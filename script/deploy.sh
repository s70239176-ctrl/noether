#!/usr/bin/env bash
# Deploys Noether on a Hyperlane Warp Route across Base Sepolia (collateral), Unichain Sepolia
# (synthetic) and Reactive Lasna (ledger), enrolls the routers, wires callback trust, seeds cover.
# Addresses land in deployments/testnet.env.
#
#   cp .env.example .env   # PRIVATE_KEY + RPCs
#   bash script/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source "${ENV_FILE:-.env}"; set +a

OUT=${OUT_FILE:-deployments/testnet.env}
mkdir -p deployments
: > "$OUT"

run() { echo; echo "==> $*"; "$@"; }
reload() { set -a; source "$OUT"; set +a; }
FLAGS=(--broadcast --slow ${FORGE_FLAGS:-})

# *_OVERRIDE variables exist only for the local rehearsal, where Hyperlane isn't predeployed.
run env ${HOME_MAILBOX_OVERRIDE:+HYPERLANE_MAILBOX=$HOME_MAILBOX_OVERRIDE} ${HOME_HOOK_OVERRIDE:+HYPERLANE_MERKLE_HOOK=$HOME_HOOK_OVERRIDE} \
  forge script script/Deploy.s.sol:DeployHome --rpc-url "$BASE_SEPOLIA_RPC" "${FLAGS[@]}"
run env SPOKE_LABEL=SPOKE_A ${SPOKE_MAILBOX_OVERRIDE:+HYPERLANE_MAILBOX=$SPOKE_MAILBOX_OVERRIDE} ${SPOKE_HOOK_OVERRIDE:+HYPERLANE_MERKLE_HOOK=$SPOKE_HOOK_OVERRIDE} \
  forge script script/Deploy.s.sol:DeploySpoke --rpc-url "$UNICHAIN_SEPOLIA_RPC" "${FLAGS[@]}"
reload

run env LOCAL_ROUTER="$HOME_ROUTER" REMOTE_DOMAIN="$SPOKE_A_CHAIN_ID" REMOTE_ROUTER="$SPOKE_A" \
  forge script script/Deploy.s.sol:Enroll --rpc-url "$BASE_SEPOLIA_RPC" "${FLAGS[@]}"
run env LOCAL_ROUTER="$SPOKE_A" REMOTE_DOMAIN="$HOME_CHAIN_ID" REMOTE_ROUTER="$HOME_ROUTER" \
  forge script script/Deploy.s.sol:Enroll --rpc-url "$UNICHAIN_SEPOLIA_RPC" "${FLAGS[@]}"

run forge script script/Deploy.s.sol:DeployLedger --rpc-url "$LASNA_RPC" "${FLAGS[@]}"
reload

run env TARGETS="$HOME_GUARD,$COVER" forge script script/Deploy.s.sol:Wire --rpc-url "$BASE_SEPOLIA_RPC" "${FLAGS[@]}"
run env TARGETS="$SPOKE_A_GUARD" forge script script/Deploy.s.sol:Wire --rpc-url "$UNICHAIN_SEPOLIA_RPC" "${FLAGS[@]}"
run forge script script/Deploy.s.sol:SeedCover --rpc-url "$BASE_SEPOLIA_RPC" "${FLAGS[@]}"

echo
echo "Deployed. Addresses ($OUT):"
cat "$OUT"
