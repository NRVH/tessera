// =============================================================================
// useAccionesPerfil: acciones del menú de un perfil que abren un diálogo o un selector:
// cambiar color, eliminar, hibernar, red del contenedor y reglas para los agentes (`useReglasPerfil`).
// Guarda qué diálogo está abierto y dónde se abre el selector de color. Lo llama `useBandaPerfiles`;
// depende del tipo `Profile` del main.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'
import type { TerminalesEnMarcha } from '../../../../shared/terminal-ipc'
import { useReglasPerfil, type AccionesReglas } from './useReglasPerfil'
import { decidirTrasConsulta, type ConfirmacionHibernar, type DecisionTrasConsulta } from './confirmaciones'
import type { EstadoPuntoPerfil } from './estadosPunto'

/** Perfil pendiente de confirmar la hibernación, con lo que el diálogo tiene que nombrar. */
export interface HibernacionPendiente {
  perfil: Perfil
  confirmacion: ConfirmacionHibernar
}

/** Cambio de red pendiente de confirmar: el modo se persiste al confirmar, no antes. */
export interface RedPendiente {
  perfil: Perfil
  redHost: boolean
  confirmacion: ConfirmacionHibernar
}

interface OpcionesAcciones {
  /** Los perfiles vivos: al volver una consulta se comprueba que el perfil siga existiendo. */
  perfiles?: Perfil[]
  /** Hibernación de cada perfil; ausente => activo. */
  estadosPunto?: Record<string, EstadoPuntoPerfil>
  /** ids de perfil con alguna sesión trabajando. */
  working?: Set<string>
  onCambiarColorPerfil: (perfilId: string, color: string) => void
  onAlternarRedHost: (perfilId: string, redHost: boolean) => void
  /** Abre el contexto de los agentes en las reglas del perfil. */
  onAbrirReglas: (perfilId: string) => void
  onEliminarPerfil: (perfilId: string) => void
  onHibernarPerfil: (perfilId: string) => void
}

/** El selector de color abierto: de qué perfil y dónde (bajo su pestaña). */
export interface SelectorColorAbierto {
  perfil: Perfil
  x: number
  y: number
}

export interface AccionesPerfil extends AccionesReglas {
  clavesSsh: string | null
  abrirClavesSsh: (perfil: string) => void
  cerrarClavesSsh: () => void
  eliminacionPendiente: Perfil | null
  hibernacionPendiente: HibernacionPendiente | null
  /** Perfil cuyo diálogo de red está abierto. */
  redModal: string | null
  /** Cambio de red que espera confirmación (corta un agente o lo que ejecuta una terminal). */
  cambiandoRed: RedPendiente | null
  selectorColor: SelectorColorAbierto | null
  abrirSelectorColor: (perfil: Perfil) => void
  cerrarSelectorColor: () => void
  pedirEliminar: (perfil: Perfil) => void
  pedirHibernacion: (perfil: Perfil) => void
  abrirRed: (perfilId: string) => void
  cerrarRed: () => void
  aplicarRed: (perfil: Perfil, redHost: boolean) => void
  elegirColor: (perfilId: string, color: string) => void
  confirmarHibernacion: () => void
  cancelarHibernacion: () => void
  confirmarRed: () => void
  cancelarRed: () => void
  confirmarEliminar: () => void
  cancelarEliminar: () => void
}

/** Ancho del selector de color (`.selector-color` en styles.css, igual que «Nuevo perfil»), para centrarlo bajo la pestaña. */
const ANCHO_SELECTOR = 300

/**
 * «Cambiar color» abre el selector bajo la pestaña del perfil, centrado en ella y sin salirse
 * de la ventana. Sin la pestaña a la vista (banda plegada) cae bajo el borde de arriba.
 */
function useSelectorColor(
  cerrarMenu: () => void,
  onCambiarColorPerfil: (perfilId: string, color: string) => void
): Pick<AccionesPerfil, 'selectorColor' | 'abrirSelectorColor' | 'cerrarSelectorColor' | 'elegirColor'> {
  const [selectorColor, setSelectorColor] = useState<SelectorColorAbierto | null>(null)
  return {
    selectorColor,
    abrirSelectorColor: (perfil) => {
      cerrarMenu()
      const pestana = document.querySelector<HTMLElement>(`.profile-tab[data-perfil-id="${CSS.escape(perfil.id)}"]`)
      const caja = pestana?.getBoundingClientRect()
      const centro = caja ? caja.left + caja.width / 2 : window.innerWidth / 2
      const x = Math.max(8, Math.min(window.innerWidth - ANCHO_SELECTOR - 8, centro - ANCHO_SELECTOR / 2))
      // Con la banda plegada la pestaña sigue en el DOM con unos px de alto: el tope de 40 lo
      // saca de debajo de la barra de título.
      setSelectorColor({ perfil, x, y: Math.max(caja?.bottom ?? 0, 40) + 6 })
    },
    cerrarSelectorColor: () => setSelectorColor(null),
    elegirColor: onCambiarColorPerfil
  }
}

/**
 * El diálogo de red y su confirmación. Se confirma ANTES de persistir: si se guardara el modo y
 * luego se preguntara, cancelar dejaría el perfil marcado con una red que su contenedor no tiene.
 */
function useCambioRed(
  consultar: Consultar,
  onAlternarRedHost: (perfilId: string, redHost: boolean) => void,
  onHibernarPerfil: (perfilId: string) => void
): Pick<AccionesPerfil, 'redModal' | 'cambiandoRed' | 'abrirRed' | 'cerrarRed' | 'aplicarRed' | 'confirmarRed' | 'cancelarRed'> {
  const [redModal, setRedModal] = useState<string | null>(null)
  const [cambiandoRed, setCambiandoRed] = useState<RedPendiente | null>(null)
  // Aplicar la red es reiniciar el contenedor: el perfil se hiberna con el modo nuevo, así que
  // pregunta con la misma regla que «Hibernar el perfil».
  const aplicar = (perfilId: string, redHost: boolean): void => {
    onAlternarRedHost(perfilId, redHost)
    onHibernarPerfil(perfilId)
  }
  return {
    redModal,
    cambiandoRed,
    abrirRed: setRedModal,
    cerrarRed: () => setRedModal(null),
    aplicarRed: (perfil, redHost) => {
      setRedModal(null)
      consultar(perfil.id, (decision) => {
        if (decision.tipo === 'nada') return
        // Un perfil ya hibernado no tiene qué cortar: el modo nuevo se guarda igual.
        if (decision.tipo === 'preguntar') setCambiandoRed({ perfil, redHost, confirmacion: decision.confirmacion })
        else aplicar(perfil.id, redHost)
      })
    },
    confirmarRed: () => {
      if (cambiandoRed) aplicar(cambiandoRed.perfil.id, cambiandoRed.redHost)
      setCambiandoRed(null)
    },
    cancelarRed: () => setCambiandoRed(null)
  }
}

/** Las terminales del perfil y cuántas ejecutan algo; null si el main no contestó. */
async function terminalesDe(perfilId: string): Promise<TerminalesEnMarcha | null> {
  try {
    return await window.tessera.terminal.enMarcha(perfilId)
  } catch (err) {
    console.error('[perfil] terminal.enMarcha falló:', err)
    return null
  }
}

type Consultar = (perfilId: string, alVolver: (decision: DecisionTrasConsulta) => void) => void

/**
 * Mira qué cortaría hibernar un perfil. La consulta tarda (hasta unos segundos en Windows): el
 * cursor lo dice, un segundo gesto sobre el mismo perfil se ignora y, al volver, se decide con el
 * estado de ese momento (perfil borrado, ya hibernado, agente que empezó a trabajar) y no con el
 * de la pulsación.
 */
function useConsultaPerfil({ perfiles, estadosPunto, working }: OpcionesAcciones): Consultar {
  const vivo = useRef({ perfiles, estadosPunto, working })
  useEffect(() => {
    vivo.current = { perfiles, estadosPunto, working }
  })
  const enVuelo = useRef(new Set<string>())
  const [cuantas, setCuantas] = useState(0)
  useEffect(() => {
    document.body.classList.toggle('consultando-perfil', cuantas > 0)
    return () => document.body.classList.remove('consultando-perfil')
  }, [cuantas])
  return (perfilId, alVolver) => {
    if (enVuelo.current.has(perfilId)) return
    enVuelo.current.add(perfilId)
    setCuantas(enVuelo.current.size)
    void terminalesDe(perfilId).then((terminales) => {
      enVuelo.current.delete(perfilId)
      setCuantas(enVuelo.current.size)
      const { perfiles, estadosPunto: estados, working: trabajando } = vivo.current
      const estado = estados?.[perfilId]
      alVolver(
        decidirTrasConsulta(
          {
            existe: perfiles?.some((p) => p.id === perfilId) === true,
            hibernado: estado === 'hibernated' || estado === 'hibernating',
            trabajando: trabajando?.has(perfilId) === true
          },
          terminales
        )
      )
    })
  }
}

/** Estado de los diálogos de perfil (eliminar, hibernar, red, reglas) y del selector de color. */
export function useAccionesPerfil(opciones: OpcionesAcciones, cerrarMenu: () => void): AccionesPerfil {
  const [clavesSsh, fijarClavesSsh] = useState<string | null>(null)
  const { onCambiarColorPerfil, onAlternarRedHost, onAbrirReglas, onEliminarPerfil, onHibernarPerfil } = opciones
  const [eliminacionPendiente, setEliminacionPendiente] = useState<Perfil | null>(null)
  const [hibernacionPendiente, setHibernacionPendiente] = useState<HibernacionPendiente | null>(null)
  const consultar = useConsultaPerfil(opciones)
  const red = useCambioRed(consultar, onAlternarRedHost, onHibernarPerfil)
  const reglas = useReglasPerfil(onAbrirReglas)
  const selectorColor = useSelectorColor(cerrarMenu, onCambiarColorPerfil)

  // Hibernar mata los ptys del perfil: se pregunta si se corta algo (un agente trabajando o una
  // terminal que ejecuta algo, `confirmaciones.ts`); si no, se ejecuta directo.
  function pedirHibernacion(perfil: Perfil): void {
    cerrarMenu()
    consultar(perfil.id, (decision) => {
      if (decision.tipo === 'preguntar') setHibernacionPendiente({ perfil, confirmacion: decision.confirmacion })
      else if (decision.tipo === 'ejecutar') onHibernarPerfil(perfil.id)
    })
  }

  function confirmarHibernacion(): void {
    if (!hibernacionPendiente) return
    onHibernarPerfil(hibernacionPendiente.perfil.id)
    setHibernacionPendiente(null)
  }

  function confirmarEliminar(): void {
    if (!eliminacionPendiente) return
    onEliminarPerfil(eliminacionPendiente.id)
    setEliminacionPendiente(null)
  }

  return {
    ...selectorColor,
    clavesSsh,
    abrirClavesSsh: (perfil) => { cerrarMenu(); fijarClavesSsh(perfil) },
    cerrarClavesSsh: () => fijarClavesSsh(null),
    ...red,
    eliminacionPendiente,
    hibernacionPendiente,
    ...reglas,
    pedirEliminar: (perfil) => {
      cerrarMenu()
      setEliminacionPendiente(perfil)
    },
    pedirHibernacion,
    confirmarHibernacion,
    cancelarHibernacion: () => setHibernacionPendiente(null),
    confirmarEliminar,
    cancelarEliminar: () => setEliminacionPendiente(null)
  }
}
