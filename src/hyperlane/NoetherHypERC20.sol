// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { HypERC20 } from "@hyperlane-xyz/core/contracts/token/HypERC20.sol";

interface INoetherGuardState {
    function frozen() external view returns (bool);
    function quarantined(address account) external view returns (bool);
}

/// @title NoetherHypERC20
/// @notice Hyperlane's synthetic warp-route token (`HypERC20`), unchanged except for one ERC-20 hook:
///         - an account Noether quarantined can't move tokens (including bridging them out), and
///         - while Noether has frozen the route, nobody can burn to bridge out (the redemption path).
///         Ordinary transfers between honest holders keep working during a freeze.
///         Minting is gated upstream by the route's ISM (`NoetherIsm`), not here.
contract NoetherHypERC20 is HypERC20 {
    error NoetherQuarantined(address account);
    error NoetherFrozen();

    INoetherGuardState public immutable guard;

    constructor(uint8 decimals_, address mailbox_, INoetherGuardState guard_) HypERC20(decimals_, 1, 1, mailbox_) {
        guard = guard_;
    }

    function _beforeTokenTransfer(address from_, address to_, uint256 amount_) internal virtual override {
        super._beforeTokenTransfer(from_, to_, amount_);
        if (from_ != address(0) && guard.quarantined(from_)) revert NoetherQuarantined(from_);
        if (to_ == address(0) && guard.frozen()) revert NoetherFrozen();
    }
}
