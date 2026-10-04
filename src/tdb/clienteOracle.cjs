// =============================================================================
// Carga del Instant Client de Oracle y sus textos: límites de thin, `sqlnet.ora` del
// explorador, versión del servidor y el aviso de soporte. Pieza de `oracle.cjs`, que
// reexporta lo que el resto usa. `clienteCargado` tiene aquí su único dueño.
// Decisiones: docs/decisiones/bd/adaptador-oracle-escalada-y-stop.md
// =============================================================================

'use strict'

const path = require('node:path')
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')

/** Error de thin que significa "esta base es demasiado vieja, usa thick". */
const COD_VERSION_NO_SOPORTADA = 'NJS-138'

/** Límites del modo thin que se resuelven cargando el Instant Client, con su motivo para el usuario. */
const LIMITES_DE_THIN = [
  { code: COD_VERSION_NO_SOPORTADA, motivo: 'es anterior a Oracle 12.1' },
  { code: 'NJS-533', motivo: 'exige cifrado nativo de red (Advanced Networking Option)' },
  { code: 'NJS-116', motivo: 'guarda la contraseña con un verificador antiguo' }
]

/**
 * Instant Client cargado en ESTE proceso, si hay alguno: tras escalar la primera sesión del
 * trabajador, las siguientes conectan en thick y necesitan saber qué pack está en uso.
 */
let clienteCargado = null

/** El pack del Instant Client ya cargado en este proceso, o null. */
function packCargado() {
  return clienteCargado ? clienteCargado.packId : null
}

/** ¿Es este error un límite de thin que el Instant Client resuelve? Mira `code` y `message`. */
function limiteDeThin(err) {
  const texto = `${String((err && err.code) || '')} ${String((err && err.message) || '')}`
  return LIMITES_DE_THIN.find((l) => texto.includes(l.code)) ?? null
}

/**
 * `sqlnet.ora` que se incluye en el del explorador: el que el cliente leería sin `configDir`
 * (TNS_ADMIN y, si no, el `network/admin` del Instant Client). Puro: entorno y existencia
 * de ficheros entran por parámetro.
 */
function sqlnetDelUsuario(env, libDir, existe) {
  const candidatos = []
  const tnsAdmin = env && typeof env.TNS_ADMIN === 'string' ? env.TNS_ADMIN.trim() : ''
  if (tnsAdmin) candidatos.push(path.join(tnsAdmin, 'sqlnet.ora'))
  if (libDir) candidatos.push(path.join(libDir, 'network', 'admin', 'sqlnet.ora'))
  // El primero que exista, en el orden en que el cliente los buscaría.
  return candidatos.find((r) => existe(r)) ?? null
}

/**
 * Contenido del `sqlnet.ora` del explorador. El `IFILE` va entre comillas (la ruta puede
 * llevar espacios y un `#` abriría un comentario) y `DISABLE_OOB` después, para que el del
 * usuario no lo tape.
 */
function contenidoSqlnetExplorador(sqlnetUsuario) {
  const lineas = [
    '# Generado por Tessera para el explorador de bases de datos. No lo edites: se reescribe.',
    '# DISABLE_OOB: el Stop (break) viaja dentro del flujo; el dato urgente de TCP no',
    '# atraviesa VPN ni reenvíos de puertos y el servidor no se enteraba nunca.'
  ]
  if (sqlnetUsuario) lineas.push(`IFILE="${sqlnetUsuario}"`)
  lineas.push('DISABLE_OOB=ON', '')
  return lineas.join('\n')
}

/**
 * Escribe el `sqlnet.ora` del explorador y devuelve su carpeta, o null si no se pudo (sin él
 * solo se pierde el Stop en las redes que tiran el OOB). Carpeta fija bajo `driversDir`,
 * escritura solo si cambió y renombrado atómico: los trabajadores no se pisan.
 */
function prepararConfigRed(ctx, libDir) {
  try {
    const dir = path.join(ctx.driversDir, 'oracle', 'red-explorador')
    const destino = path.join(dir, 'sqlnet.ora')
    const contenido = contenidoSqlnetExplorador(sqlnetDelUsuario(process.env, libDir, existsSync))
    let actual = null
    try {
      actual = readFileSync(destino, 'utf8')
    } catch {
      actual = null
    }
    if (actual !== contenido) {
      mkdirSync(dir, { recursive: true })
      const tmp = `${destino}.${process.pid}.tmp`
      writeFileSync(tmp, contenido)
      renameSync(tmp, destino)
    }
    return dir
  } catch (err) {
    process.stderr.write(`[oracle] sin sqlnet.ora del explorador (${String((err && err.code) || 'error')}): el Stop depende del OOB\n`)
    return null
  }
}

/**
 * Repone las clases base de node-oracledb que el intento thin fallido sustituyó por las thin,
 * antes de cargar el cliente. Toca un módulo interno del driver: todo en try, nunca lanza.
 */
function restaurarClasesThick() {
  try {
    const impl = require('oracledb/lib/impl/index.js')
    impl.ConnectionImpl = require('oracledb/lib/impl/connection.js')
    impl.ResultSetImpl = require('oracledb/lib/impl/resultset.js')
    impl.PoolImpl = require('oracledb/lib/impl/pool.js')
    impl.LobImpl = require('oracledb/lib/impl/lob.js')
    impl.DbObjectImpl = require('oracledb/lib/impl/dbObject.js')
  } catch {
    // otra versión de oracledb: se carga el cliente igual
  }
}

/**
 * Rutas del equipo dentro de un mensaje -> `<cliente>`: unidades de Windows (con espacios en
 * las carpetas) y rutas POSIX absolutas, nunca una URL. La usa también `sesionOracle.cjs`.
 */
function limpiarRutasHost(texto) {
  return String(texto)
    .replace(/[A-Za-z]:\\(?:[^\\"'\n]*\\)*[^\\\s"'\n]*/g, '<cliente>')
    .replace(/(?<![\w.:/\\])\/(?:[^/"'\n]+\/)+[^/\s"'\n,)]*/g, '<cliente>')
}

/**
 * El error de un Instant Client que no carga (DPI-1047, DPI-1072) sin las rutas del equipo,
 * conservando `code`, `errorNum` y el resto del texto: «Probar» lo enseña en el renderer.
 */
function sinRutasDelCliente(err) {
  const e = new Error(limpiarRutasHost(err && err.message ? err.message : String(err)))
  if (err && err.code !== undefined) e.code = err.code
  if (err && err.errorNum !== undefined) e.errorNum = err.errorNum
  return e
}

/** Los packs del catálogo que hay que probar, el preferido primero. */
function candidatosDePack(ctx, packIdPreferido) {
  const candidatos = []
  if (packIdPreferido) candidatos.push(packIdPreferido)
  for (const p of ctx.packs) {
    if (p.motor === 'oracle' && !candidatos.includes(p.id)) candidatos.push(p.id)
  }
  return candidatos
}

/**
 * Carga el Instant Client apropiado, si hay alguno instalado, y devuelve `{ ruta, packId }`
 * o null. `ctx.packs` es el catálogo y `ctx.driversDir` la raíz de descargas; `explorador`
 * añade el `configDir` con `DISABLE_OOB` y repone las clases base.
 */
function cargarInstantClient(oracledb, ctx, packIdPreferido, explorador) {
  for (const packId of candidatosDePack(ctx, packIdPreferido)) {
    const pack = ctx.packs.find((p) => p.id === packId)
    if (!pack) continue
    const rutas = [ctx.externos[packId], path.join(ctx.driversDir, 'oracle', packId)].filter(Boolean)
    for (const ruta of rutas) {
      if (!existsSync(path.join(ruta, pack.centinela))) continue
      const configDir = explorador ? prepararConfigRed(ctx, ruta) : null
      if (explorador) restaurarClasesThick()
      try {
        oracledb.initOracleClient(configDir ? { libDir: ruta, configDir } : { libDir: ruta })
      } catch (err) {
        throw sinRutasDelCliente(err)
      }
      clienteCargado = { ruta, packId }
      return { ruta, packId }
    }
  }
  return null
}

/**
 * El aviso de «fuera del soporte de Oracle» de un pack para un servidor de esta versión, o
 * null. Gemelo de `avisoSoporte` de `driverPacks.ts`: solo con la versión conocida y por
 * debajo de `soporteOracleDesde`.
 */
function avisoDeSoporte(pack, version) {
  if (!pack || typeof pack.soporteOracleDesde !== 'number' || !pack.aviso) return null
  if (version === null || version === undefined || !Number.isFinite(version)) return null
  return version < pack.soporteOracleDesde ? pack.aviso : null
}

/**
 * `mayor.menor` a partir de `connection.oracleServerVersion` (11.2.0.4.0 llega como
 * 1102000400: mayor × 10^8 + menor × 10^6 + …), o null si no es un número válido.
 */
function versionDeNumero(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  const mayor = Math.floor(n / 100000000)
  const menor = Math.floor(n / 1000000) % 100
  return mayor > 0 ? Number(`${mayor}.${menor}`) : null
}

/** Extrae `11.2` de un mensaje o banner de Oracle. */
function versionDeTexto(texto) {
  const m = texto.match(/Release\s+(\d+)\.(\d+)\./i) || texto.match(/\b(\d+)\.(\d+)\.\d+\.\d+/)
  if (!m) return null
  const v = Number(`${m[1]}.${m[2]}`)
  return Number.isFinite(v) ? v : null
}

/**
 * El «falta el cliente» de la escalada, que leen el agente en la terminal y el diálogo de la
 * conexión. El pack en imagen de disco (.dmg) no se instala con `tdb driver install`: lo
 * instala Tessera. El aviso de soporte va detrás, cuando la versión cae fuera del de Oracle.
 */
function mensajeRequiereCliente(alias, limite, version, pack) {
  const aviso = avisoDeSoporte(pack, version)
  return (
    `${alias} ${limite.motivo}${version ? ` (Oracle ${version})` : ''} y necesita el cliente Oracle.\n` +
    (pack
      ? `Falta: ${pack.nombre} (${pack.sizeMB} MB).\n` +
        (pack.formato === 'dmg'
          ? `Instálalo desde "Clientes de base de datos", en el diálogo de la conexión (vista Bases de datos).`
          : `Instálalo con:  tdb driver install ${pack.id}\n` +
            `o desde "Clientes de base de datos", en el diálogo de la conexión (vista Bases de datos).`) +
        (aviso ? `\nOracle ${version}: ${aviso}` : '')
      : 'No hay ningún cliente compatible en el catálogo.')
  )
}

/** ¿Qué pack haría falta para esta versión de servidor? (mismo criterio que el main). */
function packParaServidor(packs, version) {
  if (version !== null && version >= 12.1) return null
  const oracle = packs.filter((p) => p.motor === 'oracle')
  if (version === null) return oracle.find((p) => p.id === 'oracle-ic-19') ?? oracle[0] ?? null
  return (
    oracle.find((p) => version >= p.servidorDesde && version <= p.servidorHasta) ??
    oracle.find((p) => p.id === 'oracle-ic-19') ??
    null
  )
}

module.exports = {
  COD_VERSION_NO_SOPORTADA,
  LIMITES_DE_THIN,
  packCargado,
  limiteDeThin,
  sqlnetDelUsuario,
  contenidoSqlnetExplorador,
  restaurarClasesThick,
  limpiarRutasHost,
  cargarInstantClient,
  avisoDeSoporte,
  versionDeNumero,
  versionDeTexto,
  mensajeRequiereCliente,
  packParaServidor
}
