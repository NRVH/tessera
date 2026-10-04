#!/usr/bin/env node
// =============================================================================
// Prueba de la caché de catálogo del renderer (npm run test:db-cache-meta), con una API del
// main FALSA que se resuelve a mano para fijar el orden de llegada: deduplicación, frescura,
// errores y «Reintentar», invalidación como obsoleto (también en vuelo), detalle por partes,
// errores recordados 30 s, índice desplegado, respuestas raras, instantánea, claves ajenas,
// nivel «Bases» y las cargas de documentos y claves.
// Decisiones: docs/decisiones/bd/ui-arbol-cache-meta.md
// =============================================================================

import { CacheMetaBd, ERROR_NOMBRES_MS, type ApiCatalogoBd, type ApiFamiliasBd } from './cacheMetaBd.ts'
import { CUENTA_ESCANEO } from './arbolClaves.ts'
import { aplanarArbolBd, cargasPendientes, claveBd } from './arbolBd.ts'
import type {
  DbDetalle,
  DbEsquemasRespuesta,
  DbEventoCatalogo,
  DbIndiceNombres,
  DbRelacionesFk,
  DbRespuesta
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'

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

// --- API falsa -----------------------------------------------------------------------

interface Llamada {
  canal: string
  args: unknown[]
  resolver: (r: unknown) => void
  rechazar: (e: unknown) => void
}

function crearFalsa(): {
  api: ApiCatalogoBd
  llamadas: Llamada[]
  emitir: (e: DbEventoCatalogo) => void
  oyentes: () => number
} {
  const llamadas: Llamada[] = []
  const cbs: Array<(e: DbEventoCatalogo) => void> = []
  function diferida<T>(canal: string, args: unknown[]): Promise<T> {
    return new Promise<T>((res, rej) => {
      llamadas.push({ canal, args, resolver: (r) => res(r as T), rechazar: rej })
    })
  }
  const api: ApiCatalogoBd = {
    esquemas: (...a) => diferida('esquemas', a),
    bases: (...a) => diferida('bases', a),
    resumen: (...a) => diferida('resumen', a),
    objetos: (...a) => diferida('objetos', a),
    detalle: (...a) => diferida('detalle', a),
    resolver: (...a) => diferida('resolver', a),
    nombres: (...a) => diferida('nombres', a),
    nombresPublicos: (...a) => diferida('nombresPublicos', a),
    fks: (...a) => diferida('fks', a),
    onCatalogo: (cb) => {
      cbs.push(cb)
      return () => undefined
    }
  }
  return { api, llamadas, emitir: (e) => cbs.forEach((cb) => cb(e)), oyentes: () => cbs.length }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const ok = <T,>(valor: T): DbRespuesta<T> => ({ ok: true, valor })

const RESP_ESQ: DbEsquemasRespuesta = {
  esquemas: [
    { nombre: 'HR', sistema: false, visible: true, porDefecto: true },
    { nombre: 'VENTAS', sistema: false, visible: false, porDefecto: false }
  ],
  porDefecto: 'HR',
  config: { modo: 'lista', porDefecto: true, esquemas: [] },
  nVisibles: 1
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  hr('(1) un solo listener de onCatalogo')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    void c
    check('instalado al crear', f.oyentes() === 1, `oyentes=${f.oyentes()}`)
  }

  // ---------------------------------------------------------------------------
  hr('(2)(3) deduplicación, frescura, versión y suscriptores')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    let avisos = 0
    const baja = c.suscribir(() => avisos++)
    const v0 = c.version()
    const p1 = c.cargarEsquemas('C1')
    const p2 = c.cargarEsquemas('C1')
    check('dos peticiones a la vez = un viaje', f.llamadas.length === 1, `llamadas=${f.llamadas.length}`)
    f.llamadas[0].resolver(ok(RESP_ESQ))
    const [r1, r2] = await Promise.all([p1, p2])
    check('las dos reciben lo mismo', r1.ok && r2.ok && r1.valor === r2.valor, j([r1.ok, r2.ok]))
    check('getter síncrono', c.esquemas('C1') === RESP_ESQ, j(c.esquemas('C1')?.porDefecto))
    check('la versión subió y el suscriptor se enteró', c.version() > v0 && avisos >= 1, `v=${c.version()} avisos=${avisos}`)
    const r3 = await c.cargarEsquemas('C1')
    check('lo fresco no vuelve a viajar', f.llamadas.length === 1 && r3.ok, `llamadas=${f.llamadas.length}`)
    baja()
    const antes = avisos
    f.emitir({ conexionId: 'C1', motivo: 'refrescar' })
    check('tras la baja no avisa', avisos === antes, `avisos=${avisos}`)
    check('el esquema por defecto sale de la lista', c.esquemaPorDefecto('C1') === 'HR', j(c.esquemaPorDefecto('C1')))
  }

  // ---------------------------------------------------------------------------
  hr('(4) error y reintento')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const clave = claveBd.esquema('C1', 'HR')
    const p = c.cargarResumen('C1', 'HR')
    f.llamadas[0].resolver({ ok: false, error: { motivo: 'sinSecreto', mensaje: 'Sin contraseña' } })
    const r = await p
    check('devuelve el error', !r.ok && r.error.motivo === 'sinSecreto', j(r))
    check('queda registrado en la clave del nodo', c.error(clave)?.motivo === 'sinSecreto', j(c.error(clave)))
    check('la instantánea lo trae', c.instantaneaArbol().errores.get(clave)?.mensaje === 'Sin contraseña', 'errores')
    const v = c.version()
    const p2 = c.reintentar({ tipo: 'resumen', clave, conexionId: 'C1', esquema: 'HR' })
    check('reintentar olvida el error al momento (se pinta «Cargando…»)', c.error(clave) === null && c.version() > v, `v=${c.version()}`)
    check('y vuelve a pedir', f.llamadas.length === 2 && f.llamadas[1].canal === 'resumen', `llamadas=${f.llamadas.length}`)
    f.llamadas[1].resolver(ok({ tabla: 3 }))
    await p2
    check('ya hay dato y no hay error', c.resumen('C1', 'HR')?.tabla === 3 && c.error(clave) === null, j(c.resumen('C1', 'HR')))
  }

  // ---------------------------------------------------------------------------
  hr('(5) invalidación: obsoleto y solo lo afectado')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const cargas = [
      c.cargarEsquemas('C1'),
      c.cargarResumen('C1', 'HR'),
      c.cargarResumen('C1', 'VENTAS'),
      c.cargarObjetos('C1', 'HR', 'tabla'),
      c.cargarNombres('C1', 'HR'),
      c.cargarPublicos('C1'),
      c.cargarResolucion('C1', 'VENTAS', 'SIN'),
      c.cargarResumen('C2', 'HR')
    ]
    const valores: unknown[] = [
      RESP_ESQ,
      { tabla: 1 },
      { tabla: 2 },
      [{ esquema: 'HR', nombre: 'EMP', tipo: 'tabla' }],
      { esquemas: ['HR'], objetos: [['EMP', 0, 'tabla']], porDefecto: 'HR' },
      ['DUAL'],
      { esquema: 'HR', nombre: 'EMP', tipo: 'tabla' },
      { tabla: 9 }
    ]
    f.llamadas.forEach((l, i) => l.resolver(ok(valores[i])))
    await Promise.all(cargas)
    const eHR = claveBd.esquema('C1', 'HR')
    const eV = claveBd.esquema('C1', 'VENTAS')
    const cHR = claveBd.carpeta('C1', 'HR', 'tabla')
    const con = claveBd.conexion('C1')
    const v = c.version()
    f.emitir({ conexionId: 'C1', esquema: 'HR', motivo: 'ddl' })
    check('el esquema del DDL queda obsoleto', c.obsoleta(eHR) && c.obsoleta(cHR), `${c.obsoleta(eHR)} ${c.obsoleta(cHR)}`)
    check('otro esquema NO', !c.obsoleta(eV), `${c.obsoleta(eV)}`)
    check('la lista de esquemas sí (un CREATE USER la cambia)', c.obsoleta(con), `${c.obsoleta(con)}`)
    check('otra conexión NO', !c.obsoleta(claveBd.esquema('C2', 'HR')), 'C2')
    check('lo obsoleto se sigue leyendo (no parpadea)', c.resumen('C1', 'HR')?.tabla === 1, j(c.resumen('C1', 'HR')))
    check('y avisa', c.version() > v, `v=${c.version()}`)
    const n0 = f.llamadas.length
    void c.cargarResumen('C1', 'HR')
    void c.cargarResumen('C1', 'VENTAS')
    check('pedir lo obsoleto viaja; lo fresco no', f.llamadas.length === n0 + 1, `llamadas=${f.llamadas.length - n0}`)
    // Índice y resoluciones: afectados; públicos: solo si el esquema es PUBLIC.
    const n1 = f.llamadas.length
    void c.cargarNombres('C1', 'HR')
    void c.cargarResolucion('C1', 'VENTAS', 'SIN')
    void c.cargarPublicos('C1')
    const canales = f.llamadas.slice(n1).map((l) => l.canal)
    check('índice y resolución se vuelven a pedir; públicos no', j(canales) === j(['nombres', 'resolver']), j(canales))

    f.emitir({ conexionId: 'C1', esquema: 'PUBLIC', motivo: 'ddl' })
    const n2 = f.llamadas.length
    void c.cargarPublicos('C1')
    check('un DDL en PUBLIC invalida los públicos', f.llamadas.length === n2 + 1, `llamadas=${f.llamadas.length - n2}`)
  }
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const cargas = [c.cargarEsquemas('C1'), c.cargarResumen('C1', 'HR'), c.cargarNombres('C1', null)]
    f.llamadas[0].resolver(ok(RESP_ESQ))
    f.llamadas[1].resolver(ok({ tabla: 1 }))
    f.llamadas[2].resolver(ok({ esquemas: [], objetos: [], porDefecto: 'HR' }))
    await Promise.all(cargas)
    f.emitir({ conexionId: 'C1', motivo: 'esquemas' })
    check(
      'motivo esquemas: lista e índice, no el resumen',
      c.obsoleta(claveBd.conexion('C1')) && !c.obsoleta(claveBd.esquema('C1', 'HR')),
      `${c.obsoleta(claveBd.conexion('C1'))} ${c.obsoleta(claveBd.esquema('C1', 'HR'))}`
    )
    f.emitir({ conexionId: 'C1', esquema: 'HR', motivo: 'edicion' })
    check('motivo edicion: todo, aunque traiga esquema', c.obsoleta(claveBd.esquema('C1', 'HR')), 'edicion')
  }
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const p = c.cargarResumen('C1', 'HR')
    f.llamadas[0].resolver({ ok: false, error: { motivo: 'servidor', mensaje: 'VPN caída' } })
    await p
    f.emitir({ conexionId: 'C1', motivo: 'refrescar' })
    check('refrescar borra los errores afectados (reintenta lo que falló)', c.error(claveBd.esquema('C1', 'HR')) === null, 'error borrado')
  }

  // ---------------------------------------------------------------------------
  hr('(6) invalidación con la petición en vuelo')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const clave = claveBd.carpeta('C1', 'HR', 'tabla')
    const p = c.cargarObjetos('C1', 'HR', 'tabla')
    f.emitir({ conexionId: 'C1', esquema: 'HR', motivo: 'ddl' })
    f.llamadas[0].resolver(ok([{ esquema: 'HR', nombre: 'VIEJA', tipo: 'tabla' }]))
    await p
    check('la respuesta nace obsoleta', c.obsoleta(clave) && c.objetos('C1', 'HR', 'tabla')?.[0]?.nombre === 'VIEJA', `${c.obsoleta(clave)}`)
  }
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const clave = claveBd.carpeta('C1', 'HR', 'tabla')
    const vieja = c.cargarObjetos('C1', 'HR', 'tabla')
    f.emitir({ conexionId: 'C1', esquema: 'HR', motivo: 'ddl' })
    const nueva = c.cargarObjetos('C1', 'HR', 'tabla')
    check('tras invalidar, pedir NO se engancha a la vieja', f.llamadas.length === 2, `llamadas=${f.llamadas.length}`)
    const otra = c.cargarObjetos('C1', 'HR', 'tabla')
    check('pero sí a la nueva', f.llamadas.length === 2, `llamadas=${f.llamadas.length}`)
    f.llamadas[1].resolver(ok([{ esquema: 'HR', nombre: 'NUEVA', tipo: 'tabla' }]))
    await Promise.all([nueva, otra])
    f.llamadas[0].resolver(ok([{ esquema: 'HR', nombre: 'VIEJA', tipo: 'tabla' }]))
    await vieja
    check(
      'la vieja que llega tarde no pisa a la nueva',
      c.objetos('C1', 'HR', 'tabla')?.[0]?.nombre === 'NUEVA' && !c.obsoleta(clave),
      j(c.objetos('C1', 'HR', 'tabla'))
    )
  }

  // ---------------------------------------------------------------------------
  hr('(7) un refresco que falla tira el dato viejo')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const clave = claveBd.esquema('C1', 'HR')
    const p = c.cargarResumen('C1', 'HR')
    f.llamadas[0].resolver(ok({ tabla: 5 }))
    await p
    f.emitir({ conexionId: 'C1', motivo: 'refrescar' })
    const p2 = c.cargarResumen('C1', 'HR')
    f.llamadas[1].resolver({ ok: false, error: { motivo: 'sesionPerdida', mensaje: 'ORA-03113' } })
    await p2
    check('sin dato y con error', c.resumen('C1', 'HR') === null && c.error(clave)?.mensaje === 'ORA-03113', j(c.error(clave)))
  }

  // ---------------------------------------------------------------------------
  hr('(8) detalle por partes')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const obj = { esquema: 'HR', nombre: 'EMP', tipo: 'tabla' as const }
    const clave = claveBd.objeto('C1', 'HR', 'tabla', 'EMP')
    const pc = c.cargarColumnas('C1', 'HR', 'EMP')
    check('columnas pide solo columnas', j(f.llamadas[0].args[2]) === j(['columnas']), j(f.llamadas[0].args))
    const cols: DbDetalle = {
      columnas: [{ nombre: 'ID', posicion: 1, tipo: 'NUMBER', nullable: false, pk: 1 }]
    }
    f.llamadas[0].resolver(ok(cols))
    await pc
    check('el autocompletado las lee por nombre', c.columnas('C1', 'HR', 'EMP')?.[0]?.nombre === 'ID', j(c.columnas('C1', 'HR', 'EMP')))
    check('el árbol NO las ve (le faltan partes)', !c.instantaneaArbol().detalles.has(clave), 'no en la instantánea')
    check('detalle() con las partes del árbol = null', c.detalle('C1', obj) === null, 'null')
    const pd = c.cargarDetalle('C1', obj, ['restricciones', 'columnas', 'indices'])
    check('pide las del árbol en orden canónico', j(f.llamadas[1].args[2]) === j(['columnas', 'indices', 'restricciones']), j(f.llamadas[1].args[2]))
    f.llamadas[1].resolver(ok({ columnas: cols.columnas, indices: [], restricciones: [] }))
    await pd
    check('ahora el árbol lo ve', c.instantaneaArbol().detalles.has(clave), 'en la instantánea')
    const n = f.llamadas.length
    await c.cargarColumnas('C1', 'HR', 'EMP')
    check('columnas ya cubiertas: no viaja', f.llamadas.length === n, `llamadas=${f.llamadas.length - n}`)
  }
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const clave = claveBd.objeto('C1', 'HR', 'tabla', 'EMP')
    const p = c.cargarColumnas('C1', 'HR', 'EMP')
    f.llamadas[0].resolver({ ok: false, error: { motivo: 'servidor', mensaje: 'ORA-00942' } })
    const r = await p
    check('un fallo de solo columnas se devuelve', !r.ok, j(r))
    check('pero no se pinta en el árbol', c.error(clave) === null, 'sin error de nodo')
  }
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const obj = { esquema: 'HR', nombre: 'V', tipo: 'vista' as const }
    const p = c.cargarDetalle('C1', obj, ['columnas'])
    f.llamadas[0].resolver(ok({ columnas: [] }))
    await p
    check('una vista solo necesita columnas: el árbol la ve', c.instantaneaArbol().detalles.has(claveBd.objeto('C1', 'HR', 'vista', 'V')), 'vista')
    check('columnas() la encuentra sin saber el tipo', c.columnas('C1', 'HR', 'V') !== null, 'vista')
  }

  // ---------------------------------------------------------------------------
  hr('(9) errores del índice de nombres: 30 s')
  {
    let ahora = 1_000
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api, () => ahora)
    const p = c.cargarNombres('C1', 'HR')
    f.llamadas[0].resolver({ ok: false, error: { motivo: 'servidor', mensaje: 'VPN' } })
    await p
    const r2 = await c.cargarNombres('C1', 'HR')
    check('dentro de 30 s: el mismo error sin viajar', !r2.ok && f.llamadas.length === 1, `llamadas=${f.llamadas.length}`)
    ahora += ERROR_NOMBRES_MS
    void c.cargarNombres('C1', 'HR')
    check('pasados 30 s: vuelve a preguntar', f.llamadas.length === 2, `llamadas=${f.llamadas.length}`)
  }

  // ---------------------------------------------------------------------------
  hr('(10) índice desplegado')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const indice: DbIndiceNombres = {
      esquemas: ['HR', 'VENTAS'],
      objetos: [
        ['EMP', 0, 'tabla'],
        ['DEPT', 0, 'tabla'],
        ['FACTURAS', 1, 'vista'],
        ['ROTO', 7, 'tabla']
      ],
      porDefecto: 'HR'
    }
    const p = c.cargarNombres('C1', 'HR')
    f.llamadas[0].resolver(ok(indice))
    await p
    const todos = c.objetosIndexados('C1', 'HR', null)
    const hr2 = c.objetosIndexados('C1', 'HR', 'HR')
    check('todos (sin el índice roto)', todos.length === 3, j(todos.map((o) => o.nombre)))
    check('por esquema', hr2.length === 2 && hr2[0].esquema === 'HR', j(hr2))
    check('memorizado (misma identidad)', c.objetosIndexados('C1', 'HR', null) === todos, 'identidad')
    check('sin índice: []', c.objetosIndexados('C1', 'OTRO', null).length === 0, '[]')
    check('esquema por defecto desde el índice', c.esquemaPorDefecto('C1') === 'HR', j(c.esquemaPorDefecto('C1')))
  }

  // ---------------------------------------------------------------------------
  hr('(11) respuestas raras')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const p = c.cargarEsquemas('C1')
    f.llamadas[0].resolver(undefined)
    const r = await p
    check('undefined -> interno', !r.ok && r.error.motivo === 'interno', j(r))
    const p2 = c.cargarResolucion('C1', 'HR', 'S')
    f.llamadas[1].rechazar(new Error("Error invoking remote method 'dbx:objeto:resolver': Error: boom"))
    const r2 = await p2
    check('un invoke que lanza -> mensaje limpio', !r2.ok && r2.error.mensaje === 'boom', j(r2))
  }

  // ---------------------------------------------------------------------------
  hr('(12) instantánea e integración con el aplanador')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const i1 = c.instantaneaArbol()
    check('misma identidad sin cambios', c.instantaneaArbol() === i1, 'identidad')
    const con: DbConnection = {
      id: 'C1',
      profileId: 'P',
      alias: 'QA',
      motor: 'oracle',
      host: 'h',
      port: 1521,
      user: 'u',
      tieneSecreto: true,
      readonly: true
    }
    const entrada = () => ({
      ...c.instantaneaArbol(),
      conexiones: [con],
      consolas: [],
      expandidos: new Set([claveBd.conexion('C1')])
    })
    const pend = cargasPendientes(aplanarArbolBd(entrada()))
    check('conexión desplegada sin datos pide sus esquemas', pend.length === 1 && pend[0].tipo === 'esquemas', j(pend))
    const p = c.cargar(pend[0])
    f.llamadas[0].resolver(ok(RESP_ESQ))
    await p
    const filas = aplanarArbolBd(entrada())
    check(
      'con los esquemas cargados, el árbol pinta el visible (HR) y no pide más',
      filas.some((x) => x.kind === 'esquema' && x.esquema === 'HR') && cargasPendientes(filas).length === 0,
      j(filas.map((x) => x.kind))
    )
    check('la instantánea cambió de identidad', c.instantaneaArbol() !== i1, 'identidad')
  }

  // ---------------------------------------------------------------------------
  hr('(13) claves ajenas')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const emp = { esquema: 'HR', nombre: 'EMP', tipo: 'tabla' as const }
    const rel: DbRelacionesFk = {
      salientes: [{ nombre: 'FK_DEPT', desde: { esquema: 'HR', tabla: 'EMP', columnas: ['DEPTNO'] }, hacia: { esquema: 'HR', tabla: 'DEPT', columnas: ['DEPTNO'] } }],
      entrantes: []
    }
    const p1 = c.cargarFks('C1', emp)
    const p2 = c.cargarFks('C1', emp)
    check('dos a la vez: un viaje, con el objeto (y su tipo)', f.llamadas.length === 1 && j(f.llamadas[0].args) === j(['C1', emp]), j(f.llamadas.map((l) => l.args)))
    check('antes de llegar: null', c.fks('C1', 'HR', 'EMP') === null, 'null')
    f.llamadas[0].resolver(ok(rel))
    await Promise.all([p1, p2])
    check('llegó: se lee', j(c.fks('C1', 'HR', 'EMP')) === j(rel), j(c.fks('C1', 'HR', 'EMP')))
    await c.cargarFks('C1', emp)
    check('fresco: no vuelve a viajar', f.llamadas.length === 1, String(f.llamadas.length))

    f.emitir({ conexionId: 'C1', motivo: 'esquemas' })
    await c.cargarFks('C1', emp)
    check('fijar los esquemas visibles NO las invalida', f.llamadas.length === 1, String(f.llamadas.length))
    f.emitir({ conexionId: 'C2', esquema: 'HR', motivo: 'ddl' })
    await c.cargarFks('C1', emp)
    check('un DDL de OTRA conexión tampoco', f.llamadas.length === 1, String(f.llamadas.length))
    f.emitir({ conexionId: 'C1', esquema: 'VENTAS', motivo: 'ddl' })
    check('un DDL en OTRO esquema de la conexión sí (la FK entrante puede venir de allí)', c.obsoleta(['fks', 'C1', 'HR', 'EMP'].join(String.fromCharCode(0))), 'obsoleta')
    check('pero se sigue leyendo mientras (stale-while-revalidate)', c.fks('C1', 'HR', 'EMP') !== null, 'se lee')
    const p3 = c.cargarFks('C1', emp)
    check('y la siguiente carga viaja', f.llamadas.length === 2, String(f.llamadas.length))
    f.llamadas[1].resolver({ ok: false, error: { motivo: 'servidor', mensaje: 'ORA-12170' } })
    const r3 = await p3
    check('un error se devuelve…', !r3.ok, j(r3))
    const claveArbol = claveBd.objeto('C1', 'HR', 'tabla', 'EMP')
    check('…y no se pinta en el árbol (ni con la clave de las FKs)', c.error(claveArbol) === null && c.instantaneaArbol().errores.size === 0, j([...c.instantaneaArbol().errores.keys()]))
  }
  {
    // Lo que el autocompletado pregunta para RECARGAR lo obsoleto (revisión de la fase
    // 2: sin esto nadie volvía a pedir las FKs tras un DDL, y «Expandir columnas» usaba
    // columnas de antes de un ALTER TABLE … ADD).
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    const emp = { esquema: 'HR', nombre: 'EMP', tipo: 'tabla' as const }
    check('sin nada cargado: ni FKs ni columnas obsoletas', !c.fksObsoletas('C1', 'HR', 'EMP') && !c.columnasObsoletas('C1', 'HR', 'EMP'), 'false')
    const pf = c.cargarFks('C1', emp)
    const pc = c.cargarColumnas('C1', 'HR', 'EMP')
    f.llamadas[0].resolver(ok({ salientes: [], entrantes: [] }))
    f.llamadas[1].resolver(ok({ columnas: [{ nombre: 'ID', posicion: 1, tipo: 'NUMBER', nullable: false, pk: 1 }] }))
    await Promise.all([pf, pc])
    check('recién cargadas: al día', !c.fksObsoletas('C1', 'HR', 'EMP') && !c.columnasObsoletas('C1', 'HR', 'EMP'), 'false')
    f.emitir({ conexionId: 'C1', esquema: 'VENTAS', motivo: 'ddl' })
    check('DDL en otro esquema: FKs obsoletas, las columnas de HR no', c.fksObsoletas('C1', 'HR', 'EMP') && !c.columnasObsoletas('C1', 'HR', 'EMP'), 'fks')
    f.emitir({ conexionId: 'C1', esquema: 'HR', motivo: 'ddl' })
    check('DDL en HR: las columnas también (las que lee columnas(), sin saber el tipo)', c.columnasObsoletas('C1', 'HR', 'EMP') && c.columnas('C1', 'HR', 'EMP') !== null, 'columnas')
  }

  // ---------------------------------------------------------------------------
  hr('(14) PASO 3, nivel «Bases»: la base viaja como último argumento y SOLO si la hay')
  {
    const f = crearFalsa()
    const c = new CacheMetaBd(f.api)
    // Sin base: las llamadas de siempre, con los argumentos de siempre.
    void c.cargarEsquemas('C1')
    void c.cargarResumen('C1', 'HR')
    void c.cargarObjetos('C1', 'HR', 'tabla')
    void c.cargarNombres('C1', 'HR')
    check(
      'sin base: argumentos de siempre (ni un undefined de más)',
      j(f.llamadas.map((l) => [l.canal, l.args.length])) === j([['esquemas', 1], ['resumen', 2], ['objetos', 3], ['nombres', 2]]),
      j(f.llamadas.map((l) => [l.canal, l.args]))
    )
    const n0 = f.llamadas.length
    const pB = c.cargarBases('S1')
    void c.cargarEsquemas('S1', 'ventas')
    void c.cargarResumen('S1', 'dbo', 'ventas')
    void c.cargarObjetos('S1', 'dbo', 'tabla', 'ventas')
    void c.cargarNombres('S1', null, 'ventas')
    void c.cargarColumnas('S1', 'dbo', 't', 'tabla', 'ventas')
    const nuevas = f.llamadas.slice(n0)
    check(
      'con base: bases, y la base como ÚLTIMO argumento de cada canal',
      j(nuevas.map((l) => [l.canal, l.args])) ===
        j([
          ['bases', ['S1']],
          ['esquemas', ['S1', false, 'ventas']],
          ['resumen', ['S1', 'dbo', false, 'ventas']],
          ['objetos', ['S1', 'dbo', 'tabla', false, 'ventas']],
          ['nombres', ['S1', null, false, 'ventas']],
          ['detalle', ['S1', { esquema: 'dbo', nombre: 't', tipo: 'tabla', base: 'ventas' }, ['columnas']]]
        ]),
      j(nuevas.map((l) => [l.canal, l.args]))
    )
    const BASES = {
      bases: [{ nombre: 'ventas', sistema: false, visible: true, porDefecto: true, accesible: true }],
      porDefecto: 'ventas',
      config: { modo: 'lista' as const, porDefecto: true, esquemas: [] },
      nVisibles: 1
    }
    nuevas[0].resolver(ok(BASES))
    nuevas[1].resolver(ok(RESP_ESQ))
    nuevas[2].resolver(ok({ tabla: 1 }))
    nuevas[5].resolver(ok({ columnas: [{ nombre: 'ID', posicion: 1, tipo: 'int', nullable: false, pk: 1 }] }))
    await pB
    await tick()
    check('las bases se guardan y se leen', c.bases('S1')?.porDefecto === 'ventas', j(c.bases('S1')))
    check('los esquemas de la base, en la clave de su nodo', c.esquemas('S1', 'ventas') === RESP_ESQ && c.esquemas('S1') === null, 'ok')
    const inst = c.instantaneaArbol()
    check('la instantánea trae las bases y los esquemas de la base', inst.bases.has(claveBd.bases('S1')) && inst.esquemas.has(claveBd.base('S1', 'ventas')), 'ok')
    check('el resumen de dbo en ventas, con su ámbito', c.resumen('S1', 'dbo', 'ventas')?.tabla === 1 && c.resumen('S1', 'dbo') === null, 'ok')
    check('las columnas de ventas.dbo.t, con su base (y no sin ella)', c.columnas('S1', 'dbo', 't', 'ventas')?.[0]?.nombre === 'ID' && c.columnas('S1', 'dbo', 't') === null, 'ok')
    // La carga del árbol por tipo.
    const n1 = f.llamadas.length
    void c.cargar({ tipo: 'bases', clave: claveBd.bases('S2'), conexionId: 'S2' })
    void c.cargar({ tipo: 'esquemas', clave: claveBd.base('S2', 'x'), conexionId: 'S2', base: 'x' })
    check('`cargar` entiende `bases` y la base de `esquemas`', j(f.llamadas.slice(n1).map((l) => [l.canal, l.args])) === j([['bases', ['S2']], ['esquemas', ['S2', false, 'x']]]), 'ok')
    // Invalidación: el evento no dice la base; se invalida ese esquema en TODAS, y lo de
    // una base con ese nombre (por si el main nombra la base de la sesión).
    f.emitir({ conexionId: 'S1', esquema: 'dbo', motivo: 'ddl' })
    check('un DDL en dbo invalida dbo de la base', c.obsoleta(claveBd.esquema('S1', 'dbo', 'ventas')), 'obsoleta')
    const f2 = crearFalsa()
    const c2 = new CacheMetaBd(f2.api)
    void c2.cargarResumen('S1', 'dbo', 'ventas')
    f2.llamadas[0].resolver(ok({ tabla: 1 }))
    await tick()
    f2.emitir({ conexionId: 'S1', esquema: 'ventas', motivo: 'ddl' })
    check('un evento que nombra la BASE invalida lo de esa base', c2.obsoleta(claveBd.esquema('S1', 'dbo', 'ventas')), 'obsoleta')
    const f3 = crearFalsa()
    const c3 = new CacheMetaBd(f3.api)
    void c3.cargarBases('S1')
    f3.llamadas[0].resolver(ok(BASES))
    await tick()
    f3.emitir({ conexionId: 'S1', motivo: 'esquemas' })
    check('motivo `esquemas`: la lista de bases queda obsoleta', c3.obsoleta(claveBd.bases('S1')), 'obsoleta')
  }

  // ---------------------------------------------------------------------------
  hr('(15) Las cargas de documentos y de claves van por SU api, no por DBX')
  {
    const f = crearFalsa()
    const llamadas: Array<{ canal: string; p: unknown; resolver: (r: unknown) => void }> = []
    const diferida = <T,>(canal: string, p: unknown): Promise<T> =>
      new Promise<T>((res) => llamadas.push({ canal, p, resolver: (r) => res(r as T) }))
    const familias: ApiFamiliasBd = {
      docBases: (p) => diferida('docBases', p),
      docColecciones: (p) => diferida('docColecciones', p),
      kvBases: (p) => diferida('kvBases', p),
      kvEscanear: (p) => diferida('kvEscanear', p)
    }
    const c = new CacheMetaBd(f.api, undefined, familias)
    void c.cargar({ tipo: 'docBases', clave: claveBd.docBases('M'), conexionId: 'M' })
    void c.cargar({ tipo: 'docBases', clave: claveBd.docBases('M'), conexionId: 'M' })
    void c.cargar({ tipo: 'colecciones', clave: claveBd.docBase('M', 'app'), conexionId: 'M', base: 'app' })
    void c.cargar({ tipo: 'kvBases', clave: claveBd.kvBases('R'), conexionId: 'R' })
    void c.cargar({ tipo: 'kvClaves', clave: claveBd.kvBase('R', 3), conexionId: 'R', base: 3 })
    check('ninguna sale por la api SQL (DBX)', f.llamadas.length === 0, j(f.llamadas.map((l) => l.canal)))
    check(
      'una llamada por carga (deduplicadas), con el objeto de petición del contrato',
      j(llamadas.map((l) => [l.canal, l.p])) ===
        j([
          ['docBases', { conexionId: 'M' }],
          ['docColecciones', { conexionId: 'M', base: 'app' }],
          ['kvBases', { conexionId: 'R' }],
          ['kvEscanear', { conexionId: 'R', base: 3, patron: '', cursor: '0', cuenta: CUENTA_ESCANEO }]
        ]),
      j(llamadas.map((l) => [l.canal, l.p]))
    )
    llamadas[0].resolver(ok([{ nombre: 'app' }]))
    llamadas[1].resolver(ok([{ nombre: 'pedidos', tipo: 'coleccion' }]))
    llamadas[2].resolver({ ok: false, error: { motivo: 'driver', mensaje: 'Todavía no se puede conectar.' } })
    llamadas[3].resolver(ok({ cursor: '0', claves: [], ms: 1 }))
    await tick()
    const inst = c.instantaneaArbol()
    check(
      'cada respuesta en su mapa de la instantánea, por la clave de su carga',
      j(inst.docBases.get(claveBd.docBases('M'))) === j([{ nombre: 'app' }]) &&
        j(inst.colecciones.get(claveBd.docBase('M', 'app'))) === j([{ nombre: 'pedidos', tipo: 'coleccion' }]) &&
        j(inst.kvClaves.get(claveBd.kvBase('R', 3))) === j({ cursor: '0', claves: [], ms: 1 }) &&
        inst.esquemas.size === 0 && inst.bases.size === 0,
      j({ docBases: [...inst.docBases.keys()].length, colecciones: [...inst.colecciones.keys()].length, kvClaves: [...inst.kvClaves.keys()].length })
    )
    check('un error se guarda en la clave de su carga (la fila de error del árbol)', inst.errores.get(claveBd.kvBases('R'))?.motivo === 'driver', j(inst.errores.get(claveBd.kvBases('R'))))
    f.emitir({ conexionId: 'M', motivo: 'refrescar' })
    check('«Refrescar» de la conexión las marca obsoletas, como a las SQL', c.obsoleta(claveBd.docBases('M')) && c.obsoleta(claveBd.docBase('M', 'app')), 'obsoletas')
    check('otra conexión, intacta', !c.obsoleta(claveBd.kvBase('R', 3)), 'fresca')
    // Sin la api de las familias (una caché hecha solo con la SQL): falla con su motivo.
    const sin = new CacheMetaBd(f.api)
    const r = await sin.cargar({ tipo: 'kvBases', clave: claveBd.kvBases('R'), conexionId: 'R' })
    check('sin api de familias: error «interno» con su mensaje, sin lanzar', !r.ok && r.error.motivo === 'interno', j(r))
  }

  await tick()

  // ---------------------------------------------------------------------------
  const pasadas = results.filter((r) => r.pass).length
  const allPass = pasadas === results.length
  hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
  process.exit(allPass ? 0 : 1)
}

void main()
