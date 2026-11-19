// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { NoetherHarness } from "./utils/NoetherHarness.sol";
import { NoetherCover } from "../src/cover/NoetherCover.sol";
import { NoetherGuarded } from "../src/guard/NoetherGuarded.sol";
import { Vm } from "forge-std/Test.sol";
import { MockSystem } from "./utils/MockSystem.sol";

contract NoetherCoverTest is NoetherHarness {
    uint256 constant HOLDERS = 25; // more than one SETTLE_BATCH, so the loop must continue itself
    address[] holders;

    function setUp() public override {
        super.setUp();
        vm.deal(underwriter, 1_000 ether);
        vm.prank(underwriter);
        cover.deposit{ value: 100 ether }();
        for (uint256 i = 0; i < HOLDERS; ++i) {
            address h = makeAddr(string(abi.encodePacked("holder", vm.toString(i))));
            holders.push(h);
            vm.deal(h, 1 ether);
            uint256 premium = cover.premiumFor(1 ether); // read before prank: prank applies to the next call
            vm.prank(h);
            cover.buyCover{ value: premium }(1 ether);
        }
        vm.warp(block.timestamp + 60);
        _run();
    }

    function test_ViolationPaysEveryHolderWithNoClaim() public {
        _warmUp();
        uint256[] memory before = new uint256[](HOLDERS);
        for (uint256 i = 0; i < HOLDERS; ++i) {
            before[i] = holders[i].balance;
        }

        _forgeMint(spokeA, attacker, 1_000_000 ether);
        _run();

        assertTrue(cover.frozen());
        for (uint256 i = 0; i < HOLDERS; ++i) {
            assertEq(holders[i].balance - before[i], 1 ether, "paid in full, automatically");
        }
        assertEq(cover.payoutCursor(), HOLDERS + 1, "loop ran to completion");
        assertEq(cover.totalPaid(), HOLDERS * 1 ether);
    }

    function test_CoverBoughtAfterTheForgedMintIsExcluded() public {
        _warmUp();
        address late = makeAddr("frontrunner");
        vm.deal(late, 1 ether);

        _forgeMint(spokeA, attacker, 1_000_000 ether);
        // Same second as the forged mint, before Noether's hold could land on the home chain.
        uint256 latePremium = cover.premiumFor(10 ether);
        vm.prank(late);
        uint256 id = cover.buyCover{ value: latePremium }(10 ether);
        (address holder, uint96 boughtAt,,,,) = cover.policies(id);
        assertEq(holder, late);
        assertEq(boughtAt, block.timestamp, "bought in the same second as the forged mint");
        uint256 lateBefore = late.balance;
        _run();

        (,,,, bool settled,) = cover.policies(id);
        assertTrue(settled);
        assertEq(late.balance, lateBefore, "front-runner receives nothing");
        assertEq(cover.totalPaid(), HOLDERS * 1 ether, "only honest, pre-incident policies paid");
    }

    function test_SalesPauseOnSuspectAndReopenWhenCleared() public {
        _warmUp();
        _lock(alice, 300 ether, alice, SPOKE_A);
        Vm.Log[] memory lockLogs = _capture();
        _relayFrom(lockLogs);
        _run();

        vm.deal(bob, 1 ether);
        uint256 premium = cover.premiumFor(1 ether);
        vm.prank(bob);
        vm.expectRevert(NoetherCover.SalesClosed.selector);
        cover.buyCover{ value: premium }(1 ether);

        _feed(lockLogs);
        _deliverAll();
        vm.prank(bob);
        cover.buyCover{ value: premium }(1 ether);
    }

    function test_SalesClosedAfterViolation() public {
        _warmUp();
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        _run();
        vm.deal(bob, 1 ether);
        uint256 premium = cover.premiumFor(1 ether);
        vm.prank(bob);
        vm.expectRevert(NoetherCover.SalesClosed.selector);
        cover.buyCover{ value: premium }(1 ether);
    }

    function test_UnderwritersCannotRunWhileFrozen() public {
        _warmUp();
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        _run();
        uint256 s = cover.shares(underwriter);
        vm.prank(underwriter);
        vm.expectRevert(NoetherGuarded.Frozen.selector);
        cover.withdraw(s);
    }

    function test_PermissionlessFallbackIfLoopStalls() public {
        _warmUp();
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        _feed(_capture());
        // Deliver only the freeze callbacks, then drop the reactive settle requests on the floor.
        while (sys.pending() > 0) {
            _deliverOneIgnoringLogs();
        }
        assertTrue(cover.frozen());
        cover.settleNext(100);
        assertEq(cover.totalPaid(), HOLDERS * 1 ether);
    }

    function test_PayoutToContractThatRejectsEthIsOwedNotLost() public {
        // This test contract has no receive(): push fails, the payout is recorded for pull instead.
        uint256 premium = cover.premiumFor(1 ether);
        uint256 id = cover.buyCover{ value: premium }(1 ether);
        vm.warp(block.timestamp + 1);
        _warmUp();
        _forgeMint(spokeA, attacker, 1_000_000 ether);
        _run();
        (,,,, bool settled,) = cover.policies(id);
        assertTrue(settled);
        assertEq(cover.owed(address(this)), 1 ether);
    }

    function test_CapacityLimitsCoverSold() public {
        uint256 available = cover.capital() - cover.outstandingCover();
        vm.deal(bob, 100 ether);
        uint256 tooMuch = available + 1;
        uint256 premium = cover.premiumFor(tooMuch);
        vm.prank(bob);
        vm.expectRevert();
        cover.buyCover{ value: premium }(tooMuch);
    }

    /// @dev Delivers one callback without feeding its logs back to Noether (models a stalled loop).
    function _deliverOneIgnoringLogs() internal {
        MockSystem.Request memory r = sys.next();
        bytes memory payload = r.payload;
        address injected = r.sender;
        assembly {
            mstore(add(payload, 36), injected)
        }
        vm.prank(proxy);
        (bool ok,) = r.recipient.call{ gas: r.gasLimit }(payload);
        assertTrue(ok);
        vm.getRecordedLogs();
    }
}
