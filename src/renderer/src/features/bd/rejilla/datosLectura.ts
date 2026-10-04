// =============================================================================
// El ciclo de lectura de la pestaña de datos con el main: `abrirTabla` con un
// `peticionId` NUEVO por consulta (una respuesta vieja se descarta y su lector se
// cierra), páginas de «más filas» con su propio id, «Traer todas», «Contar», Detener
// y soltar memoria cuando el presupuesto de celdas lo pide. Solo leen el núcleo estable.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import type { DbErrorSql, DbPagina, DbRespuesta, DbTablaAbierta } from '../../../../../shared/db-explorador-ipc'
import { MOTIVO_LIBERADA } from '../consola/estadoConsola'
import { camposDeFiltroTabla } from '../filtro/modeloFiltro'
import { errorDeInvoke, motivoSinLector, peticionesEnVuelo, textoError } from '../panesBd'
import { notify } from '../../../comun/notifications'
import { numCambios, SIN_CAMBIOS } from './cambiosRejilla'
import { anexarPagina, soloPrimeraPagina } from './celdasRejilla'
import { registroCeldas } from './presupuestoCeldas'
import { motivoTopeTraerTodas, siguientePaso, trasFalloPagina, type OrigenPagina } from './traerTodas'
import {
  cancelarDatos,
  cerrarSilencioso,
  fallo,
  nuevaPeticion,
  ponerCambios,
  ponerRes,
  soltarLector
} from './datosBase'
import type { Filtro, FinPagina, NucleoDatos } from './datosTipos'

/** Texto de la píldora con el tope de memoria alcanzado al desplazar. */
export const MOTIVO_TOPE = 'Tope de memoria alcanzado: afina el filtro para ver más'

export interface OpcionesConsulta {
  maxFilas?: number
  conservar?: boolean
  sinEsperar?: boolean
}

function enVuelo(n: NucleoDatos): string[] {
  return peticionesEnVuelo({
    consulta: n.peticionRef.current,
    cargando: n.cargandoRef.current,
    mas: n.masRef.current,
    contar: n.contarRef.current
  })
}

/** Cancela lo anterior y deja la pestaña «cargando» con un `peticionId` nuevo. */
function empezarConsulta(n: NucleoDatos, conexionId: string): string {
  // Lo que siguiera en vuelo ya no lo quiere nadie: se cancela en el servidor.
  for (const viejo of enVuelo(n)) cancelarDatos(conexionId, viejo)
  soltarLector(n)
  // Otro resultado: lo pendiente apuntaba a filas de ESTE (quien llama ya preguntó).
  ponerCambios(n, SIN_CAMBIOS)
  const peticionId = nuevaPeticion('tabla')
  n.peticionRef.current = peticionId
  n.cargandoRef.current = true
  n.contarRef.current = null
  n.masRef.current = null
  n.cargandoMasRef.current = false
  // Un «Traer todas» en marcha era de la consulta anterior (su página ya está cancelada).
  n.traerRef.current = null
  n.setTrayendo(false)
  n.setCargando(true)
  n.setCargandoMas(false)
  n.setContando(false)
  n.setSinLector(null)
  n.setError(null)
  n.setErrorCampo(null)
  n.setDetenida(false)
  return peticionId
}

/** La respuesta de `abrirTabla` que sigue siendo la vigente, en el mismo turno. */
function aplicarTabla(n: NucleoDatos, r: DbRespuesta<DbTablaAbierta>, filtro: Filtro, o: OpcionesConsulta, pagina: number): void {
  n.cargandoRef.current = false
  n.setCargando(false)
  if (!r.ok) return fallo(n, r.error)
  const { resultado, clavePrimaria, objeto: real, identidad, noEditables, comparables } = r.valor
  if (resultado.tipo === 'error') return fallo(n, resultado.error)
  const an = anexarPagina(null, resultado.pagina, resultado.columnas.length)
  if (!an.ok) {
    if (resultado.lector) cerrarSilencioso(resultado.lector)
    return fallo(n, { motivo: 'interno', mensaje: an.error })
  }
  n.lectorRef.current = resultado.lector
  n.setHayLector(resultado.lector !== null)
  n.setSinEsperar(o.sinEsperar === true)
  n.aplicadoRef.current = filtro
  n.setAplicado(filtro)
  n.setConservarPara(o.conservar ? an.datos : null)
  ponerRes(n, {
    columnas: resultado.columnas,
    datos: an.datos,
    clavePrimaria,
    objetoReal: real,
    identidad,
    noEditables,
    comparables,
    ms: resultado.tiempos.totalMs,
    total: an.datos.hayMas ? null : an.datos.filas.length,
    filasPrimeraPagina: Math.min(an.datos.filas.length, pagina)
  })
}

/** Consulta la tabla con `filtro` (lo de su modo y el orden). */
export async function consultar(n: NucleoDatos, filtro: Filtro, opciones: OpcionesConsulta = {}): Promise<void> {
  const { conexion: con, objeto: obj } = n.propsRef.current
  // Filas por página de Configuración, leídas AHORA: valen para esta lectura y las siguientes.
  const pagina = n.propsRef.current.filasPorPagina
  // Lo que se intenta, para que «Reintentar» / «Leer sin esperar» repitan ESTA consulta.
  n.intentoRef.current = { filtro, maxFilas: opciones.maxFilas }
  n.setSinEsperar(false)
  const peticionId = empezarConsulta(n, con.id)
  let r: DbRespuesta<DbTablaAbierta>
  try {
    r = await window.tessera.dbExplorador.abrirTabla({
      conexionId: con.id,
      peticionId,
      objeto: obj,
      // Lo del modo aplicado (el WHERE libre O el guiado) y el orden; nunca `orderBy`.
      ...camposDeFiltroTabla(filtro),
      maxFilas: opciones.maxFilas ?? pagina,
      // Solo si se pidió: la petición de siempre no cambia ni un campo.
      ...(opciones.sinEsperar ? { sinEsperar: true } : {})
    })
  } catch (err) {
    r = { ok: false, error: errorDeInvoke(err) }
  }
  if (n.peticionRef.current !== peticionId) {
    // Llegó tarde (otra consulta o la pestaña cerrada): su lector ya no es de nadie.
    if (r.ok && r.valor.resultado.tipo === 'filas' && r.valor.resultado.lector) {
      cerrarSilencioso(r.valor.resultado.lector)
    }
    return
  }
  aplicarTabla(n, r, filtro, opciones, pagina)
}

/** Lo que hace una página de «más filas» que falló; una cancelación no pierde el lector. */
function trasPaginaFallida(n: NucleoDatos, error: DbErrorSql): FinPagina {
  const que = trasFalloPagina(error, n.origenPaginaRef.current)
  if (que === 'seguir') return 'detenida'
  n.setSinLector({ motivo: motivoSinLector(error), reejecutable: true })
  if (que === 'detenida') return 'detenida'
  notify('error', 'No se pudieron leer más filas', textoError(error))
  // Tras un fallo que no es una cancelación el main ya no sirve ese lector.
  soltarLector(n)
  return 'fallo'
}

async function pedirPagina(n: NucleoDatos, lector: string, maxFilas: number, idMas: string): Promise<FinPagina> {
  const peticion = n.peticionRef.current
  let r: DbRespuesta<DbPagina>
  try {
    r = await window.tessera.dbExplorador.leerMas(lector, maxFilas, idMas)
  } catch (err) {
    r = { ok: false, error: errorDeInvoke(err) }
  }
  if (n.masRef.current === idMas) n.masRef.current = null
  // Otra consulta (o el cierre) la dejó sin dueño: `consultar` ya reinició todo.
  if (n.peticionRef.current !== peticion || n.lectorRef.current !== lector) return 'descartada'
  n.cargandoMasRef.current = false
  n.setCargandoMas(false)
  if (!r.ok) return trasPaginaFallida(n, r.error)
  const base = n.resRef.current
  if (!base) return 'descartada'
  const an = anexarPagina(base.datos, r.valor, base.columnas.length)
  if (!an.ok) {
    n.setSinLector({ motivo: 'Una página llegó descuadrada', reejecutable: true })
    notify('error', 'No se pudieron leer más filas', an.error)
    soltarLector(n)
    return 'fallo'
  }
  if (!an.datos.hayMas) {
    // El lector se agotó (el main lo cierra al servir la última página).
    n.lectorRef.current = null
    n.setHayLector(false)
  }
  ponerRes(n, { ...base, datos: an.datos, total: an.datos.hayMas ? base.total : an.datos.filas.length })
  return 'ok'
}

/**
 * Lee la página siguiente del lector y la anexa («cargar más» y «Traer todas»). Sin
 * lector, sin datos o con otra página en vuelo no pide nada ('ocupado').
 */
export function leerPagina(n: NucleoDatos, maxFilas: number, origen: OrigenPagina): Promise<FinPagina> {
  const lector = n.lectorRef.current
  const actual = n.resRef.current
  if (!lector || !actual || n.cargandoMasRef.current || n.cargandoRef.current) return Promise.resolve('ocupado')
  n.cargandoMasRef.current = true
  n.origenPaginaRef.current = origen
  n.setCargandoMas(true)
  // Id PROPIO de esta página, no el del `abrirTabla` ya terminado: es lo que Detener cancela.
  const idMas = nuevaPeticion('mas')
  n.masRef.current = idMas
  const pagina = pedirPagina(n, lector, maxFilas, idMas)
  n.paginaRef.current = pagina
  void pagina.then(() => {
    if (n.paginaRef.current === pagina) n.paginaRef.current = null
  })
  return pagina
}

/** La rejilla se acerca al final: otra página si cabe en el presupuesto GLOBAL de celdas. */
export async function cargarMas(n: NucleoDatos): Promise<void> {
  const actual = n.resRef.current
  if (!n.lectorRef.current || !actual || n.cargandoMasRef.current || n.cargandoRef.current) return
  const pagina = n.propsRef.current.filasPorPagina
  if (!registroCeldas.cabe(pagina * actual.columnas.length)) {
    n.setSinLector({ motivo: MOTIVO_TOPE, reejecutable: false, tope: true })
    return
  }
  await leerPagina(n, pagina, 'desplazar')
}

/**
 * «Traer todas»: páginas hasta el final, hasta Detener o hasta el tope de memoria. Un solo
 * bucle con sus `await` directos: un paso en función aparte añadiría un turno por página.
 */
export async function traerTodas(n: NucleoDatos): Promise<void> {
  if (n.traerRef.current || !n.resRef.current || !n.lectorRef.current) return
  const id = nuevaPeticion('traer')
  n.traerRef.current = id
  n.setTrayendo(true)
  n.setSinLector((s) => (s?.tope ? null : s))
  try {
    for (;;) {
      const enCurso = n.paginaRef.current
      if (enCurso) {
        // La adopta: si Detener la cancela, es el Detener de «Traer todas».
        n.origenPaginaRef.current = 'traerTodas'
        await enCurso
        continue
      }
      const base = n.resRef.current
      if (n.traerRef.current !== id || !base || !n.lectorRef.current) break
      const paso = siguientePaso({ hayMas: base.datos.hayMas, detenido: false, columnas: base.columnas.length }, registroCeldas)
      if (paso.tipo === 'tope') {
        n.setSinLector({ motivo: motivoTopeTraerTodas(base.datos.filas.length), reejecutable: false, tope: true })
        break
      }
      if (paso.tipo !== 'pedir') break
      if ((await leerPagina(n, paso.filas, 'traerTodas')) !== 'ok') break
    }
  } finally {
    if (n.traerRef.current === id) {
      n.traerRef.current = null
      n.setTrayendo(false)
    }
  }
}

/** Detener «Traer todas»: para el bucle y cancela la página en vuelo; lo traído se queda. */
export function detenerTraerTodas(n: NucleoDatos): void {
  if (!n.traerRef.current) return
  n.traerRef.current = null
  n.setTrayendo(false)
  const id = n.masRef.current
  if (!id) return
  cancelarDatos(n.propsRef.current.conexion.id, id)
}

/** «Contar» en la sesión del lector (ve sus propios cambios). */
export async function contar(n: NucleoDatos): Promise<void> {
  const lector = n.lectorRef.current
  if (!lector || n.contarRef.current) return
  const id = nuevaPeticion('contar')
  n.contarRef.current = id
  n.setContando(true)
  let r: DbRespuesta<number>
  try {
    r = await window.tessera.dbExplorador.contar(lector, id)
  } catch (err) {
    r = { ok: false, error: errorDeInvoke(err) }
  }
  if (n.contarRef.current !== id) return
  n.contarRef.current = null
  n.setContando(false)
  if (r.ok) {
    const base = n.resRef.current
    if (base) ponerRes(n, { ...base, total: r.valor })
  } else if (r.error.motivo !== 'cancelada') {
    notify('error', 'No se pudieron contar las filas', textoError(r.error))
  }
}

/** Detener lo para TODO, también «Traer todas» (si no, pediría la página siguiente). */
export function detener(n: NucleoDatos): void {
  const con = n.propsRef.current.conexion
  n.traerRef.current = null
  n.setTrayendo(false)
  for (const peticionId of enVuelo(n)) cancelarDatos(con.id, peticionId)
}

/**
 * El registro de celdas pide memoria: se queda con la primera página. SÍNCRONO (el registro
 * vuelve a medir `resRef` al volver); con una consulta en vuelo o cambios sin enviar, nada.
 */
export function liberar(n: NucleoDatos): void {
  const base = n.resRef.current
  if (!base || n.cargandoRef.current) return
  if (numCambios(n.cambiosRef.current) > 0) return
  const datos = soloPrimeraPagina(base.datos, base.filasPrimeraPagina)
  if (datos === base.datos) return
  // Lo que siguiera leyendo del lector ya no encaja: se cancela y, con sus ids a null,
  // sus respuestas se descartan al llegar.
  const con = n.propsRef.current.conexion
  for (const peticionId of [n.masRef.current, n.contarRef.current]) {
    if (peticionId) cancelarDatos(con.id, peticionId)
  }
  n.masRef.current = null
  n.contarRef.current = null
  n.cargandoMasRef.current = false
  n.traerRef.current = null
  n.setTrayendo(false)
  n.setCargandoMas(false)
  n.setContando(false)
  soltarLector(n)
  // El total (contado, o sabido por haber llegado al final) sigue siendo cierto.
  ponerRes(n, { ...base, datos })
  n.setSinLector({ motivo: MOTIVO_LIBERADA, reejecutable: true })
}
