-- Avisos automáticos al despachar un remito (23/11/2026)
-- Mail (Resend) + WhatsApp (CallMeBot) por medio de la Edge Function "aviso-despacho".

create extension if not exists pg_net with schema extensions;

-- Datos de aviso de cada local: solo administración los ve y edita
create table if not exists location_avisos (
  location_id      uuid primary key references locations on delete cascade,
  email            text,   -- uno o varios mails separados por coma
  whatsapp         text,   -- con código de país, ej. +5493415551234
  callmebot_apikey text,   -- código que da CallMeBot al activar el número
  updated_at       timestamptz not null default now()
);
alter table location_avisos enable row level security;
drop policy if exists avisos_admin on location_avisos;
create policy avisos_admin on location_avisos for all to authenticated
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
grant select, insert, update, delete on location_avisos to authenticated;

-- Marca para no avisar dos veces el mismo remito
alter table remitos add column if not exists aviso_enviado_at timestamptz;

-- Cuando se registra el evento "despachado", se llama a la función de avisos
create or replace function disparar_aviso_despacho() returns trigger
language plpgsql security definer set search_path = public, extensions as
$$
begin
  if new.tipo = 'despachado' then
    perform net.http_post(
      url     := 'https://llwisprdxbrvxwxkgdan.supabase.co/functions/v1/aviso-despacho',
      body    := jsonb_build_object('remito_id', new.remito_id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        -- clave pública (anon) del proyecto: la misma que usa la app
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsd2lzcHJkeGJydnh3eGtnZGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzODQwODQsImV4cCI6MjExMDk2MDA4NH0.YnqFQ5ryBYd99p_nIk8jpRHylbISy0kvDDu6fa6vMc4')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aviso_despacho on remito_eventos;
create trigger trg_aviso_despacho
  after insert on remito_eventos
  for each row execute function disparar_aviso_despacho();

select 'ok' as resultado;
