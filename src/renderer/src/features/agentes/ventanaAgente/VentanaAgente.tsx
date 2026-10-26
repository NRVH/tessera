// =============================================================================
// La ventana de agente: una barra de título mínima y un pane vivo por agente que se ha abierto en
// ella (como la columna del agente, con `key` = clave del target), siempre nativo y en la carpeta
// del usuario, sin perfil, proyecto ni bases. El pane es el mismo de la columna: selector de
// agente, historial, chat nuevo, anillo de contexto, pegado de imágenes y copiar al seleccionar.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import { useEffect } from 'react'
import { ErrorBoundary } from '../../../comun/ErrorBoundary'
import { CapaFlotante } from '../../../comun/capaFlotante'
import { TooltipPropio } from '../../../comun/TooltipPropio'
import { AgentAppearanceContext } from '../../../theme/terminalAppearance'
import { PERFIL_VENTANA_AGENTE } from '../../../../../shared/ventana-agente-ipc'
import type { IdAgente } from '../../../../../shared/agentesManuales'
import { agentTargetKey, type OpenAgentTarget } from '../../pestanas'
import { AgentTerminalPane } from '../AgentTerminalPane'
import { nombreAgente } from '../agentPaneTipos'
import { txVentanaAgente } from './textosVentana.ts'
import { useVentanaAgente, type ModeloVentanaAgente } from './useVentanaAgente'

/** Valores con la MISMA identidad en cada render: el pane va memoizado. */
const SIN_BASES = Object.freeze([]) as unknown as string[]
function sinCuenta(): void {}
function sinMaximizar(): void {}

function targetDe(carpeta: string, agente: IdAgente): OpenAgentTarget {
  return { profileId: PERFIL_VENTANA_AGENTE, projectHostPath: carpeta, agente, key: agentTargetKey(PERFIL_VENTANA_AGENTE, carpeta, agente) }
}

/** La barra de título: arrastra la ventana y deja el hueco de los botones del sistema. */
function BarraVentanaAgente({ titulo }: { titulo: string }): React.JSX.Element {
  return (
    <header className="ventana-agente-barra">
      <span className="ventana-agente-titulo">{titulo}</span>
    </header>
  )
}

/** El título: el del agente que se ve, también en la barra de tareas. */
function useTitulo(m: ModeloVentanaAgente): string {
  const t = txVentanaAgente()
  const titulo = m.panes.activo ? t.titulo(nombreAgente(m.pestanas, m.panes.activo)) : t.tituloSinAgente
  useEffect(() => {
    document.title = titulo
  }, [titulo])
  return titulo
}

function Panes({ m }: { m: ModeloVentanaAgente }): React.JSX.Element | null {
  const carpeta = m.datos?.carpeta
  if (!carpeta) return null
  return (
    <>
      {m.panes.abiertos.map((agente) => {
        const target = targetDe(carpeta, agente)
        const visible = agente === m.panes.activo && !m.esperandoReanudar(agente)
        return (
          <ErrorBoundary key={target.key} label={nombreAgente(m.pestanas, agente)} variant="pane">
            <AgentTerminalPane
              target={target}
              hostMode
              visible={visible}
              profileName={null}
              accentColor={null}
              pestanasAgente={m.pestanas}
              onSelectAgent={m.elegir}
              dbMounted={SIN_BASES}
              lugar="ventana"
              selectedAccountId={null}
              onSelectAccount={sinCuenta}
              canExpand={false}
              expanded={false}
              onToggleExpand={sinMaximizar}
              onApi={m.registrarApi}
            />
          </ErrorBoundary>
        )
      })}
    </>
  )
}

/** La ventana de agente entera. */
export function VentanaAgente(): React.JSX.Element {
  const m = useVentanaAgente()
  const titulo = useTitulo(m)
  return (
    <AgentAppearanceContext.Provider value={m.apariencia}>
      <div className="ventana-agente">
        <BarraVentanaAgente titulo={titulo} />
        <main className="ventana-agente-cuerpo">
          {m.datos ? <Panes m={m} /> : <div className="ventana-agente-cargando">{txVentanaAgente().cargando}</div>}
        </main>
        <CapaFlotante />
        <TooltipPropio />
      </div>
    </AgentAppearanceContext.Provider>
  )
}
