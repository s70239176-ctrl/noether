// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { MiniERC20 } from "./MiniERC20.sol";

/// @title DemoUSD
/// @notice Canonical collateral token on the home chain. Testnet only: anyone can draw from the faucet.
contract DemoUSD is MiniERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000 ether;

    constructor() MiniERC20("Demo USD", "dUSD") { }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
