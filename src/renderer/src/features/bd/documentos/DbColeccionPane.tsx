// =============================================================================
// DbColeccionPane: la pestaña de colección de MongoDB: la tabla de documentos, la barra de
// filtro (guiada o en notación del shell) y la edición por `_id` con «Enviar». Cumple el
// contrato de `DbArea`: no pide nada hasta su primer `visible`, publica sus indicadores, se
// registra en `registroEdicion` para que cerrar pregunte por lo no enviado y al desmontarse
// cancela lo que tenga en vuelo. El estado y el pintado viven en los módulos que importa.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import { useMemo, useRef } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { IndicadorPestana } from '../dbTabsModel'
import { columnasFiltrables, consultaProyecta } from './coleccionDocs'
import { useCargarMas, useCicloConsulta, useConsultar, useEstadoConsulta, cancelarPeticiones } from './useConsultaColeccion'
import { useDescarteColeccion, useEstadoEdicion, useIndicadoresColeccion } from './useEdicionColeccion'
import * as barra from './barraColeccion'
import * as edicion from './edicionColeccion'
import { barraFiltro, cabeceraColeccion, zonaTabla, type AccionesVista } from './vistaColeccion'
import { panelDocumento } from './PanelDocumento'
import { dialogosColeccion } from './DialogosColeccion'
import './documentos.css'

export interface PropsColeccion {
  paneKey: string
  conexion: DbConnection
  base: string
  coleccion: string
  visible: boolean
  altoFila: number
  /** Documentos por página (Configuración › «Bases de datos»). */
  filasPorPagina: number
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
  /** Abre una consola de esta conexión con un texto inicial. */
  onAbrirConsola?: (conexionId: string, textoInicial?: string) => void
}

/** La pestaña de una colección de MongoDB (ver la cabecera del módulo). */
export function DbColeccionPane(p: PropsColeccion): React.JSX.Element {
  // `filasPorPagina` se lee por `propsRef` al pedir: cambiarlo vale para la siguiente página.
  const { conexion, base, coleccion, visible, altoFila } = p
  const propsRef = useRef(p)
  propsRef.current = p

  const e = useEstadoConsulta()
  const { consultar } = useConsultar(e, conexion.id, base, coleccion, propsRef)
  const cargarMas = useCargarMas(e, propsRef)
  useCicloConsulta(e, visible, consultar, { conexionId: conexion.id, base, coleccion }, propsRef)
  const ed = useEstadoEdicion(e.pagina)
  const descarte = useDescarteColeccion(ed, p.paneKey, conexion.id)
  useIndicadoresColeccion(e, ed, propsRef)
  const columnasGuiadas = useMemo(
    () => columnasFiltrables(e.muestra, e.pagina?.columnas ?? [], e.pagina?.documentos ?? []),
    [e.muestra, e.pagina]
  )

  const ctx: edicion.ContextoEnvio = { conexionId: conexion.id, base, coleccion, consultar, aplicadoRef: e.aplicadoRef, montadoRef: e.montadoRef }
  const documentoParcial = consultaProyecta(e.aplicado)
  const acc: AccionesVista = {
    aplicar: () => barra.aplicarEscrito(e, consultar),
    detener: () => cancelarPeticiones(conexion.id, [e.peticionRef.current, e.masRef.current]),
    anadir: () => edicion.anadirDocumento(ed),
    borrarSeleccionado: () => {
      if (ed.filaSel) edicion.alternarBorradoFila(ed, ed.filaSel)
    },
    revertir: () => void descarte.pedirDescarte(),
    enviar: () => void edicion.enviar(ed, ctx, {}),
    alternarPanel: () => ed.setPanelJson((v) => !v),
    abrirConsola: p.onAbrirConsola && (() => p.onAbrirConsola?.(conexion.id, barra.textoDeConsola(conexion.database, base, coleccion, e.aplicado))),
    cambiarModo: (m) => barra.cambiarModo(e, consultar, m),
    teclaCampo: (ev) => barra.teclaCampo(e, consultar, ev),
    restaurarGuiado: () => barra.restaurarGuiado(e),
    ordenar: (columna, multiple) => barra.ordenarPor(e, consultar, columna, multiple),
    editarCelda: ed.enviando ? undefined : (i, campo) => edicion.editarCelda(ed, i, campo),
    confirmarCelda: (texto) => edicion.confirmarCelda(ed, texto),
    menu: (i, campo, x, y) => edicion.abrirMenu(ed, i, campo, x, y),
    cargarMas: () => void cargarMas()
  }
  const datos = { conexion, base, coleccion, e, ed, acc }

  return (
    <section className={`db-coleccion${visible ? '' : ' hidden'}`} aria-label={`Colección ${base}.${coleccion}`}>
      {cabeceraColeccion(datos)}
      {barraFiltro(e, columnasGuiadas, acc)}
      <div className="db-docs-cuerpo-pestana">
        <div className="db-docs-zona-tabla">{zonaTabla(datos, altoFila)}</div>
        {ed.panelJson && panelDocumento({ ed, documentoParcial, onAplicarJson: () => edicion.aplicarJson(ed, documentoParcial) })}
      </div>
      {dialogosColeccion({
        conexion,
        base,
        coleccion,
        ed,
        descarte: descarte.descarte,
        onResponderDescarte: descarte.responderDescarte,
        onResponderConfirmacion: (ok) => edicion.responderConfirmacion(ed, ctx, ok)
      })}
    </section>
  )
}
