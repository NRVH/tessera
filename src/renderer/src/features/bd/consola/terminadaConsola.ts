// =============================================================================
// La respuesta de una sentencia del lote de una consola SQL (`sentenciaTerminada`):
// filas, afectadas, hecho o error, con sus conjuntos extra, lo que imprimió el servidor y
// los avisos del main, compuestos en Salida, pestañas y lectores en UN estado. Puro; lo
// usa `reductorLote.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type {
  DbBinds,
  DbConjuntoSiguiente,
  DbResultadoFilas,
  DbResultadoSentencia
} from '../../../../../shared/db-explorador-ipc.ts'
import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import type { RefObjeto } from '../../../../../shared/sql/clasificarSql.ts'
import type { Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import { citar } from '../../../../../shared/sql/identificadoresSql.ts'
import { sesionEsBase } from '../nivelBasesBd.ts'
import { anexarPagina } from '../rejilla/celdasRejilla.ts'
import {
  aplicarLote,
  tituloResultado,
  type EstadoResultados,
  type NuevoResultado
} from '../resultados/pestanasResultado.ts'
import { filasDePagina, finalizado, objetoDe, registrar, restantes, resumenLote, type Lote } from './lote.ts'
import {
  activarSalida,
  conLectores,
  conSalida,
  type AccionDe,
  type EstadoConsola,
  type ResultadoConsola
} from './modeloConsola.ts'
import { textoRechazoProduccion } from './produccionConsola.ts'
import {
  contarCompilacion,
  entradasCompilacion,
  entradasServidor,
  etiquetaPosicion,
  etiquetaRestantes,
  etiquetaSentencia,
  primeraPosicionCompilacion,
  textoAfectadas,
  textoCancelada,
  textoCompletado,
  textoErrorParametros,
  textoErrorResultado,
  textoFilas,
  textoLoteDetenido,
  type IrAPosicion,
  type NuevaEntrada
} from './salidaConsola.ts'

type Terminada = AccionDe<'sentenciaTerminada'>

/** Lo que va componiendo `terminada` antes de devolver el estado nuevo. */
interface Acumulado {
  nuevas: NuevaEntrada[]
  resultados: EstadoResultados<ResultadoConsola>
  lectores: readonly string[]
  creoPestana: boolean
}

function tituloDe(tabla: RefObjeto | null, esquema: string | null, motor: DbMotor, k: number): string {
  // Los identificadores ya llegan plegados del clasificador: se CITAN para que
  // `tituloResultado` no los vuelva a plegar (`MiTabla` en Oracle daría `MITABLA`).
  const ref = tabla
    ? { esquema: tabla.esquema !== null ? citar(tabla.esquema) : null, nombre: citar(tabla.nombre) }
    : null
  // Donde la sesión relee la BASE (SQL Server), `select * from t` se titula `t`.
  const t = tituloResultado(ref, sesionEsBase(motor) ? null : esquema, motor, k)
  return tabla && tabla.dblink ? `${t}@${tabla.dblink}` : t
}

/** Línea «Lote detenido: k de n» cuando el lote acaba de terminar parado. */
export function cierreDeLote(previo: Lote, lote: Lote): NuevaEntrada[] {
  if (finalizado(previo) || !finalizado(lote)) return []
  if (lote.estado !== 'detenido' && lote.estado !== 'cancelado') return []
  if (lote.sentencias.length < 2) return []
  const r = resumenLote(lote)
  const om = restantes(lote)
  const entrada: NuevaEntrada = { tipo: 'info', texto: textoLoteDetenido(r.ok, r.total) }
  if (om.length > 0) {
    entrada.accion = { tipo: 'ejecutarRestantes', loteId: lote.id, desde: om[0], etiqueta: etiquetaRestantes(om.length) }
  }
  return [entrada]
}

function resultadoDeFilas(
  r: DbResultadoFilas,
  loteId: number,
  indice: number,
  s: Sentencia,
  esquemaSesion: string | null,
  binds?: DbBinds
): { resultado: ResultadoConsola; filas: number; error: string | null } {
  const an = anexarPagina(null, r.pagina, r.columnas.length)
  const datos = an.ok ? an.datos : null
  const filas = datos ? datos.filas.length : filasDePagina(r.pagina.filasJson)
  const resultado: ResultadoConsola = {
    lector: r.lector,
    loteId,
    sentencia: indice,
    sql: s.texto,
    clase: s.clase,
    columnas: r.columnas,
    datos,
    errorDatos: an.ok ? null : an.error,
    filasPrimeraPagina: filas,
    tiempos: r.tiempos,
    afectadas: typeof r.afectadas === 'number' ? r.afectadas : null,
    noReleible: r.noReleible === true,
    reejecutada: r.pagina.reejecutada === true,
    sinLector: null,
    tabla: s.tablaUnica,
    esquemaSesion
  }
  return {
    resultado: binds ? { ...resultado, binds } : resultado,
    filas,
    error: an.ok ? null : an.error
  }
}

/** Los conjuntos extra de un resultado: `siguientes`, o `anteriores` si falló. */
export function conjuntosExtra(r: DbResultadoSentencia): readonly DbConjuntoSiguiente[] {
  if (r.tipo === 'error') return r.anteriores ?? []
  return r.siguientes ?? []
}

/** El título de la subpestaña `j` de la sentencia `k`: «Resultado k.j». */
export function tituloConjunto(k: number, j: number): string {
  return `Resultado ${k}.${j}`
}

/**
 * Las pestañas y las líneas de Salida de los conjuntos extra de una sentencia. Tras el
 * primero se numeran desde .2; los de antes de un error, desde .1. Un conjunto no tiene
 * lector y es `noReleible`: «Más» re-ejecutaría la sentencia y leería el PRIMERO.
 */
function pestanasDeConjuntos(
  extra: readonly DbConjuntoSiguiente[],
  deError: boolean,
  loteId: number,
  indice: number,
  s: Sentencia,
  esquemaSesion: string | null,
  binds?: DbBinds
): { entradas: NuevaEntrada[]; nuevos: NuevoResultado<ResultadoConsola>[] } {
  const entradas: NuevaEntrada[] = []
  const nuevos: NuevoResultado<ResultadoConsola>[] = []
  // Numeradas SEGUIDAS entre las que tienen pestaña (un «N filas afectadas» no la tiene):
  // «1.2, 1.3», no «1.2, 1.4» con un hueco que parece una pestaña perdida.
  let j = deError ? 1 : 2
  for (const c of extra) {
    if (c.tipo === 'afectadas') {
      entradas.push({ tipo: 'afectadas', texto: textoAfectadas(c.filas, c.tiempos.totalMs) })
      continue
    }
    const f = resultadoDeFilas({ ...c, lector: null }, loteId, indice, s, esquemaSesion, binds)
    entradas.push({ tipo: 'filas', texto: textoFilas(f.filas, c.pagina.hayMas, c.tiempos) })
    if (f.error) entradas.push({ tipo: 'error', texto: `No se pudieron leer las filas: ${f.error}` })
    if (c.columnas.length > 0) {
      // Sin tabla: el título de la tabla única es el del PRIMER conjunto de la sentencia.
      nuevos.push({ titulo: tituloConjunto(indice + 1, j++), resultado: { ...f.resultado, noReleible: true, tabla: null } })
    }
  }
  return { entradas, nuevos }
}

function avisosDe(r: DbResultadoSentencia): NuevaEntrada[] {
  if (r.tipo === 'error' || !r.avisos) return []
  return r.avisos.filter((t) => t && t.trim() !== '').map((t) => ({ tipo: 'aviso' as const, texto: t.trim() }))
}

function anotarFilas(acc: Acumulado, motor: DbMotor, loteId: number, a: Terminada, s: Sentencia, r: DbResultadoFilas): void {
  const f = resultadoDeFilas(r, loteId, a.indice, s, a.esquema, a.binds)
  acc.nuevas.push(
    typeof r.afectadas === 'number'
      ? { tipo: 'afectadas', texto: textoAfectadas(r.afectadas, r.tiempos.totalMs, f.filas) }
      : { tipo: 'filas', texto: textoFilas(f.filas, r.pagina.hayMas, r.tiempos) }
  )
  if (f.error) acc.nuevas.push({ tipo: 'error', texto: `No se pudieron leer las filas: ${f.error}` })
  if (r.columnas.length > 0) {
    const titulo = tituloDe(s.tablaUnica, a.esquema, motor, a.indice + 1)
    const cambio = aplicarLote(acc.resultados, [{ titulo, resultado: f.resultado }], { lote: loteId })
    acc.resultados = cambio.estado
    acc.lectores = conLectores(acc.lectores, cambio.lectoresPorCerrar)
    acc.creoPestana = true
  } else if (r.lector) {
    // Sin columnas no hay pestaña que lo use: se cierra ya.
    acc.lectores = conLectores(acc.lectores, [r.lector])
  }
}

type ResultadoError = Extract<DbResultadoSentencia, { tipo: 'error' }>

/**
 * El enlace del ✗: la posición del error del servidor o, si no la trae (un ORA-24344 no
 * la trae), la del primer error de compilación situado, o la sentencia entera.
 */
function irDelError(r: ResultadoError, loteId: number, a: Terminada): IrAPosicion {
  const pos = typeof r.error.posicion === 'number' ? r.error.posicion : null
  if (pos !== null) {
    return { loteId, sentencia: a.indice, desplazamiento: pos, etiqueta: etiquetaPosicion(a.posicionModelo) }
  }
  const posCompilacion = primeraPosicionCompilacion(r.compilacion)
  if (posCompilacion !== null) {
    return { loteId, sentencia: a.indice, desplazamiento: posCompilacion, etiqueta: etiquetaPosicion(null), exacta: true }
  }
  return { loteId, sentencia: a.indice, desplazamiento: 0, etiqueta: etiquetaSentencia(a.indice + 1) }
}

/**
 * El texto del ✗. Un rechazo por `parametros` o por `produccion` dice primero que NO se
 * envió: es lo que tranquiliza, porque no cambió nada.
 */
function textoDelError(r: ResultadoError, s: Sentencia): string {
  if (r.error.motivo === 'parametros') return textoErrorParametros(r.error)
  if (r.error.motivo === 'produccion') return textoRechazoProduccion(r.error)
  return textoErrorResultado(r, objetoDe(s))
}

function anotarError(acc: Acumulado, loteId: number, a: Terminada, s: Sentencia, r: ResultadoError): void {
  if (r.error.motivo === 'cancelada') {
    acc.nuevas.push({ tipo: 'aviso', texto: textoCancelada(r.tiempos.totalMs) })
    return
  }
  acc.nuevas.push({ tipo: 'error', texto: textoDelError(r, s), ir: irDelError(r, loteId, a) })
  acc.nuevas.push(...entradasCompilacion(r.compilacion, loteId, a.indice))
  acc.resultados = activarSalida(acc.resultados)
}

function anotarResultado(acc: Acumulado, motor: DbMotor, loteId: number, a: Terminada, s: Sentencia): void {
  const r = a.resultado
  switch (r.tipo) {
    case 'filas':
      anotarFilas(acc, motor, loteId, a, s, r)
      break
    case 'afectadas':
      acc.nuevas.push({ tipo: 'afectadas', texto: textoAfectadas(r.filas, r.tiempos.totalMs) })
      break
    case 'hecho':
      // Un CREATE de PL/SQL que compiló con avisos: lo dice la línea y los detalla debajo.
      acc.nuevas.push({
        tipo: 'completado',
        texto: textoCompletado(r.tiempos.totalMs, contarCompilacion(r.compilacion).avisos)
      })
      acc.nuevas.push(...entradasCompilacion(r.compilacion, loteId, a.indice))
      break
    case 'error':
      anotarError(acc, loteId, a, s, r)
      break
  }
}

/**
 * Los conjuntos EXTRA de la sentencia (un EXEC o un lote de T-SQL con varios SELECT):
 * subpestañas y sus líneas. Los de antes de un error van ANTES de la línea del error.
 */
function anotarConjuntosExtra(acc: Acumulado, loteId: number, a: Terminada, s: Sentencia): void {
  const r = a.resultado
  const extra = conjuntosExtra(r)
  if (extra.length === 0) return
  const x = pestanasDeConjuntos(extra, r.tipo === 'error', loteId, a.indice, s, a.esquema, a.binds)
  if (r.tipo === 'error') acc.nuevas.unshift(...x.entradas)
  else acc.nuevas.push(...x.entradas)
  if (x.nuevos.length > 0) {
    const cambio = aplicarLote(acc.resultados, x.nuevos, { lote: loteId, error: r.tipo === 'error' })
    acc.resultados = cambio.estado
    acc.lectores = conLectores(acc.lectores, cambio.lectoresPorCerrar)
    acc.creoPestana = true
  }
}

/** Aplica la respuesta de una sentencia; el MISMO estado si es de otro lote o repetida. */
export function terminada(e: EstadoConsola, a: Terminada): EstadoConsola {
  const previo = e.lote
  if (!previo || previo.id !== a.loteId) return e
  const lote = registrar(previo, a.indice, a.resultado)
  if (lote === previo) return e
  const s = a.sentencia ?? previo.sentencias[a.indice].s
  const r = a.resultado
  const acc: Acumulado = { nuevas: [], resultados: e.resultados, lectores: e.lectoresPorCerrar, creoPestana: false }
  anotarResultado(acc, e.motor, lote.id, a, s)
  anotarConjuntosExtra(acc, lote.id, a, s)
  // Lo que imprimió el servidor va también si falló: un NOTICE antes de la excepción es
  // justo lo que se busca. Entre los avisos del main va el commit implícito de un DDL.
  acc.nuevas.push(...entradasServidor(r.salida))
  acc.nuevas.push(...avisosDe(r))
  // Un lote sin filas (afectadas, completado, cancelación) enseña la Salida, salvo que el
  // usuario haya elegido otra pestaña; un error del servidor ya la activó con o sin ella.
  const errorServidor = r.tipo === 'error' && r.error.motivo !== 'cancelada'
  if (!errorServidor && !acc.creoPestana && !acc.resultados.eligioEnLote) {
    const hayDelLote = acc.resultados.pestanas.some((p) => p.lote === lote.id)
    if (!hayDelLote) acc.resultados = activarSalida(acc.resultados)
  }
  acc.nuevas.push(...cierreDeLote(previo, lote))
  return {
    ...e,
    lote,
    resultados: acc.resultados,
    lectoresPorCerrar: acc.lectores,
    salida: conSalida(e, acc.nuevas, a.ahora)
  }
}
