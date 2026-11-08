# «Pegar URI» de PostgreSQL traduce `sslmode` a los dos interruptores de cifrado

- **Estado:** vigente
- **Ámbito:** `src/shared/uriConexion.ts` (`descomponerUriPostgres`)

## Contexto

`postgres://` y `postgresql://` con `[usuario[:clave]@]host[:puerto][/base][?opciones]`. Entra por el mismo corte de la
URI que MongoDB y Redis (`partirUri`). El cifrado de PostgreSQL son dos interruptores (cifrar y confiar en el certificado;
ver `conexiones-cifrado.md`) y el motor nace sin cifrar.

## Decisión

- `sslmode` ausente o `disable`: sin cifrar. `require`: cifrar confiando (no se verifica el certificado). `verify-ca` y
  `verify-full`: cifrar verificando. Los interruptores no distinguen la CA del nombre del host: ambos verifican igual.
- `prefer` y `allow` admiten texto claro si el servidor no ofrece SSL. El formulario solo sabe cifrar o no, así que se
  cifra confiando: guardar «sin cifrar» enviaría la clave en claro a un servidor que sí cifraba, y el fallo del lado
  contrario (un servidor sin SSL) es visible y el error de conexión ya nombra el interruptor que hay que desactivar.
- Un `sslmode` con otro valor es un error al pegar. El resto de opciones no se guarda (no cambian a qué servidor se
  conecta): se descartan y se dicen, sin validarlas.
- Varios hosts es un error; un socket local, también, como en MongoDB.

## Descartes

- Interpretar `sslrootcert`, `sslcert` o `sslkey`: la conexión no tiene dónde guardarlos.
