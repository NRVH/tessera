#!/usr/bin/env node
// =============================================================================
// Prueba de las decisiones por motor del controlador del explorador con un trabajador falso, sin drivers ni Docker:
// cada bandera del descriptor y del catálogo llega a la decisión que gobierna, por cada motor del registro, y las
// conexiones de otra familia se rechazan con su motivo. La guardia (12) lee `controlador/*.ts`.
// (node src/main/db/explorador/test-explorador-motores.mts  ·  npm run test:db-explorador-motores)
// =============================================================================

// Los casos por motor recorren los SQL: `MOTORES` es aquí el registro SQL.
const MOTORES = porMotorSql((d) => d)

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IpcMain } from 'electron'
import type { DbConnection, DbMotor, DbMotorSql } from '../../../shared/db-ipc.ts'
import { DBX_CHANNELS, type DbTipoObjeto } from '../../../shared/db-explorador-ipc.ts'
import { esMotor, esMotorSql, IDS_MOTORES, MOTORES as REGISTRO, porMotorSql } from '../../../shared/motores/index.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { DOCS_CHANNELS } from '../../../shared/db-documentos-ipc.ts'
import { KV_CHANNELS } from '../../../shared/db-claves-ipc.ts'
import { ControladorClaves } from './claves/ControladorClaves.ts'
import { registrarIpcClaves } from './claves/ipc.ts'
import { ControladorDocumentos } from './documentos/ControladorDocumentos.ts'
import { registrarIpcDocumentos } from './documentos/ipc.ts'
import { ExploradorController, type GestorClavesDelegado, type GestorDocumentosDelegado } from './ExploradorController.ts'
import { registrarIpcExplorador } from './ipc.ts'
import { MENSAJE_SIN_LECTOR, type TrabajadorGestor } from './GestorSesiones.ts'
import { GestorDocumentos } from './documentos/GestorDocumentos.ts'
import { enEsqueleto, soloMotoresCon } from './motores/filasCatalogo.ts'
import { MOTORES_EXPLORADOR, type DialectoCatalogo } from './motores/index.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)

const TIPOS: readonly DbTipoObjeto[] = [
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
  'disparador'
]

/** La versión que anuncia el trabajador falso al abrir (un motor nuevo no compila sin la suya). */
const VERSION_DE_PRUEBA: Readonly<Record<DbMotorSql, string>> = {
  oracle: '11.2.0.2.0',
  postgres: '12.4',
  sqlite: '3.53.4',
  sqlserver: '11.0.2100.60'
}

/** Lo que el trabajador falso recibe: op y, en `ejecutar`, el SQL, sus binds y su propósito. */
interface Mensaje {
  op: string
  sql?: string
  binds?: unknown
  proposito?: string
}

/** Qué filas contesta el trabajador falso a cada SQL (por defecto, ninguna). */
type FilasFalsas = (sql: string) => unknown[][]

/** Un trabajador que abre con la versión de su motor y contesta `filas` (cero, sin ella) a todo. */
function trabajadorFalso(con: DbConnection, mensajes: Mensaje[], filas?: FilasFalsas): TrabajadorGestor {
  let vivo = false
  const respuesta = (p: { op: string; sql?: unknown }): unknown => {
    switch (p.op) {
      case 'abrir':
        return { modo: 'nativo', driverId: null, version: esMotorSql(con.motor) ? VERSION_DE_PRUEBA[con.motor] : undefined, esquema: 'E', usuario: 'u' }
      case 'ejecutar': {
        const f = filas && typeof p.sql === 'string' ? filas(p.sql) : []
        return {
          tipo: 'filas',
          columnas: [{ nombre: 'a', tipoLogico: 'texto', tipoMotor: 'x' }],
          filasJson: JSON.stringify(f),
          nFilas: f.length,
          hayMas: false,
          lector: null,
          comando: 'SELECT',
          msEjecucion: 1,
          msLectura: 1,
          tx: 'ninguna'
        }
      }
      case 'leer':
        return { filasJson: '[]', nFilas: 0, hayMas: false, lector: null, ms: 1 }
      case 'tx':
        return { tx: 'ninguna' }
      case 'cerrar':
        return { cerrada: true }
      case 'cancelar':
        return { cancelada: true }
      case 'cerrarLector':
        return { cerrado: true }
      case 'autoCommit':
        return { autoCommit: true, tx: 'ninguna' }
      case 'salir':
        vivo = false
        return { saliendo: true }
      default:
        return {}
    }
  }
  const falso = {
    get vivo(): boolean {
      return vivo
    },
    get pendientes(): number {
      return 0
    },
    async arrancar(): Promise<unknown> {
      vivo = true
      return { v: 1, pid: 1, versiones: { node: 'falso' } }
    },
    async enviar(peticion: unknown): Promise<unknown> {
      const p = peticion as { op: string; sql?: unknown; binds?: unknown; opciones?: { proposito?: unknown } }
      const m: Mensaje = { op: p.op }
      if (typeof p.sql === 'string') m.sql = p.sql
      if (p.binds !== undefined) m.binds = p.binds
      if (typeof p.opciones?.proposito === 'string') m.proposito = p.opciones.proposito
      mensajes.push(m)
      return respuesta(p)
    },
    onEvento: () => () => {},
    onSalida: () => () => {},
    async salir(): Promise<void> {
      vivo = false
    },
    matar(): void {
      vivo = false
    }
  }
  return falso as unknown as TrabajadorGestor
}

interface Banco {
  ex: ExploradorController
  mensajes: Mensaje[]
  lanzados: { n: number }
  d: DialectoCatalogo
}

/**
 * `logs`: si se pasa, recibe el registro del controlador (lo usan (10) y (11)). `filas`: lo
 * que contesta el trabajador a cada SQL (lo usa (8) para llegar a la SEGUNDA consulta de
 * una lectura).
 */
function banco(motor: DbMotor, logs?: string[], filas?: FilasFalsas): Banco {
  const con: DbConnection = {
    id: 'c1',
    profileId: 'p1',
    alias: 'ALIAS',
    motor,
    host: 'servidor.local',
    // `esMotor`: el caso (10) arma una conexión con un motor que el registro no conoce.
    port: esMotor(motor) ? (REGISTRO[motor].conexion.puertoPorDefecto ?? 0) : 1,
    database: 'db',
    user: 'u',
    tieneSecreto: true,
    readonly: false,
    driverId: null
  }
  const mensajes: Mensaje[] = []
  const lanzados = { n: 0 }
  const ex = new ExploradorController({
    conexiones: {
      get: (id) => (id === con.id ? con : undefined),
      secretOf: () => 'secreto',
      // Motor de archivo (SQLite): la ruta guardada; el trabajador es falso y no la abre.
      rutaArchivoDe: (id) => (id === con.id ? '/prueba/base.db' : undefined),
      setEsquemasVisibles: () => con,
      setIntrospeccion: () => {},
      marcarVerificada: () => false
    },
    registro: {
      ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
      notificarCambio: () => {},
      espacioDeDatos: () => {
        throw new Error('no se usa')
      },
      tdbScriptDir: () => '',
      ensureWorkspace: () => {}
    },
    perfilVivo: () => true,
    nombrePerfil: () => 'P',
    papelera: async () => {},
    plataforma: plataformaActual(),
    getWindow: () => null,
    lanzar: (c) => {
      lanzados.n++
      return trabajadorFalso(c, mensajes, filas)
    },
    log: (linea) => {
      logs?.push(linea)
    }
  })
  const version = Number(((esMotorSql(motor) ? VERSION_DE_PRUEBA[motor] : undefined) ?? '0').split('.')[0])
  return { ex, mensajes, lanzados, d: { motor, versionMayor: version } }
}

/** El SQL de las consultas de CATÁLOGO que recibió el trabajador desde `desde`. */
function catalogoDesde(b: Banco, desde: number): string[] {
  return b.mensajes
    .slice(desde)
    .filter((m) => m.op === 'ejecutar' && m.proposito === 'catalogo')
    .map((m) => m.sql ?? '')
}

async function main(): Promise<void> {
  // Un motor cuyo catálogo o sesión del main todavía es un ESQUELETO queda
  // fuera mientras lo sea, y se dice; en cuanto se rellene, entra solo (ver `enEsqueleto`).
  const esqueletos = (Object.keys(MOTORES_EXPLORADOR) as DbMotorSql[]).filter(
    (m) =>
      enEsqueleto(() => MOTORES_EXPLORADOR[m].catalogo.sqlEsquemas({ motor: m, versionMayor: MOTORES[m].sesion.versionMinima })) ||
      enEsqueleto(() => MOTORES_EXPLORADOR[m].sesion.sqlLeerEsquema())
  )
  if (esqueletos.length) console.log(`(motores en esqueleto, fuera de estas pruebas: ${esqueletos.join(', ')})`)
  const motores = (Object.keys(MOTORES_EXPLORADOR) as DbMotorSql[]).filter((m) => !esqueletos.includes(m))

  hr('(1) Sinónimos: tieneSinonimos decide si se pregunta')
  for (const m of motores) {
    const b = banco(m)
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const r = await b.ex.resolver('c1', 'E', 'S')
    const consultas = catalogoDesde(b, 0)
    if (MOTORES[m].catalogo.tieneSinonimos) {
      check(
        `${m}: con sinónimos, la primera consulta es sqlResolverSinonimo`,
        consultas[0] === cat.sqlResolverSinonimo(b.d, 'E', 'S').sql,
        j(consultas)
      )
    } else {
      // El aviso nombra los motores que SÍ tienen sinónimos (del registro); con los de hoy,
      // el texto de siempre (lo fija el caso de abajo, al byte).
      const aviso = soloMotoresCon('sinónimos', (x) => x.catalogo.tieneSinonimos)
      check(
        `${m}: sin sinónimos, «${aviso}» y ni una consulta de catálogo`,
        !r.ok && r.error.motivo === 'interno' && r.error.mensaje === aviso && consultas.length === 0,
        j({ r, consultas })
      )
      const abrir = await b.ex.abrirTabla({ conexionId: 'c1', peticionId: 'p1', objeto: { esquema: 'E', nombre: 'S', tipo: 'sinonimo' }, maxFilas: 10 })
      check(`${m}: abrir un «sinónimo» da el mismo error`, !abrir.ok && abrir.error.mensaje === aviso, j(abrir))
    }
  }
  {
    // El texto que ve PostgreSQL hoy, al byte: el motor lo deriva del
    // registro, pero con Oracle y PG tiene que seguir siendo este.
    const b = banco('postgres')
    const r = await b.ex.resolver('c1', 'E', 'S')
    // (con SQL Server, que también los tiene, el aviso pasa solo al plural.)
    check('postgres: el aviso es «Solo Oracle y SQL Server tienen sinónimos.»', !r.ok && r.error.mensaje === 'Solo Oracle y SQL Server tienen sinónimos.', j(r))
    // Y sale del REGISTRO, no de un literal: con la etiqueta de Oracle cambiada a
    // propósito (y restaurada), el aviso de PG la sigue. Un «Solo Oracle…» escrito a mano
    // pasaría el caso de arriba y no este.
    const descriptorOracle = MOTORES.oracle as { etiqueta: string }
    const etiqueta = descriptorOracle.etiqueta
    try {
      descriptorOracle.etiqueta = 'Oracle de prueba'
      const otra = await banco('postgres').ex.resolver('c1', 'E', 'S')
      check(
        'postgres: el aviso nombra la etiqueta del registro (cambiada: «Solo Oracle de prueba y SQL Server tienen sinónimos.»)',
        !otra.ok && otra.error.mensaje === 'Solo Oracle de prueba y SQL Server tienen sinónimos.',
        j(otra)
      )
    } finally {
      descriptorOracle.etiqueta = etiqueta
    }
  }

  hr('(2) Nombres públicos: pseudoEsquemaPublico decide si hay capa')
  for (const m of motores) {
    const b = banco(m)
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const r = await b.ex.nombresPublicos('c1')
    if (MOTORES[m].catalogo.pseudoEsquemaPublico === null) {
      check(
        `${m}: sin pseudo-esquema, ok([]) sin lanzar ningún trabajador`,
        r.ok && r.valor.length === 0 && b.lanzados.n === 0,
        j({ r, lanzados: b.lanzados.n })
      )
    } else {
      const antes = b.mensajes.length
      const consultas = catalogoDesde(b, 0)
      const esperada = cat.sqlNombresPublicos(b.d)
      check(
        `${m}: con pseudo-esquema, la consulta es sqlNombresPublicos`,
        r.ok && esperada !== null && consultas.length === 1 && consultas[0] === esperada.sql,
        j({ r, consultas })
      )
      const otra = await b.ex.nombresPublicos('c1')
      check(`${m}: la segunda vez sale de la caché`, otra.ok && catalogoDesde(b, antes).length === 0, j(catalogoDesde(b, antes)))
    }
  }

  hr('(3) «Ver DDL»: tieneDdl decide sin tocar el trabajador')
  for (const m of motores) {
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const malos: string[] = []
    for (const t of TIPOS) {
      const b = banco(m)
      const r = await b.ex.ddl('c1', { esquema: 'E', nombre: 'O', tipo: t })
      const sinDdl = !r.ok && r.error.mensaje === 'Ese tipo de objeto no tiene DDL en este motor.'
      if (cat.tieneDdl(t) ? sinDdl : !sinDdl || b.lanzados.n !== 0) malos.push(`${t}: ${j(r)} (lanzados ${b.lanzados.n})`)
    }
    check(`${m}: los ${TIPOS.length} tipos responden según tieneDdl`, malos.length === 0, malos.join(' | '))
  }

  hr('(4) Detalle de columnas: pkEnColumnas decide si la PK va aparte')
  for (const m of motores) {
    const b = banco(m)
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const r = await b.ex.detalle('c1', { esquema: 'E', nombre: 'T', tipo: 'tabla' }, ['columnas'])
    const consultas = catalogoDesde(b, 0)
    const esperadas = cat.pkEnColumnas
      ? [cat.sqlColumnas(b.d, 'E', 'T').sql]
      : [cat.sqlColumnas(b.d, 'E', 'T').sql, cat.sqlClavePrimaria(b.d, 'E', 'T').sql]
    check(
      `${m}: pkEnColumnas=${cat.pkEnColumnas} ⇒ ${esperadas.length} consulta(s), en su orden`,
      r.ok && j(consultas) === j(esperadas),
      j({ r, consultas })
    )
  }

  hr('(5) Abrir una tabla: leeTiposDeclarados decide si se piden los tipos')
  for (const m of motores) {
    const b = banco(m)
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const r = await b.ex.abrirTabla({ conexionId: 'c1', peticionId: 'p1', objeto: { esquema: 'E', nombre: 'T', tipo: 'tabla' }, maxFilas: 10 })
    const consultas = catalogoDesde(b, 0)
    if (cat.leeTiposDeclarados) {
      const sql = cat.sqlTiposColumnas(b.d, 'E', 'T').sql
      check(`${m}: con tipos declarados, se pide sqlTiposColumnas`, r.ok && consultas.indexOf(sql) >= 0, j({ r, consultas }))
    } else {
      // Su `sqlTiposColumnas` lanza (lo fija test-catalogo-motores): pedirlo sería un error en el log.
      check(`${m}: sin tipos declarados, la tabla se abre igual`, r.ok, j(r))
    }
  }

  hr('(6) FKs: las consultas son las de catalogo.leerFks')
  for (const m of motores) {
    const b = banco(m)
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const r = await b.ex.fks('c1', { esquema: 'E', nombre: 'T', tipo: 'tabla' })
    const consultas = catalogoDesde(b, 0)
    const esperadas: string[] = []
    await cat.leerFks(
      {
        dialecto: b.d,
        construir: (fn) => fn(),
        consultar: async (c) => {
          esperadas.push(c.sql)
          return []
        }
      },
      'E',
      'T'
    )
    check(`${m}: ${esperadas.length} consulta(s), las mismas y en el mismo orden`, r.ok && j(consultas) === j(esperadas), j({ consultas, esperadas }))
  }

  hr('(7) Exportar: qué es un motor válido')
  {
    const b = banco(motores[0])
    const base = { conexionId: 'c1', peticionId: 'e1', formato: 'csv', nombreSugerido: 'x' }
    for (const m of motores) {
      const r = await b.ex.exportar({ ...base, motor: m })
      check(`'${m}' pasa la comprobación del motor`, !r.ok && r.error.mensaje === 'Petición inválida: falta «origen».', j(r))
    }
    for (const m of ['constructor', 'toString', '', 7, null, 'motorInventado']) {
      const r = await b.ex.exportar({ ...base, motor: m })
      check(`${j(m)} es un motor inválido`, !r.ok && r.error.mensaje === 'Petición inválida: «motor».', j(r))
    }
  }

  hr('(8) Lo que el motor lee por el lector sale clasificado')
  // `leerFks` y `leerDdl` construyen sus consultas con `lector.construir` y lanzan sus
  // fallos seguros con `lector.fallo`: el controlador tiene que convertir los dos en un
  // error `interno` CON SU MENSAJE, no en «Error interno del explorador…». Se sustituye
  // el método del motor por uno que falla a propósito y se restaura después.
  for (const m of motores) {
    const cat = MOTORES_EXPLORADOR[m].catalogo
    const leerFks = cat.leerFks
    const leerDdl = cat.leerDdl
    const alConstruir = `Catálogo: «prueba» no existe en ${MOTORES[m].etiqueta}`
    try {
      cat.leerFks = async (lector) => {
        await lector.consultar(
          lector.construir(() => {
            throw new Error(alConstruir)
          })
        )
        return { salientes: [], entrantes: [] }
      }
      const fk = await banco(m).ex.fks('c1', { esquema: 'E', nombre: 'T', tipo: 'tabla' })
      check(
        `${m}: FKs, un fallo al construir la consulta llega como interno con su mensaje`,
        !fk.ok && fk.error.motivo === 'interno' && fk.error.mensaje === alConstruir,
        j(fk)
      )
      const tipoConDdl = TIPOS.find((t) => cat.tieneDdl(t)) ?? 'tabla'
      cat.leerDdl = async (lector) => {
        throw lector.fallo('Mensaje seguro de prueba.')
      }
      const dd = await banco(m).ex.ddl('c1', { esquema: 'E', nombre: 'O', tipo: tipoConDdl })
      check(
        `${m}: «Ver DDL», lector.fallo llega como interno con su mensaje`,
        !dd.ok && dd.error.motivo === 'interno' && dd.error.mensaje === 'Mensaje seguro de prueba.',
        j(dd)
      )
      cat.leerDdl = async (lector) => {
        const c = lector.construir(() => {
          throw new Error(alConstruir)
        })
        await lector.consultar(c)
        return { partes: [], origen: 'x' }
      }
      const dc = await banco(m).ex.ddl('c1', { esquema: 'E', nombre: 'O', tipo: tipoConDdl })
      check(
        `${m}: «Ver DDL», un fallo al construir llega como interno con su mensaje`,
        !dc.ok && dc.error.motivo === 'interno' && dc.error.mensaje === alConstruir,
        j(dc)
      )
      // Y el lector lleva el dialecto de la sesión y pregunta por el turno de catálogo.
      let visto: DialectoCatalogo | null = null
      cat.leerDdl = async (lector) => {
        visto = lector.dialecto
        await lector.consultar(lector.construir(() => ({ sql: 'SELECT 1 AS prueba_lector', binds: [] })))
        return { partes: [{ titulo: 'DDL', texto: 'x' }], origen: 'prueba' }
      }
      const b = banco(m)
      const ok = await b.ex.ddl('c1', { esquema: 'E', nombre: 'O', tipo: tipoConDdl })
      check(
        `${m}: el lector lleva el dialecto de la sesión y sus consultas van por el turno de catálogo`,
        ok.ok && j(visto) === j(b.d) && catalogoDesde(b, 0).indexOf('SELECT 1 AS prueba_lector') >= 0,
        j({ ok, visto, consultas: catalogoDesde(b, 0) })
      )
      // `bloqueTexto` (el DDL de Oracle): al trabajador llegan su SQL, sus binds y el bind de
      // salida con SU tope, por el turno de catálogo. El DDL de Oracle lo usa con TOPE_DDL;
      // un tope cambiado en el camino recortaría el DDL en otro sitio sin que nada fallase.
      cat.leerDdl = async (lector) => {
        await lector.bloqueTexto('BEGIN prueba_bloque; END;', { a: 'x', n: 7 }, 'salida_prueba', 1234)
        return { partes: [], origen: 'prueba' }
      }
      const bb = banco(m)
      const rb = await bb.ex.ddl('c1', { esquema: 'E', nombre: 'O', tipo: tipoConDdl })
      const bloque = bb.mensajes.find((x) => x.op === 'ejecutar' && x.sql === 'BEGIN prueba_bloque; END;')
      check(
        `${m}: lector.bloqueTexto llega al trabajador con su SQL, sus binds y su salida con el tope`,
        rb.ok &&
          bloque !== undefined &&
          bloque.proposito === 'catalogo' &&
          j(bloque.binds) === j({ a: 'x', n: 7, salida_prueba: { salida: 'texto', tope: 1234 } }),
        j({ rb, bloque })
      )
    } finally {
      cat.leerFks = leerFks
      cat.leerDdl = leerDdl
    }
    // Las lecturas de UNA consulta que antes construían a pelo (esquemas, resolver un
    // sinónimo, sinónimos públicos) pasan también por `construir`.
    const sqlEsquemas = cat.sqlEsquemas
    const sqlResolverSinonimo = cat.sqlResolverSinonimo
    const sqlNombresPublicos = cat.sqlNombresPublicos
    const romper = (): never => {
      throw new Error(alConstruir)
    }
    try {
      cat.sqlEsquemas = romper
      const es = await banco(m).ex.esquemas('c1')
      check(`${m}: esquemas, un fallo al construir llega como interno con su mensaje`, !es.ok && es.error.mensaje === alConstruir, j(es))
      if (MOTORES[m].catalogo.tieneSinonimos) {
        cat.sqlResolverSinonimo = romper
        const rs = await banco(m).ex.resolver('c1', 'E', 'S')
        check(`${m}: resolver un sinónimo, ídem`, !rs.ok && rs.error.mensaje === alConstruir, j(rs))
      }
      if (MOTORES[m].catalogo.pseudoEsquemaPublico !== null) {
        cat.sqlNombresPublicos = romper
        const np = await banco(m).ex.nombresPublicos('c1')
        check(`${m}: sinónimos públicos, ídem`, !np.ok && np.error.mensaje === alConstruir, j(np))
      }
    } finally {
      cat.sqlEsquemas = sqlEsquemas
      cat.sqlResolverSinonimo = sqlResolverSinonimo
      cat.sqlNombresPublicos = sqlNombresPublicos
    }
    // Las SEGUNDAS consultas de esas lecturas (la cabecera del controlador las
    // da por construidas, y nada lo comprobaba). Para llegar a ellas el trabajador contesta
    // una fila a todo: `E` como esquema (y como esquema por defecto) y `E.T` como destino
    // local del sinónimo.
    const unaFila: FilasFalsas = () => [['E', 'T', null]]
    const sqlEsquemaPorDefecto = cat.sqlEsquemaPorDefecto
    const sqlTipoDeObjeto = cat.sqlTipoDeObjeto
    const sqlNombres = cat.sqlNombres
    try {
      cat.sqlEsquemaPorDefecto = romper
      const pd = await banco(m).ex.esquemas('c1')
      check(`${m}: el esquema por defecto, un fallo al construir llega como interno con su mensaje`, !pd.ok && pd.error.mensaje === alConstruir, j(pd))
      cat.sqlEsquemaPorDefecto = sqlEsquemaPorDefecto
      if (MOTORES[m].catalogo.tieneSinonimos) {
        cat.sqlTipoDeObjeto = romper
        const bt = banco(m, undefined, unaFila)
        const tt = await bt.ex.resolver('c1', 'E', 'S')
        check(
          `${m}: el tipo del destino de un sinónimo (2.ª consulta de resolver), ídem`,
          !tt.ok && tt.error.mensaje === alConstruir && catalogoDesde(bt, 0).length === 1,
          j({ tt, consultas: catalogoDesde(bt, 0) })
        )
      }
      cat.sqlNombres = romper
      const bn = banco(m, undefined, unaFila)
      const nn = await bn.ex.nombres('c1')
      check(
        `${m}: el índice de nombres (tras leer los esquemas), ídem`,
        !nn.ok && nn.error.mensaje === alConstruir && catalogoDesde(bn, 0).length === 2,
        j({ nn, consultas: catalogoDesde(bn, 0) })
      )
    } finally {
      cat.sqlEsquemaPorDefecto = sqlEsquemaPorDefecto
      cat.sqlTipoDeObjeto = sqlTipoDeObjeto
      cat.sqlNombres = sqlNombres
    }
  }

  hr('(9) Exportar una tabla: la previa del WHERE usa la forma de paginado de su motor')
  // El sitio que mezclaba dos claves (la forma leída del MOTOR, validada contra el
  // DIALECTO) lee ahora las dos de la misma. Con una forma que el dialecto no admite, la
  // previa fallaría con «La forma de paginado … no vale para …» antes del diálogo.
  for (const m of motores) {
    const base = { peticionId: 'x', formato: 'csv', nombreSugerido: 'x', motor: m }
    const objeto = { esquema: 'E', nombre: 'T', tipo: 'tabla' }
    const bien = await banco(m).ex.exportar({ ...base, origen: { tipo: 'tabla', conexionId: 'c1', objeto, where: 'A = 1' } })
    check(
      `${m}: un WHERE válido pasa la previa y llega al diálogo de guardar`,
      !bien.ok && bien.error.mensaje === 'No hay diálogo de guardar en este entorno.',
      j(bien)
    )
    const mal = await banco(m).ex.exportar({ ...base, origen: { tipo: 'tabla', conexionId: 'c1', objeto, where: 'A = (' } })
    check(`${m}: un WHERE roto se rechaza en la previa, con su campo`, !mal.ok && mal.error.campo === 'where', j(mal))
  }

  hr('(10) Una conexión de un motor desconocido: «Motor desconocido», no un TypeError')
  // Hoy el registro de conexiones no le da al controlador una conexión de un motor que
  // no conoce (las ajenas se quedan atenuadas en el árbol), pero si llegara, cada decisión
  // pasa por `descriptor()`/`motorExplorador()`, que lanzan con su nombre. Antes, las
  // carpetas se leían de `CARPETAS_POR_MOTOR[motor]` a pelo: «Cannot read properties of
  // undefined». El renderer recibe el error interno genérico en los dos casos; lo que
  // cambia es que el registro dice QUÉ pasó.
  {
    const logs: string[] = []
    const b = banco('motorInventado' as DbMotor, logs)
    const r = await b.ex.objetos('c1', 'E', 'tabla')
    check(
      'objetos(): error interno, y el registro dice «Motor desconocido» (sin TypeError)',
      !r.ok &&
        r.error.motivo === 'interno' &&
        logs.some((l) => l.indexOf('Motor desconocido') >= 0) &&
        !logs.some((l) => /Cannot read|undefined/.test(l)) &&
        b.lanzados.n === 0,
      j({ r, logs })
    )
  }

  hr('(11) La identidad de edición: un fallo al construir deja su MOTIVO en el registro')
  // `edicionDe` se traga el fallo (la tabla se abre sin edición: leer no depende de poder
  // escribir), así que el usuario no ve nada; lo que cambia es el registro. Sin `construir`,
  // el gestor lo cambiaba por «Error interno del explorador…» y el motivo solo salía en otra
  // línea («error interno: …»), sin decir de qué lectura era.
  for (const m of motores) {
    const sesion = MOTORES_EXPLORADOR[m].sesion
    const original = sesion.sqlColumnasEdicion
    const motivo = `Catálogo: «edición de prueba» no existe en ${MOTORES[m].etiqueta}`
    const logs: string[] = []
    try {
      sesion.sqlColumnasEdicion = (): never => {
        throw new Error(motivo)
      }
      const b = banco(m, logs)
      const r = await b.ex.abrirTabla({ conexionId: 'c1', peticionId: 'p1', objeto: { esquema: 'E', nombre: 'T', tipo: 'tabla' }, maxFilas: 10 })
      check(
        `${m}: la tabla se abre sin edición y el registro dice el motivo, no «Error interno…»`,
        r.ok &&
          r.valor.identidad?.tipo === 'ninguna' &&
          logs.indexOf(`no se pudo leer la identidad de edición de c1: ${motivo}`) >= 0 &&
          !logs.some((l) => l.indexOf('error interno') >= 0 || l.indexOf('Error interno') >= 0),
        j({ r, logs })
      )
    } finally {
      sesion.sqlColumnasEdicion = original
    }
  }

  hr('(12) Guardia: cada sqlX( del controlador va dentro de construir(() => …)')
  {
    const esComentario = (l: string): boolean => {
      const t = l.trim()
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
    }
    /**
     * Las llamadas a un constructor de SQL (`sqlX(`) de una línea de CÓDIGO que no van dentro
     * de `construir(() => `. `anterior`: la línea de arriba, por si el formateador parte la
     * línea justo después de la flecha.
     */
    const sueltas = (linea: string, anterior = ''): string[] => {
      if (esComentario(linea)) return []
      const codigo = linea.split(' // ')[0]
      const malas: string[] = []
      for (const x of codigo.matchAll(/\bsql[A-Z]\w*\(/g)) {
        const antes = codigo.slice(0, x.index ?? 0)
        const partida = antes.trim() === '' && anterior.trimEnd().endsWith('construir(() =>')
        if (!antes.endsWith('construir(() => ') && !partida) malas.push(x[0])
      }
      return malas
    }
    // El detector, en las dos direcciones (true = la tiene que marcar).
    const casos: Array<[string, string, boolean]> = [
      ['    const filas = await ctx.consultar(construir(() => sqlEsquemas(ctx.dialecto)))', '', false],
      ['    for (const c of construir(() => sqlNombres(ctx.dialecto, [esq]))) filas.push(c)', '', false],
      ['      sqlTipoDeObjeto(ctx.dialecto, e, n)', '    await ctx.consultar(construir(() =>', false],
      ['      sqlTipoDeObjeto(ctx.dialecto, e, n)', '    await ctx.consultar(', true],
      ['    async (ctx) => mapearUnicaNoNula(await ctx.consultar(sqlUnicaNoNula(ref.esquema, ref.nombre))),', '', true],
      ['    const c = sqlNombresPublicos(ctx.dialecto)', '', true],
      ['    // antes: ctx.consultar(sqlFks(d, e, n))', '', false],
      ['   * `sqlTipoDeObjeto(d, e, n)` en un comentario de bloque', '', false],
      ['  sqlColumnas,', '', false]
    ]
    const fallosDetector = casos.filter(([l, a, marcar]) => (sueltas(l, a).length > 0) !== marcar)
    check(`el detector distingue lo construido de lo suelto (${casos.length} líneas inventadas)`, fallosDetector.length === 0, j(fallosDetector))
    // TODO lo que salió del controlador: la carpeta `controlador/` entera (leída, no una lista que
    // se quede atrás al añadir un módulo), la fachada y su `ipc.ts`.
    const archivos = [
      ...readdirSync(new URL('./controlador/', import.meta.url))
        .filter((n) => n.endsWith('.ts'))
        .sort()
        .map((n) => `./controlador/${n}`),
      './ExploradorController.ts',
      './ipc.ts'
    ]
    let llamadas = 0
    const malas: string[] = []
    for (const archivo of archivos) {
      const fuente = readFileSync(new URL(archivo, import.meta.url), 'utf8').split(/\r?\n/)
      fuente.forEach((l, i) => {
        if (!esComentario(l)) llamadas += (l.split(' // ')[0].match(/\bsql[A-Z]\w*\(/g) ?? []).length
        for (const s of sueltas(l, fuente[i - 1] ?? '')) malas.push(`${archivo}:${i + 1}: ${s}`)
      })
    }
    // Hoy son 17; el mínimo evita que la guardia pase en vacío si cambia la forma del código.
    check(
      `controlador/*.ts, la fachada e ipc.ts (${archivos.length} archivos): sus ${llamadas} constructores de SQL, todos dentro de construir(() => …)`,
      llamadas >= 15 && malas.length === 0,
      j(malas)
    )
  }

  hr('(13) una conexión de otra familia en un canal SQL, error clasificado y sin trabajador')
  for (const m of IDS_MOTORES.filter((x) => !esMotorSql(x))) {
    const esperado = `Todavía no se puede conectar a ${REGISTRO[m].etiqueta} desde esta versión.`
    // Directo: `conexionOError` rechaza antes de tocar el descriptor SQL.
    const b = banco(m)
    const r = await b.ex.objetos('c1', 'E', 'tabla')
    check(
      `${m}: objetos() directo → motivo 'driver' y «${esperado}», sin lanzar el trabajador`,
      !r.ok && r.error.motivo === 'driver' && r.error.mensaje === esperado && b.lanzados.n === 0,
      j(r)
    )
    // Por el handler registrado (`hSql`): cada canal SQL con `conexionId`, la misma respuesta.
    const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
    const ipcFalso = {
      handle: (canal: string, fn: (e: unknown, req: unknown) => Promise<unknown>) => {
        handlers.set(canal, fn)
      },
      on: () => {}
    } as unknown as IpcMain
    const b2 = banco(m)
    registrarIpcExplorador({ ipc: ipcFalso, explorador: b2.ex })
    const canales = [
      DBX_CHANNELS.ESQUEMAS,
      DBX_CHANNELS.BASES,
      DBX_CHANNELS.RESUMEN,
      DBX_CHANNELS.OBJETOS,
      DBX_CHANNELS.DETALLE,
      DBX_CHANNELS.FUENTE,
      DBX_CHANNELS.DDL,
      DBX_CHANNELS.TABLA_ABRIR,
      DBX_CHANNELS.DATOS_ENVIAR
    ]
    const malos: string[] = []
    for (const canal of canales) {
      const fn = handlers.get(canal)
      const resp = fn ? ((await fn({}, { conexionId: 'c1', esquema: 'E', tipo: 'tabla' })) as { ok: boolean; error?: { motivo: string; mensaje: string } }) : null
      if (!resp || resp.ok || resp.error?.motivo !== 'driver' || resp.error.mensaje !== esperado) malos.push(`${canal}: ${j(resp)}`)
    }
    check(`${m}: ${canales.length} canales SQL registrados responden el error clasificado, sin trabajador`, malos.length === 0 && b2.lanzados.n === 0, j(malos))
  }

  hr('(14) documentos y claves, un handler por canal y solo para su familia')
  {
    type Resp = { ok: boolean; valor?: unknown; error?: { motivo: string; mensaje: string } }
    const conDe = (id: string, motor: DbMotor, profileId = 'p1'): DbConnection => ({
      id,
      profileId,
      alias: id,
      motor,
      host: 'h',
      port: 1,
      user: '',
      tieneSecreto: false,
      readonly: true,
      driverId: null
    })
    const registro = new Map<string, DbConnection>([
      ['mongo', conDe('mongo', 'mongodb')],
      ['redis', conDe('redis', 'redis')],
      ['ora', conDe('ora', 'oracle')]
    ])
    const conexiones = { get: (id: string) => registro.get(id) }
    const ipcDe = (): { ipc: IpcMain; handlers: Map<string, (e: unknown, req: unknown) => Promise<unknown>> } => {
      const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
      const ipc = { handle: (c: string, fn: (e: unknown, req: unknown) => Promise<unknown>) => void handlers.set(c, fn) } as unknown as IpcMain
      return { ipc, handlers }
    }
    // El gestor de documentos FALSO: responde el nombre de la operación, y apunta
    // qué le llegó, para ver que la petición válida pasa y la inválida no.
    const llamadas: Array<{ op: string; req: unknown; politica?: unknown }> = []
    const gestorFalso = {
      bases: async (req: unknown) => (llamadas.push({ op: 'bases', req }), { ok: true as const, valor: 'bases' as never }),
      colecciones: async (req: unknown) => (llamadas.push({ op: 'colecciones', req }), { ok: true as const, valor: 'colecciones' as never }),
      detalle: async (req: unknown) => (llamadas.push({ op: 'detalle', req }), { ok: true as const, valor: 'detalle' as never }),
      consultar: async (req: unknown) => (llamadas.push({ op: 'consultar', req }), { ok: true as const, valor: 'consultar' as never }),
      leerMas: async (req: unknown) => (llamadas.push({ op: 'leerMas', req }), { ok: true as const, valor: 'leerMas' as never }),
      cerrarLector: async (req: unknown) => void llamadas.push({ op: 'cerrarLector', req }),
      ejecutarConsola: async (req: unknown, politica: unknown) => (llamadas.push({ op: 'ejecutarConsola', req, politica }), { ok: true as const, valor: 'ejecutarConsola' as never }),
      enviar: async (req: unknown, politica: unknown) => (llamadas.push({ op: 'enviar', req, politica }), { ok: true as const, valor: 'enviar' as never })
    }
    const validaDocs: Record<string, Record<string, unknown>> = {
      [DOCS_CHANNELS.BASES]: {},
      [DOCS_CHANNELS.COLECCIONES]: { base: 'pruebas' },
      [DOCS_CHANNELS.DETALLE]: { base: 'pruebas', coleccion: 'clientes' },
      [DOCS_CHANNELS.CONSULTAR]: { base: 'pruebas', coleccion: 'clientes', filtro: '', proyeccion: '', orden: '', maxDocumentos: 50 },
      [DOCS_CHANNELS.CONSOLA_EJECUTAR]: { consolaId: 'k1', base: null, texto: 'db.clientes.find()', desplazamiento: 0 },
      [DOCS_CHANNELS.ENVIAR]: { base: 'pruebas', coleccion: 'clientes', cambios: [{ tipo: 'borrar', idEjson: '{"$oid":"650000000000000000000001"}' }] }
    }
    // El gestor de claves FALSO, igual que el de documentos.
    const llamadasKv: Array<{ op: string; req: unknown; politica?: unknown }> = []
    const gestorClavesFalso = {
      bases: async (req: unknown) => (llamadasKv.push({ op: 'bases', req }), { ok: true as const, valor: 'bases' as never }),
      escanear: async (req: unknown) => (llamadasKv.push({ op: 'escanear', req }), { ok: true as const, valor: 'escanear' as never }),
      valor: async (req: unknown) => (llamadasKv.push({ op: 'valor', req }), { ok: true as const, valor: 'valor' as never }),
      ejecutarConsola: async (req: unknown, politica: unknown) => (llamadasKv.push({ op: 'ejecutarConsola', req, politica }), { ok: true as const, valor: 'ejecutarConsola' as never })
    }
    const validaKv: Record<string, Record<string, unknown>> = {
      [KV_CHANNELS.BASES]: {},
      [KV_CHANNELS.ESCANEAR]: { base: 0, patron: 'usuario:*', cursor: '0', cuenta: 500 },
      [KV_CHANNELS.VALOR]: { base: 1, clave: { texto: 'a b', base64: 'YSBi' } },
      [KV_CHANNELS.CONSOLA_EJECUTAR]: { consolaId: 'k1', base: 0, texto: 'GET a', desplazamiento: 0 }
    }
    const familias: Array<{
      nombre: string
      canales: Record<string, string>
      propia: string
      ajenas: string[]
      registrar: (ipc: IpcMain) => void
      sinConexion: string[]
      /** La petición VÁLIDA de un canal para la conexión propia (además de conexionId y perfilId). */
      valida: (canal: string) => Record<string, unknown>
      /** ¿Es la respuesta esperada con la conexión propia? */
      propiaBien: (r: Resp, canal: string) => boolean
    }> = [
      {
        nombre: 'documentos',
        canales: DOCS_CHANNELS,
        propia: 'mongo',
        ajenas: ['redis', 'ora'],
        registrar: (ipc) => registrarIpcDocumentos({ ipc, controlador: new ControladorDocumentos({ conexiones, gestor: gestorFalso }) }),
        sinConexion: [DOCS_CHANNELS.LECTOR_MAS, DOCS_CHANNELS.LECTOR_CERRAR],
        valida: (canal) => validaDocs[canal] ?? {},
        // Ya no es esqueleto: la petición válida llega al gestor (que aquí responde su op).
        propiaBien: (r) => r.ok === true && typeof r.valor === 'string'
      },
      {
        nombre: 'claves',
        canales: KV_CHANNELS,
        propia: 'redis',
        ajenas: ['mongo', 'ora'],
        registrar: (ipc) => registrarIpcClaves({ ipc, controlador: new ControladorClaves({ conexiones, gestor: gestorClavesFalso }) }),
        sinConexion: [],
        valida: (canal) => validaKv[canal] ?? {},
        // Ya no es esqueleto: la petición válida llega al gestor (sin el «todavía no»).
        propiaBien: (r) => r.ok === true && typeof r.valor === 'string'
      }
    ]
    for (const f of familias) {
      const { ipc, handlers } = ipcDe()
      f.registrar(ipc)
      const todos = Object.values(f.canales)
      check(`${f.nombre}: un handler para CADA canal del contrato (${todos.length})`, todos.every((c) => handlers.has(c)) && handlers.size === todos.length, j([...handlers.keys()]))
      const conConexion = todos.filter((c) => f.sinConexion.indexOf(c) < 0)
      const malos: string[] = []
      for (const canal of conConexion) {
        const fn = handlers.get(canal)
        if (!fn) continue
        const r = (await fn({}, { ...f.valida(canal), conexionId: f.propia, perfilId: 'p1' })) as Resp
        if (!f.propiaBien(r, canal)) malos.push(`${canal} propia: ${j(r)}`)
        // Otra familia (y un SQL): rechazo clasificado 'interno' que dice que no es de esta vista.
        for (const ajena of f.ajenas) {
          const ra = (await fn({}, { ...f.valida(canal), conexionId: ajena })) as Resp
          const etiqueta = REGISTRO[(registro.get(ajena) as DbConnection).motor].etiqueta
          if (ra.ok || ra.error?.motivo !== 'interno' || !ra.error.mensaje.startsWith(`${etiqueta} no es un motor `)) malos.push(`${canal} ${ajena}: ${j(ra)}`)
        }
        // Una que no existe, sin conexionId, o de otro perfil: 'interno', sin lanzar.
        const rx = (await fn({}, { conexionId: 'no-existe' })) as Resp
        if (rx.ok || rx.error?.motivo !== 'interno' || rx.error.mensaje !== 'La conexión ya no existe.') malos.push(`${canal} no-existe: ${j(rx)}`)
        const rv = (await fn({}, null)) as Resp
        if (rv.ok || rv.error?.motivo !== 'interno') malos.push(`${canal} null: ${j(rv)}`)
        const rp = (await fn({}, { ...f.valida(canal), conexionId: f.propia, perfilId: 'otro' })) as Resp
        if (rp.ok || rp.error?.mensaje !== 'La consola no pertenece a este perfil.') malos.push(`${canal} otro perfil: ${j(rp)}`)
      }
      check(
        `${f.nombre}: ${conConexion.length} canales con conexión: su familia → lo esperado; otra familia, inexistente, inválida u otro perfil → 'interno'`,
        malos.length === 0,
        j(malos)
      )
    }
    // Documentos: la forma se valida ANTES del gestor, y la política sale de la conexión.
    {
      const { ipc, handlers } = ipcDe()
      registrarIpcDocumentos({ ipc, controlador: new ControladorDocumentos({ conexiones, gestor: gestorFalso }) })
      llamadas.length = 0
      const malas: Array<[string, Record<string, unknown>]> = [
        [DOCS_CHANNELS.COLECCIONES, {}],
        [DOCS_CHANNELS.DETALLE, { base: 'pruebas' }],
        [DOCS_CHANNELS.CONSULTAR, { base: 'pruebas', coleccion: 'c', filtro: 3, proyeccion: '', orden: '', maxDocumentos: 50 }],
        [DOCS_CHANNELS.CONSULTAR, { base: 'pruebas', coleccion: 'c', filtro: '', proyeccion: '', orden: '', maxDocumentos: 0 }],
        [DOCS_CHANNELS.CONSOLA_EJECUTAR, { consolaId: 'k1', base: null, texto: '   ', desplazamiento: 0 }],
        [DOCS_CHANNELS.CONSOLA_EJECUTAR, { consolaId: 'k1', base: null, texto: 'db.x.find()', desplazamiento: -1 }],
        [DOCS_CHANNELS.ENVIAR, { base: 'pruebas', coleccion: 'c', cambios: [] }],
        [DOCS_CHANNELS.ENVIAR, { base: 'pruebas', coleccion: 'c', cambios: [{ tipo: 'actualizar', idEjson: 'x', poner: { a: 1 }, quitar: [] }] }],
        [DOCS_CHANNELS.ENVIAR, { base: 'pruebas', coleccion: 'c', cambios: [{ tipo: 'soltar', idEjson: 'x' }] }]
      ]
      const noRechazadas: string[] = []
      for (const [canal, req] of malas) {
        const r = (await handlers.get(canal)?.({}, { ...req, conexionId: 'mongo', perfilId: 'p1' })) as Resp
        if (r.ok || r.error?.motivo !== 'interno' || !r.error.mensaje.startsWith('Petición inválida')) noRechazadas.push(`${canal} ${j(req)}: ${j(r)}`)
      }
      check('documentos: las peticiones con mala forma → «Petición inválida…» y NO llegan al gestor', noRechazadas.length === 0 && llamadas.length === 0, j({ noRechazadas, llamadas }))
      await handlers.get(DOCS_CHANNELS.CONSOLA_EJECUTAR)?.({}, { ...validaDocs[DOCS_CHANNELS.CONSOLA_EJECUTAR], conexionId: 'mongo', perfilId: 'p1', confirmado: true })
      const pol = llamadas.find((l) => l.op === 'ejecutarConsola')?.politica
      // la conexión tiene la casilla «Solo lectura» marcada, y esa casilla es
      // de los AGENTES: el controlador del producto no la mira.
      check(
        'documentos: la consola llega con la política de la conexión (SIN solo lectura aunque la casilla de los agentes esté marcada; sin entorno, no es producción; confirmado de la petición)',
        j(pol) === j({ soloLectura: false, produccion: false, confirmado: true }),
        j(pol)
      )
      // La mitad impuesta: con `soloLecturaImpuesta`, la política la lleva.
      const imp = ipcDe()
      registrarIpcDocumentos({
        ipc: imp.ipc,
        controlador: new ControladorDocumentos({ conexiones, gestor: gestorFalso, soloLecturaImpuesta: () => true })
      })
      llamadas.length = 0
      await imp.handlers.get(DOCS_CHANNELS.CONSOLA_EJECUTAR)?.({}, { ...validaDocs[DOCS_CHANNELS.CONSOLA_EJECUTAR], conexionId: 'mongo', perfilId: 'p1', confirmado: true })
      const polImp = llamadas.find((l) => l.op === 'ejecutarConsola')?.politica
      check('documentos: con solo lectura IMPUESTA, la política dice soloLectura', j(polImp) === j({ soloLectura: true, produccion: false, confirmado: true }), j(polImp))
    }
    // Claves: lo mismo, con sus formas (base entera, clave en base64, cuenta acotada…).
    {
      const { ipc, handlers } = ipcDe()
      registrarIpcClaves({ ipc, controlador: new ControladorClaves({ conexiones, gestor: gestorClavesFalso }) })
      llamadasKv.length = 0
      const E = KV_CHANNELS.ESCANEAR
      const V = KV_CHANNELS.VALOR
      const C = KV_CHANNELS.CONSOLA_EJECUTAR
      const malas: Array<[string, Record<string, unknown>]> = [
        [E, { base: -1, patron: '', cursor: '0', cuenta: 10 }],
        [E, { base: 1.5, patron: '', cursor: '0', cuenta: 10 }],
        [E, { base: '0', patron: '', cursor: '0', cuenta: 10 }],
        [E, { base: 10000, patron: '', cursor: '0', cuenta: 10 }],
        [E, { base: 0, patron: 3, cursor: '0', cuenta: 10 }],
        [E, { base: 0, patron: '', cursor: 'abc', cuenta: 10 }],
        [E, { base: 0, patron: '', cursor: '0', cuenta: 0 }],
        [E, { base: 0, patron: '', cursor: '0', cuenta: 1_000_000 }],
        [E, { base: 0, patron: '', cursor: '0', cuenta: 10, tipo: 'otro' }],
        [V, { base: 0, clave: 'YSBi' }],
        [V, { base: 0, clave: { base64: 'no es base64!' } }],
        [V, { base: 0, clave: { base64: 'YSB' } }],
        [V, { base: 0, clave: { base64: 'YSBi' }, cuantos: 0 }],
        [V, { base: 0, clave: { base64: 'YSBi' }, desde: 5 }],
        [C, { consolaId: 'k1', base: 0, texto: '   ', desplazamiento: 0 }],
        [C, { consolaId: 'k1', base: 0, texto: 'GET a', desplazamiento: -1 }],
        [C, { consolaId: 'k1', base: -2, texto: 'GET a', desplazamiento: 0 }],
        [C, { consolaId: 'k1', base: 0, texto: 'GET a', desplazamiento: 0, confirmadoPeligroso: 'si' }],
        [C, { base: 0, texto: 'GET a', desplazamiento: 0 }]
      ]
      const noRechazadas: string[] = []
      for (const [canal, req] of malas) {
        const r = (await handlers.get(canal)?.({}, { ...req, conexionId: 'redis', perfilId: 'p1' })) as Resp
        if (r.ok || r.error?.motivo !== 'interno' || !r.error.mensaje.startsWith('Petición inválida')) noRechazadas.push(`${canal} ${j(req)}: ${j(r)}`)
      }
      check('claves: las peticiones con mala forma → «Petición inválida…» y NO llegan al gestor', noRechazadas.length === 0 && llamadasKv.length === 0, j({ noRechazadas, llamadasKv }))
      await handlers.get(V)?.({}, { ...validaKv[V], conexionId: 'redis', perfilId: 'p1', desde: '17', cuantos: 50 })
      const valor = llamadasKv.find((l) => l.op === 'valor')?.req
      check(
        'claves: VALOR pasa solo los BYTES de la clave (el texto pintado no viaja), con desde y cuantos',
        j(valor) === j({ conexionId: 'redis', base: 1, clave: { base64: 'YSBi' }, desde: '17', cuantos: 50 }),
        j(valor)
      )
      await handlers.get(C)?.({}, { ...validaKv[C], conexionId: 'redis', perfilId: 'p1', confirmadoPeligroso: true })
      const pol = llamadasKv.find((l) => l.op === 'ejecutarConsola')?.politica
      check(
        'claves: la consola llega con la política de la conexión (SIN solo lectura: la casilla es de los agentes) y la confirmación de lo peligroso',
        j(pol) === j({ soloLectura: false, produccion: false, confirmado: false, confirmadoPeligroso: true }),
        j(pol)
      )
    }
    // Los lectores de documentos no nombran conexión: con el gestor REAL, uno que no existe.
    const { ipc, handlers } = ipcDe()
    const gestorReal = new GestorDocumentos({
      lanzar: () => {
        throw new Error('no debe lanzar ningún trabajador')
      },
      conexion: (id) => registro.get(id),
      secreto: () => null,
      ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' })
    })
    registrarIpcDocumentos({ ipc, controlador: new ControladorDocumentos({ conexiones, gestor: gestorReal }) })
    const mas = (await handlers.get(DOCS_CHANNELS.LECTOR_MAS)?.({}, { lector: 'x', maxDocumentos: 10 })) as Resp
    const cerrar = await handlers.get(DOCS_CHANNELS.LECTOR_CERRAR)?.({}, 'x')
    check(
      'documentos: pedir más a un lector que no existe → noReleible «vuelve a ejecutar»; cerrarlo, nada',
      !mas.ok && mas.error?.motivo === 'noReleible' && mas.error.mensaje === MENSAJE_SIN_LECTOR && cerrar === undefined,
      j({ mas, cerrar })
    )
  }

  hr('(15) el explorador DELEGA los canales comunes a los gestores de documentos y de claves')
  {
    const dirTmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-motores-docs-'))
    const registroD = new Map<string, DbConnection>([
      ['mongo', { id: 'mongo', profileId: 'p1', alias: 'M', motor: 'mongodb', host: 'h', port: 27017, user: '', tieneSecreto: false, readonly: true, driverId: null }],
      ['redis', { id: 'redis', profileId: 'p1', alias: 'R', motor: 'redis', host: 'h', port: 6379, user: '', tieneSecreto: false, readonly: true, driverId: null }]
    ])
    const llamadas: string[] = []
    const docs: GestorDocumentosDelegado = {
      cancelar: (c) => (llamadas.push(`cancelar:${c.rol}`), false),
      forzar: (id) => void llamadas.push(`forzar:${id}`),
      desconectar: async (id) => void llamadas.push(`desconectar:${id}`),
      sesiones: () => (llamadas.push('sesiones'), [{ ref: { rol: 'meta', conexionId: 'mongo' }, conexionId: 'mongo', fase: 'lista', txModo: 'auto', tx: 'ninguna', sentenciasEnTx: 0, esquema: null, soloLectura: true }]),
      barrer: () => void llamadas.push('barrer'),
      cerrarTodo: async () => void llamadas.push('cerrarTodo'),
      reanudarTrasCierreAbortado: () => void llamadas.push('reanudar'),
      alCambiarConexion: (id) => void llamadas.push(`cambiar:${id}`),
      alBorrarConexion: (id) => void llamadas.push(`borrar:${id}`),
      cerrarConsola: async (p, c) => void llamadas.push(`cerrarConsola:${p}:${c}`)
    }
    // El de claves, delegado igual (apunta en su propia lista).
    const llamadasKv: string[] = []
    const kv: GestorClavesDelegado = {
      cancelar: (c) => (llamadasKv.push(`cancelar:${c.rol}`), false),
      forzar: (id) => void llamadasKv.push(`forzar:${id}`),
      desconectar: async (id) => void llamadasKv.push(`desconectar:${id}`),
      sesiones: () => (llamadasKv.push('sesiones'), [{ ref: { rol: 'meta', conexionId: 'redis' }, conexionId: 'redis', fase: 'lista', txModo: 'auto', tx: 'ninguna', sentenciasEnTx: 0, esquema: null, soloLectura: true }]),
      barrer: () => void llamadasKv.push('barrer'),
      cerrarTodo: async () => void llamadasKv.push('cerrarTodo'),
      reanudarTrasCierreAbortado: () => void llamadasKv.push('reanudar'),
      alCambiarConexion: (id) => void llamadasKv.push(`cambiar:${id}`),
      alBorrarConexion: (id) => void llamadasKv.push(`borrar:${id}`),
      cerrarConsola: async (p, c) => void llamadasKv.push(`cerrarConsola:${p}:${c}`)
    }
    const lanzadosD = { n: 0 }
    const exD = new ExploradorController({
      conexiones: {
        get: (id) => registroD.get(id),
        secretOf: () => null,
        setEsquemasVisibles: () => undefined as never,
        setIntrospeccion: () => {},
        marcarVerificada: () => false
      },
      registro: {
        ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
        notificarCambio: () => {},
        espacioDeDatos: (p) => path.join(dirTmp, p),
        tdbScriptDir: () => '',
        ensureWorkspace: (p) => mkdirSync(path.join(dirTmp, p), { recursive: true })
      },
      perfilVivo: () => true,
      nombrePerfil: () => 'P',
      papelera: async () => {},
      plataforma: plataformaActual(),
      getWindow: () => null,
      documentos: docs,
      claves: kv,
      lanzar: (c) => {
        lanzadosD.n++
        return trabajadorFalso(c, [], undefined)
      },
      emitir: () => {}
    })
    try {
      exD.cancelar({ rol: 'datos', conexionId: 'mongo', peticionId: 'q1' })
      exD.cancelar({ rol: 'consola', perfilId: 'p1', consolaId: 'k1', ejecucionId: 'e1' })
      exD.forzar('mongo')
      const des = await exD.desconectar('mongo')
      const ses = exD.sesiones()
      exD.barrer()
      exD.alCambiarConexion(registroD.get('mongo') as DbConnection, registroD.get('mongo') as DbConnection)
      exD.alBorrarConexion('mongo', 'p1')
      const consolaM = await exD.crearConsola('p1', 'mongo')
      const consolaR = await exD.crearConsola('p1', 'redis')
      const borrada = consolaM.ok ? await exD.borrarConsola('p1', consolaM.valor.id) : null
      // Desconectar, editar y borrar un Redis van al de claves (y no al de documentos).
      const desR = await exD.desconectar('redis')
      exD.alCambiarConexion(registroD.get('redis') as DbConnection, registroD.get('redis') as DbConnection)
      const borradaR = consolaR.ok ? await exD.borrarConsola('p1', consolaR.valor.id) : null
      exD.reanudarTrasCierreAbortado()
      await exD.cerrarTodo(50)
      const idM = consolaM.ok ? consolaM.valor.id : '?'
      const idR = consolaR.ok ? consolaR.valor.id : '?'
      const esperadas = ['cancelar:datos', 'cancelar:consola', 'forzar:mongo', 'desconectar:mongo', 'sesiones', 'barrer', 'cambiar:mongo', 'borrar:mongo', `cerrarConsola:p1:${idM}`, `cerrarConsola:p1:${idR}`, 'reanudar', 'cerrarTodo']
      check(
        'cancelar, forzar, desconectar, sesiones, barrido, edición y borrado de la conexión, borrar la consola, reanudar y cerrarTodo llegan al gestor de documentos',
        j(llamadas) === j(esperadas) && des.ok && ses.length === 2 && ses.some((s) => s.conexionId === 'mongo') && lanzadosD.n === 0,
        j({ llamadas, des, ses: ses.length, lanzados: lanzadosD.n })
      )
      // Cada gestor ignora lo que no es suyo (cancelar, forzar, borrar la conexión, cerrar una
      // consola: los dos lo reciben); desconectar y editar van SOLO al de la familia.
      const esperadasKv = ['cancelar:datos', 'cancelar:consola', 'forzar:mongo', 'sesiones', 'barrer', 'borrar:mongo', `cerrarConsola:p1:${idM}`, 'desconectar:redis', 'cambiar:redis', `cerrarConsola:p1:${idR}`, 'reanudar', 'cerrarTodo']
      check(
        'lo mismo llega al gestor de claves; desconectar y editar un Redis van solo a él; sesiones junta las tres listas',
        j(llamadasKv) === j(esperadasKv) && desR.ok && ses.some((s) => s.conexionId === 'redis'),
        j({ llamadasKv, desR })
      )
      check(
        'CONSOLAS_CREAR: MongoDB crea una consola .js y Redis una .redis; borrarlas funciona',
        consolaM.ok && consolaM.valor.rutaRelativa.endsWith('.js') && consolaR.ok && consolaR.valor.rutaRelativa.endsWith('.redis') && borrada?.ok === true && borradaR?.ok === true,
        j({ consolaM, consolaR, borrada, borradaR })
      )

      // Guardar SOLO la casilla de los agentes (lo decide
      // `ConnectionStore.soloCambiaLaCasillaDeAgentes`, con su test en `test:db-registro`) no
      // retira las sesiones; cualquier otra edición, o un borrado (sin el dato), sí.
      const mongo = registroD.get('mongo') as DbConnection
      llamadas.length = 0
      exD.alCambiarConexion(mongo, { ...mongo, readonly: false }, true)
      const trasCasilla = llamadas.slice()
      exD.alCambiarConexion(mongo, { ...mongo, readonly: false }, false)
      exD.alCambiarConexion(mongo, { ...mongo, readonly: false })
      check(
        '(#56) editar solo la casilla NO retira las sesiones; otra edición o sin el dato (borrado), sí',
        trasCasilla.length === 0 && j(llamadas) === j(['cambiar:mongo', 'cambiar:mongo']),
        j({ trasCasilla, llamadas })
      )
    } finally {
      rmSync(dirTmp, { recursive: true, force: true })
    }
  }

  hr('(16) Con una solo lectura IMPUESTA que mira la casilla, guardarla sí es una edición')
  {
    const con: DbConnection = { id: 'm2', profileId: 'p1', alias: 'M', motor: 'mongodb', host: 'h', port: 27017, user: '', tieneSecreto: false, readonly: true, driverId: null }
    const llamadas: string[] = []
    const docs = { alCambiarConexion: (id: string) => void llamadas.push(`cambiar:${id}`) } as unknown as GestorDocumentosDelegado
    const dirTmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-motores-casilla-'))
    const ex = new ExploradorController({
      conexiones: { get: () => con, secretOf: () => null, setEsquemasVisibles: () => undefined as never, setIntrospeccion: () => {}, marcarVerificada: () => false },
      registro: {
        ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
        notificarCambio: () => {},
        espacioDeDatos: (p) => path.join(dirTmp, p),
        tdbScriptDir: () => '',
        ensureWorkspace: (p) => mkdirSync(path.join(dirTmp, p), { recursive: true })
      },
      perfilVivo: () => true,
      nombrePerfil: () => 'P',
      papelera: async () => {},
      plataforma: plataformaActual(),
      getWindow: () => null,
      documentos: docs,
      soloLecturaImpuesta: (c) => c.readonly,
      lanzar: (c) => trabajadorFalso(c, [], undefined),
      emitir: () => {}
    })
    try {
      ex.alCambiarConexion(con, { ...con, readonly: false }, true)
      check('con `(c) => c.readonly` impuesta, la casilla cambia lo que hace el explorador: se retira', j(llamadas) === j(['cambiar:m2']), j(llamadas))
    } finally {
      rmSync(dirTmp, { recursive: true, force: true })
    }
  }

  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`FAIL  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
