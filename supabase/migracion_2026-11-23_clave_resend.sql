-- La clave de Resend para los avisos se guarda cifrada en Supabase Vault (no en el código).
-- Solo la función de avisos (rol service_role) puede leerla.
create or replace function clave_resend() returns text
language sql stable security definer set search_path = public, vault as
$$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'resend_api_key' order by created_at desc limit 1
$$;
revoke all on function clave_resend() from public, anon, authenticated;
grant execute on function clave_resend() to service_role;
select 'ok' as resultado;
