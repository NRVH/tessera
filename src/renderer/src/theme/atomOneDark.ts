// =============================================================================
// Paleta Atom One Dark, única fuente de verdad del tema.
//
// La estructura está lista para claro/auto en el futuro: hoy solo existe el
// tema `dark`, pero `ThemeName` y `THEMES` permiten añadir variantes sin tocar
// los componentes (que consumen variables CSS, no colores literales). El tema
// activo se aplica escribiendo estas variables en :root (ver applyTheme()).
// =============================================================================

import type { ITheme } from '@xterm/xterm'

/**
 * Colores crudos del tema oscuro (rediseño "oscuro moderno por capas de
 * elevación"): casi-negro neutro/frío, hairlines translúcidas, superficies con
 * cuerpo. Conserva el nombre ATOM_ONE_DARK como identidad histórica del tema.
 *
 * LA ESCALERA DE ELEVACIÓN son cuatro: `bgDeep` (hundido) < `bgElevated`
 * (headers y sidebar) < `bg` (contenido) < `surface` (controles). `chrome` NO
 * pertenece a esa escalera: es el marco de la ventana, y va por encima de las
 * cuatro. Léelo antes de usarlo como "la superficie más clara".
 */
export const ATOM_ONE_DARK = {
  /**
   * MARCO de la ventana: barra de título, riel de iconos y barra de estado.
   *
   * ROMPE LA ESCALERA DE ELEVACIÓN A PROPÓSITO, y hay que decirlo porque es lo
   * único de esta paleta que no la respeta: es MÁS CLARO que todo lo que encierra.
   * Es el gesto de los IDE modernos —contorno gris y el área de trabajo hundida en un
   * lienzo oscuro con las esquinas redondeadas—, y solo funciona si el marco se
   * separa hacia arriba en vez de hundirse con el resto.
   *
   * TIENE UN GEMELO LITERAL EN EL MAIN (`CHROME_BG` en main/index.ts), porque los
   * botones ─ □ ✕ los pinta Windows y hay que pasarle el color por la API de
   * `titleBarOverlay`. Son procesos distintos y no comparten el tema: si este
   * cambia, aquel también, o la barra se ve partida en dos tonos.
   */
  chrome: '#22242b',
  /**
   * LA CONSOLA DE LA SHELL DE ABAJO, y sólo ella.
   *
   * Tiene color propio porque su trabajo es no parecerse a nada: se probó con el gris
   * del marco y quedaba FUNDIDA con la barra de estado y la barra de título, o sea que
   * el panel no se distinguía de la carcasa; y con `bgDeep` es tan oscura como la
   * consola del AGENTE, y entonces las dos terminales se leen como la misma cosa
   * cuando son dos sitios distintos con dos vidas distintas.
   *
   * Queda por debajo de `chrome` (más oscura que el contorno, como se pidió) y por
   * encima de `bg` y de `bgDeep` (no es negra). Su vecino más próximo en la paleta es
   * `surface`; conviven porque `surface` son CONTROLES pequeños —botones, inputs— y
   * esto es un área grande: nunca se comparan lado a lado a igualdad de tamaño.
   *
   * La delimitación no la hace sólo el color: el hueco lleva además borde y esquinas
   * redondeadas, como el lienzo (ver `.terminal-panel .terminal-host`).
   */
  terminal: '#1d2027',
  bg: '#16171d', // editor / contenido (superficie protagonista, la más clara)
  bgElevated: '#131419', // sidebar, barra de actividad, headers, barra de estado
  bgDeep: '#101116', // zonas hundidas: banda de proyectos, editor-tabs, terminales
  surface: '#1c1e26', // botones, inputs, pill de proyecto activo, cards
  surfaceHi: '#23262f', // hover de botones
  border: 'rgba(255,255,255,0.06)', // hairline: separadores entre columnas
  borderSoft: 'rgba(255,255,255,0.10)', // divisores internos
  fg: '#cbced9', // texto principal (más nítido/frío)
  fgMuted: '#868ba0', // texto secundario
  fgFaint: '#6b6f80', // iconos / comentarios inactivos
  accent: '#6aa8ff', // azul de acento (selección activa, focos)
  accentQuiet: '#6aa8ff', // cursor
  green: '#74d39a', // ok / live
  red: '#ef6b74', // error / borrado
  yellow: '#e8c583', // uso semanal
  orange: '#d9a066',
  cyan: '#63c6cf', // Codex
  magenta: '#c98be0',
  selection: '#2a2f3a', // selección de texto
  white: '#ffffff'
} as const

/**
 * Tema base de xterm.js, y el que usan LAS TERMINALES DE LOS AGENTES: la superficie
 * más honda del shell (`bgDeep`).
 *
 * LOS DOS TIPOS DE TERMINAL NO COMPARTEN FONDO, y esto no es un descuido. La consola
 * del agente es la superficie protagonista de su columna —está siempre abierta y es
 * donde vives—, así que se hunde y desaparece como marco para dejar hablar a la
 * salida del CLI. La shell de abajo es un panel que se abre y se cierra sobre el
 * editor, y ésa sí sube al gris del marco para anunciarse (ver `XTERM_THEME_SHELL`).
 */
export const XTERM_THEME_DARK = {
  background: ATOM_ONE_DARK.bgDeep,
  foreground: ATOM_ONE_DARK.fg,
  cursor: ATOM_ONE_DARK.accentQuiet,
  cursorAccent: ATOM_ONE_DARK.bgDeep,
  selectionBackground: ATOM_ONE_DARK.selection,
  black: '#3f4451',
  red: ATOM_ONE_DARK.red,
  green: ATOM_ONE_DARK.green,
  yellow: ATOM_ONE_DARK.yellow,
  blue: ATOM_ONE_DARK.accent,
  magenta: ATOM_ONE_DARK.magenta,
  cyan: ATOM_ONE_DARK.cyan,
  white: ATOM_ONE_DARK.fg,
  brightBlack: ATOM_ONE_DARK.fgFaint,
  brightRed: ATOM_ONE_DARK.red,
  brightGreen: ATOM_ONE_DARK.green,
  brightYellow: ATOM_ONE_DARK.yellow,
  brightBlue: ATOM_ONE_DARK.accent,
  brightMagenta: ATOM_ONE_DARK.magenta,
  brightCyan: ATOM_ONE_DARK.cyan,
  brightWhite: ATOM_ONE_DARK.white
} as const

/**
 * Tema de LA SHELL DE ABAJO (la terminal normal), sobre su color propio.
 *
 * La consola no es ni el fondo del editor ni la carcasa, es
 * un panel con su propio tono y su propio contorno. Con `bgDeep` era lo más oscuro de
 * la ventana y al abrirse se hundía en vez de presentarse; con el gris del marco se
 * fundía con la barra de estado. Ver `ATOM_ONE_DARK.terminal`.
 *
 * NO LO USA LA TERMINAL DEL AGENTE, y esa separación es el motivo de que este objeto
 * exista: el tema era uno solo, y cambiarlo repintó las dos —incluida la columna del
 * agente, que debe seguir hundida—.
 *
 * EL COLOR NO BASTA POR SÍ SOLO: `theme.background` sólo pinta el lienzo de xterm; el
 * anillo del `padding` lo pinta el CSS. El gemelo está en
 * `.terminal-panel .terminal-host`, con `--bg-terminal`, y ese selector lleva
 * `.terminal-panel` DELANTE justamente para no volver a alcanzar al pane del agente,
 * que usa la misma clase `.terminal-host`.
 */
export const XTERM_THEME_SHELL = {
  ...XTERM_THEME_DARK,
  background: ATOM_ONE_DARK.terminal,
  // Tinta del GLIFO que queda debajo del cursor de bloque: tiene que seguir al fondo,
  // o el carácter bajo el cursor aparece recortado sobre un rectángulo de otro tono.
  cursorAccent: ATOM_ONE_DARK.terminal,
  // NO es `ATOM_ONE_DARK.selection`: aquel gris (#2a2f3a) se pensó contra el fondo hundido y
  // sobre #1d2027 da 1,21:1, así que la selección casi no se ve. Éste da 1,63:1.
  // Tampoco puede parecerse al resaltado de los aciertos del buscador (#37455a, en
  // `features/terminales/searchDecorations.ts`, que este tema no controla): tira al índigo
  // en vez de al pizarra para distinguirse por TONO y no solo por claridad.
  selectionBackground: '#3a3f6b'
} as const

/**
 * El tema de xterm con el CURSOR teñido del color del perfil.
 *
 * El cursor es lo único de la terminal que puede llevar identidad sin estorbar: es
 * pequeño, parpadea (o sea, ya lo estás mirando) y no compite con la salida del
 * comando, que tiene sus propios colores ANSI y no se puede tocar sin romper lo que
 * los programas esperan pintar. Con dos terminales de dos perfiles abiertas, es la
 * señal más barata de "en cuál estoy tecleando".
 *
 * `color` debe venir YA como tinta de perfil (ver features/pestanas/colorPerfil); aquí no se
 * rebaja nada, para que este módulo siga sin saber qué es un perfil. Con `null`
 * devuelve EL MISMO objeto de siempre, no una copia: los panes comparan por
 * identidad para no reasignar el tema en cada render.
 *
 * `base` es la superficie: el agente se queda con el fondo hundido (por defecto) y la
 * shell de abajo pasa `XTERM_THEME_SHELL`. Es un PARÁMETRO y no dos funciones para
 * que el trato del cursor —y la identidad estable del objeto— se escriban una vez.
 */
export function xtermThemeConCursor(color: string | null, base: ITheme = XTERM_THEME_DARK): ITheme {
  if (!color) return base
  return { ...base, cursor: color }
}

export type ThemeName = 'dark' // 'light' | 'auto' en el futuro

/** Mapa nombre-de-tema -> variables CSS. Hoy solo 'dark'. */
export const THEMES: Record<ThemeName, Record<string, string>> = {
  dark: {
    // El MARCO de la ventana. No es un peldaño más de la escalera bg/bgElevated/
    // bgDeep: va por encima de las tres (ver el comentario de `chrome`).
    '--bg-chrome': ATOM_ONE_DARK.chrome,
    // La consola de la shell de abajo. Gemelo de `XTERM_THEME_SHELL.background`: uno
    // pinta el lienzo de xterm y el otro el anillo del padding, y tienen que ir a
    // juego o se ve un marco de otro tono alrededor de la terminal.
    '--bg-terminal': ATOM_ONE_DARK.terminal,
    /**
     * SUPERFICIE DE LO QUE FLOTA (los cuatro modales).
     *
     * Es un ALIAS de `chrome`, no un color nuevo: si aquí apareciera el literal
     * habría un TERCER gemelo del gris del marco —ya hay dos, éste y `CHROME_BG` en
     * main/index.ts— y el día que el marco cambie de tono los modales se quedarían
     * atrás sin ningún error que lo avise. Tiene nombre propio para poder separarlo
     * del marco en el futuro sin repintar la ventana.
     *
     * POR QUÉ EL GRIS DEL MARCO Y NO UN PELDAÑO DE LA ESCALERA. Un modal no flota
     * sobre el fondo: flota sobre su propio scrim. Medido: con el scrim al 50 % el
     * marco de detrás queda en #111216, y la tarjeta que se usaba antes
     * (`--bg-elevated` #131419) contrasta 1,02:1 contra él. Literalmente invisible:
     * la separación la estaba pagando entera la sombra. Con este valor sube a
     * 1,21:1. Y encaja con lo que ya dice el comentario de `chrome`: lo que va por
     * encima de las cuatro capas es de esta familia.
     */
    '--bg-modal': ATOM_ONE_DARK.chrome,
    '--bg': ATOM_ONE_DARK.bg,
    '--bg-elevated': ATOM_ONE_DARK.bgElevated,
    '--bg-deep': ATOM_ONE_DARK.bgDeep,
    // Superficies interactivas por elevación (botones, inputs, pills, cards).
    '--bg-surface': ATOM_ONE_DARK.surface,
    '--bg-surface-hi': ATOM_ONE_DARK.surfaceHi,
    '--border': ATOM_ONE_DARK.border,
    '--border-soft': ATOM_ONE_DARK.borderSoft,
    '--fg': ATOM_ONE_DARK.fg,
    '--fg-muted': ATOM_ONE_DARK.fgMuted,
    '--fg-faint': ATOM_ONE_DARK.fgFaint,
    /**
     * LOS DOS GRISES DE APOYO, RECALIBRADOS PARA LA SUPERFICIE DE MODAL.
     *
     * `--fg-faint` (#6b6f80) sobre `--bg-modal` da 3,11:1 y falla AA para texto. Ya
     * iba justo antes —3,69:1 sobre `--bg-elevated`—, pero sobre una tarjeta más
     * clara es insostenible: el tenue pasa a #8c8f9c (4,81).
     *
     * Y EL TENUE NO PUEDE SUBIR SOLO: #8c8f9c es MÁS CLARO que `--fg-muted` (#868ba0), así que subir sólo
     * uno dejaba la escalera de tres grises DEL REVÉS dentro de cada modal —el
     * "tenue" pesando más que el "secundario"—. El secundario sube con él a #9398ae
     * (5,42:1, prácticamente lo mismo que daba antes sobre la tarjeta oscura). La
     * escalera dentro del modal queda 9,87 / 5,42 / 4,81, en ese orden y los tres
     * por encima de AA.
     *
     * NO se suben los tokens globales: sobre `--bg-deep` y `--bg-elevated` los
     * valores actuales están calibrados para el árbol y las terminales, y subirlos
     * allí aplanaría la jerarquía que hace legible una lista larga. Se republican
     * dentro de `.modal-overlay` (ver styles.css), que es el mismo patrón con el que
     * la densidad da a cada panel su propio tamaño: mismo nombre, otro valor, y todo
     * lo que ya los consume obedece solo.
     *
     * ALCANCE REAL, y conviene decirlo porque no es evidente: `.modal-overlay` es un
     * ANCESTRO, así que esto alcanza también a lo que dentro del modal vive sobre
     * `--bg-deep` —el riel de Configuración y sus contadores—, donde el tenue pasa de
     * 3,78 a 5,86. Ahí sube el contraste sin invertir nada, porque el secundario sube
     * con él. Lo que queda FUERA es lo que importaba proteger: el árbol del
     * explorador y las terminales.
     */
    '--fg-muted-modal': '#9398ae',
    '--fg-faint-modal': '#8c8f9c',
    '--accent': ATOM_ONE_DARK.accent,
    // Fondo del brillo de acento (fila de archivo activa en el explorador).
    '--accent-glow': 'rgba(106,168,255,0.18)',
    // Ámbar del modo Windows nativo (glifo de modo en la pestaña de proyecto).
    '--mode-windows': '#dfa25a',
    /**
     * Tinte del contenido que vive DENTRO de un archivo contenedor (.jar/.war/…).
     * Al desplegar un .jar, todo su interior se
     * pinta sobre un fondo rojizo para que se lea de un vistazo que eso NO es código
     * del proyecto —no se puede editar, ni renombrar, ni tiene estado de git—, sino
     * que estás mirando dentro de otra cosa.
     *
     * Se deja literal (como `--accent-glow`) y no como `color-mix` de `--red` porque
     * el alfa está ajustado a ojo sobre `--bg-elevated`: da ~#322026, suficiente para
     * distinguirse sin competir con el azul de la fila activa que va encima.
     */
    '--archive-glow': 'rgba(239, 107, 116, 0.13)',
    '--green': ATOM_ONE_DARK.green,
    '--red': ATOM_ONE_DARK.red,
    /**
     * ROJO PARA TEXTO SOBRE TINTE ROJO. Existe por una razón medida, no estética:
     * un botón destructivo de contorno se rellena con su propio color al tocarlo, y
     * `--red` sobre ese relleno CAE POR DEBAJO DE AA — 4,03:1 con el tinte al 17 %
     * y 3,72:1 al 22 %. Éste da 4,95 y 4,64: el color del texto sube cuando sube el
     * fondo que lo sostiene.
     *
     * Va literal (como `--accent-glow` y `--archive-glow`) y no como `color-mix` de
     * `--red`, porque es un valor de la paleta y no una derivación de uso.
     */
    '--red-hi': '#f28990',
    /**
     * LA FAMILIA DEL ROJO DE **ACCIÓN**, que no es el mismo que el de ESTADO.
     *
     * `--red` seguirá significando lo que significaba: borrado, conflicto, error,
     * línea quitada del diff, rojo ANSI de la terminal. Estos tres son otra cosa —el
     * cromo de un botón que aún no has pulsado— y se separan porque un botón nunca
     * debe pintarse con la densidad de un error: el error INFORMA de algo que ya
     * pasó, el botón ESPERA a que decidas.
     *
     * Los porcentajes son los que la app ya usaba en el único sitio donde esto
     * estaba bien hecho (el "Descartar N" del panel de Git), ahora con un nombre en
     * vez de copiados a mano. `.modal-overlay` los republica más fuertes porque su
     * tarjeta es más clara; el porqué, medido, está en styles.css.
     *
     * SE MEZCLAN CONTRA `transparent` Y NO CONTRA EL FONDO. Sobre un padre opaco las
     * dos formas dan el MISMO píxel (`color-mix` premultiplica), así que mezclar
     * contra `--bg-modal` sólo serviría para hornear en una clase genérica la
     * suposición de que siempre vive dentro de un modal. No la hornees.
     */
    '--danger-tinte': 'color-mix(in srgb, var(--red) 14%, transparent)',
    '--danger-tinte-fuerte': 'color-mix(in srgb, var(--red) 22%, transparent)',
    '--danger-filete': 'color-mix(in srgb, var(--red) 45%, transparent)',
    '--danger-filete-fuerte': 'color-mix(in srgb, var(--red) 60%, transparent)',
    /**
     * EL RELLENO TRANSLÚCIDO DE TODO LO FANTASMA (botones de icono, acciones sin
     * cuerpo, filas). Dos peldaños: `suave` para el hover y `fuerte` para el pulsado.
     *
     * Es token y no literal porque su fuerza DEPENDE del fondo: sobre la superficie
     * de modal el mismo alfa se ve menos —medido en dL\*, 8,0 baja a 7,0— y allí se
     * republican un escalón más arriba.
     *
     * DE MOMENTO SÓLO LO CONSUMEN LOS CINCO SITIOS QUE ESTE LOTE TOCÓ (el hover de
     * `.btn-icon`, los dos de Configuración, la fila de conversaciones y el fantasma
     * de los diálogos). Quedan ~20 alfas blancos escritos a mano por el resto de la
     * hoja —barra de título, pestañas, riel, terminales— con cuatro valores
     * distintos; convertirlos es una limpieza aparte y a propósito no se hizo aquí,
     * porque son superficies que NO cambian de fondo y mezclarlo con este cambio
     * habría hecho el diff imposible de revisar.
     */
    '--hover-suave': 'rgba(255,255,255,0.07)',
    '--hover-fuerte': 'rgba(255,255,255,0.12)',
    '--yellow': ATOM_ONE_DARK.yellow,
    '--selection': ATOM_ONE_DARK.selection,
    // Resaltado del buscador en las vistas RENDERIZADAS (.md / .docx), que se pinta
    // con la CSS Custom Highlight API. Mismos valores que las decoraciones de xterm
    // (features/terminales/searchDecorations.ts) para que buscar se vea igual en la terminal y
    // en un documento; se repiten porque xterm no lee variables CSS.
    '--search-match': '#37455a',
    '--search-match-active': '#7a5a25',
    '--search-match-active-fg': '#e8c583',
    /**
     * Resaltado de la LISTA de resultados de "Buscar en archivos". Es un par
     * DISTINTO de `--search-match-active*` a propósito, y la diferencia no es
     * estética sino de fondo sobre el que vive.
     *
     * Los de arriba se pintan ENCIMA del código, donde el texto ya tiene su color
     * de token y el resaltado solo puede teñir el fondo: por eso son un ámbar
     * OSCURO (#7a5a25), que no tapa lo que hay debajo. En la lista pasa lo
     * contrario —la fila es texto plano y el resaltado manda—, así que se usa el
     * naranja del tema a plena luz con la letra casi negra encima.
     * Calculado: el naranja (#d9a066) contra #14171c da ~8:1, muy por encima del
     * 4,5:1 que pide AA.
     *
     * Poner la letra clara sobre el ámbar oscuro (que es lo que había) daba 2,1:1
     * en la lista: lo buscado se leía PEOR que el resto de la línea, justo al revés
     * de lo que un resaltado tiene que hacer.
     */
    '--search-hit': ATOM_ONE_DARK.orange,
    '--search-hit-fg': '#14171c',
    /**
     * EL VELO Y LA SOMBRA DE LOS MODALES, que estaban escritos a mano en cinco sitios
     * (el overlay y las cuatro tarjetas) y por eso ya habían divergido: el overlay de
     * cierre usa 48px/0.45 y todos los demás 50px/0.5.
     *
     * EL VELO SE QUEDA EN 0,5 Y NO BAJA AL 32 % HABITUAL. Contraste de la
     * tarjeta contra su propio fondo velado: 1,14 al 32 %, 1,17 al 40 %, 1,21 al 50 %.
     * Ese 32 % está calibrado para tema CLARO; en oscuro, aclarar el velo RESTA
     * separación en vez de darla. Subir al 60 % tampoco compensa (1,24 por un fondo
     * notablemente más negro).
     */
    '--scrim': 'rgba(0,0,0,0.5)',
    '--shadow-modal': '0 18px 50px rgba(0,0,0,0.5)',
    // Sombras del rediseño: chips con cuerpo, pestañas elevadas, headers con base.
    '--shadow-chip': '0 1px 2px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.06)',
    '--shadow-tab': '0 -2px 10px rgba(0,0,0,0.22)',
    '--shadow-header': '0 1px 0 rgba(0,0,0,0.28)',
    // Scrollbars: el color sale del tema (se adaptará solo cuando exista 'light').
    // Tres estados: reposo (tenue, descubrible), hover (más contraste), arrastre
    // (acento). Derivados de fg/accent con alfa para fundirse con cualquier fondo.
    '--sb-thumb': 'rgba(171, 178, 191, 0.16)', // fg @ 16%
    '--sb-thumb-hover': 'rgba(171, 178, 191, 0.34)', // fg @ 34%
    '--sb-thumb-active': 'rgba(97, 175, 239, 0.62)' // accent @ 62%
  }
}

/** Aplica un tema escribiendo sus variables en el documento. */
export function applyTheme(name: ThemeName): void {
  const vars = THEMES[name]
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
  root.dataset.theme = name
}
