# Catálogo de clientes Oracle: un pack puede cubrir más de lo que Oracle soporta, y lo dice

- **Estado:** vigente
- **Ámbito:** `src/main/db/driverPacks.ts` (macOS: sin verificar aquí)

## Contexto

El modo thin de node-oracledb (JS puro, empaquetado) solo habla con Oracle 12.1 o superior; las bases heredadas
exigen el modo thick, con las librerías del Instant Client. Lo que Oracle publica es la matriz de soporte (el 23
soporta 19c+, el 21 12.1+, el 19 11.2+), no un límite técnico. Aquí se decía que el 21c y posteriores ya no
alcanzan a 11.2 sin haberlo medido: el Instant Client 23.26 de Windows entra en una 11.2.0.2 en thick y pasa
`test:db-oracle` entero (164/164).

## Decisión

- Un pack declara `soporteOracleDesde` y un `aviso` cuando cubre más de lo soportado: «Tessera informa, no
  prohíbe». Nada se le pregunta al usuario: se sondea la versión del servidor y se resuelve el pack contra la tabla.
- Cada pack declara en qué `plataformas` existe y su centinela va por plataforma (`oci.dll` frente a
  `libclntsh.dylib`). `packsDePlataforma(p)` es la única puerta y publica el pack con el centinela ya resuelto a
  string, porque `tdb.cjs` y `oracle.cjs` lo leen así del `catalogo.json` (contrato estable del CLI).
- macOS: un solo pack, el Instant Client 23 arm64, que Oracle publica solo como .dmg. Cubre 11.2 y superior con el
  aviso de 11.2–18c. Su URL es la versionada con su SHA-256, no el enlace «permanente» (sirve la 23.3): subir de
  versión es un cambio que se revisa y exige volver a pasar `test:db-oracle` contra una 11.2. Sus dylibs piden
  macOS 13 y Tessera admite el 12: allí el pack se lista sin descarga y con el porqué. Sin pack para Intel ni Linux.

## Descartes

- Un `centinela: string` compartido con alternativas («oci.dll o libclntsh.dylib»): en Windows aceptaría una
  carpeta de Mac copiada por error y el fallo aparecería al cargar la librería.
