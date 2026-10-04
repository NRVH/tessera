// =============================================================================
// El pintado de la pestaña de colección, en funciones sin estado propio: la cabecera con sus
// botones, la barra de filtro (guiada o de texto) y la zona de la tabla con sus avisos. El
// estado vive en `DbColeccionPane` y sus hooks; estas funciones solo devuelven el mismo árbol
// de elementos que tendría todo en un único componente.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { textoCambiosDocs, consultaFiltra, esCampoBarra, motivoNoGuiarCampo, type CampoBarra, type ModoFiltroDocs } from './coleccionDocs'
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

const ETIQUETA_CAMPO: Record<CampoBarra, string> = { filtro: 'Filtro', proyeccion: 'Proyección', orden: 'Orden' }
const PISTA_CAMPO: Record<CampoBarra, string> = {
  filtro: '{ campo: valor }  (Intro aplica)',
  proyeccion: '{ campo: 1 }',
  orden: '{ campo: -1 }'
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
  if (e.cargando) return 'Cargando…'
  if (!e.pagina) return ''
  const n = e.pagina.documentos.length
  return `${n.toLocaleString('es-ES')}${e.hayMas ? '+' : ''} documento${n === 1 ? '' : 's'} · ${e.pagina.ms} ms`
}

function botonesGenerales(e: EstadoConsulta, acc: AccionesVista): React.JSX.Element {
  return (
    <>
      <BotonBarraBd etiqueta="Refrescar" titulo="Refrescar (con el filtro escrito; lo pendiente se conserva)" onClick={acc.aplicar}>
        <IconoRefrescar />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Detener"
        titulo="Detener la consulta en curso"
        motivo={e.cargando || e.cargandoMas ? null : 'No hay ninguna consulta en curso'}
        onClick={acc.detener}
      >
        <IconoDetener />
      </BotonBarraBd>
    </>
  )
}

function botonesEdicion(e: EstadoConsulta, ed: EstadoEdicion, acc: AccionesVista): React.JSX.Element {
  const { enviando, pendientes, filaSel } = ed
  return (
    <>
      <BotonBarraBd
        etiqueta="Añadir documento"
        titulo="Añadir un documento (se inserta al Enviar)"
        motivo={enviando ? 'Enviando…' : !e.pagina ? 'Cargando…' : null}
        onClick={acc.anadir}
      >
        <IconoAnadirFila />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Borrar documento"
        titulo={filaSel?.estado === 'borrado' ? 'Deshacer el borrado del documento' : 'Borrar el documento seleccionado'}
        motivo={enviando ? 'Enviando…' : filaSel ? null : 'Selecciona el documento que quieres borrar'}
        onClick={acc.borrarSeleccionado}
      >
        <IconoBorrarFilas />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Revertir cambios"
        titulo={`Descartar ${textoCambiosDocs(pendientes)} sin enviar`}
        motivo={pendientes === 0 ? 'No hay cambios que revertir' : enviando ? 'Enviando…' : null}
        onClick={acc.revertir}
      >
        <IconoRevertir />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Enviar cambios"
        titulo={`Enviar ${textoCambiosDocs(pendientes)}`}
        motivo={pendientes === 0 ? 'No hay cambios que enviar' : enviando ? 'Enviando…' : null}
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
  return (
    <header className="panel-header db-barra">
      <MarcaEntorno entorno={conexion.entorno} />
      <span className="db-barra-meta" title={`${base}.${coleccion}`}>
        {textoMeta(e)}
        {!e.cargando && e.detenida && <span className="db-barra-aviso"> · detenida</span>}
        {ed.pendientes > 0 && <span className="db-barra-pendientes"> · {textoCambiosDocs(ed.pendientes)} sin enviar</span>}
      </span>
      <div className="panel-actions">
        {botonesGenerales(e, acc)}
        <span className="panel-actions-sep" aria-hidden="true" />
        {botonesEdicion(e, ed, acc)}
        <span className="panel-actions-sep" aria-hidden="true" />
        <BotonBarraBd
          etiqueta={ed.panelJson ? 'Ocultar el documento' : 'Ver el documento'}
          titulo={ed.panelJson ? 'Ocultar el panel JSON del documento' : 'Ver el documento elegido en JSON'}
          onClick={acc.alternarPanel}
        >
          <IconoVerValor />
        </BotonBarraBd>
        {acc.abrirConsola && (
          <BotonBarraBd etiqueta="Abrir consola" titulo="Abrir una consola con el find de esta colección" onClick={acc.abrirConsola}>
            <IconoConsola />
          </BotonBarraBd>
        )}
      </div>
    </header>
  )
}

function barraJson(e: EstadoConsulta, acc: AccionesVista): React.JSX.Element {
  const { escrito, errorCampo } = e
  return (
    <div className="db-filtro db-docs-filtro">
      {(['filtro', 'proyeccion', 'orden'] as const).map((c) => (
        <label key={c} className="db-filtro-campo">
          <span className="db-filtro-etiqueta">{ETIQUETA_CAMPO[c]}</span>
          <input
            ref={e.inputs[c]}
            className="db-filtro-input"
            value={escrito[c]}
            onChange={(ev) => {
              const v = ev.target.value
              e.setEscrito((prev) => ({ ...prev, [c]: v }))
            }}
            onKeyDown={acc.teclaCampo}
            placeholder={PISTA_CAMPO[c]}
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
        title="Volver al filtro guiado (campo · operador · valor)"
        onClick={() => acc.cambiarModo('guiado')}
      >
        Guiado
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
        titulo: 'Escribir el filtro, la proyección y el orden en JSON (notación del shell)',
        onClick: () => acc.cambiarModo('json')
      }}
    />
  )
}

function tablaColeccion(d: DatosVista, altoFila: number): React.JSX.Element {
  const { base, coleccion, e, ed, acc } = d
  const { filas, editando, indiceSel } = ed
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
      pie={e.hayMas ? <span className="db-docs-pie-texto">{e.cargandoMas ? 'Cargando más…' : 'Desplázate para cargar más'}</span> : null}
      etiquetaAria={`Documentos de ${base}.${coleccion}`}
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
  if (!e.pagina && e.detenida) return <AvisoCaja tono="info" titulo="Consulta detenida" sugerencia="Pulsa Refrescar para volver a pedirla." />
  if (e.pagina && ed.filas.length === 0 && !e.cargando) {
    return (
      <EstadoVacio
        icono={<IconoColeccion />}
        titulo="Ningún documento"
        pista={consultaFiltra(e.aplicado) ? 'Ningún documento cumple el filtro.' : 'La colección está vacía.'}
      />
    )
  }
  return tablaColeccion(d, altoFila)
}
