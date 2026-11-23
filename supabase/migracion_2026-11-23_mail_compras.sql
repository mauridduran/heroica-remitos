-- Copia de todos los remitos despachados a heroica.compras@gmail.com (mail de avisos de ambos obradores).
-- Se puede cambiar después en la app: Configuración → Obradores y locales → Editar (obrador).
insert into location_avisos (location_id, email)
select id, 'heroica.compras@gmail.com' from locations where tipo = 'obrador'
on conflict (location_id) do update set email = excluded.email, updated_at = now();

select l.nombre, a.email from location_avisos a join locations l on l.id = a.location_id order by l.tipo, l.nombre;
