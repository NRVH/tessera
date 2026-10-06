// =============================================================================
// `tssh` DENTRO del contenedor de un proyecto en modo Docker: no lanza ssh (el contenedor no tiene la red ni
// las claves del usuario); deja la orden en el buzón del puente de `tdb` y el `tssh` real corre en el host.
// Los archivos de `cp` viajan dentro de la petición y de la respuesta (el host nunca usa una ruta de aquí) y
// la salida, en base64 para no estropear un binario. Se copia al buzón junto a `tsshArgumentos`, `tsshRutas`
// y `tsshSalida`, y corre con el `node` de la imagen. Host: `src/main/ssh/controlador/buzonTssh.ts`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md, docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { analizar } = require('./tsshArgumentos.cjs')
const { lados, plataformaDelProceso } = require('./tsshRutas.cjs')
const { CODIGOS, ErrorTssh, aviso } = require('./tsshSalida.cjs')

/** Carpeta del buzón y token de la sesión: los fija Tessera al montar y al abrir la terminal. */
const BUZON = process.env.TESSERA_DB_BRIDGE || '/agent-config/dbbridge'
const TOKEN = process.env.TESSERA_DB_SESSION || ''
/** El centinela que Tessera refresca: si falta o está rancio, el puente no está (como en `tdb`). */
const CENTINELA = path.join(BUZON, '.alive')
const CENTINELA_MAX_EDAD_MS = 120_000

/** Lo que mueve un `cp` como mucho, en total (el buzón es un archivo JSON sobre 9p/virtiofs). */
const MAX_TRANSFERENCIA = 32 * 1024 * 1024
const MAX_ARCHIVOS = 10_000
/** Tope de la entrada de `run --stdin`. */
const MAX_ENTRADA = 8 * 1024 * 1024
/** El tope de `run` cuando no se pide otro: por el buzón la salida no llega en vivo, sino al acabar. */
const TOPE_RUN_S = 600
/** Lo que se espera a la respuesta más allá del tope del host (los mismos números en `buzonTssh.ts`). */
const MARGEN_S = 60
const ESPERA_CP_S = 1800 + MARGEN_S
const ESPERA_OTRAS_S = 90 + MARGEN_S
const SONDEO_RAPIDO_MS = 50
const SONDEO_RAPIDO_HASTA_MS = 2000
const SONDEO_LENTO_MS = 200

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Falla en el acto, con la frase útil, si el buzón no está montado o Tessera no da señales. */
function comprobarBuzon() {
  if (!TOKEN) throw new ErrorTssh(CODIGOS.puente, 'Esta terminal no lleva el contexto de Tessera: recarga la terminal (o reinicia el agente).')
  if (!fs.existsSync(BUZON)) throw new ErrorTssh(CODIGOS.puente, `El puente al host no está montado (${BUZON} no existe): recarga la terminal.`)
  let edad = Infinity
  try {
    edad = Date.now() - fs.statSync(CENTINELA).mtimeMs
  } catch {
    // Sin centinela: el bind se perdió al recrearse el contenedor.
  }
  if (edad > CENTINELA_MAX_EDAD_MS) throw new ErrorTssh(CODIGOS.puente, 'El puente al host no responde: recarga la terminal; si sigue, reinicia Tessera.')
}

/** Suma un archivo al total y falla si pasa de los topes. */
function contar(total, bytes, archivos) {
  const nuevo = total + bytes
  if (nuevo > MAX_TRANSFERENCIA) throw new ErrorTssh(CODIGOS.noUsable, `En modo Docker, tssh cp mueve como mucho ${MAX_TRANSFERENCIA / (1024 * 1024)} MiB por vez: copia por partes.`)
  if (archivos > MAX_ARCHIVOS) throw new ErrorTssh(CODIGOS.noUsable, `En modo Docker, tssh cp mueve como mucho ${MAX_ARCHIVOS} archivos por vez: copia por partes.`)
  return nuevo
}

/** Las carpetas y archivos bajo `raiz` (siguiendo enlaces, sin repetir una carpeta), con su contenido. */
function leerCarpeta(raiz) {
  const carpetas = []
  const archivos = []
  const vistas = new Set()
  let total = 0
  const recorrer = (abs, rel) => {
    const real = fs.realpathSync(abs)
    if (vistas.has(real)) return
    vistas.add(real)
    for (const nombre of fs.readdirSync(abs)) {
      const hijo = path.join(abs, nombre)
      const ruta = rel ? `${rel}/${nombre}` : nombre
      let st
      try {
        st = fs.statSync(hijo)
      } catch {
        continue // un enlace roto: scp tampoco lo copiaría
      }
      if (st.isDirectory()) {
        carpetas.push(ruta)
        recorrer(hijo, ruta)
      } else if (st.isFile()) {
        total = contar(total, st.size, archivos.length + 1)
        archivos.push({ ruta, datos: fs.readFileSync(hijo).toString('base64') })
      }
    }
  }
  recorrer(raiz, '')
  return { carpetas, archivos }
}

/** El origen local de una subida, entero dentro de la petición. */
function leerOrigen(local, recursivo) {
  let st
  try {
    st = fs.statSync(local)
  } catch {
    throw new ErrorTssh(CODIGOS.uso, `No existe «${local}».`)
  }
  const nombre = path.basename(local)
  if (!nombre) throw new ErrorTssh(CODIGOS.uso, `No se puede copiar «${local}» entero: elige una carpeta concreta.`)
  if (st.isFile()) {
    contar(0, st.size, 1)
    return { nombre, tipo: 'archivo', datos: fs.readFileSync(local).toString('base64') }
  }
  if (!st.isDirectory()) throw new ErrorTssh(CODIGOS.uso, `«${local}» no es un archivo ni una carpeta.`)
  if (!recursivo) throw new ErrorTssh(CODIGOS.uso, `«${local}» es una carpeta: usa tssh cp -r.`)
  return { nombre, tipo: 'carpeta', ...leerCarpeta(local) }
}

/** Un nombre o una ruta relativa que manda el host: sin `..`, sin raíz y sin vacíos. */
function relativaSegura(ruta) {
  return typeof ruta === 'string' && ruta !== '' && ruta.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !s.includes('\\'))
}

/** Escribe aquí lo que bajó el host, con la regla de scp: dentro si el destino es una carpeta que existe. */
function escribirDescarga(local, d) {
  if (!d || !relativaSegura(d.nombre) || d.nombre.includes('/')) throw new ErrorTssh(CODIGOS.puente, 'La respuesta de Tessera no se entiende.')
  let destino = local
  try {
    if (fs.statSync(local).isDirectory()) destino = path.join(local, d.nombre)
  } catch {
    // No existe: se crea con ese nombre, como hace scp.
  }
  if (d.tipo === 'archivo') {
    fs.writeFileSync(destino, Buffer.from(String(d.datos || ''), 'base64'))
    return
  }
  const carpetas = Array.isArray(d.carpetas) ? d.carpetas : []
  const archivos = Array.isArray(d.archivos) ? d.archivos : []
  if (![...carpetas, ...archivos.map((a) => a && a.ruta)].every(relativaSegura)) throw new ErrorTssh(CODIGOS.puente, 'La respuesta de Tessera no se entiende.')
  fs.mkdirSync(destino, { recursive: true })
  for (const c of carpetas) fs.mkdirSync(path.join(destino, ...c.split('/')), { recursive: true })
  for (const a of archivos) fs.writeFileSync(path.join(destino, ...a.ruta.split('/')), Buffer.from(String(a.datos || ''), 'base64'))
}

/**
 * La entrada de `run --stdin`, entera. Como flujo y no con `readFileSync(0)`, que con una entrada que no
 * bloquea (un socket o una tubería no bloqueante) da EAGAIN y la orden recibiría la entrada vacía.
 */
function leerEntrada() {
  return new Promise((resolve, reject) => {
    const trozos = []
    let bytes = 0
    process.stdin.on('data', (t) => {
      bytes += t.length
      if (bytes > MAX_ENTRADA) reject(new ErrorTssh(CODIGOS.uso, `La entrada supera los ${MAX_ENTRADA / (1024 * 1024)} MiB que admite el puente al host.`))
      else trozos.push(t)
    })
    process.stdin.on('end', () => resolve(Buffer.concat(trozos).toString('base64')))
    process.stdin.on('error', reject)
  })
}

/** Lo que viaja al host, y lo que hace falta para acabar aquí (dónde escribir lo que baje). */
async function prepararEnvio(argv, a) {
  if (a.sub === 'run') {
    const conTope = a.tope === null ? ['run', '--timeout', String(TOPE_RUN_S), ...argv.slice(1)] : argv
    return { peticion: { argv: conTope, ...(a.entrada ? { entrada: await leerEntrada() } : {}) }, esperaS: (a.tope ?? TOPE_RUN_S) + 30 + MARGEN_S }
  }
  if (a.sub !== 'cp') return { peticion: { argv }, esperaS: ESPERA_OTRAS_S }
  const l = lados(a.origen, a.destino, { plataforma: plataformaDelProceso(), cwd: process.cwd(), casa: os.homedir(), cygpath: null })
  const remoto = `${l.alias}:${l.rutaRemota}`
  const cp = l.subida ? { subida: true, recursivo: a.recursivo, remoto, ...leerOrigen(l.local, a.recursivo) } : { subida: false, recursivo: a.recursivo, remoto }
  return { peticion: { argv: ['cp'], cp }, esperaS: ESPERA_CP_S, bajarA: l.subida ? null : l.local }
}

/** Lee la respuesta si ya está entera (sobre 9p la entrada puede verse antes que su contenido). */
function leerRespuesta(ruta) {
  try {
    const texto = fs.readFileSync(ruta, 'utf-8')
    return texto.trim() ? JSON.parse(texto) : null
  } catch {
    return null
  }
}

/** Escribe la petición y SONDEA la respuesta: `inotify` no ve las escrituras del host sobre el bind. */
async function preguntar(peticion, esperaS) {
  const id = randomUUID()
  const rutaPeticion = path.join(BUZON, `${id}.req.json`)
  const rutaRespuesta = path.join(BUZON, `${id}.res.json`)
  const tmp = `${rutaPeticion}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...peticion, v: 1, prog: 'tssh', token: TOKEN, cwd: process.cwd() }), 'utf-8')
  fs.renameSync(tmp, rutaPeticion)
  const t0 = Date.now()
  for (;;) {
    const r = fs.existsSync(rutaRespuesta) ? leerRespuesta(rutaRespuesta) : null
    if (r) {
      fs.rmSync(rutaRespuesta, { force: true })
      return r
    }
    const transcurrido = Date.now() - t0
    if (transcurrido > esperaS * 1000) {
      fs.rmSync(rutaPeticion, { force: true })
      throw new ErrorTssh(CODIGOS.puente, `El puente no respondió en ${esperaS} s: comprueba que Tessera sigue abierta y recarga la terminal.`)
    }
    await dormir(transcurrido < SONDEO_RAPIDO_HASTA_MS ? SONDEO_RAPIDO_MS : SONDEO_LENTO_MS)
  }
}

/** Despacha y resuelve con el código de salida. */
async function main(argv) {
  const a = analizar(argv)
  comprobarBuzon()
  const envio = await prepararEnvio(argv, a)
  const r = await preguntar(envio.peticion, envio.esperaS)
  if (typeof r.salida === 'string' && r.salida) process.stdout.write(Buffer.from(r.salida, 'base64'))
  if (typeof r.stdout === 'string' && r.stdout) process.stdout.write(r.stdout)
  if (typeof r.stderr === 'string' && r.stderr) process.stderr.write(r.stderr)
  const codigo = typeof r.exitCode === 'number' ? r.exitCode : 1
  if (codigo === 0 && envio.bajarA) escribirDescarga(envio.bajarA, r.descarga)
  return codigo
}

/** Sale cuando ya se escribió todo: con la salida canalizada, salir a secas puede cortar lo que quede. */
function salir(codigo) {
  process.exitCode = codigo
  process.stdout.write('', () => process.stderr.write('', () => process.exit(codigo)))
}

if (require.main === module) {
  main(process.argv.slice(2)).then(salir, (e) => {
    aviso(e instanceof Error ? e.message : String(e))
    salir(e instanceof ErrorTssh ? e.codigo : 1)
  })
}

module.exports = { leerOrigen, escribirDescarga, prepararEnvio, MAX_TRANSFERENCIA }
