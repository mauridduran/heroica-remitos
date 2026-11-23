-- Estados de administración (23/11/2026)
--   Enviado → Pendiente de revisión (el local marcó "Llegó") → Pendiente de carga de facturación
--   (el local confirmó lo que llegó) → Facturado (administración lo cargó y lo cierra)
-- + avisos al obrador cuando el local recibe.

alter table remitos add column if not exists llegado_at        timestamptz;
alter table remitos add column if not exists llegado_por       uuid references profiles;
alter table remitos add column if not exists facturado_at      timestamptz;
alter table remitos add column if not exists facturado_por     uuid references profiles;
alter table remitos add column if not exists nro_factura       text;
alter table remitos add column if not exists aviso_recepcion_at timestamptz;

-- Los remitos ya recibidos quedan con su hora de llegada = hora de recepción
update remitos set llegado_at = recibido_at, llegado_por = recibido_por
where recibido_at is not null and llegado_at is null;

-- El local (o admin) marca que la mercadería llegó: pasa a "Pendiente de revisión"
create or replace function marcar_llegado(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$
declare r remitos;
begin
  select * into r from remitos where id = p_id for update;
  if not found then raise exception 'Remito inexistente'; end if;
  if not (mi_rol() = 'admin' or (mi_rol() = 'local' and r.destino_id = mi_local())) then
    raise exception 'No tenés permiso para este remito';
  end if;
  if r.estado <> 'en_transito' then raise exception 'El remito no está en tránsito'; end if;
  if r.llegado_at is not null then return; end if;
  update remitos set llegado_at = now(), llegado_por = auth.uid() where id = p_id;
  perform registrar_evento(p_id, 'llegado', 'Pendiente de revisión');
end;
$$;

-- Al confirmar la recepción, si no se había marcado la llegada, se marca en ese momento
create or replace function recibir_remito(p_id uuid, p_items jsonb, p_obs text, p_bultos jsonb default null) returns text
language plpgsql security definer set search_path = public as
$$
declare
  r remitos;
  v_dif int;
  v_estado text;
begin
  select * into r from remitos where id = p_id for update;
  if not found then raise exception 'Remito inexistente'; end if;
  if not (mi_rol() = 'admin' or (mi_rol() = 'local' and r.destino_id = mi_local())) then
    raise exception 'No tenés permiso para recibir este remito';
  end if;
  if r.estado <> 'en_transito' then raise exception 'El remito no está en tránsito'; end if;

  update remito_items i
  set cantidad_recibida = x.cantidad_recibida, obs = nullif(x.obs, '')
  from jsonb_to_recordset(p_items) as x(id uuid, cantidad_recibida numeric, obs text)
  where i.id = x.id and i.remito_id = p_id;

  if exists (select 1 from remito_items where remito_id = p_id and cantidad_recibida is null) then
    raise exception 'Falta cargar la cantidad recibida de algún producto';
  end if;

  select count(*) into v_dif from remito_items
  where remito_id = p_id and cantidad_recibida <> cantidad_enviada;

  v_estado := case when v_dif > 0 then 'con_diferencias' else 'recibido' end;

  update remitos set estado = v_estado, recibido_por = auth.uid(), recibido_at = now(),
         obs_recepcion = nullif(p_obs, ''), bultos_recibidos = p_bultos,
         llegado_at = coalesce(llegado_at, now()), llegado_por = coalesce(llegado_por, auth.uid())
  where id = p_id;

  perform registrar_evento(p_id, v_estado,
    case when v_dif > 0 then v_dif || ' productos con diferencia' else 'Todo OK' end);
  return v_estado;
end;
$$;

-- Administración marca el remito como cargado en facturación: queda "Facturado"
create or replace function marcar_facturado(p_id uuid, p_nro text default null) returns void
language plpgsql security definer set search_path = public as
$$
declare r remitos;
begin
  select * into r from remitos where id = p_id for update;
  if not found then raise exception 'Remito inexistente'; end if;
  if mi_rol() <> 'admin' then raise exception 'Solo administración puede marcar la facturación'; end if;
  if r.estado not in ('recibido', 'con_diferencias') then
    raise exception 'Solo se puede facturar un remito ya recibido por el local';
  end if;
  update remitos set facturado_at = now(), facturado_por = auth.uid(), nro_factura = nullif(p_nro, '')
  where id = p_id;
  perform registrar_evento(p_id, 'facturado', coalesce('Factura ' || nullif(p_nro, ''), 'Cargado en facturación'));
end;
$$;

grant execute on function marcar_llegado(uuid) to authenticated;
grant execute on function marcar_facturado(uuid, text) to authenticated;
grant execute on function recibir_remito(uuid, jsonb, text, jsonb) to authenticated;

-- Avisos: al despachar (como antes) y también al recibir (aviso al obrador)
create or replace function disparar_aviso_despacho() returns trigger
language plpgsql security definer set search_path = public, extensions as
$$
declare v_tipo text;
begin
  v_tipo := case when new.tipo = 'despachado' then 'despacho'
                 when new.tipo in ('recibido', 'con_diferencias') then 'recepcion' end;
  if v_tipo is not null then
    perform net.http_post(
      url     := 'https://llwisprdxbrvxwxkgdan.supabase.co/functions/v1/aviso-despacho',
      body    := jsonb_build_object('remito_id', new.remito_id, 'tipo', v_tipo),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        -- clave pública (anon) del proyecto: la misma que usa la app
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsd2lzcHJkeGJydnh3eGtnZGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzODQwODQsImV4cCI6MjExMDk2MDA4NH0.YnqFQ5ryBYd99p_nIk8jpRHylbISy0kvDDu6fa6vMc4')
    );
  end if;
  return new;
end;
$$;

select 'ok' as resultado;
