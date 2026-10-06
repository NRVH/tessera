# La lista de conexiones SSH es un riel fijo solo a pantalla completa y se pliega sin tocar lo que se eligió

- **Estado:** vigente
- **Ámbito:** `features/ssh/` (`RielConexionesSsh.tsx`, `BotonRielSsh.tsx`, `useRielSsh.ts`, `rielSsh.ts`),
  `features/terminales/TerminalsPanel.tsx`, `shared/ajustesTerminal.ts` y `e2e/riel-ssh.spec.ts`

## Contexto

A pantalla completa el ancho sobra; en la franja no, y una columna permanente se comería el ancho de la terminal (el
descarte de la lista lateral en `terminales-keep-alive-y-reinicio-limpio.md`).

## Decisión

- La MISMA `ListaConexionesSsh` en modo `fijo`, a la izquierda de la terminal y solo a pantalla completa; se monta al
  mostrarse. Fuera del modo queda el lanzador. Varios grupos abiertos a la vez: el acordeón es solo del lanzador.
- Ancho GLOBAL (`sshRielAncho`: 260 px, de 180 a 480, como el lateral) con un divisor, y visibilidad por PERFIL
  (`sshRielVisiblePorPerfil`, sin entrada = visible). Se sanean en `shared/ajustesTerminal.ts` y se podan por perfil.
- Se pliega con «Ocultar la lista» o con su conmutador: un icono propio al EXTREMO IZQUIERDO de la cabecera, solo a pantalla
  completa (`aria-pressed`, `title` «Mostrar/Ocultar las conexiones»). La ▾ no lo alterna: abre el lanzador (`lanzador-de-conexiones.md`).
- Mientras el riel se ve, la ▾ NO EXISTE (el riel ya es la lista: dos entradas a la misma cosa sobraban) y el «+» queda como
  botón simple. Plegado el riel, a mano o por falta de sitio, la ▾ vuelve: la lista nunca se queda sin entrada y nunca tiene
  dos (`flechaLanzadorVisible`, pura, la otra cara de `dondeConectar`).
- «Conectar por SSH…» del estado vacío enfoca el filtro del riel si se ve y, con el riel plegado a mano, abre el lanzador:
  mostrarlo guardaría una preferencia que el usuario no tocó (`dondeConectar`).
- La terminal no baja de 420 px (`rielCabe`, pura). Sin sitio el riel se pliega SIN tocar la preferencia y reaparece al
  ensanchar; entretanto su conmutador se apaga diciendo por qué y el lanzador deja la lista a mano. El divisor se queda
  40 px antes de ese borde (`RIEL_MARGEN_PLIEGUE`): llevado al tope, perder un píxel no pliega el riel.
- El foco no va al riel al mostrarlo; conectar enfoca la xterm de la pestaña nueva. Ocultarlo desde su cabecera devuelve el
  foco a la terminal: el acorde de pantalla completa solo vale con el foco en la franja.
- Marca la conexión de la pestaña SSH que se ve (`aria-current`) y cuenta las abiertas de cada una.
- Sin conexiones, su cuerpo solo dice «Sin conexiones SSH en este perfil»: el alta es la de su cabecera (no hay botón repetido en
  el estado vacío). Su alta solo guarda (`OrigenAltaSsh` `'lista'`); «Sin grupo» no tiene menú.

## Consecuencias

- Plegar o ensanchar el riel redimensiona el pty de la xterm visible (observador de 120 ms): es lo buscado.
- Nada de `transform`, `contain` ni `container-type` en `.shell-main` (`layout/marco-y-lienzo.md`).
- El riel lleva su propio `ErrorBoundary`: un error suyo que desmontara las terminales cerraría sus sesiones.
- Es renderer y CSS puros: igual en Windows y en macOS, sin teclas ni rutas del sistema (el e2e no bifurca).

## Descartes

- Una columna permanente también fuera de pantalla completa (come ancho de la franja), encoger el riel hasta que quepa
  (cambia un ancho elegido: plegarlo lo deja intacto) y otra lista para el riel (dos que mantener).
- Un botón «Conexiones» que alterna el riel a pantalla completa y abre la lista fuera de ella: dos entradas a lo SSH.
