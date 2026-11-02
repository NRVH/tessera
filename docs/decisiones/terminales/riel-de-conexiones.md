# La lista de conexiones SSH es un riel fijo solo a pantalla completa que se ve siempre que cabe

- **Estado:** vigente
- **Ámbito:** `features/ssh/` (`RielConexionesSsh.tsx`, `useRielSsh.ts`, `rielSsh.ts`),
  `features/terminales/TerminalsPanel.tsx`, `shared/ajustesTerminal.ts` y `e2e/riel-ssh.spec.ts`

## Contexto

A pantalla completa el ancho sobra; en la franja no, y una columna permanente se comería el ancho de la terminal (el
descarte de la lista lateral en `terminales-keep-alive-y-reinicio-limpio.md`).

## Decisión

- La MISMA `ListaConexionesSsh` en modo `fijo`, a la izquierda de la terminal y solo a pantalla completa; se monta la
  primera vez que se enseña y desde entonces se queda montado, oculto cuando no se enseña, para volver con su filtro, su
  fila y su desplazamiento (`renderer/vivos-y-ocultos.md`). Fuera del modo queda el lanzador. Varios grupos abiertos a la vez: el acordeón es solo del lanzador.
- Ancho GLOBAL (`sshRielAncho`: 260 px, de 180 a 480, como el lateral) con un divisor, saneado en
  `shared/ajustesTerminal.ts`. El riel no se oculta a mano: se ve siempre que cabe. Con terminales
  la lista ya está a la vista, y sin ellas ocultarla dejaría la columna vacía. Al cargar, los ajustes ignoran una
  preferencia de ocultarlo.
- Mientras el riel se ve, la ▾ NO EXISTE (el riel ya es la lista: dos entradas a la misma cosa sobraban) y el «+» queda como
  botón simple. Plegado el riel por falta de sitio, la ▾ vuelve: la lista nunca se queda sin entrada y nunca tiene
  dos (`flechaLanzadorVisible`, pura, la otra cara de `dondeConectar`).
- «Conectar por SSH…» del estado vacío enfoca el filtro del riel si se ve y, si no, abre el lanzador (`dondeConectar`).
- La terminal no baja de 420 px (`rielCabe`, pura). Sin sitio el riel se pliega y reaparece al ensanchar; entretanto el
  lanzador deja la lista a mano. El divisor se queda
  40 px antes de ese borde (`RIEL_MARGEN_PLIEGUE`): llevado al tope, perder un píxel no pliega el riel.
- El foco no va al riel al mostrarlo; conectar enfoca la xterm de la pestaña nueva.
- En el riel, un clic en una conexión solo la elige (para editarla, borrarla o ver su menú) y conectan el doble clic o
  Intro, como en una lista fija de archivos. En el lanzador, que es un menú que se cierra, un clic conecta.
- Marca la conexión de la pestaña SSH que se ve (`aria-current`) y cuenta las abiertas de cada una.
- Sin conexiones, su cuerpo solo dice «Sin conexiones SSH en este perfil»: el alta es la de su cabecera (no hay botón repetido en
  el estado vacío). Su alta solo guarda (`OrigenAltaSsh` `'lista'`); «Sin grupo» no tiene menú.

## Varias a la vez (`seleccionListaSsh.ts`, `useArrastreListaSsh.ts`)

- Solo en el riel y solo CONEXIONES: Ctrl+clic (⌘ en Mac) alterna, Mayús+clic marca el rango desde el ancla, Mayús+↑/↓
  lo amplía desde el filtro. Un clic en un grupo lo sigue plegando. Lo que deja de verse (un grupo plegado, un filtro, un
  borrado) se suelta de la selección. El molde es la selección múltiple del explorador.
- Con varias marcadas, el clic derecho sobre una de ellas da su menú común («Mover N conexiones a un grupo…», que abre un
  selector con «Nuevo grupo…», y «Eliminar N conexiones…»), y Supr (⌘⌫ en Mac) las borra con UNA confirmación que las
  nombra. Sobre una sin marcar, esa pasa a ser la única y sale su menú de siempre.
- Arrastrar lleva la selección (o la fila sola, si no estaba marcada). Una cabecera, o cualquier conexión de un grupo, es
  destino de ese grupo; se tiñe el grupo entero. Mientras dura el gesto, «Sin grupo» se enseña aunque esté vacío y al pie
  sale «Nuevo grupo…»: soltar ahí pide el nombre y crea el grupo con ellas dentro.
- El main mueve y borra el lote en UNA escritura (`ssh:mover`, `ssh:borrar:varias`, con tope de 1000 ids): o entran todas
  o ninguna, y un solo aviso de cambio.
- Lo que cambia la lista al empezar a arrastrar se aplaza fuera del `dragstart`: tocar el DOM dentro de él aborta el gesto.
  El fin del arrastre se escucha también en la ventana (primer `mousemove` con el botón suelto), porque la fila de origen
  puede salir de la lista virtual y su `dragend` perderse.
- Descartado: marcar grupos para borrarlos en bloque (el clic de un grupo pliega; se borran uno a uno desde su menú) y crear
  grupos en línea en el árbol (basta el diálogo de la cabecera y soltar en «Nuevo grupo…»).

## Consecuencias

- Plegarse o ensancharse el riel redimensiona el pty de la xterm visible (observador de 120 ms): es lo buscado.
- Nada de `transform`, `contain` ni `container-type` en `.shell-main` (`layout/marco-y-lienzo.md`).
- El riel lleva su propio `ErrorBoundary`: un error suyo que desmontara las terminales cerraría sus sesiones.
- Es renderer y CSS puros: igual en Windows y en macOS, sin teclas ni rutas del sistema (el e2e no bifurca).

## Descartes

- Una columna permanente también fuera de pantalla completa (come ancho de la franja), encoger el riel hasta que quepa
  (cambia un ancho elegido: plegarlo lo deja intacto) y otra lista para el riel (dos que mantener).
- Un botón «Conexiones» que alterna el riel a pantalla completa y abre la lista fuera de ella: dos entradas a lo SSH.
- Un conmutador para ocultar el riel a mano: con terminales no aporta y sin ellas deja la columna vacía.
