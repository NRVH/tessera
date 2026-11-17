// =============================================================================
// Store del agente de la terminal: la carpeta de cada perfil (la da el main), qué perfiles lo tienen
// preparado, la preferencia de verlo a pantalla completa (persistida), su agente elegido (propio, no
// el del perfil) y la bandera de UN commit con la que un gesto del usuario le lleva el teclado.
// Los efectos viven en `useAgenteTerminal.ts`; la preferencia la guarda `usePersistenciaAjustes`.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { create } from 'zustand'
import type { IdAgente } from '../../../../shared/agentesManuales'
import {
  conAgenteTerminalVisible,
  podarMapaPorPerfil,
  type AgenteTerminalVisiblePorPerfil
} from '../../../../shared/ajustesTerminal'
import { fijarMaximizado } from '../layout'

/** Estado del agente de la terminal de todos los perfiles. */
export interface EstadoAgenteTerminal {
  /** Carpeta `<userData>/terminal/<perfil>` de cada perfil, sin crear: sirve para reconocerla. */
  rutas: Record<string, string>
  /** Perfiles con el agente de la terminal preparado: solo sus targets se montan en la columna. */
  abiertos: ReadonlySet<string>
  /** Preferencia persistida: el usuario lo quiere ver a pantalla completa. Sin entrada = oculto. */
  visiblePorPerfil: AgenteTerminalVisiblePorPerfil
  /** Agente elegido en su cabecera; sin entrada, o si ya no está, el primero disponible. No es el del perfil. */
  agentePorPerfil: Record<string, IdAgente>
  /**
   * Durante UN commit: el usuario lo pidió (mostrarlo, cambiar de agente) y su pane se lleva el
   * teclado. Fuera de ese commit nunca lo roba: entrar o salir de pantalla completa no mueve el foco.
   */
  focoPedido: boolean
}

/** Estado del agente de la terminal. */
export const useStoreAgenteTerminal = create<EstadoAgenteTerminal>()(() => ({
  rutas: {},
  abiertos: new Set(),
  visiblePorPerfil: {},
  agentePorPerfil: {},
  focoPedido: false
}))

/** Elige el agente del agente de la terminal de un perfil; el nuevo se lleva el teclado. */
export function elegirAgenteTerminal(perfilId: string, agente: IdAgente): void {
  useStoreAgenteTerminal.setState((s) =>
    s.agentePorPerfil[perfilId] === agente
      ? s
      : { agentePorPerfil: { ...s.agentePorPerfil, [perfilId]: agente }, focoPedido: true }
  )
}

/** Las carpetas que dio el main; mismo objeto si no cambia nada. */
export function fijarRutasAgenteTerminal(rutas: Record<string, string>): void {
  useStoreAgenteTerminal.setState((s) =>
    Object.keys(rutas).every((id) => s.rutas[id] === rutas[id]) ? s : { rutas: { ...s.rutas, ...rutas } }
  )
}

/** Con la carpeta ya preparada: lo marca abierto y, si `mostrar`, lo enseña llevándose el teclado. */
export function abrirAgenteTerminal(perfilId: string, ruta: string, mostrar: boolean): void {
  useStoreAgenteTerminal.setState((s) => {
    const abiertos = s.abiertos.has(perfilId) ? s.abiertos : new Set(s.abiertos).add(perfilId)
    const rutas = s.rutas[perfilId] === ruta ? s.rutas : { ...s.rutas, [perfilId]: ruta }
    const visiblePorPerfil = mostrar ? conAgenteTerminalVisible(s.visiblePorPerfil, perfilId, true) : s.visiblePorPerfil
    const focoPedido = mostrar || s.focoPedido
    const igual = abiertos === s.abiertos && rutas === s.rutas && visiblePorPerfil === s.visiblePorPerfil && focoPedido === s.focoPedido
    return igual ? s : { abiertos, rutas, visiblePorPerfil, focoPedido }
  })
}

/** Lo oculta sin cerrarlo: su sesión sigue viva. */
export function ocultarAgenteTerminal(perfilId: string): void {
  useStoreAgenteTerminal.setState((s) => {
    const visiblePorPerfil = conAgenteTerminalVisible(s.visiblePorPerfil, perfilId, false)
    return visiblePorPerfil === s.visiblePorPerfil ? s : { visiblePorPerfil }
  })
}

/** Lo cierra: oculto y fuera de los abiertos, así su pane se desmonta y su sesión se cierra. */
export function cerrarAgenteTerminal(perfilId: string): void {
  // Cerrar termina la sesión: el siguiente agente arranca sin maximizar.
  fijarMaximizado('agenteTerminal', false, perfilId)
  useStoreAgenteTerminal.setState((s) => {
    if (!s.abiertos.has(perfilId) && s.visiblePorPerfil[perfilId] !== true) return s
    const abiertos = new Set(s.abiertos)
    abiertos.delete(perfilId)
    return { abiertos, visiblePorPerfil: conAgenteTerminalVisible(s.visiblePorPerfil, perfilId, false) }
  })
}

/** Suelta la bandera del foco tras el commit en que la leyeron los panes. */
export function soltarFocoAgenteTerminal(): void {
  useStoreAgenteTerminal.setState((s) => (s.focoPedido ? { focoPedido: false } : s))
}

/** Olvida los perfiles que ya no existen (nunca con una lista vacía: aún no se sabe cuáles sobran). */
export function podarAgenteTerminal(perfilesVivos: readonly string[]): void {
  if (perfilesVivos.length === 0) return
  useStoreAgenteTerminal.setState((s) => {
    const vivos = new Set(perfilesVivos)
    const abiertos = [...s.abiertos].every((id) => vivos.has(id)) ? s.abiertos : new Set([...s.abiertos].filter((id) => vivos.has(id)))
    const cambios = {
      rutas: podarMapaPorPerfil(s.rutas, perfilesVivos),
      visiblePorPerfil: podarMapaPorPerfil(s.visiblePorPerfil, perfilesVivos),
      agentePorPerfil: podarMapaPorPerfil(s.agentePorPerfil, perfilesVivos),
      abiertos
    }
    const igual =
      cambios.rutas === s.rutas &&
      cambios.visiblePorPerfil === s.visiblePorPerfil &&
      cambios.agentePorPerfil === s.agentePorPerfil &&
      abiertos === s.abiertos
    return igual ? s : cambios
  })
}
