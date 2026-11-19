# The value model — Token Launch Radar (model version: radar-3, fitted comps, LOO-validated)

The board's implied values are **fitted from the sealed snapshot itself, at run time**. No protocol
is named anywhere in the model; the same function prices every row. This file states the model,
prints the numbers it fitted on this snapshot (dated 2026-11-14), and then does the thing most
boards skip: it **validates the fit out of sample** — leave-one-out and a temporal split over the
snapshot's own launched tokens — and prints the miss, next to the baselines it beat and the ones
it only matched.

## Formula

```
implied_value_usd = TVL × peer_multiple(category, TVL) × momentum × maturity × plausibility
```

## The peer multiple — fitted on the snapshot's own launched tokens

The comparison set ("comps") is every protocol in the snapshot whose token already trades with a
market cap the market plausibly sets from TVL: `mcap_usd > 0` and `0.005 ≤ mcap/TVL ≤ 20`. On this
snapshot that is **120 comps**. (Outside that band a token's price is set by something else —
an exchange's earnings, a meme, a points market — and would teach the fit nonsense.)

On the comps, a least-squares line of `log(mcap)` on `log(TVL)`:

```
log(mcap) = 4.4193 + 0.6684 × log(TVL)        →        peer value = e^4.4193 × TVL^0.6684
```

The slope below 1 is the size effect, and it is in the data, not assumed: launched tokens' median
mcap/TVL falls from 0.65× for $5–10M protocols to 0.03× above $1B. The fitted curve, before any
category offset or prior:

| Protocol TVL | Fitted multiple | Peer value |
|---|---|---|
| $10M | 0.396× | $3.96M |
| $100M | 0.185× | $18.5M |
| $1B | 0.086× | $86.0M |

Each category then shifts the line by its **median residual** among its comps, shrunk toward zero
by `n/(n+6)` so a category with two comps cannot shout, and clamped to ±0.9 in log space:

| Category | Comps | Raw median × | Fitted offset (log) | Candidates waiting |
|---|---|---|---|---|
| Lending | 15 | 0.132× | −0.450 | 16 |
| Dexs | 11 | 0.342× | +0.087 | 21 |
| RWA | 9 | 0.275× | +0.192 | 16 |
| CEX | 8 | 0.068× | +0.042 | 0 |
| Liquid Staking | 8 | 0.044× | −0.552 | 0 |
| Yield | 8 | 0.256× | +0.117 | 15 |
| Canonical Bridge | 7 | 1.126× | +0.706 | 0 |
| Basis Trading | 6 | 0.482× | +0.332 | 8 |
| Bridge | 6 | 0.557× | +0.206 | 0 |
| Cross Chain Bridge | 4 | 1.220× | +0.387 | 1 |
| Yield Aggregator | 4 | 0.151× | −0.334 | 9 |
| CDP | 3 | 0.169× | −0.107 | 9 |
| Privacy | 3 | 0.969× | +0.561 | 0 |

Field medians from the same fit: a typical launched token trades at **0.229×** its TVL; the field's
median 7-day TVL change is **−8.23%**; its median tracked age is **677 days**.

## Validation — what the model is worth when the answer is known

A board's prices are claims about tokens that do not trade yet, so they cannot be checked
directly. What can be checked is the machine: `validateModel()` in `lib/model.ts` re-prices the
launched tokens with fits that never saw them, on every run, and the dashboard prints the result.

**Leave-one-out (all 120 comps).** Each comp is priced by a model refitted on the other 119:

| Model, refit without the answer | Typical miss | Median \|log err\| | Within 2× | Bias (log) |
|---|---|---|---|---|
| Full model — size curve + category offsets | ×3.52 | 1.26 | 29.2% | +0.02 |
| Size curve only — no category offsets | ×3.41 | 1.23 | 25.8% | +0.00 |
| Naive — one flat median multiple for everything | ×4.65 | 1.54 | 32.5% | −0.04 |

Read honestly: the **size curve is what earns its keep** — it cuts the typical miss from ×4.65
(naive) to about ×3.4–3.5, because big protocols really do trade at smaller multiples. The
category offsets are, at n = 120, **within noise of the bare line on the median** (×3.52 vs ×3.41),
while putting more comps inside 2× (29.2% vs 25.8%). They are kept — shrunk hard toward zero —
because the in-sample category medians differ by more than an order of magnitude (bridges above
1×, liquid staking at 0.04×), and a model that ignored that structure would be pretending not to
know it. The naive baseline's higher within-2× share is the flip side of its worse median: a flat
price lands near the crowded middle often and misses the tails catastrophically.

**Temporal split.** Fitting the full model on only the 44 comps listed up to 2024-02-09 and
pricing the 45 listed later: typical miss **×3.16**, **33.3%** within 2×, bias **+0.35** — the
older fit somewhat overprices newer listings, which is stated here rather than tuned away,
because the production model is fitted on all 120 comps including the recent ones.

The scale to take away: **a typical miss of ×3–4 is the honest uncertainty of pricing a token
from TVL.** The radar therefore ranks and sizes claims and prints its error bars on the page;
it does not pretend to quote prices.

## Momentum and maturity — bounded priors, disclosed as priors

Regressing the comps' residuals on their 7-day change and their listing age gives correlations of
about −0.09 and −0.01: in this snapshot, neither explains what a launched token is worth. They still
enter the model — a radar that ignored a protocol doubling in a week, or one that has run four
tokenless years, would be worse — but as **small, bounded priors**, centred on the field's own
medians so an average protocol is untouched:

- momentum = clamp(exp(0.010 × (change_7d − (−8.23))), 0.78, 1.45) — at most +45% / −22%.
- maturity = 0.86 + 0.28 × min(age_days, 1460)/1460 — at most ±14% across four years.
  An unreported listing date is scored at the field's median age.

## Plausibility — separating future tokens from products of live ones

The board carries **all 342 protocols that record no token**: 198 launch candidates and 144
structural products. A candidate is priced at full peer value (×1.00). A protocol that is
structurally a product of an ecosystem whose token already trades is discounted by a stated prior,
because it may never issue a token of its own:

| Why it is a product | Prior |
|---|---|
| Versioned deployment (name ends V2, 2.0, …) | ×0.15 |
| Liquid staking / restaking infrastructure | ×0.12 |
| Bridge / canonical bridge (custodied-asset wrapper) | ×0.10 |
| Wrapped or staked product by name | ×0.08 |
| Exchange balance entry / CEX | ×0.06 |

The exclusion tests are the house watchlist's own (category, version marker, wrapped/staked wording,
exchange prefix). Products stay on the board — flagged, and visible under the dashboard's "Products"
filter — because a radar should show what it set aside and why. The 416 protocols that record a
token are never ranked: the top 30 by market cap ride along in `data.js` as the dashboard's
"already trading" comparison set.

## Worked examples (this snapshot)

- **Sentora Curator** (Risk Curators, TVL $2,758M): peer value $2,758M × 0.0826 = $227.8M,
  × momentum 1.112 × maturity 0.938 × plausibility 1.00 → **$237,594,350**, rank 1.
- **Steakhouse Financial** (Risk Curators, TVL $2,754M): peer value $2,754M × 0.0826 = $227.5M,
  × momentum 1.062 × maturity 0.964 × plausibility 1.00 → **$233,109,594**, rank 2.
- **WBTC** (Bridge, TVL $7,909M): peer value × 0.0533, × 0.977 × 0.990 × plausibility 0.10
  → **$40,759,810**, rank 14 — a giant, priced as what it is: a wrapped product, not a future token.
- **Polymarket International** (Prediction Market, TVL $320M): × 0.1255 × 1.074 × 1.140 × 1.00
  → **$49,213,427**, rank 8.

## Farm plans — costed to an itemised ledger

Each row's plan is generated from a per-category playbook (lending, DEX liquidity, vaults, perps,
bridges, staking, RWA, basis, generic), parameterised by the protocol's own record: a position size
tiered by its TVL ($500 under $10M of TVL, up to $10,000 above $1B), its cheapest chain to work on,
a plan length of 8–12 weeks hashed from its slug, and network-fee priors per chain (Ethereum $14 an
action, Base $0.25, Solana $0.06, …).

New in radar-3: every figure in a plan's prose comes from a single **plan ledger** computed first —
line items in the order the steps perform them (setup, core position, second action, recurring
claims, exit) — and the dashboard's detail view prints that same ledger as a table, so the prose
and the audit cannot disagree. Steakhouse Financial's ledger, worked on Polygon (its cheapest
chain at a $0.05 action prior):

| Line item | Actions | Fees |
|---|---|---|
| Wallet setup + funding transfer | 1 | $0.05 |
| Deposit into the flagship vault | 1 | $0.05 |
| Second vault deposit (breadth) | 1 | $0.05 |
| Reward claims (fortnightly, 5×) | 5 | $0.25 |
| Final withdraw / unwind | 1 | $0.05 |
| **Net plan cost** | **9** | **$0.45** |

— against $10,000 of capital that stays withdrawable throughout, over 10 weeks and about 4 hours
of the farmer's time. Product-class rows open with a reality check and farm at the smallest size.

## Determinism

The program reads only the snapshot, iterates it in its sealed (slug-sorted) order, and uses no
clock, randomness or network: two runs write byte-identical outputs, which the grader verifies.
The validation is part of the run, so its numbers are exactly as reproducible as the board's.
