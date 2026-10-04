// =============================================================================
// Las acciones de edición de la pestaña de colección: editar una celda o el documento entero,
// borrar y añadir documentos, el menú contextual y «Enviar». La edición queda PENDIENTE hasta
// «Enviar», que va sin confirmar: la política la decide el main, y si devuelve 'produccion' o
// 'sinTransaccion' se pregunta y se reenvía con `confirmado` o `confirmadoSinTransaccion`.
// Son funciones sobre el estado de `useEstadoEdicion`; `DbColeccionPane` las llama.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import type { DbDocCambio } from '../../../../../shared/db-documentos-ipc'
import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc'
import {
  DOCUMENTO_NUEVO,
  EDICION_VACIA,
  alternarBorrado,
  cambioDeDoc,
  cambiosDeEdicion,
  claveDelCambio,
  descartarDoc,
  editarInsertado,
  formatearDocumento,
  insertarDoc,
  motivoNoEditarCampo,
  ponerCampo,
  quitarCampo,
  quitarInsertado,
  reemplazarDoc,
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
import { errorDeInvoke, textoError } from '../panesBd'
import { copiarTexto } from './utilPanes'
import { notify } from '../../../comun/notifications'
import { SEP, type ContextMenuEntry } from '../../../comun/ContextMenu'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { IconoBorrarFilas, IconoEditar, IconoRevertir } from '../iconosEdicion'

/** Una fila sin `_id` (proyección `{ _id: 0 }`, algunas vistas) no tiene identidad: sus cambios no sabrían a qué documento ir. */
export function sinIdentidad(f: FilaDocs): boolean {
  return f.estado !== 'nuevo' && f.documento.idEjson === ''
}

function avisarSinIdentidad(): void {
  notify('info', 'Documento sin _id', 'Sin su _id no se sabe a qué documento van los cambios: quita la proyección que lo oculta.')
}

/** Empieza a editar una celda con doble clic: pide su valor en notación del shell, o avisa de por qué no. */
export function editarCelda(ed: EstadoEdicion, i: number, campo: string): void {
  if (ed.enviando) return
  const f = ed.filas[i]
  if (!f || f.estado === 'borrado') return
  if (sinIdentidad(f)) return avisarSinIdentidad()
  const motivo = motivoNoEditarCampo(campo)
  if (motivo) {
    notify('info', 'Campo no editable', motivo)
    return
  }
  const existe = campo in f.documento.celdas
  const valor = valorDeCampo(f.documento.texto, campo)
  if (existe && valor === null) {
    notify('info', 'Edita el documento en el panel JSON', 'Este documento no se puede editar por celdas.')
    return
  }
  ed.setEditando({ clave: f.clave, campo, valor: valor ?? '' })
}

/** Cierra el editor de celda: el valor nuevo queda pendiente si cambió. */
export function confirmarCelda(ed: EstadoEdicion, texto: string): void {
  const editando = ed.editando
  ed.setEditando(null)
  if (!editando) return
  const f = ed.filas.find((x) => x.clave === editando.clave)
  const v = texto.trim()
  if (!f || v === '' || v === editando.valor) return
  if (f.estado === 'nuevo' && f.insertado !== undefined) {
    ed.ponerEdicion(editarInsertado(ed.edicionRef.current, f.insertado, textoConCambios(f.documento.texto, { [editando.campo]: v }, [])))
  } else {
    ed.ponerEdicion(ponerCampo(ed.edicionRef.current, f.documento.idEjson, editando.campo, v))
  }
}

/** Marca el documento para borrar (o lo deshace); un documento nuevo se quita. */
export function alternarBorradoFila(ed: EstadoEdicion, f: FilaDocs): void {
  if (ed.enviando) return
  if (sinIdentidad(f)) return avisarSinIdentidad()
  if (f.estado === 'nuevo' && f.insertado !== undefined) {
    ed.ponerEdicion(quitarInsertado(ed.edicionRef.current, f.insertado))
    ed.setSeleccion(null)
  } else {
    ed.ponerEdicion(alternarBorrado(ed.edicionRef.current, f.documento.idEjson))
  }
  ed.setJsonEdit(null)
}

/** Añade un documento vacío para insertar y abre su editor JSON. */
export function anadirDocumento(ed: EstadoEdicion): void {
  if (ed.enviando) return
  const e = insertarDoc(ed.edicionRef.current, DOCUMENTO_NUEVO)
  ed.ponerEdicion(e)
  const clave = `nuevo:${e.insertados.length - 1}`
  ed.setSeleccion(clave)
  ed.setPanelJson(true)
  ed.setJsonEdit({ clave, texto: DOCUMENTO_NUEVO })
}

/**
 * Aplica el JSON editado en el panel. Con una PROYECCIÓN aplicada (`documentoParcial`) el
 * documento que se ve es parcial y reemplazarlo borraría los campos ocultos: no se ofrece.
 */
export function aplicarJson(ed: EstadoEdicion, documentoParcial: boolean): void {
  const je = ed.jsonEdit
  if (!je) return
  const f = ed.filas.find((x) => x.clave === je.clave)
  ed.setJsonEdit(null)
  if (!f) return
  const texto = je.texto.trim()
  if (texto === '') return
  if (f.estado === 'nuevo' && f.insertado !== undefined) ed.ponerEdicion(editarInsertado(ed.edicionRef.current, f.insertado, texto))
  else if (documentoParcial || sinIdentidad(f)) return
  else if (texto !== formatearDocumento(f.documento.texto)) ed.ponerEdicion(reemplazarDoc(ed.edicionRef.current, f.documento.idEjson, texto))
}

type Cambio = ReturnType<typeof cambioDeDoc>

function itemsDeCampo(ed: EstadoEdicion, i: number, f: FilaDocs, campo: string, cambio: Cambio): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = []
  const existe = campo in f.documento.celdas
  const noEditable = motivoNoEditarCampo(campo) !== null
  const id = f.documento.idEjson
  if (!ed.enviando && f.estado !== 'borrado' && !sinIdentidad(f)) {
    items.push({ label: 'Editar valor', icon: <IconoEditar />, disabled: noEditable, onClick: () => editarCelda(ed, i, campo) })
    if (existe && f.estado !== 'nuevo') {
      items.push({ label: 'Quitar campo', disabled: noEditable, onClick: () => ed.ponerEdicion(quitarCampo(ed.edicionRef.current, id, campo)) })
    }
    if (cambio?.tipo === 'actualizar' && f.cambiados.has(campo)) {
      items.push({ label: 'Restaurar campo', icon: <IconoRevertir />, onClick: () => ed.ponerEdicion(restaurarCampo(ed.edicionRef.current, id, campo)) })
    }
  }
  if (existe) {
    items.push({ label: 'Copiar valor', icon: <IconoCopiar />, onClick: () => copiarTexto(valorDeCampo(f.documento.texto, campo) ?? f.documento.celdas[campo].vista, 'Valor') })
  }
  return items
}

function itemsDeDocumento(ed: EstadoEdicion, f: FilaDocs, cambio: Cambio): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [
    { label: 'Copiar documento', icon: <IconoCopiar />, onClick: () => copiarTexto(formatearDocumento(f.documento.texto), 'Documento') }
  ]
  if (ed.enviando) return items
  items.push(SEP, {
    label: f.estado === 'borrado' ? 'Deshacer borrado' : 'Borrar documento',
    icon: <IconoBorrarFilas />,
    danger: f.estado !== 'borrado',
    onClick: () => alternarBorradoFila(ed, f)
  })
  if (cambio && cambio.tipo !== 'borrar') {
    items.push({ label: 'Descartar cambios del documento', icon: <IconoRevertir />, onClick: () => ed.ponerEdicion(descartarDoc(ed.edicionRef.current, f.documento.idEjson)) })
  }
  return items
}

/** Abre el menú contextual de una fila (o de una de sus celdas, si `campo` no es null). */
export function abrirMenu(ed: EstadoEdicion, i: number, campo: string | null, x: number, y: number): void {
  const f = ed.filas[i]
  if (!f) return
  ed.setSeleccion(f.clave)
  const cambio = f.estado === 'nuevo' ? undefined : cambioDeDoc(ed.edicionRef.current, f.documento.idEjson)
  const items = [...(campo !== null ? itemsDeCampo(ed, i, f, campo, cambio) : []), ...itemsDeDocumento(ed, f, cambio)]
  ed.setMenu({ x, y, items })
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
type RespuestaEnvio = Awaited<ReturnType<typeof window.tessera.dbDocumentos.enviar>>
type ResultadoEnvio = Extract<RespuestaEnvio, { ok: true }>['valor']

async function llamarEnviar(ctx: ContextoEnvio, cambios: DbDocCambio[], conf: Confirmaciones): Promise<RespuestaEnvio> {
  try {
    return await window.tessera.dbDocumentos.enviar({ conexionId: ctx.conexionId, base: ctx.base, coleccion: ctx.coleccion, cambios, ...conf })
  } catch (err) {
    return { ok: false, error: errorDeInvoke(err) }
  }
}

/** El main devolvió sin aplicar: si pide confirmar se guarda la pregunta; si no, se avisa del error. */
function avisarFalloEnvio(ed: EstadoEdicion, error: DbErrorSql, conf: Confirmaciones): void {
  if (error.motivo === 'produccion') {
    ed.setConfirmacion({ tipo: 'produccion', confirmadoSinTransaccion: conf.confirmadoSinTransaccion === true })
  } else if (error.motivo === 'sinTransaccion') {
    ed.setConfirmacion({ tipo: 'sinTransaccion', confirmado: conf.confirmado === true })
  } else {
    notify('error', 'No se enviaron los cambios', textoError(error))
  }
}

/** El resultado se DICE siempre; lo que no entró sigue pendiente y, si algo entró, se recarga. */
function contarResultadoEnvio(ed: EstadoEdicion, ctx: ContextoEnvio, enviada: EdicionDocs, n: number, valor: ResultadoEnvio): void {
  const res = resumenEnvio(valor, n)
  if (valor.fallo) {
    ed.setFilaError(claveDelCambio(enviada, valor.fallo.indice))
    ed.ponerEdicion(valor.transaccion ? enviada : restanTrasEnvio(enviada, valor.aplicados))
    notify('error', res.titulo, res.detalle)
  } else {
    ed.ponerEdicion(EDICION_VACIA)
    notify('success', res.titulo)
  }
  if (valor.aplicados > 0) void ctx.consultar(ctx.aplicadoRef.current)
}

/** Envía lo pendiente, con las confirmaciones que ya dio el usuario (`conf`). */
export async function enviar(ed: EstadoEdicion, ctx: ContextoEnvio, conf: Confirmaciones): Promise<void> {
  const e = ed.edicionRef.current
  const cambios: DbDocCambio[] = cambiosDeEdicion(e)
  if (cambios.length === 0 || ed.enviando) return
  ed.setEnviando(true)
  ed.setFilaError(null)
  ed.setEditando(null)
  ed.setJsonEdit(null)
  const r = await llamarEnviar(ctx, cambios, conf)
  if (!ctx.montadoRef.current) return
  ed.setEnviando(false)
  if (!r.ok) return avisarFalloEnvio(ed, r.error, conf)
  contarResultadoEnvio(ed, ctx, e, cambios.length, r.valor)
}

/** La respuesta al diálogo de confirmación: si acepta, reenvía con la confirmación de ese motivo. */
export function responderConfirmacion(ed: EstadoEdicion, ctx: ContextoEnvio, ok: boolean): void {
  const c = ed.confirmacion
  ed.setConfirmacion(null)
  if (!ok || !c) return
  if (c.tipo === 'produccion') void enviar(ed, ctx, { confirmado: true, ...(c.confirmadoSinTransaccion ? { confirmadoSinTransaccion: true } : {}) })
  else void enviar(ed, ctx, { confirmadoSinTransaccion: true, ...(c.confirmado ? { confirmado: true } : {}) })
}
