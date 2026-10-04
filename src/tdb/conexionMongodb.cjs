// =============================================================================
// La CONEXIÓN a MongoDB: de la conexión del trabajador (`host`, `port`, `user`, `database`, `tls`,
// `srv`, `opcionesUri`) a la URI y las opciones del driver, y `conectar`, que abre el cliente y lee
// la topología. La contraseña va en `opciones.auth`, nunca en la URI; `directConnection=true` con
// un solo host sin `srv`. Depende de `cargaMongodb.cjs`, `erroresMongodb.cjs` y, al conectar con
// cifrado verificado, de `sqlserverComun.cjs` (sus CA del sistema).
// Decisiones: docs/decisiones/bd/mongodb-conexion-y-tipos.md
// =============================================================================
'use strict'

const { cargarMongo } = require('./cargaMongodb.cjs')
const { errorConfig } = require('./erroresMongodb.cjs')

const TIMEOUT_CONEXION_MS = 15000

/** El cifrado efectivo: el de la conexión o, sin él, sin cifrar salvo con `srv`. */
function tlsDe(con) {
  const t = con && con.tls
  if (t && typeof t === 'object') return { cifrar: t.cifrar === true, confiarCertificado: t.confiarCertificado === true }
  // Sin decir nada: lo de MongoDB (sin cifrar), salvo `+srv`, que cifra por defecto.
  return { cifrar: Boolean(con && con.srv === true), confiarCertificado: false }
}

/** `clave=valor&…` -> pares decodificados, sin las claves de TLS (van en `tls`). */
function paresDeOpciones(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') return []
  const pares = []
  for (const trozo of texto.replace(/^\?/, '').split('&')) {
    if (!trozo) continue
    const i = trozo.indexOf('=')
    let k = i < 0 ? trozo : trozo.slice(0, i)
    let v = i < 0 ? '' : trozo.slice(i + 1)
    try {
      k = decodeURIComponent(k)
      v = decodeURIComponent(v)
    } catch {
      throw errorConfig(`Las opciones de la URI no están bien codificadas («${trozo}»).`)
    }
    k = k.trim()
    if (!k || /^(tls|ssl)/i.test(k)) continue
    pares.push([k, v])
  }
  return pares
}

/** El host de la conexión, validado: uno solo, sin usuario ni opciones. */
function hostDe(con) {
  const host = typeof con.host === 'string' ? con.host.trim() : ''
  if (!host) throw errorConfig('La conexión no tiene servidor.')
  if (/[\s,/?#@]/.test(host)) throw errorConfig(`«${host}» no es un servidor válido (un solo host, sin usuario ni opciones).`)
  return host
}

// Sin `authSource`, el driver AUTENTICA en la base de la ruta (la del árbol), como mongosh: no se
// fuerza `admin`, porque rompe al usuario creado en su propia base. El remedio es `authSource` en
// las opciones de la URI, que el formulario enseña como «Base de autenticación».
function uriDe(con, host, srv, pares) {
  const hostUri = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  let uri = (srv ? 'mongodb+srv://' : 'mongodb://') + hostUri
  if (!srv) {
    const p = Number(con.port)
    uri += ':' + (Number.isInteger(p) && p > 0 && p < 65536 ? p : 27017)
  }
  uri += '/'
  const base = typeof con.database === 'string' ? con.database.trim() : ''
  if (base) uri += encodeURIComponent(base)
  if (pares.length > 0) uri += '?' + pares.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return uri
}

/** El nombre de la aplicación y los tiempos, salvo lo que ya dicen las opciones de la URI. */
function opcionesDeTiempo(claves, o) {
  const opciones = {}
  if (!claves.has('appname')) opciones.appName = (o.appName || 'Tessera').slice(0, 128)
  if (!claves.has('serverselectiontimeoutms')) opciones.serverSelectionTimeoutMS = TIMEOUT_CONEXION_MS
  if (!claves.has('connecttimeoutms')) opciones.connectTimeoutMS = TIMEOUT_CONEXION_MS
  return opciones
}

/** Lo que el cifrado añade a las opciones del driver: certificado sin verificar o las CA de confianza. */
function opcionesDeCifrado(t, cas) {
  const opciones = {}
  if (t.cifrar && t.confiarCertificado) opciones.tlsAllowInvalidCertificates = true
  // Verificando, las CA del sistema además de las del paquete (como SQL Server): `ca`
  // SUSTITUYE al almacén por defecto de Node, así que va con las dos.
  if (t.cifrar && !t.confiarCertificado && Array.isArray(cas) && cas.length > 0) opciones.ca = cas
  return opciones
}

/** `{ uri, opciones }` del driver. `secreto` '' = sin contraseña; `uri` no lleva secreto ni usuario. */
function opcionesCliente(conexion, secreto, o = {}) {
  const con = conexion || {}
  const host = hostDe(con)
  const srv = con.srv === true
  const pares = paresDeOpciones(con.opcionesUri)
  const claves = new Set(pares.map(([k]) => k.toLowerCase()))
  if (!srv && !claves.has('replicaset') && !claves.has('directconnection') && !claves.has('loadbalanced')) {
    pares.push(['directConnection', 'true'])
  }
  const uri = uriDe(con, host, srv, pares)
  const t = tlsDe(con)
  const opciones = { tls: t.cifrar, ...opcionesDeTiempo(claves, o), ...opcionesDeCifrado(t, o.cas) }
  const usuario = typeof con.user === 'string' ? con.user : ''
  if (usuario) {
    opciones.auth = { username: usuario }
    if (typeof secreto === 'string' && secreto !== '') opciones.auth.password = secreto
  }
  return { uri, opciones }
}

/** Abre el cliente y lee la topología: `{ cliente, topologia: { transacciones, version, replicaSet } }`. */
async function conectar(conexion, secreto, o = {}) {
  const { MongoClient } = cargarMongo()
  const t = tlsDe(conexion || {})
  // Las CA del sistema, con la misma función que SQL Server (sin cargar tedious: es perezoso).
  const cas = t.cifrar && !t.confiarCertificado ? require('./sqlserverComun.cjs').certificadosDeConfianza() : null
  const { uri, opciones } = opcionesCliente(conexion, secreto, { ...o, cas })
  const cliente = new MongoClient(uri, opciones)
  try {
    await cliente.connect()
    const admin = cliente.db('admin')
    const hello = await admin.command({ hello: 1 })
    let version = ''
    try {
      const bi = await admin.command({ buildInfo: 1 })
      version = typeof bi.version === 'string' ? bi.version : ''
    } catch {
      version = ''
    }
    const replicaSet = typeof hello.setName === 'string' && hello.setName ? hello.setName : null
    const transacciones = replicaSet !== null || hello.msg === 'isdbgrid'
    return { cliente, topologia: { transacciones, version, replicaSet } }
  } catch (err) {
    try {
      await cliente.close()
    } catch {
      // se informa del error de conexión, no del cierre
    }
    throw err
  }
}

module.exports = { opcionesCliente, conectar }
