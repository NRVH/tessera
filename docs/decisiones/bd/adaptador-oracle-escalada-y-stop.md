# Oracle escala de thin a thick por el error del servidor y el Stop en thick va con DISABLE_OOB

- **Estado:** vigente
- **Ámbito:** `src/tdb/oracle.cjs`, `src/tdb/clienteOracle.cjs` y el trabajador `src/tdb/sesionOracle.cjs`

## Contexto

node-oracledb arranca en thin (JavaScript puro, empaquetado). Thin no llega a una 11.2
(`NJS-138`), ni a un servidor con cifrado nativo de red (`NJS-533`), ni a un verificador de
contraseña antiguo (`NJS-116`). `initOracleClient` solo admite una llamada por proceso.

## Decisión

- Cada uno de esos códigos escala: se carga el Instant Client y se reintenta en thick; el
  usuario no tiene que saber qué exige su servidor. Un proceso `tdb` por invocación permite
  que convivan bases con clientes distintos. Un solo adaptador para `tdb` y el explorador:
  la escalada es lo caro de mantener.
- Stop en thick: el explorador genera su `sqlnet.ora` con `DISABLE_OOB=ON` (más un `IFILE` al
  del usuario) y lo pasa como `configDir`. Sin él, `connection.break()` vuelve en 1 ms pero la
  consulta sigue: el break va como dato urgente de TCP y VPN y reenvíos de puertos lo tiran.
  Medido contra una 11.2: sin él, sin respuesta a los 20,8 s; con él, cancelada en 818 ms.
- Tras la escalada, `restaurarClasesThick` repone las clases base de oracledb: el intento thin,
  aunque falle, las sustituye y cada LOB llegaba como un `ThinLobImpl` sin conexión.
- Con un cliente cuyo soporte de Oracle no llega a la versión del servidor se avisa
  (`avisoDeSoporte`) y nunca se bloquea. El cliente 23 conecta con una 11.2 (164/164).

## Consecuencias

- `DISABLE_OOB` no lo honra el descriptor ni Easy Connect (probado con el cliente 19): solo
  `sqlnet.ora`. Solo en el explorador: `tdb` no cancela.
- El explorador no toca los globales de oracledb (`outFormat`, `fetchAsString`): se filtrarían
  a las demás sesiones del proceso. Los `atributos` (`expireTime`) solo van en thin.

## Descartes

- Duplicar el adaptador para el explorador.
- `DISABLE_OOB` por conexión: el cliente 19 lo ignora.
