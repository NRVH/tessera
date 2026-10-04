# El catálogo del autocompletado es un adaptador sobre la caché del árbol, sin almacén propio

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/autocompletado/catalogoAutocompletado.ts`

## Contexto

El árbol, el selector de esquemas y el autocompletado leen el mismo catálogo. Un almacén aparte
para el autocompletado era una tercera caché invalidando lo mismo: acababan discrepando, y la tabla
recién creada salía en el árbol y no al escribir. Además el autocompletado pregunta en cada tecla.

## Decisión

- `CatalogoAutocompletado` no guarda datos: lee de `cacheMetaBd` y le pide lo que falta (ella
  deduplica en vuelo y no viaja si lo tiene fresco). Se crea uno por pregunta.
- Dos mitades: LECTURA síncrona con lo que haya, aunque esté obsoleto (lo pide la parte pura), y
  CARGAS que disparan y devuelven la promesa; cuánto esperar lo decide el proveedor.
- El esquema de la sesión (y la base) se lee UNA vez al construir: es la clave del índice, y una
  clave que cambia a mitad de pregunta leería un índice y esperaría otro. Mientras el índice de la
  sesión no llega se lee el de sin sesión, si estaba, para que la lista no se vacíe al abrirla.
- `ESQ.` fuera del índice se carga con ese esquema como «actual»: el main memoriza por esquema.
- Los sinónimos se resuelven a su destino, mirando el tipo en el índice ANTES que las columnas:
  pedidas como tabla salen vacías, la caché guardaría ese vacío y el sinónimo se quedaría sin
  columnas. Un destino sin columnas (un paquete) da `[]`, no null, para no repreguntar.
- Los fallos se recuerdan 30 s (`ERROR_NOMBRES_MS`): la caché no recuerda los de columnas,
  resoluciones ni esquemas, y con la red caída cada tecla era un viaje fallido.
- `esquemas()` deja fuera los pseudo-esquemas: `PUBLIC.X` no se escribe en SQL.
- Los nombres escritos se llevan al del catálogo por `claveDeNombre` (SQLite y SQL Server comparan
  sin caja); en Oracle y PG la clave es el propio nombre. En OTRA base no hay sinónimos.

## Consecuencias

- La memoria de fallos es solo de tiempo: tras «Refrescar» con la red ya levantada, las columnas
  pueden tardar hasta 30 s en reintentarse (el índice no: su error lo borra la caché).

## Descartes

- Disparar las cargas desde los getters: `esquemaDeRef` pregunta en cada esquema local y pedía
  columnas de `EMP` también en `public`. Lo que falta lo calcula `pendientesDeCarga`.
- Cargar las carpetas del árbol para `ESQ.`: siete u ocho viajes por lo que da una consulta.
