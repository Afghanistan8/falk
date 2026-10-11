#!/usr/bin/env node
/**
 * Local test wallet for driving the real UI end to end without MetaMask.
 *
 *   node scripts/dev_wallet.mjs            # starts the signer on http://127.0.0.1:3099
 *
 * It holds throw-away keys (derived from .arc/seed, never printed, gitignored)
 * and signs on request. Open the app, then in the browser console run the
 * snippet served at http://127.0.0.1:3099/inject.js to install a window.ethereum
 * that forwards signing to this process. Test accounts are funded from the
 * active `genlayer` CLI account on first use.
 *
 * This is a development tool. The web app itself never touches keys.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { studionet } from "genlayer-js/chains";

import { loadDeployment, ROOT, rpc } from "./lib/chain.mjs";

const dep = await loadDeployment();
mkdirSync(new URL(".arc/", ROOT), { recursive: true });
const seedPath = new URL(".arc/seed", ROOT);
if (!existsSync(seedPath)) writeFileSync(seedPath, randomBytes(32).toString("hex"));
const SEED = readFileSync(seedPath, "utf8").trim();

const NAMES = ["client", "operator", "stranger"];
const accounts = NAMES.map((n) => privateKeyToAccount(`0x${createHash("sha256").update(`${SEED}:devwallet:${n}`).digest("hex")}`));
const clients = accounts.map((account) => createWalletClient({ account, chain: studionet, transport: http(dep.rpcUrl) }));

for (const a of accounts) {
  const bal = BigInt(await rpc(dep.rpcUrl, "eth_getBalance", [a.address, "latest"]));
  if (bal < 5n * 10n ** 18n) {
    const r = spawnSync("genlayer", ["account", "send", a.address, "12gen"], { shell: true, encoding: "utf8" });
    if (r.status !== 0) console.error(`funding ${a.address} failed`);
  }
}

const INJECT = (names, addrs) => `
(() => {
  const accounts = ${JSON.stringify(addrs)};
  const names = ${JSON.stringify(names)};
  let current = 0;
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  const call = async (path, body) => (await fetch("http://127.0.0.1:3099" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  window.ethereum = {
    isDevWallet: true,
    on: (e, f) => { (listeners[e] ||= []).push(f); },
    removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
    request: async ({ method, params = [] }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [accounts[current]];
      if (method === "eth_chainId") return "0xf22f";
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") {
        const r = await call("/send", { index: current, tx: params[0] });
        if (r.error) { const e = new Error(r.error); e.code = r.error.includes("denied") ? 4001 : -32000; throw e; }
        return r.hash;
      }
      const r = await call("/rpc", { method, params });
      if (r.error) throw new Error(JSON.stringify(r.error));
      return r.result;
    },
  };
  window.__devWallet = { names, accounts, use(i) { current = i; emit("accountsChanged", [accounts[current]]); return accounts[current]; } };
  console.log("dev wallet installed", names.map((n, i) => n + "=" + accounts[i]).join(" "));
})();
`;

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const reply = (res, code, body, type = "application/json") => {
  res.writeHead(code, { ...cors, "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return reply(res, 204, "");
  if (req.url === "/inject.js") return reply(res, 200, INJECT(NAMES, accounts.map((a) => a.address)), "text/javascript");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/send") {
      const t = body.tx;
      const hash = await clients[body.index].sendTransaction({
        to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined,
        ...(t.gas ? { gas: BigInt(t.gas) } : {}),
      });
      return reply(res, 200, { hash });
    }
    if (req.url === "/rpc") return reply(res, 200, { result: await rpc(dep.rpcUrl, body.method, body.params) });
    return reply(res, 404, { error: "not found" });
  } catch (e) {
    return reply(res, 200, { error: String(e?.shortMessage || e?.message || e).slice(0, 400) });
  }
}).listen(3099, "127.0.0.1", () => {
  console.log("dev wallet on http://127.0.0.1:3099");
  NAMES.forEach((n, i) => console.log(`  ${i} ${n.padEnd(9)} ${accounts[i].address}`));
});
