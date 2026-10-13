(async function () {
  'use strict';

  // Fyzická kapacita kopule. Carina historicky krátce používala i hodnotu 290,
  // pro statistiky ale vždy omezujeme kapacitu na skutečných 278 míst.
  const MAX_KAPACITA = 278;

  const ROOT_ID = 'carina-statistiky-root';
  const STYLE_ID = 'carina-statistiky-style-link';
  const RESOURCE_STORAGE_KEY = 'carina-statistiky-resource';
  const MAX_MONTHS = 60;

  document.getElementById(ROOT_ID)?.remove();

  const scriptSrc = document.currentScript?.src || '';
  let howToUrl = '#';
  if (scriptSrc) {
    try { howToUrl = new URL('index.html', scriptSrc).href; } catch (_) {}
  }
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
    loaded: false,
    periodFrom: '2025-06-01',
    periodTo: null
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
    // Statistiky jsou záměrně stabilní během celého dne:
    // dnešní projekce se nezahrnují bez ohledu na to, zda už skončily.
    const dnes = new Date();
    dnes.setHours(0, 0, 0, 0);
    const [y, m, d] = p.datumISO.split('-').map(Number);
    const datumPoradu = new Date(y, m - 1, d, 0, 0, 0, 0);
    return datumPoradu.getTime() < dnes.getTime();
  }

  function vcerejsiDatumISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
        totalRaw: null,
        sold: null,
        reserved: null,
        locked: null,
        blocked: null,
        mode: null,
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
        available: item.available == null || item.available === '' ? null : Number(item.available),
        total: item.total == null || item.total === '' ? null : Number(item.total),
        sold: item.sold == null || item.sold === '' ? null : Number(item.sold),
        reserved: item.reserved == null || item.reserved === '' ? null : Number(item.reserved),
        locked: item.locked == null || item.locked === '' ? null : Number(item.locked),
        blocked: item.blocked == null || item.blocked === '' ? null : Number(item.blocked),
        mode: item.mode == null ? null : String(item.mode)
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
  function projdeTypemAHledanim(p) {
    if (state.filter !== 'vse' && p.typ !== state.filter) return false;
    if (state.search && !p.nazev.toLocaleLowerCase('cs').includes(state.search.toLocaleLowerCase('cs'))) return false;
    return true;
  }

  function dataHistoriePodleFiltru() {
    return state.all.filter(projdeTypemAHledanim);
  }

  function dataPodleFiltru() {
    const from = state.periodFrom || '2025-06-01';
    const to = state.periodTo || vcerejsiDatumISO();
    return state.all.filter(p => {
      if (!projdeTypemAHledanim(p)) return false;
      return p.datumISO >= from && p.datumISO <= to;
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

  function byMonthComplete(data, from = '2025-06', to = currentMonth) {
    const grouped = new Map(byMonth(data).map(item => [item.key, item]));
    return seznamMesicu(from, to).map(({ rok, mesic }) => {
      const key = `${rok}-${String(mesic).padStart(2, '0')}`;
      return grouped.get(key) || {
        key,
        label: monthKeyToLabel(key),
        projekce: 0,
        tituly: 0,
        navstevnici: 0,
        prumer: 0,
        obsazenost: 0,
        kapacita: 0,
        validCount: 0
      };
    });
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

  function topVisitorBars(items, maxItems = 10) {
    const sliced = items.slice(0, maxItems);
    const max = Math.max(1, ...sliced.map(x => Number(x.navstevnici) || 0));
    if (!sliced.length) return '<div class="cs-empty">Žádná data.</div>';

    return `<div class="cs-bar-list">${sliced.map(x => {
      const val = Number(x.navstevnici) || 0;
      const showType = state.filter === 'vse';
      const typeText = x.typ === 'modry' ? 'školní' : 'veřejnost';
      const label = `${x.nazev}${showType ? ` (${typeText})` : ''}`;
      const barClass = x.typ === 'modry' ? 'cs-bar-fill-blue' : 'cs-bar-fill-brown';
      const typeColor = x.typ === 'modry' ? '#1d4ed8' : '#7c2d12';
      const barColor = x.typ === 'modry' ? '#2563eb' : '#7f1d1d';
      const typeTextInline = showType ? ` (${typeText})` : '';
      return `<div class="cs-bar-row"><div title="${esc(label)}" style="color:${typeColor}!important;font-weight:700">${esc(x.nazev)}${esc(typeTextInline)}</div><div class="cs-bar-track"><div class="cs-bar-fill ${barClass}" style="width:${clamp(val / max * 100, 1, 100)}%;background-color:${barColor}!important;background-image:none!important"></div></div><div class="cs-bar-val">${esc(fmtInt.format(val))}</div></div>`;
    }).join('')}</div>`;
  }

  function renderKpis(data) {
    const s = summary(data);
    return `
      <div class="cs-kpis">
        ${kpi('Projekce', fmtInt.format(s.projekce), 'proběhlé termíny')}
        ${kpi('Tituly', fmtInt.format(s.tituly), 'název + typ pořadu')}
        ${kpi('Návštěvníci', fmtInt.format(s.navstevnici), 'evidováno v Carině jako Sold')}
        ${kpi('Ø na projekci', fmt1.format(s.prumer), 'aritmetický průměr')}
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
      <div class="cs-type-title"><span class="cs-dot ${type}"></span>${typLabel(type)}</div>
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
    const selected = groupPrograms(data);
    const historyMap = new Map(groupPrograms(dataHistoriePodleFiltru()).map(g => [g.key, g]));
    const programs = sortPrograms(selected.map(g => {
      const h = historyMap.get(g.key) || g;
      return {
        ...g,
        projekceCelkem: h.projekce,
        firstHistory: h.first,
        lastHistory: h.last
      };
    }));
    const arrow = key => state.sort.key === key ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `
      <div class="cs-section cs-card">
        <div class="cs-section-head"><div><h2>Statistiky pořadů</h2><div class="cs-inline-note">Výsledky za vybrané období; historie vysílání je vždy od června 2025.</div></div><button class="cs-button secondary" id="cs-export">Export CSV</button></div>
        <div class="cs-table-wrap"><table>
          <thead><tr>
            <th data-sort="nazev">Pořad${arrow('nazev')}</th>
            <th data-sort="typ">Typ${arrow('typ')}</th>
            <th data-sort="projekce">Projekcí v období${arrow('projekce')}</th>
            <th>Projekcí celkem</th>
            <th data-sort="navstevnici">Návštěvníků*${arrow('navstevnici')}</th>
            <th data-sort="prumer">Ø / projekci${arrow('prumer')}</th>
            <th data-sort="obsazenost">Obsazenost${arrow('obsazenost')}</th>
            <th data-sort="maximum">Maximum${arrow('maximum')}</th>
            <th>První vysílání</th>
            <th>Poslední vysílání</th>
          </tr></thead>
          <tbody>${programs.map(g => `<tr>
            <td><a href="#" class="cs-program" data-program="${esc(g.key)}"><span class="cs-dot ${g.typ}"></span>${esc(g.nazev)}</a></td>
            <td>${esc(typLabel(g.typ))}</td>
            <td>${fmtInt.format(g.projekce)}</td>
            <td><b>${fmtInt.format(g.projekceCelkem)}</b></td>
            <td><b>${fmtInt.format(g.navstevnici)}</b></td>
            <td>${fmt1.format(g.prumer)}</td>
            <td>${fmt1.format(g.obsazenost)} %</td>
            <td>${fmtInt.format(g.maximum)}</td>
            <td>${formatDatumISO(g.firstHistory)}</td>
            <td>${formatDatumISO(g.lastHistory)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  function renderOverview(data) {
    const programs = groupPrograms(data);
    const topVisitors = programs.slice().sort((a, b) => b.navstevnici - a.navstevnici);
    const monthsSelected = byMonth(data);
    const history = dataHistoriePodleFiltru();
    const historyMonths = byMonthComplete(history, '2025-06', currentMonth)
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key));
    const selectedLabel = `${formatDatumISO(state.periodFrom)} – ${formatDatumISO(state.periodTo)}`;
    return `
      <div class="cs-period-banner"><b>Zvolené období:</b> ${esc(selectedLabel)} <span>• souhrny a tabulka níže se počítají z tohoto období</span></div>
      ${renderKpis(data)}
      <div class="cs-grid-2">
        <div class="cs-card"><h3>Školní vs. veřejnost</h3><div class="cs-type-grid">${typeCard('modry', data)}${typeCard('hnedy', data)}</div></div>
        <div class="cs-card"><h3>Nejnavštěvovanější pořady</h3>${topVisitorBars(topVisitors)}</div>
      </div>
      <div class="cs-card cs-section">
        <details class="cs-history-details cs-monthly-details">
          <summary><b>Měsíční návštěvnost ve zvoleném období</b> <span class="cs-inline-note">— zobrazit po měsících</span></summary>
          <div class="cs-history-all">${bars(monthsSelected.slice().reverse(), 'navstevnici', 'label', v => fmtInt.format(v), 60)}</div>
        </details>
      </div>
      <div class="cs-card cs-section">
        <details class="cs-history-details">
          <summary><b>Historie počtu projekcí</b> <span class="cs-inline-note">— zobrazit všechny měsíce od června 2025</span></summary>
          <div class="cs-history-all">${bars(historyMonths, 'projekce', 'label', v => fmtInt.format(v), 999)}</div>
        </details>
      </div>
      ${renderProgramTable(data)}
      <div class="cs-footnote">„Návštěvníci“ vycházejí z pole <b>Sold</b> v Carině. Hodnota je pro ochranu proti chybným historickým nastavením omezena na maximálně <b>278 míst</b>.</div>`;
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
    const ranked = [];
    for (const [key, values] of cells) {
      const v = avg(values);
      avgs.set(key, v);
      max = Math.max(max, v);
      if (Number.isFinite(v)) ranked.push({ key, value: v });
    }

    // Zvýraznění v tabulce Den × čas:
    // pouze tři nejlepší buňky oranžově. Všechny ostatní zůstávají v modré škále.
    const top3 = new Set(
      ranked.slice().sort((a, b) => b.value - a.value).slice(0, 3).map(item => item.key)
    );

    return `<div class="cs-table-wrap"><table class="cs-heat"><thead><tr><th>Čas</th>${[0,1,2,3,4,5,6].map(d => `<th>${dayLabel(d)}</th>`).join('')}</tr></thead><tbody>
      ${times.map(t => `<tr><th>${esc(t)}</th>${[0,1,2,3,4,5,6].map(d => {
        const key = `${d}|${t}`;
        const v = avgs.get(key);
        if (!Number.isFinite(v)) return '<td>—</td>';
        const level = max > 0 ? clamp(Math.ceil(v / max * 5), 1, 5) : 1;
        const isTop = top3.has(key);
        const highlightClass = isTop ? 'cs-heat-top' : '';
        const title = isTop
          ? 'Jeden ze 3 nejvyšších průměrů návštěvnosti'
          : 'Průměrná evidovaná návštěvnost';
        // Zvýraznění dáváme i inline, aby ho nepřebil styl Cariny
        // ani případná starší verze style.css v cache prohlížeče.
        const inlineStyle = isTop
          ? 'background:#f59e0b!important;color:#111827!important;font-weight:850;border-radius:4px;'
          : '';
        return `<td class="${highlightClass}" data-level="${level}" style="${inlineStyle}" title="${title}">${fmt1.format(v)}</td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
  }

  function openDetail(key) {
    const [typ, ...nameParts] = key.split('|');
    const nazev = nameParts.join('|');

    // Celá dostupná historie pořadu slouží jen pro informaci o prvním/posledním vysílání.
    const historyRows = state.all.filter(p => p.typ === typ && p.nazev === nazev);
    if (!historyRows.length) return;

    // Všechny ostatní statistiky detailu respektují právě zvolené období Od–Do.
    const rows = historyRows.filter(p => p.datumISO >= state.periodFrom && p.datumISO <= state.periodTo);
    if (!rows.length) return;

    const s = summary(rows);
    const visitors = rows.filter(p => Number.isFinite(p.navstevnici)).map(p => p.navstevnici);
    const historyDates = historyRows.map(p => p.datumISO).sort();
    const byDay = detailBreakdown(rows, p => dayIndex(p.datumISO), k => dayLabel(Number(k))).sort((a, b) => Number(a.key) - Number(b.key));
    const byTime = detailBreakdown(rows, p => p.od, k => k).sort((a, b) => a.key.localeCompare(b.key));
    const months = byMonth(rows);
    const selectedPeriodLabel = `${formatDatumISO(state.periodFrom)} – ${formatDatumISO(state.periodTo)}`;

    const backdrop = document.createElement('div');
    backdrop.className = 'cs-modal-backdrop';
    backdrop.innerHTML = `<div class="cs-modal">
      <div class="cs-modal-head"><div><h2><span class="cs-dot ${typ}"></span>${esc(nazev)}</h2><div class="cs-subtitle">První vysílání ${formatDatumISO(historyDates[0])} • poslední vysílání ${formatDatumISO(historyDates.at(-1))}</div></div><button class="cs-close" id="cs-detail-close">×</button></div>
      <div class="cs-modal-body">
        <div class="cs-period-banner"><b>Zvolené období:</b> ${esc(selectedPeriodLabel)} <span>• všechny statistiky detailu níže se počítají z tohoto období</span></div>
        <div class="cs-kpis">
          ${kpi('Projekce v období', fmtInt.format(s.projekce), selectedPeriodLabel)}
          ${kpi('Návštěvníci', fmtInt.format(s.navstevnici), 'evidováno v Carině jako Sold')}
          ${kpi('Ø / projekci', fmt1.format(s.prumer), 'průměr')}
          ${kpi('Minimum / maximum', visitors.length ? `${fmtInt.format(Math.min(...visitors))} / ${fmtInt.format(Math.max(...visitors))}` : '—', 'na jedné projekci')}
          ${kpi('Obsazenost', `${fmt1.format(s.obsazenost)} %`, 'vážená kapacitou')}
        </div>
        <div class="cs-grid-2">
          <div class="cs-card"><h3>Podle dne v týdnu – Ø návštěvníků</h3>${bars(byDay, 'prumer', 'label', v => fmt1.format(v), 7)}</div>
          <div class="cs-card"><h3>Podle začátku – Ø návštěvníků</h3>${bars(byTime, 'prumer', 'label', v => fmt1.format(v), 20)}</div>
        </div>
        <div class="cs-grid-2">
          <div class="cs-card"><h3>Projekce po měsících ve zvoleném období</h3>${bars(months, 'projekce', 'label', v => fmtInt.format(v), 60)}</div>
          <div class="cs-card"><h3>Návštěvnost po měsících ve zvoleném období</h3>${bars(months, 'navstevnici', 'label', v => fmtInt.format(v), 60)}</div>
        </div>
        <div class="cs-card cs-section"><h3>Den × čas – Ø návštěvníků</h3>${heatmap(rows)}</div>
        <details class="cs-card cs-section cs-history-details">
          <summary>Jednotlivé projekce ve zvoleném období – data Cariny</summary>
          <div class="cs-inline-note" style="margin:10px 0">Prodané = <b>Sold</b>, neprodané = <b>Available</b>, počet míst v sále = <b>Total</b> (pro výpočty maximálně 278).</div>
          <div class="cs-table-wrap"><table><thead><tr>
            <th>Datum</th><th>Čas</th><th>Prodané</th><th>Neprodané</th><th>Počet míst v sále</th><th>Obsazenost</th><th>Carina</th>
          </tr></thead><tbody>
            ${rows.slice().sort((a,b) => datumCas(b)-datumCas(a)).map(p => `<tr>
              <td>${formatDatumISO(p.datumISO)} ${dayLabel(dayIndex(p.datumISO))}</td>
              <td>${esc(p.od)}</td>
              <td><b>${Number.isFinite(p.navstevnici) ? fmtInt.format(p.navstevnici) : '—'}</b></td>
              <td>${Number.isFinite(p.available) ? fmtInt.format(p.available) : '—'}</td>
              <td>${Number.isFinite(p.total) ? fmtInt.format(p.total) : '—'}</td>
              <td>${Number.isFinite(p.obsazenost) ? `${fmt1.format(p.obsazenost)} %` : '—'}</td>
              <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">otevřít</a>` : '—'}</td>
            </tr>`).join('')}
          </tbody></table></div>
        </details>
        <div class="cs-footnote">Návštěvnost = <b>Sold</b> z Cariny, maximálně 278. Obsazenost = návštěvnost / efektivní kapacita (max. 278).</div>
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
    const header = ['Datum','Čas od','Čas do','Pořad','Typ','Prodané (Sold)','Neprodané (Available)','Počet míst v sále','Obsazenost %','UUID'];
    const rows = data.map(p => [p.datumISO,p.od,p.do,p.nazev,typLabel(p.typ),p.navstevnici,p.available,p.total,Number.isFinite(p.obsazenost) ? p.obsazenost.toFixed(1) : '',p.uuid]);
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
  const yesterdayISO = vcerejsiDatumISO();
  const currentMonth = yesterdayISO.slice(0, 7);
  const defaultStart = '2025-06-01';

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `<div class="cs-shell">
    <div class="cs-header">
      <div><h1>Statistiky pořadů Carina</h1><div class="cs-subtitle">Školní (modré) a veřejné (hnědé) pořady — data vždy do včerejška</div></div>
      <button class="cs-close" id="cs-close">×</button>
    </div>
    <div class="cs-body">
      <div class="cs-controls">
        <label class="cs-field">Od data<input type="date" id="cs-from" min="2025-06-01" max="${yesterdayISO}" value="${defaultStart}"></label>
        <label class="cs-field">Do data<input type="date" id="cs-to" min="2025-06-01" max="${yesterdayISO}" value="${yesterdayISO}"></label>
        <div class="cs-field"><span>Typ pořadu</span><div class="cs-segmented" id="cs-type"><button class="active" data-filter="vse">Všechny</button><button data-filter="modry">🔵 Školní</button><button data-filter="hnedy">🟤 Veřejnost</button></div></div>
        <label class="cs-field">Hledat pořad<input type="search" id="cs-search" placeholder="název pořadu"></label>
        <button class="cs-button" id="cs-load">Načíst statistiky</button>
        <a class="cs-button secondary" id="cs-howto" href="${esc(howToUrl)}" target="_blank" rel="noopener noreferrer" title="Návod a vysvětlení statistik">HOW TO / Nápověda</a>
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
      if (from < '2025-06-01') throw new Error('Historie Planetária po rekonstrukci začíná 1. června 2025.');
      if (from > to) throw new Error('Datum Od musí být nejpozději datum Do.');
      const effectiveTo = to > yesterdayISO ? yesterdayISO : to;
      state.periodFrom = from;
      state.periodTo = effectiveTo;

      // Vždy načteme celou historii od června 2025 do aktuálního měsíce.
      // Zvolená data pak fungují jako filtr bez nutnosti znovu sahat do Cariny.
      const months = seznamMesicu('2025-06', currentMonth);

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
        if (c) {
          p.totalRaw = Number.isFinite(c.total) ? c.total : null;
          p.total = Number.isFinite(c.total) && c.total > 0 ? Math.min(c.total, MAX_KAPACITA) : MAX_KAPACITA;
          p.available = c.available;
          p.sold = c.sold;
          p.reserved = c.reserved;
          p.locked = c.locked;
          p.blocked = c.blocked;
          p.mode = c.mode;

          // Návštěvnost bereme z pole Sold. Diagnostika ukázala, že Available
          // zahrnuje i rezervace/blokace a u historické kapacity 290 výrazně zkresluje výsledek.
          if (Number.isFinite(c.sold) && c.sold >= 0) {
            p.navstevnici = clamp(c.sold, 0, MAX_KAPACITA);
            p.obsazenost = percent(p.navstevnici, p.total);
          }
        }
        return p;
      });

      state.all = all;
      state.loaded = true;
      const missing = all.filter(p => !Number.isFinite(p.navstevnici)).length;
      setStatus(`Hotovo: načtena historie od 01.06.2025 do ${formatDatumISO(yesterdayISO)} — ${fmtInt.format(all.length)} projekcí, ${fmtInt.format(new Set(all.map(p => `${p.typ}|${p.nazev}`)).size)} titulů.${missing ? ` U ${missing} projekcí nebyl dostupný údaj Sold.` : ''}`);
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

  ['cs-from', 'cs-to'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const from = document.getElementById('cs-from').value;
      const to = document.getElementById('cs-to').value;
      try {
        if (from < '2025-06-01') throw new Error('Nejdřívější podporované datum je 1. června 2025.');
        if (from > to) throw new Error('Datum Od musí být nejpozději datum Do.');
        const effectiveTo = to > yesterdayISO ? yesterdayISO : to;
        state.periodFrom = from;
        state.periodTo = effectiveTo;
        if (state.loaded) {
          setStatus(`Zobrazuji období ${formatDatumISO(from)} – ${formatDatumISO(effectiveTo)}. Historie zůstává načtená od 01.06.2025 do včerejška.`);
          render();
        }
      } catch (e) {
        setStatus(`CHYBA: ${e.message}`, true);
      }
    });
  });

  state.periodTo = yesterdayISO;
  render();
})();
