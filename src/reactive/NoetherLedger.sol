// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { AbstractReactive } from "reactive-lib/base/AbstractReactive.sol";
import { ISystemContract } from "reactive-lib/interfaces/ISystemContract.sol";
import { INoetherGuard, INoetherCover, NoetherReason } from "../interfaces/INoether.sol";
import { NoetherBrain } from "./NoetherBrain.sol";

/// @title NoetherLedger
/// @notice A reactive contract on Reactive Lasna that enforces a conservation law on a Hyperlane Warp Route:
///
///             every token message delivered on one chain was dispatched, exactly once, on the other.
///
///         Each Hyperlane message has an id (keccak256 of the message) that is identical on both chains.
///         Noether watches the origin Mailbox's `Dispatch` (filtered to the route's router) and the
///         destination guard's `Inbound` (emitted by `NoetherIsm.verify`, inside `Mailbox.process`), and
///         keeps a double-entry ledger keyed by that id. A delivery with no dispatch behind it is
///         unbacked supply (spoke side) or drained collateral (home side), whatever the route's security
///         module was persuaded to accept.
///
/// @dev Response ladder (see docs/DESIGN.md):
///      1. SUSPECT   an `Inbound` with no `Dispatch` seen yet. The two chains' events can reach Reactive in
///                   either order, so this alone isn't proof. Noether quarantines the recipient, holds the home
///                   redemption path and cover sales, and subscribes to its cron clock inside react().
///      2. NEURAL    the on-chain scorer rates the suspect in the same reaction. If confident (p >= 0.95)
///                   Noether skips the grace window. The model can only accelerate a freeze.
///      3. CLEARED   the matching `Dispatch` arrives within the grace window: holds and quarantine lifted,
///                   clock unsubscribed.
///      4. VIOLATION replay, mismatch, or grace timeout: every guard on every chain freezes, cover pays out,
///                   and Noether subscribes to the attacker's transfers to trace the funds.
contract NoetherLedger is AbstractReactive {
    // ------------------------------------------------------------------ constants

    /// @dev Hyperlane Mailbox: `Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)`.
    uint256 internal constant DISPATCH_TOPIC = uint256(keccak256("Dispatch(address,uint32,bytes32,bytes)"));
    /// @dev NoetherIsm: `Inbound(bytes32 indexed id, uint32 indexed origin, bytes32 indexed tokenRecipient, uint256 amount, uint256 timestamp)`.
    uint256 internal constant INBOUND_TOPIC = uint256(keccak256("Inbound(bytes32,uint32,bytes32,uint256,uint256)"));
    uint256 internal constant TRANSFER_TOPIC = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 internal constant PAYOUT_BATCH_TOPIC = uint256(keccak256("PayoutBatch(bytes32,uint256,uint256)"));

    /// @notice Legacy system contract that still emits the cron events on Reactive Omni.
    address internal constant CRON = 0x0000000000000000000000000000000000fffFfF;
    /// @notice `Cron1`: one event per Lasna block (~1 s on Omni).
    uint256 internal constant CRON1_TOPIC = 0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;

    /// @dev Hyperlane message layout (Message.sol) and warp-route body layout (TokenMessage.sol).
    uint256 internal constant DESTINATION_OFFSET = 41;
    uint256 internal constant BODY_OFFSET = 77;
    uint256 internal constant MIN_TOKEN_MESSAGE = 141; // header + recipient(32) + amount(32)

    uint64 internal constant GUARD_GAS = 400_000;
    uint64 internal constant SETTLE_GAS = 2_000_000;
    uint256 public constant SETTLE_BATCH = 20;
    uint256 public constant MAX_TAINT = 16;
    uint8 public constant MAX_TAINT_DEPTH = 3;
    uint256 internal constant BURST_WINDOW = 32;
    int256 internal constant ONE = 1_000_000;

    // ------------------------------------------------------------------ types

    enum Mode {
        NORMAL,
        ALERT,
        BREACHED
    }

    enum Kind {
        NONE,
        MINT, // delivered on a spoke with no dispatch from home seen
        RELEASE // delivered on home with no dispatch from a spoke seen
    }

    /// @notice One warp-route deployment: chain id (equal to its Hyperlane domain on these testnets),
    ///         its Hyperlane Mailbox, the route's router (the token on spokes), and Noether's guard ISM.
    struct Endpoint {
        uint256 chainId;
        address mailbox;
        address router;
        address guard;
    }

    struct Msg {
        uint128 amount;
        uint32 origin;
        uint32 destination;
        uint8 status; // 0 unknown, 1 dispatched, 2 delivered
        address recipient;
    }

    struct Suspect {
        Kind kind;
        uint64 chainId; // chain the delivery happened on
        uint64 raisedAt;
        uint64 deadline;
        address account;
        uint128 amount;
        uint256 origin; // origin domain claimed by the delivered message
        uint256 txHash;
        uint256 originTs;
        int256 logit;
    }

    // ------------------------------------------------------------------ events (all on Lasna)

    event Accounted(
        bytes32 indexed messageId, uint256 indexed chainId, bool inbound, uint256 escrowed, uint256 circulating
    );
    event SuspectRaised(
        bytes32 indexed id,
        Kind kind,
        uint256 chainId,
        uint256 origin,
        address account,
        uint256 amount,
        int256 logit,
        uint256 probabilityBps,
        uint256 deadline
    );
    event SuspectCleared(bytes32 indexed id, uint256 lasnaBlocksWaited);
    event ConservationBroken(
        bytes32 indexed incidentId,
        uint8 reason,
        uint256 chainId,
        uint256 originTxHash,
        address account,
        uint256 amount,
        uint256 escrowed,
        uint256 circulating
    );
    event ViolationWhileBreached(bytes32 indexed id, uint8 reason, uint256 chainId, uint256 originTxHash);
    event ModeChanged(Mode from, Mode to);
    event ClockSwitched(bool on);
    event TaintTraced(address indexed from, address indexed to, uint256 amount, uint8 depth, uint256 chainId);
    event PayoutContinued(bytes32 indexed incidentId, uint256 nextIndex, uint256 remaining);
    event CallbackSent(uint256 indexed chainId, address indexed target, bytes4 selector);
    event IncidentResolved(bytes32 indexed incidentId, address by);

    // ------------------------------------------------------------------ errors

    error OnlyOwner();
    error NotBreached();

    // ------------------------------------------------------------------ config

    address public immutable owner;
    address public immutable cover;
    uint256 public graceBlocks;
    Endpoint internal _home;
    Endpoint[] internal _spokes;
    mapping(uint256 chainId => uint256) internal _spokeIndex; // 1-based

    // ------------------------------------------------------------------ ledger state

    Mode public mode;
    uint256 public lockedTotal; // home -> spokes
    uint256 public releasedTotal; // delivered on home
    uint256 public mintedTotal; // delivered on spokes
    uint256 public burnedTotal; // spokes -> home

    mapping(bytes32 messageId => Msg) public messages;
    mapping(bytes32 id => Suspect) public suspects;
    bytes32[] public openSuspects;
    mapping(bytes32 id => uint256) internal _openIndex; // 1-based

    // scorer features
    mapping(address => bool) public knownRecipient;
    uint256 public avgLock;
    uint256 public lastLockBlock;
    uint64[8] internal _recentUnbacked;
    uint256 internal _recentCursor;

    // response state
    bool public clockOn;
    bytes32 public alertEpisode;
    bytes32 public activeIncident;
    uint256 public incidentCount;
    mapping(address => uint8) public taintDepth;
    address[] public tainted;
    mapping(address => uint256) public taintChain;
    uint256 public lastPayoutIndex;

    // ------------------------------------------------------------------ construction

    /// @param home_        Collateral side of the route (Base Sepolia in the demo).
    /// @param cover_       NoetherCover on the home chain.
    /// @param spokes_      Synthetic side(s) of the route (Unichain Sepolia in the demo).
    /// @param graceBlocks_ Lasna blocks a suspect may stay unexplained before it is a violation.
    constructor(Endpoint memory home_, address cover_, Endpoint[] memory spokes_, uint256 graceBlocks_) payable {
        owner = msg.sender;
        cover = cover_;
        graceBlocks = graceBlocks_;
        _home = home_;

        _subDispatch(home_);
        _sub(home_.chainId, home_.guard, INBOUND_TOPIC);
        _sub(home_.chainId, cover_, PAYOUT_BATCH_TOPIC);
        for (uint256 i = 0; i < spokes_.length; ++i) {
            _spokes.push(spokes_[i]);
            _spokeIndex[spokes_[i].chainId] = i + 1;
            _subDispatch(spokes_[i]);
            _sub(spokes_[i].chainId, spokes_[i].guard, INBOUND_TOPIC);
        }
    }

    // ------------------------------------------------------------------ entry point

    /// @notice Entry point called by the system contract for every subscribed log.
    function react(LogRecord calldata log_) external onlySystem {
        uint256 c = log_.chainId;
        address a = log_.contractAddress;
        uint256 t = log_.topic0;

        if (a == CRON && t == CRON1_TOPIC && c == block.chainid) {
            _onTick();
            return;
        }
        if (c == _home.chainId) {
            if (a == _home.mailbox && t == DISPATCH_TOPIC && log_.topic1 == _word(_home.router)) {
                _onDispatch(log_, true);
            } else if (a == _home.guard && t == INBOUND_TOPIC) {
                _onInbound(log_, false);
            } else if (a == cover && t == PAYOUT_BATCH_TOPIC) {
                _onPayoutBatch(log_);
            }
            return;
        }
        uint256 ix = _spokeIndex[c];
        if (ix == 0) return;
        Endpoint storage s = _spokes[ix - 1];
        if (a == s.mailbox && t == DISPATCH_TOPIC && log_.topic1 == _word(s.router)) _onDispatch(log_, false);
        else if (a == s.guard && t == INBOUND_TOPIC) _onInbound(log_, true);
        else if (a == s.router && t == TRANSFER_TOPIC) _onTaintedTransfer(log_);
    }

    // ------------------------------------------------------------------ dispatch side (origin chain)

    /// @dev A warp-route transfer leaving `log_.chainId`. Locks when it leaves home, burns when it leaves a spoke.
    function _onDispatch(LogRecord calldata log_, bool fromHome) internal {
        bytes memory m = abi.decode(log_.data, (bytes));
        if (m.length < MIN_TOKEN_MESSAGE) return;
        bytes32 id = keccak256(m);
        uint32 destination = uint32(bytes4(_slice32(m, DESTINATION_OFFSET)));
        address recipient = address(uint160(uint256(_slice32(m, BODY_OFFSET))));
        uint256 amount = uint256(_slice32(m, BODY_OFFSET + 32));

        if (fromHome) {
            lockedTotal += amount;
            avgLock = avgLock == 0 ? amount : (avgLock * 7 + amount) / 8;
            lastLockBlock = block.number;
        } else {
            burnedTotal += amount;
        }
        knownRecipient[recipient] = true;

        if (_isOpen(id)) {
            // The delivery reached Reactive first. Now check it against the dispatch it claimed.
            Suspect memory s = suspects[id];
            messages[id] = Msg(uint128(amount), uint32(log_.chainId), destination, 2, recipient);
            if (s.amount == amount && s.account == recipient && s.chainId == destination && s.origin == log_.chainId) {
                _clear(id);
            } else {
                uint8 reason = s.kind == Kind.MINT ? NoetherReason.MINT_MISMATCH : NoetherReason.RELEASE_MISMATCH;
                _violate(id, reason, s.chainId, s.txHash, s.originTs, s.account, s.amount);
            }
        } else if (messages[id].status == 0) {
            messages[id] = Msg(uint128(amount), uint32(log_.chainId), destination, 1, recipient);
        }
        emit Accounted(id, log_.chainId, false, escrowed(), circulating());
    }

    // ------------------------------------------------------------------ delivery side (destination chain)

    /// @dev A warp-route message delivered on `log_.chainId` (mint on a spoke, release on home), as reported
    ///      by NoetherIsm.verify inside Mailbox.process.
    function _onInbound(LogRecord calldata log_, bool isMint) internal {
        bytes32 id = bytes32(log_.topic1);
        uint256 origin = log_.topic2;
        address recipient = address(uint160(log_.topic3));
        (uint256 amount, uint256 ts) = abi.decode(log_.data, (uint256, uint256));
        if (isMint) mintedTotal += amount;
        else releasedTotal += amount;

        Msg storage msg_ = messages[id];
        if (msg_.status == 2 || _isOpen(id)) {
            uint8 reason = isMint ? NoetherReason.MINT_REPLAY : NoetherReason.RELEASE_REPLAY;
            _violate(id, reason, log_.chainId, log_.txHash, ts, recipient, amount);
        } else if (msg_.status == 1) {
            msg_.status = 2;
            if (
                msg_.amount != amount || msg_.recipient != recipient || msg_.destination != log_.chainId
                    || msg_.origin != origin
            ) {
                uint8 reason = isMint ? NoetherReason.MINT_MISMATCH : NoetherReason.RELEASE_MISMATCH;
                _violate(id, reason, log_.chainId, log_.txHash, ts, recipient, amount);
            }
        } else {
            _raise(id, isMint ? Kind.MINT : Kind.RELEASE, log_.chainId, origin, recipient, amount, log_.txHash, ts);
        }
        emit Accounted(id, log_.chainId, true, escrowed(), circulating());
    }

    /// @dev Only reachable for addresses Noether subscribed to after a violation.
    function _onTaintedTransfer(LogRecord calldata log_) internal {
        address from = address(uint160(log_.topic1));
        address to = address(uint160(log_.topic2));
        uint8 d = taintDepth[from];
        if (d == 0 || to == address(0)) return;
        uint256 amount = abi.decode(log_.data, (uint256));
        if (taintDepth[to] == 0 && d < MAX_TAINT_DEPTH && tainted.length < MAX_TAINT && to != log_.contractAddress) {
            _quarantineOn(log_.chainId, to, activeIncident, 0);
            _taint(to, log_.chainId, d + 1);
            emit TaintTraced(from, to, amount, d + 1, log_.chainId);
        }
    }

    // ------------------------------------------------------------------ cover payout loop

    /// @dev The cover pool pays a batch per callback and reports progress. Noether keeps requesting the
    ///      next batch until nothing remains: a payout that finishes itself with no keeper.
    function _onPayoutBatch(LogRecord calldata log_) internal {
        bytes32 incidentId = bytes32(log_.topic1);
        (uint256 nextIndex, uint256 remaining) = abi.decode(log_.data, (uint256, uint256));
        if (remaining == 0 || nextIndex <= lastPayoutIndex) return;
        lastPayoutIndex = nextIndex;
        _callback(
            _home.chainId,
            cover,
            SETTLE_GAS,
            abi.encodeCall(INoetherCover.settleBatch, (address(0), incidentId, SETTLE_BATCH))
        );
        emit PayoutContinued(incidentId, nextIndex, remaining);
    }

    // ------------------------------------------------------------------ clock

    function _onTick() internal {
        uint256 n = openSuspects.length;
        for (uint256 i = 0; i < n; ++i) {
            Suspect memory s = suspects[openSuspects[i]];
            if (block.number > s.deadline) {
                uint8 reason = s.kind == Kind.MINT ? NoetherReason.UNBACKED_MINT : NoetherReason.UNBACKED_RELEASE;
                _violate(openSuspects[i], reason, s.chainId, s.txHash, s.originTs, s.account, s.amount);
                return; // _violate clears every open suspect
            }
        }
    }

    function _setClock(bool on_) internal {
        if (clockOn == on_) return;
        clockOn = on_;
        if (on_) _sub(block.chainid, CRON, CRON1_TOPIC);
        else _unsub(block.chainid, CRON, CRON1_TOPIC);
        emit ClockSwitched(on_);
    }

    // ------------------------------------------------------------------ response ladder

    function _raise(
        bytes32 sid,
        Kind kind,
        uint256 chainId,
        uint256 origin,
        address account,
        uint256 amount,
        uint256 txHash,
        uint256 ts
    ) internal {
        int256 z = NoetherBrain.logit(_features(account, amount));
        _recentUnbacked[_recentCursor++ % 8] = uint64(block.number);

        if (mode == Mode.BREACHED) {
            // Already frozen everywhere: record it and follow the money, nothing else to do.
            emit ViolationWhileBreached(sid, NoetherReason.NONE, chainId, txHash);
            if (kind == Kind.MINT) _quarantineAndTaint(chainId, account, ts);
            return;
        }

        uint256 deadline = block.number + graceBlocks;
        emit SuspectRaised(sid, kind, chainId, origin, account, amount, z, NoetherBrain.probabilityBps(z), deadline);

        if (NoetherBrain.escalate(z)) {
            // Confident forgery: freeze in this same reaction. Nothing to store, the freeze subsumes it.
            _violate(sid, NoetherReason.NEURAL_ESCALATION, chainId, txHash, ts, account, amount);
            return;
        }

        suspects[sid] = Suspect(
            kind,
            uint64(chainId),
            uint64(block.number),
            uint64(deadline),
            account,
            uint128(amount),
            origin,
            txHash,
            ts,
            z
        );
        openSuspects.push(sid);
        _openIndex[sid] = openSuspects.length;

        if (kind == Kind.MINT) _quarantineOn(chainId, account, sid, ts);
        if (mode == Mode.NORMAL) {
            _setMode(Mode.ALERT);
            alertEpisode = sid;
            // Redemption path and cover sales pause for a few seconds; honest transfers continue.
            bytes memory holdCall = abi.encodeCall(INoetherGuard.hold, (address(0), sid, txHash, ts));
            _callback(_home.chainId, _home.guard, GUARD_GAS, holdCall);
            _callback(_home.chainId, cover, GUARD_GAS, holdCall);
        }
        _setClock(true);
    }

    function _clear(bytes32 sid) internal {
        Suspect memory s = suspects[sid];
        _removeOpen(sid);
        emit SuspectCleared(sid, block.number - s.raisedAt);
        if (s.kind == Kind.MINT) {
            _callback(
                s.chainId,
                _guardOn(s.chainId),
                GUARD_GAS,
                abi.encodeCall(INoetherGuard.unquarantine, (address(0), sid, s.account))
            );
        }
        if (openSuspects.length == 0 && mode == Mode.ALERT) {
            _setMode(Mode.NORMAL);
            bytes memory liftCall = abi.encodeCall(INoetherGuard.lift, (address(0), alertEpisode));
            _callback(_home.chainId, _home.guard, GUARD_GAS, liftCall);
            _callback(_home.chainId, cover, GUARD_GAS, liftCall);
            _setClock(false);
        }
    }

    function _violate(
        bytes32 id,
        uint8 reason,
        uint256 chainId,
        uint256 txHash,
        uint256 ts,
        address account,
        uint256 amount
    ) internal {
        bool onSpoke = _spokeIndex[chainId] != 0;
        if (mode == Mode.BREACHED) {
            emit ViolationWhileBreached(id, reason, chainId, txHash);
            if (onSpoke) _quarantineAndTaint(chainId, account, ts);
            return;
        }
        _setMode(Mode.BREACHED);
        activeIncident = id;
        ++incidentCount;
        lastPayoutIndex = 0;

        emit ConservationBroken(id, reason, chainId, txHash, account, amount, escrowed(), circulating());

        // One reaction, every destination: home guard, cover pool and each spoke guard.
        bytes memory freezeCall = abi.encodeCall(INoetherGuard.freeze, (address(0), id, reason, txHash, ts));
        _callback(_home.chainId, _home.guard, GUARD_GAS, freezeCall);
        _callback(_home.chainId, cover, GUARD_GAS, freezeCall);
        for (uint256 i = 0; i < _spokes.length; ++i) {
            _callback(_spokes[i].chainId, _spokes[i].guard, GUARD_GAS, freezeCall);
        }
        if (onSpoke) _quarantineAndTaint(chainId, account, ts);

        // Every open suspect is subsumed by the freeze.
        while (openSuspects.length > 0) {
            bytes32 sid = openSuspects[openSuspects.length - 1];
            openSuspects.pop();
            delete _openIndex[sid];
        }
        _setClock(false);
    }

    function _quarantineAndTaint(uint256 chainId, address account, uint256 ts) internal {
        if (taintDepth[account] != 0) return;
        _quarantineOn(chainId, account, activeIncident, ts);
        _taint(account, chainId, 1);
    }

    function _quarantineOn(uint256 chainId, address account, bytes32 id, uint256 ts) internal {
        _callback(
            chainId,
            _guardOn(chainId),
            GUARD_GAS,
            abi.encodeCall(INoetherGuard.quarantine, (address(0), id, account, ts))
        );
    }

    /// @dev Dynamic subscription inside react(): follow the attacker's outgoing transfers of the synthetic token.
    function _taint(address account, uint256 chainId, uint8 depth) internal {
        if (tainted.length >= MAX_TAINT) return;
        taintDepth[account] = depth;
        taintChain[account] = chainId;
        tainted.push(account);
        SYSTEM.subscribe(chainId, _routerOn(chainId), TRANSFER_TOPIC, _word(account), REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    // ------------------------------------------------------------------ governance (direct txs on Lasna)

    /// @notice After humans have investigated and resolved each destination, reset Noether and drop the
    ///         taint subscriptions.
    function resolveIncident() external {
        if (msg.sender != owner) revert OnlyOwner();
        if (mode != Mode.BREACHED) revert NotBreached();
        for (uint256 i = 0; i < tainted.length; ++i) {
            address acc = tainted[i];
            uint256 c = taintChain[acc];
            SYSTEM.unsubscribe(c, _routerOn(c), TRANSFER_TOPIC, _word(acc), REACTIVE_IGNORE, REACTIVE_IGNORE);
            delete taintDepth[acc];
            delete taintChain[acc];
        }
        delete tainted;
        emit IncidentResolved(activeIncident, msg.sender);
        activeIncident = bytes32(0);
        _setMode(Mode.NORMAL);
    }

    function setGraceBlocks(uint256 graceBlocks_) external {
        if (msg.sender != owner) revert OnlyOwner();
        graceBlocks = graceBlocks_;
    }

    /// @notice Pays any outstanding debt to the system contract from this contract's REACT balance.
    function coverDebt() external {
        _coverDebt();
    }

    // ------------------------------------------------------------------ views

    /// @notice Collateral escrowed on the home chain, as reconstructed from events.
    function escrowed() public view returns (uint256) {
        return lockedTotal > releasedTotal ? lockedTotal - releasedTotal : 0;
    }

    /// @notice Synthetic supply circulating across all spokes, as reconstructed from events.
    function circulating() public view returns (uint256) {
        return mintedTotal > burnedTotal ? mintedTotal - burnedTotal : 0;
    }

    function home() external view returns (Endpoint memory) {
        return _home;
    }

    function spokes() external view returns (Endpoint[] memory) {
        return _spokes;
    }

    function openSuspectCount() external view returns (uint256) {
        return openSuspects.length;
    }

    function taintedCount() external view returns (uint256) {
        return tainted.length;
    }

    /// @notice Exposes the feature vector so dashboards and tests can see exactly what the scorer saw.
    function features(address account_, uint256 amount_) external view returns (int256[6] memory) {
        return _features(account_, amount_);
    }

    // ------------------------------------------------------------------ internals

    function _features(address account, uint256 amount) internal view returns (int256[6] memory f) {
        f[0] = avgLock == 0 ? ONE : _ratio(amount, avgLock * 10);
        uint256 backing = escrowed();
        f[1] = backing == 0 ? ONE : _ratio(amount, backing);
        f[2] = knownRecipient[account] ? int256(0) : ONE;
        uint256 recent = 0;
        for (uint256 i = 0; i < 8; ++i) {
            uint64 b = _recentUnbacked[i];
            if (b != 0 && b + BURST_WINDOW >= block.number) ++recent;
        }
        f[3] = _ratio(recent, 4);
        f[4] = _ratio(openSuspects.length, 4);
        f[5] = lastLockBlock == 0 ? ONE : _ratio(block.number - lastLockBlock, 600);
    }

    function _ratio(uint256 num, uint256 den) internal pure returns (int256) {
        if (den == 0) return ONE;
        uint256 r = (num * uint256(ONE)) / den;
        return r >= uint256(ONE) ? ONE : int256(r);
    }

    function _guardOn(uint256 chainId) internal view returns (address) {
        if (chainId == _home.chainId) return _home.guard;
        return _spokes[_spokeIndex[chainId] - 1].guard;
    }

    function _routerOn(uint256 chainId) internal view returns (address) {
        if (chainId == _home.chainId) return _home.router;
        return _spokes[_spokeIndex[chainId] - 1].router;
    }

    function _callback(uint256 chainId, address target, uint64 gas, bytes memory payload) internal {
        SYSTEM.requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0(chainId, target, gas, payload));
        emit CallbackSent(chainId, target, bytes4(payload));
    }

    function _setMode(Mode m) internal {
        emit ModeChanged(mode, m);
        mode = m;
    }

    function _subDispatch(Endpoint memory e) internal {
        SYSTEM.subscribe(e.chainId, e.mailbox, DISPATCH_TOPIC, _word(e.router), REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _sub(uint256 chainId, address target, uint256 topic) internal {
        SYSTEM.subscribe(chainId, target, topic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _unsub(uint256 chainId, address target, uint256 topic) internal {
        SYSTEM.unsubscribe(chainId, target, topic, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _isOpen(bytes32 sid) internal view returns (bool) {
        return _openIndex[sid] != 0;
    }

    function _removeOpen(bytes32 sid) internal {
        uint256 idx = _openIndex[sid];
        if (idx == 0) return;
        uint256 last = openSuspects.length;
        if (idx != last) {
            bytes32 moved = openSuspects[last - 1];
            openSuspects[idx - 1] = moved;
            _openIndex[moved] = idx;
        }
        openSuspects.pop();
        delete _openIndex[sid];
    }

    function _word(address a) internal pure returns (uint256) {
        return uint256(uint160(a));
    }

    function _slice32(bytes memory b, uint256 offset) internal pure returns (bytes32 out) {
        assembly {
            out := mload(add(add(b, 32), offset))
        }
    }
}
