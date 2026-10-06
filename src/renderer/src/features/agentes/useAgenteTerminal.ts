// =============================================================================
// El agente de la terminal de cada perfil: pide al main sus carpetas para reconocerlas, lo prepara
// bajo demanda (siempre en modo nativo), lo muestra u oculta a pantalla completa de la terminal (el
// conmutador de la barra de estado y Ctrl+Alt+B / ⌥⌘B), lo restaura al entrar con la preferencia
// puesta y lo cierra. Calca `features/bd/useEspaciosDatos.ts`; el estado vive en
// `storeAgenteTerminal.ts`.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { notifyError } from '../../comun/notifications'
import { asegurarModoNativo, type UseTabs } from '../pestanas'
import { editorTargetKey } from '../editor'
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
  rutasSet: ReadonlySet<string>
  /** ¿Es la carpeta del agente de la terminal de algún perfil? Su modo no se puede cambiar. */
  esCarpetaAgenteTerminal: (projectHostPath: string) => boolean
  /** Muestra (preparándolo si hace falta, y con el teclado) u oculta sin cerrar el del perfil activo. Estable. */
  alternar: () => void
  /** Cierra el de un perfil: su pane se desmonta y su sesión se cierra. Estable. */
  cerrar: (profileId: string) => void
  /** Prepara la carpeta de un perfil (la crea el main y la fuerza a nativo); su ruta, o null si falla con aviso. */
  asegurar: (perfil: Perfil) => Promise<string | null>
  /** Perfiles con una preparación en vuelo: no se lanza dos veces. */
  preparandoRef: { current: Set<string> }
}

/** Pide al main la carpeta de cada perfil, sin crearla, y olvida lo de los perfiles que ya no existen. */
function useRutasAgenteTerminal(tabs: UseTabs): void {
  const profileIdsKey = tabs.profiles.map((p) => p.id).join('|')
  useEffect(() => {
    const ids = profileIdsKey ? profileIdsKey.split('|') : []
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
  }, [profileIdsKey])
}

/** La carpeta la crea el main; se fuerza a nativo porque es el modo en que vive (cuenta personal, `tssh`). */
async function asegurarAgenteTerminal(perfil: Perfil): Promise<string | null> {
  try {
    const ref = await window.tessera.ssh.asegurarEspacio({ profileId: perfil.id })
    asegurarModoNativo(editorTargetKey(perfil.id, ref.projectHostPath))
    return ref.projectHostPath
  } catch (err) {
    console.error('[agente-terminal] no se pudo preparar el agente de la terminal:', err)
    notifyError('No se pudo preparar el agente de la terminal', err)
    return null
  }
}

/** El agente de la terminal de la ventana: carpetas, preparación, mostrar u ocultar y cerrar. */
export function useAgenteTerminal(tabs: UseTabs): AgenteTerminalApp {
  const perfilId = tabs.activeProfile?.id ?? null
  const visible = useStoreAgenteTerminal((s) => perfilId !== null && s.visiblePorPerfil[perfilId] === true)
  const rutas = useStoreAgenteTerminal((s) => s.rutas)
  const rutasSet = useMemo(() => new Set(Object.values(rutas)), [rutas])
  const esCarpetaAgenteTerminal = useCallback((projectHostPath: string) => rutasSet.has(projectHostPath), [rutasSet])
  useRutasAgenteTerminal(tabs)
  const perfilActivoRef = useRef(tabs.activeProfile)
  perfilActivoRef.current = tabs.activeProfile
  const preparandoRef = useRef(new Set<string>())
  // Mostrar = preparar y, SOLO si sale bien, marcarlo visible: un fallo no deja la preferencia puesta.
  const alternar = useCallback(() => {
    const perfil = perfilActivoRef.current
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
    rutasSet,
    esCarpetaAgenteTerminal,
    alternar,
    cerrar: cerrarAgenteTerminal,
    asegurar: asegurarAgenteTerminal,
    preparandoRef
  }
}

/**
 * Al entrar en la terminal a pantalla completa con la preferencia puesta y el agente sin preparar (tras
 * reiniciar la app), lo prepara sin enseñarlo con el teclado; si falla, retira la preferencia.
 */
export function useRestaurarAgenteTerminal(perfil: Perfil | null, pantallaCompletaTerminal: boolean, api: AgenteTerminalApp): void {
  const id = perfil?.id ?? null
  const pedido = useStoreAgenteTerminal((s) => id !== null && s.visiblePorPerfil[id] === true)
  const abierto = useStoreAgenteTerminal((s) => id !== null && s.abiertos.has(id))
  const { asegurar, preparandoRef } = api
  const perfilRef = useRef(perfil)
  perfilRef.current = perfil
  useEffect(() => {
    const p = perfilRef.current
    if (!pantallaCompletaTerminal || !p || !pedido || abierto) return
    if (preparandoRef.current.has(p.id)) return
    preparandoRef.current.add(p.id)
    void asegurar(p).then((ruta) => {
      preparandoRef.current.delete(p.id)
      if (ruta === null) ocultarAgenteTerminal(p.id)
      else abrirAgenteTerminal(p.id, ruta, false)
    })
  }, [pantallaCompletaTerminal, id, pedido, abierto, asegurar, preparandoRef])
}
