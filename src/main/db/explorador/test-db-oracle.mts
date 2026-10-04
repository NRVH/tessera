#!/usr/bin/env node
// =============================================================================
// Integración del explorador de BD contra un Oracle de verdad, con el molde de `test-db-postgres.mts`.
// Solo corre si hay destino: `TESSERA_TEST_ORACLE='usuario/contraseña@host:puerto/servicio'` (o `:SID`) y, opcional,
// `TESSERA_TEST_ORACLE_DRIVERS`. La contraseña va en el entorno de ese comando, nunca en un archivo del repo.
// Los contenedores de pruebas se levantan con `scripts/pruebas/oracle.sh` (11 y 21, thin y thick).
// (node src/main/db/explorador/test-db-oracle.mts  ·  npm run test:db-oracle)
// =============================================================================

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DbConnection, DbEsquemasVisibles, DbIntrospeccion } from '../../../shared/db-ipc.ts'
import {
  DBX_CHANNELS,
  type DbCambioFila,
  type DbCelda,
  type DbColumnaResultado,
  type DbErrorSql,
  type DbEventoCatalogo,
  type DbIdentidadFila,
  type DbRefObjeto,
  type DbRespuesta,
  type DbResultadoSentencia
} from '../../../shared/db-explorador-ipc.ts'
// El renderer de verdad, para la prueba de punta a punta de los originales (§27): es puro
// (sin React ni DOM) y es el que elige qué se compara y arma la vista previa.
import * as cr from '../../../renderer/src/features/bd/rejilla/cambiosRejilla.ts'
import { plataformaActual, type Plataforma } from '../../../shared/plataforma.ts'
import { packsDePlataforma, type DriverPackResuelto } from '../driverPacks.ts'
import { ExploradorController } from './ExploradorController.ts'
import { probarFiltroGuiado } from './casosFiltroGuiado.mts'
import type { TrabajadorGestor } from './GestorSesiones.ts'
import { MENSAJES } from './maquinaSesion.ts'
import { ProcesoTrabajador } from './ProcesoTrabajador.ts'
import {
  esFalloTrabajador,
  type CtxDrivers,
  type ErrorTrabajador,
  type OpTrabajador,
  type PeticionSinIdDe,
  type RespuestasPorOp
} from './protocoloTrabajador.ts'

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

/** Comprobaciones que dependen de privilegios: se saltan con su motivo, no fallan. */
interface Salto {
  name: string
  motivo: string
}
const saltos: Salto[] = []
function salta(name: string, motivo: string): void {
  saltos.push({ name, motivo })
  console.log(`  [SALTA] ${name} -> ${motivo}`)
}

function saltar(motivo: string): never {
  console.log(`\nSALTADO: ${motivo}\nVEREDICTO: 0/0 PASS — SALTADO`)
  process.exit(0)
}

function configuracionInvalida(motivo: string): never {
  console.log(`\nCONFIGURACIÓN INVÁLIDA: ${motivo}\nVEREDICTO: 0/1 PASS — HAY FAIL`)
  process.exit(1)
}

/** Corta la prueba a mitad: falta algo sin lo que no queda nada que probar. */
class SaltoPrueba extends Error {}

function veredicto(): never {
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  for (const s of saltos) {
    console.log(`SALTA ${s.name}`)
    console.log(`      -> ${s.motivo}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  const nota = saltos.length > 0 ? ` (${saltos.length} saltadas)` : ''
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}${nota}`)
  process.exit(allPass ? 0 : 1)
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/**
 * El suelo de lo que tarda un `FOR UPDATE WAIT 10` en vencer. No es 10 s: la 11.2 XE
 * revisa las esperas de bloqueo cada ~3 s, y lo MEDIDO es bimodal —8,0/8,3 s o 11,0/11,2 s
 * en la misma pasada, alternando entre los dos casos— mientras la 21c da ~10 s. Con 9 s el
 * test fallaba a medias por reloj, no por el candado. 7 s sigue separando «esperó el tope»
 * de «no esperó» (un NOWAIT o un candado que falte da milisegundos).
 */
const MIN_WAIT_10_MS = 7000
const aqui = path.dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)
const PERFIL = 'perfil1'

/** Límites de thin que el Instant Client resuelve (los mismos que `oracle.cjs`). */
const LIMITES_THIN = ['NJS-138', 'NJS-533', 'NJS-116']
/** Falta de privilegio o de cuota: se salta con su motivo. */
const PRIVILEGIOS = new Set(['ORA-01031', 'ORA-01950', 'ORA-01536', 'ORA-01045'])

// --- node-oracledb, lo justo (el paquete no trae tipos) --------------------------------

interface ResultadoOracle {
  rows?: unknown[][]
}
interface ConexionOracle {
  execute(sql: string, binds?: unknown, opciones?: Record<string, unknown>): Promise<ResultadoOracle>
  rollback(): Promise<void>
  close(): Promise<void>
  readonly oracleServerVersion: number
  readonly oracleServerVersionString: string
  module: string
}
interface ModuloOracle {
  getConnection(credenciales: { user: string; password: string; connectString: string }): Promise<ConexionOracle>
  initOracleClient(opciones: { libDir: string }): void
  readonly OUT_FORMAT_ARRAY: number
}

// --- Destino ----------------------------------------------------------------------------

interface DestinoOracle {
  usuario: string
  clave: string
  host: string
  puerto: number
  servicio?: string
  sid?: string
}

/**
 * `usuario/contraseña@host:puerto/servicio` o `…@host:puerto:SID`. La contraseña va
 * entre la PRIMERA barra y la ÚLTIMA arroba: así puede llevar las dos.
 */
function parsearDestino(texto: string): DestinoOracle | null {
  const barra = texto.indexOf('/')
  const arroba = texto.lastIndexOf('@')
  if (barra <= 0 || arroba <= barra + 1) return null
  const m = /^([^:/@\s]+):(\d{1,5})([/:])([^/:@\s]+)$/.exec(texto.slice(arroba + 1))
  if (!m) return null
  const puerto = Number(m[2])
  if (!Number.isInteger(puerto) || puerto <= 0 || puerto > 65535) return null
  const d: DestinoOracle = { usuario: texto.slice(0, barra), clave: texto.slice(barra + 1, arroba), host: m[1], puerto }
  if (m[3] === '/') d.servicio = m[4]
  else d.sid = m[4]
  return d
}

/** El mismo descriptor que arma `oracle.cjs`: Easy Connect, o TNS completo por SID. */
function cadenaConexion(d: DestinoOracle): string {
  if (d.sid) {
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${d.host})(PORT=${d.puerto}))(CONNECT_DATA=(SID=${d.sid})))`
  }
  return `${d.host}:${d.puerto}/${d.servicio}`
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function codigoDe(err: unknown): string {
  const m = /\b(?:ORA|NJS|DPI|PLS)-\d+/.exec(mensajeDe(err))
  return m ? m[0] : ''
}

/** Identificador para SQL: tal cual si es un nombre Oracle "normal", entre comillas si no. */
function identSql(nombre: string): string {
  return /^[A-Z][A-Z0-9_$#]*$/.test(nombre) ? nombre : `"${nombre.replace(/"/g, '""')}"`
}

/** Pack para plataformas sin catálogo ('otra'): solo cambia el centinela. */
function packSintetico(plataforma: Plataforma): DriverPackResuelto {
  return {
    id: 'oracle-ic-prueba',
    motor: 'oracle',
    nombre: 'Instant Client de la prueba',
    sizeMB: 0,
    cubre: 'el de TESSERA_TEST_ORACLE_DRIVERS',
    url: null,
    carpetaInterna: '',
    plataformas: [plataforma],
    centinela: plataforma === 'windows' ? 'oci.dll' : plataforma === 'mac' ? 'libclntsh.dylib' : 'libclntsh.so',
    servidorDesde: 10.2,
    servidorHasta: 99
  }
}

/**
 * Guion que se interpone al trabajador para FORZAR la escalada a thick (ver la
 * cabecera). Rutas absolutas: se escribe en el temporal, lejos de `node_modules`.
 */
function guionThickForzado(rutaOracledb: string, rutaSesion: string): string {
  return [
    "'use strict'",
    '// Generado por test-db-oracle.mts: la primera conexión thin del proceso falla con',
    '// un NJS-138 falso y oracle.cjs escala a thick como ante una 11.2.',
    `const oracledb = require(${JSON.stringify(rutaOracledb)})`,
    'const original = oracledb.getConnection',
    'let forzada = false',
    'oracledb.getConnection = function (...args) {',
    '  if (!forzada && oracledb.thin) {',
    '    forzada = true',
    "    const e = new Error('NJS-138: conexión thin rechazada a propósito por test-db-oracle (forzar thick)')",
    "    e.code = 'NJS-138'",
    '    return Promise.reject(e)',
    '  }',
    '  return original.apply(this, args)',
    '}',
    `require(${JSON.stringify(rutaSesion)})`,
    ''
  ].join('\n')
}

/** Registro de conexiones en memoria con la forma que el explorador espera. */
class ConexionesEnMemoria {
  readonly mapa = new Map<string, DbConnection>()
  readonly secretos = new Map<string, string>()
  introspecciones = 0
  verificadas: Array<[string, string | null]> = []
  get(id: string): DbConnection | undefined {
    return this.mapa.get(id)
  }
  secretOf(id: string): string | null {
    return this.secretos.get(id) ?? null
  }
  setEsquemasVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    const c = this.mapa.get(id)
    if (!c) throw new Error('Conexión desconocida')
    const nueva = { ...c, esquemas: v }
    this.mapa.set(id, nueva)
    return nueva
  }
  setIntrospeccion(id: string, v: DbIntrospeccion): void {
    const c = this.mapa.get(id)
    if (!c) return
    this.introspecciones++
    this.mapa.set(id, { ...c, introspeccion: v })
  }
  marcarVerificada(id: string, driverId: string | null): boolean {
    const c = this.mapa.get(id)
    if (!c || (c.verificada && (c.driverId ?? null) === driverId)) return false
    this.verificadas.push([id, driverId])
    this.mapa.set(id, { ...c, verificada: true, driverId })
    return true
  }
}

type RespSentencia = DbRespuesta<DbResultadoSentencia>

function filasJson(json: string): unknown[][] {
  return JSON.parse(json) as unknown[][]
}
function filasDe(r: RespSentencia | null | undefined): unknown[][] {
  return r && r.ok && r.valor.tipo === 'filas' ? filasJson(r.valor.pagina.filasJson) : []
}
function errorDe(r: RespSentencia | null | undefined): DbErrorSql | null {
  if (!r) return null
  if (!r.ok) return r.error
  return r.valor.tipo === 'error' ? r.valor.error : null
}
function esHecho(r: RespSentencia): boolean {
  return r.ok && r.valor.tipo === 'hecho'
}
/** Resumen para la evidencia: el tipo, o el error con su código. */
function resumen(r: RespSentencia | null): string {
  if (!r) return 'sin respuesta'
  if (!r.ok) return `rechazada(${r.error.motivo}): ${r.error.mensaje.slice(0, 160)}`
  if (r.valor.tipo === 'error') return `✗ ${r.valor.error.codigo ?? ''} ${r.valor.error.mensaje.slice(0, 160)}`
  return r.valor.tipo
}

function conPlazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((r) => {
      const t = setTimeout(() => r(null), ms)
      t.unref()
    })
  ])
}

/**
 * (27) La tabla de cada consulta de COLUMNAS EDITABLES que recibe
 * el trabajador (`sqlColumnasEdicion`: la de `all_tab_cols c`, bind `obj`), para contar
 * cuántas veces se pregunta al catálogo de edición. El trabajador de detrás es el real.
 */
const consultasEdicion: string[] = []
/**
 * (27) Viajes de «Enviar»: cada `ejecutar` de una sesión efímera de
 * edición, con si es un candado (`FOR UPDATE`). Para contar que las filas se bloquean POR
 * LOTES y no una a una.
 */
const viajesEnvio: Array<{ candado: boolean }> = []

function conEspia(p: ProcesoTrabajador): TrabajadorGestor {
  return {
    arrancar: () => p.arrancar(),
    enviar<O extends OpTrabajador>(peticion: PeticionSinIdDe<O>, plazoMs?: number | null): Promise<RespuestasPorOp[O]> {
      if (peticion.op === 'ejecutar') {
        const pe = peticion as PeticionSinIdDe<'ejecutar'>
        const binds = pe.binds as Record<string, unknown> | undefined
        if (pe.opciones.proposito === 'catalogo' && /from all_tab_cols c/i.test(pe.sql) && binds && typeof binds.obj === 'string') {
          consultasEdicion.push(binds.obj)
        }
        if (pe.sesion.startsWith('edicion:')) viajesEnvio.push({ candado: /\bFOR UPDATE\b/.test(pe.sql) })
      }
      return p.enviar(peticion, plazoMs)
    },
    onEvento: (cb) => p.onEvento(cb),
    onSalida: (cb) => p.onSalida(cb),
    salir: (plazoMs) => p.salir(plazoMs),
    matar: () => p.matar(),
    get vivo() {
      return p.vivo
    },
    get pendientes() {
      return p.pendientes
    }
  }
}

/**
 * Borra todo lo que empiece por `prefijo` en el esquema del usuario y devuelve lo que
 * quede. Por tipo y en orden: lo que depende de las tablas antes que ellas.
 */
async function limpiar(c: ConexionOracle, prefijo: string, formato: number): Promise<string[]> {
  const q = async (sql: string, binds: unknown = []): Promise<unknown[][]> =>
    (await c.execute(sql, binds, { outFormat: formato, autoCommit: true })).rows ?? []
  try {
    await q('ALTER SESSION SET DDL_LOCK_TIMEOUT = 10')
  } catch {
    // 10g no lo tiene: el DROP falla antes con ORA-00054 y se informa lo que quede
  }
  const orden: Record<string, number> = { SYNONYM: 1, VIEW: 2, PACKAGE: 3, PROCEDURE: 3, FUNCTION: 3, TABLE: 4, SEQUENCE: 5 }
  const listar = (): Promise<unknown[][]> =>
    q(
      'SELECT object_name, object_type FROM user_objects WHERE SUBSTR(object_name, 1, :n) = :p ORDER BY object_name',
      { n: prefijo.length, p: prefijo }
    )
  const objetos = (await listar())
    .map((f) => ({ nombre: String(f[0]), tipo: String(f[1]) }))
    .filter((o) => orden[o.tipo] !== undefined)
    .sort((a, b) => orden[a.tipo] - orden[b.tipo])
  for (const o of objetos) {
    const nombre = `"${o.nombre.replace(/"/g, '""')}"`
    try {
      await q(o.tipo === 'TABLE' ? `DROP TABLE ${nombre} CASCADE CONSTRAINTS PURGE` : `DROP ${o.tipo} ${nombre}`)
    } catch {
      // lo que no se pudo borrar sale en la lista de restos
    }
  }
  return (await listar())
    .map((f) => `${String(f[1])} ${String(f[0])}`)
    .filter((t) => !/^(INDEX|LOB|PACKAGE BODY) /.test(t))
}

async function main(): Promise<void> {
  // --- Destino y requisitos -------------------------------------------------------
  const spec = process.env.TESSERA_TEST_ORACLE ?? ''
  const dirDrivers = (process.env.TESSERA_TEST_ORACLE_DRIVERS ?? '').trim()
  // Opcional: un usuario SIN SELECT_CATALOG_ROLE (misma contraseña y servidor) para
  // el repliegue del DDL. Sin él, esa comprobación se salta.
  const usuarioSinCatalogo = (process.env.TESSERA_TEST_ORACLE_SIN ?? '').trim()
  if (!spec) {
    saltar(
      'no está definida TESSERA_TEST_ORACLE (usuario/contraseña@host:puerto/servicio, o usuario/contraseña@host:puerto:SID).'
    )
  }
  const destino = parsearDestino(spec)
  if (!destino) {
    configuracionInvalida('TESSERA_TEST_ORACLE no tiene la forma usuario/contraseña@host:puerto/servicio (o …@host:puerto:SID).')
  }
  const dst: DestinoOracle = destino
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    saltar('el paquete electron no está instalado.')
  }
  if (!electron || !existsSync(electron)) saltar('falta el binario de Electron (lo baja `npm run predev`).')
  let modulo: ModuloOracle | null = null
  try {
    modulo = require_('oracledb') as ModuloOracle
  } catch {
    modulo = null
  }
  if (!modulo) saltar('el paquete oracledb no está instalado.')
  const odb: ModuloOracle = modulo
  // Leídas las dos variables, fuera todas las TESSERA_*: nada del código probado
  // debe ver el destino ni la contraseña por el entorno.
  for (const k of Object.keys(process.env)) {
    if (k.toUpperCase().startsWith('TESSERA_')) delete process.env[k]
  }

  const plataforma = plataformaActual()
  const packsOracle = packsDePlataforma(plataforma).filter((p) => p.motor === 'oracle')
  const packPrueba = packsOracle[0] ?? packSintetico(plataforma)
  if (dirDrivers && !existsSync(path.join(dirDrivers, packPrueba.centinela))) {
    configuracionInvalida(
      `TESSERA_TEST_ORACLE_DRIVERS no contiene ${packPrueba.centinela}: no es un Instant Client de esta plataforma.`
    )
  }
  const destinoLegible = `${dst.usuario}@${dst.host}:${dst.puerto}${dst.sid ? `:${dst.sid}` : `/${dst.servicio}`}`

  // --- Observador -----------------------------------------------------------------
  hr(`(0) Observador (conexión propia de la prueba) contra ${destinoLegible}`)
  const credenciales = { user: dst.usuario, password: dst.clave, connectString: cadenaConexion(dst) }
  let observador: ConexionOracle | null = null
  let observadorThick = false
  let limiteThin = ''
  let falloObservador = ''
  try {
    observador = await odb.getConnection(credenciales)
  } catch (err) {
    const codigo = codigoDe(err)
    if (LIMITES_THIN.indexOf(codigo) < 0) falloObservador = mensajeDe(err)
    else {
      limiteThin = codigo
      if (dirDrivers) {
        try {
          odb.initOracleClient({ libDir: dirDrivers })
          observador = await odb.getConnection(credenciales)
          observadorThick = true
        } catch (err2) {
          falloObservador = mensajeDe(err2)
        }
      }
    }
  }
  if (falloObservador) {
    check(`conectar con ${destinoLegible}`, false, falloObservador)
    veredicto()
  }

  const sufijo = randomBytes(3).toString('hex').toUpperCase()
  const PREFIJO = `TESSERA_T_${sufijo}`
  const CLI = `${PREFIJO}_CLI`
  const PED = `${PREFIJO}_PED`
  const NUM = `${PREFIJO}_NUM`
  const V = `${PREFIJO}_V`
  const PKG = `${PREFIJO}_PKG`
  const MAL = `${PREFIJO}_MAL`
  const PRC = `${PREFIJO}_PRC`
  const SIN = `${PREFIJO}_SIN`
  const DDL = `${PREFIJO}_DDL`
  const RO = `${PREFIJO}_RO`
  const DOC = `${PREFIJO}_DOC`
  const CMP = `${PREFIJO}_CMP`
  const AVS = `${PREFIJO}_AVS`
  const SEQ = `${PREFIJO}_SEQ`
  /** Tabla con un trigger que escribe en DBMS_OUTPUT (el trigger cae con ella). */
  const TRG = `${PREFIJO}_TRG`

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-dbo-'))
  process.on('exit', () => {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // nada
    }
  })
  const rutaSesion = path.resolve(aqui, '..', '..', '..', 'tdb', 'sesion.cjs')
  // Thick forzado solo si thin habría bastado: si el servidor ya lo exige, la
  // escalada del trabajador es la de verdad.
  const forzarThick = dirDrivers !== '' && observador !== null && !observadorThick
  let rutaScript = rutaSesion
  if (forzarThick) {
    rutaScript = path.join(tmp, 'sesion-thick-forzado.cjs')
    writeFileSync(rutaScript, guionThickForzado(require_.resolve('oracledb'), rutaSesion))
  }
  const modoEsperado = dirDrivers ? 'thick' : 'thin'
  const driverIdEsperado = dirDrivers ? packPrueba.id : null
  const ctx: CtxDrivers = {
    packs: packsOracle.length > 0 ? packsOracle : [packPrueba],
    externos: dirDrivers ? { [packPrueba.id]: dirDrivers } : {},
    driversDir: path.join(tmp, 'drivers'),
    usuarioWindows: 'prueba'
  }

  const logs: string[] = []
  const eventos: Array<{ canal: string; payload: unknown }> = []
  const procesos: ProcesoTrabajador[] = []
  /** Último proceso lanzado por conexión: para los dos puentes al trabajador. */
  const procesoDe = new Map<string, ProcesoTrabajador>()
  const conexiones = new ConexionesEnMemoria()
  const base: DbConnection = {
    id: 'c1',
    profileId: PERFIL,
    alias: `ORA-PRUEBA-${sufijo}`,
    motor: 'oracle',
    host: dst.host,
    port: dst.puerto,
    ...(dst.sid ? { sid: dst.sid } : { database: dst.servicio }),
    user: dst.usuario,
    tieneSecreto: true,
    readonly: false
  }
  const aliasRo = `${base.alias}-RO`
  conexiones.mapa.set('c1', base)
  conexiones.mapa.set('ro', { ...base, id: 'ro', alias: aliasRo, readonly: true })
  conexiones.secretos.set('c1', dst.clave)
  conexiones.secretos.set('ro', dst.clave)
  if (usuarioSinCatalogo) {
    conexiones.mapa.set('sin', { ...base, id: 'sin', alias: `${base.alias}-SIN`, user: usuarioSinCatalogo })
    conexiones.secretos.set('sin', dst.clave)
  }
  const exportados = path.join(tmp, 'exportados')
  mkdirSync(exportados, { recursive: true })
  const ex = new ExploradorController({
    // La solo lectura IMPUESTA a la conexión con la casilla marcada ('ro'): este test fija
    // contra un Oracle de verdad la maquinaria de solo lectura, que es el PRIMER candado del
    // humo remoto (que la impone en todas). Ahora el PRODUCTO no impone
    // ninguna: la casilla es solo de los agentes.
    soloLecturaImpuesta: (c) => c.readonly,
    conexiones,
    registro: {
      ctxDrivers: () => ctx,
      notificarCambio: () => {},
      espacioDeDatos: (p) => path.join(tmp, 'conexiones', p),
      tdbScriptDir: () => path.resolve(aqui, '..', '..', '..', 'tdb'),
      ensureWorkspace: (p) => mkdirSync(path.join(tmp, 'conexiones', p), { recursive: true })
    },
    perfilVivo: (id) => id === PERFIL,
    nombrePerfil: () => 'Pruebas',
    papelera: async (ruta) => rmSync(ruta, { force: true }),
    plataforma,
    getWindow: () => null,
    emitir: (canal, payload) => eventos.push({ canal, payload }),
    // El diálogo de guardar, inyectado: acepta siempre el NOMBRE propuesto y, como el de
    // la app (`util/adaptadores/dialogosNativos.ts`), pone su carpeta (el temporal).
    guardarArchivo: async (_win, opciones) => ({
      canceled: false,
      filePath: path.join(exportados, path.basename(String(opciones.defaultPath)))
    }),
    // El historial en SU carpeta, fuera del espacio de datos (como en la app).
    dirHistorial: path.join(tmp, 'db-historial'),
    log: (l) => logs.push(l),
    lanzar: (con) => {
      const p = new ProcesoTrabajador({
        rutaScript,
        execPath: electron,
        // Ver la cabecera: 'advanced' solo encaja con el mismo V8 en los dos lados.
        serializacion: process.versions.electron ? 'advanced' : 'json',
        log: (l) => logs.push(l)
      })
      procesos.push(p)
      procesoDe.set(con.id, p)
      return conEspia(p)
    }
  })
  let explorerCerrado = false

  try {
    if (!observador) {
      // El servidor exige thick y no hay cliente: lo único que se puede probar es
      // que abrir lo dice con su motivo, en vez de un error crudo de thin.
      hr(`(1) El servidor exige thick (${limiteThin}) y no hay TESSERA_TEST_ORACLE_DRIVERS`)
      const esq = await ex.esquemas('c1')
      const e = esq.ok ? null : esq.error
      check('abrir falla con motivo «driver», no con el error crudo de thin', e?.motivo === 'driver', JSON.stringify(e))
      // Solo el catálogo de Windows tiene un pack para cualquier servidor. En Mac ninguno
      // alcanza una 11.2 y el aviso, con razón, no nombra ninguno.
      if (plataforma === 'windows') {
        check('… y nombra el pack que haría falta', !!e?.requiereDriver?.packId, JSON.stringify(e?.requiereDriver))
      }
      throw new SaltoPrueba(
        `el servidor exige el modo thick (${limiteThin}); define TESSERA_TEST_ORACLE_DRIVERS con un Instant Client para probar el resto.`
      )
    }
    const obs: ConexionOracle = observador
    try {
      obs.module = 'Tessera/test-db-oracle'
    } catch {
      // solo es para que el DBA la reconozca
    }
    const q = async (sql: string, binds: unknown = []): Promise<unknown[][]> =>
      (await obs.execute(sql, binds, { outFormat: odb.OUT_FORMAT_ARRAY, autoCommit: true })).rows ?? []
    const USUARIO = String((await q('SELECT USER FROM dual'))[0]?.[0] ?? '')
    let charset = '?'
    try {
      charset = String((await q("SELECT value FROM nls_database_parameters WHERE parameter = 'NLS_CHARACTERSET'"))[0]?.[0])
    } catch {
      // informativo
    }
    const version = obs.oracleServerVersion
    const mayor = Math.floor(version / 1e8)
    check(
      'observador conectado',
      USUARIO !== '' && mayor > 0,
      `${USUARIO} en Oracle ${obs.oracleServerVersionString} (${observadorThick ? 'thick' : 'thin'}), ${charset}; ` +
        `se espera ${modoEsperado}${forzarThick ? ' forzado' : ''}`
    )

    // --- Siembra --------------------------------------------------------------------
    hr(`(0) Siembra en ${USUARIO} con el prefijo ${PREFIJO}`)
    const siembraTablas = [
      `CREATE TABLE ${CLI} (id NUMBER(10) CONSTRAINT ${CLI}_PK PRIMARY KEY, nombre VARCHAR2(40 CHAR) NOT NULL, ` +
        'saldo NUMBER, alta DATE, marca TIMESTAMP(6))',
      `CREATE TABLE ${PED} (id NUMBER(10) PRIMARY KEY, cli_id NUMBER(10) CONSTRAINT ${PED}_FK REFERENCES ${CLI} (id), ` +
        'total NUMBER(12,2))',
      `CREATE TABLE ${NUM} (id NUMBER(10) PRIMARY KEY, etiqueta VARCHAR2(20))`,
      `INSERT INTO ${CLI} VALUES (1, 'Ana', 12345678901234567890123456789012345678, ` +
        "TO_DATE('2024-03-31 02:30:00', 'YYYY-MM-DD HH24:MI:SS'), " +
        "TO_TIMESTAMP('2024-01-15 10:20:30.123456', 'YYYY-MM-DD HH24:MI:SS.FF6'))",
      `INSERT INTO ${CLI} VALUES (2, 'Bea', -0.5, NULL, NULL)`,
      `INSERT INTO ${CLI} VALUES (3, 'Cai', 0, NULL, NULL)`,
      `INSERT INTO ${PED} VALUES (1, 1, 10)`,
      `INSERT INTO ${PED} VALUES (2, 1, 20.5)`,
      `INSERT INTO ${PED} VALUES (3, 2, 30)`,
      `INSERT INTO ${NUM} (id, etiqueta) SELECT LEVEL, 'fila ' || LEVEL FROM dual CONNECT BY LEVEL <= 1234`
    ]
    try {
      for (const s of siembraTablas) await q(s)
    } catch (err) {
      const c = codigoDe(err)
      if (PRIVILEGIOS.has(c)) {
        throw new SaltoPrueba(`${USUARIO} no puede crear tablas en su esquema (${c}): sin ellas no queda nada que probar.`)
      }
      throw err
    }
    const nNum = (await q(`SELECT COUNT(*) FROM ${NUM}`))[0]?.[0]
    check('siembra: 3 tablas y 1234 filas en la de paginar', Number(nNum) === 1234, `${String(nNum)} filas`)
    const opcional = async (que: string, sql: string): Promise<string | null> => {
      try {
        await q(sql)
        return null
      } catch (err) {
        const c = codigoDe(err)
        if (PRIVILEGIOS.has(c)) return `${USUARIO} no tiene ${que} (${c})`
        throw err
      }
    }
    const sinVista = await opcional('CREATE VIEW', `CREATE VIEW ${V} AS SELECT id, nombre FROM ${CLI} WHERE saldo >= 0`)
    const sinRutina = await opcional(
      'CREATE PROCEDURE',
      `CREATE OR REPLACE PROCEDURE ${PRC} (p_saldo IN NUMBER) AS\nBEGIN\n  UPDATE ${CLI} SET saldo = p_saldo WHERE id = 3;\nEND;`
    )
    const sinSinonimo = await opcional('CREATE SYNONYM', `CREATE SYNONYM ${SIN} FOR ${CLI}`)
    for (const [que, motivo] of [
      ['vista', sinVista],
      ['procedimiento', sinRutina],
      ['sinónimo', sinSinonimo]
    ] as const) {
      if (motivo) salta(`siembra del ${que}`, motivo)
    }

    // --- (1) Abrir ----------------------------------------------------------------------
    hr('(1) Abrir: modo, driverId, verificada y esquemas «N de M»')
    const esq = await ex.esquemas('c1')
    const meta = ex.sesiones().find((s) => s.ref.rol === 'meta' && s.conexionId === 'c1')
    const drv = meta?.driver
    check(
      `abrir en ${modoEsperado}${forzarThick ? ' (escalada forzada)' : limiteThin ? ` (escalada real por ${limiteThin})` : ''}`,
      esq.ok && drv?.modo === modoEsperado && (drv.driverId ?? null) === driverIdEsperado,
      JSON.stringify(drv ?? (esq.ok ? 'sin sesión meta' : esq.error))
    )
    check(
      'la versión del servidor llega a la sesión (decide el dialecto de catálogo)',
      !!drv && parseInt(drv.version, 10) === mayor,
      `${drv?.version ?? '(nada)'} frente a ${obs.oracleServerVersionString}`
    )
    check(
      'abrir la sesión marca la conexión verificada con su driver',
      JSON.stringify(conexiones.verificadas[0]) === JSON.stringify(['c1', driverIdEsperado]) && conexiones.get('c1')?.verificada === true,
      JSON.stringify(conexiones.verificadas)
    )
    const lista = esq.ok ? esq.valor.esquemas : []
    const visibles = lista.filter((e) => e.visible).map((e) => e.nombre)
    check(
      'esquemas: el actual por defecto y visible solo él (1 de M)',
      esq.ok && esq.valor.porDefecto === USUARIO && esq.valor.nVisibles === 1 && visibles.join() === USUARIO &&
        lista.some((e) => e.nombre === USUARIO && e.porDefecto),
      esq.ok ? `${esq.valor.nVisibles} de ${lista.length}, por defecto ${esq.valor.porDefecto}` : JSON.stringify(esq)
    )
    const ultimo = lista[lista.length - 1]
    check(
      'SYS marcado del sistema y PUBLIC (pseudo) al final',
      lista.some((e) => e.nombre === 'SYS' && e.sistema) && ultimo?.nombre === 'PUBLIC' && ultimo.pseudo === true,
      lista.slice(-3).map((e) => `${e.nombre}${e.sistema ? '*' : ''}${e.pseudo ? '(pseudo)' : ''}`).join(', ')
    )
    check(
      'la introspección se guarda (N de M sin conectar)',
      conexiones.get('c1')?.introspeccion?.totalEsquemas === lista.length && conexiones.introspecciones === 1,
      JSON.stringify(conexiones.get('c1')?.introspeccion)
    )

    // --- (2) Paquete desde la consola -----------------------------------------------------
    hr('(2) Consola: CREATE PACKAGE (spec y cuerpo)')
    const consola = await ex.crearConsola(PERFIL, 'c1')
    check('crear consola (consola_1)', consola.ok && consola.valor.nombre === 'consola_1', JSON.stringify(consola))
    const k1 = consola.ok ? consola.valor.id : ''
    let n = 0
    const ejecutar = (sql: string, consolaId = k1, maxFilas = 500): Promise<RespSentencia> =>
      ex.ejecutar({ perfilId: PERFIL, consolaId, ejecucionId: `x${++n}`, sql, maxFilas })
    const deMeta = async (sql: string): Promise<string> => {
      const filas = await ex.gestor.catalogo('c1', (c) => c.consultar({ sql, binds: [] }))
      return String(filas[0]?.[0])
    }
    let sinPaquete: string | null = sinRutina
    if (!sinPaquete) {
      const antesDdl = eventos.length
      const specPkg = `CREATE OR REPLACE PACKAGE ${PKG} AS\n  FUNCTION doble(x NUMBER) RETURN NUMBER;\nEND ${PKG};`
      const bodyPkg =
        `CREATE OR REPLACE PACKAGE BODY ${PKG} AS\n  FUNCTION doble(x NUMBER) RETURN NUMBER IS\n  BEGIN\n` +
        `    RETURN x * 2;\n  END doble;\nEND ${PKG};`
      const rSpec = await ejecutar(specPkg)
      const rBody = await ejecutar(bodyPkg)
      if (PRIVILEGIOS.has(errorDe(rSpec)?.codigo ?? '')) sinPaquete = `${USUARIO} no puede crear paquetes (${errorDe(rSpec)?.codigo})`
      else {
        check(
          'spec y cuerpo: ✓ los dos (el END; del bloque se conserva al partir)',
          esHecho(rSpec) && esHecho(rBody),
          `${resumen(rSpec)} / ${resumen(rBody)}`
        )
        const evDdl = eventos.slice(antesDdl).find((e) => e.canal === DBX_CHANNELS.EV_CATALOGO)?.payload as
          | DbEventoCatalogo
          | undefined
        check('el DDL invalida el catálogo (dbx:ev:catalogo «ddl»)', evDdl?.motivo === 'ddl', JSON.stringify(evDdl))
      }
    }
    if (sinPaquete) salta('paquete desde la consola', sinPaquete)
    else {
      // Un CREATE de PL/SQL con errores "funciona" en Oracle (ORA-24344, éxito con aviso:
      // el objeto existe, INVALID). Para el usuario es un ✗ con su motivo, y en thick el
      // aviso llega por otro camino que en thin: por eso va aquí y no solo en un test puro.
      const rMal = await ejecutar(`CREATE OR REPLACE PACKAGE ${MAL} AS\n  PROCEDURE p(x NUMBRE);\nEND ${MAL};`)
      const eMal = errorDe(rMal)
      check(
        'paquete con errores de compilación: ✗ «Creado con errores de compilación» con ORA-24344',
        rMal.ok &&
          eMal?.motivo === 'servidor' &&
          eMal.codigo === 'ORA-24344' &&
          /^Creado con errores de compilación/.test(eMal.mensaje),
        resumen(rMal)
      )
      const paquetesMal = await ex.objetos('c1', USUARIO, 'paquete')
      const oMal = paquetesMal.ok ? paquetesMal.valor.find((o) => o.nombre === MAL) : undefined
      check('… y el árbol lo marca inválido', oMal?.estado === 'invalido', JSON.stringify(oMal ?? paquetesMal))
    }

    // --- (3) Catálogo -----------------------------------------------------------------------
    hr('(3) Conteos, objetos, detalle y autocompletado')
    const conteos = await ex.resumen('c1', USUARIO)
    const cv = conteos.ok ? conteos.valor : {}
    check(
      'conteos del esquema en un viaje (al menos lo sembrado)',
      conteos.ok &&
        (cv.tabla ?? 0) >= 3 &&
        (sinVista !== null || (cv.vista ?? 0) >= 1) &&
        (sinRutina !== null || (cv.rutina ?? 0) >= 1) &&
        (sinPaquete !== null || (cv.paquete ?? 0) >= 1) &&
        (sinSinonimo !== null || (cv.sinonimo ?? 0) >= 1),
      JSON.stringify(conteos.ok ? cv : conteos)
    )
    const tablas = await ex.objetos('c1', USUARIO, 'tabla')
    const propias = tablas.ok ? tablas.valor.map((o) => o.nombre).filter((x) => x.startsWith(PREFIJO)).sort() : []
    check('objetos: las tres tablas sembradas', propias.join() === [CLI, NUM, PED].sort().join(), propias.join() || JSON.stringify(tablas))
    if (!sinPaquete) {
      const paquetes = await ex.objetos('c1', USUARIO, 'paquete')
      const p = paquetes.ok ? paquetes.valor.find((o) => o.nombre === PKG) : undefined
      check('objetos: el paquete, válido', p?.estado === 'valido', JSON.stringify(p ?? paquetes))
    }
    if (!sinRutina) {
      const rutinas = await ex.objetos('c1', USUARIO, 'rutina')
      const r = rutinas.ok ? rutinas.valor.find((o) => o.nombre === PRC) : undefined
      check('objetos: el procedimiento, con su subtipo', r?.subtipo === 'PROCEDURE', JSON.stringify(r ?? rutinas))
    }
    const det = await ex.detalle('c1', { esquema: USUARIO, nombre: CLI, tipo: 'tabla' }, ['columnas', 'indices', 'restricciones'])
    const cols = det.ok ? (det.valor.columnas ?? []) : []
    const colId = cols.find((c) => c.nombre === 'ID')
    const colNombre = cols.find((c) => c.nombre === 'NOMBRE')
    check(
      'detalle: la PK en su columna y los tipos como se escriben',
      cols.length === 5 &&
        colId?.pk === 1 &&
        colId.tipo === 'NUMBER(10)' &&
        colNombre?.tipo === 'VARCHAR2(40 CHAR)' &&
        colNombre.nullable === false &&
        colNombre.pk === null,
      det.ok ? cols.map((c) => `${c.nombre}:${c.tipo}${c.pk ? `(pk${c.pk})` : ''}`).join(', ') : JSON.stringify(det)
    )
    const restr = det.ok ? (det.valor.restricciones ?? []) : []
    const indices = det.ok ? (det.valor.indices ?? []) : []
    check(
      'detalle: restricción pk e índice único sobre ID',
      restr.some((r) => r.tipo === 'pk' && r.columnas.join() === 'ID') && indices.some((i) => i.unico && i.columnas.join() === 'ID'),
      JSON.stringify({ restr, indices })
    )
    const detPed = await ex.detalle('c1', { esquema: USUARIO, nombre: PED, tipo: 'tabla' }, ['restricciones'])
    const fk = detPed.ok ? (detPed.valor.restricciones ?? []).find((r) => r.tipo === 'fk') : undefined
    check(
      'detalle: la FK de la tabla hija apunta a la madre',
      fk?.columnas.join() === 'CLI_ID' && fk.referencia?.tabla === CLI && fk.referencia.columnas.join() === 'ID',
      JSON.stringify(fk ?? detPed)
    )
    const idx = await ex.nombres('c1')
    const nomIdx = idx.ok ? idx.valor.objetos.map((o) => `${idx.valor.esquemas[o[1]]}.${o[0]}`) : []
    check(
      'autocompletado: lo sembrado, en el esquema actual',
      nomIdx.includes(`${USUARIO}.${CLI}`) && (sinPaquete !== null || nomIdx.includes(`${USUARIO}.${PKG}`)),
      `${nomIdx.length} nombres`
    )

    // --- (4) Fuente -------------------------------------------------------------------------
    hr('(4) Fuente del paquete y de la vista')
    if (sinPaquete) salta('fuente del paquete', sinPaquete)
    else {
      const fp = await ex.fuente('c1', { esquema: USUARIO, nombre: PKG, tipo: 'paquete' })
      const partes = fp.ok ? fp.valor.partes : []
      check(
        'paquete: especificación y cuerpo, en ese orden y sin aviso',
        fp.ok &&
          partes.length === 2 &&
          partes[0].titulo === 'Especificación' &&
          /^CREATE OR REPLACE PACKAGE\s/i.test(partes[0].texto) &&
          !/^CREATE OR REPLACE PACKAGE\s+BODY/i.test(partes[0].texto) &&
          partes[1].titulo === 'Cuerpo' &&
          /^CREATE OR REPLACE PACKAGE\s+BODY/i.test(partes[1].texto) &&
          /RETURN x \* 2/i.test(partes[1].texto) &&
          !fp.valor.aviso,
        fp.ok ? partes.map((p) => `${p.titulo}: ${p.texto.split('\n')[0]}`).join(' | ') + (fp.valor.aviso ?? '') : JSON.stringify(fp)
      )
    }
    if (sinVista) salta('fuente de la vista', sinVista)
    else {
      const fv = await ex.fuente('c1', { esquema: USUARIO, nombre: V, tipo: 'vista' })
      const t = fv.ok ? (fv.valor.partes[0]?.texto ?? '') : ''
      check(
        'vista: su definición de ALL_VIEWS con la cabecera CREATE OR REPLACE VIEW',
        fv.ok && fv.valor.partes[0]?.titulo === 'Definición' && t.startsWith(`CREATE OR REPLACE VIEW "${USUARIO}"."${V}" AS\n`) && /SELECT/i.test(t),
        fv.ok ? t.slice(0, 120) : JSON.stringify(fv)
      )
    }

    // --- (5) Consola: 3 SELECT, más, UPDATE -------------------------------------------------
    hr('(5) Consola: 3 SELECT, «más» del cursor y UPDATE')
    const r1 = await ejecutar(`select * from ${CLI} order by id`)
    const r2 = await ejecutar(`select * from ${PED} order by id;`)
    const r3 = await ejecutar(`select * from ${NUM} order by id`)
    const tres = [r1, r2, r3].map((r) => (r.ok && r.valor.tipo === 'filas' ? filasDe(r).length : -1))
    check('3 SELECT = 3 resultados (3, 3 y la primera página de 500)', tres.join() === '3,3,500', `${tres.join()} | ${resumen(r3)}`)
    const lectorConsola = r3.ok && r3.valor.tipo === 'filas' ? r3.valor.lector : null
    if (lectorConsola) {
      const mas = await ex.leerMas(lectorConsola, 500)
      const fm = mas.ok ? filasJson(mas.valor.filasJson) : []
      check(
        '«más» lee del MISMO cursor de la consola: 501…1000, sin re-ejecutar',
        mas.ok && mas.valor.desde === 500 && fm.length === 500 && fm[0]?.[0] === '501' && !mas.valor.reejecutada,
        JSON.stringify(mas.ok ? { desde: mas.valor.desde, n: fm.length, primera: fm[0], re: mas.valor.reejecutada } : mas)
      )
      await ex.cerrarLector(lectorConsola)
    } else {
      check('la de 1234 filas deja un cursor vivo', false, resumen(r3))
    }
    const up = await ejecutar(`update ${CLI} set nombre = nombre where id <= 2`)
    check(
      'UPDATE = 2 filas afectadas',
      up.ok && up.valor.tipo === 'afectadas' && up.valor.filas === 2 && up.valor.comando === 'UPDATE',
      JSON.stringify(up.ok ? up.valor : up)
    )
    if (!sinPaquete) {
      const doble = await ejecutar(`select ${PKG}.doble(21) as d from dual`)
      check('la función del paquete compilado responde', JSON.stringify(filasDe(doble)) === '[["42"]]', resumen(doble))
    }

    // --- (6) Formatos NLS ---------------------------------------------------------------------
    hr('(6) Formatos NLS fijados al abrir')
    const fechas = await ejecutar(`select alta, marca, saldo from ${CLI} where id = 1`)
    const f = filasDe(fechas)[0] ?? []
    check('DATE en ISO con la hora de pared exacta (también la del hueco del cambio de hora)', f[0] === '2024-03-31 02:30:00', JSON.stringify(f[0]))
    check('TIMESTAMP con sus 6 decimales', f[1] === '2024-01-15 10:20:30.123456', JSON.stringify(f[1]))
    check('NUMBER de 38 dígitos, exacto', f[2] === '12345678901234567890123456789012345678', JSON.stringify(f[2]))
    const nums = await ejecutar("select -0.5 as neg, 1/3 as tercio, TIMESTAMP '2024-03-31 02:30:00.5 +02:00' as tz from dual")
    const g = filasDe(nums)[0] ?? []
    check('-0.5 con su cero y el punto decimal (NLS_NUMERIC_CHARACTERS fijado)', g[0] === '-0.5', JSON.stringify(g[0]))
    check('1/3 exacto, sin pasar por un double', typeof g[1] === 'string' && /^0\.3{30,}$/.test(g[1]), JSON.stringify(g[1]))
    check('TIMESTAMP WITH TIME ZONE con desplazamiento numérico', g[2] === '2024-03-31 02:30:00.500000 +02:00', JSON.stringify(g[2]))
    const sqlImplicita = `select count(*) from ${CLI} where alta = '2024-03-31 02:30:00'`
    const implicita = await ejecutar(sqlImplicita)
    check(
      "un literal '2024-03-31 02:30:00' en el WHERE se lee con el NLS fijado",
      JSON.stringify(filasDe(implicita)) === '[["1"]]',
      resumen(implicita) + ' ' + JSON.stringify(filasDe(implicita))
    )
    const cambio = await ejecutar("alter session set nls_date_format = 'DD/MM/YYYY'")
    check(
      'cambiar NLS_DATE_FORMAT se rechaza antes de enviarlo',
      !cambio.ok && /TO_CHAR/.test(cambio.error.mensaje),
      resumen(cambio)
    )
    const escondido = await ejecutar("begin\n  execute immediate 'alter session set nls_date_format = ''DD/MM/YYYY''';\nend;")
    const tras = await ejecutar(sqlImplicita)
    check(
      'un EXECUTE IMMEDIATE que lo cambia no lo desfija (se vuelve a fijar tras el bloque)',
      esHecho(escondido) && JSON.stringify(filasDe(tras)) === '[["1"]]',
      `${resumen(escondido)} y luego ${resumen(tras)} ${JSON.stringify(filasDe(tras))}`
    )

    // --- (7) Posición del error ---------------------------------------------------------------
    hr('(7) Posición del error (bytes -> UTF-16)')
    const conEnes = "-- la posición llega en bytes y vuelve en UTF-16\nselect 'ñññ' as t, columna_rota from dual"
    const rEnes = await ejecutar(conEnes)
    const eEnes = errorDe(rEnes)
    check(
      "tras un literal 'ñññ': ORA-00904 justo en la columna, no 3 caracteres más allá",
      rEnes.ok && eEnes?.codigo === 'ORA-00904' && eEnes.posicion === conEnes.indexOf('columna_rota'),
      `posicion=${eEnes?.posicion} esperada=${conEnes.indexOf('columna_rota')} ${eEnes?.codigo ?? resumen(rEnes)}; charset ${charset}`
    )
    const pegadas = `select * from ${CLI}\nselect * from ${PED}`
    const rp = await ejecutar(pegadas)
    const ep = errorDe(rp)
    check(
      'dos sentencias pegadas: ✗ del servidor en la segunda',
      rp.ok && ep?.motivo === 'servidor' && ep.posicion === pegadas.indexOf('select', 1),
      `posicion=${ep?.posicion} esperada=${pegadas.indexOf('select', 1)} ${ep?.codigo ?? resumen(rp)}`
    )

    // --- (8) EXEC y PL/SQL ----------------------------------------------------------------------
    hr('(8) EXEC y bloques PL/SQL')
    if (sinRutina) salta('EXEC de un procedimiento', sinRutina)
    else {
      const rExec = await ejecutar(`EXEC ${PRC}(7)`)
      const visto = await deMeta(`SELECT TO_CHAR(saldo) FROM ${CLI} WHERE id = 3`)
      check('EXEC: ✓ y, en Auto, confirmado (la meta ve el 7)', esHecho(rExec) && visto === '7', `${resumen(rExec)}; meta=${visto}`)
    }
    const bloque =
      `declare\n  n number;\nbegin\n  select count(*) into n from ${NUM};\n  if n <> 1234 then\n` +
      "    raise_application_error(-20001, 'cuenta ' || n);\n  end if;\nend;"
    const rBloque = await ejecutar(bloque)
    check('bloque PL/SQL anónimo: ✓', esHecho(rBloque), resumen(rBloque))
    const rFalla = await ejecutar("begin\n  raise_application_error(-20002, 'fallo a propósito');\nend;")
    check('RAISE_APPLICATION_ERROR: ✗ con su código', rFalla.ok && errorDe(rFalla)?.codigo === 'ORA-20002', resumen(rFalla))

    // --- (9) Transacciones ------------------------------------------------------------------------
    hr('(9) Transacción en Auto y Manual, vista desde la sesión meta')
    const saldo2 = (): Promise<string> => deMeta(`SELECT TO_CHAR(saldo) FROM ${CLI} WHERE id = 2`)
    await ejecutar(`update ${CLI} set saldo = 11 where id = 2`)
    let est = ex.estadoConsola(PERFIL, k1)
    check('Auto: tras el UPDATE no queda transacción y la meta ya ve 11', est?.tx === 'ninguna' && (await saldo2()) === '11', JSON.stringify(est?.tx))
    const man = await ex.modoTx(PERFIL, k1, 'manual')
    check('pasar a Manual', man.ok && man.valor.txModo === 'manual', JSON.stringify(man.ok ? man.valor.txModo : man))
    await ejecutar(`select count(*) from ${CLI}`)
    est = ex.estadoConsola(PERFIL, k1)
    check('Manual: una SELECT no abre transacción', est?.tx === 'ninguna', JSON.stringify(est?.tx))
    await ejecutar(`update ${CLI} set saldo = 12 where id = 2`)
    est = ex.estadoConsola(PERFIL, k1)
    check(
      'Manual: tras el UPDATE, tx pendiente con 1 sentencia (transactionInProgress o su respaldo)',
      est?.tx === 'pendiente' && est.sentenciasEnTx === 1,
      `${JSON.stringify(est && { tx: est.tx, n: est.sentenciasEnTx })} en ${drv?.modo ?? '?'}`
    )
    check('la meta NO ve el cambio sin confirmar', (await saldo2()) === '11', 'sigue en 11')
    const commit = await ex.tx(PERFIL, k1, 'commit')
    const trasCommit = await saldo2()
    check('Commit: tx ninguna y la meta ve 12', commit.ok && commit.valor.tx === 'ninguna' && trasCommit === '12', `${JSON.stringify(commit.ok ? commit.valor.tx : commit)} meta=${trasCommit}`)
    await ejecutar(`update ${CLI} set saldo = 13 where id = 2`)
    const rb = await ex.tx(PERFIL, k1, 'rollback')
    const trasRb = await saldo2()
    check('Rollback: tx ninguna y sigue en 12', rb.ok && rb.valor.tx === 'ninguna' && trasRb === '12', `${JSON.stringify(rb.ok ? rb.valor.tx : rb)} meta=${trasRb}`)
    await ejecutar(`update ${CLI} set saldo = 14 where id = 2`)
    const ddl = await ejecutar(`create table ${DDL} (x number)`)
    const avisosDdl = ddl.ok && ddl.valor.tipo === 'hecho' ? (ddl.valor.avisos ?? []) : []
    est = ex.estadoConsola(PERFIL, k1)
    check(
      'DDL en Manual con cambios pendientes: ✓ con el aviso del COMMIT implícito',
      avisosDdl.some((a) => /impl[ií]cita/.test(a)) && est?.tx === 'ninguna',
      `${resumen(ddl)} avisos=${JSON.stringify(avisosDdl)} tx=${est?.tx}`
    )
    const trasDdl = await saldo2()
    check('… y el COMMIT implícito fue real: la meta ve 14', trasDdl === '14', `meta=${trasDdl}`)
    const auto = await ex.modoTx(PERFIL, k1, 'auto')
    check('volver a Auto sin nada pendiente', auto.ok && auto.valor.txModo === 'auto', JSON.stringify(auto.ok ? auto.valor.txModo : auto))

    // --- (10) Stop ----------------------------------------------------------------------------------
    hr('(10) Stop')
    // Dos cargas ACOTADAS (un Stop que no corta falla aquí sin dejar basura en el servidor) y sin privilegios:
    //   - un bucle PL/SQL que quema CPU 15 s (un producto cartesiano no servía: sin break la sesión seguía ACTIVE);
    //   - un UPDATE BLOQUEADO por el observador (SELECT … FOR UPDATE) que suelta la fila a los 8 s.
    // El break viaja EN BANDA (thin no tiene OOB; thick lleva DISABLE_OOB=ON, ver `oracle.cjs`). Medido: la 11.2 lo
    // atiende al vencer la espera de enqueue (~3 s); la 21c, al soltarse la fila. En 12+ solo se exige `cancelada`
    // y la consola libre; lo que tarda va en la evidencia. Un SLEEP no vale: pide DBMS_LOCK y en la 11.2 no es estable.
    const probarStop = async (sqlLarga: string, metodo: string, ejecucionId: string, plazoMs: number): Promise<void> => {
      const t0 = Date.now()
      const larga = ex.ejecutar({ perfilId: PERFIL, consolaId: k1, ejecucionId, sql: sqlLarga, maxFilas: 500 })
      await dormir(800)
      ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k1, ejecucionId: 'otra' })
      ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k1, ejecucionId })
      const rl = await conPlazo(larga, 20_000)
      const dt = Date.now() - t0
      const el = errorDe(rl)
      check(
        `Stop de ${metodo}: cancelada (ORA-01013) en menos de ${plazoMs / 1000} s`,
        rl !== null && rl.ok && el?.motivo === 'cancelada' && el.codigo === 'ORA-01013' && dt < plazoMs,
        `${resumen(rl).split('\n')[0]} en ${dt} ms (${drv?.modo ?? '?'})`
      )
      const trasStop = await ejecutar('select 42 from dual')
      check(`… y ningún cancel tardío cae en la siguiente (${metodo})`, JSON.stringify(filasDe(trasStop)) === '[["42"]]', resumen(trasStop))
    }
    await probarStop(
      'declare\n  t pls_integer := dbms_utility.get_time;\nbegin\n' +
        '  while dbms_utility.get_time - t < 1500 loop\n    null;\n  end loop;\nend;',
      'un bucle PL/SQL que quema CPU (acotado a 15 s)',
      'larga-cpu',
      5000
    )
    await obs.execute(`SELECT id FROM ${CLI} WHERE id = 3 FOR UPDATE`, [], { autoCommit: false })
    const soltar = setTimeout(() => {
      obs.rollback().catch(() => {})
    }, 8000)
    try {
      await probarStop(
        `update ${CLI} set saldo = saldo where id = 3`,
        `un UPDATE bloqueado por otra sesión${mayor >= 12 ? ' (la 12+ lo atiende al soltarse la fila, a los 8 s)' : ''}`,
        'larga-fila',
        mayor >= 12 ? 15_000 : 5000
      )
    } finally {
      clearTimeout(soltar)
      await obs.rollback()
    }

    // --- (10b) Lo que confirma POR DENTRO ---------------------
    hr('(10b) Manual: un CALL de un procedimiento que confirma por dentro, perdido a mitad, no es «revirtió»')
    // MEDIDO: con una fila pendiente, `CALL p(…)` de un procedimiento que
    // hace COMMIT, y Forzar a mitad. Tessera decía «el servidor revirtió la transacción», y la
    // fila pendiente estaba CONFIRMADA: repetirla la duplicaba. Va en su PROPIA conexión
    // ('fz'), porque Forzar mata el proceso de la conexión entera y el resto sigue en 'c1'.
    if (sinRutina) salta('CALL que confirma por dentro, perdido a mitad', sinRutina)
    else {
      const RPD = `${PREFIJO}_RPD`
      const PPD = `${PREFIJO}_PPD`
      await q(`CREATE TABLE ${RPD} (id NUMBER(10))`)
      // Confirma y luego quema CPU ~4 s (acotado): da tiempo a Forzar con la llamada en vuelo.
      await q(
        `CREATE OR REPLACE PROCEDURE ${PPD} (marca IN NUMBER) AS\n  t PLS_INTEGER := dbms_utility.get_time;\nBEGIN\n` +
          `  INSERT INTO ${RPD} VALUES (marca);\n  COMMIT;\n  WHILE dbms_utility.get_time - t < 400 LOOP\n    NULL;\n  END LOOP;\nEND;`
      )
      conexiones.mapa.set('fz', { ...base, id: 'fz', alias: `${base.alias}-FZ` })
      conexiones.secretos.set('fz', dst.clave)
      const cfz = await ex.crearConsola(PERFIL, 'fz')
      const kfz = cfz.ok ? cfz.valor.id : ''
      const manFz = await ex.modoTx(PERFIL, kfz, 'manual')
      const insFz = await ex.ejecutar({ perfilId: PERFIL, consolaId: kfz, ejecucionId: 'fz-ins', sql: `INSERT INTO ${RPD} VALUES (1)`, maxFilas: 10 })
      const txAntes = ex.estadoConsola(PERFIL, kfz)?.tx
      const enVueloFz = ex.ejecutar({ perfilId: PERFIL, consolaId: kfz, ejecucionId: 'fz-call', sql: `CALL ${PPD}(2)`, maxFilas: 10 })
      await dormir(1500)
      ex.forzar('fz')
      const rFz = await conPlazo(enVueloFz, 20_000)
      const avisoFz = ex.estadoConsola(PERFIL, kfz)?.aviso
      // El servidor acaba la llamada (~4 s) antes de ver que el cliente ya no está.
      let confirmadas: string[] = []
      for (let i = 0; i < 30 && confirmadas.length < 2; i++) {
        await dormir(500)
        confirmadas = (await q(`SELECT TO_CHAR(id) FROM ${RPD} ORDER BY id`)).map((f) => String(f[0]))
      }
      const eFz = errorDe(rFz)
      const enDuda: string[] = [MENSAJES.perdidaPorDentro, MENSAJES.caidaPorDentro]
      check(
        'Forzar con el CALL en vuelo (Manual, una fila pendiente): «pueden confirmar por dentro… no se sabe», nunca «revirtió», y el aviso sin txPerdida',
        manFz.ok && insFz.ok && insFz.valor.tipo === 'afectadas' && txAntes === 'pendiente' && eFz !== null && enDuda.some((m) => eFz.mensaje.startsWith(m)) && !/revirti/.test(eFz.mensaje) &&
          avisoFz?.txPerdida === false && enDuda.includes(avisoFz.mensaje),
        JSON.stringify({ ins: resumen(insFz), txAntes, error: eFz, aviso: avisoFz })
      )
      check(
        '… y es verdad que no se sabía: la fila PENDIENTE quedó confirmada por el COMMIT del procedimiento',
        JSON.stringify(confirmadas) === '["1","2"]',
        JSON.stringify(confirmadas)
      )
    }

    // --- (11) Pestaña de tabla -------------------------------------------------------------------
    hr('(11) Pestaña de tabla: cursor vivo 500/500/234, Contar y respaldo ROWNUM')
    const refNum = { esquema: USUARIO, nombre: NUM, tipo: 'tabla' as const }
    // CON ORDER BY: en Oracle la rejilla no añade el de la PK (lee el cursor tal cual), y
    // el orden físico de un INSERT … SELECT no está garantizado (con ASSM, en un
    // contenedor recién creado, la 21c devolvió la fila 416 la primera). Sin él, este
    // test pasaba por suerte; el ROWNUM de respaldo tampoco casaría sin un orden.
    const tb = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't1', objeto: refNum, orderBy: 'id', maxFilas: 500 })
    const tf = tb.ok && tb.valor.resultado.tipo === 'filas' ? tb.valor.resultado : null
    const f1 = tf ? filasJson(tf.pagina.filasJson) : []
    const lector = tf?.lector ?? ''
    check(
      'página 1: 500 filas (ORDER BY id), hay más, lector',
      tf !== null && f1.length === 500 && f1[0]?.[0] === '1' && f1[499]?.[0] === '500' && tf.pagina.hayMas && !!lector &&
        tb.ok && JSON.stringify(tb.valor.clavePrimaria) === '["ID"]',
      JSON.stringify(tf ? { n: f1.length, primera: f1[0], hayMas: tf.pagina.hayMas, lector } : tb)
    )
    const cnt = await ex.contar(lector, 'cuenta')
    check('Contar: 1234 (en la sesión del lector)', cnt.ok && cnt.valor === 1234, JSON.stringify(cnt))
    const p2 = await ex.leerMas(lector, 500)
    const f2 = p2.ok ? filasJson(p2.valor.filasJson) : []
    check(
      'página 2: del MISMO cursor, 501…1000, hay más',
      p2.ok && p2.valor.desde === 500 && f2.length === 500 && f2[0]?.[0] === '501' && p2.valor.hayMas && !p2.valor.reejecutada,
      JSON.stringify(p2.ok ? { desde: p2.valor.desde, n: f2.length, primera: f2[0], re: p2.valor.reejecutada } : p2)
    )
    const p3 = await ex.leerMas(lector, 500)
    const f3 = p3.ok ? filasJson(p3.valor.filasJson) : []
    check(
      'página 3: 234 filas (…1234) y fin',
      p3.ok && f3.length === 234 && f3[233]?.[0] === '1234' && !p3.valor.hayMas && !p3.valor.reejecutada,
      JSON.stringify(p3.ok ? { n: f3.length, ultima: f3[233], hayMas: p3.valor.hayMas } : p3)
    )
    const tb2 = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't2', objeto: refNum, orderBy: 'id', maxFilas: 500 })
    const lector2 = tb2.ok && tb2.valor.resultado.tipo === 'filas' ? (tb2.valor.resultado.lector ?? '') : ''
    const procC1 = procesoDe.get('c1')
    let expulsado = false
    if (procC1 && lector2) {
      try {
        expulsado = (await procC1.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: 'datos', lector: lector2 })).cerrado
      } catch (e) {
        logs.push(`cerrarLector directo: ${mensajeDe(e)}`)
      }
    }
    check('se expulsa el cursor en el trabajador por detrás del main (como hace su LRU)', expulsado, `lector=${lector2 || '(ninguno)'}`)
    const q2 = await ex.leerMas(lector2, 500)
    const g2 = q2.ok ? filasJson(q2.valor.filasJson) : []
    check(
      'respaldo ROWNUM: página 2 re-ejecutada, 501…1000 y sin la columna "__TESSERA_RN"',
      q2.ok && q2.valor.reejecutada === true && q2.valor.desde === 500 && g2.length === 500 && g2[0]?.[0] === '501' &&
        g2[0]?.length === 2 && q2.valor.hayMas,
      JSON.stringify(q2.ok ? { re: q2.valor.reejecutada, desde: q2.valor.desde, n: g2.length, primera: g2[0] } : q2)
    )
    const q3 = await ex.leerMas(lector2, 500)
    const g3 = q3.ok ? filasJson(q3.valor.filasJson) : []
    check(
      'respaldo ROWNUM: página 3, 234 filas (…1234) y fin',
      q3.ok && q3.valor.reejecutada === true && g3.length === 234 && g3[233]?.[0] === '1234' && !q3.valor.hayMas,
      JSON.stringify(q3.ok ? { re: q3.valor.reejecutada, n: g3.length, ultima: g3[233], hayMas: q3.valor.hayMas } : q3)
    )
    // una tabla con una columna que se llama RN__. El número de fila del
    // respaldo se llamaba `rn__` a pelo y chocaba con ella (ORA-00918, medido en 11.2 y
    // 21c): la página re-ejecutada fallaba justo cuando hacía falta. Ahora es el alias
    // citado `"__TESSERA_RN"`, que una columna creada sin comillas no puede llevar.
    const RNT = `${PREFIJO}_RN`
    await q(`CREATE TABLE ${RNT} (id NUMBER(10) PRIMARY KEY, rn__ VARCHAR2(10))`)
    await q(`INSERT INTO ${RNT} (id, rn__) SELECT LEVEL, 'r' || LEVEL FROM dual CONNECT BY LEVEL <= 5`)
    const tRn = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't-rn', objeto: { esquema: USUARIO, nombre: RNT, tipo: 'tabla' }, orderBy: 'id', maxFilas: 2 })
    const lectorRn = tRn.ok && tRn.valor.resultado.tipo === 'filas' ? (tRn.valor.resultado.lector ?? '') : ''
    let expulsadoRn = false
    if (procC1 && lectorRn) {
      try {
        expulsadoRn = (await procC1.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: 'datos', lector: lectorRn })).cerrado
      } catch (e) {
        logs.push(`cerrarLector directo (RN__): ${mensajeDe(e)}`)
      }
    }
    const qRn = expulsadoRn ? await ex.leerMas(lectorRn, 2) : null
    const gRn = qRn && qRn.ok ? filasJson(qRn.valor.filasJson) : []
    check(
      'una columna RN__ en la tabla: el respaldo ROWNUM re-ejecuta la página 2 (3 y 4) con sus DOS columnas, sin ORA-00918',
      expulsadoRn && qRn !== null && qRn.ok && qRn.valor.reejecutada === true && qRn.valor.desde === 2 &&
        JSON.stringify(gRn) === JSON.stringify([['3', 'r3'], ['4', 'r4']]),
      JSON.stringify(qRn && qRn.ok ? { re: qRn.valor.reejecutada, desde: qRn.valor.desde, filas: gRn } : { expulsadoRn, qRn })
    )
    if (lectorRn) await ex.cerrarLector(lectorRn)

    // --- (11b) El tipo que ve el usuario --------------------------------------------------------
    // `byteSize` del driver son bytes en thick y el número declarado SIN
    // su unidad en thin, y el trabajador lo escribía a pelo: en thick,
    // 'NVARCHAR2(40)' por una NVARCHAR2(20) y 'VARCHAR2(160)' por una VARCHAR2(40 CHAR). En la
    // pestaña de tabla manda ahora el catálogo (`tipoDeclarado`), y en la consola el driver da
    // solo lo que sabe de verdad.
    hr('(11b) el tipo declarado en la pestaña de tabla y el honesto en la consola')
    const TIP = `${PREFIJO}_TIP`
    await q(
      `CREATE TABLE ${TIP} (id NUMBER(10) PRIMARY KEY, vb VARCHAR2(40 BYTE), vc VARCHAR2(40 CHAR), cc CHAR(5 CHAR), ` +
        'nv NVARCHAR2(20), nc NCHAR(3), r RAW(16), i INTEGER, nneg NUMBER(5,-2), ids INTERVAL DAY(3) TO SECOND(2), ts3 TIMESTAMP(3))'
    )
    await q(`INSERT INTO ${TIP} (id, vb, vc, cc, nv, nc) VALUES (1, 'a', 'ñ', 'c', 'n', 'x')`)
    const refTip = { esquema: USUARIO, nombre: TIP, tipo: 'tabla' as const }
    const esperadoTip: Record<string, string> = {
      ID: 'NUMBER(10)',
      VB: 'VARCHAR2(40)',
      VC: 'VARCHAR2(40 CHAR)',
      CC: 'CHAR(5 CHAR)',
      NV: 'NVARCHAR2(20)',
      NC: 'NCHAR(3)',
      R: 'RAW(16)',
      I: 'NUMBER(*,0)',
      NNEG: 'NUMBER(5,-2)',
      IDS: 'INTERVAL DAY(3) TO SECOND(2)',
      TS3: 'TIMESTAMP(3)'
    }
    const columnasDe = (t: Awaited<ReturnType<ExploradorController['abrirTabla']>>): DbColumnaResultado[] =>
      t.ok && t.valor.resultado.tipo === 'filas' ? t.valor.resultado.columnas : []
    const discrepanTip = (cols: DbColumnaResultado[], esperado: Record<string, string>): string[] =>
      Object.entries(esperado)
        .filter(([n, tipo]) => cols.find((c) => c.nombre === n)?.tipoDeclarado !== tipo)
        .map(([n, tipo]) => `${n}: ${String(cols.find((c) => c.nombre === n)?.tipoDeclarado)} ≠ ${tipo}`)
    const colsTip = columnasDe(await ex.abrirTabla({ conexionId: 'c1', peticionId: 'tip1', objeto: refTip, maxFilas: 10 }))
    const malTip = discrepanTip(colsTip, esperadoTip)
    check(
      'pestaña de tabla: cada columna con su tipo DECLARADO (VARCHAR2(40 CHAR), NVARCHAR2(20), NUMBER(*,0), NUMBER(5,-2), INTERVAL DAY(3) TO SECOND(2))',
      colsTip.length === Object.keys(esperadoTip).length && malTip.length === 0,
      malTip.join(' | ') || colsTip.map((c) => `${c.nombre}=${String(c.tipoDeclarado)}`).join(', ')
    )
    const motorTip = (n: string): string | undefined => colsTip.find((c) => c.nombre === n)?.tipoMotor
    check(
      `y el del trabajador (${modoEsperado}), que es el que decide: VARCHAR2 y CHAR sin un tamaño que no es el declarado, NVARCHAR2/NCHAR en caracteres, RAW en bytes`,
      motorTip('VB') === 'VARCHAR2' &&
        motorTip('VC') === 'VARCHAR2' &&
        motorTip('CC') === 'CHAR' &&
        motorTip('NV') === 'NVARCHAR2(20)' &&
        motorTip('NC') === 'NCHAR(3)' &&
        motorTip('R') === 'RAW(16)' &&
        motorTip('NNEG') === 'NUMBER(5,-2)',
      colsTip.map((c) => `${c.nombre}=${c.tipoMotor}`).join(', ')
    )
    // La transacción READ ONLY de la conexión de solo lectura no deja leer una tabla recién
    // creada (ORA-01466, medido: el mismo reintento que en (27)).
    const abrirTipRo = (): ReturnType<ExploradorController['abrirTabla']> =>
      ex.abrirTabla({ conexionId: 'ro', peticionId: 'tip-ro', objeto: refTip, maxFilas: 10 })
    let tTipRo = await abrirTipRo()
    for (let i = 0; i < 6 && tTipRo.ok && tTipRo.valor.resultado.tipo === 'error' && tTipRo.valor.resultado.error.codigo === 'ORA-01466'; i++) {
      await dormir(1500)
      tTipRo = await abrirTipRo()
    }
    const colsTipRo = columnasDe(tTipRo)
    const malTipRo = discrepanTip(colsTipRo, esperadoTip)
    check(
      'también con una conexión de SOLO LECTURA, que no lee el catálogo de edición',
      colsTipRo.length === Object.keys(esperadoTip).length && malTipRo.length === 0,
      malTipRo.length === 0 ? 'todas' : `${malTipRo.join(' | ')} | ${JSON.stringify(tTipRo).slice(0, 300)}`
    )
    // Un ALTER hecho FUERA de Tessera (el observador): la caché del catálogo no se entera,
    // y la columna nueva es la señal para releerlo una vez.
    await q(`ALTER TABLE ${TIP} ADD (nueva VARCHAR2(7 CHAR))`)
    const colsTipDdl = columnasDe(await ex.abrirTabla({ conexionId: 'c1', peticionId: 'tip2', objeto: refTip, maxFilas: 10 }))
    const malTipDdl = discrepanTip(colsTipDdl, { ...esperadoTip, NUEVA: 'VARCHAR2(7 CHAR)' })
    check(
      'tras un ALTER hecho fuera de Tessera, la columna nueva llega con su tipo declarado (se relee el catálogo)',
      malTipDdl.length === 0,
      malTipDdl.join(' | ') || 'todas'
    )
    const rTip = await ejecutar(
      `select vb, vc, cc, nv, nc, r, nneg, substr(vc, 1, 3) as s3, cast('x' as nvarchar2(7)) as n7 from ${TIP}`
    )
    const colsCon = rTip.ok && rTip.valor.tipo === 'filas' ? rTip.valor.columnas : []
    const tiposCon = colsCon.map((c) => c.tipoMotor).join(',')
    check(
      'consola: VARCHAR2 y CHAR sin tamaño, NVARCHAR2 y NCHAR en caracteres (el juego nacional se lee al abrir), RAW en bytes, y sin tipo declarado',
      tiposCon === 'VARCHAR2,VARCHAR2,CHAR,NVARCHAR2(20),NCHAR(3),RAW(16),NUMBER(5,-2),VARCHAR2,NVARCHAR2(7)' &&
        colsCon.every((c) => c.tipoDeclarado === undefined),
      `${tiposCon} | ${resumen(rTip)}`
    )

    // --- (12) Sinónimo --------------------------------------------------------------------------
    hr('(12) Sinónimo privado')
    if (sinSinonimo) salta('sinónimo privado', sinSinonimo)
    else {
      const rs = await ex.resolver('c1', USUARIO, SIN)
      check(
        'se resuelve a su tabla',
        rs.ok && rs.valor.esquema === USUARIO && rs.valor.nombre === CLI && rs.valor.tipo === 'tabla',
        JSON.stringify(rs)
      )
      const ts = await ex.abrirTabla({
        conexionId: 'c1',
        peticionId: 't3',
        objeto: { esquema: USUARIO, nombre: SIN, tipo: 'sinonimo' },
        maxFilas: 500
      })
      const tsf = ts.ok && ts.valor.resultado.tipo === 'filas' ? filasJson(ts.valor.resultado.pagina.filasJson) : []
      check(
        'abrirlo abre la tabla: su PK y sus 3 filas',
        ts.ok && ts.valor.objeto.nombre === CLI && JSON.stringify(ts.valor.clavePrimaria) === '["ID"]' && tsf.length === 3,
        JSON.stringify(ts.ok ? { objeto: ts.valor.objeto, pk: ts.valor.clavePrimaria, n: tsf.length } : ts)
      )
      const sins = await ex.objetos('c1', USUARIO, 'sinonimo')
      check('y aparece en la carpeta de sinónimos', sins.ok && sins.valor.some((o) => o.nombre === SIN), sins.ok ? `${sins.valor.length} sinónimos` : JSON.stringify(sins))
    }

    // --- (12b) PUBLIC ------------------------------------------------------------------------------
    // PUBLIC no es un esquema consultable: el árbol lo enseña como pseudo-esquema con
    // sus sinónimos, abrir uno abre el objeto al que apunta, y el autocompletado los
    // carga APARTE y perezosos (en una 11g con opciones son decenas de miles). Se mide
    // lo que tarda esa carga y cuántos trae, contra lo que dice ALL_OBJECTS.
    hr('(12b) PUBLIC: pseudo-esquema, sinónimos y su índice de autocompletado')
    const nPublicos = Number(
      (await q("SELECT COUNT(DISTINCT object_name) FROM all_objects WHERE owner = 'PUBLIC' AND object_type = 'SYNONYM'"))[0]?.[0]
    )
    const sinsPub = await ex.objetos('c1', 'PUBLIC', 'sinonimo')
    check(
      'la carpeta de sinónimos de PUBLIC los lista (DUAL entre ellos)',
      sinsPub.ok && sinsPub.valor.length > 0 && sinsPub.valor.some((o) => o.nombre === 'DUAL'),
      sinsPub.ok ? `${sinsPub.valor.length} en el árbol, ${nPublicos} en ALL_OBJECTS` : JSON.stringify(sinsPub)
    )
    const rDual = await ex.resolver('c1', 'PUBLIC', 'DUAL')
    check(
      'PUBLIC.DUAL se resuelve a SYS.DUAL',
      rDual.ok && rDual.valor.esquema === 'SYS' && rDual.valor.nombre === 'DUAL',
      JSON.stringify(rDual)
    )
    const tDual = await ex.abrirTabla({
      conexionId: 'c1',
      peticionId: 't4',
      objeto: { esquema: 'PUBLIC', nombre: 'DUAL', tipo: 'sinonimo' },
      maxFilas: 500
    })
    const fDual = tDual.ok && tDual.valor.resultado.tipo === 'filas' ? filasJson(tDual.valor.resultado.pagina.filasJson) : []
    check(
      'abrir el sinónimo PUBLIC abre su objeto (nunca "PUBLIC"."DUAL")',
      tDual.ok && tDual.valor.objeto.esquema === 'SYS' && JSON.stringify(fDual) === '[["X"]]',
      JSON.stringify(tDual.ok ? { objeto: tDual.valor.objeto, filas: fDual } : tDual)
    )
    const tPub0 = Date.now()
    const pub = await ex.nombresPublicos('c1')
    const msPub = Date.now() - tPub0
    const tPub1 = Date.now()
    const pub2 = await ex.nombresPublicos('c1')
    const msPub2 = Date.now() - tPub1
    check(
      'autocompletado: los sinónimos PUBLIC, todos y sin repetir (DUAL y ALL_OBJECTS entre ellos)',
      pub.ok && pub.valor.length === nPublicos && pub.valor.includes('DUAL') && pub.valor.includes('ALL_OBJECTS'),
      pub.ok ? `${pub.valor.length} nombres (ALL_OBJECTS: ${nPublicos}) en ${msPub} ms` : JSON.stringify(pub)
    )
    check(
      '… y la segunda vez sale de la caché, sin viaje',
      pub2.ok && pub.ok && pub2.valor.length === pub.valor.length && msPub2 < Math.max(50, msPub / 4),
      `${msPub2} ms la segunda frente a ${msPub} ms la primera`
    )

    // --- (13) Solo lectura ------------------------------------------------------------------------
    hr('(13) Solo lectura: en el main y en el servidor')
    const consolaRo = await ex.crearConsola(PERFIL, 'ro')
    const kr = consolaRo.ok ? consolaRo.valor.id : ''
    const selRo = await ejecutar(`select count(*) from ${CLI}`, kr)
    let estRo = ex.estadoConsola(PERFIL, kr)
    check(
      'la consulta pasa, sin transacción que perder',
      JSON.stringify(filasDe(selRo)) === '[["3"]]' && estRo?.soloLectura === true && estRo.tx === 'ninguna',
      `${resumen(selRo)} ${JSON.stringify(estRo && { ro: estRo.soloLectura, tx: estRo.tx })}`
    )
    const upRo = await ejecutar(`update ${CLI} set saldo = 0`, kr)
    check('el main rechaza el UPDATE sin enviarlo', !upRo.ok && upRo.error.motivo === 'soloLectura', resumen(upRo))
    const bloqueRo = await ejecutar(`begin\n  insert into ${CLI} (id, nombre) values (99, 'escape');\nend;`, kr)
    check('el main rechaza un INSERT dentro de un bloque PL/SQL', !bloqueRo.ok && bloqueRo.error.motivo === 'soloLectura', resumen(bloqueRo))
    const ddlRo = await ejecutar(`create table ${RO} (x number)`, kr)
    check(
      'y un DDL (que confirmaría y escaparía a la transacción de solo lectura)',
      !ddlRo.ok && ddlRo.error.motivo === 'soloLectura',
      resumen(ddlRo)
    )
    const cs = await ejecutar(`alter session set current_schema = ${identSql(USUARIO)}`, kr)
    estRo = ex.estadoConsola(PERFIL, kr)
    check(
      'ALTER SESSION SET CURRENT_SCHEMA (lista blanca) pasa y el esquema se relee',
      esHecho(cs) && estRo?.esquema === USUARIO,
      `${resumen(cs)} esquema=${estRo?.esquema}`
    )
    const procRo = procesoDe.get('ro')
    let rechazo: ErrorTrabajador | null = null
    let colado = false
    if (procRo) {
      try {
        await procRo.enviar<'ejecutar'>({
          op: 'ejecutar',
          sesion: `consola:${kr}`,
          sql: `insert into ${CLI} (id, nombre) values (99, 'escape')`,
          opciones: { proposito: 'usuario', maxFilas: 1, candadoRO: true, esDml: true }
        })
        colado = true
      } catch (e) {
        if (esFalloTrabajador(e)) rechazo = e.error
        else logs.push(`insert directo: ${mensajeDe(e)}`)
      }
      if (colado) {
        try {
          await procRo.enviar<'tx'>({ op: 'tx', sesion: `consola:${kr}`, accion: 'rollback' })
        } catch {
          // el cierre de la sesión revierte igual
        }
      }
    }
    check(
      'el servidor rechaza un INSERT que se salta el main (SET TRANSACTION READ ONLY efectivo: ORA-01456)',
      !colado && rechazo?.clase === 'soloLectura' && rechazo.codigo === 'ORA-01456',
      colado ? '¡el INSERT pasó!' : JSON.stringify(rechazo)
    )
    const n99 = await deMeta(`SELECT TO_CHAR(COUNT(*)) FROM ${CLI} WHERE id = 99`)
    check('y no quedó nada escrito', n99 === '0', `filas con id 99: ${n99}`)

    // --- (16) DBMS_OUTPUT ----------------------------------------------------------------------------
    hr('(16) DBMS_OUTPUT en la salida del resultado (también si falla) y su tope')
    const rOut = await ejecutar("begin\n  dbms_output.put_line('hola ñ');\n  dbms_output.put_line(null);\n  dbms_output.put_line('adiós');\nend;")
    check(
      'un bloque con PUT_LINE: ✓ con su salida (la línea vacía incluida)',
      rOut.ok && rOut.valor.tipo === 'hecho' && JSON.stringify(rOut.valor.salida) === '[{"texto":"hola ñ"},{"texto":""},{"texto":"adiós"}]',
      JSON.stringify(rOut.ok ? rOut.valor : rOut)
    )
    const rOutErr = await ejecutar("begin\n  dbms_output.put_line('antes del fallo');\n  raise_application_error(-20003, 'fallo');\nend;")
    check(
      'si el bloque falla, lo que escribió antes viaja en el error',
      rOutErr.ok && rOutErr.valor.tipo === 'error' && rOutErr.valor.error.codigo === 'ORA-20003' && JSON.stringify(rOutErr.valor.salida) === '[{"texto":"antes del fallo"}]',
      JSON.stringify(rOutErr.ok ? rOutErr.valor : rOutErr)
    )
    const rOutMuchas = await ejecutar("begin\n  for i in 1 .. 1500 loop\n    dbms_output.put_line('linea ' || i);\n  end loop;\nend;")
    const sm = rOutMuchas.ok && rOutMuchas.valor.tipo === 'hecho' ? (rOutMuchas.valor.salida ?? []) : []
    check(
      'tope: 1000 líneas y el resto PURGADO sin leerlo, con su aviso',
      sm.length === 1001 && sm[999].texto === 'linea 1000' && sm[1000].aviso === true && /sin leerlo/.test(sm[1000].texto),
      JSON.stringify(sm.slice(-2))
    )
    const rOutSel = await ejecutar('select 1 from dual')
    const rOutSig = await ejecutar('begin null; end;')
    check(
      'un SELECT no gasta el viaje de GET_LINES y la purga no deja restos para la siguiente',
      rOutSel.ok && rOutSel.valor.tipo === 'filas' && rOutSel.valor.salida === undefined && rOutSig.ok && rOutSig.valor.tipo === 'hecho' && rOutSig.valor.salida === undefined,
      `${JSON.stringify(rOutSel.ok ? rOutSel.valor.salida : rOutSel)} / ${JSON.stringify(rOutSig.ok ? rOutSig.valor.salida : rOutSig)}`
    )
    // Un DML también escribe: el trigger de un INSERT con PUT_LINE. Por eso `dml` (y
    // `ddl`) siguen pagando el viaje de GET_LINES: sin él, la línea se quedaría en el
    // buffer y la enseñaría la SIGUIENTE sentencia que lee, como si fuera suya.
    await q(`CREATE TABLE ${TRG} (id NUMBER(10) PRIMARY KEY)`)
    // Trigger de sentencia, sin :NEW: un bind de más en el DDL no es lo que se prueba.
    const sinTrigger = await opcional(
      'CREATE TRIGGER',
      `CREATE OR REPLACE TRIGGER ${TRG}_AI AFTER INSERT ON ${TRG}\nBEGIN\n  dbms_output.put_line('trigger dice hola');\nEND;`
    )
    if (sinTrigger) salta('salida del trigger de un INSERT', sinTrigger)
    else {
      const rTrg = await ejecutar(`insert into ${TRG} values (1)`)
      const rTrgSig = await ejecutar('begin null; end;')
      check(
        'un INSERT cuyo trigger escribe con PUT_LINE: la línea viaja en SU resultado',
        rTrg.ok && rTrg.valor.tipo === 'afectadas' && JSON.stringify(rTrg.valor.salida) === '[{"texto":"trigger dice hola"}]',
        JSON.stringify(rTrg.ok ? rTrg.valor : rTrg)
      )
      check(
        '… y la sentencia siguiente que lee no la hereda',
        rTrgSig.ok && rTrgSig.valor.tipo === 'hecho' && rTrgSig.valor.salida === undefined,
        JSON.stringify(rTrgSig.ok ? rTrgSig.valor.salida : rTrgSig)
      )
    }

    // --- (17) ALL_ERRORS ------------------------------------------------------------------------------
    hr('(17) Errores de compilación: ALL_ERRORS con la posición en el texto enviado')
    if (sinRutina) salta('errores de compilación', sinRutina)
    else {
      // CREATE y PROCEDURE en líneas distintas, ñ y emoji en una línea anterior y un
      // tabulador antes del error: la posición es relativa a lo ENVIADO.
      const cuerpoCmp = `CREATE OR REPLACE\n  PROCEDURE ${CMP} (x NUMBRE) AS\n  v VARCHAR2(40) := 'ñññ😀';\nBEGIN\n\tv := 'ñ' || noexiste;\nEND;`
      const rCmp = await ejecutar(cuerpoCmp)
      const enviado = cuerpoCmp
      const eCmp = rCmp.ok && rCmp.valor.tipo === 'error' ? rCmp.valor : null
      const comp = eCmp?.compilacion ?? []
      check(
        'CREATE con errores: ✗ ORA-24344 y la lista de ALL_ERRORS',
        eCmp !== null && eCmp.error.codigo === 'ORA-24344' && comp.length >= 1 && comp.every((c) => !c.esAviso),
        JSON.stringify(eCmp ?? rCmp)
      )
      const numbre = comp.find((c) => /NUMBRE/.test(c.mensaje))
      check(
        'la línea 1 es la de PROCEDURE (no la de CREATE) y la marca cae en NUMBRE',
        numbre !== undefined && numbre.linea === 1 && numbre.posicion === enviado.indexOf('NUMBRE'),
        `${JSON.stringify(numbre)} esperada=${enviado.indexOf('NUMBRE')}`
      )
      // Con el parámetro arreglado, el error pasa al cuerpo, tras un tabulador y una ñ.
      const cuerpo2 = cuerpoCmp.replace('NUMBRE', 'NUMBER')
      const rCmp2 = await ejecutar(cuerpo2)
      const comp2 = rCmp2.ok && rCmp2.valor.tipo === 'error' ? (rCmp2.valor.compilacion ?? []) : []
      const noexiste = comp2.find((c) => /NOEXISTE/.test(c.mensaje))
      check(
        'error en el cuerpo tras un tabulador y una ñ (columna en bytes): la marca en noexiste',
        noexiste !== undefined && noexiste.linea === 4 && noexiste.posicion === cuerpo2.indexOf('noexiste'),
        `${JSON.stringify(noexiste)} esperada=${cuerpo2.indexOf('noexiste')}; charset ${charset}`
      )
      // Solo avisos: con PLSQL_WARNINGS, el CREATE compila (✓) y trae la lista.
      await ejecutar("alter session set plsql_warnings = 'ENABLE:ALL'")
      const rAvs = await ejecutar(`CREATE OR REPLACE PROCEDURE ${AVS} AS\n  n NUMBER;\nBEGIN\n  NULL;\nEND;`)
      await ejecutar("alter session set plsql_warnings = 'DISABLE:ALL'")
      const hAvs = rAvs.ok && rAvs.valor.tipo === 'hecho' ? rAvs.valor : null
      if (hAvs && (hAvs.compilacion ?? []).length > 0) {
        check('solo avisos: ✓ con la lista, todos marcados como aviso', (hAvs.compilacion ?? []).every((c) => c.esAviso), JSON.stringify(hAvs.compilacion))
      } else {
        check('solo avisos: ✓ (el servidor no dio avisos para esta unidad)', hAvs !== null, JSON.stringify(rAvs.ok ? rAvs.valor : rAvs))
      }
    }

    // --- (18) DDL ------------------------------------------------------------------------------------
    hr('(18) Ver DDL: DBMS_METADATA y su repliegue')
    await q(`CREATE SEQUENCE ${SEQ} START WITH 10 INCREMENT BY 5`)
    const ddlCli = await ex.ddl('c1', { esquema: USUARIO, nombre: CLI, tipo: 'tabla' })
    const tCli = ddlCli.ok ? (ddlCli.valor.partes[0]?.texto ?? '') : ''
    const viaMetadata = ddlCli.ok && ddlCli.valor.origen === 'DBMS_METADATA'
    check(
      viaMetadata
        ? 'tabla por DBMS_METADATA: CREATE TABLE con la PK, sin almacenamiento, con terminador'
        : 'tabla REPLEGADA (DBMS_METADATA no funciona aquí): CREATE TABLE con la PK desde el catálogo y el aviso',
      ddlCli.ok && ddlCli.valor.partes[0]?.titulo === 'DDL' && tCli.startsWith(`CREATE TABLE "${USUARIO}"."${CLI}"`) && tCli.includes(`"${CLI}_PK"`) &&
        !/TABLESPACE|STORAGE\s*\(/.test(tCli) && /;\s*$/.test(tCli) && (viaMetadata || /DBMS_METADATA no devolvió/.test(ddlCli.valor.aviso ?? '')),
      `${ddlCli.ok ? `${ddlCli.valor.origen} ${ddlCli.valor.aviso ?? ''}` : JSON.stringify(ddlCli)}\n${tCli}`
    )
    const ddlPed = await ex.ddl('c1', { esquema: USUARIO, nombre: PED, tipo: 'tabla' })
    const tPed = ddlPed.ok ? (ddlPed.valor.partes[0]?.texto ?? '') : ''
    check('tabla con FK: REFERENCES a la madre', tPed.includes(`REFERENCES "${USUARIO}"."${CLI}"`), tPed)
    if (!sinPaquete) {
      const ddlPkg = await ex.ddl('c1', { esquema: USUARIO, nombre: PKG, tipo: 'paquete' })
      const tPkg = ddlPkg.ok ? (ddlPkg.valor.partes[0]?.texto ?? '') : ''
      check('paquete: especificación y cuerpo, cada uno con su /', /PACKAGE\s+"?[^\n]*\n[\s\S]*\n\/\n\n[\s\S]*PACKAGE\s+BODY[\s\S]*\n\/$/.test(tPkg), tPkg)
    }
    const ddlSeq = await ex.ddl('c1', { esquema: USUARIO, nombre: SEQ, tipo: 'secuencia' })
    const tSeq = ddlSeq.ok ? (ddlSeq.valor.partes[0]?.texto ?? '') : ''
    check('secuencia', /CREATE SEQUENCE\s+"[^"]+"\."[^"]+"/.test(tSeq) && /INCREMENT BY 5/.test(tSeq), tSeq)
    if (!sinVista) {
      const ddlV = await ex.ddl('c1', { esquema: USUARIO, nombre: V, tipo: 'vista' })
      const tV = ddlV.ok ? (ddlV.valor.partes[0]?.texto ?? '') : ''
      check('vista', /CREATE OR REPLACE .*VIEW "[^"]+"\."[^"]+"/.test(tV) && /;\s*$/.test(tV), tV)
    }
    if (!sinSinonimo) {
      const ddlS = await ex.ddl('c1', { esquema: USUARIO, nombre: SIN, tipo: 'sinonimo' })
      const tS = ddlS.ok ? (ddlS.valor.partes[0]?.texto ?? '') : ''
      check('sinónimo privado', /SYNONYM "[^"]+"\."[^"]+" FOR "[^"]+"\."[^"]+";/.test(tS), tS)
    }
    const ddlDual = await ex.ddl('c1', { esquema: 'PUBLIC', nombre: 'DUAL', tipo: 'sinonimo' })
    const tDdlDual = ddlDual.ok ? (ddlDual.valor.partes[0]?.texto ?? '') : ''
    check(
      'sinónimo PUBLIC de Oracle (DBMS_METADATA no enseña los que mantiene Oracle): CREATE PUBLIC SYNONYM',
      tDdlDual === 'CREATE PUBLIC SYNONYM "DUAL" FOR "SYS"."DUAL";' || /CREATE OR REPLACE .*PUBLIC SYNONYM "DUAL"/.test(tDdlDual),
      `${tDdlDual} ${ddlDual.ok ? (ddlDual.valor.aviso ?? '') : JSON.stringify(ddlDual)}`
    )
    if (!usuarioSinCatalogo) {
      salta('repliegue por privilegios (ORA-31603)', 'sin TESSERA_TEST_ORACLE_SIN (un usuario sin SELECT_CATALOG_ROLE con la misma contraseña)')
    } else {
      let concedido = true
      try {
        await q(`GRANT SELECT ON ${CLI} TO ${identSql(usuarioSinCatalogo.toUpperCase())}`)
      } catch (err) {
        concedido = false
        salta('repliegue por privilegios (ORA-31603)', `no se pudo conceder SELECT a ${usuarioSinCatalogo}: ${codigoDe(err)}`)
      }
      if (concedido) {
        const ddlSin = await ex.ddl('sin', { esquema: USUARIO, nombre: CLI, tipo: 'tabla' })
        const tSin = ddlSin.ok ? (ddlSin.valor.partes[0]?.texto ?? '') : ''
        check(
          'sin SELECT_CATALOG_ROLE: repliegue desde ALL_TAB_COLUMNS con el aviso (ORA-31603 o DBMS_METADATA roto)',
          ddlSin.ok && ddlSin.valor.origen === 'ALL_TAB_COLUMNS' && tSin.startsWith(`CREATE TABLE "${USUARIO}"."${CLI}"`) &&
            tSin.includes(`CONSTRAINT "${CLI}_PK" PRIMARY KEY ("ID")`) && tSin.includes('"NOMBRE" VARCHAR2(40 CHAR) NOT NULL') && /DBMS_METADATA no devolvió/.test(ddlSin.valor.aviso ?? ''),
          `${ddlSin.ok ? ddlSin.valor.aviso : JSON.stringify(ddlSin)}\n${tSin}`
        )
      }
    }

    // --- (19) Valor completo -------------------------------------------------------------------------
    hr('(19) Valor completo: un CLOB de más de 64 KiB y un BLOB por su PK (NUMBER + DATE)')
    const largoDoc = 'ñ😀x'.repeat(30000) + 'FIN'
    const odbLob = odb as unknown as { CLOB: unknown; BLOB: unknown }
    await q(`CREATE TABLE ${DOC} (id NUMBER(10), fecha DATE, cuerpo CLOB, bin BLOB, CONSTRAINT ${DOC}_PK PRIMARY KEY (id, fecha))`)
    await obs.execute(
      `INSERT INTO ${DOC} (id, fecha, cuerpo, bin) VALUES (1, TO_DATE('2024-03-31 02:30:00', 'YYYY-MM-DD HH24:MI:SS'), :c, :b)`,
      { c: { val: largoDoc, type: odbLob.CLOB }, b: { val: Buffer.alloc(70000, 0xab), type: odbLob.BLOB } },
      { autoCommit: true }
    )
    const refDoc = { esquema: USUARIO, nombre: DOC, tipo: 'tabla' as const }
    const tDoc = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'tdoc', objeto: refDoc, maxFilas: 500 })
    const fDoc = tDoc.ok && tDoc.valor.resultado.tipo === 'filas' ? tDoc.valor.resultado : null
    const filaDoc = fDoc ? (filasJson(fDoc.pagina.filasJson)[0] as Array<string | null>) : []
    check(
      'la rejilla lo recibe recortado y con la PK compuesta (ID, FECHA)',
      !!fDoc && (fDoc.pagina.recortes ?? []).some((r) => r[1] === 2 && r[2] === largoDoc.length) && tDoc.ok && JSON.stringify(tDoc.valor.clavePrimaria) === '["ID","FECHA"]',
      JSON.stringify({ recortes: fDoc?.pagina.recortes, pk: tDoc.ok ? tDoc.valor.clavePrimaria : tDoc, fecha: filaDoc[1] })
    )
    const vDoc = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: [filaDoc[0] ?? null, filaDoc[1] ?? null], columna: 'CUERPO' })
    check(
      'VALOR: el CLOB entero (NUMBER y DATE como texto del bind, con el NLS fijado)',
      vDoc.ok && vDoc.valor.valor === largoDoc && vDoc.valor.longitud === largoDoc.length && !vDoc.valor.recortado && vDoc.valor.tipoLogico === 'lob',
      JSON.stringify(vDoc.ok ? { longitud: vDoc.valor.longitud, recortado: vDoc.valor.recortado } : vDoc)
    )
    const vBlob = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: [filaDoc[0] ?? null, filaDoc[1] ?? null], columna: 'BIN' })
    check('VALOR: el BLOB entero como 0x… y 70000 bytes', vBlob.ok && vBlob.valor.valor === '0x' + 'AB'.repeat(70000) && vBlob.valor.longitud === 70000, JSON.stringify(vBlob.ok ? { longitud: vBlob.valor.longitud } : vBlob))
    const vFuera = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: ['2', filaDoc[1] ?? null], columna: 'CUERPO' })
    check('la fila ya no existe: error claro', !vFuera.ok && /ya no existe/.test(vFuera.error.mensaje), JSON.stringify(vFuera))
    // De un resultado de CONSOLA en Manual se lee en SU sesión, que ve la tx sin
    // confirmar. Antes se leía en `datos`: la fila insertada «ya no existía» y la
    // actualizada daba el CLOB viejo sin avisar.
    await ex.modoTx(PERFIL, k1, 'manual')
    const rBloqDoc = await ejecutar(
      `declare\n  c clob;\nbegin\n  for i in 1 .. 20 loop\n    c := c || rpad('n', 4000, 'n');\n  end loop;\n` +
        `  update ${DOC} set cuerpo = c where id = 1;\n  insert into ${DOC} (id, fecha, cuerpo) values (2, date '2024-01-01', c);\nend;`
    )
    const rSelDoc = await ejecutar(`select id, fecha, cuerpo from ${DOC} order by id`)
    const filasSelDoc = filasDe(rSelDoc) as Array<Array<string | null>>
    const claveDe = (i: number): Array<string | null> => [filasSelDoc[i]?.[0] ?? null, filasSelDoc[i]?.[1] ?? null]
    const nuevoDoc = 'n'.repeat(80000)
    check(
      'Manual: un bloque que actualiza el CLOB e inserta otra fila, sin confirmar, y la consola los ve',
      rBloqDoc.ok && rBloqDoc.valor.tipo === 'hecho' && filasSelDoc.length === 2 && ex.estadoConsola(PERFIL, k1)?.tx === 'pendiente',
      JSON.stringify({ bloque: resumen(rBloqDoc), filas: filasSelDoc.length, tx: ex.estadoConsola(PERFIL, k1)?.tx })
    )
    const deK1 = { perfilId: PERFIL, consolaId: k1 }
    const vUpdC = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: claveDe(0), columna: 'CUERPO', consola: deK1 })
    const vInsC = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: claveDe(1), columna: 'CUERPO', consola: deK1 })
    check(
      'con su consola: el CLOB ACTUALIZADO y el de la fila INSERTADA, sin confirmar y enteros',
      vUpdC.ok && vUpdC.valor.valor === nuevoDoc && vInsC.ok && vInsC.valor.valor === nuevoDoc && vInsC.valor.longitud === 80000,
      JSON.stringify({ upd: vUpdC.ok ? vUpdC.valor.longitud : vUpdC, ins: vInsC.ok ? vInsC.valor.longitud : vInsC })
    )
    const vUpdD = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: claveDe(0), columna: 'CUERPO' })
    const vInsD = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: claveDe(1), columna: 'CUERPO' })
    check(
      'sin consola (la pestaña de tabla, en `datos`): lo confirmado, como antes',
      vUpdD.ok && vUpdD.valor.valor === largoDoc && !vInsD.ok && /ya no existe/.test(vInsD.error.mensaje),
      JSON.stringify({ upd: vUpdD.ok ? vUpdD.valor.longitud : vUpdD, ins: vInsD.ok ? 'existe' : vInsD.error.motivo })
    )
    check('leer el valor no confirma nada: la tx sigue pendiente', ex.estadoConsola(PERFIL, k1)?.tx === 'pendiente', String(ex.estadoConsola(PERFIL, k1)?.tx))
    const rbDoc = await ex.modoTx(PERFIL, k1, 'auto', 'rollback')
    const nDocTras = (await q(`SELECT COUNT(*) FROM ${DOC}`))[0]?.[0]
    check('al revertir, todo como estaba', rbDoc.ok && rbDoc.valor.tx === 'ninguna' && Number(nDocTras) === 1, JSON.stringify({ rb: rbDoc.ok ? rbDoc.valor.tx : rbDoc, filas: nDocTras }))

    // --- (20) Exportar ----------------------------------------------------------------------------------
    hr('(20) Exportar: tabla con LOB enteros y una consulta de 12 345 filas del mismo cursor')
    const leer = (archivo: string | undefined): string => {
      const ruta = path.join(exportados, archivo ?? '?')
      return existsSync(ruta) ? readFileSync(ruta, 'utf8') : '(no existe)'
    }
    const eDoc = await ex.exportar({
      peticionId: 'exp-o-1',
      origen: { tipo: 'tabla', conexionId: 'c1', objeto: refDoc },
      formato: 'json',
      nombreSugerido: `${USUARIO}.${DOC}`,
      motor: 'oracle'
    })
    const jDoc = eDoc.ok && eDoc.valor ? (JSON.parse(leer(eDoc.valor.archivo)) as Array<Record<string, unknown>>) : []
    check(
      'tabla -> JSON con el CLOB y el BLOB enteros y la fecha con el NLS fijado',
      jDoc.length === 1 && jDoc[0].CUERPO === largoDoc && jDoc[0].BIN === '0x' + 'AB'.repeat(70000) && jDoc[0].FECHA === '2024-03-31 02:30:00',
      JSON.stringify(eDoc)
    )
    const eNum = await ex.exportar({
      peticionId: 'exp-o-2',
      origen: { tipo: 'tabla', conexionId: 'c1', objeto: { esquema: USUARIO, nombre: NUM, tipo: 'tabla' }, orderBy: 'id' },
      formato: 'insert',
      nombreSugerido: NUM,
      tablaInsert: `"${NUM}"`,
      motor: 'oracle'
    })
    const insNum = eNum.ok && eNum.valor ? leer(eNum.valor.archivo).trim().split('\n') : []
    check('tabla -> INSERT: 1234 sentencias', eNum.ok && eNum.valor?.filas === 1234 && insNum.length === 1234 && insNum[0].startsWith(`INSERT INTO "${NUM}" (ID, ETIQUETA) VALUES (1, 'fila 1');`), `${insNum[0]} … ${insNum.length}`)
    const eCon = await ex.exportar({
      peticionId: 'exp-o-3',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: k1, sql: 'select level as n, rpad(\'x\', 5, \'y\') as t from dual connect by level <= 12345' },
      formato: 'csv',
      nombreSugerido: 'Resultado 1',
      motor: 'oracle'
    })
    const lCon = eCon.ok && eCon.valor ? leer(eCon.valor.archivo).split('\r\n') : []
    check(
      'consulta de 12 345 filas: 3 páginas del MISMO cursor, todas y en orden',
      eCon.ok && eCon.valor?.filas === 12345 && lCon[1] === '1,xyyyy' && lCon[12345] === '12345,xyyyy' && ex.estadoConsola(PERFIL, k1)?.fase === 'lista',
      JSON.stringify(eCon)
    )

    // --- (20b) Exportar una tabla, fuera del LRU de lectores de `datos` --------------------
    hr('(20b) exportar una tabla con su cursor en una sesión propia (nada lo expulsa)')
    {
      // Antes la exportación iba por `datos` y su cursor competía con el de cada pestaña en
      // los LRU de lectores (8): abrir la novena a media exportación lo expulsaba, y o fallaba
      // sin lector o seguía por el ROWNUM de respaldo con OTRA instantánea (un DELETE hecho
      // entretanto se notaba en el archivo). Ahora es UN cursor en su propia sesión.
      const EXP = `${PREFIJO}_EXP`
      await q(`CREATE TABLE ${EXP} (id NUMBER(10) PRIMARY KEY, v VARCHAR2(20))`)
      await q(`INSERT INTO ${EXP} SELECT LEVEL, 'fila ' || LEVEL FROM dual CONNECT BY LEVEL <= 12000`)
      const ids: string[] = []
      let paginas = 0
      let errExp: unknown = null
      let tras = ''
      const t0Exp = Date.now()
      try {
        await ex.gestor.exportarTabla(
          { conexionId: 'c1', peticionId: 'exp-lru', objeto: { esquema: USUARIO, nombre: EXP, dblink: null }, where: null, orderBy: 'id', pk: ['ID'], maxFilas: 5000 },
          async (pg) => {
            paginas++
            for (const f of filasJson(pg.filasJson)) ids.push(String(f[0]))
            if (paginas === 1) {
              // Nueve pestañas con más filas por leer (una más que el LRU) y, desde OTRA
              // sesión, un DELETE confirmado de filas que la exportación aún no ha leído.
              for (let i = 0; i < 9; i++) {
                await ex.abrirTabla({ conexionId: 'c1', peticionId: `lru-exp-${i}`, objeto: { esquema: USUARIO, nombre: NUM, tipo: 'tabla' }, maxFilas: 2 })
              }
              await q(`DELETE FROM ${EXP} WHERE id > 11000`)
              tras = String((await q(`SELECT COUNT(*) FROM ${EXP}`))[0]?.[0])
            }
          },
          () => false
        )
      } catch (err) {
        errExp = err instanceof Error ? err.message : String(err)
      }
      const distintos = new Set(ids).size
      check(
        'con 9 pestañas abiertas y 1000 filas borradas a media exportación: las 12 000 de la instantánea del principio, sin repetir ni saltar',
        errExp === null && paginas === 3 && ids.length === 12000 && distintos === 12000 && ids[0] === '1' && ids[11999] === '12000' && tras === '11000',
        JSON.stringify({ errExp, paginas, filas: ids.length, distintos, primera: ids[0], ultima: ids[ids.length - 1], tabla: tras, ms: Date.now() - t0Exp })
      )
      // Sus sesiones en el servidor, por MODULE/ACTION (null: sin permiso para v$session).
      const sesionesExportar = async (): Promise<number | null> => {
        try {
          const r = await q('SELECT COUNT(*) FROM v$session WHERE module = :m AND action = :a AND client_identifier = :c', {
            m: 'Tessera/explorador',
            a: 'exportar',
            c: `prueba@${base.alias}`
          })
          return Number(r[0]?.[0])
        } catch {
          return null
        }
      }
      let quedan = await sesionesExportar()
      for (let i = 0; i < 30 && quedan !== null && quedan > 0; i++) {
        await dormir(100)
        quedan = await sesionesExportar()
      }
      if (quedan === null) salta('la sesión de la exportación se cierra al acabar', `${USUARIO} no puede leer v$session`)
      else check('la sesión propia de la exportación se cerró al acabar', quedan === 0, `quedan=${quedan}`)
    }

    // --- (21) Esquema de la consola ------------------------------------------------------------------
    hr('(21) Esquema de la consola')
    const actual = async (consolaId: string): Promise<string> => {
      const r = await ejecutar("select sys_context('USERENV', 'CURRENT_SCHEMA') from dual", consolaId)
      return String(filasDe(r)[0]?.[0])
    }
    const fS = await ex.esquemaConsola(PERFIL, k1, 'SYSTEM')
    check('ALTER SESSION SET CURRENT_SCHEMA: el estado y la sesión dicen SYSTEM', fS.ok && fS.valor.esquema === 'SYSTEM' && (await actual(k1)) === 'SYSTEM', JSON.stringify(fS.ok ? fS.valor.esquema : fS))
    await ex.cerrarSesionConsola(PERFIL, k1)
    check('cerrar y reabrir: vuelve a SYSTEM', (await actual(k1)) === 'SYSTEM', 'SYSTEM')
    const fNull = await ex.esquemaConsola(PERFIL, k1, null)
    check('null: vuelve al esquema del usuario', fNull.ok && fNull.valor.esquema === USUARIO && (await actual(k1)) === USUARIO, JSON.stringify(fNull.ok ? fNull.valor.esquema : fNull))
    const fPub = await ex.esquemaConsola(PERFIL, k1, 'PUBLIC')
    check('PUBLIC (pseudo-esquema) se rechaza contra el catálogo', !fPub.ok, JSON.stringify(fPub))
    const fRo = await ex.esquemaConsola(PERFIL, kr, 'SYSTEM')
    check('en una conexión de solo lectura también', fRo.ok && (await actual(kr)) === 'SYSTEM', JSON.stringify(fRo.ok ? fRo.valor.esquema : fRo))
    // Degradar: el índice guarda un esquema que ya no existe (se escribe por detrás).
    await ex.consolas.fijarEsquema(PERFIL, k1, 'TESSERA_NO_EXISTE_X')
    await ex.listarConsolas(PERFIL)
    await ex.cerrarSesionConsola(PERFIL, k1)
    const rDeg = await ejecutar("select sys_context('USERENV', 'CURRENT_SCHEMA') from dual", k1)
    const avDeg = rDeg.ok && rDeg.valor.tipo === 'filas' ? (rDeg.valor.avisos ?? []) : []
    const lDeg = await ex.listarConsolas(PERFIL)
    check(
      'reabrir con un esquema que ya no existe (ORA-01435): el de la conexión, aviso y olvidado en el índice',
      String(filasDe(rDeg)[0]?.[0]) === USUARIO && avDeg.some((a) => /TESSERA_NO_EXISTE_X/.test(a)) && lDeg.ok && lDeg.valor.find((c) => c.id === k1)?.esquema === undefined,
      JSON.stringify({ avDeg, fila: filasDe(rDeg) })
    )

    // --- Parámetros y ejecución -----------------------------------------------------------------------
    hr('(22) Parámetros: por nombre, citados, rownum <= :n, EXEC, y el lector con sus binds')
    let nb = 0
    const conBinds = (sql: string, binds: Record<string, string | null> | undefined, consolaId = k1, maxFilas = 500): Promise<RespSentencia> =>
      ex.ejecutar({ perfilId: PERFIL, consolaId, ejecucionId: `b${++nb}`, sql, maxFilas, binds })
    const pb1 = await conBinds(`select nombre from ${CLI} where id = :id`, { ID: '2', SOBRA: 'x' })
    check(':id con la clave ID (sin distinguir caja); la que sobra no viaja', JSON.stringify(filasDe(pb1)) === '[["Bea"]]', resumen(pb1))
    const pb2 = await conBinds(`select nombre from ${CLI} where id = :"Id" and :"Id" = :id`, { Id: '1', ID: '1' })
    check(':"Id" citado es OTRO parámetro, exacto (viaja con sus comillas)', JSON.stringify(filasDe(pb2)) === '[["Ana"]]', resumen(pb2))
    const pb3 = await conBinds(`select id from ${NUM} where rownum <= :n`, { N: '3' })
    check('rownum <= :n con el valor como texto', filasDe(pb3).length === 3, resumen(pb3))
    const pb4 = await conBinds("select nvl(:x, 'era null'), to_char(to_date(:f) + 1, 'YYYY-MM-DD') from dual", { X: null, F: '2024-03-31 02:30:00' })
    check('NULL y una fecha con el NLS fijado', JSON.stringify(filasDe(pb4)) === '[["era null","2024-04-01"]]', resumen(pb4) + ' ' + JSON.stringify(filasDe(pb4)))
    const pb5 = await conBinds(`select * from ${CLI} where id = :id and nombre = :nom`, { ID: '1' })
    check('falta :nom: «parametros» sin enviar nada', !pb5.ok && pb5.error.motivo === 'parametros' && JSON.stringify(pb5.error.parametros) === '["NOM"]', resumen(pb5))
    if (!sinRutina) {
      const pb6 = await conBinds(`EXEC ${PRC}(:s)`, { S: '77' })
      const visto77 = await deMeta(`SELECT TO_CHAR(saldo) FROM ${CLI} WHERE id = 3`)
      check('EXEC p(:s) -> BEGIN p(:s); END; con su bind', esHecho(pb6) && visto77 === '77', `${resumen(pb6)} meta=${visto77}`)
    }
    const pb7 = await conBinds(`select id from ${NUM} where id > :d order by id`, { D: '0' })
    const lectorB = pb7.ok && pb7.valor.tipo === 'filas' ? pb7.valor.lector : null
    const cuentaB = lectorB ? await ex.contar(lectorB, 'cuenta-binds') : null
    check('Contar re-ejecuta con los MISMOS binds: 1234', cuentaB?.ok === true && cuentaB.valor === 1234, JSON.stringify(cuentaB))
    // El cursor vivo se pierde (como tras una expulsión del LRU): el respaldo re-ejecuta con los binds.
    const procDeC1 = procesoDe.get('c1')
    if (lectorB && procDeC1) await procDeC1.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: `consola:${k1}`, lector: lectorB }).catch(() => undefined)
    const masB = lectorB ? await ex.leerMas(lectorB, 500) : null
    const fmB = masB?.ok ? filasJson(masB.valor.filasJson) : []
    check('«más» sin cursor: re-ejecuta con los binds (501…1000)', masB?.ok === true && masB.valor.reejecutada === true && fmB[0]?.[0] === '501', JSON.stringify(masB?.ok ? { re: masB.valor.reejecutada, primera: fmB[0] } : masB))
    const expB = await ex.exportar({
      peticionId: 'exp-o-binds',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: k1, sql: `select id from ${NUM} where id <= :tope order by id`, binds: { TOPE: '700' } },
      formato: 'csv',
      nombreSugerido: 'con_binds',
      motor: 'oracle'
    })
    check('exportar la consulta con sus binds: 700 filas', expB.ok && expB.valor?.filas === 700, JSON.stringify(expB))

    hr('(23) Explain en SOLO LECTURA: EXPLAIN PLAN sin candado, se revierte, no ejecuta')
    // (21) dejó esta consola en SYSTEM: vuelve al esquema del usuario, donde están las tablas.
    await ex.esquemaConsola(PERFIL, kr, null)
    let npl = 0
    const explicarO = (sql: string, consolaId: string, binds?: Record<string, string | null>): ReturnType<ExploradorController['explicar']> =>
      ex.explicar({ perfilId: PERFIL, consolaId, ejecucionId: `p${++npl}`, sql, ...(binds ? { binds } : {}) })
    const pRo = await explicarO(`select c.nombre, p.total from ${CLI} c join ${PED} p on p.cli_id = c.id where c.id = :id`, kr, { ID: '1' })
    check(
      'RO: el plan con sus nodos (raíz sin padre, las dos tablas) y el texto de DBMS_XPLAN',
      pRo.ok && pRo.valor.nodos[0]?.padre === null && pRo.valor.nodos.some((x) => (x.objeto ?? '').endsWith(`.${CLI}`) || (x.objeto ?? '').includes(`${CLI}_PK`)) && /Plan hash value/.test(pRo.valor.texto),
      pRo.ok ? `${pRo.valor.nodos.map((x) => `${x.operacion} ${x.opciones ?? ''} ${x.objeto ?? ''}`).join(' | ')} (${pRo.valor.tiempos.totalMs} ms)` : JSON.stringify(pRo)
    )
    check('con parámetros: el aviso de que Oracle no mira sus valores', pRo.ok && (pRo.valor.avisos ?? []).some((a) => /bind peeking/.test(a)), JSON.stringify(pRo.ok ? pRo.valor.avisos : pRo))
    const estRoPlan = ex.estadoConsola(PERFIL, kr)
    const sqlRestos = "select count(*) from plan_table where statement_id like 'TESSERA\\_%' escape '\\'"
    const restos = await ejecutar(sqlRestos, kr)
    let nRestos = JSON.stringify(filasDe(restos))
    // La 11.2 no deja leer PLAN_TABLE (una temporal) DENTRO del SET TRANSACTION READ ONLY
    // del candado tras un Explain: ORA-01466 (medido; la 21c sí). Solo se ve si alguien
    // la consulta a mano. Se cuenta entonces por debajo, sin candado, en la misma sesión.
    if (errorDe(restos)?.codigo === 'ORA-01466' && procesoDe.get('ro')) {
      const pr = procesoDe.get('ro') as ProcesoTrabajador
      // Fuera de la transacción READ ONLY que dejó el candado de la consulta anterior.
      await pr.enviar<'tx'>({ op: 'tx', sesion: `consola:${kr}`, accion: 'rollback' })
      const r = await pr.enviar<'ejecutar'>({
        op: 'ejecutar',
        sesion: `consola:${kr}`,
        sql: sqlRestos,
        opciones: { proposito: 'catalogo', maxFilas: 1, candadoRO: false, txManual: true, comprobarTx: false }
      })
      await pr.enviar<'tx'>({ op: 'tx', sesion: `consola:${kr}`, accion: 'rollback' })
      nRestos = r.tipo === 'filas' ? `${r.filasJson} (sin candado: la 11.2 da ORA-01466 dentro de él)` : 'sin filas'
    }
    check(
      'RO: la consola sin transacción y las filas de PLAN_TABLE revertidas (en SU sesión: 0)',
      estRoPlan?.tx === 'ninguna' && (nRestos === '[["0"]]' || nRestos.startsWith('[[0]]') || nRestos.startsWith('[["0"]]')),
      `tx=${estRoPlan?.tx} plan_table=${nRestos}`
    )
    const nAntesRo = (await q(`SELECT COUNT(*) FROM ${CLI}`))[0]?.[0]
    const pRoDel = await explicarO(`delete from ${CLI}`, kr)
    const nTrasRo = (await q(`SELECT COUNT(*) FROM ${CLI}`))[0]?.[0]
    check('RO: un DELETE se explica y NO se ejecuta', pRoDel.ok && String(nAntesRo) === String(nTrasRo) && pRoDel.valor.nodos[0]?.operacion === 'DELETE STATEMENT', `${String(nAntesRo)} -> ${String(nTrasRo)} ${pRoDel.ok ? pRoDel.valor.nodos[0]?.operacion : JSON.stringify(pRoDel)}`)
    const pErr = await explicarO(`select nada_de_nada from ${CLI}`, kr)
    check('error del servidor: ok:false con la posición en la SENTENCIA (7)', !pErr.ok && pErr.error.codigo === 'ORA-00904' && pErr.error.posicion === 7, JSON.stringify(pErr))
    const trasRo = await ejecutar(`select count(*) from ${CLI}`, kr)
    const procRo2 = procesoDe.get('ro')
    let colado2 = false
    let rechazo2: ErrorTrabajador | null = null
    if (procRo2) {
      try {
        await procRo2.enviar<'ejecutar'>({
          op: 'ejecutar',
          sesion: `consola:${kr}`,
          sql: `insert into ${CLI} (id, nombre) values (98, 'escape')`,
          opciones: { proposito: 'usuario', maxFilas: 1, candadoRO: true, esDml: true }
        })
        colado2 = true
      } catch (e) {
        if (esFalloTrabajador(e)) rechazo2 = e.error
      }
      if (colado2) await procRo2.enviar<'tx'>({ op: 'tx', sesion: `consola:${kr}`, accion: 'rollback' }).catch(() => undefined)
    }
    check(
      'tras los Explain, el candado sigue: la consulta pasa y un INSERT directo da ORA-01456',
      filasDe(trasRo).length === 1 && !colado2 && rechazo2?.codigo === 'ORA-01456',
      `${resumen(trasRo)} ${colado2 ? '¡el INSERT pasó!' : JSON.stringify(rechazo2)}`
    )

    hr('(24) Explain en ESCRITURA: nunca revierte la transacción del usuario')
    const trasAutoN = async (): Promise<string> => {
      const r = await ejecutar("select count(*) from plan_table where statement_id like 'TESSERA\\_%' escape '\\'")
      return String(filasDe(r)[0]?.[0])
    }
    const pAuto = await explicarO(`select * from ${CLI} where id = 1`, k1)
    const enPlanAuto = await trasAutoN()
    check(
      'Auto sin transacción: el plan sale, la consola sigue sin transacción y sus filas se quedan en la temporal de la sesión',
      pAuto.ok && ex.estadoConsola(PERFIL, k1)?.tx === 'ninguna' && Number(enPlanAuto) > 0,
      `tx=${ex.estadoConsola(PERFIL, k1)?.tx} filas en PLAN_TABLE=${enPlanAuto}`
    )
    await ex.modoTx(PERFIL, k1, 'manual')
    await ejecutar(`update ${CLI} set nombre = 'Zoe' where id = 3`)
    const pMan = await explicarO(`update ${CLI} set nombre = 'Otro' where id = 3`, k1)
    const estMan = ex.estadoConsola(PERFIL, k1)
    const enSesion = await ejecutar(`select nombre from ${CLI} where id = 3`)
    const enMeta = await deMeta(`SELECT nombre FROM ${CLI} WHERE id = 3`)
    check(
      'Manual con un UPDATE pendiente: el Explain NO lo revierte (la sesión sigue viendo «Zoe», pendiente) y no lo confirma (la meta no lo ve)',
      pMan.ok && estMan?.tx === 'pendiente' && JSON.stringify(filasDe(enSesion)) === '[["Zoe"]]' && enMeta !== 'Zoe',
      JSON.stringify({ ok: pMan.ok, tx: estMan?.tx, sesion: filasDe(enSesion), meta: enMeta })
    )
    const vuelta = await ex.modoTx(PERFIL, k1, 'auto', 'rollback')
    const trasVuelta = await deMeta(`SELECT nombre FROM ${CLI} WHERE id = 3`)
    check('el Rollback del usuario deshace su UPDATE (el Explain no lo tocó)', vuelta.ok && vuelta.valor.tx === 'ninguna' && trasVuelta === 'Cai', `meta=${trasVuelta}`)

    hr('(25) Claves ajenas: salientes, entrantes y lo que tarda (tres consultas cortas; RULE solo en las entrantes de la 11g)')
    const t0Fk = Date.now()
    const fkCli = await ex.fks('c1', { esquema: USUARIO, nombre: CLI, tipo: 'tabla' })
    const msFk = Date.now() - t0Fk
    const entCli = fkCli.ok ? fkCli.valor.entrantes : []
    check(
      `${CLI}: entra ${PED}(CLI_ID) -> ID, y no sale ninguna`,
      fkCli.ok && fkCli.valor.salientes.length === 0 && entCli.length === 1 && entCli[0].nombre === `${PED}_FK` && JSON.stringify(entCli[0].desde.columnas) === '["CLI_ID"]' && JSON.stringify(entCli[0].hacia.columnas) === '["ID"]' && entCli[0].hacia.tabla === CLI,
      `${JSON.stringify(fkCli)} (${msFk} ms en Oracle ${mayor})`
    )
    const fkPed = await ex.fks('c1', { esquema: USUARIO, nombre: PED, tipo: 'tabla' })
    check(`${PED}: sale a ${CLI}`, fkPed.ok && fkPed.valor.salientes.length === 1 && fkPed.valor.salientes[0].hacia.tabla === CLI && fkPed.valor.entrantes.length === 0, JSON.stringify(fkPed))
    check(`lo que tarda la primera vez (tres consultas cortas en el mismo turno de meta${mayor < 12 ? '; RULE solo en las entrantes' : ''})`, msFk < 5000, `${msFk} ms`)

    hr('(27) editar la rejilla (PK, ROWID, CLOB de más de 4000 bytes, todo o nada, Stop)')
    {
      const E1 = `${PREFIJO}_E1`
      const E2 = `${PREFIJO}_E2`
      const E3 = `${PREFIJO}_E3`
      const E4 = `${PREFIJO}_E4`
      const E5 = `${PREFIJO}_E5`
      await q(
        `CREATE TABLE ${E1} (id NUMBER(10) PRIMARY KEY, nombre VARCHAR2(40 CHAR), doc CLOB, ` +
          'doble NUMBER GENERATED ALWAYS AS (id * 2) VIRTUAL, foto BLOB)'
      )
      for (const [id, nombre] of [[1, 'Ana'], [2, 'Bea'], [3, 'Cai']] as const) await q(`INSERT INTO ${E1} (id, nombre) VALUES (${id}, '${nombre}')`)
      await q(`CREATE TABLE ${E2} (x NUMBER, y VARCHAR2(20))`)
      for (const [x, y] of [[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e']] as const) await q(`INSERT INTO ${E2} VALUES (${x}, '${y}')`)
      await q(`CREATE TABLE ${E3} (id NUMBER(10) PRIMARY KEY, e1_id NUMBER(10) NOT NULL REFERENCES ${E1} (id))`)
      await q(`CREATE TABLE ${E4} (guid RAW(16) PRIMARY KEY, v VARCHAR2(20))`)
      await q(`INSERT INTO ${E4} VALUES (HEXTORAW('0A0B0C'), 'antes')`)
      if (mayor >= 12) await q(`CREATE TABLE ${E5} (n NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, v VARCHAR2(10))`)
      const E6 = `${PREFIJO}_E6`
      await q(`CREATE GLOBAL TEMPORARY TABLE ${E6} (id NUMBER(10) PRIMARY KEY, v VARCHAR2(10)) ON COMMIT PRESERVE ROWS`)
      conexiones.mapa.set('prod', { ...base, id: 'prod', alias: `${base.alias}-PROD`, entorno: 'produccion' })
      conexiones.secretos.set('prod', dst.clave)
      let nPet = 0
      const ref = (nombre: string): { esquema: string; nombre: string; tipo: 'tabla' } => ({ esquema: USUARIO, nombre, tipo: 'tabla' })
      const abrirEd = (nombre: string, extra: Record<string, unknown> = {}, con = 'c1'): ReturnType<ExploradorController['abrirTabla']> =>
        ex.abrirTabla({ conexionId: con, peticionId: `ed${++nPet}`, objeto: ref(nombre), maxFilas: 500, ...extra })
      const enviar = (nombre: string, identidad: unknown, cambios: unknown[], extra: Record<string, unknown> = {}): ReturnType<ExploradorController['enviarCambios']> =>
        ex.enviarCambios({ conexionId: 'c1', peticionId: `env${++nPet}`, objeto: ref(nombre), identidad, cambios, ...extra })
      const filasT = (t: Awaited<ReturnType<ExploradorController['abrirTabla']>>): Array<Array<string | null>> =>
        t.ok && t.valor.resultado.tipo === 'filas' ? (filasJson(t.valor.resultado.pagina.filasJson) as Array<Array<string | null>>) : []
      const PK_ID = { tipo: 'pk', columnas: ['ID'] }
      const ROWID = { tipo: 'rowid', columna: '__TESSERA_ROWID' }

      // --- Identidad al abrir ---
      const t1 = await abrirEd(E1)
      const noEd = t1.ok ? (t1.valor.noEditables ?? []).map((x) => x.columna).sort() : []
      check('con PK: identidad pk [ID], sin columna oculta', t1.ok && JSON.stringify(t1.valor.identidad) === JSON.stringify(PK_ID) && filasT(t1)[0]?.length === 5, JSON.stringify(t1.ok ? t1.valor.identidad : t1))
      check('no editables: la VIRTUAL y el BLOB (el CLOB sí se edita)', JSON.stringify(noEd) === JSON.stringify(['DOBLE', 'FOTO']), JSON.stringify(t1.ok ? t1.valor.noEditables : null))
      const t2 = await abrirEd(E2, { orderBy: 'x' })
      const f2 = filasT(t2)
      const cols2 = t2.ok && t2.valor.resultado.tipo === 'filas' ? t2.valor.resultado.columnas.map((c) => c.nombre) : []
      check(
        'sin PK: identidad ROWID y la columna OCULTA la última, con el ROWID como texto',
        t2.ok && JSON.stringify(t2.valor.identidad) === JSON.stringify(ROWID) && JSON.stringify(cols2) === JSON.stringify(['X', 'Y', '__TESSERA_ROWID']) && f2.length === 5 && f2.every((f) => typeof f[2] === 'string' && (f[2] as string).length >= 18),
        JSON.stringify({ identidad: t2.ok ? t2.valor.identidad : t2, cols2, primera: f2[0] })
      )
      const tCalif = await abrirEd(E2, { where: `${USUARIO}.${E2}.X >= 2 AND ${E2}.Y <> 'z'`, orderBy: `${E2}.X` })
      check(
        'un WHERE y un ORDER BY calificados por el NOMBRE de la tabla siguen funcionando (no hay alias)',
        tCalif.ok && tCalif.valor.resultado.tipo === 'filas' && filasT(tCalif).length === 4,
        JSON.stringify(tCalif.ok ? (tCalif.valor.resultado.tipo === 'filas' ? filasT(tCalif).length : tCalif.valor.resultado) : tCalif)
      )
      // El ROWNUM de respaldo conserva la columna oculta (un cursor expulsado a media lectura).
      const tPag = await abrirEd(E2, { orderBy: 'x', maxFilas: 2 })
      const lectorPag = tPag.ok && tPag.valor.resultado.tipo === 'filas' ? (tPag.valor.resultado.lector ?? '') : ''
      const procC1Ed = procesoDe.get('c1')
      if (procC1Ed && lectorPag) await procC1Ed.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: 'datos', lector: lectorPag }).catch(() => undefined)
      const pRown = lectorPag ? await ex.leerMas(lectorPag, 2) : null
      const gRown = pRown && pRown.ok ? filasJson(pRown.valor.filasJson) : []
      check(
        'respaldo ROWNUM: la página re-ejecutada trae el ROWID oculto el último (y sin "__TESSERA_RN")',
        pRown !== null && pRown.ok && pRown.valor.reejecutada === true && gRown.length === 2 && gRown[0]?.length === 3 && gRown[0]?.[2] === f2[2]?.[2],
        JSON.stringify(pRown && pRown.ok ? { re: pRown.valor.reejecutada, filas: gRown } : pRown)
      )
      if (lectorPag) await ex.cerrarLector(lectorPag)
      const t6 = await abrirEd(E6)
      check(
        'una tabla TEMPORAL (GTT), aunque tenga PK: ninguna (sus filas son de cada sesión) y se abre igual',
        t6.ok && t6.valor.identidad?.tipo === 'ninguna' && /temporal/.test(t6.valor.identidad.motivo) && t6.valor.resultado.tipo === 'filas',
        JSON.stringify(t6.ok ? t6.valor.identidad : t6)
      )
      // Una tabla EXTERNA sin PK: con ROWID, `SELECT t.*, ROWID` da ORA-01410 (medido en la
      // 21c) y la pestaña no se abriría. Hace falta un DIRECTORY legible, que solo crea un
      // DBA: sin él, se salta. El archivo puede no existir: lo que se comprueba es que el
      // SELECT no lleva el ROWID (un KUP-04040 del archivo es otra cosa).
      const dirExt = await q("SELECT directory_name FROM all_directories WHERE directory_name = 'TESSERA_EXT_DIR'")
      if (dirExt.length === 0) {
        salta('tabla externa', 'no hay un DIRECTORY TESSERA_EXT_DIR legible (lo crea un DBA: CREATE DIRECTORY … y GRANT READ)')
      } else {
        const E7 = `${PREFIJO}_E7`
        const archivo = `${E7.toLowerCase()}.csv`
        await q(
          `CREATE TABLE ${E7} (a VARCHAR2(10)) ORGANIZATION EXTERNAL (TYPE ORACLE_LOADER DEFAULT DIRECTORY TESSERA_EXT_DIR ` +
            `ACCESS PARAMETERS (RECORDS DELIMITED BY NEWLINE NOBADFILE NOLOGFILE FIELDS TERMINATED BY ',') LOCATION ('${archivo}'))`
        )
        // El archivo, escrito DESDE el servidor (UTL_FILE): sin él la lectura falla antes
        // (KUP-04040) con o sin ROWID, y no se distinguiría nada.
        let conArchivo = true
        try {
          await q(
            `DECLARE f UTL_FILE.FILE_TYPE; BEGIN f := UTL_FILE.FOPEN('TESSERA_EXT_DIR', '${archivo}', 'w'); ` +
              "UTL_FILE.PUT_LINE(f, 'uno'); UTL_FILE.FCLOSE(f); END;"
          )
        } catch {
          conArchivo = false
        }
        const t7 = await abrirEd(E7)
        const f7 = filasT(t7)
        const err7 = t7.ok && t7.valor.resultado.tipo === 'error' ? t7.valor.resultado.error : null
        check(
          `una tabla EXTERNA sin PK: ninguna${conArchivo ? ', y se LEE (el SELECT va sin el ROWID, que daría ORA-01410)' : ' (sin UTL_FILE no hay archivo que leer)'}`,
          t7.ok && t7.valor.identidad?.tipo === 'ninguna' && /externa/.test(t7.valor.identidad.motivo) && (!conArchivo || JSON.stringify(f7) === '[["uno"]]'),
          JSON.stringify({ identidad: t7.ok ? t7.valor.identidad : t7, filas: f7, error: err7?.codigo ?? null, conArchivo })
        )
        if (conArchivo) {
          try {
            await q(`BEGIN UTL_FILE.FREMOVE('TESSERA_EXT_DIR', '${archivo}'); END;`)
          } catch {
            // se queda en el /tmp del servidor de pruebas
          }
        }
      }

      // --- Enviar por ROWID: editar, borrar e insertar ---
      const rowidDe = (x: string): string | null => f2.find((f) => f[0] === x)?.[2] ?? null
      const r1 = await enviar(E2, ROWID, [
        { tipo: 'actualizar', clave: [rowidDe('1')], valores: { Y: 'A' } },
        { tipo: 'borrar', clave: [rowidDe('2')] },
        { tipo: 'insertar', valores: { X: '6', Y: 'f' } }
      ])
      const e2Tras = (await q(`SELECT x || ':' || y FROM ${E2} ORDER BY x`)).map((f) => String(f[0])).join(',')
      check('por ROWID: editar + borrar + insertar, hecho', r1.ok && r1.valor.tipo === 'hecho' && r1.valor.cambios === 3 && e2Tras === '1:A,3:c,4:d,5:e,6:f', JSON.stringify({ r1, e2Tras }))
      const t2b = await abrirEd(E2, { orderBy: 'x' })
      check('tras el COMMIT, volver a pedir la página ve lo nuevo', filasT(t2b).map((f) => f[1]).join(',') === 'A,c,d,e,f', JSON.stringify(filasT(t2b).map((f) => f[1])))
      // la apertura relee la edición si la página trae una columna que la
      // caché no conoce. La del ROWID NO cuenta: si contara, cada apertura de una tabla
      // sin PK volvería al catálogo (4 aperturas de E2 hasta aquí, y el «Enviar»).
      const edicionE2 = consultasEdicion.filter((t) => t === E2).length
      check('NEGATIVO: abrir E2 (ROWID) cuatro veces pregunta al catálogo de edición UNA', edicionE2 === 1, `consultas=${edicionE2}`)
      const rViejo = await enviar(E2, ROWID, [{ tipo: 'actualizar', clave: [rowidDe('2')], valores: { Y: 'fantasma' } }])
      check('el ROWID de una fila borrada: 0 filas, revertido', rViejo.ok && rViejo.valor.tipo === 'error' && rViejo.valor.filas === 0, JSON.stringify(rViejo))

      // --- CLOB de más de 4000 bytes (y de más de 32 KiB), por su bind de LOB ---
      const medio = 'ñ'.repeat(3000) + 'FIN' // 6003 bytes en AL32UTF8
      const grande = 'x'.repeat(40000) + 'FIN' // más de 32767: tampoco cabría como VARCHAR2 de PL/SQL
      // Lo que haría un bind de texto a secas (sin el de LOB), medido con el observador:
      // queda en la salida como dato, no como comprobación (depende del driver y del modo).
      // El tercero es la forma de «Enviar» con más de una celda: el texto largo DELANTE de
      // otros binds (lo que en OCI puede dar ORA-24816).
      const medir: Array<[string, string, Record<string, string>]> = [
        ['6003 bytes', `UPDATE ${E1} SET doc = :d WHERE id = 3`, { d: medio }],
        ['40 003 caracteres', `UPDATE ${E1} SET doc = :d WHERE id = 3`, { d: grande }],
        ['6003 bytes seguidos de otro bind', `UPDATE ${E1} SET doc = :d, nombre = :n WHERE id = :i`, { d: medio, n: 'x', i: '3' }]
      ]
      for (const [que, sql, binds] of medir) {
        let medido = 'ok'
        try {
          await obs.execute(sql, binds, { autoCommit: false })
        } catch (err) {
          medido = codigoDe(err) || mensajeDe(err).slice(0, 80)
        }
        await obs.rollback()
        console.log(`  [MEDIDO] ${que} como texto a secas (VARCHAR) hacia un CLOB, desde el observador (${observadorThick ? 'thick' : 'thin'}): ${medido}`)
      }
      const rClob = await enviar(E1, PK_ID, [
        { tipo: 'actualizar', clave: ['1'], valores: { DOC: medio, NOMBRE: 'Ana' } },
        { tipo: 'insertar', valores: { ID: '4', DOC: grande, NOMBRE: 'Dan' } }
      ])
      const longitudes = (await q(`SELECT id || ':' || DBMS_LOB.GETLENGTH(doc) || ':' || DBMS_LOB.SUBSTR(doc, 3, DBMS_LOB.GETLENGTH(doc) - 2) FROM ${E1} WHERE id IN (1, 4) ORDER BY id`)).map((f) => String(f[0])).join(',')
      check(
        'CLOB: 6003 bytes y 40 003 caracteres llegan ENTEROS por el bind de LOB',
        rClob.ok && rClob.valor.tipo === 'hecho' && longitudes === `1:${medio.length}:FIN,4:${grande.length}:FIN`,
        JSON.stringify({ r: rClob, longitudes, drv: drv?.modo })
      )
      const rVacio = await enviar(E1, PK_ID, [{ tipo: 'actualizar', clave: ['1'], valores: { DOC: '' } }])
      const docNulo = String((await q(`SELECT CASE WHEN doc IS NULL THEN 'NULL' ELSE TO_CHAR(DBMS_LOB.GETLENGTH(doc)) END FROM ${E1} WHERE id = 1`))[0]?.[0])
      check("'' hacia un CLOB queda NULL, como en un VARCHAR2 de Oracle (no un CLOB vacío)", rVacio.ok && rVacio.valor.tipo === 'hecho' && docNulo === 'NULL', JSON.stringify({ rVacio, docNulo }))

      // --- Todo o nada: el 2.º viola la FK y el 1.º NO queda ---
      const r2 = await enviar(E3, PK_ID, [
        { tipo: 'insertar', valores: { ID: '1', E1_ID: '1' } },
        { tipo: 'insertar', valores: { ID: '2', E1_ID: '999' } }
      ])
      const nE3 = Number((await q(`SELECT COUNT(*) FROM ${E3}`))[0]?.[0])
      check('el 2.º viola la FK (ORA-02291): índice 1, y el 1.º NO se aplicó', r2.ok && r2.valor.tipo === 'error' && r2.valor.indice === 1 && r2.valor.error.codigo === 'ORA-02291' && nE3 === 0, JSON.stringify({ r2, nE3 }))
      const r3 = await enviar(E1, PK_ID, [
        { tipo: 'actualizar', clave: ['2'], valores: { NOMBRE: 'no debe quedar' } },
        { tipo: 'actualizar', clave: ['999'], valores: { NOMBRE: 'no existe' } }
      ])
      const nombre2 = String((await q(`SELECT nombre FROM ${E1} WHERE id = 2`))[0]?.[0])
      check('una clave que ya no está: 0 filas en el índice 1 y el 1.º revertido', r3.ok && r3.valor.tipo === 'error' && r3.valor.indice === 1 && r3.valor.filas === 0 && nombre2 === 'Bea', JSON.stringify({ r3, nombre2 }))

      // --- Clave RAW tal como la pinta la rejilla, e identidad ALWAYS ---
      const t4 = await abrirEd(E4)
      const guid = filasT(t4)[0]?.[0] ?? ''
      const r4 = await enviar(E4, { tipo: 'pk', columnas: ['GUID'] }, [{ tipo: 'actualizar', clave: [guid], valores: { V: 'después' } }])
      const v4 = String((await q(`SELECT v FROM ${E4}`))[0]?.[0])
      check('clave RAW (0x… de la rejilla): encuentra su fila', guid === '0x0A0B0C' && r4.ok && r4.valor.tipo === 'hecho' && v4 === 'después', JSON.stringify({ guid, r4, v4 }))
      if (mayor >= 12) {
        const t5 = await abrirEd(E5)
        const noEd5 = t5.ok ? (t5.valor.noEditables ?? []).map((x) => x.columna) : []
        const r5 = await enviar(E5, { tipo: 'pk', columnas: ['N'] }, [{ tipo: 'insertar', valores: { V: 'nuevo' } }])
        const r5mal = await enviar(E5, { tipo: 'pk', columnas: ['N'] }, [{ tipo: 'insertar', valores: { N: '7', V: 'x' } }])
        check(
          'identidad GENERATED ALWAYS: no editable, y el INSERT sin ella la numera',
          JSON.stringify(noEd5) === '["N"]' && r5.ok && r5.valor.tipo === 'hecho' && !r5mal.ok && /no se puede editar/.test(r5mal.error.mensaje),
          JSON.stringify({ noEd5, r5, r5mal })
        )
      } else salta('identidad GENERATED ALWAYS', `Oracle ${mayor}: las identidades llegan en la 12.1`)

      // --- Solo lectura y producción: rechazados sin enviar ---
      // ORA-01466 (medido en 21c): una transacción READ ONLY —el candado de cada sentencia
      // en solo lectura— no puede leer una tabla creada hace un par de segundos (la
      // correspondencia SCN-tiempo es gruesa). Pasa igual con cualquier
      // tabla recién creada. Se reintenta unos segundos.
      let tRo = await abrirEd(E2, {}, 'ro')
      let reintentosRo = 0
      while (reintentosRo < 6 && tRo.ok && tRo.valor.resultado.tipo === 'error' && tRo.valor.resultado.error.codigo === 'ORA-01466') {
        reintentosRo++
        await dormir(1500)
        tRo = await abrirEd(E2, {}, 'ro')
      }
      if (reintentosRo > 0) console.log(`  [MEDIDO] ORA-01466 al leer en solo lectura una tabla recién creada: ${reintentosRo} reintento(s) de 1,5 s`)
      const colsRo = tRo.ok && tRo.valor.resultado.tipo === 'filas' ? tRo.valor.resultado.columnas.length : -1
      check(
        'solo lectura: identidad ninguna y SIN la columna del ROWID',
        tRo.ok && tRo.valor.identidad?.tipo === 'ninguna' && colsRo === 2,
        JSON.stringify({ identidad: tRo.ok ? tRo.valor.identidad : tRo, colsRo, resultado: tRo.ok && tRo.valor.resultado.tipo === 'error' ? tRo.valor.resultado.error : undefined })
      )
      const rRo = await ex.enviarCambios({ conexionId: 'ro', peticionId: 'ro1', objeto: ref(E1), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { NOMBRE: 'RO' } }] })
      check("«Enviar» en solo lectura: 'soloLectura'", !rRo.ok && rRo.error.motivo === 'soloLectura', JSON.stringify(rRo))
      const rProd = await ex.enviarCambios({ conexionId: 'prod', peticionId: 'pr1', objeto: ref(E1), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { NOMBRE: 'PROD' } }] })
      const rProdOk = await ex.enviarCambios({ conexionId: 'prod', peticionId: 'pr2', objeto: ref(E1), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { NOMBRE: 'PROD' } }], confirmado: true })
      const nombre1 = String((await q(`SELECT nombre FROM ${E1} WHERE id = 1`))[0]?.[0])
      check("producción: sin confirmar 'produccion'; con confirmado, aplicado", !rProd.ok && rProd.error.motivo === 'produccion' && rProdOk.ok && rProdOk.valor.tipo === 'hecho' && nombre1 === 'PROD', JSON.stringify({ rProd, rProdOk, nombre1 }))

      // --- Stop de un envío bloqueado por otra sesión ---
      await obs.execute(`SELECT id FROM ${E1} WHERE id = 1 FOR UPDATE`, [], { autoCommit: false })
      const soltarE = setTimeout(() => {
        obs.rollback().catch(() => {})
      }, mayor >= 12 ? 4000 : 12_000)
      const t0Stop = Date.now()
      try {
        const enVuelo = ex.enviarCambios({
          conexionId: 'c1',
          peticionId: 'stop-ora',
          objeto: ref(E1),
          identidad: PK_ID,
          cambios: [
            { tipo: 'actualizar', clave: ['3'], valores: { NOMBRE: 'no debe quedar' } },
            { tipo: 'actualizar', clave: ['1'], valores: { NOMBRE: 'espera' } }
          ]
        })
        await dormir(1200)
        ex.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'stop-ora' })
        const rStop = await conPlazo(enVuelo, 20_000)
        const dt = Date.now() - t0Stop
        const nombre3 = String((await q(`SELECT nombre FROM ${E1} WHERE id = 3`))[0]?.[0])
        // Índice 0: las filas se bloquean POR LOTES antes de
        // ningún DML, así que el Stop cae esperando el candado del lote, cuyo primer cambio es
        // el 0 (antes esperaba el de la fila del 2.º, justo antes de su UPDATE). Un Stop no
        // señala fila en la rejilla (`estadoTrasFallo`: «Envío detenido»).
        check(
          `Stop de un envío que espera un bloqueo: cancelado en el índice 0, sin tocar nada${mayor >= 12 ? ' (la 12+ lo atiende al soltarse la fila)' : ' (ORA-01013)'}`,
          rStop !== null && rStop.ok && rStop.valor.tipo === 'error' && rStop.valor.indice === 0 && rStop.valor.error.motivo === 'cancelada' && nombre3 === 'Cai' && dt < (mayor >= 12 ? 15_000 : 8000),
          JSON.stringify({ rStop, dt, nombre3, modo: drv?.modo })
        )
      } finally {
        clearTimeout(soltarE)
        await obs.rollback()
      }

      // --- un ALTER hecho FUERA de Tessera no deja la edición atascada ---
      // La caché de edición no caduca por tiempo (un DDL de Tessera la invalida; uno de
      // fuera, no). Antes, «Enviar» rechazaba la columna nueva con «vuelve a abrirla» y
      // reabrir leía la MISMA lista vieja. Con ROWID: la identidad y la columna oculta
      // siguen siendo las de la página que se devuelve.
      const E8 = `${PREFIJO}_E8`
      await q(`CREATE TABLE ${E8} (x NUMBER, y VARCHAR2(10))`)
      await q(`INSERT INTO ${E8} VALUES (1, 'uno')`)
      await abrirEd(E8)
      const nEd8 = consultasEdicion.filter((t) => t === E8).length
      await q(`ALTER TABLE ${E8} ADD (z VARCHAR2(10))`)
      const t8 = await abrirEd(E8)
      const cols8 = t8.ok && t8.valor.resultado.tipo === 'filas' ? t8.valor.resultado.columnas.map((c) => c.nombre) : []
      const rowid8 = filasT(t8)[0]?.[3] ?? null
      check(
        'tras un ALTER de FUERA, reabrir trae Z (con el ROWID oculto el último) y relee la edición UNA vez',
        JSON.stringify(cols8) === JSON.stringify(['X', 'Y', 'Z', '__TESSERA_ROWID']) &&
          t8.ok &&
          JSON.stringify(t8.valor.identidad) === JSON.stringify(ROWID) &&
          consultasEdicion.filter((t) => t === E8).length === nEd8 + 1,
        JSON.stringify({ cols8, identidad: t8.ok ? t8.valor.identidad : t8, relecturas: consultasEdicion.filter((t) => t === E8).length - nEd8 })
      )
      const r8 = await enviar(E8, ROWID, [{ tipo: 'actualizar', clave: [rowid8], valores: { Z: 'nueva' } }])
      const z8 = String((await q(`SELECT z FROM ${E8} WHERE x = 1`))[0]?.[0])
      check(
        '«Enviar» por ROWID escribe la columna nueva (antes: «no existe… vuelve a abrirla»)',
        r8.ok && r8.valor.tipo === 'hecho' && z8 === 'nueva',
        JSON.stringify({ r8, z8 })
      )

      // --- «Enviar» espera un BLOQUEO con tope (SELECT … FOR UPDATE WAIT 10) ---
      // Lo típico: una consola del propio usuario con un UPDATE sin confirmar de la misma
      // fila. Antes esperaba sin plazo, y en la 12c+ el Stop no lo cortaba.
      const kb = await ex.crearConsola(PERFIL, 'c1')
      const KB = kb.ok ? kb.valor.id : ''
      await ex.modoTx(PERFIL, KB, 'manual')
      const nombreDe = async (id: number): Promise<string> => String((await q(`SELECT nombre FROM ${E1} WHERE id = ${id}`))[0]?.[0])
      const antes3 = await nombreDe(3)
      const upKb = await ex.ejecutar({ perfilId: PERFIL, consolaId: KB, ejecucionId: 'kb1', sql: `update ${E1} set nombre = 'de la consola' where id = 2`, maxFilas: 10 })
      check('una consola con un UPDATE sin confirmar de la fila 2', upKb.ok && ex.estadoConsola(PERFIL, KB)?.tx === 'pendiente', JSON.stringify(upKb.ok ? ex.estadoConsola(PERFIL, KB)?.tx : upKb))
      const tBloq = Date.now()
      const rBloq = await conPlazo(
        enviar(E1, PK_ID, [
          { tipo: 'actualizar', clave: ['3'], valores: { NOMBRE: 'no debe quedar' } },
          { tipo: 'actualizar', clave: ['2'], valores: { NOMBRE: 'bloqueada' } }
        ]),
        60_000
      )
      const msBloq = Date.now() - tBloq
      console.log(`  [MEDIDO] «Enviar» contra una fila bloqueada por una consola, Oracle ${mayor} ${drv?.modo ?? '?'}: ${msBloq} ms hasta el error`)
      check(
        'la fila bloqueada por la consola: a los ~10 s (FOR UPDATE WAIT), ORA-30006 en el índice 1 con el mensaje de la fila bloqueada',
        rBloq !== null && rBloq.ok && rBloq.valor.tipo === 'error' && rBloq.valor.indice === 1 && rBloq.valor.error.codigo === 'ORA-30006' &&
          /bloqueada por otra transacción/.test(rBloq.valor.error.mensaje) && /No se aplicó nada/.test(rBloq.valor.error.mensaje) &&
          msBloq >= MIN_WAIT_10_MS && msBloq < 15_000,
        JSON.stringify({ msBloq, rBloq })
      )
      check('… y el 1.º NO quedó (todo o nada), y la consola sigue con lo suyo pendiente', (await nombreDe(3)) === antes3 && ex.estadoConsola(PERFIL, KB)?.tx === 'pendiente', `${await nombreDe(3)} / ${ex.estadoConsola(PERFIL, KB)?.tx}`)
      await ex.tx(PERFIL, KB, 'rollback')
      const rSuelta = await enviar(E1, PK_ID, [
        { tipo: 'actualizar', clave: ['3'], valores: { NOMBRE: 'Cai' } },
        { tipo: 'actualizar', clave: ['2'], valores: { NOMBRE: 'Bea' } }
      ])
      check('revertida la consola, el mismo envío se aplica entero', rSuelta.ok && rSuelta.valor.tipo === 'hecho' && (await nombreDe(2)) === 'Bea', JSON.stringify(rSuelta))

      // --- el candado POR LOTES (antes, uno por fila: el doble de viajes) ---
      const ELOTE = `${PREFIJO}_ELOTE`
      const N10 = 2000
      await q(`CREATE TABLE ${ELOTE} (id NUMBER(10) PRIMARY KEY, v VARCHAR2(40))`)
      await q(`INSERT INTO ${ELOTE} SELECT LEVEL, 'v' || LEVEL FROM dual CONNECT BY LEVEL <= ${N10}`)
      const muchos = (sufijo: string): unknown[] => Array.from({ length: N10 }, (_, i) => ({ tipo: 'actualizar', clave: [String(i + 1)], valores: { V: `${sufijo}${i + 1}` } }))
      const v0 = viajesEnvio.length
      const t10 = Date.now()
      const r10 = await enviar(ELOTE, PK_ID, muchos('a'))
      const ms10 = Date.now() - t10
      const viajes10 = viajesEnvio.slice(v0)
      const candados10 = viajes10.filter((v) => v.candado).length
      console.log(`  [MEDIDO] «Enviar» de ${N10} UPDATE, Oracle ${mayor} ${drv?.modo ?? '?'}: ${ms10} ms y ${viajes10.length} viajes (${candados10} candados)`)
      const aplicados10 = Number((await q(`SELECT COUNT(*) FROM ${ELOTE} WHERE v LIKE 'a%'`))[0]?.[0])
      check(
        `${N10} UPDATE: ${N10 / 1000} candados de lote (no ${N10}) y ${N10} DML, y se aplican todos`,
        r10.ok && r10.valor.tipo === 'hecho' && candados10 === N10 / 1000 && viajes10.length === N10 + N10 / 1000 && aplicados10 === N10,
        JSON.stringify({ r10: r10.ok ? r10.valor.tipo : r10, candados10, viajes: viajes10.length, aplicados10 })
      )
      // La fila 1500 retenida por una consola: el 2.º lote vence a los ~10 s y la bisección
      // con NOWAIT señala SU cambio (el 1500.º, índice 1499); ninguna fila se toca.
      const upKb2 = await ex.ejecutar({ perfilId: PERFIL, consolaId: KB, ejecucionId: 'kb2', sql: `update ${ELOTE} set v = 'de la consola' where id = 1500`, maxFilas: 10 })
      const tBloq10 = Date.now()
      const rBloq10 = await conPlazo(enviar(ELOTE, PK_ID, muchos('b')), 60_000)
      const msBloq10 = Date.now() - tBloq10
      console.log(`  [MEDIDO] «Enviar» de ${N10} con la fila 1500 bloqueada, Oracle ${mayor} ${drv?.modo ?? '?'}: ${msBloq10} ms hasta el error`)
      const tocadas10 = Number((await q(`SELECT COUNT(*) FROM ${ELOTE} WHERE v LIKE 'b%'`))[0]?.[0])
      check(
        'una fila bloqueada en el 2.º lote: a los ~10 s, ORA-30006 en el índice de SU cambio (1499) con el mensaje de la fila bloqueada, y nada aplicado',
        upKb2.ok && rBloq10 !== null && rBloq10.ok && rBloq10.valor.tipo === 'error' && rBloq10.valor.indice === 1499 && rBloq10.valor.error.codigo === 'ORA-30006' &&
          /bloqueada por otra transacción/.test(rBloq10.valor.error.mensaje) && msBloq10 >= MIN_WAIT_10_MS && msBloq10 < 15_000 && tocadas10 === 0,
        JSON.stringify({ msBloq10, tocadas10, rBloq10: rBloq10 && rBloq10.ok && rBloq10.valor.tipo === 'error' ? { indice: rBloq10.valor.indice, codigo: rBloq10.valor.error.codigo } : rBloq10 })
      )
      await ex.tx(PERFIL, KB, 'rollback')
      // Un error del servidor que no es de espera también se busca: un ROWID mal formado en
      // el 2.º cambio (ORA-01410, para el lote entero) señala ESE cambio, no el primero.
      const yAntes = String((await q(`SELECT y FROM ${E2} WHERE x = 1`))[0]?.[0])
      const rMal = await enviar(E2, ROWID, [
        { tipo: 'actualizar', clave: [rowidDe('1')], valores: { Y: 'no debe quedar' } },
        { tipo: 'actualizar', clave: ['NOESUNROWID'], valores: { Y: 'x' } }
      ])
      const yDespues = String((await q(`SELECT y FROM ${E2} WHERE x = 1`))[0]?.[0])
      check(
        'un ROWID mal formado en el 2.º cambio: ORA-01410 en el índice 1 (la bisección), sin tocar el 1.º',
        rMal.ok && rMal.valor.tipo === 'error' && rMal.valor.indice === 1 && rMal.valor.error.codigo === 'ORA-01410' && yDespues === yAntes,
        JSON.stringify({ rMal, yAntes, yDespues })
      )

      // --- concurrencia optimista con el ROWID (`originales`) ---
      const E9 = `${PREFIJO}_E9`
      await q(`CREATE TABLE ${E9} (x NUMBER, y VARCHAR2(20), d DATE, t TIMESTAMP(6), n NUMBER, c CLOB)`)
      await q(
        `INSERT INTO ${E9} VALUES (1, 'uno', TO_DATE('2024-03-31 02:30:00', 'YYYY-MM-DD HH24:MI:SS'), ` +
          "TO_TIMESTAMP('2024-01-15 10:20:30.123456', 'YYYY-MM-DD HH24:MI:SS.FF6'), 0.5, 'un clob')"
      )
      for (let x = 2; x <= 6; x++) await q(`INSERT INTO ${E9} (x, y, n) VALUES (${x}, 'fila ${x}', ${x})`)
      /** La fila `x` tal como la lee la pestaña: sus originales (los de la rejilla) y su ROWID. */
      const leerE9 = async (x: string): Promise<{ originales: Record<string, string | null>; rowid: string | null }> => {
        const t = await abrirEd(E9, { orderBy: 'x' })
        const cols = t.ok && t.valor.resultado.tipo === 'filas' ? t.valor.resultado.columnas.map((c) => c.nombre) : []
        const fila = filasT(t).find((f) => f[0] === x) ?? []
        const originales: Record<string, string | null> = {}
        cols.forEach((c, i) => {
          if (c !== '__TESSERA_ROWID') originales[c] = (fila[i] as string | null) ?? null
        })
        return { originales, rowid: (fila[cols.indexOf('__TESSERA_ROWID')] as string | null) ?? null }
      }
      const f1 = await leerE9('1')
      check(
        'lo que la rejilla lee de la fila: NUMBER, DATE y TIMESTAMP exactos como texto',
        f1.originales.N === '0.5' && f1.originales.D === '2024-03-31 02:30:00' && f1.originales.T === '2024-01-15 10:20:30.123456' && f1.rowid !== null,
        JSON.stringify(f1)
      )
      const rSin = await enviar(E9, ROWID, [{ tipo: 'actualizar', clave: [f1.rowid], valores: { Y: 'UNO' }, originales: f1.originales }])
      const y1 = String((await q(`SELECT y FROM ${E9} WHERE x = 1`))[0]?.[0])
      check(
        'sin cambios de nadie, los originales (NUMBER 0.5, DATE, TIMESTAMP, NULL; el CLOB se descarta) CASAN con la fila: se aplica',
        rSin.ok && rSin.valor.tipo === 'hecho' && y1 === 'UNO',
        JSON.stringify({ rSin, y1 })
      )
      const f1b = await leerE9('1')
      await q(`UPDATE ${E9} SET n = 7 WHERE x = 1`)
      const rCambio = await enviar(E9, ROWID, [{ tipo: 'actualizar', clave: [f1b.rowid], valores: { Y: 'pisada' }, originales: f1b.originales }])
      const y1b = String((await q(`SELECT y FROM ${E9} WHERE x = 1`))[0]?.[0])
      check(
        'OTRA sesión cambió la fila tras leerla: 0 filas («la fila ya no está o cambió»), y no se escribe encima',
        rCambio.ok && rCambio.valor.tipo === 'error' && rCambio.valor.indice === 0 && rCambio.valor.filas === 0 && rCambio.valor.error.codigo === 'TESSERA-FILAS' && /cambió/.test(rCambio.valor.error.mensaje) && y1b === 'UNO',
        JSON.stringify({ rCambio, y1b })
      )
      // El caso que lo motiva: un ROWID REUTILIZADO. Se borra una fila y se insertan otras
      // hasta que una ocupa su hueco (medido por el grupo del constructor: a la tercera).
      const f3 = await leerE9('3')
      await q(`DELETE FROM ${E9} WHERE x = 3`)
      let ajena: number | null = null
      for (let i = 0; i < 40 && ajena === null; i++) {
        const x = 100 + i
        await q(`INSERT INTO ${E9} (x, y, n) VALUES (${x}, 'ajena', ${x})`)
        const r = String((await q(`SELECT ROWIDTOCHAR(ROWID) FROM ${E9} WHERE x = ${x}`))[0]?.[0])
        if (r === f3.rowid) ajena = x
      }
      if (ajena === null) {
        salta('ROWID reutilizado', 'ninguna de 40 inserciones ocupó el hueco de la fila borrada en este servidor')
      } else {
        const rReuso = await enviar(E9, ROWID, [{ tipo: 'borrar', clave: [f3.rowid], originales: f3.originales }])
        const sigue = String((await q(`SELECT COUNT(*) FROM ${E9} WHERE x = ${ajena}`))[0]?.[0])
        check(
          `ROWID reutilizado (la fila ${ajena} ocupa el hueco de la 3): con los originales, 0 filas y la fila AJENA sigue ahí`,
          rReuso.ok && rReuso.valor.tipo === 'error' && rReuso.valor.filas === 0 && sigue === '1',
          JSON.stringify({ rReuso, sigue })
        )
        // Lo que evitan, medido: el mismo DELETE SIN originales (la forma antigua)
        // borra la fila de OTRO. Se hace en una transacción del observador, y se revierte.
        const medido = await obs.execute(`DELETE FROM ${E9} WHERE ROWID = :1`, [f3.rowid], { autoCommit: false })
        await obs.rollback()
        console.log(`  [MEDIDO] el mismo DELETE solo por ROWID (sin originales) tocaría ${(medido as { rowsAffected?: number }).rowsAffected ?? '?'} fila(s) AJENA(s)`)
      }

      // Revisión: originales que NO deben dar un «la fila cambió» falso. Un VARCHAR2 con un
      // byte inválido en el juego de la base (0xFF en AL32UTF8, metido «de paso») se lee
      // con pérdida, como U+FFFD, y medido no casa nunca con `=`: sin descartarlo, esa
      // fila no se podría editar jamás. Y dos que SÍ casan y se comprueban: el CHAR con
      // sus blancos de relleno y el TIMESTAMP WITH TIME ZONE de zona por nombre.
      const E10 = `${PREFIJO}_E10`
      await q(`CREATE TABLE ${E10} (x NUMBER, v VARCHAR2(20), ch CHAR(6), tz TIMESTAMP(3) WITH TIME ZONE, y VARCHAR2(20))`)
      await q(
        `INSERT INTO ${E10} VALUES (1, UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW('41FF42')), 'ab', ` +
          "TO_TIMESTAMP_TZ('2024-10-27 02:30:00.123 Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS.FF3 TZR'), 'uno')"
      )
      await q(`INSERT INTO ${E10} VALUES (2, 'sana', 'cd', TO_TIMESTAMP_TZ('2024-01-15 10:20:30.5 America/New_York', 'YYYY-MM-DD HH24:MI:SS.FF1 TZR'), 'dos')`)
      const leerE10 = async (x: string): Promise<{ originales: Record<string, string | null>; rowid: string | null }> => {
        const t = await abrirEd(E10, { orderBy: 'x' })
        const cols = t.ok && t.valor.resultado.tipo === 'filas' ? t.valor.resultado.columnas.map((c) => c.nombre) : []
        const fila = filasT(t).find((f) => f[0] === x) ?? []
        const originales: Record<string, string | null> = {}
        cols.forEach((c, i) => {
          if (c !== '__TESSERA_ROWID') originales[c] = (fila[i] as string | null) ?? null
        })
        return { originales, rowid: (fila[cols.indexOf('__TESSERA_ROWID')] as string | null) ?? null }
      }
      const g1 = await leerE10('1')
      const rPerdida = await enviar(E10, ROWID, [{ tipo: 'actualizar', clave: [g1.rowid], valores: { Y: 'UNO' }, originales: g1.originales }])
      const yPerdida = String((await q(`SELECT y FROM ${E10} WHERE x = 1`))[0]?.[0])
      check(
        'un VARCHAR2 leído con pérdida (U+FFFD) NO da un «la fila cambió» falso: se descarta esa comprobación y se aplica',
        String(g1.originales.V).includes('\uFFFD') && rPerdida.ok && rPerdida.valor.tipo === 'hecho' && yPerdida === 'UNO',
        JSON.stringify({ leido: g1.originales.V, rPerdida, yPerdida })
      )
      const g2 = await leerE10('2')
      const rSanos = await enviar(E10, ROWID, [{ tipo: 'actualizar', clave: [g2.rowid], valores: { Y: 'DOS' }, originales: g2.originales }])
      const ySanos = String((await q(`SELECT y FROM ${E10} WHERE x = 2`))[0]?.[0])
      check(
        'el CHAR con sus blancos y el TIMESTAMP WITH TIME ZONE de zona por nombre, leídos por la rejilla, CASAN con la fila',
        g2.originales.CH === 'cd    ' && rSanos.ok && rSanos.valor.tipo === 'hecho' && ySanos === 'DOS',
        JSON.stringify({ ch: g2.originales.CH, tz: g2.originales.TZ, rSanos, ySanos })
      )
      await q(`UPDATE ${E10} SET ch = 'zz' WHERE x = 2`)
      const rCh = await enviar(E10, ROWID, [{ tipo: 'actualizar', clave: [g2.rowid], valores: { Y: 'pisada' }, originales: { ...g2.originales, Y: 'DOS' } }])
      check(
        '… y comprueban de verdad: otra sesión cambia el CHAR y el envío no escribe encima (0 filas)',
        rCh.ok && rCh.valor.tipo === 'error' && rCh.valor.filas === 0 && String((await q(`SELECT y FROM ${E10} WHERE x = 2`))[0]?.[0]) === 'DOS',
        JSON.stringify(rCh)
      )

      // --- DE PUNTA A PUNTA: filas del trabajador -> `aCambiosFila` del renderer -> «Enviar» ---
      // Arriba los originales los escribe la prueba. Aquí los ELIGE el renderer de verdad,
      // como `abrirEnvio` de `rejilla/datosEnvio.ts`: por la regla compartida (`shared/sql/originalesSql.ts`),
      // por el `tipoMotor` que da el trabajador (con la precisión del TIMESTAMP) y dentro de
      // la lista `comparables` del main; y el main los vuelve a filtrar y los ejecuta. Fija
      // que la lista del main y la elección del renderer COINCIDEN columna a columna sobre
      // metadatos reales, que nada de lo leído da un «la fila cambió» falso, que cada
      // familia comparada se compara de verdad en el servidor, que lo que no se compara no
      // bloquea, y el ROWID reutilizado con su contraprueba. (Con los TIMESTAMP
      // que ahora sí se comparan.)
      const EK = `${PREFIJO}_EK`
      await q(
        `CREATE TABLE ${EK} (id NUMBER(10), nombre VARCHAR2(40 CHAR), codigo CHAR(5), medio NUMBER, precio NUMBER(10,2), alta DATE, ` +
          'marca TIMESTAMP(6), marca0 TIMESTAMP(0), marcatz TIMESTAMP(3) WITH TIME ZONE, marca9 TIMESTAMP(9), ltz TIMESTAMP(6) WITH LOCAL TIME ZONE, ' +
          'peso BINARY_DOUBLE, fl FLOAT, nombre_n NVARCHAR2(20), notas CLOB, bin RAW(8), vacia VARCHAR2(10))'
      )
      const insK = (vals: string): Promise<unknown[][]> => q(`INSERT INTO ${EK} VALUES (${vals})`)
      await insK(
        "1, 'Ana', 'AB', 0.5, 12.3, TO_DATE('2024-01-31 10:20:30', 'YYYY-MM-DD HH24:MI:SS'), TIMESTAMP '2024-01-15 10:20:30.123456', " +
          "TIMESTAMP '2024-01-15 10:20:30', TO_TIMESTAMP_TZ('2024-10-27 02:30:00.123 Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS.FF3 TZR'), " +
          "TIMESTAMP '2024-01-15 10:20:30.123456789', TIMESTAMP '2024-01-15 10:20:30.5', 1.1, 1.1, N'ñandú', 'nota', HEXTORAW('0A0B'), NULL"
      )
      await insK(
        "2, 'Bea  ', 'ñ', -0.5, 0, TO_DATE('0099-01-01', 'YYYY-MM-DD'), NULL, NULL, " +
          "TO_TIMESTAMP_TZ('2024-01-15 10:20:30.5 -05:00', 'YYYY-MM-DD HH24:MI:SS.FF1 TZH:TZM'), NULL, NULL, 0.1, 0.1, NULL, NULL, NULL, NULL"
      )
      await insK(
        "3, 'línea1' || CHR(10) || 'AT&T', 'X', 1/3, 99999999.99, SYSDATE, SYSTIMESTAMP, SYSTIMESTAMP, SYSTIMESTAMP, SYSTIMESTAMP, " +
          "SYSTIMESTAMP, 1.5e200d, 1/3, N'x', 'y', NULL, NULL"
      )
      await insK('4, NULL, NULL, 1e125, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL')
      await insK(
        "5, 'Eva', 'E', 1e-130, 0.01, TO_DATE('9999-12-31 23:59:59', 'YYYY-MM-DD HH24:MI:SS'), TIMESTAMP '9999-12-31 23:59:59.999999', " +
          'NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL'
      )
      await insK(
        "6, 'Fer', 'F', 123456789012345678901234567890123456789, -99999999.99, NULL, TIMESTAMP '0001-01-01 00:00:00', " +
          'NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL'
      )
      await insK("7, 'Gil', 'G', 2/3, 7, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL")
      await insK("8, 'Hoy', 'H', 8, 8, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL")
      /** Lo que la pestaña tiene tras abrir: lo que DbDatosPane guarda en `res`. */
      interface LeidaK {
        identidad: DbIdentidadFila | undefined
        objeto: DbRefObjeto
        columnas: DbColumnaResultado[]
        filas: DbCelda[][]
        recortes: Map<number, Set<number>>
        comparables: string[] | undefined
      }
      const abrirK = async (nombre: string): Promise<LeidaK> => {
        const t = await abrirEd(nombre, { orderBy: 'id' })
        if (!t.ok || t.valor.resultado.tipo !== 'filas') throw new Error(`abrir ${nombre}: ${JSON.stringify(t)}`)
        const r = t.valor.resultado
        const recortes = new Map<number, Set<number>>()
        for (const [f, c] of r.pagina.recortes ?? []) {
          if (!recortes.has(f)) recortes.set(f, new Set())
          recortes.get(f)?.add(c)
        }
        return {
          identidad: t.valor.identidad,
          objeto: t.valor.objeto,
          columnas: r.columnas,
          filas: filasJson(r.pagina.filasJson) as DbCelda[][],
          recortes,
          comparables: t.valor.comparables
        }
      }
      const ctxK = (b: LeidaK): cr.ContextoEnvio => ({
        columnas: b.columnas,
        identidad: cr.identidadParaEditar(b.identidad, b.columnas),
        filas: b.filas,
        recortada: (f, c) => b.recortes.get(f)?.has(c) === true,
        comparables: b.comparables
      })
      /** Como `abrirEnvio` de `rejilla/datosEnvio.ts`: los cambios y su vista previa. */
      const convertirK = (b: LeidaK, cambios: cr.CambiosRejilla): { cambios: DbCambioFila[]; previa: string[] } => {
        const ctx = ctxK(b)
        const conv = cr.aCambiosFila(cambios, ctx)
        if (!conv.ok) throw new Error('aCambiosFila: ' + conv.error)
        const previa = cr.previaEnvio('oracle', b.objeto, ctx.identidad, conv.cambios, cr.tiposPorNombre(b.columnas))
        if (!previa.ok) throw new Error('vista previa: ' + previa.error)
        return { cambios: conv.cambios, previa: previa.lineas }
      }
      const filaK = (b: LeidaK, id: string): number => b.filas.findIndex((f) => f[0] === id)
      const editarK = (b: LeidaK, id: string, columna: string, valor: string | null): cr.CambiosRejilla => {
        const f = filaK(b, id)
        const c = b.columnas.findIndex((x) => x.nombre === columna)
        return cr.editarCelda(cr.SIN_CAMBIOS, { tipo: 'servidor', f }, c, valor, b.filas[f]?.[c])
      }
      const origDe = (c: DbCambioFila | undefined): Record<string, string | null> => (c && c.tipo !== 'insertar' ? (c.originales ?? {}) : {})

      let bk = await abrirK(EK)
      const esperadas = ['ID', 'NOMBRE', 'CODIGO', 'MEDIO', 'PRECIO', 'ALTA', 'MARCA', 'MARCA0', 'MARCATZ', 'VACIA']
      check(
        'K: identidad ROWID, y el main manda la lista de las que compara (TIMESTAMP(≤6) y de zona sí; (9), LOCAL, coma flotante, N, LOB y RAW no)',
        bk.identidad?.tipo === 'rowid' && JSON.stringify(bk.comparables) === JSON.stringify(esperadas),
        JSON.stringify({ identidad: bk.identidad, comparables: bk.comparables })
      )
      const discrepan = bk.columnas
        .filter((c) => c.nombre !== '__TESSERA_ROWID')
        .filter((c) => cr.columnaComparable(c) !== (bk.comparables ?? []).includes(c.nombre))
        .map((c) => `${c.nombre}:${c.tipoMotor}`)
      check(
        'K: el renderer (por el tipoMotor del trabajador) y el main (por su catálogo) deciden IGUAL en cada columna',
        discrepan.length === 0,
        discrepan.length === 0 ? bk.columnas.map((c) => `${c.nombre}:${c.tipoMotor}`).join(' ') : `discrepan: ${discrepan.join(' ')}`
      )
      // (1) Sin falsos «la fila cambió»: cada fila difícil, editada y enviada con lo que eligió el renderer.
      for (const id of ['1', '2', '3', '4', '5', '6', '7']) {
        const { cambios, previa } = convertirK(bk, editarK(bk, id, 'VACIA', `e${id}`))
        const orig = origDe(cambios[0])
        const claves = Object.keys(orig)
        // La vista previa enseña EXACTAMENTE esas comprobaciones (en su WHERE, detrás del ROWID).
        const lineaUpd = previa[0] ?? ''
        const donde = lineaUpd.slice(lineaUpd.indexOf(' WHERE '))
        const enPrevia = [...donde.matchAll(/"([A-Z0-9_]+)" (?:=|IS NULL)/g)].map((m) => m[1]).sort()
        const r = await enviar(EK, ROWID, cambios)
        check(
          `K fila ${id}: UPDATE con ${claves.length} originales elegidos por el renderer, todos de la lista del main y todos en la vista previa -> hecho`,
          r.ok && r.valor.tipo === 'hecho' && claves.length >= 4 && claves.every((k) => (bk.comparables ?? []).includes(k)) && JSON.stringify(enPrevia) === JSON.stringify([...claves].sort()),
          `${JSON.stringify(orig)} | previa: ${(previa[0] ?? '').slice(0, 300)} | r=${JSON.stringify(r.ok ? r.valor : r.error).slice(0, 240)}`
        )
      }
      const o1 = origDe(convertirK(bk, editarK(bk, '1', 'VACIA', 'z')).cambios[0])
      check(
        'K: los TIMESTAMP(6), (0) y (3) WITH TIME ZONE van en los originales; el (9) y el LOCAL no',
        'MARCA' in o1 && 'MARCA0' in o1 && 'MARCATZ' in o1 && !('MARCA9' in o1) && !('LTZ' in o1) && !('NOMBRE_N' in o1) && !('PESO' in o1),
        JSON.stringify(o1)
      )
      bk = await abrirK(EK)
      {
        const f = filaK(bk, '8')
        const { cambios } = convertirK(bk, cr.borrarFilas(cr.SIN_CAMBIOS, [{ tipo: 'servidor', f }]))
        const r = await enviar(EK, ROWID, cambios)
        const quedan = Number((await q(`SELECT COUNT(*) FROM ${EK} WHERE id = 8`))[0]?.[0])
        check('K: DELETE por ROWID con los originales del renderer -> hecho y la fila ya no está', r.ok && r.valor.tipo === 'hecho' && quedan === 0 && Object.keys(origDe(cambios[0])).length > 0, JSON.stringify({ o: origDe(cambios[0]), r, quedan }))
      }
      // (2) Cada familia comparada se compara DE VERDAD en el servidor.
      const familiasK: Array<[string, string]> = [
        ['VARCHAR2', "nombre = 'Otra'"],
        ['CHAR', "codigo = 'ZZ'"],
        ['NUMBER', 'medio = 0.25'],
        ['NUMBER(10,2)', 'precio = 1.5'],
        ['DATE', "alta = TO_DATE('2000-01-01', 'YYYY-MM-DD')"],
        ['TIMESTAMP(6)', "marca = TIMESTAMP '2000-01-01 00:00:00.000001'"],
        ['TIMESTAMP(0)', "marca0 = TIMESTAMP '2000-01-01 00:00:01'"],
        // Otro INSTANTE (la hora de la fila, 02:30 en Madrid el día del cambio de hora, es
        // ambigua: +01:00 podría ser el mismo instante y no un cambio).
        ['TIMESTAMP(3) WITH TIME ZONE', "marcatz = TO_TIMESTAMP_TZ('2000-01-01 00:00:00.000 +00:00', 'YYYY-MM-DD HH24:MI:SS.FF3 TZH:TZM')"],
        ['NUMBER(10) (la de la fila, también)', 'id = 11']
      ]
      let nFam = 0
      for (const [fam, set] of familiasK) {
        bk = await abrirK(EK)
        // Un valor NUEVO en cada vuelta: si una vuelta anterior se aplicara, repetir el
        // mismo no sería un cambio y el fallo de esa vuelta arrastraría a la siguiente.
        const { cambios } = convertirK(bk, editarK(bk, '1', 'VACIA', `x${++nFam}`))
        await q(`UPDATE ${EK} SET ${set} WHERE id = 1`)
        const r = await enviar(EK, ROWID, cambios)
        check(`K ${fam}: otra sesión la cambia -> 0 filas y nada aplicado`, r.ok && r.valor.tipo === 'error' && r.valor.filas === 0, JSON.stringify(r.ok ? r.valor : r.error).slice(0, 240))
        if (set.startsWith('id')) await q(`UPDATE ${EK} SET id = 1 WHERE id = 11`)
      }
      // (3) Lo que no se compara no bloquea.
      const noComparadasK: Array<[string, string]> = [
        ['BINARY_DOUBLE', 'peso = 9.9'],
        ['FLOAT', 'fl = 9.9'],
        ['TIMESTAMP(9)', 'marca9 = SYSTIMESTAMP'],
        ['TIMESTAMP WITH LOCAL TIME ZONE', 'ltz = SYSTIMESTAMP'],
        ['NVARCHAR2', "nombre_n = N'otro'"],
        ['CLOB', "notas = 'otra'"],
        ['RAW', "bin = HEXTORAW('FF')"]
      ]
      let nK = 0
      for (const [fam, set] of noComparadasK) {
        bk = await abrirK(EK)
        const { cambios } = convertirK(bk, editarK(bk, '1', 'VACIA', `y${++nK}`))
        await q(`UPDATE ${EK} SET ${set} WHERE id = 1`)
        const r = await enviar(EK, ROWID, cambios)
        check(`K ${fam}: no va en los originales, y el envío sale aunque otra sesión la cambie`, r.ok && r.valor.tipo === 'hecho', JSON.stringify(r.ok ? r.valor : r.error).slice(0, 200))
      }
      // (4) ROWID reutilizado, con los originales que elige el renderer, y su contraprueba.
      {
        const EKR = `${PREFIJO}_EKR`
        await q(`CREATE TABLE ${EKR} (id NUMBER(10), nombre VARCHAR2(20))`)
        await q(`INSERT INTO ${EKR} VALUES (1, 'Ana')`)
        const bR = await abrirK(EKR)
        const rowidR = String(bR.filas[0]?.[2] ?? '')
        await q(`DELETE FROM ${EKR}`)
        let reusada = -1
        for (let i = 2; i <= 50 && reusada < 0; i++) {
          await q(`INSERT INTO ${EKR} VALUES (${i}, 'ajena${i}')`)
          const hay = await q(`SELECT id FROM ${EKR} WHERE ROWID = CHARTOROWID(:r)`, [rowidR])
          if (hay.length > 0) reusada = Number(hay[0]?.[0])
        }
        if (reusada < 0) {
          salta('K: ROWID reutilizado (renderer)', 'ninguna de 49 inserciones ocupó el hueco de la fila borrada en este servidor')
        } else {
          const { cambios } = convertirK(bR, editarK(bR, '1', 'NOMBRE', 'pisada'))
          const r = await enviar(EKR, ROWID, cambios)
          const ajenaK = String((await q(`SELECT nombre FROM ${EKR} WHERE id = :i`, [reusada]))[0]?.[0])
          check(
            `K: ROWID reutilizado (la fila ${reusada}): con los originales del renderer, 0 filas y la fila AJENA intacta`,
            r.ok && r.valor.tipo === 'error' && r.valor.filas === 0 && ajenaK === `ajena${reusada}`,
            JSON.stringify({ o: origDe(cambios[0]), r, ajenaK }).slice(0, 300)
          )
          const sinOrig = cambios.map((c): DbCambioFila => (c.tipo === 'actualizar' ? { tipo: 'actualizar', clave: c.clave, valores: c.valores } : c))
          const r2 = await enviar(EKR, ROWID, sinOrig)
          const ajena2 = String((await q(`SELECT nombre FROM ${EKR} WHERE id = :i`, [reusada]))[0]?.[0])
          check('K: CONTRAPRUEBA sin los originales (solo el ROWID en el WHERE): 1 fila AJENA pisada', r2.ok && r2.valor.tipo === 'hecho' && ajena2 === 'pisada', JSON.stringify({ r2, ajena2 }))
        }
      }

      // --- EL JUEGO NACIONAL: NCHAR/NVARCHAR2/NCLOB por su bind NVARCHAR ---
      // En una base Unicode (las de prueba son AL32UTF8) guarda lo mismo que el bind de
      // texto de antes: lo que se fija aquí es que el bind nuevo escribe EXACTO, también
      // como CLAVE (el WHERE y el FOR UPDATE WAIT con el mismo bind) y hacia un NCLOB
      // corto. Lo que arregla —una base NO Unicode, donde el VARCHAR pasaba por su juego y
      // lo que no cabía llegaba como «?»— no se puede medir con estas bases.
      const EN = `${PREFIJO}_EN`
      await q(`CREATE TABLE ${EN} (k NVARCHAR2(10) PRIMARY KEY, n NVARCHAR2(20), c NCHAR(4), nc NCLOB, v VARCHAR2(20))`)
      const kN = '汉'
      const nN = '漢字 ñ 😀'
      const rIns = await enviar(EN, { tipo: 'pk', columnas: ['K'] }, [{ tipo: 'insertar', valores: { K: kN, N: nN, C: 'ñ', NC: 'corto ✓', V: 'plano' } }])
      const leidaN = (await q(`SELECT k, n, c, TO_CHAR(nc), v FROM ${EN}`))[0] ?? []
      check(
        'N: INSERT con NVARCHAR2 (CJK y emoji), NCHAR y un NCLOB corto por el bind nacional: se guarda EXACTO',
        rIns.ok && rIns.valor.tipo === 'hecho' && leidaN[0] === kN && leidaN[1] === nN && leidaN[2] === 'ñ   ' && leidaN[3] === 'corto ✓' && leidaN[4] === 'plano',
        JSON.stringify({ rIns, leidaN })
      )
      const rUpdN = await enviar(EN, { tipo: 'pk', columnas: ['K'] }, [{ tipo: 'actualizar', clave: [kN], valores: { N: '更新' } }])
      const nTras = String((await q(`SELECT n FROM ${EN} WHERE k = :k`, [kN]))[0]?.[0])
      check(
        'N: UPDATE por una CLAVE NVARCHAR2 (WHERE y FOR UPDATE WAIT con el bind nacional): 1 fila y el valor exacto',
        rUpdN.ok && rUpdN.valor.tipo === 'hecho' && nTras === '更新',
        JSON.stringify({ rUpdN, nTras })
      )
      const rDelN = await enviar(EN, { tipo: 'pk', columnas: ['K'] }, [{ tipo: 'borrar', clave: [kN] }])
      const quedanN = Number((await q(`SELECT COUNT(*) FROM ${EN}`))[0]?.[0])
      check('N: DELETE por la clave nacional: la fila ya no está', rDelN.ok && rDelN.valor.tipo === 'hecho' && quedanN === 0, JSON.stringify({ rDelN, quedanN }))
    }

    hr('(28) El FILTRO GUIADO contra el servidor (casos comunes de `casosFiltroGuiado.mts`)')
    {
      // DATE con hora, NUMBER(38) de 30 cifras (TO_NUMBER con el modelo de sus cifras y el NLS
      // explícito), y el '' de la fila 5, que Oracle guarda como NULL. `codigo` CHAR(8) es
      // solo de Oracle: fija que «=»/«≠» comparan CON relleno (bind CHAR).
      const FG = `${PREFIJO}_FG`
      await q(`CREATE TABLE ${FG} (id NUMBER(10) PRIMARY KEY, nombre VARCHAR2(40), sueldo NUMBER(10,2), grande NUMBER(38), alta DATE, activo NUMBER(1), codigo CHAR(8))`)
      const fecha = (s: string | null): string => (s === null ? 'NULL' : `TO_DATE('${s}', 'YYYY-MM-DD HH24:MI:SS')`)
      const filasFg: Array<[number, string, string, string, string | null, string]> = [
        [1, "'Ana'", '12.5', '123456789012345678901234567890', '2026-09-28 00:00:00', '1'],
        [2, "'ANA_B'", '10', '123456789012345678901234567891', '2026-09-28 23:59:59', '0'],
        [3, "'50% off'", '-3.25', '5', '2026-09-29 00:00:00', '1'],
        [4, 'NULL', 'NULL', 'NULL', null, 'NULL'],
        [5, "''", '7', '7', '2026-09-27 12:00:00', '0'],
        [6, "'anaXb'", '12.5', '9', '2026-09-01 10:00:00', '1']
      ]
      // Los números van como literales con punto: la sesión de `q` es de node-oracledb, que
      // no toca el NLS del servidor (el de la imagen es '.,').
      for (const [id, nombre, sueldo, grande, alta, activo] of filasFg) {
        await q(`INSERT INTO ${FG} (id, nombre, sueldo, grande, alta, activo, codigo) VALUES (${id}, ${nombre}, ${sueldo}, ${grande}, ${fecha(alta)}, ${activo}, ${id === 1 ? "'ABC'" : 'NULL'})`)
      }
      const refFg = { esquema: USUARIO, nombre: FG, tipo: 'tabla' as const }
      await probarFiltroGuiado({
        motor: `Oracle ${mayor}`,
        col: { id: 'ID', nombre: 'NOMBRE', sueldo: 'SUELDO', grande: 'GRANDE', alta: 'ALTA', activo: 'ACTIVO' },
        grandes: ['123456789012345678901234567890', '123456789012345678901234567891'],
        // Sin BOOLEAN de SQL hasta la 23: NUMBER(1) es 'numero' en la interfaz.
        booleano: false,
        columnaInexistente: 'condicion',
        abrir: (p) => ex.abrirTabla({ conexionId: 'c1', objeto: refFg, maxFilas: 100, ...p }),
        leerMas: (l, m) => ex.leerMas(l, m),
        contar: (l, id) => ex.contar(l, id),
        check
      })
      // El respaldo ROWNUM CON filtro: binds por nombre `{ f1…, hasta, desde }`. Se expulsa el
      // cursor por detrás del main, como en (11), y «más» tiene que re-ejecutar lo mismo.
      {
        const tR = await ex.abrirTabla({
          conexionId: 'c1',
          peticionId: 'fg-rownum',
          objeto: refFg,
          maxFilas: 2,
          filtro: { union: 'todas', condiciones: [{ columna: 'SUELDO', categoria: 'numero', operador: 'noVacio' }, { columna: 'ALTA', categoria: 'fecha', operador: 'mayor', valor: '2026-09-01' }] },
          orden: [{ columna: 'SUELDO', dir: 'desc' }, { columna: 'ID', dir: 'asc' }]
        })
        const lR = tR.ok && tR.valor.resultado.tipo === 'filas' ? (tR.valor.resultado.lector ?? '') : ''
        const pR = procesoDe.get('c1')
        let fuera = false
        if (pR && lR) {
          try {
            fuera = (await pR.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: 'datos', lector: lR })).cerrado
          } catch (e) {
            logs.push(`cerrarLector directo: ${mensajeDe(e)}`)
          }
        }
        const mR = await ex.leerMas(lR, 2)
        const gR = mR.ok ? filasJson(mR.valor.filasJson).map((f) => String(f[0])) : []
        check(
          `Oracle ${mayor} · respaldo ROWNUM con el filtro y el orden: re-ejecutada, [5,3] tras [1,2] (sin la 6, que es del día 1)`,
          fuera && mR.ok && mR.valor.reejecutada === true && JSON.stringify(gR) === '["5","3"]',
          JSON.stringify({ fuera, mR: mR.ok ? { re: mR.valor.reejecutada, gR } : mR })
        )
      }
      const idsCodigo = async (operador: 'igual' | 'contiene' | 'distinto'): Promise<unknown> => {
        const r = await ex.abrirTabla({
          conexionId: 'c1',
          peticionId: `fg-char-${operador}`,
          objeto: refFg,
          maxFilas: 100,
          filtro: { union: 'todas', condiciones: [{ columna: 'CODIGO', categoria: 'texto', operador, valor: 'ABC' }] }
        })
        return r.ok && r.valor.resultado.tipo === 'filas' ? filasJson(r.valor.resultado.pagina.filasJson).length : r
      }
      const charIgual = await idsCodigo('igual')
      const charContiene = await idsCodigo('contiene')
      const charDistinto = await idsCodigo('distinto')
      const charTodas = await (async (): Promise<unknown> => {
        const r = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'fg-char-todas', objeto: refFg, maxFilas: 100 })
        return r.ok && r.valor.resultado.tipo === 'filas' ? filasJson(r.valor.resultado.pagina.filasJson).length : r
      })()
      // el texto de «=»/«≠» va como bind CHAR (`entrada: 'char'`), que
      // Oracle compara como un literal: con relleno contra la columna CHAR(8).
      check(
        `Oracle ${mayor} · CHAR(8) 'ABC': «=» casa (bind CHAR, con relleno), «≠» deja fuera solo esa fila y «contiene» casa`,
        charIgual === 1 && charContiene === 1 && typeof charTodas === 'number' && charDistinto === charTodas - 1,
        JSON.stringify({ charIgual, charContiene, charDistinto, charTodas })
      )
    }

    hr('(26) Historial: privado, con lo que llegó al servidor')
    await ex.historial?.esperar()
    const dirHist = path.join(tmp, 'db-historial')
    const archivosH = existsSync(dirHist) ? readdirSync(dirHist) : []
    const hO = await ex.historialListar({ perfilId: PERFIL })
    const hl = hO.ok ? hO.valor : []
    check(
      'en db-historial (no en el espacio de datos), con ok, error y cancelada',
      archivosH.join() === `${PERFIL}.jsonl` && hl.some((x) => x.resultado === 'ok') && hl.some((x) => x.resultado === 'error') && hl.some((x) => x.resultado === 'cancelada'),
      `${archivosH.join()} · ${hl.length} entradas`
    )
    check('una con parámetros guarda :id, no el valor', hl.some((x) => x.sql === `select nombre from ${CLI} where id = :id`), 'está')
    check('el Explain no se anota', !hl.some((x) => /join .* on p\.cli_id = c\.id where c\.id = :id/.test(x.sql)), 'no está')

    const contarSesiones = async (): Promise<number | string> => {
      try {
        const r = await q(
          'SELECT COUNT(*) FROM v$session WHERE module = :m AND client_identifier IN (:a, :b)',
          { m: 'Tessera/explorador', a: `prueba@${base.alias}`, b: `prueba@${aliasRo}` }
        )
        return Number(r[0]?.[0])
      } catch (err) {
        return codigoDe(err) || mensajeDe(err).slice(0, 80)
      }
    }
    const sesionesAntes = await contarSesiones()
    const vivosAntes = procesos.filter((p) => p.vivo).length
    await ex.cerrarTodo(2500)
    explorerCerrado = true
    check(
      'ningún proceso de sesión vivo',
      ex.gestor.procesosVivos() === 0 && procesos.every((p) => !p.vivo) && vivosAntes > 0,
      `antes=${vivosAntes} después=${procesos.filter((p) => p.vivo).length}`
    )
    if (typeof sesionesAntes !== 'number') {
      salta(
        "ninguna sesión 'Tessera/explorador' en v$session",
        `${USUARIO} no puede leer v$session (${sesionesAntes}); hace falta SELECT_CATALOG_ROLE o SELECT sobre v_$session`
      )
    } else {
      let despues: number | string = -1
      for (let i = 0; i < 30; i++) {
        despues = await contarSesiones()
        if (despues === 0) break
        await dormir(100)
      }
      check(
        "las sesiones se veían en v$session (module + client_identifier) y cerrarTodo no deja ninguna",
        sesionesAntes > 0 && despues === 0,
        `antes=${sesionesAntes} después=${despues}`
      )
    }

    // --- (15) Log ---------------------------------------------------------------------------------------
    hr('(15) Lo que llega al log')
    const todo = logs.join('\n')
    if (dst.clave.length >= 8) check('ninguna línea contiene la contraseña', !todo.includes(dst.clave), `${logs.length} líneas`)
    else salta('la contraseña no aparece en el log', 'tiene menos de 8 caracteres: buscarla daría falsos positivos')
    check('ni SQL de usuario', !/columna_rota|raise_application_error|fallo a propósito/i.test(todo), 'limpio')
  } catch (err) {
    if (err instanceof SaltoPrueba) salta('el resto de la prueba', err.message)
    else check('sin excepciones inesperadas', false, String(err instanceof Error ? err.stack : err))
  } finally {
    if (!explorerCerrado) await ex.cerrarTodo(1000)
    if (observador) {
      try {
        const restos = await limpiar(observador, PREFIJO, odb.OUT_FORMAT_ARRAY)
        check(
          `limpieza: no queda ningún objeto ${PREFIJO}_* en el esquema`,
          restos.length === 0,
          restos.length > 0 ? `quedan (bórralos a mano): ${restos.join(', ')}` : 'esquema limpio'
        )
      } catch (err) {
        check(`limpieza de ${PREFIJO}_*`, false, mensajeDe(err))
      }
      try {
        await observador.close()
      } catch {
        // nada
      }
    }
    if (results.some((r) => !r.pass)) {
      console.log('\n--- log ---')
      for (const l of logs) console.log('  ' + l)
    }
  }
  veredicto()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
