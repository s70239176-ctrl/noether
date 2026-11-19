// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title MiniERC20
/// @notice Minimal ERC-20 with a single `_beforeTransfer` hook. Kept in-repo so the project has no
///         dependency beyond forge-std and the Reactive library.
abstract contract MiniERC20 {
    error InsufficientBalance(address account, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowance, uint256 needed);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function approve(address spender_, uint256 amount_) external returns (bool) {
        allowance[msg.sender][spender_] = amount_;
        emit Approval(msg.sender, spender_, amount_);
        return true;
    }

    function transfer(address to_, uint256 amount_) external returns (bool) {
        _transfer(msg.sender, to_, amount_);
        return true;
    }

    function transferFrom(address from_, address to_, uint256 amount_) external returns (bool) {
        uint256 allowed = allowance[from_][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount_) revert InsufficientAllowance(msg.sender, allowed, amount_);
            allowance[from_][msg.sender] = allowed - amount_;
        }
        _transfer(from_, to_, amount_);
        return true;
    }

    function _transfer(address from_, address to_, uint256 amount_) internal {
        _beforeTransfer(from_, to_);
        uint256 bal = balanceOf[from_];
        if (bal < amount_) revert InsufficientBalance(from_, bal, amount_);
        unchecked {
            balanceOf[from_] = bal - amount_;
        }
        balanceOf[to_] += amount_;
        emit Transfer(from_, to_, amount_);
    }

    function _mint(address to_, uint256 amount_) internal {
        totalSupply += amount_;
        balanceOf[to_] += amount_;
        emit Transfer(address(0), to_, amount_);
    }

    function _burn(address from_, uint256 amount_) internal {
        uint256 bal = balanceOf[from_];
        if (bal < amount_) revert InsufficientBalance(from_, bal, amount_);
        unchecked {
            balanceOf[from_] = bal - amount_;
            totalSupply -= amount_;
        }
        emit Transfer(from_, address(0), amount_);
    }

    function _beforeTransfer(address from_, address to_) internal virtual { }
}
