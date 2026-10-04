# El autocompletado filtra por subcadena y ordena por niveles propios; Monaco solo pinta

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/autocompletado/sugerenciasSql.ts`, `candidatosSql.ts`, `fuenteCatalogo.ts`, `proveedorSqlMonaco.ts`

## Contexto

El filtro difuso de Monaco exige empezar en borde de palabra: `ROFIL` no encuentra `PROFILE`. Y su
puntuación decide el orden, cuando lo útil es un orden por cercanía al esquema actual. El índice
puede tener 200 000 nombres.

## Decisión

- Cada ítem lleva `filterText` = lo tecleado e `incomplete: true`: Monaco puntúa igual todas y el
  orden lo decide `sortText`. Filtramos nosotros por SUBCADENA y ordenamos por niveles: 0 exacta,
  1 prefijo local, 2 prefijo en otros esquemas, 3 y 4 subcadena (local, otros), 5 sinónimos
  públicos, 6 palabras clave; -1 (`/`) para lo que sale de una FK y «Expandir columnas». Dentro de
  un nivel: tipo, longitud y nombre; las columnas sin prefijo, en el orden de la tabla.
- `sortText` va en anchura fija y en MINÚSCULAS: Monaco lo compara pasado a minúsculas.
- «Local» = el esquema actual y el implícito del descriptor (`public` en PG): decide el nivel y si
  se inserta calificado. Los sinónimos públicos nunca se califican, y solo existen si el motor
  tiene pseudo-esquema (`catalogo.pseudoEsquemaPublico`).
- Palabras clave solo por PREFIJO (la subcadena traía CASE, ELSE, CLOSE al teclear `se`), en la
  caja de lo tecleado. Todo lo que se inserta pasa por `citarSiHaceFalta` del motor.
- Coste: se filtra a candidatos ligeros y se eligen los `limite` mejores sin ordenar la lista
  entera; solo esos se convierten en `Sugerencia`.
- El rango lo da `palabraEnCursor` con el léxico del motor (`$`, `#` en Oracle): `insert` hasta el
  cursor, `replace` hasta el final de la palabra.

## Consecuencias

- Con `incomplete`, cada tecla vuelve a preguntar y la lista puede parpadear al teclear rápido.
- Quitar el `filterText` igualado devuelve el orden a la puntuación de Monaco.

## Descartes

- Devolver todo y recortar en el proveedor: el coste está en crear y ordenar lo que no se ve.
- Deduplicar la misma columna de dos tablas: son dos sugerencias, y el detalle dice de dónde sale.
- Calificar las columnas con su alias al insertar: cambiaría un caso ya correcto.
