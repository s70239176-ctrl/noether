// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { TrustedRelayerIsm } from "@hyperlane-xyz/core/contracts/isms/TrustedRelayerIsm.sol";
import { HypERC20Collateral } from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import { IInterchainSecurityModule } from "@hyperlane-xyz/core/contracts/interfaces/IInterchainSecurityModule.sol";
import { NoetherConfig } from "./NoetherConfig.sol";
import { DemoUSD } from "../src/bridge/DemoUSD.sol";
import { NoetherIsm } from "../src/hyperlane/NoetherIsm.sol";
import { NoetherHypERC20, INoetherGuardState } from "../src/hyperlane/NoetherHypERC20.sol";
import { NoetherCover } from "../src/cover/NoetherCover.sol";
import { NoetherLedger } from "../src/reactive/NoetherLedger.sol";
import { NoetherGuarded } from "../src/guard/NoetherGuarded.sol";

interface IEnroll {
    function enrollRemoteRouter(uint32 domain, bytes32 router) external;
}

/// @notice Step 1, home chain (Base Sepolia): collateral token, Hyperlane collateral router on the live
///         Mailbox, Noether's guard ISM wrapping Hyperlane's TrustedRelayerIsm, and the cover pool.
contract DeployHome is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address relayer = vm.envOr("RELAYER", deployer);
        uint256 gasFunding = vm.envOr("DEST_GAS_FUNDING", uint256(0.02 ether));
        address mailbox = _mailbox();
        IPayable proxy = IPayable(payable(callbackProxy(block.chainid)));

        vm.startBroadcast(pk);
        DemoUSD dusd = new DemoUSD();
        TrustedRelayerIsm trusted = new TrustedRelayerIsm(mailbox, relayer);
        NoetherIsm guard = new NoetherIsm{ value: gasFunding }(
            proxy, deployer, mailbox, IInterchainSecurityModule(address(trusted)), true
        );
        HypERC20Collateral router = new HypERC20Collateral(address(dusd), 1, 1, mailbox);
        router.initialize(_merkleHook(), address(guard), deployer);
        guard.setRouter(address(router));
        NoetherCover cover = new NoetherCover{ value: gasFunding }(proxy, deployer, 30 days);
        vm.stopBroadcast();

        _recordUint("HOME_CHAIN_ID", block.chainid);
        _record("HOME_MAILBOX", mailbox);
        _record("DUSD", address(dusd));
        _record("HOME_TRUSTED_ISM", address(trusted));
        _record("HOME_GUARD", address(guard));
        _record("HOME_ROUTER", address(router));
        _record("COVER", address(cover));
    }
}

/// @notice Step 2, spoke chain (Unichain Sepolia): Hyperlane synthetic router (HypERC20 + quarantine hook)
///         on the live Mailbox, guarded by NoetherIsm.
contract DeploySpoke is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address relayer = vm.envOr("RELAYER", deployer);
        uint256 gasFunding = vm.envOr("DEST_GAS_FUNDING", uint256(0.02 ether));
        string memory label = vm.envOr("SPOKE_LABEL", string("SPOKE_A"));
        address mailbox = _mailbox();

        vm.startBroadcast(pk);
        TrustedRelayerIsm trusted = new TrustedRelayerIsm(mailbox, relayer);
        NoetherIsm guard = new NoetherIsm{ value: gasFunding }(
            IPayable(payable(callbackProxy(block.chainid))),
            deployer,
            mailbox,
            IInterchainSecurityModule(address(trusted)),
            false
        );
        NoetherHypERC20 token = new NoetherHypERC20(18, mailbox, INoetherGuardState(address(guard)));
        token.initialize(0, "Noether dUSD", "ndUSD", _merkleHook(), address(guard), deployer);
        guard.setRouter(address(token));
        vm.stopBroadcast();

        _recordUint(string.concat(label, "_CHAIN_ID"), block.chainid);
        _record(string.concat(label, "_MAILBOX"), mailbox);
        _record(string.concat(label, "_TRUSTED_ISM"), address(trusted));
        _record(string.concat(label, "_GUARD"), address(guard));
        _record(label, address(token));
    }
}

/// @notice Step 3, both chains: enroll the routers with each other (Hyperlane domain == chain id here).
///         REMOTE_DOMAIN=<id> REMOTE_ROUTER=<addr> LOCAL_ROUTER=<addr>
contract Enroll is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        IEnroll(vm.envAddress("LOCAL_ROUTER"))
            .enrollRemoteRouter(uint32(vm.envUint("REMOTE_DOMAIN")), _b32(vm.envAddress("REMOTE_ROUTER")));
        vm.stopBroadcast();
    }
}

/// @notice Step 4, Reactive Lasna: the ledger. It subscribes to every chain in its constructor.
contract DeployLedger is NoetherConfig {
    function run() external {
        require(block.chainid == LASNA || block.chainid == 1597, "deploy the ledger on Reactive");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 funding = vm.envOr("LEDGER_FUNDING", uint256(2 ether)); // REACT
        uint256 grace = vm.envOr("GRACE_BLOCKS", uint256(5));

        bool withB = vm.envOr("SPOKE_B", address(0)) != address(0);
        NoetherLedger.Endpoint[] memory spokes = new NoetherLedger.Endpoint[](withB ? 2 : 1);
        spokes[0] = NoetherLedger.Endpoint(
            vm.envUint("SPOKE_A_CHAIN_ID"),
            vm.envAddress("SPOKE_A_MAILBOX"),
            vm.envAddress("SPOKE_A"),
            vm.envAddress("SPOKE_A_GUARD")
        );
        if (withB) {
            spokes[1] = NoetherLedger.Endpoint(
                vm.envUint("SPOKE_B_CHAIN_ID"),
                vm.envAddress("SPOKE_B_MAILBOX"),
                vm.envAddress("SPOKE_B"),
                vm.envAddress("SPOKE_B_GUARD")
            );
        }
        NoetherLedger.Endpoint memory home = NoetherLedger.Endpoint(
            vm.envUint("HOME_CHAIN_ID"),
            vm.envAddress("HOME_MAILBOX"),
            vm.envAddress("HOME_ROUTER"),
            vm.envAddress("HOME_GUARD")
        );

        vm.startBroadcast(pk);
        NoetherLedger ledger = new NoetherLedger{ value: funding }(home, vm.envAddress("COVER"), spokes, grace);
        vm.stopBroadcast();

        _record("LEDGER", address(ledger));
    }
}

/// @notice Step 5, every destination chain: trust the ledger's callbacks. TARGETS=0x..,0x..
contract Wire is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address ledger = vm.envAddress("LEDGER");
        address[] memory targets = vm.envAddress("TARGETS", ",");
        vm.startBroadcast(pk);
        for (uint256 i = 0; i < targets.length; ++i) {
            NoetherGuarded(payable(targets[i])).setNoether(ledger);
        }
        vm.stopBroadcast();
    }
}

/// @notice Step 6, home chain: seed the cover pool and buy a handful of honest policies.
contract SeedCover is NoetherConfig {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        NoetherCover cover = NoetherCover(payable(vm.envAddress("COVER")));
        uint256 capital = vm.envOr("COVER_CAPITAL", uint256(0.01 ether));
        uint256 policies = vm.envOr("COVER_POLICIES", uint256(3));
        uint256 each = capital / (policies * 2);
        vm.startBroadcast(pk);
        cover.deposit{ value: capital }();
        for (uint256 i = 0; i < policies; ++i) {
            cover.buyCover{ value: cover.premiumFor(each) }(each);
        }
        vm.stopBroadcast();
    }
}
