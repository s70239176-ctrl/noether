# Judging Noether in 5 minutes

No wallet needed. Every claim below is an on-chain transaction you can open.

## 1. Watch it (2 minutes)

The demo video shows an uncut live attack on the testnets: a forged 1,000,000 mint accepted by Hyperlane's real Mailbox, the ledger flipping to BREACHED, and all four freeze callbacks landing. A page-rendered UTC clock runs throughout.

## 2. Follow one attack through the full loop (six links)

Forged 1,000,000 mint with the route's compromised relayer key, 2026-11-19 (UTC). The times are block timestamps relative to the forged mint.

| Step | Chain | When | Tx |
|---|---|---|---|
| 1. Forged message accepted by Hyperlane's Mailbox: 1,000,000 minted with nothing locked | Unichain Sepolia | 0 s | [0x4a58c3…d5d4](https://sepolia.uniscan.xyz/tx/0x4a58c335d50882d1b80f25d8ca582b093ffda76e1170359a8481fae431e8d5d4) |
| 2. Noether's `react()`: law broken, neural scorer p ≈ 99.75%, **4 callbacks in one reaction** | Reactive Lasna | same second | [0xeb4b31…c2c9](https://lasna.reactscan.net/tx/0xeb4b319520edcad88bae85da1f5be342c626d55d10b535d2ea0e5bf8831ce2c9) |
| 3. Base route frozen | Base Sepolia | +1 s | [0x20e528…432b](https://sepolia.basescan.org/tx/0x20e528ef0e88a08bd0dd0463b89401ab7f537fa8d34a3b15e5b5a477ca73432b) |
| 4. Unichain route frozen | Unichain Sepolia | +2 s | [0x2cb4a2…1040](https://sepolia.uniscan.xyz/tx/0x2cb4a29ba4d81c3d1991a8b5dd6b9b196c33f5fd143f693d1c5c8752e9561040) |
| 5. Attacker quarantined | Unichain Sepolia | +2 s | [0xb90188…5894](https://sepolia.uniscan.xyz/tx/0xb90188934f87467a7bd257cc06bb498f6d0b7deb7eb7eef13b22106d183f5894) |
| 6. Cover paid by the self-continuing reactive loop: 3 policies, no claims | Base Sepolia | +3 s | [0xf15f01…eaad](https://sepolia.basescan.org/tx/0xf15f0190a54492c248ea7522ad217407837f3d4071a80bab554fba6036dbeaad) |

On the Lasna transaction (step 2), Reactscan lists the four callbacks: Base guard, cover pool, Unichain guard and the quarantine.

## 3. Check that it holds up: the benchmark

26 forged mints through Hyperlane's real Mailbox on 2026-11-25, interleaved with 39 honest transfers, on the live testnets. Latency is measured from block timestamps, relative to the forged mint's block.

| Result | |
|---|---|
| Forged mints that froze **both** routes | **26 / 26** |
| Both routes frozen | **+2 s p50 · +3 s p95** (Base +1 s p50, Unichain +2 s p50) |
| Noether's decision on Lasna | same second as the forged mint (p95 +0 s) |
| Callbacks per reaction | 4 every time (Base guard, cover, Unichain guard, quarantine) |
| Copycat forged messages rejected by the frozen route | **26 / 26** |
| Honest transfers frozen by mistake | **0 / 39** (39/39 matched by message id, 0 suspects raised) |

Every run, with its transactions: [deployments/bench/BENCH.md](../deployments/bench/BENCH.md).

## 4. Watch the live state

[noether-ashy.vercel.app](https://noether-ashy.vercel.app) reads Base Sepolia, Unichain Sepolia and Lasna live: escrow vs supply, law health, the message map, and the incident dossier rebuilt from on-chain timestamps.

## 5. Where to look in the code

| What | File |
|---|---|
| The reactive contract: ledger, response ladder, fan-out callbacks, dynamic subscriptions | [src/reactive/NoetherLedger.sol](../src/reactive/NoetherLedger.sol) |
| Neural scorer inside `react()` | [src/reactive/NoetherBrain.sol](../src/reactive/NoetherBrain.sol) |
| Guard installed as the Hyperlane route's ISM (callback target) | [src/hyperlane/NoetherIsm.sol](../src/hyperlane/NoetherIsm.sol) |
| Zero-integration Monitor mode | [src/reactive/NoetherMonitor.sol](../src/reactive/NoetherMonitor.sol) |
| Protect an existing route in one command | [script/protect.sh](../script/protect.sh), [src/protect/NoetherGuardFactory.sol](../src/protect/NoetherGuardFactory.sol) |
| Tests: 44, on Hyperlane's real contracts | [test/](../test) (`forge test`) |

## What's real and what isn't

These are real: Hyperlane's live Mailboxes, Hyperlane's warp-route contracts, Reactive Lasna, and every reaction and callback.

These are demo-only: the "compromised relayer key" is the deployer's key, which the route trusts by design, and the collateral is a faucet token. The full table is in the [README](../README.md#whats-real-and-whats-simulated).
