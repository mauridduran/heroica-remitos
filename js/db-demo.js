// Backend DEMO: guarda todo en el navegador (localStorage) y sincroniza en
// tiempo real entre pestañas abiertas. Misma interfaz que db-supabase.js.

import { AREAS, PRODUCTOS } from './catalogo.js';

const KEY = 'remitos_demo_v4';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
const clone = (o) => JSON.parse(JSON.stringify(o));
// Día local (YYYY-MM-DD) de una fecha ISO
const dia = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const pad4 = (n) => String(n).padStart(4, '0');
export const labelOf = (r, areas) => { const a = areas.find((x) => x.id === r.area_id); return (a ? a.prefijo : '0000') + '-' + pad4(r.nro_area ?? r.numero); };

function seed() {
  const r = rng(42);
  const L = (nombre, tipo) => ({ id: uid(), nombre, tipo, codigo_hiopos: '', activo: true });
  const obG = L('Obrador Guemes (Rosario)', 'obrador');
  const obP = L('Obrador Palermo (Buenos Aires)', 'obrador');
  const LR = (nombre, ob) => ({ ...L(nombre, 'local'), obrador_id: ob.id });
  const locs = [obG, obP, LR('Guemes', obG), LR('Funes', obG), LR('Florida', obG), LR('Alto Rosario', obG), LR('Centro', obG), LR('DOT', obP)];
  const locales = locs.filter((l) => l.tipo === 'local');
  const localesG = locales.filter((l) => l.obrador_id === obG.id);

  const areas = AREAS.map((a, i) => ({ id: uid(), codigo: a.codigo, nombre: a.nombre, prefijo: a.prefijo, orden: i, activo: true }));
  const areaBy = Object.fromEntries(areas.map((a) => [a.codigo, a]));
  const products = PRODUCTOS.map((p) => {
    const terminado = p.seccion === 'terminado';
    const costo = Math.round((terminado ? 600 + r() * 2400 : 1500 + r() * 6000) / 50) * 50;
    return { id: uid(), codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, seccion: p.seccion, categoria: areaBy[p.area].nombre,
      area_id: areaBy[p.area].id, obrador_id: null, factor_hiopos: 1, codigo_hiopos: terminado ? p.codigo : '',
      precio_costo: costo, precio_venta: terminado ? Math.round((costo * 3) / 100) * 100 : 0, activo: true };
  });

  const profiles = [
    { id: 'u-admin', nombre: 'Administración', email: 'admin@demo', rol: 'admin', location_id: null },
    { id: 'u-obg', nombre: 'Encargado Obrador Guemes', email: 'obrador.guemes@demo', rol: 'obrador', location_id: obG.id },
    { id: 'u-obp', nombre: 'Encargado Obrador Palermo', email: 'obrador.palermo@demo', rol: 'obrador', location_id: obP.id },
    ...locales.map((l, i) => ({ id: 'u-loc' + i, nombre: 'Encargado ' + l.nombre, email: 'local' + i + '@demo', rol: 'local', location_id: l.id })),
  ];
  const nameOf = (id) => profiles.find((p) => p.id === id)?.nombre;
  const CHOFERES = ['Valentín', 'Jesús', 'Germán', 'Lucas'];

  const remitos = [], items = [], eventos = [];
  const ventasMap = new Map();
  const nros = { LAM: 1060, PAS: 850, PAN: 900, COC: 840, GEN: 1 };
  let numero = 1;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = (d, h, m = 0) => { const x = new Date(today); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const ev = (rem, tipo, detalle, user, at) => eventos.push({ id: eventos.length + 1, remito_id: rem.id, remito_numero: rem.numero, remito_label: labelOf(rem, areas), tipo, detalle, usuario_id: user, usuario_nombre: nameOf(user), created_at: at });
  const vender = (fecha, loc, p, cant) => {
    if (cant <= 0) return;
    const k = fecha + '|' + loc + '|' + p.id;
    const v = ventasMap.get(k) || { fecha, location_id: loc, product_id: p.id, codigo: p.codigo_hiopos, descripcion: p.nombre, cantidad: 0, importe: 0, fuente: 'demo' };
    v.cantidad += cant; v.importe += cant * p.precio_venta; ventasMap.set(k, v);
  };

  for (let d = 20; d >= 0; d--) {
    for (const [ai, ac] of ['LAM', 'PAS', 'PAN', 'COC'].entries()) {
      const area = areaBy[ac];
      const delArea = products.filter((p) => p.area_id === area.id);
      for (const [li, loc] of localesG.entries()) {
        const pick = delArea.filter((p) => (p.seccion === 'terminado' ? r() < 0.55 : r() < 0.12));
        if (!pick.length) continue;
        const h = 6 + ai, m = li * 6;
        const rem = {
          id: uid(), numero: numero++, origen_id: obG.id, destino_id: loc.id, area_id: area.id, nro_area: nros[ac]++,
          nro_papel: '', entregado_por: CHOFERES[(d + li) % CHOFERES.length], bultos: { tappers: Math.floor(r() * 5), latas: Math.floor(r() * 4), bowls: Math.floor(r() * 3) }, bultos_recibidos: null,
          estado: 'borrador', observaciones: '', obs_recepcion: '', anulado_motivo: '',
          creado_por: 'u-obg', creado_at: day(d, h, m), despachado_por: null, despachado_at: null, recibido_por: null, recibido_at: null,
        };
        const its = pick.map((p) => ({
          id: uid(), remito_id: rem.id, product_id: p.id, descripcion: null, unidad: null, cortesia: false, especial: false,
          cantidad_enviada: p.unidad === 'kg' ? Math.round((1 + r() * 4) * 2) / 2 : Math.max(1, Math.round(4 + r() * 20)), cantidad_recibida: null, obs: '',
        }));
        if (ac === 'PAN' && r() < 0.15) its.push({ id: uid(), remito_id: rem.id, product_id: null, descripcion: 'Panetone', unidad: 'u', cortesia: true, especial: false, cantidad_enviada: 2, cantidad_recibida: null, obs: '' });
        items.push(...its);
        ev(rem, 'creado', its.length + ' productos', 'u-obg', rem.creado_at);
        rem.estado = 'en_transito'; rem.despachado_por = 'u-obg'; rem.despachado_at = day(d, h, m + 20);
        ev(rem, 'despachado', null, 'u-obg', rem.despachado_at);
        if (d > 0 || li === 0) {
          const locUser = 'u-loc' + locales.indexOf(loc);
          let dif = 0;
          for (const it of its) {
            it.cantidad_recibida = it.cantidad_enviada;
            if (r() < 0.05) { it.cantidad_recibida = Math.max(0, it.cantidad_enviada - 1 - Math.floor(r() * 2)); it.obs = r() < 0.5 ? 'Llegaron dañados' : 'Faltante'; dif++; }
          }
          rem.bultos_recibidos = { ...rem.bultos };
          rem.estado = dif ? 'con_diferencias' : 'recibido';
          rem.recibido_por = locUser; rem.recibido_at = day(d, h + 2, m + 10);
          ev(rem, rem.estado, dif ? dif + ' productos con diferencia' : 'Todo OK', locUser, rem.recibido_at);
          // ventas HioPos: se vende entre 70% y 100% de lo recibido, repartido en el día y el siguiente
          if (d > 0) for (const it of its) {
            const p = products.find((x) => x.id === it.product_id);
            if (!p || p.seccion !== 'terminado') continue;
            const total = Math.round(it.cantidad_recibida * (0.7 + r() * 0.3));
            const hoyV = Math.round(total * 0.75);
            vender(dia(day(d, 12)), loc.id, p, hoyV);
            if (d > 1) vender(dia(day(d - 1, 12)), loc.id, p, total - hoyV);
          }
        }
        remitos.push(rem);
      }
    }
  }
  // un borrador sin despachar
  const b = { id: uid(), numero: numero++, origen_id: obG.id, destino_id: locales[2].id, area_id: areaBy.GEN.id, nro_area: nros.GEN++, nro_papel: '', entregado_por: '', bultos: {}, bultos_recibidos: null, estado: 'borrador', observaciones: 'Insumos extra', obs_recepcion: '', anulado_motivo: '', creado_por: 'u-obg', creado_at: day(0, 7, 40), despachado_por: null, despachado_at: null, recibido_por: null, recibido_at: null };
  remitos.push(b);
  const lechuga = products.find((p) => p.nombre === 'Lechuga');
  items.push({ id: uid(), remito_id: b.id, product_id: lechuga.id, descripcion: null, unidad: null, cortesia: false, especial: false, cantidad_enviada: 2, cantidad_recibida: null, obs: '' });
  items.push({ id: uid(), remito_id: b.id, product_id: null, descripcion: 'Servilletas', unidad: 'paquete', cortesia: false, especial: false, cantidad_enviada: 10, cantidad_recibida: null, obs: '' });
  ev(b, 'creado', '2 productos', 'u-obg', b.creado_at);

  const ventas = [...ventasMap.values()].map((v, i) => ({ ...v, id: i + 1 }));
  return { version: 2, locations: locs, areas, products, profiles, remitos, items, eventos, ventas, nextNumero: numero };
}

export function createDemoDB() {
  const load = () => { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {} return null; };
  let data = load();
  if (!data) { data = seed(); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }

  const subs = new Set();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('remitos_demo') : null;
  const notify = (evt) => subs.forEach((f) => { try { f(evt); } catch (e) { console.error(e); } });
  if (bc) bc.onmessage = (m) => { data = load() || data; notify(m.data); };

  const save = (evt) => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.warn('No se pudo guardar', e); }
    if (bc && evt) bc.postMessage(evt);
  };

  let me = null;
  try { const id = sessionStorage.getItem('demo_user'); me = data.profiles.find((p) => p.id === id) || null; } catch {}

  const fail = (msg) => { throw new Error(msg); };
  const loc = (id) => data.locations.find((l) => l.id === id);
  const event = (rem, tipo, detalle) => {
    const e = { id: data.eventos.length + 1, remito_id: rem.id, remito_numero: rem.numero, remito_label: labelOf(rem, data.areas), tipo, detalle, usuario_id: me?.id, usuario_nombre: me?.nombre, created_at: new Date().toISOString() };
    data.eventos.push(e);
    return { tipo, numero: rem.numero, label: e.remito_label, detalle, usuario_nombre: me?.nombre, remito_id: rem.id };
  };
  const canSee = (r) => me.rol === 'admin' || (me.rol === 'obrador' && r.origen_id === me.location_id) || (me.rol === 'local' && r.destino_id === me.location_id);

  return {
    mode: 'demo',
    // ---- auth
    async getProfile() { return me ? clone(me) : null; },
    async demoUsers() { return clone(data.profiles); },
    async signInDemo(id) { me = data.profiles.find((p) => p.id === id); sessionStorage.setItem('demo_user', id); return clone(me); },
    async signOut() { me = null; sessionStorage.removeItem('demo_user'); },
    async resetDemo() { localStorage.removeItem(KEY); data = seed(); save({ tipo: 'reset' }); },

    // ---- maestros
    async listLocations() { return clone(data.locations); },
    async saveLocation(l) {
      if (me.rol !== 'admin') fail('Solo admin');
      if (l.id) Object.assign(loc(l.id), l); else data.locations.push({ ...l, id: uid(), activo: true });
      save({ tipo: 'maestros' });
    },
    async listAreas() { return clone(data.areas.sort((a, b) => a.orden - b.orden)); },
    async saveArea(a) {
      if (me.rol !== 'admin') fail('Solo admin');
      if (a.id) Object.assign(data.areas.find((x) => x.id === a.id), a); else data.areas.push({ ...a, id: uid(), activo: true, orden: data.areas.length });
      save({ tipo: 'maestros' });
    },
    async listProducts() { return clone(data.products); },
    async saveProduct(p) {
      if (me.rol !== 'admin') fail('Solo admin');
      if (p.codigo && data.products.some((x) => x.codigo === p.codigo && x.id !== p.id)) fail('Ya existe un producto con ese código');
      if (p.id) Object.assign(data.products.find((x) => x.id === p.id), p); else data.products.push({ ...p, id: uid(), activo: true });
      save({ tipo: 'maestros' });
    },
    async listAvisos() { return clone(data.avisos || []); },
    async saveAvisos(a) {
      if (me.rol !== 'admin') fail('Solo admin');
      data.avisos = (data.avisos || []).filter((x) => x.location_id !== a.location_id).concat([a]);
      save({ tipo: 'maestros' });
    },
    async listProfiles() { return clone(data.profiles); },
    async saveProfile(p) { if (me.rol !== 'admin') fail('Solo admin'); Object.assign(data.profiles.find((x) => x.id === p.id), p); save({ tipo: 'maestros' }); },

    // ---- remitos
    async listRemitos({ desde, hasta } = {}) {
      return clone(data.remitos.filter((r) => canSee(r)
        && (!desde || dia(r.creado_at) >= desde)
        && (!hasta || dia(r.creado_at) <= hasta)).map((r) => ({
        ...r, n_items: data.items.filter((i) => i.remito_id === r.id).length,
      })).sort((a, b) => b.numero - a.numero));
    },
    async getRemito(id) {
      const r = data.remitos.find((x) => x.id === id);
      if (!r || !canSee(r)) return null;
      return clone({ ...r, items: data.items.filter((i) => i.remito_id === id), eventos: data.eventos.filter((e) => e.remito_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)) });
    },
    async createRemito({ origen_id, destino_id, area_id, observaciones, nro_papel, entregado_por, bultos, items, despachar }) {
      if (!['admin', 'obrador'].includes(me.rol)) fail('No tenés permiso para crear remitos');
      if (me.rol === 'obrador' && origen_id !== me.location_id) fail('Solo podés crear remitos desde tu obrador');
      if (loc(origen_id)?.tipo !== 'obrador') fail('El origen debe ser un obrador');
      if (loc(destino_id)?.tipo !== 'local') fail('El destino debe ser un local');
      const its = items.filter((i) => Number(i.cantidad) > 0 && (i.product_id || (i.descripcion || '').trim()));
      if (!its.length) fail('El remito no tiene productos');
      const now = new Date().toISOString();
      const nro_area = 1 + Math.max(0, ...data.remitos.filter((r) => r.origen_id === origen_id && (r.area_id || null) === (area_id || null)).map((r) => r.nro_area || 0));
      const rem = { id: uid(), numero: data.nextNumero++, origen_id, destino_id, area_id: area_id || null, nro_area, nro_papel: nro_papel || '', entregado_por: entregado_por || '', bultos: bultos || {}, bultos_recibidos: null, estado: 'borrador', observaciones: observaciones || '', obs_recepcion: '', anulado_motivo: '', creado_por: me.id, creado_at: now, despachado_por: null, despachado_at: null, recibido_por: null, recibido_at: null };
      data.remitos.push(rem);
      its.forEach((i) => data.items.push({ id: uid(), remito_id: rem.id, product_id: i.product_id || null, descripcion: i.descripcion || null, unidad: i.unidad || null, cortesia: !!i.cortesia, especial: !!i.especial, cantidad_enviada: Number(i.cantidad), cantidad_recibida: null, obs: '' }));
      let evt = event(rem, 'creado', its.length + ' productos');
      if (despachar) { rem.estado = 'en_transito'; rem.despachado_por = me.id; rem.despachado_at = now; evt = event(rem, 'despachado', null); }
      save(evt);
      return rem.id;
    },
    async despacharRemito(id) {
      const r = data.remitos.find((x) => x.id === id);
      if (!['admin', 'obrador'].includes(me.rol) || (me.rol === 'obrador' && r.origen_id !== me.location_id)) fail('No tenés permiso');
      if (r.estado !== 'borrador') fail('El remito ya fue despachado');
      r.estado = 'en_transito'; r.despachado_por = me.id; r.despachado_at = new Date().toISOString();
      save(event(r, 'despachado', null));
    },
    async recibirRemito(id, items, obs, bultos) {
      const r = data.remitos.find((x) => x.id === id);
      if (!(me.rol === 'admin' || (me.rol === 'local' && r.destino_id === me.location_id))) fail('No tenés permiso para recibir este remito');
      if (r.estado !== 'en_transito') fail('El remito no está en tránsito');
      const mine = data.items.filter((i) => i.remito_id === id);
      for (const i of mine) {
        const x = items.find((y) => y.id === i.id);
        if (!x || x.cantidad_recibida === '' || x.cantidad_recibida == null || isNaN(Number(x.cantidad_recibida))) fail('Falta cargar la cantidad recibida de algún producto');
      }
      let dif = 0;
      for (const i of mine) {
        const x = items.find((y) => y.id === i.id);
        i.cantidad_recibida = Number(x.cantidad_recibida); i.obs = x.obs || '';
        if (i.cantidad_recibida !== i.cantidad_enviada) dif++;
      }
      r.estado = dif ? 'con_diferencias' : 'recibido'; r.recibido_por = me.id; r.recibido_at = new Date().toISOString(); r.obs_recepcion = obs || ''; r.bultos_recibidos = bultos || null;
      save(event(r, r.estado, dif ? dif + ' productos con diferencia' : 'Todo OK'));
      return r.estado;
    },
    async anularRemito(id, motivo) {
      const r = data.remitos.find((x) => x.id === id);
      if (!(me.rol === 'admin' || (me.rol === 'obrador' && r.origen_id === me.location_id && ['borrador', 'en_transito'].includes(r.estado)))) fail('No tenés permiso para anular este remito');
      if (r.estado === 'anulado') fail('Ya está anulado');
      r.estado = 'anulado'; r.anulado_motivo = motivo;
      save(event(r, 'anulado', motivo));
    },
    async listEventos(limit = 30) {
      return clone(data.eventos.filter((e) => { const r = data.remitos.find((x) => x.id === e.remito_id); return r && canSee(r); })
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, limit));
    },

    // ---- contraste: items despachados en el período (con destino) + ventas
    async listItemsDespachados(desde, hasta) {
      const rs = data.remitos.filter((r) => canSee(r) && r.despachado_at && r.estado !== 'anulado'
        && dia(r.despachado_at) >= desde && dia(r.despachado_at) <= hasta);
      const byId = new Map(rs.map((r) => [r.id, r]));
      return clone(data.items.filter((i) => byId.has(i.remito_id)).map((i) => ({ ...i, destino_id: byId.get(i.remito_id).destino_id, area_id: byId.get(i.remito_id).area_id, estado: byId.get(i.remito_id).estado })));
    },
    async listVentas(desde, hasta) {
      return clone(data.ventas.filter((v) => v.fecha >= desde && v.fecha <= hasta && (me.rol === 'admin' || v.location_id === me.location_id)));
    },
    async importVentas(rows) {
      if (me.rol !== 'admin') fail('Solo admin puede importar ventas');
      let n = 0;
      for (const row of rows) {
        const ex = data.ventas.find((v) => v.fecha === row.fecha && v.location_id === row.location_id && v.codigo === row.codigo);
        if (ex) Object.assign(ex, row); else data.ventas.push({ ...row, id: data.ventas.length + 1 });
        n++;
      }
      save({ tipo: 'ventas', detalle: n + ' líneas importadas' });
      return n;
    },

    // ---- tiempo real
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}
