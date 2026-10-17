// =============================================================================
// El pintado de la pestaña de colección, en funciones sin estado propio: la cabecera con sus
// botones, la barra de filtro (guiada o de texto) y la zona de la tabla con sus avisos. El
// estado vive en `DbColeccionPane` y sus hooks; estas funciones solo devuelven el mismo árbol
// de elementos que tendría todo en un único componente.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { camposDeConsulta, textoCambiosDocs, consultaFiltra, esCampoBarra, motivoNoGuiarCampo, type CampoBarra, type ModoFiltroDocs } from './coleccionDocs'
import { BotonExportarDocs } from './BotonExportarDocs'
import type { ColumnaFiltrable } from '../filtro/modeloFiltro'
import { BarraFiltroGuiado } from '../filtro/BarraFiltroGuiado'
import { describirError, textoError } from '../panesBd'
import { AvisoCaja } from '../../../comun/AvisoCaja'
import { EstadoVacio } from '../../../comun/EstadoVacio'
import { BotonBarraBd } from '../rejilla/DatosBotonBarra'
import { MarcaEntorno } from '../MarcaEntorno'
import { IconoColeccion, IconoConsola, IconoDetener, IconoRefrescar, IconoVerValor } from '../iconosBd'
import { IconoAnadirFila, IconoBorrarFilas, IconoEnviar, IconoRevertir } from '../iconosEdicion'
import { TablaDocumentos } from './TablaDocumentos'
import type { EstadoConsulta } from './useConsultaColeccion'
import type { EstadoEdicion } from './useEdicionColeccion'
import { txColeccionDocs } from './textosColeccionDocs'

function etiquetaCampo(c: CampoBarra): string {
  const t = txColeccionDocs()
  return { filtro: t.campoFiltro, proyeccion: t.campoProyeccion, orden: t.campoOrden }[c]
}

function pistaCampo(c: CampoBarra): string {
  const t = txColeccionDocs()
  return { filtro: t.pistaFiltro, proyeccion: t.pistaProyeccion, orden: t.pistaOrden }[c]
}

/** Lo que la vista dispara: las acciones ya atadas al estado de este pintado. */
export interface AccionesVista {
  aplicar: () => void
  detener: () => void
  anadir: () => void
  borrarSeleccionado: () => void
  revertir: () => void
  enviar: () => void
  alternarPanel: () => void
  /** Ausente si la pestaña no puede abrir consolas. */
  abrirConsola: (() => void) | undefined
  cambiarModo: (m: ModoFiltroDocs) => void
  teclaCampo: (ev: React.KeyboardEvent<HTMLInputElement>) => void
  restaurarGuiado: () => void
  ordenar: (columna: string, multiple: boolean) => void
  editarCelda: ((i: number, campo: string) => void) | undefined
  confirmarCelda: (texto: string) => void
  menu: (i: number, campo: string | null, x: number, y: number) => void
  cargarMas: () => void
}

interface DatosVista {
  conexion: DbConnection
  base: string
  coleccion: string
  e: EstadoConsulta
  ed: EstadoEdicion
  acc: AccionesVista
}

function textoMeta(e: EstadoConsulta): string {
  const t = txColeccionDocs()
  if (e.cargando) return t.cargando
  if (!e.pagina) return ''
  return t.meta(e.pagina.documentos.length, e.hayMas, e.pagina.ms)
}

function botonesGenerales(e: EstadoConsulta, acc: AccionesVista): React.JSX.Element {
  const t = txColeccionDocs()
  return (
    <>
      <BotonBarraBd etiqueta={t.refrescar} titulo={t.refrescarTitulo} onClick={acc.aplicar}>
        <IconoRefrescar />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.detener}
        titulo={t.detenerConsulta}
        motivo={e.cargando || e.cargandoMas ? null : t.sinConsulta}
        onClick={acc.detener}
      >
        <IconoDetener />
      </BotonBarraBd>
    </>
  )
}

function botonesEdicion(e: EstadoConsulta, ed: EstadoEdicion, acc: AccionesVista): React.JSX.Element {
  const { enviando, pendientes, filaSel } = ed
  const t = txColeccionDocs()
  return (
    <>
      <BotonBarraBd
        etiqueta={t.anadirDocumento}
        titulo={t.anadirDocumentoTitulo}
        motivo={enviando ? t.enviando : !e.pagina ? t.cargando : null}
        onClick={acc.anadir}
      >
        <IconoAnadirFila />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.borrarDocumento}
        titulo={filaSel?.estado === 'borrado' ? t.deshacerBorradoTitulo : t.borrarSeleccionado}
        motivo={enviando ? t.enviando : filaSel ? null : t.seleccionaParaBorrar}
        onClick={acc.borrarSeleccionado}
      >
        <IconoBorrarFilas />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.revertirCambios}
        titulo={t.descartarSinEnviar(textoCambiosDocs(pendientes))}
        motivo={pendientes === 0 ? t.nadaQueRevertir : enviando ? t.enviando : null}
        onClick={acc.revertir}
      >
        <IconoRevertir />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.enviarCambios}
        titulo={t.enviar(textoCambiosDocs(pendientes))}
        motivo={pendientes === 0 ? t.nadaQueEnviar : enviando ? t.enviando : null}
        onClick={acc.enviar}
      >
        <span className="db-envio-icono">
          <IconoEnviar />
          {pendientes > 0 && (
            <span className="db-envio-cuenta" aria-hidden="true">
              {pendientes > 99 ? '99+' : pendientes}
            </span>
          )}
        </span>
      </BotonBarraBd>
    </>
  )
}

/** La cabecera: entorno, meta (con lo pendiente) y los botones. */
export function cabeceraColeccion(d: DatosVista): React.JSX.Element {
  const { conexion, base, coleccion, e, ed, acc } = d
  const t = txColeccionDocs()
  return (
    <header className="panel-header db-barra">
      <MarcaEntorno entorno={conexion.entorno} />
      <span className="db-barra-meta" title={`${base}.${coleccion}`}>
        {textoMeta(e)}
        {!e.cargando && e.detenida && <span className="db-barra-aviso">{t.detenida}</span>}
        {ed.pendientes > 0 && <span className="db-barra-pendientes">{t.sinEnviar(textoCambiosDocs(ed.pendientes))}</span>}
      </span>
      <div className="panel-actions">
        {botonesGenerales(e, acc)}
        <span className="panel-actions-sep" aria-hidden="true" />
        {botonesEdicion(e, ed, acc)}
        <span className="panel-actions-sep" aria-hidden="true" />
        <BotonExportarDocs
          origen={{ tipo: 'coleccion', conexionId: conexion.id, base, coleccion, ...camposDeConsulta(e.aplicado) }}
          motor={conexion.motor}
          nombreSugerido={`${base}.${coleccion}`}
          motivo={e.pagina ? null : t.cargando}
          titulo={t.exportarColeccion}
        />
        <BotonBarraBd
          etiqueta={ed.panelJson ? t.ocultarDocumento : t.verDocumento}
          titulo={ed.panelJson ? t.ocultarPanelJson : t.verDocumentoJson}
          onClick={acc.alternarPanel}
        >
          <IconoVerValor />
        </BotonBarraBd>
        {acc.abrirConsola && (
          <BotonBarraBd etiqueta={t.abrirConsola} titulo={t.abrirConsolaTitulo} onClick={acc.abrirConsola}>
            <IconoConsola />
          </BotonBarraBd>
        )}
      </div>
    </header>
  )
}

function barraJson(e: EstadoConsulta, acc: AccionesVista): React.JSX.Element {
  const { escrito, errorCampo } = e
  const t = txColeccionDocs()
  return (
    <div className="db-filtro db-docs-filtro">
      {(['filtro', 'proyeccion', 'orden'] as const).map((c) => (
        <label key={c} className="db-filtro-campo">
          <span className="db-filtro-etiqueta">{etiquetaCampo(c)}</span>
          <input
            ref={e.inputs[c]}
            className="db-filtro-input"
            value={escrito[c]}
            onChange={(ev) => {
              const v = ev.target.value
              e.setEscrito((prev) => ({ ...prev, [c]: v }))
            }}
            onKeyDown={acc.teclaCampo}
            placeholder={pistaCampo(c)}
            aria-invalid={errorCampo?.campo === c}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </label>
      ))}
      <button
        type="button"
        className="btn btn-ghost db-docs-filtro-modo"
        title={t.volverGuiado}
        onClick={() => acc.cambiarModo('guiado')}
      >
        {t.guiado}
      </button>
      {errorCampo && esCampoBarra(errorCampo.campo) && (
        <div className={`db-filtro-error campo-${errorCampo.campo}`} role="alert">
          {textoError(errorCampo)}
        </div>
      )}
    </div>
  )
}

/** La barra de filtro que se ve: la guiada, o la de texto (filtro, proyección y orden). */
export function barraFiltro(e: EstadoConsulta, columnasGuiadas: readonly ColumnaFiltrable[], acc: AccionesVista): React.JSX.Element {
  if (e.modo !== 'guiado') return barraJson(e, acc)
  return (
    <BarraFiltroGuiado
      columnas={columnasGuiadas}
      filtro={e.guiadoEscrito}
      onCambiar={(f) => {
        e.setGuiadoEscrito(f)
        // El error señala una fila por su ÍNDICE: al editar deja de valer (quitar una
        // fila lo movería a otra).
        e.setErrorGuiado(null)
      }}
      onAplicar={acc.aplicar}
      onRestaurar={acc.restaurarGuiado}
      error={e.errorGuiado}
      avanzado={{
        etiqueta: 'JSON',
        titulo: txColeccionDocs().escribirJson,
        onClick: () => acc.cambiarModo('json')
      }}
    />
  )
}

function tablaColeccion(d: DatosVista, altoFila: number): React.JSX.Element {
  const { base, coleccion, e, ed, acc } = d
  const { filas, editando, indiceSel } = ed
  const t = txColeccionDocs()
  const indiceError = ed.filaError === null ? null : filas.findIndex((f) => f.clave === ed.filaError)
  const filaEditada = editando ? filas.findIndex((f) => f.clave === editando.clave) : -1
  return (
    <TablaDocumentos
      columnas={ed.columnas}
      documentos={ed.documentosTabla}
      altoFila={altoFila}
      seleccionado={indiceSel >= 0 ? indiceSel : null}
      onSeleccionar={(i) => {
        const f = filas[i]
        if (!f) return
        ed.setSeleccion(f.clave)
        if (ed.jsonEdit && ed.jsonEdit.clave !== f.clave) ed.setJsonEdit(null)
      }}
      estados={ed.estadosTabla}
      filaConError={indiceError !== null && indiceError >= 0 ? indiceError : null}
      editando={editando && filaEditada >= 0 ? { fila: filaEditada, campo: editando.campo, valor: editando.valor } : null}
      onEditarCelda={acc.editarCelda}
      onConfirmarEdicion={acc.confirmarCelda}
      onCancelarEdicion={() => ed.setEditando(null)}
      onMenu={acc.menu}
      onFinAlcanzado={e.hayMas ? acc.cargarMas : undefined}
      pie={e.hayMas ? <span className="db-docs-pie-texto">{e.cargandoMas ? t.cargandoMas : t.desplazaParaMas}</span> : null}
      etiquetaAria={t.documentosDe(`${base}.${coleccion}`)}
      orden={e.aplicado.orden}
      onOrdenar={acc.ordenar}
      motivoNoOrdenar={motivoNoGuiarCampo}
    />
  )
}

/** La zona de la tabla: el error de lectura, la consulta detenida, el vacío o la tabla. */
export function zonaTabla(d: DatosVista, altoFila: number): React.JSX.Element {
  const { e, ed } = d
  const descripcion = e.error ? describirError(e.error, 'leer la colección') : null
  if (descripcion) {
    return <AvisoCaja tono={descripcion.tono} titulo={descripcion.titulo} sugerencia={descripcion.sugerencia} detalle={descripcion.detalle} />
  }
  const t = txColeccionDocs()
  if (!e.pagina && e.detenida) return <AvisoCaja tono="info" titulo={t.consultaDetenida} sugerencia={t.consultaDetenidaPista} />
  if (e.pagina && ed.filas.length === 0 && !e.cargando) {
    return (
      <EstadoVacio
        icono={<IconoColeccion />}
        titulo={t.ningunDocumento}
        pista={consultaFiltra(e.aplicado) ? t.ningunoCumple : t.coleccionVacia}
      />
    )
  }
  return tablaColeccion(d, altoFila)
}
