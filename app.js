/* ============================================================
   RegistrObraApp v3 — Registro de obra en campo
   Funciona sin conexión y sincroniza con Google Sheets + Drive
   Datos maestros: 10 PDT CENIT (ver pdt-data.js)
   ============================================================ */
const APP_VERSION = '3.0.0';
const NR = 'No registra en PDT';
const NA = 'No aplica';
const OTRO = '__otro__';
const EJECUTOR = 'BUSINESS AND QUALITY SERVICES S.A.S';
const ROOT_FOLDER = 'REGISTROS EN CAMPO';
const C_NAVY = [21, 66, 112], C_TEAL = [31, 155, 196], C_SLATE = [52, 80, 111], C_ROW = [242, 246, 250];

/* ---------------- Datos maestros ---------------- */
const PROYECTOS = {};
PDT_DATA.proyectos.forEach(p => { PROYECTOS[p.id] = p; });
const LINES = PDT_DATA.lineas;               // {k,p,z,o,c,a,d,m,pr,i,ds,u,q,n}
const LINE_BY_KEY = {};
LINES.forEach(l => { l.sig = lineSig(l); LINE_BY_KEY[l.k] = l; });
const ZONAS = [];
const ZONA_PROY = {};
LINES.forEach(l => { if (!ZONAS.includes(l.z)) { ZONAS.push(l.z); ZONA_PROY[l.z] = l.p; } });

function lineSig(l) { return [l.p, l.c, l.d, l.m, l.pr, l.i, l.ds, l.u].join('|'); }
function proyLabel(pid) { const p = PROYECTOS[pid]; return p ? (p.id + ' · ' + p.nombre) : (pid || '-'); }
function uniq(arr) { return Array.from(new Set(arr)); }
function compSortKey(id) {
  const m = String(id).match(/^([A-Za-z_]+?)_?(\d+)(.*)$/);
  return m ? [m[1].toUpperCase(), parseInt(m[2], 10), m[3] || ''] : [String(id), 0, ''];
}
function compareComp(a, b) {
  const x = compSortKey(a), y = compSortKey(b);
  if (x[0] !== y[0]) return x[0] < y[0] ? -1 : 1;
  if (x[1] !== y[1]) return x[1] - y[1];
  return x[2].localeCompare(y[2]);
}
function compareItem(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}
function fmtNum(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}
function codeOf(r) { return 'R-' + String(r.uid || '').slice(-6).toUpperCase(); }

/* ---------------- IndexedDB ---------------- */
const DB_NAME = 'registrObraDB_v2';
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('registros')) d.createObjectStore('registros', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e);
  });
}
function store(name, mode) { return db.transaction(name, mode).objectStore(name); }
function idbReq(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = e => rej(e); }); }
const idbGetAll = n => idbReq(store(n, 'readonly').getAll()).then(r => r || []);
const idbGet = (n, k) => idbReq(store(n, 'readonly').get(k));
const idbPut = (n, v) => idbReq(store(n, 'readwrite').put(v));
const idbDelete = (n, k) => idbReq(store(n, 'readwrite').delete(k));
const idbClear = n => idbReq(store(n, 'readwrite').clear());

/* ---------------- Estado ---------------- */
const STATE = { registros: [], editingId: null, photos: [], firma: null, device: null, apiUrl: '', adminKey: '', adminOk: false };
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
async function loadRegistros() {
  STATE.registros = await idbGetAll('registros');
  STATE.registros.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || String(b.creado || '').localeCompare(String(a.creado || '')));
}
function isMine(r) { return r.owner === STATE.device.id; }
function canEdit(r) { return isMine(r) || STATE.adminOk; }
function fotosOf(r) { return (r.fotos || []).map(f => typeof f === 'string' ? { data: f } : f).filter(f => f && (f.data || f.id)); }
function firmaOf(r) { const f = r.firma; if (!f) return null; return typeof f === 'string' ? { data: f } : ((f.data || f.id) ? f : null); }
function driveThumb(id, w) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (w || 400); }
function imgSrc(f, w) { return f ? (f.data || (f.id ? driveThumb(f.id, w) : '')) : ''; }

/* ---------------- Utilidades UI ---------------- */
const $ = id => document.getElementById(id);
function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3600);
}
function setTab(name) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  refreshView(name);
  window.scrollTo(0, 0);
}
function activeTab() { const b = document.querySelector('nav.tabs button.active'); return b ? b.dataset.tab : 'nuevo'; }
function refreshView(name) {
  name = name || activeTab();
  if (name === 'registros') renderRegistros();
  if (name === 'maestro') renderMaestro();
  if (name === 'datos') { renderExportSelector(); renderStorageInfo(); renderSyncInfo(); }
}
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function fillSelect(sel, values, placeholder, labelFn) {
  sel.innerHTML = '<option value="">' + escapeHtml(placeholder || 'Selecciona…') + '</option>' +
    values.map(v => '<option value="' + escapeHtml(v) + '">' + escapeHtml(labelFn ? labelFn(v) : v) + '</option>').join('');
}
async function getMeta(key, def) { const m = await idbGet('meta', key); return m ? m.value : def; }
async function setMeta(key, value) { await idbPut('meta', { key, value }); }

/* ---------------- Fecha DD/MM/AA ---------------- */
function isoToDMA(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return iso;
  return d + '/' + m + '/' + y.slice(-2);
}
function dmaToIso(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = 2000 + +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
$('f_fecha').addEventListener('input', e => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (v.length > 4) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
  else if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
  e.target.value = v;
});
$('btnCal').addEventListener('click', () => {
  const cal = $('f_fecha_cal');
  cal.value = dmaToIso($('f_fecha').value) || todayIso();
  try { if (cal.showPicker) { cal.showPicker(); return; } } catch (e) { /* sigue */ }
  cal.focus(); cal.click();
});
$('f_fecha_cal').addEventListener('change', e => { if (e.target.value) $('f_fecha').value = isoToDMA(e.target.value); });

/* ============================================================
   CASCADA: Zona → ODS → ID COMP → Departamento → Municipio → Predio
   ============================================================ */
const CASCADE = [
  { id: 'f_zona', key: 'z', ph: 'Selecciona la zona…' },
  { id: 'f_ods', key: 'o', ph: 'Selecciona el ODS…' },
  { id: 'f_comp', key: 'c', ph: 'Selecciona el ID COMP…', sort: compareComp },
  { id: 'f_departamento', key: 'd', ph: 'Selecciona el departamento…' },
  { id: 'f_municipio', key: 'm', ph: 'Selecciona el municipio…' },
  { id: 'f_predio', key: 'pr', ph: 'Selecciona el predio…' }
];
let PDT_PREDIOS = [];   // predios del PDT para la selección actual
function currentSel(upto) {
  const s = {};
  for (let i = 0; i < CASCADE.length && i < upto; i++) s[CASCADE[i].key] = $(CASCADE[i].id).value;
  if ('pr' in s && !PDT_PREDIOS.includes(s.pr)) s.pr = '';   // predio escrito en campo: sin filtro de predio
  return s;
}
function linesMatching(sel) {
  return LINES.filter(l => Object.keys(sel).every(k => !sel[k] || l[k] === sel[k]));
}
function manualPrediosFor(sel) {
  const p = ZONA_PROY[sel.z];
  return uniq(STATE.registros.filter(r => r.predioManual && r.proyecto === p && r.comp === sel.c && r.departamento === sel.d && r.municipio === sel.m).map(r => r.predio)).filter(Boolean).sort();
}
function populateLevel(idx, keepValue) {
  const lvl = CASCADE[idx];
  const el = $(lvl.id);
  const parentSel = currentSel(idx);
  const parentsOk = CASCADE.slice(0, idx).every(p => $(p.id).value);
  if (lvl.key === 'pr') { $('f_predio_otro').style.display = 'none'; }
  if (!parentsOk) { fillSelect(el, [], lvl.ph); el.disabled = true; if (lvl.key === 'pr') PDT_PREDIOS = []; return; }
  let vals = uniq(linesMatching(parentSel).map(l => l[lvl.key]));
  if (idx === 0) vals = ZONAS.slice();
  vals.sort(lvl.sort || ((a, b) => a.localeCompare(b, 'es')));
  if (lvl.key === 'pr') {
    PDT_PREDIOS = vals.slice();
    const manual = manualPrediosFor(parentSel).filter(v => !vals.includes(v));
    el.innerHTML = '<option value="">' + lvl.ph + '</option>' +
      vals.map(v => '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>').join('') +
      manual.map(v => '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + ' (escrito en campo)</option>').join('') +
      '<option value="' + OTRO + '">✎ Otro: escribir el nombre del predio</option>';
    el.disabled = false;
    if (keepValue && (vals.includes(keepValue) || manual.includes(keepValue))) el.value = keepValue;
    else if (keepValue) { el.value = OTRO; $('f_predio_otro').value = keepValue; $('f_predio_otro').style.display = ''; }
    else if (vals.length === 1) el.value = vals[0];
    return;
  }
  fillSelect(el, vals, lvl.ph);
  el.disabled = false;
  if (keepValue && vals.includes(keepValue)) el.value = keepValue;
  else if (vals.length === 1) el.value = vals[0];
}
function onCascadeChange(idx, presets) {
  presets = presets || {};
  for (let j = idx + 1; j < CASCADE.length; j++) populateLevel(j, presets[CASCADE[j].key]);
  updateProjStrip();
  updateActo(presets.a);
  refreshItemRows();
}
CASCADE.forEach((lvl, idx) => $(lvl.id).addEventListener('change', () => onCascadeChange(idx)));
$('f_predio').addEventListener('change', () => {
  const otro = $('f_predio').value === OTRO;
  $('f_predio_otro').style.display = otro ? '' : 'none';
  if (otro) setTimeout(() => $('f_predio_otro').focus(), 50);
});
function predioIsManual() { const v = $('f_predio').value; return !!v && !PDT_PREDIOS.includes(v); }
function currentPredio() { const v = $('f_predio').value; return v === OTRO ? $('f_predio_otro').value.trim().replace(/\s+/g, ' ') : v; }

function updateProjStrip() {
  const z = $('f_zona').value;
  $('projStrip').innerHTML = z
    ? 'Proyecto: <b>' + escapeHtml(proyLabel(ZONA_PROY[z])) + '</b>' + (PROYECTOS[ZONA_PROY[z]].contrato ? ' · Contrato/ODS ' + escapeHtml(PROYECTOS[ZONA_PROY[z]].contrato) : '')
    : 'Proyecto: <b>elige una zona</b>';
}
function cascadeComplete() { return CASCADE.every(l => $(l.id).value); }
function updateActo(preset) {
  const inp = $('f_acto'), sel = $('f_acto_select');
  if (!cascadeComplete()) { inp.value = ''; inp.style.display = ''; sel.style.display = 'none'; sel.innerHTML = ''; return; }
  const actos = uniq(linesMatching(currentSel(CASCADE.length)).map(l => l.a)).sort();
  if (actos.length <= 1) {
    inp.value = actos[0] || NR; inp.style.display = ''; sel.style.display = 'none'; sel.innerHTML = '';
  } else {
    fillSelect(sel, actos, 'Hay ' + actos.length + ' actos en el PDT, elige uno…');
    if (preset && actos.includes(preset)) sel.value = preset;
    inp.style.display = 'none'; sel.style.display = '';
  }
}
$('f_acto_select').addEventListener('change', refreshItemRows);
function currentActo() { return $('f_acto_select').style.display === 'none' ? $('f_acto').value : $('f_acto_select').value; }
/* Ítems disponibles. Con predio del PDT: líneas de ese predio (con cantidad contractual).
   Con predio escrito en campo: ítems del COMP/municipio sin cantidad contractual. */
function availableLines() {
  if (!cascadeComplete()) return [];
  const sel = currentSel(CASCADE.length);
  const multiActo = $('f_acto_select').style.display !== 'none';
  if (multiActo) { if (!$('f_acto_select').value) return []; sel.a = $('f_acto_select').value; }
  let lines = linesMatching(sel);
  if (predioIsManual()) {
    const seen = {};
    lines = lines.filter(l => { const k = l.i + '|' + l.ds + '|' + l.u; if (seen[k]) return false; seen[k] = 1; return true; })
      .map(l => ({ k: 'M:' + l.k, p: l.p, c: l.c, d: l.d, m: l.m, pr: null, i: l.i, ds: l.ds, u: l.u, q: null, n: 1, manual: true }));
  }
  return lines.sort((x, y) => compareItem(x.i, y.i) || x.ds.localeCompare(y.ds));
}
function lineForKey(k) {
  if (!k) return null;
  if (k.startsWith('M:')) {
    const b = LINE_BY_KEY[k.slice(2)]; if (!b) return null;
    const pr = currentPredio();
    return { k, p: b.p, c: b.c, d: b.d, m: b.m, pr, i: b.i, ds: b.ds, u: b.u, q: null, n: 1, manual: true, sig: [b.p, b.c, b.d, b.m, '✎ ' + pr, b.i, b.ds, b.u].join('|') };
  }
  return LINE_BY_KEY[k] || null;
}

/* ============================================================
   ACTIVIDADES (ítems del PDT)
   ============================================================ */
function executedBySig(excludeUid) {
  const map = {};
  STATE.registros.forEach(r => {
    if (r.sync === 'borrar') return;
    if (excludeUid && r.uid === excludeUid) return;
    (r.items || []).forEach(it => {
      if (!it.sig) return;
      const q = parseFloat(it.cantidad);
      if (!map[it.sig]) map[it.sig] = { q: 0, n: 0, last: '' };
      map[it.sig].q += isNaN(q) ? 0 : q; map[it.sig].n++;
      if ((r.fecha || '') > map[it.sig].last) map[it.sig].last = r.fecha || '';
    });
  });
  return map;
}
function itemOptionsHtml(lines, selectedKey) {
  if (!lines.length) return '<option value="">' + (cascadeComplete() ? 'Elige primero el acto administrativo…' : 'Completa zona, ODS, COMP, departamento, municipio y predio…') + '</option>';
  return '<option value="">Selecciona el ítem…</option>' + lines.map(l => {
    const d = l.ds.length > 90 ? l.ds.slice(0, 88) + '…' : l.ds;
    return '<option value="' + l.k + '"' + (l.k === selectedKey ? ' selected' : '') + '>' + escapeHtml(l.i + ' · ' + d + ' (' + l.u + ')') + '</option>';
  }).join('');
}
function addItemRow(data) {
  const div = document.createElement('div');
  div.className = 'item-row';
  div.innerHTML =
    '<div class="item-row-head"><span class="item-row-num">Actividad</span>' +
    '<button type="button" class="btn btn-danger btn-sm rmRow">Quitar</button></div>' +
    '<div class="field"><label>ÍTEM trabajado <span class="req">*</span></label>' +
    '<select class="row-item"></select><div class="err-msg">Selecciona el ítem.</div></div>' +
    '<div class="row-preview activity-preview empty">Elige un ítem para ver la descripción y las cantidades del PDT.</div>' +
    '<div class="row2" style="margin-top:12px;">' +
    '<div class="field" style="margin-bottom:0;"><label>Cantidad ejecutada <span class="req">*</span></label>' +
    '<input type="number" class="row-cant" inputmode="decimal" step="any" min="0" placeholder="0"><div class="err-msg">Indica la cantidad.</div></div>' +
    '<div class="field" style="margin-bottom:0;"><label>Unidad</label><input type="text" class="row-unid auto" readonly placeholder="Según el PDT"></div>' +
    '</div>';
  $('itemsContainer').appendChild(div);
  const sel = div.querySelector('.row-item');
  const lines = availableLines();
  let key = data && data.k;
  if (data && key && !lines.some(l => l.k === key)) {
    // buscar por ítem/descripción (p. ej. predio escrito en campo)
    const m = lines.find(l => l.i === data.item && l.ds === data.actividad && l.u === data.unidad);
    key = m ? m.k : null;
  }
  sel.innerHTML = itemOptionsHtml(lines, key);
  if (data) {
    if (!sel.value && data.item) {
      sel.insertAdjacentHTML('beforeend', '<option value="__saved__" selected>' + escapeHtml(data.item + ' · ' + data.actividad + ' (guardado)') + '</option>');
      div.dataset.saved = JSON.stringify(data);
    }
    div.querySelector('.row-cant').value = (data.cantidad === undefined || data.cantidad === null) ? '' : data.cantidad;
  }
  sel.addEventListener('change', () => updateRowPreview(div));
  div.querySelector('.rmRow').addEventListener('click', () => {
    if (document.querySelectorAll('#itemsContainer .item-row').length <= 1) { toast('Debe quedar al menos una actividad', true); return; }
    div.remove(); renumberRows(); updateFotoHint();
  });
  updateRowPreview(div); renumberRows(); updateFotoHint();
}
function updateRowPreview(div) {
  const sel = div.querySelector('.row-item');
  const prev = div.querySelector('.row-preview');
  const unid = div.querySelector('.row-unid');
  let l = lineForKey(sel.value);
  if (!l && sel.value === '__saved__' && div.dataset.saved) {
    const s = JSON.parse(div.dataset.saved);
    l = { i: s.item, ds: s.actividad, u: s.unidad, q: s.contractual, n: 1, sig: s.sig };
  }
  if (!l) { prev.className = 'row-preview activity-preview empty'; prev.textContent = 'Elige un ítem para ver la descripción y las cantidades del PDT.'; unid.value = ''; return; }
  unid.value = l.u;
  const editingUid = STATE.editingId ? (STATE.registros.find(r => r.id === STATE.editingId) || {}).uid : null;
  const ex = executedBySig(editingUid)[l.sig] || { q: 0, n: 0 };
  prev.className = 'row-preview activity-preview';
  prev.innerHTML = '<span class="lbl">Ítem ' + escapeHtml(l.i) + '</span>' + escapeHtml(l.ds) +
    (l.manual
      ? '<div class="muted" style="margin-top:6px;">Predio escrito en campo: este predio no tiene cantidad contractual en el PDT.</div>'
      : '<div class="ref-grid">' +
      '<div class="ref"><div class="rl">Cant. contractual</div><div class="rv">' + fmtNum(l.q) + ' ' + escapeHtml(l.u) + '</div></div>' +
      '<div class="ref"><div class="rl">Ejecutado antes</div><div class="rv">' + fmtNum(ex.q) + '</div></div>' +
      '<div class="ref"><div class="rl">Saldo</div><div class="rv">' + (l.q === null || l.q === undefined ? '—' : fmtNum(l.q - ex.q)) + '</div></div>' +
      '</div>' + (l.n > 1 ? '<div class="muted" style="margin-top:6px;">La cantidad contractual suma ' + l.n + ' líneas iguales del PDT.</div>' : ''));
}
function renumberRows() {
  document.querySelectorAll('#itemsContainer .item-row').forEach((d, i) => { d.querySelector('.item-row-num').textContent = 'Actividad ' + (i + 1); });
}
function refreshItemRows() {
  const lines = availableLines();
  document.querySelectorAll('#itemsContainer .item-row').forEach(div => {
    const sel = div.querySelector('.row-item');
    const cur = sel.value;
    if (cur === '__saved__') return;
    let key = cur;
    if (key && !lines.some(l => l.k === key)) {
      const old = lineForKey(key);
      const m = old ? lines.find(l => l.i === old.i && l.ds === old.ds && l.u === old.u) : null;
      key = m ? m.k : '';
    }
    sel.innerHTML = itemOptionsHtml(lines, key);
    updateRowPreview(div);
  });
}
$('btnAddRow').addEventListener('click', () => addItemRow());
$('f_predio_otro').addEventListener('input', () => document.querySelectorAll('#itemsContainer .item-row').forEach(updateRowPreview));

/* ============================================================
   FOTOS Y FIRMA (desde la galería)
   ============================================================ */
function compressImage(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        if (h > maxW * 1.4) { w = Math.round(w * maxW * 1.4 / h); h = Math.round(maxW * 1.4); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
$('f_foto_archivo').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  let fallos = 0;
  for (const f of files) {
    try { STATE.photos.push({ data: await compressImage(f, 1280, 0.68) }); } catch (err) { fallos++; }
  }
  e.target.value = '';
  renderPhotoGrid();
  if (fallos) toast(fallos + ' foto(s) no se pudieron leer', true);
  else if (files.length) toast(files.length + ' foto(s) agregada(s)');
});
function renderPhotoGrid() {
  $('photoGrid').innerHTML = STATE.photos.map((f, i) =>
    '<div class="photo-thumb"><img src="' + imgSrc(f, 200) + '" alt="Foto ' + (i + 1) + '"><button type="button" data-i="' + i + '" class="rmPhoto" aria-label="Quitar foto">✕</button></div>').join('');
  $('photoGrid').querySelectorAll('.rmPhoto').forEach(b => b.addEventListener('click', () => { STATE.photos.splice(+b.dataset.i, 1); renderPhotoGrid(); }));
  updateFotoHint();
}
function updateFotoHint() {
  const n = document.querySelectorAll('#itemsContainer .item-row').length;
  const el = $('fotoErr');
  if (el.style.display === 'block') {
    if (STATE.photos.length >= n * 4) el.style.display = 'none';
    else el.textContent = 'Debes cargar al menos ' + (n * 4) + ' fotos (' + n + ' actividad(es) × 4). Llevas ' + STATE.photos.length + '.';
  }
}
$('f_firma_archivo').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try { setFirma({ data: await compressImage(f, 700, 0.88) }); toast('Firma cargada'); }
  catch (err) { toast('No se pudo cargar la imagen de firma', true); }
  e.target.value = '';
});
function setFirma(f) {
  STATE.firma = f || null;
  const p = $('firmaPreview');
  if (STATE.firma) { $('firmaErr').style.display = 'none'; p.innerHTML = '<img src="' + imgSrc(STATE.firma, 600) + '" style="max-height:140px;max-width:100%;" alt="Firma">'; }
  else { p.textContent = 'Aún no has cargado una firma.'; }
}
$('btnClearSig').addEventListener('click', () => setFirma(null));

/* ============================================================
   GUARDAR / VALIDAR / EDITAR
   ============================================================ */
function clearErrors() {
  document.querySelectorAll('.has-error').forEach(f => f.classList.remove('has-error'));
  document.querySelectorAll('.invalid').forEach(f => f.classList.remove('invalid'));
  $('fotoErr').style.display = 'none'; $('firmaErr').style.display = 'none';
}
function markError(el) { el.classList.add('invalid'); const f = el.closest('.field'); if (f) f.classList.add('has-error'); }
function validateForm() {
  clearErrors();
  let ok = true;
  CASCADE.forEach(l => { if (!$(l.id).value) { markError($(l.id)); ok = false; } });
  if ($('f_predio').value === OTRO && !currentPredio()) { markError($('f_predio_otro')); ok = false; }
  if ($('f_acto_select').style.display !== 'none' && !$('f_acto_select').value) { markError($('f_acto_select')); ok = false; }
  if (!$('f_registrado').value.trim()) { markError($('f_registrado')); ok = false; }
  if (!dmaToIso($('f_fecha').value)) { markError($('f_fecha')); ok = false; }
  const rows = document.querySelectorAll('#itemsContainer .item-row');
  rows.forEach(div => {
    const s = div.querySelector('.row-item'), c = div.querySelector('.row-cant');
    if (!s.value) { markError(s); ok = false; }
    if (c.value === '' || isNaN(parseFloat(c.value)) || parseFloat(c.value) < 0) { markError(c); ok = false; }
  });
  const min = rows.length * 4;
  if (STATE.photos.length < min) {
    $('fotoErr').style.display = 'block';
    $('fotoErr').textContent = 'Debes cargar al menos ' + min + ' fotos (' + rows.length + ' actividad(es) × 4). Llevas ' + STATE.photos.length + '.';
    ok = false;
  }
  if (!STATE.firma) { $('firmaErr').style.display = 'block'; ok = false; }
  return ok;
}
$('regForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!validateForm()) {
    toast('Revisa los campos marcados en rojo', true);
    const first = document.querySelector('.has-error, #fotoErr[style*="block"], #firmaErr[style*="block"]');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const items = [];
  document.querySelectorAll('#itemsContainer .item-row').forEach(div => {
    const v = div.querySelector('.row-item').value;
    const cant = parseFloat(div.querySelector('.row-cant').value);
    if (v === '__saved__') { const s = JSON.parse(div.dataset.saved); s.cantidad = cant; items.push(s); return; }
    const l = lineForKey(v);
    items.push({ k: l.k, sig: l.sig, item: l.i, actividad: l.ds, unidad: l.u, contractual: l.q, cantidad: cant });
  });
  const prev = STATE.editingId ? STATE.registros.find(r => r.id === STATE.editingId) : null;
  if (prev && !canEdit(prev)) { toast('Solo quien creó este registro (o el administrador) puede modificarlo', true); return; }
  const z = $('f_zona').value;
  const nombre = $('f_registrado').value.trim().replace(/\s+/g, ' ');
  const reg = Object.assign({}, prev || {}, {
    uid: prev && prev.uid ? prev.uid : uid(),
    owner: prev ? prev.owner : STATE.device.id,
    registradoPor: nombre,
    proyecto: ZONA_PROY[z],
    proyectoNombre: proyLabel(ZONA_PROY[z]),
    zona: z,
    ods: $('f_ods').value,
    comp: $('f_comp').value,
    departamento: $('f_departamento').value,
    municipio: $('f_municipio').value,
    predio: currentPredio(),
    predioManual: predioIsManual(),
    acto: currentActo(),
    ejecutor: $('f_ejecutor').value || EJECUTOR,
    fecha: dmaToIso($('f_fecha').value),
    items,
    observaciones: $('f_obs').value.trim(),
    fotos: STATE.photos.slice(),
    firma: STATE.firma,
    creado: prev ? prev.creado : Date.now(),
    editadoLocal: Date.now(),
    sync: 'pendiente',
    appVersion: APP_VERSION
  });
  if (prev) reg.id = prev.id; else delete reg.id;
  try {
    await idbPut('registros', reg);
    if (nombre !== STATE.device.nombre) { STATE.device.nombre = nombre; await setMeta('device', STATE.device); }
    await loadRegistros();
    updateCounts();
    toast(prev ? 'Registro actualizado' : 'Registro guardado en el celular');
    resetForm(true);
    syncNow();
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar: ' + (err && err.target && err.target.error ? err.target.error.name : 'error de almacenamiento'), true);
  }
});
function resetForm(keepContext) {
  const ctx = keepContext && !STATE.editingId ? { z: $('f_zona').value, o: $('f_ods').value, c: $('f_comp').value, d: $('f_departamento').value, m: $('f_municipio').value, pr: currentPredio(), fecha: $('f_fecha').value } : null;
  $('regForm').reset();
  $('itemsContainer').innerHTML = '';
  STATE.photos = []; renderPhotoGrid(); setFirma(null);
  STATE.editingId = null;
  $('formTitle').textContent = 'Nuevo registro de obra';
  $('btnCancelEdit').style.display = 'none';
  $('f_ejecutor').value = EJECUTOR;
  $('f_registrado').value = STATE.device ? (STATE.device.nombre || '') : '';
  clearErrors();
  populateLevel(0, ctx ? ctx.z : '');
  onCascadeChange(0, ctx || {});
  $('f_fecha').value = ctx && ctx.fecha ? ctx.fecha : isoToDMA(todayIso());
  addItemRow();
}
$('btnReset').addEventListener('click', () => resetForm(false));
$('btnCancelEdit').addEventListener('click', () => { resetForm(false); setTab('registros'); });

function editRecord(id) {
  const r = STATE.registros.find(x => x.id === id);
  if (!r) return;
  if (!canEdit(r)) { toast('Solo quien creó este registro (o el administrador) puede editarlo', true); return; }
  resetForm(false);
  STATE.editingId = id;
  populateLevel(0, r.zona);
  onCascadeChange(0, { o: r.ods, c: r.comp, d: r.departamento, m: r.municipio, pr: r.predio, a: r.acto });
  $('f_fecha').value = isoToDMA(r.fecha);
  $('f_obs').value = r.observaciones || '';
  $('f_ejecutor').value = r.ejecutor || EJECUTOR;
  $('f_registrado').value = r.registradoPor || STATE.device.nombre || '';
  $('itemsContainer').innerHTML = '';
  (r.items && r.items.length ? r.items : [null]).forEach(it => addItemRow(it));
  STATE.photos = fotosOf(r).map(f => Object.assign({}, f)); renderPhotoGrid();
  setFirma(firmaOf(r) ? Object.assign({}, firmaOf(r)) : null);
  $('formTitle').textContent = 'Editando registro ' + codeOf(r);
  $('btnCancelEdit').style.display = '';
  closeModal();
  setTab('nuevo');
  if (!cascadeComplete()) toast('Algunos datos del registro no están en el PDT actual; revísalos', true);
}

/* ============================================================
   SINCRONIZACIÓN (Google Apps Script)
   ============================================================ */
let syncing = false, syncError = '', lastSync = null, syncTimer = null;
function apiUrl() { return ((window.APP_CONFIG && window.APP_CONFIG.apiUrl) || STATE.apiUrl || '').trim(); }
async function api(payload, timeoutMs) {
  const url = apiUrl();
  if (!url) throw new Error('Falta configurar el enlace de sincronización');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow', signal: ctrl.signal });
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'El servidor tardó demasiado en responder' : 'Sin conexión con el servidor'); }
  finally { clearTimeout(t); }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Respuesta inválida del servidor (revise el enlace de sincronización)'); }
  if (!data.ok) { const err = new Error(data.error || 'Error del servidor'); err.code = data.code; throw err; }
  return data;
}
function pendingCount() { return STATE.registros.filter(r => r.sync === 'pendiente' || r.sync === 'borrar').length; }
async function syncNow(manual) {
  if (!apiUrl()) { updateSyncStatus(); if (manual) toast('Falta configurar el enlace de sincronización (pestaña Descargas y copia)', true); return; }
  if (!navigator.onLine) { updateSyncStatus(); if (manual) toast('Sin internet: los registros se subirán cuando haya señal', true); return; }
  if (syncing) return;
  syncing = true; syncError = ''; updateSyncStatus();
  let subidos = 0, rechazados = 0;
  try {
    // 1) borrados pendientes
    for (const r of STATE.registros.filter(r => r.sync === 'borrar')) {
      try { await api({ action: 'delete', uid: r.uid, deviceId: STATE.device.id, adminKey: STATE.adminKey }); await idbDelete('registros', r.id); }
      catch (e) { if (e.code === 'forbidden') { r.sync = 'ok'; await idbPut('registros', r); rechazados++; } else throw e; }
    }
    // 2) registros por subir
    for (const r of STATE.registros.filter(r => r.sync === 'pendiente')) {
      const fotos = fotosOf(r), firma = firmaOf(r);
      const rec = Object.assign({}, r); delete rec.id; delete rec.fotos; delete rec.firma; delete rec.sync;
      try {
        const res = await api({
          action: 'save', deviceId: STATE.device.id, adminKey: STATE.adminKey, record: rec,
          fotos: fotos.map(f => f.id ? { id: f.id } : { data: f.data }),
          firma: firma ? (firma.id ? { id: firma.id } : { data: firma.data }) : null
        }, 240000);
        const s = res.record;
        s.fotos = (s.fotos || []).map((f, i) => ({ id: f.id, data: fotos[i] && fotos[i].data }));
        if (s.firma) s.firma = { id: s.firma.id, data: firma && firma.data };
        s.id = r.id; s.sync = 'ok';
        await idbPut('registros', s);
        subidos++;
      } catch (e) {
        if (e.code === 'forbidden') { r.sync = 'ok'; r.actualizado = 'rechazado'; await idbPut('registros', r); rechazados++; }
        else throw e;
      }
    }
    // 3) descargar todos los registros compartidos
    const list = await api({ action: 'list' }, 90000);
    await mergeRemote(list.records || []);
    lastSync = new Date();
    await setMeta('lastSync', lastSync.toISOString());
    if (manual || subidos) toast(subidos ? subidos + ' registro(s) subido(s) a la base compartida' : 'Todo está sincronizado');
    if (rechazados) toast(rechazados + ' cambio(s) no se aplicaron: solo quien creó el registro puede modificarlo', true);
  } catch (e) {
    syncError = e.message || 'Error';
    if (manual) toast('No se pudo sincronizar: ' + syncError, true);
  } finally {
    syncing = false;
    await loadRegistros();
    updateCounts(); updateSyncStatus(); refreshView();
  }
}
async function mergeRemote(remote) {
  await loadRegistros();
  const byUid = new Map(STATE.registros.map(r => [r.uid, r]));
  const seen = new Set();
  for (const R of remote) {
    if (!R || !R.uid) continue;
    seen.add(R.uid);
    const L = byUid.get(R.uid);
    if (L && L.sync !== 'ok') continue;                 // cambios locales aún por subir
    if (L && L.actualizado === R.actualizado) continue; // sin cambios
    const local = {};
    if (L) { fotosOf(L).forEach(f => { if (f.id && f.data) local[f.id] = f.data; }); const lf = firmaOf(L); if (lf && lf.id && lf.data) local[lf.id] = lf.data; }
    const N = Object.assign({}, R, { sync: 'ok' });
    N.fotos = (R.fotos || []).map(f => ({ id: f.id, data: local[f.id] }));
    N.firma = R.firma ? { id: R.firma.id, data: local[R.firma.id] } : null;
    if (L) N.id = L.id; else delete N.id;
    await idbPut('registros', N);
  }
  for (const L of STATE.registros) if (L.sync === 'ok' && !seen.has(L.uid)) await idbDelete('registros', L.id);
}
function updateSyncStatus() {
  const pill = $('netPill'), txt = $('netTxt'), det = $('syncDetail');
  const pend = pendingCount();
  pill.className = 'status-pill';
  if (!apiUrl()) { pill.classList.add('err'); txt.textContent = 'Sin configurar sincronización'; det.textContent = 'Los registros solo quedan en este celular'; return; }
  if (syncing) { pill.classList.add('syncing'); txt.textContent = 'Sincronizando…'; det.textContent = pend ? pend + ' por subir' : ''; return; }
  if (!navigator.onLine) { if (pend) pill.classList.add('pending'); txt.textContent = 'Sin conexión' + (pend ? ' · ' + pend + ' por subir' : ''); det.textContent = 'Se subirán solos cuando haya señal'; return; }
  if (syncError) { pill.classList.add('err'); txt.textContent = 'Error al sincronizar'; det.textContent = syncError; return; }
  if (pend) { pill.classList.add('pending'); txt.textContent = pend + ' por subir'; det.textContent = ''; return; }
  pill.classList.add('online');
  txt.textContent = 'Sincronizado' + (lastSync ? ' ' + lastSync.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '');
  det.textContent = '';
}
$('btnSync').addEventListener('click', () => syncNow(true));
window.addEventListener('online', () => { updateSyncStatus(); syncNow(); });
window.addEventListener('offline', updateSyncStatus);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

/* Fotos de registros de otros técnicos: se descargan de Drive cuando se necesitan */
const IMG_CACHE = {};
async function withImages(r) {
  const fotos = fotosOf(r), firma = firmaOf(r);
  const need = fotos.concat(firma ? [firma] : []).filter(f => !f.data && f.id && !IMG_CACHE[f.id]).map(f => f.id);
  if (need.length) {
    if (!navigator.onLine || !apiUrl()) throw new Error('Sin conexión: las fotos de los registros de otros técnicos se descargan con internet');
    for (let i = 0; i < need.length; i += 6) {
      const res = await api({ action: 'fotos', ids: need.slice(i, i + 6) }, 120000);
      Object.assign(IMG_CACHE, res.fotos || {});
    }
  }
  const full = Object.assign({}, r);
  full.fotos = fotos.map(f => f.data || IMG_CACHE[f.id]).filter(Boolean);
  full.firma = firma ? (firma.data || IMG_CACHE[firma.id] || null) : null;
  return full;
}

/* ---------------- Configuración y administrador ---------------- */
function renderSyncInfo() {
  const url = apiUrl();
  const fromFile = !!(window.APP_CONFIG && window.APP_CONFIG.apiUrl);
  $('apiBox').style.display = fromFile ? 'none' : '';
  if (!fromFile) $('apiUrlInput').value = STATE.apiUrl || '';
  const mine = STATE.registros.filter(isMine).length;
  $('syncInfo').innerHTML = url
    ? '<span class="config-ok">Sincronización configurada.</span> ' + STATE.registros.length + ' registro(s) en total, ' + mine + ' creados en este celular, ' + pendingCount() + ' por subir.' + (lastSync ? ' Última sincronización: ' + lastSync.toLocaleString('es-CO') + '.' : '')
    : '<span class="config-bad">Falta el enlace de sincronización.</span> Mientras tanto los registros solo quedan en este celular.';
}
$('btnSaveApi').addEventListener('click', async () => {
  const v = $('apiUrlInput').value.trim();
  if (v && !/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(v)) { toast('El enlace debe empezar por https://script.google.com/…', true); return; }
  STATE.apiUrl = v; await setMeta('apiUrl', v);
  renderSyncInfo(); updateSyncStatus();
  toast(v ? 'Enlace guardado' : 'Enlace borrado');
  if (v) syncNow(true);
});
function renderAdmin() {
  $('adminOff').style.display = STATE.adminOk ? 'none' : '';
  $('adminOn').style.display = STATE.adminOk ? '' : 'none';
  $('adminBadge').style.display = STATE.adminOk ? '' : 'none';
}
$('btnAdminOn').addEventListener('click', async () => {
  const k = $('adminKeyInput').value.trim();
  if (!k) return;
  try {
    await api({ action: 'admin', adminKey: k }, 30000);
    STATE.adminKey = k; STATE.adminOk = true; await setMeta('adminKey', k);
    $('adminKeyInput').value = ''; renderAdmin(); toast('Modo administrador activado');
  } catch (e) { toast(e.message === 'Error del servidor' ? 'Clave incorrecta' : 'No se pudo verificar la clave: ' + e.message, true); }
});
$('btnAdminOff').addEventListener('click', async () => {
  STATE.adminKey = ''; STATE.adminOk = false; await setMeta('adminKey', ''); renderAdmin(); toast('Modo administrador desactivado');
});

/* ============================================================
   REGISTROS
   ============================================================ */
function visibleRecords() { return STATE.registros.filter(r => r.sync !== 'borrar'); }
function updateCounts() {
  const all = visibleRecords();
  const n = all.length, mine = all.filter(isMine).length;
  $('stripCount').textContent = n + (n === 1 ? ' registro' : ' registros') + ' · ' + mine + ' de este celular';
  $('tabCount').textContent = n;
}
function refreshFilterSelects() {
  const recs = visibleRecords();
  const zs = uniq(recs.map(r => r.zona)).filter(Boolean).sort();
  ['filterZona', 'expZona'].forEach(id => {
    const el = $(id), v = el.value;
    el.innerHTML = '<option value="">Todas las zonas</option>' + zs.map(z => '<option>' + escapeHtml(z) + '</option>').join('');
    if (zs.includes(v)) el.value = v;
  });
  const fz = $('filterZona').value;
  const cs = uniq(recs.filter(r => !fz || r.zona === fz).map(r => r.comp)).filter(Boolean).sort(compareComp);
  const fc = $('filterComp'), v = fc.value;
  fc.innerHTML = '<option value="">Todos los COMP</option>' + cs.map(c => '<option>' + escapeHtml(c) + '</option>').join('');
  if (cs.includes(v)) fc.value = v;
}
function syncTag(r) { return r.sync === 'ok' ? '<span class="tag ok">☁ En la nube</span>' : '<span class="tag pend">⏳ Por subir</span>'; }
function renderRegistros() {
  refreshFilterSelects();
  const q = $('searchBox').value.trim().toLowerCase();
  const fz = $('filterZona').value, fc = $('filterComp').value, fm = $('filterMine').value;
  const list = visibleRecords().filter(r => {
    if (fz && r.zona !== fz) return false;
    if (fc && r.comp !== fc) return false;
    if (fm === 'mios' && !isMine(r)) return false;
    if (fm === 'pend' && r.sync === 'ok') return false;
    if (!q) return true;
    const hay = [codeOf(r), r.comp, r.predio, r.municipio, r.departamento, r.zona, r.ods, r.observaciones, r.registradoPor, isoToDMA(r.fecha)].concat((r.items || []).map(i => i.item + ' ' + i.actividad)).join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!list.length) {
    $('recList').innerHTML = '<div class="empty-state"><p><b>' + (STATE.registros.length ? 'Sin resultados' : 'Aún no hay registros') + '</b></p><p>' + (STATE.registros.length ? 'Cambia los filtros de búsqueda.' : 'Los registros de todos los técnicos aparecerán aquí.') + '</p></div>';
    return;
  }
  $('recList').innerHTML = list.slice(0, 300).map(r => {
    const its = r.items || [], f0 = fotosOf(r)[0];
    return '<div class="rec-card" data-id="' + r.id + '">' +
      '<div class="rec-thumb">' + (f0 ? '<img src="' + imgSrc(f0, 120) + '" alt="" loading="lazy" onerror="this.dataset.broken=1">' : '') + '</div>' +
      '<div class="rec-main"><div class="rec-top"><span class="rec-comp">' + escapeHtml(r.comp) + ' · ' + escapeHtml(r.predio) + '</span><span class="rec-date">' + escapeHtml(isoToDMA(r.fecha)) + '</span></div>' +
      '<div class="rec-act">' + escapeHtml(its.map(i => i.item + ' ' + i.actividad).join(' · ')) + '</div>' +
      '<div class="rec-tags">' + syncTag(r) + (isMine(r) ? '<span class="tag me">Mío</span>' : '') + '<span class="tag">' + escapeHtml(r.registradoPor || 'Sin nombre') + '</span><span class="tag">' + escapeHtml(r.zona) + '</span><span class="tag qty">' + its.length + ' actividad(es)</span><span class="tag">' + fotosOf(r).length + ' fotos</span></div></div></div>';
  }).join('') + (list.length > 300 ? '<p class="muted" style="text-align:center;">Mostrando 300 de ' + list.length + '. Usa los filtros para acotar.</p>' : '');
  $('recList').querySelectorAll('.rec-card').forEach(c => c.addEventListener('click', () => openDetail(+c.dataset.id)));
}
['searchBox', 'filterZona', 'filterComp', 'filterMine'].forEach(id => $(id).addEventListener(id === 'searchBox' ? 'input' : 'change', renderRegistros));

let detailId = null;
function openDetail(id) {
  const r = STATE.registros.find(x => x.id === id);
  if (!r) return;
  detailId = id;
  $('modalTitle').textContent = 'Registro ' + codeOf(r) + ' · ' + isoToDMA(r.fecha);
  const rows = generalRows(r).concat([['Estado', r.sync === 'ok' ? 'Sincronizado en la base compartida' : 'Por subir (guardado en el celular que lo creó)']]);
  const dl = rows.map(([k, v]) => '<div' + (String(v).length > 34 ? ' class="full"' : '') + '><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd></div>').join('');
  const its = (r.items || []).map(i => '<tr><td style="padding:5px;border-bottom:1px solid var(--line);vertical-align:top;"><b>' + escapeHtml(i.item) + '</b></td><td style="padding:5px;border-bottom:1px solid var(--line);">' + escapeHtml(i.actividad) + '</td><td style="padding:5px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right;">' + fmtNum(i.cantidad) + ' ' + escapeHtml(i.unidad) + '</td></tr>').join('');
  const fm = firmaOf(r);
  $('modalBody').innerHTML = '<dl class="detail-grid">' + dl + '</dl>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:10px;"><tr><th style="text-align:left;padding:5px;">Ítem</th><th style="text-align:left;padding:5px;">Actividad</th><th style="text-align:right;padding:5px;">Ejecutado</th></tr>' + its + '</table>' +
    (r.observaciones ? '<p style="font-size:13px;"><b>Observaciones:</b> ' + escapeHtml(r.observaciones) + '</p>' : '') +
    '<div class="detail-photos">' + fotosOf(r).map(f => '<img src="' + imgSrc(f, 300) + '" alt="" loading="lazy">').join('') + '</div>' +
    (fm ? '<div class="sig-view"><img src="' + imgSrc(fm, 500) + '" alt="Firma"></div>' : '') +
    (r.carpetaUrl ? '<p style="font-size:12.5px;margin-top:10px;"><a href="' + escapeHtml(r.carpetaUrl) + '" target="_blank" rel="noopener">Ver carpeta de fotos en Google Drive</a></p>' : '');
  const ed = canEdit(r);
  $('modalEdit').style.display = ed ? '' : 'none';
  $('modalDelete').style.display = ed ? '' : 'none';
  $('modalBg').classList.add('show');
}
function closeModal() { $('modalBg').classList.remove('show'); detailId = null; }
$('modalClose').addEventListener('click', closeModal);
$('modalBg').addEventListener('click', e => { if (e.target === $('modalBg')) closeModal(); });
$('modalEdit').addEventListener('click', () => { if (detailId) editRecord(detailId); });
$('modalPdf').addEventListener('click', async () => {
  const r = STATE.registros.find(x => x.id === detailId); if (!r) return;
  try { const doc = await buildPdf([r]); await downloadBlob(doc.output('blob'), fileBase([r]) + '.pdf'); } catch (e) { failToast('el PDF', e); }
});
$('modalDelete').addEventListener('click', async () => {
  const r = STATE.registros.find(x => x.id === detailId); if (!r) return;
  if (!canEdit(r)) { toast('Solo quien creó este registro (o el administrador) puede eliminarlo', true); return; }
  if (!confirm('¿Eliminar este registro para todos los técnicos? Esta acción no se puede deshacer.')) return;
  const neverUploaded = r.sync === 'pendiente' && typeof r.actualizado !== 'string';
  if (neverUploaded) await idbDelete('registros', r.id);
  else { r.sync = 'borrar'; await idbPut('registros', r); }
  await loadRegistros(); updateCounts(); closeModal(); renderRegistros();
  toast('Registro eliminado');
  syncNow();
});

/* ============================================================
   MAESTRO COMP (pestaña)
   ============================================================ */
let maestroLimit = 30;
function compGroups() {
  const groups = new Map();
  LINES.forEach(l => {
    const key = l.p + '|' + l.z + '|' + l.o + '|' + l.c;
    if (!groups.has(key)) groups.set(key, { p: l.p, z: l.z, o: l.o, c: l.c, lines: [] });
    groups.get(key).lines.push(l);
  });
  return Array.from(groups.values());
}
const COMP_GROUPS = compGroups();
function renderMaestro() {
  const zs = $('maestroZona'), v = zs.value;
  zs.innerHTML = '<option value="">Todas las zonas</option>' + ZONAS.map(z => '<option>' + escapeHtml(z) + '</option>').join('');
  zs.value = v;
  const recs = visibleRecords();
  const ex = executedBySig();
  const recByComp = {};
  recs.forEach(r => { const k = r.proyecto + '|' + r.zona + '|' + r.ods + '|' + r.comp; recByComp[k] = (recByComp[k] || 0) + 1; });
  const compsCon = COMP_GROUPS.filter(g => recByComp[g.p + '|' + g.z + '|' + g.o + '|' + g.c]).length;
  $('maestroKpis').innerHTML =
    '<div class="kpi"><div class="num">' + COMP_GROUPS.length + '</div><div class="lbl">ID COMP en PDT</div></div>' +
    '<div class="kpi"><div class="num">' + compsCon + '</div><div class="lbl">COMP con registros</div></div>' +
    '<div class="kpi"><div class="num">' + recs.length + '</div><div class="lbl">Registros</div></div>';
  const q = $('compSearch').value.trim().toLowerCase();
  const fz = zs.value, solo = $('maestroSolo').value;
  const list = COMP_GROUPS.filter(g => {
    if (fz && g.z !== fz) return false;
    const nreg = recByComp[g.p + '|' + g.z + '|' + g.o + '|' + g.c] || 0;
    if (solo === 'con' && !nreg) return false;
    if (!q) return true;
    return [g.c, g.z, g.o].concat(g.lines.map(l => l.m + ' ' + l.d + ' ' + l.pr + ' ' + l.a)).join(' ').toLowerCase().includes(q);
  });
  const shown = list.slice(0, maestroLimit);
  $('compMasterList').innerHTML = shown.length ? shown.map(g => {
    const nreg = recByComp[g.p + '|' + g.z + '|' + g.o + '|' + g.c] || 0;
    let tq = 0, te = 0;
    const rows = g.lines.slice().sort((a, b) => a.pr.localeCompare(b.pr) || compareItem(a.i, b.i)).map(l => {
      const e = ex[l.sig] ? ex[l.sig].q : 0;
      const pct = l.q ? e / l.q * 100 : 0;
      if (l.q) { tq += Math.min(e, l.q) / l.q; te++; }
      return '<div class="line-row"><div class="line-top"><div class="ld"><b>' + escapeHtml(l.i) + '</b> · ' + escapeHtml(l.ds) +
        '<div class="muted">' + escapeHtml(l.m + ' · ' + l.pr) + '</div></div><div class="lq">' + fmtNum(e) + ' / ' + fmtNum(l.q) + ' ' + escapeHtml(l.u) + '</div></div>' +
        '<div class="bar-track"><div class="bar-fill' + (pct > 100 ? ' over' : '') + '" style="width:' + Math.min(100, pct).toFixed(1) + '%"></div></div></div>';
    }).join('');
    const manual = recs.filter(r => r.predioManual && r.proyecto === g.p && r.comp === g.c && r.zona === g.z);
    const manualTxt = manual.length ? '<div class="muted" style="margin-top:8px;">Además hay ' + manual.length + ' registro(s) en predios escritos en campo: ' + escapeHtml(uniq(manual.map(r => r.predio)).join(', ')) + '.</div>' : '';
    const avg = te ? (tq / te * 100) : 0;
    const actos = uniq(g.lines.map(l => l.a)), munis = uniq(g.lines.map(l => l.m + ' (' + l.d + ')'));
    return '<details class="comp-card"><summary><span class="cid">' + escapeHtml(g.c === NA ? 'Sin ID COMP' : g.c) + '</span>' +
      '<span class="cinfo"><b>' + escapeHtml(g.z + ' · ' + g.o) + '</b><br>' + escapeHtml(munis.join(', ')) + '<br>' + nreg + ' registro(s) · ' + g.lines.length + ' línea(s) PDT</span>' +
      '<span class="cpct">' + avg.toFixed(0) + '%</span></summary>' +
      '<div class="comp-body"><div class="muted" style="margin-bottom:6px;">Proyecto: ' + escapeHtml(proyLabel(g.p)) + '<br>Acto(s): ' + escapeHtml(actos.join(' · ')) + '</div>' + rows + manualTxt + '</div></details>';
  }).join('') : '<div class="empty-state"><p><b>Sin resultados</b></p></div>';
  $('compMore').innerHTML = list.length > maestroLimit ? '<button class="btn btn-ghost btn-sm" id="btnMore">Ver más (' + (list.length - maestroLimit) + ' restantes)</button>' : '';
  if ($('btnMore')) $('btnMore').addEventListener('click', () => { maestroLimit += 30; renderMaestro(); });
}
['compSearch', 'maestroZona', 'maestroSolo'].forEach(id => $(id).addEventListener(id === 'compSearch' ? 'input' : 'change', () => { maestroLimit = 30; renderMaestro(); }));
$('btnMaestroExcel').addEventListener('click', async () => {
  try {
    const buf = await buildMaestroXlsx(visibleRecords(), null);
    await downloadBlob(new Blob([buf], { type: XLSX_MIME }), 'MAESTRO COMP ' + isoToDMA(todayIso()).replace(/\//g, '-') + '.xlsx');
    toast('Excel MAESTRO COMP descargado');
  } catch (e) { failToast('el Excel', e); }
});

/* ============================================================
   EXCEL MAESTRO COMP (ExcelJS, con logos)
   ============================================================ */
function recordFolder(r) {
  return [ROOT_FOLDER, safeName(proyLabel(r.proyecto).replace(' · ', ' - ')), safeName(r.comp === NA ? 'Sin ID COMP' : r.comp), safeName((r.fecha || 'sin-fecha') + '_' + (r.predio === NR ? 'Sin predio' : r.predio) + '_' + codeOf(r))].join('/');
}
function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|#%\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sin-nombre'; }
function numOrBlank(v) { return v === null || v === undefined || v === '' || isNaN(v) ? '' : Number(v); }
async function buildMaestroXlsx(records, projectIds) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RegistrObraApp · ' + EJECUTOR;
  wb.created = new Date();
  const imgBqs = wb.addImage({ base64: LOGO_BQS_BASE64, extension: 'png' });
  const imgCenit = wb.addImage({ base64: LOGO_CENIT_BASE64, extension: 'png' });
  const sub = 'Generado: ' + isoToDMA(todayIso()) + ' · ' + records.length + ' registro(s) · Ejecutor: ' + EJECUTOR;
  const NAVY = 'FF154270', TEAL = 'FF1F9BC4';

  function sheet(name, title, cols, widths, rows, numFmt) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 6 }] });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getRow(1).height = 24; ws.getRow(2).height = 24; ws.getRow(3).height = 18; ws.getRow(4).height = 18;
    const bqsH = 54, bqsW = bqsH * LOGO_BQS_W / LOGO_BQS_H;
    ws.addImage(imgBqs, { tl: { col: 0.1, row: 0.2 }, ext: { width: bqsW, height: bqsH } });
    const cenH = 58, cenW = cenH * LOGO_CENIT_W / LOGO_CENIT_H;
    ws.addImage(imgCenit, { tl: { col: Math.min(cols.length - 1, 6) + 0.1, row: 0.3 }, ext: { width: cenW, height: cenH } });
    const tc = ws.getCell('C1'); tc.value = title; tc.font = { bold: true, size: 14, color: { argb: NAVY } };
    const sc = ws.getCell('C2'); sc.value = sub; sc.font = { size: 10, color: { argb: 'FF34506F' } };
    const cc = ws.getCell('C3'); cc.value = 'BQS · Business & Quality Services SAS — Compensación Ambiental'; cc.font = { size: 9, italic: true, color: { argb: 'FF7A8796' } };
    const hr = ws.getRow(6);
    hr.values = cols; hr.height = 30;
    hr.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      c.alignment = { vertical: 'middle', wrapText: true };
      c.border = { bottom: { style: 'medium', color: { argb: TEAL } } };
    });
    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      row.alignment = { vertical: 'top', wrapText: true };
      if (i % 2 === 1) row.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6FA' } }; });
    });
    (numFmt || []).forEach(ci => { ws.getColumn(ci).numFmt = '#,##0.##'; });
    if (rows.length) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + rows.length, column: cols.length } };
    return ws;
  }

  const cols1 = ['Código', 'Fecha (DD/MM/AA)', 'Registrado por', 'Proyecto', 'Zona', 'ODS', 'ID COMP', 'Acto administrativo', 'Departamento', 'Municipio', 'Nombre del predio', 'Predio escrito en campo', 'Ejecutor', 'Ítem', 'Descripción de la actividad', 'Unidad', 'Cantidad ejecutada', 'Cantidad contractual PDT', 'N° fotos', 'Firma', 'Observaciones', 'Estado', 'Carpeta en Google Drive', 'Carpeta en el paquete .zip'];
  const rows1 = [];
  records.slice().sort((a, b) => (a.proyecto || '').localeCompare(b.proyecto || '') || compareComp(a.comp, b.comp) || (a.fecha || '').localeCompare(b.fecha || '')).forEach(r => {
    const its = r.items && r.items.length ? r.items : [{}];
    its.forEach(it => rows1.push([codeOf(r), isoToDMA(r.fecha), r.registradoPor || '', proyLabel(r.proyecto), r.zona, r.ods, r.comp, r.acto, r.departamento, r.municipio, r.predio, r.predioManual ? 'Sí' : 'No', r.ejecutor,
      it.item || '', it.actividad || '', it.unidad || '', numOrBlank(it.cantidad), numOrBlank(it.contractual), fotosOf(r).length, firmaOf(r) ? 'Sí' : 'No', r.observaciones || '',
      r.sync === 'ok' ? 'Sincronizado' : 'Por subir', r.carpetaUrl || '', recordFolder(r)]));
  });
  sheet('Registros', 'MAESTRO COMP · Registros de obra en campo', cols1, [10, 11, 20, 30, 16, 9, 12, 28, 15, 18, 22, 10, 26, 7, 50, 12, 11, 12, 7, 6, 28, 12, 40, 55], rows1, [17, 18]);

  const pids = projectIds || uniq(LINES.map(l => l.p));
  const ex = {};
  records.forEach(r => (r.items || []).forEach(it => {
    if (!it.sig) return;
    if (!ex[it.sig]) ex[it.sig] = { q: 0, n: 0, last: '' };
    ex[it.sig].q += parseFloat(it.cantidad) || 0; ex[it.sig].n++;
    if ((r.fecha || '') > ex[it.sig].last) ex[it.sig].last = r.fecha || '';
  }));
  const cols2 = ['Proyecto', 'Zona', 'ODS', 'ID COMP', 'Acto administrativo', 'Departamento', 'Municipio', 'Nombre del predio', 'Ítem', 'Descripción', 'Unidad', 'Cantidad contractual PDT', 'Cantidad ejecutada acumulada', '% avance', 'N° actividades registradas', 'Último registro'];
  const rows2 = LINES.filter(l => pids.includes(l.p)).map(l => {
    const e = ex[l.sig] || { q: 0, n: 0, last: '' };
    return [proyLabel(l.p), l.z, l.o, l.c, l.a, l.d, l.m, l.pr, l.i, l.ds, l.u, numOrBlank(l.q), e.q, l.q ? Math.round(e.q / l.q * 1000) / 10 : '', e.n, isoToDMA(e.last)];
  });
  // actividades en predios escritos en campo (sin cantidad contractual)
  Object.keys(ex).filter(s => s.split('|')[4] && s.split('|')[4].startsWith('✎ ')).forEach(s => {
    const [p, c, d, m, pr, i, ds, u] = s.split('|');
    if (!pids.includes(p)) return;
    const g = LINES.find(l => l.p === p && l.c === c) || {};
    rows2.push([proyLabel(p), g.z || '', g.o || '', c, '', d, m, pr.slice(2) + ' (escrito en campo)', i, ds, u, '', ex[s].q, '', ex[s].n, isoToDMA(ex[s].last)]);
  });
  sheet('Avance PDT', 'MAESTRO COMP · Avance frente al PDT', cols2, [30, 16, 9, 12, 28, 15, 18, 22, 7, 50, 12, 12, 12, 9, 10, 11], rows2, [12, 13]);

  const cols3 = ['Proyecto', 'Zona', 'ODS', 'ID COMP', 'Líneas PDT', 'Líneas con avance', 'N° registros', 'Último registro'];
  const rows3 = COMP_GROUPS.filter(g => pids.includes(g.p)).map(g => {
    const regs = records.filter(r => r.proyecto === g.p && r.zona === g.z && r.ods === g.o && r.comp === g.c);
    return [proyLabel(g.p), g.z, g.o, g.c, g.lines.length, g.lines.filter(l => ex[l.sig]).length, regs.length, isoToDMA(regs.map(r => r.fecha || '').sort().pop() || '')];
  });
  sheet('Resumen por COMP', 'MAESTRO COMP · Resumen por ID COMP', cols3, [30, 18, 9, 14, 12, 14, 12, 13], rows3);
  return await wb.xlsx.writeBuffer();
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ============================================================
   INFORMES PDF / WORD
   ============================================================ */
function generalRows(r) {
  return [
    ['Código', codeOf(r)], ['Fecha', isoToDMA(r.fecha) || '-'], ['Registrado por', r.registradoPor || '-'], ['Proyecto', proyLabel(r.proyecto)], ['Zona', r.zona || '-'], ['ODS', r.ods || '-'],
    ['ID COMP', r.comp || '-'], ['Acto administrativo', r.acto || '-'], ['Departamento', r.departamento || '-'],
    ['Municipio', r.municipio || '-'], ['Nombre del predio', (r.predio || '-') + (r.predioManual ? ' (escrito en campo)' : '')], ['Ejecutor', r.ejecutor || EJECUTOR]
  ];
}
function imgFmt(d) { return /^data:image\/png/.test(d) ? 'PNG' : 'JPEG'; }
function imgDims(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = src; }); }
function pdfSection(doc, t, x, y) {
  doc.setFillColor(...C_NAVY); doc.rect(x, y - 9, 3, 12, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...C_NAVY); doc.text(t, x + 8, y);
  doc.setFont('helvetica', 'normal'); return y + 16;
}
function pdfSpace(doc, y, need, pageH) { if (y + need > pageH - 50) { doc.addPage(); return 44; } return y; }
async function buildPdf(records) {
  const Ctor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  const doc = new Ctor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
  const mx = 42, cw = pageW - mx * 2;
  const list = records.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  for (let idx = 0; idx < list.length; idx++) {
    const r = await withImages(list[idx]);
    if (idx > 0) doc.addPage();
    let y = 46;
    const bw = 104, bh = bw * (LOGO_BQS_H / LOGO_BQS_W);
    const lw = 56, lh = lw * (LOGO_CENIT_H / LOGO_CENIT_W);
    try { doc.addImage(LOGO_BQS_BASE64, 'PNG', mx, 36, bw, bh); } catch (e) { }
    try { doc.addImage(LOGO_CENIT_BASE64, 'PNG', mx + bw + 12, 36 + (bh - lh) / 2, lw, lh); } catch (e) { }
    const logosW = bw + 12 + lw;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...C_NAVY);
    doc.text('Informe de Registro de Obra', pageW - mx, y, { align: 'right' }); y += 15;
    doc.setFontSize(10.5); doc.setTextColor(...C_TEAL);
    doc.text('ID COMP: ' + (r.comp || '-') + ' · Predio: ' + (r.predio || '-'), pageW - mx, y, { align: 'right', maxWidth: cw - logosW - 14 }); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...C_SLATE);
    doc.text(proyLabel(r.proyecto), pageW - mx, y, { align: 'right' }); y += 13;
    doc.setFontSize(8.5); doc.setTextColor(120, 120, 120);
    doc.text(codeOf(r) + ' · ' + (r.zona || '-') + ' · ' + (r.ods || '-') + ' · ' + (isoToDMA(r.fecha) || '-'), pageW - mx, y, { align: 'right' });
    y = Math.max(y + 10, 36 + bh + 8);
    doc.setDrawColor(207, 220, 233); doc.line(mx, y, pageW - mx, y); y += 22;

    y = pdfSection(doc, '1. Datos generales', mx, y);
    doc.autoTable({ startY: y, margin: { left: mx, right: mx }, tableWidth: cw, theme: 'plain', body: generalRows(r),
      styles: { fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 0, right: 6 }, textColor: [22, 32, 43] },
      columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold', textColor: C_SLATE }, 1: { cellWidth: cw - 130 } },
      didParseCell: d => { if (d.row.index % 2 === 1) d.cell.styles.fillColor = C_ROW; } });
    y = doc.lastAutoTable.finalY + 20;

    y = pdfSpace(doc, y, 70, pageH);
    y = pdfSection(doc, '2. Actividades ejecutadas', mx, y);
    const its = (r.items || []).map(i => [i.item || '', i.actividad || '', fmtNum(i.cantidad), i.unidad || '', fmtNum(i.contractual)]);
    doc.autoTable({ startY: y, margin: { left: mx, right: mx }, tableWidth: cw,
      head: [['Ítem', 'Actividad', 'Ejecutado', 'Unidad', 'Contractual PDT']], body: its.length ? its : [['-', 'Sin actividades', '', '', '']],
      styles: { fontSize: 8.5, cellPadding: 5, overflow: 'linebreak' }, headStyles: { fillColor: C_NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C_ROW },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: cw - 40 - 62 - 62 - 70 }, 2: { cellWidth: 62 }, 3: { cellWidth: 62 }, 4: { cellWidth: 70 } } });
    y = doc.lastAutoTable.finalY + 20;

    if (r.observaciones) {
      y = pdfSpace(doc, y, 50, pageH); y = pdfSection(doc, 'Observaciones', mx, y);
      doc.setFontSize(9.5); doc.setTextColor(22, 32, 43);
      doc.splitTextToSize(r.observaciones, cw).forEach(line => { y = pdfSpace(doc, y, 14, pageH); doc.text(line, mx, y); y += 13; });
      y += 8;
    }
    const fotos = r.fotos || [];
    y = pdfSpace(doc, y, 50, pageH); y = pdfSection(doc, '3. Registro fotográfico', mx, y);
    if (!fotos.length) { doc.setFontSize(9); doc.setTextColor(120, 120, 120); doc.text('Sin fotos adjuntas.', mx, y); y += 18; }
    else {
      const gap = 10, cwid = (cw - gap * 2) / 3, ch = cwid * 0.72;
      for (let i = 0; i < fotos.length; i++) {
        const col = i % 3;
        if (col === 0) y = pdfSpace(doc, y, ch + 24, pageH);
        const x = mx + col * (cwid + gap);
        doc.setFillColor(...C_ROW); doc.rect(x, y, cwid, ch, 'F');
        try { const d = await imgDims(fotos[i]); const s = Math.min(cwid / d.w, ch / d.h); doc.addImage(fotos[i], imgFmt(fotos[i]), x + (cwid - d.w * s) / 2, y + (ch - d.h * s) / 2, d.w * s, d.h * s); } catch (e) { }
        doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.text('Foto ' + (i + 1), x + cwid / 2, y + ch + 13, { align: 'center' });
        if (col === 2 || i === fotos.length - 1) y += ch + 26;
      }
    }
    y = pdfSpace(doc, y, 110, pageH); y = pdfSection(doc, '4. Firma', mx, y);
    if (r.firma) {
      try { const d = await imgDims(r.firma); const bw2 = 210, bh2 = 75; const s = Math.min((bw2 - 16) / d.w, (bh2 - 16) / d.h, 1);
        doc.setDrawColor(207, 220, 233); doc.rect(mx, y, bw2, bh2); doc.addImage(r.firma, imgFmt(r.firma), mx + (bw2 - d.w * s) / 2, y + (bh2 - d.h * s) / 2, d.w * s, d.h * s); y += bh2 + 14; } catch (e) { y += 10; }
    } else { doc.setFontSize(9); doc.setTextColor(120, 120, 120); doc.text('Sin firma registrada.', mx, y); y += 18; }
    doc.setFontSize(8.5); doc.setTextColor(90, 90, 90); doc.text((r.registradoPor ? r.registradoPor + ' · ' : '') + (r.ejecutor || EJECUTOR), mx, y);
  }
  const tp = doc.internal.getNumberOfPages();
  for (let p = 1; p <= tp; p++) {
    doc.setPage(p); doc.setDrawColor(207, 220, 233); doc.line(mx, pageH - 38, pageW - mx, pageH - 38);
    doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
    doc.text('Informe generado el ' + isoToDMA(todayIso()) + ' · RegistrObraApp · BQS · Compensación Ambiental', mx, pageH - 24);
    doc.text('Página ' + p + ' de ' + tp, pageW - mx, pageH - 24, { align: 'right' });
  }
  return doc;
}
async function buildWordHtml(records) {
  const sec = t => '<div style="font-size:11.5px;font-weight:bold;color:#154270;border-left:3px solid #154270;padding-left:8px;margin:12px 0 8px;">' + t + '</div>';
  const blocks = [];
  const sorted = records.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  for (let idx = 0; idx < sorted.length; idx++) {
    const r = await withImages(sorted[idx]);
    const gen = generalRows(r).map((row, i) => '<tr style="background:' + (i % 2 ? '#f2f6fa' : '#fff') + ';"><td style="padding:6px 10px;font-size:10px;font-weight:bold;color:#34506f;width:140px;border-bottom:1px solid #dbe6f1;">' + escapeHtml(row[0]) + '</td><td style="padding:6px 10px;font-size:10px;border-bottom:1px solid #dbe6f1;">' + escapeHtml(row[1]) + '</td></tr>').join('');
    const td = 'padding:5px 8px;font-size:9.5px;border:1px solid #cfdce9;';
    const its = (r.items || []).map(i => '<tr><td style="' + td + '">' + escapeHtml(i.item) + '</td><td style="' + td + '">' + escapeHtml(i.actividad) + '</td><td style="' + td + '">' + escapeHtml(fmtNum(i.cantidad)) + '</td><td style="' + td + '">' + escapeHtml(i.unidad) + '</td><td style="' + td + '">' + escapeHtml(fmtNum(i.contractual)) + '</td></tr>').join('');
    let fotos = '<p style="font-size:9.5px;color:#7a8796;">Sin fotos adjuntas.</p>';
    if (r.fotos && r.fotos.length) {
      const cells = r.fotos.map((f, i) => '<td style="width:33%;text-align:center;padding:4px;vertical-align:top;"><img src="' + f + '" width="170" style="width:170px;border:1px solid #cfdce9;"><div style="font-size:8.5px;color:#7a8796;">Foto ' + (i + 1) + '</div></td>');
      let rr = ''; for (let i = 0; i < cells.length; i += 3) rr += '<tr>' + cells.slice(i, i + 3).join('') + '</tr>';
      fotos = '<table style="width:100%;">' + rr + '</table>';
    }
    const firma = r.firma ? '<img src="' + r.firma + '" width="200" style="max-width:220px;border:1px solid #cfdce9;padding:4px;"><div style="font-size:9px;color:#4a5868;">' + escapeHtml((r.registradoPor ? r.registradoPor + ' · ' : '') + (r.ejecutor || EJECUTOR)) + '</div>' : '<p style="font-size:9.5px;color:#7a8796;">Sin firma registrada.</p>';
    blocks.push((idx ? '<div style="page-break-before:always;">&nbsp;</div>' : '') +
      '<table style="width:100%;"><tr><td style="width:190px;vertical-align:middle;"><img src="' + LOGO_BQS_BASE64 + '" width="110"> &nbsp; <img src="' + LOGO_CENIT_BASE64 + '" width="60"></td><td style="text-align:right;">' +
      '<div style="font-size:16px;font-weight:bold;color:#154270;">Informe de Registro de Obra</div>' +
      '<div style="font-size:11px;font-weight:bold;color:#1f9bc4;">ID COMP: ' + escapeHtml(r.comp) + ' · Predio: ' + escapeHtml(r.predio) + '</div>' +
      '<div style="font-size:10px;color:#34506f;">' + escapeHtml(proyLabel(r.proyecto)) + '</div>' +
      '<div style="font-size:9px;color:#888;">' + escapeHtml(codeOf(r) + ' · ' + r.zona + ' · ' + r.ods + ' · ' + isoToDMA(r.fecha)) + '</div></td></tr></table>' +
      '<hr style="border:none;border-top:1px solid #cfdce9;">' + sec('1. Datos generales') + '<table style="width:100%;border-collapse:collapse;">' + gen + '</table>' +
      sec('2. Actividades ejecutadas') + '<table style="width:100%;border-collapse:collapse;"><tr>' + ['Ítem', 'Actividad', 'Ejecutado', 'Unidad', 'Contractual PDT'].map(h => '<th style="background:#154270;color:#fff;padding:6px 8px;font-size:9.5px;text-align:left;">' + h + '</th>').join('') + '</tr>' + its + '</table>' +
      (r.observaciones ? sec('Observaciones') + '<p style="font-size:10px;">' + escapeHtml(r.observaciones) + '</p>' : '') +
      sec('3. Registro fotográfico') + fotos + sec('4. Firma') + firma);
  }
  return '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Informe de registros de obra</title><style>body{font-family:Calibri,Arial,sans-serif;color:#16202b;}table{border-collapse:collapse;}</style></head><body>' + blocks.join('') + '</body></html>';
}

/* ============================================================
   DESCARGAS
   ============================================================ */
function failToast(what, e) {
  console.error(e);
  const libs = { ExcelJS: 'exceljs.min.js', jspdf: 'jspdf.umd.min.js', JSZip: 'jszip.min.js' };
  const falt = Object.keys(libs).filter(k => !window[k]).map(k => libs[k]);
  toast(falt.length ? 'No se pudo generar ' + what + ': falta subir ' + falt.join(', ') + ' junto al index.html' : 'No se pudo generar ' + what + ' (' + (e && e.message ? e.message : 'error') + ')', true);
}
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
async function downloadBlob(blob, name) {
  if (isIOS() && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function fileBase(list) {
  const comps = uniq(list.map(r => r.comp));
  return safeName('Registros ' + (comps.length === 1 ? comps[0] : list.length + ' registros') + ' ' + isoToDMA(todayIso()).replace(/\//g, '-'));
}
function renderExportSelector() {
  refreshFilterSelects();
  const fz = $('expZona').value;
  const list = visibleRecords().filter(r => !fz || r.zona === fz);
  const cont = $('exportSelectorList');
  const prevChecked = new Set(Array.from(cont.querySelectorAll('input:checked')).map(i => +i.value));
  const first = !cont.dataset.init; cont.dataset.init = '1';
  cont.innerHTML = list.length ? list.map(r => '<label class="sel-row"><input type="checkbox" value="' + r.id + '"' + (first || prevChecked.has(r.id) ? ' checked' : '') + '><span><b>' + escapeHtml(isoToDMA(r.fecha)) + '</b> · ' + escapeHtml(r.comp + ' · ' + r.predio) + '<br><span class="muted">' + escapeHtml(codeOf(r) + ' · ' + (r.registradoPor || 'Sin nombre') + ' · ' + r.zona + ' · ' + (r.items || []).length + ' actividad(es) · ' + fotosOf(r).length + ' fotos') + '</span></span></label>').join('')
    : '<p class="muted">No hay registros para mostrar.</p>';
}
$('expZona').addEventListener('change', () => { $('exportSelectorList').dataset.init = ''; renderExportSelector(); });
$('btnSelectAll').addEventListener('click', () => $('exportSelectorList').querySelectorAll('input').forEach(i => { i.checked = true; }));
$('btnSelectNone').addEventListener('click', () => $('exportSelectorList').querySelectorAll('input').forEach(i => { i.checked = false; }));
function selectedRecords() {
  const ids = new Set(Array.from($('exportSelectorList').querySelectorAll('input:checked')).map(i => +i.value));
  return STATE.registros.filter(r => ids.has(r.id));
}
function needSelection() { const s = selectedRecords(); if (!s.length) toast('Marca al menos un registro', true); return s; }
function dataUrlToBytes(d) {
  const b = atob(d.split(',')[1]); const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
function extOf(d) { return /^data:image\/png/.test(d) ? 'png' : 'jpg'; }
async function buildZip(sel, withReports) {
  const zip = new JSZip();
  const msg = $('zipMsg');
  for (let i = 0; i < sel.length; i++) {
    msg.textContent = 'Preparando registro ' + (i + 1) + ' de ' + sel.length + '…';
    const r = await withImages(sel[i]);
    const folder = recordFolder(r);
    (r.fotos || []).forEach((f, j) => zip.file(folder + '/Foto_' + String(j + 1).padStart(2, '0') + '.' + extOf(f), dataUrlToBytes(f)));
    if (r.firma) zip.file(folder + '/Firma.' + extOf(r.firma), dataUrlToBytes(r.firma));
    if (withReports) {
      const doc = await buildPdf([r]);
      zip.file(folder + '/Informe_' + codeOf(r) + '.pdf', doc.output('arraybuffer'));
    }
    await new Promise(res => setTimeout(res, 0));
  }
  if (withReports) {
    msg.textContent = 'Generando Excel MAESTRO COMP…';
    const pids = uniq(sel.map(r => r.proyecto));
    zip.file(ROOT_FOLDER + '/MAESTRO COMP.xlsx', await buildMaestroXlsx(sel, pids));
    for (const pid of pids) {
      const recs = sel.filter(r => r.proyecto === pid);
      const pf = safeName(proyLabel(pid).replace(' · ', ' - '));
      zip.file(ROOT_FOLDER + '/' + pf + '/MAESTRO COMP - ' + pf + '.xlsx', await buildMaestroXlsx(recs, [pid]));
    }
  }
  msg.textContent = 'Comprimiendo…';
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  msg.textContent = '';
  return blob;
}
$('btnZip').addEventListener('click', async () => {
  const sel = needSelection(); if (!sel.length) return;
  const b = $('btnZip'); b.disabled = true;
  try { const blob = await buildZip(sel, $('zipPdf').checked); await downloadBlob(blob, safeName(ROOT_FOLDER + ' ' + isoToDMA(todayIso()).replace(/\//g, '-')) + '.zip'); toast('Paquete .zip descargado'); }
  catch (e) { failToast('el .zip', e); $('zipMsg').textContent = ''; }
  finally { b.disabled = false; }
});
$('btnExportFotos').addEventListener('click', async () => {
  const sel = needSelection(); if (!sel.length) return;
  try { const blob = await buildZip(sel, false); await downloadBlob(blob, safeName('Fotos y firmas ' + isoToDMA(todayIso()).replace(/\//g, '-')) + '.zip'); toast('Fotos descargadas'); }
  catch (e) { failToast('el .zip de fotos', e); $('zipMsg').textContent = ''; }
});
$('btnExportExcel').addEventListener('click', async () => {
  const sel = needSelection(); if (!sel.length) return;
  try { const buf = await buildMaestroXlsx(sel, uniq(sel.map(r => r.proyecto))); await downloadBlob(new Blob([buf], { type: XLSX_MIME }), 'MAESTRO COMP ' + isoToDMA(todayIso()).replace(/\//g, '-') + '.xlsx'); toast('Excel descargado'); }
  catch (e) { failToast('el Excel', e); }
});
$('btnExportPdf').addEventListener('click', async () => {
  const sel = needSelection(); if (!sel.length) return;
  const b = $('btnExportPdf'), t = b.textContent; b.disabled = true; b.textContent = 'Generando PDF…';
  try { const doc = await buildPdf(sel); await downloadBlob(doc.output('blob'), fileBase(sel) + '.pdf'); toast('PDF descargado'); }
  catch (e) { failToast('el PDF', e); }
  finally { b.disabled = false; b.textContent = t; }
});
$('btnExportWord').addEventListener('click', async () => {
  const sel = needSelection(); if (!sel.length) return;
  try { await downloadBlob(new Blob(['﻿' + await buildWordHtml(sel)], { type: 'application/msword' }), fileBase(sel) + '.doc'); toast('Word descargado'); }
  catch (e) { failToast('el Word', e); }
});
$('btnExportJson').addEventListener('click', async () => {
  const data = { app: 'RegistrObraApp', version: APP_VERSION, exportado: new Date().toISOString(), registros: STATE.registros };
  await downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'RegistrObraApp copia ' + isoToDMA(todayIso()).replace(/\//g, '-') + '.json');
  toast('Copia descargada');
});
async function readImport() {
  const f = $('importFile').files[0];
  if (!f) { toast('Elige primero el archivo .json', true); return null; }
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.registros)) throw new Error('formato');
    return d.registros;
  } catch (e) { toast('El archivo no es una copia válida de RegistrObraApp', true); return null; }
}
async function importRecords(list, replace) {
  if (replace) await idbClear('registros');
  const existing = new Set(replace ? [] : STATE.registros.map(r => r.uid).filter(Boolean));
  let n = 0;
  for (const r0 of list) {
    const r = Object.assign({}, r0);
    if (r.uid && existing.has(r.uid)) continue;
    if (!r.uid) r.uid = uid();
    if (!r.owner) r.owner = STATE.device.id;
    if (r.sync !== 'ok') r.sync = 'pendiente';
    delete r.id;
    await idbPut('registros', r); n++;
  }
  await loadRegistros(); updateCounts(); renderExportSelector();
  syncNow();
  return n;
}
$('btnImportMerge').addEventListener('click', async () => { const l = await readImport(); if (l) toast((await importRecords(l, false)) + ' registro(s) importado(s)'); });
$('btnImportReplace').addEventListener('click', async () => {
  const l = await readImport(); if (!l) return;
  if (!confirm('Esto BORRA la copia de este celular y la reemplaza por la del archivo. ¿Continuar?')) return;
  toast((await importRecords(l, true)) + ' registro(s) restaurado(s)');
});
$('btnWipe').addEventListener('click', async () => {
  const pend = pendingCount();
  if (!confirm('¿Borrar la copia guardada en este celular?' + (pend ? ' ATENCIÓN: hay ' + pend + ' registro(s) por subir que se perderán.' : ' Los registros sincronizados se volverán a descargar.'))) return;
  await idbClear('registros'); await loadRegistros(); updateCounts(); renderExportSelector(); toast('Datos del celular borrados');
  syncNow();
});
async function renderStorageInfo() {
  const el = $('storageInfo');
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    el.textContent = est ? 'Espacio usado en este celular: ' + (est.usage / 1048576).toFixed(1) + ' MB de ' + (est.quota / 1048576).toFixed(0) + ' MB disponibles.' : '';
  } catch (e) { el.textContent = ''; }
}

/* ============================================================
   Instalación, modo offline e inicio
   ============================================================ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('btnInstall').style.display = ''; });
$('btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('btnInstall').style.display = 'none';
});
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
    $('offlineReady').textContent = location.protocol === 'file:' ? 'Abierta como archivo local: para instalarla y usarla sin internet debe abrirse desde el enlace publicado.' : '';
    return;
  }
  navigator.serviceWorker.register('sw.js').then(reg => {
    const ready = () => { $('offlineReady').textContent = '✓ La app ya quedó guardada en este dispositivo y funciona sin internet.'; };
    if (reg.active) ready();
    navigator.serviceWorker.ready.then(ready);
  }).catch(() => { $('offlineReady').textContent = 'No se pudo preparar el modo sin internet en este navegador.'; });
}
async function initDevice() {
  let dev = await getMeta('device', null);
  if (!dev || !dev.id) { dev = { id: 'dev-' + uid() + uid(), nombre: '' }; await setMeta('device', dev); }
  STATE.device = dev;
  STATE.apiUrl = await getMeta('apiUrl', '');
  STATE.adminKey = await getMeta('adminKey', '');
  STATE.adminOk = !!STATE.adminKey;
  const ls = await getMeta('lastSync', null); if (ls) lastSync = new Date(ls);
  // registros de la versión anterior (sin dueño): quedan como propios y por subir
  for (const r of await idbGetAll('registros')) {
    if (r.owner && r.sync) continue;
    r.owner = r.owner || dev.id; r.sync = r.sync || 'pendiente'; r.uid = r.uid || uid();
    await idbPut('registros', r);
  }
}
(async function init() {
  $('verTxt').textContent = 'v' + APP_VERSION;
  try { db = await openDB(); } catch (e) { toast('Este navegador no permite guardar datos (IndexedDB)', true); return; }
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
  await initDevice();
  await loadRegistros();
  updateCounts(); renderAdmin(); updateSyncStatus();
  resetForm(false);
  registerSW();
  syncNow();
  syncTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 3 * 60 * 1000);
})();
