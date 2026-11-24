#!/usr/bin/env bash
# Deploys NoetherMonitor on Lasna and starts auditing two Hyperlane Warp Routes with zero integration.
# Opening balances are read on-chain right before registration. Appends MONITOR=... to deployments/testnet.env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source "${ENV_FILE:-.env}"; source "${OUT_FILE:-deployments/testnet.env}"; set +a
retry() { for i in 1 2 3 4 5; do if out=$("$@" 2>/dev/null); then echo "$out"; return 0; fi; sleep 3; done; return 1; }
EXT_OPEN_ESCROW=$(retry cast balance 0x1D39722592a8FaB912Aa582416F1f1b21bda2E30 --rpc-url "$BASE_SEPOLIA_RPC")
EXT_OPEN_SUPPLY=$(retry cast call 0x79B42902Ef4D9532d9EB4c1E6e064Cd79Da87B3B "totalSupply()(uint256)" --rpc-url "$SEPOLIA_RPC" | awk '{print $1}')
OWN_OPEN_ESCROW=$(retry cast call "$DUSD" "balanceOf(address)(uint256)" "$HOME_ROUTER" --rpc-url "$BASE_SEPOLIA_RPC" | awk '{print $1}')
OWN_OPEN_SUPPLY=$(retry cast call "$SPOKE_A" "totalSupply()(uint256)" --rpc-url "$UNICHAIN_SEPOLIA_RPC" | awk '{print $1}')
echo "third-party route: escrow $EXT_OPEN_ESCROW, supply $EXT_OPEN_SUPPLY | own route: escrow $OWN_OPEN_ESCROW, supply $OWN_OPEN_SUPPLY"
export EXT_OPEN_ESCROW EXT_OPEN_SUPPLY OWN_OPEN_ESCROW OWN_OPEN_SUPPLY
forge script script/Deploy.s.sol:DeployMonitor --rpc-url "$LASNA_RPC" --broadcast --slow ${FORGE_FLAGS:-}
