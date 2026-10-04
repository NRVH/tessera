// =============================================================================
// Adaptador Redis de `tdb`: lo que un agente hace con una conexión Redis (`query` con comandos
// de redis-cli, `schema` con las claves, `test` y `sessions`), con la forma de exports de los
// demás adaptadores y `claves`. Siempre solo lectura. Conexión, comandos y política viven en
// `redisComun.cjs` (compartido con `sesionRedis.cjs`); la entrada y la guardia, en `entradaRedis.cjs`.
// Decisiones: docs/decisiones/bd/adaptador-redis-solo-lectura-y-texto.md
// =============================================================================

'use strict'

const comun = require('./redisComun.cjs')
const motoresTdb = require('./motores.cjs')
const entrada = require('./entradaRedis.cjs')

const { interpretar, guardiaSoloLectura, mensajeGuardia } = entrada

/** Tope de cada operación contra el servidor (el mismo que MongoDB y SQL Server en `tdb`). */
const TOPE_PETICION_MS = 60_000

/** El cifrado de una conexión de Redis que no dice nada: sin cifrar (= `tlsPorDefecto` de shared). */
const TLS_REDIS_POR_DEFECTO = Object.freeze({ cifrar: false, confiarCertificado: false })

/** Bases que se suponen sin `CONFIG GET databases` (el valor por defecto de Redis). */
const BASES_POR_DEFECTO = 16

/** Claves que `schema` enseña por defecto (`--limit` lo cambia) y vueltas de SCAN como mucho. */
const TOPE_CLAVES = 200
const VUELTAS_SCAN = 50
const CUENTA_SCAN = 1000

/** Caracteres como mucho del texto de UNA respuesta (un GET de un valor enorme). */
const TOPE_TEXTO_RESPUESTA = 64 * 1024

/** El agente solo lee en Redis, sea cual sea la marca de la conexión. */
const soloLecturaSiempre = true

// --- Errores ------------------------------------------------------------------------------

/** Un error del driver o de `redisComun` como `Error` de `tdb`. */
function errorTdb(err, alias) {
  if (err && err.tdb === true) return err
  const e = comun.normalizarError(err)
  let mensaje
  if (e.codigo === 'TESSERA-SOLO-LECTURA' && alias !== undefined) {
    // El motivo del trabajador viene como «La conexión es de solo lectura: X.»: la frase de
    // `mensajeGuardia` ya dice lo primero.
    mensaje = mensajeGuardia(alias, { ok: false, motivo: String(e.mensaje).replace(/^La conexión es de solo lectura:\s*/, '') })
  } else if (e.clase === 'timeout' || e.clase === 'cancelada') {
    mensaje = `La operación pasó de ${TOPE_PETICION_MS / 1000} s y tdb la abandonó (${e.mensaje}).`
  } else {
    mensaje = e.mensaje
  }
  const salida = new Error(mensaje)
  if (e.codigo !== undefined) salida.codigo = e.codigo
  salida.clase = e.clase
  salida.tdb = true
  return salida
}

/**
 * Una operación con el tope de `TOPE_PETICION_MS`. Redis no cancela en el servidor (un hilo):
 * al pasarse se ABANDONA la conexión (se cierra) y se dice.
 */
async function conTope(c, promesa) {
  let reloj
  const tope = new Promise((_, rechazar) => {
    reloj = setTimeout(() => {
      try {
        c.cliente.disconnect()
      } catch {
        /* ya estaba cerrada */
      }
      const e = new Error(`La operación pasó de ${TOPE_PETICION_MS / 1000} s y tdb la abandonó (Redis no la cancela en el servidor).`)
      e.tdb = true
      rechazar(e)
    }, TOPE_PETICION_MS)
  })
  try {
    return await Promise.race([promesa, tope])
  } finally {
    clearTimeout(reloj)
  }
}

// --- Abrir ------------------------------------------------------------------------------

/**
 * El nombre del cliente que ve el servidor (`CLIENT SETNAME`): quién y con qué conexión. Redis
 * no admite blancos ni caracteres de control en él: se cambian por `_`.
 */
function nombreApp(ctx, con) {
  const quien = ctx && ctx.usuarioWindows ? ctx.usuarioWindows : 'tessera'
  return `tessera-tdb:${quien}@${con.alias}`.replace(/[^\x21-\x7e]/g, '_').slice(0, 128)
}

/** El cifrado EFECTIVO: el guardado o, sin él, el del motor (sin cifrar). Como `tlsDe` de MongoDB. */
function tlsDe(con) {
  const t = con && con.tls
  if (t && typeof t === 'object' && typeof t.cifrar === 'boolean' && typeof t.confiarCertificado === 'boolean') {
    return { cifrar: t.cifrar, confiarCertificado: t.confiarCertificado }
  }
  const fila = motoresTdb.MOTORES.redis
  const d = fila && fila.tlsPorDefecto ? fila.tlsPorDefecto : TLS_REDIS_POR_DEFECTO
  return { cifrar: d.cifrar, confiarCertificado: d.confiarCertificado }
}

/**
 * La base de la conexión: un número (el main la guarda como texto o como número); 0 si no
 * trae. `null` si trae algo que no es una base (se dice al abrir).
 */
function baseDe(con) {
  const d = con ? con.database : undefined
  if (d === undefined || d === null || d === '') return 0
  if (typeof d === 'number') return Number.isInteger(d) && d >= 0 && d <= 9999 ? d : null
  if (typeof d === 'string' && /^\d{1,4}$/.test(d.trim())) return Number(d.trim())
  return null
}

/** La conexión del registro con la forma de `ConexionTrabajador` que espera `redisComun`. */
function conexionDe(con) {
  const base = baseDe(con)
  return {
    id: con.id,
    alias: con.alias,
    motor: con.motor,
    host: con.host,
    port: con.port,
    database: String(base === null ? 0 : base),
    user: typeof con.user === 'string' ? con.user : '',
    readonly: con.readonly !== false,
    tls: tlsDe(con)
  }
}

/**
 * Conecta. Devuelve la sesión de `tdb`: `{ conexion, modo, driverId, cerrar }` con `conexion` =
 * `{ cliente, con, base, version, cache, politica }`. `secreto` undefined = sin contraseña.
 */
async function abrir(con, secreto, ctx) {
  const base = baseDe(con)
  if (base === null) {
    throw new Error(`La base de "${con.alias}" no es un número de base de Redis (0, 1, 2…): ${JSON.stringify(con.database)}. Corrígela con "Editar conexión…" en Tessera.`)
  }
  let r
  try {
    r = await comun.conectar(conexionDe(con), typeof secreto === 'string' ? secreto : '', { appName: nombreApp(ctx, con), base })
  } catch (e) {
    throw errorTdb(e)
  }
  const c = {
    cliente: r.cliente,
    con,
    base,
    version: typeof r.version === 'string' ? r.version : '',
    // Las marcas de COMMAND INFO, una vez por conexión (ver `aplicarPolitica`).
    cache: new Map(),
    politica: { soloLectura: true, produccion: con.entorno === 'produccion', confirmado: false, confirmadoPeligroso: false }
  }
  const conUsuario = typeof con.user === 'string' && con.user !== ''
  return {
    conexion: c,
    modo: conUsuario || secreto ? 'nativo' : 'nativo, sin autenticar',
    driverId: null,
    cerrar: async () => {
      try {
        // `disconnect` y no `quit`: no espera respuesta de un servidor que puede no darla.
        c.cliente.disconnect()
      } catch {
        /* cerrar no tiene que tapar el resultado ni el error de lo que se hizo */
      }
    }
  }
}

// --- Consultar ------------------------------------------------------------------------------

/** El tope de elementos de primer nivel de una respuesta: `{ respuesta, total }` (total = los que había). */
function recortar(respuesta, limite) {
  if (respuesta && respuesta.tipo === 'lista' && Array.isArray(respuesta.elementos) && respuesta.elementos.length > limite) {
    return { respuesta: { tipo: 'lista', elementos: respuesta.elementos.slice(0, limite) }, total: respuesta.elementos.length }
  }
  return { respuesta, total: null }
}

/**
 * Ejecuta UN comando de la línea `i` (un `SELECT` o un comando con la política puesta). Un fallo
 * sale con la línea y con lo que pasó con las anteriores, que ya se ejecutaron (todas de
 * lectura), para que no se repitan a ciegas.
 */
async function ejecutarLinea(c, cmd, i, varios) {
  const alias = c.con.alias
  try {
    if (cmd.base !== undefined) {
      await conTope(c, comun.seleccionar(c.cliente, cmd.base))
      c.base = cmd.base
      return { tipo: 'simple', texto: 'OK' }
    }
    await conTope(c, comun.aplicarPolitica(c.cliente, cmd.argv, c.politica, c.cache))
    return await conTope(c, comun.ejecutar(c.cliente, cmd.argv))
  } catch (e) {
    const err = errorTdb(e, alias)
    const antes = i > 0 ? `\n    Las ${i} línea(s) anteriores sí se ejecutaron (son de lectura); las siguientes, no.` : ''
    const donde = varios ? `Línea ${cmd.linea} (${cmd.texto.slice(0, 60)}): ` : ''
    const esServidor = err.codigo === undefined || !String(err.codigo).startsWith('TESSERA-')
    const salida = new Error(`${donde}${esServidor ? '(error) ' : ''}${err.message}${antes}`)
    if (err.codigo !== undefined) salida.codigo = err.codigo
    throw salida
  }
}

/**
 * Ejecuta los comandos del texto EN ORDEN, sobre la misma conexión y parando en el primer error.
 * Devuelve la forma de los demás adaptadores (`columnas`, `filas`, `avisos`) y `valor` (el texto
 * de redis-cli, que `tdb.cjs` pinta como un bloque) y `respuestas` (las estructuradas, para `--json`).
 */
async function consultar(c, texto, limite) {
  const alias = c.con.alias
  const r = interpretar(texto)
  if (!r.ok) throw new Error(r.motivo)
  // Defensa en profundidad: `tdb.cjs` ya la pasó antes de conectar.
  const g = guardiaSoloLectura(texto)
  if (!g.ok) throw new Error(mensajeGuardia(alias, g))
  const varios = r.comandos.length > 1
  const avisos = []
  const bloques = []
  const filas = []
  const respuestas = []
  for (let i = 0; i < r.comandos.length; i++) {
    const cmd = r.comandos[i]
    const respuesta = await ejecutarLinea(c, cmd, i, varios)
    const { respuesta: mostrada, total } = recortar(respuesta, limite)
    let textoResp = comun.formatoCli(mostrada)
    if (total !== null) {
      avisos.push(`TOPE: la respuesta${varios ? ` de la línea ${cmd.linea}` : ''} tiene ${total} elementos; se enseñan los primeros ${limite} (usa --limit N para más).`)
    }
    if (textoResp.length > TOPE_TEXTO_RESPUESTA) {
      textoResp = textoResp.slice(0, TOPE_TEXTO_RESPUESTA)
      avisos.push(`TOPE: la respuesta${varios ? ` de la línea ${cmd.linea}` : ''} pasa de ${TOPE_TEXTO_RESPUESTA} caracteres y se cortó (pide un trozo: GETRANGE, LRANGE…).`)
    }
    bloques.push(varios ? `> ${cmd.texto}\n${textoResp}` : textoResp)
    filas.push({ linea: cmd.linea, comando: cmd.texto, respuesta: textoResp })
    respuestas.push({ linea: cmd.linea, comando: cmd.texto, respuesta: mostrada })
  }
  return { columnas: ['linea', 'comando', 'respuesta'], filas, valor: bloques.join('\n\n'), respuestas, avisos }
}

// --- Catálogo -------------------------------------------------------------------------------

/** Un carácter de control (código < 0x20 o 0x7f). Por código y no con una clase de regex: el lint la prohíbe (no-control-regex). */
function esControl(ch) {
  return ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f
}

/** Un texto entre comillas dobles con los escapes de redis-cli (`\xHH` para los controles). */
function textoEntreComillas(texto) {
  let esc = ''
  for (const ch of texto) {
    if (ch === '\\') esc += '\\\\'
    else if (ch === '"') esc += '\\"'
    else if (ch === '\n') esc += '\\n'
    else if (ch === '\r') esc += '\\r'
    else if (ch === '\t') esc += '\\t'
    else if (esControl(ch)) esc += '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0')
    else esc += ch
  }
  return `"${esc}"`
}

/** Unos bytes que no son texto entre comillas dobles, con `\xHH` para lo que no es imprimible. */
function bytesEntreComillas(bytes) {
  const buf = Buffer.from(bytes && typeof bytes.base64 === 'string' ? bytes.base64 : '', 'base64')
  let s = ''
  for (const b of buf) {
    if (b === 0x22) s += '\\"'
    else if (b === 0x5c) s += '\\\\'
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else s += '\\x' + b.toString(16).padStart(2, '0')
  }
  return `"${s}"`
}

/**
 * El nombre de una clave para escribirlo en un comando: tal cual si es texto sin blancos ni
 * comillas; si no, entre comillas dobles con los escapes de redis-cli. Así se puede copiar de
 * `schema` a `query`.
 */
function nombreParaComando(bytes) {
  const texto = bytes && typeof bytes.texto === 'string' ? bytes.texto : null
  if (texto !== null && texto !== '' && /^[^\s"'\\]+$/.test(texto) && !Array.from(texto).some(esControl)) return texto
  return texto !== null ? textoEntreComillas(texto) : bytesEntreComillas(bytes)
}

/** Un TTL en milisegundos como lo lee una persona ('' = no caduca). */
function ttlLegible(ms) {
  if (typeof ms !== 'number' || ms < 0) return ''
  const s = Math.ceil(ms / 1000)
  if (s < 120) return `${s} s`
  if (s < 7200) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} d`
}

/**
 * Las claves de la base actual: SCAN con MATCH hasta `tope` claves o `VUELTAS_SCAN` vueltas,
 * nunca KEYS. Una vuelta VACÍA con cursor distinto de '0' no es «no hay más»: se sigue.
 * Devuelve `{ base, patron, claves: [{ CLAVE, TIPO, TTL }], hayMas, bases }` (`bases` = lo de
 * `comun.bases`, o null si no se pudo leer).
 */
async function claves(c, opciones) {
  const patron = opciones && typeof opciones.patron === 'string' && opciones.patron !== '' ? opciones.patron : '*'
  const tope = opciones && Number.isInteger(opciones.tope) && opciones.tope > 0 ? opciones.tope : TOPE_CLAVES
  const lista = []
  let cursor = '0'
  let vueltas = 0
  try {
    do {
      const p = await conTope(c, comun.escanear(c.cliente, { patron, cursor, cuenta: CUENTA_SCAN }))
      for (const k of p.claves || []) lista.push(k)
      cursor = String(p.cursor)
      vueltas++
    } while (cursor !== '0' && lista.length < tope && vueltas < VUELTAS_SCAN)
  } catch (e) {
    throw errorTdb(e, c.con.alias)
  }
  // Las bases con claves son un extra de `schema`: si no se pueden leer, se sigue sin ellas.
  let bases
  try {
    bases = await conTope(c, comun.bases(c.cliente, BASES_POR_DEFECTO))
  } catch {
    bases = null
  }
  const hayMas = cursor !== '0' || lista.length > tope
  const filas = lista.slice(0, tope).map((k) => ({
    CLAVE: nombreParaComando(k.nombre),
    TIPO: k.tipo === 'otro' && k.tipoServidor ? k.tipoServidor : k.tipo,
    TTL: ttlLegible(k.ttlMs)
  }))
  filas.sort((a, b) => (a.CLAVE < b.CLAVE ? -1 : a.CLAVE > b.CLAVE ? 1 : 0))
  return { base: c.base, patron, claves: filas, hayMas, bases }
}

/** Las claves con la forma de `tablas` de los demás adaptadores (para quien la llame así). */
async function tablas(c) {
  const r = await claves(c, {})
  return r.claves.map((k) => ({ TABLE_NAME: k.CLAVE, COLUMNAS: null, COMENTARIO: k.TTL ? `${k.TIPO}, caduca en ${k.TTL}` : k.TIPO }))
}

/** El mensaje de `describe`: en Redis no hay columnas; cómo se mira una clave. */
function mensajeSinColumnas(alias) {
  return (
    'En Redis no hay tablas ni columnas: cada clave tiene su tipo y su valor. Para mirar una:\n' +
    `    tdb query ${alias} "TYPE <clave>"   y, según el tipo: GET, HGETALL, LRANGE <clave> 0 49,\n` +
    '    SMEMBERS, ZRANGE <clave> 0 -1 WITHSCORES, XRANGE <clave> - + COUNT 50 o JSON.GET <clave> $.\n' +
    `    Las claves de la base:  tdb schema ${alias} ["<patrón>"]`
  )
}

async function columnas(c) {
  const e = new Error(mensajeSinColumnas(c.con.alias))
  e.tdb = true
  throw e
}

/** Redis no tiene referencias entre claves: lo dice, igual que `columnas`. */
async function foraneas(c) {
  const e = new Error(mensajeSinColumnas(c.con.alias))
  e.tdb = true
  throw e
}

async function banner(c) {
  const t = tlsDe(c.con)
  const conUsuario = typeof c.con.user === 'string' && c.con.user !== ''
  const partes = [
    `Redis ${c.version || '(versión desconocida)'}`,
    `base ${c.base}`,
    conUsuario ? `como ${c.con.user}` : 'usuario default',
    t.cifrar ? (t.confiarCertificado ? 'cifrada, certificado sin verificar' : 'cifrada') : 'sin cifrar',
    'solo lectura para los agentes (la impone Tessera)'
  ]
  return partes.join(' · ')
}

/** Una línea de `CLIENT LIST`/`CLIENT INFO` (`id=3 addr=… name=…`) como objeto. */
function camposCliente(linea) {
  const o = {}
  for (const par of String(linea).trim().split(' ')) {
    const i = par.indexOf('=')
    if (i > 0) o[par.slice(0, i)] = par.slice(i + 1)
  }
  return o
}

/** El texto de una respuesta de bytes (o '' si no lo es). */
function textoDe(respuesta) {
  if (respuesta && respuesta.tipo === 'bytes' && respuesta.valor && typeof respuesta.valor.texto === 'string') return respuesta.valor.texto
  if (respuesta && respuesta.tipo === 'simple') return respuesta.texto
  return ''
}

/**
 * Las conexiones del usuario de la conexión. La de este `tdb` sale en la lista (la última: la
 * más nueva). Sin permiso para `CLIENT LIST` (un ACL de lectura), solo la propia, por `CLIENT
 * INFO`, y se dice en la columna NOTA.
 */
async function sesiones(c) {
  const usuario = typeof c.con.user === 'string' && c.con.user !== '' ? c.con.user : 'default'
  const fila = (o, nota) => ({
    ID: o.id || '',
    NOMBRE: o.name || '',
    ORIGEN: o.addr || '',
    USUARIO: o.user || '',
    BASE: o.db || '',
    EDAD_S: o.age || '',
    INACTIVO_S: o.idle || '',
    COMANDO: o.cmd || '',
    ...(nota !== undefined ? { NOTA: nota } : {})
  })
  const argv = (...partes) => partes.map((p) => Buffer.from(p))
  try {
    const r = await conTope(c, comun.ejecutar(c.cliente, argv('CLIENT', 'LIST')))
    return textoDe(r)
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map(camposCliente)
      .filter((o) => o.user === undefined || o.user === usuario)
      .map((o) => fila(o))
  } catch (e) {
    if (!/NOPERM|permission/i.test(String(e && e.message))) throw errorTdb(e, c.con.alias)
  }
  try {
    const r = await conTope(c, comun.ejecutar(c.cliente, argv('CLIENT', 'INFO')))
    return [fila(camposCliente(textoDe(r)), 'sin permiso para CLIENT LIST: solo esta conexión')]
  } catch (e) {
    throw errorTdb(e, c.con.alias)
  }
}

module.exports = {
  abrir,
  consultar,
  banner,
  tablas,
  columnas,
  foraneas,
  sesiones,
  claves,
  guardiaSoloLectura,
  mensajeGuardia,
  soloLecturaSiempre,
  // Para `test-redis-tdb` (puras).
  TOPE_PETICION_MS,
  TOPE_CLAVES,
  TOPE_TEXTO_RESPUESTA,
  lineas: entrada.lineas,
  interpretar,
  recortar,
  nombreParaComando,
  ttlLegible,
  baseDe,
  tlsDe,
  conexionDe,
  nombreApp,
  camposCliente
}
