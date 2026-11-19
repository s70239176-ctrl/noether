// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script } from "forge-std/Script.sol";
import { Mailbox } from "@hyperlane-xyz/core/contracts/Mailbox.sol";
import { MerkleTreeHook } from "@hyperlane-xyz/core/contracts/hooks/MerkleTreeHook.sol";
import { TestPostDispatchHook } from "@hyperlane-xyz/core/contracts/test/TestPostDispatchHook.sol";
import { NoopIsm } from "@hyperlane-xyz/core/contracts/isms/NoopIsm.sol";

/// @notice Local rehearsal only: stands up a real Hyperlane Mailbox on an anvil node that impersonates a
///         testnet, so script/deploy.sh can run unchanged. Testnets already have Hyperlane deployed.
contract LocalHyperlane is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        string memory prefix = vm.envString("PREFIX");
        vm.startBroadcast(pk);
        Mailbox mb = new Mailbox(uint32(block.chainid));
        MerkleTreeHook merkle = new MerkleTreeHook(address(mb));
        mb.initialize(vm.addr(pk), address(new NoopIsm()), address(merkle), address(new TestPostDispatchHook()));
        vm.stopBroadcast();
        string memory out = vm.envString("OUT_FILE");
        vm.writeLine(out, string.concat(prefix, "_MAILBOX_OVERRIDE=", vm.toString(address(mb))));
        vm.writeLine(out, string.concat(prefix, "_HOOK_OVERRIDE=", vm.toString(address(merkle))));
    }
}
