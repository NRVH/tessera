// =============================================================================
// El texto de `tctx proponer`, de su fuente: un argumento, un archivo (UTF-8 o el UTF-16 que deja
// `Out-File` de PowerShell, con o sin marca de orden de bytes) o la entrada estándar, con tope. En
// Windows, una ruta del shell de Git (`/c/…`) se traduce: el atajo `sh` le pide a MSYS que no convierta
// nada, para no tocar el texto. Lo usan `tctx.cjs` y `tctx-container.cjs`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { errorDeUso } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')

/** Lo que se lee como mucho de un archivo o de la entrada: unas reglas caben de sobra. */
const MAX_BYTES = 256 * 1024

/**
 * La plataforma del proceso, en la unión de `shared/plataforma.ts`. Un `.cjs` plano que se copia al
 * contenedor no puede importar ese módulo (es TypeScript), así que lee `process.platform` aquí, igual que
 * `plataformaDelProceso` de `tssh/tsshRutas.cjs`; cada programa lleva la suya porque el buzón copia
 * solo los archivos de su propia carpeta.
 */
function plataformaDelProceso() {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'linux') return 'linux'
  return 'otra'
}

/** El texto de unos bytes: la marca de orden de bytes manda; sin ella, UTF-8. */
function decodificar(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf-8')
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const invertidos = Buffer.from(bytes.subarray(2))
    invertidos.swap16()
    return invertidos.toString('utf16le')
  }
  return bytes.toString('utf-8')
}

/**
 * La ruta del archivo, absoluta: `~` es la carpeta del usuario (PowerShell no la expande al llamar a un
 * programa) y, en Windows, `/c/…` es `C:\…`; otra ruta que empiece por `/` no se sabe dónde está.
 */
function rutaDeArchivo(texto, { plataforma, cwd, casa }) {
  const p = plataforma === 'windows' ? path.win32 : path.posix
  if (texto === '~' || texto.startsWith('~/') || (plataforma === 'windows' && texto.startsWith('~\\'))) return p.join(casa, texto.slice(1))
  if (plataforma === 'windows' && texto.startsWith('/') && !texto.startsWith('//')) {
    const unidad = /^\/(?:cygdrive\/)?([A-Za-z])(\/.*)?$/.exec(texto)
    if (!unidad) throw errorDeUso(textosTctx().rutaMsys(texto))
    return `${unidad[1].toUpperCase()}:${path.win32.normalize(unidad[2] || '/')}`
  }
  return p.resolve(cwd, texto)
}

/** El contenido de un archivo, con tope. */
function leerArchivo(ruta) {
  let bytes
  try {
    if (fs.statSync(ruta).size > MAX_BYTES) throw errorDeUso(textosTctx().archivoGrande(MAX_BYTES / 1024))
    bytes = fs.readFileSync(ruta)
  } catch (e) {
    if (e && e.codigo) throw e
    throw errorDeUso(textosTctx().noExisteArchivo(ruta))
  }
  return decodificar(bytes)
}

/** Lo que se espera como mucho a que la entrada termine: unas reglas por una tubería llegan al instante. */
const TOPE_ENTRADA_MS = 30_000

/**
 * La entrada estándar entera, como flujo: con una entrada que no bloquea, `readFileSync(0)` da EAGAIN.
 * Sin tubería (una terminal) no hay fin que esperar: es un error de uso. Con ella, el tope de tiempo
 * evita colgarse si quien la abrió no la cierra.
 */
function leerEntrada(entrada = process.stdin, topeMs = TOPE_ENTRADA_MS) {
  return new Promise((resolve, reject) => {
    if (entrada.isTTY) {
      reject(errorDeUso(textosTctx().entradaSinTuberia))
      return
    }
    const trozos = []
    let bytes = 0
    const reloj = setTimeout(() => reject(errorDeUso(textosTctx().entradaSinFin(topeMs / 1000))), topeMs)
    const fin = (accion) => (valor) => {
      clearTimeout(reloj)
      accion(valor)
    }
    entrada.on('data', (t) => {
      bytes += t.length
      if (bytes > MAX_BYTES) fin(reject)(errorDeUso(textosTctx().entradaGrande(MAX_BYTES / 1024)))
      else trozos.push(t)
    })
    entrada.on('end', () => fin(resolve)(decodificar(Buffer.concat(trozos))))
    entrada.on('error', fin(reject))
  })
}

/** El texto de la fuente que dio `analizar`. */
async function leerTexto(fuente, opciones) {
  if (fuente.tipo === 'texto') return fuente.texto
  if (fuente.tipo === 'archivo') return leerArchivo(rutaDeArchivo(fuente.ruta, opciones))
  return leerEntrada()
}

module.exports = { leerTexto, leerEntrada, decodificar, rutaDeArchivo, plataformaDelProceso, MAX_BYTES }
