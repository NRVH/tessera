// =============================================================================
// Sondeo del uso de una cuenta y sus avisos de actualización.
// Combina los avisos de fin de turno con una lectura periódica de respaldo.
// La identidad y la generación impiden publicar respuestas de una cuenta anterior.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { usageKey, type UsageRunMode, type UsageSnapshot } from '../../../../shared/usage-ipc'
import type { ConvAgent } from '../../../../shared/conversations-ipc'
export interface ConsultaUso {
  agente: ConvAgent
  accountId: string | null
  mode: UsageRunMode
  enabled: boolean
}

/**
 * Sondeo de RESPALDO: lo bueno es el aviso `onChanged` del main al terminar un turno.
 * El reloj cubre el consumo hecho desde otra máquina o fuera de Tessera y las ventanas
 * que se reinician solas, así que va holgado: en claude-code es una llamada de red con
 * límite por token; en codex, leer la cola de un fichero.
 */
export const POLL_MS: Record<ConvAgent, number> = {
  'claude-code': 180_000,
  codex: 30_000
}

type RefrescarUso = (force?: boolean) => Promise<void>

/** Consulta del uso: al activarse, en bucle de respaldo y al avisar el main de fin de turno. */
export function useSondeoUso({ agente, accountId, mode, enabled }: ConsultaUso): {
  snap: UsageSnapshot | null
  refresh: RefrescarUso
} {
  const clave = usageKey({ agente, accountId: accountId ?? '', mode })
  const [lectura, setLectura] = useState<{ clave: string; snap: UsageSnapshot | null } | null>(null)
  const generacion = useRef(0)
  // Sondeo en vuelo: evita solaparlos (una consulta lenta + un tick = dos fetch).
  const inFlightRef = useRef(false)

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      if (!enabled || inFlightRef.current) return
      if (mode !== 'host' && !accountId) return
      inFlightRef.current = true
      const turno = generacion.current
      try {
        const s = await window.tessera.usage.get({
          agente,
          accountId: accountId ?? '',
          mode,
          force
        })
        if (turno === generacion.current) setLectura({ clave, snap: s })
      } catch {
        if (turno === generacion.current) setLectura({ clave, snap: null })
      } finally {
        if (turno === generacion.current) inFlightRef.current = false
      }
    },
    [agente, accountId, mode, enabled, clave]
  )

  // El main cachea con TTL: un tick de más devuelve lo cacheado, no genera tráfico.
  useEffect(() => {
    if (!enabled) return
    const turno = generacion.current
    void refresh()
    const id = setInterval(() => void refresh(), POLL_MS[agente])
    return () => { clearInterval(id); generacion.current = turno + 1; inFlightRef.current = false }
  }, [refresh, enabled, agente])

  // El aviso de fin de turno llega a TODOS los paneles; cada uno se queda con el de SU
  // cuenta (dos proyectos con la misma cuenta comparten uso y ambos se refrescan).
  useEffect(() => {
    if (!enabled) return
    if (mode !== 'host' && !accountId) return
    const req = { agente, accountId: accountId ?? '', mode }
    const mine = usageKey(req)
    void window.tessera.usage.watch(req)
    const off = window.tessera.usage.onChanged((c) => {
      if (c.key === mine) void refresh(true)
    })
    return () => {
      off()
      void window.tessera.usage.unwatch(req)
    }
  }, [agente, accountId, mode, enabled, refresh])

  return { snap: lectura?.clave === clave ? lectura.snap : null, refresh }
}

