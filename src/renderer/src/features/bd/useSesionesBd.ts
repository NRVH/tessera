// =============================================================================
// useSesionesBd: las SESIONES vivas del explorador de bases de datos (meta, datos y
// una por consola), para el punto de sesión del árbol. Foto al montar y al recuperar
// el foco, más los cambios que empuja el main; global, sin filtrar por perfil. Una
// sesión cerrada se quita; la perdida se queda, que es lo que el punto avisa.
// Decisiones: docs/decisiones/bd/ui-area-conexiones-y-sesiones.md
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import type { DbEstadoSesion, DbRefSesion } from '../../../../shared/db-explorador-ipc'

/** Clave de una sesión por su referencia (JSON de tupla: sin separadores ambiguos). */
function claveSesion(ref: DbRefSesion): string {
  return ref.rol === 'consola'
    ? JSON.stringify(['consola', ref.perfilId, ref.consolaId])
    : JSON.stringify([ref.rol, ref.conexionId])
}

export function useSesionesBd(): readonly DbEstadoSesion[] {
  const [mapa, setMapa] = useState<ReadonlyMap<string, DbEstadoSesion>>(() => new Map())

  useEffect(() => {
    let vivo = true
    const sincronizar = (): void => {
      window.tessera.dbExplorador
        .sesiones()
        .then((lista) => {
          if (!vivo) return
          const next = new Map<string, DbEstadoSesion>()
          for (const s of lista) if (s.fase !== 'cerrada') next.set(claveSesion(s.ref), s)
          setMapa(next)
        })
        .catch(() => {
          // Sin foto se sigue con lo que haya: los cambios siguen llegando por el canal.
        })
    }
    sincronizar()
    const baja = window.tessera.dbExplorador.onSesion((s) => {
      const k = claveSesion(s.ref)
      setMapa((prev) => {
        if (s.fase === 'cerrada') {
          if (!prev.has(k)) return prev
          const next = new Map(prev)
          next.delete(k)
          return next
        }
        const next = new Map(prev)
        next.set(k, s)
        return next
      })
    })
    window.addEventListener('focus', sincronizar)
    return () => {
      vivo = false
      baja()
      window.removeEventListener('focus', sincronizar)
    }
  }, [])

  return useMemo(() => [...mapa.values()], [mapa])
}
