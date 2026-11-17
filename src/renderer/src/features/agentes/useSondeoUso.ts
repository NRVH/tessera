// =============================================================================
// Sondeo del uso de una cuenta y sus avisos de actualización.
// Combina los avisos de fin de turno con una lectura periódica de respaldo.
// La identidad y la generación impiden publicar respuestas de una cuenta anterior.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { claveUso, type ModoEjecucionUso, type FotoUso } from '../../../../shared/usage-ipc'
import type { AgenteConversacion } from '../../../../shared/conversations-ipc'
export interface ConsultaUso {
  agente: AgenteConversacion
  cuentaId: string | null
  modo: ModoEjecucionUso
  habilitado: boolean
}

/**
 * Sondeo de RESPALDO: lo bueno es el aviso `alCambiar` del main al terminar un turno.
 * El reloj cubre el consumo hecho desde otra máquina o fuera de Tessera y las ventanas
 * que se reinician solas, así que va holgado: en claude-code es una llamada de red con
 * límite por token; en codex, leer la cola de un fichero.
 */
export const SONDEO_MS: Record<AgenteConversacion, number> = {
  'claude-code': 180_000,
  codex: 30_000
}

type RefrescarUso = (force?: boolean) => Promise<void>

/** Consulta del uso: al activarse, en bucle de respaldo y al avisar el main de fin de turno. */
export function useSondeoUso({ agente, cuentaId: accountId, modo: mode, habilitado }: ConsultaUso): {
  foto: FotoUso | null
  refrescar: RefrescarUso
} {
  const clave = claveUso({ agente, accountId: accountId ?? '', mode })
  const [lectura, setLectura] = useState<{ clave: string; foto: FotoUso | null } | null>(null)
  const generacion = useRef(0)
  // Sondeo en vuelo: evita solaparlos (una consulta lenta + un tick = dos fetch).
  const enCursoRef = useRef(false)

  const refrescar = useCallback(
    async (force = false): Promise<void> => {
      if (!habilitado || enCursoRef.current) return
      if (mode !== 'host' && !accountId) return
      enCursoRef.current = true
      const turno = generacion.current
      try {
        const s = await window.tessera.uso.leer({
          agente,
          accountId: accountId ?? '',
          mode,
          force
        })
        if (turno === generacion.current) setLectura({ clave, foto: s })
      } catch {
        if (turno === generacion.current) setLectura({ clave, foto: null })
      } finally {
        if (turno === generacion.current) enCursoRef.current = false
      }
    },
    [agente, accountId, mode, habilitado, clave]
  )

  // El main cachea con TTL: un tick de más devuelve lo cacheado, no genera tráfico.
  useEffect(() => {
    if (!habilitado) return
    const turno = generacion.current
    void refrescar()
    const id = setInterval(() => void refrescar(), SONDEO_MS[agente])
    return () => { clearInterval(id); generacion.current = turno + 1; enCursoRef.current = false }
  }, [refrescar, habilitado, agente])

  // El aviso de fin de turno llega a TODOS los paneles; cada uno se queda con el de SU
  // cuenta (dos proyectos con la misma cuenta comparten uso y ambos se refrescan).
  useEffect(() => {
    if (!habilitado) return
    if (mode !== 'host' && !accountId) return
    const req = { agente, accountId: accountId ?? '', mode }
    const mine = claveUso(req)
    void window.tessera.uso.vigilar(req)
    const off = window.tessera.uso.alCambiar((c) => {
      if (c.clave === mine) void refrescar(true)
    })
    return () => {
      off()
      void window.tessera.uso.dejarDeVigilar(req)
    }
  }, [agente, accountId, mode, habilitado, refrescar])

  return { foto: lectura?.clave === clave ? lectura.foto : null, refrescar }
}

