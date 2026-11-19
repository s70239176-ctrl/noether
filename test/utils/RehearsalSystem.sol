// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ISystemContract } from "reactive-lib/interfaces/ISystemContract.sol";

/// @notice Event-only stand-in for the Reactive system contract, installed with `anvil_setCode` by
///         script/rehearse.sh so the deployment scripts can be exercised against local nodes.
contract RehearsalSystem {
    event Subscribe(
        address indexed subscriber, uint256 indexed chainId, address indexed contractAddress, uint256 topic0
    );
    event Unsubscribe(
        address indexed subscriber, uint256 indexed chainId, address indexed contractAddress, uint256 topic0
    );
    event CallbackRequest(uint256 indexed chainId, address indexed sender, address indexed recipient, bytes payload);

    function subscribe(uint256 c, address a, uint256 t0, uint256, uint256, uint256) external {
        emit Subscribe(msg.sender, c, a, t0);
    }

    function unsubscribe(uint256 c, address a, uint256 t0, uint256, uint256, uint256) external {
        emit Unsubscribe(msg.sender, c, a, t0);
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory c) external {
        emit CallbackRequest(c.chainId, msg.sender, c.recipient, c.payload);
    }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    receive() external payable { }
}
