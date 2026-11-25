## Noether: a conservation law for cross-chain value, enforced by Reactive

> **Every token delivered on one chain must have been dispatched, exactly once, on the other.**
> When that law breaks, Noether freezes the route on every chain, live on testnet in about 2 seconds, with no bot, server or keeper.

**Demo video (2 min, uncut live attack):** https://youtu.be/gzgNm0AnIUc

**Live Observatory:** https://noether-ashy.vercel.app · **Code:** https://github.com/s70239176-ctrl/noether · **On-chain evidence:** [LIVE_EVIDENCE.md](https://github.com/s70239176-ctrl/noether/blob/main/docs/LIVE_EVIDENCE.md)

Tracks: **Every Second Counts** (primary) and **Reactive Meets AI**

---

### The problem

The largest bridge hacks share one shape: **one chain accepted a mint or a release that nothing on the other chain backed.**

| Bridge | Year | Loss (as widely reported) | What the other chain never had |
|---|---|---|---|
| Ronin | 2022 | ~$625M | a burn behind the withdrawals |
| Wormhole | 2022 | ~$326M | a lock behind ~120k minted wETH |
| Nomad | 2022 | ~$190M | a proof behind the releases |
| Multichain | 2023 | ~$126M | a burn behind the withdrawals |
| Harmony | 2022 | ~$100M | a burn behind the withdrawals |

Each chain saw a transaction that looked valid, because the relayer key or the verifier said so. **No single chain can see that the books don't balance**, since each chain sees only its own half of the ledger. Users whose bridged tokens are IOUs backed by collateral on another chain lose everything the moment unbacked IOUs are minted.

### How it works

Noether is a **reactive contract on Reactive Lasna** that sees both halves of a **real Hyperlane Warp Route** (Base Sepolia ↔ Unichain Sepolia).

1. **Subscribe.** Through Reactive's system contract, Noether subscribes to Hyperlane's live `Mailbox.Dispatch` on Base (filtered to the route's router) and to Noether's guard (`NoetherIsm.Inbound`) on Unichain.
2. **Keep the books.** Every matching event triggers `react()`, which keeps a double-entry ledger keyed by **Hyperlane message id**, which is identical on both chains. Every delivery must match exactly one dispatch.
3. **Score.** A delivery with no dispatch behind it goes to a **6-8-1 neural network running inside `react()`** (integer fixed point, ~35k gas). It decides whether this is an honest out-of-order race or a forgery.
4. **Act.** On a violation, **one reactive transaction** sends conditional callbacks to every chain at once:
   - freeze the route on Base and Unichain,
   - quarantine the recipient,
   - close cover sales and start the payout loop,
   - subscribe to the attacker's transfers (taint tracing).

| Rung | Trigger | What Noether does |
|---|---|---|
| **Suspect** | delivery with no dispatch seen yet | quarantine recipient, hold releases, pause cover sales, **subscribe to Cron1 inside `react()`** |
| **Neural** | same reaction, p ≥ 0.95 | skip the grace window: freeze now |
| **Cleared** | matching dispatch arrives in time | lift holds, **unsubscribe Cron1** |
| **Violation** | duplicate, mismatch or grace timeout | freeze every chain + cover, quarantine, **trace the attacker's transfers** |

Noether doesn't trust the bridge's security module. **It audits the bridge's results.**

### Live results (testnet, every transaction linked)

**Benchmark:** 26 forged mints froze both routes in **26/26** at **+2 s p50, +3 s p95** (block timestamps). 26/26 copycats were rejected, and **0 of 39** honest transfers were frozen by mistake. [Every run](https://github.com/s70239176-ctrl/noether/blob/main/deployments/bench/BENCH.md) · [5-minute judge guide](https://github.com/s70239176-ctrl/noether/blob/main/docs/JUDGE.md)


- **Honest transfer:** 1,000 dUSD from Base to Unichain. Matched by message id, zero callbacks, the ledger stays NORMAL.
- **Forged 1,000,000 mint** with a compromised relayer key, **accepted by Hyperlane's real Mailbox**. Noether decided in the **same second**, and **both chains were frozen in 1 to 2 seconds**. Cover policies were paid automatically in 3 s with no claims filed. A copycat message was then rejected by the frozen ISM.
- **5 recorded live runs** before the benchmark, including a run on a **stock Hyperlane route protected with one command**: Base was frozen in 1 s and Unichain in 2 s.
- **Measured cost:** ≈0.0145 REACT per honest reaction (≈29 REACT per 1,000 transfers), and ≈0.043 REACT to stop an attack.

### Key features

- **Enforce mode:** the conservation law with automatic, cross-chain freezes. It's surgical: honest holders keep transferring, and only inbound minting, bridging out and the accounts involved stop. Noether never moves user funds and never unfreezes anything itself; resolution is a governance step.
- **Protect an existing route in one command** (`script/protect.sh`). `NoetherGuardFactory` wraps the route's current ISM and adds the freeze. A stock route was protected in about 2 minutes.
- **Monitor mode (zero integration):** `NoetherMonitor` audits **any** Hyperlane route from its public router events, and is live today on a third-party route from Hyperlane's registry.
- **Taint tracing:** if the attacker moves funds before the quarantine lands, Noether subscribes to the new recipient's transfers inside `react()` (up to 3 hops and 16 addresses).
- **Cover that can't be front-run:** parametric cover triggered by a violation proven from raw events. Sales pause at the Suspect rung, and any policy bought at or after the forged delivery's timestamp is excluded. Payouts run through a **self-continuing reactive loop** (`PayoutBatch` ⇄ `settleBatch`).
- **On-chain AI that can only make Noether faster:** the scorer can skip the grace window but can never clear a suspect or lift a freeze. Weights are reproducible (`model/train.py`, seed 7), and Solidity matches Python bit for bit.
- **The Observatory:** a live dashboard reading all three chains, with a live message map, an incident dossier rebuilt from on-chain timestamps, the cover pool and an interactive neural scorer. The hosted site is watch-only; the local operator console runs the attacks.

### Reactive Omni resources used

| Resource | How Noether uses it |
|---|---|
| **System contract** `0x8888…8888` | `subscribe`, `unsubscribe` and `requestCallbackV_1_0` |
| **Multi-origin, topic-filtered subscriptions** | Base Mailbox `Dispatch` (topic1 = router) and Unichain `NoetherIsm.Inbound` |
| **Dynamic subscriptions inside `react()`** | a Cron1 clock that runs **only while something is suspicious**, plus taint tracing on attacker `Transfer`s |
| **Conditional multi-destination callbacks** | one reaction → 4 callbacks → 2 chains, via callback proxies (Base `0x476F…3585`, Unichain `0x775c…66C1`) |
| **Self-continuing reactive loop** | cover payouts settle themselves batch by batch |
| **REACT economy** | the funded ledger and `coverDebt()`; destinations hold ETH for callback fees |
| **~1 s blocks on Lasna** | the decision lands in the same second as the forged mint |

The worst-case `react()` (violation, 2 spokes, taint, neural pass) measures **~416k gas** against Omni's 900k cap.

### Tech stack

- **Contracts:** Solidity, Foundry, `reactive-lib-omni`, and Hyperlane `@hyperlane-xyz/core@12.2.0`: real `Mailbox`, `HypERC20Collateral`, `HypERC20`, `TrustedRelayerIsm` and `MerkleTreeHook`.
- **Chains:** Reactive Lasna (5318007), Base Sepolia (84532), Unichain Sepolia (1301), using Hyperlane's live v3 Mailboxes.
- **AI:** a Python/NumPy training script producing an integer-quantised 6-8-1 MLP, executed on-chain in `react()`.
- **Frontend:** React 18, Vite, TypeScript and viem, with a Node operator server (key kept server-side, NDJSON action streaming). The hosted watch-only site runs on Vercel behind a read-only RPC proxy.
- **Tests:** **44 Foundry tests on Hyperlane's real contracts**, with a mocked Reactive system contract. They include golden vectors matching Python bit for bit and a gas-cap check.

### Deployed contracts

| Contract | Chain | Address |
|---|---|---|
| Noether ledger (reactive) | Reactive Lasna | `0x2466B17F7D7427A403050A18021a03F5497bf011` |
| Noether monitor (reactive) | Reactive Lasna | `0xf98333e03335476B13f967244ce74dD75187D006` |
| Warp route router (collateral) | Base Sepolia | `0xf98333e03335476B13f967244ce74dD75187D006` |
| Noether guard | Base Sepolia | `0xEbc5cf1D4B157071f1F210A2A44be22aD6d9a329` |
| Cover pool | Base Sepolia | `0x6ebc6c11F13fd70eCc369a6798a334D89AACB869` |
| Warp route (synthetic) | Unichain Sepolia | `0xEbc5cf1D4B157071f1F210A2A44be22aD6d9a329` |
| Noether guard (ISM) | Unichain Sepolia | `0x9e8046A7eca570d7D05526622c81ddE22aAE04Dd` |

### Hackathon requirements

- **Live on Reactive testnet** with real cross-chain callbacks. Every reaction and callback is an on-chain transaction, linked in [LIVE_EVIDENCE.md](https://github.com/s70239176-ctrl/noether/blob/main/docs/LIVE_EVIDENCE.md).
- **Demo video:** https://youtu.be/gzgNm0AnIUc (2 minutes, including an uncut live attack on the testnets).
- **Open source:** MIT licensed, with a deploy guide, a 5-minute verification path, and an honest "what's real vs simulated" table in the README.
- **Built during the buildathon window**, starting 2026-11-18. An AI coding assistant helped write code, tests and docs under the author's direction; every live claim is backed by a linked transaction.

**Honest limits:**
- The demo's "compromised relayer" is the deployer's own key, which the route trusts by design.
- A forged mint can't be un-minted. Noether stops further damage within ~2 s, and a DEX sale inside that window is out of scope.
- The freeze is as fast as Reactive's callback delivery: 1–2 s in our runs, though one testnet-wide stall delayed it (documented in the evidence file).
