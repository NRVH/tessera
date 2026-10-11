# MySQL: el túnel por un `stream`, el certificado contra el servidor real y cada valor como su texto exacto

- **Estado:** vigente
- **Ámbito:** `src/tdb/mysqlComun.cjs`, `src/tdb/celdasMysql.cjs`

## Contexto

mysql2 verifica el certificado contra el `host` al que conecta y lo manda por SNI; por un túnel SSH ese
host es 127.0.0.1. Y su conversión de tipos por defecto no es exacta: los DECIMAL grandes, los FLOAT, las
fechas con cero (`0000-00-00`), las horas negativas, el BIT o la geometría cambian por el camino.

## Decisión

- **Cifrado**: sin cifrar por defecto (como PG); cifrando, se verifica la cadena con las CA del
  paquete y del sistema y el NOMBRE del servidor (`verifyIdentity`), o nada con «Confiar en el
  certificado del servidor». Los errores de cifrado dicen qué casilla tocar (sin TLS en el servidor;
  servidor que exige TLS, 3159; certificado que no se verifica).
- **Túnel**: `host` es el servidor REAL (el nombre del certificado) y un `stream` abre el socket al
  extremo local del túnel. Así se verifica igual con túnel que sin él.
- **Valores**: un `typeCast` que lee del protocolo de texto el valor tal como lo escribe el servidor:
  enteros, DECIMAL, FLOAT, DOUBLE, YEAR, fechas y horas como texto exacto; el BIT como su número sin
  signo (`b'1010'` es `10`); el JSON como su texto (`jsonStrings`: MariaDB lo manda como LONGTEXT con
  formato `json`); la geometría como WKT (con `SRID=` si no es 0); lo binario como `Buffer` y en la
  rejilla `0x…`. Las cadenas, en su juego de caracteres, y las filas como arrays (dos columnas del
  mismo nombre no se pisan).
- **Tipos de columna**: el escrito (`int unsigned`, `decimal(30,10)`, `varchar(50)`, `datetime(3)`,
  `enum`) sale de los metadatos de la columna, con la longitud de texto en caracteres de utf8mb4.
- **La sesión** al abrir: versión mínima (MySQL 8.0, MariaDB 10.4) con un mensaje que la dice, el
  modo SQL sin los dos modos que cambian el léxico, `group_concat_max_len` alto y, en solo lectura,
  `SET SESSION TRANSACTION READ ONLY`.
- **Posición de un error**: el 1064 dice la línea y el texto desde el error (`near '…' at line N`) y el
  1054 la cláusula de la columna; se buscan en lo que VIAJÓ y se devuelven al texto del usuario con el
  mapa de las sustituciones de los `?`.

## Descartes

- El `ssl.servername` de mysql2: no existe; el `stream` es la forma de separar a quién se conecta de
  quién se verifica.
- `decimalNumbers` o números de JavaScript: pierden precisión.
