// =============================================================================
// Las acciones de edición de la pestaña de colección: editar una celda o el documento entero,
// borrar y añadir documentos, el menú contextual y «Enviar». La edición queda PENDIENTE hasta
// «Enviar», que abre la vista previa con las órdenes; aceptarla en producción ya es confirmarla. Si
// el main devuelve 'produccion' o 'sinTransaccion', se pregunta y se reenvía con esa confirmación.
// Son funciones sobre el estado de `useEstadoEdicion`; `PaneColeccionBd` las llama.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import type { DbDocCambio, DbDocDocumento } from '../../../../../shared/db-documentos-ipc'
import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc'
import {
  DOCUMENTO_NUEVO,
  EDICION_VACIA,
  alternarBorrado,
  cambioDeDocumento,
  cambiosDeEdicion,
  claveDelCambio,
  descartarDocumento,
  editarInsertado,
  formatearDocumento,
  insertarDocumento,
  motivoNoEditarCampo,
  ponerCampo,
  quitarCampo,
  quitarInsertado,
  reemplazarDocumento,
  restanTrasEnvio,
  restaurarCampo,
  resumenEnvio,
  textoConCambios,
  valorDeCampo,
  type ConsultaColeccion,
  type EdicionDocs,
  type FilaDocs
} from './coleccionDocs'
import type { EstadoEdicion } from './useEdicionColeccion'
import { lineaDeCambioDocs, resumenCambiosDocs, textoIdDe } from './envioDocs'
import { errorDeInvoke, textoError } from '../panesBd'
import { copiarTexto } from './utilPanes'
import { txColeccionDocs } from './textosColeccionDocs'
import { notify } from '../../../comun/notificaciones'
import { SEP, type EntradaMenuContextual } from '../../../comun/MenuContextual'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { IconoBorrarFilas, IconoEditar, IconoRevertir } from '../iconosEdicion'

/** Una fila sin `_id` (proyección `{ _id: 0 }`, algunas vistas) no tiene identidad: sus cambios no sabrían a qué documento ir. */
export function sinIdentidad(f: FilaDocs): boolean {
  return f.estado !== 'nuevo' && f.documento.idEjson === ''
}

function avisarSinIdentidad(): void {
  const t = txColeccionDocs()
  notify('info', t.sinIdTitulo, t.sinIdMensaje)
}

/** Empieza a editar una celda con doble clic: pide su valor en notación del shell, o avisa de por qué no. */
export function editarCelda(estadoEdicion: EstadoEdicion, i: number, campo: string): void {
  if (estadoEdicion.enviando) return
  const f = estadoEdicion.filas[i]
  if (!f || f.estado === 'borrado') return
  if (sinIdentidad(f)) return avisarSinIdentidad()
  const motivo = motivoNoEditarCampo(campo)
  if (motivo) {
    notify('info', txColeccionDocs().campoNoEditable, motivo)
    return
  }
  const existe = campo in f.documento.celdas
  const valor = valorDeCampo(f.documento.texto, campo)
  if (existe && valor === null) {
    notify('info', txColeccionDocs().editaEnPanel, txColeccionDocs().noEditablePorCeldas)
    return
  }
  estadoEdicion.setEditando({ clave: f.clave, campo, valor: valor ?? '' })
}

/** Cierra el editor de celda: el valor nuevo queda pendiente si cambió. */
export function confirmarCelda(estadoEdicion: EstadoEdicion, texto: string): void {
  const editando = estadoEdicion.editando
  estadoEdicion.setEditando(null)
  if (!editando) return
  const f = estadoEdicion.filas.find((x) => x.clave === editando.clave)
  const v = texto.trim()
  if (!f || v === '' || v === editando.valor) return
  if (f.estado === 'nuevo' && f.insertado !== undefined) {
    estadoEdicion.ponerEdicion(editarInsertado(estadoEdicion.edicionRef.current, f.insertado, textoConCambios(f.documento.texto, { [editando.campo]: v }, [])))
  } else {
    estadoEdicion.ponerEdicion(ponerCampo(estadoEdicion.edicionRef.current, f.documento.idEjson, editando.campo, v))
  }
}

/** Marca el documento para borrar (o lo deshace); un documento nuevo se quita. */
export function alternarBorradoFila(estadoEdicion: EstadoEdicion, f: FilaDocs): void {
  if (estadoEdicion.enviando) return
  if (sinIdentidad(f)) return avisarSinIdentidad()
  if (f.estado === 'nuevo' && f.insertado !== undefined) {
    estadoEdicion.ponerEdicion(quitarInsertado(estadoEdicion.edicionRef.current, f.insertado))
    estadoEdicion.setSeleccion(null)
  } else {
    estadoEdicion.ponerEdicion(alternarBorrado(estadoEdicion.edicionRef.current, f.documento.idEjson))
  }
  estadoEdicion.setEdicionJson(null)
}

/** Añade un documento vacío para insertar y abre su editor JSON. */
export function anadirDocumento(estadoEdicion: EstadoEdicion): void {
  if (estadoEdicion.enviando) return
  const e = insertarDocumento(estadoEdicion.edicionRef.current, DOCUMENTO_NUEVO)
  estadoEdicion.ponerEdicion(e)
  const clave = `nuevo:${e.insertados.length - 1}`
  estadoEdicion.setSeleccion(clave)
  estadoEdicion.setPanelJson(true)
  estadoEdicion.setEdicionJson({ clave, texto: DOCUMENTO_NUEVO })
}

/**
 * Aplica el JSON editado en el panel. Con una PROYECCIÓN aplicada (`documentoParcial`) el
 * documento que se ve es parcial y reemplazarlo borraría los campos ocultos: no se ofrece.
 */
export function aplicarJson(estadoEdicion: EstadoEdicion, documentoParcial: boolean): void {
  const je = estadoEdicion.edicionJson
  if (!je) return
  const f = estadoEdicion.filas.find((x) => x.clave === je.clave)
  estadoEdicion.setEdicionJson(null)
  if (!f) return
  const texto = je.texto.trim()
  if (texto === '') return
  if (f.estado === 'nuevo' && f.insertado !== undefined) estadoEdicion.ponerEdicion(editarInsertado(estadoEdicion.edicionRef.current, f.insertado, texto))
  else if (documentoParcial || sinIdentidad(f)) return
  else if (texto !== formatearDocumento(f.documento.texto)) estadoEdicion.ponerEdicion(reemplazarDocumento(estadoEdicion.edicionRef.current, f.documento.idEjson, texto))
}

type Cambio = ReturnType<typeof cambioDeDocumento>

function elementosDeCampo(estadoEdicion: EstadoEdicion, i: number, f: FilaDocs, campo: string, cambio: Cambio): EntradaMenuContextual[] {
  const t = txColeccionDocs()
  const elementos: EntradaMenuContextual[] = []
  const existe = campo in f.documento.celdas
  const noEditable = motivoNoEditarCampo(campo) !== null
  const id = f.documento.idEjson
  if (!estadoEdicion.enviando && f.estado !== 'borrado' && !sinIdentidad(f)) {
    elementos.push({ label: t.editarValor, icon: <IconoEditar />, disabled: noEditable, onClick: () => editarCelda(estadoEdicion, i, campo) })
    if (existe && f.estado !== 'nuevo') {
      elementos.push({ label: t.quitarCampo, disabled: noEditable, onClick: () => estadoEdicion.ponerEdicion(quitarCampo(estadoEdicion.edicionRef.current, id, campo)) })
    }
    if (cambio?.tipo === 'actualizar' && f.cambiados.has(campo)) {
      elementos.push({ label: t.restaurarCampo, icon: <IconoRevertir />, onClick: () => estadoEdicion.ponerEdicion(restaurarCampo(estadoEdicion.edicionRef.current, id, campo)) })
    }
  }
  if (existe) {
    elementos.push({ label: t.copiarValor, icon: <IconoCopiar />, onClick: () => copiarTexto(valorDeCampo(f.documento.texto, campo) ?? f.documento.celdas[campo].vista, t.valor) })
  }
  return elementos
}

function elementosDeDocumento(estadoEdicion: EstadoEdicion, f: FilaDocs, cambio: Cambio): EntradaMenuContextual[] {
  const t = txColeccionDocs()
  const elementos: EntradaMenuContextual[] = [
    { label: t.copiarDocumento, icon: <IconoCopiar />, onClick: () => copiarTexto(formatearDocumento(f.documento.texto), t.documento) }
  ]
  if (estadoEdicion.enviando) return elementos
  elementos.push(SEP, {
    label: f.estado === 'borrado' ? t.deshacerBorrado : t.borrarDocumento,
    icon: <IconoBorrarFilas />,
    danger: f.estado !== 'borrado',
    onClick: () => alternarBorradoFila(estadoEdicion, f)
  })
  if (cambio && cambio.tipo !== 'borrar') {
    elementos.push({ label: t.descartarCambiosDocumento, icon: <IconoRevertir />, onClick: () => estadoEdicion.ponerEdicion(descartarDocumento(estadoEdicion.edicionRef.current, f.documento.idEjson)) })
  }
  return elementos
}

/** Abre el menú contextual de una fila (o de una de sus celdas, si `campo` no es null). */
export function abrirMenu(estadoEdicion: EstadoEdicion, i: number, campo: string | null, x: number, y: number): void {
  const f = estadoEdicion.filas[i]
  if (!f) return
  estadoEdicion.setSeleccion(f.clave)
  const cambio = f.estado === 'nuevo' ? undefined : cambioDeDocumento(estadoEdicion.edicionRef.current, f.documento.idEjson)
  const elementos = [...(campo !== null ? elementosDeCampo(estadoEdicion, i, f, campo, cambio) : []), ...elementosDeDocumento(estadoEdicion, f, cambio)]
  estadoEdicion.setMenu({ x, y, items: elementos })
}

/** Lo que «Enviar» necesita de fuera de la edición. */
export interface ContextoEnvio {
  conexionId: string
  base: string
  coleccion: string
  consultar: (c: ConsultaColeccion) => Promise<void>
  aplicadoRef: React.MutableRefObject<ConsultaColeccion>
  montadoRef: React.MutableRefObject<boolean>
}

type Confirmaciones = { confirmado?: boolean; confirmadoSinTransaccion?: boolean }
type RespuestaEnvio = Awaited<ReturnType<typeof window.tessera.bdDocumentos.enviar>>
type ResultadoEnvio = Extract<RespuestaEnvio, { ok: true }>['valor']

async function llamarEnviar(ctx: ContextoEnvio, cambios: DbDocCambio[], conf: Confirmaciones): Promise<RespuestaEnvio> {
  try {
    return await window.tessera.bdDocumentos.enviar({ conexionId: ctx.conexionId, base: ctx.base, coleccion: ctx.coleccion, cambios, ...conf })
  } catch (err) {
    return { ok: false, error: errorDeInvoke(err) }
  }
}

/** El main devolvió sin aplicar: si pide confirmar se guarda la pregunta; si no, se avisa del error. */
function avisarFalloEnvio(estadoEdicion: EstadoEdicion, error: DbErrorSql, conf: Confirmaciones): void {
  if (error.motivo === 'produccion') {
    estadoEdicion.setConfirmacion({ tipo: 'produccion', confirmadoSinTransaccion: conf.confirmadoSinTransaccion === true })
  } else if (error.motivo === 'sinTransaccion') {
    estadoEdicion.setConfirmacion({ tipo: 'sinTransaccion', confirmado: conf.confirmado === true })
  } else {
    notify('error', txColeccionDocs().noSeEnviaron, textoError(error))
  }
}

/** El resultado se DICE siempre; lo que no entró sigue pendiente y, si algo entró, se recarga. */
function contarResultadoEnvio(estadoEdicion: EstadoEdicion, ctx: ContextoEnvio, enviada: EdicionDocs, n: number, valor: ResultadoEnvio): void {
  const res = resumenEnvio(valor, n)
  if (valor.fallo) {
    estadoEdicion.setFilaError(claveDelCambio(enviada, valor.fallo.indice))
    estadoEdicion.ponerEdicion(valor.transaccion ? enviada : restanTrasEnvio(enviada, valor.aplicados))
    notify('error', res.titulo, res.detalle)
  } else {
    estadoEdicion.ponerEdicion(EDICION_VACIA)
    notify('success', res.titulo)
  }
  if (valor.aplicados > 0) void ctx.consultar(ctx.aplicadoRef.current)
}

/** Envía lo pendiente, con las confirmaciones que ya dio el usuario (`conf`). */
export async function enviar(estadoEdicion: EstadoEdicion, ctx: ContextoEnvio, conf: Confirmaciones): Promise<void> {
  const e = estadoEdicion.edicionRef.current
  const cambios: DbDocCambio[] = cambiosDeEdicion(e)
  if (cambios.length === 0 || estadoEdicion.enviando) return
  estadoEdicion.setEnviando(true)
  estadoEdicion.setFilaError(null)
  estadoEdicion.setEditando(null)
  estadoEdicion.setEdicionJson(null)
  const r = await llamarEnviar(ctx, cambios, conf)
  if (!ctx.montadoRef.current) return
  estadoEdicion.setEnviando(false)
  if (!r.ok) return avisarFalloEnvio(estadoEdicion, r.error, conf)
  contarResultadoEnvio(estadoEdicion, ctx, e, cambios.length, r.valor)
}

/**
 * «Enviar»: abre la vista previa con una orden por cambio, en el orden en que viajan. El `_id` sale de
 * los documentos LEÍDOS (`leidos`, la página), no de las filas: un reemplazo pendiente puede traer otro
 * `_id` en su texto, y lo que se envía filtra por el original.
 */
export function abrirVistaPrevia(estadoEdicion: EstadoEdicion, coleccion: string, leidos: readonly DbDocDocumento[]): void {
  const cambios = cambiosDeEdicion(estadoEdicion.edicionRef.current)
  if (cambios.length === 0 || estadoEdicion.enviando) return
  const textoId = (idEjson: string): string => textoIdDe(leidos, idEjson)
  estadoEdicion.setVistaPrevia({ lineas: cambios.map((c) => lineaDeCambioDocs(coleccion, c, textoId)), resumen: resumenCambiosDocs(cambios) })
}

/** La vista previa aceptada: en producción, el botón ya era «Ejecutar en producción», así que va confirmado. */
export function aceptarVistaPrevia(estadoEdicion: EstadoEdicion, ctx: ContextoEnvio, produccion: boolean): void {
  estadoEdicion.setVistaPrevia(null)
  void enviar(estadoEdicion, ctx, produccion ? { confirmado: true } : {})
}

/** La respuesta al diálogo de confirmación: si acepta, reenvía con la confirmación de ese motivo. */
export function responderConfirmacion(estadoEdicion: EstadoEdicion, ctx: ContextoEnvio, ok: boolean): void {
  const c = estadoEdicion.confirmacion
  estadoEdicion.setConfirmacion(null)
  if (!ok || !c) return
  if (c.tipo === 'produccion') void enviar(estadoEdicion, ctx, { confirmado: true, ...(c.confirmadoSinTransaccion ? { confirmadoSinTransaccion: true } : {}) })
  else void enviar(estadoEdicion, ctx, { confirmadoSinTransaccion: true, ...(c.confirmado ? { confirmado: true } : {}) })
}
