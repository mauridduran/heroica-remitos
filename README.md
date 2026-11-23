# Heroica · Control de Remitos

App web para seguir **online y en tiempo real** cada remito que sale de los obradores hacia los locales, controlar la recepción producto por producto y **comparar lo enviado con lo vendido en HioPos**.

## Qué hace

| Quién | Qué hace en la app |
|---|---|
| **Obrador** (Güemes abastece Rosario, Palermo abastece DOT) | Carga el remito por área (Laminados 0001, Pastelería 0002, Panadería 0003, General 0004, Cocina 0005), con bultos (tappers, latas, bowls), quién lo lleva, cortesías, especial del mes y renglones libres (lechuga, insumos, etc.). Lo despacha. |
| **Local** (Rosario: Guemes, Funes, Florida, Alto Rosario y Centro · Buenos Aires: DOT) | Ve al instante lo que viene en camino. Al llegar, cuenta y carga lo recibido. Las diferencias quedan marcadas en rojo con observación. |
| **Administración** | Ve todo en vivo, importa las ventas de HioPos, ve el contraste enviado vs. vendido y administra productos, áreas, locales y usuarios. |

Cada acción queda registrada con usuario, fecha y hora (trazabilidad completa).

**App online:** https://mauridduran.github.io/heroica-remitos/
**Código:** https://github.com/mauridduran/heroica-remitos · **Base de datos:** proyecto Supabase `heroica-remitos` (São Paulo).

Para actualizar la app publicada, subir los archivos modificados al repositorio de GitHub (misma carpeta); GitHub Pages la vuelve a publicar sola en 1–2 minutos.

## Probarla ya (modo demo)

Sin configurar nada, la app arranca en **modo demo** con datos de ejemplo guardados en el navegador:

```bash
cd remitos-app
python3 -m http.server 8765
```

Abrir http://localhost:8765 y elegir un usuario. Para ver el tiempo real, abrir otra pestaña con otro usuario (por ejemplo, obrador en una y local en otra).

## Ponerla online (Supabase + hosting gratuito)

1. **Crear el proyecto en Supabase**: https://supabase.com → New project (región São Paulo, la más cercana).
2. **Crear la base de datos**: en el proyecto, abrir *SQL Editor → New query*, pegar todo `supabase/schema.sql` y hacer clic en *Run*. Después hacer lo mismo con `supabase/seed.sql`, que carga las áreas y los 147 productos de los remitos en papel.
3. **Conectar la app**: en *Project Settings → API*, copiar `Project URL` y `anon public key` en `js/config.js`:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ...',
   ```
   La *anon key* es pública por diseño. La seguridad la dan las reglas (RLS) del `schema.sql`. **Nunca** pongas la `service_role` key.
4. **Publicar la carpeta `remitos-app/`** en un hosting estático gratuito: Netlify (arrastrar la carpeta en app.netlify.com/drop), Vercel o Cloudflare Pages.
5. **Usuarios**: la **primera persona que se registra queda como administrador**. El resto se registra desde la pantalla de ingreso y el admin le asigna el rol (obrador o local) y su sede en *Configuración → Usuarios*.
   - Opcional: en Supabase → *Authentication → Providers → Email*, desactivar "Confirm email" para no tener que confirmar por mail.

## Ventas de HioPos

En *Ventas HioPos* (solo admin) se sube el informe de **ventas por artículo** exportado desde HioPos (Excel o CSV). La app:
- detecta las columnas (fecha, código, artículo, unidades, importe);
- toma la tienda y la fecha del encabezado del informe si no vienen por línea;
- asocia cada artículo con el producto por su **código HioPos** (cargarlo en *Configuración → Productos*);
- si se vuelve a importar el mismo día y local, reemplaza los datos en vez de duplicarlos.

Hay un archivo de ejemplo en `ejemplos/ventas_hiopos_ejemplo.csv`.

**Factor HioPos**: si un producto se envía entero y se vende fraccionado (por ejemplo, una tarta entera que se vende en 8 porciones), cargar `8` en *Unidades HioPos por unidad enviada* y el contraste lo convierte solo.

## Estructura

```
remitos-app/
  index.html            entrada de la app
  css/styles.css
  js/config.js          ← datos de conexión a Supabase
  js/app.js             pantallas y lógica
  js/db-supabase.js     conexión real (Postgres + tiempo real)
  js/db-demo.js         modo demo (navegador)
  js/catalogo.js        catálogo generado
  supabase/schema.sql   tablas, seguridad y funciones
  supabase/seed.sql     áreas + productos
  tools/generar_catalogo.py   catálogo de productos (editar acá y regenerar)
```

## Base de datos

- `locations`: obradores y locales · `areas`: áreas con su prefijo de talonario · `products`: catálogo (área, sección, código HioPos, costo, factor)
- `remitos` + `remito_items`: cabecera y renglones (enviado / recibido / observación, cortesía, especial, ítem libre)
- `remito_eventos`: historial completo (creado, despachado, recibido, con diferencias, anulado)
- `ventas`: ventas importadas de HioPos por día, local y artículo
- `profiles`: usuarios con rol (admin / obrador / local) y sede

Los cambios de estado de un remito se hacen solo por funciones del servidor (`crear_remito`, `despachar_remito`, `recibir_remito`, `anular_remito`), que validan permisos y estados, numeran el talonario sin huecos y registran el historial.
