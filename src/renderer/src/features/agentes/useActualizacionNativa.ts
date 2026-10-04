// =============================================================================
// Estado de «actualizar los agentes de tu equipo»: la foto del main, el progreso y el
// resumen PEGAJOSO de la última ejecución, que sobrevive al popover. Lo monta
// `useSesionesNativas` desde App; la ejecución la hace `actualizacionNativa.ts` con
// las dependencias reales enchufadas aquí, y este hook sólo traduce sus eventos.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { AgentKind } from '../../../../shared/agent-terminal-ipc'
import type { EstadoAgentesNativos } from '../../../../shared/agentes-nativos-ipc'
import { agentTargetKey } from '../pestanas'
import { ejecutar as ejecutarActualizacion, planificar } from './actualizacionNativa'
import type {
  ApiAgentePane,
  DepsActualizacion,
  EventoActualizacion,
  FaseActualizacion,
  PlanActualizacion,
  ResumenActualizacion
} from './tipos'

/** Líneas de salida que se conservan (las últimas). */
const TOPE_LINEAS = 500
/** Cada cuánto se vuelca la salida acumulada al estado. */
const VOLCADO_MS = 150

/** Lo que el botón de la barra de título y Configuración leen de la actualización nativa. */
export interface UseActualizacionNativa {
  /** Última foto del main; null antes de la primera. */
  estado: EstadoAgentesNativos | null
  /** Vista previa normal (lo que hará «Actualizar y reiniciar»); null sin estado. */
  plan: PlanActualizacion | null
  /** Vista previa de «Reiniciar igualmente» (todas las nativas vivas, sin instalar). */
  planForzado: PlanActualizacion | null
  /** Fase en curso; null si no corre nada. */
  enCurso: FaseActualizacion | null
  /** Agente de la fase en curso (instalando/deteniendo), si lo hay. */
  agenteEnCurso: AgentKind | null
  /** ¿Es «Reiniciar igualmente» lo que corre (o lo último que corrió)? */
  forzadoEnCurso: boolean
  /** Eventos de la ejecución en curso o de la última, en orden. */
  eventos: EventoActualizacion[]
  /** Salida de las instalaciones (últimas TOPE_LINEAS líneas). */
  salida: string[]
  /** Resultado PEGAJOSO de la última ejecución; null tras descartarlo. */
  resumen: ResumenActualizacion | null
  /** ¿Se vio el resumen? (retira el punto verde, nunca el rojo). */
  resumenVisto: boolean
  /** ¿Hay una comprobación manual (abrir el popover) en vuelo? */
  comprobando: boolean
  /** Error de la última comprobación manual, para el popover; null si fue bien. */
  errorComprobar: string | null
  /** `sessionId`s con un turno terminado sin mirar. */
  sinRevisar: ReadonlySet<string>
  /** Registro de la API de un pane (null al desmontarse). ESTABLE. */
  registrarApi: (clave: string, api: ApiAgentePane | null) => void
  /** Las APIs de los panes montados, leídas en el momento de llamar. ESTABLE. */
  panes: () => readonly ApiAgentePane[]
  /**
   * Pide una foto fresca SIN dar el resumen por visto. Es la de Configuración: allí no
   * se enseña el resumen, así que no puede retirar su punto. ESTABLE.
   */
  comprobar: () => void
  /** El popover se abrió: da el resumen por visto y pide una foto fresca. ESTABLE. */
  abrir: () => void
  /** El popover se cerró: da el resumen por visto si ya terminó. ESTABLE. */
  cerrar: () => void
  /** Ejecuta la actualización (o el reinicio forzado). ESTABLE. */
  ejecutar: (forzado: boolean) => void
  /** Retira el resumen (y con él el punto rojo). ESTABLE. */
  descartar: () => void
}

type Asignar<T> = Dispatch<SetStateAction<T>>

/** Los `set` del hook, en un objeto estable para los sub-hooks. */
interface Setters {
  setEstado: Asignar<EstadoAgentesNativos | null>
  setEnCurso: Asignar<FaseActualizacion | null>
  setAgenteEnCurso: Asignar<AgentKind | null>
  setForzadoEnCurso: Asignar<boolean>
  setEventos: Asignar<EventoActualizacion[]>
  setSalida: Asignar<string[]>
  setResumen: Asignar<ResumenActualizacion | null>
  setResumenVisto: Asignar<boolean>
  setComprobando: Asignar<boolean>
  setErrorComprobar: Asignar<string | null>
}

/** Los refs del hook, en un objeto estable para los sub-hooks. */
interface Refs {
  apis: MutableRefObject<Map<string, ApiAgentePane>>
  /** Verdad SÍNCRONA de «hay una ejecución en vuelo» (el estado llega un render tarde). */
  corriendo: MutableRefObject<boolean>
  comprobando: MutableRefObject<boolean>
  pendientes: MutableRefObject<string[]>
  volcado: MutableRefObject<ReturnType<typeof setTimeout> | null>
  /** Un hook desmontado no escribe estado: la ejecución puede seguir en vuelo. */
  montado: MutableRefObject<boolean>
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function useRefsActualizacion(): Refs {
  const apis = useRef(new Map<string, ApiAgentePane>())
  const corriendo = useRef(false)
  const comprobando = useRef(false)
  const pendientes = useRef<string[]>([])
  const volcado = useRef<ReturnType<typeof setTimeout> | null>(null)
  const montado = useRef(true)
  return useMemo(
    () => ({ apis, corriendo, comprobando, pendientes, volcado, montado }),
    [apis, corriendo, comprobando, pendientes, volcado, montado]
  )
}

/**
 * Suscripción a la foto y al progreso del main. La salida se acumula en un ref y se
 * vuelca como mucho cada `VOLCADO_MS`: un `setState` por línea renderizaría App cientos de veces.
 */
function useCanalAgentesNativos(set: Setters, refs: Refs): void {
  useEffect(() => {
    refs.montado.current = true
    let cancelado = false
    // Sin el canal (modo captura, arranque raro) el botón simplemente no tiene datos.
    window.tessera.agentesNativos
      .estado()
      .then((e) => {
        if (!cancelado) set.setEstado(e)
      })
      .catch(() => {})
    const offCambio = window.tessera.agentesNativos.onCambio((e) => set.setEstado(e))
    const volcar = (): void => {
      refs.volcado.current = null
      const nuevas = refs.pendientes.current
      if (nuevas.length === 0) return
      refs.pendientes.current = []
      set.setSalida((prev) => {
        const todo = [...prev, ...nuevas]
        return todo.length > TOPE_LINEAS ? todo.slice(-TOPE_LINEAS) : todo
      })
    }
    const offProgreso = window.tessera.agentesNativos.onProgreso((p) => {
      refs.pendientes.current.push(p.linea)
      // Tope también en el acumulado: una ráfaga enorme entre dos volcados no crece sin fin.
      if (refs.pendientes.current.length > TOPE_LINEAS) {
        refs.pendientes.current = refs.pendientes.current.slice(-TOPE_LINEAS)
      }
      if (refs.volcado.current === null) refs.volcado.current = setTimeout(volcar, VOLCADO_MS)
    })
    return () => {
      cancelado = true
      refs.montado.current = false
      offCambio()
      offProgreso()
      if (refs.volcado.current !== null) {
        clearTimeout(refs.volcado.current)
        refs.volcado.current = null
      }
    }
  }, [set, refs])
}

/** «Terminó sin revisar» (por clave de target) traducido a `sessionId` con la última foto. */
function useSinRevisar(
  estado: EstadoAgentesNativos | null,
  unseen: ReadonlySet<string>
): { sinRevisar: ReadonlySet<string>; sinRevisarRef: MutableRefObject<ReadonlySet<string>> } {
  const sinRevisar = useMemo((): ReadonlySet<string> => {
    const s = new Set<string>()
    if (!estado) return s
    for (const ses of estado.sesiones) {
      if (unseen.has(agentTargetKey(ses.profileId, ses.projectHostPath, ses.agente))) s.add(ses.sessionId)
    }
    return s
  }, [estado, unseen])
  const sinRevisarRef = useRef(sinRevisar)
  sinRevisarRef.current = sinRevisar
  return { sinRevisar, sinRevisarRef }
}

type Consultas = Pick<UseActualizacionNativa, 'registrarApi' | 'panes' | 'comprobar' | 'abrir' | 'cerrar'>

function useConsultas(set: Setters, refs: Refs): Consultas {
  const registrarApi = useCallback(
    (clave: string, api: ApiAgentePane | null): void => {
      if (api) refs.apis.current.set(clave, api)
      else refs.apis.current.delete(clave)
    },
    [refs]
  )
  const panes = useCallback((): readonly ApiAgentePane[] => [...refs.apis.current.values()], [refs])
  const comprobar = useCallback((): void => {
    if (refs.corriendo.current || refs.comprobando.current) return
    refs.comprobando.current = true
    set.setComprobando(true)
    set.setErrorComprobar(null)
    window.tessera.agentesNativos
      .comprobar()
      .then((e) => {
        if (refs.montado.current) set.setEstado(e)
      })
      .catch((e: unknown) => {
        if (refs.montado.current) set.setErrorComprobar(`No se pudieron comprobar las versiones: ${mensaje(e)}`)
      })
      .finally(() => {
        refs.comprobando.current = false
        if (refs.montado.current) set.setComprobando(false)
      })
  }, [set, refs])
  // Abrir DESPUÉS de terminar es ver el resultado; durante la ejecución, se decide al cerrar.
  const abrir = useCallback((): void => {
    if (!refs.corriendo.current) set.setResumenVisto(true)
    comprobar()
  }, [set, refs, comprobar])
  // Si terminó con el popover abierto, el usuario lo tuvo delante.
  const cerrar = useCallback((): void => {
    if (!refs.corriendo.current) set.setResumenVisto(true)
  }, [set, refs])
  return { registrarApi, panes, comprobar, abrir, cerrar }
}

/** Las dependencias reales del orquestador: el main por IPC y los panes registrados. */
function depsReales(set: Setters, refs: Refs): DepsActualizacion {
  return {
    plataforma: window.tessera.plataforma,
    comprobar: async () => {
      const e = await window.tessera.agentesNativos.comprobar()
      if (refs.montado.current) set.setEstado(e)
      return e
    },
    instalar: (req) => window.tessera.agentesNativos.instalar(req),
    detener: (ids) => window.tessera.agentTerminal.detenerVarias(ids),
    // En el MOMENTO de llamar: un pane que se monta o desmonta a mitad cuenta.
    panes: () => [...refs.apis.current.values()],
    onEvento: (ev) => {
      if (!refs.montado.current) return
      if (ev.tipo === 'fase') {
        set.setEnCurso(ev.fase)
        set.setAgenteEnCurso(ev.agente ?? null)
      }
      set.setEventos((prev) => [...prev, ev])
    }
  }
}

function lanzar(forzado: boolean, set: Setters, refs: Refs, sinRevisar: ReadonlySet<string>): void {
  void ejecutarActualizacion({ forzado, sinRevisar }, depsReales(set, refs))
    // `ejecutar` no rechaza nunca; si aun así pasara, cuenta como una ejecución que no hizo nada.
    .catch(
      (e: unknown): ResumenActualizacion => ({
        ok: false,
        abortado: `La actualización se interrumpió: ${mensaje(e)}`,
        instalaciones: [],
        sesiones: []
      })
    )
    .then((r) => {
      refs.corriendo.current = false
      if (!refs.montado.current) return
      set.setResumen(r)
      set.setEnCurso(null)
      set.setAgenteEnCurso(null)
    })
}

function useEjecucion(
  set: Setters,
  refs: Refs,
  sinRevisarRef: MutableRefObject<ReadonlySet<string>>
): Pick<UseActualizacionNativa, 'ejecutar' | 'descartar'> {
  const descartar = useCallback((): void => {
    if (refs.corriendo.current) return
    set.setResumen(null)
    set.setResumenVisto(false)
    set.setEventos([])
    set.setSalida([])
    set.setForzadoEnCurso(false)
  }, [set, refs])
  const ejecutar = useCallback(
    (forzado: boolean): void => {
      if (refs.corriendo.current) return
      refs.corriendo.current = true
      refs.pendientes.current = []
      set.setResumen(null)
      set.setResumenVisto(false)
      set.setEventos([])
      set.setSalida([])
      set.setForzadoEnCurso(forzado)
      set.setEnCurso('comprobando')
      set.setAgenteEnCurso(null)
      set.setErrorComprobar(null)
      lanzar(forzado, set, refs, sinRevisarRef.current)
    },
    [set, refs, sinRevisarRef]
  )
  return { ejecutar, descartar }
}

/**
 * Estado y acciones de la actualización de los agentes nativos.
 * @param unseen claves de target con un turno terminado que nadie ha mirado
 *   (`activity.unseen` de `useActividadAgentes`).
 */
export function useActualizacionNativa(unseen: ReadonlySet<string>): UseActualizacionNativa {
  const [estado, setEstado] = useState<EstadoAgentesNativos | null>(null)
  const [enCurso, setEnCurso] = useState<FaseActualizacion | null>(null)
  const [agenteEnCurso, setAgenteEnCurso] = useState<AgentKind | null>(null)
  const [forzadoEnCurso, setForzadoEnCurso] = useState(false)
  const [eventos, setEventos] = useState<EventoActualizacion[]>([])
  const [salida, setSalida] = useState<string[]>([])
  const [resumen, setResumen] = useState<ResumenActualizacion | null>(null)
  const [resumenVisto, setResumenVisto] = useState(false)
  const [comprobando, setComprobando] = useState(false)
  const [errorComprobar, setErrorComprobar] = useState<string | null>(null)
  const set = useMemo<Setters>(
    () => ({
      setEstado,
      setEnCurso,
      setAgenteEnCurso,
      setForzadoEnCurso,
      setEventos,
      setSalida,
      setResumen,
      setResumenVisto,
      setComprobando,
      setErrorComprobar
    }),
    []
  )
  const refs = useRefsActualizacion()
  useCanalAgentesNativos(set, refs)
  const { sinRevisar, sinRevisarRef } = useSinRevisar(estado, unseen)
  const plan = useMemo(() => (estado ? planificar(estado, { sinRevisar }) : null), [estado, sinRevisar])
  const planForzado = useMemo(
    () => (estado ? planificar(estado, { forzado: true, sinRevisar }) : null),
    [estado, sinRevisar]
  )
  const consultas = useConsultas(set, refs)
  const { ejecutar, descartar } = useEjecucion(set, refs, sinRevisarRef)
  return {
    estado,
    plan,
    planForzado,
    enCurso,
    agenteEnCurso,
    forzadoEnCurso,
    eventos,
    salida,
    resumen,
    resumenVisto,
    comprobando,
    errorComprobar,
    sinRevisar,
    ...consultas,
    ejecutar,
    descartar
  }
}
