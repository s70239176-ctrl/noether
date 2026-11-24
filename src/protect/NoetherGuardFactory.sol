// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { IInterchainSecurityModule } from "@hyperlane-xyz/core/contracts/interfaces/IInterchainSecurityModule.sol";
import { NoetherIsm } from "../hyperlane/NoetherIsm.sol";

interface IHyperlaneRouterInfo {
    function mailbox() external view returns (address);
    function interchainSecurityModule() external view returns (IInterchainSecurityModule);
}

interface IHyperlaneMailboxInfo {
    function defaultIsm() external view returns (IInterchainSecurityModule);
}

/// @title NoetherGuardFactory
/// @notice Puts Noether in front of an EXISTING Hyperlane Warp Route without changing its security.
///         Reads the route's router, finds the ISM it uses today (its own, or the Mailbox default), and deploys a
///         `NoetherIsm` that wraps exactly that ISM. Verification stays what it was; Noether only adds the
///         ability to freeze and quarantine. Guardianship goes straight to the route owner (or their multisig).
///
///         After this, the route owner points the router at the guard with one call:
///             router.setInterchainSecurityModule(guard)
contract NoetherGuardFactory {
    event GuardDeployed(
        address indexed router, address indexed guard, address mailbox, address innerIsm, bool collateralSide, address guardian
    );

    /// @notice This chain's Reactive callback proxy.
    IPayable public immutable callbackProxy;

    constructor(IPayable callbackProxy_) {
        callbackProxy = callbackProxy_;
    }

    /// @param router_         The route's token router on this chain.
    /// @param collateralSide_ True on the collateral (home) side: a precautionary hold also blocks releases there.
    /// @param guardian_       Who can resolve a freeze and register the ledger (the route owner or its multisig).
    /// @dev Any ETH sent funds the guard's Reactive callback fees on this chain.
    function deployGuard(address router_, bool collateralSide_, address guardian_)
        external
        payable
        returns (NoetherIsm guard, address innerIsm)
    {
        address mailbox = IHyperlaneRouterInfo(router_).mailbox();
        IInterchainSecurityModule inner = IHyperlaneRouterInfo(router_).interchainSecurityModule();
        if (address(inner) == address(0)) inner = IHyperlaneMailboxInfo(mailbox).defaultIsm();
        guard = new NoetherIsm{ value: msg.value }(callbackProxy, address(this), mailbox, inner, collateralSide_);
        guard.setRouter(router_);
        guard.setGuardian(guardian_);
        innerIsm = address(inner);
        emit GuardDeployed(router_, address(guard), mailbox, innerIsm, collateralSide_, guardian_);
    }
}
