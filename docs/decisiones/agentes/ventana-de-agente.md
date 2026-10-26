# La ventana de agente es otra BrowserWindow con el agente nativo en la carpeta del usuario, un perfil sintético y su salida enrutada por dueño

- **Estado:** vigente
- **Ámbito:** `src/main/app/ventanaAgente.ts`, `ventanasAgentePuro.ts`, `cierrePrincipal.ts`, `integracionVentanas.ts`, `instanciaUnica.ts`, `src/main/agents/terminalAgente/` (`tipos.ts`, `apertura.ts`, `cierre.ts`), `src/main/util/emisorEventos.ts`, `src/shared/ventana-agente-ipc.ts`, `src/renderer/src/agente.tsx`, `features/agentes/ventanaAgente/`, `features/agentes/panesRemotos.ts`, `electron.vite.config.ts`, `scripts/compilar.mjs`

## Contexto

Lo que da abrir una terminal y escribir el nombre del CLI, sin perfil, proyecto ni bases, y con todo lo que ya tiene la columna del agente (selector, historial, chat nuevo, anillo de contexto, pegar imágenes).

## Decisión

- **Perfil sintético.** Sus sesiones usan `_ventana-agente` (un perfil real solo lleva `[a-z0-9-]`): sin sandbox, nunca persistido, repuesto en cada `updateProfiles`. El main IMPONE la petición: siempre nativa, `cwd` en la carpeta del usuario y sin bases; sin `tdb`, `tssh`, avisos de bases o SSH ni token del puente, y sin escribir instrucciones en esa carpeta. Ofrece los de serie y los manuales nativos; nunca cuentas de contenedor. Cada agente empieza con un chat nuevo, como al escribir el CLI en una terminal; solo la restauración tras actualizar retoma una conversación.
- **Salida por dueño.** Cada sesión guarda el `webContents` que la abrió; DATA, EXIT y ACTIVITY van solo a esa ventana (`emisorPorSesion`), la foto de actividad se filtra por remitente y el uso de la cuenta se difunde a todas. Así ni la actividad, ni la hibernación por inactividad ni el mosaico de la principal ven sus sesiones.
- **Entrada propia del renderer** (`agente.html`), compilada en su propia pasada (`scripts/compilar.mjs`): con las dos páginas en una, rollup saca lo común a un trozo que se enlaza antes que el CSS de la principal y le cambia la cascada. No carga el editor ni `App` (sus barriles van sin efectos: `renderer/barriles-sin-ciclos.md`), y lee los ajustes sin escribirlos nunca (el archivo es de la principal). El zoom es del origen y lo comparte con ella.
- **Cerrar.** Su X cierra solo ella: mata de una vez el árbol de sus sesiones y las suelta. La X de la principal con ventanas de agente abiertas cierra en orden solo lo suyo (pregunta de BD, consolas, `workspace-state`, sesiones de BD, vigilantes de archivos y búsqueda, sesiones SFTP, terminales con SSH y sus agentes) y la destruye; servicios, contenedores, puente de `tdb`, `ptys-sueltos` y guardián de salida son de la app y solo los cierra `iniciarCierre`, al cerrar la última ventana o al salir, que también cierra las de agente. Sin principal, una segunda instancia sin bandera, la Jump List («Abrir Tessera») o el Dock la vuelven a crear.
- **Arranque y segunda instancia.** `--ventana-agente` en frío crea solo una ventana de agente; con la app viva, otra. Una petición que llega arrancando se atiende al terminar. Con un relevo en vuelo el proceso sale, como con una ruta.
- **Actualización de los CLIs:** sus sesiones entran en el lote. El orquestador corre en la principal y actúa sobre sus panes por el main (`panesRemotos.ts`): preparar, relanzar y soltar viajan a la ventana dueña y vuelven con tope.
- **«Reiniciar para actualizar»** cierra todo, y si relanza deja escritas las ventanas (agente a la vista y conversación) en `ventanas-agente.json`; el arranque siguiente las reabre y lo borra. Caduca a los 30 min; un cierre normal no restaura nada.
- **Entradas del sistema.** Windows: tarea de la Jump List (vale con la app cerrada) y, en cada ventana, `setAppDetails` con AppUserModelID `…agente`, su icono y el relanzamiento, para no agruparse con Tessera. macOS: el menú del Dock y «Ventana»; con la app cerrada no hay entrada. Linux: la acción del `.desktop` propio y del AppImage. Dentro: en el pie de la lista de la ▾ de las terminales.

## Consecuencias

- El arranque de una ventana de agente sin principal no espera a ningún `ready-to-show` de la principal: la latch de la segunda instancia la consume el final del arranque.
- `test:ventanas-agente`, `test:emisor-eventos`, `test:ventana-agente` y `test:panes-remotos` fijan la lógica; `e2e/ventana-agente.spec.ts`, la ventana, el cierre y la segunda instancia.

## Descartes

- Una pestaña más en la principal: no se cierra la principal y no se tiene en la barra de tareas aparte.
- Enviar la salida a todas las ventanas y filtrar en el renderer: la principal contaría su actividad.
- Que la ventana escriba los ajustes: pisaría el `workspace-state.json` de la principal.
