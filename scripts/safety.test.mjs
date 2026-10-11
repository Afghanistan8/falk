// The safety verifier must fail on a broken contract, not just pass on a good one.
//   node --test scripts/safety.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { analyze, methodsFromSource } from "./verify_safety.mjs";
import { normalizeSource } from "./lib/chain.mjs";

const SRC = normalizeSource(readFileSync(new URL("../contracts/falk.py", import.meta.url), "utf8"));

const run = (src) => analyze(src, methodsFromSource(src));
const failedIds = (src) => run(src).filter((r) => !r.ok).map((r) => r.id);

function mutate(find, replace) {
  assert.ok(SRC.includes(find), `snippet not found: ${find.slice(0, 60)}`);
  assert.equal(SRC.split(find).length - 1, 1, `snippet not unique: ${find.slice(0, 60)}`);
  return SRC.replace(find, replace);
}

test("the repository contract passes all eight checks", () => {
  const r = run(SRC);
  assert.equal(r.length, 8);
  assert.deepEqual(r.filter((x) => !x.ok), []);
});

test("methodsFromSource finds all 31 public methods", () => {
  const m = methodsFromSource(SRC);
  assert.equal(m.length, 31);
  assert.equal(m.filter(([, v]) => v.readonly).length, 11);
});

test("S1 catches a clock method", () => {
  const src = mutate("    @gl.public.view\n    def get_protocol_info(self)", "    @gl.public.write\n    def advance_clock(self, ms: int) -> None:\n        self.version = str(ms)\n\n    @gl.public.view\n    def get_protocol_info(self)");
  assert.ok(failedIds(src).includes("S1"));
});

test("S1 catches a method that takes a recipient and an amount", () => {
  const src = mutate("    @gl.public.view\n    def get_protocol_info(self)", "    @gl.public.write\n    def pay_out(self, recipient: str, amount: int) -> None:\n        self.version = recipient\n\n    @gl.public.view\n    def get_protocol_info(self)");
  assert.ok(failedIds(src).includes("S1"));
});

test("S2 catches an owner field and an admin method", () => {
  assert.ok(failedIds(mutate("    version: str\n    mandates:", "    version: str\n    owner: Address\n    mandates:")).includes("S2"));
  const src = mutate("    @gl.public.view\n    def get_protocol_info(self)", "    @gl.public.write\n    def set_admin(self, who: str) -> None:\n        self.version = who\n\n    @gl.public.view\n    def get_protocol_info(self)");
  assert.ok(failedIds(src).includes("S2"));
});

test("S3 catches a second time source", () => {
  assert.ok(failedIds(mutate('        raw = str(gl.message_raw["datetime"] or "").strip()', '        import time\n        _ = time.time()\n        raw = str(gl.message_raw["datetime"] or "").strip()')).includes("S3"));
});

test("S4 catches a second value exit and a new caller of _close", () => {
  const second = mutate("    def _send(self, to: Address, amount: int) -> None:", "    def _leak(self, to: Address, amount: int) -> None:\n        _Recipient(to).emit_transfer(value=u256(amount), on=\"finalized\")\n\n    def _send(self, to: Address, amount: int) -> None:");
  assert.ok(failedIds(second).includes("S4"));
  const extra = mutate("    def lapse_mandate(self, mandate_id: str) -> None:", "    def lapse_mandate(self, mandate_id: str) -> None:\n        self._close(self._get(mandate_id), 'SETTLED', 'RELEASE_FULL', 'X', 0, 0)");
  assert.ok(failedIds(extra).includes("S4"));
});

test("S5 catches removal of the unreviewed-delivery gate", () => {
  const src = mutate('        if self._now_ms() <= int(m.review_deadline_at):\n            refuse("the client\'s review window is still open")\n', "");
  assert.ok(failedIds(src).includes("S5"));
});

test("S6 catches recovery while a ruling is appealable", () => {
  const src = mutate("self._require_state(m, S_LAPSED, S_FINALIZED, S_RECORD_SEALED)", "self._require_state(m, S_LAPSED, S_FINALIZED, S_RECORD_SEALED, S_RULING)");
  assert.ok(failedIds(src).includes("S6"));
});

test("S6 catches removal of the manual-review deadline gate", () => {
  const src = mutate('        if now <= int(m.manual_deadline_at):\n            refuse("the manual-review window is still open")\n', "");
  assert.ok(failedIds(src).includes("S6"));
});

test("S7 catches an optional commitment and a mismatch that carries text", () => {
  assert.ok(failedIds(mutate("digest = require_commitment(commitment)", "digest = norm_commitment(commitment)")).includes("S7"));
  assert.ok(failedIds(mutate('return (F_MISMATCH, "")\n    return (F_MATCH, stripped)', "return (F_MISMATCH, stripped)\n    return (F_MATCH, stripped)")).includes("S7"));
});

test("S8 catches settlement without the terminal-state guard", () => {
  const src = mutate('        if m.status in TERMINAL:\n            refuse("this mandate is already closed")\n', "");
  assert.ok(failedIds(src).includes("S8"));
});
