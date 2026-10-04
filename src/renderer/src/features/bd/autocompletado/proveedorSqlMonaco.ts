// =============================================================================
// Proveedor de autocompletado SQL para Monaco: une el enrutador (qué consola es el
// modelo), el contexto, el catálogo y las sugerencias en lo que Monaco pinta, más la
// acción de código «Expandir columnas» y la precarga de FKs. Toda la decisión vive en
// módulos puros; `monaco` entra por parámetro y sus tipos son `import type`, así que
// `test-proveedor-sql.mts` prueba el proveedor entero bajo `node` con un Monaco falso.
// Decisiones: docs/decisiones/bd/ui-autocompletado-registro.md, docs/decisiones/bd/ui-autocompletado-espera-y-division.md
// =============================================================================

import type { CancellationToken, IDisposable, IPosition, IRange, Uri, languages } from 'monaco-editor'
import { sentenciaEnCursor, type Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { cacheMetaBd, type CacheMetaBd } from '../cacheMetaBd.ts'
import { IDS_MOTORES_SQL, descriptorSql } from '../../../../../shared/motores/index.ts'
import { analisisDe } from './analisisModelo.ts'
import { CatalogoAutocompletado, type MemoriaFallos } from './catalogoAutocompletado.ts'
import { contextoEnTexto, estrellaEn, palabraEnCursor, type Contexto, type EstrellaSelect, type PalabraCursor } from './contextoSql.ts'
import { rutaDeModelo, type RutaConsola } from './enrutadorConsolas.ts'
import { PrecargaFks, type ModeloVigilable } from './precargaFks.ts'
import {
  construirSugerencias,
  listaDeEstrella,
  pendientesDeCarga,
  pendientesDeEstrella,
  sugerenciaEstrella,
  type PendientesCarga,
  type Sugerencia,
  type TipoSugerencia
} from './sugerenciasSql.ts'

/** Tope de la espera a la caché en una pregunta. */
export const ESPERA_CATALOGO_MS = 800

/** Por encima de esto no se sugiere (el mismo tope que `MAX_ANALISIS_VIVO`). */
export const MAX_TEXTO_AUTOCOMPLETADO = 2 * 1024 * 1024

/** Lo que `lenguajesConsolaSql` lee de un descriptor (lo cumple el de `shared/motores`). */
export interface ConLenguajeConsola {
  readonly sql: { readonly lenguajeConsola: string }
}

/**
 * Los lenguajes de Monaco en los que se registra el autocompletado: `sql` (también el
 * de los `.sql` del editor de archivos, que dan `[]`) y el `sql.lenguajeConsola` de
 * CADA motor del registro, sin repetir y ORDENADOS (el orden del registro es el del
 * selector del formulario, que no tiene nada que ver con esto).
 */
export function lenguajesConsolaSql(
  // Solo los motores SQL: MongoDB y Redis no tienen `sql` ni autocompletado SQL.
  descriptores: readonly ConLenguajeConsola[] = IDS_MOTORES_SQL.map((m) => descriptorSql(m))
): string[] {
  const deMotores = new Set<string>()
  for (const d of descriptores) if (d.sql.lenguajeConsola !== 'sql') deMotores.add(d.sql.lenguajeConsola)
  return ['sql', ...Array.from(deMotores).sort()]
}

/** Lenguajes de Monaco de las consolas (ver `lenguajesConsolaSql`). */
export const LENGUAJES_SQL: readonly string[] = lenguajesConsolaSql()

/** Título de la acción de código (y del ítem de completado) sobre un `*`. */
export const TITULO_EXPANDIR = 'Expandir columnas'

export const CARACTERES_DISPARO: readonly string[] = ['.']

/** Nombre del `CompletionItemKind` de Monaco (el valor se lee del `monaco` real). */
export type NombreKind = keyof typeof languages.CompletionItemKind

/** El icono de cada tipo de sugerencia en el widget. */
export const KIND_DE_TIPO: Readonly<Record<TipoSugerencia, NombreKind>> = {
  tabla: 'Struct',
  tablaForanea: 'Struct',
  tablaVirtual: 'Struct',
  vista: 'Interface',
  vistaMaterializada: 'Interface',
  sinonimo: 'Reference',
  rutina: 'Function',
  paquete: 'Module',
  secuencia: 'Constant',
  tipoObjeto: 'Class',
  tipoColeccion: 'Class',
  tipo: 'Class',
  disparador: 'Event',
  columna: 'Field',
  palabraClave: 'Keyword',
  esquema: 'Folder',
  join: 'Struct',
  condicion: 'Operator',
  expandir: 'Snippet'
}

/**
 * Lo que el proveedor usa de `monaco` (lo cumple el de verdad; el test pasa uno falso).
 * Las acciones de código y los modelos son opcionales: un Monaco falso sin ellos
 * registra solo el completado.
 */
export interface MonacoAutocompletado {
  languages: {
    registerCompletionItemProvider(lenguaje: string, proveedor: languages.CompletionItemProvider): IDisposable
    CompletionItemKind: typeof languages.CompletionItemKind
    registerCodeActionProvider?(lenguaje: string, proveedor: languages.CodeActionProvider): IDisposable
  }
  editor?: {
    getModels(): ModeloVigilable[]
    onDidCreateModel(cb: (modelo: ModeloVigilable) => void): IDisposable
  }
}

/** Lo que el proveedor usa del modelo (lo cumple `editor.ITextModel`). */
export interface ModeloSql {
  readonly uri: { toString(): string }
  isDisposed(): boolean
  getVersionId(): number
  getValue(): string
  getValueLength(): number
  getOffsetAt(posicion: IPosition): number
}

/** Lo que se usa del token de cancelación (lo cumple el `CancellationToken` de Monaco). */
export interface TokenCancelacion {
  readonly isCancellationRequested: boolean
  onCancellationRequested?: (cb: () => void) => { dispose(): void }
}

export interface OpcionesProveedorSql {
  /** La caché del catálogo. Función: se resuelve en la primera pregunta, no al registrar. */
  cache?: () => CacheMetaBd
  /** De la URI (`model.uri.toString()`) a su consola. Por defecto, el enrutador. */
  ruta?: (uri: string) => RutaConsola | null
  /** Tope de la espera a la caché. */
  esperaMs?: number
  /** Memoria de cargas fallidas (por defecto, la de la app). */
  fallos?: MemoriaFallos
  ahora?: () => number
}

// --- Traducción pura --------------------------------------------------------------------

/**
 * Rangos de la palabra bajo el cursor, en columnas de Monaco. La palabra nunca cruza
 * líneas (un identificador no lleva saltos), así que basta la posición del cursor.
 */
export function rangosDePalabra(
  p: PalabraCursor,
  offset: number,
  pos: IPosition
): { insert: IRange; replace: IRange } {
  const inicio = pos.column - (offset - p.desde)
  return {
    insert: { startLineNumber: pos.lineNumber, startColumn: inicio, endLineNumber: pos.lineNumber, endColumn: pos.column },
    replace: {
      startLineNumber: pos.lineNumber,
      startColumn: inicio,
      endLineNumber: pos.lineNumber,
      endColumn: pos.column + (p.hasta - offset)
    }
  }
}

/**
 * Rangos de un tramo `[desde, hasta)` que acaba en el cursor o lo rodea, en la MISMA
 * línea (el `*` de «Expandir columnas»); null si cruza de línea.
 */
export function rangosDeTramo(
  texto: string,
  desde: number,
  hasta: number,
  offset: number,
  pos: IPosition
): { insert: IRange; replace: IRange } | null {
  if (/[\r\n]/.test(texto.slice(Math.min(desde, offset), Math.max(hasta, offset)))) return null
  const r: IRange = {
    startLineNumber: pos.lineNumber,
    startColumn: pos.column - (offset - desde),
    endLineNumber: pos.lineNumber,
    endColumn: pos.column + (hasta - offset)
  }
  return { insert: r, replace: r }
}

/**
 * Una `Sugerencia` como ítem de Monaco. `filtro` = lo tecleado: así Monaco puntúa igual
 * todas y manda `sortText`. El espacio de `detail` va dentro porque Monaco lo pega.
 */
export function itemDeSugerencia(
  s: Sugerencia,
  kinds: typeof languages.CompletionItemKind,
  rangos: { insert: IRange; replace: IRange },
  filtro: string
): languages.CompletionItem {
  const label: languages.CompletionItemLabel = { label: s.etiqueta }
  if (s.detalle !== '') label.detail = s.detalle
  if (s.descripcion !== '') label.description = s.descripcion
  return {
    label,
    kind: kinds[KIND_DE_TIPO[s.tipo]],
    insertText: s.insertar,
    filterText: filtro,
    sortText: s.orden,
    range: rangos
  }
}

// --- Memoria de la división ---------------------------------------------------------------

// Vive en `analisisModelo.ts` para compartirla con la precarga de FKs; se reexporta
// aquí porque es parte de la superficie del proveedor (y su test la usa).
export { analisisDe }

/**
 * ¿Se calla el autocompletado en esta sentencia? Solo en los ARGUMENTOS de una
 * sentencia de cliente que no sea DESC (`DESC tabla` es posición de objeto): con el cursor aún en la
 * primera palabra, lo que se escribe puede ser SQL (`del` -> DELETE).
 */
export function silenciarCliente(s: Sentencia, texto: string, offset: number): boolean {
  if (s.clase !== 'cliente') return false
  if (/^DESC/.test(s.verbo)) return false
  for (let i = s.desde; i < offset && i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    // Un blanco entre el inicio y el cursor: ya se está en los argumentos.
    if (c === 32 || c === 9 || c === 10 || c === 13) return true
  }
  return false
}

// --- Espera con tope ----------------------------------------------------------------------

/**
 * Espera a `p` como mucho `ms`, o hasta que se cancele la pregunta. Nunca rechaza
 * (las cargas de la caché tampoco): lo que no llegó se verá en la tecla siguiente.
 */
async function esperarConTope(p: Promise<unknown>, ms: number, token: TokenCancelacion): Promise<void> {
  if (ms <= 0 || token.isCancellationRequested) return
  let temporizador: ReturnType<typeof setTimeout> | undefined
  let suscripcion: { dispose(): void } | undefined
  const corte = new Promise<void>((resolver) => {
    temporizador = setTimeout(resolver, ms)
    if (token.onCancellationRequested) suscripcion = token.onCancellationRequested(() => resolver())
  })
  try {
    await Promise.race([p.then(noop, noop), corte])
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador)
    if (suscripcion) suscripcion.dispose()
  }
}

function noop(): void {}

// --- El proveedor --------------------------------------------------------------------------

const SIN_SUGERENCIAS = (): languages.CompletionList => ({ suggestions: [] })
/** Pregunta abandonada (cancelada o sin modelo): Monaco la descarta, pero que vuelva a preguntar. */
const ABANDONADA = (): languages.CompletionList => ({ suggestions: [], incomplete: true })

/** El modelo ya partido, con la consola que lo posee. */
interface ModeloPreparado {
  ruta: RutaConsola
  texto: string
  sentencias: readonly Sentencia[]
}

/** La consola y la división del modelo, o null si no se sugiere en él (no es de consola o es enorme). */
function preparar(modelo: ModeloSql, op: OpcionesProveedorSql): ModeloPreparado | null {
  if (modelo.isDisposed()) return null
  const ruta = (op.ruta ?? rutaDeModelo)(modelo.uri.toString())
  if (!ruta || modelo.getValueLength() > MAX_TEXTO_AUTOCOMPLETADO) return null
  const { texto, sentencias } = analisisDe(modelo, ruta.dialecto)
  return { ruta, texto, sentencias }
}

/** Lo que hace falta para esperar al catálogo con un solo tope para toda la pregunta. */
interface Espera {
  limite: number
  ahora: () => number
  token: TokenCancelacion
  modelo: ModeloSql
}

function abandonada(e: Espera): boolean {
  return e.token.isCancellationRequested || e.modelo.isDisposed()
}

/** Lo que queda del tope común de la pregunta. */
function resto(e: Espera): number {
  return e.limite - e.ahora()
}

/**
 * El `*` de la lista del SELECT si el cursor está JUSTO tras él, o null. Se mira el
 * carácter antes de tokenizar: esto corre en cada tecla.
 */
function estrellaTrasCursor(ctx: Contexto, m: ModeloPreparado, offset: number): EstrellaSelect | null {
  if (ctx.tipo !== 'columnas' || m.texto.charCodeAt(offset - 1) !== 42) return null
  const e = estrellaEn(m.texto, offset, offset, m.ruta.dialecto, m.sentencias)
  return e && e.hasta === offset && e.tablas && e.tablas.length > 0 ? e : null
}

/** Los ítems de Monaco: las sugerencias y, delante, «Expandir columnas» si procede. */
function itemsDeLista(
  kinds: typeof languages.CompletionItemKind,
  ctx: Contexto,
  estrella: EstrellaSelect | null,
  fuente: CatalogoAutocompletado,
  m: ModeloPreparado,
  offset: number,
  posicion: IPosition
): languages.CompletionItem[] {
  const d = m.ruta.dialecto
  const opSug = { dialecto: d, alias: m.ruta.alias }
  const sugerencias = construirSugerencias(ctx, fuente, opSug)
  const palabra = palabraEnCursor(m.texto, offset, d)
  const rangos = rangosDePalabra(palabra, offset, posicion)
  const items = sugerencias.map((s) => itemDeSugerencia(s, kinds, rangos, palabra.prefijo))
  const expandir = estrella ? sugerenciaEstrella(estrella, m.texto, fuente, opSug) : null
  if (expandir && expandir.rango) {
    const r = rangosDeTramo(m.texto, expandir.rango.desde, expandir.rango.hasta, offset, posicion)
    if (r) items.unshift(itemDeSugerencia(expandir, kinds, r, expandir.filtro ?? ''))
  }
  return items
}

/**
 * Las sugerencias para `modelo` en `posicion`. Separado del objeto proveedor para
 * poder llamarlo con un modelo falso.
 */
export async function sugerirEnModelo(
  kinds: typeof languages.CompletionItemKind,
  modelo: ModeloSql,
  posicion: IPosition,
  token: TokenCancelacion,
  op: OpcionesProveedorSql = {}
): Promise<languages.CompletionList> {
  const m = preparar(modelo, op)
  if (!m) return SIN_SUGERENCIAS()
  const d = m.ruta.dialecto
  const offset = modelo.getOffsetAt(posicion)
  const bajoCursor = sentenciaEnCursor(m.sentencias, m.texto, offset)
  if (bajoCursor && silenciarCliente(bajoCursor, m.texto, offset)) return SIN_SUGERENCIAS()
  const ctx = contextoEnTexto(m.texto, offset, d, m.sentencias)
  if (ctx.tipo === 'ninguno') return SIN_SUGERENCIAS()
  const estrella = estrellaTrasCursor(ctx, m, offset)

  const fuente = new CatalogoAutocompletado((op.cache ?? cacheMetaBd)(), m.ruta, op.fallos)
  // Las cargas de base se disparan siempre; en posición de palabra clave no se espera.
  const base = fuente.cargarBase()
  if (ctx.tipo !== 'palabrasClave') {
    const ahora = op.ahora ?? Date.now
    const espera: Espera = { limite: ahora() + (op.esperaMs ?? ESPERA_CATALOGO_MS), ahora, token, modelo }
    // Las esperas van AQUÍ y no en una función `async` aparte: sería un turno más entre
    // la última comprobación de `abandonada` y leer el catálogo.
    await esperarConTope(base, resto(espera), token)
    if (abandonada(espera)) return ABANDONADA()
    const pendientes = pendientesDeCarga(ctx, fuente, d)
    if (estrella) unirPendientes(pendientes, pendientesDeEstrella(estrella, fuente, d))
    if (hayPendientes(pendientes)) {
      await esperarConTope(fuente.cargarPendientes(pendientes), resto(espera), token)
      if (abandonada(espera)) return ABANDONADA()
    }
  }
  return { suggestions: itemsDeLista(kinds, ctx, estrella, fuente, m, offset, posicion), incomplete: true }
}

function hayPendientes(p: PendientesCarga): boolean {
  return p.columnas.length > 0 || p.esquemas.length > 0 || p.fks.length > 0
}

/** Añade a `a` lo de `b` que no tenga ya. */
function unirPendientes(a: PendientesCarga, b: PendientesCarga): void {
  for (const x of b.columnas) if (!a.columnas.some((y) => y.esquema === x.esquema && y.tabla === x.tabla)) a.columnas.push(x)
  for (const x of b.esquemas) if (a.esquemas.indexOf(x) < 0) a.esquemas.push(x)
  for (const x of b.fks) if (!a.fks.some((y) => y.esquema === x.esquema && y.tabla === x.tabla)) a.fks.push(x)
}

// --- Acción de código: «Expandir columnas» ------------------------------------------------

/** Lo que la acción usa del modelo (lo cumple `editor.ITextModel`). */
export interface ModeloAcciones extends ModeloSql {
  readonly uri: Uri
  getPositionAt(offset: number): IPosition
}

const SIN_ACCIONES = (): languages.CodeActionList => ({ actions: [], dispose: noop })

/**
 * Las acciones de código para `rango` (la selección o el cursor): «Expandir columnas»
 * si toca el `*` de la lista de un SELECT y se conocen TODAS sus columnas (con el
 * mismo tope de espera que el completado). Separado del proveedor para probarlo con
 * un modelo falso.
 */
export async function accionesEnModelo(
  modelo: ModeloAcciones,
  rango: IRange,
  token: TokenCancelacion,
  op: OpcionesProveedorSql = {}
): Promise<languages.CodeActionList> {
  const m = preparar(modelo, op)
  if (!m) return SIN_ACCIONES()
  const estrella = estrellaEnRango(modelo, rango, m)
  if (!estrella) return SIN_ACCIONES()
  const d = m.ruta.dialecto
  const version = modelo.getVersionId()

  const fuente = new CatalogoAutocompletado((op.cache ?? cacheMetaBd)(), m.ruta, op.fallos)
  const ahora = op.ahora ?? Date.now
  const espera: Espera = { limite: ahora() + (op.esperaMs ?? ESPERA_CATALOGO_MS), ahora, token, modelo }
  await esperarConTope(fuente.cargarBase(), resto(espera), token)
  if (abandonada(espera)) return SIN_ACCIONES()
  const pendientes = pendientesDeEstrella(estrella, fuente, d)
  if (hayPendientes(pendientes)) {
    await esperarConTope(fuente.cargarPendientes(pendientes), resto(espera), token)
    if (abandonada(espera)) return SIN_ACCIONES()
  }
  const lista = listaDeEstrella(estrella, fuente, d)
  if (lista === null) return SIN_ACCIONES()
  return accionExpandir(modelo, estrella, version, lista)
}

/** El `*` sustituible que toca `rango`, o null. */
function estrellaEnRango(modelo: ModeloAcciones, rango: IRange, m: ModeloPreparado): EstrellaSelect | null {
  const desde = modelo.getOffsetAt({ lineNumber: rango.startLineNumber, column: rango.startColumn })
  const hasta = modelo.getOffsetAt({ lineNumber: rango.endLineNumber, column: rango.endColumn })
  // Monaco pregunta en cada movimiento del cursor (la bombilla): sin un `*` que lo toque,
  // no se tokeniza nada.
  if (m.texto.slice(Math.max(0, desde - 1), hasta + 1).indexOf('*') < 0) return null
  const estrella = estrellaEn(m.texto, desde, hasta, m.ruta.dialecto, m.sentencias)
  return estrella && estrella.tablas && estrella.tablas.length > 0 ? estrella : null
}

/** La acción que sustituye el `*` por `lista`, atada a `version` (Monaco la rechaza si cambió). */
function accionExpandir(modelo: ModeloAcciones, estrella: EstrellaSelect, version: number, lista: string): languages.CodeActionList {
  const a = modelo.getPositionAt(estrella.desde)
  const b = modelo.getPositionAt(estrella.hasta)
  return {
    actions: [
      {
        title: TITULO_EXPANDIR,
        kind: 'refactor.rewrite',
        isPreferred: true,
        edit: {
          edits: [
            {
              resource: modelo.uri,
              versionId: version,
              textEdit: {
                range: { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column },
                text: lista
              }
            }
          ]
        }
      }
    ],
    dispose: noop
  }
}

/** El proveedor de acciones de código (uno para todos los lenguajes SQL). */
export function crearAccionesSql(op: OpcionesProveedorSql = {}): languages.CodeActionProvider {
  return {
    provideCodeActions: (model, range, _context, token: CancellationToken) => accionesEnModelo(model, range, token, op)
  }
}

/** El objeto proveedor de Monaco (uno para todos los lenguajes SQL). */
export function crearProveedorSql(
  monaco: MonacoAutocompletado,
  op: OpcionesProveedorSql = {}
): languages.CompletionItemProvider {
  return {
    triggerCharacters: [...CARACTERES_DISPARO],
    provideCompletionItems: (model, position, _context, token: CancellationToken) =>
      sugerirEnModelo(monaco.languages.CompletionItemKind, model, position, token, op)
  }
}

const registrados = new WeakSet<object>()

/**
 * Registra el autocompletado de las consolas en `LENGUAJES_SQL` (hoy `sql`, `pgsql` y
 * `tessera-oracle-sql`), con la acción de código «Expandir columnas» y la precarga de FKs
 * si el Monaco las trae, UNA vez por instancia de Monaco. Se puede llamar cada vez que se crea un
 * editor de consola.
 */
export function asegurarAutocompletadoSql(monaco: MonacoAutocompletado, op: OpcionesProveedorSql = {}): void {
  if (registrados.has(monaco)) return
  registrados.add(monaco)
  const proveedor = crearProveedorSql(monaco, op)
  const acciones = crearAccionesSql(op)
  for (const lenguaje of LENGUAJES_SQL) {
    monaco.languages.registerCompletionItemProvider(lenguaje, proveedor)
    monaco.languages.registerCodeActionProvider?.(lenguaje, acciones)
  }
  const editor = monaco.editor
  if (editor) {
    const precarga = new PrecargaFks({
      cache: op.cache ?? cacheMetaBd,
      ...(op.ruta ? { ruta: op.ruta } : {}),
      ...(op.fallos ? { fallos: op.fallos } : {})
    })
    for (const m of editor.getModels()) precarga.vigilar(m)
    editor.onDidCreateModel((m) => precarga.vigilar(m))
  }
}
