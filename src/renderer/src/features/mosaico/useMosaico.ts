// =============================================================================
// Mosaico de agentes en la ventana: qué targets pueden ser casilla, cómo se entra y
// se sale, cómo se mantienen las casillas mientras está abierto, los destinos que
// esperan a que su target exista y los atajos, que se deciden en fase de captura.
// Las reglas puras viven en mosaicoTeselas.ts (con su prueba).
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { notify } from '../../comun/notifications'
import { txMosaico } from './textosMosaico.ts'
import { hayModalAbierto } from '../../util/modalAbierto'
import { accionMosaico } from '../../util/atajos'
import {
  accionPeticion,
  alternarTesela,
  candidatosDelMosaico,
  reconciliarTeselas,
  reemplazarTesela,
  seleccionInicial,
  type CandidatoMosaico,
  type OpcionMosaico
} from './mosaicoTeselas'
import { opcionesDelMosaico } from './opcionesMosaico'
import {
  ampliarCasilla,
  enfocarCasilla,
  salirMosaico,
  subirTokenFoco,
  useStoreMosaico,
  verCasilla
} from './store'
import { agentTargetKey, type DecideProjectMode, type OpenAgentTarget, type UseTabs } from '../pestanas'
import { editorTargetKey } from '../editor'
import { useNombresAgente, useStoreAgentes, type ActividadAgentes, type AgentesApp } from '../agentes'
import type { IdAgente } from '../../../../shared/agentesManuales'

/** Qué agente se enseña de un proyecto (casilla, trabajando, sin ver, vivo, elegido). */
type AgenteDelProyecto = (profileId: string, projectHostPath: string) => IdAgente

/** Lo que el mosaico usa de los agentes de la ventana: todos los targets, también los que no son pestaña. */
type AgentesMosaico = Pick<
  AgentesApp,
  'activeTargetKey' | 'activeTargetKeyEfectivo' | 'targetsAgente' | 'hibernatedTargetKeys' | 'propios'
>

/** Lo que el mosaico expone a la barra de título y a la columna. */
export interface MosaicoApp {
  candidatosMosaico: CandidatoMosaico[]
  candidatosVivos: CandidatoMosaico[]
  mosaicoDisponible: boolean
  alternarMosaico: () => void
  alternarCasilla: (key: string) => void
  elegirDestinoCasilla: (casilla: string, destino: string) => void
  abrirProyectoEnCasilla: (casilla: string, profileId: string) => void
  irAlProyectoDesdeMosaico: (target: OpenAgentTarget) => void
  /** Nombre de cada proyecto abierto: en el mosaico no hay banda que lo diga. */
  nombresProyecto: Record<string, string>
  /** Una opción por proyecto abierto; vacío fuera del mosaico. */
  opcionesMosaico: OpcionMosaico[]
}

/** Nombres y opciones del mosaico; las opciones solo se calculan con el mosaico abierto. */
function useOpciones(
  tabs: UseTabs,
  agentes: AgentesMosaico,
  actividad: ActividadAgentes,
  candidatos: CandidatoMosaico[],
  candidatosVivos: CandidatoMosaico[],
  agenteDelProyecto: AgenteDelProyecto,
  tintasPorPerfil: Record<string, string>
): Pick<MosaicoApp, 'nombresProyecto' | 'opcionesMosaico'> {
  const { mosaicoActivo, teselas } = useStoreMosaico(
    useShallow((s) => ({ mosaicoActivo: s.mosaicoActivo, teselas: s.teselas }))
  )
  const nombresAgente = useNombresAgente()
  const { propios } = agentes
  const nombresProyecto: Record<string, string> = {}
  for (const p of tabs.allOpenProjects) nombresProyecto[editorTargetKey(p.profileId, p.projectHostPath)] = p.name
  // El agente de datos y el de la terminal se llaman por la vista donde viven.
  for (const c of candidatos) {
    const lugar = propios.lugarDe(c.projectHostPath)
    if (lugar !== 'proyecto') nombresProyecto[editorTargetKey(c.profileId, c.projectHostPath)] = propios.nombreDe(lugar)
  }
  const opcionesMosaico = mosaicoActivo
    ? opcionesDelMosaico({
        candidatos,
        teselas,
        vivas: new Set(candidatosVivos.map((c) => c.key)),
        perfiles: new Map(tabs.profiles.map((p) => [p.id, p])),
        nombresProyecto,
        tintasPorPerfil,
        hibernados: agentes.hibernatedTargetKeys,
        trabajando: actividad.trabajandoSet,
        sinVer: actividad.activity.unseen,
        esperando: actividad.esperandoSet,
        agenteDelProyecto,
        claveProyecto: editorTargetKey,
        nombreAgente: (c) => nombresAgente(c.profileId, c.projectHostPath, c.agente)
      })
    : []
  return { nombresProyecto, opcionesMosaico }
}

type AccionMosaico = Exclude<NonNullable<ReturnType<typeof accionMosaico>>, { tipo: 'ignorar' }>

/**
 * Candidatos: cada target abierto, ordenado como se leen las pestañas; el agente de datos y el de la
 * terminal, detrás de los proyectos de su perfil.
 */
function useCandidatos(tabs: UseTabs, agentes: AgentesMosaico): CandidatoMosaico[] {
  const { targetsAgente, propios } = agentes
  return useMemo(
    () =>
      candidatosDelMosaico({
        perfiles: tabs.profiles.map((p) => p.id),
        proyectos: tabs.allOpenProjects,
        targets: targetsAgente,
        lugarDe: propios.lugarDe
      }),
    [tabs.profiles, tabs.allOpenProjects, targetsAgente, propios.lugarDe]
  )
}

/** Qué agente se enseña de un proyecto: casilla, trabajando, sin ver, vivo, elegido. */
function useAgenteDelProyecto(agentes: AgentesMosaico, actividad: ActividadAgentes): AgenteDelProyecto {
  const teselas = useStoreMosaico((s) => s.teselas)
  const vivos = useStoreAgentes((s) => s.vivos)
  const { trabajandoSet, activity } = actividad
  const unseen = activity.unseen
  const { hibernatedTargetKeys, propios } = agentes
  return useCallback(
    (profileId: string, projectHostPath: string): IdAgente => {
      const enRejilla = new Set(teselas)
      const disponibles = propios.agentesDe(profileId, projectHostPath)
      const cands = disponibles.map((a) => ({ a, key: agentTargetKey(profileId, projectHostPath, a) }))
      return (
        cands.find((c) => enRejilla.has(c.key))?.a ??
        cands.find((c) => trabajandoSet.has(c.key))?.a ??
        cands.find((c) => unseen.has(c.key))?.a ??
        cands.find((c) => vivos.has(c.key) && !hibernatedTargetKeys.has(c.key))?.a ??
        propios.elegidoDe(profileId, projectHostPath)
      )
    },
    [teselas, trabajandoSet, unseen, vivos, hibernatedTargetKeys, propios]
  )
}

/** Mientras está abierto: sale la casilla cuyo proyecto se cierra o hiberna; nada entra solo. */
function useReconciliar(agentes: AgentesMosaico, candidatosVivos: CandidatoMosaico[], candidatos: CandidatoMosaico[]): void {
  const { mosaicoActivo, teselas, enfocada, ampliada } = useStoreMosaico(
    useShallow((s) => ({ mosaicoActivo: s.mosaicoActivo, teselas: s.teselas, enfocada: s.enfocada, ampliada: s.ampliada }))
  )
  const { targetsAgente, hibernatedTargetKeys } = agentes
  useEffect(() => {
    if (!mosaicoActivo) return
    const existentes = new Set(targetsAgente.filter((t) => !hibernatedTargetKeys.has(t.key)).map((t) => t.key))
    useStoreMosaico.setState((s) => ({
      teselas: reconciliarTeselas(s.teselas, { vivos: candidatosVivos, orden: candidatos, existentes })
    }))
  }, [mosaicoActivo, candidatosVivos, candidatos, targetsAgente, hibernatedTargetKeys])
  // Foco y ampliada siempre en una casilla que existe.
  useEffect(() => {
    if (!mosaicoActivo) return
    if (enfocada === null || !teselas.includes(enfocada)) {
      if (teselas.length > 0) {
        enfocarCasilla(teselas[0])
        subirTokenFoco()
      } else useStoreMosaico.setState({ enfocada: null })
    }
    if (ampliada !== null && !teselas.includes(ampliada)) useStoreMosaico.setState({ ampliada: null })
  }, [mosaicoActivo, teselas, enfocada, ampliada])
}

/** Atajos del mosaico en fase de CAPTURA: xterm cancelaría algunos acordes antes de que suban. */
function useAtajosMosaico(ejecutarRef: { current: (a: AccionMosaico) => void }): void {
  useEffect(() => {
    function onKeyDownCaptura(e: KeyboardEvent): void {
      if (e.isComposing) return
      const accion = accionMosaico(e, useStoreMosaico.getState().mosaicoActivo)
      if (!accion) return
      // Con un diálogo delante el teclado es suyo.
      if (hayModalAbierto()) return
      e.preventDefault()
      e.stopPropagation()
      // La autorrepetición se consume sin hacer nada.
      if (accion.tipo === 'ignorar') return
      ejecutarRef.current(accion)
    }
    window.addEventListener('keydown', onKeyDownCaptura, true)
    return () => window.removeEventListener('keydown', onKeyDownCaptura, true)
  }, [ejecutarRef])
}

/** Ejecuta una acción de atajo con el estado del momento. */
function ejecutarAccion(a: AccionMosaico, entrarMosaico: () => void): void {
  const { mosaicoActivo, teselas, ampliada, enfocada } = useStoreMosaico.getState()
  if (a.tipo === 'alternar') {
    if (mosaicoActivo) salirMosaico()
    else entrarMosaico()
    return
  }
  if (!mosaicoActivo) return
  if (a.tipo === 'ir') {
    const key = teselas[a.indice]
    if (key) verCasilla(key)
    return
  }
  // Con una ampliada hace lo mismo que su «Restaurar»; sin ninguna, amplía la enfocada.
  const k = ampliada ?? enfocada
  if (k) ampliarCasilla(k)
}

/** Resuelve el destino que esperaba a que su target existiera, despierto o abierto. */
function useDestinoPendiente(
  tabs: UseTabs,
  hibernados: ReadonlySet<string>,
  candidatos: CandidatoMosaico[],
  alternarCasilla: (key: string) => void,
  elegirDestinoCasilla: (casilla: string, destino: string) => void
): void {
  const { mosaicoActivo, teselas, destinoPendiente } = useStoreMosaico(
    useShallow((s) => ({ mosaicoActivo: s.mosaicoActivo, teselas: s.teselas, destinoPendiente: s.destinoPendiente }))
  )
  // Por ref para el efecto, que no puede depender de funciones recreadas.
  const alternarRef = useRef(alternarCasilla)
  alternarRef.current = alternarCasilla
  const elegirRef = useRef(elegirDestinoCasilla)
  elegirRef.current = elegirDestinoCasilla
  const proyectosAbiertos = useMemo(
    () => new Set(tabs.allOpenProjects.map((p) => editorTargetKey(p.profileId, p.projectHostPath))),
    [tabs.allOpenProjects]
  )
  useEffect(() => {
    if (destinoPendiente === null) return
    const accion = accionPeticion(destinoPendiente, {
      mosaico: mosaicoActivo,
      teselas,
      existe: candidatos.some((c) => c.key === destinoPendiente.key),
      hibernado: hibernados.has(destinoPendiente.key),
      proyectoAbierto: proyectosAbiertos.has(destinoPendiente.proyecto)
    })
    if (accion === 'esperar') return
    if (accion === 'alternar') alternarRef.current(destinoPendiente.key)
    else if (accion === 'reemplazar' && destinoPendiente.casilla !== null) {
      elegirRef.current(destinoPendiente.casilla, destinoPendiente.key)
    }
    useStoreMosaico.setState({ destinoPendiente: null })
  }, [destinoPendiente, mosaicoActivo, teselas, candidatos, hibernados, proyectosAbiertos])
}

/** Proyecto (`editorTargetKey`) de cada target candidato. */
function useProyectoPorClave(candidatos: CandidatoMosaico[]): Map<string, string> {
  return useMemo(
    () => new Map(candidatos.map((c) => [c.key, editorTargetKey(c.profileId, c.projectHostPath)])),
    [candidatos]
  )
}

/** Casillas por destino: meter o sacar, cambiar de destino y despertar lo hibernado. */
function useDestinos(
  tabs: UseTabs,
  agentes: AgentesMosaico,
  candidatos: CandidatoMosaico[],
  proyectoPorClave: Map<string, string>
): Pick<MosaicoApp, 'alternarCasilla' | 'elegirDestinoCasilla'> {
  const { teselas, recientes } = useStoreMosaico(useShallow((s) => ({ teselas: s.teselas, recientes: s.recientes })))
  const { hibernatedTargetKeys: hibernados, propios } = agentes
  /**
   * Un proyecto se despierta con `wakeProject` (no mueve el proyecto activo) y deja el destino
   * pendiente. El agente de datos o el de la terminal sigue abierto: se despierta y entra ya.
   */
  const despertarSiHaceFalta = (casilla: string | null, destino: string): boolean => {
    if (!hibernados.has(destino)) return false
    const c = candidatos.find((x) => x.key === destino)
    if (c === undefined) return false
    if (propios.lugarDe(c.projectHostPath) !== 'proyecto') return !propios.despertar(c)
    tabs.wakeProject(c.profileId, c.projectHostPath)
    useStoreMosaico.setState({
      destinoPendiente: { casilla, key: destino, proyecto: editorTargetKey(c.profileId, c.projectHostPath) }
    })
    return true
  }
  const alternarCasilla = (key: string): void => {
    if (!teselas.includes(key) && despertarSiHaceFalta(null, key)) return
    const next = alternarTesela(teselas, key, { orden: candidatos, recientes })
    if (next === teselas) return
    const entran = next.filter((k) => !teselas.includes(k))
    useStoreMosaico.setState({ teselas: next })
    // La que entra se VE y se lleva el teclado (con otra ampliada quedaría escondida).
    if (entran.length > 0) verCasilla(entran[0])
  }
  // Manda el PROYECTO: si ya se ve en otra casilla no se duplica, se salta a ella.
  const elegirDestinoCasilla = (casilla: string, destino: string): void => {
    const proyectoDestino = proyectoPorClave.get(destino) ?? destino
    const yaEsta = teselas.find((k) => (proyectoPorClave.get(k) ?? k) === proyectoDestino)
    if (yaEsta !== undefined && yaEsta !== casilla) {
      verCasilla(yaEsta)
      return
    }
    if (despertarSiHaceFalta(casilla, destino)) return
    const next = reemplazarTesela(teselas, casilla, destino, { orden: candidatos })
    if (next === teselas) return
    useStoreMosaico.setState({ teselas: next })
    verCasilla(destino)
  }
  useDestinoPendiente(tabs, hibernados, candidatos, alternarCasilla, elegirDestinoCasilla)
  return { alternarCasilla, elegirDestinoCasilla }
}

/**
 * «Abrir otro proyecto en <perfil>…» desde una casilla; tras el diálogo se lee el estado
 * del momento. El destino se anota en `alAbrir`, en el mismo turno que la apertura: así
 * llega al commit junto al proyecto y `useDestinoPendiente` no lo descarta por no verlo.
 */
function useAbrirProyectoEnCasilla(
  tabs: UseTabs,
  proyectoPorClave: Map<string, string>,
  decideProjectMode: DecideProjectMode,
  agenteDelProyecto: AgenteDelProyecto
): MosaicoApp['abrirProyectoEnCasilla'] {
  const agenteRef = useRef(agenteDelProyecto)
  agenteRef.current = agenteDelProyecto
  const proyectoPorClaveRef = useRef(proyectoPorClave)
  proyectoPorClaveRef.current = proyectoPorClave
  return (casilla: string, profileId: string): void => {
    const alAbrir = (abierto: { projectHostPath: string; name: string }): void => {
      const proyecto = editorTargetKey(profileId, abierto.projectHostPath)
      // Una casilla por proyecto: si ya se ve en otra, se dice y se lleva el teclado allí.
      const otra = useStoreMosaico
        .getState()
        .teselas.find((k) => k !== casilla && (proyectoPorClaveRef.current.get(k) ?? k) === proyecto)
      if (otra !== undefined) {
        notify('info', txMosaico().yaTieneTerminal, txMosaico().yaTieneTerminalDetalle(abierto.name))
        verCasilla(otra)
        return
      }
      const agente = agenteRef.current(profileId, abierto.projectHostPath)
      useStoreMosaico.setState({
        destinoPendiente: { casilla, key: agentTargetKey(profileId, abierto.projectHostPath, agente), proyecto }
      })
    }
    void tabs.openProjectInProfile(profileId, decideProjectMode, alAbrir)
  }
}

/** Abre el mosaico con lo que está trabajando; el foco, a la terminal que ya usabas si entra. */
function useEntrarMosaico(
  candidatosVivos: CandidatoMosaico[],
  activeTargetKey: string | null,
  actividad: ActividadAgentes
): () => void {
  const { trabajandoSet, activity } = actividad
  const unseen = activity.unseen
  return useCallback(() => {
    const seleccion = seleccionInicial(candidatosVivos, { activa: activeTargetKey, terminadasSinVer: unseen, trabajando: trabajandoSet })
    if (seleccion.length === 0) return
    const foco = activeTargetKey !== null && seleccion.includes(activeTargetKey) ? activeTargetKey : seleccion[0]
    useStoreMosaico.setState({ teselas: seleccion, ampliada: null })
    enfocarCasilla(foco)
    subirTokenFoco()
    useStoreMosaico.setState({ mosaicoActivo: true })
  }, [candidatosVivos, activeTargetKey, unseen, trabajandoSet])
}

/** Mosaico de agentes: candidatos, entrada y salida, casillas, destinos y atajos. */
export function useMosaico(
  tabs: UseTabs,
  actividad: ActividadAgentes,
  agentes: AgentesMosaico,
  decideProjectMode: DecideProjectMode,
  tintasPorPerfil: Record<string, string>
): MosaicoApp {
  const salidaSinFoco = useStoreMosaico((s) => s.salidaSinFoco)
  // Vive un commit: los panes (hijos) ya decidieron cuando corre este efecto del padre.
  useEffect(() => {
    if (salidaSinFoco) useStoreMosaico.setState({ salidaSinFoco: false })
  }, [salidaSinFoco])
  const candidatosMosaico = useCandidatos(tabs, agentes)
  const vivos = useStoreAgentes((s) => s.vivos)
  const { hibernatedTargetKeys, propios } = agentes
  const candidatosVivos = useMemo(
    () => candidatosMosaico.filter((c) => vivos.has(c.key) && !hibernatedTargetKeys.has(c.key)),
    [candidatosMosaico, vivos, hibernatedTargetKeys]
  )
  const agenteDelProyecto = useAgenteDelProyecto(agentes, actividad)
  // El que se ve: en bases de datos o junto a la terminal, su agente, no el del proyecto.
  const entrarMosaico = useEntrarMosaico(candidatosVivos, agentes.activeTargetKeyEfectivo ?? agentes.activeTargetKey, actividad)
  useReconciliar(agentes, candidatosVivos, candidatosMosaico)
  // Salir e ir al destino caen en el mismo commit, y la columna enseña ya su agente: el foco es suyo.
  const irAlProyectoDesdeMosaico = useCallback(
    (target: OpenAgentTarget) => {
      salirMosaico()
      propios.irA(target)
    },
    [propios]
  )
  const proyectoPorClave = useProyectoPorClave(candidatosMosaico)
  const destinos = useDestinos(tabs, agentes, candidatosMosaico, proyectoPorClave)
  const abrirProyectoEnCasilla = useAbrirProyectoEnCasilla(tabs, proyectoPorClave, decideProjectMode, agenteDelProyecto)
  const ejecutarRef = useRef<(a: AccionMosaico) => void>(() => {})
  ejecutarRef.current = (a) => ejecutarAccion(a, entrarMosaico)
  useAtajosMosaico(ejecutarRef)
  const alternarMosaico = (): void => (useStoreMosaico.getState().mosaicoActivo ? salirMosaico() : entrarMosaico())
  const opciones = useOpciones(tabs, agentes, actividad, candidatosMosaico, candidatosVivos, agenteDelProyecto, tintasPorPerfil)
  return {
    ...opciones,
    candidatosMosaico,
    candidatosVivos,
    mosaicoDisponible: candidatosVivos.length > 0,
    alternarMosaico,
    ...destinos,
    abrirProyectoEnCasilla,
    irAlProyectoDesdeMosaico
  }
}
