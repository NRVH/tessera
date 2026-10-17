// =============================================================================
// Los argumentos de `tssh`: el vocabulario cerrado (`ls`, `run`, `cp`, `doctor`, `help`) y sus opciones, sin
// pasar ninguna a ssh. En `run`, tras el alias la primera palabra que no es una opción de `tssh` empieza la
// orden, haya `--` o no: PowerShell 5.1 se come un `--` sin comillas al llamar a un guion (medido). Puro:
// lanza `ErrorTssh` de uso (código 2). Lo usa `tssh.cjs`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const { errorDeUso } = require('./tsshSalida.cjs')
const { textosTssh } = require('./textosTssh.cjs')

/** El tope más largo que admite `--timeout`: un día. */
const TOPE_MAX_S = 24 * 3600
/** Un alias más largo que esto no es de ninguna conexión (el registro admite 120) y no cabría en una petición. */
const ALIAS_MAX = 500

/** Los segundos de `--timeout`: un número positivo, con decimales si hace falta. */
function segundos(valor) {
  const n = Number(valor)
  if (valor === undefined || String(valor).trim() === '' || !Number.isFinite(n) || n <= 0 || n > TOPE_MAX_S) {
    throw errorDeUso(textosTssh().timeoutInvalido(TOPE_MAX_S))
  }
  return n
}

/** Un alias como argumento: no vacío y de un largo razonable. */
function aliasValido(alias, ejemplo) {
  if (alias === null || alias.trim() === '') throw errorDeUso(textosTssh().faltaAlias(ejemplo))
  if (alias.length > ALIAS_MAX) throw errorDeUso(textosTssh().aliasLargo)
  return alias
}

/** Una opción de `run` en la posición `i`: cuántos argumentos usa (0 si no es una opción de `tssh`). */
function opcionDeRun(args, i, r) {
  const a = args[i]
  if (a === '--stdin') {
    r.entrada = true
    return 1
  }
  if (a === '--timeout') {
    r.tope = segundos(args[i + 1])
    return 2
  }
  if (a.startsWith('--timeout=')) {
    r.tope = segundos(a.slice('--timeout='.length))
    return 1
  }
  return 0
}

/** `run [opciones] <alias> [opciones] [--] <orden…>`. Antes del alias, una opción ajena es un error. */
function analizarRun(args) {
  const r = { sub: 'run', alias: null, orden: [], entrada: false, tope: null }
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (r.alias !== null && a === '--') {
      r.orden = args.slice(i + 1)
      break
    }
    const usados = opcionDeRun(args, i, r)
    if (usados > 0) {
      i += usados
      continue
    }
    if (r.alias !== null) {
      r.orden = args.slice(i)
      break
    }
    if (a === '--') throw errorDeUso(textosTssh().faltaAliasAntesDeGuiones)
    if (a.startsWith('-')) throw errorDeUso(textosTssh().runSinOpcion(a))
    r.alias = a
    i++
  }
  aliasValido(r.alias, textosTssh().ejemploRun)
  if (r.orden.every((p) => String(p).trim() === '')) throw errorDeUso(textosTssh().faltaOrden)
  return r
}

/** `cp [-r] [--] <origen> <destino>`: `-r` en cualquier sitio antes de un `--`. */
function analizarCp(args) {
  const r = { sub: 'cp', recursivo: false, origen: null, destino: null }
  const libres = []
  let opciones = true
  for (const a of args) {
    if (opciones && a === '--') opciones = false
    else if (opciones && (a === '-r' || a === '--recursivo')) r.recursivo = true
    else if (opciones && a.startsWith('-') && a !== '-') throw errorDeUso(textosTssh().cpSinOpcion(a))
    else libres.push(a)
  }
  if (libres.length !== 2) throw errorDeUso(textosTssh().cpOrigenYDestino)
  r.origen = libres[0]
  r.destino = libres[1]
  return r
}

/** `ls [--json]`. */
function analizarLs(args) {
  const r = { sub: 'ls', json: false }
  for (const a of args) {
    if (a !== '--json') throw errorDeUso(textosTssh().lsNoLleva(a))
    r.json = true
  }
  return r
}

/** `doctor [alias]`. */
function analizarDoctor(args) {
  const libres = args.filter((a) => a !== '--')
  if (libres.length > 1) throw errorDeUso(textosTssh().doctorUnAlias)
  if (libres.length === 1 && libres[0].startsWith('-') && args[0] !== '--') throw errorDeUso(textosTssh().doctorSinOpcion(libres[0]))
  return { sub: 'doctor', alias: libres.length === 1 ? aliasValido(libres[0], textosTssh().ejemploDoctor) : null }
}

/** Los argumentos de `tssh` (sin el ejecutable ni el guion). Sin ninguno, la ayuda. */
function analizar(argv) {
  const [sub, ...resto] = argv
  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') return { sub: 'help' }
  if (sub === 'ls') return analizarLs(resto)
  if (sub === 'run') return analizarRun(resto)
  if (sub === 'cp') return analizarCp(resto)
  if (sub === 'doctor') return analizarDoctor(resto)
  throw errorDeUso(textosTssh().subcomandoDesconocido(sub))
}

module.exports = { analizar, TOPE_MAX_S }
