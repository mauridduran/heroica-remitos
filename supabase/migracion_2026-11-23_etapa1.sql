-- Etapa 1 del checklist (23/11/2026)
--  · N° de remito = N° del talonario de papel (obligatorio y sin repetir por obrador + área)
--  · Producción resuelve las diferencias (y registra mermas)
--  · No se puede anular un remito ya recibido
--  · Locales franquicia + precio de franquicia por producto

-- ---------- Diferencias: resolución de Producción ----------
alter table remitos add column if not exists dif_resuelta_at  timestamptz;
alter table remitos add column if not exists dif_resuelta_por uuid references profiles;
alter table remitos add column if not exists dif_tipo         text;   -- merma, error_carga, faltante_traslado, sobrante, reposicion, otro
alter table remitos add column if not exists dif_resolucion   text;   -- comentario de Producción

-- ---------- Franquicias ----------
alter table locations add column if not exists es_franquicia     boolean not null default false;
alter table products  add column if not exists precio_franquicia numeric(12,2) not null default 0;

-- ---------- N° de talonario único (los anulados liberan el número) ----------
create unique index if not exists remitos_talonario_uq
  on remitos (origen_id, area_id, nro_area) where estado <> 'anulado';

-- ---------- Crear remito con el N° del talonario de papel ----------
-- p: { origen_id, destino_id, area_id, nro_area (N° del talonario, obligatorio), observaciones,
--      entregado_por, bultos: {tappers, latas, bowls}, items: [...] }
create or replace function crear_remito(p jsonb, p_despachar boolean default true) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_id uuid;
  v_n  int;
  v_origen  uuid := (p->>'origen_id')::uuid;
  v_destino uuid := (p->>'destino_id')::uuid;
  v_area    uuid := nullif(p->>'area_id', '')::uuid;
  v_nro     int;
  v_pref    text;
begin
  if mi_rol() not in ('admin','obrador') then
    raise exception 'No tenés permiso para crear remitos';
  end if;
  if mi_rol() = 'obrador' and v_origen is distinct from mi_local() then
    raise exception 'Solo podés crear remitos desde tu obrador';
  end if;
  if not exists (select 1 from locations where id = v_origen and tipo = 'obrador') then
    raise exception 'El origen debe ser un obrador';
  end if;
  if not exists (select 1 from locations where id = v_destino and tipo = 'local') then
    raise exception 'El destino debe ser un local';
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then
    raise exception 'El remito no tiene productos';
  end if;

  begin
    v_nro := nullif(regexp_replace(coalesce(p->>'nro_area', ''), '\D', '', 'g'), '')::int;
  exception when others then v_nro := null;
  end;
  if v_nro is null or v_nro <= 0 then
    raise exception 'Cargá el N° del remito de papel (talonario)';
  end if;
  select prefijo into v_pref from areas where id = v_area;
  v_pref := coalesce(v_pref, '0000');

  perform pg_advisory_xact_lock(hashtext(v_origen::text || coalesce(v_area::text, '')));
  if exists (select 1 from remitos where origen_id = v_origen and area_id is not distinct from v_area
             and nro_area = v_nro and estado <> 'anulado') then
    raise exception 'El remito %-% ya está cargado', v_pref, lpad(v_nro::text, 4, '0');
  end if;

  insert into remitos (origen_id, destino_id, area_id, nro_area, nro_papel, entregado_por, bultos, observaciones, creado_por)
  values (v_origen, v_destino, v_area, v_nro, v_pref || '-' || lpad(v_nro::text, 4, '0'), nullif(p->>'entregado_por', ''),
          coalesce(p->'bultos', '{}'::jsonb), nullif(p->>'observaciones', ''), auth.uid())
  returning id into v_id;

  insert into remito_items (remito_id, product_id, descripcion, unidad, cantidad_enviada, cortesia, especial)
  select v_id, x.product_id, nullif(x.descripcion, ''), nullif(x.unidad, ''), x.cantidad,
         coalesce(x.cortesia, false), coalesce(x.especial, false)
  from jsonb_to_recordset(p->'items')
       as x(product_id uuid, descripcion text, unidad text, cantidad numeric, cortesia boolean, especial boolean)
  where x.cantidad > 0 and (x.product_id is not null or coalesce(x.descripcion, '') <> '');

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'El remito no tiene cantidades válidas'; end if;

  perform registrar_evento(v_id, 'creado', v_n || ' productos');

  if p_despachar then
    perform despachar_remito(v_id);
  end if;
  return v_id;
end;
$$;

-- ---------- Anular: nunca un remito ya recibido ----------
create or replace function anular_remito(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as
$$
declare r remitos;
begin
  select * into r from remitos where id = p_id for update;
  if not found then raise exception 'Remito inexistente'; end if;
  if r.estado in ('recibido', 'con_diferencias') then
    raise exception 'No se puede anular un remito que ya fue recibido por el local';
  end if;
  if not (mi_rol() = 'admin' or (mi_rol() = 'obrador' and r.origen_id = mi_local() and r.estado in ('borrador','en_transito'))) then
    raise exception 'No tenés permiso para anular este remito';
  end if;
  if r.estado = 'anulado' then raise exception 'El remito ya está anulado'; end if;

  update remitos set estado = 'anulado', anulado_motivo = p_motivo where id = p_id;
  perform registrar_evento(p_id, 'anulado', p_motivo);
end;
$$;

-- ---------- Producción resuelve la diferencia ----------
create or replace function resolver_diferencia(p_id uuid, p_tipo text, p_obs text) returns void
language plpgsql security definer set search_path = public as
$$
declare r remitos;
begin
  select * into r from remitos where id = p_id for update;
  if not found then raise exception 'Remito inexistente'; end if;
  if not (mi_rol() = 'admin' or (mi_rol() = 'obrador' and r.origen_id = mi_local())) then
    raise exception 'Solo Producción del obrador que lo envió o administración pueden resolver la diferencia';
  end if;
  if r.estado <> 'con_diferencias' then raise exception 'El remito no tiene diferencias'; end if;
  if r.dif_resuelta_at is not null then raise exception 'La diferencia ya fue resuelta'; end if;
  if coalesce(p_tipo, '') = '' then raise exception 'Elegí el motivo de la diferencia'; end if;

  update remitos set dif_resuelta_at = now(), dif_resuelta_por = auth.uid(),
         dif_tipo = p_tipo, dif_resolucion = nullif(p_obs, '')
  where id = p_id;
  perform registrar_evento(p_id, 'dif_resuelta',
    initcap(replace(p_tipo, '_', ' ')) || coalesce(' · ' || nullif(p_obs, ''), ''));
end;
$$;

grant execute on function crear_remito(jsonb, boolean) to authenticated;
grant execute on function anular_remito(uuid, text) to authenticated;
grant execute on function resolver_diferencia(uuid, text, text) to authenticated;

select 'ok' as resultado;
