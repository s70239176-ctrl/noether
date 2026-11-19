// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { NoetherBrainWeights as W } from "./NoetherBrainWeights.sol";

/// @title NoetherBrain
/// @notice Integer forward pass of the 6-8-1 scorer trained in `model/train.py`. It runs inside
///         `NoetherLedger.react()`, so the decision is made on-chain in the same reactive transaction
///         that observed the event. No oracle, no off-chain inference, no added latency.
/// @dev Bit-exact with `integer_forward()` in the training script: Solidity's signed division
///      truncates toward zero, and so does the Python replica. `test/NoetherBrain.t.sol` checks golden vectors.
library NoetherBrain {
    /// @param x Six features in fixed point 1e6, each in [0, 1e6].
    /// @return z Output logit in fixed point 1e6.
    function logit(int256[6] memory x) internal pure returns (int256 z) {
        int256[48] memory w1 = W.w1();
        int256[8] memory b1 = W.b1();
        int256[8] memory w2 = W.w2();
        z = W.B2;
        for (uint256 j = 0; j < 8; ++j) {
            int256 acc = 0;
            for (uint256 i = 0; i < 6; ++i) {
                acc += x[i] * w1[i * 8 + j];
            }
            int256 h = acc / W.SCALE + b1[j];
            if (h > 0) z += (h * w2[j]) / W.SCALE;
        }
    }

    /// @notice True when the scorer is confident enough to freeze without waiting for the grace window.
    function escalate(int256 z) internal pure returns (bool) {
        return z >= W.ESCALATE_LOGIT;
    }

    /// @notice Human-readable probability in basis points, for events and dashboards only (never used
    ///         for decisions). Piecewise-linear logistic over [-6, 6].
    function probabilityBps(int256 z) internal pure returns (uint256) {
        int256 s = W.SCALE;
        if (z <= -6 * s) return 25;
        if (z >= 6 * s) return 9975;
        // Anchor points of the logistic function at integer logits, in bps.
        int16[13] memory p = [int16(25), 67, 180, 474, 1192, 2689, 5000, 7311, 8808, 9526, 9820, 9933, 9975];
        int256 shifted = z + 6 * s; // in [0, 12s)
        uint256 k = uint256(shifted / s);
        int256 frac = shifted % s;
        int256 lo = int256(p[k]);
        int256 hi = int256(p[k + 1]);
        return uint256(lo + ((hi - lo) * frac) / s);
    }
}
