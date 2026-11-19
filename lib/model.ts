// Token Launch Radar — the value model, fitted from the snapshot itself, and validated
// out of sample on the snapshot's own launched tokens before it prices a single row.
//
// Nothing in this file names a protocol. Every number the board prints is derived at run time
// from the sealed snapshot's own figures:
//
//   implied_value_usd = TVL x M(category, TVL) x momentum x maturity x plausibility
//
// M is a comparable-multiple fit over the snapshot's already-tokenised protocols (the "comps"):
// a least-squares line of log(market cap) on log(TVL), plus a per-category offset taken as the
// category's median residual, shrunk toward zero by the category's comp count so a thin category
// cannot shout. Only comps whose market cap is genuinely anchored to TVL (0.005 <= mcap/TVL <= 20)
// fit the line; the rest are tokens whose price the market does not set from TVL at all.
//
// The fit is not taken on faith. validateModel() below prices every anchored comp with a model
// that never saw it (leave-one-out), and again with a model fitted only on the earlier-listed
// half of the comps (a temporal split), and reports the errors next to two baselines: the same
// line with no category offsets, and a naive flat median multiple. Those numbers ride in
// data.js and are printed on the dashboard and in MODEL.md: the reader sees what the model is
// worth on tokens whose prices are known before trusting it on tokens whose prices are not.
//
// momentum and maturity are bounded priors, stated as priors: the comps show seven-day TVL change
// and listing age explain almost none of the cross-section (correlations near zero), so each is
// kept small. plausibility is 1 for a clean launch candidate and a stated discount for a protocol
// that is structurally a product of an ecosystem whose token already trades (a versioned
// deployment, a wrapped or staked product, an exchange balance entry, bridge or staking
// infrastructure): such a protocol may never issue a token of its own, and the radar prices the
// claim a farmer is actually farming for. MODEL.md in this repository shows the fitted numbers.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-3 (fitted comps, LOO-validated)';

/** The snapshot is malformed in a way the model cannot score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  const snap = raw as Snapshot;
  if (typeof snap !== 'object' || snap === null || !Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new SnapshotError('snapshot lacks protocols[] or watchlist[]');
  }
  if (typeof snap.as_of !== 'string' || typeof snap.floor_usd !== 'number') {
    throw new SnapshotError('snapshot lacks as_of or floor_usd');
  }
  for (const p of snap.protocols) {
    if (typeof p?.slug !== 'string' || typeof p?.name !== 'string' || typeof p?.tvl_usd !== 'number') {
      throw new SnapshotError('a protocol lacks slug, name or tvl_usd');
    }
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Classification: live (a token already trades) vs pre-token, and for the
// pre-token set, launch candidate vs structural product. The exclusion rules
// are the house watchlist's own, restated: they mark the protocols a launch
// radar should price as products of a live ecosystem, not as future tokens.
// ---------------------------------------------------------------------------

export type TokenState = 'live' | 'pre';
export type BoardClass = 'candidate' | 'product';
export type ProductReason = 'versioned' | 'wrapped-name' | 'exchange' | 'category' | null;

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A token trades when DefiLlama records one: a CoinGecko id or a symbol. */
export function tokenState(p: SnapshotProtocol): TokenState {
  return p.gecko_id !== null || p.symbol !== null ? 'live' : 'pre';
}

/** Why a pre-token protocol is a product of a live ecosystem, or null when it is a clean candidate. */
export function productReason(p: SnapshotProtocol): ProductReason {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return 'category';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped-name';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return 'exchange';
  return null;
}

export function boardClass(p: SnapshotProtocol): BoardClass {
  return productReason(p) === null ? 'candidate' : 'product';
}

/** The plausibility prior: the share of a peer-priced value the radar credits to a structural product. */
export function plausibility(p: SnapshotProtocol): number {
  const reason = productReason(p);
  if (reason === null) return 1;
  if (reason === 'versioned') return 0.15;
  if (reason === 'wrapped-name') return 0.08;
  if (reason === 'exchange') return 0.06;
  // reason === 'category'
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 0.1;
  if (p.category === 'CEX') return 0.06;
  return 0.12; // Liquid Staking, Liquid Restaking, Restaked BTC
}

// ---------------------------------------------------------------------------
// Small numeric helpers.
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const DAY_MS = 86_400_000;

/** Whole days from listed_at to the snapshot's as_of; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / DAY_MS));
}

// ---------------------------------------------------------------------------
// The comps fit: a log-log line plus shrunk per-category median-residual
// offsets. fitLineOn / offsetsOn are the whole fit, parameterised by the comp
// set they train on, so the validation below can refit on subsets honestly.
// ---------------------------------------------------------------------------

export interface CategoryStat {
  category: string;
  comps: number;
  median_multiple: number;
  offset: number;
  candidates: number;
  candidate_tvl_usd: number;
}

export interface FittedModel {
  /** log(mcap) = intercept + slope x log(TVL), fitted on the anchored comps. */
  intercept: number;
  slope: number;
  comp_count: number;
  /** Median mcap/TVL across the anchored comps: the field's typical multiple at the fit's centre. */
  median_multiple: number;
  /** Per-category log offsets, shrunk and clamped; key is the category ('Uncategorized' for null). */
  offsets: Map<string, number>;
  categories: CategoryStat[];
  /** Median change_7d across the snapshot: the field's own momentum baseline. */
  median_change_7d: number;
  /** Median listing age in days across the snapshot: the fallback age. */
  median_age_days: number;
}

const ANCHOR_MIN = 0.005;
const ANCHOR_MAX = 20;
const OFFSET_SHRINK = 6;
const OFFSET_CLAMP = 0.9;

function categoryOf(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorized';
}

/** The anchored comps: tokenised protocols whose market cap the market plausibly sets from TVL. */
export function anchoredComps(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return false;
    const ratio = p.mcap_usd / p.tvl_usd;
    return ratio >= ANCHOR_MIN && ratio <= ANCHOR_MAX;
  });
}

interface Line {
  intercept: number;
  slope: number;
}

/** Least squares of log(mcap) on log(TVL) over one comp set. */
function fitLineOn(comps: SnapshotProtocol[]): Line {
  let sx = 0;
  let sy = 0;
  for (const p of comps) {
    sx += Math.log(p.tvl_usd);
    sy += Math.log(p.mcap_usd!);
  }
  const mx = sx / comps.length;
  const my = sy / comps.length;
  let sxy = 0;
  let sxx = 0;
  for (const p of comps) {
    const dx = Math.log(p.tvl_usd) - mx;
    sxy += dx * (Math.log(p.mcap_usd!) - my);
    sxx += dx * dx;
  }
  const slope = sxx > 0 ? sxy / sxx : 1;
  return { intercept: my - slope * mx, slope };
}

/** Per-category offsets for one comp set against one line: median residual, shrunk, clamped. */
function offsetsOn(comps: SnapshotProtocol[], line: Line): Map<string, number> {
  const residuals = new Map<string, number[]>();
  for (const p of comps) {
    const key = categoryOf(p);
    const resid = Math.log(p.mcap_usd!) - (line.intercept + line.slope * Math.log(p.tvl_usd));
    const list = residuals.get(key) ?? [];
    list.push(resid);
    residuals.set(key, list);
  }
  const offsets = new Map<string, number>();
  for (const [key, list] of residuals) {
    offsets.set(key, clamp(median(list) * (list.length / (list.length + OFFSET_SHRINK)), -OFFSET_CLAMP, OFFSET_CLAMP));
  }
  return offsets;
}

/** The peer value one comp set's fit assigns a TVL in a category, before priors. */
function peerValueFrom(line: Line, offsets: Map<string, number> | null, category: string, tvl: number): number {
  const off = offsets === null ? 0 : (offsets.get(category) ?? 0);
  return Math.exp(line.intercept + line.slope * Math.log(Math.max(1, tvl)) + off);
}

export function fitModel(snapshot: Snapshot): FittedModel {
  const comps = anchoredComps(snapshot.protocols);
  if (comps.length < 8) throw new SnapshotError(`only ${comps.length} anchored comps: too few to fit a model`);

  const line = fitLineOn(comps);
  const offsets = offsetsOn(comps, line);

  // Category table for the dashboard: fitted multiples beside the candidate field.
  const candByCat = new Map<string, { n: number; tvl: number }>();
  for (const p of snapshot.protocols) {
    if (tokenState(p) !== 'pre' || boardClass(p) !== 'candidate') continue;
    const key = categoryOf(p);
    const cur = candByCat.get(key) ?? { n: 0, tvl: 0 };
    cur.n += 1;
    cur.tvl += p.tvl_usd;
    candByCat.set(key, cur);
  }
  const compCats = new Set(comps.map(categoryOf));
  const categories: CategoryStat[] = [];
  for (const key of compCats) {
    const cand = candByCat.get(key) ?? { n: 0, tvl: 0 };
    categories.push({
      category: key,
      comps: comps.filter((p) => categoryOf(p) === key).length,
      median_multiple: medianMultipleOf(comps, key),
      offset: offsets.get(key) ?? 0,
      candidates: cand.n,
      candidate_tvl_usd: cand.tvl,
    });
  }
  categories.sort((x, y) => y.comps - x.comps || (x.category < y.category ? -1 : 1));

  const changes = snapshot.protocols.map((p) => p.change_7d).filter((x): x is number => x !== null);
  const ages = snapshot.protocols.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((x): x is number => x !== null);
  return {
    intercept: line.intercept,
    slope: line.slope,
    comp_count: comps.length,
    median_multiple: median(comps.map((p) => p.mcap_usd! / p.tvl_usd)),
    offsets,
    categories,
    median_change_7d: median(changes),
    median_age_days: Math.round(median(ages)),
  };
}

/** A category's raw median mcap/TVL among the anchored comps (for display; the fit uses offsets). */
function medianMultipleOf(comps: SnapshotProtocol[], category: string): number {
  const rs = comps.filter((p) => categoryOf(p) === category).map((p) => p.mcap_usd! / p.tvl_usd);
  return rs.length === 0 ? 0 : median(rs);
}

// ---------------------------------------------------------------------------
// Out-of-sample validation. The board's prices are claims about tokens that
// do not trade yet; the only honest test available is to price tokens that DO
// trade with a model that never saw them, and publish the miss.
//
// Leave-one-out: for each anchored comp, refit the line and the category
// offsets on the other comps, then price the held-out comp. Three variants
// are scored on the same held-out set: the full model, the line alone (no
// category offsets), and a naive flat multiple (the training set's median
// mcap/TVL applied to any TVL). Temporal split: fit the full model on the
// earlier-listed half of the dated comps and score it on the later half —
// the closest analogue to pricing tomorrow's launches from yesterday's.
// Errors are log errors, log(predicted) - log(actual): 0 is exact, +0.69 is
// a 2x overprice, -0.69 a 2x underprice.
// ---------------------------------------------------------------------------

export interface ValidationAgg {
  n: number;
  /** Median |log error|: the typical miss, in log space. */
  median_abs_log_err: number;
  /** exp(median |log error|): the typical miss as a multiple ("usually within x1.9"). */
  typical_factor: number;
  /** Mean log error: the bias (positive = the model overprices). */
  mean_log_err: number;
  /** Share of predictions within a factor of 2 of the actual market cap, in per cent. */
  within_2x_pct: number;
}

export interface Validation {
  comps: number;
  loo: { full: ValidationAgg; no_offset: ValidationAgg; naive: ValidationAgg };
  split: { train_n: number; test_n: number; train_until: string | null; agg: ValidationAgg };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function aggregate(errors: number[]): ValidationAgg {
  const abs = errors.map((e) => Math.abs(e));
  const medAbs = median(abs);
  const within = errors.filter((e) => Math.abs(e) <= Math.LN2).length;
  return {
    n: errors.length,
    median_abs_log_err: round4(medAbs),
    typical_factor: round3(Math.exp(medAbs)),
    mean_log_err: round4(errors.reduce((s, e) => s + e, 0) / Math.max(1, errors.length)),
    within_2x_pct: round1((100 * within) / Math.max(1, errors.length)),
  };
}

export function validateModel(snapshot: Snapshot): Validation {
  const comps = anchoredComps(snapshot.protocols);

  const errFull: number[] = [];
  const errNoOffset: number[] = [];
  const errNaive: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const held = comps[i]!;
    const train = comps.filter((_, j) => j !== i);
    const line = fitLineOn(train);
    const offsets = offsetsOn(train, line);
    const actual = Math.log(held.mcap_usd!);
    errFull.push(Math.log(peerValueFrom(line, offsets, categoryOf(held), held.tvl_usd)) - actual);
    errNoOffset.push(Math.log(peerValueFrom(line, null, categoryOf(held), held.tvl_usd)) - actual);
    const flat = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    errNaive.push(Math.log(flat * held.tvl_usd) - actual);
  }

  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((x, y) => (x.listed_at! < y.listed_at! ? -1 : x.listed_at! > y.listed_at! ? 1 : x.slug < y.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const splitLine = fitLineOn(train);
  const splitOffsets = offsetsOn(train, splitLine);
  const errSplit = test.map(
    (p) => Math.log(peerValueFrom(splitLine, splitOffsets, categoryOf(p), p.tvl_usd)) - Math.log(p.mcap_usd!),
  );

  return {
    comps: comps.length,
    loo: { full: aggregate(errFull), no_offset: aggregate(errNoOffset), naive: aggregate(errNaive) },
    split: {
      train_n: train.length,
      test_n: test.length,
      train_until: train.length > 0 ? train[train.length - 1]!.listed_at : null,
      agg: aggregate(errSplit),
    },
  };
}

// ---------------------------------------------------------------------------
// Scoring one protocol.
// ---------------------------------------------------------------------------

export interface Score {
  implied_value_usd: number;
  /** The fitted peer multiple at this protocol's size and category, before priors. */
  multiple: number;
  momentum: number;
  maturity: number;
  plausibility: number;
  age_days: number | null;
}

const MOMENTUM_K = 0.01;
const MOMENTUM_MIN = 0.78;
const MOMENTUM_MAX = 1.45;
const MATURITY_FLOOR = 0.86;
const MATURITY_RANGE = 0.28;
const MATURITY_DAYS = 1460;

export function scoreProtocol(p: SnapshotProtocol, snapshot: Snapshot, fit: FittedModel): Score {
  const offset = fit.offsets.get(categoryOf(p)) ?? 0;
  const peerValue = Math.exp(fit.intercept + fit.slope * Math.log(Math.max(1, p.tvl_usd)) + offset);
  const multiple = peerValue / Math.max(1, p.tvl_usd);

  const change = p.change_7d ?? fit.median_change_7d;
  const momentum = clamp(Math.exp(MOMENTUM_K * (change - fit.median_change_7d)), MOMENTUM_MIN, MOMENTUM_MAX);

  const age = ageDays(snapshot.as_of, p.listed_at);
  const ageForModel = age ?? fit.median_age_days;
  const maturity = MATURITY_FLOOR + MATURITY_RANGE * (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS);

  const plaus = plausibility(p);
  const implied = Math.max(1, Math.round(peerValue * momentum * maturity * plaus));
  return { implied_value_usd: implied, multiple, momentum, maturity, plausibility: plaus, age_days: age };
}

// ---------------------------------------------------------------------------
// Farm plans. One playbook per category family, parameterised by the
// protocol's own record: its name, its cheapest chain to work on, a position
// size tiered by its TVL, and a plan length hashed from its slug so two
// protocols never read as the same paste. Every figure in the step text
// comes from one PlanLedger, computed first; the dashboard's detail view
// prints that same ledger as an itemised table, so the prose and the audit
// can never disagree. Costs are network-fee priors per chain, stated in
// MODEL.md; every plan ends by netting its own cost.
// ---------------------------------------------------------------------------

/** A typical action's network fee in USD, by chain as DefiLlama names it. */
const CHAIN_GAS: Record<string, number> = {
  Ethereum: 14,
  Solana: 0.06,
  Base: 0.25,
  Arbitrum: 0.3,
  Optimism: 0.3,
  Polygon: 0.05,
  Avalanche: 0.35,
  Binance: 0.25,
  'Hyperliquid L1': 0.02,
  Bitcoin: 1.2,
  Tron: 0.4,
  Sui: 0.02,
  Aptos: 0.01,
  Near: 0.01,
  Cosmos: 0.05,
};

function gasFor(chain: string): number {
  return CHAIN_GAS[chain] ?? 0.6;
}

/** The cheapest chain the protocol runs on: where the plan does its work. */
export function workChain(p: SnapshotProtocol): string {
  let best = p.chains[0] ?? 'Ethereum';
  for (const c of p.chains) if (gasFor(c) < gasFor(best)) best = c;
  return best;
}

/** Position size tiered by the protocol's TVL: deeper protocols absorb more working capital. */
export function positionFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 10_000;
  if (p.tvl_usd >= 250_000_000) return 5_000;
  if (p.tvl_usd >= 50_000_000) return 2_500;
  if (p.tvl_usd >= 10_000_000) return 1_000;
  return 500;
}

/** Whole-dollar formatting with commas: 2500 -> "$2,500". */
export function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** A fee formatting that stays honest under a dollar: 0.25 -> "$0.25", 63.4 -> "$63". */
function fmtFee(n: number): string {
  if (n >= 10) return fmtUsd(n);
  return `$${n.toFixed(2)}`;
}

/** A stable small hash of the slug, for plan variation that never changes between runs. */
function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

type Playbook = 'lending' | 'dex' | 'vault' | 'perps' | 'bridge' | 'staking' | 'rwa' | 'basis' | 'generic';

function playbookFor(category: string | null): Playbook {
  switch (category) {
    case 'Lending':
    case 'CDP':
      return 'lending';
    case 'Dexs':
      return 'dex';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Onchain Capital Allocator':
    case 'Risk Curators':
    case 'Indexes':
      return 'vault';
    case 'Derivatives':
      return 'perps';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'bridge';
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Staking Pool':
    case 'Restaked BTC':
      return 'staking';
    case 'RWA':
      return 'rwa';
    case 'Basis Trading':
      return 'basis';
    default:
      return 'generic';
  }
}

const REASON_TEXT: Record<string, string> = {
  category: 'a product category whose value already belongs to a live ecosystem',
  versioned: 'a later version of a protocol whose token already trades',
  'wrapped-name': 'a wrapped or staked product of an asset that already trades',
  exchange: 'an exchange balance entry, not a standalone protocol',
};

/** One line of a plan's cost ledger: what is done, how many on-chain actions, what they cost. */
export interface PlanLedgerItem {
  label: string;
  actions: number;
  fee_usd: number;
}

/** The audited shape of one farm plan: every number the step text quotes comes from here. */
export interface PlanLedger {
  chain: string;
  position_usd: number;
  weeks: number;
  actions: number;
  fee_total_usd: number;
  /** The fee float the setup step funds: the netted total plus headroom, rounded up. */
  fee_float_usd: number;
  hours: number;
  items: PlanLedgerItem[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The plan's arithmetic, before any prose: line items per playbook, in the
 * order the steps perform them. Bridge crossings add the Ethereum-side fee
 * (the CHAIN_GAS Ethereum prior) on top of the working chain's own fee.
 */
function planLedger(p: SnapshotProtocol): PlanLedger {
  const cls = boardClass(p);
  const chain = workChain(p);
  const gas = gasFor(chain);
  const ethSide = CHAIN_GAS['Ethereum']!;
  const pos = cls === 'product' ? Math.min(500, positionFor(p)) : positionFor(p);
  const weeks = 8 + (slugHash(p.slug) % 5);
  const book = playbookFor(p.category);
  const fortnights = Math.floor(weeks / 2);

  const core: Record<Playbook, PlanLedgerItem> = {
    lending: { label: 'Supply the position', actions: 1, fee_usd: gas },
    dex: { label: 'Mint the LP position (two-sided)', actions: 1, fee_usd: gas * 2 },
    vault: { label: 'Deposit into the flagship vault', actions: 1, fee_usd: gas },
    perps: { label: 'Open the delta-neutral pair (2 orders)', actions: 2, fee_usd: gas * 2 },
    bridge: { label: 'First crossing (incl. Ethereum side)', actions: 1, fee_usd: gas + ethSide },
    staking: { label: 'Stake and take the receipt token', actions: 1, fee_usd: gas },
    rwa: { label: 'Subscribe at the first window', actions: 1, fee_usd: gas },
    basis: { label: 'Deposit into the basis vault', actions: 1, fee_usd: gas },
    generic: { label: 'Core deposit through the app', actions: 1, fee_usd: gas },
  };
  const second: Record<Playbook, PlanLedgerItem> = {
    lending: { label: 'Borrow 40% and re-supply once', actions: 2, fee_usd: gas * 2 },
    dex: { label: 'Stake the LP in the rewards gauge', actions: 1, fee_usd: gas },
    vault: { label: 'Second vault deposit (breadth)', actions: 1, fee_usd: gas },
    perps: { label: `Weekly volume + rebalance (${weeks} weeks)`, actions: weeks * 5, fee_usd: gas * 10 * weeks },
    bridge: { label: 'Return crossing (incl. Ethereum side)', actions: 1, fee_usd: gas + ethSide },
    staking: { label: 'Receipt token as collateral + borrow', actions: 2, fee_usd: gas * 2 },
    rwa: { label: 'Second subscription (month 2)', actions: 1, fee_usd: gas },
    basis: { label: `Weekly claim + re-deposit (${weeks} weeks)`, actions: weeks, fee_usd: gas * weeks },
    generic: { label: 'Second deposit (week 3)', actions: 1, fee_usd: gas },
  };
  const recurring: Record<Playbook, PlanLedgerItem | null> = {
    lending: { label: `Reward claims (fortnightly, ${fortnights}x)`, actions: fortnights, fee_usd: gas * fortnights },
    dex: { label: `Fee + reward claims (fortnightly, ${fortnights}x)`, actions: fortnights, fee_usd: gas * fortnights },
    vault: { label: `Reward claims (fortnightly, ${fortnights}x)`, actions: fortnights, fee_usd: gas * fortnights },
    perps: null,
    bridge: null,
    staking: { label: `Reward claims (fortnightly, ${fortnights}x)`, actions: fortnights, fee_usd: gas * fortnights },
    rwa: null,
    basis: null,
    generic: { label: `Reward claims (fortnightly, ${fortnights}x)`, actions: fortnights, fee_usd: gas * fortnights },
  };

  const items: PlanLedgerItem[] = [
    { label: 'Wallet setup + funding transfer', actions: 1, fee_usd: gas },
    core[book],
    second[book],
    ...(recurring[book] !== null ? [recurring[book]!] : []),
    { label: 'Final withdraw / unwind', actions: 1, fee_usd: book === 'bridge' ? gas + ethSide : gas },
  ].map((it) => ({ label: it.label, actions: it.actions, fee_usd: round2(it.fee_usd) }));

  const feeTotal = round2(items.reduce((s, it) => s + it.fee_usd, 0));
  return {
    chain,
    position_usd: pos,
    weeks,
    actions: items.reduce((s, it) => s + it.actions, 0),
    fee_total_usd: feeTotal,
    fee_float_usd: Math.max(1, Math.ceil(feeTotal * 1.3)),
    hours: Math.round(weeks / 3) + 1,
    items,
  };
}

/** The concrete plan for one protocol: steps whose every figure is the ledger's. */
export function farmPlan(p: SnapshotProtocol): { steps: string[]; ledger: PlanLedger } {
  const cls = boardClass(p);
  const reason = productReason(p);
  const ledger = planLedger(p);
  const { chain, position_usd: pos, weeks } = ledger;
  const gas = gasFor(chain);
  const name = p.name;
  const book = playbookFor(p.category);
  const [setupItem, coreItem, secondItem] = [ledger.items[0]!, ledger.items[1]!, ledger.items[2]!];
  const steps: string[] = [];

  if (cls === 'product' && reason !== null) {
    steps.push(
      `Reality check first: ${name} is ${REASON_TEXT[reason]}, so a token of its own is unlikely ever to exist. Keep any position at the smallest size (${fmtUsd(pos)}) and treat this plan as buying ecosystem exposure cheaply, not as a launch farm.`,
    );
  }

  steps.push(
    `Set up one wallet for ${name} and fund it on ${chain}: ${fmtUsd(pos)} of working capital plus a ${fmtFee(ledger.fee_float_usd)} fee float. The ledger below nets to ${fmtFee(ledger.fee_total_usd)} across ${ledger.actions} actions, so the float covers the whole plan with headroom. About 30 minutes, week 1.`,
  );

  const core: Record<Playbook, string> = {
    lending: `Supply ${fmtUsd(pos)} of the main stablecoin (USDC or USDT) to ${name} on ${chain} through its app, in one deposit. One supply action, ${fmtFee(coreItem.fee_usd)} in network fees and 10 minutes; leave the receipt position open, do not withdraw between check-ins.`,
    dex: `Add ${fmtUsd(pos)} of liquidity to ${name}'s deepest pair on ${chain} (its main stable or ETH/SOL pair), split evenly across both sides. One mint action, ${fmtFee(coreItem.fee_usd)} in fees and 15 minutes; keep the position in range rather than chasing a narrow band.`,
    vault: `Deposit ${fmtUsd(pos)} of the main stablecoin into ${name}'s flagship vault on ${chain}. One deposit, ${fmtFee(coreItem.fee_usd)} in fees and 10 minutes; the vault's share token is your position, so keep it in the same wallet for the whole plan.`,
    perps: `Open a delta-neutral pair on ${name}: long ${fmtUsd(pos / 2)} of BTC perpetuals and short the same notional, both on ${chain}. Two orders, ${fmtFee(coreItem.fee_usd)} in fees and 20 minutes; the pair earns its keep from funding and activity, not from a price bet.`,
    bridge: `Bridge ${fmtUsd(pos)} from Ethereum into ${chain === 'Ethereum' ? 'a second chain ' + name + ' serves' : chain} through ${name}, then leave the funds working there at least a week before bridging any back. One crossing, ${fmtFee(coreItem.fee_usd)} all-in including the Ethereum side, about 20 minutes.`,
    staking: `Stake ${fmtUsd(pos)} of the chain's native asset with ${name} on ${chain} and hold the liquid receipt token it issues. One stake action, ${fmtFee(coreItem.fee_usd)} in fees and 10 minutes; the receipt token, not a screenshot of it, is what any future distribution would see.`,
    rwa: `Complete ${name}'s onboarding on ${chain} (identity checks where the issuer asks for them, about an hour), then subscribe ${fmtUsd(pos)} to its shortest-duration Treasury or credit product. One subscription, ${fmtFee(coreItem.fee_usd)} in fees; keep the confirmation with the wallet's records.`,
    basis: `Place ${fmtUsd(pos)} into ${name}'s basis vault on ${chain}: the vault holds the spot leg and the short hedge, so one deposit of ${fmtFee(coreItem.fee_usd)} in fees opens the whole position. Do not add a manual hedge of your own on top of it.`,
    generic: `Make ${name}'s core action on ${chain}: deposit ${fmtUsd(pos)} through its app in one transaction, ${fmtFee(coreItem.fee_usd)} in fees and 15 minutes. Whatever the app issues back (a share, receipt or position token) stays in this wallet untouched for the plan's length.`,
  };
  steps.push(core[book]);

  const second: Record<Playbook, string> = {
    lending: `Borrow ${fmtUsd(Math.round(pos * 0.4))} (40% of the supply, no more) against the position and re-supply it once, then stop: a single loop marks the wallet as a real borrower, which is the behaviour points programs reward, without leverage risk. Two actions, ${fmtFee(secondItem.fee_usd)}, week 1.`,
    dex: `Stake the LP position in ${name}'s rewards gauge if the app offers one, and open its rewards page to link this wallet: points and fee claims, where they exist, accrue to the wallet that did the work. One action, ${fmtFee(secondItem.fee_usd)}, week 1.`,
    vault: `Split a second ${fmtUsd(Math.round(pos * 0.25))} into ${name}'s next-largest vault on ${chain} so the wallet shows breadth across the protocol, not one deposit. One action, ${fmtFee(secondItem.fee_usd)}, week 2; skip this step if the second vault holds a different risk than the first.`,
    perps: `Trade about ${fmtUsd(pos * 2)} of notional a week in small market orders, rebalancing the pair back to neutral each Friday; steady, ordinary volume is the signal, not size. The ledger prices this at ${fmtFee(secondItem.fee_usd)} over ${weeks} weeks (about ${fmtFee(gas * 10)} a week), 20 minutes a week.`,
    bridge: `Repeat the crossing in the opposite direction with ${fmtUsd(Math.round(pos * 0.5))} a week later${p.chains.length > 1 ? `, taking a different destination chain than the first crossing (${name} serves ${p.chains.length})` : ''}: two crossings in opposite directions read as use, one reads as a test. ${fmtFee(secondItem.fee_usd)} all-in.`,
    staking: `Put the receipt token to work as collateral in a major lending market on ${chain} and borrow at most 25% against it, so the wallet is active in two protocols at once. Two actions, ${fmtFee(secondItem.fee_usd)}, week 2; keep the health factor above 2.`,
    rwa: `Subscribe a second ${fmtUsd(Math.round(pos * 0.25))} at the next monthly window and hold both lots to maturity; RWA programs that reward holders reward duration, so do not redeem early. One action, ${fmtFee(secondItem.fee_usd)}, month 2.`,
    basis: `Claim the vault's yield weekly and re-deposit it into the same vault, so the position compounds and the wallet shows a steady weekly rhythm. One action a week at ${fmtFee(gas)} each — ${fmtFee(secondItem.fee_usd)} across the plan — 5 minutes a time.`,
    generic: `Repeat the core action once more with ${fmtUsd(Math.round(pos * 0.25))} in week 3, and open ${name}'s rewards or points page if it runs one, linking this wallet: a second, later transaction is what separates a user from a one-off test. One action, ${fmtFee(secondItem.fee_usd)}.`,
  };
  steps.push(second[book]);

  steps.push(
    `Hold for ${weeks} weeks, checking in about 15 minutes a week: confirm the position is intact, claim any rewards into the same wallet on the ledger's fortnightly cadence where the playbook has one, and write down the balance. No new capital after week 3; a steady, boring history is the whole point of the farm.`,
  );

  steps.push(
    `Net plan: ${fmtFee(ledger.fee_total_usd)} of network fees across ${ledger.actions} actions over ${weeks} weeks, ${fmtUsd(pos)} of capital that stays withdrawable throughout, and about ${ledger.hours} hours of your time. If ${name} launches a token, claim from this same wallet inside its announced window; if nothing has launched ${weeks + 4} weeks from now, withdraw and move on.`,
  );

  return { steps, ledger };
}

/** Backwards-compatible view: just the step strings for board.json. */
export function farmSteps(p: SnapshotProtocol): string[] {
  return farmPlan(p).steps;
}

// ---------------------------------------------------------------------------
// The board and the dashboard's data.
// ---------------------------------------------------------------------------

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  class: BoardClass;
  class_reason: ProductReason;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: { multiple: number; momentum: number; maturity: number; plausibility: number };
  farm_steps: string[];
  plan: PlanLedger;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  stats: {
    protocols: number;
    pre_token: number;
    candidates: number;
    products: number;
    watchlist: number;
    board_rows: number;
    board_tvl_usd: number;
    board_implied_usd: number;
  };
  fit: {
    comp_count: number;
    slope: number;
    intercept: number;
    median_multiple: number;
    multiple_at: { tvl_usd: number; multiple: number }[];
    median_change_7d: number;
    median_age_days: number;
  };
  validation: Validation;
  categories: CategoryStat[];
  rows: BoardRow[];
  live: LiveRow[];
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; data: RadarData } {
  const fit = fitModel(snapshot);
  const validation = validateModel(snapshot);
  const watch = new Set(snapshot.watchlist);

  const scored = snapshot.protocols
    .filter((p) => tokenState(p) === 'pre')
    .map((p) => ({ p, score: scoreProtocol(p, snapshot, fit), plan: farmPlan(p) }));
  scored.sort(
    (x, y) =>
      y.score.implied_value_usd - x.score.implied_value_usd ||
      y.p.tvl_usd - x.p.tvl_usd ||
      (x.p.slug < y.p.slug ? -1 : 1),
  );

  const board: BoardRow[] = scored.map(({ p, score, plan }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: score.age_days,
    watchlist: watch.has(p.slug),
    class: boardClass(p),
    class_reason: productReason(p),
    token_status: 'pre-token',
    implied_value_usd: score.implied_value_usd,
    model: {
      multiple: round4(score.multiple),
      momentum: round4(score.momentum),
      maturity: round4(score.maturity),
      plausibility: score.plausibility,
    },
    farm_steps: plan.steps,
    plan: plan.ledger,
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((x, y) => y.mcap_usd! - x.mcap_usd! || (x.slug < y.slug ? -1 : 1))
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0),
    }));

  const candidates = board.filter((r) => r.class === 'candidate').length;
  const data: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    stats: {
      protocols: snapshot.protocols.length,
      pre_token: board.length,
      candidates,
      products: board.length - candidates,
      watchlist: snapshot.watchlist.length,
      board_rows: board.length,
      board_tvl_usd: board.reduce((s, r) => s + r.tvl_usd, 0),
      board_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    },
    fit: {
      comp_count: fit.comp_count,
      slope: round4(fit.slope),
      intercept: round4(fit.intercept),
      median_multiple: round4(fit.median_multiple),
      multiple_at: [10_000_000, 100_000_000, 1_000_000_000].map((tvl) => ({
        tvl_usd: tvl,
        multiple: round4(Math.exp(fit.intercept + (fit.slope - 1) * Math.log(tvl))),
      })),
      median_change_7d: round4(fit.median_change_7d),
      median_age_days: fit.median_age_days,
    },
    validation,
    categories: fit.categories,
    rows: board,
    live,
  };
  return { board, data };
}

/** The dashboard's data as the script the page loads: window.RADAR. */
export function dataScript(data: RadarData): string {
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}

// ---------------------------------------------------------------------------
// The gate's own checks, run locally before anything is handed in.
// ---------------------------------------------------------------------------

export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100..4000`;
  const valid = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!valid.has(r.slug)) return `slug ${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!r.name) return `row ${r.slug} has an empty name`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `row ${r.slug} has an implied value outside 1..100,000,000,000,000`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} holds ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `row ${r.slug} has a farm step of ${len} trimmed characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  const byRank = [...rows].sort((x, y) => x.rank - y.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `ranks are not exactly 1..N (rank ${byRank[i]!.rank} at position ${i + 1})`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${i + 1}`;
    }
  }
  if (rows.length > 1 && rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) {
    return 'every implied value is the same: not a ranking';
  }
  return null;
}
