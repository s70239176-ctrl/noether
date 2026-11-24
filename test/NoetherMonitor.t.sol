// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Vm } from "forge-std/Test.sol";
import { IReactive } from "reactive-lib/interfaces/IReactive.sol";
import { NoetherHarness } from "./utils/NoetherHarness.sol";
import { NoetherMonitor } from "../src/reactive/NoetherMonitor.sol";

/// @notice Monitor mode audits a Hyperlane Warp Route from its public router events alone. Here the route is
///         the harness's real HypERC20Collateral <-> HypERC20 pair on real Mailboxes; the monitor is attached
///         without touching it (no ISM, no hooks, no owner action).
contract NoetherMonitorTest is NoetherHarness {
    NoetherMonitor monitor;
    uint256 constant GRACE_M = 5;
    uint256 n;

    function setUp() public override {
        super.setUp();
        monitor = new NoetherMonitor{ value: 1 ether }(GRACE_M);
        monitor.watchRoute("dUSD Base<>Unichain", HOME, address(homeRouter), SPOKE_A, address(spokeA), 0, 0);
        vm.getRecordedLogs();
    }

    // ------------------------------------------------------------------ helpers

    /// Feed logs to the monitor only, honouring its live subscriptions.
    function _feedM(Vm.Log[] memory logs) internal {
        for (uint256 i = 0; i < logs.length; ++i) {
            uint256 c = chainOf[logs[i].emitter];
            if (c == 0) continue;
            uint256[4] memory t;
            for (uint256 k = 0; k < logs[i].topics.length && k < 4; ++k) t[k] = uint256(logs[i].topics[k]);
            if (!sys.matches(address(monitor), c, logs[i].emitter, t)) continue;
            _reactM(c, logs[i].emitter, t, logs[i].data);
        }
    }

    function _reactM(uint256 c, address emitter, uint256[4] memory t, bytes memory data) internal {
        IReactive.LogRecord memory r = IReactive.LogRecord(c, emitter, t[0], t[1], t[2], t[3], data, block.number, 0, 0, uint256(keccak256(abi.encode("m", ++n))), 0);
        vm.prank(SYSTEM);
        monitor.react(r);
    }

    function _tickM(uint256 k) internal {
        for (uint256 i = 0; i < k; ++i) {
            vm.roll(block.number + 1);
            uint256[4] memory t = [CRON1_TOPIC, 0, 0, 0];
            if (sys.matches(address(monitor), block.chainid, CRON, t)) _reactM(block.chainid, CRON, t, abi.encode(block.number));
        }
    }

    function _route() internal view returns (NoetherMonitor.Route memory) {
        return monitor.route(0);
    }

    // ------------------------------------------------------------------ tests

    function test_HonestTransferIsMatched() public {
        _lock(alice, 700 ether, alice, SPOKE_A);
        Vm.Log[] memory sent = _capture();
        _relayFrom(sent);
        Vm.Log[] memory delivered = _capture();
        _feedM(sent);
        _feedM(delivered);
        NoetherMonitor.Route memory r = _route();
        assertEq(r.matched, 1);
        assertEq(r.escrowed, 700 ether);
        assertEq(r.circulating, 700 ether);
        assertEq(r.unexplained, 0);
        assertFalse(monitor.clockOn());
    }

    function test_RoundTripBothDirections() public {
        _lock(alice, 500 ether, alice, SPOKE_A);
        Vm.Log[] memory a = _capture();
        _relayFrom(a);
        Vm.Log[] memory b = _capture();
        _burn(spokeA, alice, 200 ether, alice);
        Vm.Log[] memory c = _capture();
        _relayFrom(c);
        Vm.Log[] memory d = _capture();
        _feedM(a);
        _feedM(b);
        _feedM(c);
        _feedM(d);
        NoetherMonitor.Route memory r = _route();
        assertEq(r.matched, 2);
        assertEq(r.escrowed, 300 ether);
        assertEq(r.circulating, 300 ether);
        assertEq(r.escrowed, dusd.balanceOf(address(homeRouter)), "reconstructed escrow equals the router's real balance");
        assertEq(r.circulating, spokeA.totalSupply(), "reconstructed supply equals the real synthetic supply");
    }

    function test_OutOfOrderDeliveryIsExplained() public {
        _lock(alice, 100 ether, alice, SPOKE_A);
        Vm.Log[] memory sent = _capture();
        _relayFrom(sent);
        _feedM(_capture()); // the delivery reaches Reactive first
        assertEq(monitor.openCount(), 1);
        assertTrue(monitor.clockOn(), "grace clock subscribed inside react()");
        _tickM(2);
        _feedM(sent);
        assertEq(monitor.openCount(), 0);
        assertFalse(monitor.clockOn(), "clock unsubscribed again");
        assertEq(_route().matched, 1);
        assertEq(_route().unbacked, 0);
    }

    function test_ForgedMintBecomesUnbackedDelivery() public {
        _forgeMint(spokeA, attacker, 1_000_000 ether); // real Mailbox accepts it; the route never installed Noether
        _feedM(_capture());
        assertEq(monitor.openCount(), 1);
        _tickM(GRACE_M);
        assertEq(_route().unbacked, 0, "still inside the grace window");
        vm.recordLogs();
        _tickM(1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool alerted;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == address(monitor) && logs[i].topics[0] == NoetherMonitor.UnbackedDelivery.selector) alerted = true;
        }
        assertTrue(alerted, "UnbackedDelivery emitted for anyone to act on");
        NoetherMonitor.Route memory r = _route();
        assertEq(r.unbacked, 1);
        assertGt(r.circulating, r.escrowed, "the books visibly fail to balance");
        assertFalse(monitor.clockOn());
    }

    function test_TransfersToOtherDestinationsAreIgnored() public {
        _lock(alice, 50 ether, alice, SPOKE_B); // same router, a route the monitor isn't watching
        _feedM(_capture());
        assertEq(_route().escrowed, 0);
        assertEq(_route().matched, 0);
    }

    function test_OnlyOwnerAddsRoutes() public {
        vm.prank(attacker);
        vm.expectRevert(NoetherMonitor.OnlyOwner.selector);
        monitor.watchRoute("x", HOME, address(0x1234), SPOKE_B, address(0x5678), 0, 0);
    }

    function test_RouteCannotBeWatchedTwice() public {
        vm.expectRevert(NoetherMonitor.BadRoute.selector);
        monitor.watchRoute("dup", HOME, address(homeRouter), SPOKE_A, address(spokeA), 0, 0);
    }

    function test_OneTransactionAddsFourSubscriptions() public {
        uint256 before = sys.activeSubscriptions(address(monitor));
        monitor.watchRoute("second", HOME, address(0xA11CE), SPOKE_B, address(0xB0B), 1, 1);
        assertEq(sys.activeSubscriptions(address(monitor)) - before, 4);
    }
}
