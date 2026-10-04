# Las celdas viajan como texto exacto, con topes y las fechas de Oracle desde sus bytes

- **Estado:** vigente
- **Ámbito:** `src/tdb/celdas.cjs` y sus piezas `celdasComun`, `celdasOracle`, `celdasPostgres`,
  `fechasOracle`; el trabajador de sesión y `test-celdas-trabajador.mts`

## Contexto

`NUMBER(38)` y `numeric` no caben en un double. En thin, `resultset.js` de oracledb decodifica
DATE y TIMESTAMP como `Date` y, si se pide VARCHAR, les aplica `Date#toString()`: ignora el NLS,
pierde los microsegundos y desplaza la hora que no existe en la zona local. Un `SELECT *` con LOB
de 50 MB tumbó el proceso y con él las transacciones de las demás consolas de la conexión.

## Decisión

- Los números viajan SIEMPRE como texto exacto (Oracle normaliza «.5» a «0.5»). La página es
  `filasJson`, un string opaco ([contratos-explorador-sql.md](contratos-explorador-sql.md)).
- Fechas de Oracle: thick pide VARCHAR y formatea el cliente con el NLS fijado al abrir; thin
  entrega el `Date` con los bytes originales colgados de un símbolo (`parchearFechasThin` envuelve
  `BaseBuffer#parseOracleDate`) y el texto sale de esos bytes. Si el parche no se instala, se
  formatea el `Date` con los getters locales y se pierde lo que hay por debajo del milisegundo.
- LOB como locator explícito, nunca entero: se leen 64 KiB más la longitud. El binario sale como
  `0x…` en mayúsculas y truncado; `recortes` lleva la longitud original.
- Topes: 64 Ki unidades UTF-16 por celda y 4 Mi de `filasJson` por respuesta (siempre una fila
  al menos), medidos en UTF-16 y no en bytes UTF-8 porque es lo que se copia al serializar.
- PostgreSQL: el trabajador pide texto crudo (salvo bool); aquí solo se traduce bytea y se recorta.
- La salida del servidor (DBMS_OUTPUT, NOTICE) va dentro del resultado, con tope de 1000 líneas
  o 1 Mi de caracteres y una última línea que dice qué se descartó.

## Consecuencias

- Un TIMESTAMP WITH TIME ZONE con zona por nombre de región llega en thin con un id que no se
  sabe traducir: se muestra el mismo instante en UTC (`+00:00`).
- Sin `require` de drivers al cargar: `oracledb` entra por parámetro.

## Descartes

- Pedir las fechas como texto en thin. Fijar `TZ=UTC`: cambia la zona de la sesión Oracle y con
  ella `CURRENT_DATE`.
