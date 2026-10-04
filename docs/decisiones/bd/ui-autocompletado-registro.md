# El autocompletado SQL es un proveedor por lenguaje para toda la app, enrutado por la URI del modelo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/autocompletado/proveedorSqlMonaco.ts`, `enrutadorConsolas.ts`, `precargaFks.ts`

## Contexto

Monaco no ata un proveedor de completado a un modelo: se registra por LENGUAJE y responde para
cualquier editor de ese lenguaje. Un `.sql` abierto en el editor de archivos comparte lenguaje con
las consolas, y sugerirle las tablas de la última base consultada sería una sugerencia falsa con
buena cara. Cada consola, además, cambia de esquema a mitad de su vida (`ALTER SESSION SET
CURRENT_SCHEMA`, `SET search_path`, `USE`).

## Decisión

- Se registra UNA vez por instancia de Monaco (un `WeakSet`), en `sql` y en el `sql.lenguajeConsola`
  de cada motor SQL del registro, derivados y ordenados: un motor nuevo tiene autocompletado sin
  tocar el proveedor. La consola puede llamar a `asegurarAutocompletadoSql` al crear cada editor.
- La consola dueña sale de `model.uri.toString()` (`tessera-db://consola/<id>.sql`, el id
  codificado para que las dos cadenas no difieran). Un modelo sin ruta devuelve `[]`.
- El esquema y la base de la ruta son FUNCIONES que leen el estado vivo de la sesión al preguntar.
- La baja de una ruta solo quita SU entrada: un remontaje rápido (StrictMode, cambio de `key`)
  registra la nueva antes de que la vieja se despida. Registrar la misma URI sustituye.
- La acción de código y la precarga de FKs se instalan en ese mismo registro; la precarga vigila
  los MODELOS de consola (existen antes que su editor) y el editor de archivos no paga nada.

## Consecuencias

- Registrar por editor duplicaría las sugerencias; copiar el esquema al registrar calificaría
  contra el esquema de ayer; una baja ciega deja una consola viva sin autocompletado.

## Descartes

- Una lista de lenguajes escrita a mano: un lenguaje de consola nuevo se quedaba sin
  autocompletado sin que nada fallara.
- Que la consola dispare la precarga desde su análisis vivo: ataría el autocompletado al ciclo de
  vida de `useConsola`.
