// =============================================================================
// Bloque superior de la ventana conectado a los stores: la barra de título con las
// franjas de perfiles y proyectos (BarraPestanas), la barra del mosaico cuando está
// abierto y el botón de actualizar los agentes nativos.
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { BarraPestanas } from './BarraPestanas'
import { useStoreAjustes } from '../ajustes'
import type { UsePestanas, usePuntosPerfil } from '../pestanas'
import { BotonAgentesNativos, useStoreAgentes, type ActividadAgentes, type SesionesNativas } from '../agentes'
import { BarraMosaico, fijarMosaicoPreset, useStoreMosaico, verCasilla, type MosaicoApp, type OpcionMosaico } from '../mosaico'
import { contarPintado } from '../../util/contadorRenders'

interface Props {
  pestanas: UsePestanas
  puntos: ReturnType<typeof usePuntosPerfil>
  actividad: ActividadAgentes
  mosaico: MosaicoApp
  sesiones: SesionesNativas
}

/** Controles del mosaico en la barra de título: resumen, distribuciones, selector y fichas. */
function BarraDelMosaico({ mosaico, actividad }: Pick<Props, 'mosaico' | 'actividad'>): React.JSX.Element {
  const { teselas, preset, disposicion } = useStoreMosaico(
    useShallow((s) => ({ teselas: s.teselas, preset: s.mosaicoPreset, disposicion: s.disposicionMosaico }))
  )
  const { conjuntoTrabajando: trabajandoSet, conjuntoEsperando: esperandoSet, estadoActividad: activity } = actividad
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
            return o === undefined ? undefined : { ...o, trabajando: trabajandoSet.has(k), sinVer: activity.sinVer.has(k), esperando: esperandoSet.has(k) }
          })
          .filter((o): o is OpcionMosaico => o !== undefined)
      : []
  return (
    <BarraMosaico
      casillas={teselas.length}
      trabajando={teselas.filter((k) => trabajandoSet.has(k)).length}
      preset={preset}
      onPreset={fijarMosaicoPreset}
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
export function BarraTitulo({ pestanas, puntos, actividad, mosaico, sesiones }: Props): React.JSX.Element {
  contarPintado('BarraTitulo')
  const { hideProfileNames, ajustesAbiertos } = useStoreAjustes(
    useShallow((s) => ({ hideProfileNames: s.hideProfileNames, ajustesAbiertos: s.ajustesAbiertos }))
  )
  const mosaicoActivo = useStoreMosaico((s) => s.mosaicoActivo)
  const tokenAbrirAgentes = useStoreAgentes((s) => s.tokenAbrirAgentes)
  return (
    <BarraPestanas
      pestanas={pestanas}
      estadosPuntoPerfil={puntos.estadosPuntoPerfil}
      estadosPuntoProyecto={puntos.estadosPuntoProyecto}
      perfilesConAtencion={actividad.atencionActividad.perfilesSinVer}
      perfilesTrabajando={actividad.atencionActividad.perfilesTrabajando}
      perfilesEsperando={actividad.atencionActividad.perfilesEsperando}
      ocultarNombresPerfil={hideProfileNames}
      ajustesActivos={ajustesAbiertos}
      onAlternarAjustes={() => useStoreAjustes.getState().alternarAjustes()}
      mosaicoActivo={mosaicoActivo}
      mosaicoDisponible={mosaico.mosaicoDisponible}
      onAlternarMosaico={mosaico.alternarMosaico}
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
