// =============================================================================
// Los temas del código: los colores con que se pinta el texto de los archivos (editor, diffs, visores, los
// bloques de código de la vista previa de Markdown y los editores de bases de datos). El fondo, la línea del
// cursor, la selección y los números del margen son los de Tessera en todos: un tema solo cambia los
// colores del texto, y el contenido sigue integrado en el marco de la app. Cada tema es una paleta con nombre por papel;
// `monacoTema.ts` la traduce a Monaco y `comun/temaCodigo.ts` la publica en CSS para lo que no es Monaco.
// «Tessera» es el de serie; los demás reproducen paletas de la comunidad, citadas en THIRD_PARTY_NOTICES.md.
// Puro: lo carga `node` a secas.
// Decisiones: docs/decisiones/renderer/temas-de-codigo.md
// =============================================================================

import { ATOM_ONE_DARK } from './atomOneDark.ts'

/** Los colores de un tema, por el papel que cumplen. Todos en hex `#rrggbb`, el único formato de Monaco. */
export interface PaletaCodigo {
  fondo: string
  texto: string
  comentario: string
  palabraClave: string
  operador: string
  cadena: string
  numero: string
  tipo: string
  funcion: string
  variable: string
  constante: string
  etiqueta: string
  atributo: string
  /** Las claves de JSON y YAML. */
  clave: string
  regexp: string
  /** La línea del cursor. */
  lineaActual: string
  seleccion: string
  numeroLinea: string
  numeroLineaActiva: string
  cursor: string
  /** El diff (líneas añadidas y quitadas) y los subrayados de error, aviso e información. */
  insertado: string
  eliminado: string
  aviso: string
  info: string
}

/** Lo de Tessera en todos los temas: el fondo, lo que va atado a él y los números del margen. */
type DeTessera = 'fondo' | 'lineaActual' | 'seleccion' | 'numeroLinea' | 'numeroLineaActiva'

/** Lo que aporta un tema: los colores del texto. */
type ColoresTema = Omit<PaletaCodigo, DeTessera>

/**
 * Cada tema cambia de verdad la paleta: entre dos cualesquiera, al menos la mitad de sus colores principales
 * se ven claramente distintos (`papelesQueCambian`, en `test-temas-codigo.mts`). Variantes de un mismo tono
 * no se añaden.
 */
export const TEMAS_CODIGO = [
  'tessera',
  'dracula',
  'monokai',
  'tokyo-night',
  'darcula',
  'dark-plus',
  'github-dark',
  'gruvbox-dark',
  'solarized-dark',
  'cobalt2',
  'synthwave-84'
] as const

export type TemaCodigoId = (typeof TEMAS_CODIGO)[number]

export const TEMA_CODIGO_POR_DEFECTO: TemaCodigoId = 'tessera'

const c = ATOM_ONE_DARK

/** El fondo de Tessera, lo que va atado a él y los números del margen, iguales en todos los temas. */
const FONDO_TESSERA: Pick<PaletaCodigo, DeTessera> = {
  fondo: c.bg,
  lineaActual: c.bgElevated,
  seleccion: c.selection,
  numeroLinea: c.fgFaint,
  numeroLineaActiva: c.fgMuted
}

const conFondoTessera = (t: ColoresTema): PaletaCodigo => ({ ...t, ...FONDO_TESSERA })

export const PALETAS_CODIGO: Readonly<Record<TemaCodigoId, PaletaCodigo>> = {
  // El de serie, con los colores que el editor tenía antes de haber temas.
  tessera: conFondoTessera({
    texto: c.fg,
    comentario: c.fgFaint,
    palabraClave: c.magenta,
    operador: c.cyan,
    cadena: c.green,
    numero: c.orange,
    tipo: c.yellow,
    funcion: c.accent,
    variable: c.red,
    constante: c.orange,
    etiqueta: c.red,
    atributo: c.orange,
    clave: c.red,
    regexp: c.cyan,
    cursor: c.accentQuiet,
    insertado: c.green,
    eliminado: c.red,
    aviso: c.yellow,
    info: c.accent
  }),
  dracula: conFondoTessera({
    texto: '#f8f8f2',
    comentario: '#6272a4',
    palabraClave: '#ff79c6',
    operador: '#ff79c6',
    cadena: '#f1fa8c',
    numero: '#bd93f9',
    tipo: '#8be9fd',
    funcion: '#50fa7b',
    variable: '#f8f8f2',
    constante: '#bd93f9',
    etiqueta: '#ff79c6',
    atributo: '#50fa7b',
    clave: '#8be9fd',
    regexp: '#ff5555',
    cursor: '#f8f8f2',
    insertado: '#50fa7b',
    eliminado: '#ff5555',
    aviso: '#ffb86c',
    info: '#8be9fd'
  }),
  monokai: conFondoTessera({
    texto: '#f8f8f2',
    comentario: '#75715e',
    palabraClave: '#f92672',
    operador: '#f92672',
    cadena: '#e6db74',
    numero: '#ae81ff',
    tipo: '#66d9ef',
    funcion: '#a6e22e',
    variable: '#f8f8f2',
    constante: '#ae81ff',
    etiqueta: '#f92672',
    atributo: '#a6e22e',
    clave: '#66d9ef',
    regexp: '#e6db74',
    cursor: '#f8f8f0',
    insertado: '#a6e22e',
    eliminado: '#f92672',
    aviso: '#fd971f',
    info: '#66d9ef'
  }),
  'tokyo-night': conFondoTessera({
    texto: '#c0caf5',
    comentario: '#565f89',
    palabraClave: '#bb9af7',
    operador: '#89ddff',
    cadena: '#9ece6a',
    numero: '#ff9e64',
    tipo: '#2ac3de',
    funcion: '#7aa2f7',
    variable: '#c0caf5',
    constante: '#ff9e64',
    etiqueta: '#f7768e',
    atributo: '#bb9af7',
    clave: '#73daca',
    regexp: '#b4f9f8',
    cursor: '#c0caf5',
    insertado: '#9ece6a',
    eliminado: '#f7768e',
    aviso: '#e0af68',
    info: '#7aa2f7'
  }),
  darcula: conFondoTessera({
    texto: '#a9b7c6',
    comentario: '#808080',
    palabraClave: '#cc7832',
    operador: '#a9b7c6',
    cadena: '#6a8759',
    numero: '#6897bb',
    tipo: '#a9b7c6',
    funcion: '#ffc66d',
    variable: '#9876aa',
    constante: '#9876aa',
    etiqueta: '#e8bf6a',
    atributo: '#bababa',
    clave: '#9876aa',
    regexp: '#6a8759',
    cursor: '#bbbbbb',
    insertado: '#629755',
    eliminado: '#bc3f3c',
    aviso: '#bbb529',
    info: '#6897bb'
  }),
  'dark-plus': conFondoTessera({
    texto: '#d4d4d4',
    comentario: '#6a9955',
    palabraClave: '#569cd6',
    operador: '#d4d4d4',
    cadena: '#ce9178',
    numero: '#b5cea8',
    tipo: '#4ec9b0',
    funcion: '#dcdcaa',
    variable: '#9cdcfe',
    constante: '#4fc1ff',
    etiqueta: '#569cd6',
    atributo: '#9cdcfe',
    clave: '#9cdcfe',
    regexp: '#d16969',
    cursor: '#aeafad',
    insertado: '#81b88b',
    eliminado: '#f14c4c',
    aviso: '#cca700',
    info: '#3794ff'
  }),
  'github-dark': conFondoTessera({
    texto: '#e6edf3',
    comentario: '#8b949e',
    palabraClave: '#ff7b72',
    operador: '#ff7b72',
    cadena: '#a5d6ff',
    numero: '#79c0ff',
    tipo: '#ffa657',
    funcion: '#d2a8ff',
    variable: '#e6edf3',
    constante: '#79c0ff',
    etiqueta: '#7ee787',
    atributo: '#79c0ff',
    clave: '#7ee787',
    regexp: '#7ee787',
    cursor: '#e6edf3',
    insertado: '#3fb950',
    eliminado: '#f85149',
    aviso: '#d29922',
    info: '#58a6ff'
  }),
  'gruvbox-dark': conFondoTessera({
    texto: '#ebdbb2',
    comentario: '#928374',
    palabraClave: '#fb4934',
    operador: '#fe8019',
    cadena: '#b8bb26',
    numero: '#d3869b',
    tipo: '#fabd2f',
    funcion: '#8ec07c',
    variable: '#83a598',
    constante: '#d3869b',
    etiqueta: '#fb4934',
    atributo: '#fabd2f',
    clave: '#83a598',
    regexp: '#8ec07c',
    cursor: '#ebdbb2',
    insertado: '#b8bb26',
    eliminado: '#fb4934',
    aviso: '#fabd2f',
    info: '#83a598'
  }),
  'solarized-dark': conFondoTessera({
    texto: '#93a1a1',
    comentario: '#657b83',
    palabraClave: '#859900',
    operador: '#859900',
    cadena: '#2aa198',
    numero: '#d33682',
    tipo: '#b58900',
    funcion: '#268bd2',
    variable: '#93a1a1',
    constante: '#cb4b16',
    etiqueta: '#268bd2',
    atributo: '#b58900',
    clave: '#268bd2',
    regexp: '#dc322f',
    cursor: '#93a1a1',
    insertado: '#859900',
    eliminado: '#dc322f',
    aviso: '#b58900',
    info: '#268bd2'
  }),
  cobalt2: conFondoTessera({
    texto: '#ffffff',
    comentario: '#0088ff',
    palabraClave: '#ff9d00',
    operador: '#ff9d00',
    cadena: '#3ad900',
    numero: '#ff628c',
    tipo: '#80ffbb',
    funcion: '#ffc600',
    variable: '#9effff',
    constante: '#ff628c',
    etiqueta: '#9effff',
    atributo: '#ffc600',
    clave: '#9effff',
    regexp: '#80ffc2',
    cursor: '#ffc600',
    insertado: '#3ad900',
    eliminado: '#ff628c',
    aviso: '#ffc600',
    info: '#0088ff'
  }),
  'synthwave-84': conFondoTessera({
    texto: '#ffffff',
    comentario: '#848bbd',
    palabraClave: '#fede5d',
    operador: '#fede5d',
    cadena: '#ff8b39',
    numero: '#f97e72',
    tipo: '#fe4450',
    funcion: '#36f9f6',
    variable: '#ff7edb',
    constante: '#f97e72',
    etiqueta: '#72f1b8',
    atributo: '#fede5d',
    clave: '#72f1b8',
    regexp: '#f97e72',
    cursor: '#f97e72',
    insertado: '#72f1b8',
    eliminado: '#fe4450',
    aviso: '#fede5d',
    info: '#36f9f6'
  })
}

/** El nombre con que se elige cada tema: el de su proyecto, que es como lo conoce quien lo busca. */
export const NOMBRES_TEMAS_CODIGO: Readonly<Record<Exclude<TemaCodigoId, 'tessera'>, string>> = {
  dracula: 'Dracula',
  monokai: 'Monokai',
  'tokyo-night': 'Tokyo Night',
  darcula: 'Darcula',
  'dark-plus': 'Dark+',
  'github-dark': 'GitHub Dark',
  'gruvbox-dark': 'Gruvbox Dark',
  'solarized-dark': 'Solarized Dark',
  cobalt2: 'Cobalt2',
  'synthwave-84': "SynthWave '84"
}

/** ¿Es un tema que existe? Lo guardado sale de un archivo: uno que ya no existe cae al de serie. */
export function esTemaCodigo(v: unknown): v is TemaCodigoId {
  return typeof v === 'string' && (TEMAS_CODIGO as readonly string[]).includes(v)
}

/** La paleta de un tema, o la de serie si el id no existe. */
export function paletaDe(id: string): PaletaCodigo {
  return esTemaCodigo(id) ? PALETAS_CODIGO[id] : PALETAS_CODIGO[TEMA_CODIGO_POR_DEFECTO]
}

/** Luminancia relativa de un `#rrggbb` (WCAG 2.x). */
function luminancia(hex: string): number {
  const canal = (i: number): number => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5)
}

/** Contraste entre dos colores, de 1 a 21 (WCAG 2.x). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** Un `#rrggbb` en el espacio CIE Lab (D65), donde la distancia se parece a la diferencia que se ve. */
function lab(hex: string): [number, number, number] {
  const lin = (i: number): number => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [lin(1), lin(3), lin(5)]
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
  const fy = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
  const fz = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Diferencia de color (ΔE CIE76): por encima de 25, dos colores se ven claramente distintos. */
export function diferenciaDeColor(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** Los colores que definen el aspecto de un tema. */
export const PAPELES_PRINCIPALES: readonly (keyof PaletaCodigo)[] = [
  'texto', 'comentario', 'palabraClave', 'operador', 'cadena', 'numero', 'tipo', 'funcion', 'variable', 'etiqueta'
]

/**
 * Pares que comparten tonos y aun así se ofrecen los dos. Tokyo Night reparte el azul y el morado del de
 * serie de otra forma (palabra clave morada, funciones azules) y es de los más usados; con los demás
 * cambia de siete a diez colores. La excepción es por par, no por tema: frente a cualquier otro, la regla vale.
 */
export const PARECIDOS_ADMITIDOS: readonly (readonly [TemaCodigoId, TemaCodigoId])[] = [['tessera', 'tokyo-night']]

/** Cuántos de los colores principales cambian claramente de un tema a otro. */
export function papelesQueCambian(a: PaletaCodigo, b: PaletaCodigo): number {
  return PAPELES_PRINCIPALES.filter((k) => diferenciaDeColor(a[k], b[k]) > 25).length
}
