# El chat vivo se ancla al que Tessera abrió y a los envíos del usuario, en vez de adivinarse por el último evento

- **Estado:** vigente
- **Ámbito:** `src/main/context/anclaConversacion.ts` y las terminales del agente que alimentan el registro

## Contexto

El anillo elegía el chat por la marca del último evento de su transcript. Falla en el caso que más
duele: se reanuda un chat viejo A, se vuelve al chat nuevo C, y C no recibe eventos hasta que se
escriba; A conserva el último y el anillo enseña el 80 % de A mientras se trabaja en uno que ocupa
cero. Del disco solo no se puede saber; Tessera sí sabe con qué chat arrancó la sesión y cuándo se
pulsó Enter.

## Decisión

- Cada (agente, carpeta, proyecto) tiene un ancla con estado `anclada` (`--resume <id>` o aprendida
  por evidencia), `esperando` (sesión nueva: la viva será la primera que reciba un evento desde el
  arranque) o `dudosa` (se tecleó `/resume` o `/clear` dentro del TUI: manda la heurística hasta que
  haya evidencia). El orden de las reglas de `elegirVivo` es la especificación.
- Con envío reciente y otro candidato que recibió un evento después mientras el anclado no, el
  usuario se cambió de chat: gana el otro y se aprende su id. Si no, gana el anclado aunque otro
  tenga un evento más reciente. Un ancla a un chat que ya no existe vuelve a la heurística.
- La clave no lleva el perfil (el lector no lo conoce) y en modo nativo todos los perfiles comparten
  carpeta, así que el registro cuenta sesiones (`refs`) y el ancla solo muere con la última.
- La tolerancia de reloj (5 s) cubre que el evento lo fecha el agente y el envío el main.
- El módulo es puro, sin E/S ni Electron.

## Descartes

- Pintar un guion cuando ancla y heurística discrepan: tira un dato casi siempre correcto.
- Soltar el ancla cuando otro transcript adelanta al anclado: es el fallo original.
- Meter el `sessionId` en la petición IPC: el renderer conoce el id del pty, no el de la
  conversación, y el TUI cambia de conversación sin avisarle.
