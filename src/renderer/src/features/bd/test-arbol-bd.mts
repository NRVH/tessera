#!/usr/bin/env node
// =============================================================================
// Prueba del árbol de BASES DE DATOS aplanado (npm run test:db-arbol): claves, insignia
// «N de M», orden y visibilidad, carpetas, detalle, marcadores y cargas, búsqueda, teclado,
// pestañas y «Mostrar en el árbol», el nivel «Bases» (con `nivelBasesBd`), el árbol de cada
// familia (documentos y claves, con su recorrido en `cacheMetaBd`) y que la entrada no se muta.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import {
  fuentePopover,
  nivelSelectorConsola,
  porDefectoSelector,
  sesionEsBase,
  TEXTOS_POPOVER,
  textosSelectorConsola
} from './nivelBasesBd.ts'
import {
  accionTecla,
  ambitoEsquema,
  ancestrosDe,
  aplanarArbolBd,
  partesAmbito,
  cargaDeConexion,
  cargasPendientes,
  esContenedor,
  claveBd,
  claveDePane,
  coincidenciaDe,
  conexionDeClave,
  indicePadre,
  normalizarBusqueda,
  paneDdlDeFila,
  paneDeFila,
  partesDetalle,
  type EntradaArbolBd,
  type FilaBd,
  type FilaObjeto
} from './arbolBd.ts'
import type {
  DbBasesRespuesta,
  DbConsolaInfo,
  DbConteos,
  DbDetalle,
  DbErrorSql,
  DbEsquemasRespuesta,
  DbObjeto,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { descriptor, type DescriptorClaves, type DescriptorDocumentos } from '../../../../shared/motores/index.ts'
import { metaColeccion, ordenarBasesDocumentos, raizDocumentos } from './arbolDocumentos.ts'
import {
  TEXTOS_CLAVES,
  acumularPagina,
  agruparClaves,
  basePorDefectoClaves,
  basesDeClaves,
  etiquetaBaseClaves,
  nombreClave,
  patronDeFiltro,
  escaparGlob,
  prefijosDeClave,
  recorrerClaves,
  textoSinCoincidencias,
  vistaCargarMas,
  type RecorridoClaves
} from './arbolClaves.ts'
import type { DbKvClave, DbKvEscanear, DbKvPaginaClaves, DbKvTipo } from '../../../../shared/db-claves-ipc.ts'
import type { DbEventoCatalogo, DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import { CacheMetaBd, type ApiCatalogoBd, type ApiFamiliasBd } from './cacheMetaBd.ts'

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
const legibleClave = (k: string): string => k.split('\u0000').join('/')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function conexion(id: string, alias: string, motor: 'oracle' | 'postgres', extra: Partial<DbConnection> = {}): DbConnection {
  return {
    id,
    profileId: 'p1',
    alias,
    motor,
    host: 'h',
    port: motor === 'oracle' ? 1521 : 5432,
    user: 'u',
    tieneSecreto: true,
    readonly: true,
    ...extra
  }
}
const C1 = conexion('c1', 'QA-REPLICA-DEMO', 'oracle', {
  esquemas: { modo: 'lista', porDefecto: true, esquemas: ['HR', 'SYS', 'PUBLIC'] },
  introspeccion: { totalEsquemas: 151, esquemaPorDefecto: 'ADMDEMO', en: 1 }
})
const C2 = conexion('c2', 'PG-LOCAL', 'postgres')
const C3 = conexion('c3', 'SIN-CONECTAR', 'oracle', {
  esquemas: { modo: 'lista', porDefecto: true, esquemas: ['A', 'B'] },
  introspeccion: { totalEsquemas: 116, esquemaPorDefecto: 'X', en: 1 }
})
const consolaInfo = (id: string, conexionId: string, nombre: string): DbConsolaInfo => ({
  id,
  perfilId: 'p1',
  conexionId,
  nombre,
  rutaRelativa: `consolas/${nombre}.sql`,
  modificadaEn: 0,
  bytes: 0
})
const CONSOLAS = [
  consolaInfo('k1', 'c1', 'consola_10'),
  consolaInfo('k2', 'c1', 'consola_2'),
  consolaInfo('k3', 'c2', 'consola_1'),
  consolaInfo('k4', 'huerfana', 'consola_3')
]
const RESP_C1: DbEsquemasRespuesta = {
  esquemas: [
    { nombre: 'ADMDEMO', sistema: false, visible: true, porDefecto: true },
    { nombre: 'HR', sistema: false, visible: true, porDefecto: false },
    { nombre: 'PUBLIC', sistema: false, visible: true, porDefecto: false, pseudo: true },
    { nombre: 'SYS', sistema: true, visible: true, porDefecto: false },
    { nombre: 'SYSTEM', sistema: true, visible: false, porDefecto: false },
    { nombre: 'VENTAS', sistema: false, visible: false, porDefecto: false }
  ],
  porDefecto: 'ADMDEMO',
  config: { modo: 'lista', porDefecto: true, esquemas: ['HR', 'SYS', 'PUBLIC'] },
  nVisibles: 4
}
const obj = (esquema: string, nombre: string, tipo: DbTipoObjeto, extra: Partial<DbObjeto> = {}): DbObjeto => ({
  esquema,
  nombre,
  tipo,
  ...extra
})
const CONTEOS = new Map<string, DbConteos>([
  [claveBd.esquema('c1', 'ADMDEMO'), { tabla: 27, vista: 4, vistaMaterializada: 0, paquete: 2, secuencia: 0, sinonimo: 3 }],
  [claveBd.esquema('c1', 'PUBLIC'), { sinonimo: 5000, tabla: 9 }]
])
const OBJETOS = new Map<string, readonly DbObjeto[]>([
  [
    claveBd.carpeta('c1', 'ADMDEMO', 'tabla'),
    [obj('ADMDEMO', 'APPLICATION', 'tabla'), obj('ADMDEMO', 'ES_CONFIG', 'tabla')]
  ],
  [claveBd.carpeta('c1', 'ADMDEMO', 'vista'), []]
])
const DETALLES = new Map<string, DbDetalle>([
  [
    claveBd.objeto('c1', 'ADMDEMO', 'tabla', 'APPLICATION'),
    {
      columnas: [
        { nombre: 'ID', posicion: 1, tipo: 'NUMBER(10)', nullable: false, pk: 1 },
        { nombre: 'NAME', posicion: 2, tipo: 'VARCHAR2(40 CHAR)', nullable: true, pk: null }
      ],
      indices: [],
      restricciones: [{ nombre: 'PK_APPLICATION', tipo: 'pk', columnas: ['ID'] }]
    }
  ]
])
const ERROR_HR: DbErrorSql = { mensaje: 'ORA-01031: privilegios insuficientes', motivo: 'servidor', codigo: 'ORA-01031' }
const ERROR_C2: DbErrorSql = {
  mensaje: 'Falta el cliente nativo',
  motivo: 'driver',
  requiereDriver: { packId: 'oracle-ic-19', motivo: 'Oracle 11.2 necesita el cliente Oracle 19' }
}
const ERRORES = new Map<string, DbErrorSql>([
  [claveBd.esquema('c1', 'HR'), ERROR_HR],
  [claveBd.conexion('c2'), ERROR_C2]
])

// ---------------------------------------------------------------------------
// (11) El nivel «Bases» (SQL Server sin base fija) y `nivelBasesBd`
// ---------------------------------------------------------------------------
function seccionNivelBases(): void {
  hr('(11) Nivel «Bases» (SQL Server sin base fija) y nivelBasesBd')
  const sqls = (id: string, extra: Partial<DbConnection> = {}): DbConnection => ({
    id,
    profileId: 'p1',
    alias: id.toUpperCase(),
    motor: 'sqlserver',
    host: 'h',
    port: 1433,
    user: 'u',
    tieneSecreto: true,
    readonly: true,
    ...extra
  })
  const S = sqls('s1', { bases: { modo: 'lista', porDefecto: true, esquemas: ['ventas', 'master', 'cerrada'] } })
  const F = sqls('s2', { database: 'pruebas' })
  const BASES: DbBasesRespuesta = {
    bases: [
      { nombre: 'master', sistema: true, visible: true, porDefecto: false, accesible: true },
      { nombre: 'pruebas', sistema: false, visible: true, porDefecto: true, accesible: true },
      { nombre: 'ventas', sistema: false, visible: true, porDefecto: false, accesible: true },
      { nombre: 'cerrada', sistema: false, visible: true, porDefecto: false, accesible: false },
      { nombre: 'otra', sistema: false, visible: false, porDefecto: false, accesible: true }
    ],
    porDefecto: 'pruebas',
    config: { modo: 'lista', porDefecto: true, esquemas: ['ventas', 'master', 'cerrada'] },
    nVisibles: 4
  }
  const ESQ_VENTAS: DbEsquemasRespuesta = {
    esquemas: [
      { nombre: 'dbo', sistema: false, visible: true, porDefecto: true, base: 'ventas' },
      { nombre: 'sys', sistema: true, visible: false, porDefecto: false, base: 'ventas' }
    ],
    porDefecto: 'dbo',
    config: { modo: 'lista' as const, porDefecto: true, esquemas: [] },
    nVisibles: 1
  }
  const kS = claveBd.conexion('s1')
  const kVentas = claveBd.base('s1', 'ventas')
  const kDbo = claveBd.esquema('s1', 'dbo', 'ventas')
  const kTablas = claveBd.carpeta('s1', 'dbo', 'tabla', 'ventas')
  const kT = claveBd.objeto('s1', 'dbo', 'tabla', 't', undefined, 'ventas')
  const e: EntradaArbolBd = {
    conexiones: [S, F],
    consolas: [],
    esquemas: new Map([[kVentas, ESQ_VENTAS]]),
    bases: new Map([[claveBd.bases('s1'), BASES]]),
    conteos: new Map([[kDbo, { tabla: 1 }]]),
    objetos: new Map([[kTablas, [{ esquema: 'dbo', nombre: 't', tipo: 'tabla' as const, base: 'ventas' }]]]),
    detalles: new Map(),
    errores: new Map(),
    expandidos: new Set([kS, kVentas, kDbo, kTablas, claveBd.base('s1', 'cerrada'), claveBd.conexion('s2')])
  }
  const filas = aplanarArbolBd(e)
  const vista = filas.map((f) => `${f.depth}:${etiqueta(f)}`)
  // La conexión sin base fija: bases visibles (normales antes que las del sistema), y de la
  // base desplegada SUS esquemas visibles (la configuración de esquemas de la conexión).
  const s1 = vista.slice(0, vista.indexOf('0:conexion:S2'))
  check(
    'sin base fija: conexión → bases visibles → esquemas → carpetas → objetos',
    j(s1) ===
      j([
        '0:conexion:S1',
        // La por defecto del login entra por «porDefecto: true» de la configuración.
        '1:base:pruebas',
        '1:base:ventas',
        '2:esquema:dbo',
        '3:carpeta:tabla(1)',
        '4:objeto:t',
        '1:base:cerrada(sin acceso)',
        '2:~empty',
        '1:base:master'
      ]),
    j(s1)
  )
  const vacioCerrada = filas.find((f) => f.kind === 'placeholder' && f.padre === claveBd.base('s1', 'cerrada'))
  check('la base sin acceso dice por qué', vacioCerrada?.kind === 'placeholder' && vacioCerrada.mensaje === 'Sin acceso a esta base', j(vacioCerrada))
  const fs1 = filas[0]
  check('la insignia de la conexión cuenta BASES (4 de 5)', fs1.kind === 'conexion' && fs1.nivelBases === true && j(fs1.insignia) === j({ n: 4, m: 5 }), j(fs1.kind === 'conexion' ? fs1.insignia : null))
  const fVentas = filas.find((f) => f.kind === 'base' && f.base === 'ventas')
  check('la base lleva el «N de M» de SUS esquemas (1 de 2)', fVentas?.kind === 'base' && j(fVentas.insignia) === j({ n: 1, m: 2 }), j(fVentas))
  const fObj = filas.find((f): f is FilaObjeto => f.kind === 'objeto')
  check('el objeto lleva su base y su clave con el ámbito', fObj?.base === 'ventas' && fObj.key === kT, fObj ? legibleClave(fObj.key) : 'null')
  // Con base fija: el árbol de PG (esquemas, sin nivel «Bases»), y la carga es la de esquemas.
  const s2 = filas.slice(filas.findIndex((f) => f.kind === 'conexion' && f.conexionId === 's2'))
  check(
    'con base fija: como PG (la conexión pide esquemas, sin nivel «Bases»)',
    s2.length === 2 && s2[0].kind === 'conexion' && s2[0].nivelBases === undefined && s2[1].kind === 'placeholder' && s2[1].carga?.tipo === 'esquemas',
    j(s2.map((f) => f.kind))
  )
  // Las cargas: la lista de bases en su clave; los esquemas de una base con su base.
  const sinLista = aplanarArbolBd({ ...e, bases: new Map(), expandidos: new Set([kS]) })
  const cargas = cargasPendientes(sinLista)
  check('sin la lista: la conexión pide `bases` (en claveBd.bases)', j(cargas) === j([{ tipo: 'bases', clave: claveBd.bases('s1'), conexionId: 's1' }]), j(cargas))
  const sinEsq = aplanarArbolBd({ ...e, esquemas: new Map(), expandidos: new Set([kS, kVentas]) })
  check(
    'sin los esquemas de la base: los pide con su base',
    j(cargasPendientes(sinEsq)) === j([{ tipo: 'esquemas', clave: kVentas, conexionId: 's1', base: 'ventas' }]),
    j(cargasPendientes(sinEsq))
  )
  const sinConteos = aplanarArbolBd({ ...e, conteos: new Map(), expandidos: new Set([kS, kVentas, kDbo]) })
  check(
    'el resumen de un esquema de una base lleva la base',
    j(cargasPendientes(sinConteos)) === j([{ tipo: 'resumen', clave: kDbo, conexionId: 's1', esquema: 'dbo', base: 'ventas' }]),
    j(cargasPendientes(sinConteos))
  )
  // La base sin acceso NO pide su catálogo.
  check('una base sin acceso no pide nada', !cargasPendientes(filas).some((c) => c.clave === claveBd.base('s1', 'cerrada')), 'ok')

  // Claves: la de siempre sin base (al byte) y distinta con ella; `dbo` de dos bases, dos nodos.
  check('sin base: la clave de siempre', claveBd.esquema('c1', 'HR') === claveBd.esquema('c1', 'HR', undefined), legibleClave(claveBd.esquema('c1', 'HR')))
  check('dbo de dos bases: dos claves distintas', claveBd.objeto('s1', 'dbo', 'tabla', 't', undefined, 'a') !== claveBd.objeto('s1', 'dbo', 'tabla', 't', undefined, 'b'), 'distintas')
  check('la base no mueve la conexión de sitio (conexionDeClave)', conexionDeClave(kT) === 's1', String(conexionDeClave(kT)))
  check('ámbito ida y vuelta', j(partesAmbito(ambitoEsquema('dbo', 'ventas'))) === j({ base: 'ventas', esquema: 'dbo' }) && j(partesAmbito('HR')) === j({ esquema: 'HR' }), 'ok')

  // Panes: la base viaja con la pestaña; sin base, la pestaña de siempre.
  const pane = fObj ? paneDeFila(fObj) : null
  check('abrir la tabla: pane de datos CON su base', j(pane) === j({ kind: 'datos', conexionId: 's1', esquema: 'dbo', objeto: 't', tipo: 'tabla', base: 'ventas' }), j(pane))
  check('claveDePane vuelve a la fila', pane !== null && claveDePane(pane) === kT, pane ? legibleClave(claveDePane(pane)) : 'null')
  check(
    'ancestros: conexión, BASE, esquema y carpeta',
    pane !== null && j(ancestrosDe(pane)) === j([kS, kVentas, kDbo, kTablas]),
    pane ? j(ancestrosDe(pane).map(legibleClave)) : 'null'
  )
  const ddl = fObj ? paneDdlDeFila(fObj) : null
  check('«Ver DDL» también lleva la base', ddl?.kind === 'fuente' && ddl.base === 'ventas' && ddl.modo === 'ddl', j(ddl))
  check('una base es contenedor (se despliega)', fVentas !== undefined && accionTecla(fVentas, 'dcha') === 'nada', 'ya abierta')

  // --- nivelBasesBd ---
  check('popover de esquemas: clave y carga de siempre', j(fuentePopover('c1', 'esquemas')) === j({ clave: claveBd.conexion('c1'), carga: { tipo: 'esquemas', clave: claveBd.conexion('c1'), conexionId: 'c1' } }), 'ok')
  check('popover de bases: su clave y su carga', j(fuentePopover('s1', 'bases').carga) === j({ tipo: 'bases', clave: claveBd.bases('s1'), conexionId: 's1' }), 'ok')
  check('popover de esquemas de UNA base', j(fuentePopover('s1', 'esquemas', 'ventas').carga) === j({ tipo: 'esquemas', clave: kVentas, conexionId: 's1', base: 'ventas' }), 'ok')
  const te = TEXTOS_POPOVER.esquemas
  check(
    'textos del popover de esquemas: los de siempre, al byte',
    te.cabecera === 'Esquemas de' && te.filtrar === 'Filtrar esquemas' && te.cargando === 'Cargando esquemas…' && te.todos === 'Todos los esquemas' && te.ninguno === 'Ningún esquema coincide.' && te.delSistema === 'esquema del sistema' && te.lista === 'Esquemas' && te.visibles === 'Esquemas visibles',
    j(te)
  )
  check('los de bases hablan de bases', /bases/i.test(TEXTOS_POPOVER.bases.cabecera + TEXTOS_POPOVER.bases.todos) && !/esquema/i.test(j(TEXTOS_POPOVER.bases)), j(TEXTOS_POPOVER.bases))
  check('selector de consola: Oracle y PG eligen esquema', nivelSelectorConsola({ motor: 'oracle' }) === 'esquema' && nivelSelectorConsola({ motor: 'postgres', database: 'x' }) === 'esquema', 'esquema')
  check('SQL Server sin base: elige la BASE', nivelSelectorConsola({ motor: 'sqlserver' }) === 'base' && nivelSelectorConsola({ motor: 'sqlserver', database: '  ' }) === 'base', 'base')
  check('SQL Server con base fija: nada que elegir', nivelSelectorConsola({ motor: 'sqlserver', database: 'pruebas' }) === 'fija', 'fija')
  const tEsq = textosSelectorConsola('esquema')
  check(
    'textos del selector de esquema: los de siempre',
    tEsq.deLaConexion('HR') === 'Esquema de la conexión (HR)' && tEsq.tituloBoton('HR', false) === 'Esquema: HR. Pulsa para cambiar' && tEsq.datoActual('HR') === 'Esquema actual: HR' && tEsq.cambiando === 'Cambiando el esquema…' && tEsq.etiquetaBoton(null) === 'Esquema de la consola',
    'ok'
  )
  check('selector de base: «Base de la conexión (X)» y USE', textosSelectorConsola('base').deLaConexion('pruebas') === 'Base de la conexión (pruebas)' && textosSelectorConsola('base').tituloBoton('x', false).includes('USE'), 'ok')
  check('por defecto sin sesión, esquema: el del árbol', porDefectoSelector('esquema', { introspeccion: { esquemaPorDefecto: 'ADMDEMO' } }, 'no') === 'ADMDEMO', 'ADMDEMO')
  check('por defecto sin sesión, base: la del login (lista de bases)', porDefectoSelector('base', { introspeccion: { esquemaPorDefecto: 'dbo' } }, 'pruebas') === 'pruebas', 'pruebas')
  check('por defecto sin sesión, fija: la de la conexión (nunca «dbo»)', porDefectoSelector('fija', { database: ' pruebas ', introspeccion: { esquemaPorDefecto: 'dbo' } }, null) === 'pruebas', 'pruebas')
  check('la sesión relee la BASE solo en SQL Server', sesionEsBase('sqlserver') && !sesionEsBase('oracle') && !sesionEsBase('postgres') && !sesionEsBase('sqlite'), 'ok')
}

// ---------------------------------------------------------------------------
// (12) UN ÁRBOL POR FAMILIA (documentos y claves)
// ---------------------------------------------------------------------------
function conexionDe(id: string, alias: string, motor: 'mongodb' | 'redis', extra: Partial<DbConnection> = {}): DbConnection {
  return {
    id,
    profileId: 'p1',
    alias,
    motor,
    host: 'h',
    port: motor === 'mongodb' ? 27017 : 6379,
    user: '',
    tieneSecreto: false,
    readonly: true,
    ...extra
  }
}

function seccionFamilias(): void {
  hr('(12) un árbol por FAMILIA (qué pide cada una y cómo se pinta)')
  const M1 = conexionDe('m1', 'MONGO-DEV', 'mongodb')
  const M2 = conexionDe('m2', 'MONGO-APP', 'mongodb', { database: ' app ' })
  const R1 = conexionDe('r1', 'REDIS-DEV', 'redis', { database: '1' })
  const vacia = (conexiones: DbConnection[], expandidos: string[], extra: Partial<EntradaArbolBd> = {}): EntradaArbolBd => ({
    conexiones,
    consolas: [],
    esquemas: new Map(),
    conteos: new Map(),
    objetos: new Map(),
    detalles: new Map(),
    errores: new Map(),
    expandidos: new Set(expandidos),
    ...extra
  })
  const TIPOS_SQL = ['esquemas', 'bases', 'resumen', 'objetos', 'detalle']

  // --- Qué pide cada familia al desplegar la conexión ---
  const todas = [C2, M1, M2, R1]
  const cargas = cargasPendientes(aplanarArbolBd(vacia(todas, todas.map((c) => claveBd.conexion(c.id)))))
  const porConexion = new Map(cargas.map((c) => [c.conexionId, c]))
  check('SQL (PG): pide sus esquemas, lo de siempre', j(porConexion.get('c2')) === j({ tipo: 'esquemas', clave: claveBd.conexion('c2'), conexionId: 'c2' }), j(porConexion.get('c2')))
  check('documentos sin base: pide las BASES por su contrato', j(porConexion.get('m1')) === j({ tipo: 'docBases', clave: claveBd.docBases('m1'), conexionId: 'm1' }), j(porConexion.get('m1')))
  check(
    'documentos con base fija: pide las COLECCIONES de esa base (recortada)',
    j(porConexion.get('m2')) === j({ tipo: 'colecciones', clave: claveBd.docBase('m2', 'app'), conexionId: 'm2', base: 'app' }),
    j(porConexion.get('m2'))
  )
  check('claves: pide las bases numeradas', j(porConexion.get('r1')) === j({ tipo: 'kvBases', clave: claveBd.kvBases('r1'), conexionId: 'r1' }), j(porConexion.get('r1')))
  const sqlDeOtras = cargas.filter((c) => c.conexionId !== 'c2' && TIPOS_SQL.includes(c.tipo))
  check('NEGATIVO: documentos y claves no piden NADA del catálogo SQL', sqlDeOtras.length === 0, j(sqlDeOtras))
  check('cada conexión pide exactamente una carga', cargas.length === 4, `${cargas.length} cargas`)
  check(
    '`cargaDeConexion` (el refresco) dice lo mismo que el marcador',
    todas.every((c) => j(cargaDeConexion(c)) === j(porConexion.get(c.id))),
    'igual en las cuatro'
  )
  const filaConexionM1 = aplanarArbolBd(vacia([M1], []))[0]
  check('la fila de una conexión de documentos: sin insignia ni nivel «Bases» SQL', filaConexionM1.kind === 'conexion' && filaConexionM1.insignia === null && filaConexionM1.nivelBases === undefined, j(filaConexionM1))

  // --- Documentos: bases -> colecciones ---
  const colsApp = [
    { nombre: 'zeta', tipo: 'coleccion' as const, documentosEstimados: 1234 },
    { nombre: 'alfa', tipo: 'vista' as const },
    { nombre: 'pedidos10', tipo: 'coleccion' as const },
    { nombre: 'pedidos9', tipo: 'serieTemporal' as const }
  ]
  const conDatos = vacia([M1], [claveBd.conexion('m1'), claveBd.docBase('m1', 'app')], {
    docBases: new Map([[claveBd.docBases('m1'), [{ nombre: 'app' }, { nombre: 'admin' }]]]),
    colecciones: new Map([[claveBd.docBase('m1', 'app'), colsApp]])
  })
  const filasDoc = aplanarArbolBd(conDatos)
  check(
    'documentos: bases en su orden y colecciones por nombre (natural), con su dato',
    j(resumen(filasDoc)) === j(['0|conexion:MONGO-DEV', '1|docBase:app', '2|coleccion:alfa', '2|coleccion:pedidos9', '2|coleccion:pedidos10', '2|coleccion:zeta', '1|docBase:admin']),
    j(resumen(filasDoc))
  )
  const metas = filasDoc.flatMap((f) => (f.kind === 'coleccion' ? [f.meta] : []))
  check('el dato de cada colección: el tipo, o los documentos estimados', j(metas) === j(['vista', 'serie temporal', null, `~${(1234).toLocaleString('es-ES')}`]), j(metas))
  const colAlfa = filasDoc.find((f) => f.kind === 'coleccion')
  // La colección abre su pestaña de documentos con Enter / doble clic.
  const paneAlfa = colAlfa ? paneDeFila(colAlfa) : null
  check(
    'una colección es una hoja que abre su pestaña de colección',
    colAlfa !== undefined &&
      !esContenedor(colAlfa) &&
      j(paneAlfa) === j({ kind: 'coleccion', conexionId: 'm1', base: 'app', coleccion: 'alfa' }) &&
      accionTecla(colAlfa, 'abrir') === 'abrir',
    j(paneAlfa)
  )
  check(
    '«Mostrar en el árbol» de una colección: su fila y, delante, la conexión y la base',
    paneAlfa !== null &&
      claveDePane(paneAlfa) === claveBd.coleccion('m1', 'app', 'alfa') &&
      j(ancestrosDe(paneAlfa)) === j([claveBd.conexion('m1'), claveBd.docBase('m1', 'app')]),
    paneAlfa ? j(ancestrosDe(paneAlfa)) : 'sin pane'
  )
  const cargasDoc = cargasPendientes(aplanarArbolBd({ ...conDatos, expandidos: new Set([claveBd.conexion('m1'), claveBd.docBase('m1', 'admin')]) }))
  check(
    'desplegar una base sin colecciones cargadas pide las suyas',
    j(cargasDoc) === j([{ tipo: 'colecciones', clave: claveBd.docBase('m1', 'admin'), conexionId: 'm1', base: 'admin' }]),
    j(cargasDoc)
  )
  const colsFija = aplanarArbolBd(vacia([M2], [claveBd.conexion('m2')], { colecciones: new Map([[claveBd.docBase('m2', 'app'), [colsApp[1]]]]) }))
  check('con base fija, las colecciones cuelgan de la conexión', j(resumen(colsFija)) === j(['0|conexion:MONGO-APP', '1|coleccion:alfa']), j(resumen(colsFija)))
  const sinCols = aplanarArbolBd(vacia([M2], [claveBd.conexion('m2')], { colecciones: new Map([[claveBd.docBase('m2', 'app'), []]]) }))
  check('una base sin colecciones lo dice', sinCols[1]?.kind === 'placeholder' && sinCols[1].variante === 'empty' && sinCols[1].mensaje === 'Sin colecciones', j(sinCols[1]))
  const buscada = aplanarArbolBd({ ...conDatos, expandidos: new Set(), filtro: 'zet' })
  check('la búsqueda encuentra una colección y abre su cadena', j(resumen(buscada)) === j(['0|conexion:MONGO-DEV', '1|docBase:app', '2|coleccion:zeta']), j(resumen(buscada)))

  // --- El error de hoy (el esqueleto del main) se pinta como el de una conexión SQL ---
  const errDriver: DbErrorSql = { motivo: 'driver', mensaje: 'Todavía no se puede conectar a MongoDB desde esta versión.' }
  const conError = aplanarArbolBd(vacia([M1], [claveBd.conexion('m1')], { errores: new Map([[claveBd.docBases('m1'), errDriver]]) }))
  const filaErr = conError[1]
  check(
    'documentos con error: fila de error con su mensaje y «Reintentar» de la misma carga',
    filaErr?.kind === 'placeholder' && filaErr.variante === 'error' && filaErr.mensaje === errDriver.mensaje && j(filaErr.reintentar) === j(cargaDeConexion(M1)),
    j(filaErr)
  )
  check('y el error no se vuelve a pedir solo', cargasPendientes(conError).length === 0, j(cargasPendientes(conError)))

  // --- Claves: bases numeradas -> claves ---
  const errKv: DbErrorSql = { motivo: 'driver', mensaje: 'Todavía no se puede conectar a Redis desde esta versión.' }
  const kvError = aplanarArbolBd(vacia([R1], [claveBd.conexion('r1')], { errores: new Map([[claveBd.kvBases('r1'), errKv]]) }))
  const basesError = kvError.filter((f) => f.kind === 'kv-base')
  const ultima = kvError[kvError.length - 1]
  check(
    'claves con la lista fallida: las 16 del descriptor, sin conteo, y DETRÁS el error',
    basesError.length === 16 && basesError.every((f) => f.kind === 'kv-base' && f.claves === null) && ultima.kind === 'placeholder' && ultima.variante === 'error' && j(ultima.reintentar) === j(cargaDeConexion(R1)),
    `${basesError.length} bases; último: ${j(ultima)}`
  )
  check('la base por defecto es la del campo `database` (1)', basesError.filter((f) => f.kind === 'kv-base' && f.porDefecto).map((f) => (f.kind === 'kv-base' ? f.indice : -1)).join() === '1', 'db1')
  const resp = { total: 3, totalDelServidor: true, conClaves: [{ indice: 1, claves: 2, caducan: 0 }] }
  const kvOk = aplanarArbolBd(vacia([R1], [claveBd.conexion('r1'), claveBd.kvBase('r1', 0), claveBd.kvBase('r1', 1)], { kvBases: new Map([[claveBd.kvBases('r1'), resp]]) }))
  check(
    'claves: el total del servidor, sus conteos; la vacía dice «Sin claves» sin pedir nada; la otra pide su página',
    j(resumen(kvOk)) === j(['0|conexion:REDIS-DEV', '1|kvBase:0(0)', '2|~empty', '1|kvBase:1(2)', '2|~loading', '1|kvBase:2(0)']) &&
      j(cargasPendientes(kvOk)) === j([{ tipo: 'kvClaves', clave: claveBd.kvBase('r1', 1), conexionId: 'r1', base: 1 }]),
    `${j(resumen(kvOk))} ${j(cargasPendientes(kvOk))}`
  )
  // `conteosDesconocidos`: ninguna base con cifra, y se recorren TODAS.
  const respSinConteos = { total: 2, totalDelServidor: false, conClaves: [], conteosDesconocidos: true as const }
  const kvSinConteos = aplanarArbolBd(vacia([R1], [claveBd.conexion('r1'), claveBd.kvBase('r1', 0)], { kvBases: new Map([[claveBd.kvBases('r1'), respSinConteos]]) }))
  check(
    'conteos desconocidos: las bases sin cifra (no «0») y la desplegada pide su recorrido (no «Sin claves»)',
    j(resumen(kvSinConteos)) === j(['0|conexion:REDIS-DEV', '1|kvBase:0(?)', '2|~loading', '1|kvBase:1(?)']) &&
      j(cargasPendientes(kvSinConteos)) === j([{ tipo: 'kvClaves', clave: claveBd.kvBase('r1', 0), conexionId: 'r1', base: 0 }]),
    `${j(resumen(kvSinConteos))} ${j(cargasPendientes(kvSinConteos))}`
  )

  // El recorrido, agrupado en carpetas por `:`.
  const clavePag = (texto: string | null, base64: string, tipo: DbKvTipo = 'string'): DbKvClave =>
    texto === null ? { nombre: { base64 }, tipo, ttlMs: null } : { nombre: { texto, base64 }, tipo, ttlMs: null }
  const pagina: DbKvPaginaClaves = {
    cursor: '17',
    ms: 1,
    claves: [
      clavePag('usuario:2', 'dXN1YXJpbzoy', 'hash'),
      clavePag(null, '/w=='),
      { nombre: { texto: 'a', base64: 'YQ==' }, tipo: 'otro', tipoServidor: 'TSDB-TYPE', ttlMs: null },
      clavePag('usuario:10', 'dXN1YXJpbzoxMA=='),
      clavePag('usuario:1:perfil', 'dXN1YXJpbzoxOnBlcmZpbA=='),
      // Repetida (SCAN puede devolver una clave dos veces): no sale dos veces.
      clavePag('usuario:2', 'dXN1YXJpbzoy', 'hash')
    ]
  }
  const recorrido = acumularPagina(null, pagina, '').recorrido
  const conRecorrido = (expandidos: string[], extra: Partial<EntradaArbolBd> = {}): FilaBd[] =>
    aplanarArbolBd(
      vacia([R1], [claveBd.conexion('r1'), claveBd.kvBase('r1', 1), ...expandidos], {
        kvBases: new Map([[claveBd.kvBases('r1'), resp]]),
        kvClaves: new Map([[claveBd.kvBase('r1', 1), recorrido]]),
        ...extra
      })
    )
  const deLaBase = (filas: FilaBd[]): FilaBd[] =>
    filas.slice(filas.findIndex((f) => f.kind === 'kv-base' && f.indice === 1) + 1, filas.findIndex((f) => f.kind === 'kv-base' && f.indice === 2))
  const kvPag = conRecorrido([])
  check(
    'carpetas por «:» delante (con sus claves cargadas), después las claves (nombre pintado, bytes con escapes), sin repetir, y «Cargar más» al final',
    j(resumen(deLaBase(kvPag))) === j(['2|kvCarpeta:usuario:(3)', '2|kvClave:\\xff', '2|kvClave:a', '2|kvMas:Cargar más claves']),
    j(resumen(deLaBase(kvPag)))
  )
  const kvAbierto = conRecorrido([claveBd.kvCarpeta('r1', 1, 'usuario:'), claveBd.kvCarpeta('r1', 1, 'usuario:1:')])
  check(
    'dentro de una carpeta: sus carpetas y sus claves en orden NATURAL (2 antes que 10), un nivel más',
    j(resumen(deLaBase(kvAbierto))) ===
      j(['2|kvCarpeta:usuario:(3)', '3|kvCarpeta:usuario:1:(1)', '4|kvClave:usuario:1:perfil', '3|kvClave:usuario:2', '3|kvClave:usuario:10', '2|kvClave:\\xff', '2|kvClave:a', '2|kvMas:Cargar más claves']),
    j(resumen(deLaBase(kvAbierto)))
  )
  const claveBin = deLaBase(kvPag).find((f) => f.kind === 'kv-clave')
  check('la clave de la fila es su base64 (no el texto pintado)', claveBin?.key === claveBd.kvClave('r1', 1, '/w=='), claveBin ? legibleClave(claveBin.key) : 'null')
  const perfil = kvAbierto.find((f) => f.kind === 'kv-clave' && f.nombre === 'usuario:1:perfil')
  check('una clave en una carpeta lleva el NOMBRE ENTERO y cuánto de él es prefijo (se atenúa)', perfil?.kind === 'kv-clave' && perfil.largoPrefijo === 'usuario:1:'.length, j(perfil))
  const panePerfil = perfil ? paneDeFila(perfil) : null
  check(
    'una clave abre su VISOR: pane `clave` con la base, el base64 y el nombre pintado; Enter la abre',
    perfil !== undefined &&
      !esContenedor(perfil) &&
      accionTecla(perfil, 'abrir') === 'abrir' &&
      j(panePerfil) === j({ kind: 'clave', conexionId: 'r1', base: 1, clave: 'dXN1YXJpbzoxOnBlcmZpbA==', nombre: 'usuario:1:perfil' }),
    j(panePerfil)
  )
  check(
    '«Mostrar en el árbol» de una clave: su fila y, delante, la conexión, la base y sus carpetas',
    panePerfil !== null &&
      claveDePane(panePerfil) === claveBd.kvClave('r1', 1, 'dXN1YXJpbzoxOnBlcmZpbA==') &&
      j(ancestrosDe(panePerfil)) === j([claveBd.conexion('r1'), claveBd.kvBase('r1', 1), claveBd.kvCarpeta('r1', 1, 'usuario:'), claveBd.kvCarpeta('r1', 1, 'usuario:1:')]),
    panePerfil ? j(ancestrosDe(panePerfil).map(legibleClave)) : 'sin pane'
  )
  const filaMas = deLaBase(kvPag).find((f) => f.kind === 'kv-mas')
  check('«Cargar más»: Enter pide la vuelta siguiente; no es una carga del marcador', filaMas !== undefined && accionTecla(filaMas, 'abrir') === 'cargarMas' && cargasPendientes(kvPag).length === 0, j(filaMas))
  const kvCargandoMas = deLaBase(conRecorrido([], { kvCargandoMas: new Set([claveBd.kvBase('r1', 1)]) })).find((f) => f.kind === 'kv-mas')
  check(
    'con una «Cargar más» en vuelo, la fila lo dice y Enter no pide otra',
    kvCargandoMas?.kind === 'kv-mas' && kvCargandoMas.cargando && kvCargandoMas.vista.accion === TEXTOS_CLAVES.cargando && accionTecla(kvCargandoMas, 'abrir') === 'nada',
    j(kvCargandoMas)
  )
  const carpetaUsuario = kvPag.find((f) => f.kind === 'kv-carpeta')
  check('una carpeta se despliega y no abre nada', carpetaUsuario !== undefined && esContenedor(carpetaUsuario) && paneDeFila(carpetaUsuario) === null, j(carpetaUsuario))
  const buscadaKv = aplanarArbolBd({
    ...vacia([R1], [], { kvBases: new Map([[claveBd.kvBases('r1'), resp]]), kvClaves: new Map([[claveBd.kvBase('r1', 1), recorrido]]) }),
    filtro: 'perf'
  })
  check(
    'la búsqueda encuentra una clave dentro de sus carpetas y abre la cadena (sin «Cargar más»)',
    j(resumen(buscadaKv)) === j(['0|conexion:REDIS-DEV', '1|kvBase:1(2)', '2|kvCarpeta:usuario:(3)', '3|kvCarpeta:usuario:1:(1)', '4|kvClave:usuario:1:perfil']),
    j(resumen(buscadaKv))
  )

  // Una vuelta VACÍA con cursor distinto de '0' NO es «Sin claves».
  const vaciaSigue = acumularPagina(null, { cursor: '99', claves: [], ms: 1 }, '*x*').recorrido
  const kvVaciaSigue = deLaBase(
    aplanarArbolBd(
      vacia([R1], [claveBd.conexion('r1'), claveBd.kvBase('r1', 1)], {
        kvBases: new Map([[claveBd.kvBases('r1'), resp]]),
        kvClaves: new Map([[claveBd.kvBase('r1', 1), vaciaSigue]]),
        kvPatrones: new Map([[claveBd.kvBase('r1', 1), '*x*']])
      })
    )
  )
  check(
    'vuelta vacía con el cursor abierto: NI «Sin claves» NI vacío, sino «Seguir buscando» con las vueltas',
    kvVaciaSigue.length === 1 && kvVaciaSigue[0].kind === 'kv-mas' && kvVaciaSigue[0].vista.accion === TEXTOS_CLAVES.seguirBuscando && kvVaciaSigue[0].vista.nota === 'Ninguna todavía tras 1 vuelta',
    j(kvVaciaSigue)
  )
  const kvFiltradaVacia = aplanarArbolBd(
    vacia([R1], [claveBd.conexion('r1'), claveBd.kvBase('r1', 1)], {
      kvBases: new Map([[claveBd.kvBases('r1'), resp]]),
      kvClaves: new Map([[claveBd.kvBase('r1', 1), acumularPagina(null, { cursor: '0', claves: [], ms: 1 }, '*x*').recorrido]]),
      kvPatrones: new Map([[claveBd.kvBase('r1', 1), '*x*']])
    })
  )
  const filaBaseFiltrada = kvFiltradaVacia.find((f) => f.kind === 'kv-base' && f.indice === 1)
  const trasLaBase = deLaBase(kvFiltradaVacia)
  check(
    'con patrón y el recorrido acabado sin nada: lo dice con el patrón, y la fila de la base lo lleva',
    filaBaseFiltrada?.kind === 'kv-base' &&
      filaBaseFiltrada.patron === '*x*' &&
      trasLaBase.length === 1 &&
      trasLaBase[0].kind === 'placeholder' &&
      trasLaBase[0].mensaje === textoSinCoincidencias('*x*'),
    j(trasLaBase)
  )

  // --- Las piezas puras de cada familia ---
  check('basePorDefectoClaves: vacío o no numérico -> 0; «3» -> 3', basePorDefectoClaves({}) === 0 && basePorDefectoClaves({ database: 'x' }) === 0 && basePorDefectoClaves({ database: ' 3 ' }) === 3, 'ok')
  check('nombreClave: escapes de redis-cli para barra, comillas y control', nombreClave({ base64: 'XCIK' }) === '\\\\\\"\\x0a', nombreClave({ base64: 'XCIK' }))
  check('etiquetaBaseClaves: db0', etiquetaBaseClaves(0) === 'db0', etiquetaBaseClaves(0))
  check(
    'basesDeClaves: un total inválido cae al del descriptor',
    basesDeClaves({ total: 0, totalDelServidor: true, conClaves: [] }, descriptor('redis') as DescriptorClaves, {}).length === 16,
    'ok'
  )
  check(
    'basesDeClaves: con `conteosDesconocidos`, ningún conteo (null), aunque venga alguno',
    basesDeClaves({ total: 2, totalDelServidor: true, conClaves: [{ indice: 0, claves: 5, caducan: 0 }], conteosDesconocidos: true }, descriptor('redis') as DescriptorClaves, {}).every(
      (b) => b.claves === null
    ),
    'null'
  )
  check(
    'escaparGlob: `cache:[v2]:*?\\` literal; con el `*` detrás, patronDeFiltro lo deja tal cual',
    escaparGlob('cache:[v2]:*?\\') === 'cache:\\[v2\\]:\\*\\?\\\\' && patronDeFiltro(`${escaparGlob('cache:[v2]:')}*`) === 'cache:\\[v2\\]:*',
    j(escaparGlob('cache:[v2]:*?\\'))
  )
  check(
    'patronDeFiltro: vacío sin filtro; con comodines tal cual; sin ellos, en cualquier parte (la barra escapada)',
    patronDeFiltro('  ') === '' && patronDeFiltro('usuario:*') === 'usuario:*' && patronDeFiltro('a?[bc]') === 'a?[bc]' && patronDeFiltro(' pedido ') === '*pedido*' && patronDeFiltro('a\\b') === '*a\\\\b*',
    j([patronDeFiltro('pedido'), patronDeFiltro('a\\b')])
  )
  check(
    'prefijosDeClave: de fuera adentro; sin separador, ninguno',
    j(prefijosDeClave('a:b:c')) === j(['a:', 'a:b:']) && j(prefijosDeClave('suelta')) === j([]) && j(prefijosDeClave('a::b')) === j(['a:', 'a::']),
    j(prefijosDeClave('a:b:c'))
  )
  const raro = agruparClaves([
    { clave: { nombre: { texto: 'a', base64: 'YQ==' }, tipo: 'string', ttlMs: null }, nombre: 'a' },
    { clave: { nombre: { texto: 'a:b', base64: 'YTpi' }, tipo: 'string', ttlMs: null }, nombre: 'a:b' },
    { clave: { nombre: { texto: 'a:', base64: 'YTo=' }, tipo: 'string', ttlMs: null }, nombre: 'a:' }
  ])
  check(
    'agruparClaves: una clave y una carpeta con el mismo nombre son dos filas; `a:` es una clave de nombre vacío en `a`',
    raro.carpetas.length === 1 && raro.carpetas[0].prefijo === 'a:' && raro.carpetas[0].total === 2 && j(raro.claves.map((k) => k.nombre)) === j(['a']) && j(raro.carpetas[0].claves.map((k) => k.nombre)) === j(['a:', 'a:b']),
    j(raro)
  )
  const acumulado = acumularPagina(acumularPagina(null, { cursor: '5', claves: [clavePag('x', 'eA==')], ms: 2 }, '').recorrido, { cursor: '0', claves: [clavePag('x', 'eA=='), clavePag('y', 'eQ==')], ms: 3 }, '')
  check(
    'acumularPagina: suma las páginas sin repetir, con el nombre pintado ya calculado y los ms sumados',
    acumulado.nuevas === 1 && j(acumulado.recorrido.claves.map((k) => k.nombre)) === j(['x', 'y']) && acumulado.recorrido.ms === 5 && acumulado.recorrido.cursor === '0',
    j(acumulado)
  )
  check(
    'un recorrido de una sola página sin patrón se serializa como la página (sin opcionales por omisión)',
    j(acumularPagina(null, { cursor: '0', claves: [], ms: 1 }, '').recorrido) === j({ cursor: '0', claves: [], ms: 1 }),
    j(acumularPagina(null, { cursor: '0', claves: [], ms: 1 }, '').recorrido)
  )
  const conFallo: RecorridoClaves = { cursor: '7', claves: [], ms: 1, errorMas: { motivo: 'interno', mensaje: 'se cayó' } }
  check('vistaCargarMas: un «más» fallido ofrece «Reintentar» y dice por qué', vistaCargarMas(conFallo, false).accion === 'Reintentar' && vistaCargarMas(conFallo, false).error, j(vistaCargarMas(conFallo, false)))
  check('metaColeccion: sin estimado, nada', metaColeccion({ nombre: 'x', tipo: 'coleccion' }) === null, 'null')
  check('ordenarBasesDocumentos: sin repetidas', j(ordenarBasesDocumentos([{ nombre: 'a' }, { nombre: 'a' }, { nombre: 'b' }]).map((b) => b.nombre)) === j(['a', 'b']), 'ok')
  check(
    'raizDocumentos: con base, colecciones; sin ella, bases',
    j(raizDocumentos(descriptor('mongodb') as DescriptorDocumentos, { database: 'x' })) === j({ nivel: 'colecciones', base: 'x' }) &&
      j(raizDocumentos(descriptor('mongodb') as DescriptorDocumentos, { database: '  ' })) === j({ nivel: 'bases' }),
    'ok'
  )
}

/**
 * (13) `recorrerClaves`, el CLIC del recorrido: sigue solo tras las
 * vueltas vacías hasta el tope, se para en la primera con claves o en el cursor '0', y un
 * fallo de «Cargar más» no tira lo cargado.
 */
async function seccionRecorridoClaves(): Promise<void> {
  hr('(13) el recorrido de SCAN (vueltas vacías, tope por clic, fallos)')
  const clave = (t: string): DbKvClave => ({ nombre: { texto: t, base64: btoa(t) }, tipo: 'string', ttlMs: null })
  /** Un servidor falso: devuelve las páginas en orden y apunta los cursores que le piden. */
  const servidor = (paginas: Array<DbRespuesta<DbKvPaginaClaves> | 'lanza'>): { pedidos: string[]; escanear: (c: string) => Promise<DbRespuesta<DbKvPaginaClaves>> } => {
    const pedidos: string[] = []
    let i = 0
    return {
      pedidos,
      escanear: async (c) => {
        pedidos.push(c)
        const p = paginas[i++]
        if (p === 'lanza') throw new Error('el canal se cerró')
        return p ?? { ok: false, error: { motivo: 'interno', mensaje: 'sin más páginas en el falso' } }
      }
    }
  }
  const pag = (cursor: string, claves: string[]): DbRespuesta<DbKvPaginaClaves> => ({ ok: true, valor: { cursor, claves: claves.map(clave), ms: 1 } })

  const s1 = servidor([pag('3', []), pag('8', []), pag('12', ['a', 'b']), pag('0', ['c'])])
  const r1 = await recorrerClaves(s1.escanear, null, '*a*')
  check(
    'vueltas vacías: sigue SOLO hasta la primera con claves (y se para ahí, sin pedir la siguiente)',
    r1.ok && j(s1.pedidos) === j(['0', '3', '8']) && r1.valor.cursor === '12' && r1.valor.claves.length === 2 && r1.valor.patron === '*a*' && r1.valor.vueltasVacias === undefined,
    `${j(s1.pedidos)} ${j(r1)}`
  )
  const s2 = servidor(Array.from({ length: 20 }, (_, k) => pag(String(k + 1), [])))
  const r2 = await recorrerClaves(s2.escanear, null, '*zzz*', 10)
  check(
    'tope por clic: 10 vueltas vacías y para, con el cursor abierto y las vueltas contadas',
    r2.ok && s2.pedidos.length === 10 && r2.valor.cursor === '10' && r2.valor.claves.length === 0 && r2.valor.vueltasVacias === 10,
    `${s2.pedidos.length} vueltas ${j(r2)}`
  )
  const s3 = servidor([pag('0', [])])
  const r3 = await recorrerClaves(s3.escanear, null, '')
  check('cursor 0 a la primera: una sola vuelta', r3.ok && s3.pedidos.length === 1 && r3.valor.cursor === '0', j(r3))
  if (r2.ok) {
    const s4 = servidor([pag('11', []), pag('0', ['z'])])
    const r4 = await recorrerClaves(s4.escanear, r2.valor, '*zzz*')
    check(
      '«Seguir buscando» sigue DESDE el cursor guardado y acumula',
      r4.ok && j(s4.pedidos) === j(['10', '11']) && r4.valor.cursor === '0' && j(r4.valor.claves.map((k) => k.nombre)) === j(['z']),
      `${j(s4.pedidos)} ${j(r4)}`
    )
  }
  if (r1.ok) {
    const s5 = servidor([{ ok: false, error: { motivo: 'sesionPerdida', mensaje: 'se perdió' } }])
    const r5 = await recorrerClaves(s5.escanear, r1.valor, '*a*')
    check(
      '«Cargar más» que falla: lo cargado se queda y el error va en `errorMas`',
      r5.ok && r5.valor.claves.length === 2 && r5.valor.cursor === '12' && r5.valor.errorMas?.motivo === 'sesionPerdida',
      j(r5)
    )
    if (r5.ok) {
      const s6 = servidor([pag('0', ['d'])])
      const r6 = await recorrerClaves(s6.escanear, r5.valor, '*a*')
      check('reintentar el «más»: el error viejo se va y sigue desde el mismo cursor', r6.ok && r6.valor.errorMas === undefined && j(s6.pedidos) === j(['12']) && r6.valor.claves.length === 3, j(r6))
    }
    const s8 = servidor(['lanza'])
    const r8 = await recorrerClaves(s8.escanear, r1.valor, '*a*')
    check('si el canal LANZA en un «más», es un `errorMas` interno (no rompe)', r8.ok && r8.valor.errorMas?.motivo === 'interno', j(r8))
  }
  const s7 = servidor([pag('4', []), { ok: false, error: { motivo: 'servidor', mensaje: 'NOPERM' } }])
  const r7 = await recorrerClaves(s7.escanear, null, '')
  check('primera carga que falla: es el error de la carga (la fila de error del árbol)', !r7.ok && r7.error.mensaje === 'NOPERM', j(r7))
  const acabado: RecorridoClaves = { cursor: '0', claves: [], ms: 1 }
  const s9 = servidor([])
  const r9 = await recorrerClaves(s9.escanear, acabado, '')
  check('un recorrido acabado no pide nada', r9.ok && r9.valor === acabado && s9.pedidos.length === 0, j(s9.pedidos))

  // --- La caché: «Cargar más», el patrón por base y la invalidación (cacheMetaBd) ---
  let emitir: (e: DbEventoCatalogo) => void = () => undefined
  const noUsar = (): Promise<never> => Promise.reject(new Error('la api SQL no se usa aquí'))
  const apiSql: ApiCatalogoBd = {
    esquemas: noUsar,
    bases: noUsar,
    resumen: noUsar,
    objetos: noUsar,
    detalle: noUsar,
    resolver: noUsar,
    nombres: noUsar,
    nombresPublicos: noUsar,
    fks: noUsar,
    onCatalogo: (cb) => {
      emitir = cb
      return () => undefined
    }
  }
  const escaneos: DbKvEscanear[] = []
  let respuestas: DbRespuesta<DbKvPaginaClaves>[] = []
  const familias: ApiFamiliasBd = {
    docBases: noUsar,
    docColecciones: noUsar,
    kvBases: noUsar,
    kvEscanear: async (p) => {
      escaneos.push(p)
      return respuestas.shift() ?? { ok: false, error: { motivo: 'interno', mensaje: 'sin respuesta en el falso' } }
    }
  }
  const cache = new CacheMetaBd(apiSql, undefined, familias)
  const K3 = claveBd.kvBase('r1', 3)
  const carga3 = { tipo: 'kvClaves' as const, clave: K3, conexionId: 'r1', base: 3 }
  respuestas = [pag('9', ['a'])]
  await cache.cargar(carga3)
  respuestas = [pag('0', ['b'])]
  const vuelo = cache.cargarMasClaves('r1', 3)
  const enVuelo = cache.instantaneaArbol().kvCargandoMas.has(K3)
  await vuelo
  const tras = cache.instantaneaArbol()
  check(
    'caché: «Cargar más» sigue desde el cursor guardado, marca la base «en vuelo» mientras tanto y acumula',
    enVuelo && !tras.kvCargandoMas.has(K3) && j(escaneos.map((e) => e.cursor)) === j(['0', '9']) && j(tras.kvClaves.get(K3)?.claves.map((k) => k.nombre)) === j(['a', 'b']),
    `${j(escaneos.map((e) => e.cursor))} ${j(tras.kvClaves.get(K3))}`
  )
  cache.filtrarClaves('r1', 3, 'usu*')
  const filtrada = cache.instantaneaArbol()
  check(
    'caché: cambiar el patrón TIRA lo recorrido (el árbol vuelve a «Cargando…») y lo recuerda por base',
    !filtrada.kvClaves.has(K3) && filtrada.kvPatrones.get(K3) === 'usu*' && cache.patronClaves('r1', 3) === 'usu*' && cache.patronClaves('r1', 4) === '',
    j([...filtrada.kvPatrones])
  )
  respuestas = [pag('0', ['usuario'])]
  await cache.cargar(carga3)
  check('caché: la carga siguiente va con el patrón de la base', escaneos[escaneos.length - 1]?.patron === 'usu*' && escaneos[escaneos.length - 1]?.cursor === '0', j(escaneos[escaneos.length - 1]))
  respuestas = [pag('5', ['x'])]
  await cache.cargar(carga3) // fresca: no pide nada
  emitir({ conexionId: 'r1', motivo: 'refrescar' })
  const antes = escaneos.length
  respuestas = [pag('0', ['usuario', 'usuario:2'])]
  await cache.cargarMasClaves('r1', 3)
  check(
    'caché: «Cargar más» sobre algo OBSOLETO (Refrescar) vuelve a empezar desde 0, con el patrón',
    escaneos.length === antes + 1 && escaneos[antes].cursor === '0' && escaneos[antes].patron === 'usu*' && cache.instantaneaArbol().kvClaves.get(K3)?.claves.length === 2,
    j(escaneos.slice(antes))
  )
  // Un cambio de patrón con la petición en vuelo: la respuesta vieja no se guarda.
  cache.filtrarClaves('r1', 3, '')
  let soltar: (r: DbRespuesta<DbKvPaginaClaves>) => void = () => undefined
  const lenta: ApiFamiliasBd = { ...familias, kvEscanear: () => new Promise((res) => (soltar = res)) }
  const cache2 = new CacheMetaBd(apiSql, undefined, lenta)
  const p1 = cache2.cargar(carga3)
  cache2.filtrarClaves('r1', 3, 'otro*')
  soltar({ ok: true, valor: { cursor: '0', claves: [clave('vieja')], ms: 1 } })
  await p1
  check('caché: la respuesta del patrón VIEJO no se guarda', !cache2.instantaneaArbol().kvClaves.has(K3), j([...cache2.instantaneaArbol().kvClaves.keys()]))
}

function entrada(expandidos: string[], extra: Partial<EntradaArbolBd> = {}): EntradaArbolBd {
  return {
    conexiones: [C1, C2, C3],
    consolas: CONSOLAS,
    esquemas: new Map([[claveBd.conexion('c1'), RESP_C1]]),
    conteos: CONTEOS,
    objetos: OBJETOS,
    detalles: DETALLES,
    errores: ERRORES,
    expandidos: new Set(expandidos),
    ...extra
  }
}

/** Resumen legible de una fila: sangría + tipo + nombre. */
function etiqueta(f: FilaBd): string {
  switch (f.kind) {
    case 'conexion':
      return `conexion:${f.conexion.alias}`
    case 'carpeta-consolas':
      return `consolas(${f.cuenta})`
    case 'consola':
      return `consola:${f.consola.nombre}`
    case 'base':
      return `base:${f.base}${f.accesible ? '' : '(sin acceso)'}`
    case 'esquema':
      return `esquema:${f.esquema}`
    case 'carpeta':
      return `carpeta:${f.tipo}(${f.cuenta})`
    case 'objeto':
      return `objeto:${f.objeto.nombre}`
    case 'carpeta-detalle':
      return `detalle:${f.parte}(${f.cuenta})`
    case 'columna':
      return `columna:${f.columna.nombre}`
    case 'indice':
      return `indice:${f.indice.nombre}`
    case 'restriccion':
      return `restriccion:${f.restriccion.nombre}`
    case 'placeholder':
      return `~${f.variante}`
    case 'doc-base':
      return `docBase:${f.base}`
    case 'coleccion':
      return `coleccion:${f.coleccion.nombre}`
    case 'kv-base':
      return `kvBase:${f.indice}(${f.claves === null ? '?' : f.claves})`
    case 'kv-carpeta':
      return `kvCarpeta:${f.prefijo}(${f.cuenta})`
    case 'kv-clave':
      return `kvClave:${f.nombre}`
    case 'kv-mas':
      return `kvMas:${f.vista.accion}`
  }
}
const resumen = (filas: readonly FilaBd[]): string[] => filas.map((f) => `${f.depth}|${etiqueta(f)}`)

const K = {
  c1: claveBd.conexion('c1'),
  c2: claveBd.conexion('c2'),
  c3: claveBd.conexion('c3'),
  consolasC1: claveBd.consolas('c1'),
  admdemo: claveBd.esquema('c1', 'ADMDEMO'),
  hr: claveBd.esquema('c1', 'HR'),
  sys: claveBd.esquema('c1', 'SYS'),
  public: claveBd.esquema('c1', 'PUBLIC'),
  tablas: claveBd.carpeta('c1', 'ADMDEMO', 'tabla'),
  vistas: claveBd.carpeta('c1', 'ADMDEMO', 'vista'),
  paquetes: claveBd.carpeta('c1', 'ADMDEMO', 'paquete'),
  application: claveBd.objeto('c1', 'ADMDEMO', 'tabla', 'APPLICATION'),
  esConfig: claveBd.objeto('c1', 'ADMDEMO', 'tabla', 'ES_CONFIG'),
  columnas: claveBd.detalle('c1', 'ADMDEMO', 'tabla', 'APPLICATION', 'columnas')
}

function filaObjeto(tipo: DbTipoObjeto, extra: Partial<DbObjeto> = {}): FilaObjeto {
  return {
    kind: 'objeto',
    key: claveBd.objeto('c1', 'E', tipo, 'X', extra.firma),
    depth: 3,
    conexionId: 'c1',
    esquema: 'E',
    objeto: obj('E', 'X', tipo, extra),
    expandible: partesDetalle(tipo).length > 0,
    expandida: false
  }
}

async function main(): Promise<void> {
  hr('(1) Claves')
  const todas = [
    K.c1,
    K.consolasC1,
    claveBd.consola('c1', 'k1'),
    K.admdemo,
    K.tablas,
    K.application,
    K.columnas,
    claveBd.hoja('c1', 'ADMDEMO', 'tabla', 'APPLICATION', 'columnas', 'ID'),
    // La de la fila de una conexión AJENA: este módulo no la pinta, pero su clave sale
    // de aquí (antes `filasArbolBd` la armaba con una copia del separador).
    claveBd.ajena('c1')
  ]
  check('claves de niveles distintos no chocan', new Set(todas).size === todas.length, `${todas.length} únicas`)
  check('el separador es NUL', K.admdemo === 'esquema\u0000c1\u0000ADMDEMO', JSON.stringify(K.admdemo))
  check(
    "firma '' y sin firma son claves distintas",
    claveBd.objeto('c', 'e', 'rutina', 'f', '') !== claveBd.objeto('c', 'e', 'rutina', 'f'),
    'distintas'
  )
  check(
    'nombres con `.`, `:` o `/` no chocan',
    claveBd.esquema('c', 'A.B') !== claveBd.carpeta('c', 'A', 'tabla') &&
      claveBd.objeto('c', 'A', 'tabla', 'B.C') !== claveBd.objeto('c', 'A.B', 'tabla', 'C'),
    'distintas'
  )
  check(
    'conexionDeClave en todos los niveles',
    todas.every((k) => conexionDeClave(k) === 'c1') && conexionDeClave('suelta') === null,
    'c1'
  )

  hr('(2) Insignia N de M')
  const raiz = aplanarArbolBd(entrada([]))
  check('sin expandir: solo las conexiones, en su orden', j(resumen(raiz)) === j(['0|conexion:QA-REPLICA-DEMO', '0|conexion:PG-LOCAL', '0|conexion:SIN-CONECTAR']), j(resumen(raiz)))
  const ins = (i: number): unknown => (raiz[i].kind === 'conexion' ? raiz[i].insignia : 'no')
  check('con la lista del servidor: exacta (4 de 6)', j(ins(0)) === j({ n: 4, m: 6 }), j(ins(0)))
  check('sin lista ni introspección: null (se oculta)', ins(1) === null, j(ins(1)))
  check('solo con introspección: estimada (A, B y el por defecto = 3 de 116)', j(ins(2)) === j({ n: 3, m: 116 }), j(ins(2)))

  hr('(3) Conexión expandida: consolas y esquemas visibles')
  const c1 = aplanarArbolBd(entrada([K.c1]))
  check(
    'orden: consolas, luego esquemas normales, de sistema y PUBLIC al final; solo los visibles',
    j(resumen(c1).slice(0, 6)) ===
      j(['0|conexion:QA-REPLICA-DEMO', '1|consolas(2)', '1|esquema:ADMDEMO', '1|esquema:HR', '1|esquema:SYS', '1|esquema:PUBLIC']),
    j(resumen(c1).slice(0, 6))
  )
  const esqAdm = c1.find((f) => f.key === K.admdemo)
  check(
    'el esquema por defecto va marcado; SYS marcado de sistema; PUBLIC pseudo',
    esqAdm?.kind === 'esquema' &&
      esqAdm.porDefecto &&
      c1.some((f) => f.kind === 'esquema' && f.esquema === 'SYS' && f.sistema) &&
      c1.some((f) => f.kind === 'esquema' && f.esquema === 'PUBLIC' && f.pseudo),
    'ok'
  )
  check('la consola de una conexión que no está en la lista no aparece', !c1.some((f) => f.kind === 'consola'), 'carpeta plegada')
  const conVentas = aplanarArbolBd(
    entrada([K.c1], {
      conexiones: [{ ...C1, esquemas: { modo: 'lista', porDefecto: true, esquemas: ['VENTAS'] } }, C2, C3]
    })
  )
  check(
    'la visibilidad sale de la CONFIGURACIÓN de la conexión (no del `visible` de la respuesta)',
    j(resumen(conVentas).filter((s) => s.includes('esquema:'))) === j(['1|esquema:ADMDEMO', '1|esquema:VENTAS']),
    j(resumen(conVentas).filter((s) => s.includes('esquema:')))
  )
  const ninguno = aplanarArbolBd(
    entrada([K.c1], { conexiones: [{ ...C1, esquemas: { modo: 'lista', porDefecto: false, esquemas: [] } }], consolas: [] })
  )
  check(
    'ningún esquema visible: marcador vacío con su mensaje',
    ninguno.length === 2 && ninguno[1].kind === 'placeholder' && ninguno[1].variante === 'empty' && ninguno[1].mensaje === 'Ningún esquema visible',
    j(resumen(ninguno))
  )
  const consolas = aplanarArbolBd(entrada([K.c1, K.consolasC1]))
  check(
    'consolas en orden NUMÉRICO (consola_2 antes que consola_10)',
    j(resumen(consolas).slice(1, 4)) === j(['1|consolas(2)', '2|consola:consola_2', '2|consola:consola_10']),
    j(resumen(consolas).slice(1, 4))
  )

  hr('(4) Carpetas por motor')
  const adm = aplanarArbolBd(entrada([K.c1, K.admdemo]))
  const carpetas = resumen(adm).filter((s) => s.includes('carpeta:'))
  check(
    'orden de las carpetas del descriptor y sin las de 0 (vistaMaterializada, secuencia) ni las ausentes',
    j(carpetas) === j(['2|carpeta:tabla(27)', '2|carpeta:vista(4)', '2|carpeta:paquete(2)', '2|carpeta:sinonimo(3)']),
    j(carpetas)
  )
  const pub = aplanarArbolBd(entrada([K.c1, K.public]))
  const iPub = pub.findIndex((f) => f.key === K.public)
  check(
    'PUBLIC: solo la carpeta de sinónimos aunque el conteo traiga más',
    j(resumen(pub.slice(iPub, iPub + 2))) === j(['1|esquema:PUBLIC', '2|carpeta:sinonimo(5000)']) &&
      !pub.some((f) => f.kind === 'carpeta' && f.esquema === 'PUBLIC' && f.tipo === 'tabla'),
    j(resumen(pub.slice(iPub, iPub + 2)))
  )

  hr('(5) Objetos y detalle')
  const tablas = aplanarArbolBd(entrada([K.c1, K.admdemo, K.tablas, K.application, K.columnas]))
  const iTablas = tablas.findIndex((f) => f.key === K.tablas)
  const tramo = resumen(tablas.slice(iTablas, iTablas + 8))
  check(
    'tabla -> columnas y restricciones (índices vacíos se omiten) -> hojas',
    j(tramo) ===
      j([
        '2|carpeta:tabla(27)',
        '3|objeto:APPLICATION',
        '4|detalle:columnas(2)',
        '5|columna:ID',
        '5|columna:NAME',
        '4|detalle:restricciones(1)',
        '3|objeto:ES_CONFIG',
        '2|carpeta:vista(4)'
      ]),
    j(tramo)
  )
  const app = tablas.find((f) => f.key === K.application)
  check('una tabla es expandible; su fila lo dice', app?.kind === 'objeto' && app.expandible && app.expandida, j(app && etiqueta(app)))
  const pkg = aplanarArbolBd(entrada([K.c1, K.admdemo, K.paquetes]))
  check(
    'partesDetalle: tabla 3 partes, vista solo columnas, paquete ninguna',
    j(partesDetalle('tabla')) === j(['columnas', 'indices', 'restricciones']) &&
      j(partesDetalle('vista')) === j(['columnas']) &&
      partesDetalle('paquete').length === 0,
    'ok'
  )

  hr('(6) Marcadores y cargas')
  const vistas = aplanarArbolBd(entrada([K.c1, K.admdemo, K.vistas]))
  const iVistas = vistas.findIndex((f) => f.key === K.vistas)
  const vacia = vistas[iVistas + 1]
  check(
    'carpeta cargada vacía: marcador empty',
    vacia.kind === 'placeholder' && vacia.variante === 'empty' && vacia.padre === K.vistas && vacia.depth === 3,
    j(vacia)
  )
  const iPkg = pkg.findIndex((f) => f.key === K.paquetes)
  const cargando = pkg[iPkg + 1]
  check(
    'carpeta sin cargar: marcador loading con su carga (objetos de paquete)',
    cargando.kind === 'placeholder' &&
      cargando.variante === 'loading' &&
      j(cargando.carga) === j({ tipo: 'objetos', clave: K.paquetes, conexionId: 'c1', esquema: 'ADMDEMO', tipoObjeto: 'paquete' }),
    j(cargando)
  )
  const filasCfg = aplanarArbolBd(entrada([K.c1, K.admdemo, K.tablas, K.esConfig]))
  const iCfg = filasCfg.findIndex((f) => f.key === K.esConfig)
  const cargaDetalle = filasCfg[iCfg + 1]
  check(
    'tabla sin detalle: loading con la carga de detalle y sus 3 partes',
    cargaDetalle.kind === 'placeholder' &&
      j(cargaDetalle.carga) ===
        j({
          tipo: 'detalle',
          clave: K.esConfig,
          conexionId: 'c1',
          objeto: { esquema: 'ADMDEMO', nombre: 'ES_CONFIG', tipo: 'tabla' },
          partes: ['columnas', 'indices', 'restricciones']
        }),
    j(cargaDetalle)
  )
  const errores = aplanarArbolBd(entrada([K.c1, K.hr, K.sys, K.c2]))
  const iHr = errores.findIndex((f) => f.key === K.hr)
  const errHr = errores[iHr + 1]
  check(
    'esquema con error: marcador error con mensaje, motivo y reintentar (resumen)',
    errHr.kind === 'placeholder' &&
      errHr.variante === 'error' &&
      errHr.mensaje === ERROR_HR.mensaje &&
      errHr.motivo === 'servidor' &&
      j(errHr.reintentar) === j({ tipo: 'resumen', clave: K.hr, conexionId: 'c1', esquema: 'HR' }) &&
      errHr.carga === undefined,
    j(errHr)
  )
  const iC2 = errores.findIndex((f) => f.key === K.c2)
  const trasC2 = resumen(errores.slice(iC2, iC2 + 3))
  const errC2 = errores[iC2 + 2]
  check(
    'conexión con error: las consolas (del disco) se ven igual, y el error lleva requiereDriver',
    j(trasC2) === j(['0|conexion:PG-LOCAL', '1|consolas(1)', '1|~error']) &&
      errC2.kind === 'placeholder' &&
      errC2.requiereDriver?.packId === 'oracle-ic-19' &&
      errC2.motivo === 'driver',
    j(trasC2)
  )
  const pend = cargasPendientes(errores)
  check(
    'cargasPendientes: solo los loading (SYS sin conteos y c3 sin esquemas no expandida)',
    j(pend) === j([{ tipo: 'resumen', clave: K.sys, conexionId: 'c1', esquema: 'SYS' }]),
    j(pend)
  )
  const c3 = aplanarArbolBd(entrada([K.c3]))
  check(
    'conexión sin esquemas cargados: loading con la carga de esquemas',
    j(cargasPendientes(c3)) === j([{ tipo: 'esquemas', clave: K.c3, conexionId: 'c3' }]),
    j(cargasPendientes(c3))
  )

  hr('(7) Búsqueda')
  const expandidosAntes = new Set([K.c1])
  const busq = aplanarArbolBd(entrada([], { expandidos: expandidosAntes, filtro: 'es_con' }))
  check(
    'fuerza abiertos los antepasados y solo enseña la coincidencia',
    j(resumen(busq)) === j(['0|conexion:QA-REPLICA-DEMO', '1|esquema:ADMDEMO', '2|carpeta:tabla(27)', '3|objeto:ES_CONFIG']),
    j(resumen(busq))
  )
  const hit = busq[3]
  check('marca la coincidencia (sin distinguir mayúsculas)', j(hit.coincidencia) === j([0, 6]), j(hit.coincidencia))
  // La regla EXPORTADA (la usan también las ajenas de `filasArbolBd`): recorta y baja
  // el filtro; con la İ turca (cambia de longitud al bajarla) busca tal cual.
  check(
    'normalizarBusqueda recorta y baja; sin filtro, cadena vacía',
    normalizarBusqueda('  ES_Con ') === 'es_con' && normalizarBusqueda(undefined) === '',
    j([normalizarBusqueda('  ES_Con '), normalizarBusqueda(undefined)])
  )
  check(
    'coincidenciaDe: sin distinguir mayúsculas; con la İ, tal cual (los índices casan)',
    j(coincidenciaDe('ES_CONFIG', 'es_con')) === j([0, 6]) &&
      j(coincidenciaDe('İSTANBUL-ventas', 'ventas')) === j([9, 15]) &&
      coincidenciaDe('İSTANBUL', 'stan') === null,
    j([coincidenciaDe('ES_CONFIG', 'es_con'), coincidenciaDe('İSTANBUL-ventas', 'ventas')])
  )
  check(
    'los antepasados van expandidos y FORZADOS; `expandidos` no se muta',
    busq.slice(0, 3).every((f) => 'expandida' in f && f.expandida && 'forzada' in f && f.forzada === true) &&
      expandidosAntes.size === 1 &&
      expandidosAntes.has(K.c1),
    j([...expandidosAntes].map((k) => k.split('\u0000').join('/')))
  )
  const enDetalle = aplanarArbolBd(entrada([], { filtro: 'name' }))
  check(
    'busca en lo ya cargado aunque esté plegado (una columna)',
    j(resumen(enDetalle)) ===
      j([
        '0|conexion:QA-REPLICA-DEMO',
        '1|esquema:ADMDEMO',
        '2|carpeta:tabla(27)',
        '3|objeto:APPLICATION',
        '4|detalle:columnas(2)',
        '5|columna:NAME'
      ]),
    j(resumen(enDetalle))
  )
  const enConsola = aplanarArbolBd(entrada([], { filtro: 'CONSOLA_1' }))
  check(
    'busca consolas por nombre; las carpetas no coinciden por su nombre genérico',
    j(resumen(enConsola)) ===
      j(['0|conexion:QA-REPLICA-DEMO', '1|consolas(2)', '2|consola:consola_10', '0|conexion:PG-LOCAL', '1|consolas(1)', '2|consola:consola_1']),
    j(resumen(enConsola))
  )
  const porAlias = aplanarArbolBd(entrada([], { filtro: 'pg-' }))
  const filaPg = porAlias[0]
  check(
    'coincide el alias de la conexión: se ve sin forzarla abierta',
    porAlias.length === 1 && filaPg.kind === 'conexion' && !filaPg.expandida && j(filaPg.coincidencia) === j([0, 3]),
    j(resumen(porAlias))
  )
  check('sin coincidencias: ninguna fila', aplanarArbolBd(entrada([K.c1], { filtro: 'zzz' })).length === 0, '[]')
  check(
    'un filtro de solo espacios es como no tenerlo',
    j(resumen(aplanarArbolBd(entrada([K.c1], { filtro: '   ' })))) === j(resumen(aplanarArbolBd(entrada([K.c1])))),
    'igual'
  )
  check('la búsqueda no pinta marcadores', !busq.some((f) => f.kind === 'placeholder'), 'sin ~')

  hr('(8) indicePadre y accionTecla')
  check(
    'indicePadre: columna -> carpeta de detalle -> objeto -> carpeta -> esquema -> conexión',
    (() => {
      const iCol = tablas.findIndex((f) => f.kind === 'columna')
      const d = indicePadre(tablas, iCol)
      const o = indicePadre(tablas, d)
      const c = indicePadre(tablas, o)
      const e = indicePadre(tablas, c)
      const x = indicePadre(tablas, e)
      return (
        tablas[d].kind === 'carpeta-detalle' &&
        tablas[o].kind === 'objeto' &&
        tablas[c].kind === 'carpeta' &&
        tablas[e].kind === 'esquema' &&
        tablas[x].kind === 'conexion' &&
        indicePadre(tablas, x) === -1
      )
    })(),
    'cadena completa'
  )
  const conexionPlegada = raiz[0]
  const conexionAbierta = c1[0]
  const esqPlegado = c1.find((f) => f.key === K.hr) as FilaBd
  const carpetaAbierta = tablas[iTablas]
  const tablaAbierta = app as FilaBd
  const tablaPlegada = filaObjeto('tabla')
  const paquete = filaObjeto('paquete')
  const secuencia = filaObjeto('secuencia')
  const columna = tablas.find((f) => f.kind === 'columna') as FilaBd
  const consola = consolas.find((f) => f.kind === 'consola') as FilaBd
  const casos: Array<[string, FilaBd, 'izq' | 'dcha' | 'abrir', string]> = [
    ['→ conexión plegada', conexionPlegada, 'dcha', 'expandir'],
    ['→ conexión desplegada', conexionAbierta, 'dcha', 'nada'],
    ['← conexión desplegada', conexionAbierta, 'izq', 'plegar'],
    ['← conexión plegada (raíz)', conexionPlegada, 'izq', 'nada'],
    ['← esquema plegado', esqPlegado, 'izq', 'aPadre'],
    ['← carpeta desplegada', carpetaAbierta, 'izq', 'plegar'],
    ['→ tabla plegada', tablaPlegada, 'dcha', 'expandir'],
    ['← tabla desplegada', tablaAbierta, 'izq', 'plegar'],
    ['→ paquete (hoja)', paquete, 'dcha', 'nada'],
    ['← paquete (hoja)', paquete, 'izq', 'aPadre'],
    ['← columna', columna, 'izq', 'aPadre'],
    ['Enter tabla: abre (no alterna)', tablaPlegada, 'abrir', 'abrir'],
    ['Enter paquete: abre su fuente', paquete, 'abrir', 'abrir'],
    ['Enter secuencia: nada', secuencia, 'abrir', 'nada'],
    ['Enter esquema plegado: expande', esqPlegado, 'abrir', 'expandir'],
    ['Enter conexión desplegada: pliega', conexionAbierta, 'abrir', 'plegar'],
    ['Enter columna: abre su tabla', columna, 'abrir', 'abrir'],
    ['Enter consola: abre', consola, 'abrir', 'abrir'],
    ['Enter error: reintenta', errHr, 'abrir', 'reintentar'],
    ['Enter cargando: nada', cargando, 'abrir', 'nada'],
    ['← marcador', errHr, 'izq', 'aPadre'],
    ['← antepasado forzado por la búsqueda: sube, no pliega', busq[1], 'izq', 'aPadre'],
    ['→ antepasado forzado por la búsqueda: nada', busq[1], 'dcha', 'nada']
  ]
  for (const [nombre, fila, tecla, esperado] of casos) {
    const obtenido = accionTecla(fila, tecla)
    check(`accionTecla: ${nombre}`, obtenido === esperado, `${obtenido} (esperado ${esperado})`)
  }

  hr('(9) paneDeFila, claveDePane y ancestrosDe')
  const datosDe: DbTipoObjeto[] = ['tabla', 'vista', 'vistaMaterializada', 'tablaForanea', 'sinonimo']
  const fuenteDe: DbTipoObjeto[] = ['paquete', 'rutina', 'disparador', 'tipoObjeto', 'tipoColeccion']
  const nadaDe: DbTipoObjeto[] = ['secuencia', 'tipo']
  check(
    'tabla, vista, vista materializada, tabla foránea y sinónimo -> datos',
    datosDe.every((t) => {
      const p = paneDeFila(filaObjeto(t))
      return p !== null && p.kind === 'datos' && p.tipo === t && p.objeto === 'X' && p.esquema === 'E'
    }),
    datosDe.join(',')
  )
  check(
    'paquete, rutina, disparador y tipos de Oracle -> fuente',
    fuenteDe.every((t) => paneDeFila(filaObjeto(t))?.kind === 'fuente'),
    fuenteDe.join(',')
  )
  check('secuencia y tipo de PG -> nada', nadaDe.every((t) => paneDeFila(filaObjeto(t)) === null), nadaDe.join(','))
  const conFirma = paneDeFila(filaObjeto('rutina', { firma: 'integer, text' }))
  check('rutina con firma: la pestaña de fuente la lleva', conFirma?.kind === 'fuente' && conFirma.firma === 'integer, text', j(conFirma))
  const pCol = paneDeFila(columna)
  check(
    'columna -> datos de SU tabla',
    j(pCol) === j({ kind: 'datos', conexionId: 'c1', esquema: 'ADMDEMO', objeto: 'APPLICATION', tipo: 'tabla' }),
    j(pCol)
  )
  check(
    'consola -> consola',
    j(paneDeFila(consola)) === j({ kind: 'consola', conexionId: 'c1', consolaId: 'k2' }),
    j(paneDeFila(consola))
  )
  check(
    'conexión, esquema, carpetas, índices y marcadores -> nada',
    [conexionAbierta, esqPlegado, carpetaAbierta, errHr, tablas.find((f) => f.kind === 'carpeta-detalle') as FilaBd].every(
      (f) => paneDeFila(f) === null
    ),
    'null'
  )
  const paneCfg = paneDeFila(filasCfg[iCfg])
  if (paneCfg === null) throw new Error('ES_CONFIG debería abrir datos')
  const anc = ancestrosDe(paneCfg)
  const revelado = aplanarArbolBd(entrada(anc))
  check(
    'ancestrosDe: expandirlos deja a la vista la fila de claveDePane',
    j(anc) === j([K.c1, K.admdemo, K.tablas]) && claveDePane(paneCfg) === K.esConfig && revelado.some((f) => f.key === K.esConfig),
    j(anc.map((k) => k.split('\u0000').join('/')))
  )
  const paneConsola = paneDeFila(consola)
  if (paneConsola === null) throw new Error('la consola debería abrir')
  const revConsola = aplanarArbolBd(entrada(ancestrosDe(paneConsola)))
  check(
    'ancestrosDe de una consola: conexión y carpeta de consolas',
    revConsola.some((f) => f.key === claveDePane(paneConsola)) && claveDePane(paneConsola) === claveBd.consola('c1', 'k2'),
    j(resumen(revConsola).slice(0, 4))
  )
  const paneRutina = paneDeFila(filaObjeto('rutina', { firma: '' }))
  check(
    "claveDePane conserva la firma ('' incluida)",
    paneRutina !== null && claveDePane(paneRutina) === claveBd.objeto('c1', 'E', 'rutina', 'X', ''),
    'ok'
  )

  hr('(9b) paneDdlDeFila («Ver DDL»)')
  const todosLosTipos: DbTipoObjeto[] = [
    'tabla',
    'vista',
    'vistaMaterializada',
    'tablaForanea',
    'secuencia',
    'sinonimo',
    'tipoObjeto',
    'tipoColeccion',
    'tipo',
    'paquete',
    'rutina',
    'disparador'
  ]
  check(
    'todo objeto del árbol ofrece su DDL: pane de fuente con modo ddl, su tipo y su nombre',
    todosLosTipos.every((t) => {
      const p = paneDdlDeFila(filaObjeto(t))
      return p !== null && p.kind === 'fuente' && p.modo === 'ddl' && p.tipo === t && p.objeto === 'X' && p.esquema === 'E'
    }),
    todosLosTipos.join(',')
  )
  const ddlFirma = paneDdlDeFila(filaObjeto('rutina', { firma: 'integer' }))
  check('rutina con firma: el DDL la lleva', ddlFirma?.kind === 'fuente' && ddlFirma.firma === 'integer', j(ddlFirma))
  check(
    'NO: columna, consola, conexión, esquema, carpetas y marcadores no tienen DDL',
    [columna, consola, conexionAbierta, esqPlegado, carpetaAbierta, errHr].every((f) => paneDdlDeFila(f) === null),
    'null'
  )
  const ddlTabla = paneDdlDeFila(filaObjeto('tabla'))
  check(
    '«Mostrar en el árbol» desde la pestaña de DDL lleva a la misma fila que la de datos',
    ddlTabla !== null && claveDePane(ddlTabla) === claveDePane(paneDeFila(filaObjeto('tabla')) as NonNullable<ReturnType<typeof paneDeFila>>),
    ddlTabla ? legibleClave(claveDePane(ddlTabla)) : 'null'
  )

  hr('(10) Pureza')
  const e = entrada([K.c1, K.admdemo, K.tablas], { filtro: '' })
  const antes = j({ c: e.conexiones, k: e.consolas, x: [...e.expandidos] })
  aplanarArbolBd(e)
  aplanarArbolBd({ ...e, filtro: 'app' })
  check('la entrada no se muta', j({ c: e.conexiones, k: e.consolas, x: [...e.expandidos] }) === antes, 'igual')
  check(
    'determinista',
    j(aplanarArbolBd(e)) === j(aplanarArbolBd(e)),
    `${aplanarArbolBd(e).length} filas`
  )

  seccionNivelBases()
  seccionFamilias()
  await seccionRecorridoClaves()

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
