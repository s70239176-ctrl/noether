// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { TrustedRelayerIsm } from "@hyperlane-xyz/core/contracts/isms/TrustedRelayerIsm.sol";
import { HypERC20Collateral } from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import { HypERC20 } from "@hyperlane-xyz/core/contracts/token/HypERC20.sol";
import { NoetherConfig } from "./NoetherConfig.sol";

/// @notice A stock Hyperlane Warp Route with NO Noether code, the kind a third party would run. Used to show
///         `script/protect.sh` putting Noether in front of a route it didn't create.
contract VanillaHome is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address mailbox = _mailbox();
        vm.startBroadcast(pk);
        TrustedRelayerIsm ism = new TrustedRelayerIsm(mailbox, vm.addr(pk));
        HypERC20Collateral router = new HypERC20Collateral(vm.envAddress("DUSD"), 1, 1, mailbox);
        router.initialize(_merkleHook(), address(ism), vm.addr(pk));
        vm.stopBroadcast();
        _recordUint("VANILLA_HOME_CHAIN_ID", block.chainid);
        _record("VANILLA_HOME_ROUTER", address(router));
        _record("VANILLA_HOME_MAILBOX", mailbox);
    }
}

contract VanillaSpoke is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address mailbox = _mailbox();
        vm.startBroadcast(pk);
        TrustedRelayerIsm ism = new TrustedRelayerIsm(mailbox, vm.addr(pk));
        HypERC20 router = new HypERC20(18, 1, 1, mailbox);
        router.initialize(0, "Vanilla dUSD", "vdUSD", _merkleHook(), address(ism), vm.addr(pk));
        vm.stopBroadcast();
        _recordUint("VANILLA_SPOKE_CHAIN_ID", block.chainid);
        _record("VANILLA_SPOKE_ROUTER", address(router));
        _record("VANILLA_SPOKE_MAILBOX", mailbox);
    }
}
