// =============================================================================
// El panel del documento elegido en la pestaña de colección: su JSON en notación del shell,
// coloreado, o un `<textarea>` mientras se edita entero. Son funciones de pintado sin estado
// propio: el estado vive en `DbColeccionPane` y sus hooks.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import { useMemo } from 'react'
import { formatearDocumento, formatearTokens, tokenizar, type FilaDocs } from './coleccionDocs'
import type { EstadoEdicion } from './useEdicionColeccion'
import { sinIdentidad } from './edicionColeccion'
import { copiarTexto } from './utilPanes'
import { txColeccionDocs } from './textosColeccionDocs'
import { EstadoVacio } from '../../../comun/EstadoVacio'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { BotonBarraBd } from '../rejilla/DatosBotonBarra'
import { IconoEditar } from '../iconosEdicion'

/** Un documento más grande que esto se enseña sin colorear (miles de nodos por nada). */
const COLOREAR_MAX = 200_000

export interface DatosPanel {
  ed: EstadoEdicion
  /** Con una proyección aplicada el documento que se ve es parcial: no se reemplaza entero. */
  documentoParcial: boolean
  onAplicarJson: () => void
}

/** El documento sangrado y coloreado por token. Uno enorme va sin colorear. */
function JsonColoreado({ texto }: { texto: string }): React.JSX.Element {
  const tokens = useMemo(() => (texto.length > COLOREAR_MAX ? null : formatearTokens(tokenizar(texto))), [texto])
  if (!tokens) return <pre className="db-docs-json">{texto}</pre>
  return (
    <pre className="db-docs-json" tabIndex={0}>
      {tokens.map((t, i) =>
        t.clase === 'espacio' ? (
          t.texto
        ) : (
          <span key={i} className={`tk-${t.clase}`}>
            {t.texto}
          </span>
        )
      )}
    </pre>
  )
}

function tituloPanel(f: FilaDocs | null): string {
  const t = txColeccionDocs()
  if (!f) return t.ningunDocumentoElegido
  return f.estado === 'nuevo' ? t.documentoNuevo : `_id: ${f.documento.celdas._id?.vista ?? '—'}`
}

function puedeEditarEntero(d: DatosPanel, f: FilaDocs): boolean {
  if (d.ed.enviando || f.estado === 'borrado' || d.ed.jsonEdit) return false
  return f.estado === 'nuevo' || (!d.documentoParcial && !sinIdentidad(f))
}

function cabeceraPanel(d: DatosPanel): React.JSX.Element {
  const { filaSel, setJsonEdit } = d.ed
  const t = txColeccionDocs()
  return (
    <div className="db-docs-panel-cab">
      <span className="db-docs-panel-titulo">{tituloPanel(filaSel)}</span>
      {filaSel && filaSel.estado !== 'normal' && (
        <span className="db-docs-panel-estado">
          {filaSel.estado === 'borrado' ? t.seBorrara : filaSel.estado === 'nuevo' ? t.seInsertara : t.sinEnviarEstado}
        </span>
      )}
      {filaSel && puedeEditarEntero(d, filaSel) && (
        <BotonBarraBd
          etiqueta={t.editarDocumento}
          titulo={t.editarDocumentoTitulo}
          onClick={() => setJsonEdit({ clave: filaSel.clave, texto: formatearDocumento(filaSel.documento.texto) })}
        >
          <IconoEditar />
        </BotonBarraBd>
      )}
      {filaSel && (
        <BotonBarraBd etiqueta={t.copiarDocumento} titulo={t.copiarElDocumento} onClick={() => copiarTexto(formatearDocumento(filaSel.documento.texto), t.documento)}>
          <IconoCopiar />
        </BotonBarraBd>
      )}
    </div>
  )
}

function editorJson(d: DatosPanel): React.JSX.Element {
  const { jsonEdit, setJsonEdit } = d.ed
  const t = txColeccionDocs()
  return (
    <>
      <textarea
        className="db-docs-json"
        value={jsonEdit?.texto ?? ''}
        onChange={(e) => {
          const v = e.target.value
          setJsonEdit((prev) => (prev ? { ...prev, texto: v } : prev))
        }}
        onKeyDown={(e) => {
          // Mod+Intro aplica, Esc cancela; el resto de teclas no sube al área (Mod+W).
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setJsonEdit(null)
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            d.onAplicarJson()
          }
        }}
        spellCheck={false}
        autoFocus
        aria-label={t.documentoEnShell}
      />
      <div className="db-docs-panel-acciones">
        <button type="button" className="btn btn-ghost" onClick={() => setJsonEdit(null)}>
          {t.cancelar}
        </button>
        <button type="button" className="btn primary" onClick={d.onAplicarJson}>
          {t.aplicar}
        </button>
      </div>
    </>
  )
}

/** El panel lateral del documento elegido (ver la cabecera del módulo). */
export function panelDocumento(d: DatosPanel): React.JSX.Element {
  const { filaSel, jsonEdit } = d.ed
  const t = txColeccionDocs()
  return (
    <aside className="db-docs-panel" aria-label={t.documentoElegido}>
      {cabeceraPanel(d)}
      {filaSel && jsonEdit && jsonEdit.clave === filaSel.clave ? (
        editorJson(d)
      ) : filaSel ? (
        <JsonColoreado texto={filaSel.documento.texto} />
      ) : (
        <div className="db-docs-panel-vacio">
          <EstadoVacio titulo={t.eligeUnDocumento} pista={t.contenidoAqui} />
        </div>
      )}
    </aside>
  )
}
