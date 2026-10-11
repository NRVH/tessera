# Si el agente informa su estado (OSC 7501), manda él; la deducción queda para el que no informa

- **Estado:** vigente
- **Ámbito:** `src/main/agents/estadoPrograma.ts`, `agents/agentActivity.ts`, `agents/terminalAgente/turnos.ts`,
  `shared/agent-terminal-ipc.ts` y `features/agentes/agentActivity.ts` (y los puntos que lo pintan)

## Contexto

El estado de cada agente se deducía (`turnos-actividad-del-agente.md`): el Enter abre, y cierran la marca del
transcript, el BEL, el silencio o un tope. Tiene dos huecos que se ven: «te espera» (un permiso, una pregunta) no
existe, porque sin BEL se confunde con «terminó» a los 10 s de silencio, y el punto puede quedarse pegado cuando la
marca del transcript no llega o no casa. El «Program Status Protocol» (OSC 7501, revisión 0.3) es el agente diciendo
su estado por su propia salida: `idle`, `working`, `done`, `blocked` (con `kind`), `error` y `clear`. Claude Code lo
emite desde la 2.1.295, pero solo si la terminal contesta a su sonda (`OSC 7501 ; ?`), que manda seguida de un
`CSI c`: si llega antes la respuesta a este, da el protocolo por no soportado.

## Decisión

- **El main contesta la sonda** en el mismo trozo en que la ve, escribiendo al pty. El renderer no llegaría a tiempo:
  su respuesta al `CSI c` cruza el IPC y llegaría primero la de xterm. Vale igual en Docker: viaja por el pty.
- **Una respuesta por proceso, y solo desde ella cuentan sus avisos.** Una sonda o un aviso que salgan en lo que el
  agente enseña (un archivo, un log) no pueden apagar la deducción ni escribirle a ciegas en su entrada, y la despedida
  del proceso que muere tras un relanzamiento no cae sobre el nuevo. Un programa que informe sin preguntar antes (la
  especificación lo permite) se queda con la deducción.
- **Desde el primer aviso de una sesión, manda el agente.** El Enter ya no abre, y ni el BEL, ni el silencio, ni la
  marca del transcript cierran. Hasta ese aviso (y en un agente o una versión que no informa, Codex hoy) sigue la
  deducción entera. Se decide por sesión y no por versión: no hay que saber qué CLI lo soporta.
- **El tope sigue, contado desde el último `working`**: un agente que se cuelga sin cerrarse ni avisar no deja el punto
  encendido para siempre, y uno que trabaja horas avisando a cada paso no se corta. Cierra en silencio, y un `working`
  posterior lo vuelve a abrir.
- `working` abre; `done` y `error` cierran con aviso; `idle` y `clear` cierran en silencio; `blocked` cierra el turno y
  emite el estado nuevo `blocked` con su motivo. Solo se avisa de los cambios: el agente repite `working` a cada paso,
  y el `idle` del arranque o un `done` repetido no cierran nada. Un `blocked` es `esperandoRespuesta`, que ya veta la
  hibernación y el reinicio masivo.
- **Solo cuenta el registro raíz.** Los hijos (`id`) no se miran: el raíz ya resume el programa.
- Relanzar el proceso (`finish`) vuelve a la deducción hasta el siguiente aviso, y una espera abierta se apaga.
- **Lo que no vale se descarta entero**, como pide la especificación: un `state` desconocido, un `id` mal formado, un
  texto que no decodifica limpio. Un OSC de más de 4 KiB (un portapapeles) no se guarda. El lector tolera secuencias
  partidas entre trozos en cualquier punto.
- **El BEL que cierra un OSC no es una campana.** Con la deducción, cualquier BEL cerraba el turno, y Claude Code
  termina en BEL sus avisos y sus títulos.
- En la interfaz, «te espera» es un anillo que parpadea alrededor del punto (perfil, casilla del mosaico, selector y
  chip del otro agente): distinto del latido de «trabaja» y del halo de «terminó», y gana a los dos. Además avisa como
  «terminó» si no lo miras, y **vuelve a avisar cada vez que dejas de mirarlo sin contestar**: si no, mirar una pregunta
  y cambiar de pestaña la dejaría sin señal. Una espera que se apaga sin terminar (cancelada, relanzada) se lleva ese
  aviso. La foto del main, al recargar o volver el foco, manda sobre la espera.

## Descartes

- Contestar desde el renderer (`registerOscHandler` de xterm): pierde la carrera con la respuesta al `CSI c`, y la
  sesión no visible no tiene xterm que la conteste.
- Quitar la deducción: es lo único que hay para Codex y para un Claude Code anterior a la 2.1.295.
- Mirar los registros hijos (subagentes): nada de lo medido los usa todavía para algo que el raíz no diga.
