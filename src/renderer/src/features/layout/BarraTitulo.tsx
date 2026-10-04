// =============================================================================
// Bloque superior de la ventana conectado a los stores: la barra de título con las
// franjas de perfiles y proyectos (TabsBar), la barra del mosaico cuando está
// abierto y el botón de actualizar los agentes nativos.
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { TabsBar } from './TabsBar'
import { useStoreAjustes } from '../ajustes'
import { useStorePestanas, type ModoProyecto, type UseTabs, type usePuntosPerfil } from '../pestanas'
import { BotonAgentesNativos, useStoreAgentes, type ActividadAgentes, type SesionesNativas } from '../agentes'
import { BarraMosaico, setMosaicoPreset, useStoreMosaico, verCasilla, type MosaicoApp, type OpcionMosaico } from '../mosaico'
import { contarRender } from '../../util/contadorRenders'

interface Props {
  tabs: UseTabs
  puntos: ReturnType<typeof usePuntosPerfil>
  actividad: ActividadAgentes
  modo: ModoProyecto
  mosaico: MosaicoApp
  sesiones: SesionesNativas
}

/** Controles del mosaico en la barra de título: resumen, distribuciones, selector y fichas. */
function BarraDelMosaico({ mosaico, actividad }: Pick<Props, 'mosaico' | 'actividad'>): React.JSX.Element {
  const { teselas, preset, disposicion } = useStoreMosaico(
    useShallow((s) => ({ teselas: s.teselas, preset: s.mosaicoPreset, disposicion: s.disposicionMosaico }))
  )
  const { trabajandoSet, activity } = actividad
  const opciones = mosaico.opcionesMosaico
  const porClave = new Map(opciones.map((o) => [o.key, o]))
  // Fichas: solo cuando no se ven todas a la vez (ventana pequeña o una ampliada).
  const enfoque = disposicion?.forma === 'enfoque'
  const visibleEnfoque =
    enfoque && disposicion?.visibleEnfoque != null ? (teselas[disposicion.visibleEnfoque] ?? null) : null
  // La ficha ES una casilla: su punto habla del agente que se ve, no del proyecto.
  const fichas =
    enfoque && teselas.length > 1
      ? teselas
          .map((k) => {
            const o = porClave.get(k)
            return o === undefined ? undefined : { ...o, trabajando: trabajandoSet.has(k), sinVer: activity.unseen.has(k) }
          })
          .filter((o): o is OpcionMosaico => o !== undefined)
      : []
  return (
    <BarraMosaico
      casillas={teselas.length}
      trabajando={teselas.filter((k) => trabajandoSet.has(k)).length}
      preset={preset}
      onPreset={setMosaicoPreset}
      presetRespetado={disposicion?.presetRespetado ?? true}
      opciones={opciones}
      onAlternar={mosaico.alternarCasilla}
      fichas={fichas}
      visible={visibleEnfoque}
      onElegirFicha={verCasilla}
    />
  )
}

/** Barra de título con las pestañas de perfiles y proyectos. */
export function BarraTitulo({ tabs, puntos, actividad, modo, mosaico, sesiones }: Props): React.JSX.Element {
  contarRender('BarraTitulo')
  const { hideProfileNames, settingsOpen } = useStoreAjustes(
    useShallow((s) => ({ hideProfileNames: s.hideProfileNames, settingsOpen: s.settingsOpen }))
  )
  const windowsModeKeys = useStorePestanas((s) => s.windowsModeKeys)
  const mosaicoActivo = useStoreMosaico((s) => s.mosaicoActivo)
  const tokenAbrirAgentes = useStoreAgentes((s) => s.tokenAbrirAgentes)
  return (
    <TabsBar
      tabs={tabs}
      profileDotStates={puntos.profileDotStates}
      projectDotStates={puntos.projectDotStates}
      attentionProfiles={actividad.activityAttention.unseenProfiles}
      workingProfiles={actividad.activityAttention.workingProfiles}
      hideProfileNames={hideProfileNames}
      onShowProfileNames={() => useStoreAjustes.setState({ hideProfileNames: false })}
      windowsModeKeys={windowsModeKeys}
      onToggleWindowsMode={modo.toggleWindowsMode}
      decideProjectMode={modo.decideProjectMode}
      settingsActive={settingsOpen}
      onToggleSettings={() => useStoreAjustes.getState().alternarSettings()}
      mosaicoActivo={mosaicoActivo}
      mosaicoDisponible={mosaico.mosaicoDisponible}
      onToggleMosaico={mosaico.alternarMosaico}
      barraMosaico={mosaicoActivo ? <BarraDelMosaico mosaico={mosaico} actividad={actividad} /> : null}
      botonAgentes={
        <BotonAgentesNativos
          act={sesiones.actualizacionNativa}
          hayProyectoNativo={sesiones.hayProyectoNativo}
          info={sesiones.infoSesionesAgentes}
          tokenAbrir={tokenAbrirAgentes}
        />
      }
    />
  )
}
