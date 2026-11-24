// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { console } from "forge-std/console.sol";
import { NoetherConfig } from "./NoetherConfig.sol";
import { NoetherGuardFactory } from "../src/protect/NoetherGuardFactory.sol";
import { NoetherIsm } from "../src/hyperlane/NoetherIsm.sol";
import { NoetherLedger } from "../src/reactive/NoetherLedger.sol";

interface IOwnedRouter {
    function owner() external view returns (address);
    function setInterchainSecurityModule(address ism) external;
}

/// Scripts behind `bash script/protect.sh` ("Protect your route"). They write to $OUT_FILE.

/// @notice Per chain: put a NoetherIsm, wrapping the route's current ISM, in front of ROUTER.
contract ProtectGuard is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address router = vm.envAddress("ROUTER");
        string memory label = vm.envString("LABEL");
        vm.startBroadcast(pk);
        NoetherGuardFactory factory = new NoetherGuardFactory(IPayable(payable(callbackProxy(block.chainid))));
        (NoetherIsm guard, address inner) = factory.deployGuard{ value: vm.envOr("GUARD_FUNDING", uint256(0.003 ether)) }(
            router, vm.envBool("COLLATERAL_SIDE"), vm.envOr("GUARDIAN", vm.addr(pk))
        );
        vm.stopBroadcast();
        _recordUint(string.concat(label, "_CHAIN_ID"), block.chainid);
        _record(string.concat(label, "_ROUTER"), router);
        _record(string.concat(label, "_MAILBOX"), guard.mailbox());
        _record(string.concat(label, "_GUARD"), address(guard));
        _record(string.concat(label, "_INNER_ISM"), inner);
    }
}

/// @notice On Reactive Lasna: a ledger for this route (cover optional).
contract ProtectLedger is NoetherConfig {
    function run() external {
        require(block.chainid == LASNA || block.chainid == 1597, "deploy the ledger on Reactive");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        NoetherLedger.Endpoint[] memory spokes = new NoetherLedger.Endpoint[](1);
        spokes[0] = NoetherLedger.Endpoint(
            vm.envUint("SPOKE_CHAIN_ID"), vm.envAddress("SPOKE_MAILBOX"), vm.envAddress("SPOKE_ROUTER"), vm.envAddress("SPOKE_GUARD")
        );
        NoetherLedger.Endpoint memory home = NoetherLedger.Endpoint(
            vm.envUint("HOME_CHAIN_ID"), vm.envAddress("HOME_MAILBOX"), vm.envAddress("HOME_ROUTER"), vm.envAddress("HOME_GUARD")
        );
        vm.startBroadcast(pk);
        NoetherLedger ledger = new NoetherLedger{ value: vm.envOr("LEDGER_FUNDING", uint256(1 ether)) }(
            home, vm.envOr("COVER", address(0)), spokes, vm.envOr("GRACE_BLOCKS", uint256(5))
        );
        vm.stopBroadcast();
        _record("LEDGER", address(ledger));
    }
}

/// @notice Per chain: the guard trusts the ledger, and the router is pointed at the guard. If the signer is not
///         the router's owner (e.g. a multisig owns it), the exact call to submit is printed instead.
contract ProtectWire is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        NoetherIsm guard = NoetherIsm(payable(vm.envAddress("GUARD")));
        address router = vm.envAddress("ROUTER");
        vm.startBroadcast(pk);
        if (guard.guardian() == me) guard.setNoether(vm.envAddress("LEDGER"));
        if (IOwnedRouter(router).owner() == me) IOwnedRouter(router).setInterchainSecurityModule(address(guard));
        vm.stopBroadcast();
        if (guard.guardian() != me) {
            console.log("Guardian must call on chain", block.chainid);
            console.log("  guard.setNoether(ledger)  guard:", address(guard));
        }
        if (IOwnedRouter(router).owner() != me) {
            console.log("Route owner must call on chain", block.chainid);
            console.log("  router.setInterchainSecurityModule(guard)  router:", router);
            console.log("  calldata:");
            console.logBytes(abi.encodeCall(IOwnedRouter.setInterchainSecurityModule, (address(guard))));
        }
    }
}
