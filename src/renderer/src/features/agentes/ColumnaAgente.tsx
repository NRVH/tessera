// =============================================================================
// Columna derecha de la ventana: el divisor que toque (el de siempre contra el editor, el del
// agente de datos en la vista de BD o el del agente de la terminal a pantalla completa) y las
// terminales de agente multiplexadas de todos los perfiles (CCPanel), que nunca se desmontan.
// También decide quién se lleva el teclado cuando la columna cambia de dueño.
// Decisiones: docs/decisiones/agentes/columna-del-agente.md, docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CC_WIDTH_MIN } from '../../../../shared/workspace-state-ipc'
import { Splitter } from '../../comun/Splitter'
import { CCPanel, type MosaicoPanel } from './CCPanel'
import { handleTargetStatus, handleTargetVivo, selectAccount, selectAgent, useStoreAgentes } from './store'
import { cerrarAgenteTerminal, elegirAgenteTerminal, soltarFocoAgenteTerminal, useStoreAgenteTerminal } from './storeAgenteTerminal'
import type { AgentesApp } from './useAgentesApp'
import type { AgenteTerminalApp } from './useAgenteTerminal'
import type { ColumnaAgenteEstado } from './useColumnaAgente'
import type { SesionesNativas } from './useSesionesNativas'
import { fijadoresLayout, useStoreLayout, type SalidaLayoutCentro, type Tamanos } from '../layout'
import { useStorePestanas, type ModoProyecto, type UseTabs } from '../pestanas'
import { useStoreBd, type EspaciosDatos, type MontajesBd } from '../bd'
import { useStoreAjustes } from '../ajustes'
import { ampliarCasilla, enfocarCasilla, setDisposicionMosaico, useStoreMosaico, type MosaicoApp } from '../mosaico'
import type { ActividadAgentes } from './useActividadAgentes'

interface Props {
  tabs: UseTabs
  agentes: AgentesApp
  columna: ColumnaAgenteEstado
  tamanos: Tamanos
  mosaico: MosaicoApp
  actividad: ActividadAgentes
  modo: ModoProyecto
  espacios: EspaciosDatos
  agenteTerminal: AgenteTerminalApp
  montajes: MontajesBd
  sesiones: SesionesNativas
}

/** Lo que el mosaico pinta en la columna; null fuera del mosaico. */
function usePanelMosaico(p: Pick<Props, 'mosaico' | 'actividad' | 'modo' | 'espacios'>): MosaicoPanel | null {
  const m = useStoreMosaico(
    useShallow((s) => ({
      activo: s.mosaicoActivo,
      teselas: s.teselas,
      enfocada: s.enfocada,
      ampliada: s.ampliada,
      preset: s.mosaicoPreset
    }))
  )
  if (!m.activo) return null
  return {
    teselas: m.teselas,
    enMarcha: p.mosaico.candidatosVivos.length,
    enfocada: m.enfocada,
    ampliada: m.ampliada,
    preset: m.preset,
    nombresProyecto: p.mosaico.nombresProyecto,
    trabajando: p.actividad.trabajandoSet,
    sinVer: p.actividad.activity.unseen,
    opciones: p.mosaico.opcionesMosaico,
    onElegirDestino: p.mosaico.elegirDestinoCasilla,
    onAbrirProyecto: p.mosaico.abrirProyectoEnCasilla,
    onCambiarModo: p.modo.toggleWindowsMode,
    modoBloqueado: p.espacios.esEspacioDeDatos,
    onEnfocar: enfocarCasilla,
    onAmpliar: ampliarCasilla,
    onIrAlProyecto: p.mosaico.irAlProyectoDesdeMosaico,
    onDisposicion: setDisposicionMosaico
  }
}

/** El divisor que toque contra el centro: el del editor, el del agente de datos, el del agente de la terminal, o ninguno. */
function DivisorAgente({
  divisor,
  tamanos
}: {
  divisor: SalidaLayoutCentro['divisorAgente']
  tamanos: Tamanos
}): React.JSX.Element | null {
  const ccWidth = useStoreLayout((s) => s.ccWidth)
  if (divisor === null) return null
  const porDivisor = {
    editor: { size: ccWidth, max: tamanos.ccMax, onResize: fijadoresLayout.ccWidth, label: 'Redimensionar Claude Code' },
    db: { size: tamanos.dbAgenteWidthVisible, max: tamanos.ccMaxDb, onResize: fijadoresLayout.dbAgenteWidth, label: 'Redimensionar el agente' },
    terminal: {
      size: tamanos.agenteTerminalAnchoVisible,
      max: tamanos.ccMaxTerminal,
      onResize: fijadoresLayout.agenteTerminalAncho,
      label: 'Redimensionar el agente de la terminal'
    }
  }[divisor]
  // `splitter-agente`: el CSS del agente de la terminal lo deja a la vista y aparta a sus hermanos.
  return <Splitter orientation="vertical" min={CC_WIDTH_MIN} direction={-1} className="splitter-agente" {...porDivisor} />
}

/**
 * ¿Cambia en este render la columna hacia o desde el agente de la terminal? Lo compara con el último
 * commit: entrar o salir de pantalla completa (por cualquier vía) cambia de dueño sin que nadie haya
 * pedido el teclado, y en ese commit ningún pane se lo lleva.
 */
function useCambiaAgenteTerminal(agente: SalidaLayoutCentro['agente']): boolean {
  const anterior = useRef(agente)
  const cambia = anterior.current !== agente && (anterior.current === 'terminal' || agente === 'terminal')
  useEffect(() => {
    anterior.current = agente
  })
  return cambia
}

/** Quién se lleva el teclado: la salida del mosaico y los cambios de dueño no; un gesto en el agente de la terminal sí. */
function useFocoDeLaColumna(lay: SalidaLayoutCentro): { tokenFoco: number; sinRobarFoco: boolean; focoAgenteTerminal: boolean } {
  const { tokenFocoMosaico, salidaSinFoco } = useStoreMosaico(
    useShallow((s) => ({ tokenFocoMosaico: s.tokenFocoMosaico, salidaSinFoco: s.salidaSinFoco }))
  )
  const focoPedido = useStoreAgenteTerminal((s) => s.focoPedido)
  const cambia = useCambiaAgenteTerminal(lay.agente)
  // Vive un commit: los panes (hijos) ya decidieron cuando corre este efecto del padre.
  useEffect(() => {
    if (focoPedido) soltarFocoAgenteTerminal()
  }, [focoPedido])
  return { tokenFoco: tokenFocoMosaico, sinRobarFoco: salidaSinFoco || (cambia && !focoPedido), focoAgenteTerminal: focoPedido }
}

export function ColumnaAgente(props: Props): React.JSX.Element {
  const { tabs, agentes, columna, tamanos, espacios, agenteTerminal, montajes, sesiones } = props
  const lay = agentes.lay
  const accountByTarget = useStoreAgentes((s) => s.accountByTarget)
  const foco = useFocoDeLaColumna(lay)
  const windowsModeKeys = useStorePestanas((s) => s.windowsModeKeys)
  const dbMounts = useStoreBd((s) => s.dbMounts)
  const settingsLoaded = useStoreAjustes((s) => s.settingsLoaded)
  const mosaicoPanel = usePanelMosaico(props)
  return (
    <>
      <DivisorAgente divisor={lay.divisorAgente} tamanos={tamanos} />
      <CCPanel
        grow={lay.cc.grow}
        targets={agentes.targetsAgente}
        activeTargetKey={agentes.activeTargetKeyEfectivo}
        hibernatedTargetKeys={agentes.hibernatedTargetKeys}
        profiles={tabs.profiles}
        canExpand={lay.cc.canExpand}
        expanded={columna.ccExpanded}
        onToggleExpand={columna.alternarCcMaximizado}
        hidden={lay.cc.hidden}
        onTargetStatus={handleTargetStatus}
        onTargetVivo={handleTargetVivo}
        mosaico={mosaicoPanel}
        {...foco}
        onSelectAgent={selectAgent}
        accountByTarget={accountByTarget}
        onSelectAccount={selectAccount}
        windowsModeKeys={windowsModeKeys}
        dbMountsByProject={dbMounts}
        onChangeDbMounted={montajes.setDbMountedForProject}
        dbReady={settingsLoaded}
        rutasEspacioDatos={espacios.espacioPathsSet}
        rutasAgenteTerminal={agenteTerminal.rutasSet}
        onSelectAgentTerminal={elegirAgenteTerminal}
        onCerrarAgenteTerminal={cerrarAgenteTerminal}
        onApiAgente={sesiones.actualizacionNativa.registrarApi}
        estadoAgentesNativos={sesiones.actualizacionNativa.estado}
        enEspera={
          lay.agente === 'proyecto' && columna.textosDiferido
            ? { ...columna.textosDiferido, onIniciar: columna.iniciarAgenteDiferido }
            : null
        }
      />
    </>
  )
}
