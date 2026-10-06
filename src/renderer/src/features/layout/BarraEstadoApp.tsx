// =============================================================================
// Barra de estado de la ventana: el conmutador de la columna del agente (en la vista
// de BD, el del agente de datos; a pantalla completa de la terminal, el del agente de
// la terminal), la rama del repo y la codificación y el fin de línea del archivo
// activo, que en BD no se enseñan porque el editor no se ve.
// =============================================================================
import { etiquetaAcorde } from '../../util/atajos'
import { StatusBar } from './StatusBar'
import type { SalidaLayoutCentro } from './layoutCentro'
import type { EditorApp } from '../editor'

interface Props {
  lay: SalidaLayoutCentro
  enConexiones: boolean
  agenteDbVisible: boolean
  alternarAgenteDb: () => void
  /** Muestra el agente de la terminal (preparándolo si hace falta) o lo oculta sin cerrarlo: su sesión sigue viva. */
  alternarAgenteTerminal: () => void
  toggleCcHidden: () => void
  /** Rótulo del conmutador cuando el agente del proyecto activo está diferido, o null. */
  tituloAgenteDiferido: string | null
  activeBranch: string | null
  editor: EditorApp
}

/** Rótulo y acción del conmutador según de quién sea la columna. */
function conmutador(p: Props): { titulo: string | undefined; alternar: () => void } {
  const acorde = etiquetaAcorde('alternarAgente')
  switch (p.lay.barraEstado.accion) {
    case 'agente-db':
      return { titulo: `${p.agenteDbVisible ? 'Ocultar' : 'Mostrar'} el agente de datos (${acorde})`, alternar: p.alternarAgenteDb }
    case 'agente-terminal':
      return {
        titulo: p.lay.barraEstado.ccVisible
          ? `Ocultar el agente de la terminal, que sigue corriendo (${acorde})`
          : `Mostrar el agente de la terminal (${acorde})`,
        alternar: p.alternarAgenteTerminal
      }
    default:
      // Con el agente del proyecto diferido, mostrar la columna además lo inicia: se dice.
      return { titulo: p.tituloAgenteDiferido ?? undefined, alternar: p.toggleCcHidden }
  }
}

/** Barra de estado inferior. */
export function BarraEstadoApp(p: Props): React.JSX.Element {
  const { lay, editor } = p
  const { titulo, alternar } = conmutador(p)
  return (
    <StatusBar
      ccVisible={lay.barraEstado.ccVisible}
      razonBloqueoCc={lay.barraEstado.razonBloqueo}
      onToggleCc={alternar}
      tituloCc={titulo}
      branch={p.activeBranch}
      editorMeta={p.enConexiones ? null : editor.activeEditorMeta}
      onSaveEncoding={(id) => editor.requestConvert({ encodingId: id })}
      onReopenEncoding={(id) => editor.requestReopenEncoding(id)}
      onPickEol={(eol) => editor.requestConvert({ eol })}
    />
  )
}
