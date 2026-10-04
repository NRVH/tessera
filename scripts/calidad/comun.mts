// =============================================================================
// Piezas comunes de las guardias de calidad (test-cabeceras, -menciones, -comentarios, -ciclos):
// argumentos, ámbito de archivos, extracción de comentarios e informe hr/check/VEREDICTO.
// Los comentarios salen del parser de `typescript` (también los `{/* */}` de JSX); los de
// CSS, de los `.css` y de los literales de `estilos*.ts` y `estilos/*.ts`, con un extractor
// de `/* */`.
// El ámbito es lo que ve git (versionado o sin ignorar) menos lo que no es fuente nuestro.
// =============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Raíz del repo, desde este archivo (`scripts/calidad/`). */
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Extensiones de código: todas llevan cabecera. */
export const EXT_CODIGO = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/

/** Código más hojas de estilo: lo que miran las guardias de comentarios y menciones. */
export const EXT_CODIGO_Y_CSS = /\.(ts|tsx|mts|cts|mjs|cjs|js|css)$/

/** Carpetas que no son fuente nuestro aunque git las vea. */
const FUERA = /^(node_modules|out|dist|spikes|vendor|\.tessera|release|resources)\//

export interface Opciones {
  detalle: boolean
  rutas: string[]
  json: string | null
  privados: string | null
}

const USO = 'uso: [--detalle] [--json <salida>] [--privados <archivo>] [--] [rutas…]'

/** Un argumento que no se entiende corta la guardia con salida 2, en vez de tomarse por ruta. */
function abortar(motivo: string): never {
  console.error(`${motivo}\n${USO}`)
  process.exit(2)
}

/** El valor de una opción que lo exige (`--json x`): falta si no hay o si es otra opción. */
function valorDe(argv: string[], i: number): string {
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('-')) abortar(`${argv[i]} necesita un valor`)
  return v
}

/**
 * `--detalle`, `--json <salida>`, `--privados <archivo>` y rutas sueltas. `--estricto` se
 * acepta y no hace nada: antes activaba el fallo ante hallazgos, que ya es el comportamiento.
 */
export function leerArgumentos(argv: string[]): Opciones {
  const op: Opciones = { detalle: false, rutas: [], json: null, privados: null }
  let soloRutas = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (soloRutas || !a.startsWith('-')) op.rutas.push(normalizarRuta(a))
    else if (a === '--') soloRutas = true
    else if (a === '--estricto') continue
    else if (a === '--detalle') op.detalle = true
    else if (a === '--json') op.json = valorDe(argv, i++)
    else if (a === '--privados') op.privados = valorDe(argv, i++)
    else abortar(`opción desconocida: ${a}`)
  }
  op.privados ??= process.env.TESSERA_PATRONES_PRIVADOS || null
  return op
}

function normalizarRuta(r: string): string {
  const rel = path.relative(RAIZ, path.resolve(r)).replace(/\\/g, '/')
  return rel === '' ? '.' : rel.replace(/\/$/, '')
}

function dentroDe(archivo: string, rutas: string[]): boolean {
  if (rutas.length === 0) return true
  return rutas.some((r) => r === '.' || archivo === r || archivo.startsWith(r + '/'))
}

/** Archivos del ámbito (rutas relativas con `/`) que casan `ext` y están bajo `rutas`. */
export function archivosDelAmbito(ext: RegExp, rutas: string[]): string[] {
  const salida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const vistos = new Set<string>()
  for (const f of salida.split('\0')) {
    if (!f || !ext.test(f) || FUERA.test(f) || !dentroDe(f, rutas)) continue
    if (existsSync(path.join(RAIZ, f))) vistos.add(f)
  }
  return [...vistos].sort()
}

export function leer(archivo: string): string {
  return readFileSync(path.join(RAIZ, archivo), 'utf8')
}

export interface Comentario {
  /** Líneas 1-based, inclusivas. */
  inicio: number
  fin: number
  texto: string
  /** `jsdoc`: un `/** *\/` que documenta una declaración; cualquier otro `/* *\/` es `bloque`. */
  tipo: 'linea' | 'bloque' | 'jsdoc'
  /** Nada más que espacio (o la `{` de JSX) antes del comentario en su línea. */
  propioRenglon: boolean
}

/** Tipos de nodo cuyo texto NO es código: un `//` dentro no es un comentario. */
const LITERALES = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral
])

const PLANTILLAS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail
])

/** Declaraciones que un `/** *\/` puede documentar: solo delante de ellas cuenta como JSDoc. */
const DECLARACIONES = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.IndexSignature,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.ExportDeclaration
])

const ES_JSDOC = /^\/\*\*(?!\/)/

/** `module.exports… =` o `exports.x =`: la forma de declarar un export en CommonJS. */
function esExportCommonJs(n: ts.Node, sf: ts.SourceFile): boolean {
  if (!ts.isExpressionStatement(n) || !ts.isBinaryExpression(n.expression)) return false
  if (n.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false
  return /^(module\.exports|exports)\b/.test(n.expression.left.getText(sf))
}

/**
 * El JSDoc de una declaración: el último `/** *\/` de sus comentarios iniciales, con solo
 * comentarios `//` (directivas) entre él y la declaración. Devuelve su posición o null.
 */
function jsdocDe(texto: string, n: ts.Node, sf: ts.SourceFile): number | null {
  if (!DECLARACIONES.has(n.kind) && !esExportCommonJs(n, sf)) return null
  const previos = ts.getLeadingCommentRanges(texto, n.pos) ?? []
  for (let i = previos.length - 1; i >= 0; i--) {
    const r = previos[i]
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) continue
    return ES_JSDOC.test(texto.slice(r.pos, r.end)) ? r.pos : null
  }
  return null
}

function tipoDeScript(archivo: string): ts.ScriptKind {
  if (archivo.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (/\.(m|c)?js$/.test(archivo)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

interface Tramo {
  desde: number
  hasta: number
}

/**
 * Recorre nodos y tokens y junta los rangos de comentario, los tramos de literal y las
 * posiciones de los `/** *\/` que documentan una declaración (el JSDoc de verdad).
 */
function rangosTs(archivo: string, texto: string) {
  const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, tipoDeScript(archivo))
  const rangos = new Map<number, ts.CommentRange>()
  const literales: Tramo[] = []
  const plantillas: Tramo[] = []
  const jsdocs = new Set<number>()
  const visitar = (n: ts.Node): void => {
    if (LITERALES.has(n.kind)) {
      const tramo = { desde: n.getStart(sf), hasta: n.end }
      literales.push(tramo)
      if (PLANTILLAS.has(n.kind)) plantillas.push(tramo)
    }
    const doc = jsdocDe(texto, n, sf)
    if (doc !== null) jsdocs.add(doc)
    for (const r of ts.getLeadingCommentRanges(texto, n.pos) ?? []) rangos.set(r.pos, r)
    for (const r of ts.getTrailingCommentRanges(texto, n.end) ?? []) rangos.set(r.pos, r)
    for (const h of n.getChildren(sf)) visitar(h)
  }
  visitar(sf)
  const fuera = (r: ts.CommentRange) => !literales.some((t) => r.pos >= t.desde && r.pos < t.hasta)
  return { rangos: [...rangos.values()].filter(fuera).sort((a, b) => a.pos - b.pos), plantillas, jsdocs }
}

/** Línea 0-based de una posición, por búsqueda binaria sobre los saltos de línea. */
function indiceDeLineas(texto: string): (p: number) => number {
  const saltos: number[] = []
  for (let i = texto.indexOf('\n'); i !== -1; i = texto.indexOf('\n', i + 1)) saltos.push(i)
  return (p) => {
    let lo = 0
    let hi = saltos.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (saltos[m] < p) lo = m + 1
      else hi = m
    }
    return lo
  }
}

function aComentario(
  texto: string,
  lineaDe: (p: number) => number,
  desde: number,
  hasta: number,
  tipo: Comentario['tipo']
): Comentario {
  const contenido = texto.slice(desde, hasta)
  const inicioLinea = texto.lastIndexOf('\n', desde - 1) + 1
  const previo = texto.slice(inicioLinea, desde)
  return {
    inicio: lineaDe(desde) + 1,
    fin: lineaDe(hasta) + 1,
    texto: contenido,
    tipo,
    propioRenglon: /^\s*\{?\s*$/.test(previo)
  }
}

/** Comentarios `/* … *\/` de CSS dentro de [desde, hasta). */
function comentariosCss(texto: string, lineaDe: (p: number) => number, desde = 0, hasta = texto.length): Comentario[] {
  const fuera: Comentario[] = []
  const re = /\/\*[\s\S]*?\*\//g
  re.lastIndex = desde
  for (let m = re.exec(texto); m && m.index < hasta; m = re.exec(texto)) {
    fuera.push(aComentario(texto, lineaDe, m.index, m.index + m[0].length, 'bloque'))
  }
  return fuera
}

/** Todos los comentarios de un archivo, en orden. */
export function extraerComentarios(archivo: string, texto: string): Comentario[] {
  const lineaDe = indiceDeLineas(texto)
  if (archivo.endsWith('.css')) return comentariosCss(texto, lineaDe)
  const { rangos, plantillas, jsdocs } = rangosTs(archivo, texto)
  const tipoDe = (r: ts.CommentRange): Comentario['tipo'] =>
    r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'linea' : jsdocs.has(r.pos) ? 'jsdoc' : 'bloque'
  const lista = rangos.map((r) => aComentario(texto, lineaDe, r.pos, r.end, tipoDe(r)))
  if (/(^|\/)estilos([^/]*|\/[^/]+)\.ts$/.test(archivo)) {
    for (const t of plantillas) lista.push(...comentariosCss(texto, lineaDe, t.desde, t.hasta))
  }
  return lista.sort((a, b) => a.inicio - b.inicio)
}

/** Una línea de delimitador de cabecera: `// ====…` (diez o más `=`). */
export const DELIMITADOR = /^\/\/\s?={10,}\s*$/

export interface Hallazgo {
  archivo: string
  linea: number
  clase: string
  detalle: string
}

// ---------------------------------------------------------------------------
// Informe (molde de las pruebas del repo)
// ---------------------------------------------------------------------------
export function hr(titulo: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(titulo)
  console.log('='.repeat(78))
}

interface Resultado {
  nombre: string
  pasa: boolean
  evidencia: string
}
const resultados: Resultado[] = []

export function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
}

/** Lista los hallazgos: todos con rutas o `--detalle`; si no, los 25 primeros. */
export function informar(hallazgos: Hallazgo[], op: Opciones): void {
  const todos = op.detalle || op.rutas.length > 0
  const lista = todos ? hallazgos : hallazgos.slice(0, 25)
  for (const h of lista) console.log(`  ${h.archivo}:${h.linea}  [${h.clase}] ${h.detalle}`)
  if (lista.length < hallazgos.length) {
    console.log(`  … y ${hallazgos.length - lista.length} más (--detalle o una ruta para verlos todos)`)
  }
  const porArchivo = new Set(hallazgos.map((h) => h.archivo)).size
  console.log(`\n  ${hallazgos.length} hallazgo(s) en ${porArchivo} archivo(s)`)
}

/**
 * Escribe el JSON de `--json` y cierra con el VEREDICTO; sale 1 solo si algo falla. `aviso` se
 * añade al VEREDICTO cuando pasar no garantiza nada (una guardia que no ha buscado).
 */
export function cerrar(guardia: string, archivos: number, hallazgos: Hallazgo[], op: Opciones, aviso?: string): void {
  if (op.json) writeFileSync(op.json, JSON.stringify({ guardia, archivos, hallazgos }, null, 1))
  check('ningún hallazgo en el ámbito', hallazgos.length === 0, `${hallazgos.length} hallazgo(s)`)
  hr('RESULTADO (PASS/FAIL)')
  for (const r of resultados) {
    console.log(`${r.pasa ? 'PASS' : 'FAIL'}  ${r.nombre}`)
    console.log(`      -> ${r.evidencia}`)
  }
  const pasan = resultados.filter((r) => r.pasa).length
  const todo = pasan === resultados.length
  hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}${aviso ? ` — ${aviso}` : ''}`)
  process.exit(todo ? 0 : 1)
}
