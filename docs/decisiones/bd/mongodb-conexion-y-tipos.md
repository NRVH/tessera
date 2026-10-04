# MongoDB: contraseña fuera de la URI, tipos numéricos explícitos y cancelar solo donde el driver puede

- **Estado:** vigente
- **Ámbito:** `src/tdb/conexionMongodb.cjs`, `src/tdb/ejecutarMongodb.cjs`, `src/tdb/textoMongodb.cjs`, `src/tdb/cargaMongodb.cjs`

## Contexto

Driver `mongodb` 7.7.0 (JS puro) bajo el Node de Electron. BSON y EJSON salen del propio driver: en
`node_modules` hay una sola copia de `bson`, así que los objetos del parser son los que el driver serializa.

## Decisión

- El driver, el parser de literales y `acorn` se cargan perezosos y cada caché tiene un dueño
  (`cargaMongodb.cjs`): `tdb ls` no los paga, y `test-motores-tdb` fija que cargar un adaptador no arrastra
  ningún driver.
- La contraseña nunca va en la URI (acabaría en logs y mensajes de error): va en `opciones.auth`, con el
  usuario. `directConnection=true` con un solo host, sin `srv` y sin `replicaSet=`, `directConnection=` ni
  `loadBalanced=` en `opcionesUri` (lo que hace mongosh: un replica set no se queda en la dirección que se
  le da, y detrás de un túnel eso rompe). Las claves `tls*` y `ssl*` de `opcionesUri` se descartan aquí
  aunque el main ya las rechace al guardar: el cifrado lo decide `tls`, no dos sitios a la vez.
- Sin `authSource` el driver autentica en la base de la ruta, como mongosh. No se fuerza `admin`: rompe al
  usuario creado en su propia base, que es tan normal como el otro. El remedio es `authSource` en las
  opciones, que el formulario enseña como «Base de autenticación».
- EJSON relajado pierde los `Long` (`9007199254740993` vuelve como `…992`). El texto de un documento es la
  notación del shell con los tipos explícitos donde un número a pelo cambiaría de tipo: `NumberLong("…")`,
  `NumberDecimal("…")` y `Double(34)` para un double sin decimales. Los documentos de usuario se leen con
  `promoteValues: false`; un entero a pelo es `Int32`, lo que el driver escribe al volver.
- Cancelar es `signal` (`AbortSignal`) en las operaciones que lo admiten (`find`, `findOne`, `aggregate`,
  `countDocuments`, `command`, `listCollections`), y `comment: 'tessera:<id>'` siempre. Las escrituras no
  aceptan `signal` en el driver 7 y no se simula: abandonar la promesa diría «cancelada» de algo que el
  servidor termina igual. `maxTimeMS` no se pone. `distinct` va como comando porque `col.distinct` no
  admite `signal`.
- Transacciones solo en replica set o mongos (`hello.setName` o `msg: 'isdbgrid'`). Con cifrado verificado,
  `ca` lleva las CA del sistema y las del paquete: sustituye al almacén por defecto de Node.

## Descartes

- El EJSON relajado de la investigación: además de los `Long`, convertía un double 34.0 en un int 34 al
  editar.
- Forzar `authSource=admin` con usuario.
