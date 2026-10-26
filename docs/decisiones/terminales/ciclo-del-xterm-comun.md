# La terminal de shell y la del agente comparten un solo ciclo de vida del xterm

- **Estado:** vigente
- **Ámbito:** `features/terminales/montajeXterm.ts`, `sesionXterm.ts`, `useAparienciaXterm.ts`, `ajusteTamano.ts`, `buscadorXterm.ts`, `atajosTerminal.ts`; lo usan `useXtermPane.ts` y `features/agentes/xtermAgente.ts`

## Contexto

Las dos terminales crean el mismo xterm, lo conectan con un canal IPC de la misma forma y lo
desmontan devolviendo su WebGL. Dos copias divergen sin motivo: una puede cerrar la sesión con el
pty aún pausado por la contrapresión y la otra no.

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
- En la pantalla alternativa (un agente a pantalla completa, `vim`, `less`) el host lleva
  `data-pantalla="alternativa"` y la zona de desplazamiento de xterm no tiene barra, como en una
  terminal nativa: allí no hay historial, el desplazamiento es del programa, y arrastrar la barra de
  xterm movería la vista por debajo de lo que pinta y taparía sus últimas filas. Al cambiar de
  pantalla la vista vuelve al fondo. Va en un atributo porque el `className` del host lo pinta React,
  y se esconde la barra (`scrollbar-width`) y no el desplazamiento: cambiar `overflow` mueve
  `scrollTop`, xterm lo toma por un gesto del usuario y, al volver, deja de seguir el final.

## Consecuencias

- Una mejora del xterm se hace una vez y vale para las dos. Una diferencia nueva entre ellas entra
  como opción, nunca como otra copia.
- Siguen siendo distintos a propósito: la apertura y el reinicio de la sesión, el clic derecho (el
  agente pega si el CLI no sigue el ratón), el pegado de imágenes y archivos (el agente los copia al
  contenedor), el tamaño enviado al pty (el agente no repite el mismo y nace con el suyo), el
  diagnóstico del WebGL y el buscador, que solo tiene la de shell (sin `setSearchResults` no se
  carga el addon y Mod+F llega al programa).

## Descartes

- Un componente común con JSX: los dos panes tienen árboles distintos y el del agente no puede
  cambiar de forma sin cerrar sesiones (`agentes/columna-del-agente.md`).
