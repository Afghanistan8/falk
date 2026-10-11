# Sample evidence fixtures

Public, static documents used by the sample scenarios and by `scripts/arc.mjs`.
They are served from this repository through `raw.githubusercontent.com`, so every
GenLayer validator can retrieve them without a login.

| File | Used as |
| --- | --- |
| `northwind-report.md` | the deliverable; supports criterion C1 (all five markets) |
| `figures-sourced.md` | supports C2 (every figure cites a source) -> PASS |
| `figures-unsourced.md` | counter-evidence for C2 -> FAIL |
| `exec-summary.md` | supports C3 (summary fits one page) |
| `unrelated-note.md` | irrelevant evidence -> cannot support PASS |
| `injection-attempt.md` | contains an embedded instruction; must be treated as data |

**Never edit a fixture after a mandate has committed to its hash.** The content
commitment is `sha256(utf8(body.strip()))`; `scripts/arc.mjs` recomputes it from the
live URL each run. Line endings are forced to LF by `.gitattributes`.
