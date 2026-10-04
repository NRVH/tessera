# El guion de Oracle tiene que pasar por SQL*Plus: líneas cortas, sin controles crudos y sin `&`

- **Estado:** vigente
- **Ámbito:** `src/shared/escrituraSql/oracle.ts`, `src/shared/formatosFilas.ts`, `src/shared/sql/dmlRejilla.ts`

## Contexto

Un `.sql` exportado se corre a menudo con SQL*Plus, que lee por líneas y tiene reglas que el servidor no
conoce: medido en la 11.2 y la 21c, el guion de antes no insertaba ni una fila con textos normales.

## Decisión

- **Líneas de como mucho 2400 bytes.** SQL*Plus 11g ignora entera una línea de 2499 o más (SP2-0027) y
  cuenta bytes: 1240 «ñ» en AL32UTF8 ya no entran. Se parte solo entre segmentos (columnas, valores,
  detrás de ` ||`), nunca dentro de un literal; un literal que no cabe se trocea en `'…' || '…'` de ≤ 2000
  bytes. 2400 y no 2498 deja margen a un editor que sangre.
- **Ningún carácter de control crudo dentro de un literal.** Un salto dentro de la cadena hace que
  SQL*Plus corte la sentencia en una línea en blanco, en una que acaba en `;` o en una `/` o `.` solas
  (ORA-01756, SP2-0042). Salen como `CHR(n)` fuera de las comillas, todos menos el tabulador (medido: el
  tabulador, DEL, U+0080–U+009F, U+2028, U+2029 y un BOM entran exactos). Con el `&`: `ESPECIAL_SQLPLUS`.
- **`&` es variable de sustitución** (también en SQLcl y otros clientes): se corta el literal detrás de
  cada `&` (`'AT&' || 'T'`). Solo un `&` en un nombre citado, que no se puede cortar, pone
  `SET DEFINE OFF` al principio.
- **Muchos especiales, `TRANSLATE`.** Cada `CHR(n)` es un operando más y el servidor gasta en analizarlos:
  un CLOB de 16 MiB con un salto cada 48 caracteres daba ORA-04036 en la 21c y 88 s en la 11.2. Un trozo
  con más de `MAX_CORTES_CHR` cortes, o con especiales en un texto de más de `TROZO_CLOB` unidades, usa un
  marcador ASCII que el trozo no contiene y `TRANSLATE('uno~dos~', '~', CHR(10))`: exacto en 35 s en la
  11.2 y sin ORA-04036 en la 21c. Sin marcador libre, `CHR(n)` otra vez.
- **Un nombre con un salto** no se puede cortar, y el propio PL/SQL lo rechaza (PLS-00112). Esa tabla
  escribe cada fila como `BEGIN EXECUTE IMMEDIATE '<el INSERT sin su ;>'; END;` y la `/`, con los valores
  como literales dentro del texto: el servidor convierte cada tipo igual que con el `INSERT` suelto. El
  binario grande va por posición (`:tessera_b1` y `USING`, también con el CLOB temporal: sin él, ORA-01008).
  Un texto de más de `TROZO_EJECUTAR` unidades se arma en un CLOB con `DBMS_LOB.APPEND` de 8000 unidades:
  concatenar con `||` copia lo acumulado y tardaba 269 s con 4 MiB frente a 6. La vista previa de «Enviar»
  de un cambio con un nombre así se enseña como ese bloque con la `/`; las demás llevan `;`.

## Descartes

- `SET DEFINE OFF` general: cambia la sesión de quien lo corre y no es SQL, así que rompe en otro cliente.
- Pasar los valores por `USING`: un bind no se convierte como un literal (`USING NULL` da PLS-00457).
