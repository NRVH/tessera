// =============================================================================
// Los argumentos de `tctx`: el vocabulario cerrado (`reglas`, `proponer`, `traspaso`, `buscar`, `docs`, `config`,
// `cuentas`, `modelos`, `delegar`, `tarea`, `tareas`, `help`), las opciones de cada orden, con el texto de una sola fuente (`--archivo`,
// `--texto` o `-`, la entrada estándar) donde lo hay. Puro: lanza `ErrorTctx` de uso (código 2). Lo usan `tctx.cjs`
// y `tctx-container.cjs`.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md, docs/decisiones/agentes/buscar-en-el-historial.md,
// docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
'use strict'

const { errorDeUso } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')

/** Las opciones de `proponer` que llevan valor, y el campo donde va. `config proponer` admite además las suyas. */
const CON_VALOR = { '--archivo': 'archivo', '--texto': 'texto', '--motivo': 'motivo' }
const CON_VALOR_CONFIG = { ...CON_VALOR, '--nivel': 'nivel', '--agente': 'agente' }

/** La opción con valor en la posición `i` (`--x v` o `--x=v`): su nombre, su valor y cuántos argumentos usa. */
function opcionConValor(args, i, opciones = CON_VALOR) {
  const a = args[i]
  const igual = a.indexOf('=')
  const nombre = igual > 0 ? a.slice(0, igual) : a
  if (!(nombre in opciones)) return null
  if (igual > 0) return { campo: opciones[nombre], valor: a.slice(igual + 1), usados: 1 }
  if (i + 1 >= args.length) throw errorDeUso(textosTctx().faltaValor(nombre))
  return { campo: opciones[nombre], valor: args[i + 1], usados: 2 }
}

/**
 * `proponer (--archivo R | --texto T | -) [--motivo M] [--global]`: exactamente una fuente del texto; `--global`
 * propone las reglas globales en vez de las del perfil. Con `config`, en su lugar `--nivel` y `--agente`, que
 * quedan en el resultado.
 */
function analizarProponer(args, config = false) {
  const r = config ? { sub: 'config-proponer', fuente: null, motivo: '' } : { sub: 'proponer', fuente: null, motivo: '' }
  const fuentes = []
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '-') {
      fuentes.push({ tipo: 'entrada' })
      i++
      continue
    }
    if (a === '--global' && !config) {
      r.nivel = 'global'
      i++
      continue
    }
    const o = opcionConValor(args, i, config ? CON_VALOR_CONFIG : CON_VALOR)
    if (o === null) throw errorDeUso(textosTctx().proponerSinOpcion(a))
    const fuente = FUENTES[o.campo]
    if (fuente) fuentes.push(fuente(o.valor))
    else r[o.campo] = o.valor
    i += o.usados
  }
  if (fuentes.length === 0) throw errorDeUso(textosTctx().faltaFuente)
  if (fuentes.length > 1) throw errorDeUso(textosTctx().dosFuentes)
  r.fuente = fuentes[0]
  if (config) exigirNivel(r)
  return r
}

/** Las opciones que dan el texto; las demás (motivo, nivel, agente) son campos del resultado. */
const FUENTES = {
  archivo: (ruta) => ({ tipo: 'archivo', ruta }),
  texto: (texto) => ({ tipo: 'texto', texto })
}

function exigirNivel(r) {
  if (r.nivel !== 'global' && r.nivel !== 'perfil') throw errorDeUso(textosTctx().configNivel)
}

/** `config [--agente A]` lo muestra; `config proponer …` propone el archivo de configuración entero nuevo de un nivel. */
function analizarConfig(args) {
  if (args[0] === 'proponer') return analizarProponer(args.slice(1), true)
  const r = { sub: 'config' }
  for (let i = 0; i < args.length; ) {
    const o = opcionConValor(args, i, { '--agente': 'agente' })
    if (o === null) throw errorDeUso(textosTctx().configSinOpcion(args[i]))
    r.agente = o.valor
    i += o.usados
  }
  return r
}

/** Topes de `buscar`: los de `src/main/historial/` (`MAX_TEXTO_BUSQUEDA`, `MAX_RESULTADOS_TOPE`); los fija `test:tctx`. */
const MAX_TEXTO_BUSCAR = 200
const MAX_RESULTADOS = 20

/** El número de `--max`, entre 1 y el tope. */
function leerMax(valor) {
  if (valor === undefined) throw errorDeUso(textosTctx().faltaValor('--max'))
  const n = /^\d+$/.test(valor) ? Number(valor) : 0
  if (n < 1 || n > MAX_RESULTADOS) throw errorDeUso(textosTctx().maxInvalido(MAX_RESULTADOS))
  return n
}

/**
 * `buscar <palabras…> [--max N] [--exacta]`: las palabras sueltas se unen con un espacio, así que no hacen
 * falta comillas; tras `--`, todo es texto (para buscar algo que empiece por `--`).
 */
function analizarBuscar(args) {
  const t = textosTctx()
  const palabras = []
  let max
  let exacta = false
  let soloTexto = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (soloTexto || !a.startsWith('--')) palabras.push(a)
    else if (a === '--') soloTexto = true
    else if (a === '--exacta') exacta = true
    else if (a === '--max') max = leerMax(args[++i])
    else if (a.startsWith('--max=')) max = leerMax(a.slice('--max='.length))
    else throw errorDeUso(t.buscarSinOpcion(a))
  }
  const texto = palabras.join(' ').trim()
  if (texto === '') throw errorDeUso(t.faltaBusqueda)
  if (texto.length > MAX_TEXTO_BUSCAR) throw errorDeUso(t.busquedaLarga(MAX_TEXTO_BUSCAR))
  return max === undefined ? { sub: 'buscar', texto, exacta } : { sub: 'buscar', texto, exacta, max }
}

function analizarReglas(resto) {
  if (resto.length === 1 && (resto[0] === '--perfil' || resto[0] === '--global')) return { sub: 'reglas', nivel: resto[0].slice(2) }
  if (resto.length > 0) throw errorDeUso(textosTctx().reglasNoLleva(resto[0]))
  return { sub: 'reglas' }
}

/** Los argumentos de `tctx` (sin el ejecutable ni el guion). Sin ninguno, la ayuda. */
function analizar(argv) {
  const [sub, ...resto] = argv
  if ([undefined, 'help', '--help', '-h'].includes(sub)) return { sub: 'help' }
  // `reglas` da los dos niveles con su encabezado; `--perfil` o `--global`, uno solo tal cual, para editarlo y proponerlo.
  if (sub === 'reglas') return analizarReglas(resto)
  if (sub === 'proponer') return analizarProponer(resto)
  if (sub === 'cuentas' || sub === 'tareas') {
    if (resto.length) throw errorDeUso(textosTctx().delegacionUso)
    return { sub }
  }
  if (sub === 'modelos') return analizarModelos(resto)
  if (sub === 'delegar' || sub === 'tarea') return analizarDelegacion(sub, resto)
  if (sub === 'traspaso') {
    if (resto.length > 0) throw errorDeUso(textosTctx().traspasoNoLleva(resto[0]))
    return { sub: 'traspaso' }
  }
  if (sub === 'buscar') return analizarBuscar(resto)
  if (sub === 'config') return analizarConfig(resto)
  // `docs` sin nada lista; con un nombre, lo lee. Las palabras sueltas se unen: un nombre puede llevar espacios.
  if (sub === 'docs') {
    const nombre = resto.join(' ').trim()
    return nombre === '' ? { sub: 'docs' } : { sub: 'docs', nombre }
  }
  throw errorDeUso(textosTctx().subcomandoDesconocido(sub))
}

/** `modelos --agente A [--cuenta C|auto] [--actualizar]`. */
function analizarModelos(args) {
  const t = textosTctx()
  const r = { sub: 'modelos', cuenta: 'auto' }
  const vistos = new Set()
  for (let i = 0; i < args.length;) {
    const nombre = args[i].split('=')[0]
    if (vistos.has(nombre)) throw errorDeUso(t.delegacionUso)
    vistos.add(nombre)
    if (args[i] === '--actualizar') {
      r.actualizar = true
      i++
      continue
    }
    const o = opcionConValor(args, i, { '--agente': 'agente', '--cuenta': 'cuenta' })
    if (!o || !o.valor || o.valor.startsWith('--')) throw errorDeUso(t.delegacionUso)
    r[o.campo] = o.valor
    i += o.usados
  }
  if (!['claude-code', 'codex'].includes(r.agente)) throw errorDeUso(t.delegacionUso)
  return r
}

/** El tope de `--max-segundos`: un día. */
const MAX_SEGUNDOS_ESPERA = 86400

function analizarDelegacion(sub, args) {
  const t = textosTctx()
  const r = sub === 'delegar' ? { sub, cuenta: 'auto' } : { sub, id: args[0] }
  if (sub === 'tarea' && (!r.id || r.id.startsWith('-'))) throw errorDeUso(t.delegacionUso)
  const vistos = new Set()
  const indicadores = sub === 'delegar'
    ? { '-': 'entrada', '--sin-esperar': 'sinEsperar', '--solo-lectura': 'soloLectura' }
    : { '-': 'entrada', '--sin-esperar': 'sinEsperar', '--cancelar': 'cancelar', '--continuar': 'continuar', '--esperar': 'esperar' }
  const conValor = sub === 'delegar'
    ? { '--agente': 'agente', '--cuenta': 'cuenta', '--archivo': 'archivo', '--modelo': 'modelo', '--esfuerzo': 'esfuerzo' }
    : { '--archivo': 'archivo', '--modelo': 'modelo', '--esfuerzo': 'esfuerzo', '--max-segundos': 'maxSegundos' }
  for (let i = sub === 'tarea' ? 1 : 0; i < args.length;) {
    const a = args[i]
    const nombre = a.split('=')[0]
    if (vistos.has(nombre)) throw errorDeUso(t.delegacionUso)
    vistos.add(nombre)
    if (Object.hasOwn(indicadores, a)) r[indicadores[a]] = true
    else {
      const o = opcionConValor(args, i, conValor)
      if (!o || !o.valor || o.valor.startsWith('--')) throw errorDeUso(t.delegacionUso)
      r[o.campo] = o.valor
      i += o.usados
      continue
    }
    i++
  }
  return completarDelegacion(r)
}

/** Esperar es consultar: una orden que para o continúa la tarea tiene su propia espera. */
function comprobarEspera(r) {
  if (r.esperar && (r.cancelar || r.continuar)) throw errorDeUso(textosTctx().delegacionUso)
  if (r.maxSegundos === undefined) return
  const n = /^\d+$/.test(r.maxSegundos) ? Number(r.maxSegundos) : 0
  if (!r.esperar || n < 1 || n > MAX_SEGUNDOS_ESPERA) throw errorDeUso(textosTctx().delegacionUso)
  r.maxSegundos = n
}

function completarDelegacion(r) {
  const t = textosTctx()
  if (r.cancelar && r.continuar) throw errorDeUso(t.delegacionUso)
  if (r.cancelar) r.accion = 'cancelar'
  if (r.continuar) r.accion = 'continuar'
  if (r.sub === 'delegar' && !['claude-code', 'codex'].includes(r.agente)) throw errorDeUso(t.delegacionUso)
  const llevaOrden = r.sub === 'delegar' || r.continuar
  if (!llevaOrden && [r.entrada, r.archivo, r.sinEsperar, r.modelo, r.esfuerzo].some(Boolean)) throw errorDeUso(t.delegacionUso)
  if (r.entrada && r.archivo) throw errorDeUso(t.delegacionUso)
  comprobarEspera(r)
  if (llevaOrden) r.fuente = r.archivo ? { tipo: 'ruta', ruta: r.archivo } : { tipo: 'entrada' }
  delete r.archivo
  delete r.entrada
  delete r.cancelar
  delete r.continuar
  return r
}

module.exports = { analizar, MAX_TEXTO_BUSCAR, MAX_RESULTADOS }
