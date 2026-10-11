# El cifrado de las conexiones es el mismo par de casillas en todos los motores de red, y Oracle solo verifica

- **Estado:** vigente
- **Ámbito:** `src/shared/motores/*.ts` (`opcionales`, `tlsPorDefecto`, `admiteConfiarCertificado`), `src/tdb/tlsComun.cjs`,
  `src/tdb/postgres.cjs`, `src/tdb/oracle.cjs`, `features/bd/camposConexionPresentacion.ts`

## Contexto

SQL Server, MongoDB y Redis cifraban con dos casillas (`DbTls`: cifrar, y confiar en el certificado sin verificarlo);
PostgreSQL y Oracle no cifraban nada. Sin SSL no se conecta a ningún PostgreSQL en la nube, que lo exigen todos.

## Decisión

- PostgreSQL y Oracle declaran `tls` como los demás. Nacen SIN cifrar (`tlsPorDefecto`): una conexión guardada antes
  no cambia de comportamiento, y un servidor local no suele cifrar.
- Verificar es comprobar el certificado y el NOMBRE del servidor (el `verify-full` de libpq) contra las CA del paquete
  de Node y las del SISTEMA (almacén de Windows, llavero de macOS): una CA de empresa instalada en el equipo vale sin
  configurar nada en Tessera. Confiar es cifrar sin comprobar (el `require` de libpq). No hay un tercer modo
  (`verify-ca`) ni una CA por archivo: con las del sistema basta para lo indispensable.
- PostgreSQL traduce los tres fallos de cifrado a su remedio, citando la casilla tal como la pinta el formulario: el
  certificado no verificado, el servidor sin SSL y el servidor que lo exige (`hostssl` en `pg_hba.conf`).
- Oracle cifra por TCPS (`tcps://` en Easy Connect, `PROTOCOL=TCPS` por SID). El cliente thin de oracledb verifica
  SIEMPRE el certificado (`rejectUnauthorized` fijo) y no admite CA por conexión: el formulario no ofrece «confiar»
  (`admiteConfiarCertificado: false`), el main no lo guarda aunque llegue de otro motor al cambiarlo, y las CA del
  sistema pasan a ser las de confianza por defecto del proceso (`tls.setDefaultCACertificates`), que es uno por
  conexión. El cliente thick (bases anteriores a 12.1) cifraría con un wallet de Oracle que Tessera no gestiona: con
  cifrado no se escala a thick, y se dice que se desmarque.
- Lo común (las CA, el error de certificado en la cadena de causas y su mensaje) vive en `tlsComun.cjs` para todos los
  motores; el mensaje quita la coletilla de Node sobre `--use-system-ca`, que no le sirve al usuario.

## Consecuencias

Un PostgreSQL gestionado conecta marcando una casilla. Un Oracle con certificado autofirmado solo conecta si su CA está
instalada en el sistema. Oracle 11g no cifra.

Contra servidores reales (`scripts/pruebas/oracle.sh tcps 11` y `… tcps 21`): la 21 se prueba entera por TCPS; la 11.2
solo en lo que no necesita su listener TCPS (cifrar contra su puerto TCP y el proceso ya en thick). A la 11.2 XE de las
pruebas no se le puede poner TCPS: su auto-login (`cwallet.sso`) tiene un formato que los `orapki` publicados ya no
escriben (ORA-29106), y la imagen no trae el suyo. Queda sin probar en real el caso «11g con TCPS y la CA instalada»
(el saludo TLS pasa y thin rechaza la versión): lo cubre la misma rama que el proceso en thick.

## Descartes

- Los cuatro `sslmode` de libpq en un desplegable: dos casillas iguales en todos los motores cuentan lo mismo.
- Un campo de CA por archivo: una ruta del equipo que no viaja entre máquinas, y el almacén del sistema ya lo cubre.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` para que Oracle «confíe»: apaga la verificación de todo el proceso, no de una conexión.
