// Edge Function "aviso-despacho"
// La dispara un trigger de la base en dos momentos:
//   tipo "despacho"  → el obrador despachó: avisa al local destino, al obrador y a administración.
//   tipo "recepcion" → el local confirmó lo que llegó: avisa al obrador y a administración (con diferencias).
// Manda mail (Resend) y WhatsApp (CallMeBot), y deja registrado en el historial del remito a quién se avisó.
//
// Clave de Resend (permiso de envío para mheroica.com): secreto RESEND_API_KEY de la función
// o, si no está, guardada cifrada en Supabase Vault con el nombre "resend_api_key".
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente.

import { createClient } from "jsr:@supabase/supabase-js@2";

const APP_URL = "https://mauridduran.github.io/heroica-remitos/";
const FROM = "Heroica Remitos <remitos@mheroica.com>";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fmtQ = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 }));
const emails = (s: unknown) => String(s ?? "").split(/[,;\s]+/).map((m) => m.trim().toLowerCase()).filter((m) => m.includes("@"));

Deno.serve(async (req) => {
  let remito_id: string | undefined;
  let tipo = "despacho";
  try {
    const body = await req.json();
    remito_id = body.remito_id;
    if (body.tipo === "recepcion") tipo = "recepcion";
  } catch { /* sin cuerpo */ }
  if (!remito_id) return json({ error: "falta remito_id" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: r, error } = await sb
    .from("remitos")
    .select("*, items:remito_items(*), area:areas(nombre, prefijo)")
    .eq("id", remito_id)
    .maybeSingle();
  if (error || !r) return json({ error: error?.message || "remito inexistente" }, 404);
  if (tipo === "despacho" && (r.estado === "borrador" || r.estado === "anulado")) return json({ skip: "no despachado" });
  if (tipo === "recepcion" && !["recibido", "con_diferencias"].includes(r.estado)) return json({ skip: "no recibido" });

  // Se reserva el aviso en forma atómica: si ya se avisó (o otro llamado ganó), no se repite.
  const marca = tipo === "despacho" ? "aviso_enviado_at" : "aviso_recepcion_at";
  const { data: claimed } = await sb
    .from("remitos")
    .update({ [marca]: new Date().toISOString() })
    .eq("id", r.id)
    .is(marca, null)
    .select("id");
  if (!claimed?.length) return json({ skip: "ya avisado" });

  const label = `${r.area?.prefijo ?? "0000"}-${String(r.nro_area ?? r.numero).padStart(4, "0")}`;
  const areaNombre = r.area?.nombre ?? "";

  const [{ data: locs }, { data: avisosTodos }, { data: perfiles }] = await Promise.all([
    sb.from("locations").select("id, nombre").in("id", [r.origen_id, r.destino_id]),
    sb.from("location_avisos").select("*").in("location_id", [r.origen_id, r.destino_id]),
    sb.from("profiles").select("email, nombre, rol, location_id, id"),
  ]);
  const avLocal = avisosTodos?.find((a) => a.location_id === r.destino_id);
  const avObrador = avisosTodos?.find((a) => a.location_id === r.origen_id);
  const locName = (id: string) => locs?.find((l) => l.id === id)?.nombre ?? "";
  const origen = locName(r.origen_id);
  const destino = locName(r.destino_id);
  const nombre = (id: string | null) => perfiles?.find((p) => p.id === id)?.nombre ?? "";

  // Productos
  const prodIds = r.items.filter((i: any) => i.product_id).map((i: any) => i.product_id);
  const { data: prods } = prodIds.length
    ? await sb.from("products").select("id, nombre, unidad").in("id", prodIds)
    : { data: [] as any[] };
  const items = r.items.map((i: any) => {
    const p = prods?.find((x) => x.id === i.product_id);
    const dif = i.cantidad_recibida == null ? null : i.cantidad_recibida - i.cantidad_enviada;
    return {
      nombre: p?.nombre ?? i.descripcion ?? "", unidad: p?.unidad ?? i.unidad ?? "",
      enviada: i.cantidad_enviada, recibida: i.cantidad_recibida, dif, obs: i.obs ?? "",
      extra: i.cortesia ? "Cortesía" : i.especial ? "Especial del mes" : "",
    };
  }).sort((a: any, b: any) => (b.dif ? 1 : 0) - (a.dif ? 1 : 0) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0) || a.nombre.localeCompare(b.nombre));
  const conDif = items.filter((i: any) => i.dif);

  const bul = (o: any) => ["tappers", "latas", "bowls"].map((k) => `${o?.[k] || 0} ${k}`).join(" · ");
  const link = `${APP_URL}#/remitos/${r.id}`;
  const esRecepcion = tipo === "recepcion";

  // ---------- Destinatarios ----------
  const destinatarios = new Set<string>();
  const whatsapps: { phone: string; apikey: string }[] = [];
  for (const p of perfiles ?? []) {
    if (!p.email) continue;
    if (p.rol === "admin") destinatarios.add(p.email.trim().toLowerCase());
    if (!esRecepcion && p.rol === "local" && p.location_id === r.destino_id) destinatarios.add(p.email.trim().toLowerCase());
    if (esRecepcion && p.rol === "obrador" && p.location_id === r.origen_id) destinatarios.add(p.email.trim().toLowerCase());
  }
  // Obrador: mail y WhatsApp en ambos casos (confirmación de despacho y aviso de recepción)
  emails(avObrador?.email).forEach((m) => destinatarios.add(m));
  if (avObrador?.whatsapp && avObrador?.callmebot_apikey) whatsapps.push({ phone: avObrador.whatsapp, apikey: avObrador.callmebot_apikey });
  // Local: solo al despachar (le avisa que la mercadería está en camino)
  if (!esRecepcion) {
    emails(avLocal?.email).forEach((m) => destinatarios.add(m));
    if (avLocal?.whatsapp && avLocal?.callmebot_apikey) whatsapps.push({ phone: avLocal.whatsapp, apikey: avLocal.callmebot_apikey });
  }

  // ---------- Mail ----------
  let mailEstado = "sin destinatarios";
  const resendKey = Deno.env.get("RESEND_API_KEY") || (await sb.rpc("clave_resend")).data;
  if (destinatarios.size && !resendKey) mailEstado = "mail sin clave de Resend";
  else if (destinatarios.size) {
    const td = "padding:6px 10px;border-bottom:1px solid #e5e7eb";
    const filas = items.map((i: any) =>
      `<tr style="${i.dif ? "background:#fde8e6" : ""}"><td style="${td}">${esc(i.nombre)}${i.extra ? ` <span style="color:#1d5fbf;font-size:12px">(${esc(i.extra)})</span>` : ""}${esRecepcion && i.obs ? `<div style="font-size:12px;color:#b42318">${esc(i.obs)}</div>` : ""}</td>` +
      `<td style="${td};color:#666">${esc(i.unidad)}</td>` +
      `<td style="${td};text-align:right">${fmtQ(i.enviada)}</td>` +
      (esRecepcion
        ? `<td style="${td};text-align:right"><b>${fmtQ(i.recibida)}</b></td><td style="${td};text-align:right;color:${i.dif ? "#b42318" : "#17803d"}">${i.dif ? (i.dif > 0 ? "+" : "") + fmtQ(i.dif) : "✓"}</td>`
        : "") +
      `</tr>`
    ).join("");
    const titulo = esRecepcion
      ? (r.estado === "con_diferencias" ? `Remito ${label} recibido con diferencias ⚠️` : `Remito ${label} recibido OK ✓`)
      : `Remito ${label} despachado 🚚`;
    const color = esRecepcion && r.estado === "con_diferencias" ? "#b42318" : "#0f5c4d";
    const filasInfo = esRecepcion
      ? `<tr><td style="color:#666;padding:2px 0">Recibido por</td><td>${esc(nombre(r.recibido_por)) || "—"}</td></tr>
         <tr><td style="color:#666;padding:2px 0">Bultos</td><td>enviados ${esc(bul(r.bultos))} · recibidos ${esc(bul(r.bultos_recibidos))}</td></tr>
         ${r.obs_recepcion ? `<tr><td style="color:#666;padding:2px 0">Observaciones</td><td>${esc(r.obs_recepcion)}</td></tr>` : ""}
         <tr><td style="color:#666;padding:2px 0">Estado</td><td><b>Pendiente de carga de facturación</b></td></tr>`
      : `<tr><td style="color:#666;padding:2px 0">Despachado por</td><td>${esc(nombre(r.despachado_por || r.creado_por)) || "—"}</td></tr>
         <tr><td style="color:#666;padding:2px 0">Entregado por</td><td>${esc(r.entregado_por) || "—"}</td></tr>
         <tr><td style="color:#666;padding:2px 0">Bultos</td><td>${esc(bul(r.bultos))}</td></tr>
         ${r.observaciones ? `<tr><td style="color:#666;padding:2px 0">Observaciones</td><td>${esc(r.observaciones)}</td></tr>` : ""}`;
    const html = `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:Arial,Helvetica,sans-serif;color:#1b2420">
<div style="max-width:620px;margin:0 auto;padding:24px">
  <div style="background:${color};color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
    <div style="font-size:13px;opacity:.85">Heroica · Remitos</div>
    <div style="font-size:22px;font-weight:bold;margin-top:4px">${esc(titulo)}</div>
  </div>
  <div style="background:#fff;padding:20px;border-radius:0 0 10px 10px;border:1px solid #e2e5df;border-top:0">
    <p style="margin:0 0 12px"><b>${esc(origen)}</b> → <b>${esc(destino)}</b> · ${esc(areaNombre)}</p>
    ${esRecepcion && conDif.length ? `<p style="margin:0 0 12px;color:#b42318"><b>${conDif.length} producto${conDif.length > 1 ? "s" : ""} con diferencia</b> entre lo enviado y lo recibido.</p>` : ""}
    <table style="width:100%;font-size:14px;margin-bottom:14px">${filasInfo}</table>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="background:#f8f9f6"><th style="text-align:left;padding:6px 10px">Producto</th><th style="text-align:left;padding:6px 10px">Unidad</th><th style="text-align:right;padding:6px 10px">Enviado</th>${esRecepcion ? '<th style="text-align:right;padding:6px 10px">Recibido</th><th style="text-align:right;padding:6px 10px">Dif.</th>' : ""}</tr>
      ${filas}
    </table>
    <p style="margin:20px 0 0;text-align:center"><a href="${link}" style="background:#0f5c4d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${esRecepcion ? "Ver el remito" : "Abrir el remito y controlar la recepción"}</a></p>
  </div>
  <p style="font-size:12px;color:#888;text-align:center;margin-top:14px">Aviso automático de Heroica Remitos. No respondas este mail.</p>
</div></body></html>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [...destinatarios],
        subject: esRecepcion
          ? `Remito ${label} recibido en ${destino}${r.estado === "con_diferencias" ? " · CON DIFERENCIAS" : " · OK"}`
          : `Remito ${label} · ${areaNombre} → ${destino}`,
        html,
      }),
    });
    mailEstado = res.ok ? `mail a ${destinatarios.size}` : `mail con error (${res.status})`;
    if (!res.ok) console.error("Resend", res.status, await res.text());
  }

  // ---------- WhatsApp (CallMeBot) ----------
  let waEstado = "WhatsApp no configurado";
  if (whatsapps.length) {
    const texto = esRecepcion
      ? `${r.estado === "con_diferencias" ? "⚠️" : "✅"} *Remito ${label}* recibido en ${destino}\n` +
        (r.estado === "con_diferencias"
          ? `Con diferencias:\n${conDif.slice(0, 10).map((i: any) => `• ${i.nombre}: enviado ${fmtQ(i.enviada)}, recibido ${fmtQ(i.recibida)}${i.obs ? ` (${i.obs})` : ""}`).join("\n")}\n`
          : `Todo OK, llegó igual a lo enviado.\n`) +
        `Ver: ${link}`
      : `🚚 *Remito ${label}* (${areaNombre})\nDe: ${origen}\nPara: ${destino}\n` +
        (r.entregado_por ? `Entrega: ${r.entregado_por}\n` : "") +
        `${items.length} productos · Bultos: ${bul(r.bultos)}\nControlar: ${link}`;
    let ok = 0, errores = 0;
    for (const w of whatsapps) {
      const phone = String(w.phone).replace(/[^\d+]/g, "");
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(w.apikey)}`;
      try {
        const res = await fetch(url);
        const txt = (await res.text()).replace(/<[^>]+>/g, " ");
        if (res.ok && (/queued|sent/i.test(txt) || !/error|invalid/i.test(txt))) ok++;
        else { errores++; console.error("CallMeBot", res.status, txt.slice(0, 500)); }
      } catch (e) {
        errores++;
        console.error("CallMeBot", e);
      }
    }
    waEstado = `WhatsApp a ${ok}` + (errores ? ` (${errores} con error)` : "");
  }

  const detalle = `${esRecepcion ? "Aviso de recepción" : "Aviso de despacho"}: ${mailEstado} · ${waEstado}`;
  await sb.from("remito_eventos").insert({
    remito_id: r.id, remito_numero: r.numero, remito_label: label,
    tipo: "aviso", detalle, usuario_nombre: "Avisos automáticos",
  });
  return json({ ok: true, detalle });
});
