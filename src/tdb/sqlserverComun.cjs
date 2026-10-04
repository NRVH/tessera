// =============================================================================
// Lo común de SQL Server para `tdb` (`sqlserver.cjs`) y el trabajador del explorador
// (`sesionSqlserver.cjs`): la configuración de tedious, conectar, y los errores traducidos a
// `ErrorTrabajador`. Reexporta los valores exactos (`exactosSqlserver`) y las celdas
// (`celdasSqlserver`). El driver es `tedious`, JavaScript puro y fijado a una versión exacta.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-conexion-y-exactos.md
// =============================================================================

'use strict'

const exactos = require('./exactosSqlserver.cjs')
const celdasSqlserver = require('./celdasSqlserver.cjs')

/** La versión de tedious contra la que se escribió y se probó el parche de valores exactos. */
const VERSION_TEDIOUS = '20.3.3'

/** Idioma de la sesión: los mensajes del servidor en español (el NÚMERO del error viaja aparte: ningún código debe casar el texto). */
const IDIOMA = 'Español'
/** Formato de fecha de la sesión: los literales `'AAAA-MM-DD …'` se leen igual en cualquier idioma. */
const FORMATO_FECHA = 'ymd'
/** Nombre de la aplicación que ve el servidor (`program_name` en sys.dm_exec_sessions). */
const NOMBRE_APP = 'Tessera'
/** Tope para conectar: el de tedious (una instancia sin SQL Browser espera esto entero). */
const TIMEOUT_CONEXION_MS = 15000
/** Tope para que el servidor atienda un Stop (attention). */
const TIMEOUT_CANCELAR_MS = 5000
/** Tope de espera de un bloqueo en las sesiones que lo llevan (`sqlInicioSesion`). */
const TOPE_BLOQUEO_MS = 10000
/** El error del servidor al vencer `SET LOCK_TIMEOUT`. */
const CODIGO_BLOQUEO = '1222'
/** Infos del servidor que no son salida del usuario: 5701 (cambio de base), 5703 (idioma). */
const INFOS_DE_CONTEXTO = Object.freeze([5701, 5703])

// --- Autenticación (copia CJS de `shared/motores/autenticacion.ts`) --------------------

/** Los valores de `DbAutenticacion` (= `AUTENTICACIONES` de shared; lo cruza el test). */
const AUTENTICACIONES = Object.freeze(['sql', 'ntlm'])

function nunca(valor, contexto) {
  throw new Error(`Caso sin contemplar en ${contexto}: ${JSON.stringify(valor)}`)
}

/** ¿Es un valor de `DbAutenticacion`? (= `esAutenticacion` de shared). */
function esAutenticacion(x) {
  return typeof x === 'string' && AUTENTICACIONES.indexOf(x) >= 0
}

/** ¿Pide esta autenticación el dominio? (= `pideDominio` de shared). */
function pideDominio(a) {
  switch (a) {
    case 'sql':
      return false
    case 'ntlm':
      return true
    default:
      return nunca(a, 'pideDominio')
  }
}

// --- Errores de Tessera -----------------------------------------------------------------

/**
 * Un error con código de Tessera ('TESSERA-MSSQL-…'). Códigos: CONFIG (la conexión guardada
 * no se puede usar), CERTIFICADO, INSTANCIA, SIN-RESPUESTA, RECHAZADA, EXACTOS.
 */
function errorSqlServer(codigo, mensaje, extra) {
  const e = new Error(mensaje)
  e.codigo = `TESSERA-MSSQL-${codigo}`
  if (extra) Object.assign(e, extra)
  return e
}

// --- Configuración de la conexión (pura) ---------------------------------------------

/**
 * Las CA en las que se confía al VERIFICAR el certificado del servidor: las del paquete de
 * Node y las del SISTEMA (almacén de Windows, llavero de macOS), sin repetir. `tlsMod` entra
 * por parámetro (el test lo sustituye). null si este Node no sabe leerlas (entonces tedious
 * usa las de Node).
 */
function certificadosDeConfianza(tlsMod) {
  const t = tlsMod || require('node:tls')
  if (!t || typeof t.getCACertificates !== 'function') return null
  const vistos = new Set()
  const salida = []
  for (const tipo of ['bundled', 'system']) {
    let lista
    try {
      lista = t.getCACertificates(tipo) || []
    } catch {
      lista = []
    }
    for (const c of lista) {
      if (!vistos.has(c)) {
        vistos.add(c)
        salida.push(c)
      }
    }
  }
  return salida.length > 0 ? salida : null
}

/** El cifrado efectivo de una conexión: el guardado o, sin él, cifrar y verificar (`TLS_POR_DEFECTO`). */
function tlsDe(con) {
  const t = con && con.tls
  if (t && typeof t === 'object' && typeof t.cifrar === 'boolean' && typeof t.confiarCertificado === 'boolean') {
    return { cifrar: t.cifrar, confiarCertificado: t.confiarCertificado }
  }
  return { cifrar: true, confiarCertificado: false }
}

/**
 * La autenticación de tedious: 'sql' (login del servidor, `type: 'default'`) o 'ntlm' (cuenta
 * de dominio con su clave). Lanza TESSERA-MSSQL-CONFIG si no se puede usar: mejor eso que
 * mandar la clave como otra cuenta.
 */
function autenticacionTedious(con, secreto) {
  const autenticacion = con.autenticacion === undefined || con.autenticacion === null ? 'sql' : con.autenticacion
  if (!esAutenticacion(autenticacion)) {
    throw errorSqlServer('CONFIG', `Autenticación desconocida: "${String(autenticacion)}". Actualiza Tessera o edita la conexión.`)
  }
  const usuario = typeof con.user === 'string' ? con.user : ''
  const clave = typeof secreto === 'string' ? secreto : ''
  if (!pideDominio(autenticacion)) return { type: 'default', options: { userName: usuario, password: clave } }
  const dominio = typeof con.dominio === 'string' ? con.dominio.trim() : ''
  if (!dominio) throw errorSqlServer('CONFIG', 'La conexión usa una cuenta de dominio pero no tiene el dominio.')
  return { type: 'ntlm', options: { userName: usuario, password: clave, domain: dominio } }
}

/** Las opciones de tedious de una conexión (ver `opcionesConexion`). */
function opcionesTedious(con, t, o) {
  const instancia = typeof con.instancia === 'string' ? con.instancia.trim() : ''
  const opciones = {
    appName: o.appName || NOMBRE_APP,
    encrypt: t.cifrar,
    trustServerCertificate: t.confiarCertificado,
    connectTimeout: TIMEOUT_CONEXION_MS,
    // 0 = SIN tope: el de fábrica de tedious, 15 s, mata una consulta larga.
    requestTimeout: Number.isInteger(o.requestTimeoutMs) && o.requestTimeoutMs > 0 ? o.requestTimeoutMs : 0,
    cancelTimeout: TIMEOUT_CANCELAR_MS,
    // Con XACT_ABORT, un Stop revierte la transacción entera; sin él, sobrevive.
    abortTransactionOnError: false,
    language: IDIOMA,
    dateFormat: FORMATO_FECHA,
    // Tres columnas llamadas 'b' conviven (una sin nombre llega como '') y las filas van en flujo.
    useColumnNames: false,
    rowCollectionOnRequestCompletion: false
  }
  // Una instancia con nombre va SIN puerto: tedious no admite los dos (se resuelve por SQL Browser, UDP 1434).
  if (instancia) opciones.instanceName = instancia
  else opciones.port = Number(con.port)
  if (typeof con.database === 'string' && con.database.trim() !== '') opciones.database = con.database.trim()
  if (Number.isInteger(o.textsize) && o.textsize > 0) opciones.textsize = o.textsize
  // Verificando, las CA del sistema además de las del paquete; confiando, no hace falta ninguna.
  if (t.cifrar && !t.confiarCertificado && Array.isArray(o.cas) && o.cas.length > 0) {
    opciones.cryptoCredentialsDetails = { ca: o.cas }
  }
  return opciones
}

/**
 * La configuración de tedious (`new Connection(config)`) de una conexión del registro
 * (`ConexionTrabajador` o la entrada que lee `tdb`). Lanza TESSERA-MSSQL-CONFIG si la entrada
 * no se puede usar (una autenticación desconocida, NTLM sin dominio).
 *
 * `o`: { requestTimeoutMs (0 = sin tope, el de por defecto), textsize (bytes; sin él, el de
 * tedious), cas (las CA, de `certificadosDeConfianza`; null = las de Node), appName }.
 */
function opcionesConexion(con, secreto, o = {}) {
  if (!con || typeof con.host !== 'string' || con.host.trim() === '') {
    throw errorSqlServer('CONFIG', 'La conexión no tiene servidor.')
  }
  const authentication = autenticacionTedious(con, secreto)
  const options = opcionesTedious(con, tlsDe(con), o)
  return { server: con.host.trim(), authentication, options }
}

/**
 * Lo que se manda nada más conectar, según para qué es la sesión. '' si nada. `proposito`:
 * 'meta' (el árbol: LOCK_TIMEOUT y READ UNCOMMITTED, para que un CREATE TABLE sin confirmar no
 * cuelgue la consulta de `sys.objects`), 'datos' (la rejilla, «Enviar», el valor de una celda:
 * LOCK_TIMEOUT), 'consola' y 'exportar' (sin tope: las detiene Stop) o 'cli' (`tdb`: con tope,
 * un agente no debe quedarse colgado detrás de la transacción del usuario).
 */
function sqlInicioSesion(proposito) {
  switch (proposito) {
    case 'meta':
      return `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT ${TOPE_BLOQUEO_MS}`
    case 'datos':
    case 'cli':
      return `SET LOCK_TIMEOUT ${TOPE_BLOQUEO_MS}`
    case 'consola':
    case 'exportar':
      return ''
    default:
      return nunca(proposito, 'sqlInicioSesion')
  }
}

// --- Conectar -----------------------------------------------------------------------------

/** tedious, cargado cuando hace falta (tarda ~170 ms; una sesión de Oracle no debe pagarlo). */
function cargarTedious() {
  return require('tedious')
}

/**
 * Conecta y resuelve el `Connection` de tedious ya listo, o rechaza con el error tal cual
 * (pásalo por `normalizarError`). Con los valores exactos instalados antes. El login fallido de
 * tedious (ELOGIN) no trae el número del servidor: se toma del último `errorMessage` que llegó
 * durante el login (18456 y compañía).
 */
function conectar(config, o = {}) {
  const tedious = o.tedious || cargarTedious()
  if (o.exactos !== false) exactos.instalarValoresExactos(o.valueParser)
  return new Promise((resolve, reject) => {
    let conexion
    try {
      conexion = new tedious.Connection(config)
    } catch (e) {
      reject(e)
      return
    }
    let ultimoMensaje = null
    const alMensaje = (m) => {
      ultimoMensaje = m
    }
    conexion.on('errorMessage', alMensaje)
    // Un 'error' sin oyente tumba el proceso; mientras se conecta, el de `connect` basta.
    const alError = () => {}
    conexion.on('error', alError)
    conexion.connect((err) => {
      conexion.removeListener('errorMessage', alMensaje)
      conexion.removeListener('error', alError)
      if (err) {
        if (ultimoMensaje && err.number === undefined && typeof ultimoMensaje.number === 'number') {
          err.number = ultimoMensaje.number
          if (err.class === undefined) err.class = ultimoMensaje.class
        }
        try {
          conexion.close()
        } catch {
          // Se dice el error de conectar, no el de cerrar.
        }
        reject(err)
        return
      }
      resolve(conexion)
    })
  })
}

/** Cierra la conexión y espera a que se cierre (o a que pase `ms`). */
function cerrar(conexion, ms = 2000) {
  return new Promise((resolve) => {
    if (!conexion || conexion.closed) {
      resolve()
      return
    }
    const t = setTimeout(resolve, ms)
    if (t && typeof t.unref === 'function') t.unref()
    conexion.once('end', () => {
      clearTimeout(t)
      resolve()
    })
    try {
      conexion.close()
    } catch {
      clearTimeout(t)
      resolve()
    }
  })
}

// --- Errores -----------------------------------------------------------------------------

/** Los errores que cuelgan de uno (AggregateError de tedious: `errors`). */
function erroresDe(err) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) return err.errors
  return [err]
}

/** La causa TLS de un error de conexión (tedious envuelve el de Node en `cause`). */
function causaTls(err) {
  let e = err
  for (let i = 0; i < 4 && e; i++) {
    const codigo = typeof e.code === 'string' ? e.code : ''
    const msg = typeof e.message === 'string' ? e.message : ''
    if (
      /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS/.test(codigo) ||
      /self[- ]signed certificate|unable to verify|certificate (has expired|is not yet valid)|Hostname\/IP does not match/i.test(msg)
    ) {
      return e
    }
    e = e.cause
  }
  return null
}

/** ¿Deja el error la conexión inservible? ESOCKET, EINVALIDSTATE, ECLOSE o severidad >= 20 (596 de un KILL, 233…). */
function esPerdida(err) {
  if (!err) return false
  for (const e of erroresDe(err)) {
    if (!e) continue
    if (e.code === 'ESOCKET' || e.code === 'EINVALIDSTATE' || e.code === 'ECLOSE') return true
    if (typeof e.class === 'number' && e.class >= 20) return true
  }
  return false
}

/** «Error 208 (línea 3): …» para las líneas de `detalle`. */
function lineaDeError(e) {
  const partes = []
  if (typeof e.number === 'number') partes.push(`Error ${e.number}`)
  if (typeof e.lineNumber === 'number' && e.lineNumber > 0) partes.push(`línea ${e.lineNumber}`)
  const cab = partes.length ? `${partes.join(', ')}: ` : ''
  return cab + String(e.message || '')
}

/** El error de conexión que el usuario arregla con un mensaje claro, o null. `d` = { err, con, primero, codigo, servidor }. */
function errorDeConexion(d) {
  const { err, con, primero, codigo, servidor } = d
  const tlsMalo = causaTls(err)
  if (tlsMalo) {
    return {
      mensaje:
        `No se pudo verificar el certificado de ${servidor} (${String(tlsMalo.message || tlsMalo.code)}). ` +
        'Si es un servidor de tu red con un certificado propio, marca «Confiar en el certificado del servidor» en la conexión.',
      codigo: 'TESSERA-MSSQL-CERTIFICADO',
      clase: 'servidor'
    }
  }
  if (codigo === 'EINSTLOOKUP' || (con && con.instancia && codigo === 'ETIMEOUT' && /\\/.test(String(primero.message)))) {
    return {
      mensaje:
        `No se encontró la instancia «${con && con.instancia ? con.instancia : ''}» en ${con ? con.host : 'el servidor'}: ` +
        'hace falta el servicio SQL Browser (UDP 1434) abierto, o escribe el puerto de la instancia y deja vacía la instancia.',
      codigo: 'TESSERA-MSSQL-INSTANCIA',
      clase: 'servidor'
    }
  }
  if (codigo === 'ESOCKET' && /ECONNREFUSED/.test(String(primero.message))) {
    return {
      mensaje: `${servidor} rechazó la conexión: comprueba el servidor y el puerto, y que SQL Server acepte conexiones TCP.`,
      codigo: 'TESSERA-MSSQL-RECHAZADA',
      clase: 'perdida'
    }
  }
  if (codigo === 'ETIMEOUT' && /connect/i.test(String(primero.message))) {
    return {
      mensaje: `${servidor} no respondió en ${TIMEOUT_CONEXION_MS / 1000} s: comprueba el servidor, el puerto y la red (VPN, cortafuegos).`,
      codigo: 'TESSERA-MSSQL-SIN-RESPUESTA',
      clase: 'timeout'
    }
  }
  return null
}

/** El error de una petición: manda el primero, el resto va a `detalle`; la clase sale de ECANCEL, ETIMEOUT y `esPerdida`. */
function errorDePeticion(err, lista, primero, codigoTedious) {
  const e = { mensaje: String(primero.message || (err && err.message) || 'Error desconocido de SQL Server'), clase: 'servidor' }
  if (typeof primero.number === 'number') e.codigo = String(primero.number)
  else if (codigoTedious) e.codigo = codigoTedious
  if (typeof primero.lineNumber === 'number' && primero.lineNumber > 0) e.linea = primero.lineNumber
  if (typeof primero.procName === 'string' && primero.procName !== '') e.objeto = primero.procName
  if (lista.length > 1) e.detalle = lista.slice(1).map(lineaDeError).join('\n')
  if (codigoTedious === 'ECANCEL') e.clase = 'cancelada'
  else if (codigoTedious === 'ETIMEOUT') e.clase = 'timeout'
  else if (esPerdida(err)) e.clase = 'perdida'
  return e
}

/**
 * Un error de tedious (de conectar o de una petición) como `ErrorTrabajador` (`{mensaje, codigo,
 * clase, linea, objeto, detalle}`). El `codigo` es el NÚMERO del error de SQL Server como texto
 * ('1222', '208'); los fallos de conexión propios llevan 'TESSERA-MSSQL-…'. Varios errores a la
 * vez llegan como AggregateError con `message` vacío: manda el primero y el resto va a `detalle`.
 * Clases: 'cancelada', 'timeout', 'perdida' y 'servidor'. `con` (opcional) da el servidor y la
 * instancia para los mensajes de conexión.
 */
function normalizarError(err, con) {
  if (err && typeof err.codigo === 'string' && err.codigo.startsWith('TESSERA-')) {
    return { mensaje: String(err.message), codigo: err.codigo, clase: 'servidor' }
  }
  const lista = erroresDe(err)
  const primero = lista[0] || err || {}
  const codigoTedious = typeof primero.code === 'string' ? primero.code : typeof (err && err.code) === 'string' ? err.code : ''
  const servidor = con && con.host ? (con.instancia ? `${con.host}\\${con.instancia}` : `${con.host}:${con.port}`) : 'el servidor'
  return errorDeConexion({ err, con, primero, codigo: codigoTedious, servidor }) ?? errorDePeticion(err, lista, primero, codigoTedious)
}

/**
 * Una info del servidor (`infoMessage`: PRINT, RAISERROR ≤ 10, avisos) como línea de salida
 * (`DbLineaSalida`), o null si es de contexto (5701 al cambiar de base, 5703 de idioma: no
 * son del usuario). La base NUEVA tras un `USE` no se saca del texto de la 5701 (va en
 * español o en inglés): la da el evento `databaseChange` de la conexión de tedious.
 */
function lineaDeInfo(info) {
  if (!info || INFOS_DE_CONTEXTO.indexOf(info.number) >= 0) return null
  const linea = { texto: String(info.message || '') }
  // Un RAISERROR de nivel 1-10 es un aviso; un PRINT llega con clase 0.
  if (typeof info.class === 'number' && info.class > 0) linea.aviso = true
  return linea
}

// --- Pruebas ------------------------------------------------------------------------------------

/**
 * El destino de una prueba contra un servidor real, de una variable de entorno con la forma
 * `usuario/clave@host:puerto[/base]` (la escribe `scripts/pruebas/mssql.sh`). La clave no puede
 * llevar `/` ni `@`. null si no viene o no casa.
 */
function destinoDePrueba(texto) {
  if (typeof texto !== 'string' || texto === '') return null
  const m = /^([^/@]+)\/([^@]*)@([^:/]+):(\d+)(?:\/(.*))?$/.exec(texto)
  if (!m) return null
  return { user: m[1], secreto: m[2], host: m[3], port: Number(m[4]), database: m[5] || undefined }
}

module.exports = {
  VERSION_TEDIOUS,
  IDIOMA,
  FORMATO_FECHA,
  NOMBRE_APP,
  TIMEOUT_CONEXION_MS,
  TIMEOUT_CANCELAR_MS,
  TOPE_BLOQUEO_MS,
  CODIGO_BLOQUEO,
  INFOS_DE_CONTEXTO,
  AUTENTICACIONES,
  esAutenticacion,
  pideDominio,
  errorSqlServer,
  certificadosDeConfianza,
  tlsDe,
  opcionesConexion,
  sqlInicioSesion,
  cargarTedious,
  conectar,
  cerrar,
  esPerdida,
  normalizarError,
  lineaDeInfo,
  textoExacto: exactos.textoExacto,
  instalarValoresExactos: exactos.instalarValoresExactos,
  valoresExactos: exactos.valoresExactos,
  COMANDOS_DONE: exactos.COMANDOS_DONE,
  CURCMD_SELECT: exactos.CURCMD_SELECT,
  instalarComandoDone: exactos.instalarComandoDone,
  comandoDone: exactos.comandoDone,
  esCuentaDeEscritura: exactos.esCuentaDeEscritura,
  tipoMotorSqlServer: celdasSqlserver.tipoMotorSqlServer,
  tipoLogicoSqlServer: celdasSqlserver.tipoLogicoSqlServer,
  columnasSqlServer: celdasSqlserver.columnasSqlServer,
  celdaSqlServer: celdasSqlserver.celdaSqlServer,
  filaSqlServer: celdasSqlserver.filaSqlServer,
  destinoDePrueba
}
