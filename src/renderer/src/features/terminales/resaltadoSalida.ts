// =============================================================================
// Resaltado de la salida de las terminales de shell (logs, compilaciones, pruebas, instalaciones,
// conectividad): colores ANSI en lo que llega del pty antes de xterm, así que el texto no cambia y el
// color es un atributo más de la celda. Solo pinta lo que llega SIN color y nunca en la pantalla
// alternativa. Error y aviso, la línea entera; info, ok y lo demás, solo su etiqueta o su dato. El
// estado de cada terminal se lleva de un trozo al siguiente en `EstadoResaltado`.
// Puro: sin DOM ni xterm, con su prueba (`test:resaltado-salida`).
// Decisiones: docs/decisiones/terminales/resaltado-de-la-salida.md
// =============================================================================

const ESC = '\u001b'
const ROJO = `${ESC}[31m`
const AMARILLO = `${ESC}[33m`
const AZUL = `${ESC}[34m`
const VERDE = `${ESC}[32m`
const CIAN = `${ESC}[36m`
const MAGENTA = `${ESC}[35m`
const AZUL_CLARO = `${ESC}[94m`
const MAGENTA_CLARO = `${ESC}[95m`
const CIAN_CLARO = `${ESC}[96m`
const TENUE = `${ESC}[2m`
const FIN_COLOR = `${ESC}[39m`
const FIN_TENUE = `${ESC}[22m`

/** Más largo que esto no se analiza: una línea así no es un log que se lea, y el coste crece con ella. */
export const LARGO_MAXIMO = 2000

/**
 * Una secuencia de escape completa: CSI (`ESC [ … letra`), OSC (`ESC ] … BEL|ST`), las de cadena
 * (DCS, SOS, PM y APC: `ESC P|X|^|_ … ST`, que llevan imágenes y datos) o de dos caracteres. Una de
 * cadena sin terminar cae en la de dos caracteres, y `esIntroductorDeCadena` la delata.
 */
const RE_ESCAPE = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)|[PX^_][^${ESC}]*${ESC}\\\\|[@-Z\\\\-_])`,
  'g'
)
/** Entrar (`h`) o salir (`l`) de la pantalla alternativa. */
const RE_ALTERNATIVA = new RegExp(`^${ESC}\\[\\?(?:1049|1047|47)([hl])$`)
/** Dónde se corta una línea visual: saltos, retornos y mover el cursor a otra fila o columna. */
const RE_CORTE = new RegExp(`(\\r\\n|\\n|\\r|${ESC}\\[[0-9;]*[HfABEFGd])`)

const RE_SGR = new RegExp(`^${ESC}\\[([0-9;]*)m$`)
const RE_REINICIO = new RegExp(`^${ESC}\\[0*m$`)
/** Parámetros de SGR que apagan en vez de encender: reinicio y los «por defecto» de cada atributo. */
const APAGAN = new Set([0, 22, 23, 24, 25, 27, 28, 29, 39, 49])

/** ¿Es un SGR que pone color o estilo (no un simple reinicio)? Entonces el programa ya colorea. */
function esSgrConColor(secuencia: string): boolean {
  const m = RE_SGR.exec(secuencia)
  if (!m) return false
  return m[1].split(';').some((p) => p !== '' && Number(p) !== 0)
}

/**
 * Tras este SGR, ¿queda algún color o estilo del programa encendido? Si no es un SGR, `previo`. Solo
 * el reinicio lo apaga del todo: un «color por defecto» puede dejar la negrita puesta, y en la duda
 * se da por encendido (no pintar es el error barato).
 */
function colorTrasSgr(secuencia: string, previo: boolean): boolean {
  const m = RE_SGR.exec(secuencia)
  if (!m) return previo
  const params = m[1] === '' ? [0] : m[1].split(';').map((p) => (p === '' ? 0 : Number(p)))
  let encendido = previo
  for (const p of params) encendido = !APAGAN.has(p) ? true : p === 0 ? false : encendido
  return encendido
}

/** Una de cadena (o un OSC) sin terminar: lo que sigue es su contenido, no texto. */
function esIntroductorDeCadena(secuencia: string): boolean {
  return secuencia.length === 2 && ']PX^_'.includes(secuencia[1])
}

/** ¿Es un reinicio de atributos (`ESC[m`, `ESC[0m`)? Apagaría el color de una línea entera. */
function esReinicio(secuencia: string): boolean {
  return RE_REINICIO.test(secuencia)
}

type Nivel = 'error' | 'aviso' | null

// --- Niveles: solo cuentan como etiqueta, para que «no error found» no pinte nada --------------

const NIVEL_ERROR = 'ERROR|ERR|SEVERE|CRITICAL|CRIT|FATAL|EMERG|EMERGENCY|ALERT|FAIL|FAILED|FAILURE'
const NIVEL_AVISO = 'WARN|WARNING|DEPRECATED'
const NIVEL_INFO = 'INFO|NOTICE'
const NIVEL_DEPURAR = 'DEBUG|TRACE|VERBOSE'
/** Lo que delimita una etiqueta en mayúsculas: no es parte de otra palabra ni de un identificador. */
const ANTES = '(?<![\\w.$-])'
const DESPUES = '(?![\\w$-])'

/** La etiqueta de un nivel: en mayúsculas sueltas, entre `<>`/`[]` en cualquier caja o como `level=`. */
function reEtiqueta(niveles: string): RegExp {
  return new RegExp(
    `${ANTES}(?:${niveles})${DESPUES}` +
      `|[<\\[](?:${niveles}|${niveles.toLowerCase()}|${capitalizar(niveles)})[>\\]]` +
      `|\\b(?:level|severity|lvl)["']?\\s*[=:]\\s*["']?(?:${niveles}|${niveles.toLowerCase()})\\b`,
    'g'
  )
}

function capitalizar(niveles: string): string {
  return niveles
    .split('|')
    .map((n) => n[0] + n.slice(1).toLowerCase())
    .join('|')
}

const RE_NIVEL_ERROR = reEtiqueta(NIVEL_ERROR)
const RE_NIVEL_AVISO = reEtiqueta(NIVEL_AVISO)
const RE_NIVEL_INFO = reEtiqueta(NIVEL_INFO)
const RE_NIVEL_DEPURAR = reEtiqueta(NIVEL_DEPURAR)

/** Errores que no llevan nivel: compiladores, trazas, gestores de paquetes y conectividad. */
const ERRORES_SIN_NIVEL: RegExp[] = [
  // `error:`, `error[E0308]:`, `error TS2345:` al principio; `archivo:12:5: error:` de los compiladores.
  /^\s*(?:error|fatal)(?:\[[A-Z]?\d+\])?(?::|\s+TS\d+)/i,
  /:\d+(?::\d+)?:\s*(?:fatal\s+)?error\b/i,
  /\berror\s+TS\d+\b/,
  // Gestores de paquetes.
  /^E: /,
  /\bnpm (?:ERR!|error)\s/,
  // Una excepción lanzada: nombre de clase y dos puntos (`IOException: …`) o sola al final de la línea.
  // Sin eso es código que la nombra (`class FooError extends`, `onError (e)`), no un error.
  /\b[\w.$]*[A-Za-z](?:Exception|Error)(?::|\s*$)/,
  /^Exception in thread /,
  // Las trazas: la causa, la cabecera y los marcos de pila de los lenguajes más usados.
  /^\s*Caused by:/,
  /^Traceback \(most recent call last\)/,
  /^\s+at\s+\S+.*(?:\(.*:\d+(?::\d+)?\)|:\d+:\d+)\s*$/,
  /^\s+File ".*", line \d+/,
  // Compilar y probar.
  /\bBUILD (?:FAILURE|FAILED)\b/,
  // Conectividad, también en español. «timed out» suelto no: aparece en resúmenes («0 timed out»).
  /\b(?:Connection (?:refused|timed out|reset|closed by remote host)|(?:Request|Operation|Read|Connect|Connection attempt) timed out|Permission denied|Could not resolve host|Name or service not known|Network is unreachable|No route to host|Host key verification failed|Host (?:is )?unreachable|Destination host unreachable)\b/i,
  /\b(?:Tiempo de espera agotado|Acceso denegado|Host de destino inaccesible|No se puede resolver)\b/i
]

const AVISOS_SIN_NIVEL: RegExp[] = [
  /^\s*warning(?:\[[A-Z]?\d+\])?:/i,
  /:\d+(?::\d+)?:\s*warning\b/i,
  /^W: /,
  /\bnpm (?:WARN|warn)\s/
]

/** El nivel de la línea, si es de error o de aviso: entonces se pinta entera. */
export function nivelDeLinea(texto: string): Nivel {
  if (hay(RE_NIVEL_ERROR, texto) || ERRORES_SIN_NIVEL.some((re) => re.test(texto))) return 'error'
  if (hay(RE_NIVEL_AVISO, texto) || AVISOS_SIN_NIVEL.some((re) => re.test(texto))) return 'aviso'
  return null
}

function hay(re: RegExp, texto: string): boolean {
  re.lastIndex = 0
  return re.test(texto)
}

// --- Datos sueltos: solo se pintan ellos, en una línea que no es de error ni de aviso -------

interface Regla {
  re: RegExp
  /** El color del trozo, o null si este trozo no se pinta (un 3xx, un «0 failed»). */
  color: (m: RegExpExecArray) => { abre: string; cierra: string } | null
  /** Qué grupo se pinta; sin él, toda la coincidencia. */
  grupo?: number
}

const pinta = (abre: string, cierra = FIN_COLOR) => () => ({ abre, cierra })

function colorHttp(codigo: string): { abre: string; cierra: string } | null {
  if (codigo.startsWith('2')) return { abre: VERDE, cierra: FIN_COLOR }
  if (codigo.startsWith('4')) return { abre: AMARILLO, cierra: FIN_COLOR }
  if (codigo.startsWith('5')) return { abre: ROJO, cierra: FIN_COLOR }
  return null
}

function ipValida(ip: string): boolean {
  return ip.split('.').every((n) => Number(n) <= 255)
}

const MESES = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'

/** Una palabra clave que no va tras un cero: «0 failed» o «0 timed out» de un resumen no es un fallo. */
const palabras = (lista: string): RegExp => new RegExp(`(?<!\\b0 )\\b(?:${lista})\\b`, 'gi')

/** Una IPv6 completa o abreviada con `::`; un `::` sin cifras (`std::`, `a :: b`) no lo es. */
const RE_IPV6 =
  /(?<![\w:.])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}|(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?)(?![\w:])/gi

const REGLAS: Regla[] = [
  { re: RE_NIVEL_INFO, color: pinta(AZUL) },
  { re: RE_NIVEL_DEPURAR, color: pinta(TENUE, FIN_TENUE) },
  // Lo que fue bien.
  { re: /\bBUILD SUCCESS(?:FUL)?\b|\bSuccessfully \w+\b|\b(?:Connected to|[Cc]onnection established)\b|[✓✔]/g, color: pinta(VERDE) },
  { re: new RegExp(`${ANTES}(?:OK|SUCCESS|SUCCEEDED|PASS|PASSED|DONE)${DESPUES}`, 'g'), color: pinta(VERDE) },
  // Recuentos de pruebas: lo pasado en verde y lo fallado en rojo solo si no es cero.
  { re: /\b\d+ (?:passed|passing)\b/g, color: pinta(VERDE) },
  { re: /\b(\d+) (?:failed|failing|errors?)\b/g, color: (m) => (Number(m[1]) > 0 ? { abre: ROJO, cierra: FIN_COLOR } : null) },
  { re: /[✗✘]/g, color: pinta(ROJO) },
  // Códigos HTTP: tras la versión (`HTTP/1.1 404`) o tras la petición de un log de acceso (`" 404 `).
  { re: /\bHTTP\/\d(?:\.\d)? (\d{3})\b/g, grupo: 1, color: (m) => colorHttp(m[1]) },
  { re: /" (\d{3}) (?=\d|-)/g, grupo: 1, color: (m) => colorHttp(m[1]) },
  // Palabras clave en cualquier caja, solo la palabra: lo que falla, lo que avisa y lo que fue bien.
  {
    re: palabras(
      "error|failed|failure|fatal|denied|refused|unreachable|timed out|timeout|unable to|cannot|can't|could not|couldn't|not found|no such file or directory|segfault|panic|aborted|killed|corrupted"
    ),
    color: pinta(ROJO)
  },
  { re: palabras('warning|deprecated|retrying|skipped|degraded'), color: pinta(AMARILLO) },
  { re: palabras('success|successful|successfully|succeeded|completed|finished|connected'), color: pinta(VERDE) },
  // Fechas y horas: ISO, las de syslog, las de los servidores de aplicaciones, las de un log de acceso
  // y una hora suelta.
  {
    re: /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    color: pinta(MAGENTA)
  },
  {
    re: new RegExp(`\\b(?:${MESES}) \\d{1,2},? (?:\\d{4},? )?\\d{1,2}:\\d{2}(?::\\d{2}(?:[.,]\\d+)?)?(?: [AP]M)?`, 'g'),
    color: pinta(MAGENTA)
  },
  { re: new RegExp(`\\b\\d{2}/(?:${MESES})/\\d{4}:\\d{2}:\\d{2}:\\d{2}(?: [+-]\\d{4})?`, 'g'), color: pinta(MAGENTA) },
  { re: /\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, color: pinta(MAGENTA) },
  // El programa que escribe la línea de un registro del sistema: `systemd[1]:`, `postfix/smtp[123]:`.
  { re: /\b[A-Za-z_][\w.@/-]*\[\d+\](?=:)/g, color: pinta(MAGENTA_CLARO) },
  // IPs y URLs.
  { re: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, color: (m) => (ipValida(m[0].split(':')[0]) ? { abre: CIAN, cierra: FIN_COLOR } : null) },
  { re: RE_IPV6, color: (m) => (/[0-9a-f]/i.test(m[0]) ? { abre: CIAN, cierra: FIN_COLOR } : null) },
  { re: /\bhttps?:\/\/[^\s<>"'`]+/g, color: pinta(CIAN) },
  // Rutas absolutas, del sistema o de la carpeta personal; una URL ya la tomó su regla, que empieza antes.
  { re: /(?<![\w.:/~-])~?\/(?:[\w.@+-]+\/)*[\w.@+-]+\/?|\b[A-Za-z]:\\(?:[^\s\\:*?"<>|]+\\)*[^\s\\:*?"<>|]+/g, color: pinta(AZUL_CLARO) },
  // Claves: `clave=valor` de los registros, y las de YAML (`nombre:` al principio) y JSON (`"nombre":`).
  { re: /\b([A-Za-z_][\w.-]*)=(?=[^\s=])/g, grupo: 1, color: pinta(CIAN_CLARO) },
  { re: /^\s*(?:- )?([\w.-]+|"[^"]+"|'[^']+'):(?=\s|$)/g, grupo: 1, color: pinta(CIAN_CLARO) },
  { re: /("[^"\\]*")\s*:/g, grupo: 1, color: pinta(CIAN_CLARO) },
  // Un comentario de configuración o de guion: la línea entera, atenuada.
  { re: /^\s*#(?:\s.*)?$/g, color: pinta(TENUE, FIN_TENUE) }
]

interface Tramo {
  desde: number
  hasta: number
  abre: string
  cierra: string
}

/** Los tramos que se pintan en un texto sin escapes, sin solaparse (gana el que empieza antes). */
export function tramosDe(texto: string): Tramo[] {
  const tramos: Tramo[] = []
  for (const regla of REGLAS) {
    regla.re.lastIndex = 0
    for (let m = regla.re.exec(texto); m !== null; m = regla.re.exec(texto)) {
      if (m[0] === '') {
        regla.re.lastIndex++
        continue
      }
      const color = regla.color(m)
      if (!color) continue
      const trozo = regla.grupo !== undefined ? m[regla.grupo] : m[0]
      const desde = m.index + (regla.grupo !== undefined ? m[0].indexOf(trozo) : 0)
      tramos.push({ desde, hasta: desde + trozo.length, ...color })
    }
  }
  tramos.sort((a, b) => a.desde - b.desde || b.hasta - a.hasta)
  const libres: Tramo[] = []
  for (const t of tramos) if (libres.length === 0 || t.desde >= libres[libres.length - 1].hasta) libres.push(t)
  return libres
}

/** Partes de un tramo de línea: el texto y las secuencias de escape, en orden. */
function partes(linea: string): { escape: boolean; s: string }[] {
  const out: { escape: boolean; s: string }[] = []
  let i = 0
  RE_ESCAPE.lastIndex = 0
  for (let m = RE_ESCAPE.exec(linea); m !== null; m = RE_ESCAPE.exec(linea)) {
    if (m.index > i) out.push({ escape: false, s: linea.slice(i, m.index) })
    out.push({ escape: true, s: m[0] })
    i = m.index + m[0].length
  }
  if (i < linea.length) out.push({ escape: false, s: linea.slice(i) })
  return out
}

/**
 * Una línea sin terminar acaba quizá a media palabra («ERR» de «ERRATA»): para decidir se le pega una
 * letra, así su final no cuenta como fin de palabra. Los tramos que la tocarían se descartan.
 */
const PEGADA = 'a'

/**
 * ¿Se deja tal cual? Si ya trae color, o si lleva una secuencia partida o un carácter partido en dos
 * mitades entre dos trozos: meter un color en medio los rompería.
 */
function noSeToca(linea: string, ps: { escape: boolean; s: string }[]): boolean {
  if (ps.some((p) => p.escape && esSgrConColor(p.s))) return true
  if (ps.some((p) => (p.escape ? esIntroductorDeCadena(p.s) : p.s.includes(ESC)))) return true
  return /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(linea)
}

/** La línea entera de `color`; tras cada reinicio del programa se vuelve a poner, o lo apagaría a media línea. */
function pintarEntera(ps: { escape: boolean; s: string }[], color: string): string {
  let out = ''
  let abierto = false
  for (const p of ps) {
    if (p.escape) {
      out += p.s
      if (abierto && esReinicio(p.s)) out += color
      continue
    }
    if (!abierto) {
      out += color
      abierto = true
    }
    out += p.s
  }
  return abierto ? out + FIN_COLOR : out
}

/**
 * Pinta una línea (sin su corte): entera si es de error o de aviso, y si no, sus datos sueltos.
 * `completa`: llegó con su salto; si no, su última palabra puede estar cortada.
 */
export function resaltarLinea(linea: string, completa = true): string {
  if (linea.length === 0 || linea.length > LARGO_MAXIMO) return linea
  const ps = partes(linea)
  if (noSeToca(linea, ps)) return linea
  const texto = ps.filter((p) => !p.escape).map((p) => p.s).join('')
  if (!/[\p{L}\d✓✔✗✘]/u.test(texto)) return linea
  const nivel = nivelDeLinea(completa ? texto : texto + PEGADA)
  if (nivel !== null) return pintarEntera(ps, nivel === 'error' ? ROJO : AMARILLO)
  // Los datos sueltos se buscan en cada trozo de texto: no cruzan una secuencia de escape. Solo el
  // último trozo de una línea sin terminar puede estar cortado.
  const ultimoTexto = ps.map((p) => !p.escape).lastIndexOf(true)
  return ps.map((p, i) => (p.escape ? p.s : pintarTramos(p.s, completa || i !== ultimoTexto))).join('')
}

function pintarTramos(texto: string, completo: boolean): string {
  const tramos = completo ? tramosDe(texto) : tramosDe(texto + PEGADA).filter((t) => t.hasta < texto.length)
  if (tramos.length === 0) return texto
  let out = ''
  let i = 0
  for (const t of tramos) {
    out += texto.slice(i, t.desde) + t.abre + texto.slice(t.desde, t.hasta) + t.cierra
    i = t.hasta
  }
  return out + texto.slice(i)
}

/**
 * Lo que una terminal arrastra de un trozo al siguiente. Se sigue en el propio flujo y no en el búfer
 * de xterm, que va por detrás de lo que aún está en cola.
 */
export interface EstadoResaltado {
  /** En la pantalla alternativa: no se pinta nada. */
  alternativa: boolean
  /** El programa dejó un color o estilo encendido: sus líneas siguientes ya van coloreadas. */
  colorDelPrograma: boolean
  /** El trozo anterior acabó a media línea (o a media secuencia): su continuación no se pinta. */
  lineaAbierta: boolean
}

export function estadoInicial(): EstadoResaltado {
  return { alternativa: false, colorDelPrograma: false, lineaAbierta: false }
}

/** Recorre las secuencias de un tramo y deja en `estado` la pantalla y el color con que acaba. */
function seguirEstado(tramo: string, estado: EstadoResaltado): void {
  RE_ESCAPE.lastIndex = 0
  for (let m = RE_ESCAPE.exec(tramo); m !== null; m = RE_ESCAPE.exec(tramo)) {
    const alt = RE_ALTERNATIVA.exec(m[0])
    if (alt) estado.alternativa = alt[1] === 'h'
    else estado.colorDelPrograma = colorTrasSgr(m[0], estado.colorDelPrograma)
  }
}

/** ¿Acaba a media secuencia (un ESC sin cerrar)? */
function acabaAMediaSecuencia(tramo: string): boolean {
  const ultimo = tramo.lastIndexOf(ESC)
  if (ultimo < 0) return false
  RE_ESCAPE.lastIndex = ultimo
  const m = RE_ESCAPE.exec(tramo)
  return m === null || m.index !== ultimo || esIntroductorDeCadena(m[0])
}

/**
 * Pinta un trozo de salida del pty y deja en `estado` lo que el siguiente necesita saber. Se corta por
 * líneas visuales y cada una se pinta por su cuenta si al empezarla y al acabarla la terminal no está
 * en la pantalla alternativa ni con un color del programa encendido. La continuación de una línea que
 * quedó abierta en el trozo anterior no se pinta (su principio podría ser media secuencia).
 */
export function resaltarSalida(datos: string, estado: EstadoResaltado): string {
  const trozos = datos.split(RE_CORTE)
  let out = ''
  for (let i = 0; i < trozos.length; i++) {
    const tramo = trozos[i]
    if (i % 2 === 1) {
      seguirEstado(tramo, estado)
      out += tramo
      continue
    }
    const continuacion = i === 0 && estado.lineaAbierta
    const completa = i < trozos.length - 1
    const limpioAntes = !estado.alternativa && !estado.colorDelPrograma
    seguirEstado(tramo, estado)
    const limpioDespues = !estado.alternativa && !estado.colorDelPrograma
    out += !continuacion && limpioAntes && limpioDespues ? resaltarLinea(tramo, completa) : tramo
  }
  const ultimo = trozos[trozos.length - 1]
  estado.lineaAbierta = acabaAMediaSecuencia(datos) || ultimo.replace(RE_ESCAPE, '') !== ''
  return out
}
