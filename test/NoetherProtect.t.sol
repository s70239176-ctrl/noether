// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Vm } from "forge-std/Test.sol";
import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { HypERC20 } from "@hyperlane-xyz/core/contracts/token/HypERC20.sol";
import { HypERC20Collateral } from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import { MerkleTreeHook } from "@hyperlane-xyz/core/contracts/hooks/MerkleTreeHook.sol";
import { TrustedRelayerIsm } from "@hyperlane-xyz/core/contracts/isms/TrustedRelayerIsm.sol";
import { NoetherHarness } from "./utils/NoetherHarness.sol";
import { NoetherIsm } from "../src/hyperlane/NoetherIsm.sol";
import { NoetherLedger } from "../src/reactive/NoetherLedger.sol";
import { NoetherGuardFactory } from "../src/protect/NoetherGuardFactory.sol";

/// @notice "Protect your route": an existing, unmodified Hyperlane Warp Route (stock HypERC20Collateral and
///         stock HypERC20 on the Mailbox's default ISM) gets Enforce mode with a factory call per chain, a
///         ledger without cover, and one setInterchainSecurityModule call per chain by the route owner.
contract NoetherProtectTest is NoetherHarness {
    HypERC20Collateral vHome; // the route that already exists
    HypERC20 vSpoke;
    NoetherIsm gHome;
    NoetherIsm gSpoke;
    address routeOwner = makeAddr("routeOwner");
    address innerHome;

    function setUp() public override {
        super.setUp();

        // ---- an existing route, deployed by someone else, with no Noether code in it ----
        vm.startPrank(routeOwner);
        vHome = new HypERC20Collateral(address(dusd), 1, 1, address(homeMailbox));
        vHome.initialize(address(new MerkleTreeHook(address(homeMailbox))), address(0), routeOwner);
        vSpoke = new HypERC20(18, 1, 1, address(mailboxB));
        vSpoke.initialize(0, "Vanilla dUSD", "vdUSD", address(new MerkleTreeHook(address(mailboxB))), address(0), routeOwner);
        vHome.enrollRemoteRouter(SPOKE_B, _b32(address(vSpoke)));
        vSpoke.enrollRemoteRouter(HOME, _b32(address(vHome)));
        vm.stopPrank();

        // ---- step 1: guards from the factory (one per chain), ledger on Lasna without cover ----
        NoetherGuardFactory factory = new NoetherGuardFactory(IPayable(payable(proxy)));
        (gHome, innerHome) = factory.deployGuard{ value: 1 ether }(address(vHome), true, routeOwner);
        (gSpoke,) = factory.deployGuard{ value: 1 ether }(address(vSpoke), false, routeOwner);
        NoetherLedger.Endpoint[] memory spokes = new NoetherLedger.Endpoint[](1);
        spokes[0] = NoetherLedger.Endpoint(SPOKE_B, address(mailboxB), address(vSpoke), address(gSpoke));
        ledger = new NoetherLedger{ value: 1 ether }(
            NoetherLedger.Endpoint(HOME, address(homeMailbox), address(vHome), address(gHome)), address(0), spokes, GRACE
        );

        // ---- steps 2 and 3: the route owner trusts the ledger and points each router at its guard ----
        vm.startPrank(routeOwner);
        gHome.setNoether(address(ledger));
        gSpoke.setNoether(address(ledger));
        vHome.setInterchainSecurityModule(address(gHome));
        vSpoke.setInterchainSecurityModule(address(gSpoke));
        vm.stopPrank();

        _tag(HOME, address(homeMailbox), address(gHome), address(vHome));
        _tag(SPOKE_B, address(mailboxB), address(gSpoke), address(vSpoke));
        vm.getRecordedLogs();
    }

    function _vLock(address user, uint256 amount) internal {
        vm.startPrank(user);
        dusd.faucet();
        dusd.approve(address(vHome), type(uint256).max);
        vHome.transferRemote(SPOKE_B, _b32(user), amount);
        vm.stopPrank();
    }

    function test_GuardWrapsTheRoutesExistingIsm() public view {
        assertEq(address(gHome.inner()), address(homeMailbox.defaultIsm()), "wraps exactly what the route used before");
        assertEq(innerHome, address(homeMailbox.defaultIsm()));
        assertEq(gHome.guardian(), routeOwner, "guardianship goes to the route owner, not the factory");
        assertEq(gHome.router(), address(vHome));
        assertEq(address(vHome.interchainSecurityModule()), address(gHome));
    }

    function test_HyperlaneRelayerCanStillReadTheWrappedIsm() public {
        // The relayer builds metadata from the recipient ISM's config; the guard forwards those reads.
        (bool ok, bytes memory ret) = address(gHome).staticcall(abi.encodeWithSignature("trustedRelayer()"));
        assertTrue(ok);
        assertEq(abi.decode(ret, (address)), TrustedRelayerIsm(innerHome).trustedRelayer());
        assertEq(gHome.moduleType(), TrustedRelayerIsm(innerHome).moduleType());
    }

    function test_HonestTrafficStillFlowsAfterProtection() public {
        _vLock(alice, 400 ether);
        _run();
        _relay();
        _run();
        assertEq(vSpoke.balanceOf(alice), 400 ether);
        assertEq(uint8(ledger.mode()), 0);
        assertEq(ledger.escrowed(), 400 ether);
        assertEq(ledger.circulating(), 400 ether);
    }

    function test_ForgedMintOnTheProtectedRouteFreezesIt() public {
        _vLock(alice, 400 ether);
        _run();
        _relay();
        _run();

        uint256 requestsBefore = sys.totalRequests();
        _forge(HOME, address(vHome), SPOKE_B, address(vSpoke), attacker, 1_000_000 ether);
        _feed(_capture());
        assertEq(uint8(ledger.mode()), 2, "violation");
        // home guard + spoke guard + quarantine; no cover callbacks because this route runs without cover.
        assertEq(sys.totalRequests() - requestsBefore, 3);
        _deliverAll();
        assertTrue(gHome.frozen() && gSpoke.frozen());

        // A second forged mint is refused by the frozen ISM...
        vm.expectRevert("Mailbox: ISM verification failed");
        _forge(HOME, address(vHome), SPOKE_B, address(vSpoke), attacker, 1 ether);

        // ...and the forged tokens can't be redeemed for real collateral: the stock HypERC20 still lets the
        // attacker burn, but the release message is refused by the frozen collateral-side guard.
        vm.prank(attacker);
        vSpoke.transferRemote(HOME, _b32(attacker), 500_000 ether);
        Vm.Log[] memory burn = _capture();
        bytes memory m;
        for (uint256 i = 0; i < burn.length; ++i) {
            if (burn[i].emitter == address(mailboxB) && burn[i].topics[0] == DISPATCH_TOPIC) m = abi.decode(burn[i].data, (bytes));
        }
        vm.prank(relayer, relayer);
        vm.expectRevert("Mailbox: ISM verification failed");
        homeMailbox.process("", m);
        assertEq(dusd.balanceOf(attacker), 0, "no collateral left the vault");
    }

    function test_OnlyTheRouteOwnerCanResolve() public {
        vm.prank(attacker);
        vm.expectRevert();
        gHome.resolve();
    }
}
