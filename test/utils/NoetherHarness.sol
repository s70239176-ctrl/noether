// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test, Vm } from "forge-std/Test.sol";
import { IReactive } from "reactive-lib/interfaces/IReactive.sol";
import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { Mailbox } from "@hyperlane-xyz/core/contracts/Mailbox.sol";
import { MerkleTreeHook } from "@hyperlane-xyz/core/contracts/hooks/MerkleTreeHook.sol";
import { TestPostDispatchHook } from "@hyperlane-xyz/core/contracts/test/TestPostDispatchHook.sol";
import { TrustedRelayerIsm } from "@hyperlane-xyz/core/contracts/isms/TrustedRelayerIsm.sol";
import { HypERC20Collateral } from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import { IInterchainSecurityModule } from "@hyperlane-xyz/core/contracts/interfaces/IInterchainSecurityModule.sol";
import { MockSystem } from "./MockSystem.sol";
import { DemoUSD } from "../../src/bridge/DemoUSD.sol";
import { NoetherIsm } from "../../src/hyperlane/NoetherIsm.sol";
import { NoetherHypERC20, INoetherGuardState } from "../../src/hyperlane/NoetherHypERC20.sol";
import { NoetherCover } from "../../src/cover/NoetherCover.sol";
import { NoetherLedger } from "../../src/reactive/NoetherLedger.sol";

/// @notice Runs the whole cross-chain loop inside one EVM, on Hyperlane's real contracts:
///         one real `Mailbox` per domain, real `MerkleTreeHook`, real `TrustedRelayerIsm`, real
///         `HypERC20Collateral` and `HypERC20` routers. The harness plays three off-chain roles:
///         - the Hyperlane relayer: takes `Dispatch` messages and calls `Mailbox.process` on the destination,
///         - the Reactive Network: feeds a log to `NoetherLedger.react()` only if a live subscription matches,
///         - the callback proxy: delivers requested callbacks with Noether's address injected.
abstract contract NoetherHarness is Test {
    address internal constant SYSTEM = 0x8888888888888888888888888888888888888888;
    address internal constant CRON = 0x0000000000000000000000000000000000fffFfF;
    uint256 internal constant CRON1_TOPIC = 0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;
    bytes32 internal constant DISPATCH_TOPIC = keccak256("Dispatch(address,uint32,bytes32,bytes)");

    uint32 internal constant HOME = 84532; // Base Sepolia
    uint32 internal constant SPOKE_A = 1301; // Unichain Sepolia
    uint32 internal constant SPOKE_B = 11155111; // Ethereum Sepolia
    uint256 internal constant GRACE = 5;

    MockSystem internal sys;
    DemoUSD internal dusd;
    NoetherCover internal cover;
    NoetherLedger internal ledger;

    Mailbox internal homeMailbox;
    Mailbox internal mailboxA;
    Mailbox internal mailboxB;
    NoetherIsm internal homeGuard;
    NoetherIsm internal guardA;
    NoetherIsm internal guardB;
    HypERC20Collateral internal homeRouter;
    NoetherHypERC20 internal spokeA;
    NoetherHypERC20 internal spokeB;

    address internal proxy = makeAddr("callbackProxy");
    address internal guardian = makeAddr("guardian");
    address internal relayer = makeAddr("relayer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker");
    address internal accomplice = makeAddr("accomplice");
    address internal underwriter = makeAddr("underwriter");

    uint256 internal _txCounter;
    uint256 internal reactCount;
    uint256 internal deliveredCount;
    uint256 internal maxReactGas;
    uint32 internal forgedNonce = 900_000_000;

    mapping(address => uint256) internal chainOf;
    mapping(uint32 => Mailbox) internal mailboxOf;
    bytes[] internal _inFlight; // dispatched Hyperlane messages awaiting relay

    function setUp() public virtual {
        vm.etch(SYSTEM, address(new MockSystem()).code);
        sys = MockSystem(payable(SYSTEM));
        vm.warp(1_800_000_000);
        vm.roll(100);

        dusd = new DemoUSD();
        (homeMailbox, homeGuard) = _domain(HOME, true);
        (mailboxA, guardA) = _domain(SPOKE_A, false);
        (mailboxB, guardB) = _domain(SPOKE_B, false);

        homeRouter = new HypERC20Collateral(address(dusd), 1, 1, address(homeMailbox));
        homeRouter.initialize(address(new MerkleTreeHook(address(homeMailbox))), address(homeGuard), address(this));
        spokeA = _spoke(mailboxA, guardA);
        spokeB = _spoke(mailboxB, guardB);

        homeRouter.enrollRemoteRouter(SPOKE_A, _b32(address(spokeA)));
        homeRouter.enrollRemoteRouter(SPOKE_B, _b32(address(spokeB)));
        spokeA.enrollRemoteRouter(HOME, _b32(address(homeRouter)));
        spokeB.enrollRemoteRouter(HOME, _b32(address(homeRouter)));

        cover = new NoetherCover{ value: 1 ether }(IPayable(payable(proxy)), guardian, 30 days);

        NoetherLedger.Endpoint[] memory spokes = new NoetherLedger.Endpoint[](2);
        spokes[0] = NoetherLedger.Endpoint(SPOKE_A, address(mailboxA), address(spokeA), address(guardA));
        spokes[1] = NoetherLedger.Endpoint(SPOKE_B, address(mailboxB), address(spokeB), address(guardB));
        ledger = new NoetherLedger{ value: 1 ether }(
            NoetherLedger.Endpoint(HOME, address(homeMailbox), address(homeRouter), address(homeGuard)),
            address(cover),
            spokes,
            GRACE
        );

        vm.startPrank(guardian);
        homeGuard.setRouter(address(homeRouter));
        guardA.setRouter(address(spokeA));
        guardB.setRouter(address(spokeB));
        homeGuard.setNoether(address(ledger));
        guardA.setNoether(address(ledger));
        guardB.setNoether(address(ledger));
        cover.setNoether(address(ledger));
        vm.stopPrank();

        _tag(HOME, address(homeMailbox), address(homeGuard), address(homeRouter));
        _tag(SPOKE_A, address(mailboxA), address(guardA), address(spokeA));
        _tag(SPOKE_B, address(mailboxB), address(guardB), address(spokeB));
        chainOf[address(cover)] = HOME;

        vm.recordLogs();
    }

    function _domain(uint32 domain, bool isHome) internal returns (Mailbox mb, NoetherIsm guard) {
        mb = new Mailbox(domain);
        TrustedRelayerIsm trusted = new TrustedRelayerIsm(address(mb), relayer);
        TestPostDispatchHook required = new TestPostDispatchHook();
        MerkleTreeHook merkle = new MerkleTreeHook(address(mb));
        mb.initialize(address(this), address(trusted), address(merkle), address(required));
        guard = new NoetherIsm{ value: 1 ether }(
            IPayable(payable(proxy)), guardian, address(mb), IInterchainSecurityModule(address(trusted)), isHome
        );
        mailboxOf[domain] = mb;
    }

    function _spoke(Mailbox mb, NoetherIsm guard) internal returns (NoetherHypERC20 t) {
        t = new NoetherHypERC20(18, address(mb), INoetherGuardState(address(guard)));
        t.initialize(
            0, "Noether dUSD", "ndUSD", address(new MerkleTreeHook(address(mb))), address(guard), address(this)
        );
    }

    function _tag(uint256 c, address mb, address g, address r) internal {
        chainOf[mb] = c;
        chainOf[g] = c;
        chainOf[r] = c;
    }

    // ------------------------------------------------------------------ Reactive Network simulation

    /// @notice Feed everything recorded so far, then deliver callbacks until quiet. Does NOT relay
    ///         Hyperlane messages; call `_relay()` for that, so tests control cross-chain ordering.
    function _run() internal {
        _feed(vm.getRecordedLogs());
        _deliverAll();
    }

    function _capture() internal view returns (Vm.Log[] memory) {
        return vm.getRecordedLogs();
    }

    function _feed(Vm.Log[] memory logs) internal {
        for (uint256 i = 0; i < logs.length; ++i) {
            uint256 c = chainOf[logs[i].emitter];
            if (c == 0) continue;
            if (logs[i].topics.length > 0 && logs[i].topics[0] == DISPATCH_TOPIC) {
                _inFlight.push(abi.decode(logs[i].data, (bytes)));
            }
            uint256[4] memory t;
            for (uint256 k = 0; k < logs[i].topics.length && k < 4; ++k) {
                t[k] = uint256(logs[i].topics[k]);
            }
            if (!sys.matches(address(ledger), c, logs[i].emitter, t)) continue;
            _react(c, logs[i].emitter, t, logs[i].data, logs[i].topics.length);
        }
    }

    function _react(uint256 c, address emitter, uint256[4] memory t, bytes memory data, uint256 opCode) internal {
        IReactive.LogRecord memory r = IReactive.LogRecord({
            chainId: c,
            contractAddress: emitter,
            topic0: t[0],
            topic1: t[1],
            topic2: t[2],
            topic3: t[3],
            data: data,
            blockNumber: block.number,
            opCode: opCode,
            blockHash: uint256(blockhash(block.number - 1)),
            txHash: uint256(keccak256(abi.encode("tx", ++_txCounter))),
            logIndex: 0
        });
        vm.prank(SYSTEM);
        uint256 g = gasleft();
        ledger.react(r);
        uint256 used = g - gasleft();
        if (used > maxReactGas) maxReactGas = used;
        ++reactCount;
    }

    function _deliverAll() internal {
        uint256 guard = 0;
        while (sys.pending() > 0) {
            require(++guard < 500, "callback storm");
            MockSystem.Request memory r = sys.next();
            assertEq(r.sender, address(ledger), "callback requested by someone else");
            assertGe(r.gasLimit, 100_000, "callbacks below 100k gas are ignored by the network");
            bytes memory payload = r.payload;
            address injected = r.sender;
            assembly {
                mstore(add(payload, 36), injected) // first argument after the 4-byte selector
            }
            vm.prank(proxy);
            (bool ok, bytes memory ret) = r.recipient.call{ gas: r.gasLimit }(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
            ++deliveredCount;
            _feed(vm.getRecordedLogs());
        }
    }

    /// @notice Advance `n` Lasna blocks, emitting Cron1 only while Noether is subscribed to it.
    function _tick(uint256 n) internal {
        for (uint256 i = 0; i < n; ++i) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 1);
            uint256[4] memory t = [CRON1_TOPIC, 0, 0, 0];
            if (sys.matches(address(ledger), block.chainid, CRON, t)) {
                _react(block.chainid, CRON, t, abi.encode(block.number), 1);
            }
            _run();
        }
    }

    // ------------------------------------------------------------------ Hyperlane relayer simulation

    /// @notice Relay every dispatched message seen so far, exactly as Hyperlane's relayer would.
    function _relay() internal {
        bytes[] memory batch = _inFlight;
        delete _inFlight;
        for (uint256 i = 0; i < batch.length; ++i) {
            _process(batch[i]);
        }
    }

    /// @notice Relay the Dispatch messages contained in `logs` (for out-of-order scenarios).
    function _relayFrom(Vm.Log[] memory logs) internal {
        for (uint256 i = 0; i < logs.length; ++i) {
            if (chainOf[logs[i].emitter] != 0 && logs[i].topics[0] == DISPATCH_TOPIC) {
                _process(abi.decode(logs[i].data, (bytes)));
            }
        }
    }

    function _process(bytes memory message) internal {
        uint32 destination;
        assembly {
            destination := shr(224, mload(add(add(message, 32), 41)))
        }
        Mailbox mb = mailboxOf[destination];
        if (mb.delivered(keccak256(message))) return; // a relayer never delivers twice
        vm.prank(relayer, relayer);
        mb.process("", message);
    }

    /// @notice What a compromised trusted-relayer key can do: hand-craft a message "from" the enrolled
    ///         remote router and have the real Mailbox accept it.
    function _forge(uint32 origin, address fromRouter, uint32 destination, address toRouter, address to, uint256 amount)
        internal
        returns (bytes memory message)
    {
        message = abi.encodePacked(
            uint8(3), ++forgedNonce, origin, _b32(fromRouter), destination, _b32(toRouter), _b32(to), amount
        );
        vm.prank(relayer, relayer);
        mailboxOf[destination].process("", message);
    }

    function _forgeMint(NoetherHypERC20 spoke, address to, uint256 amount) internal {
        uint32 d = spoke == spokeA ? SPOKE_A : SPOKE_B;
        _forge(HOME, address(homeRouter), d, address(spoke), to, amount);
    }

    // ------------------------------------------------------------------ users

    function _lock(address user, uint256 amount, address recipient, uint32 dst) internal {
        vm.startPrank(user);
        dusd.faucet();
        dusd.approve(address(homeRouter), type(uint256).max);
        homeRouter.transferRemote(dst, _b32(recipient), amount);
        vm.stopPrank();
    }

    function _burn(NoetherHypERC20 spoke, address user, uint256 amount, address homeRecipient) internal {
        vm.prank(user);
        spoke.transferRemote(HOME, _b32(homeRecipient), amount);
    }

    /// @notice Lock, let Reactive see it, relay, let Reactive see the mint.
    function _bridge(address user, uint256 amount, uint32 dst) internal {
        _lock(user, amount, user, dst);
        _run();
        _relay();
        _run();
    }

    /// @notice A few honest round trips so averages and the known-address set look like a live route.
    function _warmUp() internal {
        for (uint256 i = 0; i < 4; ++i) {
            address u = i % 2 == 0 ? alice : bob;
            _bridge(u, 500 ether, SPOKE_A);
            vm.roll(block.number + 2);
        }
    }

    function _mode() internal view returns (uint8) {
        return uint8(ledger.mode());
    }

    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }
}
