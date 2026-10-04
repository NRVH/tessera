#!/usr/bin/env node
// =============================================================================
// Prueba del proveedor de autocompletado SQL de Monaco, de su catálogo y de la
// precarga de FKs, ENTEROS: un Monaco falso que solo registra, modelos falsos con
// versión y la caché REAL (`CacheMetaBd`) sobre una API del main falsa que cuenta los
// viajes. Fija la costura: qué se carga, cuándo se espera y cómo sale cada sugerencia.
// (npm run test:db-autocompletado-proveedor)
// Decisiones: docs/decisiones/bd/ui-autocompletado-registro.md
// =============================================================================

import { CacheMetaBd, type ApiCatalogoBd } from '../cacheMetaBd.ts'
import { CatalogoAutocompletado, MemoriaFallos } from './catalogoAutocompletado.ts'
import { registrarRutaConsola, uriConsola, type RutaConsola } from './enrutadorConsolas.ts'
import { PrecargaFks, precargarFks, type EventoCambioModelo, type ModeloVigilable } from './precargaFks.ts'
import {
  KIND_DE_TIPO,
  LENGUAJES_SQL,
  MAX_TEXTO_AUTOCOMPLETADO,
  TITULO_EXPANDIR,
  accionesEnModelo,
  analisisDe,
  asegurarAutocompletadoSql,
  lenguajesConsolaSql,
  sugerirEnModelo,
  type ConLenguajeConsola,
  type ModeloAcciones,
  type ModeloSql,
  type MonacoAutocompletado,
  type OpcionesProveedorSql,
  type TokenCancelacion
} from './proveedorSqlMonaco.ts'
import type {
  DbColumnaInfo,
  DbEsquemasRespuesta,
  DbIndiceNombres,
  DbRefObjeto,
  DbRelacionesFk,
  DbRespuesta,
  DbTipoObjeto
} from '../../../../../shared/db-explorador-ipc.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { IDS_MOTORES_SQL, descriptorSql } from '../../../../../shared/motores/index.ts'
import type { CancellationToken, IPosition, IRange, Uri, editor, languages } from 'monaco-editor'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

// --- Monaco falso -------------------------------------------------------------------------

/** Los valores reales de `languages.CompletionItemKind` (monaco 0.52). */
const KINDS = {
  Method: 0,
  Function: 1,
  Constructor: 2,
  Field: 3,
  Variable: 4,
  Class: 5,
  Struct: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Event: 10,
  Operator: 11,
  Unit: 12,
  Value: 13,
  Constant: 14,
  Enum: 15,
  EnumMember: 16,
  Keyword: 17,
  Text: 18,
  Color: 19,
  File: 20,
  Reference: 21,
  Customcolor: 22,
  Folder: 23,
  TypeParameter: 24,
  User: 25,
  Issue: 26,
  Snippet: 27
}
const kinds = KINDS as unknown as typeof languages.CompletionItemKind

interface Registro {
  lenguaje: string
  proveedor: languages.CompletionItemProvider
}
function monacoFalso(): { monaco: MonacoAutocompletado; registros: Registro[]; acciones: string[] } {
  const registros: Registro[] = []
  const acciones: string[] = []
  const monaco = {
    languages: {
      CompletionItemKind: kinds,
      registerCompletionItemProvider: (lenguaje: string, proveedor: languages.CompletionItemProvider) => {
        registros.push({ lenguaje, proveedor })
        return { dispose: (): void => {} }
      },
      registerCodeActionProvider: (lenguaje: string) => {
        acciones.push(lenguaje)
        return { dispose: (): void => {} }
      }
    }
  }
  return { monaco, registros, acciones }
}

// --- Modelo falso -------------------------------------------------------------------------

/** Separa el texto en el marcador del cursor (`¦`). */
function conCursor(conMarca: string): { texto: string; offset: number } {
  const offset = conMarca.indexOf('¦')
  return { texto: conMarca.slice(0, offset) + conMarca.slice(offset + 1), offset }
}

function posicionDe(texto: string, offset: number): IPosition {
  const antes = texto.slice(0, offset).split('\n')
  return { lineNumber: antes.length, column: antes[antes.length - 1].length + 1 }
}

interface ModeloFalso extends ModeloSql {
  cambiar(t: string): void
  lecturas(): number
  largo: number | null
  getPositionAt(o: number): IPosition
}
function modeloFalso(texto: string, uri: string): ModeloFalso {
  let version = 1
  let lecturas = 0
  const m: ModeloFalso = {
    uri: { toString: () => uri },
    getPositionAt: (o: number) => posicionDe(texto, o),
    isDisposed: () => false,
    getVersionId: () => version,
    getValue: () => {
      lecturas++
      return texto
    },
    getValueLength: () => (m.largo !== null ? m.largo : texto.length),
    getOffsetAt: (p: IPosition) => {
      const lineas = texto.split('\n')
      let o = 0
      for (let i = 0; i < p.lineNumber - 1; i++) o += lineas[i].length + 1
      return o + p.column - 1
    },
    cambiar: (t: string) => {
      texto = t
      version++
    },
    lecturas: () => lecturas,
    largo: null
  }
  return m
}

const TOKEN: TokenCancelacion = { isCancellationRequested: false }

// --- API del main falsa -------------------------------------------------------------------

interface Catalogo {
  porDefecto: string
  /** Todos los esquemas (la M); los visibles se indexan siempre. */
  esquemas: Array<{ nombre: string; pseudo?: boolean }>
  visibles: string[]
  objetos: Record<string, Array<[string, DbTipoObjeto]>>
  /** 'ESQ.NOMBRE' -> columnas. */
  columnas: Record<string, DbColumnaInfo[]>
  /** 'ESQ.NOMBRE' -> destino. */
  sinonimos: Record<string, DbRefObjeto>
  publicos: string[]
  /** 'ESQ.TABLA' -> claves ajenas; sin entrada, ninguna. */
  fks?: Record<string, DbRelacionesFk>
}

interface Llamada {
  canal: string
  args: unknown[]
}

interface Falsa {
  api: ApiCatalogoBd
  llamadas: Llamada[]
  de(canal: string): Llamada[]
  /** Canales cuyas respuestas se retienen hasta `soltar()`. */
  colgar: Set<string>
  soltar(): void
  /** Canales que responden con error. */
  fallar: Set<string>
}

const col = (nombre: string, posicion: number): DbColumnaInfo => ({ nombre, posicion, tipo: 'x', nullable: true, pk: null })

function falsa(cat: Catalogo): Falsa {
  const llamadas: Llamada[] = []
  const colgar = new Set<string>()
  const fallar = new Set<string>()
  let retenidas: Array<() => void> = []
  function responder<T>(canal: string, args: unknown[], valor: () => T): Promise<DbRespuesta<T>> {
    llamadas.push({ canal, args })
    const r = (): DbRespuesta<T> =>
      fallar.has(canal) ? { ok: false, error: { motivo: 'servidor', mensaje: 'ORA-12170: TNS:Connect timeout' } } : { ok: true, valor: valor() }
    if (!colgar.has(canal)) return Promise.resolve(r())
    return new Promise((res) => retenidas.push(() => res(r())))
  }
  const indice = (actual: string | null | undefined): DbIndiceNombres => {
    const esquemas = [...cat.visibles]
    if (actual && cat.objetos[actual] && esquemas.indexOf(actual) < 0) esquemas.push(actual)
    const objetos: DbIndiceNombres['objetos'] = []
    esquemas.forEach((e, i) => {
      for (const [nombre, tipo] of cat.objetos[e] ?? []) objetos.push([nombre, i, tipo])
    })
    return { esquemas, objetos, porDefecto: actual ?? cat.porDefecto }
  }
  const api: ApiCatalogoBd = {
    esquemas: (...a) =>
      responder('esquemas', a, (): DbEsquemasRespuesta => ({
        esquemas: cat.esquemas.map((e) => ({
          nombre: e.nombre,
          sistema: false,
          visible: cat.visibles.indexOf(e.nombre) >= 0,
          porDefecto: e.nombre === cat.porDefecto,
          pseudo: e.pseudo
        })),
        porDefecto: cat.porDefecto,
        config: { modo: 'todos' },
        nVisibles: cat.visibles.length
      })),
    bases: (...a) =>
      responder('bases', a, () => ({ bases: [], porDefecto: '', config: { modo: 'todos' as const }, nVisibles: 0 })),
    resumen: (...a) => responder('resumen', a, () => ({})),
    objetos: (...a) => responder('objetos', a, () => []),
    detalle: (...a) =>
      responder('detalle', a, () => {
        const o = a[1] as DbRefObjeto
        return { columnas: cat.columnas[`${o.esquema}.${o.nombre}`] ?? [] }
      }),
    resolver: (...a) =>
      responder('resolver', a, () => {
        const destino = cat.sinonimos[`${a[1] as string}.${a[2] as string}`]
        if (!destino) throw new Error('sinónimo desconocido en la prueba')
        return destino
      }),
    nombres: (...a) => responder('nombres', a, () => indice(a[1] as string | null | undefined)),
    nombresPublicos: (...a) => responder('publicos', a, () => [...cat.publicos]),
    fks: (...a) =>
      responder('fks', a, (): DbRelacionesFk => {
        const o = a[1] as DbRefObjeto
        return cat.fks?.[`${o.esquema}.${o.nombre}`] ?? { salientes: [], entrantes: [] }
      }),
    onCatalogo: () => () => {}
  }
  return {
    api,
    llamadas,
    de: (canal) => llamadas.filter((l) => l.canal === canal),
    colgar,
    fallar,
    soltar: () => {
      const r = retenidas
      retenidas = []
      colgar.clear()
      for (const f of r) f()
    }
  }
}

// --- Catálogos de ejemplo -----------------------------------------------------------------

const PG: Catalogo = {
  porDefecto: 'public',
  esquemas: [{ nombre: 'public' }, { nombre: 'ventas' }, { nombre: 'pg_catalog' }],
  visibles: ['public', 'ventas'],
  objetos: {
    public: [
      ['profile', 'tabla'],
      ['users', 'tabla'],
      ['proc_limpiar', 'rutina']
    ],
    ventas: [
      ['productos', 'tabla'],
      ['v_pedidos', 'vista']
    ]
  },
  columnas: {},
  sinonimos: {},
  publicos: []
}

const ORA: Catalogo = {
  porDefecto: 'SCOTT',
  esquemas: [{ nombre: 'SCOTT' }, { nombre: 'HR' }, { nombre: 'SYS' }, { nombre: 'PUBLIC', pseudo: true }],
  visibles: ['SCOTT'],
  objetos: {
    SCOTT: [
      ['EMP', 'tabla'],
      ['DEPT', 'tabla'],
      ['EMP_S', 'sinonimo'],
      ['PKG_NOMINA', 'paquete']
    ],
    HR: [
      ['EMPLOYEES', 'tabla'],
      ['JOBS', 'tabla']
    ],
    SYS: [['ALL_USERS', 'vista']]
  },
  columnas: {
    // Desordenadas a propósito: se ofrecen por `posicion`.
    'SCOTT.EMP': [col('DEPTNO', 3), col('EMPNO', 1), col('ENAME', 2)],
    'SYS.ALL_USERS': [col('USERNAME', 1), col('USER_ID', 2)]
  },
  sinonimos: {
    'PUBLIC.ALL_USERS': { esquema: 'SYS', nombre: 'ALL_USERS', tipo: 'vista' },
    'SCOTT.EMP_S': { esquema: 'SCOTT', nombre: 'EMP', tipo: 'tabla' }
  },
  publicos: ['ALL_USERS', 'DUAL']
}

// --- Montaje de una consola ---------------------------------------------------------------

let siguienteId = 0
interface Escena {
  f: Falsa
  cache: CacheMetaBd
  modelo: ModeloFalso
  offset: number
  pos: IPosition
  op: OpcionesProveedorSql
  reloj: { t: number }
  baja: () => void
  sugerir(token?: TokenCancelacion): Promise<languages.CompletionList>
  /** Mueve el cursor a otra marca `¦` en un texto nuevo (nueva versión). */
  escribir(conMarca: string): void
}

function escena(
  cat: Catalogo,
  dialecto: DialectoSql,
  conMarca: string,
  esquemaSesion: () => string | null = () => null,
  esperaMs = 200
): Escena {
  const f = falsa(cat)
  const reloj = { t: 1_000_000 }
  const cache = new CacheMetaBd(f.api, () => reloj.t)
  const uri = uriConsola(`consola-${++siguienteId}`)
  const ruta: RutaConsola = {
    consolaId: `consola-${siguienteId}`,
    conexionId: 'cx1',
    alias: 'QA',
    dialecto,
    esquema: esquemaSesion
  }
  const baja = registrarRutaConsola(uri, ruta)
  const { texto, offset } = conCursor(conMarca)
  const modelo = modeloFalso(texto, uri)
  const op: OpcionesProveedorSql = { cache: () => cache, esperaMs, fallos: new MemoriaFallos(() => reloj.t) }
  const e: Escena = {
    f,
    cache,
    modelo,
    offset,
    pos: posicionDe(texto, offset),
    op,
    reloj,
    baja,
    sugerir: (token = TOKEN) => sugerirEnModelo(kinds, modelo, e.pos, token, op),
    escribir: (m: string) => {
      const c = conCursor(m)
      modelo.cambiar(c.texto)
      e.offset = c.offset
      e.pos = posicionDe(c.texto, c.offset)
    }
  }
  return e
}

const etiqueta = (it: languages.CompletionItem): string =>
  typeof it.label === 'string' ? it.label : it.label.label
const etiquetas = (l: languages.CompletionList): string[] => l.suggestions.map(etiqueta)
const rangoDe = (it: languages.CompletionItem): { insert: { startColumn: number; endColumn: number }; replace: { startColumn: number; endColumn: number } } =>
  it.range as { insert: { startColumn: number; endColumn: number }; replace: { startColumn: number; endColumn: number } }

async function main(): Promise<void> {
  hr('(1) registro idempotente en sql, pgsql y tessera-oracle-sql')
  const { monaco, registros, acciones } = monacoFalso()
  asegurarAutocompletadoSql(monaco)
  asegurarAutocompletadoSql(monaco)
  check(
    // También el de la consola de SQLite.
    'un registro por lenguaje, aunque se llame dos veces',
    j(registros.map((r) => r.lenguaje)) === j(['sql', 'pgsql', 'tessera-oracle-sql', 'tessera-sqlite-sql']),
    j(registros.map((r) => r.lenguaje))
  )
  check('el mismo proveedor para los tres', registros[0].proveedor === registros[1].proveedor && registros[1].proveedor === registros[2].proveedor, 'identidad')
  check('triggerCharacters = ["."]', j(registros[0].proveedor.triggerCharacters) === '["."]', j(registros[0].proveedor.triggerCharacters))
  check('y la acción de código en todos', j(acciones) === j(['sql', 'pgsql', 'tessera-oracle-sql', 'tessera-sqlite-sql']), j(acciones))
  // El lenguaje de la consola de cada motor sale de su descriptor; uno nuevo que no esté
  // en `LENGUAJES_SQL` se quedaría sin autocompletado sin que nada fallara. Solo los motores
  // SQL: MongoDB y Redis no tienen consola SQL.
  const sinRegistro = IDS_MOTORES_SQL.filter(
    (m) => !registros.some((r) => r.lenguaje === descriptorSql(m).sql.lenguajeConsola)
  )
  check('el lenguaje de la consola de CADA motor tiene su registro', sinRegistro.length === 0, j(sinRegistro))
  // La lista SALE del registro. Con un motor más
  // que traiga su lenguaje, está en la lista sin tocar el proveedor; uno que reutilice un
  // lenguaje ya presente (o `sql`) no se repite.
  const MAS: ConLenguajeConsola[] = [
    ...IDS_MOTORES_SQL.map((m) => descriptorSql(m)),
    { sql: { lenguajeConsola: 'tessera-sqlite-sql' } },
    { sql: { lenguajeConsola: 'pgsql' } },
    { sql: { lenguajeConsola: 'sql' } }
  ]
  check(
    'un motor nuevo con su lenguaje: entra, sin repetidos y sin mover los de hoy',
    j(lenguajesConsolaSql(MAS)) === j(['sql', 'pgsql', 'tessera-oracle-sql', 'tessera-sqlite-sql']),
    j(lenguajesConsolaSql(MAS))
  )
  check('LENGUAJES_SQL es lo que sale del registro', j(LENGUAJES_SQL) === j(lenguajesConsolaSql()), j(LENGUAJES_SQL))
  const otro = monacoFalso()
  asegurarAutocompletadoSql(otro.monaco)
  check('otra instancia de Monaco registra lo suyo', otro.registros.length === LENGUAJES_SQL.length, String(otro.registros.length))

  hr('(2) un .sql del editor de archivos: nada, sin tocar la caché')
  {
    // El proveedor registrado usa la caché de la app (`window.tessera`): si la tocara,
    // aquí lanzaría. Una URI ajena tiene que volver antes.
    const { texto, offset } = conCursor('select * from pro¦')
    const m = modeloFalso(texto, 'file:///proyecto/consulta.sql')
    const r = await registros[0].proveedor.provideCompletionItems(
      m as unknown as editor.ITextModel,
      posicionDe(texto, offset) as unknown as Parameters<languages.CompletionItemProvider['provideCompletionItems']>[1],
      { triggerKind: 0 } as languages.CompletionContext,
      TOKEN as CancellationToken
    )
    check('suggestions = []', !!r && r.suggestions.length === 0, j(r))
    check('sin incomplete (no hay nada que volver a pedir)', !!r && r.incomplete === undefined, String(r && r.incomplete))
    check('ni siquiera lee el texto', m.lecturas() === 0, `lecturas=${m.lecturas()}`)
  }

  hr('(3) select * from pro (PG)')
  {
    const e = escena(PG, 'postgres', 'select * from pro¦')
    const r = await e.sugerir()
    const ls = etiquetas(r)
    const primero = r.suggestions[0]
    check('profile primero, productos detrás', ls[0] === 'profile' && ls.indexOf('productos') > 0, j(ls))
    check('la rutina no sale en un FROM', ls.indexOf('proc_limpiar') < 0, j(ls))
    check(
      'label = {profile, " (public)", "QA"}',
      j(primero.label) === j({ label: 'profile', detail: ' (public)', description: 'QA' }),
      j(primero.label)
    )
    check('kind Struct', primero.kind === KINDS.Struct, String(primero.kind))
    check('filterText = lo tecleado', primero.filterText === 'pro', String(primero.filterText))
    check('sortText presente y ordena igual que la lista', r.suggestions.every((s, i) => i === 0 || (r.suggestions[i - 1].sortText ?? '') <= (s.sortText ?? '')), j(r.suggestions.map((s) => s.sortText)))
    check('insertText local sin calificar', primero.insertText === 'profile', primero.insertText)
    const prod = r.suggestions[ls.indexOf('productos')]
    check('fuera de lo local se califica', prod.insertText === 'ventas.productos' && j(prod.label).indexOf(' (ventas)') >= 0, prod.insertText)
    const rg = rangoDe(primero)
    check('rangos: de la col 15 al cursor (18)', rg.insert.startColumn === 15 && rg.insert.endColumn === 18 && rg.replace.endColumn === 18, j(rg))
    check('incomplete: true', r.incomplete === true, String(r.incomplete))
    check('una lista de esquemas y un índice (sesión null), sin públicos en PG', e.f.de('esquemas').length === 1 && e.f.de('nombres').length === 1 && e.f.de('nombres')[0].args[1] === null && e.f.de('publicos').length === 0, j(e.f.llamadas.map((l) => l.canal)))

    hr('(4) misma versión: ni relee ni viaja')
    const lecturas = e.modelo.lecturas()
    const viajes = e.f.llamadas.length
    const r2 = await e.sugerir()
    check('mismo resultado', j(etiquetas(r2)) === j(ls), j(etiquetas(r2)))
    check('el texto no se vuelve a leer', e.modelo.lecturas() === lecturas, `lecturas ${lecturas} -> ${e.modelo.lecturas()}`)
    check('ningún viaje nuevo al main', e.f.llamadas.length === viajes, `viajes ${viajes} -> ${e.f.llamadas.length}`)
    e.baja()
  }

  hr('(5) e. con el FROM detrás del cursor (Oracle, sesión SCOTT)')
  {
    const e = escena(ORA, 'oracle', 'select e.¦ from emp e', () => 'SCOTT')
    const r = await e.sugerir()
    check('columnas en el orden de la tabla', j(etiquetas(r)) === j(['EMPNO', 'ENAME', 'DEPTNO']), j(etiquetas(r)))
    check('kind Field y detalle (EMP)', r.suggestions.every((s) => s.kind === KINDS.Field) && j(r.suggestions[0].label).indexOf(' (EMP)') >= 0, j(r.suggestions[0] && r.suggestions[0].label))
    const det = e.f.de('detalle')
    check(
      'una carga: SCOTT.EMP como tabla, solo columnas',
      det.length === 1 && j(det[0].args[1]) === j({ esquema: 'SCOTT', nombre: 'EMP', tipo: 'tabla' }) && j(det[0].args[2]) === '["columnas"]',
      j(det.map((d) => d.args))
    )
    check('índice pedido con el esquema de la sesión', e.f.de('nombres')[0].args[1] === 'SCOTT', j(e.f.de('nombres').map((n) => n.args)))
    check('en Oracle se piden los públicos', e.f.de('publicos').length === 1, String(e.f.de('publicos').length))
    const rg = rangoDe(r.suggestions[0])
    check('tras el punto el rango es vacío en el cursor', rg.insert.startColumn === 10 && rg.insert.endColumn === 10, j(rg))
    e.baja()
  }

  hr('(6) sinónimo PUBLIC: columnas del destino')
  {
    const e = escena(ORA, 'oracle', 'select u.¦ from all_users u', () => 'SCOTT')
    const r = await e.sugerir()
    check('USERNAME y USER_ID', j(etiquetas(r)) === j(['USERNAME', 'USER_ID']), j(etiquetas(r)))
    const res = e.f.de('resolver')
    check('se resolvió PUBLIC.ALL_USERS', res.length === 1 && res[0].args[1] === 'PUBLIC' && res[0].args[2] === 'ALL_USERS', j(res.map((x) => x.args)))
    const det = e.f.de('detalle')
    check('columnas de SYS.ALL_USERS como vista', det.length === 1 && j(det[0].args[1]) === j({ esquema: 'SYS', nombre: 'ALL_USERS', tipo: 'vista' }), j(det.map((d) => d.args)))
    e.baja()
  }

  hr('(7) sinónimo privado: se resuelve antes de pedir columnas')
  {
    const e = escena(ORA, 'oracle', 'select x.¦ from emp_s x', () => 'SCOTT')
    const r = await e.sugerir()
    check('columnas de EMP a través de EMP_S', j(etiquetas(r)) === j(['EMPNO', 'ENAME', 'DEPTNO']), j(etiquetas(r)))
    const det = e.f.de('detalle')
    check('nunca se pidió EMP_S como tabla', det.every((d) => (d.args[1] as DbRefObjeto).nombre !== 'EMP_S'), j(det.map((d) => d.args[1])))
    e.baja()
  }

  hr('(8) HR. fuera del índice')
  {
    const e = escena(ORA, 'oracle', 'select * from HR.¦', () => 'SCOTT')
    const r = await e.sugerir()
    const ls = etiquetas(r)
    check('objetos de HR', ls.indexOf('EMPLOYEES') >= 0 && ls.indexOf('JOBS') >= 0, j(ls))
    check('sin calificar (el esquema ya está escrito)', r.suggestions.every((s) => s.insertText.indexOf('.') < 0), j(r.suggestions.map((s) => s.insertText)))
    check('nada de SCOTT', ls.indexOf('EMP') < 0, j(ls))
    const idx = e.f.de('nombres').map((n) => n.args[1])
    check('índice de la sesión y luego el de HR', j(idx) === j(['SCOTT', 'HR']), j(idx))
    e.baja()
  }

  hr('(9) tope de espera con la caché colgada')
  {
    const e = escena(PG, 'postgres', 'select * from prof¦', () => null, 60)
    e.f.colgar.add('nombres')
    const t0 = Date.now()
    const r = await e.sugerir()
    const ms = Date.now() - t0
    check('vuelve cerca del tope (60 ms), no colgada', ms >= 50 && ms < 1000, `${ms} ms`)
    check('sin objetos todavía, incomplete: true', r.suggestions.length === 0 && r.incomplete === true, j(etiquetas(r)))
    e.f.soltar()
    await new Promise((res) => setTimeout(res, 0))
    const r2 = await e.sugerir()
    check('la siguiente pregunta ya lo ve', etiquetas(r2)[0] === 'profile', j(etiquetas(r2)))
    check('y no volvió a viajar por el índice', e.f.de('nombres').length === 1, String(e.f.de('nombres').length))
    e.baja()
  }

  hr('(10) palabras clave: no espera, pero dispara la base')
  {
    const e = escena(PG, 'postgres', 'sel¦', () => null, 5000)
    e.f.colgar.add('nombres')
    e.f.colgar.add('esquemas')
    const t0 = Date.now()
    const r = await e.sugerir()
    const ms = Date.now() - t0
    check('vuelve sin esperar a la caché', ms < 1000, `${ms} ms`)
    const sel = r.suggestions.find((s) => etiqueta(s) === 'select')
    check('select en la caja tecleada, kind Keyword', !!sel && sel.kind === KINDS.Keyword && sel.insertText === 'select', j(sel && sel.label))
    check('sin descripción de conexión en las palabras clave', !!sel && typeof sel.label !== 'string' && sel.label.description === undefined, j(sel && sel.label))
    check('la base se disparó igual', e.f.de('nombres').length === 1 && e.f.de('esquemas').length === 1, j(e.f.llamadas.map((l) => l.canal)))
    e.f.soltar()
    e.baja()
  }

  hr('(11) cadena, comentario y sentencia de cliente: nada')
  {
    for (const [nombre, marca, d] of [
      ['dentro de una cadena', "select 'pro¦", 'postgres'],
      ['dentro de un comentario', 'select 1 -- pro¦', 'postgres'],
      ['argumentos de PROMPT', 'prompt pro¦', 'oracle'],
      ['argumentos de SET de SQL*Plus', 'set serveroutput o¦', 'oracle'],
      ['argumentos de \\d en PG', '\\dt pro¦', 'postgres']
    ] as const) {
      const e = escena(d === 'oracle' ? ORA : PG, d, marca)
      const r = await e.sugerir()
      check(nombre, r.suggestions.length === 0 && e.f.llamadas.length === 0, `${j(etiquetas(r))} viajes=${e.f.llamadas.length}`)
      e.baja()
    }
    // Mitades negativas: lo que el clasificador llama «cliente» pero sí se completa.
    {
      // `del` es la abreviatura de DEL de SQL*Plus para el clasificador; aquí se está
      // escribiendo DELETE.
      const e = escena(ORA, 'oracle', 'select 1 from dual;\ndel¦', () => 'SCOTT')
      const r = await e.sugerir()
      check('primera palabra de un «cliente» (del -> delete): sí sugiere', etiquetas(r).indexOf('delete') >= 0, j(etiquetas(r)))
      e.baja()
    }
    {
      const e = escena(ORA, 'oracle', 'desc em¦', () => 'SCOTT')
      const r = await e.sugerir()
      check('DESC tabla: sí sugiere objetos', etiquetas(r)[0] === 'EMP', j(etiquetas(r)))
      e.baja()
    }
  }

  hr('(12) cancelación: deja de esperar en el acto')
  {
    const e = escena(PG, 'postgres', 'select * from prof¦', () => null, 5000)
    e.f.colgar.add('nombres')
    let oyente: (() => void) | null = null
    const token: TokenCancelacion & { isCancellationRequested: boolean } = {
      isCancellationRequested: false,
      onCancellationRequested: (cb) => {
        oyente = cb
        return { dispose: () => (oyente = null) }
      }
    }
    const t0 = Date.now()
    setTimeout(() => {
      token.isCancellationRequested = true
      if (oyente) oyente()
    }, 20)
    const r = await e.sugerir(token)
    const ms = Date.now() - t0
    check('vuelve al cancelar, no a los 5 s', ms < 1000, `${ms} ms`)
    check('pregunta abandonada: [] e incomplete', r.suggestions.length === 0 && r.incomplete === true, j(r))
    check('la suscripción se soltó', oyente === null, String(oyente))
    e.f.soltar()
    e.baja()
  }

  hr('(13) memoria de fallos')
  {
    const e = escena(ORA, 'oracle', 'select e.¦ from emp e', () => 'SCOTT')
    e.f.fallar.add('detalle')
    const r1 = await e.sugerir()
    check('sin columnas si la carga falla', r1.suggestions.length === 0, j(etiquetas(r1)))
    e.escribir('select e.en¦ from emp e')
    await e.sugerir()
    check('la tecla siguiente no repite la carga', e.f.de('detalle').length === 1, String(e.f.de('detalle').length))
    e.f.fallar.delete('detalle')
    e.reloj.t += 31_000
    const r3 = await e.sugerir()
    check('pasados 30 s se reintenta', e.f.de('detalle').length === 2, String(e.f.de('detalle').length))
    check('y ya salen, filtradas por lo tecleado', j(etiquetas(r3)) === j(['ENAME']), j(etiquetas(r3)))
    e.baja()
  }

  hr('(14) en mitad de una palabra')
  {
    const e = escena(PG, 'postgres', 'select * from pr¦ofile')
    const r = await e.sugerir()
    const it = r.suggestions[0]
    const rg = rangoDe(it)
    check('filterText = hasta el cursor', it.filterText === 'pr', String(it.filterText))
    check('insert: col 15..17; replace: col 15..22', rg.insert.startColumn === 15 && rg.insert.endColumn === 17 && rg.replace.startColumn === 15 && rg.replace.endColumn === 22, j(rg))
    e.baja()
  }

  hr('(15) texto por encima del tope')
  {
    const e = escena(PG, 'postgres', 'select * from pro¦')
    e.modelo.largo = MAX_TEXTO_AUTOCOMPLETADO + 1
    const r = await e.sugerir()
    check('nada, sin leer el texto ni viajar', r.suggestions.length === 0 && e.modelo.lecturas() === 0 && e.f.llamadas.length === 0, `lecturas=${e.modelo.lecturas()} viajes=${e.f.llamadas.length}`)
    e.baja()
  }

  hr('(16) la división se memoriza por versión y dialecto')
  {
    const m = modeloFalso('select 1; select 2', 'inmemory://x')
    const a = analisisDe(m, 'oracle')
    const b = analisisDe(m, 'oracle')
    check('misma versión y dialecto: una lectura, el mismo análisis', m.lecturas() === 1 && a === b && a.sentencias.length === 2, `lecturas=${m.lecturas()}`)
    analisisDe(m, 'postgres')
    check('otro dialecto: se rehace', m.lecturas() === 2, `lecturas=${m.lecturas()}`)
    m.cambiar('select 1')
    const c = analisisDe(m, 'postgres')
    check('otra versión: se rehace', m.lecturas() === 3 && c.sentencias.length === 1, `lecturas=${m.lecturas()}`)
  }

  hr('(17) el esquema de la sesión manda')
  {
    const e = escena(PG, 'postgres', 'select * from pro¦', () => 'ventas')
    const r = await e.sugerir()
    const prod = r.suggestions.find((s) => etiqueta(s) === 'productos')
    const prof = r.suggestions.find((s) => etiqueta(s) === 'profile')
    check('índice con la sesión ventas', e.f.de('nombres')[0].args[1] === 'ventas', j(e.f.de('nombres').map((n) => n.args)))
    check('productos es local: sin calificar (en (3), sin sesión, era ventas.productos)', !!prod && prod.insertText === 'productos', String(prod && prod.insertText))
    check('public sigue siendo local en PG', !!prof && prof.insertText === 'profile', String(prof && prof.insertText))
    e.baja()
  }

  hr('(18) sesión recién abierta: mientras llega su índice, el de sin sesión')
  {
    let sesion: string | null = null
    const e = escena(ORA, 'oracle', 'select * from em¦', () => sesion, 60)
    await e.sugerir()
    sesion = 'SCOTT'
    e.f.colgar.add('nombres')
    e.escribir('select * from emp¦')
    const r = await e.sugerir()
    check('se pidió el índice de la sesión', e.f.de('nombres').map((n) => n.args[1]).indexOf('SCOTT') >= 0, j(e.f.de('nombres').map((n) => n.args[1])))
    check('y mientras tanto se sugiere con el de sin sesión', etiquetas(r)[0] === 'EMP', j(etiquetas(r)))
    e.f.soltar()
    e.baja()
  }

  hr('(19) el adaptador y los iconos')
  {
    const f = falsa(ORA)
    const cache = new CacheMetaBd(f.api)
    const cat = new CatalogoAutocompletado(cache, { conexionId: 'cx1', dialecto: 'oracle', esquema: () => null }, new MemoriaFallos())
    check('sin nada cargado: esquemaActual null, esquemas []', cat.esquemaActual() === null && cat.esquemas().length === 0, j([cat.esquemaActual(), cat.esquemas()]))
    await cat.cargarBase()
    check('esquemas sin el pseudo PUBLIC', j(cat.esquemas()) === j(['SCOTT', 'HR', 'SYS']), j(cat.esquemas()))
    check('esquemaActual de reserva: el por defecto del índice', cat.esquemaActual() === 'SCOTT', String(cat.esquemaActual()))
    check('públicos en Oracle', j(cat.publicos()) === j(['ALL_USERS', 'DUAL']), j(cat.publicos()))
    const pg = new CatalogoAutocompletado(cache, { conexionId: 'cx1', dialecto: 'postgres', esquema: () => null }, new MemoriaFallos())
    check('sin públicos en PG aunque estén en caché', pg.publicos().length === 0, j(pg.publicos()))
    {
      // Sinónimo a un paquete: columnas() da [] (no null) para no pedirlo en cada tecla.
      const f2 = falsa({ ...ORA, objetos: { SCOTT: [['PKG_S', 'sinonimo']] }, sinonimos: { 'SCOTT.PKG_S': { esquema: 'SCOTT', nombre: 'PKG_NOMINA', tipo: 'paquete' } } })
      const c2 = new CacheMetaBd(f2.api)
      const a = new CatalogoAutocompletado(c2, { conexionId: 'cx1', dialecto: 'oracle', esquema: () => 'SCOTT' }, new MemoriaFallos())
      await a.cargarBase()
      await a.cargarPendientes({ columnas: [{ esquema: 'SCOTT', tabla: 'PKG_S' }], esquemas: [], fks: [] })
      check('sinónimo a un paquete: columnas() da [] y no se pidió detalle', j(a.columnas('SCOTT', 'PKG_S')) === '[]' && f2.de('detalle').length === 0, j([a.columnas('SCOTT', 'PKG_S'), f2.de('detalle').length]))
    }
    const tipos: Array<keyof typeof KIND_DE_TIPO> = [
      'tabla',
      'vista',
      'vistaMaterializada',
      'tablaForanea',
      'rutina',
      'paquete',
      'secuencia',
      'sinonimo',
      'tipoObjeto',
      'tipoColeccion',
      'tipo',
      'disparador',
      'columna',
      'palabraClave',
      'esquema',
      'join',
      'condicion',
      'expandir'
    ]
    const sinIcono = tipos.filter((t) => typeof (KINDS as Record<string, number>)[KIND_DE_TIPO[t]] !== 'number')
    check('cada tipo de sugerencia tiene un kind de Monaco', sinIcono.length === 0, j(sinIcono))
    const esperado: Record<string, string> = {
      tabla: 'Struct',
      vista: 'Interface',
      sinonimo: 'Reference',
      rutina: 'Function',
      paquete: 'Module',
      secuencia: 'Constant',
      columna: 'Field',
      palabraClave: 'Keyword',
      esquema: 'Folder'
    }
    const malos = Object.keys(esperado).filter((t) => KIND_DE_TIPO[t as keyof typeof KIND_DE_TIPO] !== esperado[t])
    check('los del plan: tabla Struct, vista Interface, sinónimo Reference…', malos.length === 0, j(malos))
  }

  // --- Claves ajenas--------------------------------------------------------------------------

  const FK_EMP_DEPT = {
    nombre: 'FK_EMP_DEPT',
    desde: { esquema: 'SCOTT', tabla: 'EMP', columnas: ['DEPTNO'] },
    hacia: { esquema: 'SCOTT', tabla: 'DEPT', columnas: ['DEPTNO'] }
  }
  const ORA_FK: Catalogo = {
    ...ORA,
    columnas: { ...ORA.columnas, 'SCOTT.DEPT': [col('DEPTNO', 1), col('DNAME', 2)] },
    fks: {
      'SCOTT.EMP': { salientes: [FK_EMP_DEPT], entrantes: [] },
      'SCOTT.DEPT': { salientes: [], entrantes: [FK_EMP_DEPT] }
    }
  }

  hr('(20) JOIN por FK de punta a punta')
  {
    const e = escena(ORA_FK, 'oracle', 'select * from emp e join ¦', () => 'SCOTT')
    const r = await e.sugerir()
    const primero = r.suggestions[0]
    check(
      'PRIMERO «DEPT d on d.DEPTNO = e.DEPTNO», kind Struct, detalle con la FK',
      primero !== undefined && primero.insertText === 'DEPT d on d.DEPTNO = e.DEPTNO' && primero.kind === KINDS.Struct && j(primero.label).indexOf('FK_EMP_DEPT') >= 0,
      j(primero)
    )
    const fks = e.f.de('fks')
    check('se pidieron las FKs de SCOTT.EMP (como tabla), una vez', fks.length === 1 && j(fks[0].args[1]) === j({ esquema: 'SCOTT', nombre: 'EMP', tipo: 'tabla' }), j(fks.map((x) => x.args)))
    e.escribir('select * from emp e join d¦')
    const r2 = await e.sugerir()
    check('la tecla siguiente: sin viajar otra vez, y filtrada', e.f.de('fks').length === 1 && r2.suggestions[0]?.insertText === 'DEPT d on d.DEPTNO = e.DEPTNO', j(etiquetas(r2).slice(0, 3)))
    check('filterText = lo tecleado, como las demás', r2.suggestions[0]?.filterText === 'd', String(r2.suggestions[0]?.filterText))
    e.escribir('select * from emp e join dept d on ¦')
    const r3 = await e.sugerir()
    check('tras ON: primero la condición', r3.suggestions[0]?.insertText === 'd.DEPTNO = e.DEPTNO' && r3.suggestions[0].kind === KINDS.Operator, j(r3.suggestions[0]))
    check('y las FKs de DEPT se pidieron (la tabla nueva)', e.f.de('fks').some((x) => (x.args[1] as DbRefObjeto).nombre === 'DEPT'), j(e.f.de('fks').map((x) => x.args[1])))
    e.baja()
  }
  {
    // Un sinónimo privado: las FKs son las de su destino.
    const cat: Catalogo = { ...ORA_FK }
    const e = escena(cat, 'oracle', 'select * from emp_s x join ¦', () => 'SCOTT')
    const r = await e.sugerir()
    check('por el sinónimo EMP_S: la FK de EMP', r.suggestions[0]?.insertText === 'DEPT d on d.DEPTNO = x.DEPTNO', j(r.suggestions[0]))
    check('las FKs se pidieron del DESTINO', e.f.de('fks').every((x) => (x.args[1] as DbRefObjeto).nombre === 'EMP'), j(e.f.de('fks').map((x) => x.args[1])))
    e.baja()
  }

  hr('(21) FKs colgadas: el tope corta y la tecla siguiente las ve')
  {
    const e2 = escena(ORA_FK, 'oracle', 'select * from emp e join ¦', () => 'SCOTT', 60)
    e2.f.colgar.add('fks')
    const t0 = Date.now()
    const r = await e2.sugerir()
    const ms = Date.now() - t0
    check('vuelve cerca del tope, sin la FK', ms < 1000 && r.suggestions.every((s) => (s.insertText ?? '').indexOf(' on ') < 0), `${ms} ms, ${j(etiquetas(r).slice(0, 2))}`)
    e2.f.soltar()
    await new Promise((res) => setTimeout(res, 0))
    const r2 = await e2.sugerir()
    check('al llegar, la siguiente pregunta ya la tiene sin volver a pedirla', r2.suggestions[0]?.insertText === 'DEPT d on d.DEPTNO = e.DEPTNO' && e2.f.de('fks').length === 1, j(etiquetas(r2).slice(0, 2)))
    e2.baja()
  }

  hr('(22) «Expandir columnas» por completado')
  {
    const e = escena(ORA_FK, 'oracle', 'select *¦ from emp', () => 'SCOTT')
    const r = await e.sugerir()
    const it = r.suggestions[0]
    const rg = it ? rangoDe(it) : null
    check(
      'primero, con la lista en el orden de la tabla',
      it !== undefined && etiqueta(it) === TITULO_EXPANDIR && it.insertText === 'EMPNO, ENAME, DEPTNO' && it.kind === KINDS.Snippet,
      j(it)
    )
    check('rango = el * (col 8..9), filterText «*»', rg !== null && rg.insert.startColumn === 8 && rg.insert.endColumn === 9 && rg.replace.endColumn === 9 && it?.filterText === '*', j(rg))
    check('y siguen las demás (columnas, FROM…)', r.suggestions.length > 1, String(r.suggestions.length))
    e.escribir('select e.*¦ from emp e join dept d on d.deptno = e.deptno')
    const r2 = await e.sugerir()
    check('e.*: calificada con «e» y rango de «e.*»', r2.suggestions[0]?.insertText === 'e.EMPNO, e.ENAME, e.DEPTNO' && rangoDe(r2.suggestions[0]).insert.startColumn === 8 && r2.suggestions[0].filterText === 'e.*', j(r2.suggestions[0]))
    e.escribir('select * ¦from emp')
    const r3 = await e.sugerir()
    check('con un blanco entre el * y el cursor: no', r3.suggestions.every((s) => etiqueta(s) !== TITULO_EXPANDIR), j(etiquetas(r3).slice(0, 3)))
    e.escribir('select count(*¦) from emp')
    const r4 = await e.sugerir()
    check('count(*): no', r4.suggestions.every((s) => etiqueta(s) !== TITULO_EXPANDIR), j(etiquetas(r4).slice(0, 3)))
    e.baja()
  }

  hr('(23) la acción de código «Expandir columnas»')
  {
    const e = escena(ORA_FK, 'oracle', 'select * from emp e\n  join dept d on d.deptno = e.deptno¦', () => 'SCOTT')
    const acc = (desde: number, hasta: number, modelo: ModeloFalso = e.modelo): Promise<languages.CodeActionList> => {
      const t = modelo.getValue()
      const a = posicionDe(t, desde)
      const b = posicionDe(t, hasta)
      const rango: IRange = { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }
      return accionesEnModelo(modelo as unknown as ModeloAcciones, rango, TOKEN, e.op)
    }
    const r = await acc(8, 8)
    const a = r.actions[0]
    const te = a?.edit?.edits[0] as { resource: Uri; versionId: number | undefined; textEdit: { range: IRange; text: string } } | undefined
    check('una acción, refactor.rewrite y preferida', r.actions.length === 1 && a.title === TITULO_EXPANDIR && a.kind === 'refactor.rewrite' && a.isPreferred === true, j(r.actions.map((x) => [x.title, x.kind])))
    check(
      'edita el * con las columnas de las dos tablas, calificadas',
      te !== undefined && te.textEdit.text === 'e.EMPNO, e.ENAME, e.DEPTNO, d.DEPTNO, d.DNAME' && te.textEdit.range.startColumn === 8 && te.textEdit.range.endColumn === 9,
      j(te)
    )
    check('con la versión del modelo (Monaco la rechaza si cambió)', te !== undefined && te.versionId === e.modelo.getVersionId(), String(te?.versionId))
    check('fuera del *: ninguna', (await acc(2, 2)).actions.length === 0, 'vacío')
    const ajeno = modeloFalso('select * from emp', 'file:///x.sql')
    check('en un modelo que no es de consola: ninguna', (await acc(8, 8, ajeno)).actions.length === 0, 'vacío')
    e.escribir('select *¦ from (select 1 x from dual)')
    check('con una subconsulta en el FROM: ninguna', (await acc(8, 8)).actions.length === 0, 'vacío')
    e.baja()
  }

  hr('(24) precarga de FKs en la pausa')
  {
    // precargarFks directamente: la sentencia bajo el offset, solo tablas que existen.
    const f = falsa(ORA_FK)
    const cache = new CacheMetaBd(f.api)
    const ruta: RutaConsola = { consolaId: 'p1', conexionId: 'cx1', alias: 'QA', dialecto: 'oracle', esquema: () => 'SCOTT' }
    const texto = 'select * from dept;\nselect * from emp e, pe x where 1 = 1'
    const n = await precargarFks(texto, texto.length, ruta, cache, new MemoriaFallos())
    const pedidas = f.de('fks').map((x) => (x.args[1] as DbRefObjeto).nombre)
    check('solo la sentencia del cursor, y solo lo que existe (EMP sí, «pe» no)', n === 1 && j(pedidas) === j(['EMP']), j(pedidas))
    const n2 = await precargarFks(texto, texto.length, ruta, cache, new MemoriaFallos())
    check('lo que ya está en caché no vuelve a viajar', n2 === 0 && f.de('fks').length === 1, `${n2} / ${f.de('fks').length}`)

    // La clase, con temporizadores falsos y un modelo que emite cambios.
    const programados: Array<() => void> = []
    let cancelados = 0
    const oyentesCambio: Array<(e: EventoCambioModelo) => void> = []
    const oyentesFin: Array<() => void> = []
    const valor = 'select * from dept d join '
    const uri = uriConsola('precarga-1')
    const modelo: ModeloVigilable = {
      uri: { toString: () => uri },
      isDisposed: () => false,
      getVersionId: () => 1,
      getValue: () => valor,
      getValueLength: () => valor.length,
      onDidChangeContent: (cb) => {
        oyentesCambio.push(cb)
        return { dispose: () => oyentesCambio.splice(oyentesCambio.indexOf(cb), 1) }
      },
      onWillDispose: (cb) => {
        oyentesFin.push(cb)
        return { dispose: () => oyentesFin.splice(oyentesFin.indexOf(cb), 1) }
      }
    }
    const f2 = falsa(ORA_FK)
    const cache2 = new CacheMetaBd(f2.api)
    const baja = registrarRutaConsola(uri, { ...ruta, consolaId: 'precarga-1' })
    const precarga = new PrecargaFks({
      cache: () => cache2,
      fallos: new MemoriaFallos(),
      programar: (fn) => {
        programados.push(fn)
        return programados.length
      },
      cancelar: () => {
        cancelados++
      }
    })
    precarga.vigilar(modelo)
    precarga.vigilar(modelo)
    check('vigilar es idempotente (un solo oyente)', oyentesCambio.length === 1, String(oyentesCambio.length))
    const emitir = (): void => oyentesCambio.forEach((cb) => cb({ changes: [{ rangeOffset: valor.length - 1, text: ' ' }] }))
    emitir()
    emitir()
    check('dos teclas seguidas: la primera pausa se cancela', programados.length === 2 && cancelados === 1, `${programados.length} programadas, ${cancelados} canceladas`)
    programados[1]()
    await new Promise((res) => setTimeout(res, 10))
    check('al vencer la pausa: se piden las FKs de DEPT', f2.de('fks').some((x) => (x.args[1] as DbRefObjeto).nombre === 'DEPT'), j(f2.de('fks').map((x) => x.args[1])))
    oyentesFin.forEach((cb) => cb())
    check('al cerrarse el modelo: se suelta todo', oyentesCambio.length === 0 && oyentesFin.length === 0, `${oyentesCambio.length}/${oyentesFin.length}`)
    const archivo: ModeloVigilable = { ...modelo, uri: { toString: () => 'file:///c/x.sql' } }
    const antes = oyentesCambio.length
    precarga.vigilar(archivo)
    check('un modelo del editor de archivos no se vigila', oyentesCambio.length === antes, String(oyentesCambio.length))
    baja()

    // El registro la engancha a los modelos que hay y a los que se crean.
    const creados: Array<(m: ModeloVigilable) => void> = []
    let vigilados = 0
    const conModelos = monacoFalso()
    const deConsola = (id: string): ModeloVigilable => ({
      ...modelo,
      uri: { toString: () => uriConsola(id) },
      onDidChangeContent: () => {
        vigilados++
        return { dispose: () => undefined }
      },
      onWillDispose: () => ({ dispose: () => undefined })
    })
    const m = {
      ...conModelos.monaco,
      editor: {
        getModels: () => [deConsola('ya-estaba')],
        onDidCreateModel: (cb: (m: ModeloVigilable) => void) => {
          creados.push(cb)
          return { dispose: () => undefined }
        }
      }
    }
    asegurarAutocompletadoSql(m, { cache: () => cache2 })
    creados.forEach((cb) => cb(deConsola('nueva')))
    check('el registro vigila el modelo que ya había y el que se crea después', vigilados === 2 && creados.length === 1, `${vigilados} vigilados`)

    // (revisión) Un flush no es una pausa, y la pausa reutiliza la división del completado.
    // Temporizadores que de verdad se cancelan, y un modelo con versión que cuenta lecturas.
    const f3 = falsa(ORA_FK)
    const cache3 = new CacheMetaBd(f3.api)
    const uri3 = uriConsola('precarga-flush')
    const baja3 = registrarRutaConsola(uri3, { ...ruta, consolaId: 'precarga-flush' })
    const temporizadores = new Map<number, () => void>()
    let siguiente = 0
    const vencer = async (): Promise<void> => {
      const fns = [...temporizadores.values()]
      temporizadores.clear()
      fns.forEach((fn) => fn())
      await new Promise((res) => setTimeout(res, 10))
    }
    let texto3 = ''
    let version3 = 1
    let lecturas3 = 0
    const oyentes3: Array<(e: EventoCambioModelo) => void> = []
    const m3: ModeloVigilable = {
      uri: { toString: () => uri3 },
      isDisposed: () => false,
      getVersionId: () => version3,
      getValue: () => {
        lecturas3++
        return texto3
      },
      getValueLength: () => texto3.length,
      onDidChangeContent: (cb) => {
        oyentes3.push(cb)
        return { dispose: () => undefined }
      },
      onWillDispose: () => ({ dispose: () => undefined })
    }
    const cambiar3 = (t: string, rangeOffset: number, text: string, isFlush: boolean): void => {
      texto3 = t
      version3++
      oyentes3.forEach((cb) => cb({ changes: [{ rangeOffset, text }], isFlush }))
    }
    // Como `setValue` de Monaco 0.52 (`textModel.js`): el texto entero desde 0, con `isFlush`.
    const setValue = (t: string): void => cambiar3(t, 0, t, true)
    // Una tecla al final: una edición normal, sin `isFlush`.
    const teclear = (t: string): void => cambiar3(texto3 + t, texto3.length, t, false)
    const p3 = new PrecargaFks({
      cache: () => cache3,
      fallos: new MemoriaFallos(),
      programar: (fn) => {
        temporizadores.set(++siguiente, fn)
        return siguiente
      },
      cancelar: (h) => {
        temporizadores.delete(h as number)
      }
    })
    p3.vigilar(m3)
    const guardada = 'select * from bonus;\nselect * from emp e join dept d on '
    setValue(guardada)
    check('un flush (la primera carga desde el disco) no programa la pausa', temporizadores.size === 0, `${temporizadores.size} programadas`)
    await vencer()
    check('... ni viaja al catálogo: ni la base ni las FKs', f3.llamadas.length === 0, j(f3.llamadas.map((l) => l.canal)))
    teclear(' ')
    setValue(guardada)
    check('una tecla y luego un flush: la pausa pendiente se cancela', temporizadores.size === 0, `${temporizadores.size} programadas`)
    await vencer()
    check('... y no se piden FKs', f3.llamadas.length === 0, j(f3.llamadas.map((l) => l.canal)))
    // Mitades negativas: tras el flush se sigue vigilando, y la recarga desde el disco
    // (`pushEditOperations`: el texto entero pero SIN `isFlush`) sí es una pausa.
    teclear(' ')
    check('tras el flush, una tecla sí programa la pausa', temporizadores.size === 1, `${temporizadores.size} programadas`)
    await vencer()
    const fks3 = f3.de('fks').map((x) => (x.args[1] as DbRefObjeto).nombre).sort()
    check('... y al vencer se piden las de la última sentencia (DEPT y EMP)', j(fks3) === j(['DEPT', 'EMP']), j(fks3))
    cambiar3('select * from emp', 0, 'select * from emp', false)
    check('la recarga desde el disco (sin isFlush) sí programa la pausa', temporizadores.size === 1, `${temporizadores.size} programadas`)
    await vencer()

    // La división: la pausa reutiliza la del completado en la misma versión, y al revés.
    teclear(' e')
    analisisDe(m3, 'oracle') // lo que hace el completado al preguntar tras una letra
    const tras = lecturas3
    await vencer()
    check('la pausa reutiliza la división que ya hizo el completado (no relee el texto)', lecturas3 === tras, `lecturas ${tras} -> ${lecturas3}`)
    teclear(' ')
    await vencer()
    const trasPausa = lecturas3
    const a3 = analisisDe(m3, 'oracle') // un Ctrl+Espacio tras la pausa, misma versión
    check('en una versión nueva la pausa la parte una vez, y el completado la reutiliza', trasPausa === tras + 1 && lecturas3 === trasPausa && a3.version === version3, `lecturas ${tras} -> ${trasPausa} -> ${lecturas3}`)
    baja3()
  }

  hr('(25) lo obsoleto se vuelve a pedir (revisión): FKs tras un DDL y columnas de «Expandir»')
  {
    // Un catálogo propio que se puede cambiar a mitad (el main respondería lo nuevo).
    const FK_PRY_DEPT = {
      nombre: 'FK_PRY_DEPT',
      desde: { esquema: 'SCOTT', tabla: 'PROYECTOS', columnas: ['DEPTNO'] },
      hacia: { esquema: 'SCOTT', tabla: 'DEPT', columnas: ['DEPTNO'] }
    }
    const cat: Catalogo = { ...ORA_FK, columnas: { ...ORA_FK.columnas }, fks: { ...ORA_FK.fks } }
    const ddl = (e: Escena): void => e.cache.invalidar({ conexionId: 'cx1', esquema: 'SCOTT', motivo: 'ddl' })
    const e = escena(cat, 'oracle', 'select * from dept d join ¦', () => 'SCOTT')
    const r1 = await e.sugerir()
    check('antes del DDL: la FK de EMP', r1.suggestions[0]?.insertText === 'EMP e on e.DEPTNO = d.DEPTNO', j(etiquetas(r1).slice(0, 2)))
    // `ALTER TABLE proyectos ADD CONSTRAINT fk_pry_dept … REFERENCES dept` en la consola.
    cat.fks = { ...cat.fks, 'SCOTT.DEPT': { salientes: [], entrantes: [FK_EMP_DEPT, FK_PRY_DEPT] } }
    ddl(e)
    e.escribir('select * from dept d join ¦')
    const r2 = await e.sugerir()
    check(
      'tras el DDL: se vuelven a pedir y sale la FK nueva',
      e.f.de('fks').length === 2 && r2.suggestions.some((s) => s.insertText === 'PROYECTOS p on p.DEPTNO = d.DEPTNO'),
      `${e.f.de('fks').length} viajes, ${j(r2.suggestions.slice(0, 3).map((s) => s.insertText))}`
    )
    // Si la recarga se cuelga, se sugiere lo que había (lo obsoleto se sigue leyendo).
    e.f.colgar.add('fks')
    ddl(e)
    e.escribir('select * from dept d join ¦')
    const r3 = await e.sugerir()
    check('recarga colgada: tras el tope, las que había', r3.suggestions[0]?.insertText === 'EMP e on e.DEPTNO = d.DEPTNO', j(etiquetas(r3).slice(0, 2)))
    e.f.soltar()
    await new Promise((res) => setTimeout(res, 0))

    // «Expandir columnas» tras `ALTER TABLE emp ADD sal`.
    e.escribir('select *¦ from emp')
    const x1 = await e.sugerir()
    check('antes del ADD: EMPNO, ENAME, DEPTNO', x1.suggestions[0]?.insertText === 'EMPNO, ENAME, DEPTNO', j(x1.suggestions[0]?.insertText))
    cat.columnas = { ...cat.columnas, 'SCOTT.EMP': [...(cat.columnas['SCOTT.EMP'] ?? []), col('SAL', 4)] }
    e.f.colgar.add('detalle')
    ddl(e)
    e.escribir('select *¦ from emp')
    const x2 = await e.sugerir()
    check(
      'con las columnas obsoletas y la recarga colgada: NO se ofrece (la lista vieja dejaría fuera SAL)',
      x2.suggestions.every((s) => etiqueta(s) !== TITULO_EXPANDIR),
      j(etiquetas(x2).slice(0, 2))
    )
    const acc = await accionesEnModelo(e.modelo as unknown as ModeloAcciones, { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 8 }, TOKEN, e.op)
    check('…ni como acción de código', acc.actions.length === 0, j(acc.actions.map((a) => a.title)))
    e.f.soltar()
    await new Promise((res) => setTimeout(res, 0))
    e.escribir('select *¦ from emp')
    const x3 = await e.sugerir()
    check('al llegar la recarga: la lista nueva, con SAL', x3.suggestions[0]?.insertText === 'EMPNO, ENAME, DEPTNO, SAL', j(x3.suggestions[0]?.insertText))
    e.baja()

    // La precarga también recarga las obsoletas.
    const f = falsa(cat)
    const cache = new CacheMetaBd(f.api)
    const ruta: RutaConsola = { consolaId: 'p25', conexionId: 'cx1', alias: 'QA', dialecto: 'oracle', esquema: () => 'SCOTT' }
    const texto = 'select * from emp e'
    await precargarFks(texto, texto.length, ruta, cache, new MemoriaFallos())
    cache.invalidar({ conexionId: 'cx1', esquema: 'HR', motivo: 'ddl' })
    const n = await precargarFks(texto, texto.length, ruta, cache, new MemoriaFallos())
    check('precarga: tras un DDL de la conexión vuelve a pedir las de EMP', n === 1 && f.de('fks').length === 2, `${n} / ${f.de('fks').length}`)
    const nRemota = await precargarFks('select * from dept@remota d', 27, ruta, cache, new MemoriaFallos())
    check('precarga: una tabla por enlace no se pide', nRemota === 0 && f.de('fks').length === 2, `${nRemota} / ${f.de('fks').length}`)
  }

  hr('(26) SQLite: los nombres se comparan SIN CAJA')
  {
    // SQLite guarda el nombre como se escribió y compara sin caja ASCII: `clientes`,
    // `CLIENTES` y `MAIN.clientes` son `main.Clientes`.
    const LITE: Catalogo = {
      porDefecto: 'main',
      esquemas: [{ nombre: 'main' }],
      visibles: ['main'],
      objetos: { main: [['Clientes', 'tabla'], ['Pedidos', 'tabla']] },
      columnas: { 'main.Clientes': [col('Id', 1), col('Nombre', 2)] },
      sinonimos: {},
      publicos: []
    }
    const f = falsa(LITE)
    const cache = new CacheMetaBd(f.api)
    const cat = new CatalogoAutocompletado(cache, { conexionId: 'cx1', dialecto: 'sqlite', esquema: () => 'main' }, new MemoriaFallos())
    await cat.cargarBase()
    await cat.cargarPendientes({ columnas: [{ esquema: 'MAIN', tabla: 'clientes' }], esquemas: [], fks: [] })
    const det = f.de('detalle')
    check('pide las columnas de main.Clientes (el nombre del catálogo)', det.length === 1 && j(det[0].args[1]) === j({ esquema: 'main', nombre: 'Clientes', tipo: 'tabla' }), j(det.map((d) => d.args[1])))
    check('columnas() con otra caja las encuentra', j(cat.columnas('MAIN', 'CLIENTES')) === j(['Id', 'Nombre']) && j(cat.columnas('main', 'clientes')) === j(['Id', 'Nombre']), j(cat.columnas('MAIN', 'CLIENTES')))
    check('destino() da el nombre del catálogo', j(cat.destino('Main', 'PEDIDOS')) === j({ esquema: 'main', nombre: 'Pedidos' }), j(cat.destino('Main', 'PEDIDOS')))
    check('objetos() de `MAIN.`', cat.objetos('MAIN').length === 2, String(cat.objetos('MAIN').length))
    check('lo que no existe se queda como se escribió', j(cat.destino('main', 'nada')) === j({ esquema: 'main', nombre: 'nada' }), j(cat.destino('main', 'nada')))
    // La precarga de FKs (para sugerir el JOIN) también: mirando si existe con `===`,
    // `pedidos` (la tabla `Pedidos`) no se precargaría.
    const textoFk = 'select * from pedidos p join '
    const nFk = await precargarFks(textoFk, textoFk.length, { consolaId: 'p26', conexionId: 'cx1', alias: 'LITE', dialecto: 'sqlite', esquema: () => 'main' }, cache, new MemoriaFallos())
    check('precargarFks: `pedidos` en minúscula es `Pedidos` y se precarga', nFk === 1, String(nFk))
    // La mitad negativa: Oracle sigue EXACTO (lo escrito ya llega plegado; `emp` entre
    // comillas es otra tabla que no existe).
    const fo = falsa(ORA)
    const co = new CacheMetaBd(fo.api)
    const ora = new CatalogoAutocompletado(co, { conexionId: 'cx1', dialecto: 'oracle', esquema: () => 'SCOTT' }, new MemoriaFallos())
    await ora.cargarBase()
    await ora.cargarPendientes({ columnas: [{ esquema: 'SCOTT', tabla: 'EMP' }], esquemas: [], fks: [] })
    check('Oracle: `emp` (citado) NO es EMP', ora.columnas('SCOTT', 'emp') === null && ora.columnas('SCOTT', 'EMP') !== null, j([ora.columnas('SCOTT', 'emp'), ora.columnas('SCOTT', 'EMP')]))
    check('Oracle: `scott` no es SCOTT', j(ora.destino('scott', 'EMP')) === j({ esquema: 'scott', nombre: 'EMP' }), j(ora.destino('scott', 'EMP')))
  }

  // -------------------------------------------------------------------------------
  hr('(27) SQL Server: la base de la consola, tres partes y sin caja Unicode')
  {
    const SQLS: Catalogo = {
      porDefecto: 'dbo',
      esquemas: [{ nombre: 'dbo' }, { nombre: 'ventas_esq' }],
      visibles: ['dbo'],
      objetos: { dbo: [['Ñandú', 'tabla'], ['Pedidos', 'tabla']] },
      columnas: { 'dbo.Ñandú': [col('Id', 1), col('Pico', 2)] },
      sinonimos: {},
      publicos: []
    }
    const f = falsa(SQLS)
    const cache = new CacheMetaBd(f.api)
    // Con nivel «Bases»: el esquema de la sesión no se usa (es la base) y la base es la de la consola.
    const cat = new CatalogoAutocompletado(cache, { conexionId: 'cx1', dialecto: 'sqlserver', esquema: () => null, base: () => 'ventas' }, new MemoriaFallos())
    await cat.cargarBase()
    check('la lista de esquemas se pide DE LA BASE', j(f.de('esquemas').map((l) => l.args)) === j([['cx1', false, 'ventas']]), j(f.de('esquemas').map((l) => l.args)))
    check('el índice de nombres, de la base y sin esquema actual', j(f.de('nombres').map((l) => l.args)) === j([['cx1', null, false, 'ventas']]), j(f.de('nombres').map((l) => l.args)))
    await cat.cargarPendientes({ columnas: [{ esquema: 'DBO', tabla: 'ÑANDÚ' }], esquemas: [], fks: [] })
    const det = f.de('detalle')
    check(
      'las columnas de `DBO.ÑANDÚ` se piden como dbo.Ñandú EN LA BASE (sin caja en toda letra)',
      det.length === 1 && j(det[0].args[1]) === j({ esquema: 'dbo', nombre: 'Ñandú', tipo: 'tabla', base: 'ventas' }),
      j(det.map((d) => d.args[1]))
    )
    check('columnas() con otra caja las encuentra', j(cat.columnas('dbo', 'ñandú')) === j(['Id', 'Pico']), j(cat.columnas('dbo', 'ñandú')))
    // Tres partes hacia OTRA base: su índice y sus columnas, aparte.
    await cat.cargarPendientes({ columnas: [{ esquema: 'dbo', tabla: 'Pedidos', base: 'compras' }], esquemas: [], fks: [], deBase: [{ base: 'compras', esquema: 'dbo' }] })
    const nombresOtra = f.de('nombres').filter((l) => l.args[3] === 'compras')
    check('el índice de la otra base, con ese esquema como actual', nombresOtra.length >= 1 && j(nombresOtra[0].args) === j(['cx1', 'dbo', false, 'compras']), j(nombresOtra.map((l) => l.args)))
    const detOtra = f.de('detalle').filter((l) => (l.args[1] as DbRefObjeto).base === 'compras')
    check('las columnas de compras.dbo.Pedidos llevan su base', detOtra.length === 1 && (detOtra[0].args[1] as DbRefObjeto).nombre === 'Pedidos', j(detOtra.map((d) => d.args[1])))
    check('objetos(dbo, compras): los de esa base', cat.objetos('dbo', 'compras').length === 2, String(cat.objetos('dbo', 'compras').length))
    // Sin `base` en la ruta (Oracle, PG, SQLite y SQL Server con base fija): lo de siempre.
    const f2 = falsa(SQLS)
    const c2 = new CacheMetaBd(f2.api)
    const fija = new CatalogoAutocompletado(c2, { conexionId: 'cx1', dialecto: 'sqlserver', esquema: () => null }, new MemoriaFallos())
    await fija.cargarBase()
    check('sin base en la ruta: las llamadas de siempre', j(f2.de('esquemas').map((l) => l.args)) === j([['cx1']]) && j(f2.de('nombres').map((l) => l.args)) === j([['cx1', null]]), j(f2.llamadas.map((l) => [l.canal, l.args])))
  }

  const pasados = results.filter((r) => r.pass).length
  const allPass = pasados === results.length
  console.log(`\nVEREDICTO: ${pasados}/${results.length} PASS`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
