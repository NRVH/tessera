# Las reglas del perfil las escribe o aprueba el usuario y llegan en el arranque a todo agente del perfil

- **Estado:** vigente
- **Ámbito:** `src/main/profiles/` (`types.ts` `reglas`, `validate.ts`, `borradoDePerfil.ts`), `src/shared/reglasPerfil.ts`,
  `src/shared/reglas-ipc.ts`, `src/main/agents/briefingCompuesto.ts`, `terminalAgente/apertura.ts` y `recarga.ts`, `src/tctx/`,
  `src/main/reglas/` (`propuestasReglas.ts`, `operacionesReglas.ts`, `buzonTctx.ts`, `ipc.ts`, `componer.ts`),
  `src/main/util/atajosPrograma.ts`, `DbBridge.sesionDeToken` y, en `features/pestanas/`, `ReglasPerfilModal`,
  `CapaPropuestasReglas`, `PropuestaReglasModal`, `DiffReglas` y `storePropuestasReglas`

## Contexto

Quien trabaja con varios agentes y cuentas en el mismo perfil repite las mismas reglas en cada proyecto y
en el formato de cada CLI (`CLAUDE.md`, `AGENTS.md`, la memoria de cada cuenta): cómo se sube al
repositorio de un cliente, qué ramas, qué no se toca. Mantenerlas a mano por proyecto y por CLI hace que
se queden viejas, y dejar que los agentes las escriban solas las llena de ruido hasta que estorban.

## Decisión

- **Un texto por perfil, en el propio perfil** (`Profile.reglas`, Markdown). Viaja con el perfil (copia de
  la configuración, borrado) y nunca dentro de un repositorio ni de una carpeta montada en un contenedor.
  Importado a un perfil de aquí que ya tiene otras, se mantienen las de aquí salvo que se elija
  sustituirlas, viendo el mismo diff que en una propuesta ([exportar-importar.md](../configuracion/exportar-importar.md)).
  Tiene tope (`MAX_REGLAS_PERFIL`): con el resto del aviso tiene que caber en la línea de arranque.
- **Lo escribe o lo aprueba el usuario.** Se edita en el diálogo «Reglas para los agentes» del menú del
  perfil. Un agente no lo cambia: lo **propone** con `tctx proponer` (la versión entera nueva, con un
  motivo) y la propuesta queda pendiente hasta que el usuario ve el cambio exacto y la acepta, la edita o la
  descarta. Hay una propuesta pendiente por perfil; una nueva sustituye a la anterior.
- **Llega en el arranque a todo agente del perfil** que reciba aviso (de serie, nativo o en Docker, de
  cualquier cuenta, el de la terminal y el de datos), detrás del de bases y el de SSH, como instrucciones
  del usuario. La línea de arranque aplana el aviso a una línea, así que cada salto de línea de las reglas
  se marca y el aviso dice cómo leerlo. Una regla cambiada no llega a un agente ya abierto: `tctx reglas`
  da las vigentes, y el aviso lo dice.
- **El aviso citado tiene tope** (`MAX_AVISO_CITADO`, 30 000 caracteres, medido sobre el aviso entero ya
  citado con la cita de POSIX, la que más crece: cada apóstrofo pasa a cuatro caracteres). La línea de
  arranque no puede pasar de 32 767 (la creación de procesos de Windows, y el `bash -c` de un contenedor).
  Si con el texto de las reglas se pasa, el aviso las deja fuera y manda a leerlas con `tctx reglas`.
- **`tctx`**, hermano de `tdb` y `tssh`, por el mismo puente y el mismo buzón en Docker: el perfil sale
  siempre del token de la sesión, nunca de la petición. `reglas` las lee; `proponer` deja la propuesta
  (`traspaso` es de `traspaso-entre-agentes.md` y `buscar`, de `buscar-en-el-historial.md`: `reglas/componer.ts`
  registra también las operaciones de `tctx` de otros dominios, y espera las que contestan con una promesa). En Docker el buzón la atiende sin lanzar ningún proceso. El texto llega por `--archivo` (lo recomendado: no
  pasa por las comillas de ninguna shell; lee UTF-8 y el UTF-16 de `Out-File`), por la entrada (`-`) o por
  `--texto`. Para que quepan unas reglas enteras, el tope de una petición del puente es de 32 KiB.
- **Una propuesta pendiente por perfil** en `<userData>/reglas-propuestas.json`; se ignora la de un perfil
  que no existe y el borrado del perfil la quita. Al llegar, un aviso con «Revisar»; como se pierde sin
  ventana, la interfaz pide las pendientes al montar y al abrir el diálogo de reglas. La revisión enseña el
  diff entre las vigentes de ESE momento y la propuesta; aceptar o editar la guarda el renderer (dueño de los
  perfiles) y anota en el main que se resuelva al guardarse esas reglas: el main la quita cuando el guardado
  de perfiles trae las reglas aceptadas, y solo si sigue siendo la misma propuesta. Hasta entonces sigue
  pendiente, así que un guardado que falle no pierde ni las reglas ni la propuesta. El aviso de «Revisar»
  espera a que el perfil esté cargado. Un perfil que se borra pierde su propuesta al empezar el borrado,
  se recree o no con el mismo id.
- El aviso pide al agente proponer, no aplicar: cuando el usuario diga que algo es una regla del perfil o
  lo corrija dos veces, que lo proponga con `tctx proponer`, y que nunca lo trate como aprobado.

## Consecuencias

- Los agentes manuales no reciben aviso (su línea es la del usuario): tienen `tctx` en el PATH pero no
  conocen las reglas salvo que su comando las pida. La ventana de agente independiente no tiene perfil ni
  `tctx`.
- Una propuesta es datos de un agente hasta que se aprueba: nunca entra en un aviso antes.
- `test:reglas-perfil` fija el aplanado, el tope y la validación; `test:briefing-compuesto`, que el aviso las
  lleva en las dos formas de la línea; `test:propuestas-reglas`, el almacén, las operaciones y el buzón;
  `test:tctx`, el CLI de verdad en cada shell y por el buzón; `e2e/reglas-propuesta.spec.ts`, el recorrido.

## Descartes

- Un archivo propio en la carpeta del perfil (`.tessera/perfiles/<id>/`): el borrado del perfil no la
  toca y un perfil nuevo con el mismo id heredaría las reglas; la copia de la configuración no la lleva.
- Escribirlas en el `CLAUDE.md`/`AGENTS.md` de cada cuenta: el agente puede editarlos, cada CLI tiene el
  suyo y un agente en Docker los vería como memoria propia.
- Que los agentes anoten sin aprobación: se llena de ruido y una anotación cualquiera acabaría como orden
  para todos los proyectos del perfil.
