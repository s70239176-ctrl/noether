# Noether: live evidence (testnet)

Recorded 2026-11-19 on Base Sepolia, Unichain Sepolia and Reactive Lasna. Everything below was regenerated from raw chain logs by `script/evidence.mjs`; nothing comes from the demo script's own clock.

## Deployed contracts

| Contract | Chain | Address |
|---|---|---|
| Hyperlane Mailbox (live, Hyperlane's) | Base Sepolia | [`0x6966b0E55883d49BFB24539356a2f8A673E02039`](https://sepolia.basescan.org/address/0x6966b0E55883d49BFB24539356a2f8A673E02039) |
| Hyperlane Mailbox (live, Hyperlane's) | Unichain Sepolia | [`0xDDcFEcF17586D08A5740B7D91735fcCE3dfe3eeD`](https://sepolia.uniscan.xyz/address/0xDDcFEcF17586D08A5740B7D91735fcCE3dfe3eeD) |
| HypERC20Collateral (warp route, collateral side) | Base Sepolia | [`0xf98333e03335476B13f967244ce74dD75187D006`](https://sepolia.basescan.org/address/0xf98333e03335476B13f967244ce74dD75187D006) |
| NoetherHypERC20 (warp route, synthetic side) | Unichain Sepolia | [`0xEbc5cf1D4B157071f1F210A2A44be22aD6d9a329`](https://sepolia.uniscan.xyz/address/0xEbc5cf1D4B157071f1F210A2A44be22aD6d9a329) |
| NoetherIsm (route ISM, Base) | Base Sepolia | [`0xEbc5cf1D4B157071f1F210A2A44be22aD6d9a329`](https://sepolia.basescan.org/address/0xEbc5cf1D4B157071f1F210A2A44be22aD6d9a329) |
| NoetherIsm (route ISM, Unichain) | Unichain Sepolia | [`0x9e8046A7eca570d7D05526622c81ddE22aAE04Dd`](https://sepolia.uniscan.xyz/address/0x9e8046A7eca570d7D05526622c81ddE22aAE04Dd) |
| TrustedRelayerIsm (Hyperlane's, inner ISM) | Base / Unichain | `0x9e8046A7eca570d7D05526622c81ddE22aAE04Dd` / `0x2466B17F7D7427A403050A18021a03F5497bf011` |
| NoetherCover | Base Sepolia | [`0x6ebc6c11F13fd70eCc369a6798a334D89AACB869`](https://sepolia.basescan.org/address/0x6ebc6c11F13fd70eCc369a6798a334D89AACB869) |
| DemoUSD (collateral) | Base Sepolia | [`0x2466B17F7D7427A403050A18021a03F5497bf011`](https://sepolia.basescan.org/address/0x2466B17F7D7427A403050A18021a03F5497bf011) |
| **NoetherLedger (reactive contract)** | Reactive Lasna | [`0x2466B17F7D7427A403050A18021a03F5497bf011`](https://lasna.reactscan.net/address/0x2466B17F7D7427A403050A18021a03F5497bf011) |

Ledger deployment: [0xbc0457…f0e8](https://lasna.reactscan.net/tx/0xbc045780d7ee1e2dbf39ba6472795357edbff8cb98843b42f85d824ee5c2f0e8). It registered 5 subscriptions with the system contract in its constructor: Base Mailbox `Dispatch` (topic1 = route router), Base guard `Inbound`, cover `PayoutBatch`, Unichain Mailbox `Dispatch` (topic1 = route router), and Unichain guard `Inbound`.

## Scenario 0: honest warp transfer (Noether stays silent)

- 1,000 dUSD dispatched on Base: [0x517f42…29d9](https://sepolia.basescan.org/tx/0x517f42c28e5277af831d6556930bd7a58f0f28c031658811fbf5295aa70629d9)
- Relayed through Hyperlane's Mailbox on Unichain, 1,000 ndUSD minted: [0x2f0183…dc1e](https://sepolia.uniscan.xyz/tx/0x2f01838d78f4b58ce5e93c38ee4bf487df74ac6e4a14d588e67648516d01dc1e)
- The ledger on Lasna matched the two by Hyperlane message id: `mode = NORMAL`, `escrowed = 1000`, `circulating = 1000`, zero callbacks.

## Scenarios 1 and 2: compromised relayer key

Scenario 1 (unbacked mint) was run with `bash script/demo.sh attack`. The front-runner's `buyCover` was **rejected, because sales had already closed**, and the attacker's second forged message was rejected by Hyperlane's Mailbox (`ISM verification failed`).

Scenario 2 (drained collateral) was run with `bash script/demo.sh resolve && bash script/demo.sh drain`. The copycat drain was rejected the same way.

### Suspects raised on Lasna
- 0x91500eaa… amount 1,000,000 to 0x00000000000000000000000000000000000bad01, scorer logit 37.74 (p≈99.75%) | [Lasna tx](https://lasna.reactscan.net/tx/0xeb4b319520edcad88bae85da1f5be342c626d55d10b535d2ea0e5bf8831ce2c9)
- 0x58e9dcfa… amount 100 to 0x00000000000000000000000000000000000bad01, scorer logit 6.29 (p≈99.75%) | [Lasna tx](https://lasna.reactscan.net/tx/0x3648d82bc307c9123b56d09f10ac43fc5e6d9e667ca8f2691ca5d47c77ce6c6f)

### Incident 0x91500eaabcd2b86390cba26c22ad058354ee67f83d6021542434ac88a1b97d49
Reason **NEURAL_ESCALATION** on chain 1301: 1,000,000 delivered to 0x00000000000000000000000000000000000bad01. Ledger at detection: escrowed 1,000, circulating 1,001,000.

| Step | Chain | When (UTC) | +s from origin | Tx |
|---|---|---|---|---|
| 1. Forged message processed by Hyperlane Mailbox (unbacked mint) | Unichain Sepolia | 2026-11-19T01:22:03Z | +0 | [0x4a58c335d5…](https://sepolia.uniscan.xyz/tx/0x4a58c335d50882d1b80f25d8ca582b093ffda76e1170359a8481fae431e8d5d4) |
| 2. Noether reacts: law broken | Reactive Lasna | 2026-11-19T01:22:02Z | -1 (clock skew) | [0xeb4b319520…](https://lasna.reactscan.net/tx/0xeb4b319520edcad88bae85da1f5be342c626d55d10b535d2ea0e5bf8831ce2c9) |
| 3. Unichain route frozen (NoetherIsm) | Unichain Sepolia | 2026-11-19T01:22:05Z | +2 | [0x2cb4a29ba4…](https://sepolia.uniscan.xyz/tx/0x2cb4a29ba4d81c3d1991a8b5dd6b9b196c33f5fd143f693d1c5c8752e9561040) |
| 3. Base route frozen (NoetherIsm) | Base Sepolia | 2026-11-19T01:22:04Z | +1 | [0x20e528ef0e…](https://sepolia.basescan.org/tx/0x20e528ef0e88a08bd0dd0463b89401ab7f537fa8d34a3b15e5b5a477ca73432b) |
| 3. Cover sales closed + payout opened | Base Sepolia | 2026-11-19T01:22:05Z | +2 | [0x6afbdecb9e…](https://sepolia.basescan.org/tx/0x6afbdecb9e3d11c4439c52f7fe92746ba0455a4d6a1cef9541fb8bc2d214404a) |
| 3. Quarantined 0x00000000… | Unichain Sepolia | 2026-11-19T01:22:05Z | +2 | [0xb90188934f…](https://sepolia.uniscan.xyz/tx/0xb90188934f87467a7bd257cc06bb498f6d0b7deb7eb7eef13b22106d183f5894) |
| 4. Payout completed (0.0025 ETH) | Base Sepolia | 2026-11-19T01:22:06Z | +3 | [0xf15f0190a5…](https://sepolia.basescan.org/tx/0xf15f0190a54492c248ea7522ad217407837f3d4071a80bab554fba6036dbeaad) |

Callbacks requested in that single reactive transaction: **4** (multi-destination fan-out).
Policies paid automatically for this incident: **3**. Policies excluded in range (bought at or after a forged event): **0**.

### Incident 0x58e9dcfa070abce495886961ed5b17dc07aaa0fad699438f55aefd38d6da66c3
Reason **NEURAL_ESCALATION** on chain 84532: 100 delivered to 0x00000000000000000000000000000000000bad01. Ledger at detection: escrowed 900, circulating 1,001,000.

| Step | Chain | When (UTC) | +s from origin | Tx |
|---|---|---|---|---|
| 1. Forged message processed by Hyperlane Mailbox (unbacked release) | Base Sepolia | 2026-11-19T01:23:51Z | +0 | [0x18b20707d7…](https://sepolia.basescan.org/tx/0x18b20707d775fb1a1dae61b3684432ee544e555f928d6b1e779ac33ebe8922b9) |
| 2. Noether reacts: law broken | Reactive Lasna | 2026-11-19T01:23:50Z | -1 (clock skew) | [0x3648d82bc3…](https://lasna.reactscan.net/tx/0x3648d82bc307c9123b56d09f10ac43fc5e6d9e667ca8f2691ca5d47c77ce6c6f) |
| 3. Unichain route frozen (NoetherIsm) | Unichain Sepolia | 2026-11-19T01:23:53Z | +2 | [0x5af4c529e8…](https://sepolia.uniscan.xyz/tx/0x5af4c529e8e20ead03cb2ced99435357fd3f67f203236a5cc83354d861d6e7aa) |
| 3. Base route frozen (NoetherIsm) | Base Sepolia | 2026-11-19T01:23:52Z | +1 | [0x7345d2c636…](https://sepolia.basescan.org/tx/0x7345d2c636dceaa2b0fe0508c706f7cd5e2b73972bafcb11786e73f16ce9c8f9) |
| 3. Cover sales closed + payout opened | Base Sepolia | 2026-11-19T01:23:53Z | +2 | [0xd04c1e297a…](https://sepolia.basescan.org/tx/0xd04c1e297a73f853ba0d3ff080f411677bced6b49da658d13790bb7e4abb9f2a) |
| 4. Payout completed (0 ETH) | Base Sepolia | 2026-11-19T01:23:55Z | +4 | [0xc23f517fec…](https://sepolia.basescan.org/tx/0xc23f517fecc2fc017eef6cdcd4aea42a18e307ae1ce169e404076fbdee0d1c51) |

Callbacks requested in that single reactive transaction: **3** (multi-destination fan-out).
Policies paid automatically for this incident: **0**. Policies excluded in range (bought at or after a forged event): **0**.

### Reading the timestamps

Each chain keeps its own clock at about 1 s granularity, so Lasna's block can carry a timestamp one second "before" the origin block it reacted to. The "+s" column measures each destination block's timestamp against the origin block's timestamp. In scenario 1 the callback count is 4: Base guard, cover, Unichain guard, and the attacker's quarantine. In scenario 2 it is 3, because a home-side recipient isn't quarantined on the synthetic token. In scenario 2 the payout was 0 ETH: the three test policies had already been paid out in scenario 1.
