// =============================================================================
// Los argumentos de `tctx`: el vocabulario cerrado (`reglas`, `proponer`, `traspaso`, `buscar`, `help`), las
// opciones de `proponer`, con el texto de una sola fuente (`--archivo`, `--texto` o `-`, la entrada estándar), y
// las de `buscar`. Puro: lanza `ErrorTctx` de uso (código 2). Lo usan `tctx.cjs` y `tctx-container.cjs`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
'use strict'

const { errorDeUso } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')

/** Las opciones de `proponer` que llevan valor, y el campo donde va. */
const CON_VALOR = { '--archivo': 'archivo', '--texto': 'texto', '--motivo': 'motivo' }

/** La opción con valor en la posición `i` (`--x v` o `--x=v`): su nombre, su valor y cuántos argumentos usa. */
function opcionConValor(args, i) {
  const a = args[i]
  const igual = a.indexOf('=')
  const nombre = igual > 0 ? a.slice(0, igual) : a
  if (!(nombre in CON_VALOR)) return null
  if (igual > 0) return { campo: CON_VALOR[nombre], valor: a.slice(igual + 1), usados: 1 }
  if (i + 1 >= args.length) throw errorDeUso(textosTctx().faltaValor(nombre))
  return { campo: CON_VALOR[nombre], valor: args[i + 1], usados: 2 }
}

/** `proponer (--archivo R | --texto T | -) [--motivo M]`: exactamente una fuente del texto. */
function analizarProponer(args) {
  const r = { sub: 'proponer', fuente: null, motivo: '' }
  const fuentes = []
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '-') {
      fuentes.push({ tipo: 'entrada' })
      i++
      continue
    }
    const o = opcionConValor(args, i)
    if (o === null) throw errorDeUso(textosTctx().proponerSinOpcion(a))
    if (o.campo === 'motivo') r.motivo = o.valor
    else fuentes.push(o.campo === 'archivo' ? { tipo: 'archivo', ruta: o.valor } : { tipo: 'texto', texto: o.valor })
    i += o.usados
  }
  if (fuentes.length === 0) throw errorDeUso(textosTctx().faltaFuente)
  if (fuentes.length > 1) throw errorDeUso(textosTctx().dosFuentes)
  r.fuente = fuentes[0]
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

/** Los argumentos de `tctx` (sin el ejecutable ni el guion). Sin ninguno, la ayuda. */
function analizar(argv) {
  const [sub, ...resto] = argv
  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') return { sub: 'help' }
  if (sub === 'reglas') {
    if (resto.length > 0) throw errorDeUso(textosTctx().reglasNoLleva(resto[0]))
    return { sub: 'reglas' }
  }
  if (sub === 'proponer') return analizarProponer(resto)
  if (sub === 'traspaso') {
    if (resto.length > 0) throw errorDeUso(textosTctx().traspasoNoLleva(resto[0]))
    return { sub: 'traspaso' }
  }
  if (sub === 'buscar') return analizarBuscar(resto)
  throw errorDeUso(textosTctx().subcomandoDesconocido(sub))
}

module.exports = { analizar, MAX_TEXTO_BUSCAR, MAX_RESULTADOS }
