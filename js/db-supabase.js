// Backend real: Supabase (Postgres + Auth + Realtime).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export async function createSupabaseDB(cfg) {
  // El link del mail de recupero vuelve con "#...type=recovery" (o con un error si venció).
  // Se lee antes de crear el cliente porque Supabase limpia la URL al procesarla.
  const hashInicial = location.hash;
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { flowType: 'implicit', detectSessionInUrl: true } });
  // Dirección a la que vuelve el mail: la misma página de la app, sin el #ruta
  const appUrl = location.origin + location.pathname;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  let profile = null;
  // Convierte un día local (YYYY-MM-DD) en rango ISO respetando la zona horaria del navegador
  const ini = (d) => new Date(d + 'T00:00:00').toISOString();
  const fin = (d) => new Date(d + 'T23:59:59.999').toISOString();

  async function loadProfile() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return (profile = null);
    profile = ok(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
    return profile;
  }

  // Paginado para tablas grandes (Supabase devuelve 1000 filas por defecto)
  async function all(query) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const rows = ok(await query().range(from, from + size - 1));
      out.push(...rows);
      if (rows.length < size) return out;
    }
  }

  return {
    mode: 'supabase',
    // ---- auth
    async getProfile() { return loadProfile(); },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? 'Mail o contraseña incorrectos. Si no la recordás, usá "¿Olvidaste tu contraseña?".' : error.message);
      return loadProfile();
    },
    async signUp(email, password, nombre) { ok(await sb.auth.signUp({ email, password, options: { data: { nombre } } })); return loadProfile(); },
    async signOut() { await sb.auth.signOut(); profile = null; },
    // ---- recupero de contraseña
    async recoveryState() {
      await sb.auth.getSession(); // espera a que Supabase procese el link del mail
      const p = new URLSearchParams(hashInicial.replace(/^#\/?/, ''));
      if (p.get('error_description')) return { error: p.get('error_description').replace(/\+/g, ' ') };
      return { recovery: p.get('type') === 'recovery' };
    },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl })); },
    async updatePassword(password) { ok(await sb.auth.updateUser({ password })); return loadProfile(); },

    // ---- maestros
    async listLocations() { return ok(await sb.from('locations').select('*').order('tipo').order('nombre')); },
    async saveLocation(l) {
      const { id, ...rest } = l;
      ok(id ? await sb.from('locations').update(rest).eq('id', id) : await sb.from('locations').insert(rest));
    },
    async listAreas() { return ok(await sb.from('areas').select('*').order('orden')); },
    async saveArea(a) {
      const { id, ...rest } = a;
      ok(id ? await sb.from('areas').update(rest).eq('id', id) : await sb.from('areas').insert(rest));
    },
    async listProducts() { return ok(await sb.from('products').select('*').order('nombre')); },
    async saveProduct(p) {
      const { id, ...rest } = p;
      ok(id ? await sb.from('products').update(rest).eq('id', id) : await sb.from('products').insert(rest));
    },
    async listAvisos() { return ok(await sb.from('location_avisos').select('*')); },
    async saveAvisos(a) { ok(await sb.from('location_avisos').upsert({ ...a, updated_at: new Date().toISOString() })); },
    async listProfiles() { return ok(await sb.from('profiles').select('*').order('created_at')); },
    async saveProfile(p) { const { id, rol, location_id, nombre } = p; ok(await sb.from('profiles').update({ rol, location_id, nombre }).eq('id', id)); },

    // ---- remitos
    async listRemitos({ desde, hasta } = {}) {
      let q = sb.from('remitos').select('*, remito_items(count)').order('numero', { ascending: false }).limit(500);
      if (desde) q = q.gte('creado_at', ini(desde));
      if (hasta) q = q.lte('creado_at', fin(hasta));
      return ok(await q).map((r) => ({ ...r, n_items: r.remito_items?.[0]?.count ?? 0 }));
    },
    async getRemito(id) {
      const r = ok(await sb.from('remitos').select('*, items:remito_items(*), eventos:remito_eventos(*)').eq('id', id).maybeSingle());
      if (r) r.eventos.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return r;
    },
    async createRemito({ despachar, items, ...rest }) {
      return ok(await sb.rpc('crear_remito', {
        p: { ...rest, items: items.map((i) => ({ product_id: i.product_id || null, descripcion: i.descripcion || null, unidad: i.unidad || null, cantidad: Number(i.cantidad), cortesia: !!i.cortesia, especial: !!i.especial })) },
        p_despachar: !!despachar,
      }));
    },
    async despacharRemito(id) { ok(await sb.rpc('despachar_remito', { p_id: id })); },
    async recibirRemito(id, items, obs, bultos) {
      return ok(await sb.rpc('recibir_remito', { p_id: id, p_items: items.map((i) => ({ id: i.id, cantidad_recibida: i.cantidad_recibida === '' ? null : Number(i.cantidad_recibida), obs: i.obs || '' })), p_obs: obs || '', p_bultos: bultos || null }));
    },
    async marcarLlegado(id) { ok(await sb.rpc('marcar_llegado', { p_id: id })); },
    async marcarFacturado(id, nro) { ok(await sb.rpc('marcar_facturado', { p_id: id, p_nro: nro || '' })); },
    async anularRemito(id, motivo) { ok(await sb.rpc('anular_remito', { p_id: id, p_motivo: motivo })); },
    async resolverDiferencia(id, tipo, obs) { ok(await sb.rpc('resolver_diferencia', { p_id: id, p_tipo: tipo, p_obs: obs || '' })); },
    // Renglones con diferencia (enviado ≠ recibido) de remitos recibidos en el período
    async listDiferencias(desde, hasta) {
      const rows = await all(() => sb.from('remito_items')
        .select('*, remitos!inner(id, numero, nro_area, area_id, origen_id, destino_id, estado, recibido_at, dif_resuelta_at, dif_tipo, dif_resolucion, facturado_at)')
        .eq('remitos.estado', 'con_diferencias')
        .gte('remitos.recibido_at', ini(desde)).lte('remitos.recibido_at', fin(hasta)).order('id'));
      return rows.filter((i) => i.cantidad_recibida != null && Number(i.cantidad_recibida) !== Number(i.cantidad_enviada))
        .map(({ remitos: r, ...i }) => ({ ...i, remito: r }));
    },
    async listEventos(limit = 30) { return ok(await sb.from('remito_eventos').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)); },

    // ---- contraste
    async listItemsDespachados(desde, hasta) {
      const rows = await all(() => sb.from('remito_items')
        .select('*, remitos!inner(destino_id, origen_id, area_id, estado, despachado_at, nro_area, numero, facturado_at, nro_factura, dif_tipo, dif_resuelta_at)')
        .gte('remitos.despachado_at', ini(desde)).lte('remitos.despachado_at', fin(hasta))
        .neq('remitos.estado', 'anulado').order('id'));
      return rows.map(({ remitos: r, ...i }) => ({ ...i, destino_id: r.destino_id, origen_id: r.origen_id, area_id: r.area_id, estado: r.estado, remito: { id: i.remito_id, ...r } }));
    },
    async listVentas(desde, hasta) {
      return all(() => sb.from('ventas').select('*').gte('fecha', desde).lte('fecha', hasta).order('id'));
    },
    async importVentas(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        ok(await sb.from('ventas').upsert(rows.slice(i, i + 500), { onConflict: 'fecha,location_id,codigo' }));
      }
      return rows.length;
    },

    // ---- sincronización HioPos (Bridge ICG)
    async hioposEstado() {
      const [aj, logs] = await Promise.all([sb.from('ajustes').select('*'), sb.from('sync_log').select('*').order('id', { ascending: false }).limit(8)]);
      return { ajustes: ok(aj), logs: ok(logs) };
    },
    async saveAjuste(clave, valor) { ok(await sb.from('ajustes').upsert({ clave, valor, updated_at: new Date().toISOString() })); },
    async guardarCredHiopos(email, password) { ok(await sb.rpc('guardar_credenciales_hiopos', { p_email: email, p_password: password })); },
    async hioposSync(body) {
      const { data, error } = await sb.functions.invoke('sync-hiopos', { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error || msg; } catch {}
        throw new Error(msg);
      }
      return data;
    },

    // ---- tiempo real
    subscribe(cb) {
      const ch = sb.channel('remitos-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'remito_eventos' }, (p) => {
          const e = p.new; cb({ tipo: e.tipo, numero: e.remito_numero, label: e.remito_label, detalle: e.detalle, usuario_nombre: e.usuario_nombre, remito_id: e.remito_id });
        })
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
