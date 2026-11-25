# Noether: live evidence (testnet)

Recorded 2026-11-19 on Base Sepolia, Unichain Sepolia and Reactive Lasna. Everything below was regenerated from raw chain logs by `script/evidence.mjs`; nothing comes from the demo script's own clock.

## Benchmark (2026-11-25)

26 forged mints through Hyperlane's real Mailbox on 2026-11-25, interleaved with 39 honest transfers, on the live testnets. Latency is measured from block timestamps, relative to the forged mint's block.

| Result | |
|---|---|
| Forged mints that froze **both** routes | **26 / 26** |
| Both routes frozen | **+2 s p50 · +3 s p95** (Base +1 s p50, Unichain +2 s p50) |
| Noether's decision on Lasna | same second as the forged mint (p95 +0 s) |
| Callbacks per reaction | 4 every time (Base guard, cover, Unichain guard, quarantine) |
| Copycat forged messages rejected by the frozen route | **26 / 26** |
| Honest transfers frozen by mistake | **0 / 39** (39/39 matched by message id, 0 suspects raised) |

Every run, with links to each transaction: [deployments/bench/BENCH.md](../deployments/bench/BENCH.md).

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

## Run 3: from the Observatory UI, 2026-11-19 ~20:13 UTC (testnet delivery stall)

Every step was clicked in the Observatory's operator console: **Resolve**, then **Bridge 1,000 dUSD**, then **Forge a 1,000,000 mint**.

- Honest transfer: [dispatch](https://sepolia.basescan.org/tx/0xf1b9e9106b2496017045be631635825dea2bd6c24187f42b63b3da98bb7907cd) on Base, [delivery](https://sepolia.uniscan.xyz/tx/0x6eafcb14fc22b22e8478dc65678409fde0e36c280ecbcad2c260f7eb66d814fc) on Unichain, matched by the ledger, mode stayed NORMAL.
- Forged mint accepted by the Unichain Mailbox: [0x318b23…503726](https://sepolia.uniscan.xyz/tx/0x318b23cd9200224b2884c643a9b4c2e09cab200347fc08f9f07983d658503726).
- **Noether reacted in the same second**: `NEURAL_ESCALATION` (p ≈ 99.75%), 4 callbacks requested, taint subscription opened ([Lasna tx](https://lasna.reactscan.net/tx/0x3613854c9b765d715d6aa589ec40706cb22c9e9266d498fb3ea2da9466ec9073)).
- **Callback delivery stalled network-wide**: Reactive's testnet delivery account (`0xF7E866D726658F6C3F14B8EE537fe268a4D91DDb`) sent no transactions on Base or Unichain for several minutes (nonce stuck at 6939 on Base), while our ledger had REACT and no debt and our guards had ETH and no proxy debt. When delivery resumed, all four callbacks landed together at 20:38:59 UTC, **1,509 s after the reaction**:
  - [Unichain route frozen](https://sepolia.uniscan.xyz/tx/0x98949a4b4fda7598adcf86e1cdd3c111e40f57a0fe0ce75e070db61717823fa9)
  - [Base route frozen](https://sepolia.basescan.org/tx/0x08e42a0031aafca18d32fe202c6a2f72d66b85db7560b6fe243a1a5f3bd35890)
  - [cover sales closed, payout opened](https://sepolia.basescan.org/tx/0x2b32e6cef2c729b3795c8dd2f0ec284f8f89d1998ac450a8b47d5e3faaf0efad)
  - [attacker quarantined](https://sepolia.uniscan.xyz/tx/0x56c487ab77f2c522c61875de8e1f3e7e61ddbf783d688127b92b4bc7c3ac9d2a)
- During the stall, a front-runner bought cover (policy #4, [0xecaf74…adbfc1](https://sepolia.basescan.org/tx/0xecaf74214c29311bf0e8d7cf3c98317f626f7fee38319076ca0801e4d6adbfc1)) before the hold landed. Eligibility is decided by the forged mint's origin timestamp, and the self-continuing payout loop later settled it as **excluded** (`PolicyExcluded`, then `PayoutCompleted`): [0x5ff700…72d0](https://sepolia.basescan.org/tx/0x5ff700b31231e57392586926388f6dc493889642ee33b0e07a57f49333f272d0). The second layer of the front-running defence, proven live.

Takeaway: Noether's decision is made inside one reactive transaction in the same second. End-to-end time-to-freeze also includes Reactive's callback delivery, which was 1–2 s in runs 1 and 2 and 25 minutes during this testnet stall. The Observatory shows "callbacks landed n / 4" and a live wait timer, so a stall is visible instead of hidden.

## Run 4: Monitor mode, 2026-11-24 (zero-integration audit)

`NoetherMonitor` was deployed on Lasna at [`0xf98333e03335476B13f967244ce74dD75187D006`](https://lasna.reactscan.net/address/0xf98333e03335476B13f967244ce74dD75187D006) with a 60-block grace window, and started watching two routes:

- **Third-party, from Hyperlane's registry** (`deployments/warp_routes/USDC/predicate-sepolia-basesepolia`): native ETH on Base Sepolia `0x1D39722592a8FaB912Aa582416F1f1b21bda2E30` ⇄ synthetic ETH on Ethereum Sepolia `0x79B42902Ef4D9532d9EB4c1E6e064Cd79Da87B3B`. Registered in [0x06cb…822d](https://lasna.reactscan.net/tx/0x06cba257ca37cfad8df4f08acd9f910f641ef27030f3c02b3a5f187a5096822d), with opening books read on-chain: 0.0309 ETH locked, 0.0309 ETH minted (balanced). Our attempt to send a transfer through it reverted at gas estimation with `PredicateRouterWrapper__UnauthorizedTransfer`: the route only accepts transfers through a Predicate compliance wrapper with an off-chain attestation. Nothing was sent.
- **Noether's dUSD route**, registered in [0xb3bf…4f02](https://lasna.reactscan.net/tx/0xb3bfd86fffb90ba9ed464c7573e83e745b97a7977f12f18295cfe97436044f02).

Live match on the dUSD route. The monitor uses only the routers' public events, not Noether's guard:

1. 1,000 dUSD locked on Base: [0xd3db51…0bcc](https://sepolia.basescan.org/tx/0xd3db51412641a76520893963e5831ae24c3e58bd4e8f38492409826bebcc0bcc)
2. Monitor recorded the send: [`TransferSent` 0xafc3b7…7b93](https://lasna.reactscan.net/tx/0xafc3b7a1ff0a3afeea2371901199b158c23ee443434d45c9b7fcccda0be37b93)
3. Delivered on Unichain by `Mailbox.process`: [0xc57315…4a3b](https://sepolia.uniscan.xyz/tx/0xc5731527eafd91fab96814175dd0746dc6fca98da21668ad78e6e04d6b284a3b) (the first relay attempts failed on network timeouts; the same message was relayed once, later)
4. Monitor matched the delivery: [`TransferMatched` 0x38a907…6200](https://lasna.reactscan.net/tx/0x38a907222432eff479f90a1ec41a4312eee84464f524f7126d62a719f4f06200)

Afterwards the monitor's books (escrow 2,900 dUSD, circulating 2,003,000 ndUSD, matched 1, unexplained 0) equal the Enforce-mode ledger's (escrowed 2,900, circulating 2,003,000, mode NORMAL).

## Run 5: protecting an existing stock route in one command, 2026-11-24

1. **A stock Hyperlane route with no Noether code** was deployed: [`HypERC20Collateral` 0xF03bF46a2600e0233e5Ed96e727cd491F3125D8c](https://sepolia.basescan.org/address/0xF03bF46a2600e0233e5Ed96e727cd491F3125D8c) on Base Sepolia ⇄ [`HypERC20` 0x2D23bEdD66d9E2Cce1B420B19e5DA4b1D52B7D0A](https://sepolia.uniscan.xyz/address/0x2D23bEdD66d9E2Cce1B420B19e5DA4b1D52B7D0A) on Unichain Sepolia, each secured by its own `TrustedRelayerIsm` (Base `0xE5f06F85d97Ca9551AAB4A7B6919d02290043437`, Unichain `0x1da5537cB1C15b45AC2461d5dccce4c6227c7dBa`).
2. **`bash script/protect.sh`** (about 2 minutes of network time, not counting RPC retries):
   - Guards from `NoetherGuardFactory`, each wrapping that route's own ISM: Base [`0x305fF099FEb5a878221C3C1C5DcF051B63028215`](https://sepolia.basescan.org/address/0x305fF099FEb5a878221C3C1C5DcF051B63028215), Unichain [`0x51ADAF2224f8D08F64a8cf50AB04b83997Fd9433`](https://sepolia.uniscan.xyz/address/0x51ADAF2224f8D08F64a8cf50AB04b83997Fd9433). 58 s.
   - Ledger without cover on Lasna: [`0xB8d99c8CA86557e74A817C16Ff776cB7507D216e`](https://lasna.reactscan.net/address/0xB8d99c8CA86557e74A817C16Ff776cB7507D216e). 18 s.
   - Wiring: guards trust the ledger, routers point at their guards. 14 s + 25 s.
3. **Attack**: a forged 1,000,000 mint accepted by the Unichain Mailbox, [0xadd2b3…3bca](https://sepolia.uniscan.xyz/tx/0xadd2b3ec6ebb03291949313169953bb16dc942f6b911b78aeeb2a72787ce3bca).
4. **Freeze**: the ledger went to BREACHED. [Base guard frozen](https://sepolia.basescan.org/tx/0x38f5256e726f85582de3e736927e1a53d9e78136dba20bb446fb7fdae4e96f4c) **1 s** after the origin timestamp, and [Unichain guard frozen](https://sepolia.uniscan.xyz/tx/0x028cd03c963713bebd973185d07588a8cbea003acfc37c6a8308c4b5decb33fd) **2 s** after.

Notes: an earlier `protect.sh` attempt deployed one extra Base guard before an RPC timeout; it is unused. The script now retries each step.

## Measured costs (2026-11-24)

From balance changes on Lasna (base fee ≈ 70 gwei): 0.0145 REACT for an honest dispatch reaction, 0.0152 and 0.0140 REACT for Monitor mode's send and match, and 0.0431 REACT for the run-3 violation reaction with 4 callbacks. Destination guards spent under 0.0000021 ETH each in total, across every callback in three incidents.
