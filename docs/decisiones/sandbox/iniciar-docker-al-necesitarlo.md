# Tessera inicia Docker cuando una orden lo necesita, y dice si no lo logra

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/gestor/arranqueDocker.ts`, `src/main/sandbox/adaptadores/lanzarDocker.ts`,
  `terminalAgente/apertura.ts`, `aperturaManual.ts`, `recarga.ts`, `agentes/delegacion/ServicioDelegacion.ts`

## Contexto

Tras un corte de luz o al encender el equipo, Docker suele estar apagado. El trabajo pendiente vive en sus contenedores:
una pestaña de Docker o una tarea delegada no se podía retomar hasta que alguien abriera Docker a mano, también cuando
esas pestañas están ocultas y quien retoma el trabajo es un agente nativo.

## Decisión

- **El primer paso es intentar levantarlo.** Abrir o reabrir un agente de Docker, delegar, continuar una tarea y consultar
  sus modelos inician Docker si el motor no responde, y esperan hasta tres minutos a que conteste.
- **Solo cuando algo lo necesita.** Abrir Tessera no lo inicia por sí mismo, porque Docker ocupa memoria y puede no hacer
  falta; sí lo hace una pestaña de Docker que se abre al estar a la vista.
- **Lo inicia Tessera, no el agente.** El agente no necesita saber cómo se arranca en cada sistema ni recibe esa capacidad
  (`el-agente-pide-tessera-ejecuta.md`). Las órdenes son fijas: `docker desktop start` y, si esa versión no la tiene,
  el camino de cada plataforma. Con Docker Engine en Linux hace falta `sudo`: no se arranca y se dice.
- **Nada a escondidas.** La pestaña que espera lo escribe en su terminal; la tarea lo cuenta en su actividad. Una tarea se
  acepta al momento, con su id, aunque arrancar Docker tarde más que lo que espera `tctx`.
- **Si no arranca, se dice y lo resuelve la persona.** La pestaña enseña el error con «Reintentar», y la tarea termina como
  fallida por Docker, en rojo en su indicador y con su código de salida. El agente nativo se lo comunica al usuario, que
  puede revisarlo o pedirle que lo diagnostique. Tessera no insiste por su cuenta.
- **Solo si el motor no contesta.** Docker en modo sin privilegios u otro problema con el motor en marcha no se arregla
  iniciándolo: se informa directamente.
- Con el motor parado, una tarea que pide `--modelo` no se comprueba contra el catálogo: no hay contenedor al que
  preguntar. Si el modelo no vale, el CLI lo dice al empezar.

## Alternativas descartadas

- **Iniciar Docker al abrir Tessera:** gasta memoria en sesiones que no lo usan.
- **Un botón «Iniciar Docker» en el error:** obliga a intervenir en el caso normal, y con las pestañas ocultas no hay
  donde pulsarlo.
- **Que lo arranque el agente nativo por su cuenta:** cada agente tendría que saber cómo hacerlo en cada plataforma.
