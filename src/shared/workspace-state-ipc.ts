// =============================================================================
// Contrato IPC y saneado de la persistencia del workspace (`workspace-state.json`): qué
// proyectos tenía abiertos cada perfil, cuál es el activo y los ajustes globales.
// No persiste repos (se re-descubren) ni sesiones de agente (arrancan perezosas).
// LOAD -> WorkspaceState | null (null = sin archivo); SAVE en cada cambio relevante y no
// solo al salir, para sobrevivir a cierres sucios. Las rutas host son opacas.
// Puro y con imports `.ts` (`ajustesBd.ts`, `ajustesAgente.ts`, `ajustesTerminal.ts`): lo cargan tests con `node`.
// Decisiones: docs/decisiones/workspace/estado-persistido-crash-safe.md
// =============================================================================

import type { DbTxModo } from './db-explorador-ipc.ts'
import { AGENTE_INACTIVIDAD_MIN_POR_DEFECTO, normalizarInactividadAgenteMin } from './ajustesAgente.ts'
import {
  SSH_RIEL_ANCHO_POR_DEFECTO,
  normalizarAgenteTerminalVisible,
  normalizarAnchoRiel,
  normalizarGruposPlegados,
  normalizarRecientesPorPerfil,
  normalizarRielVisiblePorPerfil
} from './ajustesTerminal.ts'
import {
  DB_FILAS_POR_PAGINA_POR_DEFECTO,
  DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO,
  DB_TX_INICIAL_POR_DEFECTO,
  normalizarFilasPorPagina,
  normalizarInactividadConsolaMin,
  normalizarTxInicial
} from './ajustesBd.ts'

export const WORKSPACE_STATE_CHANNELS = {
  /** invoke: lee el estado de workspace persistido. Sin argumentos. -> WorkspaceState | null. */
  LOAD: 'workspaceState:load',
  /** invoke: persiste el estado de workspace COMPLETO (escritura incremental). WorkspaceState -> void. */
  SAVE: 'workspaceState:save',
  /** invoke: lee SOLO el slice de ajustes globales de UI (zoom, etc.). Sin argumentos. -> WorkspaceSettings. */
  LOAD_SETTINGS: 'workspaceState:loadSettings',
  /** invoke: persiste SOLO el slice de ajustes globales (preserva el esqueleto). WorkspaceSettings -> void. */
  SAVE_SETTINGS: 'workspaceState:saveSettings'
} as const

/**
 * Ajustes GLOBALES de UI del usuario: ni por perfil ni por proyecto, valen para
 * toda la app (el zoom escala TODO el webFrame de forma uniforme). Se persisten en
 * el MISMO archivo que el esqueleto de tabs, pero como un SLICE independiente: el
 * guardado de tabs y el de ajustes se fusionan en el store sin pisarse. Extensible
 * (añadir campos aquí + su default en DEFAULT_SETTINGS + su saneado en normalize).
 */
export interface WorkspaceSettings {
  /**
   * Nivel de zoom DISCRETO de webFrame (0 = 100%; cada paso ≈ 1.2×, la curva de
   * Ctrl +/−). Se persiste el NIVEL, no el factor, porque se re-aplica con
   * webFrame.setZoomLevel al arrancar. Acotado al mismo rango que la API del preload.
   */
  zoomLevel: number
  /**
   * Cuenta (login) elegida por cada target de agente (key = `profileId|proyecto|agente`
   * -> accountId, o null si se dejó sin cuenta). Recuerda con qué cuenta se abrió cada
   * agente en cada proyecto, para restaurarla al reabrir la app. Entradas de targets
   * que ya no existen son inertes (se ignoran; el pane auto-selecciona si hace falta).
   */
  agentAccountByTarget: Record<string, string | null>
  /**
   * Oculta los NOMBRES de los perfiles en la banda superior, dejando solo su línea
   * de color (modo compacto). Ajuste GLOBAL de UI; se recuerda entre reinicios.
   */
  hideProfileNames: boolean
  /**
   * Proyectos en MODO WINDOWS (host nativo, sin Docker, cuenta personal), como
   * claves `${profileId}|${projectHostPath}`. Un proyecto aquí corre el agente y la
   * terminal directamente en Windows con tu login personal, en vez de dentro del
   * contenedor aislado del perfil. Pensado para proyectos legacy (p.ej. Java/Swing)
   * que se levantan con herramientas de Windows. Se recuerda entre reinicios.
   */
  windowsModeProjects: string[]
  /**
   * Qué modo usa un proyecto RECIÉN abierto: `windows` (host nativo), `docker`
   * (contenedor aislado) o `ask` (preguntar con un modal al abrir). Default `windows`
   * (el 90% del uso). Cambiar el modo de un proyecto ya abierto sigue por el toggle
   * por-pestaña; esto solo decide con qué modo NACE uno nuevo.
   */
  defaultProjectMode: DefaultProjectMode
  /**
   * Orden de los iconos de la barra de actividad izquierda (ids de vista:
   * 'files' | 'git' | 'db'), reordenables por drag&drop. Ausente/incompleto
   * => se completa con el orden por defecto (los ids que falten se anexan). Ajuste
   * GLOBAL de UI; se recuerda entre reinicios.
   */
  activityBarOrder: string[]
  /**
   * Orden de los conmutadores de la FRANJA INFERIOR ('terminal' | 'gitlog'), el
   * segundo grupo del riel de actividad, también reordenable por arrastre.
   *
   * Va en su propia clave y no dentro de `activityBarOrder` a propósito: son dos
   * grupos con contratos distintos (arriba, qué columna lateral se muestra;
   * abajo, qué panel ocupa la franja inferior), y compartir la lista permitiría
   * arrastrar un icono de un grupo al otro, donde no puede cumplir su función.
   * Además, el saneado descartaría el id ajeno en el SIGUIENTE arranque: el
   * arrastre "funcionaría" hasta reiniciar, que es peor que no permitirlo.
   */
  bottomBarOrder: string[]
  /**
   * APARIENCIA de la terminal de SHELL: familia de fuente CSS ('' = la
   * predeterminada de la app) y tamaño en px (0 = el predeterminado). Ajuste
   * GLOBAL; se aplica a todas las terminales vivas y se recuerda entre reinicios.
   *
   * Las claves conservan el nombre `terminal*` aunque ahora solo gobiernen la
   * terminal de shell: renombrarlas habría RESETEADO el ajuste de todo el mundo en
   * la primera actualización (la misma razón por la que `terminalHeight` sigue
   * llamándose así aunque la franja inferior ya no sea solo de la terminal).
   */
  terminalFontFamily: string
  terminalFontSize: number
  /**
   * APARIENCIA de la terminal del AGENTE (CC/Codex), INDEPENDIENTE de la de shell.
   * Se separaron porque no se usan igual: en la del agente lees conversación larga
   * y quieres letra cómoda; en la de shell miras salida de comandos y quieres que
   * quepa. Ausentes => se siembran con los valores de la terminal de shell, para
   * que actualizar no cambie lo que ya se veía.
   */
  agentFontFamily: string
  agentFontSize: number
  /**
   * TAMAÑO DE LETRA DE LA INTERFAZ en px (0 = el predeterminado, ver
   * `theme/densidad.ts`). Es la BASE: gobierna todo el chrome de la app
   * —pestañas, barra de estado, riel, el propio panel de ajustes, progreso de
   * agentes, conexiones de BD— y las ALTURAS DE FILA que se derivan de él. NO
   * toca el editor ni las terminales, que tienen sus propios ajustes.
   */
  uiFontSize: number
  /**
   * TAMAÑOS PROPIOS del explorador y de la vista de git. `0` = "igual que la
   * interfaz", la misma convención que el resto de tamaños de este archivo.
   *
   * Se separaron de `uiFontSize` porque un solo número no servía para las dos:
   * el explorador enseña nombres cortos y la vista de git listas con ruta, autor
   * y fecha, así que la densidad cómoda en una aprieta en la otra. La BASE se
   * queda con su nombre —renombrarla habría reseteado a todo el que ya la tenía
   * puesta, igual que con `terminal*`— y estas dos son overrides suyos.
   *
   * AUSENTES => `0`, nunca `uiFontSize`. Es deliberado y es lo contrario de lo
   * que se hizo con `agentFont*`: allí sembrar desde la terminal de shell
   * conservaba lo que el usuario YA veía, mientras que aquí heredar es
   * exactamente lo que ya pasaba, así que copiar el número solo dejaría dos
   * overrides fijos que nadie puso y que dejarían de seguir a la base.
   */
  explorerFontSize: number
  gitFontSize: number
  /**
   * Ancho (px) del panel lateral POR VISTA (`files` | `git` | `activity` |
   * `settings`). Por vista y no uno global porque Configuración necesita bastante
   * más ancho que el árbol de archivos: compartir el valor obligaba a reajustarlo
   * cada vez que se alterna. Vista ausente => DEFAULT_SIDEBAR_WIDTH.
   */
  sidebarWidthByView: Record<string, number>
  /** Ancho (px) de la columna del agente. El tope REAL es dinámico (ver ccMax en useTamanos). */
  ccWidth: number
  /**
   * Altura (px) de la FRANJA INFERIOR (la terminal o el panel de Git·Log, que se
   * turnan en el mismo hueco).
   *
   * La clave conserva el nombre histórico `terminalHeight` a propósito, aunque ya
   * no sea solo de la terminal: renombrarla habría reseteado la altura de todo el
   * mundo en la primera actualización, sin ganar nada más que un nombre bonito en
   * un archivo que el usuario no lee.
   */
  terminalHeight: number
  /** Ancho (px) de la columna de RAMAS del panel Git·Log. */
  gitLogRamasWidth: number
  /** Ancho (px) de la columna de DETALLE del panel Git·Log. */
  gitLogDetalleWidth: number
  /**
   * Altura (px) de la lista de ARCHIVOS dentro de la tercera columna del log. Lo
   * que sobra se lo queda el mensaje del commit, así que este número reparte los
   * dos: subirlo enseña más archivos, bajarlo enseña más mensaje.
   */
  gitLogArchivosHeight: number
  /**
   * Bases de datos MONTADAS por proyecto: clave `${profileId}|${projectHostPath}`
   * -> ids de conexión. Solo esas se inyectan en la sesión de agente de ese
   * proyecto (modo Windows), en vez de todas las del perfil.
   *
   * El ámbito lo eliges TÚ: un proyecto que cruza dev/QA/prod monta las tres. Lo
   * que evita es que el agente vea en `tdb ls` bases que no vienen al caso y
   * consulte la que no era por ambigüedad.
   *
   * Entradas de proyectos o conexiones que ya no existen se ignoran al resolver.
   */
  dbMountsByProject: Record<string, string[]>
  /**
   * Cuando hay una actualización PREPARADA, ¿se aplica sola al cerrar Tessera?
   *
   * Es el interruptor del "apply on relaunch": la descarga ya pasó en segundo
   * plano y lo único que queda es el instalador, que no puede correr con la app
   * viva. Aplicarlo al cerrar es el único momento en que no interrumpe a nadie.
   * Apagado, la actualización se queda preparada indefinidamente (persistida entre
   * arranques, sin volver a descargar) hasta que se pulse el botón de la barra.
   *
   * Por defecto ACTIVADO, y por eso su saneado es `!== false` y no `=== true`: un
   * workspace-state.json escrito por una versión anterior no trae la clave, y con
   * `=== true` todos los usuarios existentes estrenarían la función apagada.
   */
  aplicarUpdateAlCerrar: boolean
  /**
   * ¿El visor de diferencias esconde los fragmentos SIN CAMBIOS? Es el
   * «colapsar los fragmentos sin cambios» de los visores de diff, y se recuerda entre reinicios.
   *
   * Va aquí y no por pestaña a propósito: es una preferencia de LECTURA ("así es
   * como quiero leer un diff"), no una respuesta al espacio disponible. Contrasta
   * con el modo lado-a-lado/unificado, que es por-pane y volátil justamente porque
   * responde al ancho que hay AHORA: recordarlo sería recordar la respuesta a una
   * pregunta que ya cambió (ver `features/editor/modoDiff.ts`).
   *
   * Por defecto APAGADO: cada diff abre entero, como siempre, hasta que se pulse
   * el botón de la barra del visor.
   */
  diffColapsarSinCambios: boolean
  /**
   * Paquetes apt que se HORNEAN en la imagen del sandbox de Docker, para que el
   * agente los tenga sin instalarlos cada vez.
   *
   * Existe porque las dos mitades del problema tienen respuestas distintas: el
   * agente ya puede instalar lo que quiera en caliente (`sudo` va en la imagen),
   * pero eso vive dentro del contenedor y el contenedor se DESTRUYE al hibernar,
   * al cerrar Tessera y al pulsar "Actualizar agentes" (todos los caminos hacen
   * `docker rm`; no hay `docker commit` en ningún sitio). Lo recurrente —el
   * LibreOffice con el que se convierte un Word para capturarlo— tiene que estar
   * en la imagen o se reinstala eternamente.
   *
   * GLOBAL y no por perfil a propósito: la imagen base es UNA sola, compartida por
   * todos los perfiles (lo que distingue a un perfil es su contenedor). Un
   * interruptor por perfil obligaría a una imagen por perfil, que es justo el
   * coste que el diseño evita.
   *
   * Por defecto VACÍO: quien no lo necesite no paga ni tamaño de imagen ni tiempo
   * de build. Cambiarlo marca la imagen como obsoleta y se rehornea sola.
   */
  paquetesExtraSandbox: string[]
  /**
   * ¿Se hornean también las libs de sistema que necesita Chromium (el
   * `playwright install-deps`)?
   *
   * Va aparte de `paquetesExtraSandbox` y no como siete nombres más de la lista
   * porque no es una lista de paquetes: cuáles son depende de la versión de
   * Playwright y las sabe el propio Playwright. Copiarlas aquí sería una lista
   * que se queda vieja en silencio.
   */
  sandboxDepsNavegador: boolean
  /**
   * "Abrir con Tessera" en el menú contextual de CARPETAS del Explorador de Windows
   * (carpeta, fondo de carpeta y unidad).
   *
   * Por defecto APAGADO: escribir en el registro de Windows es un efecto sobre el
   * sistema del usuario, no sobre la app, y ninguna aplicación debería hacerlo sin
   * que se lo pidan. Lo que sí hace Tessera es AVISAR una vez de que existe
   * (`menuWindowsAvisado`), para que la función no pase desapercibida.
   *
   * Estos tres campos son la MEMORIA de lo que se escribió: al arrancar siembran el
   * servicio de integración, que los necesita para saber qué BORRAR cuando el usuario
   * desmarca algo. Sin ellos, desmarcar una extensión dejaría su ProgID huérfano.
   */
  menuWindowsCarpetas: boolean
  /** "Abrir con Tessera" sobre CUALQUIER archivo. Ver `menuWindowsCarpetas`. */
  menuWindowsArchivos: boolean
  /**
   * Extensiones asociadas a Tessera (`.java`, `.sql`…), ya normalizadas y ordenadas.
   * Aparecen en el "Abrir con" de Windows; NO convierten a Tessera en la aplicación
   * predeterminada, que es algo que solo el usuario puede elegir desde Windows.
   */
  menuWindowsExtensiones: string[]
  /** ¿Ya se avisó una vez de que la integración con el Explorador existe? */
  menuWindowsAvisado: boolean
  /**
   * La acción rápida «Abrir en Tessera» del Finder (macOS): el `.workflow` que vive en
   * `~/Library/Services`. Por defecto APAGADO, por el mismo motivo que los tres de
   * arriba: escribir en el HOME del usuario es un efecto sobre SU sistema.
   *
   * A DIFERENCIA DE LOS DE WINDOWS, ESTE CAMPO NO ES LA VERDAD, sólo una copia para que
   * el panel no parpadee mientras el main contesta. La verdad es si existe esa carpeta
   * en el disco, y el usuario puede borrarla a mano desde el propio Finder; por eso el
   * servicio de macOS no se siembra con esto (mira el disco) y el panel corrige el valor
   * persistido con lo que el main le diga. Los de Windows sí son memoria de verdad,
   * porque allí hace falta saber qué había para saber qué BORRAR.
   */
  accionRapidaFinder: boolean
  /**
   * Qué VISTA LATERAL (Archivos / Cambios / Progreso / Conexiones) tiene abierta
   * cada perfil: `profileId -> id de vista`. Un perfil sin entrada abre Archivos.
   *
   * POR PERFIL y no global porque cada perfil es un espacio de trabajo aparte: lo que estás mirando
   * en uno no tiene nada que ver con lo que estabas mirando en otro, y que
   * abrir Cambios en un perfil te cambiara la pantalla de otro convertía el cambio de
   * pestaña en una sorpresa. Es la misma razón por la que las tabs de archivo ya
   * estaban scoped por (perfil, proyecto).
   *
   * Los ids válidos son los de `ACTIVITY_BAR_DEFAULT_ORDER`; el saneado descarta
   * cualquier otro, así que un archivo de una versión con vistas distintas no
   * deja a nadie mirando una pantalla que ya no existe.
   */
  vistaLateralPorPerfil: Record<string, string>
  /**
   * Qué panel ocupa la FRANJA INFERIOR en cada perfil: `profileId -> 'terminal' |
   * 'gitlog'`. Cadena vacía o sin entrada = franja cerrada.
   *
   * Antes esto no se persistía a propósito, y la razón sigue siendo válida:
   * restaurar un Git·Log abierto dispararía su consulta ANTES de que el backend
   * haya re-apuntado al proyecto activo. Lo que cambia es la respuesta: en vez de
   * no recordarlo, se recuerda y se retiene el pintado de `gitlog` hasta que hay
   * objetivo CONFIRMADO (ver useVistasPorPerfil). La terminal no necesita esa espera: su pty
   * cuelga del proyecto, no de una consulta.
   */
  panelInferiorPorPerfil: Record<string, string>
  /**
   * Distribución elegida para el MOSAICO DE AGENTES (Automático, Cuadrícula, Columnas,
   * Filas o Principal y pila). GLOBAL, como los tamaños: es una preferencia de cómo te gusta
   * ver la pantalla, no del perfil que estás mirando.
   *
   * Se persiste SÓLO esto. El mosaico en sí (abierto o no) y qué casillas tenía NO:
   * al arrancar, las sesiones se abren perezosamente al mirarlas, así que reabrir el
   * mosaico enseñaría una rejilla vacía, y las casillas son sesiones que ya no existen.
   */
  mosaicoPreset: MosaicoPresetGuardado
  /**
   * ¿El usuario pidió VER el agente de datos en la vista de bases de datos? Por
   * PERFIL (`profileId -> true`), por lo mismo que la vista lateral: es una forma de
   * trabajar con las bases de UN perfil, no una preferencia global. Sin entrada =
   * oculto, que es el valor por defecto: el centro de esa vista es el explorador, y
   * el agente aparece solo cuando se le llama.
   *
   * Es lo ÚNICO de la vista de bases de datos que se recuerda por perfil. Las
   * pestañas NO se guardan, igual que las del editor de archivos: restaurarlas
   * lanzaría consultas contra bases que al arrancar quizá no están a tiro (VPN) y
   * reabriría filtros que ya no aplican. Las consolas sobreviven como ARCHIVOS del
   * espacio de datos y se reabren desde su carpeta del árbol.
   */
  dbAgenteVisiblePorPerfil: Record<string, boolean>
  /**
   * Ancho (px) de la columna del agente EN LA VISTA DE BASES DE DATOS. Propio y no
   * el `ccWidth` de siempre: allí la columna comparte el ancho con una rejilla de
   * datos o una consola SQL, no con el editor, y el ancho cómodo es otro. Con uno
   * solo, ajustarlo en una vista lo desajustaba en la otra.
   */
  dbAgenteWidth: number
  /**
   * Alto (px) del bloque de RESULTADOS de las consolas SQL (Salida + pestañas de
   * filas), debajo del editor. GLOBAL, no por consola: es cómo te gusta repartir la
   * pantalla, igual que el alto de la franja inferior.
   */
  dbResultadosAlto: number
  /**
   * AJUSTES DEL EXPLORADOR DE BASES DE DATOS (Configuración › «Bases de datos»).
   * GLOBALES, como los tamaños: son una forma de trabajar, no algo de un
   * perfil. El saneado, los valores por defecto y el porqué de cada uno viven en
   * `shared/ajustesBd.ts`; aquí solo su forma.
   *
   * `dbFontSize`: tamaño de letra propio del árbol, las rejillas y los resultados. `0` =
   * «igual que el Explorador» (que a su vez puede seguir a la interfaz). AUSENTE => `0`,
   * igual que `explorerFontSize` y por el mismo motivo: antes de existir, la vista ya
   * seguía al Explorador, así que heredar es exactamente lo que el usuario ya veía, y
   * copiar el número dejaría un override fijo que nadie puso.
   */
  dbFontSize: number
  /** Filas por página de la rejilla y la consola: un valor de `DB_FILAS_POR_PAGINA_OPCIONES`. */
  dbFilasPorPagina: number
  /** Con qué transacción nace una consola nueva que no es de producción ni de solo lectura. */
  dbTxInicial: DbTxModo
  /** Minutos de inactividad tras los que se cierra la sesión de una consola; 0 = Nunca. */
  dbConsolaInactividadMin: number
  /**
   * Minutos sin actividad tras los que se hiberna el agente de un proyecto que no está en
   * pantalla; 0 = Nunca. Lo aplica el main (decide y cierra) a petición del renderer.
   */
  agenteInactividadMin: number
  /**
   * Grupos de conexiones SSH plegados en la lista de conexiones, por PERFIL (`profileId` -> ids de
   * grupo; `''` = «Sin grupo»). Sin entrada = todo desplegado, que es lo que ve quien nunca plegó.
   * El saneado vive en `shared/ajustesTerminal.ts`; aquí solo su forma.
   */
  sshGruposPlegadosPorPerfil: Record<string, string[]>
  /**
   * Ancho (px) del riel de conexiones SSH que la terminal enseña a pantalla completa. GLOBAL, como los
   * demás tamaños: es cómo te gusta repartir la pantalla, no algo del perfil. El rango, el saneado y el
   * porqué viven en `shared/ajustesTerminal.ts`; aquí solo su forma.
   */
  sshRielAncho: number
  /**
   * ¿Se ve el riel de conexiones SSH a pantalla completa?, por PERFIL (`profileId` -> boolean). Sin
   * entrada = se ve. Es una preferencia: que la terminal quede estrecha pliega el riel sin tocarla.
   */
  sshRielVisiblePorPerfil: Record<string, boolean>
  /**
   * Las últimas conexiones SSH abiertas desde Tessera, por PERFIL (`profileId` -> ids de conexión, la más
   * reciente primero, hasta `SSH_RECIENTES_MAX`). El saneado vive en `shared/ajustesTerminal.ts`.
   */
  sshRecientesPorPerfil: Record<string, string[]>
  /**
   * ¿Se ve el agente de la terminal a la derecha de la terminal a pantalla completa?, por PERFIL
   * (`profileId` -> true). Sin entrada = oculto. El saneado vive en `shared/ajustesTerminal.ts`.
   */
  agenteTerminalVisiblePorPerfil: Record<string, boolean>
}

/**
 * Distribuciones del mosaico, en el orden en que se ofrecen. Viven AQUÍ, en el
 * contrato, porque lo leen main y renderer: `renderer/src/features/mosaico/mosaicoLayout.ts`
 * las importa (`PresetMosaico`, `PRESETS_MOSAICO`) en vez de tener su propia copia, que
 * habría que mantener sincronizada a mano. Este módulo solo importa módulos puros y con
 * extensión (ver la cabecera), así que el renderer puede traerlo también desde los tests
 * que corren con `node` a secas.
 */
export const MOSAICO_PRESETS = ['auto', 'cuadricula', 'columnas', 'filas', 'principal'] as const
export type MosaicoPresetGuardado = (typeof MOSAICO_PRESETS)[number]

/** Guarda de tipo para lo que llega de disco o de un menú. */
export function esPresetMosaico(v: unknown): v is MosaicoPresetGuardado {
  return typeof v === 'string' && (MOSAICO_PRESETS as readonly string[]).includes(v)
}

// Una clave desconocida de un `workspace-state.json` viejo (p. ej. el antiguo colapso
// por perfil del inspector de progreso) se ignora sola: el saneado solo copia lo que conoce.

/** Modo con el que nace un proyecto nuevo (ajuste global). */
export type DefaultProjectMode = 'windows' | 'docker' | 'ask'

/** Rango de zoom válido (ESPEJO de ZOOM_MIN/MAX_LEVEL del preload; mantenlos sincronizados). */
export const ZOOM_LEVEL_MIN = -3
export const ZOOM_LEVEL_MAX = 5

/** Orden por defecto (y CANÓNICO: conjunto válido de ids) de la barra de actividad. */
/**
 * Ya NO está 'activity' (el inspector «Progreso de agentes»): el mosaico enseña las
 * terminales que trabajan, así que el panel que las LISTABA dejó de tener trabajo. Las
 * señales que alimentaba —el dot que late por perfil, el aviso de «terminó sin
 * revisar»— siguen exactamente igual: vivían en el modelo, no en el panel.
 *
 * Quitarlo de aquí es además lo que LIMPIA lo persistido, sin migración: el riel se
 * sanea contra esta lista (`normalizarParticion`), los anchos por vista contra
 * `SIDEBAR_VIEW_KEYS` y la vista lateral recordada de cada perfil contra ella misma
 * (`mapaDeIds`), así que un `workspace-state.json` que traiga 'activity' lo pierde al
 * cargar y su perfil vuelve a «Archivos».
 */
export const ACTIVITY_BAR_DEFAULT_ORDER: readonly string[] = ['files', 'git', 'db']

/**
 * Orden por defecto del segundo grupo del riel: los conmutadores de la franja
 * inferior. Ya NO es un conjunto canónico cerrado —el usuario puede subirlos
 * arriba—, sino el grupo en el que NACEN. Ver `bottomBarOrder`.
 */
export const BOTTOM_BAR_DEFAULT_ORDER: readonly string[] = ['terminal', 'gitlog']

/**
 * TODOS los iconos del riel: el conjunto canónico de verdad, ahora que los dos
 * grupos son una partición de él y no dos conjuntos estancos. El orden de esta
 * lista solo importa para repartir lo que falte.
 */
export const RIEL_IDS: readonly string[] = [
  ...ACTIVITY_BAR_DEFAULT_ORDER,
  ...BOTTOM_BAR_DEFAULT_ORDER
]

// --- LAYOUT: defaults y límites de las zonas redimensionables ----------------
// Viven aquí (no en el renderer) porque ahora se PERSISTEN: el saneado del archivo y
// el clamp de los Splitters tienen que usar exactamente los mismos números, o un
// workspace-state de otra versión/monitor podría restaurar un panel inservible.
// Los defaults coinciden con las variables CSS de styles.css.
/** Ancho por defecto del panel lateral (todas las vistas). */
export const DEFAULT_SIDEBAR_WIDTH = 260
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 480
/** Ancho por defecto de la columna del agente. */
export const DEFAULT_CC_WIDTH = 340
/** Suelo de la columna del agente: por debajo, su header no cabe (ver useTamanos). */
export const CC_WIDTH_MIN = 330
/** Tope ABSOLUTO solo para sanear el archivo; el tope real lo calcula useTamanos con el
 *  ancho de ventana (ccMax) y recorta al restaurar si la pantalla es más chica. */
export const CC_WIDTH_MAX = 4000
/** Altura por defecto de la FRANJA INFERIOR (terminal / Git·Log). */
export const DEFAULT_TERMINAL_HEIGHT = 260
export const TERMINAL_HEIGHT_MIN = 140
export const TERMINAL_HEIGHT_MAX = 640
/**
 * Suelo de la franja cuando muestra GIT·LOG. Es mayor que el de la terminal
 * porque una franja de 140 px deja las tres columnas inservibles (cabecera +
 * filtros + una fila y media). NO sustituye a TERMINAL_HEIGHT_MIN: ese sigue
 * gobernando el clamp del archivo de ajustes, para que una sesión guardada con
 * la terminal a 140 no se "corrija" sola al restaurarla. Solo acota el divisor
 * mientras el panel visible es el de git.
 */
export const PANEL_GIT_MIN = 220

/** Anchos por defecto de las columnas laterales del panel Git·Log. */
export const DEFAULT_GIT_LOG_RAMAS = 210
export const DEFAULT_GIT_LOG_DETALLE = 330
/** Suelo de una columna lateral del log: por debajo no cabe ni una ruta corta. */
export const GIT_LOG_COL_MIN = 140
/** Techo solo para SANEAR el archivo; el real lo acota useTamanos con el ancho de
 *  ventana, para que las dos columnas nunca se coman la del centro. */
export const GIT_LOG_COL_MAX = 900

/**
 * Altura (px) de la LISTA DE ARCHIVOS dentro de la tercera columna del log; lo que
 * sobra es para el mensaje del commit. Antes el reparto era fijo (la lista se comía
 * todo y el mensaje tenía un `max-height: 50%`), así que un commit con mensaje
 * largo obligaba a hacer scroll dentro de una franja de 100 px.
 */
export const DEFAULT_GIT_LOG_ARCHIVOS_H = 180
/** Suelo: por debajo no cabe ni una fila de archivo con su cabecera. */
export const GIT_LOG_ARCHIVOS_MIN = 60
/** Techo solo para SANEAR; el real lo acota el alto vivo de la franja inferior. */
export const GIT_LOG_ARCHIVOS_MAX = 2000

/**
 * Ancho por defecto de la columna del agente en la vista de bases de datos. Algo
 * más ancho que el de la vista de archivos (340): la columna aparece A DEMANDA, casi
 * siempre para escribir una consulta larga o leer un plan, y el centro (rejilla o
 * consola) aguanta bien el recorte. Se acota con los mismos límites que `ccWidth`
 * (su cabecera es la misma), y el tope real lo calcula useTamanos con el ancho de ventana.
 */
export const DEFAULT_DB_AGENTE_WIDTH = 400
/** Alto por defecto del bloque de resultados de una consola SQL (la mitad baja). */
export const DEFAULT_DB_RESULTADOS_ALTO = 260
/**
 * Suelo del bloque de resultados: por debajo no caben la tira de pestañas de
 * resultado, la cabecera de la rejilla y dos filas. Mismo criterio que PANEL_GIT_MIN.
 */
export const DB_RESULTADOS_ALTO_MIN = 120
/** Techo solo para SANEAR; el real lo acota el alto vivo de la consola. */
export const DB_RESULTADOS_ALTO_MAX = 2000

/** Ajustes por defecto: primer arranque o archivo sin slice de settings. */
export const DEFAULT_SETTINGS: WorkspaceSettings = {
  zoomLevel: 0,
  agentAccountByTarget: {},
  hideProfileNames: false,
  windowsModeProjects: [],
  defaultProjectMode: 'windows',
  activityBarOrder: [...ACTIVITY_BAR_DEFAULT_ORDER],
  bottomBarOrder: [...BOTTOM_BAR_DEFAULT_ORDER],
  terminalFontFamily: '',
  terminalFontSize: 0,
  agentFontFamily: '',
  agentFontSize: 0,
  uiFontSize: 0,
  explorerFontSize: 0,
  gitFontSize: 0,
  sidebarWidthByView: {},
  ccWidth: DEFAULT_CC_WIDTH,
  terminalHeight: DEFAULT_TERMINAL_HEIGHT,
  gitLogRamasWidth: DEFAULT_GIT_LOG_RAMAS,
  gitLogDetalleWidth: DEFAULT_GIT_LOG_DETALLE,
  gitLogArchivosHeight: DEFAULT_GIT_LOG_ARCHIVOS_H,
  dbMountsByProject: {},
  aplicarUpdateAlCerrar: true,
  diffColapsarSinCambios: false,
  paquetesExtraSandbox: [],
  sandboxDepsNavegador: false,
  menuWindowsCarpetas: false,
  menuWindowsArchivos: false,
  menuWindowsExtensiones: [],
  menuWindowsAvisado: false,
  accionRapidaFinder: false,
  vistaLateralPorPerfil: {},
  panelInferiorPorPerfil: {},
  mosaicoPreset: 'auto',
  dbAgenteVisiblePorPerfil: {},
  dbAgenteWidth: DEFAULT_DB_AGENTE_WIDTH,
  dbResultadosAlto: DEFAULT_DB_RESULTADOS_ALTO,
  dbFontSize: 0,
  dbFilasPorPagina: DB_FILAS_POR_PAGINA_POR_DEFECTO,
  dbTxInicial: DB_TX_INICIAL_POR_DEFECTO,
  dbConsolaInactividadMin: DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO,
  agenteInactividadMin: AGENTE_INACTIVIDAD_MIN_POR_DEFECTO,
  sshGruposPlegadosPorPerfil: {},
  sshRielAncho: SSH_RIEL_ANCHO_POR_DEFECTO,
  sshRielVisiblePorPerfil: {},
  sshRecientesPorPerfil: {},
  agenteTerminalVisiblePorPerfil: {}
}

/** Rango válido del tamaño de fuente de terminal (0 = usar el predeterminado). */
export const TERMINAL_FONT_SIZE_MIN = 9
export const TERMINAL_FONT_SIZE_MAX = 28

/**
 * Rango del tamaño de letra de la INTERFAZ, solo para sanear el archivo. El rango
 * real y la derivación de alturas viven en `renderer/theme/densidad.ts`, que es de
 * renderer y no puede importarse desde aquí (esto es `shared`); se mantienen
 * iguales a propósito.
 */
export const UI_FONT_SIZE_MIN = 9
export const UI_FONT_SIZE_MAX = 18

/**
 * Estado de un proyecto abierto de cara a la restauración.
 *  - `active`     -> el proyecto amanece como una pestaña normal (inerte bajo el
 *                    arranque perezoso: su agente NO arranca hasta que el usuario
 *                    entra a la pestaña).
 *  - `hibernated` -> el proyecto amanece HIBERNADO (igual de inerte bajo el modelo
 *                    perezoso; el campo lo consume el bloque B1, hibernación
 *                    manual, que aún no está implementado). Se define YA para que
 *                    un proyecto hibernado al cerrar la app amanezca hibernado.
 */
export type ProjectEstado = 'active' | 'hibernated'

/** Un proyecto abierto, tal cual se persiste (identidad + estado; sin repos). */
export interface PersistedProject {
  /** Ruta host OPACA (clave de identidad). El renderer la reenvía sin interpretarla. */
  projectHostPath: string
  /** Nombre neutro para pintar el tab (basename). */
  name: string
  /** Estado de cara a la restauración (ver ProjectEstado). */
  estado: ProjectEstado
  /**
   * Abierto desde el sistema para ver un archivo: su agente no arranca hasta que se pide.
   * Solo se guarda cuando es `true`; ausente es lo normal.
   */
  agenteDiferido?: true
}

/** Estado de sesión persistido de UN perfil. Análogo a ProfileTabs, sin repoState. */
export interface PersistedProfileTabs {
  /** Proyectos abiertos, en orden de pestañas. */
  openProjects: PersistedProject[]
  /** projectHostPath del proyecto activo de ESTE perfil, o null si está vacío. */
  activePath: string | null
}

/**
 * Documento raíz de workspace-state.json. `version` versiona el shape para futuras
 * migraciones. `byProfile` SOLO incluye perfiles con al menos un proyecto abierto
 * (los vacíos se omiten: reabrir un perfil sin proyectos no necesita entrada, cae
 * al estado por defecto). `activeProfileId` se guarda aunque su perfil esté vacío.
 */
export interface WorkspaceState {
  version: 1
  /** Perfil activo global recordado; null si no había ninguno. */
  activeProfileId: string | null
  /** Estado de sesión por perfil, indexado por profileId (solo perfiles no vacíos). */
  byProfile: Record<string, PersistedProfileTabs>
  /**
   * Ajustes globales de UI (zoom, etc.). OPCIONAL en el shape porque el renderer
   * proyecta el esqueleto de tabs SIN conocerlos (serializeWorkspace los omite) y
   * el store fusiona/preserva el slice. `normalizeWorkspaceState` SIEMPRE lo emite
   * con defaults, así lo leído del disco lo trae siempre presente.
   */
  settings?: WorkspaceSettings
}

/** Versión de shape que este build escribe. Bump al migrar. */
export const WORKSPACE_STATE_VERSION = 1 as const

/** Estados de proyecto válidos (para normalizar entradas desconocidas). */
const VALID_ESTADOS: readonly ProjectEstado[] = ['active', 'hibernated']

/**
 * Normaliza un valor CRUDO (recién parseado del disco, potencialmente corrupto por
 * un cierre sucio) a un WorkspaceState de forma DEFENSIVA:
 *  - descarta proyectos/perfiles malformados en vez de lanzar (un archivo a medio
 *    escribir nunca debe impedir arrancar: se degrada a "menos proyectos", jamás
 *    a un crash);
 *  - `estado` desconocido -> 'active' (default seguro);
 *  - devuelve `null` SOLO si la raíz no es ni siquiera un objeto (archivo basura):
 *    el llamador lo trata como "sin estado" (arranque limpio).
 * Es PURA (sin electron / sin fs): la comparten el store del main y los tests.
 */
export function normalizeWorkspaceState(raw: unknown): WorkspaceState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>

  const activeProfileId = typeof obj.activeProfileId === 'string' ? obj.activeProfileId : null

  const byProfile: Record<string, PersistedProfileTabs> = {}
  const rawByProfile = obj.byProfile
  if (typeof rawByProfile === 'object' && rawByProfile !== null) {
    for (const [profileId, rawTabs] of Object.entries(rawByProfile as Record<string, unknown>)) {
      const normalized = normalizeProfileTabs(rawTabs)
      // Perfil vacío tras el saneado (sin proyectos válidos): se omite.
      if (normalized.openProjects.length > 0) byProfile[profileId] = normalized
    }
  }

  return {
    version: WORKSPACE_STATE_VERSION,
    activeProfileId,
    byProfile,
    settings: normalizeSettings(obj.settings)
  }
}

/**
 * Sanea el slice de ajustes globales de forma DEFENSIVA (un archivo a medio
 * escribir o de una versión vieja nunca debe romper): valores no numéricos o
 * fuera de rango caen al default; el nivel de zoom se redondea y se acota. SIEMPRE
 * devuelve un objeto completo (nunca undefined), así lo persistido lo trae siempre.
 */
function normalizeSettings(raw: unknown): WorkspaceSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  // Los dos grupos del riel se sanean JUNTOS, como una partición: cada icono
  // exactamente una vez entre los dos. Saneando cada lista contra su conjunto fijo,
  // un icono movido de grupo se descartaría en silencio y volvería a su sitio.
  const particionRiel = normalizarParticion(
    obj.activityBarOrder,
    obj.bottomBarOrder,
    RIEL_IDS,
    (id) => !BOTTOM_BAR_DEFAULT_ORDER.includes(id)
  )
  // El orden de los grupos reproduce el de las claves de `WorkspaceSettings`, que es
  // el orden en que se escriben en el archivo.
  return {
    ...normalizarGenerales(obj),
    activityBarOrder: particionRiel.arriba,
    bottomBarOrder: particionRiel.abajo,
    ...normalizarFuentes(obj),
    ...normalizarTamanosPaneles(obj),
    dbMountsByProject: normalizarMontajesBd(obj.dbMountsByProject),
    ...normalizarSistema(obj),
    ...normalizarVistasPorPerfil(obj),
    ...normalizarVistaBd(obj),
    agenteInactividadMin: normalizarInactividadAgenteMin(obj.agenteInactividadMin),
    sshGruposPlegadosPorPerfil: normalizarGruposPlegados(obj.sshGruposPlegadosPorPerfil),
    sshRielAncho: normalizarAnchoRiel(obj.sshRielAncho),
    sshRielVisiblePorPerfil: normalizarRielVisiblePorPerfil(obj.sshRielVisiblePorPerfil),
    sshRecientesPorPerfil: normalizarRecientesPorPerfil(obj.sshRecientesPorPerfil),
    agenteTerminalVisiblePorPerfil: normalizarAgenteTerminalVisible(obj.agenteTerminalVisiblePorPerfil)
  }
}

/** Número finito acotado y redondeado; cualquier otra cosa cae a `porDefecto`. */
function numeroAcotado(v: unknown, min: number, max: number, porDefecto: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clampInt(v, min, max) : porDefecto
}

/**
 * Tamaño de letra de terminal: 0 pasa tal cual (el predeterminado), un número se acota y
 * cualquier otra cosa cae a `porDefecto`.
 */
function tamanoTerminal(v: unknown, porDefecto: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return porDefecto
  return v === 0 ? 0 : clampInt(v, TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX)
}

/**
 * Los tamaños de letra de interfaz se sanean IGUAL: 0 pasa tal cual («el predeterminado»
 * en la base, «igual que la interfaz» en los overrides) y lo demás se acota o cae a 0.
 * El clamp real y la derivación de alturas viven en el renderer (`theme/densidad.ts`);
 * aquí solo se acota a un rango sano para que el archivo no traiga un 900.
 */
function tamanoUi(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? v === 0
      ? 0
      : clampInt(v, UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX)
    : 0
}

/** Strings recortados, no vacíos y sin duplicados; `[]` si no llega una lista. */
function listaDeTextos(v: unknown, transformar: (s: string) => string): string[] {
  if (!Array.isArray(v)) return []
  return [
    ...new Set(
      (v as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map(transformar)
        .filter((s) => s.length > 0)
    )
  ]
}

/** Zoom, cuentas por target, nombres de perfil y modo de los proyectos. */
function normalizarGenerales(
  obj: Record<string, unknown>
): Pick<
  WorkspaceSettings,
  'zoomLevel' | 'agentAccountByTarget' | 'hideProfileNames' | 'windowsModeProjects' | 'defaultProjectMode'
> {
  // Mapa cuenta-por-target: acepta solo entradas string->string|null (defensivo).
  const agentAccountByTarget: Record<string, string | null> = {}
  if (typeof obj.agentAccountByTarget === 'object' && obj.agentAccountByTarget !== null) {
    for (const [k, v] of Object.entries(obj.agentAccountByTarget as Record<string, unknown>)) {
      if (typeof v === 'string' || v === null) agentAccountByTarget[k] = v
    }
  }
  const modo = obj.defaultProjectMode
  return {
    zoomLevel: numeroAcotado(obj.zoomLevel, ZOOM_LEVEL_MIN, ZOOM_LEVEL_MAX, DEFAULT_SETTINGS.zoomLevel),
    agentAccountByTarget,
    hideProfileNames: obj.hideProfileNames === true,
    windowsModeProjects: Array.isArray(obj.windowsModeProjects)
      ? obj.windowsModeProjects.filter((k): k is string => typeof k === 'string')
      : DEFAULT_SETTINGS.windowsModeProjects,
    defaultProjectMode:
      modo === 'windows' || modo === 'docker' || modo === 'ask' ? modo : DEFAULT_SETTINGS.defaultProjectMode
  }
}

/** Fuentes y tamaños de letra de las terminales y de la interfaz. */
function normalizarFuentes(
  obj: Record<string, unknown>
): Pick<
  WorkspaceSettings,
  | 'terminalFontFamily'
  | 'terminalFontSize'
  | 'agentFontFamily'
  | 'agentFontSize'
  | 'uiFontSize'
  | 'explorerFontSize'
  | 'gitFontSize'
> {
  const terminalFontFamily =
    typeof obj.terminalFontFamily === 'string' ? obj.terminalFontFamily.slice(0, 200) : DEFAULT_SETTINGS.terminalFontFamily
  const terminalFontSize = tamanoTerminal(obj.terminalFontSize, DEFAULT_SETTINGS.terminalFontSize)
  // Si el archivo no trae la apariencia del AGENTE (versión en la que había un solo
  // ajuste para las dos terminales), se SIEMBRA con la de shell: sembrar con el default
  // resetearía en silencio a quien tuviera la fuente ajustada.
  return {
    terminalFontFamily,
    terminalFontSize,
    agentFontFamily: typeof obj.agentFontFamily === 'string' ? obj.agentFontFamily.slice(0, 200) : terminalFontFamily,
    agentFontSize: tamanoTerminal(obj.agentFontSize, terminalFontSize),
    uiFontSize: tamanoUi(obj.uiFontSize),
    explorerFontSize: tamanoUi(obj.explorerFontSize),
    gitFontSize: tamanoUi(obj.gitFontSize)
  }
}

/** Anchos y altos de las zonas redimensionables. */
function normalizarTamanosPaneles(
  obj: Record<string, unknown>
): Pick<
  WorkspaceSettings,
  | 'sidebarWidthByView'
  | 'ccWidth'
  | 'terminalHeight'
  | 'gitLogRamasWidth'
  | 'gitLogDetalleWidth'
  | 'gitLogArchivosHeight'
> {
  // Anchos por vista: solo claves de vista conocidas y números en rango (un archivo de
  // otro monitor no debe dejar un panel inservible); las que falten caen al default.
  const sidebarWidthByView: Record<string, number> = {}
  if (typeof obj.sidebarWidthByView === 'object' && obj.sidebarWidthByView !== null) {
    for (const [view, v] of Object.entries(obj.sidebarWidthByView as Record<string, unknown>)) {
      if (!SIDEBAR_VIEW_KEYS.includes(view)) continue
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      sidebarWidthByView[view] = clampInt(v, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)
    }
  }
  const d = DEFAULT_SETTINGS
  return {
    sidebarWidthByView,
    ccWidth: numeroAcotado(obj.ccWidth, CC_WIDTH_MIN, CC_WIDTH_MAX, d.ccWidth),
    terminalHeight: numeroAcotado(obj.terminalHeight, TERMINAL_HEIGHT_MIN, TERMINAL_HEIGHT_MAX, d.terminalHeight),
    gitLogRamasWidth: numeroAcotado(obj.gitLogRamasWidth, GIT_LOG_COL_MIN, GIT_LOG_COL_MAX, d.gitLogRamasWidth),
    gitLogDetalleWidth: numeroAcotado(obj.gitLogDetalleWidth, GIT_LOG_COL_MIN, GIT_LOG_COL_MAX, d.gitLogDetalleWidth),
    gitLogArchivosHeight: numeroAcotado(
      obj.gitLogArchivosHeight,
      GIT_LOG_ARCHIVOS_MIN,
      GIT_LOG_ARCHIVOS_MAX,
      d.gitLogArchivosHeight
    )
  }
}

/**
 * Bases montadas por proyecto: solo claves con array de strings, deduplicado y sin
 * vacíos. Una lista vacía equivale a «ninguna montada», el caso por defecto, y no se guarda.
 */
function normalizarMontajesBd(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [clave, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue
    const ids = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length > 0) out[clave] = ids
  }
  return out
}

/** Actualización, diff, imagen del sandbox e integración con el gestor de archivos. */
function normalizarSistema(
  obj: Record<string, unknown>
): Pick<
  WorkspaceSettings,
  | 'aplicarUpdateAlCerrar'
  | 'diffColapsarSinCambios'
  | 'paquetesExtraSandbox'
  | 'sandboxDepsNavegador'
  | 'menuWindowsCarpetas'
  | 'menuWindowsArchivos'
  | 'menuWindowsExtensiones'
  | 'menuWindowsAvisado'
  | 'accionRapidaFinder'
> {
  // Un booleano cuyo default es ACTIVADO se lee con `!== false`, para que la ausencia
  // de la clave (archivo de una versión anterior) caiga en el default; los de default
  // APAGADO, con `=== true`. Las dos listas se sanean aquí solo en FORMA: la validación
  // estricta vive en `sandboxExtras.ts` y `extensionesShell.ts`, justo antes de usarlas
  // (en un `--build-arg` sin comillas y en una clave del registro).
  return {
    aplicarUpdateAlCerrar: obj.aplicarUpdateAlCerrar !== false,
    diffColapsarSinCambios: obj.diffColapsarSinCambios === true,
    paquetesExtraSandbox: listaDeTextos(obj.paquetesExtraSandbox, (s) => s.trim()),
    sandboxDepsNavegador: obj.sandboxDepsNavegador === true,
    menuWindowsCarpetas: obj.menuWindowsCarpetas === true,
    menuWindowsArchivos: obj.menuWindowsArchivos === true,
    menuWindowsExtensiones: listaDeTextos(obj.menuWindowsExtensiones, (s) => s.trim().toLowerCase()).sort(),
    menuWindowsAvisado: obj.menuWindowsAvisado === true,
    accionRapidaFinder: obj.accionRapidaFinder === true
  }
}

/** Vista lateral y panel inferior recordados por perfil, y distribución del mosaico. */
function normalizarVistasPorPerfil(
  obj: Record<string, unknown>
): Pick<WorkspaceSettings, 'vistaLateralPorPerfil' | 'panelInferiorPorPerfil' | 'mosaicoPreset'> {
  // Un id retirado en una versión futura solo hace que ESE perfil abra el default. La
  // franja admite además '' (cerrada), que es un estado con significado. Un preset de
  // mosaico desconocido vuelve a Automático, que es el que siempre cabe.
  return {
    vistaLateralPorPerfil: mapaDeIds(obj.vistaLateralPorPerfil, ACTIVITY_BAR_DEFAULT_ORDER),
    panelInferiorPorPerfil: mapaDeIds(obj.panelInferiorPorPerfil, [...BOTTOM_BAR_DEFAULT_ORDER, '']),
    mosaicoPreset: esPresetMosaico(obj.mosaicoPreset) ? obj.mosaicoPreset : DEFAULT_SETTINGS.mosaicoPreset
  }
}

/** Vista de bases de datos: agente visible por perfil, tamaños y ajustes del explorador. */
function normalizarVistaBd(
  obj: Record<string, unknown>
): Pick<
  WorkspaceSettings,
  | 'dbAgenteVisiblePorPerfil'
  | 'dbAgenteWidth'
  | 'dbResultadosAlto'
  | 'dbFontSize'
  | 'dbFilasPorPagina'
  | 'dbTxInicial'
  | 'dbConsolaInactividadMin'
> {
  // Los ajustes del explorador se sanean contra su LISTA de `ajustesBd.ts`, y lo que no
  // esté en ella vuelve al de siempre (ver allí por qué no se acerca al más próximo).
  return {
    dbAgenteVisiblePorPerfil: mapaDeBooleanos(obj.dbAgenteVisiblePorPerfil),
    dbAgenteWidth: numeroAcotado(obj.dbAgenteWidth, CC_WIDTH_MIN, CC_WIDTH_MAX, DEFAULT_SETTINGS.dbAgenteWidth),
    dbResultadosAlto: numeroAcotado(
      obj.dbResultadosAlto,
      DB_RESULTADOS_ALTO_MIN,
      DB_RESULTADOS_ALTO_MAX,
      DEFAULT_SETTINGS.dbResultadosAlto
    ),
    dbFontSize: tamanoUi(obj.dbFontSize),
    dbFilasPorPagina: normalizarFilasPorPagina(obj.dbFilasPorPagina),
    dbTxInicial: normalizarTxInicial(obj.dbTxInicial),
    dbConsolaInactividadMin: normalizarInactividadConsolaMin(obj.dbConsolaInactividadMin)
  }
}

/**
 * Sanea un mapa `clave -> booleano` (el agente de datos visible por perfil). Mismo
 * criterio que `mapaDeIds`: se descarta la ENTRADA mala, nunca el mapa entero.
 */
function mapaDeBooleanos(raw: unknown): Record<string, boolean> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.length > 0 && typeof v === 'boolean') out[k] = v
  }
  return out
}

/**
 * Sanea un mapa `clave -> id` quedándose SOLO con las entradas cuyo valor está en
 * `validos`. Devuelve `{}` si lo que llega no es un objeto plano.
 *
 * Se descarta entrada a entrada y no el mapa entero a propósito: estos mapas están
 * indexados por perfil, así que tirarlo completo por una clave mala haría que todos
 * los perfiles perdieran su pantalla por culpa de uno.
 */
function mapaDeIds(raw: unknown, validos: readonly string[]): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && k.length > 0 && typeof v === 'string' && validos.includes(v)) {
      out[k] = v
    }
  }
  return out
}

/** Vistas que pueden tener su propio ancho de panel lateral (las del riel + Configuración). */
const SIDEBAR_VIEW_KEYS: readonly string[] = [...ACTIVITY_BAR_DEFAULT_ORDER, 'settings']

/** Redondea y acota (los tamaños viajan a CSS: siempre enteros). */
function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)))
}

/**
 * Reparte `canonicos` en dos grupos respetando lo que el usuario dejó guardado.
 *
 * Sustituye al `normalizarOrden` por grupo, que saneaba cada lista contra SU
 * conjunto fijo y por tanto descartaba en silencio cualquier icono movido al otro
 * lado: la primera mitad del arreglo era inútil sin esta.
 *
 * Reglas, en este orden:
 *   1. Se respeta lo guardado, en su orden, descartando duplicados y desconocidos
 *      (un icono retirado en una versión nueva no debe dejar un hueco muerto).
 *   2. Un id que aparezca en LOS DOS grupos se queda en el primero que lo declare
 *      (`arriba` gana): estar en dos sitios a la vez no significa nada, y elegir
 *      es mejor que descartarlo de ambos.
 *   3. Lo que falte va a su grupo POR DEFECTO — el `inicial` que se le pasa—, no
 *      a un cajón común: así un icono NUEVO de una versión futura aparece donde
 *      su autor lo pensó, sin que el usuario tenga que ir a buscarlo.
 */
export function normalizarParticion(
  arribaCrudo: unknown,
  abajoCrudo: unknown,
  canonicos: readonly string[],
  /** Grupo por defecto de cada id canónico: `true` = arriba. */
  inicialArriba: (id: string) => boolean
): { arriba: string[]; abajo: string[] } {
  const validos = new Set(canonicos)
  const vistos = new Set<string>()
  const limpiar = (crudo: unknown): string[] => {
    if (!Array.isArray(crudo)) return []
    const out: string[] = []
    for (const v of crudo) {
      if (typeof v !== 'string') continue
      if (!validos.has(v) || vistos.has(v)) continue
      vistos.add(v)
      out.push(v)
    }
    return out
  }
  const arriba = limpiar(arribaCrudo)
  const abajo = limpiar(abajoCrudo)
  for (const id of canonicos) {
    if (vistos.has(id)) continue
    ;(inicialArriba(id) ? arriba : abajo).push(id)
  }
  // Un grupo vacío tras el reparto solo puede venir de un archivo manipulado a
  // mano: se le devuelve un icono para que el riel no quede a medias. Se elige
  // el ÚLTIMO del otro grupo porque el primero suele ser el que más se usa.
  if (arriba.length === 0 && abajo.length > 1) arriba.push(abajo.pop() as string)
  if (abajo.length === 0 && arriba.length > 1) abajo.push(arriba.pop() as string)
  return { arriba, abajo }
}

/** Normaliza el estado de sesión de un perfil (proyectos válidos + activePath consistente). */
function normalizeProfileTabs(raw: unknown): PersistedProfileTabs {
  if (typeof raw !== 'object' || raw === null) return { openProjects: [], activePath: null }
  const obj = raw as Record<string, unknown>

  const openProjects: PersistedProject[] = []
  const seen = new Set<string>()
  if (Array.isArray(obj.openProjects)) {
    for (const item of obj.openProjects) {
      const proj = normalizeProject(item)
      // Dedupe por path (la identidad es intra-perfil): descarta duplicados crudos.
      if (proj && !seen.has(proj.projectHostPath)) {
        seen.add(proj.projectHostPath)
        openProjects.push(proj)
      }
    }
  }

  // activePath solo es válido si apunta a un proyecto realmente presente; si no,
  // cae al primero (perfil no vacío) o a null (vacío). Así nunca queda un activo
  // fantasma que la restauración no pueda resolver.
  let activePath = typeof obj.activePath === 'string' ? obj.activePath : null
  if (activePath === null || !seen.has(activePath)) {
    activePath = openProjects[0]?.projectHostPath ?? null
  }

  return { openProjects, activePath }
}

/** Normaliza un proyecto crudo; devuelve null si le falta la identidad (path). */
function normalizeProject(raw: unknown): PersistedProject | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.projectHostPath !== 'string' || obj.projectHostPath === '') return null
  const name = typeof obj.name === 'string' && obj.name !== '' ? obj.name : basenameOf(obj.projectHostPath)
  const estado =
    typeof obj.estado === 'string' && VALID_ESTADOS.includes(obj.estado as ProjectEstado)
      ? (obj.estado as ProjectEstado)
      : 'active'
  // Solo `true` literal: el main normaliza en CADA guardado, así que sin esta línea la
  // marca no llegaría nunca al disco y el agente arrancaría al reabrir.
  const diferido = obj.agenteDiferido === true ? { agenteDiferido: true as const } : {}
  return { projectHostPath: obj.projectHostPath, name, estado, ...diferido }
}

/** Basename tolerante a separadores Windows/POSIX (fallback de nombre neutro). */
function basenameOf(hostPath: string): string {
  const parts = hostPath.split(/[\\/]/).filter((s) => s !== '')
  return parts[parts.length - 1] ?? hostPath
}

/**
 * Qué se sabe de la carpeta de un proyecto al restaurar. Son TRES estados y no dos, y
 * esa es toda la historia de este bloque: ver `pruneMissingProjects`.
 */
export type PresenciaProyecto =
  /** Se ha comprobado y está ahí. */
  | 'presente'
  /** Se ha comprobado y NO está: borrada o movida. Es lo único que justifica podar. */
  | 'ausente'
  /** No se ha podido comprobar. NO es lo mismo que no estar. */
  | 'indeterminada'

/**
 * Poda los proyectos cuya carpeta host ya NO existe en disco (borrada/movida desde el
 * último cierre): restaurar una pestaña muerta que falla al entrar es peor que no
 * restaurarla. PURA — recibe el veredicto inyectado (en el main sale de un `stat`; en
 * los tests, un fake), de modo que el renderer nunca toca disco.
 *
 * SÓLO SE PODA CON `'ausente'`, Y ESO ES UN ARREGLO CON HISTORIA. Antes el predicado era
 * un booleano `exists` alimentado por un `stat` cuyo `catch` no miraba el error: CUALQUIER
 * fallo se leía como «la carpeta ya no está» y el proyecto se borraba del workspace. Y el
 * borrado es DEFINITIVO, porque la persistencia es incremental: el renderer restaura la
 * versión podada y el primer cambio de UI la escribe encima del disco. O sea que un fallo
 * de un instante se llevaba por delante los proyectos abiertos del usuario, para siempre.
 *
 * `stat` falla por muchas cosas que no son «no existe»:
 *   · macOS pide PERMISO para `~/Documents`, `~/Desktop`, `~/Downloads` e iCloud Drive
 *     (TCC). Sin conceder, `stat` devuelve EPERM. Y el permiso está atado a la FIRMA de
 *     la app: con firma ad-hoc, cada build tiene otro cdhash, así que **una
 *     actualización lo invalida**. De ahí el síntoma que lo destapó: «actualicé Tessera y
 *     al abrirla ya no estaban mis repositorios».
 *   · un share SMB que no responde (ETIMEDOUT), un EIO puntual, un EACCES de permisos
 *     POSIX de toda la vida.
 *   · UN VOLUMEN QUE NO ESTÁ MONTADO, que es el caso traicionero y merece párrafo aparte:
 *     ahí `stat` devuelve **ENOENT**, igual que una carpeta borrada, porque el punto de
 *     montaje sólo existe mientras el volumen lo está (medido: `/Volumes/LoQueSea/x` da
 *     ENOENT con el disco desenchufado). El errno NO basta para distinguirlos, así que
 *     `raizDeVolumen` + una segunda comprobación es lo que separa «borraste la carpeta»
 *     de «no has enchufado el disco». Tampoco es exclusivo de macOS: en Windows una
 *     unidad mapeada o un UNC sin reconectar también llegan como ENOENT (libuv traduce
 *     `ERROR_BAD_NETPATH` a `UV_ENOENT`).
 *
 * Ante la duda se CONSERVA. Un proyecto que no abre es un incordio visible y reversible;
 * un proyecto borrado de la lista es trabajo perdido en silencio.
 *
 * Al podar de verdad:
 *   - un perfil que queda sin proyectos se omite;
 *   - si el activePath apuntaba a un proyecto podado, cae al primero superviviente.
 * Se aplica en el LOAD del main, después de normalizar.
 */
export function pruneMissingProjects(
  state: WorkspaceState,
  presencia: (projectHostPath: string) => PresenciaProyecto
): WorkspaceState {
  const byProfile: Record<string, PersistedProfileTabs> = {}
  for (const [profileId, tabs] of Object.entries(state.byProfile)) {
    const openProjects = tabs.openProjects.filter(
      (p) => presencia(p.projectHostPath) !== 'ausente'
    )
    if (openProjects.length === 0) continue // perfil sin proyectos vivos: se omite
    let activePath = tabs.activePath
    if (activePath === null || !openProjects.some((p) => p.projectHostPath === activePath)) {
      activePath = openProjects[0].projectHostPath // el activo fue podado: cae al primero
    }
    byProfile[profileId] = { openProjects, activePath }
  }
  // Los ajustes globales no dependen de las rutas: se conservan tal cual al podar.
  return {
    version: state.version,
    activeProfileId: state.activeProfileId,
    byProfile,
    settings: state.settings
  }
}

/**
 * Traduce el `code` de un fallo de `stat` a un veredicto. PURA y aparte del `stat` a
 * propósito: es la línea exacta cuyo error causó la pérdida de proyectos, y con la
 * clasificación dentro del `catch` no había forma de probarla. Un futuro añadido de
 * `EACCES` a la rama de «ausente» reintroduciría el fallo con la suite en verde.
 *
 * SÓLO ENOENT Y ENOTDIR son ausencia, y ni siquiera del todo: son las dos formas de «no
 * está ahí» —la segunda, que un tramo intermedio haya dejado de ser directorio— pero
 * ENOENT también lo devuelve un volumen sin montar, así que quien la use tiene que
 * rematar la comprobación con `raizDeVolumen` (ver `pruneMissingProjects`).
 */
export function clasificarPresencia(codigo: unknown): PresenciaProyecto {
  return codigo === 'ENOENT' || codigo === 'ENOTDIR' ? 'ausente' : 'indeterminada'
}

/**
 * Raíz del VOLUMEN al que pertenece una ruta, o `null` si la ruta cuelga del volumen del
 * sistema (donde no hay nada que comprobar: si no está montado, no hay app).
 *
 * Sirve para desempatar el ENOENT ambiguo: si la raíz del volumen tampoco está, lo que
 * falta es el DISCO y no la carpeta, y el proyecto se conserva.
 *
 * Se decide por la FORMA de la ruta y nunca por la plataforma actual, que es la misma
 * regla que `shared/rutasHost.ts`: así una ruta de
 * Windows se clasifica igual desde un Mac, y los dos casos se prueban desde cualquiera de
 * las dos máquinas.
 *
 *   `/Volumes/Trabajo/repo`      -> `/Volumes/Trabajo`   (disco externo o red en macOS)
 *   `/Users/x/Documents/repo`    -> null                 (volumen del sistema)
 *   `D:\proyectos\repo`          -> `D:\`                (unidad de Windows)
 *   `\\servidor\recurso\repo`    -> `\\servidor\recurso` (UNC: el recurso es la raíz)
 */
export function raizDeVolumen(hostPath: string): string | null {
  // UNC primero: empieza por dos barras (de cualquier tipo) y la raíz es servidor+recurso.
  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(hostPath)
  if (unc) return `\\\\${unc[1]}\\${unc[2]}`
  // Unidad de Windows: la raíz es `X:\`, que siempre existe si la unidad está conectada.
  const unidad = /^([A-Za-z]):[\\/]/.exec(hostPath)
  if (unidad) return `${unidad[1]}:\\`
  // macOS: todo lo montado que no es el sistema cuelga de `/Volumes/<nombre>`.
  const volumen = /^\/Volumes\/([^/]+)/.exec(hostPath)
  if (volumen) return `/Volumes/${volumen[1]}`
  return null
}
