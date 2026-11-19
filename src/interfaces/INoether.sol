// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title Noether shared vocabulary
/// @notice Reason codes, the cover pool's loop event, and the callback surface every protected contract
///         exposes. The bridge events Noether observes are Hyperlane's own `Mailbox.Dispatch` and
///         `NoetherIsm.Inbound` (emitted inside `Mailbox.process`).

/// @notice Events emitted by the cover pool that drive Noether's self-continuing payout loop.
interface INoetherCoverEvents {
    event PayoutBatch(bytes32 indexed incidentId, uint256 nextIndex, uint256 remaining);
}

/// @notice Reason codes for a broken conservation law.
library NoetherReason {
    uint8 internal constant NONE = 0;
    /// A spoke delivered a message no home dispatch backs (within the grace window).
    uint8 internal constant UNBACKED_MINT = 1;
    /// The same message id delivered twice.
    uint8 internal constant MINT_REPLAY = 2;
    /// A delivery's amount, recipient or route differs from its dispatch.
    uint8 internal constant MINT_MISMATCH = 3;
    /// The home side released collateral for a message no spoke dispatched (within the grace window).
    uint8 internal constant UNBACKED_RELEASE = 4;
    /// The same release message delivered twice.
    uint8 internal constant RELEASE_REPLAY = 5;
    /// A release's amount, recipient or route differs from its dispatch.
    uint8 internal constant RELEASE_MISMATCH = 6;
    /// The neural scorer judged a pending suspect hostile enough to skip the grace window.
    uint8 internal constant NEURAL_ESCALATION = 7;
}

/// @notice Callback surface shared by every contract Noether protects. The first argument of each
///         function is overwritten by the Reactive Network with the address of the requesting reactive
///         contract, which is how the destination authenticates Noether.
interface INoetherGuard {
    /// @notice Precautionary, reversible hold while a suspect is inside its grace window.
    function hold(address noether, bytes32 incidentId, uint256 originTxHash, uint256 originTimestamp) external;

    /// @notice Lift a precautionary hold once every suspect has been explained.
    function lift(address noether, bytes32 incidentId) external;

    /// @notice Block a single account (the recipient of a suspect mint, or a taint hop).
    function quarantine(address noether, bytes32 incidentId, address account, uint256 originTimestamp) external;

    /// @notice Unblock an account Noether quarantined for a suspect that was later cleared.
    function unquarantine(address noether, bytes32 incidentId, address account) external;

    /// @notice Conservation law broken: freeze. Only governance can unfreeze.
    function freeze(address noether, bytes32 incidentId, uint8 reason, uint256 originTxHash, uint256 originTimestamp)
        external;
}

/// @notice Extra callback on the cover pool for the payout loop.
interface INoetherCover is INoetherGuard {
    function settleBatch(address noether, bytes32 incidentId, uint256 maxCount) external;
}
