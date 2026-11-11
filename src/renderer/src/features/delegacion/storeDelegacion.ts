// =============================================================================
// Estado compartido, una suscripción IPC y un reloj para todos los indicadores de delegación.
// La retirada espera la confirmación y la salida; los errores de IPC permiten volver a actuar. Cancelar no bloquea.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { useEffect } from 'react'
import { create } from 'zustand'
import type { VistaTarea, VistaTareaPanel } from '../../../../shared/delegacion-ipc'
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
}

export const VISTA_CERRADA: VistaIndicador = {
  abierto: false, arriba: false, derecha: 0, borde: 0, cancelar: null
}

interface EstadoDelegacion {
  tareas: VistaTareaPanel[]
  ahora: number
  retiradas: Record<string, number>
  errores: Record<string, string>
  /** Las tareas cuya cancelación sigue en curso: el chip lo dice y no se vuelve a pedir. */
  cancelando: Record<string, true>
  /** Por qué no se pudo cancelar una tarea que sigue en marcha: se puede volver a intentar. */
  fallosCancelar: Record<string, string>
  vistas: Record<string, VistaIndicador>
}

export const useStoreDelegacion = create<EstadoDelegacion>(() => ({
  tareas: [], ahora: Date.now(), retiradas: {}, errores: {}, cancelando: {}, fallosCancelar: {}, vistas: {}
}))

function sin<T>(mapa: Record<string, T>, id: string): Record<string, T> {
  const copia = { ...mapa }
  delete copia[id]
  return copia
}

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

/**
 * La pregunta se cierra al confirmar y la cancelación sigue en segundo plano: el chip enseña que está en curso, y si
 * falla, lo dice en su fila con la opción de volver a intentarlo. Nada retiene la ventana mientras tanto.
 */
export async function confirmarCancelacion(clave: string): Promise<void> {
  const tarea = useStoreDelegacion.getState().vistas[clave]?.cancelar
  if (!tarea) return
  cambiarVista(clave, { cancelar: null })
  const id = tarea.id
  if (useStoreDelegacion.getState().cancelando[id]) return
  useStoreDelegacion.setState((s) => ({ cancelando: { ...s.cancelando, [id]: true }, fallosCancelar: sin(s.fallosCancelar, id) }))
  try {
    await window.tessera.delegacion.cancelar(id)
  } catch {
    useStoreDelegacion.setState((s) => ({ fallosCancelar: { ...s.fallosCancelar, [id]: txDelegacion().errorCancelar } }))
  } finally {
    useStoreDelegacion.setState((s) => ({ cancelando: sin(s.cancelando, id) }))
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
  const recibir = (tareas: VistaTareaPanel[]): void => {
    if (!vivo) return
    const ahora = Date.now()
    useStoreDelegacion.setState((s) => ({
      tareas, ahora,
      retiradas: planificarRetiradas(tareas, s.retiradas, ahora, MS_CONFIRMACION),
      errores: Object.fromEntries(Object.entries(s.errores).filter(([id]) => tareas.some((t) => t.id === id))),
      // El aviso de que no se pudo cancelar solo vale mientras siga en marcha: si acabó sola, ya no es cierto.
      fallosCancelar: Object.fromEntries(Object.entries(s.fallosCancelar).filter(([id]) => tareas.some((t) => t.id === id && t.estado === 'en-marcha')))
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
