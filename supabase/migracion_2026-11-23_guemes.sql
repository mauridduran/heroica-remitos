-- El local "Guemes" era el mismo Obrador Guemes (que tiene mostrador y vende en HioPos).
-- Se desactiva el local (queda el historial) y se anula el remito que estaba en tránsito hacia él.
do $$
declare v_loc uuid; v_rem uuid;
begin
  select id into v_loc from locations where nombre = 'Guemes' and tipo = 'local';
  if v_loc is null then raise exception 'No encontré el local Guemes'; end if;

  update locations set activo = false where id = v_loc;

  for v_rem in select id from remitos where destino_id = v_loc and estado in ('borrador', 'en_transito') loop
    update remitos set estado = 'anulado', anulado_motivo = 'Local Guemes desactivado: era el mismo Obrador Guemes' where id = v_rem;
    perform registrar_evento(v_rem, 'anulado', 'Local Guemes desactivado: era el mismo Obrador Guemes');
  end loop;
end $$;

select l.nombre, l.tipo, l.activo,
  (select string_agg(a.prefijo || '-' || lpad(r.nro_area::text, 4, '0') || ' ' || r.estado, ', ')
     from remitos r left join areas a on a.id = r.area_id where r.destino_id = l.id and r.creado_at >= '2026-11-23' and r.nro_area < 10 and a.prefijo in ('0001','0002')) as remitos
from locations l where l.nombre = 'Guemes';
