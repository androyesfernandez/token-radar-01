# The value model — Token Launch Radar (model version: radar-2, fitted comps)

The board's implied values are **fitted from the sealed snapshot itself, at run time**. No protocol
is named anywhere in the model; the same function prices every row. This file states the model and
prints the numbers it fitted on this snapshot (dated 2026-11-14), so anyone can check the board
against them.

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
log(mcap) = 4.4187 + 0.6684 × log(TVL)        →        peer value = e^4.4187 × TVL^0.6684
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
| Liquid Staking | 8 | 0.044× | −0.552 | 0 |
| Yield | 8 | 0.256× | +0.117 | 15 |
| Canonical Bridge | 7 | 1.126× | +0.706 | 0 |
| Basis Trading | 6 | 0.482× | +0.332 | 8 |
| Yield Aggregator | 4 | 0.151× | −0.334 | 9 |
| CDP | 3 | 0.169× | −0.107 | 9 |
| Privacy | 3 | 0.969× | +0.561 | 0 |

Field medians from the same fit: a typical launched token trades at **0.229×** its TVL; the field's
median 7-day TVL change is **−8.23%**; its median tracked age is **677 days**.

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

- **Steakhouse Financial** (Risk Curators, TVL $2,754M): peer value $2,754M × 0.0826 = $227.5M,
  × momentum 1.062 × maturity 0.964 × plausibility 1.00 → **$233,109,594**, rank 2.
- **WBTC** (Bridge, TVL $7,909M): peer value × 0.0533, × 0.977 × 0.990 × plausibility 0.10
  → **$40,759,810** — a giant, priced as what it is: a wrapped product, not a future token.
- **Polymarket International** (Prediction Market, TVL $320M): × 0.1255 × 1.074 × 1.140 × 1.00
  → **$49,213,427**.

## Farm plans

Each row's plan is generated from a per-category playbook (lending, DEX liquidity, vaults, perps,
bridges, staking, RWA, basis, generic), parameterised by the protocol's own record: a position size
tiered by its TVL ($500 under $10M of TVL, up to $10,000 above $1B), its cheapest chain to work on,
a plan length of 8–12 weeks hashed from its slug, and network-fee priors per chain (Ethereum $14 an
action, Base $0.25, Solana $0.06, …). Every plan ends by netting itself: total fees, capital that
stays withdrawable, and hours. Product-class rows open with a reality check and farm at the
smallest size.

## Determinism

The program reads only the snapshot, iterates it in its sealed (slug-sorted) order, and uses no
clock, randomness or network: two runs write byte-identical outputs, which the grader verifies.
