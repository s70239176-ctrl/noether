// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { AbstractReactive } from "reactive-lib/base/AbstractReactive.sol";

/// @title NoetherMonitor
/// @notice Monitor mode: audits ANY Hyperlane Warp Route from its public events, with zero integration.
///         The route's owner installs nothing and trusts nothing; Noether just watches.
///
///         Every Hyperlane token router emits
///             SentTransferRemote(uint32 indexed destination, bytes32 indexed recipient, uint256 amount)
///             ReceivedTransferRemote(uint32 indexed origin, bytes32 indexed recipient, uint256 amount)
///         Noether matches each delivery on one chain with a send on the other (same route, direction,
///         recipient and amount). A delivery nothing sent gets a grace window, because the two chains'
///         events can reach Reactive in either order; if still unexplained when it closes, Noether emits
///         `UnbackedDelivery`.
///
///         Monitor mode only raises alerts: the route never gave Noether the power to freeze it. Enforce mode
///         (NoetherLedger + NoetherIsm) adds the freeze. Any reactive contract, or the route owner's own
///         tooling, can subscribe to `UnbackedDelivery` and act on it.
contract NoetherMonitor is AbstractReactive {
    uint256 internal constant SENT_TOPIC = uint256(keccak256("SentTransferRemote(uint32,bytes32,uint256)"));
    uint256 internal constant RECEIVED_TOPIC = uint256(keccak256("ReceivedTransferRemote(uint32,bytes32,uint256)"));
    address internal constant CRON = 0x0000000000000000000000000000000000fffFfF;
    uint256 internal constant CRON1_TOPIC = 0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;

    /// @notice One watched route. Side A is the collateral side (where value is escrowed), side B is synthetic.
    struct Route {
        string name;
        uint64 chainA;
        uint64 chainB;
        address routerA;
        address routerB;
        uint256 escrowed; // collateral held by routerA, as reconstructed (opening balance + sends - deliveries on A)
        uint256 circulating; // synthetic supply on B, as reconstructed (opening supply + deliveries on B - sends from B)
        uint64 matched;
        uint64 unexplained;
        uint64 unbacked;
        uint64 watchedAt; // Lasna block
    }

    struct Pending {
        uint256 routeId;
        uint64 deadline;
        uint64 chainId;
        bytes32 recipient;
        uint256 amount;
        uint256 txHash;
    }

    event RouteWatched(uint256 indexed routeId, string name, uint256 chainA, address routerA, uint256 chainB, address routerB, uint256 openEscrow, uint256 openSupply);
    event TransferSent(uint256 indexed routeId, uint256 indexed fromChain, uint256 toChain, bytes32 recipient, uint256 amount, uint256 txHash);
    event TransferMatched(uint256 indexed routeId, uint256 indexed onChain, bytes32 recipient, uint256 amount, uint256 txHash, uint256 escrowed, uint256 circulating);
    event UnexplainedDelivery(uint256 indexed routeId, bytes32 indexed key, uint256 onChain, bytes32 recipient, uint256 amount, uint256 txHash, uint256 deadline);
    event DeliveryExplained(uint256 indexed routeId, bytes32 indexed key, uint256 lasnaBlocksWaited);
    event UnbackedDelivery(uint256 indexed routeId, bytes32 indexed key, uint256 onChain, bytes32 recipient, uint256 amount, uint256 originTxHash, uint256 escrowed, uint256 circulating);
    event ClockSwitched(bool on);

    error OnlyOwner();
    error BadRoute();

    address public immutable owner;
    uint256 public graceBlocks;
    Route[] internal _routes;
    /// @dev (chainId, router) -> routeId + 1, and which side it is.
    mapping(bytes32 => uint256) internal _routeOf;
    mapping(bytes32 => bool) internal _isSideA;
    /// @dev Sent-but-not-yet-delivered transfers per (route, destination chain, recipient, amount).
    mapping(bytes32 => uint256) public inFlight;
    mapping(bytes32 => Pending) public pending;
    bytes32[] public openKeys;
    mapping(bytes32 => uint256) internal _openIndex; // 1-based
    mapping(bytes32 => uint64) internal _raisedAt;
    uint256 internal _nonce;
    bool public clockOn;

    constructor(uint256 graceBlocks_) payable {
        owner = msg.sender;
        graceBlocks = graceBlocks_;
    }

    // ------------------------------------------------------------------ registry

    /// @notice Start auditing a route. One transaction, four subscriptions, nothing installed on the route.
    /// @param openEscrow_ Collateral routerA holds right now (read on-chain by the caller).
    /// @param openSupply_ Synthetic supply on chain B right now (read on-chain by the caller).
    function watchRoute(
        string calldata name_,
        uint256 chainA_,
        address routerA_,
        uint256 chainB_,
        address routerB_,
        uint256 openEscrow_,
        uint256 openSupply_
    ) external returns (uint256 routeId) {
        if (msg.sender != owner) revert OnlyOwner();
        bytes32 a = _side(chainA_, routerA_);
        bytes32 b = _side(chainB_, routerB_);
        if (_routeOf[a] != 0 || _routeOf[b] != 0 || chainA_ == chainB_) revert BadRoute();
        routeId = _routes.length;
        _routes.push(Route(name_, uint64(chainA_), uint64(chainB_), routerA_, routerB_, openEscrow_, openSupply_, 0, 0, 0, uint64(block.number)));
        _routeOf[a] = routeId + 1;
        _routeOf[b] = routeId + 1;
        _isSideA[a] = true;
        for (uint256 i = 0; i < 2; ++i) {
            (uint256 c, address r) = i == 0 ? (chainA_, routerA_) : (chainB_, routerB_);
            SYSTEM.subscribe(c, r, SENT_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
            SYSTEM.subscribe(c, r, RECEIVED_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        }
        emit RouteWatched(routeId, name_, chainA_, routerA_, chainB_, routerB_, openEscrow_, openSupply_);
    }

    function setGraceBlocks(uint256 graceBlocks_) external {
        if (msg.sender != owner) revert OnlyOwner();
        graceBlocks = graceBlocks_;
    }

    function coverDebt() external {
        _coverDebt();
    }

    // ------------------------------------------------------------------ reactive entry point

    function react(LogRecord calldata log_) external onlySystem {
        if (log_.contractAddress == CRON && log_.topic0 == CRON1_TOPIC && log_.chainId == block.chainid) {
            _onTick();
            return;
        }
        bytes32 side = _side(log_.chainId, log_.contractAddress);
        uint256 rid = _routeOf[side];
        if (rid == 0) return;
        Route storage r = _routes[rid - 1];
        bool onA = _isSideA[side];
        uint256 amount = abi.decode(log_.data, (uint256));
        bytes32 recipient = bytes32(log_.topic2);

        if (log_.topic0 == SENT_TOPIC) {
            uint256 dest = log_.topic1;
            uint256 other = onA ? r.chainB : r.chainA;
            if (dest != other) return; // a different route of the same router (multi-chain routers)
            if (onA) r.escrowed += amount;
            else r.circulating = r.circulating > amount ? r.circulating - amount : 0;
            bytes32 key = _key(rid - 1, dest, recipient, amount);
            emit TransferSent(rid - 1, log_.chainId, dest, recipient, amount, log_.txHash);
            // A delivery may have reached Reactive first: explain the oldest one waiting on this key.
            bytes32 waiting = _findOpen(key);
            if (waiting != bytes32(0)) {
                _closeOpen(waiting);
                ++r.matched;
                emit DeliveryExplained(rid - 1, waiting, block.number - _raisedAt[waiting]);
            } else {
                ++inFlight[key];
            }
        } else if (log_.topic0 == RECEIVED_TOPIC) {
            uint256 origin = log_.topic1;
            uint256 other = onA ? r.chainB : r.chainA;
            if (origin != other) return;
            if (onA) r.escrowed = r.escrowed > amount ? r.escrowed - amount : 0;
            else r.circulating += amount;
            bytes32 key = _key(rid - 1, log_.chainId, recipient, amount);
            if (inFlight[key] > 0) {
                --inFlight[key];
                ++r.matched;
                emit TransferMatched(rid - 1, log_.chainId, recipient, amount, log_.txHash, r.escrowed, r.circulating);
            } else {
                ++r.unexplained;
                bytes32 pid = keccak256(abi.encode(key, ++_nonce));
                pending[pid] = Pending(rid - 1, uint64(block.number + graceBlocks), uint64(log_.chainId), recipient, amount, log_.txHash);
                _raisedAt[pid] = uint64(block.number);
                openKeys.push(pid);
                _openIndex[pid] = openKeys.length;
                emit UnexplainedDelivery(rid - 1, pid, log_.chainId, recipient, amount, log_.txHash, block.number + graceBlocks);
                _setClock(true);
            }
        }
    }

    // ------------------------------------------------------------------ grace clock

    function _onTick() internal {
        uint256 i = 0;
        while (i < openKeys.length) {
            bytes32 pid = openKeys[i];
            Pending memory p = pending[pid];
            if (block.number > p.deadline) {
                Route storage r = _routes[p.routeId];
                ++r.unbacked;
                emit UnbackedDelivery(p.routeId, pid, p.chainId, p.recipient, p.amount, p.txHash, r.escrowed, r.circulating);
                _closeOpen(pid); // swaps the last key into slot i, so don't advance
            } else {
                ++i;
            }
        }
        if (openKeys.length == 0) _setClock(false);
    }

    function _setClock(bool on_) internal {
        if (clockOn == on_) return;
        clockOn = on_;
        if (on_) SYSTEM.subscribe(block.chainid, CRON, CRON1_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        else SYSTEM.unsubscribe(block.chainid, CRON, CRON1_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        emit ClockSwitched(on_);
    }

    // ------------------------------------------------------------------ views

    function routeCount() external view returns (uint256) {
        return _routes.length;
    }

    function route(uint256 id_) external view returns (Route memory) {
        return _routes[id_];
    }

    function openCount() external view returns (uint256) {
        return openKeys.length;
    }

    // ------------------------------------------------------------------ internals

    function _side(uint256 chainId, address router) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainId, router));
    }

    function _key(uint256 rid, uint256 deliveredOn, bytes32 recipient, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(rid, deliveredOn, recipient, amount));
    }

    function _findOpen(bytes32 key) internal view returns (bytes32) {
        for (uint256 i = 0; i < openKeys.length; ++i) {
            Pending memory p = pending[openKeys[i]];
            if (_key(p.routeId, p.chainId, p.recipient, p.amount) == key) return openKeys[i];
        }
        return bytes32(0);
    }

    function _closeOpen(bytes32 pid) internal {
        uint256 idx = _openIndex[pid];
        if (idx == 0) return;
        uint256 last = openKeys.length;
        if (idx != last) {
            bytes32 moved = openKeys[last - 1];
            openKeys[idx - 1] = moved;
            _openIndex[moved] = idx;
        }
        openKeys.pop();
        delete _openIndex[pid];
        if (openKeys.length == 0) _setClock(false);
    }
}
