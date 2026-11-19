// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script } from "forge-std/Script.sol";

/// @notice Network constants.
///         Reactive callback proxies: https://dev.reactive.network/origins-and-destinations (checked 2026-11-18).
///         Hyperlane Mailbox / MerkleTreeHook: github.com/hyperlane-xyz/hyperlane-registry chains/<name>/addresses.yaml
///         (checked 2026-11-19; Mailbox VERSION 3 confirmed on-chain on Base Sepolia and Unichain Sepolia).
abstract contract NoetherConfig is Script {
    uint256 internal constant LASNA = 5318007;
    uint256 internal constant BASE_SEPOLIA = 84532;
    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant ETH_SEPOLIA = 11155111;

    function callbackProxy(uint256 chainId) internal pure returns (address) {
        if (chainId == BASE_SEPOLIA) return 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
        if (chainId == UNICHAIN_SEPOLIA) return 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
        if (chainId == ETH_SEPOLIA) return 0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4;
        revert("no callback proxy for this chain");
    }

    function hyperlaneMailbox(uint256 chainId) internal pure returns (address) {
        if (chainId == BASE_SEPOLIA) return 0x6966b0E55883d49BFB24539356a2f8A673E02039;
        if (chainId == UNICHAIN_SEPOLIA) return 0xDDcFEcF17586D08A5740B7D91735fcCE3dfe3eeD;
        if (chainId == ETH_SEPOLIA) return 0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766;
        revert("no Hyperlane mailbox for this chain");
    }

    function hyperlaneMerkleTreeHook(uint256 chainId) internal pure returns (address) {
        if (chainId == BASE_SEPOLIA) return 0x86fb9F1c124fB20ff130C41a79a432F770f67AFD;
        if (chainId == UNICHAIN_SEPOLIA) return 0x086E902d2f99BcCEAa28B31747eC6Dc5fd43B1bE;
        if (chainId == ETH_SEPOLIA) return 0x4917a9746A7B6E0A57159cCb7F5a6744247f2d0d;
        revert("no Hyperlane merkle tree hook for this chain");
    }

    /// @dev Local rehearsal nodes reuse the real chain ids but have no Hyperlane: allow overrides.
    function _mailbox() internal view returns (address) {
        return vm.envOr("HYPERLANE_MAILBOX", hyperlaneMailbox(block.chainid));
    }

    function _merkleHook() internal view returns (address) {
        return vm.envOr("HYPERLANE_MERKLE_HOOK", hyperlaneMerkleTreeHook(block.chainid));
    }

    /// @dev Defaults to deployments/testnet.env; the local rehearsal redirects it with OUT_FILE.
    function _out() internal view returns (string memory) {
        return vm.envOr("OUT_FILE", string("deployments/testnet.env"));
    }

    function _record(string memory key, address value) internal {
        vm.writeLine(_out(), string.concat(key, "=", vm.toString(value)));
    }

    function _recordUint(string memory key, uint256 value) internal {
        vm.writeLine(_out(), string.concat(key, "=", vm.toString(value)));
    }

    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }
}
