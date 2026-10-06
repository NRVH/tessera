// =============================================================================
// Las operaciones largas de una sesión SFTP: la lista de las que están en marcha o acaban de
// terminar (por los eventos de progreso, que ya traen su sesión), cancelar y mostrar una descarga,
// quitar solas las que terminan bien, refrescar la carpeta cuando una subida o un borrado la toca, y
// el plan con conflictos que espera confirmación. Depende de `window.tessera.sftp` y de
// `operacionesSftp` (puro).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SftpInicioTransferencia, SftpPlan, SftpResultado } from '../../../../shared/sftp-ipc'
import { aplicarProgreso, debeRefrescar, quitarOperacion, seQuitaSola, type OperacionSftp } from './operacionesSftp'

/** Cuánto tarda en irse de la tira una operación terminada bien o cancelada. */
const MS_HASTA_QUITAR = 6000

export interface OperacionesSftp {
  operaciones: OperacionSftp[]
  plan: SftpPlan | null
  cancelar: (opId: string) => void
  mostrarDescarga: (opId: string) => void
  cerrar: (opId: string) => void
  /** Procesa lo que devolvió una transferencia: un aviso si falló, el plan si hay conflictos. */
  alIniciar: (r: SftpResultado<SftpInicioTransferencia | null>) => void
  /** Confirma (reemplazando) o descarta el plan pendiente. */
  resolverPlan: (reemplazar: boolean) => void
}

/** Suscribe la lista a los eventos de progreso de la sesión y refresca la carpeta cuando toca. */
function useProgreso(
  sesionId: string,
  rutaVisible: string | null,
  refrescar: () => void,
  setOperaciones: React.Dispatch<React.SetStateAction<OperacionSftp[]>>
): void {
  const rutaRef = useRef(rutaVisible)
  rutaRef.current = rutaVisible
  const refrescarRef = useRef(refrescar)
  refrescarRef.current = refrescar
  useEffect(() => {
    const temporizadores = new Map<string, ReturnType<typeof setTimeout>>()
    const baja = window.tessera.sftp.onProgreso((p) => {
      if (p.sesionId !== sesionId) return
      setOperaciones((l) => aplicarProgreso(l, p))
      if (seQuitaSola(p.fase) && !temporizadores.has(p.opId)) {
        temporizadores.set(
          p.opId,
          setTimeout(() => setOperaciones((l) => quitarOperacion(l, p.opId)), MS_HASTA_QUITAR)
        )
      }
      if (debeRefrescar(p, rutaRef.current)) refrescarRef.current()
    })
    return () => {
      baja()
      for (const t of temporizadores.values()) clearTimeout(t)
    }
  }, [sesionId, setOperaciones])
}

/** Las operaciones de la sesión y el plan pendiente. `avisar` recibe los errores de acciones puntuales. */
export function useOperacionesSftp(
  sesionId: string,
  rutaVisible: string | null,
  refrescar: () => void,
  avisar: (texto: string) => void
): OperacionesSftp {
  const [operaciones, setOperaciones] = useState<OperacionSftp[]>([])
  const [plan, setPlan] = useState<SftpPlan | null>(null)
  useProgreso(sesionId, rutaVisible, refrescar, setOperaciones)

  const alIniciar = useCallback(
    (r: SftpResultado<SftpInicioTransferencia | null>) => {
      if (!r.ok) return avisar(r.error)
      if (r.valor?.tipo === 'plan') setPlan({ planId: r.valor.planId, conflictos: r.valor.conflictos })
    },
    [avisar]
  )
  const resolverPlan = useCallback(
    (reemplazar: boolean) => {
      if (plan === null) return
      setPlan(null)
      void window.tessera.sftp.confirmarPlan({ planId: plan.planId, reemplazar }).then((r) => {
        if (!r.ok) avisar(r.error)
      })
    },
    [plan, avisar]
  )
  return {
    operaciones,
    plan,
    cancelar: (opId) => void window.tessera.sftp.cancelar({ opId }),
    mostrarDescarga: (opId) => void window.tessera.sftp.mostrarDescarga({ opId }),
    cerrar: (opId) => setOperaciones((l) => quitarOperacion(l, opId)),
    alIniciar,
    resolverPlan
  }
}
