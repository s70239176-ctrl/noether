#!/usr/bin/env bash
# Protect an existing Hyperlane Warp Route with Noether (Enforce mode), in one command.
#
#   HOME_ROUTER=0x... HOME_RPC=https://... SPOKE_ROUTER=0x... SPOKE_RPC=https://... bash script/protect.sh
#
#   HOME_*   the collateral side of the route (where value is escrowed)
#   SPOKE_*  the synthetic side
# Optional: GUARDIAN (default: the signer), COVER (a NoetherCover, default: none), GRACE_BLOCKS (default 5),
#           GUARD_FUNDING (ETH per guard, default 0.003), LEDGER_FUNDING (REACT, default 1), OUT_FILE.
#
# What it does:
#   1. Each chain: a NoetherIsm wrapping the route's CURRENT ISM, so verification is unchanged (one factory call).
#   2. Lasna: a NoetherLedger subscribed to both sides of the route.
#   3. Wiring: guards trust the ledger; routers point at their guards. If you don't own the routers (a multisig
#      does), the script prints the exact calls to submit instead of sending them.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source "${ENV_FILE:-.env}"; set +a
: "${HOME_ROUTER:?set HOME_ROUTER}" "${SPOKE_ROUTER:?set SPOKE_ROUTER}" "${HOME_RPC:?set HOME_RPC}" "${SPOKE_RPC:?set SPOKE_RPC}"
export OUT_FILE=${OUT_FILE:-deployments/protected-route.env}
mkdir -p deployments
: > "$OUT_FILE"
FLAGS=(--broadcast --slow ${FORGE_FLAGS:-})
export FOUNDRY_ETH_RPC_TIMEOUT=60
LASNA_FLAGS=(--broadcast --slow --legacy --with-gas-price "${LASNA_GAS_PRICE:-150gwei}")
START=$(date +%s)
step() { echo; echo "==> [$(( $(date +%s) - START ))s] $*"; }
reload() { set -a; source "$OUT_FILE"; set +a; }
# Public testnet RPCs drop connections; retry each step (a forge script that failed before broadcasting is safe to rerun).
retry() { for i in 1 2 3 4; do if "$@"; then return 0; fi; echo "   (network hiccup, retry $i)"; sleep 12; done; return 1; }

step "1/3 guards wrapping the route's current ISM"
ROUTER=$HOME_ROUTER COLLATERAL_SIDE=true LABEL=HOME retry forge script script/Protect.s.sol:ProtectGuard --rpc-url "$HOME_RPC" "${FLAGS[@]}" >/dev/null
ROUTER=$SPOKE_ROUTER COLLATERAL_SIDE=false LABEL=SPOKE retry forge script script/Protect.s.sol:ProtectGuard --rpc-url "$SPOKE_RPC" "${FLAGS[@]}" >/dev/null
reload
echo "   home guard $HOME_GUARD wraps ISM $HOME_INNER_ISM"
echo "   spoke guard $SPOKE_GUARD wraps ISM $SPOKE_INNER_ISM"

step "2/3 ledger on Reactive Lasna"
retry forge script script/Protect.s.sol:ProtectLedger --rpc-url "$LASNA_RPC" "${LASNA_FLAGS[@]}" >/dev/null
reload
echo "   ledger $LEDGER"

step "3/3 wiring"
GUARD=$HOME_GUARD ROUTER=$HOME_ROUTER retry forge script script/Protect.s.sol:ProtectWire --rpc-url "$HOME_RPC" "${FLAGS[@]}" 2>&1 | grep -E "must call|router\.|guard\.|calldata|0x" | grep -v "^Script" || true
GUARD=$SPOKE_GUARD ROUTER=$SPOKE_ROUTER retry forge script script/Protect.s.sol:ProtectWire --rpc-url "$SPOKE_RPC" "${FLAGS[@]}" 2>&1 | grep -E "must call|router\.|guard\.|calldata|0x" | grep -v "^Script" || true

step "done"
cat "$OUT_FILE"
