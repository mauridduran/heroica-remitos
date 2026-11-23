-- =====================================================================
--  Control de Remitos  ·  Esquema de base de datos (Supabase / Postgres)
--  Ejecutar completo en: Supabase → SQL Editor → New query → Run
--  Después ejecutar seed.sql (áreas y catálogo de productos)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Tablas maestras
-- ---------------------------------------------------------------------
create table if not exists locations (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null unique,
  tipo          text not null check (tipo in ('obrador','local')),
  codigo_hiopos text,                       -- código de tienda en HioPos (para importar ventas)
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);
-- Obrador que abastece a cada local (filtra el destino al cargar un remito)
alter table locations add column if not exists obrador_id uuid references locations;

-- Áreas de producción: cada una tiene su talonario (prefijo del N° de remito)
create table if not exists areas (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null unique,          -- PAN, PAS, LAM, COC, GEN
  nombre     text not null,
  prefijo    text not null default '0000',  -- ej. 0003 → remito 0003-0941
  orden      int  not null default 0,
  activo     boolean not null default true
);

create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique,                -- código interno
  nombre        text not null,
  unidad        text not null default 'u',  -- u, kg, docena, bandeja...
  categoria     text,
  area_id       uuid references areas,      -- área del obrador que lo produce
  seccion       text not null default 'terminado'
                check (seccion in ('terminado','masa_sola','intermedio','materia_prima')),
  obrador_id    uuid references locations,  -- si solo lo produce un obrador (opcional)
  factor_hiopos numeric(12,3) not null default 1, -- unidades vendidas en HioPos por unidad enviada (ej. tarta entera = 8 porciones)
  codigo_hiopos text,                       -- código de artículo en HioPos
  precio_costo  numeric(12,2) not null default 0,
  precio_venta  numeric(12,2) not null default 0,
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists products_hiopos_idx on products (codigo_hiopos);

create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  nombre      text,
  email       text,
  rol         text not null default 'pendiente'
              check (rol in ('admin','obrador','local','pendiente')),
  location_id uuid references locations,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Remitos
-- ---------------------------------------------------------------------
create table if not exists remitos (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity unique,  -- interno
  origen_id       uuid not null references locations,
  destino_id      uuid not null references locations,
  area_id         uuid references areas,
  nro_area        int,            -- correlativo del talonario por obrador + área
  nro_papel       text,           -- N° del remito en papel, si todavía se usa
  entregado_por   text,           -- quién lleva la mercadería
  bultos          jsonb not null default '{}'::jsonb,   -- {"tappers":3,"latas":2,"bowls":0}
  bultos_recibidos jsonb,
  estado          text not null default 'borrador'
                  check (estado in ('borrador','en_transito','recibido','con_diferencias','anulado')),
  observaciones   text,
  obs_recepcion   text,
  anulado_motivo  text,
  creado_por      uuid references profiles,
  creado_at       timestamptz not null default now(),
  despachado_por  uuid references profiles,
  despachado_at   timestamptz,
  recibido_por    uuid references profiles,
  recibido_at     timestamptz
);
create index if not exists remitos_destino_idx on remitos (destino_id, despachado_at);
create index if not exists remitos_estado_idx  on remitos (estado);

create table if not exists remito_items (
  id                uuid primary key default gen_random_uuid(),
  remito_id         uuid not null references remitos on delete cascade,
  product_id        uuid references products,      -- null = ítem libre (no está en el catálogo)
  descripcion       text,                          -- para ítems libres
  unidad            text,
  cortesia          boolean not null default false,
  especial          boolean not null default false, -- "especial del mes"
  cantidad_enviada  numeric(12,3) not null check (cantidad_enviada > 0),
  cantidad_recibida numeric(12,3),
  obs               text,
  check (product_id is not null or coalesce(descripcion, '') <> '')
);
create index if not exists remito_items_remito_idx on remito_items (remito_id);

-- Historial / trazabilidad (cada acción queda registrada con usuario y hora)
create table if not exists remito_eventos (
  id             bigint generated always as identity primary key,
  remito_id      uuid not null references remitos on delete cascade,
  remito_numero  bigint,
  remito_label   text,           -- ej. 0003-0941
  tipo           text not null,   -- creado, despachado, recibido, con_diferencias, anulado
  detalle        text,
  usuario_id     uuid references profiles,
  usuario_nombre text,
  created_at     timestamptz not null default now()
);
create index if not exists remito_eventos_remito_idx on remito_eventos (remito_id);

-- ---------------------------------------------------------------------
--  Ventas (importadas desde HioPos)
-- ---------------------------------------------------------------------
create table if not exists ventas (
  id           bigint generated always as identity primary key,
  fecha        date not null,
  location_id  uuid not null references locations,
  product_id   uuid references products,
  codigo       text not null,          -- código de artículo HioPos (o descripción si no hay código)
  descripcion  text,
  cantidad     numeric(12,3) not null default 0,
  importe      numeric(14,2) not null default 0,
  fuente       text not null default 'hiopos-import',
  importado_at timestamptz not null default now(),
  unique (fecha, location_id, codigo)
);
create index if not exists ventas_loc_fecha_idx on ventas (location_id, fecha);

-- ---------------------------------------------------------------------
--  Helpers de seguridad
-- ---------------------------------------------------------------------
create or replace function mi_rol() returns text
language sql stable security definer set search_path = public as
$$ select rol from profiles where id = auth.uid() $$;

create or replace function mi_local() returns uuid
language sql stable security definer set search_path = public as
$$ select location_id from profiles where id = auth.uid() $$;

create or replace function mi_nombre() returns text
language sql stable security definer set search_path = public as
$$ select coalesce(nombre, email) from profiles where id = auth.uid() $$;

-- Crea el perfil automáticamente al registrarse un usuario.
-- El primer usuario registrado queda como admin.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  insert into profiles (id, email, nombre, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    case when (select count(*) from profiles) = 0 then 'admin' else 'pendiente' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
--  Operaciones (RPC). Toda modificación de remitos pasa por acá,
--  así se validan permisos y estados y queda el historial.
-- ---------------------------------------------------------------------
create or replace function remito_label(p_id uuid) returns text
language sql stable security definer set search_path = public as
$$
  select coalesce(a.prefijo, '0000') || '-' || lpad(coalesce(r.nro_area, r.numero)::text, 4, '0')
  from remitos r left join areas a on a.id = r.area_id where r.id = p_id
$$;

create or replace function registrar_evento(p_remito uuid, p_tipo text, p_detalle text)
returns void language plpgsql security definer set search_path = public as
$$
begin
  insert into remito_eventos (remito_id, remito_numero, remito_label, tipo, detalle, usuario_id, usuario_nombre)
  select p_remito, r.numero, remito_label(r.id), p_tipo, p_detalle, auth.uid(), mi_nombre()
  from remitos r where r.id = p_remito;
end;
$$;

-- p: { origen_id, destino_id, area_id, observaciones, nro_papel, entregado_por,
--      bultos: {tappers, latas, bowls},
--      items: [{ product_id | descripcion, unidad, cantidad, cortesia, especial }] }
create or replace function crear_remito(p jsonb, p_despachar boolean default true) returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  v_id uuid;
  v_n  int;
  v_origen  uuid := (p->>'origen_id')::uuid;
  v_destino uuid := (p->>'destino_id')::uuid;
  v_area    uuid := nullif(p->>'area_id', '')::uuid;
  v_nro int;
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

  -- correlativo del talonario (obrador + área), sin huecos por concurrencia
  perform pg_advisory_xact_lock(hashtext(v_origen::text || coalesce(v_area::text, '')));
  select coalesce(max(nro_area), 0) + 1 into v_nro
  from remitos where origen_id = v_origen and area_id is not distinct from v_area;

  insert into remitos (origen_id, destino_id, area_id, nro_area, nro_papel, entregado_por, bultos, observaciones, creado_por)
  values (v_origen, v_destino, v_area, v_nro, nullif(p->>'nro_papel', ''), nullif(p->>'entregado_por', ''),
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

create or replace function despachar_remito(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$
declare r remitos;
begin
  select * into r from remitos where id = p_id for update;
  if not found then raise exception 'Remito inexistente'; end if;
  if mi_rol() not in ('admin','obrador') or (mi_rol() = 'obrador' and r.origen_id is distinct from mi_local()) then
    raise exception 'No tenés permiso para despachar este remito';
  end if;
  if r.estado <> 'borrador' then raise exception 'El remito ya fue despachado'; end if;

  update remitos set estado = 'en_transito', despachado_por = auth.uid(), despachado_at = now()
  where id = p_id;
  perform registrar_evento(p_id, 'despachado', null);
end;
$$;

-- p_items: [{ "id": <remito_item id>, "cantidad_recibida": 10, "obs": "2 rotos" }, ...]
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
         obs_recepcion = nullif(p_obs, ''), bultos_recibidos = p_bultos
  where id = p_id;

  perform registrar_evento(p_id, v_estado,
    case when v_dif > 0 then v_dif || ' productos con diferencia' else 'Todo OK' end);
  return v_estado;
end;
$$;

create or replace function anular_remito(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as
$$
declare r remitos;
begin
  select * into r from remitos where id = p_id for update;
  if not found then raise exception 'Remito inexistente'; end if;
  if not (mi_rol() = 'admin' or (mi_rol() = 'obrador' and r.origen_id = mi_local() and r.estado in ('borrador','en_transito'))) then
    raise exception 'No tenés permiso para anular este remito';
  end if;
  if r.estado = 'anulado' then raise exception 'El remito ya está anulado'; end if;

  update remitos set estado = 'anulado', anulado_motivo = p_motivo where id = p_id;
  perform registrar_evento(p_id, 'anulado', p_motivo);
end;
$$;

-- ---------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------
alter table locations      enable row level security;
alter table products       enable row level security;
alter table areas          enable row level security;
alter table profiles       enable row level security;
alter table remitos        enable row level security;
alter table remito_items   enable row level security;
alter table remito_eventos enable row level security;
alter table ventas         enable row level security;

-- Maestros: todos los usuarios activos leen, solo admin escribe
drop policy if exists loc_read on locations;
create policy loc_read on locations for select to authenticated using (mi_rol() <> 'pendiente');
drop policy if exists loc_admin on locations;
create policy loc_admin on locations for all to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists area_read on areas;
create policy area_read on areas for select to authenticated using (mi_rol() <> 'pendiente');
drop policy if exists area_admin on areas;
create policy area_admin on areas for all to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists prod_read on products;
create policy prod_read on products for select to authenticated using (mi_rol() <> 'pendiente');
drop policy if exists prod_admin on products;
create policy prod_admin on products for all to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

-- Perfiles: cada uno ve el suyo; admin ve y edita todos
drop policy if exists prof_self on profiles;
create policy prof_self on profiles for select to authenticated using (id = auth.uid() or mi_rol() = 'admin');
drop policy if exists prof_admin on profiles;
create policy prof_admin on profiles for update to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

-- Remitos: admin ve todo, obrador los que envía, local los que recibe.
-- No hay insert/update directo: se usan las funciones RPC de arriba.
drop policy if exists rem_read on remitos;
create policy rem_read on remitos for select to authenticated using (
  mi_rol() = 'admin'
  or (mi_rol() = 'obrador' and origen_id = mi_local())
  or (mi_rol() = 'local'   and destino_id = mi_local())
);

drop policy if exists item_read on remito_items;
create policy item_read on remito_items for select to authenticated using (
  exists (select 1 from remitos r where r.id = remito_id)   -- hereda la visibilidad del remito
);

drop policy if exists ev_read on remito_eventos;
create policy ev_read on remito_eventos for select to authenticated using (
  exists (select 1 from remitos r where r.id = remito_id)
);

-- Ventas: admin todo; local solo las suyas (lectura)
drop policy if exists ven_read on ventas;
create policy ven_read on ventas for select to authenticated using (
  mi_rol() = 'admin' or (mi_rol() = 'local' and location_id = mi_local())
);
drop policy if exists ven_admin on ventas;
create policy ven_admin on ventas for all to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

-- ---------------------------------------------------------------------
--  Permisos de la API (los proyectos nuevos de Supabase no los dan solos).
--  La seguridad real la dan las políticas RLS de arriba.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------
--  Tiempo real
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table remitos;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table remito_eventos; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------
--  Datos iniciales (editables luego desde la app → Configuración)
-- ---------------------------------------------------------------------
insert into locations (nombre, tipo) values
  ('Obrador Guemes (Rosario)', 'obrador'),
  ('Obrador Palermo (Buenos Aires)', 'obrador'),
  ('Guemes', 'local'),
  ('Funes', 'local'),
  ('Florida', 'local'),
  ('Alto Rosario', 'local'),
  ('Centro', 'local'),
  ('DOT', 'local')
on conflict (nombre) do nothing;

update locations set obrador_id = (select id from locations where nombre = 'Obrador Guemes (Rosario)')
where nombre in ('Guemes', 'Funes', 'Florida', 'Alto Rosario', 'Centro');
update locations set obrador_id = (select id from locations where nombre = 'Obrador Palermo (Buenos Aires)')
where nombre = 'DOT';
