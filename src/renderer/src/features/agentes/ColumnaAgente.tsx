// =============================================================================
// Columna derecha de la ventana: el divisor que toque (el de siempre contra el
// editor, o el del agente de datos en la vista de BD) y las terminales de agente
// multiplexadas de todos los perfiles (CCPanel), que nunca se desmontan.
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { CC_WIDTH_MIN } from '../../../../shared/workspace-state-ipc'
import { Splitter } from '../../comun/Splitter'
import { CCPanel, type MosaicoPanel } from './CCPanel'
import { handleTargetStatus, handleTargetVivo, selectAccount, selectAgent, useStoreAgentes } from './store'
import type { AgentesApp } from './useAgentesApp'
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

/** Divisores de la columna del agente y la columna misma. */
/** El divisor que toque contra el centro: el del editor, el del agente de datos en BD, o ninguno. */
function DivisorAgente({
  divisor,
  tamanos
}: {
  divisor: SalidaLayoutCentro['divisorAgente']
  tamanos: Tamanos
}): React.JSX.Element | null {
  const ccWidth = useStoreLayout((s) => s.ccWidth)
  if (divisor === 'editor') {
    return (
      <Splitter
        orientation="vertical"
        size={ccWidth}
        min={CC_WIDTH_MIN}
        max={tamanos.ccMax}
        direction={-1}
        onResize={fijadoresLayout.ccWidth}
        label="Redimensionar Claude Code"
      />
    )
  }
  if (divisor === 'db') {
    return (
      <Splitter
        orientation="vertical"
        size={tamanos.dbAgenteWidthVisible}
        min={CC_WIDTH_MIN}
        max={tamanos.ccMaxDb}
        direction={-1}
        onResize={fijadoresLayout.dbAgenteWidth}
        label="Redimensionar el agente"
      />
    )
  }
  return null
}

export function ColumnaAgente(props: Props): React.JSX.Element {
  const { tabs, agentes, columna, tamanos, espacios, montajes, sesiones } = props
  const lay = agentes.lay
  const accountByTarget = useStoreAgentes((s) => s.accountByTarget)
  const { tokenFocoMosaico, salidaSinFoco } = useStoreMosaico(
    useShallow((s) => ({ tokenFocoMosaico: s.tokenFocoMosaico, salidaSinFoco: s.salidaSinFoco }))
  )
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
        hibernatedTargetKeys={tabs.hibernatedTargetKeys}
        profiles={tabs.profiles}
        canExpand={lay.cc.canExpand}
        expanded={columna.ccExpanded}
        onToggleExpand={columna.alternarCcMaximizado}
        hidden={lay.cc.hidden}
        onTargetStatus={handleTargetStatus}
        onTargetVivo={handleTargetVivo}
        mosaico={mosaicoPanel}
        tokenFoco={tokenFocoMosaico}
        sinRobarFoco={salidaSinFoco}
        onSelectAgent={selectAgent}
        accountByTarget={accountByTarget}
        onSelectAccount={selectAccount}
        windowsModeKeys={windowsModeKeys}
        dbMountsByProject={dbMounts}
        onChangeDbMounted={montajes.setDbMountedForProject}
        dbReady={settingsLoaded}
        rutasEspacioDatos={espacios.espacioPathsSet}
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
