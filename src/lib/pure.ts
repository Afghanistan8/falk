/**
 * Dependency-free helpers shared by the UI and its Node tests.
 */

/** Python's str.strip() whitespace set (differs from JS trim: no BOM, adds \x1c-\x1f and \x85). */
const PY_SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");

export function pyStrip(text: string): string {
  return text.replace(PY_STRIP, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The content commitment the contract expects: sha256 of the stripped UTF-8 body. */
export function commitmentOf(body: string): Promise<string> {
  return sha256Hex(pyStrip(body));
}

const WEI = 10n ** 18n;

/** wei -> GEN, trimmed (never rounds). */
export function formatGen(wei: string | bigint): string {
  const value = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const whole = value / WEI;
  const frac = (value % WEI).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Decimal GEN -> wei. Refuses negatives, junk and more than 18 decimals. */
export function parseGen(text: string): bigint {
  const t = text.trim();
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(t);
  if (!m) throw new Error("Enter a non-negative amount in GEN with at most 18 decimals.");
  return BigInt(m[1]) * WEI + BigInt((m[2] ?? "").padEnd(18, "0") || "0");
}

const REFUSALS: Array<[RegExp, string]> = [
  [/exact payment required/i, "The payment must be exactly the agreed amount."],
  [/exact performance bond required/i, "The performance bond must be exactly the agreed amount."],
  [/exact contest bond required/i, "The contest bond must be exactly the agreed amount."],
  [/content commitment is required/i, "Paste the sha256 of the document body (or let Falk compute it from the URL)."],
  [/review window has closed/i, "The client's review window has closed."],
  [/execution deadline has passed/i, "The execution deadline has passed."],
  [/frozen terms no longer match/i, "The frozen terms no longer match their recorded hash."],
  [/sum to exactly 100/i, "Criterion weights must add up to exactly 100."],
];

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return "The contract refused this action.";
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Turn a contract refusal into text a person can act on. */
export function humanizeRefusal(message: string): string {
  const raw = String(message || "").replace(/^.*?\[(EXPECTED|EXTERNAL|TRANSIENT|PANEL_ERROR)\]\s*/s, "");
  for (const [pattern, friendly] of REFUSALS) {
    if (friendly && pattern.test(raw)) return friendly;
  }
  const needs = /this mandate is ([A-Z_]+); this action needs (.+)$/.exec(raw);
  if (needs) {
    return `This mandate is ${needs[1].replace("_", " ").toLowerCase()}; that action needs it to be ${needs[2]
      .replace(/_/g, " ")
      .toLowerCase()}.`;
  }
  return sentence(raw);
}
