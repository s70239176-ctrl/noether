// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { IInterchainSecurityModule } from "@hyperlane-xyz/core/contracts/interfaces/IInterchainSecurityModule.sol";
import { Message } from "@hyperlane-xyz/core/contracts/libs/Message.sol";
import { TokenMessage } from "@hyperlane-xyz/core/contracts/token/libs/TokenMessage.sol";
import { NoetherGuarded } from "../guard/NoetherGuarded.sol";

/// @title NoetherIsm
/// @notice Noether's guard for a Hyperlane Warp Route, installed as the route's Interchain Security
///         Module (ISM). This is Hyperlane's own extension point for per-route security policy, so the
///         Hyperlane Mailbox and token routers run unmodified.
///
///         `Mailbox.process` records the processor, then calls `verify` on the recipient's ISM, then calls
///         the router's `handle` (which mints or releases). That ordering lets this contract:
///         1. refuse every inbound message while Noether has frozen the route (and, on the collateral side,
///            while Noether holds the redemption path),
///         2. refuse messages paying a quarantined account,
///         3. delegate real verification to the route's configured ISM (Hyperlane's `TrustedRelayerIsm`
///            in the demo, any ISM in production),
///         4. emit `Inbound` with the exact Hyperlane message id and the destination timestamp. That is the
///            event Noether's reactive ledger matches against the `Dispatch` on the other chain.
///
///         If `handle` later reverts, the whole `process` transaction reverts and so does `Inbound`, so an
///         `Inbound` log always means tokens were really minted or released.
contract NoetherIsm is NoetherGuarded, IInterchainSecurityModule {
    using Message for bytes;

    error OnlyMailbox();
    error RouterAlreadySet();

    /// @param id             Hyperlane message id (keccak256 of the message), identical on both chains.
    /// @param origin         Origin domain.
    /// @param tokenRecipient Recipient encoded in the warp-route token message.
    /// @param amount         Amount in the token message.
    /// @param timestamp      Destination `block.timestamp`, carried so latency and cover eligibility use chain time.
    event Inbound(
        bytes32 indexed id, uint32 indexed origin, bytes32 indexed tokenRecipient, uint256 amount, uint256 timestamp
    );
    event RouterSet(address indexed router);

    address public immutable mailbox;
    IInterchainSecurityModule public immutable inner;
    /// @notice True on the collateral (home) side: a precautionary hold also blocks releases.
    bool public immutable blockOnHold;
    /// @notice The warp-route router this ISM protects. Set once, after the router is deployed.
    address public router;

    constructor(
        IPayable callbackProxy_,
        address guardian_,
        address mailbox_,
        IInterchainSecurityModule inner_,
        bool blockOnHold_
    ) payable NoetherGuarded(callbackProxy_, guardian_) {
        mailbox = mailbox_;
        inner = inner_;
        blockOnHold = blockOnHold_;
    }

    function setRouter(address router_) external onlyGuardian {
        if (router != address(0)) revert RouterAlreadySet();
        router = router_;
        emit RouterSet(router_);
    }

    /// @inheritdoc IInterchainSecurityModule
    function moduleType() external view returns (uint8) {
        return inner.moduleType();
    }

    /// @inheritdoc IInterchainSecurityModule
    function verify(bytes calldata metadata_, bytes calldata message_) external returns (bool) {
        // Only the Mailbox may call this: otherwise anyone could emit fake `Inbound` events.
        if (msg.sender != mailbox) revert OnlyMailbox();
        if (frozen) return false;
        if (held && blockOnHold) return false;
        if (message_.recipientAddress() != router) return false;

        bytes calldata body = message_.body();
        bytes32 to = TokenMessage.recipient(body);
        if (quarantined[address(uint160(uint256(to)))]) return false;
        if (!inner.verify(metadata_, message_)) return false;

        emit Inbound(message_.id(), message_.origin(), to, TokenMessage.amount(body), block.timestamp);
        return true;
    }
}
