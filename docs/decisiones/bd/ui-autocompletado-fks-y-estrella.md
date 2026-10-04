# Las FKs se sugieren tras JOIN y ON, y el `*` solo se expande con todas sus columnas al día

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/autocompletado/relacionesFk.ts`, `expandirEstrella.ts`, `estrellaSql.ts`, `precargaFks.ts`, `proveedorSqlMonaco.ts`

## Contexto

Sustituir un `*` por una lista explícita cambia el resultado sin ningún error si la lista está a
medias o es de antes de un `ALTER TABLE … ADD`. Y las FKs no tienen fila del árbol que las recargue.

## Decisión

- Tras `JOIN ` van primero las tablas relacionadas por FK con las de SU consulta (tras un UNION se
  empieza de cero), con su ON: alias libre (iniciales; con número si está usado o es reservado),
  la previa nombrada como se escribió, citado por motor y en la caja del JOIN. NATURAL, CROSS y
  APPLY no llevan ON. La palabra a medio escribir no cuenta como alias usado.
- Tras `ON ` (o `AND` dentro del ON), las condiciones de FK en los dos sentidos.
- Lo obsoleto se VUELVE A PEDIR con el mismo tope; si no llega, las FKs se sugieren con lo que hay.
- «Expandir columnas» solo con TODAS las columnas en caché y al día. No se sustituye si una fuente
  no es del catálogo (subconsulta, función de tabla, CTE, enlace `@remota`, otra base) ni tras
  NATURAL, USING o PIVOT (el `*` funde o cambia columnas). Se ofrece como ítem justo tras el `*`
  (con su propio rango) y como acción de código con `versionId`: si el texto cambió, Monaco la
  rechaza. En Mac, ⌘. es Detener en la consola: allí se abre con la bombilla o el ítem.
- Precarga: tras UN segundo sin cambios se piden las FKs de la sentencia del último cambio, hasta
  8 tablas y solo las que existen. Un flush (`setValue`, la primera carga desde disco) no es una
  pausa y cancela la pendiente; la recarga desde disco sí cuenta (es una edición real). Un
  esquema `'PUBLIC'` se da por existente a pelo, sin mirar el motor: así sigue valiendo en PG.

## Consecuencias

- Relajar la condición de «al día» o expandir sobre una tabla ajena reescribe la consulta con
  columnas de otra tabla o de otra época.

## Descartes

- Sugerir FKs en el WHERE de un join a la antigua: compiten con cualquier filtro.
- Una lista del `*` en varias líneas: obligaría a adivinar la sangría; la ordena el formateador.
- Precargar al abrir la consola: son miles de filas para ofrecer una o dos, y con la cola de UNA
  plaza de la sesión de metadatos iría por delante de lo que el usuario despliega en el árbol.
