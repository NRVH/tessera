// =============================================================================
// Targets de agente de la ventana: los de proyecto y los sintéticos de los espacios de datos y del
// agente de la terminal, cuál se ve (según layoutCentro), la restauración del agente de datos y del
// de la terminal, y los hibernados que ve la columna. También poda el estado de sesión y lleva a un
// (perfil, proyecto, agente).
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AGENTES_DISPONIBLES } from '../../../../main/perfiles/types'
import type { IdAgente } from '../../../../shared/agentesManuales'
import { agenteAMostrar, pestanasDeLaTerminal } from './agentesDelProyecto'
import { useAgentesDe, useFuenteAgentes } from './useAgentesDelProyecto'
import type { EstadoPaneAgente } from './tiposPaneAgente'
import { resolverAgenteSeleccionado } from './agenteElegido'
import { seleccionarAgente, useStoreAgentes } from './store'
import { useStoreAgenteTerminal } from './storeAgenteTerminal'
import type { ColumnaAgenteEstado } from './useColumnaAgente'
import { useRestaurarAgenteTerminal, type AgenteTerminalApp } from './useAgenteTerminal'
import { useHibernacionFueraDePestanas } from './useHibernacionFueraDePestanas'
import { useAgentesPropios, type AgentesPropios } from './useAgentesPropios'
import { claveDestinoAgente, useStorePestanas, type DestinoAgenteAbierto, type UsePestanas } from '../pestanas'
import {
  agenteVisibleEnFranja,
  cambiarVistaSi,
  derivarLayoutCentro,
  fijarColumna,
  pantallaCompletaCoherente,
  pantallaCompletaPedidaDe,
  useStoreLayout,
  useStoreVentanasFranja,
  type PanelInferiorCentro,
  type SalidaLayoutCentro,
  type VistasPorPerfil
} from '../layout'
import { ocultarAgenteDb, useStoreBd, type EspaciosDatos } from '../bd'
import { useStoreMosaico } from '../mosaico'
import { useDelegacion } from '../delegacion'

/** Targets de agente, el que se ve y el layout del centro. */
export interface AgentesApp {
  claveDestinoActivo: string | null
  destinosAgente: DestinoAgenteAbierto[]
  agenteDbVisible: boolean
  disposicion: SalidaLayoutCentro
  /** El panel de la franja que se pinta a pantalla completa, ya coherente: lo calcula UNA vez el layout. */
  pantallaCompleta: PanelInferiorCentro | null
  /** El target cuya columna se ve: del espacio en 'db', del agente de la terminal, del proyecto fuera, o ninguno. */
  claveDestinoActivoEfectivo: string | null
  agentesEnHijas: ReadonlyMap<string, string>
  /** Los hibernados que ve la columna: los de las pestañas y los que no son pestaña de un perfil hibernado. */
  clavesDestinoHibernados: Set<string>
  abrirDestinoAgente: (perfilId: string, rutaHostProyecto: string, agente: IdAgente) => void
  /** Lugar, agentes y navegación de cualquier target, también de los que no son pestaña. */
  propios: AgentesPropios
}

/**
 * Un target por agente para cada perfil abierto con su carpeta conocida (espacio de datos o agente de
 * la terminal). `agentesDe` da los agentes de cada perfil en ese sitio.
 */
function destinosDeCarpetas(
  abiertos: ReadonlySet<string>,
  rutas: Record<string, string>,
  agentesDe: (perfilId: string) => readonly IdAgente[]
): DestinoAgenteAbierto[] {
  const salida: DestinoAgenteAbierto[] = []
  for (const perfilId of abiertos) {
    const ruta = rutas[perfilId]
    if (!ruta) continue
    for (const agente of agentesDe(perfilId)) {
      salida.push({ profileId: perfilId, projectHostPath: ruta, agente, key: claveDestinoAgente(perfilId, ruta, agente) })
    }
  }
  return salida
}

const agentesDeSerie = (): readonly IdAgente[] => AGENTES_DISPONIBLES

/** Targets sintéticos de los espacios de datos abiertos (uno por agente de serie). */
function useDestinosEspacio(): DestinoAgenteAbierto[] {
  const { espaciosAbiertos, rutasWorkspaceDb } = useStoreBd(
    useShallow((s) => ({ espaciosAbiertos: s.espaciosAbiertos, rutasWorkspaceDb: s.rutaEspacioDatosPorPerfil }))
  )
  return useMemo(() => destinosDeCarpetas(espaciosAbiertos, rutasWorkspaceDb, agentesDeSerie), [espaciosAbiertos, rutasWorkspaceDb])
}

/** Targets sintéticos del agente de la terminal de los perfiles que lo tienen abierto (uno por agente suyo). */
function useDestinosTerminal(): DestinoAgenteAbierto[] {
  const { abiertos, rutas } = useStoreAgenteTerminal(useShallow((s) => ({ abiertos: s.abiertos, rutas: s.rutas })))
  const fuente = useFuenteAgentes()
  return useMemo(
    () => destinosDeCarpetas(abiertos, rutas, (perfil) => pestanasDeLaTerminal(fuente, perfil).map((x) => x.id)),
    [abiertos, rutas, fuente]
  )
}

function useAgentesEnHijas(destinos: DestinoAgenteAbierto[]): ReadonlyMap<string, string> {
  const { visibles, elegidos } = useStoreAgenteTerminal(
    useShallow((s) => ({ visibles: s.visiblePorPerfil, elegidos: s.agentePorPerfil }))
  )
  return useStoreVentanasFranja(useShallow(({ anchos, compactaPorPerfil }) => {
    const agentes = new Map<string, string>()
    for (const [perfil, ancho] of anchos) {
      if (!agenteVisibleEnFranja(Boolean(visibles[perfil]), Boolean(compactaPorPerfil[perfil]), ancho)) continue
      const propios = destinos.filter((d) => d.profileId === perfil)
      const destino = propios.find((d) => d.agente === elegidos[perfil]) ?? propios[0]
      if (destino) agentes.set(perfil, destino.key)
    }
    return agentes
  }))
}

/** Al entrar en BD con la preferencia puesta, prepara el espacio; si falla, retira la preferencia. */
function useRestaurarAgenteDb(pestanas: UsePestanas, enConexiones: boolean, espacios: EspaciosDatos): void {
  const { dbAgenteVisiblePorPerfil, espaciosAbiertos } = useStoreBd(
    useShallow((s) => ({ dbAgenteVisiblePorPerfil: s.dbAgenteVisiblePorPerfil, espaciosAbiertos: s.espaciosAbiertos }))
  )
  const { asegurarEspacioDeDatos, preparandoEspacioRef } = espacios
  useEffect(() => {
    const perfil = pestanas.perfilActivo
    if (!enConexiones || !perfil) return
    if (dbAgenteVisiblePorPerfil[perfil.id] !== true || espaciosAbiertos.has(perfil.id)) return
    if (preparandoEspacioRef.current.has(perfil.id)) return
    preparandoEspacioRef.current.add(perfil.id)
    void asegurarEspacioDeDatos(perfil).then((ok) => {
      preparandoEspacioRef.current.delete(perfil.id)
      if (!ok) ocultarAgenteDb(perfil.id)
    })
  }, [enConexiones, pestanas.perfilActivo, dbAgenteVisiblePorPerfil, espaciosAbiertos, asegurarEspacioDeDatos, preparandoEspacioRef])
}

/** Poda el estado de sesión de los targets que ya no están abiertos. */
function usePodaEstadoSesion(destinosAgente: DestinoAgenteAbierto[]): void {
  useEffect(() => {
    useStoreAgentes.setState((s) => {
      const prev = s.estadoPorDestino
      const claves = Object.keys(prev)
      if (claves.length === 0) return {}
      const abierto = new Set(destinosAgente.map((t) => t.key))
      if (claves.every((k) => abierto.has(k))) return {}
      const siguiente: Record<string, EstadoPaneAgente> = {}
      for (const k of claves) if (abierto.has(k)) siguiente[k] = prev[k]
      return { estadoPorDestino: siguiente }
    })
  }, [destinosAgente])
}

/** Lo que hay en el centro y en la franja: pestañas del editor y terminales que enseñar. */
export interface ContenidoCentro {
  hayPestanasEditor: boolean
  conTerminales: boolean
}

/** Layout del centro del perfil activo, el espacio de datos que le toca y el panel que se pinta a pantalla completa. */
function useLayoutDelCentro(
  pestanas: UsePestanas,
  vistas: Pick<VistasPorPerfil, 'vistaActiva' | 'panelInferior'>,
  columna: ColumnaAgenteEstado,
  { hayPestanasEditor, conTerminales }: ContenidoCentro
): {
  disposicion: SalidaLayoutCentro
  agenteDbVisible: boolean
  espacioActivoRuta: string | undefined
  pantallaCompleta: PanelInferiorCentro | null
} {
  const perfil = pestanas.perfilActivo
  const { espacioActivoRuta, espacioAbierto, agenteDbVisible, hayPestanasBd, hayConexionesBd } = useStoreBd(
    useShallow((s) => ({
      espacioActivoRuta: perfil ? s.rutaEspacioDatosPorPerfil[perfil.id] : undefined,
      espacioAbierto: perfil ? s.espaciosAbiertos.has(perfil.id) : false,
      agenteDbVisible: perfil ? s.dbAgenteVisiblePorPerfil[perfil.id] === true : false,
      hayPestanasBd: perfil ? (s.vistaBd.get(perfil.id)?.pestanas.pestanas.length ?? 0) > 0 : false,
      hayConexionesBd: perfil ? s.perfilesConConexiones.has(perfil.id) : false
    }))
  )
  const terminal = useStoreAgenteTerminal(
    useShallow((s) => ({
      visible: perfil ? s.visiblePorPerfil[perfil.id] === true : false,
      abierto: perfil ? s.abiertos.has(perfil.id) && s.rutas[perfil.id] !== undefined : false
    }))
  )
  const mosaicoActivo = useStoreMosaico((s) => s.mosaicoActivo)
  // De lo que el perfil dejó maximizado, en este mismo render: sin esperar al espejo de un efecto.
  const maximizados = useStoreLayout((s) => s.maximizadoPorPerfil[perfil?.id ?? ''])
  const pedida = pantallaCompletaPedidaDe(maximizados, vistas.panelInferior)
  const disposicion = derivarLayoutCentro({
    vista: vistas.vistaActiva,
    mosaico: mosaicoActivo,
    hayPestanasEditor,
    ccExpandido: columna.ccExpandido,
    ccOculto: columna.ccOculto,
    vistaDividida: columna.vistaDividida,
    agenteDbVisible,
    espacioAbierto: Boolean(perfil && espacioActivoRuta && espacioAbierto),
    hayPerfil: perfil !== null,
    panelInferior: vistas.panelInferior,
    pantallaCompletaPedida: pedida,
    agenteTerminalVisible: terminal.visible,
    agenteTerminalAbierto: terminal.abierto,
    conTerminales,
    agenteTerminalMaximizadoPedido: maximizados?.agenteTerminal === true,
    agenteDbMaximizadoPedido: maximizados?.agenteDb === true,
    hayPestanasBd,
    hayConexionesBd
  })
  const pantallaCompleta = pantallaCompletaCoherente({ pedida, franja: disposicion.franja, mosaico: mosaicoActivo })
  return { disposicion, agenteDbVisible, espacioActivoRuta, pantallaCompleta }
}

/**
 * El target cuya columna se ve. Ninguno en 'db' con el agente oculto: si no, su sesión arrancaría sin
 * que nadie la mirase. Tampoco con el agente DIFERIDO del proyecto: sin pane visible no hay sesión.
 * El agente de la terminal tiene su propio agente elegido, no el del perfil.
 */
function useClaveEfectiva(
  pestanas: UsePestanas,
  disposicion: SalidaLayoutCentro,
  espacioActivoRuta: string | undefined,
  proyecto: { clave: string | null; diferido: boolean }
): string | null {
  const perfil = pestanas.perfilActivo
  const agenteSeleccionadoPorPerfil = useStoreAgentes((s) => s.agenteSeleccionadoPorPerfil)
  const fuente = useFuenteAgentes()
  const { rutaTerminal, agenteTerminal } = useStoreAgenteTerminal(
    useShallow((s) => ({
      rutaTerminal: perfil ? s.rutas[perfil.id] : undefined,
      agenteTerminal: perfil ? s.agentePorPerfil[perfil.id] : undefined
    }))
  )
  if (disposicion.agente === 'terminal' && perfil && rutaTerminal) {
    const deLaTerminal = pestanasDeLaTerminal(fuente, perfil.id).map((x) => x.id)
    return claveDestinoAgente(perfil.id, rutaTerminal, agenteAMostrar(deLaTerminal, agenteTerminal) ?? AGENTES_DISPONIBLES[0])
  }
  if (disposicion.agente === 'espacio' && perfil && espacioActivoRuta) {
    return claveDestinoAgente(perfil.id, espacioActivoRuta, resolverAgenteSeleccionado(perfil.id, agenteSeleccionadoPorPerfil) ?? AGENTES_DISPONIBLES[0])
  }
  return disposicion.agente === 'proyecto' && !proyecto.diferido ? proyecto.clave : null
}

/** Lleva a un (perfil, proyecto, agente): restaura la columna y sale de BD en el perfil de destino. */
function useAbrirDestinoAgente(pestanas: UsePestanas): AgentesApp['abrirDestinoAgente'] {
  return useCallback(
    (perfilId: string, rutaHostProyecto: string, agente: IdAgente) => {
      seleccionarAgente(perfilId, agente)
      fijarColumna({ oculta: 'no' }, perfilId)
      cambiarVistaSi(perfilId, 'db', 'files')
      // Quien pide ir a ESE agente lo quiere en marcha: deja de estar diferido.
      pestanas.quitarAgenteDiferido(perfilId, rutaHostProyecto)
      // Una sola acción: entrar al perfil por separado despertaría su proyecto activo, no este.
      pestanas.setActiveProject(perfilId, rutaHostProyecto, { entrar: true })
    },
    [pestanas]
  )
}

/**
 * Un agente diferido que arranca por otra vía (una casilla del mosaico) deja de estarlo:
 * si no, al volver a la vista normal la columna diría «no se inicia hasta que lo pidas»
 * encima de una sesión viva.
 */
function useQuitarDiferidoAlArrancar(pestanas: UsePestanas): void {
  const vivos = useStoreAgentes((s) => s.vivos)
  // Una casilla del mosaico se mira, así que su agente arranca: cuenta desde que se elige,
  // sin esperar a que la sesión esté viva.
  const teselas = useStoreMosaico(useShallow((s) => (s.mosaicoActivo ? s.teselas : SIN_TESELAS)))
  const { todosLosDestinosAbiertos, quitarAgenteDiferido } = pestanas
  useEffect(() => {
    // Casi nunca hay un proyecto diferido: se sale sin recorrer los targets.
    const diferidos = new Set<string>()
    for (const [perfilId, t] of Object.entries(useStorePestanas.getState().pestanas.porPerfil)) {
      for (const p of t.proyectosAbiertos) if (p.agenteDiferido) diferidos.add(`${perfilId}|${p.rutaHostProyecto}`)
    }
    if (diferidos.size === 0) return
    for (const t of todosLosDestinosAbiertos) {
      if (!diferidos.has(`${t.profileId}|${t.projectHostPath}`)) continue
      if (vivos.has(t.key) || teselas.includes(t.key)) quitarAgenteDiferido(t.profileId, t.projectHostPath)
    }
  }, [vivos, teselas, todosLosDestinosAbiertos, quitarAgenteDiferido])
}

const SIN_TESELAS: readonly string[] = []

/** Targets de agente, layout del centro y navegación a un agente concreto. */
export function useAgentesApp(
  pestanas: UsePestanas,
  vistas: Pick<VistasPorPerfil, 'vistaActiva' | 'panelInferior' | 'enConexiones'>,
  columna: ColumnaAgenteEstado,
  espacios: EspaciosDatos,
  agenteTerminal: AgenteTerminalApp,
  contenido: ContenidoCentro
): AgentesApp {
  useDelegacion()
  // El agente que se ve es el del proyecto que se ve: su sesión ya vive, no espera al backend.
  const visto = pestanas.objetivoVisto
  const agenteSeleccionadoPorPerfil = useStoreAgentes((s) => s.agenteSeleccionadoPorPerfil)
  const agentesDe = useAgentesDe()
  // El elegido del perfil si es una pestaña de ESTE proyecto (su modo y los manuales); si no, la primera.
  const agenteActivo = visto
    ? resolverAgenteSeleccionado(visto.perfilId, agenteSeleccionadoPorPerfil, agentesDe(visto.perfilId, visto.proyecto.rutaHostProyecto))
    : null
  const claveDestinoActivo =
    visto && agenteActivo ? claveDestinoAgente(visto.perfilId, visto.proyecto.rutaHostProyecto, agenteActivo) : null
  const destinosEspacio = useDestinosEspacio()
  const destinosTerminal = useDestinosTerminal()
  const agentesEnHijas = useAgentesEnHijas(destinosTerminal)
  const fueraDePestanas = useMemo(() => [...destinosEspacio, ...destinosTerminal], [destinosEspacio, destinosTerminal])
  // La lista que monta la columna y la que usan las podas: con los targets que no son pestaña incluidos.
  const destinosAgente = useMemo(
    () => (fueraDePestanas.length ? [...pestanas.todosLosDestinosAbiertos, ...fueraDePestanas] : pestanas.todosLosDestinosAbiertos),
    [pestanas.todosLosDestinosAbiertos, fueraDePestanas]
  )
  const { disposicion, agenteDbVisible, espacioActivoRuta, pantallaCompleta } = useLayoutDelCentro(pestanas, vistas, columna, contenido)
  const claveDestinoActivoEfectivo = useClaveEfectiva(pestanas, disposicion, espacioActivoRuta, {
    clave: claveDestinoActivo,
    diferido: columna.agenteDiferido
  })
  const clavesVistas = useMemo(() => {
    const claves = new Set(agentesEnHijas.values())
    if (claveDestinoActivoEfectivo) claves.add(claveDestinoActivoEfectivo)
    return claves
  }, [agentesEnHijas, claveDestinoActivoEfectivo])
  const clavesDestinoHibernados = useHibernacionFueraDePestanas(pestanas, fueraDePestanas, clavesVistas)
  useQuitarDiferidoAlArrancar(pestanas)
  useRestaurarAgenteDb(pestanas, vistas.enConexiones, espacios)
  const perfilEnTerminalCompleta = pantallaCompleta === 'terminal' ? pestanas.perfilActivo?.id ?? null : null
  useRestaurarAgenteTerminal(pestanas.perfiles, perfilEnTerminalCompleta, agenteTerminal)
  usePodaEstadoSesion(destinosAgente)
  const abrirDestinoAgente = useAbrirDestinoAgente(pestanas)
  const propios = useAgentesPropios(pestanas, espacios.esEspacioDeDatos, agenteTerminal.esCarpetaAgenteTerminal, abrirDestinoAgente)
  return {
    claveDestinoActivo,
    destinosAgente,
    agenteDbVisible,
    disposicion,
    pantallaCompleta,
    claveDestinoActivoEfectivo,
    agentesEnHijas,
    clavesDestinoHibernados,
    abrirDestinoAgente,
    propios
  }
}
