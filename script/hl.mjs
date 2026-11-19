#!/usr/bin/env node
// Tiny Hyperlane helper for the demo (Node >= 18, no dependencies).
//
//   node script/hl.mjs msg-from-tx <rpc> <txHash> <mailbox>
//       Prints the Hyperlane message dispatched by <mailbox> in <txHash>. That's what a relayer passes to
//       Mailbox.process on the destination chain.
//
//   node script/hl.mjs forge <origin> <senderRouter> <destination> <recipientRouter> <to> <amountWei> <nonce>
//       Prints a hand-built warp-route message: what a compromised trusted-relayer key submits.
//
// Message layout (Hyperlane Message.sol, version 3):
//   version u8 | nonce u32 | origin u32 | sender b32 | destination u32 | recipient b32 | body
// Warp-route body (TokenMessage.sol): recipient b32 | amount u256

const DISPATCH = "0x769f711d20c679153d382254f59892613b58a97cc876b249134ac25c80f9c814";

const hex = (n, bytes) => BigInt(n).toString(16).padStart(bytes * 2, "0");
const b32 = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function msgFromTx(url, tx, mailbox) {
  for (let i = 0; i < 30; i++) {
    const rc = await rpc(url, "eth_getTransactionReceipt", [tx]);
    if (rc) {
      const log = rc.logs.find((l) => l.address.toLowerCase() === mailbox.toLowerCase() && l.topics[0] === DISPATCH);
      if (!log) throw new Error("no Dispatch from that mailbox in tx");
      const data = log.data.slice(2);
      const len = Number(BigInt("0x" + data.slice(64, 128)));
      return "0x" + data.slice(128, 128 + len * 2);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("receipt not found");
}

function forge(origin, sender, destination, recipient, to, amount, nonce) {
  return "0x" + hex(3, 1) + hex(nonce, 4) + hex(origin, 4) + b32(sender) + hex(destination, 4) + b32(recipient) + b32(to) + hex(amount, 32);
}

const [cmd, ...a] = process.argv.slice(2);
try {
  if (cmd === "msg-from-tx") console.log(await msgFromTx(a[0], a[1], a[2]));
  else if (cmd === "forge") console.log(forge(...a));
  else throw new Error("usage: msg-from-tx <rpc> <tx> <mailbox> | forge <origin> <sender> <dest> <recipient> <to> <amount> <nonce>");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
