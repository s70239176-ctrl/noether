// Contract ABIs shared by the operator server (server.mjs) and the browser app.
// Event signatures match src/ in this repo and Hyperlane's Mailbox (VERSION 3).
import { parseAbi } from "viem";

export const ledgerAbi = parseAbi([
  "function mode() view returns (uint8)",
  "function lockedTotal() view returns (uint256)",
  "function releasedTotal() view returns (uint256)",
  "function mintedTotal() view returns (uint256)",
  "function burnedTotal() view returns (uint256)",
  "function escrowed() view returns (uint256)",
  "function circulating() view returns (uint256)",
  "function clockOn() view returns (bool)",
  "function openSuspectCount() view returns (uint256)",
  "function taintedCount() view returns (uint256)",
  "function incidentCount() view returns (uint256)",
  "function activeIncident() view returns (bytes32)",
  "function graceBlocks() view returns (uint256)",
  "function owner() view returns (address)",
  "function resolveIncident()",
  "event Accounted(bytes32 indexed messageId, uint256 indexed chainId, bool inbound, uint256 escrowed, uint256 circulating)",
  "event SuspectRaised(bytes32 indexed id, uint8 kind, uint256 chainId, uint256 origin, address account, uint256 amount, int256 logit, uint256 probabilityBps, uint256 deadline)",
  "event SuspectCleared(bytes32 indexed id, uint256 lasnaBlocksWaited)",
  "event ConservationBroken(bytes32 indexed incidentId, uint8 reason, uint256 chainId, uint256 originTxHash, address account, uint256 amount, uint256 escrowed, uint256 circulating)",
  "event ViolationWhileBreached(bytes32 indexed id, uint8 reason, uint256 chainId, uint256 originTxHash)",
  "event ModeChanged(uint8 from, uint8 to)",
  "event ClockSwitched(bool on)",
  "event TaintTraced(address indexed from, address indexed to, uint256 amount, uint8 depth, uint256 chainId)",
  "event PayoutContinued(bytes32 indexed incidentId, uint256 nextIndex, uint256 remaining)",
  "event CallbackSent(uint256 indexed chainId, address indexed target, bytes4 selector)",
  "event IncidentResolved(bytes32 indexed incidentId, address by)",
]);

export const guardAbi = parseAbi([
  "function frozen() view returns (bool)",
  "function held() view returns (bool)",
  "function quarantined(address) view returns (bool)",
  "function noether() view returns (address)",
  "function resolve()",
  "function clearQuarantine(address)",
  "event Inbound(bytes32 indexed id, uint32 indexed origin, bytes32 indexed tokenRecipient, uint256 amount, uint256 timestamp)",
  "event GuardHeld(bytes32 indexed incidentId, uint256 originTxHash, uint256 originTimestamp, uint256 landedAt)",
  "event GuardLifted(bytes32 indexed incidentId, uint256 landedAt)",
  "event GuardFrozen(bytes32 indexed incidentId, uint8 reason, uint256 originTxHash, uint256 originTimestamp, uint256 landedAt)",
  "event AccountQuarantine(bytes32 indexed incidentId, address indexed account, uint256 originTimestamp, uint256 landedAt)",
  "event AccountReleased(bytes32 indexed incidentId, address indexed account)",
  "event GuardResolved(address indexed guardian)",
]);

export const coverAbi = parseAbi([
  "function capital() view returns (uint256)",
  "function outstandingCover() view returns (uint256)",
  "function totalPaid() view returns (uint256)",
  "function nextPolicyId() view returns (uint256)",
  "function premiumFor(uint256) pure returns (uint256)",
  "function buyCover(uint256) payable returns (uint256)",
  "event CoverBought(uint256 indexed policyId, address indexed holder, uint256 amount, uint256 premium, uint256 expiry)",
  "event PayoutOpened(bytes32 indexed incidentId, uint256 incidentTimestamp, uint256 ratioWad, uint256 policies)",
  "event PolicyPaid(uint256 indexed policyId, address indexed holder, uint256 payout, uint256 boughtAt, uint256 incidentTimestamp)",
  "event PolicyExcluded(uint256 indexed policyId, address indexed holder, uint8 why, uint256 boughtAt)",
  "event PayoutCompleted(bytes32 indexed incidentId, uint256 totalPaid)",
  "event PayoutBatch(bytes32 indexed incidentId, uint256 nextIndex, uint256 remaining)",
]);

export const mailboxAbi = parseAbi([
  "function process(bytes metadata, bytes message) payable",
  "event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)",
]);

export const routerAbi = parseAbi([
  "function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32)",
  "function quoteGasPayment(uint32 destination) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function faucet()",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

export const REASONS = [
  "NONE",
  "UNBACKED_MINT",
  "MINT_REPLAY",
  "MINT_MISMATCH",
  "UNBACKED_RELEASE",
  "RELEASE_REPLAY",
  "RELEASE_MISMATCH",
  "NEURAL_ESCALATION",
];

export const MODES = ["NORMAL", "ALERT", "BREACHED"];

/** Hand-built Hyperlane v3 warp-route message (what a compromised trusted-relayer key submits). */
export function forgeMessage({ nonce, origin, sender, destination, recipient, to, amount }) {
  const hex = (n, bytes) => BigInt(n).toString(16).padStart(bytes * 2, "0");
  const b32 = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return ("0x" + hex(3, 1) + hex(nonce, 4) + hex(origin, 4) + b32(sender) + hex(destination, 4) + b32(recipient) + b32(to) + hex(amount, 32));
}

/** Demo attacker and the address a taint hop would go to. */
export const ATTACKER = "0x00000000000000000000000000000000000bad01"; // lowercase: viem rejects a bad checksum

export const monitorAbi = parseAbi([
  "struct Route { string name; uint64 chainA; uint64 chainB; address routerA; address routerB; uint256 escrowed; uint256 circulating; uint64 matched; uint64 unexplained; uint64 unbacked; uint64 watchedAt; }",
  "function routeCount() view returns (uint256)",
  "function route(uint256 id) view returns (Route)",
  "function openCount() view returns (uint256)",
  "function clockOn() view returns (bool)",
  "event RouteWatched(uint256 indexed routeId, string name, uint256 chainA, address routerA, uint256 chainB, address routerB, uint256 openEscrow, uint256 openSupply)",
  "event TransferSent(uint256 indexed routeId, uint256 indexed fromChain, uint256 toChain, bytes32 recipient, uint256 amount, uint256 txHash)",
  "event TransferMatched(uint256 indexed routeId, uint256 indexed onChain, bytes32 recipient, uint256 amount, uint256 txHash, uint256 escrowed, uint256 circulating)",
  "event UnexplainedDelivery(uint256 indexed routeId, bytes32 indexed key, uint256 onChain, bytes32 recipient, uint256 amount, uint256 txHash, uint256 deadline)",
  "event DeliveryExplained(uint256 indexed routeId, bytes32 indexed key, uint256 lasnaBlocksWaited)",
  "event UnbackedDelivery(uint256 indexed routeId, bytes32 indexed key, uint256 onChain, bytes32 recipient, uint256 amount, uint256 originTxHash, uint256 escrowed, uint256 circulating)",
]);
