// =============================================================================
// Estado compartido, una suscripción IPC y un reloj para todos los indicadores de delegación.
// La retirada espera la confirmación y la salida; los errores de IPC permiten volver a actuar.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { useEffect } from 'react'
import { create } from 'zustand'
import type { VistaTarea } from '../../../../shared/delegacion-ipc'
import { MS_CONFIRMACION } from '../../comun/BotonGuardar'
import { movimientoReducido, MS_SALIDA } from '../../comun/presencia'
import { txDelegacion } from './textos'
import { planificarRetiradas } from './modeloDelegacion'

export interface VistaIndicador {
  abierto: boolean
  arriba: boolean
  derecha: number
  borde: number
  cancelar: VistaTarea | null
  ocupado: boolean
  error: string | null
}

export const VISTA_CERRADA: VistaIndicador = {
  abierto: false, arriba: false, derecha: 0, borde: 0, cancelar: null, ocupado: false, error: null
}

interface EstadoDelegacion {
  tareas: VistaTarea[]
  ahora: number
  retiradas: Record<string, number>
  errores: Record<string, string>
  vistas: Record<string, VistaIndicador>
}

export const useStoreDelegacion = create<EstadoDelegacion>(() => ({
  tareas: [], ahora: Date.now(), retiradas: {}, errores: {}, vistas: {}
}))

export function cambiarVista(clave: string, cambio: Partial<VistaIndicador>): void {
  useStoreDelegacion.setState((s) => ({ vistas: { ...s.vistas, [clave]: { ...(s.vistas[clave] ?? VISTA_CERRADA), ...cambio } } }))
}

export function olvidarVista(clave: string): void {
  useStoreDelegacion.setState((s) => {
    const vistas = { ...s.vistas }
    delete vistas[clave]
    return { vistas }
  })
}

export async function descartarTarea(id: string): Promise<void> {
  try {
    await window.tessera.delegacion.descartar(id)
    useStoreDelegacion.setState((s) => {
      const errores = { ...s.errores }
      delete errores[id]
      return { tareas: s.tareas.filter((t) => t.id !== id), errores }
    })
  } catch {
    useStoreDelegacion.setState((s) => ({ errores: { ...s.errores, [id]: txDelegacion().error } }))
  }
}

export async function confirmarCancelacion(clave: string): Promise<void> {
  const vista = useStoreDelegacion.getState().vistas[clave]
  if (!vista?.cancelar || vista.ocupado) return
  cambiarVista(clave, { ocupado: true, error: null })
  try {
    await window.tessera.delegacion.cancelar(vista.cancelar.id)
    if (useStoreDelegacion.getState().vistas[clave]) cambiarVista(clave, { cancelar: null, ocupado: false })
  } catch {
    if (useStoreDelegacion.getState().vistas[clave]) cambiarVista(clave, { ocupado: false, error: txDelegacion().error })
  }
}

let usuarios = 0
let desconectar: (() => void) | undefined

/** Se suscribe antes de listar: una respuesta inicial tardía nunca pisa un evento más reciente. */
function conectar(): () => void {
  let vivo = true
  let cambioRecibido = false
  let salida: ReturnType<typeof setTimeout> | undefined
  const descartando = new Set<string>()
  const programar = (): void => {
    clearTimeout(salida)
    const s = useStoreDelegacion.getState()
    const ahora = Date.now()
    const demoraSalida = movimientoReducido() ? 0 : MS_SALIDA
    let proxima = Infinity
    for (const t of s.tareas) {
      const fecha = s.retiradas[t.id]
      if (fecha === undefined || s.errores[t.id] || descartando.has(t.id)) continue
      if (ahora >= fecha + demoraSalida) {
        descartando.add(t.id)
        void descartarTarea(t.id).finally(() => {
          descartando.delete(t.id)
          if (vivo) programar()
        })
      } else proxima = Math.min(proxima, ahora < fecha ? fecha : fecha + demoraSalida)
    }
    if (Number.isFinite(proxima)) salida = setTimeout(() => {
      useStoreDelegacion.setState({ ahora: Date.now() })
      programar()
    }, Math.max(0, proxima - ahora))
  }
  const recibir = (tareas: VistaTarea[]): void => {
    if (!vivo) return
    const ahora = Date.now()
    useStoreDelegacion.setState((s) => ({
      tareas, ahora,
      retiradas: planificarRetiradas(tareas, s.retiradas, ahora, MS_CONFIRMACION),
      errores: Object.fromEntries(Object.entries(s.errores).filter(([id]) => tareas.some((t) => t.id === id)))
    }))
    programar()
  }
  const quitar = window.tessera.delegacion.alCambiar((tareas) => {
    cambioRecibido = true
    recibir(tareas)
  })
  void window.tessera.delegacion.listar().then((tareas) => {
    if (!cambioRecibido) recibir(tareas)
  }).catch(() => { /* Los eventos posteriores permiten recuperar la lista. */ })
  const reloj = setInterval(() => {
    if (useStoreDelegacion.getState().tareas.some((t) => t.estado === 'en-marcha')) {
      useStoreDelegacion.setState({ ahora: Date.now() })
    }
  }, 1000)
  return () => {
    vivo = false
    quitar()
    clearInterval(reloj)
    clearTimeout(salida)
  }
}

/** Se monta con los demás hooks de agentes; el contador evita duplicar la suscripción. */
export function useDelegacion(): void {
  useEffect(() => {
    if (usuarios++ === 0) desconectar = conectar()
    return () => {
      if (--usuarios === 0) desconectar?.()
    }
  }, [])
}
