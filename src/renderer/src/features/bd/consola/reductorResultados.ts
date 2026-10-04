// =============================================================================
// Sub-reductores de una consola SQL fuera del lote: las pestañas de resultado (página,
// lector cerrado, liberar memoria, acciones de pestaña) y la sesión y la Salida (sesión,
// Commit/Rollback, pista, líneas sueltas, limpiar, drenar lectores). Puros; los llama
// `reducirConsola` de `estadoConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import { anexarPagina, SIN_RECORTES, type MapaRecortes } from '../rejilla/celdasRejilla.ts'
import {
  activar,
  actualizarResultado,
  cerrar,
  cerrarOtrasNoFijadas,
  cerrarTodas,
  desfijar,
  fijar,
  type CambioResultados,
  type EstadoResultados
} from '../resultados/pestanasResultado.ts'
import {
  MOTIVO_LIBERADA,
  conLectores,
  conSalida,
  type AccionDe,
  type AccionPestana,
  type EstadoConsola,
  type ResultadoConsola
} from './modeloConsola.ts'
import { textoCommitRechazado } from './produccionConsola.ts'
import { limpiarSalida, textoAvisoSesion, textoError, textoTx } from './salidaConsola.ts'

/** Las acciones sobre las pestañas de resultado. */
export type AccionResultados = AccionDe<'pagina' | 'lectorCerrado' | 'liberar' | 'pestana'>

/** Las acciones sobre la sesión, la pista y la Salida. */
export type AccionSesionYSalida = AccionDe<'sesion' | 'tx' | 'pista' | 'salida' | 'limpiarSalida' | 'drenarLectores'>

function conResultado(
  e: EstadoConsola,
  id: string,
  cambiar: (r: ResultadoConsola) => ResultadoConsola | null,
  extraLectores: (r: ResultadoConsola) => readonly string[] = () => []
): EstadoConsola {
  const r = e.resultados.resultados[id]
  if (!r) return e
  const nuevo = cambiar(r)
  if (!nuevo || nuevo === r) return e
  return {
    ...e,
    resultados: actualizarResultado(e.resultados, id, nuevo),
    lectoresPorCerrar: conLectores(e.lectoresPorCerrar, extraLectores(r))
  }
}

function recortesHasta(m: MapaRecortes, n: number): MapaRecortes {
  let quitar = false
  m.forEach((_v, fila) => {
    if (fila >= n) quitar = true
  })
  if (!quitar) return m
  const nuevo = new Map<number, ReadonlyMap<number, number>>()
  m.forEach((v, fila) => {
    if (fila < n) nuevo.set(fila, v)
  })
  return nuevo.size === 0 ? SIN_RECORTES : nuevo
}

function pagina(e: EstadoConsola, a: AccionDe<'pagina'>): EstadoConsola {
  return conResultado(e, a.id, (r) => {
    const an = anexarPagina(r.datos, a.pagina, r.columnas.length)
    if (!an.ok) return { ...r, errorDatos: an.error }
    return {
      ...r,
      datos: an.datos,
      errorDatos: null,
      lector: a.pagina.hayMas ? r.lector : null,
      reejecutada: r.reejecutada || a.pagina.reejecutada === true
    }
  })
}

function liberar(e: EstadoConsola, a: AccionDe<'liberar'>): EstadoConsola {
  return conResultado(
    e,
    a.id,
    (r) => {
      if (!r.datos || r.datos.filas.length <= r.filasPrimeraPagina) return null
      const n = r.filasPrimeraPagina
      return {
        ...r,
        datos: { filas: r.datos.filas.slice(0, n), recortes: recortesHasta(r.datos.recortes, n), hayMas: true },
        lector: null,
        sinLector: MOTIVO_LIBERADA
      }
    },
    (r) => (r.lector ? [r.lector] : [])
  )
}

function cambioDePestana(
  r: EstadoResultados<ResultadoConsola>,
  accion: AccionPestana,
  id: string
): CambioResultados<ResultadoConsola> {
  switch (accion) {
    case 'activar':
      return { estado: activar(r, id), lectoresPorCerrar: [] }
    case 'fijar':
      return { estado: fijar(r, id), lectoresPorCerrar: [] }
    case 'desfijar':
      return { estado: desfijar(r, id), lectoresPorCerrar: [] }
    case 'cerrar':
      return cerrar(r, id)
    case 'cerrarOtras':
      return cerrarOtrasNoFijadas(r, id)
    case 'cerrarTodas':
      return cerrarTodas(r)
  }
}

function pestana(e: EstadoConsola, a: AccionDe<'pestana'>): EstadoConsola {
  const cambio = cambioDePestana(e.resultados, a.accion, a.id)
  if (cambio.estado === e.resultados && cambio.lectoresPorCerrar.length === 0) return e
  return {
    ...e,
    resultados: cambio.estado,
    lectoresPorCerrar: conLectores(e.lectoresPorCerrar, cambio.lectoresPorCerrar)
  }
}

/** Aplica una acción de pestañas de resultado; el MISMO estado si no cambia nada. */
export function reducirResultados(e: EstadoConsola, a: AccionResultados): EstadoConsola {
  switch (a.tipo) {
    case 'pagina':
      return pagina(e, a)
    case 'lectorCerrado':
      return conResultado(e, a.id, (r) =>
        r.lector === null && r.sinLector === a.motivo ? null : { ...r, lector: null, sinLector: a.motivo }
      )
    case 'liberar':
      return liberar(e, a)
    case 'pestana':
      return pestana(e, a)
  }
}

/** Un aviso de sesión se escribe en la Salida UNA vez (`ultimoAvisoEn`). */
function sesion(e: EstadoConsola, a: AccionDe<'sesion'>): EstadoConsola {
  const s = a.sesion
  if (s && s.aviso && s.aviso.en !== e.ultimoAvisoEn) {
    return {
      ...e,
      sesion: s,
      ultimoAvisoEn: s.aviso.en,
      salida: conSalida(e, [{ tipo: 'aviso', texto: textoAvisoSesion(s.aviso) }], a.ahora)
    }
  }
  return s === e.sesion ? e : { ...e, sesion: s }
}

function tx(e: EstadoConsola, a: AccionDe<'tx'>): EstadoConsola {
  if (a.respuesta.ok) {
    return {
      ...e,
      sesion: a.respuesta.valor,
      salida: conSalida(e, [{ tipo: 'tx', texto: textoTx(a.op, a.ms) }], a.ahora)
    }
  }
  // Un COMMIT rechazado por producción dice primero que no se confirmó.
  const texto =
    a.respuesta.error.motivo === 'produccion' ? textoCommitRechazado(a.respuesta.error) : textoError(a.respuesta.error)
  return { ...e, salida: conSalida(e, [{ tipo: 'error', texto }], a.ahora) }
}

/** Aplica una acción de sesión, pista o Salida; el MISMO estado si no cambia nada. */
export function reducirSesionYSalida(e: EstadoConsola, a: AccionSesionYSalida): EstadoConsola {
  switch (a.tipo) {
    case 'sesion':
      return sesion(e, a)
    case 'tx':
      return tx(e, a)
    case 'pista':
      return e.pista === a.texto ? e : { ...e, pista: a.texto }
    case 'salida':
      return { ...e, salida: conSalida(e, [a.entrada], a.ahora) }
    case 'limpiarSalida': {
      const salida = limpiarSalida(e.salida)
      return salida === e.salida ? e : { ...e, salida }
    }
    case 'drenarLectores':
      return e.lectoresPorCerrar.length === 0 ? e : { ...e, lectoresPorCerrar: [] }
  }
}
