-- Locales actualizados (23/11/2026)
--  Rosario  (Obrador Guemes):  Funes, Florida, Alto Rosario, Centro
--  Bs. As.  (Obrador Palermo): DOT (próxima apertura)
--  Córdoba ya no recibe; el local "Guemes" no figura en la lista → ambos quedan inactivos (no se borran: conservan su historial)

-- Qué obrador abastece a cada local (filtra el destino al cargar un remito)
alter table locations add column if not exists obrador_id uuid references locations;

insert into locations (nombre, tipo) values
  ('Florida', 'local'),
  ('Centro', 'local'),
  ('DOT', 'local')
on conflict (nombre) do nothing;

update locations set activo = true
where nombre in ('Funes', 'Florida', 'Alto Rosario', 'Centro', 'DOT');

update locations set activo = false
where nombre in ('Córdoba', 'Guemes');

update locations
set obrador_id = (select id from locations where nombre = 'Obrador Guemes (Rosario)')
where nombre in ('Funes', 'Florida', 'Alto Rosario', 'Centro');

update locations
set obrador_id = (select id from locations where nombre = 'Obrador Palermo (Buenos Aires)')
where nombre = 'DOT';

-- Verificación
select l.nombre, l.tipo, l.activo, o.nombre as abastecido_por
from locations l left join locations o on o.id = l.obrador_id
order by l.tipo desc, l.activo desc, l.nombre;
