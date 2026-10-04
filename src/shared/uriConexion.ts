// =============================================================================
// «Pegar URI» del formulario de conexión: `descomponerUriMongo` y `descomponerUriRedis` la reparten en
// campos; `validarOpcionesUriMongo` y `validarBaseRedis` validan lo que se guarda, y las usan el
// formulario y el main, así que las dos puntas dicen lo mismo. Puro, sin DOM ni `process`.
// Decisiones: docs/decisiones/bd/uri-mongodb-al-pegar.md, docs/decisiones/bd/uri-redis-al-pegar.md
// =============================================================================

import type { DbTls } from './db-ipc.ts'
import { descriptor, tlsDeConexion } from './motores/index.ts'

/** Las claves de `opcionesUri` que se aceptan (lo demás se rechaza al guardar). */
export const OPCIONES_URI_MONGO: readonly string[] = [
  'authSource',
  'authMechanism',
  'replicaSet',
  'directConnection',
  'readPreference',
  'readPreferenceTags',
  'loadBalanced',
  'appName',
  'retryWrites',
  'retryReads',
  'w',
  'journal',
  'readConcernLevel',
  'maxPoolSize',
  'connectTimeoutMS',
  'serverSelectionTimeoutMS',
  'socketTimeoutMS'
]

/**
 * Lo COMÚN de lo que sale de una URI, del motor que sea: lo que el formulario
 * rellena al pegarla (`conUri`). Lo propio de un motor (el SRV y las opciones de Mongo) va en
 * su extensión, y un campo que el motor no trae el formulario no lo toca.
 */
export interface CamposUri {
  host: string
  /** null = la URI no lleva puerto y el motor no lo usa (Mongo con srv). */
  port: number | null
  user: string
  password: string
  database: string
  tls: DbTls
  /** Lo de la URI que no se guarda, para decirlo. */
  descartadas: string[]
  srv?: boolean
  opcionesUri?: string
}

export interface CamposUriMongo extends CamposUri {
  srv: boolean
  opcionesUri: string
}

/** Redis: el puerto siempre (6379 sin decirlo) y la base como su número en texto. */
export interface CamposUriRedis extends CamposUri {
  port: number
}

/** Lo que devuelve una descomposición: los campos, o por qué no se pudo. */
export type ResultadoUri<T> = { ok: true; campos: T } | { ok: false; error: string }

// --- Validación de las opciones (genérica) ----------------------------------------------

/** Cómo se validan las opciones de una URI de un motor. Claves sin distinguir mayúsculas. */
interface ReglasOpciones {
  admitidas: readonly string[]
  /** Las que valen `true` o `false`. */
  booleanas: readonly string[]
  /** Las que son un entero no negativo. */
  enteras: readonly string[]
  /** Las que el driver admite repetidas. */
  repetibles: readonly string[]
  /** Las que el driver admite VACÍAS (`readPreferenceTags=`: «cualquier etiqueta», el último recurso). */
  admitenVacio: readonly string[]
  /** ¿Es una opción de cifrado? (va en las casillas de TLS, no aquí). */
  esTls: (claveMinusculas: string) => boolean
}

const CLAVES_CREDENCIALES = ['user', 'username', 'password', 'pass', 'pwd']

const REGLAS_MONGO: ReglasOpciones = {
  admitidas: OPCIONES_URI_MONGO,
  booleanas: ['directConnection', 'loadBalanced', 'retryWrites', 'retryReads', 'journal'],
  enteras: ['maxPoolSize', 'connectTimeoutMS', 'serverSelectionTimeoutMS', 'socketTimeoutMS'],
  repetibles: ['readPreferenceTags'],
  admitenVacio: ['readPreferenceTags'],
  esTls: (k) => k === 'ssl' || k.startsWith('tls')
}

const minus = (xs: readonly string[]): string[] => xs.map((x) => x.toLowerCase())

/** `decodeURIComponent` que no lanza: null si hay un `%` que no es de un carácter codificado. */
function decodificar(s: string): string | null {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/** Una opción `clave=valor`; `valor` crudo (tal como va en la URI). */
interface Opcion {
  clave: string
  valor: string
}

/**
 * Parte `a=1&b=2` en opciones (los `&` de sobra no cuentan), o el error de la primera mala.
 * Un valor vacío es un error salvo en las claves de `r.admitenVacio` (como el driver).
 */
function partirOpciones(texto: string, r: ReglasOpciones): { ok: true; opciones: Opcion[] } | { ok: false; error: string } {
  const vacias = minus(r.admitenVacio)
  const opciones: Opcion[] = []
  for (const trozo of texto.split('&')) {
    if (trozo === '') continue
    const igual = trozo.indexOf('=')
    const clave = igual < 0 ? trozo : trozo.slice(0, igual)
    const valor = igual < 0 ? '' : trozo.slice(igual + 1)
    if (clave === '') return { ok: false, error: `Falta la clave en «${trozo}» (clave=valor).` }
    if (igual < 0 || (valor === '' && !vacias.includes(clave.toLowerCase()))) {
      return { ok: false, error: `La opción «${clave}» no lleva valor (clave=valor).` }
    }
    opciones.push({ clave, valor })
  }
  return { ok: true, opciones }
}

/** Valida unas opciones YA PARTIDAS con las reglas de un motor. */
function validarPartidas(opciones: readonly Opcion[], r: ReglasOpciones): string | null {
  const admitidas = minus(r.admitidas)
  const booleanas = minus(r.booleanas)
  const enteras = minus(r.enteras)
  const repetibles = minus(r.repetibles)
  const vistas = new Set<string>()
  for (const { clave, valor } of opciones) {
    const k = clave.toLowerCase()
    if (r.esTls(k)) return `El cifrado no va en las opciones («${clave}»): usa las casillas de TLS de la conexión.`
    if (CLAVES_CREDENCIALES.includes(k)) return `Usuario y contraseña van en sus campos, no en las opciones («${clave}»).`
    if (!admitidas.includes(k)) return `«${clave}» no es una opción admitida. Se admiten: ${r.admitidas.join(', ')}.`
    if (vistas.has(k) && !repetibles.includes(k)) return `La opción «${clave}» está repetida.`
    vistas.add(k)
    const decodificado = decodificar(valor)
    if (decodificado === null) return `El valor de «${clave}» lleva un % que no es de un carácter codificado: escríbelo como %25.`
    if (booleanas.includes(k) && !/^(true|false)$/i.test(decodificado)) return `«${clave}» vale true o false.`
    if (enteras.includes(k) && !/^\d+$/.test(decodificado)) return `«${clave}» es un número entero.`
  }
  return null
}

/** `clave=valor&clave=valor` con las reglas de un motor: null si vale, o el mensaje. */
function validarOpciones(texto: string, r: ReglasOpciones): string | null {
  const t = texto.trim()
  if (t === '') return null
  if (t.startsWith('?')) return 'Sin el «?» del principio: solo clave=valor&clave=valor.'
  if (/[\s#]/.test(t)) return 'Las opciones no llevan espacios ni «#».'
  const p = partirOpciones(t, r)
  if (!p.ok) return p.error
  return validarPartidas(p.opciones, r)
}

/**
 * El campo «Base de autenticación» del formulario de MongoDB
 * ES el `authSource` de las opciones: no se guarda aparte, así que ni el main, ni `tdb`, ni la
 * huella de destino cambian. El formulario lo SACA de las opciones al abrir una conexión o al
 * pegar una URI (`separarAuthSource`) y lo VUELVE A PONER al guardar (`unirAuthSource`) en el
 * MISMO sitio y con el MISMO texto si no se tocó: el main compara las opciones al byte para
 * decidir si la conexión deja de estar probada, y reordenarlas la desverificaría sin motivo.
 */
export interface OrigenAuthSource {
  /** Posición del par entre las opciones (sin contar los `&` de sobra). */
  indice: number
  /** El par tal como estaba (`authsource=admin`, `authSource=%24external`…). */
  par: string
}

export interface AuthSourceSeparado {
  /** El valor, decodificado ('' = no había). */
  authSource: string
  /** Las demás opciones, en su orden. */
  resto: string
  origen: OrigenAuthSource | null
}

const esParAuthSource = (trozo: string): boolean => {
  const igual = trozo.indexOf('=')
  return igual > 0 && trozo.slice(0, igual).toLowerCase() === 'authsource'
}

/**
 * Saca el `authSource` de unas opciones. Si no hay uno solo y legible (repetido, o con un `%`
 * suelto), NO se toca nada: se queda en las opciones y lo dice su validación.
 */
export function separarAuthSource(opciones: string): AuthSourceSeparado {
  const t = opciones.trim()
  const trozos = t.split('&').filter((x) => x !== '')
  const indices = trozos.flatMap((x, i) => (esParAuthSource(x) ? [i] : []))
  if (indices.length !== 1) return { authSource: '', resto: t, origen: null }
  const indice = indices[0]
  const par = trozos[indice]
  const valor = decodificar(par.slice(par.indexOf('=') + 1))
  if (valor === null) return { authSource: '', resto: t, origen: null }
  return { authSource: valor, resto: trozos.filter((_, i) => i !== indice).join('&'), origen: { indice, par } }
}

/** Lo contrario de `separarAuthSource`: '' en la base es «sin `authSource`». */
export function unirAuthSource(resto: string, authSource: string, origen: OrigenAuthSource | null): string {
  const a = authSource.trim()
  const r = resto.trim()
  if (a === '') return r
  const intacto = origen !== null && decodificar(origen.par.slice(origen.par.indexOf('=') + 1)) === a
  const par = intacto ? origen.par : `authSource=${encodeURIComponent(a)}`
  const trozos = r.split('&').filter((x) => x !== '')
  const indice = origen === null ? trozos.length : Math.min(origen.indice, trozos.length)
  trozos.splice(indice, 0, par)
  return trozos.join('&')
}

/**
 * Las opciones tal como las teclea el formulario, SIN el `authSource`: ese va en su campo
 * (la base de autenticación), y escrito aquí también, el main lo rechazaría por repetido.
 */
export function validarOpcionesFormularioMongo(texto: string): string | null {
  // Solo uno que se podría SACAR a su campo (uno y legible): repetido o con un `%` suelto, lo
  // que vale es el error de verdad del main («va en su campo» lo tapaba).
  if (separarAuthSource(texto).origen !== null) {
    return 'La base de autenticación (authSource) va en su campo, no en las opciones.'
  }
  return validarOpcionesUriMongo(texto)
}

export function validarOpcionesUriMongo(texto: string): string | null {
  return validarOpciones(texto, REGLAS_MONGO)
}

// --- Corte de la URI (genérico: MongoDB y Redis) ----------------------------------------

/** Una URI partida, con sus trozos CRUDOS salvo usuario y clave (ya decodificados). */
interface UriPartida {
  /** En minúsculas, sin `://`. */
  esquema: string
  user: string
  password: string
  /** La lista de hosts tal cual (`h1:27017`, `[::1]`), sin decodificar. */
  hosts: string[]
  /** La ruta sin la barra del principio, decodificada. */
  ruta: string
  /** Lo de detrás de `?`, sin el `?` y crudo. */
  consulta: string
}

/** La autoridad de una URI (`usuario:clave@hosts`) y lo que va detrás de ella (`/base?opciones`). */
interface AutoridadUri {
  user: string
  password: string
  listaHosts: string
  tras: string
}

function partirAutoridad(resto: string): ResultadoUri<AutoridadUri> {
  // La autoridad acaba en la primera `/` o `?`; el usuario, en su ÚLTIMA `@`.
  const finAutoridad = resto.search(/[/?]/)
  const autoridad = finAutoridad < 0 ? resto : resto.slice(0, finAutoridad)
  const tras = finAutoridad < 0 ? '' : resto.slice(finAutoridad)
  const arroba = autoridad.lastIndexOf('@')
  const info = arroba < 0 ? '' : autoridad.slice(0, arroba)
  const listaHosts = arroba < 0 ? autoridad : autoridad.slice(arroba + 1)
  const dosPuntos = info.indexOf(':')
  const user = decodificar(dosPuntos < 0 ? info : info.slice(0, dosPuntos))
  const password = decodificar(dosPuntos < 0 ? '' : info.slice(dosPuntos + 1))
  if (user === null) return { ok: false, error: 'El usuario lleva un % que no es de un carácter codificado: escríbelo como %25.' }
  if (password === null) return { ok: false, error: 'La contraseña lleva un % que no es de un carácter codificado: escríbelo como %25.' }
  if (listaHosts === '') return { ok: false, error: 'Falta el host de la URI.' }
  return { ok: true, campos: { user, password, listaHosts, tras } }
}

function partirUri(uri: string, esquemas: readonly string[]): ResultadoUri<UriPartida> {
  const t = uri.trim()
  const esperados = esquemas.map((e) => `${e}://`).join(' o ')
  const sep = t.indexOf('://')
  const esquema = sep < 0 ? '' : t.slice(0, sep).toLowerCase()
  if (sep < 0 || !esquemas.includes(esquema)) return { ok: false, error: `La URI tiene que empezar por ${esperados}.` }
  // Lo de detrás de `#` no es de la URI (un fragmento): fuera.
  let resto = t.slice(sep + 3)
  const almohadilla = resto.indexOf('#')
  if (almohadilla >= 0) resto = resto.slice(0, almohadilla)
  const a = partirAutoridad(resto)
  if (!a.ok) return a
  const { user, password, listaHosts, tras } = a.campos
  const interrogacion = tras.indexOf('?')
  const rutaCruda = (interrogacion < 0 ? tras : tras.slice(0, interrogacion)).replace(/^\//, '')
  const ruta = decodificar(rutaCruda)
  if (ruta === null) return { ok: false, error: 'La base lleva un % que no es de un carácter codificado.' }
  return {
    ok: true,
    campos: {
      esquema,
      user,
      password,
      hosts: listaHosts.split(','),
      ruta,
      consulta: interrogacion < 0 ? '' : tras.slice(interrogacion + 1)
    }
  }
}

/** `host`, `host:puerto`, `[v6]` o `[v6]:puerto`, con el puerto validado. */
function partirHost(crudo: string): { ok: true; host: string; puerto: number | null } | { ok: false; error: string } {
  let host: string
  let puerto: string | null = null
  if (crudo.startsWith('[')) {
    const cierra = crudo.indexOf(']')
    if (cierra < 0) return { ok: false, error: `Falta el «]» de la dirección IPv6 «${crudo}».` }
    host = crudo.slice(1, cierra)
    const tras = crudo.slice(cierra + 1)
    if (tras !== '') {
      if (!tras.startsWith(':')) return { ok: false, error: `Sobra «${tras}» detrás de la dirección IPv6.` }
      puerto = tras.slice(1)
    }
  } else {
    const dos = crudo.lastIndexOf(':')
    host = dos < 0 ? crudo : crudo.slice(0, dos)
    if (dos >= 0) puerto = crudo.slice(dos + 1)
  }
  const decodificado = decodificar(host)
  if (decodificado === null || decodificado === '') return { ok: false, error: `El host «${crudo}» no es válido.` }
  if (decodificado.includes('/')) return { ok: false, error: 'Tessera no se conecta por un socket local: pon un host y un puerto.' }
  if (puerto === null) return { ok: true, host: decodificado, puerto: null }
  const n = /^\d+$/.test(puerto) ? Number(puerto) : NaN
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false, error: `El puerto «${puerto}» no es válido (1-65535).` }
  return { ok: true, host: decodificado, puerto: n }
}

const esBooleano = (v: string): boolean | null => (/^true$/i.test(v) ? true : /^false$/i.test(v) ? false : null)

// --- MongoDB -------------------------------------------------------------------------------

/** El host de una URI de MongoDB: uno solo y, con `srv`, sin puerto, como exige el driver. */
function hostDeUriMongo(u: UriPartida, srv: boolean, puertoPorDefecto: number | null): ResultadoUri<{ host: string; port: number | null }> {
  if (u.hosts.length > 1) {
    return {
      ok: false,
      error: srv
        ? 'Una URI mongodb+srv lleva un solo nombre de host.'
        : 'La URI lleva varios hosts y la conexión va a uno solo: pon uno de los miembros y añade replicaSet=<nombre> en las opciones (el resto lo descubre el driver).'
    }
  }
  const h = partirHost(u.hosts[0])
  if (!h.ok) return h
  if (srv && h.puerto !== null) return { ok: false, error: 'Una URI mongodb+srv no lleva puerto: lo dan los registros DNS del host.' }
  return { ok: true, campos: { host: h.host, port: srv ? null : (h.puerto ?? puertoPorDefecto) } }
}

/** Lo que sale de las opciones de una URI de MongoDB: el TLS a sus casillas y el resto, admitido o descartado. */
interface OpcionesMongoClasificadas {
  cifrar: boolean | null
  confiar: boolean
  quedan: Opcion[]
  descartadas: string[]
}

/** Aplica una opción de TLS (`tls`, `ssl`, `tlsAllowInvalidCertificates`, `tlsInsecure`) a las casillas; devuelve el error, si lo hay. */
function aplicarOpcionTls(c: OpcionesMongoClasificadas, o: Opcion, k: string): string | null {
  const b = esBooleano(decodificar(o.valor) ?? o.valor)
  if (b === null) return `«${o.clave}» vale true o false.`
  if (k === 'tls' || k === 'ssl') {
    if (c.cifrar !== null && c.cifrar !== b) return 'tls y ssl dicen cosas distintas en la URI.'
    c.cifrar = b
  } else {
    c.confiar = c.confiar || b
  }
  return null
}

function clasificarOpcionesMongo(opciones: readonly Opcion[]): ResultadoUri<OpcionesMongoClasificadas> {
  const admitidas = minus(OPCIONES_URI_MONGO)
  const c: OpcionesMongoClasificadas = { cifrar: null, confiar: false, quedan: [], descartadas: [] }
  for (const o of opciones) {
    const k = o.clave.toLowerCase()
    if (k === 'tls' || k === 'ssl' || k === 'tlsallowinvalidcertificates' || k === 'tlsinsecure') {
      const error = aplicarOpcionTls(c, o, k)
      if (error !== null) return { ok: false, error }
    } else if (admitidas.includes(k)) {
      // Con el nombre canónico de la lista (el driver no distingue mayúsculas).
      c.quedan.push({ clave: OPCIONES_URI_MONGO[admitidas.indexOf(k)], valor: o.valor })
    } else {
      c.descartadas.push(o.clave)
    }
  }
  return { ok: true, campos: c }
}

/** Añade `authSource=<base>` cuando la base de la ruta es la de autenticación del driver (ver el ADR de la URI de MongoDB). */
function anadirAuthSourceImplicito(u: UriPartida, srv: boolean, quedan: Opcion[]): void {
  const mecanismo = quedan.find((o) => o.clave === 'authMechanism')?.valor ?? ''
  const sinAuthSource = !quedan.some((o) => o.clave === 'authSource')
  if (!srv && u.user !== '' && u.ruta !== '' && sinAuthSource && (mecanismo === '' || /^SCRAM-/i.test(mecanismo))) {
    quedan.push({ clave: 'authSource', valor: encodeURIComponent(u.ruta) })
  }
}

export function descomponerUriMongo(uri: string): ResultadoUri<CamposUriMongo> {
  const partida = partirUri(uri, ['mongodb', 'mongodb+srv'])
  if (!partida.ok) return partida
  const u = partida.campos
  const srv = u.esquema === 'mongodb+srv'
  const d = descriptor('mongodb')

  const h = hostDeUriMongo(u, srv, d.conexion.puertoPorDefecto)
  if (!h.ok) return h
  const p = partirOpciones(u.consulta, REGLAS_MONGO)
  if (!p.ok) return p
  const c = clasificarOpcionesMongo(p.opciones)
  if (!c.ok) return c
  const { cifrar, confiar, quedan, descartadas } = c.campos
  if (srv && quedan.some((o) => o.clave === 'directConnection' && esBooleano(o.valor) === true)) {
    return { ok: false, error: 'Una URI mongodb+srv no admite directConnection=true.' }
  }
  anadirAuthSourceImplicito(u, srv, quedan)
  const opcionesUri = quedan.map((o) => `${o.clave}=${o.valor}`).join('&')
  // Lo que se guarda tiene que pasar la misma validación que el main aplica al guardar.
  const invalida = validarOpcionesUriMongo(opcionesUri)
  if (invalida !== null) return { ok: false, error: invalida }

  const porDefecto = tlsDeConexion(d, {})
  return {
    ok: true,
    campos: {
      host: h.campos.host,
      port: h.campos.port,
      user: u.user,
      password: u.password,
      database: u.ruta,
      srv,
      tls: { cifrar: cifrar ?? (srv ? true : porDefecto.cifrar), confiarCertificado: confiar },
      opcionesUri,
      descartadas
    }
  }
}

// --- Redis ------------------------------------------------------------------------------

/** La base más alta que se admite. */
export const BASE_REDIS_MAX = 9999

/**
 * La base de Redis tal como se GUARDA (el valor ya limpio: `limpiarDestinoBd`): '' (la 0) o un
 * entero de 0 a `BASE_REDIS_MAX`, en cifras. null si vale, o el mensaje.
 */
export function validarBaseRedis(valor: string): string | null {
  const v = valor.trim()
  if (v === '') return null
  // Hasta 4 cifras: es la regla del trabajador y de `tdb`
  // (`^\d{1,4}$`); con `^\d+$`, «00007» se guardaba y cada sesión fallaba al abrir.
  if (!/^\d{1,4}$/.test(v) || Number(v) > BASE_REDIS_MAX) {
    return `La base es un número entero de 0 a ${BASE_REDIS_MAX} (vacía, la 0): «${v}» no lo es.`
  }
  return null
}

export function descomponerUriRedis(uri: string): ResultadoUri<CamposUriRedis> {
  const partida = partirUri(uri, ['redis', 'rediss'])
  if (!partida.ok) return partida
  const u = partida.campos
  const d = descriptor('redis')

  if (u.hosts.length > 1) {
    return {
      ok: false,
      error: 'La URI lleva varios hosts y la conexión va a un servidor solo (Cluster y Sentinel, todavía no): pon el del servidor.'
    }
  }
  const h = partirHost(u.hosts[0])
  if (!h.ok) return h

  // La base: el número de la ruta, normalizado.
  const invalida = validarBaseRedis(u.ruta)
  if (invalida !== null) return { ok: false, error: `En la ruta de la URI va el número de la base (/0, /1…). ${invalida}` }
  const database = u.ruta.trim() === '' ? '' : String(Number(u.ruta.trim()))

  // Las opciones no se guardan: solo sus claves, sin repetir, para decirlo.
  const descartadas: string[] = []
  for (const trozo of u.consulta.split('&')) {
    if (trozo === '') continue
    const igual = trozo.indexOf('=')
    const clave = igual < 0 ? trozo : trozo.slice(0, igual)
    const nombre = clave === '' ? trozo : (decodificar(clave) ?? clave)
    if (!descartadas.includes(nombre)) descartadas.push(nombre)
  }

  return {
    ok: true,
    campos: {
      host: h.host,
      port: h.puerto ?? d.conexion.puertoPorDefecto ?? 0,
      user: u.user,
      password: u.password,
      database,
      tls: u.esquema === 'rediss' ? { cifrar: true, confiarCertificado: false } : tlsDeConexion(d, {}),
      descartadas
    }
  }
}
