// =============================================================================
// Estado y acciones del bloque «Tessera» de la categoría Actualizaciones: el
// `UpdateState` real del main (getState + onState), la simulación de desarrollo y
// las acciones de comprobar, instalar y descartar avisos.
// Los avisos no se descartan al desmontar el bloque: ver
// docs/decisiones/renderer/actualizaciones-de-la-app.md.
// =============================================================================

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { UpdateState, UpdateStatus } from '../../../../../../shared/update-ipc'
import { useAhora } from '../../../../comun/useAhora'
import { TICK_ULTIMO_CHEQUEO_MS, useEstadoUpdate } from '../../../actualizaciones'
import { estadoDeEscena, pasosDelCiclo, semillaUpdate, type Escena } from './escenasUpdate'

type Temporizadores = MutableRefObject<ReturnType<typeof setTimeout>[]>

/** Todo lo que el bloque necesita para pintarse y actuar. */
export interface UpdateAjustes {
  state: UpdateState | null
  status: UpdateStatus
  busy: boolean
  version: string
  ahora: number
  isDev: boolean
  check: () => void
  install: () => void
  descartar: (que: 'aplicada' | 'fallo') => void
  devPreview: (escena: Escena) => void
}

function limpiar(timers: Temporizadores): void {
  for (const t of timers.current) clearTimeout(t)
}

/** Estado real del main; al desmontar también cancela los temporizadores de la simulación. */
function useUpdateReal(timers: Temporizadores): UpdateState | null {
  const real = useEstadoUpdate()
  useEffect(() => () => limpiar(timers), [timers])
  return real
}

/** 'disabled' se pinta como 'idle', pero no se fuerza por estar en dev: el estado simulado del main es real. */
function estadoPintado(preview: UpdateState | null, state: UpdateState | null): UpdateStatus {
  const statusReal = state?.status ?? 'idle'
  return preview ? preview.status : statusReal === 'disabled' ? 'idle' : statusReal
}

/** Estado y acciones del bloque de actualización de Tessera (real, o simulado en desarrollo). */
export function useUpdateAjustes(): UpdateAjustes {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [preview, setPreview] = useState<UpdateState | null>(null)
  const real = useUpdateReal(timers)
  const ahora = useAhora(TICK_ULTIMO_CHEQUEO_MS)

  // Se pregunta a Vite y no al estado del updater: con `TESSERA_FAKE_UPDATE` el main
  // simula el ciclo y el estado deja de ser 'disabled', pero el selector de escenas debe verse.
  const isDev = import.meta.env.DEV
  const state = preview ?? real
  const status = estadoPintado(preview, state)
  const busy = status === 'checking' || status === 'downloading' || status === 'installing'
  const version = state?.currentVersion ?? '—'

  function devPreview(escena: Escena): void {
    limpiar(timers)
    timers.current = []
    const seed = semillaUpdate(real?.currentVersion ?? '0.0.0')
    const fijo = estadoDeEscena(escena, seed)
    if (fijo) {
      setPreview(fijo)
      return
    }
    setPreview(seed)
    for (const { retardo, estado } of pasosDelCiclo(seed)) {
      timers.current.push(setTimeout(() => setPreview(estado), retardo))
    }
  }

  function check(): void {
    if (isDev) {
      devPreview('ciclo')
      return
    }
    void window.tessera.update.check()
  }

  function install(): void {
    if (preview) {
      // En `available` el main real abre el navegador y se queda en `available`:
      // simular «Instalando…» enseñaría un estado que esa copia no tiene.
      if (preview.status === 'available') return
      setPreview({ ...preview, status: 'installing' })
      timers.current.push(setTimeout(() => setPreview(null), 1400))
      return
    }
    void window.tessera.update.install()
  }

  function descartar(que: 'aplicada' | 'fallo'): void {
    if (preview) {
      setPreview({ ...preview, avisoAplicada: null, avisoFallo: null })
      return
    }
    void window.tessera.update.dismiss(que)
  }

  return { state, status, busy, version, ahora, isDev, check, install, descartar, devPreview }
}
