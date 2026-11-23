import { createDemoDB } from './db-demo.js';

const cfg = window.APP_CONFIG || {};

// ======================================================================
//  Utilidades
// ======================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n, d = 0) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: d });
const fmtQ = (n) => (n == null ? '—' : fmtN(n, 3));
const fmt$ = (n) => '$\u00a0' + fmtN(Math.round(n || 0));
const fmtPct = (n) => (n == null || !isFinite(n) ? '—' : fmtN(n * 100, 0) + '%');
const fmtFH = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtF = (iso) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const dia = (d) => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hoy = () => dia(new Date());
// Fecha completa y válida (un campo de fecha vacío o a medio escribir no se usa como filtro)
const okFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(new Date(v + 'T00:00:00'));
const fechasOk = (f, desde, hasta) => { if (!okFecha(f.desde)) f.desde = desde; if (!okFecha(f.hasta)) f.hasta = hasta; return f; };
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dia(d); };
const hace = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};

const ESTADOS = {
  borrador: { l: 'Borrador', c: 'gray', ico: '✎' },
  en_transito: { l: 'En tránsito', c: 'amber', ico: '🚚' },
  recibido: { l: 'Recibido completo', c: 'green', ico: '✓' },
  con_diferencias: { l: 'Recibido con diferencias', c: 'red', ico: '!' },
  anulado: { l: 'Anulado', c: 'muted', ico: '✕' },
};
const EVENTOS = {
  creado: { l: 'Creado', c: 'gray', ico: '✎' },
  despachado: { l: 'Despachado', c: 'amber', ico: '🚚' },
  recibido: { l: 'Recibido OK', c: 'green', ico: '✓' },
  con_diferencias: { l: 'Recibido con diferencias', c: 'red', ico: '!' },
  anulado: { l: 'Anulado', c: 'gray', ico: '✕' },
  aviso: { l: 'Aviso enviado', c: 'blue', ico: '✉' },
  llegado: { l: 'Llegó al local', c: 'amber', ico: '📦' },
  facturado: { l: 'Cargado en facturación', c: 'green', ico: '$' },
  dif_resuelta: { l: 'Diferencia resuelta por Producción', c: 'blue', ico: '✓' },
};
// Motivos con los que Producción resuelve una diferencia
const DIF_TIPOS = { merma: 'Merma', error_carga: 'Error de carga del obrador', faltante_traslado: 'Faltante / rotura en el traslado', sobrante: 'Sobrante', reposicion: 'Reposición enviada', otro: 'Otro' };
// Circuito administrativo (solo lo ve administración)
const ESTADOS_ADMIN = {
  borrador: { l: 'Borrador', c: 'gray' },
  enviado: { l: 'En tránsito', c: 'amber' },
  revision: { l: 'Pendiente de recepción', c: 'blue' },
  facturacion: { l: 'Pendiente de facturación', c: 'red' },
  facturado: { l: 'Facturado (diferencia sin resolver)', c: 'amber' },
  cerrado: { l: 'Cerrado', c: 'green' },
  anulado: { l: 'Anulado', c: 'muted' },
};
const difPendiente = (r) => r.estado === 'con_diferencias' && !r.dif_resuelta_at;
// Estado de la recepción / diferencia (lo ven todos)
const badgeRecep = (r) => r.estado === 'recibido' ? '<span class="badge b-green">Recibido completo</span>'
  : r.estado !== 'con_diferencias' ? ''
  : difPendiente(r) ? '<span class="badge b-red">Diferencia pendiente de resolución</span>' : '<span class="badge b-gray">Diferencia resuelta</span>';
const estadoAdmin = (r) => {
  if (r.estado === 'anulado') return 'anulado';
  if (r.estado === 'borrador') return 'borrador';
  if (r.estado === 'en_transito') return r.llegado_at ? 'revision' : 'enviado';
  if (!r.facturado_at) return 'facturacion';
  return difPendiente(r) ? 'facturado' : 'cerrado';
};
const badgeAdmin = (r) => { const e = ESTADOS_ADMIN[estadoAdmin(r)]; return `<span class="badge b-${e.c}">${esc(e.l)}</span>`; };
const ROLES = { admin: 'Administración', obrador: 'Obrador', local: 'Local', pendiente: 'Pendiente' };
const badge = (estado) => { const e = ESTADOS[estado] || { l: estado, c: 'gray' }; return `<span class="badge b-${e.c}">${esc(e.l)}</span>`; };

function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (opts.err ? ' err' : '');
  el.textContent = msg;
  if (opts.onClick) el.onclick = opts.onClick;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), opts.err ? 7000 : 4500);
}
const err = (e) => { console.error(e); toast(e.message || String(e), { err: true }); };

// Modal genérico con formulario. fields: [{name,label,type,options,value,required}]
function modalForm({ title, fields, submit = 'Guardar', html = '' }) {
  return new Promise((resolve) => {
    const dlg = $('#modal');
    dlg.innerHTML = `<form method="dialog">
      <h2>${esc(title)}</h2>${html}
      <div class="form-grid">${fields.map((f) => `<label class="field" style="${f.type === 'textarea' ? 'grid-column:1/-1' : ''}"><span>${esc(f.label)}</span>${
        f.type === 'select' ? `<select name="${f.name}" ${f.required ? 'required' : ''}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
          : f.type === 'textarea' ? `<textarea name="${f.name}" ${f.required ? 'required' : ''}>${esc(f.value)}</textarea>`
            : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value)}" ${f.required ? 'required' : ''} ${f.type === 'number' ? 'step="any"' : ''}>`
      }</label>`).join('')}</div>
      <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="ok">${esc(submit)}</button></div>
    </form>`;
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      const fd = new FormData($('form', dlg));
      const out = {};
      fields.forEach((f) => { let v = fd.get(f.name); if (f.type === 'number') v = v === '' ? 0 : Number(v); out[f.name] = v; });
      resolve(out);
    };
    dlg.returnValue = '';
    dlg.showModal();
  });
}

// ======================================================================
//  Estado global
// ======================================================================
let db, me;
let locs = [], prods = [], areas = [];
const S = { refresh: null, sort: { key: 'dif', dir: -1 } };
const locName = (id) => locs.find((l) => l.id === id)?.nombre || '—';
const prod = (id) => prods.find((p) => p.id === id);
const area = (id) => areas.find((a) => a.id === id);
const label = (r) => (area(r.area_id)?.prefijo || '0000') + '-' + String(r.nro_area ?? r.numero).padStart(4, '0');
const evLabel = (e) => e.remito_label || e.label || '#' + (e.remito_numero ?? e.numero);
const SECCIONES = { terminado: 'Productos terminados', masa_sola: 'Masa sola', intermedio: 'Elaborados / intermedios', materia_prima: 'Materias primas' };
const BULTOS = ['tappers', 'latas', 'bowls'];
const itemNombre = (i) => (i.product_id ? prod(i.product_id)?.nombre || '(producto eliminado)' : i.descripcion);
const itemUnidad = (i) => (i.product_id ? prod(i.product_id)?.unidad : i.unidad) || '';
const obradores = () => locs.filter((l) => l.tipo === 'obrador' && l.activo !== false);
const locales = () => locs.filter((l) => l.tipo === 'local' && l.activo !== false);
// Locales que abastece un obrador (los que no tienen obrador asignado aparecen para todos)
const localesDe = (obradorId) => locales().filter((l) => !l.obrador_id || l.obrador_id === obradorId);
const can = {
  crear: () => ['admin', 'obrador'].includes(me.rol),
  admin: () => me.rol === 'admin',
  despachar: (r) => r.estado === 'borrador' && (me.rol === 'admin' || (me.rol === 'obrador' && r.origen_id === me.location_id)),
  llegar: (r) => r.estado === 'en_transito' && !r.llegado_at && (me.rol === 'admin' || (me.rol === 'local' && r.destino_id === me.location_id)),
  recibir: (r) => r.estado === 'en_transito' && (me.rol === 'admin' || (me.rol === 'local' && r.destino_id === me.location_id && !!r.llegado_at)),
  facturar: (r) => me.rol === 'admin' && ['recibido', 'con_diferencias'].includes(r.estado) && !r.facturado_at,
  resolver: (r) => difPendiente(r) && (me.rol === 'admin' || (me.rol === 'obrador' && r.origen_id === me.location_id)),
  anular: (r) => ['borrador', 'en_transito'].includes(r.estado) && (me.rol === 'admin' || (me.rol === 'obrador' && r.origen_id === me.location_id && ['borrador', 'en_transito'].includes(r.estado))),
};

async function loadMaestros() { [locs, prods, areas] = await Promise.all([db.listLocations(), db.listProducts(), db.listAreas()]); }

// ======================================================================
//  Arranque
// ======================================================================
async function boot() {
  try {
    if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      const m = await import('./db-supabase.js');
      db = await m.createSupabaseDB(cfg);
      const rec = await db.recoveryState();
      if (rec.error || rec.recovery) history.replaceState(null, '', location.pathname); // limpia el token de la URL
      if (rec.error) setTimeout(() => toast('El link de recupero venció o ya se usó. Pedí uno nuevo.', { err: true }), 300);
      if (rec.recovery) return renderNuevaPassword();
    } else {
      db = createDemoDB();
    }
    me = await db.getProfile();
    if (!me) return renderLogin();
    if (me.rol === 'pendiente') return renderPendiente();
    await start();
  } catch (e) {
    $('#app').innerHTML = `<div class="boot">No se pudo iniciar la app: ${esc(e.message)}</div>`;
    console.error(e);
  }
}

async function start() {
  await loadMaestros();
  renderShell();
  db.subscribe(onLive);
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/tablero';
  route();
  setInterval(() => $$('[data-ago]').forEach((el) => (el.textContent = hace(el.dataset.ago))), 30000);
}

async function onLive(evt) {
  if (!evt) return;
  if (evt.tipo === 'maestros' || evt.tipo === 'reset') await loadMaestros();
  if (evt.numero) {
    const e = EVENTOS[evt.tipo];
    toast(`Remito ${evLabel(evt)}: ${e ? e.l : evt.tipo}${evt.usuario_nombre ? ' · ' + evt.usuario_nombre : ''}`, {
      onClick: () => evt.remito_id && (location.hash = '#/remitos/' + evt.remito_id),
    });
  } else if (evt.tipo === 'ventas') {
    toast('Se importaron ventas nuevas');
  }
  S.lastEvt = evt;
  if (S.refresh) S.refresh();
}

// ======================================================================
//  Login
// ======================================================================
async function renderLogin() {
  const empresa = esc(cfg.EMPRESA || 'Control de Remitos');
  if (db.mode === 'demo') {
    const users = await db.demoUsers();
    const lname = (id) => (id ? (users && locs.length ? locName(id) : '') : '');
    locs = await db.listLocations();
    $('#app').innerHTML = `<div class="login"><div class="card">
      <div class="brand"><div class="brand-logo">R</div>${empresa}</div>
      <p class="muted">Remitos de obradores a locales, con control de recepción y contraste contra ventas.</p>
      <div class="demo-banner">Modo demo: datos de ejemplo guardados en este navegador. Elegí con qué usuario entrar. Abrí otra pestaña con otro usuario para ver el tiempo real.</div>
      <div class="user-pick">${users.map((u) => `<button data-u="${u.id}"><span><b>${esc(u.nombre)}</b><br><span class="muted small">${esc(ROLES[u.rol])}${u.location_id ? ' · ' + esc(lname(u.location_id)) : ''}</span></span><span>→</span></button>`).join('')}</div>
      <p class="small muted" style="margin-top:16px"><a href="#" id="reset">Reiniciar datos de demo</a></p>
    </div></div>`;
    $$('[data-u]').forEach((b) => (b.onclick = async () => { me = await db.signInDemo(b.dataset.u); location.hash = '#/tablero'; start(); }));
    $('#reset').onclick = async (e) => { e.preventDefault(); if (confirm('¿Borrar los datos de demo y regenerarlos?')) { await db.resetDemo(); renderLogin(); } };
    return;
  }
  let signup = false;
  const drawReset = () => {
    $('#app').innerHTML = `<div class="login"><div class="card">
      <div class="brand"><div class="brand-logo">R</div>${empresa}</div>
      <h2 style="margin:6px 0">Recuperar contraseña</h2>
      <p class="muted">Escribí el mail con el que te registraste y te mandamos un link para elegir una contraseña nueva.</p>
      <form id="fr" class="grid" style="margin-top:12px">
        <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
        <button class="btn primary big">Enviar link</button>
      </form>
      <div id="sent"></div>
      <p class="small muted" style="margin-top:14px"><a href="#" id="back">← Volver a ingresar</a></p>
    </div></div>`;
    $('#back').onclick = (e) => { e.preventDefault(); draw(); };
    $('#fr').onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button', e.target); btn.disabled = true;
      const email = new FormData(e.target).get('email');
      try {
        $('#sent').innerHTML = '';
        await db.resetPassword(email);
        $('#sent').innerHTML = `<div class="callout info" style="margin:14px 0 0"><span>Listo. Si ${esc(email)} tiene usuario, en unos minutos le llega un mail de Supabase ("Reset Your Password") con el link. Revisá también la carpeta de spam.</span></div>`;
      } catch (ex) {
        err(/rate limit|security purposes/i.test(ex.message) ? new Error('Se pidieron demasiados mails seguidos. Esperá unos minutos y volvé a intentar.') : ex);
      } finally { setTimeout(() => (btn.disabled = false), 5000); }
    };
  };
  const draw = () => {
    $('#app').innerHTML = `<div class="login"><div class="card">
      <div class="brand"><div class="brand-logo">R</div>${empresa}</div>
      <p class="muted">${signup ? 'Creá tu usuario. Un administrador te va a asignar el obrador o local.' : 'Ingresá con tu usuario.'}</p>
      <form id="f" class="grid" style="margin-top:12px">
        ${signup ? '<label class="field"><span>Nombre</span><input name="nombre" required></label>' : ''}
        <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
        <label class="field"><span>Contraseña</span><input name="pass" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        <button class="btn primary big">${signup ? 'Crear usuario' : 'Ingresar'}</button>
      </form>
      <p class="small muted" style="margin-top:14px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <a href="#" id="tog">${signup ? 'Ya tengo usuario' : 'No tengo usuario, registrarme'}</a>
        ${signup ? '' : '<a href="#" id="olvide">¿Olvidaste tu contraseña?</a>'}</p>
    </div></div>`;
    $('#tog').onclick = (e) => { e.preventDefault(); signup = !signup; draw(); };
    $('#olvide') && ($('#olvide').onclick = (e) => { e.preventDefault(); drawReset(); });
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        me = signup ? await db.signUp(fd.get('email'), fd.get('pass'), fd.get('nombre')) : await db.signIn(fd.get('email'), fd.get('pass'));
        if (!me) return toast('Revisá tu email para confirmar el usuario y luego ingresá.');
        if (me.rol === 'pendiente') return renderPendiente();
        start();
      } catch (ex) { err(ex); }
    };
  };
  draw();
}

// Pantalla a la que llega el link del mail de recupero
function renderNuevaPassword() {
  $('#app').innerHTML = `<div class="login"><div class="card">
    <div class="brand"><div class="brand-logo">R</div>${esc(cfg.EMPRESA || 'Control de Remitos')}</div>
    <h2 style="margin:6px 0">Elegí tu contraseña nueva</h2>
    <form id="fn" class="grid" style="margin-top:12px">
      <label class="field"><span>Contraseña nueva</span><input name="p1" type="password" required minlength="6" autocomplete="new-password"></label>
      <label class="field"><span>Repetila</span><input name="p2" type="password" required minlength="6" autocomplete="new-password"></label>
      <button class="btn primary big">Guardar e ingresar</button>
    </form></div></div>`;
  $('#fn').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('p1') !== fd.get('p2')) return toast('Las dos contraseñas no coinciden', { err: true });
    const btn = $('button', e.target); btn.disabled = true;
    try {
      me = await db.updatePassword(fd.get('p1'));
      toast('Contraseña actualizada');
      if (!me) return location.reload();
      if (me.rol === 'pendiente') return renderPendiente();
      location.hash = '#/tablero';
      start();
    } catch (ex) { err(ex); btn.disabled = false; }
  };
}

function renderPendiente() {
  $('#app').innerHTML = `<div class="login"><div class="card">
    <div class="brand"><div class="brand-logo">R</div>${esc(cfg.EMPRESA || 'Control de Remitos')}</div>
    <h2 style="margin:10px 0">Usuario pendiente de aprobación</h2>
    <p class="muted">Tu usuario (${esc(me.email)}) fue creado. Pedile a un administrador que te asigne el rol y el obrador o local.</p>
    <button class="btn" id="out">Salir</button></div></div>`;
  $('#out').onclick = async () => { await db.signOut(); location.reload(); };
}

// ======================================================================
//  Shell y ruteo
// ======================================================================
function navItems() {
  const items = [['tablero', '◉', 'Tablero en vivo'], ['remitos', '☰', 'Remitos']];
  if (can.crear()) items.push(['remitos/nuevo', '+', 'Nuevo remito']);
  if (me.rol !== 'local') items.push(['diferencias', '±', 'Diferencias']);
  if (me.rol !== 'local') items.push(['reportes', '▤', 'Reportes']);
  if (can.admin()) items.push(['franquicias', '◈', 'Franquicias']);
  if (me.rol !== 'obrador') items.push(['contraste', '⇄', 'Enviado vs. vendido']);
  if (can.admin()) items.push(['ventas', '↥', 'Ventas HioPos'], ['config', '⚙', 'Configuración']);
  return items;
}

function renderShell() {
  const where = me.location_id ? locName(me.location_id) : 'Todas las sedes';
  $('#app').innerHTML = `
    <div class="topbar"><button id="burger" aria-label="Menú">☰</button><b>${esc(cfg.EMPRESA || 'Control de Remitos')}</b><span style="flex:1"></span><span class="live">En vivo</span></div>
    <div class="shell">
      <nav class="nav" id="nav">
        <div class="brand"><div class="brand-logo">R</div>${esc(cfg.EMPRESA || 'Control de Remitos')}</div>
        ${navItems().map(([h, ico, l]) => `<a href="#/${h}" data-r="${h}"><span class="ico">${ico}</span>${l}</a>`).join('')}
        <div class="spacer"></div>
        ${db.mode === 'demo' ? '<div class="demo-banner">Modo demo</div>' : ''}
        <div class="userbox">
          <span class="live">En vivo</span>
          <div><div class="who">${esc(me.nombre || me.email)}</div><div class="small muted">${esc(ROLES[me.rol])} · ${esc(where)}</div></div>
          <button class="btn sm" id="logout">Salir</button>
        </div>
      </nav>
      <main id="view"></main>
    </div>`;
  $('#logout').onclick = async () => { await db.signOut(); location.hash = ''; location.reload(); };
  $('#burger').onclick = () => $('#nav').classList.toggle('open');
}

async function route() {
  const path = location.hash.replace(/^#\/?/, '') || 'tablero';
  $('#nav')?.classList.remove('open');
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === path || (a.dataset.r === 'remitos' && /^remitos\/(?!nuevo)/.test(path))));
  S.refresh = null;
  const v = $('#view');
  try {
    if (path === 'tablero') await viewTablero(v);
    else if (path === 'remitos') await viewRemitos(v);
    else if (path === 'remitos/nuevo') await viewNuevo(v);
    else if (path.startsWith('remitos/')) await viewDetalle(v, path.split('/')[1]);
    else if (path === 'contraste') await viewContraste(v);
    else if (path === 'diferencias') await viewDiferencias(v);
    else if (path === 'reportes' && me.rol !== 'local') await viewReportes(v);
    else if (path === 'franquicias' && can.admin()) await viewFranquicias(v);
    else if (path === 'ventas') await viewVentas(v);
    else if (path === 'config') await viewConfig(v);
    else v.innerHTML = '<div class="empty">Página no encontrada</div>';
  } catch (e) { err(e); v.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}

// ======================================================================
//  Tablero en vivo
// ======================================================================
async function viewTablero(v) {
  const draw = async () => {
    const [rems, evs] = await Promise.all([db.listRemitos({ desde: haceDias(30) }), db.listEventos(25)]);
    const transito = rems.filter((r) => r.estado === 'en_transito').sort((a, b) => a.despachado_at.localeCompare(b.despachado_at));
    const borr = rems.filter((r) => r.estado === 'borrador');
    const recHoy = rems.filter((r) => r.recibido_at && dia(r.recibido_at) === hoy());
    const difs7 = rems.filter((r) => r.estado === 'con_diferencias' && r.recibido_at >= new Date(Date.now() - 7 * 864e5).toISOString());
    const paraMi = me.rol === 'local' ? transito.filter((r) => r.destino_id === me.location_id) : [];
    const newest = S.lastEvt?.numero;
    const esAdmin = me.rol === 'admin';
    const porEstado = (k) => rems.filter((r) => estadoAdmin(r) === k);
    const difSinRes = rems.filter(difPendiente);
    const pendFact = esAdmin ? porEstado('facturacion').sort((a, b) => (a.recibido_at || '').localeCompare(b.recibido_at || '')) : [];

    v.innerHTML = `
      <div class="page-head"><div><h1>Tablero en vivo</h1><p>${esc(me.location_id ? locName(me.location_id) : 'Todos los obradores y locales')} · se actualiza solo</p></div>
      ${can.crear() ? '<a class="btn primary" href="#/remitos/nuevo">+ Nuevo remito</a>' : ''}</div>
      ${me.rol === 'obrador' && difSinRes.length ? `<div class="callout"><span>± Hay ${difSinRes.length} remito${difSinRes.length > 1 ? 's' : ''} con diferencias para resolver</span><a class="btn" href="#/diferencias">Ver diferencias</a></div>` : ''}
      ${paraMi.length ? `<div class="callout"><span>🚚 Tenés ${paraMi.length} remito${paraMi.length > 1 ? 's' : ''} en camino para recibir</span><a class="btn" href="#/remitos/${paraMi[0].id}">${paraMi[0].llegado_at ? 'Controlar recepción' : 'Abrir remito'}</a></div>` : ''}
      ${esAdmin ? `<h2 style="margin:0 0 8px">Circuito administrativo <span class="small muted">(últimos 30 días)</span></h2>
      <div class="kpis">
        <div class="card kpi warn"><div class="label">En tránsito</div><div class="value">${porEstado('enviado').length}</div><div class="sub">en camino al local</div></div>
        <div class="card kpi"><div class="label">Pendiente de recepción</div><div class="value" style="color:var(--blue)">${porEstado('revision').length}</div><div class="sub">llegó, el local está controlando</div></div>
        <div class="card kpi ${pendFact.length ? 'alert' : ''}"><div class="label">Pendiente de facturación</div><div class="value">${pendFact.length}</div><div class="sub">controlado por el local, falta facturar</div></div>
        <div class="card kpi ${difSinRes.length ? 'alert' : ''}"><a href="#/diferencias" style="color:inherit"><div class="label">Diferencias sin resolver</div><div class="value">${difSinRes.length}</div><div class="sub">Producción tiene que resolverlas</div></a></div>
        <div class="card kpi ok"><div class="label">Cerrado</div><div class="value">${porEstado('cerrado').length}</div><div class="sub">facturado y sin diferencias pendientes</div></div>
      </div>` : ''}
      <div class="kpis">
        <div class="card kpi warn"><div class="label">En tránsito ahora</div><div class="value">${transito.length}</div><div class="sub">${fmtN(transito.reduce((s, r) => s + r.n_items, 0))} líneas de productos</div></div>
        <div class="card kpi ok"><div class="label">Recibidos hoy</div><div class="value">${recHoy.length}</div><div class="sub">${recHoy.filter((r) => r.estado === 'con_diferencias').length} con diferencias</div></div>
        <div class="card kpi ${difs7.length ? 'alert' : ''}"><div class="label">Con diferencias (7 días)</div><div class="value">${difs7.length}</div><div class="sub">faltantes o roturas en recepción</div></div>
        <div class="card kpi"><div class="label">Borradores sin despachar</div><div class="value">${borr.length}</div><div class="sub">&nbsp;</div></div>
      </div>
      ${esAdmin && pendFact.length ? `<section class="card" style="margin-bottom:16px">
          <div class="card-head"><h2>Pendientes de facturación</h2><a class="small" href="#/remitos" id="ver-fact">Ver todos</a></div>
          <div class="list">${pendFact.slice(0, 8).map((r) => `
            <a class="list-item" href="#/remitos/${r.id}" style="color:inherit">
              <div class="main"><div class="title">${label(r)} · ${esc(locName(r.destino_id))} <span class="muted small">${esc(area(r.area_id)?.nombre || '')}</span></div>
              <div class="small muted">recibido ${fmtFH(r.recibido_at)}${r.estado === 'con_diferencias' ? ' · <span style="color:var(--red)">con diferencias</span>' : ''}</div></div>
              <span class="btn sm">Facturar</span>
            </a>`).join('')}</div>
        </section>` : ''}
      <div class="grid cols-2">
        <section class="card">
          <div class="card-head"><h2>En tránsito</h2><a class="small" href="#/remitos">Ver todos</a></div>
          <div class="list">${transito.length ? transito.map((r) => `
            <a class="list-item" href="#/remitos/${r.id}" style="color:inherit">
              <div class="main"><div class="title">${label(r)} · ${esc(locName(r.destino_id))} <span class="muted small">${esc(area(r.area_id)?.nombre || '')}</span></div>
              <div class="small muted">desde ${esc(locName(r.origen_id))} · salió <span data-ago="${r.despachado_at}">${hace(r.despachado_at)}</span> · ${r.n_items} productos</div></div>
              ${can.llegar(r) ? '<span class="btn sm primary">Llegó</span>' : can.recibir(r) ? '<span class="btn sm primary">Controlar</span>' : esAdmin ? badgeAdmin(r) : badge(r.estado)}
            </a>`).join('') : '<div class="empty">No hay remitos en camino</div>'}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Actividad</h2><span class="live">En vivo</span></div>
          <div>${evs.length ? evs.map((e, i) => { const m = EVENTOS[e.tipo] || { l: e.tipo, c: 'gray', ico: '•' }; return `
            <a class="feed-item ${i === 0 && newest === e.remito_numero ? 'new' : ''}" href="#/remitos/${e.remito_id}" style="color:inherit">
              <div class="feed-dot b-${m.c}">${m.ico}</div>
              <div><div><b>${esc(evLabel(e))}</b> ${esc(m.l)}${e.detalle ? ` <span class="muted">· ${esc(e.detalle)}</span>` : ''}</div>
              <div class="small muted">${esc(e.usuario_nombre || '')} · <span data-ago="${e.created_at}">${hace(e.created_at)}</span></div></div>
            </a>`; }).join('') : '<div class="empty">Sin actividad todavía</div>'}
          </div>
        </section>
      </div>`;
  };
  await draw();
  S.refresh = draw;
  v.addEventListener('click', (e) => { if (e.target.id === 'ver-fact') { (S.remFilters ||= { desde: haceDias(30), hasta: hoy(), estado: '', origen: '', destino: '', area: '', q: '' }).estado = 'adm:facturacion'; } });
}

// ======================================================================
//  Listado de remitos
// ======================================================================
async function viewRemitos(v) {
  const f = fechasOk(S.remFilters || (S.remFilters = { desde: haceDias(30), hasta: hoy(), estado: '', origen: '', destino: '', area: '', q: '' }), haceDias(30), hoy());
  v.innerHTML = `
    <div class="page-head"><div><h1>Remitos</h1><p>Todo lo enviado de los obradores a los locales</p></div>
    <div class="btn-row">${can.crear() ? '<a class="btn primary" href="#/remitos/nuevo">+ Nuevo remito</a>' : ''}<button class="btn" id="csv">Exportar CSV</button></div></div>
    <div class="filters card card-pad">
      <label class="field"><span>Desde</span><input type="date" id="f-desde" value="${f.desde}"></label>
      <label class="field"><span>Hasta</span><input type="date" id="f-hasta" value="${f.hasta}"></label>
      <label class="field"><span>Estado</span><select id="f-estado"><option value="">Todos</option>${me.rol === 'admin'
        ? `<optgroup label="Circuito administrativo">${Object.entries(ESTADOS_ADMIN).map(([k, e]) => `<option value="adm:${k}" ${f.estado === 'adm:' + k ? 'selected' : ''}>${e.l}</option>`).join('')}</optgroup><optgroup label="Recepción">${['recibido', 'con_diferencias'].map((k) => `<option value="${k}" ${f.estado === k ? 'selected' : ''}>${ESTADOS[k].l}</option>`).join('')}<option value="dif:pend" ${f.estado === 'dif:pend' ? 'selected' : ''}>Diferencia pendiente de resolución</option></optgroup>`
        : Object.entries(ESTADOS).map(([k, e]) => `<option value="${k}" ${f.estado === k ? 'selected' : ''}>${e.l}</option>`).join('')}<option value="dif:pend" ${f.estado === 'dif:pend' ? 'selected' : ''}>Diferencia pendiente de resolución</option></select></label>
      ${me.rol !== 'obrador' ? `<label class="field"><span>Obrador</span><select id="f-origen"><option value="">Todos</option>${obradores().map((l) => `<option value="${l.id}" ${f.origen === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>` : ''}
      ${me.rol !== 'local' ? `<label class="field"><span>Local</span><select id="f-destino"><option value="">Todos</option>${locales().map((l) => `<option value="${l.id}" ${f.destino === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Área</span><select id="f-area"><option value="">Todas</option>${areas.map((a) => `<option value="${a.id}" ${f.area === a.id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></label>
      <label class="field"><span>N° remito</span><input id="f-q" value="${esc(f.q)}" placeholder="Ej: 0941" style="width:110px"></label>
    </div>
    <div class="card"><div class="table-wrap" id="tbl"></div></div>`;
  let rows = [];
  const draw = async () => {
    const all = await db.listRemitos({ desde: f.desde, hasta: f.hasta });
    const okEstado = (r) => !f.estado || (f.estado === 'dif:pend' ? difPendiente(r) : f.estado.startsWith('adm:') ? estadoAdmin(r) === f.estado.slice(4) : r.estado === f.estado);
    rows = all.filter((r) => okEstado(r) && (!f.origen || r.origen_id === f.origen) && (!f.destino || r.destino_id === f.destino) && (!f.area || r.area_id === f.area) && (!f.q || label(r).includes(f.q.trim()) || (r.nro_papel || '').includes(f.q.trim())));
    $('#tbl').innerHTML = rows.length ? `<table>
      <thead><tr><th>N°</th><th>Área</th><th>Creado</th><th>Obrador</th><th>Local</th><th class="num">Productos</th><th>Estado</th><th>Despachado</th><th>Recibido</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="click ${r.estado === 'con_diferencias' ? 'row-dif' : ''}" data-id="${r.id}">
        <td class="nowrap"><b>${label(r)}</b></td><td>${esc(area(r.area_id)?.nombre || '—')}</td><td>${fmtF(r.creado_at)}</td><td>${esc(locName(r.origen_id))}</td><td>${esc(locName(r.destino_id))}</td>
        <td class="num">${r.n_items}</td><td>${me.rol === 'admin' ? badgeAdmin(r) + (difPendiente(r) ? ' <span class="badge b-red">Dif. sin resolver</span>' : '') : r.estado === 'con_diferencias' ? badgeRecep(r) : badge(r.estado)}</td><td class="small">${fmtFH(r.despachado_at)}</td><td class="small">${fmtFH(r.recibido_at)}</td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No hay remitos con estos filtros</div>';
    $$('#tbl tr[data-id]').forEach((tr) => (tr.onclick = () => (location.hash = '#/remitos/' + tr.dataset.id)));
  };
  const bind = (id, key) => { const el = $(id); if (el) el.oninput = () => { if (el.type === 'date' && !okFecha(el.value)) return; f[key] = el.value; draw(); }; };
  bind('#f-desde', 'desde'); bind('#f-hasta', 'hasta'); bind('#f-estado', 'estado'); bind('#f-origen', 'origen'); bind('#f-destino', 'destino'); bind('#f-area', 'area'); bind('#f-q', 'q');
  $('#csv').onclick = () => downloadCSV('remitos.csv', [['N°', 'Área', 'Creado', 'Obrador', 'Local', 'Productos', 'Estado', 'Despachado', 'Recibido'],
    ...rows.map((r) => [label(r), area(r.area_id)?.nombre || '', fmtFH(r.creado_at), locName(r.origen_id), locName(r.destino_id), r.n_items, me.rol === 'admin' ? ESTADOS_ADMIN[estadoAdmin(r)].l + (r.estado === 'con_diferencias' ? (difPendiente(r) ? ' (diferencia sin resolver)' : ' (diferencia resuelta)') : '') : ESTADOS[r.estado]?.l, fmtFH(r.despachado_at), fmtFH(r.recibido_at)])]);
  await draw();
  S.refresh = draw;
}

// ======================================================================
//  Nuevo remito
// ======================================================================
async function viewNuevo(v) {
  if (!can.crear()) { v.innerHTML = '<div class="empty">No tenés permiso para crear remitos</div>'; return; }
  const activeAreas = areas.filter((a) => a.activo !== false);
  const previos = await db.listRemitos({ desde: haceDias(400) });
  const st = S.nuevo = {
    origen: me.rol === 'obrador' ? me.location_id : obradores()[0]?.id, destino: '', area: activeAreas[0]?.id || '',
    q: '', todas: false, qty: {}, extras: [], bultos: {},
  };
  v.innerHTML = `
    <div class="page-head"><div><h1>Nuevo remito</h1><p>Igual que el talonario en papel. Al despachar, el local lo ve al instante.</p></div></div>
    <div class="grid">
      <div class="card card-pad grid">
        <div class="field"><span>Área</span><div class="seg" id="areas">${activeAreas.map((a) => `<button type="button" data-a="${a.id}">${esc(a.nombre)} <span class="small">${esc(a.prefijo)}</span></button>`).join('')}</div></div>
        <div class="form-grid">
          <label class="field"><span>Obrador (origen)</span>${me.rol === 'obrador' ? `<input value="${esc(locName(me.location_id))}" disabled>` : `<select id="origen">${obradores().map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select>`}</label>
          <label class="field"><span>Destino (local)</span><select id="destino" required></select></label>
          <label class="field"><span>Entregado por</span><input id="entregado" placeholder="Quién lleva la mercadería"></label>
          <label class="field"><span>N° del remito en papel (talonario) *</span><div style="display:flex;gap:6px;align-items:center"><b id="pref" class="nowrap"></b><input id="papel" inputmode="numeric" required placeholder="Ej: 0941" style="flex:1;min-width:0"></div><span class="small muted" id="papel-hint"></span></label>
        </div>
        <div class="form-grid">
          ${BULTOS.map((b) => `<label class="field"><span>Bultos · ${b}</span><input class="qty" style="width:100%" type="number" min="0" inputmode="numeric" data-b="${b}" placeholder="0"></label>`).join('')}
          <label class="field" style="grid-column:span 1"><span>Observaciones</span><input id="obs" placeholder="Opcional"></label>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Productos</h2>
          <div class="btn-row" style="align-items:center"><label class="small"><input type="checkbox" id="todas"> Ver todas las áreas</label><input id="q" placeholder="Buscar producto…" style="width:190px"></div></div>
        <div class="table-wrap" id="plist"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Otros renglones</h2><div class="small muted">Cortesías, especial del mes o cualquier cosa que no esté en la lista</div></div>
          <button class="btn sm" id="add-extra">+ Agregar renglón</button></div>
        <div class="table-wrap" id="extras"></div>
      </div>
      <div class="card card-pad sticky-foot">
        <div id="resumen" class="muted">Sin productos cargados</div>
        <div class="btn-row"><button class="btn" id="borrador">Guardar borrador</button><button class="btn primary big" id="despachar">Despachar ahora 🚚</button></div>
      </div>
    </div>`;

  const drawDestinos = () => {
    const opts = localesDe(st.origen);
    if (!opts.some((l) => l.id === st.destino)) st.destino = '';
    $('#destino').innerHTML = `<option value="">${opts.length ? 'Elegí un local…' : 'Este obrador no tiene locales asignados'}</option>` +
      opts.map((l) => `<option value="${l.id}" ${l.id === st.destino ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('');
  };
  const drawAreas = () => {
    $$('#areas button').forEach((b) => b.classList.toggle('on', b.dataset.a === st.area));
    $('#pref').textContent = (area(st.area)?.prefijo || '0000') + ' -';
    const ult = Math.max(0, ...previos.filter((r) => r.origen_id === st.origen && r.area_id === st.area && r.estado !== 'anulado').map((r) => r.nro_area || 0));
    $('#papel-hint').textContent = ult ? `Último cargado: ${String(ult).padStart(4, '0')} · copiá el número impreso en el talonario` : 'Copiá el número impreso en el talonario';
  };
  const drawList = () => {
    const q = norm(st.q);
    const ar = area(st.area);
    const general = ar?.codigo === 'GEN';
    const list = prods.filter((p) => p.activo !== false
      && (!p.obrador_id || p.obrador_id === st.origen)
      && (st.todas || q || p.area_id === st.area || (general && p.seccion === 'materia_prima'))
      && (!q || norm(p.nombre).includes(q) || norm(p.codigo).includes(q)));
    const groups = Object.keys(SECCIONES).map((k) => [k, list.filter((p) => (p.seccion || 'terminado') === k)]).filter(([, l]) => l.length);
    $('#plist').innerHTML = list.length ? `<table><thead><tr><th>Descripción</th><th>Unidad</th>${st.todas || q || general ? '<th>Área</th>' : ''}<th class="num">Cantidad</th></tr></thead>
      ${groups.map(([k, l]) => `<tbody><tr class="sec"><td colspan="4">${SECCIONES[k]}</td></tr>
        ${l.map((p) => `<tr><td><b>${esc(p.nombre)}</b> <span class="muted small">${esc(p.codigo || '')}</span></td><td>${esc(p.unidad)}</td>${st.todas || q || general ? `<td class="small muted">${esc(area(p.area_id)?.nombre || '')}</td>` : ''}
        <td class="num"><input class="qty" inputmode="decimal" type="number" min="0" step="any" data-p="${p.id}" value="${st.qty[p.id] ?? ''}"></td></tr>`).join('')}</tbody>`).join('')}</table>`
      : `<div class="empty">No hay productos en esta área. ${general ? 'Usá "Otros renglones" para cargar insumos sueltos, o cargalos en Configuración → Productos.' : 'Cargalos en Configuración → Productos.'}</div>`;
    $$('#plist input[data-p]').forEach((i) => (i.oninput = () => { st.qty[i.dataset.p] = i.value; resumen(); }));
  };
  const drawExtras = () => {
    $('#extras').innerHTML = st.extras.length ? `<table><thead><tr><th>Descripción</th><th>Unidad</th><th>Tipo</th><th class="num">Cantidad</th><th></th></tr></thead><tbody>
      ${st.extras.map((x, i) => `<tr>
        <td><input data-x="${i}" data-f="descripcion" value="${esc(x.descripcion)}" placeholder="Ej: Lechuga, Panetone…" style="width:100%;min-width:160px"></td>
        <td><input data-x="${i}" data-f="unidad" value="${esc(x.unidad)}" placeholder="u, kg, jaula…" style="width:100px"></td>
        <td><select data-x="${i}" data-f="tipo"><option value="normal" ${x.tipo === 'normal' ? 'selected' : ''}>Normal / insumo</option><option value="cortesia" ${x.tipo === 'cortesia' ? 'selected' : ''}>Cortesía</option><option value="especial" ${x.tipo === 'especial' ? 'selected' : ''}>Especial del mes</option></select></td>
        <td class="num"><input class="qty" data-x="${i}" data-f="cantidad" type="number" min="0" step="any" inputmode="decimal" value="${esc(x.cantidad)}"></td>
        <td class="num"><button class="btn sm danger" data-del="${i}" aria-label="Quitar">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty small">Sin renglones extra</div>';
    $$('#extras [data-x]').forEach((el) => (el.oninput = () => { st.extras[el.dataset.x][el.dataset.f] = el.value; resumen(); }));
    $$('#extras [data-del]').forEach((b) => (b.onclick = () => { st.extras.splice(Number(b.dataset.del), 1); drawExtras(); resumen(); }));
  };
  const items = () => [
    ...Object.entries(st.qty).filter(([, q]) => Number(q) > 0).map(([product_id, cantidad]) => ({ product_id, cantidad: Number(cantidad) })),
    ...st.extras.filter((x) => x.descripcion.trim() && Number(x.cantidad) > 0).map((x) => ({ descripcion: x.descripcion.trim(), unidad: x.unidad.trim(), cantidad: Number(x.cantidad), cortesia: x.tipo === 'cortesia', especial: x.tipo === 'especial' })),
  ];
  const resumen = () => {
    const its = items();
    const val = its.reduce((s, i) => s + i.cantidad * (prod(i.product_id)?.precio_costo || 0), 0);
    $('#resumen').innerHTML = its.length ? `<b>${its.length}</b> renglones · valorizado a costo <b>${fmt$(val)}</b>` : 'Sin productos cargados';
  };
  $$('#areas button').forEach((b) => (b.onclick = () => { st.area = b.dataset.a; drawAreas(); drawList(); }));
  if ($('#origen')) $('#origen').onchange = (e) => { st.origen = e.target.value; drawDestinos(); drawAreas(); drawList(); };
  $('#destino').onchange = (e) => (st.destino = e.target.value);
  $('#q').oninput = (e) => { st.q = e.target.value; drawList(); };
  $('#todas').onchange = (e) => { st.todas = e.target.checked; drawList(); };
  $$('[data-b]').forEach((i) => (i.oninput = () => (st.bultos[i.dataset.b] = Number(i.value) || 0)));
  $('#add-extra').onclick = () => { st.extras.push({ descripcion: '', unidad: '', tipo: 'normal', cantidad: '' }); drawExtras(); $(`#extras [data-x="${st.extras.length - 1}"]`)?.focus(); };
  const guardar = async (despachar, btn) => {
    if (!st.destino) return toast('Elegí el local de destino', { err: true });
    const nro = parseInt($('#papel').value.replace(/\D/g, ''), 10);
    if (!(nro > 0)) { $('#papel').focus(); return toast('Cargá el N° del remito de papel (talonario)', { err: true }); }
    if (!items().length) return toast('Cargá al menos un producto', { err: true });
    btn.disabled = true;
    try {
      const id = await db.createRemito({
        origen_id: st.origen, destino_id: st.destino, area_id: st.area || null, observaciones: $('#obs').value,
        entregado_por: $('#entregado').value, nro_area: nro, bultos: st.bultos, items: items(), despachar,
      });
      toast(despachar ? 'Remito despachado. El local ya lo puede ver.' : 'Borrador guardado');
      location.hash = '#/remitos/' + id;
    } catch (e) { err(e); btn.disabled = false; }
  };
  $('#borrador').onclick = (e) => guardar(false, e.currentTarget);
  $('#despachar').onclick = (e) => guardar(true, e.currentTarget);
  drawAreas(); drawDestinos(); drawList(); drawExtras();
}

// ======================================================================
//  Detalle / recepción
// ======================================================================
async function viewDetalle(v, id) {
  let recibiendo = false;
  const KREC = 'recepcion_' + id;
  let rec = {};
  try { rec = JSON.parse(localStorage.getItem(KREC) || '{}'); } catch {}
  const guardarRec = () => { try { localStorage.setItem(KREC, JSON.stringify(rec)); } catch {} };
  const draw = async () => {
    const r = await db.getRemito(id);
    if (!r) { v.innerHTML = '<div class="empty">Remito no encontrado o sin permiso para verlo</div>'; return; }
    const user = (tipo) => r.eventos.filter((e) => e.tipo === tipo || (tipo === 'recibido' && e.tipo === 'con_diferencias')).pop();
    const ord = Object.keys(SECCIONES);
    const items = r.items.map((i) => ({ ...i, p: prod(i.product_id) || { nombre: i.descripcion || '(producto eliminado)', unidad: i.unidad || '', precio_costo: 0, seccion: 'zz' } }))
      .sort((a, b) => (a.cortesia - b.cortesia) || (a.especial - b.especial) || (ord.indexOf(a.p.seccion) - ord.indexOf(b.p.seccion)) || a.p.nombre.localeCompare(b.p.nombre));
    const bul = (o) => BULTOS.map((b) => `${o?.[b] || 0} ${b}`).join(' · ');
    const recibido = r.recibido_at != null;
    const totEnv = items.reduce((s, i) => s + i.cantidad_enviada, 0);
    const totRec = items.reduce((s, i) => s + (i.cantidad_recibida || 0), 0);
    const valDif = items.reduce((s, i) => s + ((i.cantidad_recibida ?? i.cantidad_enviada) - i.cantidad_enviada) * (i.p.precio_costo || 0), 0);
    const evC = user('creado'), evD = user('despachado'), evR = user('recibido'), evL = user('llegado'), evF = user('facturado');

    v.innerHTML = `
      <div class="page-head">
        <div><a class="small no-print" href="#/remitos">← Remitos</a>
          <h1 style="margin-top:6px">Remito ${label(r)} ${me.rol === 'admin' ? badgeAdmin(r) + ' ' + badgeRecep(r) : r.estado === 'con_diferencias' ? badgeRecep(r) : badge(r.estado)}</h1>
          <p class="route"><b>${esc(locName(r.origen_id))}</b><span class="arrow">→</span><b>${esc(locName(r.destino_id))}</b></p></div>
        <div class="btn-row no-print">
          ${can.despachar(r) ? '<button class="btn primary" id="b-desp">Despachar 🚚</button>' : ''}
          ${can.llegar(r) ? '<button class="btn primary big" id="b-lleg">📦 Llegó al local</button>' : ''}
          ${can.recibir(r) && !recibiendo ? `<button class="btn ${r.llegado_at ? 'primary big' : ''}" id="b-rec">Controlar recepción</button>` : ''}
          ${can.facturar(r) ? '<button class="btn primary big" id="b-fact">Marcar como cargado en facturación</button>' : ''}
          ${can.resolver(r) ? '<button class="btn primary" id="b-resol">Resolver diferencia</button>' : ''}
          <button class="btn" onclick="window.print()">Imprimir</button>
          ${can.anular(r) ? '<button class="btn danger" id="b-anul">Anular</button>' : ''}
        </div>
      </div>
      <div class="print-only" style="margin-bottom:12px"><b>${esc(cfg.EMPRESA || '')}</b> · Remito N° ${label(r)} · Área ${esc(area(r.area_id)?.nombre || '')} · Fecha ${fmtFH(r.despachado_at || r.creado_at)}</div>
      <div class="meta card card-pad">
        <div><span>Área</span><b>${esc(area(r.area_id)?.nombre || '—')}</b></div>
        <div><span>Entregado por</span><b>${esc(r.entregado_por || '—')}</b></div>
        <div><span>Bultos enviados</span><b>${bul(r.bultos)}</b></div>
        ${r.bultos_recibidos ? `<div><span>Bultos recibidos</span><b style="color:${BULTOS.some((b) => (r.bultos?.[b] || 0) !== (r.bultos_recibidos?.[b] || 0)) ? 'var(--red)' : ''}">${bul(r.bultos_recibidos)}</b></div>` : ''}
        ${r.despachado_at ? `<div><span>Fecha de envío</span><b>${fmtFH(r.despachado_at)}</b></div>` : ''}
        ${me.rol === 'admin' && r.facturado_at ? `<div><span>Facturado</span><b>${fmtFH(r.facturado_at)}${r.nro_factura ? ' · ' + esc(r.nro_factura) : ''}</b></div>` : ''}
      </div>
      ${r.estado === 'anulado' ? `<div class="callout">Remito anulado: ${esc(r.anulado_motivo || 'sin motivo')}</div>` : ''}
      <div class="steps" style="margin-bottom:16px">
        <div class="step done"><div class="t">1 · Creado</div><div class="d">${fmtFH(r.creado_at)} · ${esc(evC?.usuario_nombre || '')}</div></div>
        <div class="step ${r.despachado_at ? 'done' : ''}"><div class="t">2 · Despachado</div><div class="d">${r.despachado_at ? `${fmtFH(r.despachado_at)} · ${esc(evD?.usuario_nombre || '')}` : 'Pendiente'}</div></div>
        <div class="step ${r.llegado_at ? 'done' : ''}"><div class="t">3 · Llegó al local</div><div class="d">${r.llegado_at ? `${fmtFH(r.llegado_at)}${evL?.usuario_nombre ? ' · ' + esc(evL.usuario_nombre) : ''}` : r.despachado_at && r.estado !== 'anulado' ? `En camino · <span data-ago="${r.despachado_at}">${hace(r.despachado_at)}</span>` : 'Pendiente'}</div></div>
        <div class="step ${recibido ? (r.estado === 'con_diferencias' ? 'dif' : 'done') : ''}"><div class="t">4 · Controlado por el local</div><div class="d">${recibido ? `${fmtFH(r.recibido_at)} · ${esc(evR?.usuario_nombre || '')}` : r.llegado_at ? 'Pendiente de revisión' : 'Pendiente'}</div></div>
        ${me.rol === 'admin' ? `<div class="step ${r.facturado_at ? 'done' : ''}"><div class="t">5 · Facturado</div><div class="d">${r.facturado_at ? `${fmtFH(r.facturado_at)} · ${esc(evF?.usuario_nombre || '')}` : recibido ? 'Pendiente de facturación' : 'Pendiente'}</div></div>
        <div class="step ${estadoAdmin(r) === 'cerrado' ? 'done' : ''}"><div class="t">6 · Cerrado</div><div class="d">${estadoAdmin(r) === 'cerrado' ? 'Facturado y sin diferencias pendientes' : difPendiente(r) ? 'Falta resolver la diferencia' : 'Pendiente'}</div></div>` : ''}
      </div>
      ${r.estado === 'con_diferencias' ? (r.dif_resuelta_at
        ? `<div class="callout info"><span><b>Diferencia resuelta por Producción</b> · ${esc(DIF_TIPOS[r.dif_tipo] || r.dif_tipo || '')}${r.dif_resolucion ? ' · ' + esc(r.dif_resolucion) : ''} · ${fmtFH(r.dif_resuelta_at)}</span></div>`
        : `<div class="callout"><span><b>Diferencia pendiente de resolución.</b> ${me.rol === 'local' ? 'Producción ya fue avisada.' : 'Se factura lo recibido; Producción tiene que indicar el motivo (merma, error de carga, faltante en el traslado…).'}</span></div>`) : ''}
      ${r.observaciones ? `<p><b>Observaciones del obrador:</b> ${esc(r.observaciones)}</p>` : ''}
      ${r.obs_recepcion ? `<p><b>Observaciones de recepción:</b> ${esc(r.obs_recepcion)}</p>` : ''}
      ${recibiendo ? `<div class="callout info no-print"><span>Controlá producto por producto: cargá la cantidad que llegó y tildá ✓ cuando lo hayas contado. Si algo no coincide, se marca en rojo. <b id="prog"></b></span><button class="btn" id="b-all">Cargar cantidades enviadas</button></div>` : ''}
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>${recibiendo ? '<th>✓</th>' : ''}<th>Producto</th><th>Unidad</th><th class="num">Enviado</th><th class="num">Recibido</th><th class="num">Diferencia</th><th>Observación</th></tr></thead>
          <tbody>${items.map((i) => {
            const d = i.cantidad_recibida == null ? null : i.cantidad_recibida - i.cantidad_enviada;
            return `<tr class="${d ? 'row-dif' : ''}" data-row="${i.id}">${recibiendo ? `<td><input type="checkbox" class="ck" data-ck="${i.id}" ${rec[i.id]?.ok ? 'checked' : ''} aria-label="Controlado"></td>` : ''}<td><b>${esc(i.p.nombre)}</b> <span class="muted small">${esc(i.p.codigo || '')}</span>${i.cortesia ? ' <span class="badge b-blue">Cortesía</span>' : ''}${i.especial ? ' <span class="badge b-amber">Especial del mes</span>' : ''}${!i.product_id ? ' <span class="badge b-gray">Ítem libre</span>' : ''}</td><td>${esc(i.p.unidad)}</td>
              <td class="num">${fmtQ(i.cantidad_enviada)}</td>
              ${recibiendo
                ? `<td class="num"><input class="qty" type="number" inputmode="decimal" min="0" step="any" data-i="${i.id}" data-env="${i.cantidad_enviada}" value="${rec[i.id]?.cantidad_recibida ?? ''}"></td><td class="num" data-d="${i.id}">—</td><td><input data-o="${i.id}" placeholder="Ej: 2 rotos" value="${esc(rec[i.id]?.obs || '')}" style="width:100%;min-width:120px"></td>`
                : `<td class="num">${fmtQ(i.cantidad_recibida)}</td><td class="num" style="color:${d ? 'var(--red)' : ''}">${d == null ? '—' : d === 0 ? '✓' : (d > 0 ? '+' : '') + fmtQ(d)}</td><td class="small">${esc(i.obs || '')}</td>`}
            </tr>`; }).join('')}</tbody>
          <tfoot><tr><td colspan="${recibiendo ? 3 : 2}">Total</td><td class="num">${fmtQ(totEnv)}</td><td class="num">${recibido ? fmtQ(totRec) : ''}</td><td class="num">${recibido ? (valDif ? fmt$(valDif) + ' a costo' : '✓') : ''}</td><td></td></tr></tfoot>
        </table></div>
      </div>
      ${recibiendo ? `<div class="card card-pad grid no-print" style="margin-top:16px">
          <div class="form-grid">${BULTOS.map((b) => `<label class="field"><span>Bultos recibidos · ${b} (enviados: ${r.bultos?.[b] || 0})</span><input class="qty" style="width:100%" type="number" min="0" inputmode="numeric" data-rb="${b}" value="${rec._bultos?.[b] ?? (r.bultos?.[b] || 0)}"></label>`).join('')}</div>
          <label class="field"><span>Observaciones de recepción</span><textarea id="obs-rec" placeholder="Opcional">${esc(rec._obs || '')}</textarea></label>
          <div class="btn-row" style="justify-content:flex-end"><button class="btn" id="b-cancel">Cancelar</button><button class="btn primary big" id="b-conf">Confirmar recepción</button></div>
        </div>` : ''}
      <div class="print-only signs"><div>Firma y aclaración · entrega (obrador)</div><div>Firma y aclaración · recepción (local)</div></div>
      <section class="card no-print" style="margin-top:16px"><div class="card-head"><h2>Historial</h2></div>
        <div>${r.eventos.map((e) => { const m = EVENTOS[e.tipo] || { l: e.tipo, c: 'gray', ico: '•' }; return `<div class="feed-item"><div class="feed-dot b-${m.c}">${m.ico}</div><div><div>${esc(m.l)}${e.detalle ? ` <span class="muted">· ${esc(e.detalle)}</span>` : ''}</div><div class="small muted">${esc(e.usuario_nombre || '')} · ${fmtFH(e.created_at)}</div></div></div>`; }).join('')}</div>
      </section>`;

    $('#b-desp') && ($('#b-desp').onclick = async () => { try { await db.despacharRemito(r.id); toast('Remito despachado'); draw(); } catch (e) { err(e); } });
    $('#b-anul') && ($('#b-anul').onclick = async () => {
      const res = await modalForm({ title: `Anular remito ${label(r)}`, fields: [{ name: 'motivo', label: 'Motivo', type: 'textarea', required: true }], submit: 'Anular' });
      if (!res) return;
      try { await db.anularRemito(r.id, res.motivo); toast('Remito anulado'); draw(); } catch (e) { err(e); }
    });
    $('#b-rec') && ($('#b-rec').onclick = () => { recibiendo = true; S.refresh = null; draw(); });
    $('#b-lleg') && ($('#b-lleg').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await db.marcarLlegado(r.id); toast('Llegada registrada. Ahora controlá lo que llegó.'); recibiendo = true; S.refresh = null; draw(); } catch (ex) { err(ex); e.currentTarget.disabled = false; }
    });
    $('#b-resol') && ($('#b-resol').onclick = async () => {
      const res = await modalForm({ title: `Resolver diferencia · remito ${label(r)}`, submit: 'Marcar como resuelta',
        html: `<p class="muted" style="margin:0">Indicá por qué no coincide lo enviado con lo recibido. Queda registrado en el historial y en el panel de Diferencias.</p>`,
        fields: [{ name: 'tipo', label: 'Motivo', type: 'select', required: true, options: Object.entries(DIF_TIPOS).map(([value, label]) => ({ value, label })) },
          { name: 'obs', label: 'Comentario (opcional)', type: 'textarea' }] });
      if (!res) return;
      try { await db.resolverDiferencia(r.id, res.tipo, res.obs || ''); toast('Diferencia resuelta'); draw(); } catch (e) { err(e); }
    });
    $('#b-fact') && ($('#b-fact').onclick = async () => {
      const res = await modalForm({ title: `Remito ${label(r)} · cargado en facturación`, submit: 'Marcar como facturado',
        html: `<p class="muted" style="margin:0">Confirmá que cargaste en facturación lo que el local controló${r.estado === 'con_diferencias' ? ' (este remito tiene diferencias: facturá lo recibido, no lo enviado)' : ''}.</p>`,
        fields: [{ name: 'nro', label: 'N° de factura (opcional)' }] });
      if (!res) return;
      try { await db.marcarFacturado(r.id, res.nro || ''); toast('Remito marcado como facturado'); draw(); } catch (e) { err(e); }
    });
    if (recibiendo) {
      const prog = () => {
        const n = items.filter((i) => rec[i.id]?.ok).length;
        $('#prog').textContent = `${n} de ${items.length} productos controlados`;
        $$('tr[data-row]').forEach((tr) => tr.classList.toggle('row-ok', !!rec[tr.dataset.row]?.ok));
      };
      const upd = (inp) => {
        const env = Number(inp.dataset.env), val = inp.value;
        rec[inp.dataset.i] = { ...(rec[inp.dataset.i] || {}), cantidad_recibida: val };
        guardarRec();
        const cell = $(`[data-d="${inp.dataset.i}"]`);
        inp.classList.remove('dif', 'okv');
        if (val === '') { cell.textContent = '—'; cell.style.color = ''; return; }
        const d = Number(val) - env;
        inp.classList.add(d ? 'dif' : 'okv');
        cell.textContent = d === 0 ? '✓' : (d > 0 ? '+' : '') + fmtQ(d);
        cell.style.color = d ? 'var(--red)' : 'var(--green)';
      };
      $$('input[data-i]').forEach((inp) => { inp.oninput = () => upd(inp); upd(inp); });
      $$('input[data-ck]').forEach((ck) => (ck.onchange = () => {
        const inp = $(`input[data-i="${ck.dataset.ck}"]`);
        // tildar sin cantidad = llegó igual a lo enviado
        if (ck.checked && inp.value === '') { inp.value = inp.dataset.env; upd(inp); }
        rec[ck.dataset.ck] = { ...(rec[ck.dataset.ck] || {}), ok: ck.checked };
        guardarRec(); prog();
      }));
      $$('input[data-o]').forEach((inp) => (inp.oninput = () => { rec[inp.dataset.o] = { ...(rec[inp.dataset.o] || {}), obs: inp.value }; guardarRec(); }));
      $('#obs-rec').oninput = (e) => { rec._obs = e.target.value; guardarRec(); };
      rec._bultos = rec._bultos || BULTOS.reduce((o, b) => ({ ...o, [b]: r.bultos?.[b] || 0 }), {});
      $$('[data-rb]').forEach((i) => (i.oninput = () => { rec._bultos[i.dataset.rb] = Number(i.value) || 0; guardarRec(); }));
      $('#b-all').onclick = () => $$('input[data-i]').forEach((inp) => { if (inp.value === '') { inp.value = inp.dataset.env; upd(inp); } });
      $('#b-cancel').onclick = () => { recibiendo = false; S.refresh = draw; draw(); };
      prog();
      $('#b-conf').onclick = async (e) => {
        const payload = items.map((i) => ({ id: i.id, cantidad_recibida: rec[i.id]?.cantidad_recibida ?? '', obs: rec[i.id]?.obs || '' }));
        const falt = payload.filter((p) => p.cantidad_recibida === '').length;
        if (falt) return toast(`Faltan cargar ${falt} producto${falt > 1 ? 's' : ''}`, { err: true });
        const sinCk = items.filter((i) => !rec[i.id]?.ok).length;
        if (sinCk) return toast(`Faltan tildar ${sinCk} producto${sinCk > 1 ? 's' : ''} como controlado${sinCk > 1 ? 's' : ''} ✓`, { err: true });
        const difs = payload.filter((p) => Number(p.cantidad_recibida) !== items.find((i) => i.id === p.id).cantidad_enviada).length;
        if (difs && !confirm(`Hay ${difs} producto${difs > 1 ? 's' : ''} con diferencia. ¿Confirmar la recepción igual?`)) return;
        e.currentTarget.disabled = true;
        try {
          const estado = await db.recibirRemito(r.id, payload, rec._obs || '', rec._bultos);
          toast(estado === 'recibido' ? 'Recepción confirmada: todo OK ✓' : 'Recepción confirmada con diferencias');
          try { localStorage.removeItem(KREC); } catch {}
          rec = {};
          recibiendo = false; S.refresh = draw; draw();
        } catch (ex) { err(ex); e.currentTarget.disabled = false; }
      };
    }
  };
  await draw();
  S.refresh = () => { if (!recibiendo) draw(); };
}

// ======================================================================
//  Diferencias: lo que Producción tiene que resolver
// ======================================================================
async function viewDiferencias(v) {
  const f = fechasOk(S.difFilters || (S.difFilters = { desde: haceDias(30), hasta: hoy(), estado: 'pend', origen: '', destino: '', area: '', q: '' }), haceDias(30), hoy());
  v.innerHTML = `
    <div class="page-head"><div><h1>Diferencias</h1><p>Productos donde lo recibido no coincide con lo enviado. Se factura lo recibido; Producción indica el motivo y la cierra.</p></div>
    <div class="btn-row"><button class="btn" id="csv">Exportar CSV</button></div></div>
    <div class="filters card card-pad">
      <label class="field"><span>Recibido desde</span><input type="date" id="f-desde" value="${f.desde}"></label>
      <label class="field"><span>Hasta</span><input type="date" id="f-hasta" value="${f.hasta}"></label>
      <label class="field"><span>Estado</span><select id="f-estado"><option value="pend" ${f.estado === 'pend' ? 'selected' : ''}>Pendientes de resolución</option><option value="res" ${f.estado === 'res' ? 'selected' : ''}>Resueltas</option><option value="" ${f.estado === '' ? 'selected' : ''}>Todas</option></select></label>
      ${me.rol === 'admin' ? `<label class="field"><span>Obrador</span><select id="f-origen"><option value="">Todos</option>${obradores().map((l) => `<option value="${l.id}" ${f.origen === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Sucursal</span><select id="f-destino"><option value="">Todas</option>${locales().map((l) => `<option value="${l.id}" ${f.destino === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>
      <label class="field"><span>Área</span><select id="f-area"><option value="">Todas</option>${areas.map((a) => `<option value="${a.id}" ${f.area === a.id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></label>
      <label class="field"><span>Producto</span><input id="f-q" value="${esc(f.q)}" placeholder="Buscar…" style="width:150px"></label>
    </div>
    <div class="kpis" id="dk"></div>
    <div class="card"><div class="table-wrap" id="tbl"></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Por motivo (resueltas)</h2></div><div class="table-wrap" id="mot"></div></div>`;
  let rows = [];
  const draw = async () => {
    const all = await db.listDiferencias(f.desde, f.hasta);
    rows = all.map((i) => ({ ...i, nombre: itemNombre(i), unidad: itemUnidad(i), dif: Number(i.cantidad_recibida) - Number(i.cantidad_enviada), costo: prod(i.product_id)?.precio_costo || 0 }))
      .filter((i) => (f.estado === '' || (f.estado === 'pend' ? !i.remito.dif_resuelta_at : !!i.remito.dif_resuelta_at))
        && (!f.origen || i.remito.origen_id === f.origen) && (!f.destino || i.remito.destino_id === f.destino)
        && (!f.area || i.remito.area_id === f.area) && (!f.q || norm(i.nombre).includes(norm(f.q))))
      .sort((a, b) => (b.remito.recibido_at || '').localeCompare(a.remito.recibido_at || ''));
    const remIds = new Set(rows.map((i) => i.remito.id));
    const pend = new Set(rows.filter((i) => !i.remito.dif_resuelta_at).map((i) => i.remito.id));
    const falt = rows.filter((i) => i.dif < 0).reduce((s, i) => s - i.dif * i.costo, 0);
    const sobr = rows.filter((i) => i.dif > 0).reduce((s, i) => s + i.dif * i.costo, 0);
    $('#dk').innerHTML = `
      <div class="card kpi ${pend.size ? 'alert' : ''}"><div class="label">Remitos sin resolver</div><div class="value">${pend.size}</div><div class="sub">de ${remIds.size} con diferencias</div></div>
      <div class="card kpi"><div class="label">Renglones con diferencia</div><div class="value">${rows.length}</div><div class="sub">&nbsp;</div></div>
      <div class="card kpi alert"><div class="label">Faltantes a costo</div><div class="value">${fmt$(falt)}</div><div class="sub">llegó menos de lo enviado</div></div>
      <div class="card kpi"><div class="label">Sobrantes a costo</div><div class="value">${fmt$(sobr)}</div><div class="sub">llegó más de lo enviado</div></div>`;
    $('#tbl').innerHTML = rows.length ? `<table>
      <thead><tr><th>Remito</th><th>Recibido</th><th>Sucursal</th><th>Área</th><th>Producto</th><th class="num">Enviado</th><th class="num">Recibido</th><th class="num">Dif.</th><th>Obs. del local</th><th>Estado</th></tr></thead>
      <tbody>${rows.map((i) => `<tr class="click" data-id="${i.remito.id}">
        <td class="nowrap"><b>${label(i.remito)}</b></td><td class="small">${fmtFH(i.remito.recibido_at)}</td><td>${esc(locName(i.remito.destino_id))}</td><td>${esc(area(i.remito.area_id)?.nombre || '—')}</td>
        <td><b>${esc(i.nombre)}</b> <span class="muted small">${esc(i.unidad)}</span></td><td class="num">${fmtQ(i.cantidad_enviada)}</td><td class="num">${fmtQ(i.cantidad_recibida)}</td>
        <td class="num" style="color:var(--red)">${i.dif > 0 ? '+' : ''}${fmtQ(i.dif)}</td><td class="small">${esc(i.obs || '')}</td>
        <td>${i.remito.dif_resuelta_at ? `<span class="badge b-gray">${esc(DIF_TIPOS[i.remito.dif_tipo] || i.remito.dif_tipo)}</span>` : can.resolver({ ...i.remito }) ? `<button class="btn sm primary" data-res="${i.remito.id}">Resolver</button>` : '<span class="badge b-red">Pendiente</span>'}</td></tr>`).join('')}</tbody>
      </table>` : `<div class="empty">${f.estado === 'pend' ? 'No hay diferencias pendientes 👌' : 'No hay diferencias con estos filtros'}</div>`;
    const porMot = {};
    rows.filter((i) => i.remito.dif_resuelta_at).forEach((i) => { const m = (porMot[i.remito.dif_tipo] ||= { rem: new Set(), val: 0 }); m.rem.add(i.remito.id); m.val += i.dif * i.costo; });
    $('#mot').innerHTML = Object.keys(porMot).length ? `<table><thead><tr><th>Motivo</th><th class="num">Remitos</th><th class="num">Valor a costo</th></tr></thead><tbody>
      ${Object.entries(porMot).map(([k, m]) => `<tr><td>${esc(DIF_TIPOS[k] || k)}</td><td class="num">${m.rem.size}</td><td class="num">${fmt$(m.val)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty small">Sin diferencias resueltas en este período (elegí Estado: Resueltas o Todas)</div>';
    $$('#tbl tr[data-id]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('[data-res]')) location.hash = '#/remitos/' + tr.dataset.id; }));
    $$('#tbl [data-res]').forEach((b) => (b.onclick = async () => {
      const res = await modalForm({ title: 'Resolver diferencia', submit: 'Marcar como resuelta',
        fields: [{ name: 'tipo', label: 'Motivo', type: 'select', required: true, options: Object.entries(DIF_TIPOS).map(([value, label]) => ({ value, label })) },
          { name: 'obs', label: 'Comentario (opcional)', type: 'textarea' }] });
      if (!res) return;
      try { await db.resolverDiferencia(b.dataset.res, res.tipo, res.obs || ''); toast('Diferencia resuelta'); draw(); } catch (e) { err(e); }
    }));
  };
  const bind = (id, key) => { const el = $(id); if (el) el.oninput = () => { if (el.type === 'date' && !okFecha(el.value)) return; f[key] = el.value; draw(); }; };
  bind('#f-desde', 'desde'); bind('#f-hasta', 'hasta'); bind('#f-estado', 'estado'); bind('#f-origen', 'origen'); bind('#f-destino', 'destino'); bind('#f-area', 'area'); bind('#f-q', 'q');
  $('#csv').onclick = () => downloadCSV('diferencias.csv', [['Remito', 'Recibido', 'Obrador', 'Sucursal', 'Área', 'Producto', 'Unidad', 'Enviado', 'Recibido', 'Diferencia', 'Valor a costo', 'Obs. local', 'Estado', 'Motivo', 'Comentario Producción'],
    ...rows.map((i) => [label(i.remito), fmtFH(i.remito.recibido_at), locName(i.remito.origen_id), locName(i.remito.destino_id), area(i.remito.area_id)?.nombre || '', i.nombre, i.unidad, i.cantidad_enviada, i.cantidad_recibida, i.dif, Math.round(i.dif * i.costo), i.obs || '',
      i.remito.dif_resuelta_at ? 'Resuelta' : 'Pendiente', DIF_TIPOS[i.remito.dif_tipo] || i.remito.dif_tipo || '', i.remito.dif_resolucion || ''])]);
  await draw();
  S.refresh = draw;
}

// ======================================================================
//  Reportes (Etapa 2)
// ======================================================================
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesDe = (iso) => dia(iso).slice(0, 7);
const mesLabel = (m) => MESES[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const inicioMes = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return dia(d); };
// Cantidad que cuenta: lo recibido si ya se controló, si no lo enviado
const cantReal = (i) => Number(i.cantidad_recibida ?? i.cantidad_enviada) || 0;
const esFranq = (locId) => !!locs.find((l) => l.id === locId)?.es_franquicia;
const groupBy = (arr, key) => arr.reduce((m, x) => { const k = key(x); (m[k] ||= []).push(x); return m; }, {});
const barra = (v, max, cls = '') => `<div class="bar ${cls}"><i style="width:${max ? Math.max(2, Math.round((v / max) * 100)) : 0}%"></i></div>`;

function downloadXLSX(name, sheets) {
  if (!window.XLSX) return toast('La librería de Excel no cargó todavía, probá de nuevo', { err: true });
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([n, rows]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = (rows[0] || []).map((_, c) => ({ wch: Math.min(40, Math.max(8, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31));
  });
  XLSX.writeFile(wb, name);
}

// Lee los renglones despachados del período y les agrega producto, costo y precio de franquicia
async function cargarRenglones(f) {
  const its = await db.listItemsDespachados(f.desde, f.hasta);
  return its.filter((i) => i.estado !== 'anulado'
    && (!f.origen || i.origen_id === f.origen) && (!f.destino || i.destino_id === f.destino) && (!f.area || i.area_id === f.area)
    && (!f.tipo || (f.tipo === 'franq') === esFranq(i.destino_id)))
    .map((i) => {
      const p = prod(i.product_id);
      const env = Number(i.cantidad_enviada) || 0, real = cantReal(i);
      return { ...i, nombre: itemNombre(i), unidad: itemUnidad(i), env, real, costo: p?.precio_costo || 0, pf: i.cortesia ? 0 : p?.precio_franquicia || 0,
        dif: i.cantidad_recibida == null ? 0 : Number(i.cantidad_recibida) - env, mes: mesDe(i.remito?.despachado_at || i.created_at || new Date().toISOString()) };
    });
}

async function viewReportes(v) {
  const f = fechasOk(S.repFilters || (S.repFilters = { desde: inicioMes(2), hasta: hoy(), origen: '', destino: '', area: '', tipo: '', orden: 'cant' }), inicioMes(2), hoy());
  v.innerHTML = `
    <div class="page-head"><div><h1>Reportes</h1><p>Lo enviado a cada sucursal: ranking de productos, volumen por mes, diferencias y facturación</p></div>
    <div class="btn-row"><button class="btn primary" id="xlsx">Exportar a Excel</button></div></div>
    <div class="filters card card-pad">
      <label class="field"><span>Desde</span><input type="date" id="f-desde" value="${f.desde}"></label>
      <label class="field"><span>Hasta</span><input type="date" id="f-hasta" value="${f.hasta}"></label>
      ${me.rol === 'admin' ? `<label class="field"><span>Obrador</span><select id="f-origen"><option value="">Todos</option>${obradores().map((l) => `<option value="${l.id}" ${f.origen === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Sucursal / cliente</span><select id="f-destino"><option value="">Todas</option>${locales().map((l) => `<option value="${l.id}" ${f.destino === l.id ? 'selected' : ''}>${esc(l.nombre)}${l.es_franquicia ? ' (franquicia)' : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Tipo</span><select id="f-tipo"><option value="">Propios y franquicias</option><option value="prop" ${f.tipo === 'prop' ? 'selected' : ''}>Solo locales propios</option><option value="franq" ${f.tipo === 'franq' ? 'selected' : ''}>Solo franquicias</option></select></label>
      <label class="field"><span>Área</span><select id="f-area"><option value="">Todas</option>${areas.map((a) => `<option value="${a.id}" ${f.area === a.id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></label>
    </div>
    <div id="rep"><div class="empty">Cargando…</div></div>`;
  let R = null;
  const draw = async () => {
    const rows = await cargarRenglones(f);
    const rems = Object.values(groupBy(rows, (i) => i.remito_id)).map((l) => ({ ...l[0].remito, lineas: l, costo: l.reduce((s, i) => s + i.real * i.costo, 0), pf: l.reduce((s, i) => s + i.real * i.pf, 0) }));
    const totCosto = rows.reduce((s, i) => s + i.env * i.costo, 0);
    const difVal = rows.reduce((s, i) => s + i.dif * i.costo, 0);
    // Top productos
    const porProd = Object.values(groupBy(rows.filter((i) => !i.cortesia), (i) => i.product_id || 'x:' + norm(i.nombre))).map((l) => ({
      nombre: l[0].nombre, unidad: l[0].unidad, area: area(prod(l[0].product_id)?.area_id || l[0].area_id)?.nombre || '', env: l.reduce((s, i) => s + i.env, 0), real: l.reduce((s, i) => s + i.real, 0),
      val: l.reduce((s, i) => s + i.env * i.costo, 0), suc: new Set(l.map((i) => i.destino_id)).size,
    })).sort((a, b) => (f.orden === 'val' ? b.val - a.val : b.env - a.env));
    // Por sucursal
    const porSuc = Object.entries(groupBy(rows, (i) => i.destino_id)).map(([id, l]) => ({
      id, nombre: locName(id), franq: esFranq(id), rem: new Set(l.map((i) => i.remito_id)).size, lin: l.length, env: l.reduce((s, i) => s + i.env, 0),
      costo: l.reduce((s, i) => s + i.env * i.costo, 0), pf: l.reduce((s, i) => s + i.real * i.pf, 0), dif: l.reduce((s, i) => s + i.dif * i.costo, 0),
    })).sort((a, b) => b.costo - a.costo);
    // Por mes (y mes × sucursal)
    const meses = [...new Set(rows.map((i) => i.mes))].sort();
    const porMes = meses.map((m) => { const l = rows.filter((i) => i.mes === m); return { m, rem: new Set(l.map((i) => i.remito_id)).size, env: l.reduce((s, i) => s + i.env, 0), costo: l.reduce((s, i) => s + i.env * i.costo, 0), dif: l.reduce((s, i) => s + i.dif * i.costo, 0) }; });
    const mesSuc = porSuc.map((s) => ({ ...s, m: meses.map((m) => rows.filter((i) => i.mes === m && i.destino_id === s.id).reduce((t, i) => t + i.env * i.costo, 0)) }));
    // Por área
    const porArea = Object.entries(groupBy(rows, (i) => i.area_id || '')).map(([id, l]) => ({ nombre: area(id)?.nombre || 'Sin área', rem: new Set(l.map((i) => i.remito_id)).size, costo: l.reduce((s, i) => s + i.env * i.costo, 0) })).sort((a, b) => b.costo - a.costo);
    // Diferencias / mermas por motivo
    const difs = rows.filter((i) => i.dif);
    const porMot = Object.entries(groupBy(difs, (i) => (i.remito.dif_resuelta_at ? i.remito.dif_tipo : '_pend'))).map(([k, l]) => ({ k, nombre: k === '_pend' ? 'Sin resolver' : DIF_TIPOS[k] || k, rem: new Set(l.map((i) => i.remito_id)).size, lin: l.length, val: l.reduce((s, i) => s + i.dif * i.costo, 0) })).sort((a, b) => a.val - b.val);
    // Facturación
    const fact = rems.filter((r) => r.facturado_at).sort((a, b) => b.facturado_at.localeCompare(a.facturado_at));
    const pendFact = rems.filter((r) => ['recibido', 'con_diferencias'].includes(r.estado) && !r.facturado_at);
    R = { rows, porProd, porSuc, porMes, mesSuc, meses, porArea, porMot, difs, fact, pendFact };

    const maxP = Math.max(0, ...porProd.slice(0, 10).map((p) => (f.orden === 'val' ? p.val : p.env)));
    const maxS = Math.max(0, ...porSuc.map((s) => s.costo));
    const maxM = Math.max(0, ...porMes.map((m) => m.costo));
    const verFranq = me.rol === 'admin';
    $('#rep').innerHTML = !rows.length ? '<div class="empty">No hay remitos despachados con estos filtros</div>' : `
      <div class="kpis">
        <div class="card kpi"><div class="label">Remitos</div><div class="value">${fmtN(rems.length)}</div><div class="sub">${fmtN(rows.length)} renglones</div></div>
        <div class="card kpi"><div class="label">Enviado a costo</div><div class="value">${fmt$(totCosto)}</div><div class="sub">${porSuc.length} sucursales</div></div>
        <div class="card kpi ${difVal < 0 ? 'alert' : ''}"><div class="label">Diferencias a costo</div><div class="value">${fmt$(difVal)}</div><div class="sub">${R.difs.length} renglones con diferencia</div></div>
        ${verFranq ? `<div class="card kpi ${pendFact.length ? 'warn' : 'ok'}"><div class="label">Facturación</div><div class="value">${fact.length}</div><div class="sub">facturados · ${pendFact.length} pendientes</div></div>` : ''}
      </div>
      <div class="grid cols-2">
        <section class="card"><div class="card-head"><h2>Top 10 productos</h2>
          <div class="seg" id="orden"><button type="button" data-o="cant" class="${f.orden !== 'val' ? 'on' : ''}">Por cantidad</button><button type="button" data-o="val" class="${f.orden === 'val' ? 'on' : ''}">Por valor</button></div></div>
          <div class="table-wrap"><table><thead><tr><th>#</th><th>Producto</th><th class="num">Enviado</th><th class="num">A costo</th><th></th></tr></thead><tbody>
          ${porProd.slice(0, 10).map((p, i) => `<tr><td class="muted">${i + 1}</td><td><b>${esc(p.nombre)}</b> <span class="small muted">${esc(p.area)} · ${p.suc} suc.</span></td><td class="num nowrap">${fmtQ(p.env)} ${esc(p.unidad)}</td><td class="num">${fmt$(p.val)}</td><td style="width:90px">${barra(f.orden === 'val' ? p.val : p.env, maxP)}</td></tr>`).join('')}
          </tbody></table></div></section>
        <section class="card"><div class="card-head"><h2>Por sucursal / cliente</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Sucursal</th><th class="num">Remitos</th><th class="num">A costo</th>${verFranq ? '<th class="num">A precio franquicia</th>' : ''}<th class="num">Dif.</th><th></th></tr></thead><tbody>
          ${porSuc.map((s) => `<tr><td><b>${esc(s.nombre)}</b>${s.franq ? ' <span class="badge b-amber">Franquicia</span>' : ''}</td><td class="num">${s.rem}</td><td class="num">${fmt$(s.costo)}</td>${verFranq ? `<td class="num">${s.franq ? fmt$(s.pf) : '<span class="muted">—</span>'}</td>` : ''}<td class="num" style="color:${s.dif < 0 ? 'var(--red)' : ''}">${s.dif ? fmt$(s.dif) : '✓'}</td><td style="width:80px">${barra(s.costo, maxS)}</td></tr>`).join('')}
          </tbody></table></div></section>
      </div>
      <section class="card" style="margin-top:16px"><div class="card-head"><h2>Volumen mensual</h2><span class="small muted">enviado a costo</span></div>
        <div class="table-wrap"><table><thead><tr><th>Sucursal</th>${porMes.map((m) => `<th class="num">${mesLabel(m.m)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
        ${mesSuc.map((s) => `<tr><td><b>${esc(s.nombre)}</b></td>${s.m.map((x) => `<td class="num">${x ? fmt$(x) : '<span class="muted">—</span>'}</td>`).join('')}<td class="num"><b>${fmt$(s.costo)}</b></td></tr>`).join('')}
        </tbody><tfoot><tr><td>Total</td>${porMes.map((m) => `<td class="num">${fmt$(m.costo)}<div style="margin-top:4px">${barra(m.costo, maxM)}</div><div class="small muted">${m.rem} remitos</div></td>`).join('')}<td class="num">${fmt$(totCosto)}</td></tr></tfoot></table></div></section>
      <div class="grid cols-2" style="margin-top:16px">
        <section class="card"><div class="card-head"><h2>Diferencias y mermas por motivo</h2><a class="small" href="#/diferencias">Ver detalle</a></div>
          <div class="table-wrap">${porMot.length ? `<table><thead><tr><th>Motivo</th><th class="num">Remitos</th><th class="num">Renglones</th><th class="num">A costo</th></tr></thead><tbody>
          ${porMot.map((m) => `<tr><td>${m.k === '_pend' ? '<span class="badge b-red">Sin resolver</span>' : esc(m.nombre)}</td><td class="num">${m.rem}</td><td class="num">${m.lin}</td><td class="num">${fmt$(m.val)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty small">Sin diferencias en el período 👌</div>'}</div></section>
        <section class="card"><div class="card-head"><h2>Por área</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Área</th><th class="num">Remitos</th><th class="num">A costo</th></tr></thead><tbody>
          ${porArea.map((a) => `<tr><td>${esc(a.nombre)}</td><td class="num">${a.rem}</td><td class="num">${fmt$(a.costo)}</td></tr>`).join('')}</tbody></table></div></section>
      </div>
      ${verFranq ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Historial de facturación</h2><span class="small muted">${fact.length} facturados · ${pendFact.length} pendientes</span></div>
        <div class="table-wrap">${fact.length ? `<table><thead><tr><th>Remito</th><th>Sucursal</th><th>Facturado</th><th>N° factura</th><th class="num">Recibido a costo</th><th class="num">A precio franquicia</th></tr></thead><tbody>
        ${fact.slice(0, 50).map((r) => `<tr class="click" data-id="${r.id}"><td class="nowrap"><b>${label(r)}</b></td><td>${esc(locName(r.destino_id))}</td><td class="small">${fmtFH(r.facturado_at)}</td><td>${esc(r.nro_factura || '—')}</td><td class="num">${fmt$(r.costo)}</td><td class="num">${esFranq(r.destino_id) ? fmt$(r.pf) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>
        ${fact.length > 50 ? '<div class="small muted card-pad">Se muestran los últimos 50; el Excel tiene todos.</div>' : ''}` : '<div class="empty small">Sin remitos facturados en el período</div>'}</div></section>` : ''}`;
    $$('#orden [data-o]').forEach((b) => (b.onclick = () => { f.orden = b.dataset.o; draw(); }));
    $$('#rep tr[data-id]').forEach((tr) => (tr.onclick = () => (location.hash = '#/remitos/' + tr.dataset.id)));
  };
  const bind = (id, key) => { const el = $(id); if (el) el.oninput = () => { if (el.type === 'date' && !okFecha(el.value)) return; f[key] = el.value; draw(); }; };
  bind('#f-desde', 'desde'); bind('#f-hasta', 'hasta'); bind('#f-origen', 'origen'); bind('#f-destino', 'destino'); bind('#f-area', 'area'); bind('#f-tipo', 'tipo');
  $('#xlsx').onclick = () => {
    if (!R?.rows.length) return toast('No hay datos para exportar', { err: true });
    const admin = me.rol === 'admin';
    downloadXLSX(`reporte_remitos_${f.desde}_${f.hasta}.xlsx`, {
      'Ranking productos': [['#', 'Producto', 'Área', 'Unidad', 'Enviado', 'Recibido', 'Sucursales', 'Valor a costo'], ...R.porProd.map((p, i) => [i + 1, p.nombre, p.area, p.unidad, p.env, p.real, p.suc, Math.round(p.val)])],
      'Por sucursal': [['Sucursal', 'Tipo', 'Remitos', 'Renglones', 'Unidades enviadas', 'Valor a costo', ...(admin ? ['Valor precio franquicia'] : []), 'Diferencias a costo'],
        ...R.porSuc.map((s) => [s.nombre, s.franq ? 'Franquicia' : 'Propio', s.rem, s.lin, s.env, Math.round(s.costo), ...(admin ? [s.franq ? Math.round(s.pf) : ''] : []), Math.round(s.dif)])],
      'Mensual': [['Sucursal', ...R.meses.map(mesLabel), 'Total'], ...R.mesSuc.map((s) => [s.nombre, ...s.m.map(Math.round), Math.round(s.costo)]),
        ['Total', ...R.porMes.map((m) => Math.round(m.costo)), Math.round(R.porMes.reduce((t, m) => t + m.costo, 0))], ['Remitos', ...R.porMes.map((m) => m.rem)]],
      'Por área': [['Área', 'Remitos', 'Valor a costo'], ...R.porArea.map((a) => [a.nombre, a.rem, Math.round(a.costo)])],
      'Diferencias': [['Remito', 'Fecha envío', 'Sucursal', 'Área', 'Producto', 'Unidad', 'Enviado', 'Recibido', 'Diferencia', 'Valor a costo', 'Obs. local', 'Motivo'],
        ...R.difs.map((i) => [label(i.remito), fmtF(i.remito.despachado_at), locName(i.destino_id), area(i.area_id)?.nombre || '', i.nombre, i.unidad, i.env, Number(i.cantidad_recibida), i.dif, Math.round(i.dif * i.costo), i.obs || '', i.remito.dif_resuelta_at ? DIF_TIPOS[i.remito.dif_tipo] || i.remito.dif_tipo : 'Sin resolver'])],
      ...(admin ? { 'Facturación': [['Remito', 'Sucursal', 'Tipo', 'Estado', 'Facturado', 'N° factura', 'Recibido a costo', 'A precio franquicia'],
        ...[...R.fact, ...R.pendFact].map((r) => [label(r), locName(r.destino_id), esFranq(r.destino_id) ? 'Franquicia' : 'Propio', r.facturado_at ? 'Facturado' : 'Pendiente', r.facturado_at ? fmtFH(r.facturado_at) : '', r.nro_factura || '', Math.round(r.costo), esFranq(r.destino_id) ? Math.round(r.pf) : ''])] } : {}),
      'Detalle': [['Remito', 'Fecha envío', 'Obrador', 'Sucursal', 'Área', 'Producto', 'Unidad', 'Enviado', 'Recibido', 'Costo unit.', 'Cortesía', 'Estado'],
        ...R.rows.map((i) => [label(i.remito), fmtF(i.remito.despachado_at), locName(i.origen_id), locName(i.destino_id), area(i.area_id)?.nombre || '', i.nombre, i.unidad, i.env, i.cantidad_recibida ?? '', i.costo, i.cortesia ? 'Sí' : '', ESTADOS[i.estado]?.l || i.estado])],
    });
  };
  await draw();
  S.refresh = draw;
}

// ======================================================================
//  Franquicias: qué se les mandó, a qué precio y con qué margen
// ======================================================================
async function viewFranquicias(v) {
  const franqs = locales().filter((l) => l.es_franquicia);
  const f = fechasOk(S.frFilters || (S.frFilters = { desde: inicioMes(0), hasta: hoy(), destino: '', tipo: 'franq', tab: 'resumen' }), inicioMes(0), hoy());
  v.innerHTML = `
    <div class="page-head"><div><h1>Franquicias</h1><p>Lo que recibió cada franquicia valorizado a precio de franquicia, contra el costo de producción</p></div>
    <div class="btn-row"><button class="btn primary" id="xlsx">Exportar a Excel</button></div></div>
    ${franqs.length ? '' : '<div class="callout"><span>Todavía no hay locales marcados como franquicia. Marcalos en Configuración → Obradores y locales → Editar → "Propio o franquicia".</span><a class="btn" href="#/config">Ir a Configuración</a></div>'}
    <div class="tabs" id="tabs"><button data-t="resumen" class="${f.tab === 'resumen' ? 'active' : ''}">Resumen por franquicia</button><button data-t="precios" class="${f.tab === 'precios' ? 'active' : ''}">Lista de precios</button></div>
    <div id="fr"></div>`;
  let X = null;
  const sinPrecio = () => prods.filter((p) => p.activo !== false && p.seccion === 'terminado' && !p.precio_franquicia);
  const drawResumen = async () => {
    $('#fr').innerHTML = `<div class="filters card card-pad">
        <label class="field"><span>Desde</span><input type="date" id="f-desde" value="${f.desde}"></label>
        <label class="field"><span>Hasta</span><input type="date" id="f-hasta" value="${f.hasta}"></label>
        <label class="field"><span>Franquicia</span><select id="f-destino"><option value="">Todas</option>${franqs.map((l) => `<option value="${l.id}" ${f.destino === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>
      </div><div id="frr"><div class="empty">Cargando…</div></div>`;
    const bind = (id, key) => { const el = $(id); if (el) el.oninput = () => { if (el.type === 'date' && !okFecha(el.value)) return; f[key] = el.value; drawResumen(); }; };
    bind('#f-desde', 'desde'); bind('#f-hasta', 'hasta'); bind('#f-destino', 'destino');
    const rows = (await cargarRenglones({ ...f, tipo: 'franq' })).filter((i) => esFranq(i.destino_id));
    const porF = Object.entries(groupBy(rows, (i) => i.destino_id)).map(([id, l]) => {
      const venta = l.reduce((s, i) => s + i.real * i.pf, 0), costo = l.reduce((s, i) => s + i.real * i.costo, 0);
      return { id, nombre: locName(id), rem: new Set(l.map((i) => i.remito_id)).size, venta, costo, margen: venta - costo, sinP: new Set(l.filter((i) => !i.pf && !i.cortesia && i.product_id).map((i) => i.product_id)).size };
    }).sort((a, b) => b.venta - a.venta);
    const porProd = Object.values(groupBy(rows.filter((i) => !i.cortesia), (i) => i.product_id || 'x:' + norm(i.nombre))).map((l) => ({
      nombre: l[0].nombre, unidad: l[0].unidad, cant: l.reduce((s, i) => s + i.real, 0), pf: l[0].pf, costo: l[0].costo,
      venta: l.reduce((s, i) => s + i.real * i.pf, 0), cst: l.reduce((s, i) => s + i.real * i.costo, 0),
    })).sort((a, b) => b.venta - a.venta || b.cant - a.cant);
    X = { rows, porF, porProd };
    const tv = porF.reduce((s, x) => s + x.venta, 0), tc = porF.reduce((s, x) => s + x.costo, 0);
    $('#frr').innerHTML = !rows.length ? '<div class="empty">No hay envíos a franquicias en el período</div>' : `
      <div class="kpis">
        <div class="card kpi"><div class="label">A precio franquicia</div><div class="value">${fmt$(tv)}</div><div class="sub">lo recibido en el período</div></div>
        <div class="card kpi"><div class="label">Costo de producción</div><div class="value">${fmt$(tc)}</div><div class="sub">&nbsp;</div></div>
        <div class="card kpi ${tv - tc < 0 ? 'alert' : 'ok'}"><div class="label">Margen</div><div class="value">${fmt$(tv - tc)}</div><div class="sub">${tv ? fmtPct((tv - tc) / tv) + ' sobre el precio' : '&nbsp;'}</div></div>
      </div>
      <section class="card"><div class="card-head"><h2>Por franquicia</h2></div><div class="table-wrap"><table>
        <thead><tr><th>Franquicia</th><th class="num">Remitos</th><th class="num">A precio franquicia</th><th class="num">Costo</th><th class="num">Margen</th><th class="num">%</th></tr></thead>
        <tbody>${porF.map((x) => `<tr><td><b>${esc(x.nombre)}</b>${x.sinP ? ` <span class="badge b-amber" title="Productos enviados sin precio de franquicia cargado">${x.sinP} productos sin precio</span>` : ''}</td><td class="num">${x.rem}</td><td class="num">${fmt$(x.venta)}</td><td class="num">${fmt$(x.costo)}</td><td class="num">${fmt$(x.margen)}</td><td class="num">${x.venta ? fmtPct(x.margen / x.venta) : '—'}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card" style="margin-top:16px"><div class="card-head"><h2>Productos enviados a franquicias</h2></div><div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Precio franq.</th><th class="num">Costo unit.</th><th class="num">Total precio</th><th class="num">Margen</th></tr></thead>
        <tbody>${porProd.map((p) => `<tr><td><b>${esc(p.nombre)}</b> <span class="small muted">${esc(p.unidad)}</span></td><td class="num">${fmtQ(p.cant)}</td><td class="num">${p.pf ? fmt$(p.pf) : '<span class="badge b-amber">falta</span>'}</td><td class="num">${fmt$(p.costo)}</td><td class="num">${fmt$(p.venta)}</td><td class="num">${fmt$(p.venta - p.cst)}</td></tr>`).join('')}</tbody></table></div></section>`;
  };
  const drawPrecios = () => {
    const q = f.q || '';
    const list = prods.filter((p) => p.activo !== false && (!q || norm(p.nombre).includes(norm(q)) || norm(p.codigo).includes(norm(q))))
      .sort((a, b) => ((area(a.area_id)?.orden ?? 99) - (area(b.area_id)?.orden ?? 99)) || a.nombre.localeCompare(b.nombre));
    const falt = sinPrecio().length;
    $('#fr').innerHTML = `${falt ? `<div class="callout"><span>${falt} productos terminados no tienen precio de franquicia. Se cargan en Configuración → Productos → Editar → "Precio a franquicias".</span></div>` : ''}
      <div class="card"><div class="card-head"><h2>Lista de precios a franquicias</h2><input id="pq" placeholder="Buscar…" value="${esc(q)}" style="width:180px"></div>
      <div class="table-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Unidad</th><th>Área</th><th class="num">Costo</th><th class="num">Precio franquicia</th><th class="num">Margen</th><th class="num">Precio venta local</th></tr></thead>
      <tbody>${list.map((p) => `<tr><td>${esc(p.codigo || '')}</td><td><b>${esc(p.nombre)}</b></td><td>${esc(p.unidad)}</td><td>${esc(area(p.area_id)?.nombre || '—')}</td><td class="num">${fmt$(p.precio_costo)}</td>
        <td class="num">${p.precio_franquicia ? fmt$(p.precio_franquicia) : p.seccion === 'terminado' ? '<span class="badge b-amber">falta</span>' : '<span class="muted">—</span>'}</td>
        <td class="num">${p.precio_franquicia ? fmtPct((p.precio_franquicia - (p.precio_costo || 0)) / p.precio_franquicia) : '—'}</td><td class="num">${p.precio_venta ? fmt$(p.precio_venta) : '—'}</td></tr>`).join('')}</tbody></table></div></div>
      <p class="small muted">Los costos se cargan a mano en Configuración → Productos. Cuando tengamos el acceso a Open Wings se podrán traer de ahí.</p>`;
    $('#pq').oninput = (e) => { f.q = e.target.value; const pos = e.target.selectionStart; drawPrecios(); const el = $('#pq'); el.focus(); el.setSelectionRange(pos, pos); };
  };
  const draw = () => (f.tab === 'precios' ? drawPrecios() : drawResumen());
  $$('#tabs [data-t]').forEach((b) => (b.onclick = () => { f.tab = b.dataset.t; $$('#tabs [data-t]').forEach((x) => x.classList.toggle('active', x === b)); draw(); }));
  $('#xlsx').onclick = async () => {
    if (!X) X = { rows: (await cargarRenglones({ ...f, tipo: 'franq' })).filter((i) => esFranq(i.destino_id)), porF: [], porProd: [] };
    const lista = prods.filter((p) => p.activo !== false).sort((a, b) => ((area(a.area_id)?.orden ?? 99) - (area(b.area_id)?.orden ?? 99)) || a.nombre.localeCompare(b.nombre));
    downloadXLSX(`franquicias_${f.desde}_${f.hasta}.xlsx`, {
      'Lista de precios': [['Código', 'Producto', 'Unidad', 'Área', 'Costo', 'Precio franquicia', 'Margen %', 'Precio venta local'],
        ...lista.map((p) => [p.codigo || '', p.nombre, p.unidad, area(p.area_id)?.nombre || '', p.precio_costo || 0, p.precio_franquicia || 0, p.precio_franquicia ? Math.round(((p.precio_franquicia - (p.precio_costo || 0)) / p.precio_franquicia) * 100) : '', p.precio_venta || 0])],
      'Por franquicia': [['Franquicia', 'Remitos', 'A precio franquicia', 'Costo', 'Margen'], ...X.porF.map((x) => [x.nombre, x.rem, Math.round(x.venta), Math.round(x.costo), Math.round(x.margen)])],
      'Detalle': [['Remito', 'Fecha envío', 'Franquicia', 'Producto', 'Unidad', 'Cantidad recibida', 'Precio franquicia', 'Total', 'Costo unit.', 'Facturado', 'N° factura'],
        ...X.rows.map((i) => [label(i.remito), fmtF(i.remito.despachado_at), locName(i.destino_id), i.nombre, i.unidad, i.real, i.pf, Math.round(i.real * i.pf), i.costo, i.remito.facturado_at ? 'Sí' : 'No', i.remito.nro_factura || ''])],
    });
  };
  draw();
  S.refresh = () => f.tab === 'resumen' && drawResumen();
}

// ======================================================================
//  Contraste: enviado vs vendido
// ======================================================================
async function viewContraste(v) {
  const f = fechasOk(S.conFilters || (S.conFilters = { desde: haceDias(7), hasta: hoy(), local: me.rol === 'local' ? me.location_id : '', area: '', seccion: 'terminado' }), haceDias(7), hoy());
  v.innerHTML = `
    <div class="page-head"><div><h1>Enviado vs. vendido</h1><p>Compara lo que recibió cada local desde los obradores con lo que vendió en HioPos</p></div>
      <button class="btn" id="csv">Exportar CSV</button></div>
    <div class="filters card card-pad">
      <label class="field"><span>Desde</span><input type="date" id="c-desde" value="${f.desde}"></label>
      <label class="field"><span>Hasta</span><input type="date" id="c-hasta" value="${f.hasta}"></label>
      ${me.rol === 'admin' ? `<label class="field"><span>Local</span><select id="c-local"><option value="">Todos los locales</option>${locales().map((l) => `<option value="${l.id}" ${f.local === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Área</span><select id="c-area"><option value="">Todas</option>${areas.map((a) => `<option value="${a.id}" ${f.area === a.id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></label>
      <label class="field"><span>Sección</span><select id="c-sec"><option value="">Todas</option>${Object.entries(SECCIONES).map(([k, l]) => `<option value="${k}" ${f.seccion === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btn-row"><button class="btn sm" data-r="0">Hoy</button><button class="btn sm" data-r="1">Ayer</button><button class="btn sm" data-r="7">7 días</button><button class="btn sm" data-r="30">30 días</button></div>
    </div>
    <div id="c-out"></div>`;
  let rows = [];
  const draw = async () => {
    const [its, vts] = await Promise.all([db.listItemsDespachados(f.desde, f.hasta), db.listVentas(f.desde, f.hasta)]);
    const inLoc = (id) => !f.local || id === f.local;
    const map = new Map();
    const row = (pid) => {
      if (!map.has(pid)) { const p = prod(pid); map.set(pid, { pid, p, enviado: 0, recibido: 0, transito: 0, vendido: 0, importe: 0 }); }
      return map.get(pid);
    };
    let cortesias = 0;
    for (const i of its) {
      if (!inLoc(i.destino_id)) continue;
      if (i.cortesia) { cortesias += i.cantidad_enviada; continue; }
      if (!i.product_id) continue;
      const x = row(i.product_id);
      x.enviado += i.cantidad_enviada;
      if (i.cantidad_recibida != null) x.recibido += i.cantidad_recibida; else x.transito += i.cantidad_enviada;
    }
    let sinMatch = 0, sinMatchImp = 0;
    const porLocal = new Map();
    for (const s of vts) {
      if (!inLoc(s.location_id)) continue;
      const pl = porLocal.get(s.location_id) || { vendido: 0, importe: 0 }; pl.importe += s.importe; porLocal.set(s.location_id, pl);
      if (!s.product_id || !prod(s.product_id)) { sinMatch++; sinMatchImp += s.importe; continue; }
      const x = row(s.product_id); x.vendido += s.cantidad / (Number(x.p.factor_hiopos) || 1); x.importe += s.importe;
    }
    rows = [...map.values()].filter((x) => x.p && (!f.area || x.p.area_id === f.area) && (!f.seccion || (x.p.seccion || 'terminado') === f.seccion));
    for (const x of rows) {
      x.dif = x.recibido - x.vendido;
      x.pct = x.recibido ? x.vendido / x.recibido : null;
      x.faltante = x.enviado - x.transito - x.recibido;
      x.difVal = x.dif * (x.p.precio_costo || 0);
    }
    const { key, dir } = S.sort;
    const val = (x) => (key === 'nombre' ? x.p.nombre : x[key] ?? -Infinity);
    rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);

    const T = rows.reduce((t, x) => { ['enviado', 'recibido', 'transito', 'vendido', 'importe', 'dif', 'difVal', 'faltante'].forEach((k) => (t[k] += x[k])); return t; }, { enviado: 0, recibido: 0, transito: 0, vendido: 0, importe: 0, dif: 0, difVal: 0, faltante: 0 });
    const pctT = T.recibido ? T.vendido / T.recibido : null;
    const faltVal = rows.reduce((s, x) => s + x.faltante * (x.p.precio_costo || 0), 0);
    const th = (k, l, cls = '') => `<th class="sortable ${cls}" data-k="${k}">${l}${S.sort.key === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const barCls = (p) => (p == null ? '' : p < 0.6 ? 'bad' : p < 0.8 ? 'warn' : '');

    $('#c-out').innerHTML = `
      <div class="kpis">
        <div class="card kpi"><div class="label">Recibido por los locales</div><div class="value">${fmtN(T.recibido)}</div><div class="sub">unidades${T.transito ? ` · ${fmtN(T.transito)} en tránsito` : ''}</div></div>
        <div class="card kpi"><div class="label">Vendido (HioPos)</div><div class="value">${fmtN(T.vendido)}</div><div class="sub">${fmt$(T.importe)} facturado</div></div>
        <div class="card kpi ${pctT != null && pctT < 0.8 ? 'warn' : 'ok'}"><div class="label">% vendido de lo recibido</div><div class="value">${fmtPct(pctT)}</div><div class="sub">aprovechamiento</div></div>
        <div class="card kpi ${T.dif > 0 ? 'alert' : ''}"><div class="label">Recibido sin vender</div><div class="value">${fmtN(T.dif)}</div><div class="sub">${fmt$(T.difVal)} a costo · stock o merma</div></div>
        <div class="card kpi ${T.faltante > 0 ? 'alert' : ''}"><div class="label">Faltantes en recepción</div><div class="value">${fmtN(T.faltante)}</div><div class="sub">${fmt$(faltVal)} a costo</div></div>
      </div>
      ${cortesias ? `<p class="small muted">No se cuentan ${fmtN(cortesias)} unidades enviadas como cortesía.</p>` : ''}
      ${sinMatch ? `<div class="callout info"><span>${sinMatch} líneas de venta (${fmt$(sinMatchImp)}) no coinciden con ningún producto. Revisá el código HioPos en Configuración → Productos.</span></div>` : ''}
      ${!vts.length ? `<div class="callout info"><span>No hay ventas cargadas para este período.</span>${can.admin() ? '<a class="btn" href="#/ventas">Importar ventas de HioPos</a>' : ''}</div>` : ''}
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>${th('nombre', 'Producto')}${th('enviado', 'Enviado', 'num')}${th('faltante', 'Faltante recep.', 'num')}${th('recibido', 'Recibido', 'num')}${th('vendido', 'Vendido', 'num')}${th('pct', '% vendido')}${th('dif', 'Sin vender', 'num')}${th('difVal', 'Sin vender $ costo', 'num')}${th('importe', 'Venta $', 'num')}</tr></thead>
          <tbody>${rows.length ? rows.map((x) => `<tr class="${x.pct != null && x.pct < 0.6 ? 'row-dif' : ''}">
            <td><b>${esc(x.p.nombre)}</b> <span class="small muted">${esc(x.p.unidad)}${Number(x.p.factor_hiopos) > 1 ? ` · 1 = ${fmtN(x.p.factor_hiopos)} en HioPos` : ''}</span></td>
            <td class="num">${fmtQ(x.enviado)}</td>
            <td class="num" style="color:${x.faltante > 0 ? 'var(--red)' : ''}">${x.faltante ? fmtQ(x.faltante) : '—'}</td>
            <td class="num">${fmtQ(x.recibido)}${x.transito ? ` <span class="small muted">(+${fmtQ(x.transito)})</span>` : ''}</td>
            <td class="num">${fmtQ(x.vendido)}</td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="bar ${barCls(x.pct)}" style="flex:1"><i style="width:${Math.min(100, (x.pct || 0) * 100)}%"></i></div><span class="small num" style="width:40px">${fmtPct(x.pct)}</span></div></td>
            <td class="num" style="color:${x.dif < 0 ? 'var(--blue)' : x.dif > 0 ? 'var(--red)' : ''}">${fmtQ(x.dif)}</td>
            <td class="num">${fmt$(x.difVal)}</td>
            <td class="num">${fmt$(x.importe)}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">Sin datos en el período</td></tr>'}</tbody>
          ${rows.length ? `<tfoot><tr><td>Total</td><td class="num">${fmtQ(T.enviado)}</td><td class="num">${fmtQ(T.faltante)}</td><td class="num">${fmtQ(T.recibido)}</td><td class="num">${fmtQ(T.vendido)}</td><td>${fmtPct(pctT)}</td><td class="num">${fmtQ(T.dif)}</td><td class="num">${fmt$(T.difVal)}</td><td class="num">${fmt$(T.importe)}</td></tr></tfoot>` : ''}
        </table></div>
      </div>
      <p class="small muted" style="margin-top:10px"><b>Sin vender</b> = recibido − vendido. Si es positivo, quedó stock o hubo merma. Si es <span style="color:var(--blue)">negativo</span>, se vendió más de lo recibido en el período (stock anterior o error de carga). Se toman los remitos por fecha de despacho y las ventas por fecha de HioPos. Si un producto se vende fraccionado (ej. tarta entera → porciones), cargá el factor en Configuración → Productos.</p>`;
    $$('#c-out th[data-k]').forEach((t) => (t.onclick = () => { S.sort = { key: t.dataset.k, dir: S.sort.key === t.dataset.k ? -S.sort.dir : t.dataset.k === 'nombre' ? 1 : -1 }; draw(); }));
  };
  const bind = (id, key) => { const el = $(id); if (el) el.onchange = () => { if (el.type === 'date' && !okFecha(el.value)) return; f[key] = el.value; draw(); }; };
  bind('#c-desde', 'desde'); bind('#c-hasta', 'hasta'); bind('#c-local', 'local'); bind('#c-area', 'area'); bind('#c-sec', 'seccion');
  $$('[data-r]').forEach((b) => (b.onclick = () => { const n = Number(b.dataset.r); f.desde = haceDias(n); f.hasta = n === 1 ? haceDias(1) : hoy(); $('#c-desde').value = f.desde; $('#c-hasta').value = f.hasta; draw(); }));
  $('#csv').onclick = () => downloadCSV(`contraste_${f.desde}_${f.hasta}.csv`, [['Código', 'Producto', 'Unidad', 'Enviado', 'Faltante recepción', 'Recibido', 'En tránsito', 'Vendido', '% vendido', 'Sin vender', 'Sin vender $ costo', 'Venta $'],
    ...rows.map((x) => [x.p.codigo, x.p.nombre, x.p.unidad, x.enviado, x.faltante, x.recibido, x.transito, x.vendido, x.pct == null ? '' : Math.round(x.pct * 100), x.dif, Math.round(x.difVal), Math.round(x.importe)])]);
  await draw();
  S.refresh = draw;
}

// ======================================================================
//  Importación de ventas HioPos
// ======================================================================
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}
function parseFecha(v) {
  if (v instanceof Date && !isNaN(v)) return dia(v);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const GUESS = {
  fecha: ['fecha', 'dia', 'date'],
  local: ['tienda', 'local', 'sucursal', 'almacen', 'establecimiento', 'serie'],
  codigo: ['codigo', 'cod', 'referencia', 'ref', 'id articulo', 'plu'],
  descripcion: ['articulo', 'descripcion', 'producto', 'nombre', 'detalle'],
  cantidad: ['unidades', 'cantidad', 'uds', 'cant', 'unid'],
  importe: ['importe', 'total', 'venta', 'neto', 'monto', 'facturado'],
};

async function viewVentas(v) {
  if (!can.admin()) { v.innerHTML = '<div class="empty">Solo administración</div>'; return; }
  const st = { headers: [], data: [], map: {}, fechaFija: haceDias(1), localFijo: '' };
  v.innerHTML = `
    <div class="page-head"><div><h1>Ventas HioPos</h1><p>Importá el informe de ventas por artículo para contrastarlo contra lo enviado</p></div></div>
    <div class="grid cols-2" style="margin-bottom:16px">
      <div class="card card-pad">
        <h2 style="margin-bottom:8px">Cómo exportar desde HioPos</h2>
        <ol class="muted" style="margin:0;padding-left:18px">
          <li>En HioPos (o HioPos Cloud) entrá a <b>Informes → Ventas por artículo</b> (o el informe equivalente de ventas por producto).</li>
          <li>Elegí el local y el rango de fechas. Si podés, incluí las columnas fecha, código, artículo, unidades e importe.</li>
          <li>Exportalo a <b>Excel</b> o <b>CSV</b> y subilo acá.</li>
        </ol>
        <p class="small muted">Si el informe no trae fecha o local por línea, los elegís abajo. Si volvés a importar el mismo día y local, se reemplaza: no se duplica.</p>
      </div>
      <label class="dropzone" id="dz"><input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>
        <div style="font-size:28px">↥</div><b>Arrastrá el archivo de HioPos acá</b><div class="small">o hacé clic para elegirlo (.xlsx, .xls, .csv)</div></label>
    </div>
    <div id="map"></div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Ventas cargadas (últimos 14 días)</h2></div><div class="table-wrap" id="cob"></div></section>`;

  const cobertura = async () => {
    const vs = await db.listVentas(haceDias(14), hoy());
    const days = [...Array(14)].map((_, i) => haceDias(13 - i));
    $('#cob').innerHTML = `<table><thead><tr><th>Local</th>${days.map((d) => `<th class="num">${d.slice(8)}/${d.slice(5, 7)}</th>`).join('')}</tr></thead><tbody>
      ${locales().map((l) => `<tr><td><b>${esc(l.nombre)}</b></td>${days.map((d) => { const imp = vs.filter((x) => x.location_id === l.id && x.fecha === d).reduce((s, x) => s + x.importe, 0); return `<td class="num small" style="color:${imp ? '' : 'var(--muted)'}">${imp ? fmtN(imp / 1000) + 'k' : '—'}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table>`;
  };

  const matchLocal = (val) => { const n = norm(val); if (!n) return null; return locales().find((l) => norm(l.codigo_hiopos) === n || norm(l.nombre) === n || n.includes(norm(l.nombre)))?.id || null; };
  const matchProd = (cod, desc) => {
    const c = norm(cod), d = norm(desc);
    return prods.find((p) => (c && (norm(p.codigo_hiopos) === c || norm(p.codigo) === c)) || (d && norm(p.nombre) === d))?.id || null;
  };
  const build = () => {
    const m = st.map, out = new Map();
    let sinFecha = 0, sinLocal = 0;
    for (const r of st.data) {
      const desc = m.descripcion !== '' ? r[m.descripcion] : '';
      const cod = m.codigo !== '' ? String(r[m.codigo] ?? '').trim() : '';
      if (!cod && !desc) continue;
      const cant = parseNum(r[m.cantidad]);
      if (!cant && !(m.importe !== '' && parseNum(r[m.importe]))) continue;
      if (norm(desc).startsWith('total') || norm(cod).startsWith('total')) continue;
      const fecha = m.fecha !== '' ? parseFecha(r[m.fecha]) : st.fechaFija;
      const location_id = m.local !== '' ? matchLocal(r[m.local]) : st.localFijo;
      if (!fecha) { sinFecha++; continue; }
      if (!location_id) { sinLocal++; continue; }
      const codigo = cod || String(desc).trim();
      const k = fecha + '|' + location_id + '|' + codigo;
      const x = out.get(k) || { fecha, location_id, codigo, descripcion: String(desc || ''), product_id: matchProd(cod, desc), cantidad: 0, importe: 0, fuente: 'hiopos-import' };
      x.cantidad += cant; x.importe += m.importe !== '' ? parseNum(r[m.importe]) : 0;
      out.set(k, x);
    }
    return { rows: [...out.values()], sinFecha, sinLocal };
  };
  const drawMap = () => {
    if (!st.headers.length) { $('#map').innerHTML = ''; return; }
    const opt = (k, allowNone) => `<select data-m="${k}">${allowNone ? `<option value="">${allowNone}</option>` : ''}${st.headers.map((h, i) => `<option value="${i}" ${String(st.map[k]) === String(i) ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('')}</select>`;
    const { rows, sinFecha, sinLocal } = build();
    const sinProd = rows.filter((r) => !r.product_id);
    $('#map').innerHTML = `<div class="card card-pad grid">
      <h2>Columnas del archivo (${st.data.length} filas)</h2>
      <div class="form-grid">
        <label class="field"><span>Fecha</span>${opt('fecha', '— Fecha fija —')}</label>
        ${st.map.fecha === '' ? `<label class="field"><span>Fecha de las ventas</span><input type="date" id="ffija" value="${st.fechaFija}"></label>` : ''}
        <label class="field"><span>Local / tienda</span>${opt('local', '— Local fijo —')}</label>
        ${st.map.local === '' ? `<label class="field"><span>Local de las ventas</span><select id="lfijo"><option value="">Elegí…</option>${locales().map((l) => `<option value="${l.id}" ${st.localFijo === l.id ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Código artículo</span>${opt('codigo', '— Sin código —')}</label>
        <label class="field"><span>Descripción</span>${opt('descripcion', '— Sin descripción —')}</label>
        <label class="field"><span>Cantidad / unidades</span>${opt('cantidad')}</label>
        <label class="field"><span>Importe</span>${opt('importe', '— Sin importe —')}</label>
      </div>
      <div class="kpis" style="margin:0">
        <div class="card kpi"><div class="label">Líneas a importar</div><div class="value">${rows.length}</div><div class="sub">${fmtN(rows.reduce((s, r) => s + r.cantidad, 0))} u · ${fmt$(rows.reduce((s, r) => s + r.importe, 0))}</div></div>
        <div class="card kpi ${sinProd.length ? 'warn' : 'ok'}"><div class="label">Sin producto asociado</div><div class="value">${sinProd.length}</div><div class="sub">se guardan igual, no entran al contraste</div></div>
        <div class="card kpi ${sinFecha + sinLocal ? 'alert' : ''}"><div class="label">Descartadas</div><div class="value">${sinFecha + sinLocal}</div><div class="sub">${sinFecha} sin fecha · ${sinLocal} sin local</div></div>
      </div>
      ${sinProd.length ? `<details><summary class="small">Ver artículos sin producto asociado (${sinProd.length})</summary><p class="small muted">Cargá el "Código HioPos" en Configuración → Productos para asociarlos.</p><div class="small">${[...new Set(sinProd.map((r) => r.codigo + ' · ' + r.descripcion))].slice(0, 80).map(esc).join('<br>')}</div></details>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Local</th><th>Código</th><th>Descripción</th><th>Producto</th><th class="num">Cant.</th><th class="num">Importe</th></tr></thead><tbody>
        ${rows.slice(0, 8).map((r) => `<tr><td>${r.fecha}</td><td>${esc(locName(r.location_id))}</td><td>${esc(r.codigo)}</td><td>${esc(r.descripcion)}</td><td>${r.product_id ? esc(prod(r.product_id).nombre) : '<span class="badge b-amber">sin asociar</span>'}</td><td class="num">${fmtQ(r.cantidad)}</td><td class="num">${fmt$(r.importe)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn" id="cancel">Cancelar</button><button class="btn primary big" id="imp" ${rows.length ? '' : 'disabled'}>Importar ${rows.length} líneas</button></div>
    </div>`;
    $$('[data-m]').forEach((s) => (s.onchange = () => { st.map[s.dataset.m] = s.value; drawMap(); }));
    $('#ffija') && ($('#ffija').onchange = (e) => { st.fechaFija = e.target.value; drawMap(); });
    $('#lfijo') && ($('#lfijo').onchange = (e) => { st.localFijo = e.target.value; drawMap(); });
    $('#cancel').onclick = () => { st.headers = []; drawMap(); };
    $('#imp').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { const n = await db.importVentas(build().rows); toast(`${n} líneas de venta importadas`); st.headers = []; drawMap(); cobertura(); } catch (ex) { err(ex); e.currentTarget.disabled = false; }
    };
  };
  const loadFile = async (file) => {
    if (!window.XLSX) return toast('La librería de Excel no cargó todavía, probá de nuevo', { err: true });
    try {
      const buf = await file.arrayBuffer();
      let wb;
      if (/\.(csv|txt)$/i.test(file.name)) {
        // HioPos puede exportar CSV en UTF-8 o en Windows-1252: probamos UTF-8 y si hay caracteres inválidos usamos 1252
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
        wb = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', raw: true }); // raw: no interpreta fechas dd/mm como mm/dd
      } else {
        wb = XLSX.read(buf, { type: 'array', cellDates: true });
      }
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
      // la fila de encabezados es la primera con varias celdas de texto que matchean palabras clave
      const all = Object.values(GUESS).flat();
      let hi = aoa.findIndex((r) => r.filter((c) => typeof c === 'string' && all.some((k) => norm(c).includes(k))).length >= 2);
      if (hi < 0) hi = 0;
      st.headers = aoa[hi].map((h) => String(h).trim());
      st.data = aoa.slice(hi + 1).filter((r) => r.some((c) => c !== ''));
      const used = new Set();
      st.map = {};
      for (const [k, words] of Object.entries(GUESS)) {
        const idx = st.headers.findIndex((h, i) => !used.has(i) && words.some((w) => norm(h).includes(w)));
        st.map[k] = idx >= 0 ? String(idx) : '';
        if (idx >= 0) used.add(idx);
      }
      if (st.map.cantidad === '') st.map.cantidad = '0';
      // si el encabezado del informe menciona la tienda (ej. "Tienda: Funes"), se preselecciona
      const pre = aoa.slice(0, hi).flat().join(' ');
      const tienda = locales().find((l) => norm(pre).includes(norm(l.nombre)) || (l.codigo_hiopos && norm(pre).includes(norm(l.codigo_hiopos))));
      if (tienda) st.localFijo = tienda.id;
      // ídem fecha, si el informe es de un solo día
      const fpre = pre.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/);
      if (fpre && parseFecha(fpre[1])) st.fechaFija = parseFecha(fpre[1]);
      drawMap();
    } catch (e) { err(e); }
  };
  const dz = $('#dz');
  $('#file').onchange = (e) => e.target.files[0] && loadFile(e.target.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); };
  await cobertura();
}

// ======================================================================
//  Configuración (admin)
// ======================================================================
async function viewConfig(v) {
  if (!can.admin()) { v.innerHTML = '<div class="empty">Solo administración</div>'; return; }
  const tab = S.cfgTab || 'locs';
  v.innerHTML = `<div class="page-head"><div><h1>Configuración</h1><p>Obradores, locales, productos y usuarios</p></div></div>
    <div class="tabs">${[['locs', 'Obradores y locales'], ['areas', 'Áreas y talonarios'], ['prods', 'Productos'], ['users', 'Usuarios']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="cfg"></div>`;
  $$('[data-t]').forEach((b) => (b.onclick = () => { S.cfgTab = b.dataset.t; viewConfig(v); }));
  const out = $('#cfg');
  const yesno = [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }];

  if (tab === 'locs') {
    const avisos = await db.listAvisos();
    const avisoTxt = (a, tipo) => {
      const partes = [];
      if (a?.email) partes.push('✉ ' + esc(a.email));
      if (a?.whatsapp) partes.push((a.callmebot_apikey ? '💬 ' : '💬 (sin código) ') + esc(a.whatsapp));
      if (tipo === 'obrador') return partes.length ? partes.join('<br>') + '<br><span class="muted">despachos y recepciones</span>' : '<span class="muted">—</span>';
      return partes.length ? partes.join('<br>') : '<span class="muted">Solo encargados y admin</span>';
    };
    out.innerHTML = `<div class="card"><div class="card-head"><h2>Obradores y locales</h2><button class="btn primary sm" id="add">+ Agregar</button></div><div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Tipo</th><th>Abastecido por</th><th>Avisos al despachar</th><th>Código tienda HioPos</th><th>Estado</th><th></th></tr></thead>
      <tbody>${[...locs].sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'obrador' ? -1 : 1) || ((a.activo === false) - (b.activo === false)) || a.nombre.localeCompare(b.nombre)).map((l) => `<tr><td><b>${esc(l.nombre)}</b></td><td>${l.tipo === 'obrador' ? '<span class="badge b-blue">Obrador</span>' : l.es_franquicia ? '<span class="badge b-amber">Franquicia</span>' : '<span class="badge b-green">Local propio</span>'}</td><td>${l.tipo === 'local' ? esc(l.obrador_id ? locName(l.obrador_id) : 'Cualquier obrador') : '—'}</td><td class="small">${avisoTxt(avisos.find((a) => a.location_id === l.id), l.tipo)}</td><td>${esc(l.codigo_hiopos || '—')}</td><td>${l.activo === false ? 'Inactivo' : 'Activo'}</td><td class="num"><button class="btn sm" data-e="${l.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>
      <p class="small muted" style="margin-top:10px">Al despachar un remito se manda un mail a los encargados del local, a administración y al mail de avisos del local, y un WhatsApp al número del local. Para activar el WhatsApp, desde ese celular mandá <b>I allow callmebot to send me messages</b> al contacto <b>+34 644 45 70 57</b> y cargá acá el código (apikey) que responde.</p>`;
    const edit = async (l = {}) => {
      const av = avisos.find((a) => a.location_id === l.id) || {};
      const r = await modalForm({ title: l.id ? 'Editar sede' : 'Nueva sede', fields: [
        { name: 'nombre', label: 'Nombre', value: l.nombre, required: true },
        { name: 'tipo', label: 'Tipo', type: 'select', value: l.tipo || 'local', options: [{ value: 'obrador', label: 'Obrador' }, { value: 'local', label: 'Local' }] },
        { name: 'es_franquicia', label: 'Propio o franquicia (solo locales)', type: 'select', value: String(!!l.es_franquicia), options: [{ value: 'false', label: 'Local propio' }, { value: 'true', label: 'Franquicia' }] },
        { name: 'obrador_id', label: 'Abastecido por (solo locales)', type: 'select', value: l.obrador_id || '', options: [{ value: '', label: 'Cualquier obrador' }, ...obradores().map((o) => ({ value: o.id, label: o.nombre }))] },
        { name: 'codigo_hiopos', label: 'Código / nombre de tienda en HioPos', value: l.codigo_hiopos },
        { name: 'activo', label: 'Estado', type: 'select', value: String(l.activo !== false), options: yesno },
        ...(l.tipo === 'obrador' ? [
          { name: 'av_email', label: 'Mail del obrador: recibe cada despacho y cada recepción (opcional, varios separados por coma)', value: av.email || '' },
          { name: 'av_whatsapp', label: 'WhatsApp del obrador (con código de país, ej. +5493415551234)', value: av.whatsapp || '' },
          { name: 'av_apikey', label: 'Código CallMeBot (apikey) de ese WhatsApp', value: av.callmebot_apikey || '' },
        ] : [
          { name: 'av_email', label: 'Mail de avisos del local (opcional, varios separados por coma)', value: av.email || '' },
          { name: 'av_whatsapp', label: 'WhatsApp de avisos (con código de país, ej. +5493415551234)', value: av.whatsapp || '' },
          { name: 'av_apikey', label: 'Código CallMeBot (apikey) de ese WhatsApp', value: av.callmebot_apikey || '' },
        ]),
      ] });
      if (!r) return;
      const { av_email, av_whatsapp, av_apikey, ...loc } = r;
      try {
        await db.saveLocation({ ...(l.id ? { id: l.id } : {}), ...loc, obrador_id: loc.tipo === 'local' && loc.obrador_id ? loc.obrador_id : null, es_franquicia: loc.tipo === 'local' && loc.es_franquicia === 'true', activo: loc.activo === 'true' });
        if (l.id) await db.saveAvisos({ location_id: l.id, email: (av_email || '').trim() || null, whatsapp: (av_whatsapp || '').replace(/[^\d+]/g, '') || null, callmebot_apikey: (av_apikey || '').trim() || null });
        await loadMaestros(); toast('Guardado'); viewConfig(v);
      } catch (e) { err(e); }
    };
    $('#add').onclick = () => edit();
    $$('[data-e]').forEach((b) => (b.onclick = () => edit(locs.find((l) => l.id === b.dataset.e))));
  }

  if (tab === 'areas') {
    out.innerHTML = `<div class="card"><div class="card-head"><div><h2>Áreas y talonarios</h2><div class="small muted">Cada área numera sus remitos por separado, como el talonario en papel (ej. 0003-0941)</div></div><button class="btn primary sm" id="add">+ Agregar</button></div><div class="table-wrap"><table>
      <thead><tr><th>Área</th><th>Código</th><th>Prefijo talonario</th><th class="num">Productos</th><th>Estado</th><th></th></tr></thead>
      <tbody>${areas.map((a) => `<tr><td><b>${esc(a.nombre)}</b></td><td>${esc(a.codigo)}</td><td>${esc(a.prefijo)}</td><td class="num">${prods.filter((p) => p.area_id === a.id).length}</td><td>${a.activo === false ? 'Inactiva' : 'Activa'}</td><td class="num"><button class="btn sm" data-e="${a.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>`;
    const edit = async (a = {}) => {
      const r = await modalForm({ title: a.id ? 'Editar área' : 'Nueva área', fields: [
        { name: 'nombre', label: 'Nombre', value: a.nombre, required: true },
        { name: 'codigo', label: 'Código corto (ej. PAN)', value: a.codigo, required: true },
        { name: 'prefijo', label: 'Prefijo del talonario (ej. 0003)', value: a.prefijo || '0000', required: true },
        { name: 'activo', label: 'Estado', type: 'select', value: String(a.activo !== false), options: yesno },
      ] });
      if (!r) return;
      try { await db.saveArea({ ...(a.id ? { id: a.id } : {}), ...r, activo: r.activo === 'true' }); await loadMaestros(); toast('Guardado'); viewConfig(v); } catch (e) { err(e); }
    };
    $('#add').onclick = () => edit();
    $$('[data-e]').forEach((b) => (b.onclick = () => edit(areas.find((a) => a.id === b.dataset.e))));
  }

  if (tab === 'prods') {
    out.innerHTML = `<div class="card"><div class="card-head"><h2>Productos (${prods.length})</h2><div class="btn-row"><input id="pq" placeholder="Buscar…" style="width:180px"><button class="btn primary sm" id="add">+ Agregar</button></div></div><div class="table-wrap" id="pt"></div></div>`;
    const drawP = (q = '') => {
      const list = prods.filter((p) => !q || norm(p.nombre).includes(norm(q)) || norm(p.codigo).includes(norm(q)))
        .sort((a, b) => ((area(a.area_id)?.orden ?? 99) - (area(b.area_id)?.orden ?? 99)) || a.nombre.localeCompare(b.nombre));
      $('#pt').innerHTML = `<table><thead><tr><th>Código</th><th>Producto</th><th>Unidad</th><th>Área</th><th>Sección</th><th>Código HioPos</th><th class="num">Costo</th><th class="num">Precio venta</th><th class="num">Precio franquicia</th><th></th></tr></thead>
        <tbody>${list.map((p) => `<tr style="${p.activo === false ? 'opacity:.5' : ''}"><td>${esc(p.codigo)}</td><td><b>${esc(p.nombre)}</b></td><td>${esc(p.unidad)}</td><td>${esc(area(p.area_id)?.nombre || '—')}</td><td class="small">${esc(SECCIONES[p.seccion] || '—')}</td><td>${p.codigo_hiopos ? esc(p.codigo_hiopos) : p.seccion === 'terminado' ? '<span class="badge b-amber">falta</span>' : '<span class="muted">—</span>'}</td><td class="num">${fmt$(p.precio_costo)}</td><td class="num">${fmt$(p.precio_venta)}</td><td class="num">${p.precio_franquicia ? fmt$(p.precio_franquicia) : '<span class="muted">—</span>'}</td><td class="num"><button class="btn sm" data-e="${p.id}">Editar</button></td></tr>`).join('')}</tbody></table>`;
      $$('[data-e]', $('#pt')).forEach((b) => (b.onclick = () => edit(prods.find((p) => p.id === b.dataset.e))));
    };
    const edit = async (p = {}) => {
      const r = await modalForm({ title: p.id ? 'Editar producto' : 'Nuevo producto', fields: [
        { name: 'codigo', label: 'Código interno', value: p.codigo },
        { name: 'nombre', label: 'Nombre', value: p.nombre, required: true },
        { name: 'unidad', label: 'Unidad (u, kg, docena…)', value: p.unidad || 'u', required: true },
        { name: 'area_id', label: 'Área', type: 'select', value: p.area_id || '', options: [{ value: '', label: '—' }, ...areas.map((a) => ({ value: a.id, label: a.nombre }))] },
        { name: 'seccion', label: 'Sección', type: 'select', value: p.seccion || 'terminado', options: Object.entries(SECCIONES).map(([value, label]) => ({ value, label })) },
        { name: 'obrador_id', label: 'Solo lo produce el obrador', type: 'select', value: p.obrador_id || '', options: [{ value: '', label: 'Cualquiera' }, ...obradores().map((l) => ({ value: l.id, label: l.nombre }))] },
        { name: 'codigo_hiopos', label: 'Código de artículo en HioPos', value: p.codigo_hiopos },
        { name: 'factor_hiopos', label: 'Unidades HioPos por unidad enviada', type: 'number', value: p.factor_hiopos ?? 1 },
        { name: 'precio_costo', label: 'Costo unitario', type: 'number', value: p.precio_costo ?? 0 },
        { name: 'precio_venta', label: 'Precio de venta', type: 'number', value: p.precio_venta ?? 0 },
        { name: 'precio_franquicia', label: 'Precio a franquicias', type: 'number', value: p.precio_franquicia ?? 0 },
        { name: 'activo', label: 'Estado', type: 'select', value: String(p.activo !== false), options: yesno },
      ] });
      if (!r) return;
      try { await db.saveProduct({ ...(p.id ? { id: p.id } : {}), ...r, obrador_id: r.obrador_id || null, area_id: r.area_id || null, categoria: area(r.area_id)?.nombre || null, factor_hiopos: r.factor_hiopos || 1, codigo: r.codigo || null, activo: r.activo === 'true' }); await loadMaestros(); toast('Producto guardado'); viewConfig(v); } catch (e) { err(e); }
    };
    $('#add').onclick = () => edit();
    $('#pq').oninput = (e) => drawP(e.target.value);
    drawP();
  }

  if (tab === 'users') {
    const users = await db.listProfiles();
    out.innerHTML = `${db.mode === 'supabase' ? '<div class="callout info"><span>Cada persona se registra desde la pantalla de ingreso. Después le asignás acá el rol y su obrador o local.</span></div>' : ''}
      <div class="card"><div class="card-head"><h2>Usuarios</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Obrador / local</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr><td><b>${esc(u.nombre)}</b></td><td>${esc(u.email)}</td><td>${u.rol === 'pendiente' ? '<span class="badge b-amber">Pendiente</span>' : esc(ROLES[u.rol])}</td><td>${esc(u.location_id ? locName(u.location_id) : '—')}</td><td class="num"><div class="btn-row" style="justify-content:flex-end">${db.mode === 'supabase' ? `<button class="btn sm" data-rp="${u.id}" title="Le manda un mail para elegir una contraseña nueva">Recuperar contraseña</button>` : ''}<button class="btn sm" data-e="${u.id}">Editar</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
    $$('[data-rp]').forEach((b) => (b.onclick = async () => {
      const u = users.find((x) => x.id === b.dataset.rp);
      if (!confirm(`¿Mandar a ${u.email} un mail para elegir una contraseña nueva?`)) return;
      b.disabled = true;
      try { await db.resetPassword(u.email); toast(`Mail de recupero enviado a ${u.email}`); } catch (e) { err(e); b.disabled = false; }
    }));
    $$('[data-e]').forEach((b) => (b.onclick = async () => {
      const u = users.find((x) => x.id === b.dataset.e);
      const r = await modalForm({ title: 'Editar usuario', fields: [
        { name: 'nombre', label: 'Nombre', value: u.nombre },
        { name: 'rol', label: 'Rol', type: 'select', value: u.rol, options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
        { name: 'location_id', label: 'Obrador / local', type: 'select', value: u.location_id || '', options: [{ value: '', label: '— (solo admin)' }, ...locs.map((l) => ({ value: l.id, label: `${l.nombre} (${l.tipo})` }))] },
      ] });
      if (!r) return;
      const l = locs.find((x) => x.id === r.location_id);
      if ((r.rol === 'obrador' || r.rol === 'local') && (!l || l.tipo !== r.rol)) return toast(`Un usuario de rol "${ROLES[r.rol]}" necesita un ${r.rol} asignado`, { err: true });
      try { await db.saveProfile({ id: u.id, ...r, location_id: r.location_id || null }); toast('Usuario actualizado'); viewConfig(v); } catch (e) { err(e); }
    }));
  }
}

// ======================================================================
function downloadCSV(name, rows) {
  const csv = '﻿' + rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

boot();
