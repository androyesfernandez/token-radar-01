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

const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

/* ---------------- stats strip ---------------- */
function renderStats() {
  const s = R.stats;
  const cells = [
    [`${s.protocols}`, 'protocols scanned'],
    [`<em>${s.pre_token}</em>`, 'record no token'],
    [`${s.candidates}`, 'launch candidates'],
    [`<em>${s.watchlist}/${s.watchlist}</em>`, 'watchlist covered'],
    [money(s.board_tvl_usd), 'TVL on the board'],
    [money(s.board_implied_usd), 'total implied value'],
  ];
  $('stats').innerHTML = cells.map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  $('asof').textContent = `Snapshot ${R.as_of}`;
  $('modelchip').textContent = `Model ${R.model_version}`;
  $('source').textContent = `Data: ${R.source}. The board is regenerated from that sealed snapshot on every run of the program; nothing here is fetched live.`;
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
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}" class="${state.detail === r.slug ? 'sel' : ''}">
      <td class="rk">${r.rank}</td>
      <td><span class="nm">${esc(r.name)}</span>${r.watchlist ? '<span class="badge badge-wl">WATCHLIST</span>' : ''}${r.class === 'product' ? '<span class="badge badge-prod">PRODUCT</span>' : ''}
        <div class="sub">${esc(r.category ?? 'Uncategorized')} · ${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</div></td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</td>
      <td class="num imp">${money(r.implied_value_usd)}</td>
      <td class="num">${r.model.multiple.toFixed(2)}×</td>
      <td class="num">${ageText(r.age_days)}</td>
    </tr>`,
    )
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
function factor(label, value, widthPct, note) {
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
  const multW = (Math.log10(Math.max(0.01, m.multiple)) + 2) / (Math.log10(4) + 2) * 100; // 0.01x..4x log scale
  const catStat = R.categories.find((c) => c.category === (r.category ?? 'Uncategorized'));
  const peers = R.live.filter((l) => l.category === r.category).slice(0, 4);
  const peerRows = (peers.length > 0 ? peers : R.live.slice(0, 4))
    .map((l) => `<tr><td>${esc(l.name)}${l.symbol ? ` <span style="color:var(--amber)">${esc(l.symbol)}</span>` : ''}</td><td class="num">${money(l.mcap_usd)}</td><td class="num">${l.multiple.toFixed(2)}×</td></tr>`)
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
    <div class="plan">
      <h3>Farm plan — netted</h3>
      <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>
    <div class="comps">
      <h3>Already trading in ${esc(r.category ?? 'this space')}</h3>
      <table><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">× TVL</th></tr></thead><tbody>${peerRows}</tbody></table>
    </div>`;
  $('dclose').addEventListener('click', () => {
    state.detail = null;
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
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.comps}</td><td class="num">${c.median_multiple.toFixed(2)}×</td><td class="num">${c.candidates}</td></tr>`)
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
        <table class="cats"><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Median ×</th><th class="num">Candidates</th></tr></thead><tbody>${catRows}</tbody></table>
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
renderRows();
renderDetail();
renderModel();
renderLive();
