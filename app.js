/* ============================================================
   RegistrObraApp v2 — Registro de obra en campo (100% offline)
   Datos maestros: 10 PDT CENIT (ver pdt-data.js)
   ============================================================ */
const APP_VERSION = '2.1.0';
const NR = 'No registra en PDT';
const NA = 'No aplica';
const EJECUTOR = 'BUSINESS AND QUALITY SERVICES S.A.S';
const ROOT_FOLDER = 'REGISTROS EN CAMPO';

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
const STATE = { registros: [], editingId: null, photos: [], firma: null };
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
async function loadRegistros() {
  STATE.registros = await idbGetAll('registros');
  STATE.registros.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.id - a.id));
}

/* ---------------- Utilidades UI ---------------- */
const $ = id => document.getElementById(id);
function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}
function setTab(name) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'registros') renderRegistros();
  if (name === 'maestro') renderMaestro();
  if (name === 'datos') { renderExportSelector(); renderStorageInfo(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function fillSelect(sel, values, placeholder, labelFn) {
  sel.innerHTML = '<option value="">' + escapeHtml(placeholder || 'Selecciona…') + '</option>' +
    values.map(v => '<option value="' + escapeHtml(v) + '">' + escapeHtml(labelFn ? labelFn(v) : v) + '</option>').join('');
}

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
function currentSel(upto) {
  const s = {};
  for (let i = 0; i < CASCADE.length && i < upto; i++) s[CASCADE[i].key] = $(CASCADE[i].id).value;
  return s;
}
function linesMatching(sel) {
  return LINES.filter(l => Object.keys(sel).every(k => !sel[k] || l[k] === sel[k]));
}
function populateLevel(idx, keepValue) {
  const lvl = CASCADE[idx];
  const el = $(lvl.id);
  const parentSel = currentSel(idx);
  const parentsOk = CASCADE.slice(0, idx).every(p => $(p.id).value);
  if (!parentsOk) { fillSelect(el, [], lvl.ph); el.disabled = true; return; }
  let vals = uniq(linesMatching(parentSel).map(l => l[lvl.key]));
  if (idx === 0) vals = ZONAS.slice();
  vals.sort(lvl.sort || ((a, b) => a.localeCompare(b, 'es')));
  fillSelect(el, vals, lvl.ph);
  el.disabled = false;
  if (keepValue && vals.includes(keepValue)) el.value = keepValue;
  else if (vals.length === 1) el.value = vals[0];
  if (lvl.key === 'pr' && vals.length === 1 && vals[0] === NR) el.disabled = true;
}
function onCascadeChange(idx, presets) {
  presets = presets || {};
  for (let j = idx + 1; j < CASCADE.length; j++) populateLevel(j, presets[CASCADE[j].key]);
  updateProjStrip();
  updateActo(presets.a);
  refreshItemRows();
}
CASCADE.forEach((lvl, idx) => $(lvl.id).addEventListener('change', () => onCascadeChange(idx)));

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
function availableLines() {
  if (!cascadeComplete()) return [];
  const sel = currentSel(CASCADE.length);
  const multiActo = $('f_acto_select').style.display !== 'none';
  if (multiActo) { if (!$('f_acto_select').value) return []; sel.a = $('f_acto_select').value; }
  return linesMatching(sel).sort((x, y) => compareItem(x.i, y.i) || x.ds.localeCompare(y.ds));
}

/* ============================================================
   ACTIVIDADES (ítems del PDT)
   ============================================================ */
function executedBySig(excludeId) {
  const map = {};
  STATE.registros.forEach(r => {
    if (excludeId && r.id === excludeId) return;
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
  sel.innerHTML = itemOptionsHtml(availableLines(), data && data.k);
  if (data) {
    if (data.k && !sel.value && data.item) {
      // ítem guardado que ya no existe en el PDT actual
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
  let l = LINE_BY_KEY[sel.value];
  if (!l && sel.value === '__saved__' && div.dataset.saved) {
    const s = JSON.parse(div.dataset.saved);
    l = { i: s.item, ds: s.actividad, u: s.unidad, q: s.contractual, n: 1, sig: s.sig };
  }
  if (!l) { prev.className = 'row-preview activity-preview empty'; prev.textContent = 'Elige un ítem para ver la descripción y las cantidades del PDT.'; unid.value = ''; return; }
  unid.value = l.u;
  const ex = executedBySig(STATE.editingId)[l.sig] || { q: 0, n: 0 };
  prev.className = 'row-preview activity-preview';
  prev.innerHTML = '<span class="lbl">Ítem ' + escapeHtml(l.i) + '</span>' + escapeHtml(l.ds) +
    '<div class="ref-grid">' +
    '<div class="ref"><div class="rl">Cant. contractual</div><div class="rv">' + fmtNum(l.q) + ' ' + escapeHtml(l.u) + '</div></div>' +
    '<div class="ref"><div class="rl">Ejecutado antes</div><div class="rv">' + fmtNum(ex.q) + '</div></div>' +
    '<div class="ref"><div class="rl">Saldo</div><div class="rv">' + (l.q === null || l.q === undefined ? '—' : fmtNum(l.q - ex.q)) + '</div></div>' +
    '</div>' + (l.n > 1 ? '<div class="muted" style="margin-top:6px;">La cantidad contractual suma ' + l.n + ' líneas iguales del PDT.</div>' : '');
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
    sel.innerHTML = itemOptionsHtml(lines, cur);
    updateRowPreview(div);
  });
}
$('btnAddRow').addEventListener('click', () => addItemRow());

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
    try { STATE.photos.push(await compressImage(f, 1280, 0.68)); } catch (err) { fallos++; }
  }
  e.target.value = '';
  renderPhotoGrid();
  if (fallos) toast(fallos + ' foto(s) no se pudieron leer', true);
  else if (files.length) toast(files.length + ' foto(s) agregada(s)');
});
function renderPhotoGrid() {
  $('photoGrid').innerHTML = STATE.photos.map((src, i) =>
    '<div class="photo-thumb"><img src="' + src + '" alt="Foto ' + (i + 1) + '"><button type="button" data-i="' + i + '" class="rmPhoto" aria-label="Quitar foto">✕</button></div>').join('');
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
  try { setFirma(await compressImage(f, 700, 0.88)); toast('Firma cargada'); }
  catch (err) { toast('No se pudo cargar la imagen de firma', true); }
  e.target.value = '';
});
function setFirma(d) {
  STATE.firma = d || null;
  const p = $('firmaPreview');
  if (STATE.firma) { $('firmaErr').style.display = 'none'; p.innerHTML = '<img src="' + STATE.firma + '" style="max-height:140px;max-width:100%;" alt="Firma">'; }
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
  if ($('f_acto_select').style.display !== 'none' && !$('f_acto_select').value) { markError($('f_acto_select')); ok = false; }
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
    const l = LINE_BY_KEY[v];
    items.push({ k: l.k, sig: l.sig, item: l.i, actividad: l.ds, unidad: l.u, contractual: l.q, cantidad: cant });
  });
  const prev = STATE.editingId ? STATE.registros.find(r => r.id === STATE.editingId) : null;
  const z = $('f_zona').value;
  const reg = {
    uid: prev && prev.uid ? prev.uid : uid(),
    proyecto: ZONA_PROY[z],
    proyectoNombre: proyLabel(ZONA_PROY[z]),
    zona: z,
    ods: $('f_ods').value,
    comp: $('f_comp').value,
    departamento: $('f_departamento').value,
    municipio: $('f_municipio').value,
    predio: $('f_predio').value,
    acto: currentActo(),
    ejecutor: $('f_ejecutor').value || EJECUTOR,
    fecha: dmaToIso($('f_fecha').value),
    items,
    observaciones: $('f_obs').value.trim(),
    fotos: STATE.photos.slice(),
    firma: STATE.firma,
    creado: prev ? prev.creado : Date.now(),
    actualizado: Date.now(),
    appVersion: APP_VERSION
  };
  if (prev) reg.id = prev.id;
  try {
    await idbPut('registros', reg);
    await loadRegistros();
    updateCounts();
    toast(prev ? 'Registro actualizado' : 'Registro guardado en el dispositivo');
    resetForm(true);
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar: ' + (err && err.target && err.target.error ? err.target.error.name : 'error de almacenamiento'), true);
  }
});
function resetForm(keepContext) {
  const ctx = keepContext && !STATE.editingId ? { z: $('f_zona').value, o: $('f_ods').value, c: $('f_comp').value, d: $('f_departamento').value, m: $('f_municipio').value, pr: $('f_predio').value, fecha: $('f_fecha').value } : null;
  $('regForm').reset();
  $('itemsContainer').innerHTML = '';
  STATE.photos = []; renderPhotoGrid(); setFirma(null);
  STATE.editingId = null;
  $('formTitle').textContent = 'Nuevo registro de obra';
  $('btnCancelEdit').style.display = 'none';
  $('f_ejecutor').value = EJECUTOR;
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
  resetForm(false);
  STATE.editingId = id;
  populateLevel(0, r.zona);
  onCascadeChange(0, { o: r.ods, c: r.comp, d: r.departamento, m: r.municipio, pr: r.predio, a: r.acto });
  $('f_fecha').value = isoToDMA(r.fecha);
  $('f_obs').value = r.observaciones || '';
  $('f_ejecutor').value = r.ejecutor || EJECUTOR;
  $('itemsContainer').innerHTML = '';
  (r.items && r.items.length ? r.items : [null]).forEach(it => addItemRow(it));
  STATE.photos = (r.fotos || []).slice(); renderPhotoGrid();
  setFirma(r.firma);
  $('formTitle').textContent = 'Editando registro #' + r.id;
  $('btnCancelEdit').style.display = '';
  closeModal();
  setTab('nuevo');
  if (!cascadeComplete()) toast('Algunos datos del registro no están en el PDT actual; revísalos', true);
}

/* ============================================================
   REGISTROS
   ============================================================ */
function updateCounts() {
  const n = STATE.registros.length;
  $('stripCount').textContent = n + (n === 1 ? ' registro guardado' : ' registros guardados');
  $('tabCount').textContent = n;
}
function refreshFilterSelects() {
  const zs = uniq(STATE.registros.map(r => r.zona)).filter(Boolean).sort();
  ['filterZona', 'expZona'].forEach(id => {
    const el = $(id), v = el.value;
    el.innerHTML = '<option value="">Todas las zonas</option>' + zs.map(z => '<option>' + escapeHtml(z) + '</option>').join('');
    if (zs.includes(v)) el.value = v;
  });
  const fz = $('filterZona').value;
  const cs = uniq(STATE.registros.filter(r => !fz || r.zona === fz).map(r => r.comp)).filter(Boolean).sort(compareComp);
  const fc = $('filterComp'), v = fc.value;
  fc.innerHTML = '<option value="">Todos los COMP</option>' + cs.map(c => '<option>' + escapeHtml(c) + '</option>').join('');
  if (cs.includes(v)) fc.value = v;
}
function renderRegistros() {
  refreshFilterSelects();
  const q = $('searchBox').value.trim().toLowerCase();
  const fz = $('filterZona').value, fc = $('filterComp').value;
  const list = STATE.registros.filter(r => {
    if (fz && r.zona !== fz) return false;
    if (fc && r.comp !== fc) return false;
    if (!q) return true;
    const hay = [r.comp, r.predio, r.municipio, r.departamento, r.zona, r.ods, r.observaciones, isoToDMA(r.fecha)].concat((r.items || []).map(i => i.item + ' ' + i.actividad)).join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!list.length) {
    $('recList').innerHTML = '<div class="empty-state"><p><b>' + (STATE.registros.length ? 'Sin resultados' : 'Aún no hay registros') + '</b></p><p>' + (STATE.registros.length ? 'Cambia los filtros de búsqueda.' : 'Los registros que guardes aparecerán aquí.') + '</p></div>';
    return;
  }
  $('recList').innerHTML = list.map(r => {
    const its = r.items || [];
    return '<div class="rec-card" data-id="' + r.id + '">' +
      '<div class="rec-thumb">' + (r.fotos && r.fotos[0] ? '<img src="' + r.fotos[0] + '" alt="">' : '') + '</div>' +
      '<div class="rec-main"><div class="rec-top"><span class="rec-comp">' + escapeHtml(r.comp) + ' · ' + escapeHtml(r.predio) + '</span><span class="rec-date">' + escapeHtml(isoToDMA(r.fecha)) + '</span></div>' +
      '<div class="rec-act">' + escapeHtml(its.map(i => i.item + ' ' + i.actividad).join(' · ')) + '</div>' +
      '<div class="rec-tags"><span class="tag">' + escapeHtml(r.zona) + '</span><span class="tag">' + escapeHtml(r.ods) + '</span><span class="tag">' + escapeHtml(r.municipio) + '</span><span class="tag qty">' + its.length + ' actividad(es)</span><span class="tag">' + (r.fotos || []).length + ' fotos</span></div></div></div>';
  }).join('');
  $('recList').querySelectorAll('.rec-card').forEach(c => c.addEventListener('click', () => openDetail(+c.dataset.id)));
}
['searchBox', 'filterZona', 'filterComp'].forEach(id => $(id).addEventListener(id === 'searchBox' ? 'input' : 'change', renderRegistros));

let detailId = null;
function openDetail(id) {
  const r = STATE.registros.find(x => x.id === id);
  if (!r) return;
  detailId = id;
  $('modalTitle').textContent = 'Registro #' + r.id + ' · ' + isoToDMA(r.fecha);
  const dl = generalRows(r).map(([k, v]) => '<div' + (String(v).length > 34 ? ' class="full"' : '') + '><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd></div>').join('');
  const its = (r.items || []).map(i => '<tr><td style="padding:5px;border-bottom:1px solid var(--line);vertical-align:top;"><b>' + escapeHtml(i.item) + '</b></td><td style="padding:5px;border-bottom:1px solid var(--line);">' + escapeHtml(i.actividad) + '</td><td style="padding:5px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right;">' + fmtNum(i.cantidad) + ' ' + escapeHtml(i.unidad) + '</td></tr>').join('');
  $('modalBody').innerHTML = '<dl class="detail-grid">' + dl + '</dl>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:10px;"><tr><th style="text-align:left;padding:5px;">Ítem</th><th style="text-align:left;padding:5px;">Actividad</th><th style="text-align:right;padding:5px;">Ejecutado</th></tr>' + its + '</table>' +
    (r.observaciones ? '<p style="font-size:13px;"><b>Observaciones:</b> ' + escapeHtml(r.observaciones) + '</p>' : '') +
    '<div class="detail-photos">' + (r.fotos || []).map(f => '<img src="' + f + '" alt="">').join('') + '</div>' +
    (r.firma ? '<div class="sig-view"><img src="' + r.firma + '" alt="Firma"></div>' : '');
  $('modalBg').classList.add('show');
}
function closeModal() { $('modalBg').classList.remove('show'); detailId = null; }
$('modalClose').addEventListener('click', closeModal);
$('modalBg').addEventListener('click', e => { if (e.target === $('modalBg')) closeModal(); });
$('modalEdit').addEventListener('click', () => { if (detailId) editRecord(detailId); });
$('modalPdf').addEventListener('click', async () => {
  const r = STATE.registros.find(x => x.id === detailId); if (!r) return;
  try { const doc = await buildPdf([r]); downloadBlob(doc.output('blob'), fileBase([r]) + '.pdf'); } catch (e) { failToast('el PDF', e); }
});
$('modalDelete').addEventListener('click', async () => {
  if (!detailId) return;
  if (!confirm('¿Eliminar este registro de forma permanente? Esta acción no se puede deshacer.')) return;
  await idbDelete('registros', detailId);
  await loadRegistros(); updateCounts(); closeModal(); renderRegistros();
  toast('Registro eliminado');
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
  const ex = executedBySig();
  const recByComp = {};
  STATE.registros.forEach(r => { const k = r.proyecto + '|' + r.zona + '|' + r.ods + '|' + r.comp; recByComp[k] = (recByComp[k] || 0) + 1; });
  const compsCon = COMP_GROUPS.filter(g => recByComp[g.p + '|' + g.z + '|' + g.o + '|' + g.c]).length;
  $('maestroKpis').innerHTML =
    '<div class="kpi"><div class="num">' + COMP_GROUPS.length + '</div><div class="lbl">ID COMP en PDT</div></div>' +
    '<div class="kpi"><div class="num">' + compsCon + '</div><div class="lbl">COMP con registros</div></div>' +
    '<div class="kpi"><div class="num">' + STATE.registros.length + '</div><div class="lbl">Registros</div></div>';
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
    const avg = te ? (tq / te * 100) : 0;
    const actos = uniq(g.lines.map(l => l.a)), munis = uniq(g.lines.map(l => l.m + ' (' + l.d + ')'));
    return '<details class="comp-card"><summary><span class="cid">' + escapeHtml(g.c === NA ? 'Sin ID COMP' : g.c) + '</span>' +
      '<span class="cinfo"><b>' + escapeHtml(g.z + ' · ' + g.o) + '</b><br>' + escapeHtml(munis.join(', ')) + '<br>' + nreg + ' registro(s) · ' + g.lines.length + ' línea(s) PDT</span>' +
      '<span class="cpct">' + avg.toFixed(0) + '%</span></summary>' +
      '<div class="comp-body"><div class="muted" style="margin-bottom:6px;">Proyecto: ' + escapeHtml(proyLabel(g.p)) + '<br>Acto(s): ' + escapeHtml(actos.join(' · ')) + '</div>' + rows + '</div></details>';
  }).join('') : '<div class="empty-state"><p><b>Sin resultados</b></p></div>';
  $('compMore').innerHTML = list.length > maestroLimit ? '<button class="btn btn-ghost btn-sm" id="btnMore">Ver más (' + (list.length - maestroLimit) + ' restantes)</button>' : '';
  if ($('btnMore')) $('btnMore').addEventListener('click', () => { maestroLimit += 30; renderMaestro(); });
}
['compSearch', 'maestroZona', 'maestroSolo'].forEach(id => $(id).addEventListener(id === 'compSearch' ? 'input' : 'change', () => { maestroLimit = 30; renderMaestro(); }));
$('btnMaestroExcel').addEventListener('click', async () => {
  try {
    const buf = await buildMaestroXlsx(STATE.registros, null);
    await downloadBlob(new Blob([buf], { type: XLSX_MIME }), 'MAESTRO COMP ' + isoToDMA(todayIso()).replace(/\//g, '-') + '.xlsx');
    toast('Excel MAESTRO COMP descargado');
  } catch (e) { failToast('el Excel', e); }
});

/* ============================================================
   EXCEL MAESTRO COMP (misma estructura del formulario)
   ============================================================ */
function recordFolder(r) {
  return [ROOT_FOLDER, safeName(proyLabel(r.proyecto).replace(' · ', ' - ')), safeName(r.comp === NA ? 'Sin ID COMP' : r.comp), safeName((r.fecha || 'sin-fecha') + '_' + (r.predio === NR ? 'Sin predio' : r.predio) + '_R' + r.id)].join('/');
}
function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|#%\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sin-nombre'; }
/* Excel con ExcelJS (permite logos). Devuelve un ArrayBuffer .xlsx */
async function buildMaestroXlsx(records, projectIds) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RegistrObraApp · ' + EJECUTOR;
  wb.created = new Date();
  const imgBqs = wb.addImage({ base64: LOGO_BQS_BASE64, extension: 'png' });
  const imgCenit = wb.addImage({ base64: LOGO_CENIT_BASE64, extension: 'png' });
  const sub = 'Generado: ' + isoToDMA(todayIso()) + ' · ' + records.length + ' registro(s) · Ejecutor: ' + EJECUTOR;
  const GREEN = 'FF1F4D3A', CLAY = 'FFB5763F';

  function sheet(name, title, cols, widths, rows, numFmt) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 6 }] });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getRow(1).height = 24; ws.getRow(2).height = 24; ws.getRow(3).height = 18; ws.getRow(4).height = 18;
    // Logos: BQS a la izquierda, CENIT a la derecha del título
    const bqsH = 54, bqsW = bqsH * LOGO_BQS_W / LOGO_BQS_H;
    ws.addImage(imgBqs, { tl: { col: 0.1, row: 0.2 }, ext: { width: bqsW, height: bqsH } });
    const cenH = 58, cenW = cenH * LOGO_CENIT_W / LOGO_CENIT_H;
    ws.addImage(imgCenit, { tl: { col: Math.min(cols.length - 1, 6) + 0.1, row: 0.3 }, ext: { width: cenW, height: cenH } });
    const tc = ws.getCell('C1'); tc.value = title; tc.font = { bold: true, size: 14, color: { argb: GREEN } };
    const sc = ws.getCell('C2'); sc.value = sub; sc.font = { size: 10, color: { argb: 'FF6B4A2F' } };
    const cc = ws.getCell('C3'); cc.value = 'BQS · Business & Quality Services SAS — Compensación Ambiental'; cc.font = { size: 9, italic: true, color: { argb: 'FF77827A' } };
    const hr = ws.getRow(6);
    hr.values = cols; hr.height = 30;
    hr.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
      c.alignment = { vertical: 'middle', wrapText: true };
      c.border = { bottom: { style: 'medium', color: { argb: CLAY } } };
    });
    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      row.alignment = { vertical: 'top', wrapText: true };
      if (i % 2 === 1) row.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F5F0' } }; });
    });
    (numFmt || []).forEach(ci => { ws.getColumn(ci).numFmt = '#,##0.##'; });
    if (rows.length) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + rows.length, column: cols.length } };
    return ws;
  }

  // Hoja 1: registros (una fila por actividad, mismos campos del formulario)
  const cols1 = ['ID registro', 'Fecha (DD/MM/AA)', 'Proyecto', 'Zona', 'ODS', 'ID COMP', 'Acto administrativo', 'Departamento', 'Municipio', 'Nombre del predio', 'Ejecutor', 'Ítem', 'Descripción de la actividad', 'Unidad', 'Cantidad ejecutada', 'Cantidad contractual PDT', 'N° fotos', 'Firma', 'Observaciones', 'Carpeta en el paquete .zip'];
  const rows1 = [];
  records.slice().sort((a, b) => (a.proyecto || '').localeCompare(b.proyecto || '') || compareComp(a.comp, b.comp) || (a.fecha || '').localeCompare(b.fecha || '')).forEach(r => {
    const its = r.items && r.items.length ? r.items : [{}];
    its.forEach(it => rows1.push([r.id, isoToDMA(r.fecha), proyLabel(r.proyecto), r.zona, r.ods, r.comp, r.acto, r.departamento, r.municipio, r.predio, r.ejecutor,
      it.item || '', it.actividad || '', it.unidad || '', numOrBlank(it.cantidad), numOrBlank(it.contractual), (r.fotos || []).length, r.firma ? 'Sí' : 'No', r.observaciones || '', recordFolder(r)]));
  });
  sheet('Registros', 'MAESTRO COMP · Registros de obra en campo', cols1, [9, 11, 30, 16, 9, 12, 28, 15, 18, 22, 26, 7, 50, 12, 11, 12, 7, 6, 28, 55], rows1, [15, 16]);

  // Hoja 2: avance por línea del PDT
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
  sheet('Avance PDT', 'MAESTRO COMP · Avance frente al PDT', cols2, [30, 16, 9, 12, 28, 15, 18, 22, 7, 50, 12, 12, 12, 9, 10, 11], rows2, [12, 13]);

  // Hoja 3: resumen por COMP
  const cols3 = ['Proyecto', 'Zona', 'ODS', 'ID COMP', 'Líneas PDT', 'Líneas con avance', 'N° registros', 'Último registro'];
  const rows3 = COMP_GROUPS.filter(g => pids.includes(g.p)).map(g => {
    const regs = records.filter(r => r.proyecto === g.p && r.zona === g.z && r.ods === g.o && r.comp === g.c);
    return [proyLabel(g.p), g.z, g.o, g.c, g.lines.length, g.lines.filter(l => ex[l.sig]).length, regs.length, isoToDMA(regs.map(r => r.fecha || '').sort().pop() || '')];
  });
  sheet('Resumen por COMP', 'MAESTRO COMP · Resumen por ID COMP', cols3, [30, 18, 9, 14, 12, 14, 12, 13], rows3);
  return await wb.xlsx.writeBuffer();
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function numOrBlank(v) { return v === null || v === undefined || v === '' || isNaN(v) ? '' : Number(v); }

/* ============================================================
   INFORMES PDF / WORD
   ============================================================ */
function generalRows(r) {
  return [
    ['Fecha', isoToDMA(r.fecha) || '-'], ['Proyecto', proyLabel(r.proyecto)], ['Zona', r.zona || '-'], ['ODS', r.ods || '-'],
    ['ID COMP', r.comp || '-'], ['Acto administrativo', r.acto || '-'], ['Departamento', r.departamento || '-'],
    ['Municipio', r.municipio || '-'], ['Nombre del predio', r.predio || '-'], ['Ejecutor', r.ejecutor || EJECUTOR]
  ];
}
function imgFmt(d) { return /^data:image\/png/.test(d) ? 'PNG' : 'JPEG'; }
function imgDims(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = src; }); }
function pdfSection(doc, t, x, y) {
  doc.setFillColor(31, 77, 58); doc.rect(x, y - 9, 3, 12, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(31, 77, 58); doc.text(t, x + 8, y);
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
    const r = list[idx];
    if (idx > 0) doc.addPage();
    let y = 46;
    const bw = 104, bh = bw * (LOGO_BQS_H / LOGO_BQS_W);
    const lw = 56, lh = lw * (LOGO_CENIT_H / LOGO_CENIT_W);
    try { doc.addImage(LOGO_BQS_BASE64, 'PNG', mx, 36, bw, bh); } catch (e) { }
    try { doc.addImage(LOGO_CENIT_BASE64, 'PNG', mx + bw + 12, 36 + (bh - lh) / 2, lw, lh); } catch (e) { }
    const logosW = bw + 12 + lw;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(31, 77, 58);
    doc.text('Informe de Registro de Obra', pageW - mx, y, { align: 'right' }); y += 15;
    doc.setFontSize(10.5); doc.setTextColor(181, 118, 63);
    doc.text('ID COMP: ' + (r.comp || '-') + ' · Predio: ' + (r.predio || '-'), pageW - mx, y, { align: 'right', maxWidth: cw - logosW - 14 }); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(107, 74, 47);
    doc.text(proyLabel(r.proyecto), pageW - mx, y, { align: 'right' }); y += 13;
    doc.setFontSize(8.5); doc.setTextColor(120, 120, 120);
    doc.text((r.zona || '-') + ' · ' + (r.ods || '-') + ' · ' + (isoToDMA(r.fecha) || '-'), pageW - mx, y, { align: 'right' });
    y = Math.max(y + 10, 36 + bh + 8);
    doc.setDrawColor(217, 207, 186); doc.line(mx, y, pageW - mx, y); y += 22;

    y = pdfSection(doc, '1. Datos generales', mx, y);
    doc.autoTable({ startY: y, margin: { left: mx, right: mx }, tableWidth: cw, theme: 'plain', body: generalRows(r),
      styles: { fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 0, right: 6 }, textColor: [28, 36, 32] },
      columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold', textColor: [107, 74, 47] }, 1: { cellWidth: cw - 130 } },
      didParseCell: d => { if (d.row.index % 2 === 1) d.cell.styles.fillColor = [247, 245, 240]; } });
    y = doc.lastAutoTable.finalY + 20;

    y = pdfSpace(doc, y, 70, pageH);
    y = pdfSection(doc, '2. Actividades ejecutadas', mx, y);
    const its = (r.items || []).map(i => [i.item || '', i.actividad || '', fmtNum(i.cantidad), i.unidad || '', fmtNum(i.contractual)]);
    doc.autoTable({ startY: y, margin: { left: mx, right: mx }, tableWidth: cw,
      head: [['Ítem', 'Actividad', 'Ejecutado', 'Unidad', 'Contractual PDT']], body: its.length ? its : [['-', 'Sin actividades', '', '', '']],
      styles: { fontSize: 8.5, cellPadding: 5, overflow: 'linebreak' }, headStyles: { fillColor: [31, 77, 58], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 245, 240] },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: cw - 40 - 62 - 62 - 70 }, 2: { cellWidth: 62 }, 3: { cellWidth: 62 }, 4: { cellWidth: 70 } } });
    y = doc.lastAutoTable.finalY + 20;

    if (r.observaciones) {
      y = pdfSpace(doc, y, 50, pageH); y = pdfSection(doc, 'Observaciones', mx, y);
      doc.setFontSize(9.5); doc.setTextColor(28, 36, 32);
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
        doc.setFillColor(247, 245, 240); doc.rect(x, y, cwid, ch, 'F');
        try { const d = await imgDims(fotos[i]); const s = Math.min(cwid / d.w, ch / d.h); doc.addImage(fotos[i], imgFmt(fotos[i]), x + (cwid - d.w * s) / 2, y + (ch - d.h * s) / 2, d.w * s, d.h * s); } catch (e) { }
        doc.setFontSize(8); doc.setTextColor(120, 120, 120); doc.text('Foto ' + (i + 1), x + cwid / 2, y + ch + 13, { align: 'center' });
        if (col === 2 || i === fotos.length - 1) y += ch + 26;
      }
    }
    y = pdfSpace(doc, y, 110, pageH); y = pdfSection(doc, '4. Firma', mx, y);
    if (r.firma) {
      try { const d = await imgDims(r.firma); const bw = 210, bh = 75; const s = Math.min((bw - 16) / d.w, (bh - 16) / d.h, 1);
        doc.setDrawColor(217, 207, 186); doc.rect(mx, y, bw, bh); doc.addImage(r.firma, imgFmt(r.firma), mx + (bw - d.w * s) / 2, y + (bh - d.h * s) / 2, d.w * s, d.h * s); y += bh + 14; } catch (e) { y += 10; }
    } else { doc.setFontSize(9); doc.setTextColor(120, 120, 120); doc.text('Sin firma registrada.', mx, y); y += 18; }
    doc.setFontSize(8.5); doc.setTextColor(90, 90, 90); doc.text(r.ejecutor || EJECUTOR, mx, y);
  }
  const tp = doc.internal.getNumberOfPages();
  for (let p = 1; p <= tp; p++) {
    doc.setPage(p); doc.setDrawColor(217, 207, 186); doc.line(mx, pageH - 38, pageW - mx, pageH - 38);
    doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
    doc.text('Informe generado el ' + isoToDMA(todayIso()) + ' · RegistrObraApp · Compensación Ambiental', mx, pageH - 24);
    doc.text('Página ' + p + ' de ' + tp, pageW - mx, pageH - 24, { align: 'right' });
  }
  return doc;
}
function buildWordHtml(records) {
  const sec = t => '<div style="font-size:11.5px;font-weight:bold;color:#1f4d3a;border-left:3px solid #1f4d3a;padding-left:8px;margin:12px 0 8px;">' + t + '</div>';
  const blocks = records.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map((r, idx) => {
    const gen = generalRows(r).map((row, i) => '<tr style="background:' + (i % 2 ? '#f7f5f0' : '#fff') + ';"><td style="padding:6px 10px;font-size:10px;font-weight:bold;color:#6b4a2f;width:140px;border-bottom:1px solid #e8dfcc;">' + escapeHtml(row[0]) + '</td><td style="padding:6px 10px;font-size:10px;border-bottom:1px solid #e8dfcc;">' + escapeHtml(row[1]) + '</td></tr>').join('');
    const td = 'padding:5px 8px;font-size:9.5px;border:1px solid #d9cfba;';
    const its = (r.items || []).map(i => '<tr><td style="' + td + '">' + escapeHtml(i.item) + '</td><td style="' + td + '">' + escapeHtml(i.actividad) + '</td><td style="' + td + '">' + escapeHtml(fmtNum(i.cantidad)) + '</td><td style="' + td + '">' + escapeHtml(i.unidad) + '</td><td style="' + td + '">' + escapeHtml(fmtNum(i.contractual)) + '</td></tr>').join('');
    let fotos = '<p style="font-size:9.5px;color:#77827a;">Sin fotos adjuntas.</p>';
    if (r.fotos && r.fotos.length) {
      const cells = r.fotos.map((f, i) => '<td style="width:33%;text-align:center;padding:4px;vertical-align:top;"><img src="' + f + '" width="170" style="width:170px;border:1px solid #d9cfba;"><div style="font-size:8.5px;color:#77827a;">Foto ' + (i + 1) + '</div></td>');
      let rr = ''; for (let i = 0; i < cells.length; i += 3) rr += '<tr>' + cells.slice(i, i + 3).join('') + '</tr>';
      fotos = '<table style="width:100%;">' + rr + '</table>';
    }
    const firma = r.firma ? '<img src="' + r.firma + '" width="200" style="max-width:220px;border:1px solid #d9cfba;padding:4px;"><div style="font-size:9px;color:#4a564e;">' + escapeHtml(r.ejecutor || EJECUTOR) + '</div>' : '<p style="font-size:9.5px;color:#77827a;">Sin firma registrada.</p>';
    return (idx ? '<div style="page-break-before:always;">&nbsp;</div>' : '') +
      '<table style="width:100%;"><tr><td style="width:190px;vertical-align:middle;"><img src="' + LOGO_BQS_BASE64 + '" width="110"> &nbsp; <img src="' + LOGO_CENIT_BASE64 + '" width="60"></td><td style="text-align:right;">' +
      '<div style="font-size:16px;font-weight:bold;color:#1f4d3a;">Informe de Registro de Obra</div>' +
      '<div style="font-size:11px;font-weight:bold;color:#b5763f;">ID COMP: ' + escapeHtml(r.comp) + ' · Predio: ' + escapeHtml(r.predio) + '</div>' +
      '<div style="font-size:10px;color:#6b4a2f;">' + escapeHtml(proyLabel(r.proyecto)) + '</div>' +
      '<div style="font-size:9px;color:#888;">' + escapeHtml(r.zona + ' · ' + r.ods + ' · ' + isoToDMA(r.fecha)) + '</div></td></tr></table>' +
      '<hr style="border:none;border-top:1px solid #d9cfba;">' + sec('1. Datos generales') + '<table style="width:100%;border-collapse:collapse;">' + gen + '</table>' +
      sec('2. Actividades ejecutadas') + '<table style="width:100%;border-collapse:collapse;"><tr>' + ['Ítem', 'Actividad', 'Ejecutado', 'Unidad', 'Contractual PDT'].map(h => '<th style="background:#1f4d3a;color:#fff;padding:6px 8px;font-size:9.5px;text-align:left;">' + h + '</th>').join('') + '</tr>' + its + '</table>' +
      (r.observaciones ? sec('Observaciones') + '<p style="font-size:10px;">' + escapeHtml(r.observaciones) + '</p>' : '') +
      sec('3. Registro fotográfico') + fotos + sec('4. Firma') + firma;
  }).join('');
  return '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Informe de registros de obra</title><style>body{font-family:Calibri,Arial,sans-serif;color:#1c2420;}table{border-collapse:collapse;}</style></head><body>' + blocks + '</body></html>';
}

function failToast(what, e) {
  console.error(e);
  const libs = { ExcelJS: 'exceljs.min.js', jspdf: 'jspdf.umd.min.js', JSZip: 'jszip.min.js' };
  const falt = Object.keys(libs).filter(k => !window[k]).map(k => libs[k]);
  toast(falt.length ? 'No se pudo generar ' + what + ': falta subir ' + falt.join(', ') + ' junto al index.html' : 'No se pudo generar ' + what + ' (' + (e && e.message ? e.message : 'error') + ')', true);
}

/* ============================================================
   DESCARGAS
   ============================================================ */
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
  const list = STATE.registros.filter(r => !fz || r.zona === fz);
  const cont = $('exportSelectorList');
  const prevChecked = new Set(Array.from(cont.querySelectorAll('input:checked')).map(i => +i.value));
  const first = !cont.dataset.init; cont.dataset.init = '1';
  cont.innerHTML = list.length ? list.map(r => '<label class="sel-row"><input type="checkbox" value="' + r.id + '"' + (first || prevChecked.has(r.id) ? ' checked' : '') + '><span><b>' + escapeHtml(isoToDMA(r.fecha)) + '</b> · ' + escapeHtml(r.comp + ' · ' + r.predio) + '<br><span class="muted">' + escapeHtml(r.zona + ' · ' + r.ods + ' · ' + (r.items || []).length + ' actividad(es) · ' + (r.fotos || []).length + ' fotos') + '</span></span></label>').join('')
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
    const r = sel[i];
    const folder = recordFolder(r);
    msg.textContent = 'Preparando registro ' + (i + 1) + ' de ' + sel.length + '…';
    (r.fotos || []).forEach((f, j) => zip.file(folder + '/Foto_' + String(j + 1).padStart(2, '0') + '.' + extOf(f), dataUrlToBytes(f)));
    if (r.firma) zip.file(folder + '/Firma.' + extOf(r.firma), dataUrlToBytes(r.firma));
    if (withReports) {
      const doc = await buildPdf([r]);
      zip.file(folder + '/Informe_R' + r.id + '.pdf', doc.output('arraybuffer'));
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
  catch (e) { failToast('el .zip de fotos', e); }
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
  try { await downloadBlob(new Blob(['﻿' + buildWordHtml(sel)], { type: 'application/msword' }), fileBase(sel) + '.doc'); toast('Word descargado'); }
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
    delete r.id;
    await idbPut('registros', r); n++;
  }
  await loadRegistros(); updateCounts(); renderExportSelector();
  return n;
}
$('btnImportMerge').addEventListener('click', async () => { const l = await readImport(); if (l) toast((await importRecords(l, false)) + ' registro(s) importado(s)'); });
$('btnImportReplace').addEventListener('click', async () => {
  const l = await readImport(); if (!l) return;
  if (!confirm('Esto BORRA los registros actuales de este dispositivo y los reemplaza por los de la copia. ¿Continuar?')) return;
  toast((await importRecords(l, true)) + ' registro(s) restaurado(s)');
});
$('btnWipe').addEventListener('click', async () => {
  if (!confirm('¿Borrar TODOS los registros, fotos y firmas de este dispositivo? Descarga antes una copia .json.')) return;
  if (!confirm('Confirmación final: esta acción no se puede deshacer.')) return;
  await idbClear('registros'); await loadRegistros(); updateCounts(); renderExportSelector(); toast('Registros borrados');
});
async function renderStorageInfo() {
  const el = $('storageInfo');
  try {
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    el.textContent = (est ? 'Espacio usado: ' + (est.usage / 1048576).toFixed(1) + ' MB de ' + (est.quota / 1048576).toFixed(0) + ' MB disponibles. ' : '') +
      (persisted ? 'Almacenamiento protegido contra borrado automático.' : '');
  } catch (e) { el.textContent = ''; }
}

/* ============================================================
   Migración desde la versión anterior (misma dirección web)
   ============================================================ */
async function checkOldVersion() {
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      if (!dbs.some(d => d.name === 'registroObraDB')) return;
    } else return;
    const old = await new Promise((res, rej) => { const q = indexedDB.open('registroObraDB'); q.onsuccess = () => res(q.result); q.onerror = rej; });
    if (!old.objectStoreNames.contains('registros')) { old.close(); return; }
    const regs = await new Promise((res, rej) => { const q = old.transaction('registros').objectStore('registros').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = rej; });
    old.close();
    const meta = await idbGet('meta', 'migracionV1');
    if (!regs.length || meta) return;
    if (!confirm('Se encontraron ' + regs.length + ' registro(s) de la versión anterior de RegistrObraApp en este dispositivo. ¿Traerlos a esta versión? (El predio quedará como "Sin predio – versión anterior")')) { await idbPut('meta', { key: 'migracionV1', omitida: true }); return; }
    const ZMAP = { 'Zona Occidente Norte': 'Occidente Norte', 'Zona Occidente sur': 'Occidente Sur' };
    const conv = regs.map(o => {
      const z = ZMAP[o.zona] || o.zona || '';
      const items = (o.items && o.items.length ? o.items : (o.item ? [{ item: o.item, actividad: o.actividad, cantidad: o.cantidad, unidad: o.unidad }] : []))
        .map(i => ({ item: String(i.item || ''), actividad: i.actividad || '', unidad: i.unidad || '', cantidad: i.cantidad, contractual: null, sig: '' }));
      return { uid: 'v1-' + o.id + '-' + (o.creado || ''), proyecto: ZONA_PROY[z] || '', zona: z, ods: o.ods || '', comp: o.comp || '', departamento: o.departamento || '', municipio: o.municipio || '',
        predio: 'Sin predio – versión anterior', acto: o.actoAdministrativo || '', ejecutor: o.ejecutor || EJECUTOR, fecha: o.fecha || '', items, observaciones: o.observaciones || '',
        fotos: o.fotos || [], firma: o.firma || null, creado: o.creado || Date.now(), actualizado: Date.now(), origen: 'v1' };
    });
    const n = await importRecords(conv, false);
    await idbPut('meta', { key: 'migracionV1', fecha: Date.now(), n });
    toast(n + ' registro(s) de la versión anterior importados');
  } catch (e) { console.warn('Migración v1', e); }
}

/* ============================================================
   Conexión, instalación y modo offline
   ============================================================ */
function updateNet() {
  const on = navigator.onLine;
  $('netPill').classList.toggle('online', on);
  $('netTxt').textContent = (on ? 'En línea' : 'Sin conexión') + ' · datos en este dispositivo';
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
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

/* ---------------- Inicio ---------------- */
(async function init() {
  $('verTxt').textContent = 'v' + APP_VERSION;
  updateNet();
  try { db = await openDB(); } catch (e) { toast('Este navegador no permite guardar datos (IndexedDB)', true); return; }
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
  await loadRegistros();
  updateCounts();
  resetForm(false);
  registerSW();
  checkOldVersion();
})();
