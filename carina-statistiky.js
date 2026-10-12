(async function () {
  'use strict';

  const ROOT_ID = 'carina-statistiky-root';
  const STYLE_ID = 'carina-statistiky-style-link';
  const RESOURCE_STORAGE_KEY = 'carina-statistiky-resource';
  const MAX_MONTHS = 60;

  document.getElementById(ROOT_ID)?.remove();

  const scriptSrc = document.currentScript?.src || '';
  if (scriptSrc && !document.getElementById(STYLE_ID)) {
    try {
      const styleUrl = new URL('style.css', scriptSrc).href;
      const link = document.createElement('link');
      link.id = STYLE_ID;
      link.rel = 'stylesheet';
      link.href = styleUrl;
      document.head.appendChild(link);
    } catch (e) {
      console.warn('Carina statistiky: nepodařilo se připojit style.css', e);
    }
  }

  const state = {
    all: [],
    filter: 'vse',
    search: '',
    sort: { key: 'navstevnici', dir: 'desc' },
    resource: null,
    loaded: false
  };

  // ----------------------------
  // Pomocné funkce
  // ----------------------------
  const fmtInt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
  const fmt1 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function gridRowStart(element) {
    let row = parseInt(element.style.gridRowStart, 10);
    if (row) return row;
    const raw = element.style.gridRow || '';
    row = parseInt(raw.split('/')[0], 10);
    return row || null;
  }

  function gridColumnBounds(element) {
    let start = parseInt(element.style.gridColumnStart, 10);
    let end = parseInt(element.style.gridColumnEnd, 10);
    if (start && end) return { start, end };
    const raw = element.style.gridColumn || '';
    const parts = raw.split('/').map(v => parseInt(v.trim(), 10));
    start = start || parts[0];
    end = end || parts[1];
    return { start: start || null, end: end || null };
  }

  function sloupecNaCas(column) {
    const minuty = (8 * 60) + ((column - 2) * 15);
    const hodiny = Math.floor(minuty / 60);
    const mins = minuty % 60;
    return `${String(hodiny).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  function typPoradu(show) {
    const styleText = (show.getAttribute('style') || '').toLowerCase().replace(/\s/g, '');
    const barva = (show.style.backgroundColor || '').toLowerCase().replace(/\s/g, '');
    if (styleText.includes('background-color:#000075') || barva === '#000075' || barva === 'rgb(0,0,117)') return 'modry';
    if (styleText.includes('background-color:#800000') || barva === '#800000' || barva === 'rgb(128,0,0)') return 'hnedy';
    return null;
  }

  function datumNaISO(datum) {
    const cisla = String(datum || '').match(/\d+/g) || [];
    if (cisla.length < 3) return '';
    const [den, mesic, rok] = cisla.map(Number);
    if (!den || !mesic || !rok) return '';
    return `${String(rok).padStart(4, '0')}-${String(mesic).padStart(2, '0')}-${String(den).padStart(2, '0')}`;
  }

  function datumCas(p, useEnd = false) {
    const [y, m, d] = p.datumISO.split('-').map(Number);
    const time = useEnd && p.do ? p.do : p.od;
    const [hh, mm] = time.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }

  function jeProbehly(p) {
    return datumCas(p, true).getTime() < Date.now();
  }

  function formatDatumISO(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function typLabel(typ) {
    return typ === 'modry' ? 'Školní' : 'Veřejnost';
  }

  // Kompatibilita se starší verzí skriptu, kde se omylem objevilo typoLabel().
  // Po načtení nové verze tak dashboard nespadne ani při staré referenci.
  const typoLabel = typLabel;

  function monthKeyToLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('cs-CZ', { month: 'short', year: 'numeric' }).format(new Date(y, m - 1, 1));
  }

  function dayIndex(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const js = new Date(y, m - 1, d).getDay();
    return js === 0 ? 6 : js - 1; // Po=0 ... Ne=6
  }

  function dayLabel(index) {
    return ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'][index] || '';
  }

  function median(values) {
    const arr = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!arr.length) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }

  function avg(values) {
    const arr = values.filter(Number.isFinite);
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function sum(values) {
    return values.filter(Number.isFinite).reduce((a, b) => a + b, 0);
  }

  function percent(part, total) {
    return total > 0 ? (part / total) * 100 : 0;
  }

  function ulozResource(resource) {
    if (!resource) return;
    try { localStorage.setItem(RESOURCE_STORAGE_KEY, resource); } catch (_) {}
  }

  function zjistiResource() {
    try {
      const current = new URL(window.location.href);
      const resource = current.searchParams.get('resource');
      if (resource) { ulozResource(resource); return resource; }
    } catch (_) {}

    for (const a of document.querySelectorAll('a[href]')) {
      try {
        const u = new URL(a.href, window.location.origin);
        const resource = u.searchParams.get('resource');
        if (resource) { ulozResource(resource); return resource; }
      } catch (_) {}
    }

    const input = document.querySelector('[name="resource"]');
    if (input?.value) { ulozResource(input.value); return input.value; }
    const elem = document.querySelector('[data-resource]');
    if (elem?.dataset?.resource) { ulozResource(elem.dataset.resource); return elem.dataset.resource; }

    try { return localStorage.getItem(RESOURCE_STORAGE_KEY); } catch (_) { return null; }
  }

  function seznamMesicu(from, to) {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    if (!fy || !fm || !ty || !tm) throw new Error('Vyber období OD i DO.');
    const a = fy * 12 + fm;
    const b = ty * 12 + tm;
    if (a > b) throw new Error('Měsíc OD musí být před měsícem DO.');
    const out = [];
    let y = fy, m = fm;
    while (y < ty || (y === ty && m <= tm)) {
      out.push({ rok: y, mesic: m });
      m++;
      if (m > 12) { m = 1; y++; }
      if (out.length > MAX_MONTHS) throw new Error(`Najednou lze načíst maximálně ${MAX_MONTHS} měsíců.`);
    }
    return out;
  }

  function urlMesice(rok, mesic) {
    const url = new URL('/!month@schedule', window.location.origin);
    url.searchParams.set('year', rok);
    url.searchParams.set('month', mesic);
    url.searchParams.set('resource', state.resource);
    return url.toString();
  }

  function urlUdalosti(uuid) {
    return uuid ? `${window.location.origin}/!view@schedule~${uuid}` : '';
  }

  // ----------------------------
  // Načítání Cariny
  // ----------------------------
  async function nactiMesic(rok, mesic) {
    const response = await fetch(urlMesice(rok, mesic), { method: 'GET', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Načtení ${mesic}/${rok}: HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return zpracujMesic(doc, rok, mesic);
  }

  function zpracujMesic(doc, rok, mesic) {
    const datumy = new Map();
    doc.querySelectorAll('.day[data-date]').forEach(day => {
      const row = gridRowStart(day);
      if (row && day.dataset.date) datumy.set(row, day.dataset.date);
    });

    const out = [];
    doc.querySelectorAll('.show').forEach(show => {
      const typ = typPoradu(show);
      if (!typ) return;
      const nameEl = show.querySelector('.name');
      const capacityEl = show.querySelector('.capacity');
      if (!nameEl || !capacityEl) return;
      const row = gridRowStart(show);
      const columns = gridColumnBounds(show);
      if (!row || !columns.start) return;
      const datum = datumy.get(row);
      const datumISO = datumNaISO(datum);
      if (!datumISO) return;
      const scheduleId = (capacityEl.id || '').replace('capa', '').trim();
      if (!scheduleId) return;
      const uuid = show.dataset.uuid || '';
      const p = {
        datum: datum || '',
        datumISO,
        od: sloupecNaCas(columns.start),
        do: columns.end ? sloupecNaCas(columns.end) : '',
        nazev: nameEl.textContent.trim(),
        typ,
        scheduleId,
        uuid,
        rok,
        mesic,
        monthKey: `${rok}-${String(mesic).padStart(2, '0')}`,
        url: urlUdalosti(uuid),
        available: null,
        total: null,
        navstevnici: null,
        obsazenost: null
      };
      if (p.nazev && jeProbehly(p)) out.push(p);
    });
    return out;
  }

  async function nactiKapacity(ids) {
    if (!ids.length) return {};
    const data = new URLSearchParams();
    data.set('ids', ids.join(','));
    const response = await fetch('/!capacities@schedule', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: data.toString()
    });
    if (!response.ok) throw new Error(`Načtení kapacit: HTTP ${response.status}`);
    const json = await response.json();
    const map = {};
    json.forEach(item => {
      map[String(item.schedule_id)] = {
        available: Number(item.available),
        total: Number(item.total)
      };
    });
    return map;
  }

  async function nactiKapacityPoDavkach(ids, status) {
    const BATCH = 150;
    const out = {};
    for (let i = 0; i < ids.length; i += BATCH) {
      status(`Načítám kapacity ${i + 1}–${Math.min(i + BATCH, ids.length)} z ${ids.length}…`);
      Object.assign(out, await nactiKapacity(ids.slice(i, i + BATCH)));
    }
    return out;
  }

  // ----------------------------
  // Statistiky
  // ----------------------------
  function dataPodleFiltru() {
    return state.all.filter(p => {
      if (state.filter !== 'vse' && p.typ !== state.filter) return false;
      if (state.search && !p.nazev.toLocaleLowerCase('cs').includes(state.search.toLocaleLowerCase('cs'))) return false;
      return true;
    });
  }

  function summary(data) {
    const valid = data.filter(p => Number.isFinite(p.navstevnici));
    const totalVisitors = sum(valid.map(p => p.navstevnici));
    const totalCapacity = sum(valid.map(p => p.total));
    return {
      projekce: data.length,
      tituly: new Set(data.map(p => `${p.typ}|${p.nazev}`)).size,
      navstevnici: totalVisitors,
      prumer: valid.length ? totalVisitors / valid.length : 0,
      median: median(valid.map(p => p.navstevnici)),
      obsazenost: percent(totalVisitors, totalCapacity),
      kapacita: totalCapacity,
      validCount: valid.length
    };
  }

  function groupPrograms(data) {
    const map = new Map();
    data.forEach(p => {
      const key = `${p.typ}|${p.nazev}`;
      if (!map.has(key)) map.set(key, { key, nazev: p.nazev, typ: p.typ, rows: [] });
      map.get(key).rows.push(p);
    });
    return [...map.values()].map(g => {
      const s = summary(g.rows);
      const vals = g.rows.filter(p => Number.isFinite(p.navstevnici)).map(p => p.navstevnici);
      const dates = g.rows.map(p => p.datumISO).sort();
      return {
        ...g,
        projekce: s.projekce,
        navstevnici: s.navstevnici,
        prumer: s.prumer,
        median: s.median,
        obsazenost: s.obsazenost,
        minimum: vals.length ? Math.min(...vals) : 0,
        maximum: vals.length ? Math.max(...vals) : 0,
        first: dates[0] || '',
        last: dates.at(-1) || ''
      };
    });
  }

  function sortPrograms(programs) {
    const { key, dir } = state.sort;
    return programs.slice().sort((a, b) => {
      let A = a[key], B = b[key];
      let cmp;
      if (typeof A === 'string') cmp = A.localeCompare(B, 'cs');
      else cmp = (A ?? 0) - (B ?? 0);
      if (cmp === 0) cmp = a.nazev.localeCompare(b.nazev, 'cs');
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  function byMonth(data) {
    const map = new Map();
    data.forEach(p => {
      if (!map.has(p.monthKey)) map.set(p.monthKey, []);
      map.get(p.monthKey).push(p);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({ key, label: monthKeyToLabel(key), ...summary(rows) }));
  }

  function bars(items, valueKey, labelKey, formatter = fmtInt.format.bind(fmtInt), maxItems = 10) {
    const sliced = items.slice(0, maxItems);
    const max = Math.max(1, ...sliced.map(x => Number(x[valueKey]) || 0));
    if (!sliced.length) return '<div class="cs-empty">Žádná data.</div>';
    return `<div class="cs-bar-list">${sliced.map(x => {
      const val = Number(x[valueKey]) || 0;
      return `<div class="cs-bar-row"><div title="${esc(x[labelKey])}">${esc(x[labelKey])}</div><div class="cs-bar-track"><div class="cs-bar-fill" style="width:${clamp(val / max * 100, 1, 100)}%"></div></div><div class="cs-bar-val">${esc(formatter(val))}</div></div>`;
    }).join('')}</div>`;
  }

  function renderKpis(data) {
    const s = summary(data);
    return `
      <div class="cs-kpis">
        ${kpi('Projekce', fmtInt.format(s.projekce), 'proběhlé termíny')}
        ${kpi('Tituly', fmtInt.format(s.tituly), 'název + typ pořadu')}
        ${kpi('Návštěvníci*', fmtInt.format(s.navstevnici), 'evidovaná obsazená místa')}
        ${kpi('Ø na projekci', fmt1.format(s.prumer), 'aritmetický průměr')}
        ${kpi('Medián', fmt1.format(s.median), 'návštěvníků / projekci')}
        ${kpi('Obsazenost', `${fmt1.format(s.obsazenost)} %`, `${fmtInt.format(s.navstevnici)} / ${fmtInt.format(s.kapacita)}`)}
      </div>`;
  }

  function kpi(label, value, note) {
    return `<div class="cs-card"><div class="cs-kpi-label">${esc(label)}</div><div class="cs-kpi-value">${esc(value)}</div><div class="cs-kpi-note">${esc(note)}</div></div>`;
  }

  function typeCard(type, data) {
    const rows = data.filter(p => p.typ === type);
    const s = summary(rows);
    const all = summary(data);
    const cls = type === 'modry' ? 'blue' : 'brown';
    return `<div class="cs-type-card ${cls}">
      <div class="cs-type-title"><span class="cs-dot ${type}"></span>${typeLabel(type)}</div>
      <div class="cs-mini-grid">
        <div><b>${fmtInt.format(s.projekce)}</b>projekcí</div>
        <div><b>${fmtInt.format(s.navstevnici)}</b>návštěvníků*</div>
        <div><b>${fmt1.format(s.prumer)}</b>Ø / projekci</div>
        <div><b>${fmt1.format(s.obsazenost)} %</b>obsazenost</div>
        <div><b>${fmt1.format(percent(s.projekce, all.projekce))} %</b>podíl projekcí</div>
        <div><b>${fmt1.format(percent(s.navstevnici, all.navstevnici))} %</b>podíl návštěv</div>
      </div>
    </div>`;
  }

  function renderProgramTable(data) {
    const programs = sortPrograms(groupPrograms(data));
    const arrow = key => state.sort.key === key ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `
      <div class="cs-section cs-card">
        <div class="cs-section-head"><h2>Statistiky pořadů</h2><button class="cs-button secondary" id="cs-export">Export CSV</button></div>
        <div class="cs-table-wrap"><table>
          <thead><tr>
            <th data-sort="nazev">Pořad${arrow('nazev')}</th>
            <th data-sort="typ">Typ${arrow('typ')}</th>
            <th data-sort="projekce">Projekcí${arrow('projekce')}</th>
            <th data-sort="navstevnici">Návštěvníků*${arrow('navstevnici')}</th>
            <th data-sort="prumer">Ø / projekci${arrow('prumer')}</th>
            <th data-sort="median">Medián${arrow('median')}</th>
            <th data-sort="obsazenost">Obsazenost${arrow('obsazenost')}</th>
            <th data-sort="maximum">Maximum${arrow('maximum')}</th>
            <th>Období</th>
          </tr></thead>
          <tbody>${programs.map(g => `<tr>
            <td><a href="#" class="cs-program" data-program="${esc(g.key)}"><span class="cs-dot ${g.typ}"></span>${esc(g.nazev)}</a></td>
            <td>${esc(typLabel(g.typ))}</td>
            <td>${fmtInt.format(g.projekce)}</td>
            <td><b>${fmtInt.format(g.navstevnici)}</b></td>
            <td>${fmt1.format(g.prumer)}</td>
            <td>${fmt1.format(g.median)}</td>
            <td>${fmt1.format(g.obsazenost)} %</td>
            <td>${fmtInt.format(g.maximum)}</td>
            <td>${formatDatumISO(g.first)} – ${formatDatumISO(g.last)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  function renderOverview(data) {
    const programs = groupPrograms(data);
    const topVisitors = programs.slice().sort((a, b) => b.navstevnici - a.navstevnici);
    const topOcc = programs.filter(p => p.projekce >= 2).slice().sort((a, b) => b.obsazenost - a.obsazenost);
    const months = byMonth(data);
    return `
      ${renderKpis(data)}
      <div class="cs-grid-2">
        <div class="cs-card"><h3>Školní vs. veřejnost</h3><div class="cs-type-grid">${typeCard('modry', data)}${typeCard('hnedy', data)}</div></div>
        <div class="cs-card"><h3>Nejnavštěvovanější pořady</h3>${bars(topVisitors, 'navstevnici', 'nazev')}</div>
      </div>
      <div class="cs-grid-2">
        <div class="cs-card"><h3>Nejvyšší obsazenost</h3>${bars(topOcc, 'obsazenost', 'nazev', v => `${fmt1.format(v)} %`)}</div>
        <div class="cs-card"><h3>Měsíční návštěvnost</h3>${bars(months.slice().reverse(), 'navstevnici', 'label')}</div>
      </div>
      ${renderProgramTable(data)}
      <div class="cs-footnote">* „Návštěvníci“ jsou v této verzi odvozeni jako <b>kapacita − volná místa</b> z kapacitního rozhraní Cariny. Je tedy přesnější chápat údaj jako evidovaná obsazená místa, dokud nepotvrdíme, že Carina tímto údajem reprezentuje skutečně odbavené návštěvníky.</div>`;
  }

  function render() {
    const target = document.getElementById('cs-content');
    if (!target) return;
    const data = dataPodleFiltru();
    target.innerHTML = state.loaded
      ? (data.length ? renderOverview(data) : '<div class="cs-card cs-empty">Pro zvolený filtr nejsou žádná data.</div>')
      : '<div class="cs-card cs-empty">Vyber období a stiskni „Načíst statistiky“.</div>';
    bindRenderedEvents();
  }

  function bindRenderedEvents() {
    document.querySelectorAll(`#${ROOT_ID} th[data-sort]`).forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort.key = key; state.sort.dir = key === 'nazev' || key === 'typ' ? 'asc' : 'desc'; }
        render();
      });
    });
    document.querySelectorAll(`#${ROOT_ID} .cs-program[data-program]`).forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        openDetail(a.dataset.program);
      });
    });
    document.getElementById('cs-export')?.addEventListener('click', exportCsv);
  }

  function detailBreakdown(rows, keyFn, labelFn) {
    const map = new Map();
    rows.forEach(p => {
      const key = keyFn(p);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
    return [...map.entries()].map(([key, data]) => ({ key, label: labelFn(key), ...summary(data) }));
  }

  function heatmap(rows) {
    const times = [...new Set(rows.map(p => p.od))].sort();
    if (!times.length) return '<div class="cs-empty">Žádná data.</div>';
    const cells = new Map();
    let max = 0;
    rows.forEach(p => {
      const d = dayIndex(p.datumISO);
      const key = `${d}|${p.od}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p.navstevnici);
    });
    const avgs = new Map();
    for (const [key, values] of cells) {
      const v = avg(values);
      avgs.set(key, v);
      max = Math.max(max, v);
    }
    return `<div class="cs-table-wrap"><table class="cs-heat"><thead><tr><th>Čas</th>${[0,1,2,3,4,5,6].map(d => `<th>${dayLabel(d)}</th>`).join('')}</tr></thead><tbody>
      ${times.map(t => `<tr><th>${esc(t)}</th>${[0,1,2,3,4,5,6].map(d => {
        const v = avgs.get(`${d}|${t}`);
        if (!Number.isFinite(v)) return '<td>—</td>';
        const level = max > 0 ? clamp(Math.ceil(v / max * 5), 1, 5) : 1;
        return `<td data-level="${level}" title="Průměrná evidovaná návštěvnost">${fmt1.format(v)}</td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
  }

  function openDetail(key) {
    const [typ, ...nameParts] = key.split('|');
    const nazev = nameParts.join('|');
    const rows = state.all.filter(p => p.typ === typ && p.nazev === nazev);
    if (!rows.length) return;
    const s = summary(rows);
    const visitors = rows.filter(p => Number.isFinite(p.navstevnici)).map(p => p.navstevnici);
    const dates = rows.map(p => p.datumISO).sort();
    const byDay = detailBreakdown(rows, p => dayIndex(p.datumISO), k => dayLabel(Number(k))).sort((a, b) => Number(a.key) - Number(b.key));
    const byTime = detailBreakdown(rows, p => p.od, k => k).sort((a, b) => a.key.localeCompare(b.key));
    const months = byMonth(rows);

    const backdrop = document.createElement('div');
    backdrop.className = 'cs-modal-backdrop';
    backdrop.innerHTML = `<div class="cs-modal">
      <div class="cs-modal-head"><div><h2><span class="cs-dot ${typ}"></span>${esc(nazev)}</h2><div class="cs-subtitle">${esc(typLabel(typ))} • ${formatDatumISO(dates[0])} – ${formatDatumISO(dates.at(-1))}</div></div><button class="cs-close" id="cs-detail-close">×</button></div>
      <div class="cs-modal-body">
        <div class="cs-kpis">
          ${kpi('Projekce', fmtInt.format(s.projekce), 'celkem')}
          ${kpi('Návštěvníci*', fmtInt.format(s.navstevnici), 'evidovaná obsazená místa')}
          ${kpi('Ø / projekci', fmt1.format(s.prumer), 'průměr')}
          ${kpi('Medián', fmt1.format(s.median), 'návštěvníků')}
          ${kpi('Minimum / maximum', visitors.length ? `${fmtInt.format(Math.min(...visitors))} / ${fmtInt.format(Math.max(...visitors))}` : '—', 'na jedné projekci')}
          ${kpi('Obsazenost', `${fmt1.format(s.obsazenost)} %`, 'vážená kapacitou')}
        </div>
        <div class="cs-grid-2">
          <div class="cs-card"><h3>Podle dne v týdnu – Ø návštěvníků</h3>${bars(byDay, 'prumer', 'label', v => fmt1.format(v), 7)}</div>
          <div class="cs-card"><h3>Podle začátku – Ø návštěvníků</h3>${bars(byTime, 'prumer', 'label', v => fmt1.format(v), 20)}</div>
        </div>
        <div class="cs-grid-2">
          <div class="cs-card"><h3>Vývoj po měsících</h3>${bars(months, 'navstevnici', 'label', v => fmtInt.format(v), 60)}</div>
          <div class="cs-card"><h3>Den × čas – Ø návštěvníků</h3>${heatmap(rows)}</div>
        </div>
        <div class="cs-card cs-section"><h3>Jednotlivé projekce</h3>
          <div class="cs-table-wrap"><table><thead><tr><th>Datum</th><th>Čas</th><th>Návštěvníci*</th><th>Kapacita</th><th>Obsazenost</th><th>Carina</th></tr></thead><tbody>
            ${rows.slice().sort((a,b) => datumCas(b)-datumCas(a)).map(p => `<tr><td>${formatDatumISO(p.datumISO)} ${dayLabel(dayIndex(p.datumISO))}</td><td>${esc(p.od)}</td><td><b>${Number.isFinite(p.navstevnici) ? fmtInt.format(p.navstevnici) : '—'}</b></td><td>${Number.isFinite(p.total) ? fmtInt.format(p.total) : '—'}</td><td>${Number.isFinite(p.obsazenost) ? `${fmt1.format(p.obsazenost)} %` : '—'}</td><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">otevřít</a>` : '—'}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="cs-footnote">* Návštěvnost je odvozena jako kapacita − volná místa.</div>
      </div>
    </div>`;
    document.getElementById(ROOT_ID).appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#cs-detail-close').addEventListener('click', close);
  }

  function csvCell(v) {
    const text = String(v ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const data = dataPodleFiltru().slice().sort((a,b) => datumCas(a) - datumCas(b));
    const header = ['Datum','Čas od','Čas do','Pořad','Typ','Kapacita','Volno','Návštěvníci','Obsazenost %','UUID'];
    const rows = data.map(p => [p.datumISO,p.od,p.do,p.nazev,typLabel(p.typ),p.total,p.available,p.navstevnici,Number.isFinite(p.obsazenost) ? p.obsazenost.toFixed(1) : '',p.uuid]);
    const csv = '\uFEFF' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carina-statistiky-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ----------------------------
  // UI
  // ----------------------------
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const yearStart = `${now.getFullYear()}-01`;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `<div class="cs-shell">
    <div class="cs-header">
      <div><h1>Statistiky pořadů Carina</h1><div class="cs-subtitle">Proběhlé školní (modré) a veřejné (hnědé) pořady</div></div>
      <button class="cs-close" id="cs-close">×</button>
    </div>
    <div class="cs-body">
      <div class="cs-controls">
        <label class="cs-field">Od měsíce<input type="month" id="cs-from" value="${yearStart}"></label>
        <label class="cs-field">Do měsíce<input type="month" id="cs-to" value="${currentMonth}"></label>
        <div class="cs-field"><span>Typ pořadu</span><div class="cs-segmented" id="cs-type"><button class="active" data-filter="vse">Všechny</button><button data-filter="modry">🔵 Školní</button><button data-filter="hnedy">🟤 Veřejnost</button></div></div>
        <label class="cs-field">Hledat pořad<input type="search" id="cs-search" placeholder="název pořadu"></label>
        <button class="cs-button" id="cs-load">Načíst statistiky</button>
      </div>
      <div class="cs-status" id="cs-status">Připraveno.</div>
      <div id="cs-content"></div>
    </div>
  </div>`;
  document.body.appendChild(root);

  const statusEl = document.getElementById('cs-status');
  const loadBtn = document.getElementById('cs-load');

  function setStatus(text, error = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', error);
  }

  async function load() {
    try {
      loadBtn.disabled = true;
      state.loaded = false;
      state.all = [];
      render();
      state.resource = zjistiResource();
      if (!state.resource) {
        throw new Error('Nepodařilo se zjistit kalendář Cariny. Otevři jednou měsíční přehled Cariny a spusť statistiky znovu.');
      }
      const from = document.getElementById('cs-from').value;
      const to = document.getElementById('cs-to').value;
      const months = seznamMesicu(from, to);
      const nowKey = now.getFullYear() * 12 + (now.getMonth() + 1);
      const toParts = to.split('-').map(Number);
      if (toParts[0] * 12 + toParts[1] > nowKey) {
        setStatus('Období zasahuje do budoucna; budoucí projekce budou automaticky vynechány.');
      }

      let all = [];
      for (let i = 0; i < months.length; i++) {
        const m = months[i];
        setStatus(`Načítám ${m.mesic}/${m.rok} (${i + 1} z ${months.length})…`);
        const rows = await nactiMesic(m.rok, m.mesic);
        all.push(...rows);
      }

      // Deduplikace podle scheduleId, případně UUID+čas.
      all = [...new Map(all.map(p => [p.scheduleId || `${p.uuid}|${p.datumISO}|${p.od}`, p])).values()];
      if (!all.length) {
        state.all = [];
        state.loaded = true;
        setStatus('V zadaném období nebyly nalezeny žádné proběhlé modré ani hnědé pořady.');
        render();
        return;
      }

      const ids = [...new Set(all.map(p => p.scheduleId).filter(Boolean))];
      const caps = await nactiKapacityPoDavkach(ids, setStatus);
      all = all.map(p => {
        const c = caps[String(p.scheduleId)];
        if (c && Number.isFinite(c.total) && Number.isFinite(c.available)) {
          p.total = c.total;
          p.available = c.available;
          p.navstevnici = clamp(c.total - c.available, 0, c.total);
          p.obsazenost = percent(p.navstevnici, p.total);
        }
        return p;
      });

      state.all = all;
      state.loaded = true;
      const missing = all.filter(p => !Number.isFinite(p.navstevnici)).length;
      setStatus(`Hotovo: ${fmtInt.format(all.length)} proběhlých projekcí, ${fmtInt.format(new Set(all.map(p => `${p.typ}|${p.nazev}`)).size)} titulů.${missing ? ` U ${missing} projekcí nebyla dostupná kapacita.` : ''}`);
      render();
    } catch (e) {
      console.error('Carina statistiky:', e);
      setStatus(`CHYBA: ${e.message}`, true);
      state.loaded = false;
      render();
    } finally {
      loadBtn.disabled = false;
    }
  }

  document.getElementById('cs-close').addEventListener('click', () => root.remove());
  loadBtn.addEventListener('click', load);
  document.querySelectorAll('#cs-type button[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cs-type button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      render();
    });
  });
  document.getElementById('cs-search').addEventListener('input', e => {
    state.search = e.target.value.trim();
    render();
  });

  render();
})();
