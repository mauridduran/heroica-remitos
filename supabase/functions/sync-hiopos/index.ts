// Edge Function "sync-hiopos"
// Trae las ventas por artículo de HioPos (Bridge ICG / HiOffice) y las guarda en la tabla ventas.
//
//   modo "automatica"  → la llama pg_cron 4 veces por día: sincroniza los últimos 3 días.
//   modo "manual"      → botón "Sincronizar ahora" (solo administración): rango desde/hasta.
//   modo "probar"      → solo administración: hace login + export y devuelve columnas y una muestra, sin guardar.
//
// Flujo del Bridge (ver "Manual Bridge Desarrollador"):
//   1. GET  https://cloudlicense.icg.eu/services/cloud/getCustomerWithAuthToken?email&password  → XML con address + authToken
//   2. POST https://<address>/ErpCloud/exportation/launch  {exportationId, startDate, endDate, filters: []}
//      → [ { exportedDocs: [ { data: base64, type: 4 (json) } ] } ]
//   3. GET  https://<address>/ErpCloud/session/logout   (siempre)
//
// Credenciales: Supabase Vault (hiopos_email / hiopos_password), leídas con credenciales_hiopos() (solo service_role).
// GUID del dashboard de exportación: tabla ajustes, clave "hiopos_export_id".
// Mapeo de columnas: automático por nombre; se puede forzar con ajustes "hiopos_columnas" (JSON {fecha, tienda, codigo, descripcion, cantidad, importe}).

import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const dia = (d: Date) => d.toISOString().slice(0, 10);
const diaAR = (offsetDias = 0) => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() + offsetDias); return dia(d); };

// Columnas posibles en el export (por nombre, sin acentos ni mayúsculas)
const GUESS: Record<string, string[]> = {
  fecha: ["fecha", "fecha documento", "fecha doc", "dia", "date"],
  tienda: ["tienda", "almacen", "local", "sucursal", "establecimiento", "serie", "caja"],
  codigo: ["referencia", "codigo articulo", "cod articulo", "codigo", "cod", "ref", "plu", "id articulo"],
  descripcion: ["articulo", "descripcion", "producto", "nombre", "detalle"],
  cantidad: ["unidades", "cantidad", "uds", "cant", "unid"],
  importe: ["total neto", "importe", "total", "neto", "venta", "monto", "facturado"],
};

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{3}$/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function parseFecha(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d{12,13}$/.test(String(v))) return dia(new Date(Number(v) - 3 * 3600e3));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const d = new Date(s); // "Mon Jul 11 00:00:00 CEST 2016"
  return isNaN(+d) ? null : dia(new Date(d.getTime() + 12 * 3600e3));
}

// ICG emite números con coma de miles (43,500.06) que rompen el JSON: se limpian fuera de los strings
function sanitizar(txt: string): string {
  return txt.split(/("(?:[^"\\]|\\.)*")/g).map((part, i) => (i % 2 ? part : part.replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1"))).join("");
}

function decodeB64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// Convierte lo exportado en una lista de objetos {columna: valor}
function aFilas(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    if (parsed.length && typeof parsed[0] === "object" && !Array.isArray(parsed[0])) return parsed as Record<string, unknown>[];
    return [];
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    // formato {headers:[...], rows:[[...]]}
    if (Array.isArray(o.rows) && Array.isArray(o.headers)) {
      const hs = (o.headers as any[]).filter(Boolean).map((h, i) => h?.name || h?.attributeName || h?.metricName || `col${i + 1}`);
      return (o.rows as any[][]).map((r) => Object.fromEntries(hs.map((h, i) => [h, r[r.length - hs.length + i]])));
    }
    for (const v of Object.values(o)) if (Array.isArray(v)) { const f = aFilas(v); if (f.length) return f; }
  }
  return [];
}

function elegirColumnas(cols: string[], forzado: Record<string, string> = {}) {
  const map: Record<string, string | null> = {};
  const usadas = new Set<string>();
  for (const k of Object.keys(GUESS)) {
    if (forzado[k] && cols.includes(forzado[k])) { map[k] = forzado[k]; usadas.add(forzado[k]); continue; }
    let elegida: string | null = null;
    for (const w of GUESS[k]) {
      elegida = cols.find((c) => !usadas.has(c) && norm(c) === w) || cols.find((c) => !usadas.has(c) && norm(c).includes(w)) || null;
      if (elegida) break;
    }
    map[k] = elegida;
    if (elegida) usadas.add(elegida);
  }
  return map;
}

async function login(email: string, password: string) {
  const url = `https://cloudlicense.icg.eu/services/cloud/getCustomerWithAuthToken?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&isoCode=ES`;
  const r = await fetch(url);
  const xml = await r.text();
  const tag = (t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim() || "";
  if (/<serverError>/.test(xml)) {
    const code = tag("code");
    throw new Error(code === "6" ? "HioPos rechazó el usuario o la contraseña (error 6)" : `HioPos respondió error ${code}: ${tag("message")}`);
  }
  const address = tag("address"), token = tag("authToken");
  if (!address || !token) throw new Error(`Respuesta inesperada del login de HioPos (HTTP ${r.status})`);
  const secure = tag("secure") !== "false";
  const port = tag("port");
  const base = `${secure ? "https" : "http"}://${address}${port && !["443", "80"].includes(port) ? ":" + port : ""}`;
  return { base, token };
}

async function exportar(base: string, token: string, exportationId: string, desde: string, hasta: string) {
  const r = await fetch(`${base}/ErpCloud/exportation/launch`, {
    method: "POST",
    headers: { "x-auth-token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ exportationId, startDate: desde, endDate: hasta, filters: [] }),
  });
  if (r.status === 401) throw new Error("La sesión de HioPos se cerró (401). Volvé a intentar.");
  const txt = await r.text();
  if (!r.ok) throw new Error(`El export de HioPos respondió HTTP ${r.status}: ${txt.slice(0, 200)}`);
  if (!txt.length) throw new Error("HioPos devolvió una respuesta vacía: revisá el GUID del export o los filtros del dashboard.");
  const resp = JSON.parse(txt);
  const docs = (Array.isArray(resp) ? resp : [resp]).flatMap((x: any) => x?.exportedDocs || []);
  const filas: Record<string, unknown>[] = [];
  const tipos = docs.map((d: any) => d.type);
  for (const d of docs) {
    if (d.type !== 4 || !d.data) continue; // 4 = JSON
    filas.push(...aFilas(JSON.parse(sanitizar(decodeB64(d.data)))));
  }
  return { filas, docs: docs.length, tipos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  let body: any = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const modo = ["manual", "probar"].includes(body.modo) ? body.modo : "automatica";

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // "manual" y "probar" solo para administración (la automática solo sincroniza, no devuelve datos)
  if (modo !== "automatica") {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    const { data: p } = u?.user ? await sb.from("profiles").select("rol").eq("id", u.user.id).maybeSingle() : { data: null };
    if (p?.rol !== "admin") return json({ ok: false, error: "Solo administración puede sincronizar a mano" }, 403);
  }

  const okF = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const desde = okF(body.desde) ? body.desde : diaAR(-3);
  const hasta = okF(body.hasta) ? body.hasta : diaAR(0);

  const { data: log } = await sb.from("sync_log").insert({ origen: modo === "probar" ? "prueba" : modo, desde, hasta }).select("id").single();
  const terminar = async (res: Record<string, unknown>) => {
    if (log?.id) await sb.from("sync_log").update({ fin: new Date().toISOString(), ok: !!res.ok, filas: res.filas ?? null, guardadas: res.guardadas ?? null, detalle: res }).eq("id", log.id);
    return json(res, res.ok ? 200 : 500);
  };

  const { data: aj } = await sb.from("ajustes").select("clave, valor").in("clave", ["hiopos_export_id", "hiopos_columnas"]);
  const ajuste = (k: string) => aj?.find((a) => a.clave === k)?.valor || "";
  const exportationId = ajuste("hiopos_export_id").trim();
  let forzado: Record<string, string> = {};
  try { forzado = JSON.parse(ajuste("hiopos_columnas") || "{}"); } catch { /* sin mapeo forzado */ }

  const { data: cred } = await sb.rpc("credenciales_hiopos");
  if (!cred?.email || !cred?.password) return await terminar({ ok: false, error: "Faltan el usuario y la contraseña de HioPos (Ventas HioPos → Sincronización)." });
  if (!exportationId) return await terminar({ ok: false, error: "Falta el GUID del dashboard de exportación de HioPos (Ventas HioPos → Sincronización)." });

  let sesion: { base: string; token: string } | null = null;
  try {
    sesion = await login(cred.email, cred.password);
    const { filas, docs, tipos } = await exportar(sesion.base, sesion.token, exportationId, desde, hasta);
    const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))];
    const map = elegirColumnas(cols, forzado);

    if (modo === "probar") {
      return await terminar({ ok: true, prueba: true, desde, hasta, docs, tipos, filas: filas.length, columnas: cols, mapeo: map, muestra: filas.slice(0, 5) });
    }
    const faltan = ["fecha", "tienda", "cantidad"].filter((k) => !map[k]);
    if (filas.length && faltan.length) return await terminar({ ok: false, error: `No encontré en el export las columnas: ${faltan.join(", ")}`, columnas: cols, mapeo: map, filas: filas.length });
    if (!map.codigo && !map.descripcion) return await terminar({ ok: false, error: "El export no trae código ni descripción del artículo", columnas: cols, mapeo: map });

    const [{ data: locs }, { data: prods }] = await Promise.all([
      sb.from("locations").select("id, nombre, tipo, codigo_hiopos, activo"),
      sb.from("products").select("id, codigo, codigo_hiopos, nombre"),
    ]);
    const sedes = (locs || []).filter((l) => l.activo !== false);
    const corto = (l: any) => (l.tipo === "obrador" ? l.nombre.replace(/\s*\(.*\)\s*$/, "").replace(/^obrador\s+/i, "") : l.nombre);
    const cacheLoc = new Map<string, string | null>();
    const matchLoc = (v: unknown) => {
      const n = norm(v);
      if (!n) return null;
      if (cacheLoc.has(n)) return cacheLoc.get(n)!;
      const l = sedes.find((x) => x.codigo_hiopos && norm(x.codigo_hiopos) === n) || sedes.find((x) => norm(x.nombre) === n || norm(corto(x)) === n)
        || sedes.find((x) => x.codigo_hiopos && n.includes(norm(x.codigo_hiopos))) || sedes.find((x) => n.includes(norm(corto(x))));
      cacheLoc.set(n, l?.id || null);
      return l?.id || null;
    };
    const matchProd = (cod: string, desc: string) => {
      const c = norm(cod), d = norm(desc);
      return (prods || []).find((p) => (c && (norm(p.codigo_hiopos) === c || norm(p.codigo) === c)) || (d && norm(p.nombre) === d))?.id || null;
    };

    const agg = new Map<string, any>();
    const sinTienda = new Map<string, number>();
    let sinFecha = 0;
    for (const f of filas) {
      const fecha = parseFecha(f[map.fecha!]);
      if (!fecha) { sinFecha++; continue; }
      const tiendaTxt = String(f[map.tienda!] ?? "").trim();
      const location_id = matchLoc(tiendaTxt);
      if (!location_id) { sinTienda.set(tiendaTxt || "(vacío)", (sinTienda.get(tiendaTxt || "(vacío)") || 0) + 1); continue; }
      const cod = map.codigo ? String(f[map.codigo] ?? "").trim() : "";
      const desc = map.descripcion ? String(f[map.descripcion] ?? "").trim() : "";
      const codigo = cod || desc;
      if (!codigo) continue;
      const k = `${fecha}|${location_id}|${codigo}`;
      const x = agg.get(k) || { fecha, location_id, codigo, descripcion: desc, product_id: matchProd(cod, desc), cantidad: 0, importe: 0, fuente: "hiopos-api" };
      x.cantidad += parseNum(f[map.cantidad!]);
      x.importe += map.importe ? parseNum(f[map.importe]) : 0;
      agg.set(k, x);
    }
    const rows = [...agg.values()].map((x) => ({ ...x, cantidad: Math.round(x.cantidad * 1000) / 1000, importe: Math.round(x.importe * 100) / 100 }));

    // Reemplaza lo sincronizado antes en el rango, para las sedes que vinieron en el export
    const sedesConDatos = [...new Set(rows.map((r) => r.location_id))];
    if (sedesConDatos.length) {
      const { error: e1 } = await sb.from("ventas").delete().eq("fuente", "hiopos-api").gte("fecha", desde).lte("fecha", hasta).in("location_id", sedesConDatos);
      if (e1) throw new Error("No pude limpiar las ventas anteriores: " + e1.message);
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e2 } = await sb.from("ventas").upsert(rows.slice(i, i + 500), { onConflict: "fecha,location_id,codigo" });
      if (e2) throw new Error("No pude guardar las ventas: " + e2.message);
    }
    return await terminar({
      ok: true, desde, hasta, filas: filas.length, guardadas: rows.length,
      sin_producto: rows.filter((r) => !r.product_id).length, sin_fecha: sinFecha,
      sin_tienda: Object.fromEntries(sinTienda), sedes: sedesConDatos.length, mapeo: map,
    });
  } catch (e) {
    return await terminar({ ok: false, error: (e as Error).message });
  } finally {
    if (sesion) { try { await fetch(`${sesion.base}/ErpCloud/session/logout`, { headers: { "x-auth-token": sesion.token } }); } catch { /* ignorar */ } }
  }
});
