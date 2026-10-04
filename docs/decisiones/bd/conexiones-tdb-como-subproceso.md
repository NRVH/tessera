# El main nunca carga los drivers de bases de datos: todo pasa por `tdb` como subproceso

- **Estado:** vigente
- **Ámbito:** `src/main/db/DbController.ts`, `src/main/db/controlador/invocacionTdb.ts`

## Contexto

`initOracleClient` solo admite una llamada por proceso (`NJS-090` a la segunda con otra ruta): si el main
cargara el Instant Client quedaría casado con esa versión hasta reiniciar la app, y el día que convivan una
base 11.2 y una 9.2 se rompería. Además, un addon nativo que se cuelga se lleva por delante un proceso de
unos 400 ms, no Tessera entera.

## Decisión

- El main nunca carga `oracledb` ni `pg`. «Probar conexión», el agente y las terminales ejecutan `tdb` como
  subproceso, así que un fallo se reproduce igual desde los tres sitios.
- El explorador mantiene la decisión con otra forma: un proceso de sesión de vida larga por conexión
  (`src/tdb/sesion.cjs`), porque una transacción, una cancelación o un cursor paginado no sobreviven a un
  proceso por consulta. Ese proceso lo gobierna el controlador del explorador, no `DbController`.
- Como cada invocación es un Electron entero, hay un tope de cantidad (4 vivas a la vez, en todo el proceso)
  además del de tiempo (90 s) y de salida (32 MiB). Es una cola propia: no se comparte con `runDocker` ni con
  la de git, o una consulta lenta a Oracle retrasaría un `git status`.
- Cuando `tdb` no llega a responder (se cae, no arranca, se pasa de un tope), «Probar» enseña la causa por los
  campos del error (código, señal, tope) y no el `message` de `execFile`, que es la línea de órdenes entera con
  rutas del host. El detalle va al log. El error del servidor (ORA-12154, VPN caída) se enseña crudo a
  propósito: es lo que sirve para depurar.

## Consecuencias

- Los errores de escritura del registro que llegan al renderer pasan por `sinRutasDelHost`: un error de `fs`
  en crudo lleva la ruta de `userData`.
- Con el puente vivo, «Probar» acuña un token de un solo uso en vez de meter la contraseña en el entorno del
  subproceso; sin puente, la contraseña viaja con la huella de su destino.
