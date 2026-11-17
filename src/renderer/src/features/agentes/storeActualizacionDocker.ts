// =============================================================================
// Estado de la actualización de los agentes en Docker: sobrevive al popover, porque reconstruir la imagen tarda minutos
// y su resultado tiene que seguir a la vista al volver a abrirlo.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================
import { useEffect } from 'react'
import { create } from 'zustand'
import type { EstadoAgentesDocker } from '../../../../shared/agents-update-ipc'
import { anadirConTope, necesitaConfirmar, type ModoActualizacion, type ResultadoDocker } from './modeloActualizacionDocker'

interface EstadoStore {
  estado: EstadoAgentesDocker | null
  corriendo: boolean
  lineas: string[]
  resultado: ResultadoDocker | null
  resultadoVisto: boolean
  /** La acción que espera confirmación porque cortaría algo en curso. */
  confirmando: ModoActualizacion | null
}

export const useStoreActualizacionDocker = create<EstadoStore>()(() => ({
  estado: null,
  corriendo: false,
  lineas: [],
  resultado: null,
  resultadoVisto: true,
  confirmando: null
}))

const store = useStoreActualizacionDocker
let enVuelo: Promise<void> | null = null
let generacion = 0

export function refrescarDocker(): Promise<void> {
  enVuelo ??= window.tessera.actualizacionAgentes
    .estado()
    .then((estado) => store.setState({ estado }))
    .catch((err: unknown) => console.error('[agentes] no se pudo leer el estado de Docker:', err))
    .finally(() => {
      enVuelo = null
    })
  return enVuelo
}

/** ¿Se puede lanzar ya? Con datos frescos: si cortaría algo en curso, deja pendiente la confirmación. */
export async function solicitarActualizacionDocker(modo: ModoActualizacion): Promise<boolean> {
  const peticion = generacion
  await refrescarDocker()
  // Se canceló o se cerró el popover mientras se comprobaba: nadie está ya pidiendo esto.
  if (peticion !== generacion) return false
  const { estado } = store.getState()
  if (estado && necesitaConfirmar(estado)) {
    store.setState({ confirmando: modo })
    return false
  }
  return true
}

export function cancelarConfirmacionDocker(): void {
  generacion++
  store.setState({ confirmando: null })
}

export function marcarResultadoDockerVisto(): void {
  if (!store.getState().corriendo) store.setState({ resultadoVisto: true })
}

/** Al cerrar: un resultado bueno ya visto se retira para volver a enseñar las versiones. Un fallo se queda hasta descartarlo. */
export function retirarResultadoDockerVisto(): void {
  const { corriendo, resultado, resultadoVisto } = store.getState()
  if (!corriendo && resultado?.ok && resultadoVisto) store.setState({ resultado: null, lineas: [] })
}

export function descartarResultadoDocker(): void {
  store.setState({ resultado: null, lineas: [] })
}

export async function ejecutarActualizacionDocker(): Promise<void> {
  const { corriendo, estado } = store.getState()
  if (corriendo) return
  const actualizados = { claude: estado?.claude.hayNueva ?? false, codex: estado?.codex.hayNueva ?? false }
  store.setState({ corriendo: true, lineas: [], resultado: null, confirmando: null, resultadoVisto: false })
  const dejar = window.tessera.actualizacionAgentes.alProgreso((p) => store.setState((s) => ({ lineas: anadirConTope(s.lineas, p.line) })))
  let resultado: ResultadoDocker
  try {
    const r = await window.tessera.actualizacionAgentes.actualizar()
    resultado = { ok: r.ok, error: r.error ?? null, actualizados }
  } catch (err) {
    resultado = { ok: false, error: err instanceof Error ? err.message : String(err), actualizados }
  } finally {
    dejar()
  }
  store.setState({ corriendo: false, resultado })
  await refrescarDocker()
}

/** Comprueba con la misma cadencia que los agentes del equipo y cuando Docker cambia de disponibilidad. */
export function useVigilarActualizacionDocker(ultimaComprobacion: number | null): void {
  useEffect(() => {
    if (ultimaComprobacion !== null) void refrescarDocker()
  }, [ultimaComprobacion])
  useEffect(
    () =>
      window.tessera.estadoDocker.alCambiar((estado) => {
        if (estado !== 'iniciando') void refrescarDocker()
      }),
    []
  )
}
