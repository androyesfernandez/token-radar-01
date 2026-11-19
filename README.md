# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/androyesfernandez/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/androyesfernandez/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads the competition's sealed DefiLlama snapshot (758 protocols) and ranks **all 342 protocols that record no token** by an implied token value, each with a concrete, costed farm plan. The value model is fitted from the snapshot itself at run time — a least-squares line of log market cap on log TVL over the 120 already-tokenised protocols whose price is anchored to TVL, plus shrunk per-category offsets — then adjusted by bounded momentum and maturity priors and a stated plausibility discount for protocols that are structurally products of ecosystems whose token already trades (a versioned deployment, a wrapped product, a bridge wrapper). No protocol is named in the model. The dashboard is a static page: a sortable, filterable board with a per-protocol detail view (model breakdown, farm plan, launched peers), the fitted model printed on the page, and the already-trading comparison set shown separately, never ranked. MODEL.md documents the model and the numbers it fitted.

Layout: `main.ts` (entrypoint) · `lib/model.ts` (fit, scoring, farm plans, gate self-check) · `vendor/makefun-board.ts` (the kit's dossier library, byte-unchanged) · `dashboard/` (index.html, app.css, app.js) · `screenshots/` (the board, a detail view, the watchlist filter).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

In the grader the sealed snapshot mounts at `/input`; locally pass `--input <snapshot.json>` for any copy of it. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, deterministically — two runs write the same bytes. Node 22.18+, standard library only.

---
<sub>Entered on [make.fun](https://make.fun/?ref=ktpzxevq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
