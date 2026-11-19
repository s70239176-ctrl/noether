#!/usr/bin/env bash
# Noether live demo on a Hyperlane Warp Route. Run after script/deploy.sh.
#
#   bash script/demo.sh honest     # honest Base -> Unichain warp transfer, relayed; Noether stays silent
#   bash script/demo.sh attack     # compromised trusted-relayer key forges a mint; watch every chain freeze
#   bash script/demo.sh drain      # forged release drains collateral on Base; copycats are blocked
#   bash script/demo.sh evidence   # rebuild the whole loop from logs, with tx links and latency
#   bash script/demo.sh resolve    # governance resets the ledger and every guard
#
# PRIVATE_KEY plays every role: user, the route's trusted relayer, and (once that key is "compromised")
# the attacker. Recipients are distinct addresses.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source "${ENV_FILE:-.env}"; source "${OUT_FILE:-deployments/testnet.env}"; set +a

BASE="$BASE_SEPOLIA_RPC"; UNI="$UNICHAIN_SEPOLIA_RPC"; LASNA="$LASNA_RPC"
KEY="$PRIVATE_KEY"
ME=$(cast wallet address --private-key "$KEY")
ATTACKER=${ATTACKER:-0x00000000000000000000000000000000000BAD01}
MODES=(NORMAL ALERT BREACHED)

say()  { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
txh()  { awk '/^transactionHash/ {print $2}'; }
now()  { date +%s; }
mode() { echo "${MODES[$(cast call "$LEDGER" "mode()(uint8)" --rpc-url "$LASNA")]}"; }
pad()  { printf '0x%064s' "$(echo "${1#0x}" | tr 'A-F' 'a-f')" | tr ' ' 0; }

wait_for() { # wait_for <label> <expected> <rpc> <address> <sig> [args...]
  local label=$1 want=$2 rpc=$3 addr=$4 sig=$5; shift 5
  for _ in $(seq 1 60); do
    if [ "$(cast call "$addr" "$sig" "$@" --rpc-url "$rpc")" = "$want" ]; then
      note "$label after $(( $(now) - T0 ))s (wall clock from the forged message)"; return 0
    fi
    sleep 0.5
  done
  note "$label: not observed within 30s, check Reactscan for the Lasna transaction"
}

relay() { # relay <origin rpc> <tx> <origin mailbox> <dest rpc> <dest mailbox>
  local msg; msg=$(node script/hl.mjs msg-from-tx "$1" "$2" "$3")
  cast send "$5" "process(bytes,bytes)" 0x "$msg" --rpc-url "$4" --private-key "$KEY" | txh
}

honest() {
  say "Honest warp transfer: 1,000 dUSD Base Sepolia -> Unichain Sepolia over Hyperlane"
  cast send "$DUSD" "faucet()" --rpc-url "$BASE" --private-key "$KEY" >/dev/null
  cast send "$DUSD" "approve(address,uint256)" "$HOME_ROUTER" "$(cast max-uint)" --rpc-url "$BASE" --private-key "$KEY" >/dev/null
  local amt fee lock mint
  amt=$(cast to-wei 1000)
  fee=$(cast call "$HOME_ROUTER" "quoteGasPayment(uint32)(uint256)" "$SPOKE_A_CHAIN_ID" --rpc-url "$BASE" | awk '{print $1}')
  lock=$(cast send "$HOME_ROUTER" "transferRemote(uint32,bytes32,uint256)" "$SPOKE_A_CHAIN_ID" "$(pad "$ME")" "$amt" --value "$fee" --rpc-url "$BASE" --private-key "$KEY" | txh)
  note "Dispatched on Base:  https://sepolia.basescan.org/tx/$lock"
  mint=$(relay "$BASE" "$lock" "$HOME_MAILBOX" "$UNI" "$SPOKE_A_MAILBOX")
  note "Relayed on Unichain: https://sepolia.uniscan.xyz/tx/$mint"
  sleep 6
  note "Ledger: mode=$(mode) escrowed=$(cast call "$LEDGER" "escrowed()(uint256)" --rpc-url "$LASNA") circulating=$(cast call "$LEDGER" "circulating()(uint256)" --rpc-url "$LASNA")"
}

attack() {
  say "Attack: the route's trusted-relayer key is compromised and forges a 1,000,000 ndUSD mint"
  note "Ledger mode before: $(mode)"
  local forged msg tx cov prem out
  forged=$(cast to-wei 1000000)
  msg=$(node script/hl.mjs forge "$HOME_CHAIN_ID" "$HOME_ROUTER" "$SPOKE_A_CHAIN_ID" "$SPOKE_A" "$ATTACKER" "$forged" "$(( 900000000 + RANDOM ))")
  T0=$(now)
  tx=$(cast send "$SPOKE_A_MAILBOX" "process(bytes,bytes)" 0x "$msg" --rpc-url "$UNI" --private-key "$KEY" | txh)
  note "Forged message accepted by Hyperlane's Mailbox on Unichain: https://sepolia.uniscan.xyz/tx/$tx"
  note "Attacker balance: $(cast call "$SPOKE_A" "balanceOf(address)(uint256)" "$ATTACKER" --rpc-url "$UNI")"

  say "A front-runner tries to buy cover on Base the moment they see it"
  cov=$(cast to-wei 0.001)
  prem=$(cast call "$COVER" "premiumFor(uint256)(uint256)" "$cov" --rpc-url "$BASE" | awk '{print $1}')
  if out=$(cast send "$COVER" "buyCover(uint256)" "$cov" --value "$prem" --rpc-url "$BASE" --private-key "$KEY" 2>&1); then
    note "Bought before the hold landed: $(echo "$out" | txh). It is EXCLUDED from payout (bought at/after the forged mint)."
  else
    note "Rejected: sales already closed"
  fi

  say "Waiting for Noether's callbacks to land"
  wait_for "Unichain guard frozen" true "$UNI" "$SPOKE_A_GUARD" "frozen()(bool)"
  wait_for "Base guard frozen" true "$BASE" "$HOME_GUARD" "frozen()(bool)"
  wait_for "Cover pool triggered" true "$BASE" "$COVER" "frozen()(bool)"
  wait_for "Attacker quarantined" true "$UNI" "$SPOKE_A_GUARD" "quarantined(address)(bool)" "$ATTACKER"
  note "Ledger mode: $(mode)"

  say "The attacker tries again"
  msg=$(node script/hl.mjs forge "$HOME_CHAIN_ID" "$HOME_ROUTER" "$SPOKE_A_CHAIN_ID" "$SPOKE_A" "$ATTACKER" "$forged" "$(( 910000000 + RANDOM ))")
  if cast send "$SPOKE_A_MAILBOX" "process(bytes,bytes)" 0x "$msg" --rpc-url "$UNI" --private-key "$KEY" >/dev/null 2>&1; then
    note "UNEXPECTED: second forged message accepted"
  else
    note "Second forged message rejected: Mailbox: ISM verification failed"
  fi
  note "Run: bash script/demo.sh evidence"
}

drain() {
  say "Attack: forged 'burn' message releases real collateral on Base with nothing burned on Unichain"
  local msg tx amt
  amt=$(cast to-wei 100)
  msg=$(node script/hl.mjs forge "$SPOKE_A_CHAIN_ID" "$SPOKE_A" "$HOME_CHAIN_ID" "$HOME_ROUTER" "$ATTACKER" "$amt" "$(( 920000000 + RANDOM ))")
  T0=$(now)
  tx=$(cast send "$HOME_MAILBOX" "process(bytes,bytes)" 0x "$msg" --rpc-url "$BASE" --private-key "$KEY" | txh)
  note "First drain lands: https://sepolia.basescan.org/tx/$tx"
  wait_for "Base guard frozen" true "$BASE" "$HOME_GUARD" "frozen()(bool)"
  msg=$(node script/hl.mjs forge "$SPOKE_A_CHAIN_ID" "$SPOKE_A" "$HOME_CHAIN_ID" "$HOME_ROUTER" "$ATTACKER" "$amt" "$(( 930000000 + RANDOM ))")
  if cast send "$HOME_MAILBOX" "process(bytes,bytes)" 0x "$msg" --rpc-url "$BASE" --private-key "$KEY" >/dev/null 2>&1; then
    note "UNEXPECTED: copycat drain accepted"
  else
    note "Copycat drain rejected: Mailbox: ISM verification failed"
  fi
}

resolve() {
  say "Governance resolution (humans, after investigation)"
  cast send "$LEDGER" "resolveIncident()" --rpc-url "$LASNA" --private-key "$KEY" >/dev/null && note "Ledger reset, taint subscriptions dropped"
  for pair in "$HOME_GUARD:$BASE" "$COVER:$BASE" "$SPOKE_A_GUARD:$UNI"; do
    cast send "${pair%%:*}" "resolve()" --rpc-url "${pair#*:}" --private-key "$KEY" >/dev/null && note "Resolved ${pair%%:*}"
  done
  cast send "$SPOKE_A_GUARD" "clearQuarantine(address)" "$ATTACKER" --rpc-url "$UNI" --private-key "$KEY" >/dev/null || true
}

case "${1:-}" in
  honest) honest ;;
  attack) attack ;;
  drain) drain ;;
  evidence) node script/evidence.mjs ;;
  resolve) resolve ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
