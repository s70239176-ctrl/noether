// Bit-exact replica of NoetherBrain.logit() (src/reactive/NoetherBrain.sol): integer fixed point 1e6,
// Solidity-style truncating division. Weights come straight from model/train.py's export.
import weights from "../../../model/weights.json";

const S = BigInt(weights.scale);
const W1 = weights.w1.map((r: number[]) => r.map(BigInt));
const B1 = weights.b1.map(BigInt);
const W2 = weights.w2.map(BigInt);
const B2 = BigInt(weights.b2);
export const ESCALATE = BigInt(weights.escalateLogit);
export const FEATURE_NAMES = [
  "Size vs average lock",
  "Size vs backing",
  "Recipient never seen",
  "Unbacked burst (32 blocks)",
  "Open suspects",
  "Silence since last lock",
];

const div = (a: bigint, b: bigint) => a / b; // BigInt division truncates toward zero, like Solidity

/** @param x six features in [0, 1] */
export function forward(x: number[]) {
  const xi = x.map((v) => BigInt(Math.round(Math.max(0, Math.min(1, v)) * 1e6)));
  const hidden: number[] = [];
  let z = B2;
  for (let j = 0; j < 8; j++) {
    let acc = 0n;
    for (let i = 0; i < 6; i++) acc += xi[i] * W1[i][j];
    const h = div(acc, S) + B1[j];
    hidden.push(h > 0n ? Number(h) / 1e6 : 0);
    if (h > 0n) z += div(h * W2[j], S);
  }
  const logit = Number(z) / 1e6;
  return { logit, p: 1 / (1 + Math.exp(-logit)), escalate: z >= ESCALATE, hidden };
}

export const W1n = weights.w1.map((r: number[]) => r.map((v) => v / 1e6));
export const W2n = weights.w2.map((v: number) => v / 1e6);
