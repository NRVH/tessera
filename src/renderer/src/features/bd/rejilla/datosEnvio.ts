// =============================================================================
// «Enviar» y «Descartar N cambios» de la pestaña de datos. Los cambios viajan en el
// orden de `aCambiosFila` y la vista previa sale del MISMO constructor que ejecuta el
// main; nada se da por enviado antes de la respuesta `hecho`, y con error, cancelación
// o COMMIT incierto lo pendiente SE QUEDA. Solo leen el núcleo estable.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import { DB_PAGINA_MAX, type DbResultadoEnvio, type DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql'
import { notify } from '../../../comun/notifications'
import { errorDeInvoke, textoError } from '../panesBd'
import {
  aCambiosFila,
  estadoAlAbrirEnvio,
  estadoTrasFallo,
  filaDeIndice,
  focoTrasCerrarEnvio,
  identidadParaEditar,
  numCambios,
  previaEnvio,
  resumenCambios,
  SIN_CAMBIOS,
  textoCambios,
  textoResumen,
  tiposPorNombre,
  type RefFila
} from './cambiosRejilla'
import { cancelarDatos, nuevaPeticion, ponerCambios, ponerEnvio } from './datosBase'
import { consultar } from './datosLectura'
import type { Envio, NucleoDatos } from './datosTipos'

/**
 * Pregunta «Descartar N cambios» si hay algo pendiente y resuelve si se puede seguir (y,
 * si sí, ya lo descartó). Dos peticiones a la vez comparten la misma pregunta.
 */
export function pedirDescarte(n: NucleoDatos): Promise<boolean> {
  const num = numCambios(n.cambiosRef.current)
  if (num === 0) return Promise.resolve(true)
  if (n.descarteRef.current) return n.descarteRef.current.promesa
  let resolver: (ok: boolean) => void = () => undefined
  const promesa = new Promise<boolean>((r) => {
    resolver = r
  })
  n.descarteRef.current = { promesa, resolver }
  n.setDescarte({ n: num })
  return promesa
}

/** Responde la pregunta; el foco lo devuelve el propio diálogo al cerrarse. */
export function responderDescarte(n: NucleoDatos, ok: boolean): void {
  const d = n.descarteRef.current
  n.descarteRef.current = null
  n.setDescarte(null)
  if (ok) ponerCambios(n, SIN_CAMBIOS)
  d?.resolver(ok)
}

/** Corre `accion` si no hay nada pendiente o si el usuario acepta descartarlo. */
export function conDescarte(n: NucleoDatos, accion: () => void): void {
  void pedirDescarte(n).then((ok) => {
    if (ok) accion()
  })
}

/** Señala en la rejilla la fila de un cambio que no se pudo aplicar. */
function senalar(n: NucleoDatos, ref: RefFila, mensaje: string): void {
  n.setFilaError({ ref, mensaje, token: ++n.tokenErrorRef.current })
}

/** Arma los cambios y su vista previa y abre el diálogo (o señala la fila que no cuadra). */
export function abrirEnvio(n: NucleoDatos): void {
  const base = n.resRef.current
  const c = n.cambiosRef.current
  const con = n.propsRef.current.conexion
  if (!base || numCambios(c) === 0 || n.envioRef.current || n.descarteRef.current) return
  const ident = identidadParaEditar(base.identidad, base.columnas)
  const conv = aCambiosFila(c, {
    columnas: base.columnas,
    identidad: ident,
    filas: base.datos.filas,
    recortada: (f, col) => base.datos.recortes.get(f)?.has(col) === true,
    comparables: base.comparables,
    // La regla de tipo de los originales es del motor (SQLite, por afinidad).
    dialecto: dialectoDeMotor(con.motor)
  })
  if (!conv.ok) {
    senalar(n, conv.fila, conv.error)
    notify('error', 'No se puede enviar', conv.error)
    return
  }
  const previa = previaEnvio(con.motor, base.objetoReal, ident, conv.cambios, tiposPorNombre(base.columnas))
  if (!previa.ok) {
    const ref = filaDeIndice(conv.origen, previa.indice)
    if (ref) senalar(n, ref, previa.error)
    notify('error', 'No se puede enviar', previa.error)
    return
  }
  ponerEnvio(n, {
    conv,
    identidad: ident,
    objeto: base.objetoReal,
    lineas: previa.lineas,
    resumen: textoResumen(resumenCambios(c)),
    estado: estadoAlAbrirEnvio(n.envioInciertoRef.current)
  })
}

/** Salió bien: se limpia lo pendiente y se relee lo que había, conservando el sitio. */
function trasEnvioHecho(n: NucleoDatos, aplicados: number): void {
  ponerEnvio(n, null)
  ponerCambios(n, SIN_CAMBIOS)
  notify('success', `${textoCambios(aplicados)} ${aplicados === 1 ? 'aplicado' : 'aplicados'}`)
  // El diálogo devuelve el foco a quien lo abrió; tras él, a la rejilla.
  requestAnimationFrame(() => n.accionesRef.current?.enfocar())
  const cargadas = n.resRef.current?.datos.filas.length ?? 0
  void consultar(n, n.aplicadoRef.current, {
    maxFilas: Math.min(DB_PAGINA_MAX, Math.max(n.propsRef.current.filasPorPagina, cargadas)),
    conservar: true
  })
}

/** La respuesta del envío que sigue siendo el vigente, en el mismo turno. */
function aplicarRespuestaEnvio(n: NucleoDatos, r: DbRespuesta<DbResultadoEnvio>, e: Envio): void {
  const actual = n.envioRef.current ?? e
  if (!r.ok) {
    const detenido = r.error.motivo === 'cancelada'
    ponerEnvio(n, {
      ...actual,
      estado: {
        tipo: 'error',
        titulo: detenido ? 'Envío detenido: no se aplicó nada' : 'No se envió nada',
        mensaje: detenido ? '' : textoError(r.error),
        indice: null
      }
    })
    return
  }
  const v = r.valor
  if (v.tipo === 'hecho') return trasEnvioHecho(n, v.cambios)
  const ref = filaDeIndice(actual.conv.origen, v.indice)
  // Título, mensaje y COMMIT INCIERTO los decide `estadoTrasFallo`: los cambios se quedan.
  const { estado, detenido, mensaje } = estadoTrasFallo(v, actual.conv.cambios.length)
  // La duda sobrevive al diálogo: si se cierra y se reabre, lo vuelve a decir.
  if (estado.incierto === true) n.envioInciertoRef.current = true
  ponerEnvio(n, { ...actual, estado })
  if (ref && !detenido) senalar(n, ref, mensaje)
}

/** Manda el envío abierto; `confirmado` solo en producción, desde el botón del diálogo. */
export async function ejecutarEnvio(n: NucleoDatos): Promise<void> {
  const e = n.envioRef.current
  if (!e || e.estado.tipo === 'enviando') return
  const con = n.propsRef.current.conexion
  const produccion = con.entorno === 'produccion'
  const id = nuevaPeticion('envio')
  n.envioIdRef.current = id
  ponerEnvio(n, { ...e, estado: { tipo: 'enviando' } })
  let r: DbRespuesta<DbResultadoEnvio>
  try {
    r = await window.tessera.dbExplorador.enviarCambios({
      conexionId: con.id,
      peticionId: id,
      objeto: e.objeto,
      identidad: e.identidad,
      cambios: e.conv.cambios,
      // En producción, el botón «Ejecutar en producción» ES la confirmación.
      ...(produccion ? { confirmado: true } : {})
    })
  } catch (err) {
    r = { ok: false, error: errorDeInvoke(err) }
  }
  // La pestaña se cerró mientras tanto: el desmontaje ya lo canceló.
  if (n.envioIdRef.current !== id) return
  n.envioIdRef.current = null
  aplicarRespuestaEnvio(n, r, e)
}

/** Stop del envío: cancela por su `peticionId`. */
export function detenerEnvio(n: NucleoDatos): void {
  const id = n.envioIdRef.current
  if (!id) return
  cancelarDatos(n.propsRef.current.conexion.id, id)
}

/** Cierra el diálogo (no mientras envía); con el COMMIT incierto el foco va a la rejilla. */
export function cerrarEnvio(n: NucleoDatos): void {
  const e = n.envioRef.current
  if (e?.estado.tipo === 'enviando') return
  ponerEnvio(n, null)
  // En el siguiente fotograma: al desmontarse, el diálogo devuelve antes el foco a quien lo abrió.
  if (e && focoTrasCerrarEnvio(e.estado) === 'rejilla') {
    requestAnimationFrame(() => n.accionesRef.current?.enfocar())
  }
}
