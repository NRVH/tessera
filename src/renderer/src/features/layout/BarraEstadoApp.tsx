// =============================================================================
// Barra de estado de la ventana: el conmutador de la columna del agente (en la vista
// de BD, el del agente de datos), la rama del repo y la codificación y el fin de
// línea del archivo activo, que en BD no se enseñan porque el editor no se ve.
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
  toggleCcHidden: () => void
  /** Rótulo del conmutador cuando el agente del proyecto activo está diferido, o null. */
  tituloAgenteDiferido: string | null
  activeBranch: string | null
  editor: EditorApp
}

/** Barra de estado inferior. */
export function BarraEstadoApp(p: Props): React.JSX.Element {
  const { lay, editor } = p
  const esAgenteDb = lay.barraEstado.accion === 'agente-db'
  // Con el agente del proyecto diferido, mostrar la columna además lo inicia: se dice.
  const tituloCc = esAgenteDb
    ? `${p.agenteDbVisible ? 'Ocultar' : 'Mostrar'} el agente de datos (${etiquetaAcorde('alternarAgente')})`
    : (p.tituloAgenteDiferido ?? undefined)
  return (
    <StatusBar
      ccVisible={lay.barraEstado.ccVisible}
      razonBloqueoCc={lay.barraEstado.razonBloqueo}
      onToggleCc={esAgenteDb ? p.alternarAgenteDb : p.toggleCcHidden}
      tituloCc={tituloCc}
      branch={p.activeBranch}
      editorMeta={p.enConexiones ? null : editor.activeEditorMeta}
      onSaveEncoding={(id) => editor.requestConvert({ encodingId: id })}
      onReopenEncoding={(id) => editor.requestReopenEncoding(id)}
      onPickEol={(eol) => editor.requestConvert({ eol })}
    />
  )
}
