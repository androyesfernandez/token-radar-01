# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/androyesfernandez/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/androyesfernandez/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar, presented as a terminal: KPI strip, the board's implied-value distribution, and the fitted multiple curve above a sortable, filterable board. It reads the competition's sealed DefiLlama snapshot (758 protocols) and ranks **all 342 protocols that record no token** by an implied token value, each with a concrete farm plan costed to an itemised ledger. The value model is fitted from the snapshot itself at run time — a least-squares line of log market cap on log TVL over the 120 already-tokenised protocols whose price is anchored to TVL, plus shrunk per-category offsets — then adjusted by bounded momentum and maturity priors and a stated plausibility discount for protocols that are structurally products of ecosystems whose token already trades (a versioned deployment, a wrapped product, a bridge wrapper). No protocol is named in the model. And the model is **validated out of sample on every run**: leave-one-out over all 120 comps (typical miss ×3.52) plus a temporal split (fit on the earlier-listed half, tested on the later half, ×3.16), printed on the dashboard and in MODEL.md next to the baselines it is measured against. The dashboard is a static page: a per-protocol detail view shows the model factor breakdown, the plan ledger (every action and fee, netted), the farm steps, and launched peers; the already-trading comparison set is shown separately, never ranked. MODEL.md documents the model, the validation, and the numbers both fitted.

Layout: `main.ts` (entrypoint) · `lib/model.ts` (fit, validation, scoring, farm plans + ledgers, gate self-check) · `vendor/makefun-board.ts` (the kit's dossier library, byte-unchanged) · `dashboard/` (index.html, app.css, app.js) · `screenshots/` (the board, a detail view, the watchlist filter).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

In the grader the sealed snapshot mounts at `/input`; locally pass `--input <snapshot.json>` for any copy of it. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, deterministically — two runs write the same bytes. Node 22.18+, standard library only.

---
<sub>Entered on [make.fun](https://make.fun/?ref=ktpzxevq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
