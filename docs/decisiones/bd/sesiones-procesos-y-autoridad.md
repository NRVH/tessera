# Un proceso de sesión por conexión, una cola de una plaza por sesión y la autoridad en el main

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/GestorSesiones.ts` y `sesiones/`, `colaSesion.ts`, `protocoloTrabajador.ts`, `ProcesoTrabajador.ts`, `limites.ts`

## Contexto

Las sesiones SQL del explorador (`meta` para el árbol, `datos` para las rejillas, una por consola)
corren en procesos `src/tdb/sesion.cjs`. Cada sesión solo hace una cosa a la vez, el usuario
necesita parar lo que tarda, y el renderer no es de fiar como autoridad.

## Decisión

- Un proceso por conexión, lanzado bajo demanda, con tope `MAX_PROCESOS` (expulsa el ocioso más
  viejo; solo acota memoria, 8 × ~40 MB) y salida tras un rato sin sesiones. Excepción: un motor
  que no se interrumpe (SQLite, `procesoPorSesion`) tiene un proceso PROPIO por consola, que
  cuenta aparte (`MAX_PROCESOS_CONSOLA`), porque su Stop es matar el proceso.
- Cada sesión, con una cola de UNA plaza propia (`colaSesion.ts`): cancelar UNA tarea por clave,
  prioridad (el árbol antes que el índice) y descarte por clave. La tarea arranca SÍNCRONA si la
  cola está libre: un `cancelar` inmediato la ve en curso.
- Stop por CLAVE: la pestaña de tabla y «Contar» su `peticionId`, la consola su `ejecucionId`.
  En espera, la cola la saca; dentro del trabajador, `cancelar`; abriendo, se apunta.
- Una ejecución de USUARIO por consola (`operacionUsuario`): la segunda responde `ocupada` al
  instante, sin encolarse (el renderer orquesta el lote, su cronómetro y su Stop).
- Autoridad en el main: el trabajador ejecuta lo que se le da; el main vuelve a partir la
  sentencia (`dividirSentencias`, exactamente una), la clasifica y decide las opciones
  (candado, BEGIN perezoso, Manual, releer esquema). El renderer hace un prevuelo con las mismas
  funciones, pero no se le cree.
- El secreto (y la ruta de SQLite) se pide justo antes de `abrir` y se suelta. El protocolo y
  sus vigilantes, en [sesiones-protocolo-del-trabajador.md](sesiones-protocolo-del-trabajador.md).

## Consecuencias

- Sin `electron`: todo se inyecta y se prueba con un transporte falso. La fachada delega sin
  `async` ni `await`: un turno de más desplaza el Stop. `meta` no lleva candado por sentencia.

## Descartes

- Un proceso por sesión (`initOracleClient` es único por proceso; 8 consolas serían 8 Electron).
- Reutilizar `shared/colaConcurrencia.ts`: solo sabe cancelar todo lo pendiente.
