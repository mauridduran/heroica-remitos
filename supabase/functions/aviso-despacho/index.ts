// Edge Function "aviso-despacho"
// Se ejecuta cuando un remito pasa a "despachado" (la dispara un trigger de la base).
// Manda un mail con el resumen (Resend) y un WhatsApp al local destino (CallMeBot),
// y deja registrado en el historial del remito a quién se avisó.
//
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   clave de Resend con permiso de envío para mheroica.com
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente.

import { createClient } from "jsr:@supabase/supabase-js@2";

const APP_URL = "https://mauridduran.github.io/heroica-remitos/";
const FROM = "Heroica Remitos <remitos@mheroica.com>";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fmtQ = (n: number) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 });

Deno.serve(async (req) => {
  let remito_id: string | undefined;
  try {
    ({ remito_id } = await req.json());
  } catch { /* sin cuerpo */ }
  if (!remito_id) return json({ error: "falta remito_id" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: r, error } = await sb
    .from("remitos")
    .select("*, items:remito_items(*), area:areas(nombre, prefijo)")
    .eq("id", remito_id)
    .maybeSingle();
  if (error || !r) return json({ error: error?.message || "remito inexistente" }, 404);
  if (r.estado === "borrador" || r.estado === "anulado") return json({ skip: "no despachado" });

  // Se reserva el aviso en forma atómica: si ya se avisó (o otro llamado ganó), no se repite.
  const { data: claimed } = await sb
    .from("remitos")
    .update({ aviso_enviado_at: new Date().toISOString() })
    .eq("id", r.id)
    .is("aviso_enviado_at", null)
    .select("id");
  if (!claimed?.length) return json({ skip: "ya avisado" });

  const label = `${r.area?.prefijo ?? "0000"}-${String(r.nro_area ?? r.numero).padStart(4, "0")}`;
  const areaNombre = r.area?.nombre ?? "";

  const [{ data: locs }, { data: avisos }, { data: perfiles }] = await Promise.all([
    sb.from("locations").select("id, nombre").in("id", [r.origen_id, r.destino_id]),
    sb.from("location_avisos").select("*").eq("location_id", r.destino_id).maybeSingle(),
    sb.from("profiles").select("email, nombre, rol, location_id, id"),
  ]);
  const locName = (id: string) => locs?.find((l) => l.id === id)?.nombre ?? "";
  const origen = locName(r.origen_id);
  const destino = locName(r.destino_id);
  const despachadoPor = perfiles?.find((p) => p.id === (r.despachado_por || r.creado_por))?.nombre ?? "";

  // Productos
  const prodIds = r.items.filter((i: any) => i.product_id).map((i: any) => i.product_id);
  const { data: prods } = prodIds.length
    ? await sb.from("products").select("id, nombre, unidad, seccion").in("id", prodIds)
    : { data: [] as any[] };
  const items = r.items.map((i: any) => {
    const p = prods?.find((x) => x.id === i.product_id);
    return {
      nombre: p?.nombre ?? i.descripcion ?? "",
      unidad: p?.unidad ?? i.unidad ?? "",
      cantidad: i.cantidad_enviada,
      extra: i.cortesia ? "Cortesía" : i.especial ? "Especial del mes" : "",
    };
  }).sort((a: any, b: any) => (a.extra ? 1 : 0) - (b.extra ? 1 : 0) || a.nombre.localeCompare(b.nombre));

  const b = r.bultos || {};
  const bultos = ["tappers", "latas", "bowls"].map((k) => `${b[k] || 0} ${k}`).join(" · ");
  const link = `${APP_URL}#/remitos/${r.id}`;

  // ---------- Mail ----------
  const destinatarios = new Set<string>();
  for (const p of perfiles ?? []) {
    if (!p.email) continue;
    if (p.rol === "admin" || (p.rol === "local" && p.location_id === r.destino_id)) destinatarios.add(p.email.trim().toLowerCase());
  }
  for (const m of String(avisos?.email ?? "").split(/[,;\s]+/)) if (m.includes("@")) destinatarios.add(m.trim().toLowerCase());

  let mailEstado = "sin destinatarios";
  if (destinatarios.size) {
    const filas = items.map((i: any) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(i.nombre)}${i.extra ? ` <span style="color:#1d5fbf;font-size:12px">(${esc(i.extra)})</span>` : ""}</td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#666">${esc(i.unidad)}</td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right"><b>${fmtQ(i.cantidad)}</b></td></tr>`
    ).join("");
    const html = `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:Arial,Helvetica,sans-serif;color:#1b2420">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#0f5c4d;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
    <div style="font-size:13px;opacity:.85">Heroica · Remitos</div>
    <div style="font-size:22px;font-weight:bold;margin-top:4px">Remito ${esc(label)} despachado 🚚</div>
  </div>
  <div style="background:#fff;padding:20px;border-radius:0 0 10px 10px;border:1px solid #e2e5df;border-top:0">
    <p style="margin:0 0 12px"><b>${esc(origen)}</b> → <b>${esc(destino)}</b> · ${esc(areaNombre)}</p>
    <table style="width:100%;font-size:14px;margin-bottom:14px">
      <tr><td style="color:#666;padding:2px 0">Despachado por</td><td>${esc(despachadoPor) || "—"}</td></tr>
      <tr><td style="color:#666;padding:2px 0">Entregado por</td><td>${esc(r.entregado_por) || "—"}</td></tr>
      <tr><td style="color:#666;padding:2px 0">Bultos</td><td>${esc(bultos)}</td></tr>
      ${r.observaciones ? `<tr><td style="color:#666;padding:2px 0">Observaciones</td><td>${esc(r.observaciones)}</td></tr>` : ""}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="background:#f8f9f6"><th style="text-align:left;padding:6px 10px">Producto</th><th style="text-align:left;padding:6px 10px">Unidad</th><th style="text-align:right;padding:6px 10px">Cantidad</th></tr>
      ${filas}
    </table>
    <p style="margin:20px 0 0;text-align:center"><a href="${link}" style="background:#0f5c4d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">Abrir el remito y controlar la recepción</a></p>
  </div>
  <p style="font-size:12px;color:#888;text-align:center;margin-top:14px">Aviso automático de Heroica Remitos. No respondas este mail.</p>
</div></body></html>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [...destinatarios],
        subject: `Remito ${label} · ${areaNombre} → ${destino}`,
        html,
      }),
    });
    mailEstado = res.ok ? `mail a ${destinatarios.size}` : `mail con error (${res.status})`;
    if (!res.ok) console.error("Resend", res.status, await res.text());
  }

  // ---------- WhatsApp (CallMeBot) ----------
  let waEstado = "WhatsApp no configurado";
  if (avisos?.whatsapp && avisos?.callmebot_apikey) {
    const texto =
      `🚚 *Remito ${label}* (${areaNombre})\n` +
      `De: ${origen}\nPara: ${destino}\n` +
      (r.entregado_por ? `Entrega: ${r.entregado_por}\n` : "") +
      `${items.length} productos · Bultos: ${bultos}\n` +
      `Controlar: ${link}`;
    const phone = String(avisos.whatsapp).replace(/[^\d+]/g, "");
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(avisos.callmebot_apikey)}`;
    try {
      const res = await fetch(url);
      const body = await res.text();
      const txt = body.replace(/<[^>]+>/g, " ");
      if (res.ok && /queued|sent/i.test(txt)) waEstado = "WhatsApp enviado";
      else if (!res.ok || /error|invalid|apikey/i.test(txt)) waEstado = `WhatsApp con error (${res.status})`;
      else waEstado = "WhatsApp enviado (sin confirmar)";
      if (waEstado !== "WhatsApp enviado") console.error("CallMeBot", res.status, txt.slice(0, 500));
    } catch (e) {
      waEstado = "WhatsApp con error";
      console.error("CallMeBot", e);
    }
  }

  const detalle = `${mailEstado} · ${waEstado}`;
  await sb.from("remito_eventos").insert({
    remito_id: r.id, remito_numero: r.numero, remito_label: label,
    tipo: "aviso", detalle, usuario_nombre: "Avisos automáticos",
  });
  return json({ ok: true, detalle });
});
