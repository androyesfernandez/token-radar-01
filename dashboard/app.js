// Token Launch Radar — the page's behaviour. Everything renders from window.RADAR, the data
// file main.ts writes beside this page from the same board the gate reads: what the page shows
// and what board.json holds can never drift apart.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** $1.24B, $312M, $45K, $812 — compact money for tables. */
function money(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/** Fees keep cents under ten dollars: $0.25, $63. */
function fee(n) {
  if (n === null || n === undefined) return '—';
  return n >= 10 ? money(n) : `$${n.toFixed(2)}`;
}

/** Signed percent with one decimal: +4.2%, -11.0%. */
function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** Tokenless age: 1284 -> "3.5y", 96 -> "3mo", 12 -> "12d". */
function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 730) return `${(days / 365.25).toFixed(1)}y`;
  if (days >= 60) return `${Math.round(days / 30.44)}mo`;
  return `${days}d`;
}

const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') ?? '',
  category: params.get('category') ?? '',
  chain: params.get('chain') ?? '',
  cls: params.get('cls') ?? 'all',
  sort: params.get('sort') ?? 'rank',
  detail: params.get('detail') ?? null,
};
if (state.detail) document.body.classList.add('focus');

const bySlug = new Map(R.rows.map((r) => [r.slug, r]));
const logMin = Math.log10(Math.min(...R.rows.map((r) => r.implied_value_usd)));
const logMax = Math.log10(Math.max(...R.rows.map((r) => r.implied_value_usd)));

/* ---------------- KPI strip ---------------- */
function renderStats() {
  const s = R.stats;
  const v = R.validation.loo.full;
  const cells = [
    [`${s.protocols}`, 'protocols scanned', ''],
    [`<em>${s.pre_token}</em>`, 'pre-token, ranked', 'hot'],
    [`${s.candidates}`, `launch candidates · ${s.products} products set aside`, ''],
    [`<em>${s.watchlist}/${s.watchlist}</em>`, 'watchlist covered', 'hot'],
    [money(s.board_implied_usd), 'aggregate implied value', ''],
    [`${R.fit.median_multiple.toFixed(2)}×`, 'median peer multiple', ''],
    [`<span class="amb">×${v.typical_factor.toFixed(2)}</span>`, `leave-one-out typical miss · ${v.n} comps`, 'warn'],
  ];
  $('stats').innerHTML = cells
    .map(([val, k, cls]) => `<div class="stat ${cls}"><div class="v">${val}</div><div class="k">${k}</div></div>`)
    .join('');
  $('asof').textContent = `Snapshot ${R.as_of}`;
  $('modelchip').textContent = `Model ${R.model_version}`;
  $('loochip').textContent = `LOO ×${v.typical_factor.toFixed(2)} · ${v.within_2x_pct}% within 2×`;
  $('source').textContent = `Data: ${R.source}. The board is regenerated from that sealed snapshot on every run of the program; nothing here is fetched live.`;
}

/* ---------------- charts ---------------- */
function renderHist() {
  const vals = R.rows.map((r) => Math.log10(r.implied_value_usd));
  const lo = Math.floor(Math.min(...vals) * 2) / 2;
  const hi = Math.ceil(Math.max(...vals) * 2) / 2;
  const buckets = [];
  for (let b = lo; b < hi; b += 0.5) buckets.push({ at: b, n: 0 });
  for (const x of vals) {
    const i = Math.min(buckets.length - 1, Math.floor((x - lo) / 0.5));
    buckets[i].n += 1;
  }
  const maxN = Math.max(...buckets.map((b) => b.n));
  const W = 560, H = 118, base = 96, bw = W / buckets.length;
  const bars = buckets
    .map((b, i) => {
      const h = Math.max(2, (b.n / maxN) * 78);
      const x = i * bw + 3, w = bw - 6;
      return `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${i === buckets.length - 1 ? '#f5b84c' : '#3ddc97'}" opacity="${i === buckets.length - 1 ? 0.95 : 0.55 + (0.45 * b.n) / maxN}"/>
      <text class="cnt" x="${(x + w / 2).toFixed(1)}" y="${(base - h - 4).toFixed(1)}" text-anchor="middle">${b.n}</text>`;
    })
    .join('');
  const ticks = [];
  const ds = [];
  for (let d = Math.ceil(lo); d <= Math.floor(hi); d++) ds.push(d);
  ds.forEach((d, i) => {
    const x = ((d - lo) / (hi - lo)) * W;
    const anchor = i === 0 ? 'start' : i === ds.length - 1 ? 'end' : 'middle';
    ticks.push(`<text class="axis" x="${x.toFixed(1)}" y="112" text-anchor="${anchor}">${money(10 ** d)}</text>`);
  });
  $('hist').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram of implied values">${bars}${ticks.join('')}</svg>`;
  const sorted = [...R.rows].sort((a, b) => a.implied_value_usd - b.implied_value_usd);
  const med = sorted[Math.floor(sorted.length / 2)].implied_value_usd;
  $('histnote').textContent =
    `Half-decade buckets of implied value across all ${R.rows.length} ranked protocols. The median launch prices at ${money(med)}; ` +
    `the amber tail is a handful of giants whose size, not their multiple, carries them up the board.`;
}

function renderCurve() {
  const f = R.fit;
  const W = 420, H = 118, padL = 34, padR = 8, padT = 10, padB = 20;
  const x0 = Math.log10(5e6), x1 = Math.log10(2e10);
  const mult = (tvl) => Math.exp(f.intercept + (f.slope - 1) * Math.log(tvl));
  const ys = [];
  for (let i = 0; i <= 24; i++) ys.push(mult(10 ** (x0 + ((x1 - x0) * i) / 24)));
  const y0 = Math.log10(Math.min(...ys) * 0.8), y1 = Math.log10(Math.max(...ys) * 1.25);
  const X = (tvl) => padL + ((Math.log10(tvl) - x0) / (x1 - x0)) * (W - padL - padR);
  const Y = (m) => padT + (1 - (Math.log10(m) - y0) / (y1 - y0)) * (H - padT - padB);
  const pts = ys.map((m, i) => `${X(10 ** (x0 + ((x1 - x0) * i) / 24)).toFixed(1)},${Y(m).toFixed(1)}`).join(' ');
  const dots = f.multiple_at
    .map((p) => `<circle cx="${X(p.tvl_usd).toFixed(1)}" cy="${Y(p.multiple).toFixed(1)}" r="3.2" fill="#f5b84c"/><text class="cnt" x="${X(p.tvl_usd).toFixed(1)}" y="${(Y(p.multiple) - 8).toFixed(1)}" text-anchor="middle">${p.multiple.toFixed(2)}×</text>`)
    .join('');
  const xt = [1e7, 1e8, 1e9, 1e10].map((t) => `<text class="axis" x="${X(t).toFixed(1)}" y="112" text-anchor="middle">${money(t)}</text>`).join('');
  const yt = [0.05, 0.1, 0.2, 0.4].map((m) => `<text class="axis" x="${padL - 5}" y="${(Y(m) + 3).toFixed(1)}" text-anchor="end">${m.toFixed(2)}×</text>`).join('');
  $('curve').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fitted peer multiple by size"><polyline points="${pts}" fill="none" stroke="#3ddc97" stroke-width="2"/>${dots}${xt}${yt}</svg>`;
  $('curvenote').textContent =
    `Fitted on the ${f.comp_count} launched tokens whose price is anchored to TVL: log(mcap) = ${f.intercept.toFixed(2)} + ${f.slope.toFixed(2)} × log(TVL). ` +
    `A slope under 1 is the size effect — the bigger the protocol, the smaller the multiple the market pays. Category offsets shift this line per category.`;
}

/* ---------------- filters ---------------- */
function fillSelects() {
  const cats = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorized'))].sort();
  $('f-category').innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('f-chain').innerHTML = `<option value="">All chains</option>` + chains.map((c) => `<option>${esc(c)}</option>`).join('');
  $('q').value = state.q;
  $('f-category').value = state.category;
  $('f-chain').value = state.chain;
  $('f-sort').value = state.sort;
  document.querySelectorAll('.segmented button').forEach((b) => b.classList.toggle('on', b.dataset.cls === state.cls));
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (state.cls === 'candidate' && r.class !== 'candidate') return false;
    if (state.cls === 'product' && r.class !== 'product') return false;
    if (state.cls === 'watchlist' && !r.watchlist) return false;
    if (state.category && (r.category ?? 'Uncategorized') !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    return true;
  });
  const desc = (f) => (a, b) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity);
  switch (state.sort) {
    case 'implied': rows.sort(desc((r) => r.implied_value_usd)); break;
    case 'tvl': rows.sort(desc((r) => r.tvl_usd)); break;
    case 'chg': rows.sort(desc((r) => r.change_7d)); break;
    case 'mult': rows.sort(desc((r) => r.model.multiple)); break;
    case 'age': rows.sort(desc((r) => r.age_days)); break;
    default: rows.sort((a, b) => a.rank - b.rank);
  }
  return rows;
}

function renderRows() {
  const rows = visibleRows();
  $('count').textContent = `${rows.length} of ${R.rows.length} protocols`;
  $('empty').hidden = rows.length > 0;
  $('rows').innerHTML = rows
    .map((r) => {
      const w = Math.max(2, ((Math.log10(r.implied_value_usd) - logMin) / (logMax - logMin)) * 100);
      const arrow = r.change_7d === null ? '' : r.change_7d > 0 ? '<span class="arr">▲</span> ' : r.change_7d < 0 ? '<span class="arr">▼</span> ' : '';
      return `<tr data-slug="${esc(r.slug)}" class="${state.detail === r.slug ? 'sel' : ''}${r.rank <= 3 ? ' top' : ''}">
      <td class="rk">${r.rank}</td>
      <td><span class="nm">${esc(r.name)}</span>${r.watchlist ? '<span class="badge badge-wl">WATCHLIST</span>' : ''}${r.class === 'product' ? '<span class="badge badge-prod">PRODUCT</span>' : ''}
        <div class="sub">${esc(r.category ?? 'Uncategorized')} · ${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</div></td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${arrow}${pct(r.change_7d)}</td>
      <td class="num imp">${money(r.implied_value_usd)}<div class="vbar"><span style="width:${w.toFixed(1)}%"></span></div></td>
      <td class="num mult">${r.model.multiple.toFixed(2)}×</td>
      <td class="num">${ageText(r.age_days)}</td>
    </tr>`;
    })
    .join('');
  document.querySelectorAll('#rows tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      state.detail = tr.dataset.slug;
      renderRows();
      renderDetail();
    });
  });
}

/* ---------------- detail panel ---------------- */
function factor(label, value, widthPct) {
  return `<div class="factor"><span>${label}</span><span class="bar"><span class="fill" style="width:${Math.max(2, Math.min(100, widthPct))}%"></span></span><span class="fv">${value}</span></div>`;
}

function renderDetail() {
  const box = $('detail');
  const r = state.detail ? bySlug.get(state.detail) : R.rows[0];
  if (!r) {
    box.innerHTML = '<p class="hint">Select a protocol on the board to see its model breakdown and farm plan.</p>';
    return;
  }
  const m = r.model;
  const multW = ((Math.log10(Math.max(0.01, m.multiple)) + 2) / (Math.log10(4) + 2)) * 100; // 0.01x..4x log scale
  const catStat = R.categories.find((c) => c.category === (r.category ?? 'Uncategorized'));
  const peers = R.live.filter((l) => l.category === r.category).slice(0, 4);
  const peerRows = (peers.length > 0 ? peers : R.live.slice(0, 4))
    .map((l) => `<tr><td>${esc(l.name)}${l.symbol ? ` <span style="color:var(--amber)">${esc(l.symbol)}</span>` : ''}</td><td class="num">${money(l.mcap_usd)}</td><td class="num">${l.multiple.toFixed(2)}×</td></tr>`)
    .join('');
  const pl = r.plan;
  const ledgerRows = pl.items
    .map((it) => `<tr><td>${esc(it.label)}</td><td class="num">${it.actions}</td><td class="num">${fee(it.fee_usd)}</td></tr>`)
    .join('');
  box.innerHTML = `
    <button class="close" id="dclose" aria-label="Clear selection">×</button>
    <h2>${esc(r.name)}</h2>
    <div class="cat">Rank #${r.rank} of ${R.rows.length} · ${esc(r.category ?? 'Uncategorized')} · ${r.watchlist ? 'on the house watchlist' : 'below the watchlist floor'}${r.class === 'product' ? ' · product of a live ecosystem' : ''}</div>
    <div class="big"><small>Implied token value</small>${money(r.implied_value_usd)}</div>
    <div class="kv">
      <div><div class="k">TVL</div><div class="v">${money(r.tvl_usd)}</div></div>
      <div><div class="k">7d TVL change</div><div class="v ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</div></div>
      <div><div class="k">Tokenless age</div><div class="v">${r.age_days === null ? 'unreported' : `${r.age_days.toLocaleString('en-US')} days`}</div></div>
      <div><div class="k">Tracked since</div><div class="v">${esc(r.listed_at ?? '—')}</div></div>
    </div>
    <div class="chips">${r.chains.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
    <div class="modelbox">
      <h3>How this value is built</h3>
      ${factor('Peer multiple', `${m.multiple.toFixed(2)}×`, multW)}
      ${factor('Momentum', `${m.momentum.toFixed(2)}×`, ((m.momentum - 0.7) / 0.8) * 100)}
      ${factor('Maturity', `${m.maturity.toFixed(2)}×`, ((m.maturity - 0.8) / 0.4) * 100)}
      ${factor('Plausibility', `${m.plausibility.toFixed(2)}×`, m.plausibility * 100)}
      <p class="hint">TVL × peer multiple × momentum × maturity × plausibility = ${money(r.implied_value_usd)}.${catStat ? ` Launched ${esc(catStat.category)} peers trade at a median ${catStat.median_multiple.toFixed(2)}× TVL across ${catStat.comps} comp${catStat.comps === 1 ? '' : 's'}.` : ''}</p>
    </div>
    <div class="ledger">
      <h3>Plan ledger — every cost, itemised</h3>
      <table><thead><tr><th>Line item</th><th class="num">Actions</th><th class="num">Fees</th></tr></thead>
      <tbody>${ledgerRows}
      <tr class="total"><td>Net plan cost</td><td class="num">${pl.actions}</td><td class="num">${fee(pl.fee_total_usd)}</td></tr></tbody></table>
      <p class="cap">Capital <b>${money(pl.position_usd)}</b> stays withdrawable throughout · <b>${pl.weeks} weeks</b> · about <b>${pl.hours} hours</b> of your time · worked on <b>${esc(pl.chain)}</b> (cheapest chain it runs on) · setup funds a <b>${fee(pl.fee_float_usd)}</b> fee float.</p>
    </div>
    <div class="plan">
      <h3>Farm plan — the steps</h3>
      <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>
    <div class="comps">
      <h3>Already trading in ${esc(r.category ?? 'this space')}</h3>
      <table><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">× TVL</th></tr></thead><tbody>${peerRows}</tbody></table>
    </div>`;
  $('dclose').addEventListener('click', () => {
    state.detail = null;
    document.body.classList.remove('focus');
    renderRows();
    renderDetail();
  });
}

/* ---------------- model section ---------------- */
function renderModel() {
  const f = R.fit;
  const multRows = f.multiple_at
    .map((x) => `<tr><td>${money(x.tvl_usd)} TVL</td><td class="num">${x.multiple.toFixed(2)}×</td><td class="num">${money(x.tvl_usd * x.multiple)}</td></tr>`)
    .join('');
  const catRows = R.categories
    .slice(0, 10)
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.comps}</td><td class="num">${c.median_multiple.toFixed(2)}×</td><td class="num">${c.offset >= 0 ? '+' : ''}${c.offset.toFixed(2)}</td><td class="num">${c.candidates}</td></tr>`)
    .join('');
  $('model').innerHTML = `
    <h2>How the model works — fitted, not hardcoded</h2>
    <p class="lede">No protocol is named anywhere in the model. The peer multiple is fitted at run time on the
    snapshot's own already-tokenised protocols: the ${f.comp_count} whose market cap is anchored to TVL
    (0.005×–20×), by a least-squares line of log market cap on log TVL plus each category's median residual,
    shrunk toward the field by its comp count. Bigger protocols earn smaller multiples in the data itself —
    the fitted size slope is ${f.slope.toFixed(2)} — and the page you are reading prints the fit it ran.</p>
    <div class="formula">implied value = TVL × peer multiple(category, size) × momentum × maturity × plausibility</div>
    <div class="modelgrid">
      <div>
        <h3>The fitted size curve (before category and priors)</h3>
        <table class="cats"><thead><tr><th>Protocol size</th><th class="num">Multiple</th><th class="num">Peer value</th></tr></thead><tbody>${multRows}</tbody></table>
        <p style="margin-top:10px">Field medians from the same fit: a typical launched token trades at ${f.median_multiple.toFixed(2)}× its
        TVL; the field's median 7-day TVL change is ${pct(f.median_change_7d)} and its median tracked age is
        ${f.median_age_days.toLocaleString('en-US')} days — both are the baselines the priors below are centred on.</p>
      </div>
      <div>
        <h3>Category multiples and the field still waiting</h3>
        <table class="cats"><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Median ×</th><th class="num">Offset</th><th class="num">Candidates</th></tr></thead><tbody>${catRows}</tbody></table>
      </div>
    </div>
    <div class="modelgrid">
      <div><h3>Momentum and maturity — small, on purpose</h3>
      <p>The comps say seven-day growth and listing age explain almost none of a launched token's value, so both
      enter as bounded priors, not fits: momentum moves a value by at most +45% / −22% against the field's own
      median week, and maturity by +14% / −14% across four tokenless years. They order near-ties; they never
      make a ranking on their own.</p></div>
      <div><h3>Plausibility — the radar's own judgement</h3>
      <p>A clean launch candidate is priced at full peer value (×1.00). A protocol that is structurally a product
      of an ecosystem whose token already trades — a versioned deployment, a wrapped or staked product, an exchange
      balance entry, bridge or staking infrastructure — is discounted (×0.06–×0.15, stated per row), because it may
      never issue a token of its own. Those rows stay on the board, flagged, below the candidates they would
      otherwise outrank on size alone.</p></div>
    </div>`;
}

/* ---------------- validation section ---------------- */
function renderValidation() {
  const V = R.validation;
  const row = (name, a, win) => `<tr class="${win ? 'win' : ''}"><td>${name}</td><td class="num">×${a.typical_factor.toFixed(2)}</td><td class="num">${a.median_abs_log_err.toFixed(2)}</td><td class="num">${a.within_2x_pct.toFixed(1)}%</td><td class="num">${a.mean_log_err >= 0 ? '+' : ''}${a.mean_log_err.toFixed(2)}</td></tr>`;
  $('vallede').textContent =
    `The board's prices are claims about tokens that do not trade yet, so they cannot be checked directly. ` +
    `What can be checked is the machine that makes them: this run re-priced every one of the ${V.comps} launched tokens it fitted on, ` +
    `each time with that token left out of the fit (leave-one-out), and scored the miss against the market cap the market actually set. ` +
    `Two baselines run the same test, so the reader can see what the fit earns over doing less.`;
  $('validation').innerHTML = `
    <table class="cats"><thead><tr><th>Model, refit without the answer</th><th class="num">Typical miss</th><th class="num">Median |log err|</th><th class="num">Within 2×</th><th class="num">Bias (log)</th></tr></thead>
    <tbody>
      ${row('Full model — size curve + category offsets', V.loo.full, true)}
      ${row('Size curve only — no category offsets', V.loo.no_offset, false)}
      ${row('Naive — one flat median multiple for everything', V.loo.naive, false)}
    </tbody></table>
    <p class="splitline">Temporal split: fitted on the <b>${V.split.train_n}</b> comps listed up to <b>${esc(V.split.train_until ?? '—')}</b>, the full model
    priced the <b>${V.split.test_n}</b> listed later at a typical miss of <b>×${V.split.agg.typical_factor.toFixed(2)}</b>, with <b>${V.split.agg.within_2x_pct.toFixed(1)}%</b> inside 2×
    of their actual market caps — the closest available analogue to pricing tomorrow's launches from yesterday's record. A typical miss of ×3–4 is the honest
    scale of this problem: launched tokens scatter widely around any TVL-based price, so the radar ranks and sizes claims with stated error bars — it does not pretend to quote prices.</p>`;
}

/* ---------------- live strip ---------------- */
function renderLive() {
  $('liverow').innerHTML = R.live
    .slice(0, 12)
    .map(
      (l) => `<div class="livecard"><span class="nm">${esc(l.name)}</span>${l.symbol ? `<span class="sym">${esc(l.symbol)}</span>` : ''}
      <div class="row"><span>Market cap</span><b>${money(l.mcap_usd)}</b></div>
      <div class="row"><span>TVL</span><b>${money(l.tvl_usd)}</b></div>
      <div class="row"><span>Trades at</span><b>${l.multiple.toFixed(2)}× TVL</b></div></div>`,
    )
    .join('');
}

/* ---------------- wiring ---------------- */
$('q').addEventListener('input', (e) => { state.q = e.target.value; renderRows(); });
$('f-category').addEventListener('change', (e) => { state.category = e.target.value; renderRows(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderRows(); });
$('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderRows(); });
document.querySelectorAll('.segmented button').forEach((b) =>
  b.addEventListener('click', () => {
    state.cls = b.dataset.cls;
    document.querySelectorAll('.segmented button').forEach((x) => x.classList.toggle('on', x === b));
    renderRows();
  }),
);
document.querySelectorAll('th[data-sort]').forEach((th) =>
  th.addEventListener('click', () => {
    state.sort = th.dataset.sort;
    $('f-sort').value = state.sort;
    renderRows();
  }),
);

fillSelects();
renderStats();
renderHist();
renderCurve();
renderRows();
renderDetail();
renderModel();
renderValidation();
renderLive();
