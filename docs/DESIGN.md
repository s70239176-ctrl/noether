# Noether: design

## 1. The invariant

A Hyperlane Warp Route moves tokens as Hyperlane messages. Each message has an id, `keccak256(message)`, that is identical on the origin and destination chains. A correct route keeps this per message:

| Destination event | Must match | Keyed by |
|---|---|---|
| `NoetherIsm.Inbound(id, origin, to, amount)` on a spoke (a mint) | exactly one `Mailbox.Dispatch` from the home router with the same id, destination, recipient and amount | Hyperlane message id |
| `NoetherIsm.Inbound(id, origin, to, amount)` on home (a release) | exactly one `Mailbox.Dispatch` from that spoke's router | Hyperlane message id |

In aggregate this gives `circulating (minted − burned) ≤ escrowed (locked − released)`, which the ledger also tracks and reports.

A **violation** means the route's security module accepted something it shouldn't have:
- `UNBACKED_MINT` / `UNBACKED_RELEASE`: no dispatch appears within the grace window
- `MINT_REPLAY` / `RELEASE_REPLAY`: the same id is delivered twice (Hyperlane's Mailbox already prevents this; kept as defence in depth)
- `MINT_MISMATCH` / `RELEASE_MISMATCH`: decoded fields differ from the dispatch
- `NEURAL_ESCALATION`: the scorer is confident enough that waiting is pointless

## 2. Where the events come from

- **`Dispatch`**, Hyperlane's own `Mailbox` event: `Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)`. Noether subscribes with `topic1 = router` and recomputes the id, destination, token recipient and amount from the raw message bytes (`Message.sol` header offsets 41 and 77, then `TokenMessage` recipient and amount).
- **`Inbound`**, emitted by `NoetherIsm.verify`, which `Mailbox.process` calls after recording the processor and before `handle`. Only the Mailbox can call `verify` (`OnlyMailbox`), so the event can't be faked. If `handle` reverts, the log reverts with it.

## 3. State machine (NoetherLedger)

```
            suspect raised                    last suspect cleared
  NORMAL ───────────────────▶ ALERT ─────────────────────────────▶ NORMAL
     │                          │
     │  replay / mismatch /     │  grace timeout (Cron1) / neural escalation /
     │  neural escalation       │  replay / mismatch
     ▼                          ▼
   BREACHED ◀───────────────────┘
     │
     └── resolveIncident() by owner (after each guard is resolved by its guardian) ──▶ NORMAL
```

## 4. Event flows

### 4.1 Normal protection (honest warp transfer)
1. Base: user `HypERC20Collateral.transferRemote(1301, alice, 1000)` → collateral escrowed → `Mailbox.Dispatch(router, 1301, spokeRouter, msg)`
2. Lasna: `react()` → `messages[id] = DISPATCHED`, `lockedTotal += 1000`. No callbacks.
3. Unichain: the relayer calls `Mailbox.process("", msg)` → `NoetherIsm.verify` passes (not frozen, inner `TrustedRelayerIsm` ok) → `Inbound(id, 84532, alice, 1000, ts)` → `HypERC20` mints
4. Lasna: `react()` → id matches → `DELIVERED`. No callbacks.

### 4.2 Failure detection (honest race, cleared)
1. The Unichain `Inbound` reaches Lasna before the Base `Dispatch` → `_raise` → scorer below threshold → `SuspectRaised`
   - callbacks: `quarantine(alice)` → Unichain guard; `hold` → Base guard (releases paused) and cover (sales paused)
   - `SYSTEM.subscribe(lasna, 0x…fffFfF, Cron1)`: the clock switched on from inside `react()`
2. The Base `Dispatch` arrives within `GRACE_BLOCKS` and matches → `_clear` → unquarantine, lift ×2, unsubscribe `Cron1`

### 4.3 Violation (compromised relayer key, neural fast path)
1. Unichain: the key submits a hand-built message "from" the home router → the real Mailbox and `TrustedRelayerIsm` accept it → `Inbound(id', …, attacker, 1e24)` → `HypERC20` mints
2. Lasna, **one reactive transaction**: no dispatch for `id'` → `_raise` → logit ≥ threshold → `_violate(NEURAL_ESCALATION)`:
   - `freeze` → Base guard, cover, Unichain guard (and every other spoke)
   - `quarantine(attacker)` → Unichain guard
   - `SYSTEM.subscribe(1301, spokeRouter, Transfer, from = attacker)`: dynamic taint subscription
   - `ConservationBroken(id', reason, chain, originTx, attacker, amount, escrowed, circulating)`
3. Base: `Cover._onFreeze` → `PayoutOpened`, `PayoutBatch(id', 1, n)`
4. Lasna: `react(PayoutBatch)` → `settleBatch(20)` → … → `PayoutCompleted`
5. Afterwards every forged `process` fails with `Mailbox: ISM verification failed`, the attacker can't transfer, and nobody can bridge out until governance resolves.

### 4.4 Violation (low-score forgery, deterministic path)
Same as 4.2 step 1, but nothing backs it. On the first `Cron1` tick past the deadline → `_violate(UNBACKED_MINT)` → as 4.3 step 2.

### 4.5 Drained collateral (Nomad shape)
A forged message "from" the spoke router to the home router releases real collateral. The first one lands; Noether freezes the Base guard; every copycat is rejected by the ISM.

## 5. Trust and authentication

- `react()` is `onlySystem` (caller is `0x8888…8888`).
- Guard callbacks require both `msg.sender == callbackProxy` and that the injected first argument equals the ledger.
- `NoetherIsm.verify` is callable only by its Mailbox.
- Noether never unfreezes. `resolve()` is guardian-only on each guard; `resolveIncident()` is owner-only on the ledger.
- Noether does not trust the route's inner ISM or relayer. That is the point.

## 6. Gas and economics

| Path | Measured |
|---|---|
| worst-case `react()` (violation, 2 spokes, taint, neural) | ~416k gas (cap 900k) |
| scorer forward pass | ~35k gas |
| callback gas limits | 400k guard calls, 2M `settleBatch` (20 policies) |
| Hyperlane dispatch fee with `MerkleTreeHook` | 0 wei on Base Sepolia, 1 wei on Unichain Sepolia (quoted on-chain 2026-11-19) |

The cron clock costs REACT every block, so it is subscribed only while a suspect is open. The `Dispatch` subscriptions are filtered to the route's router, so other apps' traffic on the shared Mailboxes costs nothing.

## 7. Threat model

| Attack | Real precedent | Caught by |
|---|---|---|
| relayer/validator key compromise → unbacked mint | Ronin, Harmony, Multichain | `UNBACKED_MINT` (grace) or `NEURAL_ESCALATION` (instant) |
| verification bypass → unbacked mint | Wormhole | same; Noether doesn't depend on the ISM being right |
| release with no burn, then copycats | Nomad | `UNBACKED_RELEASE`; the home freeze stops the copycats |
| replay of a delivered message | Nomad copycats | Hyperlane `delivered[id]`, plus `*_REPLAY` |
| buying cover after seeing the hack | adverse selection in cover markets | hold at the Suspect rung + timestamp eligibility |
| moving stolen funds before quarantine lands | laundering | taint tracing via dynamic subscriptions |

Out of scope: a DEX sale in the ~2 s before quarantine lands; attacks on Reactive's own validators; a compromised Noether owner or guardian (use a multisig).

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| An honest race looks unbacked | grace window plus automatic clearing; the scorer threshold is high |
| The scorer freezes an honest delivery | 0.10% on synthetic data; human resolution; the model can't weaken deterministic checks |
| The ledger runs out of REACT | fund generously; `coverDebt()`; `SYSTEM.debt(ledger)` is visible |
| The payout loop stalls | permissionless `settleNext`; `owed` pull fallback |
| Taint list exhaustion | caps of 16 addresses and 3 hops; the freeze holds regardless |
| Router initialization front-run | init right after deploy; use a proxy with atomic init in production |
