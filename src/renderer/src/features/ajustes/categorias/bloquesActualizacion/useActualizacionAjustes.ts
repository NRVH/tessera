// =============================================================================
// Estado y acciones del bloque «Tessera» de la categoría Actualizaciones: el
// `EstadoActualizacion` real del main (estado + alCambiarEstado), la simulación de desarrollo y
// las acciones de comprobar, instalar y descartar avisos.
// Los avisos no se descartan al desmontar el bloque: ver
// docs/decisiones/renderer/actualizaciones-de-la-app.md.
// =============================================================================

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { EstadoActualizacion, FaseActualizacionApp } from '../../../../../../shared/update-ipc'
import { useAhora } from '../../../../comun/useAhora'
import { TICK_ULTIMO_CHEQUEO_MS, useEstadoActualizacion } from '../../../actualizaciones'
import { estadoDeEscena, pasosDelCiclo, semillaActualizacion, type Escena } from './escenasActualizacion'

type Temporizadores = MutableRefObject<ReturnType<typeof setTimeout>[]>

/** Todo lo que el bloque necesita para pintarse y actuar. */
export interface ActualizacionAjustes {
  estado: EstadoActualizacion | null
  fase: FaseActualizacionApp
  ocupado: boolean
  version: string
  ahora: number
  esDesarrollo: boolean
  comprobar: () => void
  instalarActualizacion: () => void
  descartar: (que: 'aplicada' | 'fallo') => void
  mostrarPreviaDesarrollo: (escena: Escena) => void
}

function limpiar(temporizadores: Temporizadores): void {
  for (const t of temporizadores.current) clearTimeout(t)
}

/** Estado real del main; al desmontar también cancela los temporizadores de la simulación. */
function useActualizacionReal(temporizadores: Temporizadores): EstadoActualizacion | null {
  const real = useEstadoActualizacion()
  useEffect(() => () => limpiar(temporizadores), [temporizadores])
  return real
}

/** 'disabled' se pinta como 'idle', pero no se fuerza por estar en dev: el estado simulado del main es real. */
function estadoPintado(previa: EstadoActualizacion | null, estado: EstadoActualizacion | null): FaseActualizacionApp {
  const faseReal = estado?.fase ?? 'idle'
  return previa ? previa.fase : faseReal === 'disabled' ? 'idle' : faseReal
}

/** Estado y acciones del bloque de actualización de Tessera (real, o simulado en desarrollo). */
export function useActualizacionAjustes(): ActualizacionAjustes {
  const temporizadores = useRef<ReturnType<typeof setTimeout>[]>([])
  const [previa, setPrevia] = useState<EstadoActualizacion | null>(null)
  const real = useActualizacionReal(temporizadores)
  const ahora = useAhora(TICK_ULTIMO_CHEQUEO_MS)

  // Se pregunta a Vite y no al estado del updater: con `TESSERA_FAKE_UPDATE` el main
  // simula el ciclo y el estado deja de ser 'disabled', pero el selector de escenas debe verse.
  const esDesarrollo = import.meta.env.DEV
  const estado = previa ?? real
  const fase = estadoPintado(previa, estado)
  const ocupado = fase === 'checking' || fase === 'downloading' || fase === 'installing'
  const version = estado?.versionActual ?? '—'

  function mostrarPreviaDesarrollo(escena: Escena): void {
    limpiar(temporizadores)
    temporizadores.current = []
    const semilla = semillaActualizacion(real?.versionActual ?? '0.0.0')
    const fijo = estadoDeEscena(escena, semilla)
    if (fijo) {
      setPrevia(fijo)
      return
    }
    setPrevia(semilla)
    for (const { retardo, estado } of pasosDelCiclo(semilla)) {
      temporizadores.current.push(setTimeout(() => setPrevia(estado), retardo))
    }
  }

  function comprobarActualizacion(): void {
    if (esDesarrollo) {
      mostrarPreviaDesarrollo('ciclo')
      return
    }
    void window.tessera.actualizacion.comprobar()
  }

  function instalarActualizacion(): void {
    if (previa) {
      // En `available` el main real abre el navegador y se queda en `available`:
      // simular «Instalando…» enseñaría un estado que esa copia no tiene.
      if (previa.fase === 'available') return
      setPrevia({ ...previa, fase: 'installing' })
      temporizadores.current.push(setTimeout(() => setPrevia(null), 1400))
      return
    }
    void window.tessera.actualizacion.instalar()
  }

  function descartar(que: 'aplicada' | 'fallo'): void {
    if (previa) {
      setPrevia({ ...previa, avisoAplicada: null, avisoFallo: null })
      return
    }
    void window.tessera.actualizacion.descartar(que)
  }

  return { estado, fase, ocupado, version, ahora, esDesarrollo, comprobar: comprobarActualizacion, instalarActualizacion, descartar, mostrarPreviaDesarrollo }
}
