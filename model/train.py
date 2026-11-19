"""
Noether neural scorer: training and Solidity export.

The scorer runs inside NoetherLedger.react() on Reactive Lasna. It answers one question:

    "A mint (or release) just appeared with no matching lock (or burn) yet. Is this an honest
     out-of-order delivery that the grace window will explain, or a forgery we should freeze now?"

A low score never weakens the deterministic rules: the suspect still waits out the grace window and
is frozen if nothing backs it. A high score lets Noether skip the window and freeze immediately.
So the model can only make Noether faster, never more permissive.

Features (all scaled to [0, 1], fixed point 1e6 on-chain), computed in NoetherLedger._features():
    f0  amount / EMA(lock size), capped at 10x, divided by 10
    f1  amount / current backing (escrowed - released), capped at 1
    f2  recipient never seen on the home chain (1) or seen before (0)
    f3  unbacked events in the last 32 Lasna blocks, divided by 4, capped at 1
    f4  suspects currently open, divided by 4, capped at 1
    f5  Lasna blocks since the last observed lock, divided by 600, capped at 1

The training data is synthetic, generated below from documented assumptions about honest out-of-order
delivery versus forged mints (relayer-key compromise, verification bypass). It isn't a claim about
real attack frequencies. The point is a small, auditable, deterministic network whose weights anyone
can regenerate with `python model/train.py` and compare byte for byte.

Usage:  python model/train.py            -> writes src/reactive/NoetherBrainWeights.sol, model/model_card.json
"""

from __future__ import annotations

import json
import pathlib

import numpy as np

SEED = 7
N_PER_CLASS = 20_000
HIDDEN = 8
FEATURES = 6
SCALE = 1_000_000  # on-chain fixed point
ESCALATE_PROBABILITY = 0.95  # freeze without waiting for the grace window

ROOT = pathlib.Path(__file__).resolve().parents[1]
rng = np.random.default_rng(SEED)


def clip01(x: np.ndarray) -> np.ndarray:
    return np.clip(x, 0.0, 1.0)


def honest(n: int) -> np.ndarray:
    """A real lock exists, but the spoke event reached Reactive before the home event did."""
    amount_vs_avg = rng.lognormal(mean=0.0, sigma=0.8, size=n)  # typical sizes, occasional whales
    f0 = clip01(np.minimum(amount_vs_avg, 10.0) / 10.0)
    f1 = clip01(rng.beta(1.2, 40.0, size=n))  # a single honest transfer is a small slice of TVL
    f2 = (rng.random(n) < 0.30).astype(float)  # new users are common
    f3 = clip01(rng.poisson(0.3, size=n) / 4.0)  # out-of-order deliveries are rare and isolated
    f4 = clip01(rng.poisson(0.2, size=n) / 4.0)
    f5 = clip01(rng.exponential(0.02, size=n))  # the backing lock was made seconds ago
    return np.stack([f0, f1, f2, f3, f4, f5], axis=1)


def forged(n: int) -> np.ndarray:
    """Unbacked supply: compromised relayer key, forged proof, or replayed message."""
    amount_vs_avg = rng.lognormal(mean=1.6, sigma=0.9, size=n)
    f0 = clip01(np.minimum(amount_vs_avg, 10.0) / 10.0)
    f1 = clip01(rng.beta(2.0, 4.0, size=n))
    f2 = (rng.random(n) < 0.85).astype(float)
    f3 = clip01(rng.poisson(1.5, size=n) / 4.0)  # attackers repeat fast
    f4 = clip01(rng.poisson(1.0, size=n) / 4.0)
    f5 = clip01(rng.exponential(0.25, size=n))  # no lock activity preceded the mint
    return np.stack([f0, f1, f2, f3, f4, f5], axis=1)


def train() -> tuple[dict, dict]:
    x = np.concatenate([honest(N_PER_CLASS), forged(N_PER_CLASS)])
    y = np.concatenate([np.zeros(N_PER_CLASS), np.ones(N_PER_CLASS)])
    idx = rng.permutation(len(x))
    x, y = x[idx], y[idx]
    split = int(0.8 * len(x))
    xtr, ytr, xte, yte = x[:split], y[:split], x[split:], y[split:]

    w1 = rng.normal(0, 0.5, size=(FEATURES, HIDDEN))
    b1 = np.zeros(HIDDEN)
    w2 = rng.normal(0, 0.5, size=(HIDDEN,))
    b2 = 0.0
    params = [w1, b1, w2, np.array([b2])]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    lr, beta1, beta2, eps = 0.01, 0.9, 0.999, 1e-8

    for step in range(1, 3001):
        batch = rng.choice(len(xtr), 1024, replace=False)
        xb, yb = xtr[batch], ytr[batch]
        w1, b1, w2, b2v = params
        h_pre = xb @ w1 + b1
        h = np.maximum(h_pre, 0)
        z = h @ w2 + b2v[0]
        p = 1 / (1 + np.exp(-z))
        dz = (p - yb) / len(xb)
        gw2 = h.T @ dz
        gb2 = np.array([dz.sum()])
        dh = np.outer(dz, w2) * (h_pre > 0)
        gw1 = xb.T @ dh
        gb1 = dh.sum(axis=0)
        grads = [gw1, gb1, gw2, gb2]
        for i, g in enumerate(grads):
            m[i] = beta1 * m[i] + (1 - beta1) * g
            v[i] = beta2 * v[i] + (1 - beta2) * g * g
            mh = m[i] / (1 - beta1**step)
            vh = v[i] / (1 - beta2**step)
            params[i] = params[i] - lr * mh / (np.sqrt(vh) + eps)

    w1, b1, w2, b2v = params
    q = {
        "w1": np.round(w1 * SCALE).astype(np.int64),
        "b1": np.round(b1 * SCALE).astype(np.int64),
        "w2": np.round(w2 * SCALE).astype(np.int64),
        "b2": int(round(b2v[0] * SCALE)),
    }

    # Evaluate the *quantised integer* network exactly as Solidity computes it.
    logit_threshold = int(round(np.log(ESCALATE_PROBABILITY / (1 - ESCALATE_PROBABILITY)) * SCALE))
    xi = np.round(xte * SCALE).astype(np.int64)
    z_int = integer_forward(xi, q)
    pred = z_int >= logit_threshold
    honest_mask = yte == 0
    metrics = {
        "seed": SEED,
        "test_samples": int(len(yte)),
        "escalate_probability": ESCALATE_PROBABILITY,
        "logit_threshold_1e6": logit_threshold,
        "false_escalation_rate_on_honest": float(pred[honest_mask].mean()),
        "escalation_rate_on_forged": float(pred[~honest_mask].mean()),
        "accuracy_at_0_5": float(((z_int >= 0) == (yte == 1)).mean()),
    }
    return q, metrics


def integer_forward(xi: np.ndarray, q: dict) -> np.ndarray:
    """Bit-exact replica of NoetherBrain.logit(): int64 math, truncating division toward zero."""
    out = np.empty(len(xi), dtype=np.int64)
    for r, row in enumerate(xi):
        z = q["b2"]
        for j in range(HIDDEN):
            acc = 0
            for i in range(FEATURES):
                acc += int(row[i]) * int(q["w1"][i, j])
            h = int(acc / SCALE) if acc >= 0 else -int(-acc // SCALE)  # Solidity truncation
            h += int(q["b1"][j])
            h = max(h, 0)
            prod = h * int(q["w2"][j])
            z += int(prod / SCALE) if prod >= 0 else -int(-prod // SCALE)
        out[r] = z
    return out


def emit_solidity(q: dict, metrics: dict) -> str:
    lines = []
    for i in range(FEATURES):
        for j in range(HIDDEN):
            lines.append(f"        w[{i * HIDDEN + j}] = {int(q['w1'][i, j])};")
    w1_body = "\n".join(lines)
    b1_body = "\n".join(f"        b[{j}] = {int(q['b1'][j])};" for j in range(HIDDEN))
    w2_body = "\n".join(f"        w[{j}] = {int(q['w2'][j])};" for j in range(HIDDEN))
    return f"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title NoetherBrainWeights
/// @notice AUTO-GENERATED by model/train.py (seed {SEED}). Do not edit by hand; re-run the script.
///         Quantised 6-8-1 ReLU network, fixed point 1e6.
///         Held-out synthetic test set: false escalation on honest {metrics['false_escalation_rate_on_honest']:.4%},
///         escalation on forged {metrics['escalation_rate_on_forged']:.4%} at p >= {ESCALATE_PROBABILITY}.
library NoetherBrainWeights {{
    int256 internal constant SCALE = {SCALE};
    int256 internal constant FEATURES = {FEATURES};
    int256 internal constant HIDDEN = {HIDDEN};
    /// @notice Logit (x1e6) at or above which Noether freezes without waiting for the grace window.
    int256 internal constant ESCALATE_LOGIT = {metrics['logit_threshold_1e6']};
    int256 internal constant B2 = {q['b2']};

    function w1() internal pure returns (int256[{FEATURES * HIDDEN}] memory w) {{
{w1_body}
    }}

    function b1() internal pure returns (int256[{HIDDEN}] memory b) {{
{b1_body}
    }}

    function w2() internal pure returns (int256[{HIDDEN}] memory w) {{
{w2_body}
    }}
}}
"""


def main() -> None:
    q, metrics = train()
    sol = ROOT / "src" / "reactive" / "NoetherBrainWeights.sol"
    sol.parent.mkdir(parents=True, exist_ok=True)
    sol.write_text(emit_solidity(q, metrics), encoding="utf-8", newline="\n")
    # Golden vectors let the Foundry test prove Solidity == Python on the same inputs.
    golden_x = np.round(np.concatenate([honest(8), forged(8)]) * SCALE).astype(np.int64)
    golden_z = integer_forward(golden_x, q)
    card = {
        "name": "noether-brain-v1",
        "architecture": "6-8-1 MLP, ReLU hidden, logistic output, int fixed point 1e6",
        "features": [
            "amount / EMA(lock size), cap 10x, /10",
            "amount / backing, cap 1",
            "recipient novel on home chain (0/1)",
            "unbacked events in last 32 Lasna blocks / 4, cap 1",
            "open suspects / 4, cap 1",
            "Lasna blocks since last lock / 600, cap 1",
        ],
        "decision": "escalate (freeze now) iff logit >= ESCALATE_LOGIT; otherwise wait for the deterministic grace window",
        "safety": "the model can only shorten time-to-freeze; it can never clear a suspect or lift a freeze",
        "metrics": metrics,
        "golden": {"x": golden_x.tolist(), "logit": golden_z.tolist()},
    }
    (ROOT / "model" / "model_card.json").write_text(json.dumps(card, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
