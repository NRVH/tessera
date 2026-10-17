# «Pegar URI» de MongoDB rechaza lo que el driver rechaza y guarda campos, no la URI

- **Estado:** vigente
- **Ámbito:** `src/shared/uriConexion.ts` (`descomponerUriMongo`, `validarOpcionesUriMongo`), `src/tdb/mongoComun.cjs`

## Contexto

Las conexiones de MongoDB se comparten como URI (`mongodb://…`, `mongodb+srv://…`) y el formulario es de
campos. La descomposición y la validación de las opciones que se guardan (`opcionesUri`, lo de detrás de
`?`) las usan el formulario (al pegar y en vivo) y el main (al guardar): las dos puntas dicen lo mismo.

## Decisión

- Lo que el driver rechaza se rechaza aquí, con su motivo y en el idioma de la interfaz:
  `srv` con puerto, con varios nombres o con `directConnection=true`, `tls` y `ssl` que no coinciden, una
  opción sin valor o repetida. Mejor el error al pegar que un `MongoParseError` al probar.
- Varios hosts sin `srv` (un replica set sin DNS SRV) van al campo host como lista, `h1:27017,h2:27018`,
  cada uno con su puerto si lo trae, y `port` es el de los que no. Es el mismo texto que escribe quien la
  teclea a mano, y la huella del destino lo cubre entero: la contraseña va solo a esa lista. Con varios no
  se añade `directConnection=true` (el driver descubre la topología entre ellos): con un solo miembro, una conexión tras un DNS sin SRV
  dejaría de funcionar si ese cayera.
- El TLS sale de las opciones y va a las casillas (`DbTls`): `tls`/`ssl` a `cifrar`;
  `tlsAllowInvalidCertificates`/`tlsInsecure` a `confiarCertificado`. Sin decir nada: con `srv`, cifrar; sin
  `srv`, el valor por defecto del motor (sin cifrar), no `TLS_POR_DEFECTO`. `tlsAllowInvalidCertificates`
  sin `tls=true` no cifra, como en el driver. Las demás opciones de TLS van a `descartadas`.
- La base de la ruta es también la de autenticación cuando no hay `authSource`: al descomponer una URI sin
  `srv`, con usuario y base y sin `authSource`, se añade `authSource=<base>`. Con `srv` no (el registro TXT
  de Atlas pone el suyo) y con un `authMechanism` que no es SCRAM tampoco (el driver exige `$external`).
- La contraseña se acepta con una `@` sin codificar (el usuario acaba en la última `@`): aquí no se
  reenvía la URI, solo sus campos. `/`, `?` y `#` sin codificar no se recuperan, y un `%` suelto es un
  error con su remedio (`%25`). Un IPv6 se devuelve sin corchetes en `host`.
- La contraseña nunca va en una URI guardada: acabaría en logs y mensajes de error.

## Descartes

- `new URL()` y `URLSearchParams`: `URL` no admite varios hosts ni el IPv6 de Mongo sin reescribirlo, y
  `URLSearchParams` convierte `+` en espacio. Se parte a mano con las reglas del driver.
- Importar `mongodb-connection-string-url`: el renderer no carga dependencias del driver.
- Guardar la URI entera: la huella, `tdb ls` y el árbol trabajan con campos.
