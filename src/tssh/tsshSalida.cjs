// =============================================================================
// Los códigos de salida propios de `tssh`, el error que los lleva y cómo se avisa: siempre por la salida de
// errores y con «tssh:» delante, para no mezclarse con la salida de la orden remota. Los mismos códigos los
// decide el main (`CODIGOS_TSSH` de `src/main/ssh/controlador/puenteTssh.ts`). Para un contenedor, sin las
// carpetas del equipo. Depende de `textosTssh` y, al avisar, de `tsshRutas` (la plataforma).
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const os = require('node:os')
const { textosTssh } = require('./textosTssh.cjs')

/** La marca que pone el host al ejecutar `tssh` para un contenedor (`ejecutorTssh` de `controlador/buzonTssh.ts`). */
const ENV_BUZON_TSSH = 'TESSERA_TSSH_BUZON'

/** ¿Lo ejecuta el host para un contenedor? Entonces no se enseñan las rutas del equipo que se conocen. */
function paraContenedor(env = process.env) {
  return env[ENV_BUZON_TSSH] === '1'
}

/**
 * Las carpetas que dicen quién es el usuario del equipo: la personal y, en Windows, la temporal,
 * que puede llegar con su nombre corto y entonces no cuelga, escrita, de la personal.
 */
function carpetasDelEquipo(plataforma) {
  return plataforma === 'windows' ? [os.homedir(), os.tmpdir()] : [os.homedir()]
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `texto` con cada una de `carpetas` cambiada por `marca`: con cualquier separador, sin distinguir
 * mayúsculas y solo la carpeta entera (ssh y el sistema escriben la ruta a su manera). Una letra de
 * unidad casa también en su forma `/c/…`. Nunca la raíz ni una unidad sola. La misma regla que
 * `sinCarpetasDelEquipo` de `src/tdb/tdbSalida.cjs`: cada CLI corre suelto, sin el otro.
 */
function sinCarpetasDelEquipo(texto, carpetas, marca = textosTssh().carpetaDelEquipo) {
  const patrones = carpetas
    .map((c) => String(c || '').replace(/[\\/]+$/, ''))
    .filter((c) => c.length > 2 && !/^[A-Za-z]:$/.test(c))
    .sort((a, b) => b.length - a.length)
    .map((c) =>
      c
        .split(/[\\/]+/)
        .map((s, i) => (i === 0 && /^[A-Za-z]:$/.test(s) ? `(?:${escaparRegex(s)}|[\\\\/]${s[0]})` : escaparRegex(s)))
        .join('[\\\\/]+')
    )
  let r = String(texto)
  for (const p of patrones) r = r.replace(new RegExp(`(?<![\\p{L}\\p{N}._~-])${p}(?![\\p{L}\\p{N}._~-])`, 'giu'), () => marca)
  return r
}

/** Un texto de Tessera para quien llamó: tal cual en una terminal nativa, sin las carpetas del equipo para un contenedor. */
function paraQuienLlama(texto, plataforma) {
  return paraContenedor() ? sinCarpetasDelEquipo(texto, carpetasDelEquipo(plataforma)) : texto
}

/**
 * Códigos propios: solo salen ANTES de que corra la orden remota (o al agotar el tope). Si la orden corre,
 * el código es el suyo, y 255 si ssh no pudo conectar o entrar.
 */
const CODIGOS = Object.freeze({ uso: 2, puente: 3, alias: 4, huella: 5, noUsable: 6, tope: 124 })

/** Un fallo de `tssh` con su código de salida. */
class ErrorTssh extends Error {
  constructor(codigo, mensaje) {
    super(mensaje)
    this.codigo = codigo
  }
}

/** Un fallo de uso (código 2), con la pista de la ayuda. */
function errorDeUso(mensaje) {
  return new ErrorTssh(CODIGOS.uso, textosTssh().conPistaDeAyuda(mensaje))
}

/** Escribe una línea de `tssh` en la salida de errores. */
function aviso(texto) {
  // Se pide aquí y no arriba: `tsshRutas` depende de este archivo.
  const { plataformaDelProceso } = require('./tsshRutas.cjs')
  process.stderr.write(`tssh: ${paraQuienLlama(texto, plataformaDelProceso())}\n`)
}

module.exports = { CODIGOS, ErrorTssh, errorDeUso, aviso, paraContenedor, carpetasDelEquipo, sinCarpetasDelEquipo, paraQuienLlama }
