#!/usr/bin/env bash
# Local dress rehearsal of the live deployment: three anvil nodes impersonate Base Sepolia, Unichain
# Sepolia and Lasna. Each origin node gets a real Hyperlane Mailbox first (testnets already have one),
# Lasna gets an event-only system contract at 0x8888…8888. Then script/deploy.sh runs unchanged, and
# the honest demo transfers real HypERC20Collateral -> HypERC20 through the local Mailboxes.
# Reactive's event delivery isn't simulated here; `forge test` covers that.
set -euo pipefail
cd "$(dirname "$0")/.."

# The key below is Anvil's well-known default account #0: a public test key for local nodes only.
export ENV_FILE=deployments/rehearsal.env.local
cat > "$ENV_FILE" <<'EOF'
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
BASE_SEPOLIA_RPC=http://127.0.0.1:18545
UNICHAIN_SEPOLIA_RPC=http://127.0.0.1:18546
LASNA_RPC=http://127.0.0.1:18547
EOF
export OUT_FILE=deployments/testnet.local.env
HL_FILE=deployments/hyperlane.local.env
: > "$HL_FILE"

anvil --port 18545 --chain-id 84532 --silent & P1=$!
anvil --port 18546 --chain-id 1301 --silent & P2=$!
anvil --port 18547 --chain-id 5318007 --silent & P3=$!
trap 'kill $P1 $P2 $P3 2>/dev/null || true' EXIT
for p in 18545 18546 18547; do
  for _ in $(seq 1 50); do cast chain-id --rpc-url "http://127.0.0.1:$p" >/dev/null 2>&1 && break; sleep 0.2; done
done
set -a; source "$ENV_FILE"; set +a

forge build --quiet
OUT_FILE=$HL_FILE PREFIX=HOME forge script script/Rehearsal.s.sol:LocalHyperlane --rpc-url "$BASE_SEPOLIA_RPC" --broadcast --quiet
OUT_FILE=$HL_FILE PREFIX=SPOKE forge script script/Rehearsal.s.sol:LocalHyperlane --rpc-url "$UNICHAIN_SEPOLIA_RPC" --broadcast --quiet
set -a; source "$HL_FILE"; set +a
CODE=$(forge inspect test/utils/RehearsalSystem.sol:RehearsalSystem deployedBytecode)
cast rpc anvil_setCode 0x8888888888888888888888888888888888888888 "$CODE" --rpc-url "$LASNA_RPC" >/dev/null

bash script/deploy.sh
set -a; source "$OUT_FILE"; set +a
echo
echo "==> checks"
for t in "$HOME_GUARD:$BASE_SEPOLIA_RPC" "$COVER:$BASE_SEPOLIA_RPC" "$SPOKE_A_GUARD:$UNICHAIN_SEPOLIA_RPC"; do
  n=$(cast call "${t%%:http*}" "noether()(address)" --rpc-url "http${t#*:http}")
  [ "$(cast to-check-sum-address "$n")" = "$(cast to-check-sum-address "$LEDGER")" ] || { echo "wiring failed for ${t%%:http*}"; exit 1; }
done
[ "$(cast call "$HOME_ROUTER" "interchainSecurityModule()(address)" --rpc-url "$BASE_SEPOLIA_RPC")" = "$(cast to-check-sum-address "$HOME_GUARD")" ] || { echo "home ISM not NoetherIsm"; exit 1; }
[ "$(cast call "$SPOKE_A" "interchainSecurityModule()(address)" --rpc-url "$UNICHAIN_SEPOLIA_RPC")" = "$(cast to-check-sum-address "$SPOKE_A_GUARD")" ] || { echo "spoke ISM not NoetherIsm"; exit 1; }
SUBS=$(cast logs --rpc-url "$LASNA_RPC" --address 0x8888888888888888888888888888888888888888 --from-block 0 "Subscribe(address indexed,uint256 indexed,address indexed,uint256)" | grep -c "transactionHash")
echo "guards wired, routers use NoetherIsm, ledger registered $SUBS subscriptions"
bash script/demo.sh honest
BAL=$(cast call "$SPOKE_A" "balanceOf(address)(uint256)" "$(cast wallet address --private-key "$PRIVATE_KEY")" --rpc-url "$UNICHAIN_SEPOLIA_RPC")
echo "synthetic balance on spoke after relay: $BAL"

# The attack path: a message hand-built by script/hl.mjs, submitted by the trusted-relayer key.
EVIL=0x00000000000000000000000000000000000BAD01
MSG=$(node script/hl.mjs forge "$HOME_CHAIN_ID" "$HOME_ROUTER" "$SPOKE_A_CHAIN_ID" "$SPOKE_A" "$EVIL" 1000000000000000000 424242)
cast send "$SPOKE_A_MAILBOX" "process(bytes,bytes)" 0x "$MSG" --rpc-url "$UNICHAIN_SEPOLIA_RPC" --private-key "$PRIVATE_KEY" >/dev/null
FORGED=$(cast call "$SPOKE_A" "balanceOf(address)(uint256)" "$EVIL" --rpc-url "$UNICHAIN_SEPOLIA_RPC")
[ "$FORGED" = "1000000000000000000 [1e18]" ] || { echo "forged message format rejected: $FORGED"; exit 1; }
echo "forged message accepted by the Mailbox (as on testnet, before Noether reacts): attacker holds $FORGED"
echo
echo "Rehearsal OK"
