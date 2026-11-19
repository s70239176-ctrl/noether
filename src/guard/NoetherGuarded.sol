// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { AbstractPayer } from "reactive-lib/base/AbstractPayer.sol";
import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { INoetherGuard } from "../interfaces/INoether.sol";

/// @title NoetherGuarded
/// @notice Base for every contract Noether protects. It accepts callbacks only when BOTH hold:
///         1. `msg.sender` is the chain's Reactive callback proxy (checked by `onlyServiceProvider`), and
///         2. the proxy-injected first argument equals the registered Noether reactive contract.
///
///         It keeps three independent safety states:
///         - `held`        precautionary and reversible; Noether sets and lifts it on its own.
///         - `frozen`      a conservation law was broken; only `guardian` (governance) can unfreeze.
///         - `quarantined` per-account block for suspect recipients and taint hops.
///
///         Every transition emits the origin transaction hash and origin timestamp, so the
///         origin event -> Reactive transaction -> callback loop can be checked from the explorer alone.
abstract contract NoetherGuarded is AbstractPayer, INoetherGuard {
    error OnlyGuardian();
    error UnknownNoether(address got, address expected);
    error Frozen();
    error Held();
    error AccountQuarantined(address account);

    event NoetherSet(address indexed noether);
    event GuardianSet(address indexed guardian);
    event GuardHeld(bytes32 indexed incidentId, uint256 originTxHash, uint256 originTimestamp, uint256 landedAt);
    event GuardLifted(bytes32 indexed incidentId, uint256 landedAt);
    event GuardFrozen(
        bytes32 indexed incidentId, uint8 reason, uint256 originTxHash, uint256 originTimestamp, uint256 landedAt
    );
    event AccountQuarantine(
        bytes32 indexed incidentId, address indexed account, uint256 originTimestamp, uint256 landedAt
    );
    event AccountReleased(bytes32 indexed incidentId, address indexed account);
    event GuardResolved(address indexed guardian);

    /// @notice Governance (multisig in production). Can resolve a freeze and rotate the Noether address.
    address public guardian;
    /// @notice The Noether reactive contract on Lasna whose callbacks this contract trusts.
    address public noether;

    bool public held;
    bool public frozen;
    bytes32 public lastIncident;
    mapping(address account => bool) public quarantined;

    constructor(IPayable callbackProxy_, address guardian_) AbstractPayer(callbackProxy_) {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    // ------------------------------------------------------------------ modifiers

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert OnlyGuardian();
        _;
    }

    /// @dev Proxy check + injected-sender check. A forged call from anyone else fails the first;
    ///      a callback requested by some other reactive contract fails the second.
    modifier onlyNoether(address sender_) {
        _onlyServiceProvider();
        if (sender_ != noether || sender_ == address(0)) revert UnknownNoether(sender_, noether);
        _;
    }

    modifier whenNotFrozen() {
        if (frozen) revert Frozen();
        _;
    }

    modifier whenNotHeld() {
        if (held) revert Held();
        _;
    }

    modifier notQuarantined(address account_) {
        if (quarantined[account_]) revert AccountQuarantined(account_);
        _;
    }

    // ------------------------------------------------------------------ governance

    /// @notice Registers the Noether reactive contract. It is deployed after the protected contracts
    ///         because it must know their addresses to subscribe, so this cannot be an immutable.
    function setNoether(address noether_) external onlyGuardian {
        noether = noether_;
        emit NoetherSet(noether_);
    }

    function setGuardian(address guardian_) external onlyGuardian {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Human resolution after an investigation. Noether never unfreezes on its own.
    function resolve() external onlyGuardian {
        frozen = false;
        held = false;
        _onResolve();
        emit GuardResolved(msg.sender);
    }

    function clearQuarantine(address account_) external onlyGuardian {
        quarantined[account_] = false;
        emit AccountReleased(bytes32(0), account_);
    }

    /// @notice Pays outstanding callback-proxy debt from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    // ------------------------------------------------------------------ Noether callbacks

    /// @inheritdoc INoetherGuard
    function hold(address sender_, bytes32 incidentId_, uint256 originTxHash_, uint256 originTimestamp_)
        external
        onlyNoether(sender_)
    {
        held = true;
        lastIncident = incidentId_;
        _onHold(incidentId_);
        emit GuardHeld(incidentId_, originTxHash_, originTimestamp_, block.timestamp);
    }

    /// @inheritdoc INoetherGuard
    function lift(address sender_, bytes32 incidentId_) external onlyNoether(sender_) {
        held = false;
        _onLift(incidentId_);
        emit GuardLifted(incidentId_, block.timestamp);
    }

    /// @inheritdoc INoetherGuard
    function quarantine(address sender_, bytes32 incidentId_, address account_, uint256 originTimestamp_)
        external
        onlyNoether(sender_)
    {
        if (!_quarantinable(account_)) return;
        quarantined[account_] = true;
        emit AccountQuarantine(incidentId_, account_, originTimestamp_, block.timestamp);
    }

    /// @inheritdoc INoetherGuard
    function unquarantine(address sender_, bytes32 incidentId_, address account_) external onlyNoether(sender_) {
        // A frozen contract keeps its quarantines until governance looks at them.
        if (frozen) return;
        quarantined[account_] = false;
        emit AccountReleased(incidentId_, account_);
    }

    /// @inheritdoc INoetherGuard
    function freeze(
        address sender_,
        bytes32 incidentId_,
        uint8 reason_,
        uint256 originTxHash_,
        uint256 originTimestamp_
    ) external onlyNoether(sender_) {
        if (frozen) return; // idempotent: a second violation in the same incident changes nothing
        frozen = true;
        lastIncident = incidentId_;
        _onFreeze(incidentId_, reason_, originTimestamp_);
        emit GuardFrozen(incidentId_, reason_, originTxHash_, originTimestamp_, block.timestamp);
    }

    // ------------------------------------------------------------------ hooks

    function _onHold(bytes32 incidentId_) internal virtual { }
    function _onLift(bytes32 incidentId_) internal virtual { }
    function _onFreeze(bytes32 incidentId_, uint8 reason_, uint256 originTimestamp_) internal virtual { }
    function _onResolve() internal virtual { }

    /// @dev Contracts can refuse to quarantine infrastructure addresses (e.g. themselves).
    function _quarantinable(address account_) internal view virtual returns (bool) {
        return account_ != address(0) && account_ != address(this);
    }
}
