-- Sincronización automática de ventas desde HioPos (Bridge ICG / HiOffice)
-- · Credenciales del usuario de HiOffice cifradas en Supabase Vault (solo las lee la función).
-- · Ajustes (GUID del dashboard de exportación) y registro de cada sincronización.
-- · Tarea programada (pg_cron) que llama a la Edge Function "sync-hiopos" 4 veces por día.

-- ---------- Ajustes generales (solo administración) ----------
create table if not exists ajustes (
  clave      text primary key,
  valor      text,
  updated_at timestamptz not null default now()
);
alter table ajustes enable row level security;
drop policy if exists aju_admin on ajustes;
create policy aju_admin on ajustes for all to authenticated using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
grant select, insert, update, delete on ajustes to authenticated;
grant all on ajustes to service_role;

-- ---------- Registro de sincronizaciones ----------
create table if not exists sync_log (
  id        bigint generated always as identity primary key,
  fuente    text not null default 'hiopos',
  origen    text,                    -- 'automatica' | 'manual' | 'prueba'
  inicio    timestamptz not null default now(),
  fin       timestamptz,
  ok        boolean,
  desde     date,
  hasta     date,
  filas     int,
  guardadas int,
  detalle   jsonb
);
alter table sync_log enable row level security;
drop policy if exists sync_admin on sync_log;
create policy sync_admin on sync_log for select to authenticated using (mi_rol() = 'admin');
grant select on sync_log to authenticated;
grant all on sync_log to service_role;

-- ---------- Credenciales de HiOffice en Vault ----------
-- La carga el administrador desde la app (Ventas HioPos → Sincronización); nadie las puede leer desde la app.
create or replace function guardar_credenciales_hiopos(p_email text, p_password text) returns void
language plpgsql security definer set search_path = public, vault as
$$
declare v_id uuid;
begin
  if mi_rol() is distinct from 'admin' then raise exception 'Solo administración'; end if;
  if coalesce(trim(p_email), '') = '' or coalesce(p_password, '') = '' then raise exception 'Completá mail y contraseña'; end if;
  select id into v_id from vault.secrets where name = 'hiopos_email';
  if v_id is null then perform vault.create_secret(trim(p_email), 'hiopos_email');
  else perform vault.update_secret(v_id, trim(p_email)); end if;
  select id into v_id from vault.secrets where name = 'hiopos_password';
  if v_id is null then perform vault.create_secret(p_password, 'hiopos_password');
  else perform vault.update_secret(v_id, p_password); end if;
  insert into ajustes (clave, valor, updated_at) values ('hiopos_usuario', trim(p_email), now())
  on conflict (clave) do update set valor = excluded.valor, updated_at = now();
end;
$$;
revoke all on function guardar_credenciales_hiopos(text, text) from public, anon;
grant execute on function guardar_credenciales_hiopos(text, text) to authenticated;

-- Solo la Edge Function (service_role) puede leerlas
create or replace function credenciales_hiopos() returns jsonb
language sql stable security definer set search_path = public, vault as
$$
  select jsonb_build_object(
    'email',    (select decrypted_secret from vault.decrypted_secrets where name = 'hiopos_email' order by created_at desc limit 1),
    'password', (select decrypted_secret from vault.decrypted_secrets where name = 'hiopos_password' order by created_at desc limit 1))
$$;
revoke all on function credenciales_hiopos() from public, anon, authenticated;
grant execute on function credenciales_hiopos() to service_role;

-- ---------- Sincronización automática: 6, 12, 18 y 0 hs de Argentina ----------
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'sync-hiopos';
select cron.schedule('sync-hiopos', '0 3,9,15,21 * * *', $cron$
  select net.http_post(
    url     := 'https://llwisprdxbrvxwxkgdan.supabase.co/functions/v1/sync-hiopos',
    body    := '{"modo":"automatica"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsd2lzcHJkeGJydnh3eGtnZGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzODQwODQsImV4cCI6MjExMDk2MDA4NH0.YnqFQ5ryBYd99p_nIk8jpRHylbISy0kvDDu6fa6vMc4'),
    timeout_milliseconds := 60000)
$cron$);

select 'ok' as resultado, (select count(*) from cron.job where jobname = 'sync-hiopos') as tarea_programada;
