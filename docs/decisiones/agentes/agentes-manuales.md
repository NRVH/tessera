# Agentes definidos a mano: pestañas con un «+», carpetas que decide Tessera y una capa de imagen por perfil

- **Estado:** vigente
- **Ámbito:** `src/shared/agentesManuales.ts`, `src/shared/capaPerfil.ts`, `src/main/agents/terminalAgente/aperturaManual.ts`, `src/main/agents/manuales/`, `src/main/sandbox/gestor/capaPerfil.ts`, `src/renderer/src/features/agentes/agentesDelProyecto.ts`, `PestanasAgente.tsx`, `ModalAgenteManual.tsx`, `src/shared/contextoAgenteManual.ts`, `ContextoManual.tsx`

## Contexto

Claude Code y Codex llevan una integración a medida: conversaciones, uso de la cuenta, contexto,
fin de turno, hibernación por inactividad y actualización. Hay más agentes de terminal, y Tessera no
puede mantener un catálogo de todos ni leer lo que cada uno guarda a su manera. Lo que sí puede es
lanzarlos donde se lanzan los suyos, con el mismo aislamiento.

## Decisión

- **Pestañas de agente con un «+».** El segmentado pasa a una pestaña por agente. Claude Code y Codex
  no se eliminan, se ocultan, y por perfil (no la última pestaña). El «+» define otro agente, y el clic
  derecho en una pestaña manual la edita, copia su definición como JSON o la elimina.
- **Lo que se define:** nombre y comando, obligatorios; cómo reanudar (`--continue`) y, en Docker, las
  órdenes de instalación, opcionales; y si se ofrece también como agente de la terminal. El id sale del
  nombre (`m-` y un slug), porque acaba en rutas del perfil y en una línea de `sh`.
- **Alcance según dónde corre, como las cuentas:** los manuales nativos son de todo el equipo (los ven
  todos los perfiles); los de Docker, solo del perfil donde se añadieron. Al definir uno se elige
  dónde corre y no cambia después (`modo-por-agente.md`). Las pestañas de un proyecto son las de
  serie visibles, los manuales nativos y los de Docker de su perfil. Todo vive en los ajustes (`agentesNativos`,
  `agentesDockerPorPerfil`, `agentesOcultosPorPerfil`), con el mismo saneado que el resto.
- **Las carpetas las decide Tessera.** En Docker, cada agente manual tiene su `HOME` persistente por
  perfil, junto a las cuentas de los de serie (`.tessera/perfiles/<perfil>/<agente>/`), montado con el
  mismo mecanismo que sus credenciales: lo que el programa guarde en `~/.algo` sobrevive a recrear el
  contenedor sin que nadie diga dónde lo guarda. Las llaves no se mueven: ssh lee `~/.ssh` del usuario
  del sistema, no de `$HOME`. En nativo usa la carpeta personal de siempre. Esa carpeta es su cuenta
  predeterminada; se pueden crear otras, cada una con su `HOME` y su contenedor
  (`cuentas-por-perfil-y-agente.md`). No tienen «cerrar sesión»: Tessera no sabe qué archivos son su
  credencial, así que solo se eliminan.
- **El comando se lanza tal cual**, por la shell de las sesiones nativas o bajo el `env -i` del
  contenedor con sus `.local/bin` delante del PATH, y sin `exec` (puede llevar sintaxis de shell).
  Reanudar se añade al abrir; «Nueva conversación» lanza sin ello, y recargar reanuda siempre.
- **Sin aviso por opción de arranque.** Las opciones que llevan el contexto de bases y servidores son
  de cada programa; pasarle una desconocida podría impedir que arranque. Como agente de la terminal, el
  contexto le llega por el `AGENTS.md` de su carpeta, y el modal explica que si el agente no lo lee
  trabajará sin él.
- **Lo que Tessera no sabe leer no existe para un agente manual:** ni conversaciones, ni uso, ni
  turnos (su rastreador de actividad es inerte), ni hibernación automática, ni actualización nativa.
  El main lo valida otra vez al abrir: no se fía de la definición que llega.
- **El contexto, solo si el usuario dice de dónde sale, y de forma genérica.** Un comando o un archivo
  que den JSON (o JSON Lines, y entonces cuenta la línea más reciente que traiga los campos), el campo
  de lo usado con puntos y corchetes (`turnos[-1].tokens`) y el máximo como otro campo o un número
  fijo. El comando corre donde el agente: en la shell nativa o en el contenedor, con su `HOME` y en la
  carpeta del proyecto; en un archivo, `~` es la casa del agente y una ruta relativa cuelga del
  proyecto, y solo se leen sus últimos 256 KiB. Sin aviso de fin de turno que lo dispare, el pie lo
  consulta cada 15 s mientras está en pantalla, con una sola lectura en vuelo por sesión. La fuente
  viaja con la definición validada al abrir, así que un cambio se aplica al reiniciar el agente. Sin
  acción de compactar: Tessera no conoce los comandos de ese agente.
- **Capa de imagen por perfil.** Las órdenes de instalación de los agentes Docker de un perfil se
  hornean en una imagen derivada de la base común (`FROM` la base, el guion como root y de vuelta al
  usuario del sandbox), con un sello que incluye el id de la base. El registro de lo aplicado es del
  main (`capas-perfil.json`): al crear el contenedor, la capa se pone al día si cambió la base o las
  órdenes, y si falla el contenedor nace de la base. Un build que falló no se repite al crear el
  contenedor (retrasaría también a Claude Code y Codex): se apunta su sello y solo se reintenta al
  aplicar de nuevo o cuando cambia la base. Aplicar construye, comprueba que cada programa
  quedó en el PATH de la imagen y para el contenedor del perfil, que se recrea al reabrir sus agentes.
  En nativo no hay instalación: Tessera solo comprueba que la shell encuentre el programa.

## Consecuencias

- Un proyecto puede tener cualquier número de agentes; el chip del mosaico los recorre todos y el
  mosaico los ordena detrás de los de serie.
- Cambiar las órdenes de instalación reinicia los agentes vivos del perfil, igual que «Actualizar
  agentes». Eliminar un agente manual no reconstruye la capa: lo instalado se queda hasta la siguiente.
- Eliminar un agente manual de Docker cierra sus sesiones del perfil y borra sus cuentas y sus carpetas
  (la predeterminada incluida): como el id sale del nombre, otro agente con el mismo nombre heredaría
  su login. El main valida el perfil y el id antes de borrar. En nativo no se borra nada: su carpeta es
  la personal del usuario.
- Borrar un perfil borra también su capa.

## Descartes

- **Un catálogo de agentes conocidos:** se queda viejo al día siguiente y obliga a integraciones a medida.
- **Pedir la carpeta de configuración del agente:** cada programa la elige a su manera y el usuario no
  tiene por qué saberla; con un `HOME` propio no hace falta.
- **Mandar el contexto como primer mensaje en la terminal:** se ve en la conversación, gasta un turno y
  se pierde si llega antes de que el agente esté listo.
- **Instalar en el contenedor vivo:** no sobrevive a recrearlo; por eso va a una capa de imagen.
- **Leer el contexto con integraciones a medida por agente:** lo mismo que el catálogo; el usuario
  conoce su agente y dice de dónde sale el dato.
- **Mandar la fuente del contexto en cada consulta desde el renderer:** el main ejecutaría lo que le
  llegara por IPC; se usa la de la definición validada al abrir la sesión.
