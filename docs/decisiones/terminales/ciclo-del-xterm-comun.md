# La terminal de shell y la del agente comparten un solo ciclo de vida del xterm

- **Estado:** vigente
- **Ámbito:** `features/terminales/montajeXterm.ts`, `sesionXterm.ts`, `useAparienciaXterm.ts`, `ajusteTamano.ts`, `buscadorXterm.ts`, `atajosTerminal.ts`; lo usan `useXtermPane.ts` y `features/agentes/xtermAgente.ts`

## Contexto

Las dos terminales crean el mismo xterm, lo conectan con un canal IPC de la misma forma y lo
desmontan devolviendo su WebGL. Eran dos copias que ya divergían sin motivo: la del shell cerraba
la sesión con el pty aún pausado por la contrapresión.

## Decisión

- Un solo montaje (`montarXterm`) con lo propio de cada pane por opciones: canal, tema, sesión del
  momento, fin de la sesión, qué hacer con las rutas soltadas, `puedeBuscar` y cómo cerrar.
- Vive en `features/terminales` y no en `comun/` o `util/`: depende del portapapeles, la
  contrapresión y el pegado, que son de la feature; el agente lo importa por su `index.ts` (F5).
- Desmontar reinicia el escritor PRIMERO, mientras la sesión aún se conoce: despausa el pty, cuyo
  callback de xterm ya no llegará. Después vacía las refs del xterm y solo entonces cierra la sesión,
  para que un `open()` en vuelo detecte el desmontaje y cierre la que acabe de abrir.
- Lo que no necesita xterm en ejecución (`sesionXterm.ts`) va aparte, con su prueba bajo `node`
  (`test:ciclo-xterm`).

## Consecuencias

- Una mejora del xterm se hace una vez y vale para las dos. Una diferencia nueva entre ellas entra
  como opción, nunca como otra copia.
- Siguen siendo distintos a propósito: la apertura y el reinicio de la sesión, el clic derecho (el
  agente pega si el CLI no sigue el ratón), el pegado de imágenes y archivos (el agente los copia al
  contenedor), el tamaño enviado al pty (el agente no repite el mismo) y el diagnóstico del WebGL.

## Descartes

- Un componente común con JSX: los dos panes tienen árboles distintos y el del agente no puede
  cambiar de forma sin cerrar sesiones (`agentes/columna-del-agente.md`).
