// =============================================================================
// Barra de estado de la ventana: el conmutador de la columna del agente (en la vista
// de BD, el del agente de datos; a pantalla completa de la terminal, el del agente de
// la terminal), la rama del repo, el uso de las cuentas del perfil y la codificación y el
// fin de línea del archivo activo, que en BD no se enseñan porque el editor no se ve.
// =============================================================================
import { etiquetaAcorde } from '../../util/atajos'
import { BarraEstadoPuro, tituloDelAgenteTerminal } from './BarraEstadoPuro'
import { textoRazon, type SalidaLayoutCentro } from './layoutCentro'
import { txLayout } from './textos.ts'
import type { EditorApp } from '../editor'

interface Props {
  disposicion: SalidaLayoutCentro
  enConexiones: boolean
  agenteDbVisible: boolean
  alternarAgenteDb: () => void
  /** Muestra el agente de la terminal (preparándolo si hace falta) o lo oculta sin cerrarlo: su sesión sigue viva. */
  alternarAgenteTerminal: () => void
  alternarCcOculto: () => void
  /** Rótulo del conmutador cuando el agente del proyecto activo está diferido, o null. */
  tituloAgenteDiferido: string | null
  ramaActiva: string | null
  editor: EditorApp
  /** El uso de las cuentas del perfil; lo compone App.tsx para que esta feature no dependa de la de agentes. */
  usoCuentas: React.ReactNode
}

/** Rótulo y acción del conmutador según de quién sea la columna. */
function conmutador(p: Props): { titulo: string | undefined; alternar: () => void } {
  const acorde = etiquetaAcorde('alternarAgente')
  const t = txLayout().estado
  switch (p.disposicion.barraEstado.accion) {
    case 'agente-db':
      return {
        titulo: p.agenteDbVisible ? t.ocultarAgenteDatos(acorde) : t.mostrarAgenteDatos(acorde),
        alternar: p.alternarAgenteDb
      }
    case 'agente-terminal':
      return {
        titulo: tituloDelAgenteTerminal(p.disposicion.barraEstado.ccVisible),
        alternar: p.alternarAgenteTerminal
      }
    default:
      // Con el agente del proyecto diferido, mostrar la columna además lo inicia: se dice.
      return { titulo: p.tituloAgenteDiferido ?? undefined, alternar: p.alternarCcOculto }
  }
}

/** Barra de estado inferior. */
export function BarraEstadoApp(p: Props): React.JSX.Element {
  const { disposicion, editor } = p
  const { titulo, alternar } = conmutador(p)
  return (
    <BarraEstadoPuro
      ccVisible={disposicion.barraEstado.ccVisible}
      razonBloqueoCc={textoRazon(disposicion.barraEstado.razonBloqueo)}
      onAlternarCc={alternar}
      tituloCc={titulo}
      rama={p.ramaActiva}
      editorMeta={p.enConexiones ? null : editor.metaEditorActivo}
      onGuardarEncoding={(id) => editor.pedirConvertir({ encodingId: id })}
      onReabrirEncoding={(id) => editor.pedirReabrirEncoding(id)}
      onElegirEol={(eol) => editor.pedirConvertir({ eol })}
      usoCuentas={p.usoCuentas}
    />
  )
}
