// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Vm } from "forge-std/Test.sol";
import { IReactive } from "reactive-lib/interfaces/IReactive.sol";
import { NoetherHarness } from "./utils/NoetherHarness.sol";
import { NoetherGuarded } from "../src/guard/NoetherGuarded.sol";
import { NoetherIsm } from "../src/hyperlane/NoetherIsm.sol";
import { NoetherHypERC20 } from "../src/hyperlane/NoetherHypERC20.sol";
import { NoetherLedger } from "../src/reactive/NoetherLedger.sol";

/// @notice End-to-end behaviour on Hyperlane's real Mailbox / TrustedRelayerIsm / HypERC20 routers:
///         honest traffic, out-of-order delivery, forged messages from a compromised relayer key,
///         drained collateral, taint tracing, governance and authentication.
contract NoetherLoopTest is NoetherHarness {
    uint8 constant NORMAL = 0;
    uint8 constant ALERT = 1;
    uint8 constant BREACHED = 2;

    // ------------------------------------------------------------------ honest traffic

    function test_HonestRoundTripNeverAlarms() public {
        _bridge(alice, 1_000 ether, SPOKE_A);
        assertEq(spokeA.balanceOf(alice), 1_000 ether, "real HypERC20 minted on the spoke");

        uint256 before = dusd.balanceOf(alice);
        _burn(spokeA, alice, 400 ether, alice);
        _run();
        _relay();
        _run();
        assertEq(dusd.balanceOf(alice) - before, 400 ether, "real HypERC20Collateral released on home");

        assertEq(_mode(), NORMAL);
        assertEq(ledger.escrowed(), 600 ether);
        assertEq(ledger.circulating(), 600 ether);
        assertEq(ledger.escrowed(), dusd.balanceOf(address(homeRouter)), "ledger mirrors the collateral router");
        assertEq(ledger.circulating(), spokeA.totalSupply(), "ledger mirrors the synthetic supply");
        assertEq(sys.totalRequests(), 0, "no callback was ever needed");
        assertFalse(ledger.clockOn(), "cron stays unsubscribed while nothing is suspicious");
    }

    function test_OutOfOrderMintIsHeldThenAutoCleared() public {
        _warmUp();
        _lock(alice, 300 ether, alice, SPOKE_A);
        Vm.Log[] memory lockLogs = _capture(); // Base event is late to reach Reactive...
        _relayFrom(lockLogs); // ...but the relayer already delivered it on Unichain
        _run();

        assertEq(_mode(), ALERT);
        assertTrue(guardA.quarantined(alice), "recipient quarantined while unexplained");
        assertTrue(homeGuard.held(), "redemption path held");
        assertTrue(cover.held(), "cover sales held");
        assertTrue(ledger.clockOn(), "cron subscribed dynamically inside react()");

        _tick(2);
        _feed(lockLogs); // the Dispatch finally reaches Reactive, inside the grace window
        _deliverAll();

        assertEq(_mode(), NORMAL);
        assertFalse(guardA.quarantined(alice));
        assertFalse(homeGuard.held());
        assertFalse(cover.held());
        assertFalse(ledger.clockOn(), "cron unsubscribed again");
        assertFalse(guardA.frozen());
    }

    // ------------------------------------------------------------------ forged messages

    function test_ForgedMintThatLooksHonestFreezesAfterGrace() public {
        _warmUp();
        // Small forged message to a known user: the scorer stays calm, so the deterministic clock decides.
        _forgeMint(spokeA, alice, 100 ether);
        _run();
        assertEq(_mode(), ALERT);

        _tick(GRACE);
        assertEq(_mode(), ALERT, "still inside the grace window");
        _tick(1);

        assertEq(_mode(), BREACHED, "no dispatch backed it: violation");
        assertTrue(homeGuard.frozen() && cover.frozen() && guardA.frozen() && guardB.frozen(), "every chain frozen");
        assertFalse(ledger.clockOn());
    }

    function test_ForgedWhaleMintFreezesInTheSameReaction() public {
        _warmUp();
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        assertEq(spokeA.balanceOf(attacker), 1_000_000 ether, "the real Mailbox accepted the forged message");

        uint256 reactsBefore = reactCount;
        uint256 requestsBefore = sys.totalRequests();
        _feed(_capture());
        assertEq(reactCount - reactsBefore, 1, "one reactive transaction");
        assertEq(_mode(), BREACHED, "neural escalation skipped the grace window");
        // home guard + cover + 2 spoke guards frozen, attacker quarantined: 5 callbacks, 3 chains, one react().
        assertEq(sys.totalRequests() - requestsBefore, 5, "multi-destination fan-out");
        _deliverAll();

        assertTrue(guardA.frozen() && guardB.frozen() && homeGuard.frozen() && cover.frozen());
        assertTrue(guardA.quarantined(attacker));

        // The attacker's follow-ups fail on every chain.
        vm.expectRevert("Mailbox: ISM verification failed");
        _forgeMint(spokeB, attacker, 1_000_000 ether);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(NoetherHypERC20.NoetherQuarantined.selector, attacker));
        spokeA.transfer(accomplice, 1 ether);
        vm.expectRevert("Mailbox: ISM verification failed");
        _forge(SPOKE_A, address(spokeA), HOME, address(homeRouter), attacker, 1 ether);

        // Nobody can bridge out while frozen, but honest holders still transact on the spoke.
        vm.expectRevert(NoetherHypERC20.NoetherFrozen.selector);
        _burn(spokeA, alice, 1 ether, alice);
        vm.prank(alice);
        spokeA.transfer(bob, 1 ether);
    }

    function test_DrainedCollateralFreezesHome() public {
        _warmUp();
        uint256 escrow = dusd.balanceOf(address(homeRouter));
        // Forged "burn" message from the spoke router: releases real collateral with nothing burned.
        _forge(SPOKE_A, address(spokeA), HOME, address(homeRouter), attacker, 1_000 ether);
        assertEq(dusd.balanceOf(attacker), 1_000 ether, "the first drain lands");
        _run();
        if (_mode() != BREACHED) _tick(GRACE + 1);
        assertEq(_mode(), BREACHED);
        assertTrue(homeGuard.frozen());

        // Nomad-style copycats get nothing.
        vm.expectRevert("Mailbox: ISM verification failed");
        _forge(SPOKE_A, address(spokeA), HOME, address(homeRouter), accomplice, 1_000 ether);
        assertEq(dusd.balanceOf(address(homeRouter)), escrow - 1_000 ether);
    }

    function test_OutOfOrderReleaseClears() public {
        _warmUp();
        _burn(spokeA, alice, 200 ether, alice);
        Vm.Log[] memory burnLogs = _capture();
        _relayFrom(burnLogs);
        _run();
        assertEq(_mode(), ALERT);
        _feed(burnLogs);
        _deliverAll();
        assertEq(_mode(), NORMAL);
        assertFalse(homeGuard.held());
    }

    function test_HyperlaneRejectsCrossChainReplayNatively() public {
        _lock(alice, 100 ether, alice, SPOKE_A);
        Vm.Log[] memory logs = _capture();
        bytes memory m;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == address(homeMailbox) && logs[i].topics[0] == DISPATCH_TOPIC) {
                m = abi.decode(logs[i].data, (bytes));
            }
        }
        vm.prank(relayer, relayer);
        vm.expectRevert("Mailbox: unexpected destination");
        mailboxB.process("", m); // a message bound for Unichain can't be replayed on Sepolia
    }

    function test_OtherRoutesOnTheSameMailboxAreIgnored() public {
        uint256 before = reactCount;
        vm.prank(alice);
        homeMailbox.dispatch(SPOKE_A, _b32(address(0xBEEF)), "unrelated app message");
        _run();
        assertEq(reactCount, before, "the Dispatch subscription is filtered to the route's router");
    }

    // ------------------------------------------------------------------ taint tracing

    function test_TaintFollowsFundsMovedBeforeQuarantineLanded() public {
        _warmUp();
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        // Reactive has reacted, but the callbacks are still in flight...
        _feed(_capture());
        assertEq(_mode(), BREACHED);
        assertFalse(guardA.quarantined(attacker), "quarantine not landed yet");

        // ...and in that window the attacker moves funds.
        vm.prank(attacker);
        spokeA.transfer(accomplice, 400_000 ether);
        _feed(_capture()); // the Transfer matches the subscription Noether added inside react()
        _deliverAll();

        assertTrue(guardA.quarantined(attacker));
        assertTrue(guardA.quarantined(accomplice), "hop 1 traced and quarantined");
        assertEq(ledger.taintDepth(accomplice), 2);
        vm.prank(accomplice);
        vm.expectRevert(abi.encodeWithSelector(NoetherHypERC20.NoetherQuarantined.selector, accomplice));
        spokeA.transfer(bob, 1 ether);
    }

    // ------------------------------------------------------------------ gas

    /// @notice The heaviest path must fit in Omni's 900k-gas reactive transaction cap, with headroom.
    function test_WorstCaseReactFitsGasCap() public {
        _warmUp();
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        _run();
        emit log_named_uint("max react() gas", maxReactGas);
        assertLt(maxReactGas, 600_000);
    }

    // ------------------------------------------------------------------ governance & auth

    function test_ResolveDropsTaintSubscriptions() public {
        _warmUp();
        uint256 baseline = sys.activeSubscriptions(address(ledger));
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        _run();
        assertGt(sys.activeSubscriptions(address(ledger)), baseline);

        ledger.resolveIncident();
        assertEq(_mode(), NORMAL);
        assertEq(sys.activeSubscriptions(address(ledger)), baseline, "back to the static subscription set");
        assertEq(ledger.taintedCount(), 0);

        // Destinations stay frozen until their own governance resolves them.
        assertTrue(guardA.frozen());
        vm.prank(guardian);
        guardA.resolve();
        assertFalse(guardA.frozen());
    }

    function test_OnlyOwnerResolves() public {
        vm.prank(attacker);
        vm.expectRevert(NoetherLedger.OnlyOwner.selector);
        ledger.resolveIncident();
    }

    function test_InboundCannotBeFakedOutsideTheMailbox() public {
        vm.prank(attacker);
        vm.expectRevert(NoetherIsm.OnlyMailbox.selector);
        guardA.verify("", "");
    }

    function test_GuardRejectsCallsNotFromProxy() public {
        vm.prank(attacker);
        vm.expectRevert();
        guardA.freeze(address(ledger), bytes32(0), 1, 0, 0);
    }

    function test_GuardRejectsOtherReactiveContracts() public {
        vm.prank(proxy);
        vm.expectRevert(abi.encodeWithSelector(NoetherGuarded.UnknownNoether.selector, attacker, address(ledger)));
        guardA.freeze(attacker, bytes32(0), 1, 0, 0);
    }

    function test_ReactOnlyFromSystem() public {
        IReactive.LogRecord memory r;
        vm.prank(attacker);
        vm.expectRevert();
        ledger.react(r);
    }

    // ------------------------------------------------------------------ fuzz

    /// @notice Honest traffic of arbitrary sizes and users, over both spokes, never trips the law.
    function testFuzz_HonestTrafficNeverFreezes(uint96[6] memory amounts, uint8 seed) public {
        address[3] memory users = [alice, bob, makeAddr("carol")];
        for (uint256 i = 0; i < amounts.length; ++i) {
            uint256 amt = bound(uint256(amounts[i]), 1, 10_000 ether);
            address u = users[(seed + i) % 3];
            NoetherHypERC20 s = (seed + i) % 2 == 0 ? spokeA : spokeB;
            _bridge(u, amt, s == spokeA ? SPOKE_A : SPOKE_B);
            if (i % 2 == 1) {
                _burn(s, u, amt, u);
                _run();
                _relay();
                _run();
            }
        }
        assertEq(_mode(), NORMAL);
        assertEq(ledger.circulating(), spokeA.totalSupply() + spokeB.totalSupply());
        assertEq(ledger.escrowed(), dusd.balanceOf(address(homeRouter)));
    }
}
