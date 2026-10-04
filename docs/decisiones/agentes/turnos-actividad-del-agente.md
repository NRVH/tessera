# El turno lo abre el Enter, lo cierra el transcript y el pty solo dice «trabajando»

- **Estado:** vigente
- **Ámbito:** `src/main/agents/agentActivity.ts` y `agents/lineaEnviada.ts`

## Contexto

Decidir el fin de un turno por el caudal de bytes del pty producía ruido: el eco de las teclas
marcaba «trabajando», un repintado fabricaba un falso «listo por revisar», y una interfaz que
repinta sola ronda el umbral y parpadea entre «trabajando» y «listo» o deja el punto del perfil
encendido para siempre. Los dos CLIs escriben el fin de turno en su transcript.

## Decisión

- Abrir lo decide el Enter del usuario (instantáneo). Cerrar, por este orden: la marca del
  transcript, el BEL (cubre «necesito tu aprobación», que no cierra nada en disco), el silencio
  absoluto (cero bytes, no un umbral: no puede oscilar) y un tope de duración que cierra en silencio.
- Solo avisa `done` si el turno produjo trabajo (`turnBytes`): un Enter de menú abre turno igual.
- `esperandoRespuesta` (turno cerrado sin marca y con una apertura del transcript sin cierre) no es
  un estado de actividad: bloquea el reinicio masivo, que teclea `^C` y cancelaría el diálogo.
  Cualquier tecla del usuario la apaga; el foco y demás respuestas automáticas de xterm no cuentan.
- Las respuestas de xterm (OSC de color, DECRQSS) se quitan del stdin antes de reconstruir la línea:
  se leían como Alt+] más texto y un `/clear` dejaba de verse. `puedeTenerTextoSinEnviar` es un
  booleano con su propia pasada sobre el trozo crudo: en él un pegado sí es texto, y solo `\r` la apaga.

## Consecuencias

- Falla hacia el silencio: ante la duda no avisa. Las guardas (eco, `suppress`, contrapresión) están
  acotadas; sin tope, arrastrar el separador congelaba la detección indefinidamente.
- `TurnWatcher` reparte las marcas por nombre de proyecto: otra sesión del mismo proyecto puede
  encender `esperandoRespuesta`, solo mientras trabaja.

## Descartes

- Contar imprimibles y restar retrocesos: miente hacia los dos lados y el malo pierde un borrador.
- Un umbral de caudal para el cierre: es justo lo que producía el parpadeo.
