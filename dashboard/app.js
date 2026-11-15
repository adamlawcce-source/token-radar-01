// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the
// model's own inputs, the farm verdict and the farm plan board.json carries. No network.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', verdict: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.abs(n).toFixed(2);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) + 'x' : 'n/a';
  }

  // The model, recomputed in the page, so the detail view can be checked against board.json.
  function impliedOf(row) {
    var f = DATA.fit, m = DATA.model;
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(m.growth_cap, Math.max(m.growth_floor, g));
    var growthM = 1 + (g / 100) * (g >= 0 ? m.growth_up : m.growth_down);
    var chainM = m.chain_base + m.chain_step * Math.min((row.chains || []).length, m.chain_cap);
    var catM = (row.category && m.category_prior[row.category]) || 1;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var top = Math.log(1 + m.maturity_cap_days / m.maturity_scale_days);
    var matM = m.maturity_floor + m.maturity_span * (Math.log(1 + Math.min(Math.max(age, 0), m.maturity_cap_days) / m.maturity_scale_days) / top);
    var curve = Math.exp(f.intercept + f.slope * Math.log(row.tvl_usd));
    return Math.max(1, Math.round(curve * growthM * chainM * catM * matM));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.watchOnly && !r.watched) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var order = { FARM: 0, THIN: 1, SKIP: 2 };
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'slice') { av = a.slice_usd; bv = b.slice_usd; }
      else if (key === 'net') { av = a.farm_net_usd; bv = b.farm_net_usd; }
      else if (key === 'verdict') { av = order[a.verdict]; bv = order[b.verdict]; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' protocols record no token. Here is what each launch would be worth, and how to farm it.' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, picked by the model — not by raw TVL. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // The verdicts on a $1,000 plan, counted across the board.
  function verdictStrip() {
    var counts = { FARM: 0, THIN: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { if (counts[r.verdict] !== undefined) counts[r.verdict]++; });
    return el('section', { class: 'panel strip', 'aria-label': 'Farm verdicts on a $1,000 plan' },
      el('div', { class: 'strip-grid' },
        el('div', { class: 'strip-box farm' }, el('b', { text: 'FARM ' + counts.FARM }), el('span', { text: 'pay after fees and the yield you give up' })),
        el('div', { class: 'strip-box thin' }, el('b', { text: 'THIN ' + counts.THIN }), el('span', { text: 'beat their fees, but not the yield' })),
        el('div', { class: 'strip-box skipv' }, el('b', { text: 'SKIP ' + counts.SKIP }), el('span', { text: 'the slice does not cover the fees' }))
      ),
      el('p', { class: 'sub', text: 'On a $1,000 plan: the slice is what $1,000 deposited would get if 10% of the launch goes to depositors pro rata; fees are the plan\u2019s transactions at the chain\u2019s gas; the yield is a 4% T-bill over the hold.' })
    );
  }

  // The five visible rows whose TVL grew fastest this week.
  function topMovers() {
    var movers = visibleRows().filter(function (r) { return r.change_7d !== null && r.change_7d > 0; })
      .sort(function (a, b) { return b.change_7d - a.change_7d || a.rank - b.rank; }).slice(0, 5);
    if (movers.length === 0) return null;
    return el('section', { class: 'panel movers', 'aria-label': 'Top movers' },
      el('div', { class: 'movers-head' },
        el('h2', { text: 'Top movers' }),
        el('span', { class: 'sub', text: 'Largest 7-day TVL gain among pre-token rows' })
      ),
      el('div', { class: 'movers-grid' }, movers.map(function (r) {
        return el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'mover-name', text: r.name }),
          el('span', { class: 'mover-pct pos', text: fmtPct(r.change_7d) }),
          el('span', { class: 'sub', text: 'Rank ' + r.rank + ' · ' + fmtUsd(r.implied_value_usd) + ' implied' })
        );
      }))
    );
  }

  // The model in plain words, one line per multiplier.
  function explainer() {
    var m = DATA.model, f = DATA.fit;
    return el('section', { class: 'panel explainer' },
      el('h2', { text: 'How the model works' }),
      el('ul', { class: 'how' },
        el('li', null, el('b', { text: 'Curve. ' }), 'Implied value starts on a curve fitted to the ' + f.comps + ' protocols that already have tokens and are launches like the ones ranked — exchanges, bridges and staking receipts are set aside first. log(market cap) = ' + f.intercept + ' + ' + f.slope + ' x log(TVL), fitted at runtime from the snapshot.'),
        el('li', null, el('b', { text: 'Growth. ' }), 'A rising 7-day TVL lifts the score; a falling one counts double against it.'),
        el('li', null, el('b', { text: 'Reach. ' }), 'Each extra chain adds a little: more chains, more users who can reach the protocol.'),
        el('li', null, el('b', { text: 'Category. ' }), 'DEXs and lending score highest; bridges and liquid staking score lowest.'),
        el('li', null, el('b', { text: 'Maturity. ' }), 'The longer a protocol has run with no token, the closer its launch — up to a point.'),
        el('li', null, el('b', { text: 'Verdict. ' }), 'Every row carries a verdict on a $1,000 plan: FARM when the slice pays after fees and the yield you give up, THIN when it beats the fees only, SKIP when it does not cover the fees.'),
        el('li', null, el('b', { text: 'Gas. ' }), 'Fees are priced per transaction by chain: Ethereum $2.40, Base $0.06, Solana $0.01, and $0.50 on a chain the table does not list. The yield is a 4% T-bill over the hold.')
      )
    );
  }

  // The comps scatter: every fitted token against TVL, the curve, and its band.
  function scatterSVG(highlight) {
    var comps = DATA.comps || [];
    var f = DATA.fit;
    if (comps.length === 0) return '';
    var W = 660, H = 300, L = 52, R = 16, T = 14, B = 32;
    var xs = comps.map(function (c) { return Math.log10(c.tvl); });
    var ys = comps.map(function (c) { return Math.log10(c.mcap); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(v) { return L + ((v - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    function tick(e) {
      if (e >= 9) return Math.pow(10, e - 9) + 'B';
      if (e >= 6) return Math.pow(10, e - 6) + 'M';
      return Math.pow(10, e - 3) + 'K';
    }
    function curveLog(tvl) { return (f.intercept + f.slope * Math.log(tvl)) / Math.LN10; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL for the fitted comps, with the curve and its band">';
    var e;
    for (e = x0; e <= x1; e++) {
      s += '<line x1="' + X(e).toFixed(1) + '" y1="' + T + '" x2="' + X(e).toFixed(1) + '" y2="' + (H - B) + '" stroke="#ddd3bf" stroke-width="1"/>';
      s += '<text x="' + X(e).toFixed(1) + '" y="' + (H - B + 16) + '" font-size="10" fill="#6f675a" text-anchor="middle">' + tick(e) + '</text>';
    }
    for (e = y0; e <= y1; e++) {
      s += '<line x1="' + L + '" y1="' + Y(e).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(e).toFixed(1) + '" stroke="#ddd3bf" stroke-width="1"/>';
      s += '<text x="' + (L - 6) + '" y="' + (Y(e) + 3).toFixed(1) + '" font-size="10" fill="#6f675a" text-anchor="end">$' + tick(e) + '</text>';
    }
    s += '<text x="' + ((W - L - R) / 2 + L) + '" y="' + (H - 4) + '" font-size="10" fill="#6f675a" text-anchor="middle">TVL</text>';
    s += '<text x="12" y="' + ((H - T - B) / 2 + T) + '" font-size="10" fill="#6f675a" text-anchor="middle" transform="rotate(-90 12 ' + ((H - T - B) / 2 + T) + ')">market cap</text>';
    var band = 'M ' + X(x0).toFixed(1) + ' ' + Y(curveLog(Math.pow(10, x0)) + Math.log10(f.band_high)).toFixed(1) +
      ' L ' + X(x1).toFixed(1) + ' ' + Y(curveLog(Math.pow(10, x1)) + Math.log10(f.band_high)).toFixed(1) +
      ' L ' + X(x1).toFixed(1) + ' ' + Y(curveLog(Math.pow(10, x1)) + Math.log10(f.band_low)).toFixed(1) +
      ' L ' + X(x0).toFixed(1) + ' ' + Y(curveLog(Math.pow(10, x0)) + Math.log10(f.band_low)).toFixed(1) + ' Z';
    s += '<path d="' + band + '" fill="#a93226" fill-opacity="0.07"/>';
    s += '<line x1="' + X(x0).toFixed(1) + '" y1="' + Y(curveLog(Math.pow(10, x0))).toFixed(1) + '" x2="' + X(x1).toFixed(1) + '" y2="' + Y(curveLog(Math.pow(10, x1))).toFixed(1) + '" stroke="#a93226" stroke-width="2"/>';
    comps.forEach(function (c) {
      s += '<circle cx="' + X(Math.log10(c.tvl)).toFixed(1) + '" cy="' + Y(Math.log10(c.mcap)).toFixed(1) + '" r="2.4" fill="#a93226" fill-opacity="0.55"/>';
    });
    if (highlight) {
      var hx = X(Math.log10(highlight.tvl_usd)), hy = Y(Math.log10(highlight.implied_value_usd));
      s += '<circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="6" fill="#a93226" stroke="#fffdf6" stroke-width="2"/>';
      s += '<text x="' + Math.min(hx + 10, W - 130).toFixed(1) + '" y="' + Math.max(hy - 10, T + 10).toFixed(1) + '" font-size="11" font-weight="600" fill="#211d17">' + esc(highlight.name) + '</text>';
    }
    return s + '</svg>';
  }

  // The comps curve in numbers, with its two blind tests. The error is the honest part.
  function compsCurve() {
    var f = DATA.fit;
    return el('section', { class: 'panel explainer' },
      el('h2', { text: 'Comps curve' }),
      el('div', { class: 'scatter', html: scatterSVG(null) }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'log(market cap) = a + b x log(TVL)' }), el('b', { class: 'num', text: 'a ' + f.intercept + ' · b ' + f.slope })),
        el('div', null, el('span', { text: 'Launch comps fitted' }), el('b', { class: 'num', text: String(f.comps) })),
        el('div', null, el('span', { text: 'Median market cap / TVL' }), el('b', { class: 'num', text: f.median_ratio + 'x' })),
        el('div', null, el('span', { text: 'Blind test: median error, within 3x' }), el('b', { class: 'num', text: (f.holdout_error === null ? 'n/a' : f.holdout_error + '%') + ' · ' + (f.holdout_within3 === null ? 'n/a' : f.holdout_within3 + '%') + ' over ' + f.holdout + ' held out' })),
        el('div', null, el('span', { text: 'One flat multiple on the same set' }), el('b', { class: 'num', text: (f.flat_error === null ? 'n/a' : f.flat_error + '%') + ' · ' + (f.flat_within3 === null ? 'n/a' : f.flat_within3 + '%') + ' within 3x' })),
        el('div', null, el('span', { text: 'Time split: fitted on the older half, tested on the newer' }), el('b', { class: 'num', text: (f.timesplit_error === null ? 'n/a' : f.timesplit_error + '%') + ' · ' + (f.timesplit_within3 === null ? 'n/a' : f.timesplit_within3 + '%') + ' within 3x over ' + f.timesplit })),
        el('div', null, el('span', { text: 'Middle half of the curve\u2019s misses' }), el('b', { class: 'num', text: 'x' + f.band_low + ' .. x' + f.band_high }))
      ),
      el('p', { class: 'sub', text: 'The curve is rough. On a random holdout it lands within 3x for ' + (f.holdout_within3 === null ? '—' : f.holdout_within3 + '%') + ' of tokens, against ' + (f.flat_within3 === null ? '—' : f.flat_within3 + '%') + ' for one flat multiple. On the time split it barely beats the flat multiple: newer tokens are harder to predict, and the page says so. It is a guide for ranking, not a price — the multipliers and the farm plan do the rest of the work.' })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var verdict = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'Any verdict' }),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v, selected: v === state.verdict ? 'selected' : null }); })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdict),
      el('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = (key === 'rank' || key === 'name') ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function nameCell(r) {
    var badge = r.watched ? el('span', { class: 'watch', text: 'WATCH' }) : null;
    return el('div', { class: 'name' },
      el('span', null, el('b', { text: r.name }), badge),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
    );
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search, the watchlist filter or another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.verdict = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var netClass = r.farm_net_usd >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'data-watch': r.watched ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, nameCell(r)),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtMoney(r.slice_usd) }),
        el('td', { class: 'num ' + netClass, text: fmtSigned(r.farm_net_usd) }),
        el('td', null, el('span', { class: 'verdict verdict-' + r.verdict.toLowerCase(), text: r.verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. The $1K slice is what $1,000 deposited would get if 10% of the launch goes to depositors pro rata; net is the slice minus fees and a 4% T-bill over the hold. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('slice', '$1K slice'),
            sortHeader('net', 'Net'),
            sortHeader('verdict', 'Verdict')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( exp(' + DATA.fit.intercept + ' + ' + DATA.fit.slope + ' x ln(tvl_usd)) x growthM x chainM x catM x ageM )  |  ' +
        'growthM = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_up + ' up, x ' + m.growth_down + ' down  |  ' +
        'chainM = ' + m.chain_base + ' + 0.02 x min(chains, ' + m.chain_cap + ')  |  ' +
        'ageM = ' + m.maturity_floor + ' + ' + m.maturity_span + ' x ln(1 + min(age, ' + m.maturity_cap_days + ') / ' + m.maturity_scale_days + ') / ln(1 + ' + m.maturity_cap_days + ' / ' + m.maturity_scale_days + ')  |  ' +
        'band = curve x ' + DATA.fit.band_low + ' .. x' + DATA.fit.band_high + ' (the middle half of the fit\u2019s misses)  |  ' +
        'slice = implied x 10% x $1,000 / tvl  |  fees = transactions x gas(first chain)  |  net = slice - fees - 4% T-bill on $1,000 over the hold'
      ),
      el('p', { class: 'sub', text: 'Growth is punished harder than it is rewarded: a shrinking TVL counts double against the score. Age is a saturating curve — a year with no token already earns most of the maturity weight. catM is a stated category prior (DEX and Lending 1.06, bridges and liquid staking 0.88); an unlisted category scores 1.00. The curve is fitted to the ' + DATA.fit.comps + ' launch-like tokens only — exchange tokens, bridge tokens and staking receipts are set aside before the fit. The early radar is the 160 strongest pre-token protocols below the watchlist floor, picked by this score.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watched ? ' — watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict on a $1,000 plan' }),
      el('div', { class: 'econ' },
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'verdict verdict-' + row.verdict.toLowerCase(), text: row.verdict })),
        el('div', null, el('span', { text: 'Slice' }), el('b', { class: 'num', text: fmtMoney(row.slice_usd) })),
        el('div', null, el('span', { text: 'Fees' }), el('b', { class: 'num', text: fmtMoney(row.farm_fees_usd) })),
        el('div', null, el('span', { text: 'Net' }), el('b', { class: 'num ' + (row.farm_net_usd >= 0 ? 'pos' : 'neg'), text: fmtSigned(row.farm_net_usd) })),
        el('div', null, el('span', { text: 'Could be' }), el('b', { class: 'num', text: fmtUsd(row.value_low_usd) + ' – ' + fmtUsd(row.value_high_usd) }))
      ),
      el('p', { class: 'sub', text: 'The slice is what $1,000 deposited would get if 10% of the launch goes to depositors pro rata. Fees are the plan\u2019s transactions at ' + (row.chains[0] || 'its main chain') + '\u2019s gas; the yield is a 4% T-bill over the hold. The range is the middle half of the curve\u2019s misses.' })
    ));
    var run = row.curve_value_usd;
    var steps = [
      ['Curve value', fmtUsd(row.curve_value_usd), run],
      ['x growth ' + fmtMult(row.growth_multiplier), fmtUsd(run * row.growth_multiplier), run *= row.growth_multiplier],
      ['x chain ' + fmtMult(row.chain_multiplier), fmtUsd(run * row.chain_multiplier), run *= row.chain_multiplier],
      ['x category ' + fmtMult(row.category_multiplier), fmtUsd(run * row.category_multiplier), run *= row.category_multiplier],
      ['x maturity ' + fmtMult(row.maturity_multiplier), fmtUsd(run * row.maturity_multiplier), run *= row.maturity_multiplier],
    ];
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How the value was reached' }),
      el('div', { class: 'equation' },
        steps.map(function (s) { return el('div', null, el('span', { text: s[0] }), el('b', { class: 'num', text: s[1] })); }),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Where it sits on the fitted curve' }),
      el('div', { class: 'scatter', html: scatterSVG(row) }),
      el('p', { class: 'sub', text: 'Each dot is one of the ' + DATA.fit.comps + ' launch tokens the curve is fitted on. The red line is the curve; the band is the middle half of its misses.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        var item = el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
        if (action.indexOf('Risk to watch:') === 0) item.className = 'risk';
        if (action.indexOf('Verdict on a $1,000 plan:') === 0) item.className = 'verdict-step';
        return item;
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(verdictStrip());
    shell.appendChild(explainer());
    shell.appendChild(compsCurve());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      var movers = topMovers();
      if (movers) shell.appendChild(movers);
      shell.appendChild(boardTable());
      shell.appendChild(modelPanel());
    } else {
      shell.appendChild(liveTable());
    }
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + DATA.model_version + ' model' }),
      el('span', { text: 'Implied value is a model, not a price or a promise.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
