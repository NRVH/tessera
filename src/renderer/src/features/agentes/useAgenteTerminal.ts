// =============================================================================
// El agente de la terminal de cada perfil: pide al main sus carpetas para reconocerlas, lo prepara
// bajo demanda (siempre en modo nativo), lo muestra u oculta a pantalla completa o en la franja
// desacoplada (el conmutador de la barra de estado y Ctrl+Alt+B / ⌥⌘B), lo restaura con la preferencia
// puesta y lo cierra. Calca `features/bd/useEspaciosDatos.ts`; el estado vive en
// `storeAgenteTerminal.ts`.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { notifyError } from '../../comun/notificaciones'
import { txSesion } from './textosSesion.ts'
import { agenteVisibleEnFranja, useStoreVentanasFranja } from '../layout'
import type { UsePestanas } from '../pestanas'
import {
  abrirAgenteTerminal,
  cerrarAgenteTerminal,
  fijarRutasAgenteTerminal,
  ocultarAgenteTerminal,
  podarAgenteTerminal,
  useStoreAgenteTerminal
} from './storeAgenteTerminal'

type Perfil = { id: string; nombre: string }

/** Lo que la ventana usa del agente de la terminal. */
export interface AgenteTerminalApp {
  /** El del perfil activo está pedido: el conmutador de la barra de estado, pulsado. */
  visible: boolean
  /** Carpetas del agente de la terminal (una por perfil), con identidad estable. */
  conjuntoRutas: ReadonlySet<string>
  /** ¿Es la carpeta del agente de la terminal de algún perfil? Su modo no se puede cambiar. */
  esCarpetaAgenteTerminal: (rutaHostProyecto: string) => boolean
  /** Muestra (preparándolo si hace falta, y con el teclado) u oculta sin cerrar el del perfil indicado (o el activo). Estable. */
  alternar: (perfilId?: string) => void
  /** Cierra el de un perfil: su pane se desmonta y su sesión se cierra. Estable. */
  cerrar: (perfilId: string) => void
  /** Prepara la carpeta de un perfil (la crea el main y la fuerza a nativo); su ruta, o null si falla con aviso. */
  asegurar: (perfil: Perfil) => Promise<string | null>
  /** Perfiles con una preparación en vuelo: no se lanza dos veces. */
  preparandoRef: { current: Set<string> }
}

/** Pide al main la carpeta de cada perfil, sin crearla, y olvida lo de los perfiles que ya no existen. */
function useRutasAgenteTerminal(pestanas: UsePestanas): void {
  const claveIdsPerfil = pestanas.perfiles.map((p) => p.id).join('|')
  useEffect(() => {
    const ids = claveIdsPerfil ? claveIdsPerfil.split('|') : []
    if (ids.length === 0) return
    podarAgenteTerminal(ids)
    let vivo = true
    void window.tessera.ssh
      .rutasEspacio({ profileIds: ids })
      .then((mapa) => {
        if (vivo) fijarRutasAgenteTerminal(mapa)
      })
      .catch(() => {
        // Sin este mapa el agente sigue funcionando; solo se pierde el bloqueo de su modo hasta prepararlo.
      })
    return () => {
      vivo = false
    }
  }, [claveIdsPerfil])
}

/** La carpeta la crea el main; se fuerza a nativo porque es el modo en que vive (cuenta personal, `tssh`). */
async function asegurarAgenteTerminal(perfil: Perfil): Promise<string | null> {
  try {
    const ref = await window.tessera.ssh.asegurarEspacio({ profileId: perfil.id })
    return ref.projectHostPath
  } catch (err) {
    console.error('[agente-terminal] no se pudo preparar el agente de la terminal:', err)
    notifyError(txSesion().noSePudoPrepararAgenteTerminal, err)
    return null
  }
}

/** El agente de la terminal de la ventana: carpetas, preparación, mostrar u ocultar y cerrar. */
export function useAgenteTerminal(pestanas: UsePestanas): AgenteTerminalApp {
  const perfilId = pestanas.perfilActivo?.id ?? null
  const visible = useStoreAgenteTerminal((s) => perfilId !== null && s.visiblePorPerfil[perfilId] === true)
  const rutas = useStoreAgenteTerminal((s) => s.rutas)
  const conjuntoRutas = useMemo(() => new Set(Object.values(rutas)), [rutas])
  const esCarpetaAgenteTerminal = useCallback((rutaHostProyecto: string) => conjuntoRutas.has(rutaHostProyecto), [conjuntoRutas])
  useRutasAgenteTerminal(pestanas)
  const perfilActivoRef = useRef(pestanas.perfilActivo)
  perfilActivoRef.current = pestanas.perfilActivo
  const perfilesRef = useRef(pestanas.perfiles)
  perfilesRef.current = pestanas.perfiles
  const preparandoRef = useRef(new Set<string>())
  // Mostrar = preparar y, SOLO si sale bien, marcarlo visible: un fallo no deja la preferencia puesta.
  const alternar = useCallback((perfilObjetivo?: string) => {
    const perfil =
      typeof perfilObjetivo === 'string'
        ? perfilesRef.current.find((p) => p.id === perfilObjetivo) ?? null
        : perfilActivoRef.current
    if (!perfil) return
    const s = useStoreAgenteTerminal.getState()
    const ruta = s.rutas[perfil.id]
    if (s.visiblePorPerfil[perfil.id] === true) {
      ocultarAgenteTerminal(perfil.id)
    } else if (ruta !== undefined && s.abiertos.has(perfil.id)) {
      // Ya preparado y solo oculto: se enseña sin volver al main (su sesión sigue viva).
      abrirAgenteTerminal(perfil.id, ruta, true)
    } else if (!preparandoRef.current.has(perfil.id)) {
      preparandoRef.current.add(perfil.id)
      void asegurarAgenteTerminal(perfil).then((preparada) => {
        preparandoRef.current.delete(perfil.id)
        if (preparada !== null) abrirAgenteTerminal(perfil.id, preparada, true)
      })
    }
  }, [])
  return {
    visible,
    conjuntoRutas,
    esCarpetaAgenteTerminal,
    alternar,
    cerrar: cerrarAgenteTerminal,
    asegurar: asegurarAgenteTerminal,
    preparandoRef
  }
}

/**
 * Restaura los agentes pedidos que pueden verse en la principal o en una hija, sin mover el foco.
 * Si falla la preparación, retira la preferencia del perfil.
 */
export function useRestaurarAgenteTerminal(perfiles: readonly Perfil[], perfilPrincipal: string | null, api: AgenteTerminalApp): void {
  const { pedidos, abiertos } = useStoreAgenteTerminal(
    useShallow((s) => ({ pedidos: s.visiblePorPerfil, abiertos: s.abiertos }))
  )
  const hijasConAgentePedido = useStoreVentanasFranja(useShallow(({ anchos, compactaPorPerfil }) =>
    new Set([...anchos].filter(([id, ancho]) =>
      agenteVisibleEnFranja(pedidos[id] === true, Boolean(compactaPorPerfil[id]), ancho)
    ).map(([id]) => id))
  ))
  const { asegurar, preparandoRef } = api
  useEffect(() => {
    for (const perfil of perfiles) {
      const { id } = perfil
      if (!(hijasConAgentePedido.has(id) || (id === perfilPrincipal && pedidos[id] === true))) continue
      if (abiertos.has(id) || preparandoRef.current.has(id)) continue
      preparandoRef.current.add(id)
      void asegurar(perfil).then((ruta) => {
        preparandoRef.current.delete(id)
        if (ruta === null) ocultarAgenteTerminal(id)
        else abrirAgenteTerminal(id, ruta, false)
      })
    }
  }, [perfiles, perfilPrincipal, hijasConAgentePedido, pedidos, abiertos, asegurar, preparandoRef])
}
