#!/usr/bin/env node
/**
 * Fill the live-proof section of README.md from deployments/arc-studionet.json,
 * so no transaction hash in the README is ever typed by hand.
 *
 *   node scripts/readme_proof.mjs
 *
 * Replaces everything between <!-- proof:start --> and <!-- proof:end -->.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { loadDeployment, ROOT } from "./lib/chain.mjs";

const dep = await loadDeployment();
const arc = JSON.parse(readFileSync(new URL("deployments/arc-studionet.json", ROOT), "utf8"));
const link = (h, text = `${h.slice(0, 10)}…`) => `[\`${text}\`](${dep.explorerUrl}/tx/${h})`;

const KEY = {
  A: ["approve_work", "settle"],
  B: ["adjudicate", "settle"],
  C: ["adjudicate", "recover_escrow"],
  D: ["cancel_mandate"],
  E: ["lapse_mandate", "recover_escrow"],
  F: ["appeal", "adjudicate", "settle"],
  G: ["claim_unreviewed_delivery", "settle"],
  H: ["cancel_mandate"],
};

const rows = arc.scenarios.map((s) => {
  const wanted = KEY[s.code] ?? [];
  const seen = new Set();
  const links = [];
  for (const step of s.steps) {
    if (wanted.includes(step.fn) && !(step.fn === "adjudicate" && seen.has("adjudicate") && s.code !== "F")) {
      links.push(`${step.fn} ${link(step.hash)}`);
      seen.add(step.fn);
    }
  }
  return `| ${s.code} | ${s.title} | \`${s.mandate}\` | ${s.outcome} | ${s.walls.length} | ${links.join(" · ")} |`;
});

const block = [
  "<!-- proof:start -->",
  `Run \`node scripts/arc.mjs\` on ${arc.ranAt.slice(0, 10)} against \`${arc.contract}\` (${arc.revision}): **${arc.checks.passed}/${arc.checks.total} checks passed**, ${arc.scenarios.length} scenarios, ${arc.seconds}s, every hash a real StudioNet transaction.`,
  "",
  "| | Scenario | Mandate | Outcome | Refusals | Key transactions |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  `Every step and every refusal, with explorer links: [docs/LIVE_PROOF.md](docs/LIVE_PROOF.md). Machine record: [deployments/arc-studionet.json](deployments/arc-studionet.json). Re-check it keylessly with \`npm run verify:arc\`.`,
  "<!-- proof:end -->",
].join("\n");

const path = new URL("README.md", ROOT);
const text = readFileSync(path, "utf8");
const next = text.replace(/<!-- proof:start -->[\s\S]*<!-- proof:end -->/, block);
if (next === text && !text.includes("<!-- proof:start -->")) {
  console.error("README.md has no <!-- proof:start --> marker");
  process.exit(1);
}
writeFileSync(path, next);
console.log(`README proof section updated (${rows.length} scenarios)`);
