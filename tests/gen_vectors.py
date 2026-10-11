"""Generate shared act-matrix vectors from the Python original.

    python tests/gen_vectors.py          # (re)write tests/vectors/acts.json
    python tests/gen_vectors.py --check  # fail if the committed file is stale

scripts/web.test.mjs replays every vector against src/lib/acts.ts, so the UI's
mirror cannot drift from the function the contract suite checks against the
chain.
"""

import itertools
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from support import core  # noqa: E402

K = core()
OUT = pathlib.Path(__file__).resolve().parent / "vectors" / "acts.json"

STATUSES = ["DRAFT", "ESCROWED", "ENGAGED", "DELIVERED", "APPROVED", "CONTESTED", "RECORD_SEALED",
            "RULING", "APPEALED", "FINALIZED", "SETTLED", "CANCELLED", "LAPSED", "RECOVERED"]
CLIENT, OPERATOR, KEEPER = "0xC11E000000000000000000000000000000000001", "0x0B0000000000000000000000000000000000002", "0xEE00000000000000000000000000000000000003"


def build():
    vectors = []
    deadline = 1000
    for status in STATUSES:
        for responded, appeals, action, proposed, proposer in itertools.product(
                (False, True), (0, 1), ("PRORATA", "MANUAL_REVIEW", ""), (False, True), (CLIENT, OPERATOR)):
            if not proposed and proposer != CLIENT:
                continue
            for who in (CLIENT, OPERATOR, KEEPER):
                for now in (0, 999, 1000, 1001):
                    view = {
                        "status": status, "client": CLIENT, "operator": OPERATOR,
                        "execution_deadline_at": deadline, "review_deadline_at": deadline,
                        "response_deadline_at": deadline, "stall_deadline_at": deadline,
                        "appeal_deadline_at": deadline, "manual_deadline_at": deadline,
                        "appeal_count": appeals, "operator_responded": responded,
                        "resolved_action": action, "split_proposed": proposed,
                        "split_proposer": proposer if proposed else "",
                    }
                    vectors.append([status, who, now, responded, appeals, action, proposed,
                                    proposer if proposed else "", K.compute_acts(view, who, now)])
    return vectors


def main():
    payload = {
        "deadline": 1000, "client": CLIENT, "operator": OPERATOR,
        "columns": ["status", "who", "now", "responded", "appeals", "action", "proposed",
                    "proposer", "acts"],
        "rows": build(),
    }
    data = json.dumps(payload, separators=(",", ":")) + "\n"
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != data:
            print("tests/vectors/acts.json is stale; run python tests/gen_vectors.py")
            return 1
        print("act vectors are current")
        return 0
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(data, encoding="utf-8", newline="\n")
    print(f"wrote {len(json.loads(data)['rows'])} vectors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
