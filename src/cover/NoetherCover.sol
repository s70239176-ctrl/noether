// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IPayable } from "reactive-lib/interfaces/IPayable.sol";
import { NoetherGuarded } from "../guard/NoetherGuarded.sol";
import { INoetherCover, INoetherGuard, INoetherCoverEvents } from "../interfaces/INoether.sol";

/// @title NoetherCover
/// @notice Parametric bridge-exploit cover whose trigger is a conservation-law violation that Noether
///         proved from raw events, not a claims vote.
///
///         The hard problem in on-chain cover is the first minutes of a hack: people who see it first
///         buy cover against a loss already happening, draining money meant for honest buyers. Two
///         independent layers close that window:
///         1. Sales close within about a second of the first *suspect* event, before a violation is
///            even confirmed (`hold`).
///         2. Payout eligibility is fixed by the *origin* timestamp of the forged event on the spoke
///            chain, carried through the callback. A policy bought at or after that instant is excluded,
///            even if it slipped in before the hold landed.
///
///         Payouts need no claim. On `freeze`, the pool opens a payout and emits `PayoutBatch`; Noether
///         reacts with `settleBatch`, which pays the next batch and emits `PayoutBatch` again, until
///         nothing remains. If the reactive loop ever stalls, anyone can push it with `settleNext`.
contract NoetherCover is NoetherGuarded, INoetherCover, INoetherCoverEvents {
    error SalesClosed();
    error WrongPremium(uint256 expected, uint256 got);
    error OverCapacity(uint256 requested, uint256 available);
    error NotExpired(uint256 policyId);
    error NoPayout();
    error WrongIncident(bytes32 expected, bytes32 got);
    error TransferFailed2();
    error ZeroAmount();
    error InsufficientShares();

    event Deposited(address indexed underwriter, uint256 amount, uint256 shares);
    event Withdrawn(address indexed underwriter, uint256 amount, uint256 shares);
    event CoverBought(
        uint256 indexed policyId, address indexed holder, uint256 amount, uint256 premium, uint256 expiry
    );
    event PolicyRetired(uint256 indexed policyId);
    event PayoutOpened(bytes32 indexed incidentId, uint256 incidentTimestamp, uint256 ratioWad, uint256 policies);
    event PolicyPaid(
        uint256 indexed policyId, address indexed holder, uint256 payout, uint256 boughtAt, uint256 incidentTimestamp
    );
    event PolicyExcluded(uint256 indexed policyId, address indexed holder, uint8 why, uint256 boughtAt);
    event PayoutCompleted(bytes32 indexed incidentId, uint256 totalPaid);
    event Owed(address indexed holder, uint256 amount);

    uint8 internal constant EXCLUDED_BOUGHT_AFTER_INCIDENT = 1;
    uint8 internal constant EXCLUDED_EXPIRED = 2;

    uint256 public constant PREMIUM_BPS = 200; // 2% of the covered amount
    uint256 public immutable coverPeriod;
    uint256 internal constant WAD = 1e18;

    struct Policy {
        address holder;
        uint96 boughtAt;
        uint96 expiry;
        bool retired;
        bool settled;
        uint256 amount;
    }

    // underwriting
    uint256 public capital; // underwriter stake + premiums - payouts (gas top-ups are NOT capital)
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    // policies
    uint256 public nextPolicyId = 1;
    uint256 public outstandingCover;
    mapping(uint256 => Policy) public policies;

    // payout
    bytes32 public payoutIncident;
    uint256 public incidentTimestamp;
    uint256 public payoutRatioWad;
    uint256 public payoutCursor;
    uint256 public payoutEnd;
    uint256 public totalPaid;
    mapping(address => uint256) public owed;
    uint256 public totalOwed;

    constructor(IPayable callbackProxy_, address guardian_, uint256 coverPeriod_)
        payable
        NoetherGuarded(callbackProxy_, guardian_)
    {
        coverPeriod = coverPeriod_;
    }

    // ------------------------------------------------------------------ underwriters

    function deposit() external payable whenNotFrozen returns (uint256 minted) {
        if (msg.value == 0) revert ZeroAmount();
        minted = totalShares == 0 || capital == 0 ? msg.value : (msg.value * totalShares) / capital;
        capital += msg.value;
        totalShares += minted;
        shares[msg.sender] += minted;
        emit Deposited(msg.sender, msg.value, minted);
    }

    /// @notice Withdraw stake. Capital backing outstanding cover stays locked; nothing moves while frozen.
    function withdraw(uint256 shares_) external whenNotFrozen whenNotHeld {
        if (shares_ == 0 || shares[msg.sender] < shares_) revert InsufficientShares();
        uint256 amount = (shares_ * capital) / totalShares;
        if (capital - amount < outstandingCover) revert OverCapacity(amount, capital - outstandingCover);
        shares[msg.sender] -= shares_;
        totalShares -= shares_;
        capital -= amount;
        _send(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares_);
    }

    // ------------------------------------------------------------------ buyers

    function premiumFor(uint256 amount_) public pure returns (uint256) {
        return (amount_ * PREMIUM_BPS) / 10_000;
    }

    /// @notice Buy cover for `amount_` against a conservation-law violation on the protected bridge.
    function buyCover(uint256 amount_) external payable returns (uint256 policyId) {
        if (frozen || held) revert SalesClosed();
        if (amount_ == 0) revert ZeroAmount();
        uint256 premium = premiumFor(amount_);
        if (msg.value != premium) revert WrongPremium(premium, msg.value);
        uint256 available = capital > outstandingCover ? capital - outstandingCover : 0;
        if (amount_ > available) revert OverCapacity(amount_, available);

        capital += premium;
        outstandingCover += amount_;
        policyId = nextPolicyId++;
        uint256 expiry = block.timestamp + coverPeriod;
        policies[policyId] = Policy(msg.sender, uint96(block.timestamp), uint96(expiry), false, false, amount_);
        emit CoverBought(policyId, msg.sender, amount_, premium, expiry);
    }

    /// @notice Frees capacity held by an expired policy. Anyone can call it.
    function retire(uint256 policyId_) external {
        Policy storage p = policies[policyId_];
        if (p.retired || p.expiry > block.timestamp || p.holder == address(0)) revert NotExpired(policyId_);
        p.retired = true;
        outstandingCover -= p.amount;
        emit PolicyRetired(policyId_);
    }

    function claimOwed() external {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NoPayout();
        owed[msg.sender] = 0;
        totalOwed -= amount;
        _send(msg.sender, amount);
    }

    // ------------------------------------------------------------------ Noether hooks

    /// @dev A confirmed violation opens the payout. The ratio is fixed now: full payout if capital covers
    ///      every policy, pro-rata otherwise. Policies bought at or after the origin timestamp are skipped.
    function _onFreeze(bytes32 incidentId_, uint8, uint256 originTimestamp_) internal override {
        payoutIncident = incidentId_;
        incidentTimestamp = originTimestamp_;
        payoutRatioWad = outstandingCover == 0 || capital >= outstandingCover ? WAD : (capital * WAD) / outstandingCover;
        payoutCursor = 1;
        payoutEnd = nextPolicyId - 1;
        totalPaid = 0;
        emit PayoutOpened(incidentId_, originTimestamp_, payoutRatioWad, payoutEnd);
        emit PayoutBatch(incidentId_, payoutCursor, payoutEnd);
    }

    /// @inheritdoc INoetherCover
    function settleBatch(address sender_, bytes32 incidentId_, uint256 maxCount_) external onlyNoether(sender_) {
        if (incidentId_ != payoutIncident) revert WrongIncident(payoutIncident, incidentId_);
        _settle(maxCount_);
    }

    /// @notice Permissionless fallback in case the reactive payout loop stalls.
    function settleNext(uint256 maxCount_) external {
        if (!frozen || payoutIncident == bytes32(0)) revert NoPayout();
        _settle(maxCount_);
    }

    function _settle(uint256 maxCount_) internal {
        uint256 cursor = payoutCursor;
        uint256 end = payoutEnd;
        if (cursor == 0 || cursor > end) return;
        uint256 stop = cursor + maxCount_ > end + 1 ? end + 1 : cursor + maxCount_;
        uint256 ts = incidentTimestamp;
        for (; cursor < stop; ++cursor) {
            Policy storage p = policies[cursor];
            if (p.settled) continue;
            p.settled = true;
            if (p.boughtAt >= ts) {
                emit PolicyExcluded(cursor, p.holder, EXCLUDED_BOUGHT_AFTER_INCIDENT, p.boughtAt);
                continue;
            }
            if (p.retired || p.expiry <= ts) {
                emit PolicyExcluded(cursor, p.holder, EXCLUDED_EXPIRED, p.boughtAt);
                continue;
            }
            uint256 payout = (p.amount * payoutRatioWad) / WAD;
            if (payout > capital) payout = capital;
            capital -= payout;
            outstandingCover -= p.amount;
            p.retired = true;
            totalPaid += payout;
            (bool ok,) = payable(p.holder).call{ value: payout, gas: 30_000 }("");
            if (!ok) {
                owed[p.holder] += payout;
                totalOwed += payout;
                emit Owed(p.holder, payout);
            }
            emit PolicyPaid(cursor, p.holder, payout, p.boughtAt, ts);
        }
        payoutCursor = cursor;
        uint256 remaining = cursor > end ? 0 : end - cursor + 1;
        emit PayoutBatch(payoutIncident, cursor, remaining);
        if (remaining == 0) emit PayoutCompleted(payoutIncident, totalPaid);
    }

    function _onResolve() internal override {
        payoutIncident = bytes32(0);
        payoutCursor = 0;
        payoutEnd = 0;
    }

    /// @dev The cover pool has no accounts to quarantine.
    function _quarantinable(address) internal pure override returns (bool) {
        return false;
    }

    function _send(address to_, uint256 amount_) internal {
        (bool ok,) = payable(to_).call{ value: amount_ }("");
        if (!ok) revert TransferFailed2();
    }
}
