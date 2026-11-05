const D = JSON.parse(document.getElementById('data').textContent);
const OWN = 'allianzdirect.nl';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 0) => v == null || isNaN(v) ? '·' : Number(v).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => v == null ? '·' : nf(v, d) + '%';
const fmtD = s => { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: '2-digit' }); };
const dnum = s => new Date(s + 'T00:00:00').getTime();
const DAY = 864e5;
const TYPES = { google: { l: 'Google-update', c: 'var(--deep)' }, change: { l: 'Doorgevoerd', c: 'var(--accent)' }, pr: { l: 'PR', c: 'var(--accent-soft)' }, data: { l: 'Datatwijfel', c: 'var(--bad)' } };
const RANGES = [
  { from: '2026-07-05', to: '2026-08-30', tabs: ['google'], l: 'Dubbele meting FolloEngine' },
  { from: '2025-11-11', to: '2025-12-23', tabs: ['aio'], l: 'AIO-meting onvolledig' },
  { from: '2026-01-27', to: '2026-02-08', tabs: ['google', 'aio'], l: 'Geen scrapes' },
  { from: '2026-03-22', to: '2026-04-05', tabs: ['google', 'aio'], l: 'Geen scrapes' }
];
const st = { tab: 'overzicht', sub: { google: 'trend', aio: 'trend', chatgpt: 'trend', aimode: 'snapshot' }, types: { google: 1, change: 1, pr: 1, data: 1 }, phases: true, N: 3, src: 'fe', gm: 'impr', cl: 'alle', hidden: {}, ov: null };

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/>',
  google: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  aio: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  chatgpt: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  aimode: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h8M8 13h5"/>',
  ann: '<path d="M4 4h16v12H8l-4 4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>'
};
const ico = (k, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const TABS = [['overzicht', 'Overzicht', 'home'], ['google', 'Google Search', 'google'], ['aio', 'AI Overviews', 'aio'], ['chatgpt', 'ChatGPT', 'chatgpt'], ['aimode', 'AI Mode', 'aimode'], ['annotaties', 'Annotaties', 'ann'], ['methodologie', 'Methodologie', 'book']];
function nav() {
  $('#tabs').innerHTML = TABS.map(([k, l, i]) => `<a href="#${k}" data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${ico(i)}${l}${k === 'aimode' ? '<span class="soon">Nieuw</span>' : ''}</a>`).join('');
}

/* ===== helpers on annotations ===== */
function annsFor(tab) { return D.annotations.filter(a => st.types[a.type] && (a.tabs.includes('all') || a.tabs.includes(tab) || (tab === 'overzicht'))); }
function linreg(pts) {
  const n = pts.length; if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0; pts.forEach(([x, y]) => { sx += x; sy += y; sxx += x * x; sxy += x * y; });
  const den = n * sxx - sx * sx; if (!den) return null;
  const b = (n * sxy - sx * sy) / den; return { b, a: (sy - b * sx) / n };
}

/* ===== line chart with annotations ===== */
let CH = 0;
function chart(o) {
  // o: {dates, series:[{name, vals, color, own, dash}], tab, fmt, h, onPoint, yMin0, phases}
  const ALL = o.series; o = Object.assign({}, o, { series: ALL.filter(s => !st.hidden[s.name]).length ? ALL.filter(s => !st.hidden[s.name]) : ALL.filter(s => s.own) });
  const id = 'ch' + (++CH), W = 980, H = o.h || 300, L = 52, Rm = 16, T = 26, B = 30;
  const xs = o.dates.map(dnum), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const all = o.series.flatMap(s => s.vals.filter(v => v != null)); if (!all.length) all.push(0, 1);
  let y0 = o.yMin0 === false ? Math.min(...all) : 0, y1 = Math.max(...all);
  if (o.yMin0 === false) { const pad = (y1 - y0) * .1 || 1; y0 -= pad; y1 += pad; } else y1 *= 1.08;
  if (o.invert) { const t = y0; y0 = y1; y1 = t; }
  const X = t => L + (t - x0) / (x1 - x0 || 1) * (W - L - Rm), Y = v => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v); g += `<line class="ax" x1="${L}" x2="${W - Rm}" y1="${y}" y2="${y}"/><text class="tk" x="${L - 8}" y="${y + 4}" text-anchor="end">${esc(o.fmt ? o.fmt(v) : nf(v))}</text>`; }
  const months = []; let d = new Date(x0); d.setDate(1); d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= x1) { months.push(new Date(d)); d.setMonth(d.getMonth() + (o.dates.length > 40 ? 2 : 1)); }
  months.forEach(m => { const x = X(m.getTime()); g += `<text class="tk" x="${x}" y="${H - 8}" text-anchor="middle">${m.toLocaleDateString('nl-NL', { month: 'short', year: '2-digit' })}</text>`; });
  // ranges
  RANGES.filter(r => r.tabs.includes(o.tab) && st.types.data).forEach(r => {
    const a = Math.max(dnum(r.from), x0), b = Math.min(dnum(r.to), x1); if (b <= a) return;
    g += `<rect x="${X(a)}" y="${T}" width="${X(b) - X(a)}" height="${H - T - B}" fill="url(#hatch)" opacity=".55"><title>${esc(r.l)}</title></rect>`;
  });
  // annotations
  const anns = annsFor(o.tab).filter(a => dnum(a.date) >= x0 - 3 * DAY && dnum(a.date) <= x1 + 3 * DAY);
  anns.forEach(a => {
    const x = X(Math.min(Math.max(dnum(a.date), x0), x1)), c = TYPES[a.type].c;
    g += `<g class="ann" data-ann="${D.annotations.indexOf(a)}" tabindex="0" role="button" aria-label="${esc(a.title)}"><line x1="${x}" x2="${x}" y1="${T - 4}" y2="${H - B}" stroke="${c}" stroke-width="1.2" stroke-dasharray="${a.type === 'data' ? '3 3' : a.type === 'google' ? '1 0' : '5 3'}" opacity=".7"/><circle cx="${x}" cy="${T - 10}" r="6" fill="${c}" stroke="var(--surface)" stroke-width="2"/><rect x="${x - 9}" y="${T - 20}" width="18" height="${H - B - T + 20}" fill="transparent"/><title>${esc(fmtD(a.date) + ' · ' + a.title)}</title></g>`;
  });
  // phase trend lines (segmented regression on own series between change/pr annotations)
  const own = o.series.find(s => s.own) || o.series[0];
  if (st.phases && o.phases !== false && own) {
    const cuts = anns.filter(a => a.type === 'change' || a.type === 'pr').map(a => dnum(a.date)).filter(t => t > x0 && t < x1);
    const bounds = [x0, ...cuts, x1 + 1];
    for (let i = 0; i < bounds.length - 1; i++) {
      const pts = xs.map((t, j) => [t, own.vals[j]]).filter(([t, v]) => v != null && t >= bounds[i] && t < bounds[i + 1]);
      if (pts.length < 3) continue;
      const r = linreg(pts.map(([t, v]) => [(t - x0) / DAY, v])); if (!r) continue;
      const ta = pts[0][0], tb = pts[pts.length - 1][0];
      const va = r.a + r.b * (ta - x0) / DAY, vb = r.a + r.b * (tb - x0) / DAY;
      const up = o.invert ? vb < va : vb > va;
      g += `<line x1="${X(ta)}" y1="${Y(va)}" x2="${X(tb)}" y2="${Y(vb)}" stroke="${up ? 'var(--good)' : 'var(--bad)'}" stroke-width="2.5" stroke-dasharray="7 5" opacity=".9"><title>Fase-trend (lineaire trend van ${esc(own.name)} tussen twee doorgevoerde wijzigingen): ${up ? 'verbetert' : 'verslechtert'}</title></line>`;
    }
  }
  // series
  o.series.slice().sort((a, b) => (a.own ? 1 : 0) - (b.own ? 1 : 0)).forEach(s => {
    let p = '', on = false;
    s.vals.forEach((v, j) => { if (v == null) { on = false; return; } p += (on ? 'L' : 'M') + X(xs[j]).toFixed(1) + ' ' + Y(v).toFixed(1); on = true; });
    g += `<path class="ln" fill="none" d="${p}" stroke="${s.color}" stroke-width="${s.own ? 2.8 : 1.6}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} opacity="${s.own ? 1 : .75}"/>`;
  });
  // hover/click columns
  const half = (W - L - Rm) / Math.max(o.dates.length - 1, 1) / 2;
  o.dates.forEach((dt, j) => {
    const x = X(xs[j]); const tip = o.series.filter(s => s.vals[j] != null).slice(0, 6).map(s => `${s.name}: ${o.fmt ? o.fmt(s.vals[j]) : nf(s.vals[j])}`).join('\n');
    g += `<rect class="hit" data-i="${j}" x="${x - half}" y="${T}" width="${half * 2}" height="${H - T - B}" fill="transparent"><title>${esc(fmtD(dt) + '\n' + tip + (o.onPoint ? '\nKlik voor details' : ''))}</title></rect>`;
  });
  if (own) own.vals.forEach((v, j) => { if (v != null && j === own.vals.length - 1) g += `<circle class="dot" cx="${X(xs[j])}" cy="${Y(v)}" r="4.5" fill="${own.color}"/>`; });
  setTimeout(() => {
    const el = document.getElementById(id); if (!el) return;
    el.querySelectorAll('.ann').forEach(n => { const f = () => openAnn(+n.dataset.ann); n.addEventListener('click', f); n.addEventListener('keydown', e => { if (e.key === 'Enter') f(); }); });
    if (o.onPoint) el.querySelectorAll('.hit').forEach(n => { n.style.cursor = 'pointer'; n.addEventListener('click', () => o.onPoint(+n.dataset.i)); });
  });
  const legend = ALL.map(s => `<button class="lgb ${st.hidden[s.name] ? 'off' : ''}" data-ser="${esc(s.name)}" aria-pressed="${!st.hidden[s.name]}" title="Klik om aan of uit te zetten"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('') + (ALL.length > 2 ? `<span class="lgsep"></span><button class="lgb lgall" data-serall="${esc(ALL.filter(s => !s.own).map(s => s.name).join('|'))}">${ALL.filter(s => !s.own).some(s => !st.hidden[s.name]) ? 'Alleen AD' : 'Alles tonen'}</button>` : '');
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Trend')}"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--bad)" stroke-width="1.4" opacity=".35"/></pattern></defs>${g}</svg><div class="lg">${legend}</div></div>`;
}

function annBar(tab) {
  const counts = {}; annsFor(tab).forEach(a => counts[a.type] = (counts[a.type] || 0) + 1);
  return `<div class="annbar"><span class="annlab">Annotaties</span>${Object.entries(TYPES).map(([k, t]) => `<button class="tg ${st.types[k] ? 'on' : ''}" data-type="${k}"><i style="background:${t.c}"></i>${t.l}</button>`).join('')}<span class="sepv"></span><button class="tg ${st.phases ? 'on' : ''}" data-phases="1"><i class="dashi"></i>Fase-trendlijnen</button><button class="linkbtn small" data-go="methodologie">Wat is dit?</button></div>`;
}

/* ===== drawers ===== */
function drawer(html) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="drawer" role="dialog" aria-modal="true"><button class="x">Sluiten</button>${html}</div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov || e.target.classList.contains('x')) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  ov.querySelectorAll('[data-kw]').forEach(n => n.addEventListener('click', () => { close(); openKw(n.dataset.kw); }));
  ov.querySelectorAll('[data-ann]').forEach(n => n.addEventListener('click', () => { close(); openAnn(+n.dataset.ann); }));
  ov.querySelector('.x').focus();
}
function around(series, dates, t, n = 4) {
  const idx = dates.map(dnum);
  const before = idx.map((x, i) => [x, series[i]]).filter(([x, v]) => x < t && v != null).slice(-n).map(p => p[1]);
  const after = idx.map((x, i) => [x, series[i]]).filter(([x, v]) => x >= t && v != null).slice(0, n).map(p => p[1]);
  const m = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  return { b: m(before), a: m(after), nb: before.length, na: after.length };
}
function impactRows(t) {
  const gw = D.gsc_weekly.map(r => r[0]);
  const rows = [
    ['GSC vertoningen per week (URL)', around(D.gsc_cl.alle.url_impr, gw, t), v => nf(v), false],
    ['GSC gem. positie (URL-niveau)', around(D.gsc_cl.alle.url_pos, gw, t), v => nf(v, 1), true],
    ['Google marktaandeel (FE)', around(D.fe_trend.map(r => r[1]), D.fe_dates, t), v => pct(v, 2), false],
    ['AIO citatieaandeel', around(D.aio_trend.map(r => r[4]), D.aio_trend.map(r => r[0]), t), v => pct(v), false],
    ['ChatGPT genoemd (% prompts)', around(D.gpt_trend.map(r => r[2] / r[1] * 100), D.gpt_trend.map(r => r[0]), t), v => pct(v), false]
  ];
  return `<table><thead><tr><th>Metric</th><th class="r">4 metingen ervoor</th><th class="r">4 metingen erna</th><th class="r">Verschil</th></tr></thead><tbody>${rows.map(([l, r, f, inv]) => {
    if (r.b == null || r.a == null) return `<tr><td>${l}</td><td class="r">${r.b == null ? 'geen data' : f(r.b)}</td><td class="r">${r.a == null ? 'nog geen data' : f(r.a)}</td><td class="r">·</td></tr>`;
    const dlt = (r.a - r.b) / Math.abs(r.b) * 100, good = inv ? dlt < 0 : dlt > 0;
    return `<tr><td>${l}</td><td class="r">${f(r.b)}</td><td class="r">${f(r.a)}</td><td class="r"><span class="flag ${good ? 'good' : 'warn'}">${dlt > 0 ? '+' : ''}${nf(dlt, 1)}%</span></td></tr>`;
  }).join('')}</tbody></table>`;
}
function openAnn(i) {
  const a = D.annotations[i], t = dnum(a.date);
  const near = D.annotations.filter(b => b !== a && Math.abs(dnum(b.date) - t) < 21 * DAY);
  drawer(`<p class="eyebrow">${TYPES[a.type].l} · ${fmtD(a.date)}</p><h2>${esc(a.title)}</h2>
  <div class="answer"><p>${esc(a.detail)}</p><div class="kv"><span>Bron</span><b>${esc(a.source)}</b><span>Geldt voor</span><b>${a.tabs.map(x => ({ all: 'Alle kanalen', google: 'Google Search', aio: 'AI Overviews', chatgpt: 'ChatGPT', aimode: 'AI Mode' }[x])).join(', ')}</b></div>${a.url ? `<p><a href="${esc(a.url)}" target="_blank" rel="noopener">Open bron</a></p>` : ''}</div>
  ${a.type === 'data' ? `<div class="note"><b>Let op bij interpretatie.</b> Deze annotatie markeert twijfel over de meting zelf. Verschillen rond deze datum zeggen mogelijk meer over de data dan over de prestaties.</div>` : ''}
  <section><h3>Voor en na</h3><p class="sub">Gemiddelde van de 4 metingen voor en vanaf deze datum. Indicatief: andere gebeurtenissen in dezelfde periode tellen mee.</p><div class="tcard"><div class="scroll">${impactRows(t)}</div></div></section>
  ${near.length ? `<section><h3>In dezelfde periode</h3><div class="tl">${near.map(b => `<button class="r rowbtn" data-ann="${D.annotations.indexOf(b)}"><time>${fmtD(b.date)}</time><i class="tdot" style="background:${TYPES[b.type].c}"></i><span>${esc(b.title)}</span><span class="flag">${TYPES[b.type].l}</span></button>`).join('')}</div></section>` : ''}`);
}

/* ===== streak helpers ===== */
function streaks(vals, ok) {
  let cur = 0, best = 0, run = 0, hits = 0, n = 0;
  vals.forEach(v => { if (v === undefined) return; n++; if (v != null && ok(v)) { run++; hits++; best = Math.max(best, run); } else run = 0; });
  for (let i = vals.length - 1; i >= 0; i--) { const v = vals[i]; if (v != null && ok(v)) cur++; else break; }
  return { cur, best, rate: n ? hits / n : 0 };
}
function growthStreak(vals, inv) {
  const ok = vals.map((v, i) => i && v != null && vals[i - 1] != null ? (inv ? v < vals[i - 1] : v > vals[i - 1]) : null);
  return streaks(ok.map(x => x == null ? null : x ? 1 : 0), v => v === 1);
}
function streakCard(t, s, unit, sub) {
  return `<div class="card"><h4>${t}</h4><p class="cap">${sub}</p><div class="stats"><div><span class="stat-l">Huidige streak</span><span class="num">${s.cur}</span><span class="of">${unit} op rij</span></div><div><span class="stat-l">Langste streak</span><span class="num sm">${s.best}</span><span class="of">${unit}</span></div></div></div>`;
}
function posCls(p) { return p == null ? 'p0' : p <= 1 ? 'p1' : p <= 3 ? 'p2' : p <= 10 ? 'p3' : 'p4'; }
function segN() { return `<div class="seg" role="group" aria-label="Top N">${[1, 3, 10].map(n => `<button data-n="${n}" class="${st.N === n ? 'on' : ''}">Top ${n}</button>`).join('')}</div>`; }

/* ===== keyword drawer ===== */
function openKw(k) {
  const fe = D.fe_kw[k], gq = D.gsc_query_hist[k];
  let html = `<p class="eyebrow">Zoekwoord</p><h2>${esc(k)}</h2>`;
  if (fe) {
    const s = { 1: streaks(fe.pos, v => v <= 1), 3: streaks(fe.pos, v => v <= 3), 10: streaks(fe.pos, v => v <= 10) };
    html += `<div class="grid g3">${[1, 3, 10].map(n => `<div class="card"><h4>Top ${n}</h4><div class="stats"><div><span class="stat-l">Nu</span><span class="num sm">${s[n].cur}</span><span class="of">metingen op rij</span></div><div><span class="stat-l">Record</span><span class="num sm">${s[n].best}</span><span class="of">${pct(s[n].rate * 100, 0)} van de tijd</span></div></div></div>`).join('')}</div>
    <section><h3>Positie in Google (FolloEngine, mobiel)</h3><p class="sub">Zoekvolume ${nf(fe.sv)} · lager is beter · lege plekken: niet in de gemeten resultaten</p><div class="card">${chart({ dates: D.fe_dates, series: [{ name: 'Positie AD', vals: fe.pos, color: 'var(--brand)', own: 1 }], tab: 'google', invert: true, yMin0: false, fmt: v => nf(v, 0), phases: true, label: 'Positie ' + k })}</div></section>`;
  }
  if (gq) {
    html += `<section><h3>Gemiddelde positie in Search Console</h3><p class="sub">Per week, gewogen naar vertoningen · ${nf(gq.impr)} vertoningen in de periode</p><div class="card">${chart({ dates: D.gsc_weekly.map(r => r[0]), series: [{ name: 'GSC positie', vals: gq.pos, color: 'var(--accent)', own: 1 }], tab: 'google', invert: true, yMin0: false, fmt: v => nf(v, 1), label: 'GSC ' + k })}</div></section>`;
  }
  const aio = D.aio_kw.find(r => r.kw === k);
  const ah = D.aio_kw_hist[k];
  if (aio || ah) html += `<section><h3>AI Overviews</h3>${ah && ah.dates.length > 1 ? `<div class="card">${chart({ dates: ah.dates, series: [{ name: 'AD geciteerd (1 = ja)', vals: ah.cited, color: 'var(--brand)', own: 1 }], tab: 'aio', fmt: v => v >= .5 ? 'ja' : 'nee', phases: false })}</div>` : '<div class="note">De grafiek per meting komt mee in de geautomatiseerde run: FolloEngine bewaart per zoekwoord per meting of AD geciteerd is. Hieronder de samenvatting over de hele periode.</div>'}`;
  if (aio) html += `<div class="answer"><div class="kv"><span>AIO getoond</span><b>${pct(aio.aio * 100, 0)} van de metingen</b><span>AD geciteerd</span><b>${pct(aio.our * 100, 0)} van de AIO's</b><span>Laatste 5 metingen</span><b>${aio.recent}% geciteerd</b></div></div></section>`;
  const am = D.aimode.rows.find(r => r.kw === k);
  const mh = D.aimode_hist[k];
  if (am) html += `<section><h3>AI Mode (${fmtD(D.aimode.scraped)})</h3>${mh && mh.dates.length > 1 ? `<div class="card">${chart({ dates: mh.dates, series: [{ name: 'Geciteerd', vals: mh.cited, color: 'var(--brand)', own: 1 }, { name: 'Genoemd', vals: mh.mentioned, color: 'var(--accent-soft)' }], tab: 'aimode', fmt: v => v >= .5 ? 'ja' : 'nee', phases: false })}</div>` : '<div class="note">Eerste meting. Vanaf de tweede run verschijnt hier de grafiek per meting.</div>'}`;
  if (am) html += `<section><div class="answer"><p>${am.cited ? `<span class="chip yes">Geciteerd</span> <a href="${esc(am.ad_url)}" target="_blank" rel="noopener">${esc(am.ad_url)}</a>` : am.mentioned ? '<span class="chip soft">Genoemd, niet geciteerd</span>' : '<span class="chip no">Niet zichtbaar</span>'}</p><p><a href="${esc(am.check)}" target="_blank" rel="noopener">Bekijk in Google AI Mode</a></p></div></section>`;
  html += `<p><a href="https://www.google.com/search?q=${encodeURIComponent(k)}&hl=nl&gl=NL" target="_blank" rel="noopener">Open de zoekresultaten in Google</a></p>`;
  drawer(html);
}

/* ===== drill-downs per point ===== */
function nearAnns(t, tab) { return D.annotations.filter(a => Math.abs(dnum(a.date) - t) <= 10 * DAY && (a.tabs.includes('all') || a.tabs.includes(tab))); }
function annList(list) { return list.length ? `<section><h3>Annotaties rond deze week</h3><div class="tl">${list.map(b => `<button class="r rowbtn" data-ann="${D.annotations.indexOf(b)}"><time>${fmtD(b.date)}</time><i class="tdot" style="background:${TYPES[b.type].c}"></i><span>${esc(b.title)}</span><span class="flag ${b.type === 'data' ? 'warn' : ''}">${TYPES[b.type].l}</span></button>`).join('')}</div></section>` : ''; }
function openGscWeek(i) {
  const w = D.gsc_weekly[i][0], G = D.gsc_cl[st.cl] || D.gsc_cl.alle, im = G.url_impr[i], p = G.url_pos[i], pim = G.url_impr[i - 1];
  const qs = (D.gsc_week_queries[w] || []).filter(r => st.cl === 'alle' || clOfKw(r[0]) === st.cl), ps = (D.gsc_week_pages[w] || []);
  drawer(`<p class="eyebrow">Search Console · week van ${fmtD(w)}${st.cl !== 'alle' ? ' · ' + clName(st.cl) : ''}</p><h2>${nf(im)} vertoningen, positie ${nf(p, 1)}</h2>
  <div class="grid g3"><div class="card"><span class="stat-l">Vertoningen (URL)</span><span class="num sm">${nf(im)}</span>${pim ? `<span class="delta">${im >= pim ? '+' : ''}${nf((im - pim) / pim * 100, 1)}% t.o.v. vorige week</span>` : ''}</div><div class="card"><span class="stat-l">Gem. positie URL-niveau</span><span class="num sm">${nf(p, 1)}</span></div><div class="card"><span class="stat-l">Gem. positie queryniveau</span><span class="num sm">${nf(G.q_pos[i], 1)}</span></div></div>
  ${annList(nearAnns(dnum(w), 'google'))}
  <section><h3>Zoekopdrachten met de meeste vertoningen</h3><div class="tcard"><div class="scroll"><table><thead><tr><th>Zoekopdracht</th><th class="r">Vertoningen</th><th class="r">Positie</th><th class="r">Clicks</th></tr></thead><tbody>${qs.map(r => `<tr class="click" data-kw="${esc(r[0])}"><td>${esc(r[0])}</td><td class="r">${nf(r[2])}</td><td class="r">${nf(r[3], 1)}</td><td class="r">${nf(r[1])}</td></tr>`).join('') || '<tr><td colspan="4">Geen zoekopdrachten in deze steekproef</td></tr>'}</tbody></table></div></div></section>
  <section><h3>Pagina's met de meeste vertoningen</h3><div class="tcard"><div class="scroll"><table><thead><tr><th>Pagina</th><th class="r">Vertoningen</th><th class="r">Positie</th></tr></thead><tbody>${ps.map(r => `<tr><td><a class="trunc" href="${esc(r[0])}" target="_blank" rel="noopener">${esc(r[0].replace('https://www.allianzdirect.nl', '') || '/')}</a></td><td class="r">${nf(r[2])}</td><td class="r">${nf(r[3], 1)}</td></tr>`).join('')}</tbody></table></div></div></section>`);
}
function openFeDate(i) {
  const dt = D.fe_dates[i], FC = D.fe_cl[st.cl] || D.fe_cl.alle, ds = D.fe_dist[i];
  const doms = Object.entries(FC.domains).map(([d, v]) => [d, v[i]]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...doms.map(x => x[1]));
  drawer(`<p class="eyebrow">FolloEngine · meting ${fmtD(dt)}</p><h2>Marktaandeel AD ${pct(FC.share[i], 2)}${st.cl !== 'alle' ? ' in ' + esc(clName(st.cl)) : ''}</h2>
  ${annList(nearAnns(dnum(dt), 'google'))}
  <section><h3>Marktaandeel top 10 domeinen</h3><div class="card"><div class="hb">${doms.map(([d, v]) => `<div class="r ${d === OWN ? 'me' : ''}"><span class="nm">${esc(d)}</span><span class="tr"><i style="width:${v / max * 100}%"></i></span><b>${pct(v, 1)}</b></div>`).join('')}</div></div></section>
  ${ds[1] != null && st.cl === 'alle' ? `<section><h3>Positieverdeling AD</h3><p class="sub">Aantal resultaten van allianzdirect.nl per positiegroep (${nf(ds[6])} zoekwoorden met een AD-resultaat)</p><div class="grid g4">${[['Positie 1', ds[1]], ['Positie 2 tot 3', ds[2]], ['Positie 4 tot 10', ds[3] + ds[4]], ['Positie 11 tot 25', ds[5]]].map(([l, v]) => `<div class="card"><span class="stat-l">${l}</span><span class="num sm">${nf(v)}</span></div>`).join('')}</div></section>` : ''}
  <section><h3>Zoekwoorden op deze datum</h3><div class="tcard"><div class="scroll"><table><thead><tr><th>Zoekwoord</th><th class="r">Volume</th><th class="r">Positie AD</th></tr></thead><tbody>${Object.entries(D.fe_kw).filter(([k, v]) => st.cl === 'alle' || v.cl === st.cl).map(([k, v]) => `<tr class="click" data-kw="${esc(k)}"><td>${esc(k)}</td><td class="r">${nf(v.sv)}</td><td class="r"><span class="pos ${posCls(v.pos[i])}">${v.pos[i] ?? '·'}</span></td></tr>`).join('')}</tbody></table></div></div></section>`);
}
function openAioDate(i) {
  const r = D.aio_trend[i], dt = r[0];
  const doms = Object.entries(D.aio_domains).map(([d, v]) => [d, v[i]]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...doms.map(x => x[1]), 1);
  drawer(`<p class="eyebrow">AI Overviews · meting ${fmtD(dt)}</p><h2>AD in ${nf(r[3])} AI Overviews (${pct(r[4])})</h2>
  ${r[6] ? '<div class="note"><b>Datatwijfel.</b> In deze meting is maar een deel van de AI Overviews gecontroleerd op een AD-citatie. Het aandeel is daardoor onbetrouwbaar.</div>' : ''}
  <div class="grid g3"><div class="card"><span class="stat-l">Zoekwoorden met AIO</span><span class="num sm">${nf(r[1])}</span><span class="of">van ${nf(r[2])} (${pct(r[5])})</span></div><div class="card"><span class="stat-l">AD geciteerd</span><span class="num sm">${nf(r[3])}</span></div><div class="card"><span class="stat-l">Citatieaandeel</span><span class="num sm">${pct(r[4])}</span></div></div>
  ${annList(nearAnns(dnum(dt), 'aio'))}
  <section><h3>Geciteerde domeinen (aantal AIO's)</h3><div class="card"><div class="hb">${doms.map(([d, v]) => `<div class="r ${d === OWN ? 'me' : ''}"><span class="nm">${esc(d)}</span><span class="tr"><i style="width:${v / max * 100}%"></i></span><b>${nf(v)}</b></div>`).join('')}</div></div></section>`);
}
function openGptDate(i) {
  const r = D.gpt_trend[i], dt = r[0];
  const ans = D.gpt_answers.filter(a => a.date === dt);
  const comp = Object.entries(D.gpt_mentions).map(([k, v]) => [k, k === 'allianz direct' ? r[2] / r[1] * 100 : v[i]]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...comp.map(x => x[1]), 1);
  drawer(`<p class="eyebrow">ChatGPT · meting ${fmtD(dt)}</p><h2>Genoemd in ${nf(r[2])} van ${nf(r[1])} antwoorden</h2>
  <div class="grid g3"><div class="card"><span class="stat-l">Genoemd</span><span class="num sm">${pct(r[2] / r[1] * 100)}</span></div><div class="card"><span class="stat-l">Geciteerd (link)</span><span class="num sm">${pct(r[3] / r[1] * 100)}</span></div><div class="card"><span class="stat-l">Prompts gemeten</span><span class="num sm">${nf(r[1])}</span></div></div>
  ${annList(nearAnns(dnum(dt), 'chatgpt'))}
  ${comp.length > 1 ? `<section><h3>Merken in antwoorden</h3><p class="sub">Aandeel antwoorden waarin het merk genoemd wordt</p><div class="card"><div class="hb">${comp.map(([d, v]) => `<div class="r ${d === 'allianz direct' ? 'me' : ''}"><span class="nm">${esc(d)}</span><span class="tr"><i style="width:${v / max * 100}%"></i></span><b>${pct(v)}</b></div>`).join('')}</div></div></section>` : '<div class="note">Geen merkdata voor deze meting.</div>'}
  ${ans.length ? `<section><h3>Antwoorden in de steekproef (${ans.length})</h3><div class="tcard"><div class="scroll"><table><thead><tr><th>Prompt</th><th>Genoemd</th><th>Geciteerd</th></tr></thead><tbody>${ans.map((a, j) => `<tr class="click" data-ans="${D.gpt_answers.indexOf(a)}"><td>${esc(a.prompt)}</td><td>${a.mention === 'yes' ? '<span class="chip yes">Ja</span>' : '<span class="chip no">Nee</span>'}</td><td>${a.citation === 'yes' ? '<span class="chip yes">Ja</span>' : '<span class="chip no">Nee</span>'}</td></tr>`).join('')}</tbody></table></div></div></section>` : '<div class="note">Voor deze datum zijn geen volledige antwoorden geladen. In de geautomatiseerde versie komen alle antwoorden mee.</div>'}`);
  document.querySelectorAll('[data-ans]').forEach(n => n.addEventListener('click', () => { document.querySelector('.ov')?.remove(); openAnswer(+n.dataset.ans); }));
}
function openAnswer(i) {
  const a = D.gpt_answers[i];
  const md = esc(a.answer).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/allianz direct/gi, m => `<mark>${m}</mark>`).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
  drawer(`<p class="eyebrow">ChatGPT-antwoord · ${fmtD(a.date)}</p><h2>${esc(a.prompt)}</h2><div class="chips">${a.mention === 'yes' ? '<span class="chip yes">AD genoemd</span>' : '<span class="chip no">AD niet genoemd</span>'}${a.citation === 'yes' ? '<span class="chip yes">AD geciteerd</span>' : ''}</div><div class="answer"><p>${md}</p></div>${a.cites.length ? `<section><h3>Bronnen</h3><div class="src">${a.cites.map(u => `<a class="s ${u.includes(OWN) ? 'own' : ''}" href="${esc(u)}" target="_blank" rel="noopener"><span class="d">${esc(new URL(u).hostname.replace('www.', ''))}</span><small>${esc(u)}</small></a>`).join('')}</div></section>` : ''}`);
}

/* ===== clusters ===== */
const CLN = Object.fromEntries(D.clusters);
const clName = c => c === 'alle' ? 'Alle clusters' : CLN[c] || c;
function clOfKw(k) {
  k = (k || '').toLowerCase();
  if (D.fe_kw[k]) return D.fe_kw[k].cl;
  if (D.gsc_query_hist[k]) return D.gsc_query_hist[k].cl;
  if (/reis|annuler|wintersport/.test(k)) return 'reisverzekering';
  if (/rechts?bijstand|rechtbijstand|juridis|rechtshulp|dagwaarde|autowaarde|restwaarde|^verzeker/.test(k)) return 'overig';
  if (/inboedel|opstal|woon|huis|woning|aansprakelijk|avp|lekkage|waterschade|brandverzekering|koophuis|huur/.test(k)) return 'woonverzekering';
  if (/schade|groene kaart|steenslag|hagel|ruit|pech|in brand|vandalisme|schadevrije|geparkeerde/.test(k)) return 'autoschade';
  return 'autoverzekering';
}
const inCl = c => st.cl === 'alle' || c === st.cl;
function clBar(note) {
  return `<div class="clbar"><span class="annlab">Cluster</span><div class="seg">${[['alle', 'Alle']].concat(D.clusters).map(([k, l]) => `<button data-cl="${k}" class="${st.cl === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>${note ? `<span class="clnote">${note}</span>` : ''}</div>`;
}
const FC = () => D.fe_cl[st.cl] || D.fe_cl.alle;
const GC = () => D.gsc_cl[st.cl] || D.gsc_cl.alle;
const AC = () => D.aio_cl[st.cl] || D.aio_cl.alle;
const PAL = ['var(--heat-2)', 'var(--heat-3)', 'var(--subtle)', 'var(--accent-soft)', 'var(--heat-4)', 'var(--muted)', 'var(--tint-2)', 'var(--heat-1)'];
function inRange(d, tab) { return RANGES.find(r => r.tabs.includes(tab) && d >= r.from && d <= r.to); }
function idxAtOrBefore(dates, d) { let j = -1; dates.forEach((x, i) => { if (x <= d) j = i; }); return j; }

/* ===== heatmap per meetmoment (GaragePark-stijl) ===== */
st.hv = { aio: 'moment', chatgpt: 'moment' };
function hvSeg(key) {
  return `<div class="hvbar"><span class="annlab">Weergave</span><div class="seg">${[['moment', 'Per meetmoment'], ['samen', 'Samenvatting']].map(([k, l]) => `<button data-hv="${key}:${k}" class="${st.hv[key] === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
}
function heatGrid(o) {
  const rows = o.rows.map(r => Object.assign(r, { s: streaks(r.v, o.ok) }));
  rows.sort((a, b) => b.s.cur - a.s.cur || b.s.best - a.s.best);
  const n = o.dates.length, from = Math.max(0, n - (o.max || 20));
  const col = o.dates.slice(from);
  return `<section><div class="tcard"><div class="thead"><div><h4>${o.title}</h4><p>${o.sub}</p></div></div><div class="scroll"><table class="heat"><thead><tr><th>${o.label || 'Zoekwoord'}</th><th class="r">${o.metaHead}</th><th class="r">Nu</th><th class="r">Record</th>${col.map(d => `<th>${new Date(d + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td class="lab">${r.kw ? `<a href="#" data-kw="${esc(r.kw)}">${esc(r.k)}</a>` : esc(r.k)}</td><td class="r">${r.meta}</td><td class="r"><b>${r.s.cur}</b></td><td class="r">${r.s.best}</td>${r.v.slice(from).map((v, j) => { const [c, t, tip] = o.cell(v); const d = col[j]; return `<td class="c"><button class="${c}" ${r.date ? `data-gd="${d}"` : r.kw ? `data-kw="${esc(r.kw)}"` : ''} title="${esc(fmtD(d) + ': ' + tip)}">${t}</button></td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${col.length + 4}">Geen rijen in dit cluster.</td></tr>`}</tbody></table></div><div class="tfoot"><span>${o.foot || ''}</span></div></div></section>`;
}

/* ===== views ===== */
const last = a => a[a.length - 1];
function kpi(label, val, delta, sub, tab) {
  return `<button class="card feat" data-go="${tab}"><h4>${label}<span class="go">${ico('arrow', 16)}</span></h4><div class="num">${val}</div>${delta}<p class="cap">${sub}</p></button>`;
}
function dl(a, b, inv, d = 1, unit = '%') {
  if (a == null || b == null) return '';
  const v = unit === 'pp' ? a - b : (a - b) / Math.abs(b) * 100; const good = inv ? v < 0 : v > 0;
  return `<div class="delta" style="color:${good ? 'var(--good)' : 'var(--bad)'}">${v > 0 ? '+' : ''}${nf(v, d)}${unit === 'pp' ? ' pp' : unit === 'pos' ? ' posities' : '%'} t.o.v. 4 metingen eerder</div>`;
}

/* ===== opvallendheden per meetmoment ===== */
function insights(i) {
  const d = D.fe_dates[i], p = D.fe_dates[i - 1], out = [];
  const add = (sev, ch, cl, text, act) => out.push({ sev, ch, cl, text, act });
  const flagFe = inRange(d, 'google') || (p && inRange(p, 'google'));
  // marktaandeel per cluster
  ['alle'].concat(D.clusters.map(c => c[0])).forEach(c => {
    const s = D.fe_cl[c].share, a = s[i], b = s[i - 1], b4 = s[i - 4];
    if (a == null || b == null) return;
    const dd = a - b, rel = b ? dd / b : 0;
    if (Math.abs(rel) >= .2 && Math.abs(dd) >= .3) add(dd < 0 ? 'neg' : 'pos', 'Google', c, `Marktaandeel ${c === 'alle' ? 'totaal' : 'in ' + clName(c)} ${dd < 0 ? 'daalt' : 'stijgt'} van ${pct(b, 2)} naar ${pct(a, 2)}${b4 != null ? ` (4 metingen terug ${pct(b4, 2)})` : ''}.`, { tab: 'google', cl: c });
  });
  // zoekwoorden
  Object.entries(D.fe_kw).forEach(([k, v]) => {
    const a = v.pos[i], b = v.pos[i - 1];
    if (a == null && b == null) return;
    const cl = v.cl;
    if (b != null && b <= 3 && (a == null || a > 3)) add('neg', 'Google', cl, `<b>${esc(k)}</b> valt uit de top 3 (${b} naar ${a ?? 'niet gevonden'}). Volume ${nf(v.sv)}.`, { kw: k });
    else if (a != null && a <= 3 && (b == null || b > 3)) add('pos', 'Google', cl, `<b>${esc(k)}</b> komt de top 3 in (${b ?? 'niet gevonden'} naar ${a}). Volume ${nf(v.sv)}.`, { kw: k });
    else if (b != null && b <= 10 && (a == null || a > 10)) add('neg', 'Google', cl, `<b>${esc(k)}</b> valt van pagina 1 (${b} naar ${a ?? 'niet gevonden'}).`, { kw: k });
    else if (a != null && b != null && Math.abs(a - b) >= 5) add(a > b ? 'neg' : 'pos', 'Google', cl, `<b>${esc(k)}</b> ${a > b ? 'zakt' : 'stijgt'} ${Math.abs(a - b)} posities (${b} naar ${a}).`, { kw: k });
  });
  // AIO per cluster
  const ad = D.aio_trend.map(r => r[0]), ai = idxAtOrBefore(ad, d);
  if (ai > 0) ['alle'].concat(D.clusters.map(c => c[0])).forEach(c => {
    const s = D.aio_cl[c].share, a = s[ai], b = s[ai - 1];
    if (a == null || b == null || D.aio_trend[ai][6] || D.aio_trend[ai - 1][6]) return;
    if (Math.abs(a - b) >= 6) add(a < b ? 'neg' : 'pos', 'AI Overviews', c, `AD geciteerd in ${pct(a)} van de AI Overviews ${c === 'alle' ? '' : 'voor ' + clName(c) + ' '}(was ${pct(b)}).`, { tab: 'aio', cl: c });
  });
  // ChatGPT
  const gd = D.gpt_trend.map(r => r[0]), gi = idxAtOrBefore(gd, d);
  if (gi > 0) {
    const sh = j => D.gpt_trend[j][2] / D.gpt_trend[j][1] * 100, a = sh(gi), b = sh(gi - 1);
    if (Math.abs(a - b) >= 5) add(a < b ? 'neg' : 'pos', 'ChatGPT', 'alle', `ChatGPT noemt AD in ${pct(a)} van de antwoorden (vorige meting ${pct(b)}).`, { tab: 'chatgpt' });
    const b4 = gi >= 4 ? sh(gi - 4) : null;
    if (b4 != null && a < b4 * .6) add('neg', 'ChatGPT', 'alle', `Vermeldingen in ChatGPT zijn in 4 metingen bijna gehalveerd (${pct(b4)} naar ${pct(a)}).`, { tab: 'chatgpt' });
  }
  // GSC URL-niveau per cluster
  const gw = D.gsc_weekly.map(r => r[0]), wi = idxAtOrBefore(gw, d);
  if (wi > 0) ['alle'].concat(D.clusters.map(c => c[0])).forEach(c => {
    const G = D.gsc_cl[c], a = G.url_impr[wi], b = G.url_impr[wi - 1], pa = G.url_pos[wi], pb = G.url_pos[wi - 1];
    if (a && b && Math.abs(a - b) / b >= .2) add(a < b ? 'neg' : 'pos', 'Search Console', c, `Vertoningen ${c === 'alle' ? 'totaal' : clName(c)} ${a < b ? 'dalen' : 'stijgen'} ${nf(Math.abs(a - b) / b * 100, 0)}% in de week van ${fmtD(gw[wi])}.`, { tab: 'google', cl: c, gsc: wi });
    if (pa && pb && Math.abs(pa - pb) >= 1.5) add(pa > pb ? 'neg' : 'pos', 'Search Console', c, `Gemiddelde URL-positie ${c === 'alle' ? '' : clName(c) + ' '}${pa > pb ? 'verslechtert' : 'verbetert'} van ${nf(pb, 1)} naar ${nf(pa, 1)}.`, { tab: 'google', cl: c, gsc: wi });
  });
  // annotaties sinds vorige meting
  D.annotations.filter(a => p && a.date > p && a.date <= d && st.types[a.type]).forEach(a => add(a.type === 'data' ? 'data' : 'info', TYPES[a.type].l, 'alle', esc(a.title), { ann: D.annotations.indexOf(a) }));
  if (flagFe) add('data', 'Datatwijfel', 'alle', `Deze meting valt in een periode met twijfel over de FolloEngine-data (${esc(flagFe.l)}). Verschillen in Google-cijfers kunnen door de meting komen.`, { tab: 'annotaties' });
  const order = { data: 0, neg: 1, pos: 2, info: 3 };
  return out.filter(x => inCl(x.cl) || x.cl === 'alle').sort((a, b) => order[a.sev] - order[b.sev]);
}
function insightBlock() {
  const n = D.fe_dates.length; if (st.ov == null) st.ov = n - 1;
  const i = st.ov, items = insights(i);
  const icon = { neg: '▼', pos: '▲', info: '•', data: '!' };
  const opts = D.fe_dates.slice(1).map((d, j) => `<option value="${j + 1}" ${j + 1 === i ? 'selected' : ''}>${fmtD(d)}</option>`).reverse().join('');
  const cnt = s => items.filter(x => x.sev === s).length;
  return `<div class="ins"><div class="inshead"><div><p class="eyebrow">Opvallendheden per meetmoment</p><h2>Wat vraagt aandacht op <span class="hl">${fmtD(D.fe_dates[i])}</span>?</h2><p>Vergeleken met de vorige meting (${fmtD(D.fe_dates[i - 1])}). ${cnt('neg')} punten van aandacht, ${cnt('pos')} verbeteringen${cnt('data') ? `, ${cnt('data')} datatwijfel` : ''}.</p></div><label class="inssel">Meetmoment<select id="ovsel">${opts}</select></label></div>
  <div class="inslist">${items.slice(0, 10).map((x, j) => `<button class="insrow ${x.sev}" data-ins="${j}"><span class="insic">${icon[x.sev]}</span><span class="insch">${esc(x.ch)}${x.cl !== 'alle' ? ` · ${esc(clName(x.cl))}` : ''}</span><span class="instx">${x.text}</span></button>`).join('') || '<p>Geen opvallende verschuivingen bij deze meting.</p>'}${items.length > 10 ? `<p class="insmore">${items.length - 10} kleinere punten niet getoond. Kies een cluster om te filteren.</p>` : ''}</div></div>`;
}
function bindInsights() {
  const sel = $('#ovsel'); if (sel) sel.addEventListener('change', () => { st.ov = +sel.value; render(); });
  const items = insights(st.ov);
  document.querySelectorAll('[data-ins]').forEach(n => n.addEventListener('click', () => {
    const a = items[+n.dataset.ins].act;
    if (a.kw) return openKw(a.kw);
    if (a.ann != null) return openAnn(a.ann);
    if (a.cl) st.cl = a.cl;
    if (a.gsc != null) { st.tab = 'google'; render(); return openGscWeek(a.gsc); }
    st.tab = a.tab; location.hash = st.tab; render(); window.scrollTo(0, 0);
  }));
}

function viewOverzicht() {
  const F = FC(), G = GC(), A = AC(), fi = D.fe_dates.length - 1, gi = D.gsc_weekly.length - 1, ai = D.aio_trend.length - 1;
  const gp = D.gpt_trend, c1 = last(gp), c0 = gp[gp.length - 5];
  const am = D.aimode.rows.filter(r => inCl(r.cl)), amv = am.filter(r => r.cited || r.mentioned).length;
  const recent = D.annotations.slice().reverse().filter(a => st.types[a.type]).slice(0, 6);
  const idx = vals => { const base = vals.find(v => v != null); return vals.map(v => v == null ? null : v / base * 100); };
  const pick = (dates, vals) => D.fe_dates.map(d => { let best = null, bd = 1e15; dates.forEach((x, i) => { const dd = Math.abs(dnum(x) - dnum(d)); if (dd < bd && dd <= 4 * DAY) { bd = dd; best = vals[i]; } }); return best; });
  return `<div class="head"><div><p class="eyebrow">Allianz Direct · Search & AI monitor</p><h1>Hoe vindbaar is <span class="p">Allianz Direct</span>, en waarom?</h1><p class="lede">Marktaandeel, vertoningen en posities in Google, en zichtbaarheid in AI Overviews, ChatGPT en AI Mode, naast wat er is doorgevoerd en wat Google heeft aangepast.</p></div></div>
  ${clBar(st.cl !== 'alle' ? 'ChatGPT-cijfers zijn niet per cluster beschikbaar' : '')}
  <div class="band insband"><div>${insightBlock()}</div><div><p class="eyebrow">Datakwaliteit</p><p class="big">${D.annotations.filter(a => a.type === 'data').length} datatwijfels gemarkeerd</p><p>Gestreepte vlakken en oranje stippellijnen in de grafieken tonen periodes waarin de meting zelf niet klopt. Lees die stukken met een korrel zout.</p><p><button class="linkbtn onDeep" data-go="methodologie">Hoe we meten</button></p></div></div>
  <section><h3>Kanalen${st.cl !== 'alle' ? ' · ' + esc(clName(st.cl)) : ''}</h3><p class="sub">Laatste meting, vergeleken met 4 metingen eerder</p><div class="grid g4">
  ${kpi('Google marktaandeel', pct(F.share[fi], 2), dl(F.share[fi], F.share[fi - 4], false, 2, 'pp'), `FolloEngine, ${nf(F.kw)} zoekwoorden · URL-positie GSC ${nf(G.url_pos[gi], 1)}`, 'google')}
  ${kpi('AI Overviews', pct(A.share[ai]), dl(A.share[ai], A.share[ai - 4], false, 1, 'pp'), `Aandeel AIO's waarin AD geciteerd wordt`, 'aio')}
  ${kpi('ChatGPT', pct(c1[2] / c1[1] * 100), dl(c1[2] / c1[1] * 100, c0[2] / c0[1] * 100, false, 1, 'pp'), `Genoemd in ${c1[2]} van ${c1[1]} prompts (alle clusters)`, 'chatgpt')}
  ${kpi('AI Mode', `${amv}/${am.length}`, `<div class="delta">${D.aimode.runs > 1 ? D.aimode.runs + ' metingen' : 'Eerste meting'}</div>`, `Zoekwoorden waar AD genoemd of geciteerd wordt`, 'aimode')}
  </div></section>
  <section><h3>Ontwikkeling naast elkaar</h3><p class="sub">Index (eerste meting = 100) zodat kanalen met verschillende schalen vergelijkbaar zijn. Klik op een lijn in de legenda om hem aan of uit te zetten.</p>${annBar('overzicht')}<div class="card">${chart({ dates: D.fe_dates, series: [{ name: 'Google marktaandeel (FE)', vals: idx(F.share), color: 'var(--brand)', own: 1 }, { name: 'GSC vertoningen (URL)', vals: idx(pick(D.gsc_weekly.map(r => r[0]), G.url_impr)), color: 'var(--accent-soft)' }, { name: 'AIO citatieaandeel', vals: idx(pick(D.aio_trend.map(r => r[0]), D.aio_trend.map((r, j) => r[6] ? null : A.share[j]))), color: 'var(--accent)', dash: 1 }], tab: 'overzicht', fmt: v => nf(v), label: 'Index alle kanalen', onPoint: i => { st.ov = Math.max(1, i); render(); window.scrollTo(0, 0); } })}</div></section>
  <section><h3>Laatste annotaties</h3><div class="tl">${recent.map(b => `<button class="r rowbtn" data-ann="${D.annotations.indexOf(b)}"><time>${fmtD(b.date)}</time><i class="tdot" style="background:${TYPES[b.type].c}"></i><span>${esc(b.title)}</span><span class="flag ${b.type === 'data' ? 'warn' : ''}">${TYPES[b.type].l}</span></button>`).join('')}</div><p><button class="linkbtn" data-go="annotaties">Alle ${D.annotations.length} annotaties</button></p></section>`;
}
function subtabs(key, items) { return `<div class="subtabs" role="tablist">${items.map(([id, l]) => `<button role="tab" data-sub="${key}:${id}" aria-selected="${st.sub[key] === id}" class="${st.sub[key] === id ? 'on' : ''}">${l}</button>`).join('')}</div>`; }

function viewGoogle() {
  const s = st.sub.google, F = FC();
  let h = `<div class="head"><div><p class="eyebrow">Google Search</p><h1>Organisch in <span class="p">Google</span></h1><p class="lede">Marktaandeel tegen concurrenten in de FolloEngine-zoekwoordenset (${nf(F.kw)} zoekwoorden${st.cl !== 'alle' ? ' in ' + esc(clName(st.cl)) : ''}), plus vertoningen en gemiddelde positie op URL- en queryniveau uit Search Console.</p></div>${subtabs('google', [['trend', 'Trend'], ['streaks', 'Streaks'], ['woorden', 'Zoekwoorden']])}</div>${clBar()}`;
  if (s === 'trend') {
    h += annBar('google');
    const comps = Object.entries(F.domains).filter(([d]) => d !== OWN).slice(0, 7);
    h += `<section><h3>Marktaandeel tegen concurrenten</h3><p class="sub">Aandeel van het geschatte verkeer in de zoekwoordenset${st.cl !== 'alle' ? ' van dit cluster' : ''}. Zet concurrenten aan of uit via de legenda. Klik op een meting voor domeinen en zoekwoorden.</p><div class="card">${chart({ dates: D.fe_dates, series: [{ name: OWN, vals: F.share, color: 'var(--brand)', own: 1 }, ...comps.map(([d, v], i) => ({ name: d, vals: v, color: PAL[i % PAL.length] }))], tab: 'google', fmt: v => pct(v, 1), onPoint: openFeDate, label: 'Marktaandeel' })}</div></section>`;
    const G = GC(), gw = D.gsc_weekly.map(r => r[0]);
    h += `<section><div class="thead0"><div><h3>Search Console per week${st.cl !== 'alle' ? ' · ' + esc(clName(st.cl)) : ''}</h3><p class="sub">${st.gm === 'impr' ? 'Vertoningen op URL-niveau: elke pagina telt mee.' : 'URL-niveau: elke pagina telt met haar eigen positie. Queryniveau: elke zoekopdracht telt met haar eigen positie, ook waar AD op pagina 2 of 3 staat.'} Alleen Nederland. Klik op een week voor zoekopdrachten en pagina\'s.</p></div><div class="seg">${[['impr', 'Vertoningen'], ['pos', 'Gem. positie']].map(([k, l]) => `<button data-gm="${k}" class="${st.gm === k ? 'on' : ''}">${l}</button>`).join('')}</div></div><div class="card">${st.gm === 'impr'
      ? chart({ dates: gw, series: [{ name: 'Vertoningen (URL-niveau)', vals: G.url_impr, color: 'var(--brand)', own: 1 }], tab: 'google', fmt: v => nf(v), onPoint: openGscWeek, label: 'Vertoningen' })
      : chart({ dates: gw, series: [{ name: 'Gem. positie URL-niveau', vals: G.url_pos, color: 'var(--brand)', own: 1 }, { name: 'Gem. positie queryniveau', vals: G.q_pos, color: 'var(--accent)', dash: 1 }], tab: 'google', fmt: v => nf(v, 1), invert: true, yMin0: false, onPoint: openGscWeek, label: 'Positie' })}</div></section>`;
    if (st.cl === 'alle') {
      const ds = D.fe_dist;
      h += `<section><h3>Positieverdeling allianzdirect.nl</h3><p class="sub">Aantal AD-resultaten in positie 1, top 3 en top 10 per meting.</p><div class="card">${chart({ dates: D.fe_dates, series: [{ name: 'Top 10', vals: ds.map(r => r[1] == null ? null : r[1] + r[2] + r[3] + r[4]), color: 'var(--accent-soft)' }, { name: 'Top 3', vals: ds.map(r => r[1] == null ? null : r[1] + r[2]), color: 'var(--accent)' }, { name: 'Positie 1', vals: ds.map(r => r[1]), color: 'var(--brand)', own: 1 }], tab: 'google', onPoint: openFeDate, label: 'Positieverdeling' })}</div></section>`;
    }
  } else if (s === 'streaks') h += streakView();
  else h += wordsView();
  return h;
}
function streakView() {
  const N = st.N, src = st.src, G = GC(), F = FC(), A = AC();
  const cards = `<div class="grid g4">${streakCard('Groei vertoningen', growthStreak(G.url_impr), 'weken', 'GSC URL-niveau, week op week meer')}${streakCard('Betere URL-positie', growthStreak(G.url_pos, true), 'weken', 'GSC, positie week op week beter')}${streakCard('Groei marktaandeel', growthStreak(F.share), 'metingen', 'FolloEngine, hoger dan vorige meting')}${streakCard('Groei AIO-citaties', growthStreak(D.aio_trend.map((r, j) => r[6] ? null : A.share[j])), 'metingen', 'Aandeel AIO met AD hoger')}</div>`;
  let rows, dates;
  if (src === 'fe') { dates = D.fe_dates; rows = Object.entries(D.fe_kw).filter(([k, v]) => inCl(v.cl)).map(([k, v]) => ({ k, sv: v.sv, pos: v.pos })); }
  else { dates = D.gsc_weekly.map(r => r[0]); rows = Object.entries(D.gsc_query_hist).filter(([k, v]) => !v.brand && inCl(v.cl)).slice(0, 40).map(([k, v]) => ({ k, sv: v.impr, pos: v.pos })); }
  rows.forEach(r => r.s = streaks(r.pos, v => v <= N));
  rows.sort((a, b) => b.s.cur - a.s.cur || b.s.best - a.s.best || b.sv - a.sv);
  const shown = 20, from = dates.length - shown, col = dates.slice(from);
  const tbl = `<div class="tcard"><div class="thead"><div><h4>Zoekwoorden in de top ${N}</h4><p>Elke cel is een meting. Paars: AD stond in de top ${N}. Getal: positie. Klik op een zoekwoord voor de volledige historie.</p></div><div class="ctl">${segN()}<div class="seg">${[['fe', 'FolloEngine'], ['gsc', 'Search Console']].map(([k, l]) => `<button data-src="${k}" class="${src === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div><div class="scroll"><table class="heat"><thead><tr><th>Zoekwoord</th><th class="r">${src === 'fe' ? 'Volume' : 'Vertoningen'}</th><th class="r">Nu</th><th class="r">Record</th>${col.map(d => `<th>${new Date(d + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td class="lab"><a href="#" data-kw="${esc(r.k)}">${esc(r.k)}</a></td><td class="r">${nf(r.sv)}</td><td class="r"><b>${r.s.cur}</b></td><td class="r">${r.s.best}</td>${r.pos.slice(from).map(v => `<td class="c"><button data-kw="${esc(r.k)}" class="${v != null && v <= N ? (v <= 1 ? 'h5' : v <= 3 ? 'h4' : 'h3') : v != null ? 'h1' : 'h0'}" title="${v == null ? 'niet gevonden' : 'positie ' + nf(v, 1)}">${v == null ? '' : Math.round(v)}</button></td>`).join('')}</tr>`).join('') || '<tr><td colspan="24">Geen zoekwoorden in dit cluster in deze set.</td></tr>'}</tbody></table></div><div class="tfoot"><span>${src === 'fe' ? 'FolloEngine: 36 belangrijkste zoekwoorden op volume, wekelijkse mobiele meting.' : 'Search Console: top 40 niet-merk zoekopdrachten op vertoningen, gemiddelde positie per week.'}</span></div></div>`;
  return `<section><h3>Streaks</h3><p class="sub">Hoe lang houden we iets vol? Huidige streak loopt tot de laatste meting, record is de langste reeks in de periode.</p>${cards}</section><section>${tbl}</section>`;
}
function wordsView() {
  const rows = Object.entries(D.fe_kw).filter(([k, v]) => inCl(v.cl)).map(([k, v]) => { const p = v.pos.filter(x => x != null); const cur = last(v.pos), prev = v.pos[v.pos.length - 5]; return { k, sv: v.sv, cl: v.cl, cur, prev, best: p.length ? Math.min(...p) : null }; });
  return `<section><div class="tcard"><div class="thead"><div><h4>Belangrijkste zoekwoorden</h4><p>Huidige positie in Google (FolloEngine), 4 metingen eerder en de beste positie in de periode. Klik voor de historie, GSC-positie, AIO- en AI Mode-status.</p></div></div><div class="scroll"><table><thead><tr><th>Zoekwoord</th><th>Cluster</th><th class="r">Volume</th><th class="r">Nu</th><th class="r">4 metingen terug</th><th class="r">Beste</th><th class="r">Verschil</th></tr></thead><tbody>${rows.map(r => `<tr class="click" data-kw="${esc(r.k)}"><td>${esc(r.k)}</td><td><span class="chip soft">${esc(clName(r.cl))}</span></td><td class="r">${nf(r.sv)}</td><td class="r"><span class="pos ${posCls(r.cur)}">${r.cur ?? '·'}</span></td><td class="r">${r.prev ?? '·'}</td><td class="r">${r.best ?? '·'}</td><td class="r">${r.cur != null && r.prev != null ? `<span class="flag ${r.cur <= r.prev ? 'good' : 'warn'}">${r.cur < r.prev ? '+' + (r.prev - r.cur) : r.cur > r.prev ? '−' + (r.cur - r.prev) : '0'}</span>` : '·'}</td></tr>`).join('')}</tbody></table></div></div></section>`;
}
function viewAio() {
  const s = st.sub.aio, t = D.aio_trend, dates = t.map(r => r[0]), A = AC();
  let h = `<div class="head"><div><p class="eyebrow">AI Overviews</p><h1>Geciteerd in <span class="p">AI Overviews</span></h1><p class="lede">Hoe vaak toont Google een AI Overview in de zoekwoordenset, en in welk deel daarvan wordt allianzdirect.nl als bron genoemd.</p></div>${subtabs('aio', [['trend', 'Trend'], ['streaks', 'Streaks']])}</div>${clBar()}`;
  if (s === 'trend') {
    h += annBar('aio');
    const clSeries = st.cl === 'alle' ? D.clusters.map(([c, l], i) => ({ name: l, vals: D.aio_cl[c].share, color: PAL[i % PAL.length] })) : [];
    h += `<section><h3>Citatieaandeel allianzdirect.nl${st.cl !== 'alle' ? ' · ' + esc(clName(st.cl)) : ''}</h3><p class="sub">Aandeel van de AI Overviews waarin AD geciteerd wordt${st.cl === 'alle' ? ', totaal en per cluster (zet clusters aan of uit in de legenda)' : ''}. Gestreept: meting onvolledig. Klik op een meting voor de domeinen.</p><div class="card">${chart({ dates, series: [{ name: 'AD citatieaandeel', vals: A.share, color: 'var(--brand)', own: 1 }, { name: 'Zoekwoorden met AIO (%)', vals: A.trig, color: 'var(--accent-soft)', dash: 1 }, ...clSeries], tab: 'aio', fmt: v => pct(v, 0), onPoint: openAioDate, label: 'AIO citatieaandeel' })}</div></section>`;
    h += `<section><h3>Aantal AIO's met citatie per domein</h3><p class="sub">Alle clusters samen${st.cl !== 'alle' ? '; per cluster komt dit mee in de geautomatiseerde run' : ''}. Zet domeinen aan of uit via de legenda.</p><div class="card">${chart({ dates, series: Object.entries(D.aio_domains).map(([d, v], i) => d === OWN ? { name: d, vals: v, color: 'var(--brand)', own: 1 } : { name: d, vals: v, color: PAL[i % PAL.length] }), tab: 'aio', onPoint: openAioDate, label: 'AIO per domein', phases: false })}</div></section>`;
    h += `<section><div class="tcard"><div class="thead"><div><h4>Leaderboard hele periode</h4><p>Aantal AI Overviews waarin het domein voorkomt en het aandeel van alle AIO's</p></div></div><div class="scroll"><table><thead><tr><th>#</th><th>Domein</th><th class="r">AIO's</th><th class="r">Aandeel</th></tr></thead><tbody>${D.aio_leaderboard.map((r, i) => `<tr class="${r[0] === OWN ? 'own' : ''}"><td><span class="rank">${i + 1}</span></td><td>${esc(r[0])}</td><td class="r">${nf(r[1])}</td><td class="r"><div class="meter"><span class="t"><i style="width:${r[2]}%"></i></span><b>${pct(r[2])}</b></div></td></tr>`).join('')}</tbody></table></div></div></section>`;
  } else {
    const cs = growthStreak(t.map((r, j) => r[6] ? null : A.share[j]));
    const rows = D.aio_kw.filter(r => inCl(r.cl)).sort((a, b) => b.recent - a.recent || b.our - a.our);
    h += hvSeg('aio');
    if (st.hv.aio === 'moment') {
      const H = Object.entries(D.aio_kw_hist).filter(([k, v]) => inCl(v.cl));
      h += `<section><div class="grid g3">${streakCard('Groei citatieaandeel', cs, 'metingen', 'Onvolledige metingen tellen niet mee')}${streakCard('Zoekwoorden met AD in de AIO', streaks(D.aio_hist_dates.map((d, i) => H.filter(([k, v]) => v.v[i] > 0).length), v => v >= 3), 'metingen', '3 of meer van deze zoekwoorden met AD als bron')}<div class="card"><h4>Nu geciteerd</h4><div class="num">${H.filter(([k, v]) => last(v.v) > 0).length}</div><p class="cap">van ${H.length} zoekwoorden bij de laatste meting</p></div></div></section>`;
      h += heatGrid({
        title: 'AD als bron in de AI Overview, per meting',
        sub: 'Elke cel is een meting. Paars: AD staat als bron in de AIO, het getal is de plek van AD in de bronnenlijst. Lichtpaars: wel een AIO, zonder AD. Leeg: geen AIO getoond. Klik voor het zoekwoordprofiel.',
        dates: D.aio_hist_dates, metaHead: 'Volume',
        rows: H.map(([k, v]) => ({ k, kw: k, meta: nf(v.sv), v: v.v })),
        ok: v => v > 0,
        cell: v => v == null ? ['h0', '', 'niet gemeten'] : v < 0 ? ['h0', '', 'geen AI Overview'] : v === 0 ? ['h1', '', 'AIO zonder AD'] : [v <= 1 ? 'h5' : v <= 3 ? 'h4' : 'h3', v, 'AD bron op plek ' + v],
        foot: `De ${H.length} grootste zoekwoorden op volume met een AIO-meting, laatste 20 metingen. Bij een dubbele meting op één dag telt de beste uitkomst.`
      });
    } else
    h += `<section><h3>Streaks</h3><p class="sub">Op clusterniveau: metingen op rij met een hoger citatieaandeel. Per zoekwoord: hoe vaak AD in de AIO stond, over de hele periode en in de laatste 5 metingen.</p><div class="grid g3">${streakCard('Groei citatieaandeel', cs, 'metingen', 'Onvolledige metingen tellen niet mee')}<div class="card"><h4>Altijd geciteerd, laatste 5</h4><div class="num">${rows.filter(r => r.recent === 100).length}</div><p class="cap">zoekwoorden waar AD in alle 5 recente AIO's staat</p></div><div class="card"><h4>Nooit geciteerd, laatste 5</h4><div class="num">${rows.filter(r => r.recent === 0).length}</div><p class="cap">zoekwoorden met AIO maar zonder AD</p></div></div></section>
    <section><div class="tcard"><div class="thead"><div><h4>Zoekwoorden</h4><p>Paarse balk: aandeel van de metingen met AD in de AIO. Klik voor de historie.</p></div></div><div class="scroll"><table><thead><tr><th>Zoekwoord</th><th>Cluster</th><th class="r">Volume</th><th class="r">AIO getoond</th><th class="r">AD geciteerd, hele periode</th><th class="r">Laatste 5 metingen</th></tr></thead><tbody>${rows.map(r => `<tr class="click" data-kw="${esc(r.kw)}"><td>${esc(r.kw)}</td><td><span class="chip soft">${esc(clName(r.cl))}</span></td><td class="r">${nf(r.sv)}</td><td class="r">${pct(r.aio * 100, 0)}</td><td class="r"><div class="meter"><span class="t"><i style="width:${r.our * 100}%"></i></span><b>${pct(r.our * 100, 0)}</b></div></td><td class="r"><span class="flag ${r.recent >= 80 ? 'good' : r.recent === 0 ? 'warn' : ''}">${r.recent}%</span></td></tr>`).join('')}</tbody></table></div><div class="tfoot"><span>De ${rows.length} grootste zoekwoorden op volume uit de FolloEngine AIO-set (${nf(last(D.aio_trend)[2])} zoekwoorden)</span></div></div></section>`;
  }
  return h;
}
function viewGpt() {
  const s = st.sub.chatgpt, t = D.gpt_trend, dates = t.map(r => r[0]);
  let h = `<div class="head"><div><p class="eyebrow">ChatGPT</p><h1>Genoemd door <span class="p">ChatGPT</span></h1><p class="lede">${nf(t[t.length - 1][1])} prompts per week rond verzekeringen. Genoemd: het merk komt in het antwoord voor. Geciteerd: allianzdirect.nl staat als bron in het antwoord.</p></div>${subtabs('chatgpt', [['trend', 'Trend'], ['streaks', 'Streaks'], ['antwoorden', 'Antwoorden']])}</div>${clBar(st.cl !== 'alle' ? 'Trends zijn voor alle prompts; de prompttabel is gefilterd' : '')}`;
  if (s === 'trend') {
    h += annBar('chatgpt');
    h += `<section><h3>Aandeel antwoorden met Allianz Direct</h3><p class="sub">Klik op een meting voor merken en antwoorden van die week</p><div class="card">${chart({ dates, series: [{ name: 'Genoemd', vals: t.map(r => r[2] / r[1] * 100), color: 'var(--brand)', own: 1 }, { name: 'Geciteerd', vals: t.map(r => r[3] / r[1] * 100), color: 'var(--accent)', dash: 1 }], tab: 'chatgpt', fmt: v => pct(v, 0), onPoint: openGptDate, label: 'ChatGPT aandeel' })}</div></section>`;
    h += `<section><h3>Merken in antwoorden</h3><p class="sub">Aandeel antwoorden per merk. Zet merken aan of uit via de legenda.</p><div class="card">${chart({ dates, series: Object.entries(D.gpt_mentions).map(([k, v], i) => k === 'allianz direct' ? { name: 'Allianz Direct', vals: t.map(r => r[2] / r[1] * 100), color: 'var(--brand)', own: 1 } : { name: k, vals: v, color: PAL[i % PAL.length] }), tab: 'chatgpt', fmt: v => pct(v, 0), onPoint: openGptDate, phases: false, label: 'Merken' })}</div></section>`;
    h += `<div class="grid g2"><div class="tcard"><div class="thead"><div><h4>Meest genoemde merken</h4></div></div><div class="scroll"><table><thead><tr><th>Merk</th><th class="r">Antwoorden</th><th class="r">Aandeel</th></tr></thead><tbody>${D.gpt_mentions_lb.map(r => `<tr class="${r.mention === 'allianz direct' ? 'own' : ''}"><td>${esc(r.mention)}</td><td class="r">${nf(r.total_answers)}</td><td class="r">${pct(r.answer_share * 100)}</td></tr>`).join('')}</tbody></table></div></div><div class="tcard"><div class="thead"><div><h4>Meest geciteerde bronnen</h4></div></div><div class="scroll"><table><thead><tr><th>Domein</th><th class="r">Antwoorden</th><th class="r">Aandeel</th></tr></thead><tbody>${D.gpt_citations_lb.map(r => `<tr class="${r.citation === OWN ? 'own' : ''}"><td>${esc(r.citation)}</td><td class="r">${nf(r.total_answers)}</td><td class="r">${pct(r.answer_share * 100)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  } else if (s === 'streaks') {
    const ms = streaks(t.map(r => r[2] / r[1] * 100), v => v >= 20), gs = growthStreak(t.map(r => r[2] / r[1]));
    const P = D.gpt_prompts.filter(r => inCl(r.cl));
    h += hvSeg('chatgpt');
    if (st.hv.chatgpt === 'moment') {
      const G = D.gpt_hist, R = Object.entries(G.rows).filter(([p, v]) => inCl(v.cl));
      const sc = ([p, v]) => streaks(v.v, x => x >= 2);
      R.sort((a, b) => sc(b).cur - sc(a).cur || sc(b).best - sc(a).best || b[1].v.filter(x => x).length - a[1].v.filter(x => x).length);
      h += `<section><div class="grid g3">${streakCard('Genoemd in 20% of meer', ms, 'metingen', 'Metingen op rij met minstens 1 op 5 antwoorden')}${streakCard('Groei genoemd', gs, 'metingen', 'Aandeel hoger dan de vorige meting')}<div class="card"><h4>Nu genoemd</h4><div class="num">${R.filter(([p, v]) => last(v.v) >= 2).length}</div><p class="cap">prompts bij de meting van ${fmtD(last(G.dates))}</p></div></div></section>`;
      h += heatGrid({
        title: 'Allianz Direct in ChatGPT, per meting',
        sub: 'Elke cel is een wekelijkse meting. Donkerpaars <b>G+B</b>: genoemd én allianzdirect.nl als bron. Paars <b>G</b>: alleen genoemd. Lichtpaars <b>B</b>: alleen als bron, zonder merknaam. Leeg: niet zichtbaar. Klik op een cel voor de merken en antwoorden van die week.',
        dates: G.dates, metaHead: 'Genoemd', label: 'Prompt',
        rows: R.map(([p, v]) => ({ k: p, meta: v.v.filter(x => x >= 2).length + '/' + v.v.length, v: v.v, date: true })),
        ok: v => v >= 2,
        cell: v => v === 3 ? ['h5', 'G+B', 'genoemd en geciteerd'] : v === 2 ? ['h4', 'G', 'genoemd'] : v === 1 ? ['h2', 'B', 'alleen geciteerd'] : ['h0', '', 'niet zichtbaar'],
        foot: `Alle ${Object.keys(G.rows).length} prompts waarin AD sinds ${fmtD(G.dates[0])} minstens één keer zichtbaar was. De streak telt metingen op rij met een vermelding.`
      });
    } else
    h += `<section><h3>Streaks</h3><p class="sub">Per prompt: in welk deel van de metingen AD genoemd en geciteerd werd sinds maart 2026.</p><div class="grid g3">${streakCard('Genoemd in 20% of meer', ms, 'metingen', 'Metingen op rij met minstens 1 op 5 antwoorden')}${streakCard('Groei genoemd', gs, 'metingen', 'Aandeel hoger dan de vorige meting')}<div class="card"><h4>Prompts met AD in elke meting</h4><div class="num">${P.filter(r => +r.mention_pct === 100).length}</div><p class="cap">van de ${P.length} prompts met een vermelding</p></div></div></section>
    <section><div class="tcard"><div class="thead"><div><h4>Prompts met een vermelding</h4><p>Gesorteerd op hoe vaak AD genoemd wordt</p></div></div><div class="scroll"><table><thead><tr><th>Prompt</th><th class="r">Genoemd</th><th class="r">Geciteerd</th><th class="r">Laatst genoemd</th><th class="r">Laatst geciteerd</th></tr></thead><tbody>${P.map(r => `<tr><td>${esc(r.prompt)}</td><td class="r"><div class="meter"><span class="t"><i style="width:${r.mention_pct}%"></i></span><b>${r.mention_pct}%</b></div></td><td class="r">${r.citation_pct}%</td><td class="r">${r.mention_last ? fmtD(r.mention_last) : '·'}</td><td class="r">${r.citation_last ? fmtD(r.citation_last) : '·'}</td></tr>`).join('')}</tbody></table></div></div></section>`;
  } else {
    const A = D.gpt_answers;
    h += `<section><div class="tcard"><div class="thead"><div><h4>Antwoorden van de laatste twee metingen</h4><p>${A.length} antwoorden, eerst die met Allianz Direct. Klik voor het volledige antwoord en de bronnen.</p></div></div><div class="scroll"><table><thead><tr><th>Datum</th><th>Prompt</th><th>Genoemd</th><th>Geciteerd</th></tr></thead><tbody>${A.map((a, i) => `<tr class="click" data-ans="${i}"><td>${fmtD(a.date)}</td><td>${esc(a.prompt)}</td><td>${a.mention === 'yes' ? '<span class="chip yes">Ja</span>' : '<span class="chip no">Nee</span>'}</td><td>${a.citation === 'yes' ? '<span class="chip yes">Ja</span>' : '<span class="chip no">Nee</span>'}</td></tr>`).join('')}</tbody></table></div></div></section>`;
  }
  return h;
}
function viewAimode() {
  const A = D.aimode, rows = A.rows.filter(r => inCl(r.cl));
  const cited = rows.filter(r => r.cited).length, ment = rows.filter(r => r.mentioned).length;
  const refs = {}; rows.forEach(r => r.refs.forEach(d => refs[d] = (refs[d] || 0) + 1));
  const top = Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 10), max = top.length ? top[0][1] : 1;
  const AMD = [...new Set(Object.values(D.aimode_hist).flatMap(x => x.dates))].sort();
  return `<div class="head"><div><p class="eyebrow">AI Mode</p><h1>Zichtbaar in <span class="p">AI Mode</span></h1><p class="lede">Google AI Mode (udm=50), desktop, Nederland, via DataForSEO. Laatste meting ${fmtD(A.scraped)}, ${A.runs} ${A.runs === 1 ? 'meting' : 'metingen'} in totaal, om de twee weken.</p></div></div>${clBar()}
  ${A.runs === 1 || A.rows.length < A.total_planned ? `<div class="note">${A.runs === 1 ? '<b>Eerste meting.</b> Bij elke run komt er een kolom bij en gaan trend en streaks lopen. ' : ''}${A.rows.length} van ${A.total_planned} zoekwoorden gaven bij de laatste meting een bruikbaar antwoord.</div>` : ''}
  <div class="grid g3"><div class="card"><h4>Geciteerd als bron</h4><div class="num">${cited}</div><p class="cap">van ${rows.length} zoekwoorden</p></div><div class="card"><h4>Genoemd in de tekst</h4><div class="num">${ment}</div><p class="cap">merknaam in het antwoord, zonder link</p></div><div class="card"><h4>Niet zichtbaar</h4><div class="num">${rows.length - cited - ment}</div><p class="cap">vergelijkers en concurrenten domineren</p></div></div>
  ${heatGrid({
    title: 'Zichtbaarheid in AI Mode, per meting',
    sub: 'Elke cel is een meting. Donkerpaars <b>B</b>: allianzdirect.nl als bron. Paars <b>G</b>: genoemd zonder link. Lichtpaars: niet zichtbaar. Leeg: niet gemeten.',
    dates: AMD, metaHead: 'Volume',
    rows: rows.map(r => { const m = D.aimode_hist[r.kw] || { dates: [], cited: [], mentioned: [] }; return { k: r.kw, kw: r.kw, meta: nf(r.sv), v: AMD.map(d => { const i = m.dates.indexOf(d); return i < 0 ? null : m.cited[i] ? 2 : m.mentioned[i] ? 1 : 0; }) }; }),
    ok: v => v >= 1,
    cell: v => v === 2 ? ['h5', 'B', 'geciteerd als bron'] : v === 1 ? ['h4', 'G', 'genoemd'] : v === 0 ? ['h1', '', 'niet zichtbaar'] : ['h0', '', 'niet gemeten'],
    foot: `${A.total_planned} zoekwoorden, om de twee weken gemeten`
  })}
  <section><div class="tcard"><div class="thead"><div><h4>Per zoekwoord</h4><p>Klik voor het zoekwoordprofiel, of open AI Mode direct</p></div></div><div class="scroll"><table><thead><tr><th>Zoekwoord</th><th>Cluster</th><th class="r">Volume</th><th>Status</th><th>Bronnen in het antwoord</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td><a href="#" data-kw="${esc(r.kw)}">${esc(r.kw)}</a></td><td><span class="chip soft">${esc(clName(r.cl))}</span></td><td class="r">${nf(r.sv)}</td><td>${r.cited ? '<span class="chip yes">Geciteerd</span>' : r.mentioned ? '<span class="chip soft">Genoemd</span>' : '<span class="chip no">Niet zichtbaar</span>'}</td><td><div class="chips">${r.refs.slice(0, 6).map(d => `<span class="chip ${d === OWN ? 'yes' : 'soft'}">${esc(d)}</span>`).join('')}${r.refs.length > 6 ? `<span class="chip no">+${r.refs.length - 6}</span>` : ''}</div></td><td><a href="${esc(r.check)}" target="_blank" rel="noopener">Open</a></td></tr>`).join('') || '<tr><td colspan="6">Nog geen zoekwoorden uit dit cluster gemeten.</td></tr>'}</tbody></table></div></div></section>
  ${rows.filter(r => r.mention_text).map(r => `<div class="note"><b>${esc(r.kw)}:</b> ${esc(r.mention_text)}</div>`).join('')}
  ${top.length ? `<section><h3>Meest gebruikte bronnen</h3><div class="card"><div class="hb">${top.map(([d, v]) => `<div class="r ${d === OWN ? 'me' : ''}"><span class="nm">${esc(d)}</span><span class="tr"><i style="width:${v / max * 100}%"></i></span><b>${v}</b></div>`).join('')}</div></div></section>` : ''}`;
}
function viewAnn() {
  const list = D.annotations.slice().reverse().filter(a => st.types[a.type]);
  const byM = {}; list.forEach(a => (byM[a.date.slice(0, 7)] = byM[a.date.slice(0, 7)] || []).push(a));
  return `<div class="head"><div><p class="eyebrow">Annotaties</p><h1>Wat er <span class="p">gebeurde</span></h1><p class="lede">Google-updates (status.search.google.com), wijzigingen en PR uit Gmail, Slack en Notion, en momenten waarop de data zelf twijfelachtig is. Klik voor het effect voor en na.</p></div></div>${annBar('overzicht')}
  ${Object.entries(byM).map(([m, a]) => `<section><h3>${new Date(m + '-01T00:00:00').toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}</h3><div class="tl">${a.map(b => `<button class="r rowbtn" data-ann="${D.annotations.indexOf(b)}"><time>${fmtD(b.date)}</time><i class="tdot" style="background:${TYPES[b.type].c}"></i><span><b>${esc(b.title)}</b><small>${esc(b.source)}</small></span><span class="flag ${b.type === 'data' ? 'warn' : b.type === 'change' ? 'good' : ''}">${TYPES[b.type].l}</span></button>`).join('')}</div></section>`).join('')}`;
}
function viewMethod() {
  const blk = (t, body) => `<section class="meth"><h3>${t}</h3><div class="answer">${body}</div></section>`;
  return `<div class="head"><div><p class="eyebrow">Methodologie</p><h1>Hoe we <span class="p">meten</span></h1><p class="lede">Waar elk cijfer vandaan komt, hoe het berekend wordt en waar de grenzen liggen.</p></div></div>
  ${blk('Bronnen en meetmomenten', `<table><thead><tr><th>Kanaal</th><th>Bron</th><th>Meetmoment</th><th>Wat telt</th></tr></thead><tbody>
  <tr><td>Google marktaandeel</td><td>FolloEngine, SERP-scrape (mobiel, Nederland)</td><td>Wekelijks, sinds mei 2025</td><td>Geschat verkeer per resultaat (zoekvolume × CTR-curve per positie), aandeel van allianzdirect.nl in het totaal van de zoekwoordenset</td></tr>
  <tr><td>Vertoningen en URL-positie</td><td>Search Console-export via Windsor (BigQuery), datum × pagina × zoekopdracht</td><td>Dagelijks, gebundeld per volledige week (ma t/m zo)</td><td>Alleen Nederland, zoektype web. Vertoningen per pagina opgeteld; positie per pagina, gewogen naar vertoningen</td></tr>
  <tr><td>Querypositie</td><td>Search Console-export via Windsor (BigQuery), datum × zoekopdracht</td><td>Per week, per cluster</td><td>Positie per zoekopdracht, gewogen naar vertoningen, over alle zoekopdrachten</td></tr>
  <tr><td>AI Overviews</td><td>FolloEngine AIO-scrape</td><td>Wekelijks, sinds juni 2025</td><td>Aandeel AIO's in de set waarin allianzdirect.nl als bron staat</td></tr>
  <tr><td>ChatGPT</td><td>FolloEngine ChatGPT-tracking, ${last(D.gpt_trend)[1]} prompts</td><td>Wekelijks, sinds ${fmtD(D.gpt_trend[0][0])}</td><td>Genoemd: merknaam in het antwoord. Geciteerd: allianzdirect.nl als bron</td></tr>
  <tr><td>AI Mode</td><td>DataForSEO, Google AI Mode (desktop, NL)</td><td>Om de twee weken, sinds ${fmtD(Object.values(D.aimode_hist).flatMap(x => x.dates).sort()[0] || D.aimode.scraped)}</td><td>Geciteerd als bron of genoemd in de tekst, per zoekwoord</td></tr></tbody></table>`)}
  ${blk('Waarom twee soorten gemiddelde positie', `<p>Search Console toont standaard een <b>property-gemiddelde</b>: per zoekopdracht telt alleen het hoogste resultaat van de site. Dat getal ligt daardoor altijd gunstig (laag). Wij tonen daarom twee strengere gemiddelden:</p><ul><li><b>URL-niveau</b>: elke pagina telt mee met haar eigen positie, gewogen naar vertoningen. Een tweede pagina die op positie 40 staat trekt het gemiddelde omhoog.</li><li><b>Queryniveau</b>: elke zoekopdracht telt mee, ook de duizenden waar AD op pagina 2 of 3 staat. Dit laat zien hoe breed de zichtbaarheid is.</li></ul><p>Beide komen uit de volledige Search Console-export (Windsor) en zijn per cluster beschikbaar. Zoekopdrachten met de merknaam tellen alleen mee bij <i>Alle clusters</i>.</p><p>Clicks laten we bewust buiten beeld: ze hangen sterk af van merkzoekopdrachten en van AI Overviews die het klikgedrag veranderen. Vertoningen, marktaandeel en posities zeggen meer over de zichtbaarheid.</p>`)}
  ${blk('Clusters', `<p>De clusterindeling volgt de clusters van FolloEngine: <b>Autoverzekering</b>, <b>Autoschade & service</b> (schadeformulier, groene kaart, pech, steenslag), <b>Woonverzekering</b> (inboedel, opstal, aansprakelijkheid), <b>Reisverzekering</b> (incl. annulering) en <b>Rechtsbijstand & overig</b> (rechtsbijstand, dagwaarde, algemene verzekeringstermen). Zoekwoorden en zoekopdrachten krijgen een cluster op basis van de woorden erin, Search Console-pagina's op basis van het URL-pad, met één set regels voor alle bronnen (config/allianzdirect.yaml in de repository). ChatGPT-trends zijn niet per cluster beschikbaar; de prompttabellen wel.</p>`)}
  ${blk('Fase-trendlijnen', `<p>De groene en rode stippellijnen in de grafieken zijn <b>trendlijnen per fase</b>. Een fase is de periode tussen twee annotaties van het type <i>Doorgevoerd</i> of <i>PR</i>. Binnen elke fase trekken we een rechte lijn door de metingen (lineaire regressie). Groen: in die fase verbeterde de lijn, rood: hij verslechterde.</p><p>Zo zie je in één oogopslag of de richting veranderde nadat er iets live ging. Voorbeeld: is de lijn vóór een wijziging rood en erna groen, dan keerde de trend na die wijziging. Dat bewijst geen oorzaak; Google-updates en seizoen tellen mee. Klik op de annotatie voor de voor-en-na-vergelijking in cijfers. Je zet de lijnen uit met de knop <i>Fase-trendlijnen</i>.</p>`)}
  ${blk('Streaks', `<p>Een streak is het aantal metingen op rij waarin iets waar is: een zoekwoord in de top 1, 3 of 10, of een cijfer dat hoger is dan bij de vorige meting. <b>Huidige streak</b> loopt tot en met de laatste meting, <b>record</b> is de langste reeks in de hele periode. Metingen met datatwijfel tellen bij AIO niet mee.</p>`)}
  ${blk('Opvallendheden per meetmoment', `<p>Per FolloEngine-meting vergelijken we met de meting ervoor en markeren we:</p><ul><li>marktaandeel per cluster dat minstens 20% relatief en 0,3 procentpunt verschuift;</li><li>zoekwoorden die de top 3 of pagina 1 in of uit gaan, of 5 posities of meer verschuiven;</li><li>AIO-citatieaandeel per cluster dat 6 procentpunt of meer verschuift;</li><li>ChatGPT-vermeldingen die 5 procentpunt verschuiven of in 4 metingen bijna halveren;</li><li>GSC-vertoningen per cluster die 20% verschuiven, of een URL-positie die 1,5 plek verschuift;</li><li>annotaties sinds de vorige meting en datatwijfels.</li></ul>`)}
  ${blk('Annotaties en datatwijfels', `<p><b>Google-updates</b> komen bij elke run automatisch van status.search.google.com. <b>Doorgevoerd</b> en <b>PR</b> komen uit Gmail, Slack en Notion: aan het begin van elke maand zoekt Claude daar op Allianz en zet nieuwe annotaties klaar. <b>Datatwijfels</b> zijn deels automatisch gevonden in de data (sprongen in de zoekwoordenset, verdubbeld totaalverkeer, gaten tussen metingen, onvolledige AIO-controle) en deels uit berichten (bijvoorbeeld een kapotte ChatGPT-module). Vanaf november 2026 controleert elke run de data ook zelf: een gewijzigde zoekwoordenset, gaten tussen metingen, onvolledige AIO- of ChatGPT-metingen en bronnen die niet zijn bijgewerkt krijgen automatisch een datatwijfel. De voor-en-na-vergelijking neemt het gemiddelde van 4 metingen ervoor en 4 metingen erna.</p>`)}
  ${blk('Verversen', `<p>Het dashboard wordt elke maandagochtend automatisch opnieuw opgebouwd met de nieuwste FolloEngine- en Search Console-data. AI Mode wordt om de twee weken gemeten, de annotaties uit Gmail, Slack en Notion worden aan het begin van elke maand bijgewerkt. Laatste build: ${fmtD(D.generated)}. Data t/m: Google ${fmtD(D.data_through.google)}, AI Overviews ${fmtD(D.data_through.aio)}, ChatGPT ${fmtD(D.data_through.chatgpt)}, Search Console ${fmtD(D.data_through.gsc)}, AI Mode ${D.data_through.aimode ? fmtD(D.data_through.aimode) : 'nog geen meting'}.</p><ul><li>Heatmaps tonen de laatste ${D.aio_hist_dates.length} AIO-metingen (${Object.keys(D.aio_kw_hist).length} grootste zoekwoorden) en de laatste ${D.gpt_hist.dates.length} ChatGPT-metingen.</li><li>Search Console loopt ongeveer een week achter; alleen volledige weken tellen mee.</li></ul>`)}`;
}

function render() {
  nav();
  const th = $('#thru'), up = $('#upd');
  if (th) th.textContent = 'Data t/m ' + fmtD(D.data_through ? D.data_through.google : D.fe_dates[D.fe_dates.length - 1]);
  if (up) up.textContent = 'Bijgewerkt ' + fmtD(D.generated);
  const v = { overzicht: viewOverzicht, google: viewGoogle, aio: viewAio, chatgpt: viewGpt, aimode: viewAimode, annotaties: viewAnn, methodologie: viewMethod }[st.tab];
  $('#view').innerHTML = v();
  $('#crumb').innerHTML = `allianzdirect.nl · <b>${TABS.find(t => t[0] === st.tab)[1]}</b>${st.cl !== 'alle' && !['annotaties', 'methodologie'].includes(st.tab) ? ' · ' + esc(clName(st.cl)) : ''}`;
  bind();
}
function bind() {
  const V = $('#view');
  V.querySelectorAll('[data-go]').forEach(n => n.addEventListener('click', () => { st.tab = n.dataset.go; location.hash = st.tab; render(); window.scrollTo(0, 0); }));
  V.querySelectorAll('[data-sub]').forEach(n => n.addEventListener('click', () => { const [k, s] = n.dataset.sub.split(':'); st.sub[k] = s; render(); }));
  V.querySelectorAll('[data-type]').forEach(n => n.addEventListener('click', () => { st.types[n.dataset.type] = !st.types[n.dataset.type]; render(); }));
  V.querySelectorAll('[data-phases]').forEach(n => n.addEventListener('click', () => { st.phases = !st.phases; render(); }));
  V.querySelectorAll('[data-n]').forEach(n => n.addEventListener('click', () => { st.N = +n.dataset.n; render(); }));
  V.querySelectorAll('[data-src]').forEach(n => n.addEventListener('click', () => { st.src = n.dataset.src; render(); }));
  V.querySelectorAll('[data-gm]').forEach(n => n.addEventListener('click', () => { st.gm = n.dataset.gm; render(); }));
  V.querySelectorAll('[data-hv]').forEach(n => n.addEventListener('click', () => { const [k, v] = n.dataset.hv.split(':'); st.hv[k] = v; render(); }));
  V.querySelectorAll('[data-gd]').forEach(n => n.addEventListener('click', () => { const i = D.gpt_trend.findIndex(r => r[0] === n.dataset.gd); if (i >= 0) openGptDate(i); }));
  V.querySelectorAll('[data-cl]').forEach(n => n.addEventListener('click', () => { st.cl = n.dataset.cl; render(); }));
  V.querySelectorAll('[data-ser]').forEach(n => n.addEventListener('click', () => { const k = n.dataset.ser; st.hidden[k] = !st.hidden[k]; render(); }));
  V.querySelectorAll('[data-serall]').forEach(n => n.addEventListener('click', () => { const names = n.dataset.serall.split('|'); const anyOn = names.some(k => !st.hidden[k]); names.forEach(k => st.hidden[k] = anyOn); render(); }));
  V.querySelectorAll('[data-kw]').forEach(n => n.addEventListener('click', e => { e.preventDefault(); openKw(n.dataset.kw); }));
  V.querySelectorAll('[data-ann]').forEach(n => n.addEventListener('click', () => openAnn(+n.dataset.ann)));
  V.querySelectorAll('[data-ans]').forEach(n => n.addEventListener('click', () => openAnswer(+n.dataset.ans)));
  if (st.tab === 'overzicht') bindInsights();
}
document.addEventListener('click', e => { const a = e.target.closest('#tabs a'); if (!a) return; e.preventDefault(); st.tab = a.dataset.tab; location.hash = st.tab; render(); window.scrollTo(0, 0); });
const h0 = (location.hash || '').slice(1); if (TABS.some(t => t[0] === h0)) st.tab = h0;
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.some(t => t[0] === h) && h !== st.tab) { st.tab = h; render(); } });
render();
