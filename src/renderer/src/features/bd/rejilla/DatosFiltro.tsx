// =============================================================================
// El filtro de la pestaña de datos: GUIADO por defecto (columna · operador · valor) o el
// WHERE libre del modo «SQL». Cambiar de barra no consulta; Intro, «Aplicar» o
// Refrescar aplican lo del modo visible. Un error de un campo sale bajo ese campo; el
// del orden de la cabecera, bajo la barra en los dos modos.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import { BarraFiltroGuiado } from '../filtro/BarraFiltroGuiado'
import type { ErrorBarraFiltro } from '../filtro/modeloFiltro'
import { textoError } from '../panesBd'
import { aplicarEscrito, cambiarModo, quitarOrden, restaurarGuiado, teclaWhere } from './datosAcciones'
import type { VistaDatos } from './datosTipos'
import { txRejilla } from './textosRejilla.ts'

/** El error del ORDEN (una columna que el servidor no sabe ordenar), o null. */
function errorOrden(v: VistaDatos): string | null {
  const { errorCampo } = v.e
  return errorCampo?.campo === 'orderBy' ? txRejilla().noSePudoOrdenar(textoError(errorCampo)) : null
}

/** El error que pinta la barra guiada: el suyo o el del servidor en su fila (el del orden va aparte). */
function errorGuiada(v: VistaDatos): ErrorBarraFiltro | null {
  const { errorGuiado, errorCampo } = v.e
  if (errorGuiado) return errorGuiado
  if (errorCampo?.campo === 'filtro') return { condicion: errorCampo.condicion ?? null, mensaje: textoError(errorCampo) }
  return null
}

/** El error del orden con su salida, «Quitar el orden», en las dos barras. */
function avisoOrden(v: VistaDatos): React.JSX.Element | null {
  const orden = errorOrden(v)
  if (orden === null) return null
  return (
    <div className="db-filtro-error campo-orderBy" role="alert">
      <span>{orden}</span>
      <button type="button" className="btn" onClick={() => quitarOrden(v)}>
        {txRejilla().quitarOrden}
      </button>
    </div>
  )
}

function filtroGuiado(v: VistaDatos): React.JSX.Element {
  const { n } = v
  return (
    <div ref={n.guiadoRef} className="db-filtro-guiado">
      <BarraFiltroGuiado
        columnas={v.d.columnasFiltro}
        filtro={v.e.guiadoTxt}
        onCambiar={(f) => {
          // El error apunta a su fila por ÍNDICE: al añadir o quitar filas pasaría a otra.
          n.setGuiadoTxt(f)
          n.setErrorGuiado(null)
          if (v.e.errorCampo?.campo === 'filtro') n.setErrorCampo(null)
        }}
        onAplicar={() => aplicarEscrito(v)}
        onRestaurar={() => restaurarGuiado(v)}
        error={errorGuiada(v)}
        avanzado={{
          etiqueta: 'SQL',
          titulo: txRejilla().escribirWhere,
          onClick: () => cambiarModo(n, 'sql')
        }}
      />
      {avisoOrden(v)}
    </div>
  )
}

function filtroSql(v: VistaDatos): React.JSX.Element {
  const { n } = v
  const { errorCampo } = v.e
  return (
    <div className="db-filtro filtro-sql">
      <label className="db-filtro-campo">
        <span className="db-filtro-etiqueta">WHERE</span>
        <input
          ref={n.whereRef}
          className="db-filtro-input"
          value={v.e.whereTxt}
          onChange={(e) => n.setWhereTxt(e.target.value)}
          onKeyDown={(e) => teclaWhere(v, e)}
          placeholder={txRejilla().filtrarFilas}
          aria-invalid={errorCampo?.campo === 'where'}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </label>
      <button
        type="button"
        className="btn filtro-modo"
        title={txRejilla().volverGuiado}
        onClick={() => cambiarModo(n, 'guiado')}
      >
        {txRejilla().guiado}
      </button>
      {errorCampo?.campo === 'where' && (
        <div className="db-filtro-error campo-where" role="alert">
          {textoError(errorCampo)}
        </div>
      )}
      {avisoOrden(v)}
    </div>
  )
}

/** La barra de filtro del modo que se ve. */
export function filtroDatos(v: VistaDatos): React.JSX.Element {
  return v.e.modo === 'guiado' ? filtroGuiado(v) : filtroSql(v)
}
