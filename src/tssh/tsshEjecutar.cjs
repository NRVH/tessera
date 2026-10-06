// =============================================================================
// Lanza el ssh (o el scp) que preparó Tessera: con el entorno de la terminal sin lo que no debe heredar, más
// lo suyo (el `PATH` se antepone), la salida en vivo y la de errores también en vivo, guardando su cola para
// que Tessera clasifique un 255. Con tope, mata el árbol entero y lo dice. La ficha del programa de
// contraseñas solo viaja en el entorno del hijo. Depende de `tsshRutas.cjs` (la plataforma).
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { constants } = require('node:os')
const path = require('node:path')
const { plataformaDelProceso } = require('./tsshRutas.cjs')

/** Bytes de la salida de errores que se guardan; Tessera mira las últimas líneas. */
const BYTES_COLA = 8192
/** Lo que se le manda a Tessera: su puente corta las peticiones a 4 KiB. */
const MAX_COLA = 2000

/** Las secuencias ANSI y los controles salvo el salto de línea, por su código (escritos tal cual romperían el archivo). */
const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const CONTROLES = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(9)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g')

/** El entorno del hijo: `base` sin `quitar` (sin distinguir mayúsculas, como Windows) y con `extra` encima. */
function entornoHijo(base, quitar, extra) {
  const fuera = new Set(quitar.map((k) => k.toUpperCase()))
  const env = Object.fromEntries(Object.entries(base).filter(([k]) => !fuera.has(k.toUpperCase())))
  for (const [k, v] of Object.entries(extra || {})) {
    const clavePath = k.toUpperCase() === 'PATH' ? Object.keys(env).find((x) => x.toUpperCase() === 'PATH') : undefined
    if (clavePath === undefined) env[k] = v
    else env[clavePath] = env[clavePath] ? `${v}${path.delimiter}${env[clavePath]}` : v
  }
  return env
}

/** La cola de la salida de errores sin ANSI ni controles, recortada. */
function colaLimpia(trozos) {
  return Buffer.concat(trozos).toString('utf-8').replace(ANSI, '').replace(CONTROLES, '').slice(-MAX_COLA)
}

/** Mata el hijo y lo que cuelgue de él: en Windows, matar solo a scp deja vivo su ssh. */
function matarArbol(hijo) {
  if (hijo.pid === undefined) return
  if (plataformaDelProceso() === 'windows') {
    const taskkill = path.win32.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'taskkill.exe')
    spawnSync(taskkill, ['/PID', String(hijo.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  } else {
    hijo.kill('SIGTERM')
  }
}

/** El código de un hijo que murió por una señal, como lo dan los shells (128 + número). */
function codigoDeSenal(senal) {
  const n = senal ? constants.signals[senal] : undefined
  return typeof n === 'number' ? 128 + n : null
}

/**
 * Corre el hijo. `entrada`: hereda la de `tssh` (`--stdin`) o ninguna; `silencio`: no repite la salida de
 * errores (la prueba de `doctor`). Resuelve con el código (null si no arrancó o agotó el tope), lo que tardó
 * y la cola de errores.
 */
function ejecutar(exe, args, { env, entrada = false, topeS = null, silencio = false }) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const trozos = []
    let bytes = 0
    let agotado = false
    let hijo
    try {
      hijo = spawn(exe, args, { env, windowsHide: true, stdio: [entrada ? 'inherit' : 'ignore', silencio ? 'ignore' : 'inherit', 'pipe'] })
    } catch (e) {
      resolve({ codigo: null, agotado: false, ms: 0, cola: '', error: e instanceof Error ? e.message : String(e) })
      return
    }
    hijo.stderr.on('data', (trozo) => {
      if (!silencio) process.stderr.write(trozo)
      trozos.push(trozo)
      bytes += trozo.length
      while (bytes > BYTES_COLA && trozos.length > 1) bytes -= trozos.shift().length
    })
    const tope = topeS ? setTimeout(() => {
      agotado = true
      matarArbol(hijo)
    }, topeS * 1000) : null
    hijo.on('error', (e) => {
      if (tope) clearTimeout(tope)
      resolve({ codigo: null, agotado: false, ms: Date.now() - t0, cola: '', error: e.message })
    })
    hijo.on('close', (codigo, senal) => {
      if (tope) clearTimeout(tope)
      resolve({ codigo: agotado ? null : (codigo ?? codigoDeSenal(senal)), agotado, ms: Date.now() - t0, cola: colaLimpia(trozos), error: null })
    })
  })
}

module.exports = { ejecutar, entornoHijo, colaLimpia }
