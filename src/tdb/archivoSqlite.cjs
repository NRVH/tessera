// =============================================================================
// El archivo de una base SQLite: plataforma y rutas, volumen desconectado, URI de apertura,
// lectura de la cabecera, decisión de apertura y enlaces. Pieza de `sqliteComun.cjs`, que
// reexporta lo que usan `tdb`, el trabajador y el main. La plataforma entra por parámetro.
// Decisiones: docs/decisiones/bd/adaptador-sqlite-apertura-y-autorizador.md
// =============================================================================

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

/** Los 16 bytes con que empieza toda base SQLite 3. */
const MAGIA_SQLITE = Buffer.from('SQLite format 3\0', 'latin1')
/** Bytes de cabecera que se leen antes de abrir. */
const LARGO_CABECERA = 100
/** Los hermanos de un `.db` que crea SQLite. */
const SUFIJOS_AUXILIARES = Object.freeze(['-wal', '-shm', '-journal'])

/**
 * Un error con código de Tessera (`codigo`, 'TESSERA-SQLITE-…'), para que `tdb` y el
 * trabajador lo traduzcan sin mirar el texto. Códigos: SIN-AUTORIZADOR, VACIO, NO-SQLITE,
 * AUXILIAR, JOURNAL, ENLACE, RUTA-CAMBIADA, NO-EXISTE, DESCONECTADO, PERMISO, YA-EXISTE,
 * NO-PERMITIDO, COLA, CERRADA.
 */
function errorSqlite(codigo, mensaje, extra) {
  const e = new Error(mensaje)
  e.codigo = `TESSERA-SQLITE-${codigo}`
  if (extra) Object.assign(e, extra)
  return e
}

// --- Plataforma y rutas (puro) ---------------------------------------------------------

/** La plataforma del proceso, en la unión de `shared/plataforma.ts`. El ÚNICO que lee `process.platform`. */
function plataformaDelProceso() {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  return 'otra'
}

function pathDe(plataforma) {
  return plataforma === 'windows' ? path.win32 : path.posix
}

/** ¿Distingue mayúsculas el sistema de archivos de la plataforma? (NTFS y APFS por defecto, no.) */
function sinCaja(plataforma) {
  return plataforma === 'windows' || plataforma === 'mac'
}

/**
 * Si el NOMBRE es el de un auxiliar de SQLite (`x.db-wal`, `x.db-shm`, `x.db-journal`),
 * el nombre de su base (`x.db`); si no, null. Sin caja en Windows y macOS.
 */
function baseDeAuxiliar(nombre, plataforma = plataformaDelProceso()) {
  const cmp = sinCaja(plataforma) ? nombre.toLowerCase() : nombre
  for (const s of SUFIJOS_AUXILIARES) {
    if (cmp.length > s.length && cmp.endsWith(s)) return nombre.slice(0, nombre.length - s.length)
  }
  return null
}

/** ¿Es una ruta UNC de Windows (`\\servidor\recurso\…`, también `\\?\UNC\…`)? */
function esUnc(ruta) {
  return /^\\\\\?\\UNC\\/i.test(ruta) || (/^\\\\[^\\?.]/.test(ruta))
}

/**
 * La raíz del VOLUMEN de una ruta, por su FORMA y no por la plataforma (= `raizDeVolumen`
 * de `shared/workspace-state-ipc.ts`; `test-sqlite-tdb` fija que dan lo mismo): `E:\`,
 * `\\servidor\recurso` o `/Volumes/Disco`. null = el volumen del sistema, que siempre está.
 */
function raizDeVolumen(ruta) {
  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(ruta)
  if (unc) return `\\\\${unc[1]}\\${unc[2]}`
  const unidad = /^([A-Za-z]):[\\/]/.exec(ruta)
  if (unidad) return `${unidad[1]}:\\`
  const volumen = /^\/Volumes\/([^/]+)/.exec(ruta)
  if (volumen) return `/Volumes/${volumen[1]}`
  return null
}

/**
 * ¿Falta el VOLUMEN entero de la ruta (disco, unidad o recurso de red desconectados)? Un
 * archivo borrado y un disco desenchufado dan el mismo ENOENT; la raíz lo desempata.
 */
function volumenDesconectado(ruta, fsImpl = fs) {
  const raiz = raizDeVolumen(ruta)
  if (raiz === null) return false
  try {
    fsImpl.statSync(raiz)
    return false
  } catch (e) {
    return Boolean(e) && (e.code === 'ENOENT' || e.code === 'ENOTDIR')
  }
}

/**
 * El texto de un archivo cuyo volumen no está, con el NOMBRE del volumen (la letra de la
 * unidad, el disco de macOS o el recurso de red) y no su ruta: llega al renderer. El remedio
 * es otro en cada forma: enchufar el disco, o la red o la VPN.
 */
function mensajeDesconectado(nombre, raiz) {
  const r = String(raiz || '')
  if (/^\\\\/.test(r)) {
    const recurso = r.split('\\').filter((t) => t !== '').pop() || ''
    return `«${nombre}» está en una carpeta de red que no responde («${recurso}»): comprueba la red o la VPN y vuelve a intentarlo.`
  }
  const unidad = /^([A-Za-z]:)/.exec(r)
  if (unidad) return `«${nombre}» está en la unidad ${unidad[1].toUpperCase()}, que no está conectada: conéctala y vuelve a intentarlo.`
  const disco = /^\/Volumes\/(.+)$/.exec(r)
  if (disco) return `«${nombre}» está en el disco «${disco[1]}», que no está conectado: conéctalo y vuelve a intentarlo.`
  return `«${nombre}» está en un disco que no está conectado: conéctalo y vuelve a intentarlo.`
}

/**
 * La URI con que se abre `ruta`: `pathToFileURL` con la plataforma de parámetro y, si
 * `inmutable`, `?immutable=1`; una UNC, con `file:////`. Devuelve un `URL` (lo que
 * node:sqlite acepta como URI).
 */
function uriSqlite(ruta, { inmutable = false, plataforma = plataformaDelProceso() } = {}) {
  let url
  if (plataforma === 'windows' && esUnc(ruta)) {
    const sinPrefijo = ruta.replace(/^\\\\\?\\UNC\\/i, '').replace(/^\\\\/, '')
    const trozos = sinPrefijo.split(/[\\/]+/).filter((t) => t !== '').map(encodeURIComponent)
    url = new URL('file:////' + trozos.join('/'))
  } else {
    // `\\?\C:\…` (ruta larga de Windows): la misma ruta sin el prefijo.
    const normal = plataforma === 'windows' ? ruta.replace(/^\\\\\?\\(?=[A-Za-z]:)/, '') : ruta
    url = pathToFileURL(normal, { windows: plataforma === 'windows' })
  }
  if (inmutable) url.searchParams.set('immutable', '1')
  return url
}

// --- Cabecera y decisión de apertura (puro) ---------------------------------------------

/** ¿Anuncia la cabecera el modo WAL? Bytes 18 y 19: versión de escritura y de lectura; 2 = WAL. */
function esWal(b) {
  return b.length > 19 && (b[18] === 2 || b[19] === 2)
}

/** Qué es un archivo que no empieza por la magia de SQLite, por sus primeros bytes. */
function parecerDe(b) {
  const empieza = (bytes) => b.length >= bytes.length && bytes.every((x, i) => b[i] === x)
  if (empieza([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'H:2,') return 'h2'
  if (b.length >= 12 && b.subarray(8, 12).toString('latin1') === 'DUCK') return 'duckdb'
  if (empieza([0x37, 0x7f, 0x06, 0x82]) || empieza([0x37, 0x7f, 0x06, 0x83])) return 'walSuelto'
  if (b.length > 0 && b.every((x) => x === 0x09 || x === 0x0a || x === 0x0d || (x >= 0x20 && x !== 0x7f))) return 'texto'
  return 'otro'
}

/**
 * Qué parece un archivo por sus primeros bytes (hasta 100):
 *   { tipo: 'sqlite', wal } · { tipo: 'vacio' } · { tipo: 'noSqlite', parece }
 * con `parece` en 'ole' (documento OLE: Thumbs.db, Office antiguo), 'h2', 'duckdb',
 * 'walSuelto' (un `-wal` renombrado), 'texto' u 'otro' (binario desconocido o CIFRADO: una
 * SQLCipher cifra también la cabecera, así que no se distingue de unos bytes al azar).
 */
function analizarCabecera(cabecera, tamano) {
  if (tamano === 0) return { tipo: 'vacio' }
  const b = Buffer.from(cabecera || [])
  if (b.length >= 16 && b.subarray(0, 16).equals(MAGIA_SQLITE)) return { tipo: 'sqlite', wal: esWal(b) }
  return { tipo: 'noSqlite', parece: parecerDe(b) }
}

/** El texto de un archivo que no es una base SQLite, según lo que parece. */
function mensajeNoSqlite(nombre, parece) {
  const base = `«${nombre}» no es una base SQLite (no empieza por «SQLite format 3»)`
  switch (parece) {
    case 'ole':
      return `${base}: es un documento OLE (una miniatura de Thumbs.db o un documento de Office antiguo).`
    case 'h2':
      return `${base}: es una base H2.`
    case 'duckdb':
      return `${base}: es una base DuckDB.`
    case 'walSuelto':
      return `${base}: es el registro de escritura (-wal) de una SQLite, renombrado. Elige la base.`
    case 'texto':
      return `${base}: es un archivo de texto.`
    default:
      return `${base}. Si es una SQLite cifrada (SQLCipher, SEE), Tessera no la abre.`
  }
}

/**
 * La decisión de apertura. Pura: todo lo del disco entra ya leído.
 * @param {object} e
 * @param {string} e.nombre       el nombre del archivo (para los mensajes y los auxiliares)
 * @param {Buffer|Uint8Array} e.cabecera  sus primeros bytes (hasta 100)
 * @param {number} e.tamano       su tamaño en bytes
 * @param {{wal: boolean, shm: boolean, journalCaliente: boolean}} e.hermanos
 * @param {boolean} e.soloLectura
 * @param {string} [e.plataforma]
 * @returns {{ok: true, modo: 'normal'|'inmutable', wal: boolean} | {ok: false, codigo: string, mensaje: string}}
 */
function decidirApertura({ nombre, cabecera, tamano, hermanos, soloLectura, plataforma = plataformaDelProceso() }) {
  const base = baseDeAuxiliar(nombre, plataforma)
  if (base !== null) {
    return {
      ok: false,
      codigo: 'TESSERA-SQLITE-AUXILIAR',
      mensaje: `«${nombre}» es un archivo auxiliar de SQLite, no la base: elige «${base}».`
    }
  }
  const c = analizarCabecera(cabecera, tamano)
  if (c.tipo === 'vacio') {
    return {
      ok: false,
      codigo: 'TESSERA-SQLITE-VACIO',
      mensaje: `«${nombre}» está vacío (0 bytes): no es una base SQLite todavía. Para empezar una, crea una base nueva.`
    }
  }
  if (c.tipo === 'noSqlite') {
    return { ok: false, codigo: 'TESSERA-SQLITE-NO-SQLITE', mensaje: mensajeNoSqlite(nombre, c.parece) }
  }
  const h = hermanos || { wal: false, shm: false, journalCaliente: false }
  if (soloLectura && h.journalCaliente) {
    return {
      ok: false,
      codigo: 'TESSERA-SQLITE-JOURNAL',
      mensaje:
        `«${nombre}» tiene una escritura a medias (su «-journal»): en solo lectura no se puede recuperar. ` +
        'Ábrela una vez con la aplicación que la usa, o en una conexión sin «Solo lectura», y SQLite la recuperará.'
    }
  }
  if (soloLectura && c.wal && !h.wal) return { ok: true, modo: 'inmutable', wal: true }
  return { ok: true, modo: 'normal', wal: c.wal }
}

/** El texto de un archivo que no se deja leer, por plataforma (el remedio es otro). */
function mensajePermiso(nombre, plataforma = plataformaDelProceso()) {
  if (plataforma === 'mac') {
    return (
      `macOS no deja a Tessera leer «${nombre}». Si está en Documentos, Escritorio, Descargas o iCloud, ` +
      'dale permiso a Tessera en Ajustes del Sistema › Privacidad y seguridad › Archivos y carpetas ' +
      '(o Acceso total al disco) y vuelve a intentarlo. Ese permiso se pierde con cada actualización.'
    )
  }
  return `No hay permiso para leer «${nombre}».`
}

// --- Lo que se lee del disco -------------------------------------------------------------

/** Los primeros `n` bytes de un archivo (menos si es más corto). */
function leerPrincipio(ruta, n, fsImpl) {
  const fd = fsImpl.openSync(ruta, 'r')
  try {
    const buf = Buffer.alloc(n)
    const leidos = fsImpl.readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, leidos)
  } finally {
    fsImpl.closeSync(fd)
  }
}

function existe(ruta, fsImpl) {
  try {
    fsImpl.lstatSync(ruta)
    return true
  } catch {
    return false
  }
}

/**
 * ¿Es CALIENTE el journal de rollback? Existe, no está vacío (TRUNCATE lo deja en 0) y su
 * cabecera no está a ceros (PERSIST la pone a ceros al confirmar). Es la señal de una
 * escritura que no terminó.
 */
function journalCaliente(ruta, fsImpl) {
  const j = ruta + '-journal'
  if (!existe(j, fsImpl)) return false
  try {
    const b = leerPrincipio(j, 8, fsImpl)
    return b.length === 8 && b.some((x) => x !== 0)
  } catch {
    // No se puede leer: lo seguro es tratarlo como caliente (en solo lectura, no se abre).
    return true
  }
}

/**
 * Los problemas de ENLACE de una ruta guardada: los enlaces simbólicos entre el `.db` y sus
 * hermanos, y si la ruta REAL ya no es la guardada. Vacío = bien. Una ruta que no existe no
 * es un problema de enlace (lo dirá la apertura).
 */
function verificarRuta(ruta, { plataforma = plataformaDelProceso(), fsImpl = fs } = {}) {
  const problemas = []
  for (const r of [ruta, ...SUFIJOS_AUXILIARES.map((s) => ruta + s)]) {
    try {
      if (fsImpl.lstatSync(r).isSymbolicLink()) problemas.push({ tipo: 'enlace', ruta: r })
    } catch {
      // no existe: nada que mirar
    }
  }
  if (problemas.length === 0) {
    try {
      const real = fsImpl.realpathSync.native(ruta)
      const igual = sinCaja(plataforma) ? real.toLowerCase() === ruta.toLowerCase() : real === ruta
      if (!igual) problemas.push({ tipo: 'rutaCambiada', ruta, real })
    } catch {
      // no existe o no se deja: lo dirá la apertura
    }
  }
  return problemas
}

/**
 * Lo que `decidirApertura` necesita, leído del disco. Lanza con el error de Tessera si el
 * archivo no existe o no se deja leer (con el mensaje del permiso de la plataforma). Los
 * textos llevan el nombre y no la ruta: llegan al renderer.
 */
function inspeccionar(ruta, { plataforma = plataformaDelProceso(), fsImpl = fs } = {}) {
  const nombre = pathDe(plataforma).basename(ruta)
  let tamano
  let cabecera
  try {
    tamano = fsImpl.statSync(ruta).size
    cabecera = tamano > 0 ? leerPrincipio(ruta, LARGO_CABECERA, fsImpl) : Buffer.alloc(0)
  } catch (e) {
    const codigo = e && e.code
    if (codigo === 'ENOENT' || codigo === 'ENOTDIR') {
      if (volumenDesconectado(ruta, fsImpl)) throw errorSqlite('DESCONECTADO', mensajeDesconectado(nombre, raizDeVolumen(ruta)))
      throw errorSqlite('NO-EXISTE', `No existe «${nombre}»: se movió, se renombró o se borró.`)
    }
    if (codigo === 'EPERM' || codigo === 'EACCES') throw errorSqlite('PERMISO', mensajePermiso(nombre, plataforma))
    throw e
  }
  return {
    nombre,
    tamano,
    cabecera,
    hermanos: { wal: existe(ruta + '-wal', fsImpl), shm: existe(ruta + '-shm', fsImpl), journalCaliente: journalCaliente(ruta, fsImpl) }
  }
}

module.exports = {
  MAGIA_SQLITE,
  LARGO_CABECERA,
  SUFIJOS_AUXILIARES,
  errorSqlite,
  plataformaDelProceso,
  pathDe,
  baseDeAuxiliar,
  esUnc,
  raizDeVolumen,
  volumenDesconectado,
  mensajeDesconectado,
  uriSqlite,
  analizarCabecera,
  decidirApertura,
  mensajeNoSqlite,
  mensajePermiso,
  inspeccionar,
  verificarRuta
}
