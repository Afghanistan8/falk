"""Shared constants and helpers for the Falk suites.

`core()` loads the PURE CORE region of contracts/falk.py into a bare Python
namespace that has no `gl` object. If any core function reaches for the VM,
the pure suite fails with NameError.
"""

import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
import os

CONTRACT = pathlib.Path(os.environ.get("FALK_CONTRACT") or (ROOT / "contracts" / "falk.py"))
BEGIN = "# ==== FALK PURE CORE BEGIN ===="
END = "# ==== FALK PURE CORE END ===="


def core_source() -> str:
    text = CONTRACT.read_text(encoding="utf-8")
    start = text.index(BEGIN) + len(BEGIN)
    stop = text.index(END)
    return text[start:stop]


class _Ns(dict):
    __getattr__ = dict.__getitem__


_CACHE = {}


def core() -> _Ns:
    if "ns" not in _CACHE:
        ns = _Ns()
        ns["__name__"] = "falk_core"
        exec(compile(core_source(), "falk_core", "exec"), ns)
        _CACHE["ns"] = ns
    return _CACHE["ns"]


WEI = 10 ** 18
PAYMENT = 100 * WEI
OP_BOND = 5 * WEI
CT_BOND = 2 * WEI

SEALED_BODY = "<html>the sealed deliverable</html>"
SEALED_COMMITMENT = hashlib.sha256(SEALED_BODY.strip().encode("utf-8")).hexdigest()
OTHER_BODY = "a swapped document"
OTHER_COMMITMENT = hashlib.sha256(OTHER_BODY.encode("utf-8")).hexdigest()

CRITERIA = [
    {"id": "C1", "title": "Covers all five markets", "description": "The report covers all five named markets.",
     "weight": 40, "non_negotiable": True, "min_evidence": 1, "independence": "ANY"},
    {"id": "C2", "title": "Figures cite sources", "description": "Every figure cites a public source.",
     "weight": 35, "non_negotiable": False, "min_evidence": 1, "independence": "ANY"},
    {"id": "C3", "title": "Summary is one page", "description": "The executive summary fits on one page.",
     "weight": 25, "non_negotiable": False, "min_evidence": 1, "independence": "ANY"},
]
CRITERIA_JSON = json.dumps(CRITERIA)
IDS = [c["id"] for c in CRITERIA]

MIN = 60_000
WINDOWS = {"execution": 10 * MIN, "review": 5 * MIN, "response": 2 * MIN,
           "appeal": 3 * MIN, "manual": 20 * MIN}
POLICY = {"PARTIAL": "PRORATA", "REJECTED": "RETURN", "INCONCLUSIVE": "MANUAL_REVIEW",
          "LAPSE_BOND": "RETURN"}

T0 = 1_800_000_000_000  # an arbitrary fixed origin for tests


def iso(ms: int) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def panel_json(results, **extra):
    payload = {
        "criterion_results": [{"id": k, "result": v, "reason": "fixture"} for k, v in results.items()],
        "evidence_quality": "HIGH", "integrity_flags": [], "reasoning": "fixture",
    }
    payload.update(extra)
    return json.dumps(payload)
