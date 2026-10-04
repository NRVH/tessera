// =============================================================================
// Escenas de la previsualización de desarrollo del bloque de actualización: qué
// `UpdateState` siembra cada una y los pasos del ciclo simulado. Lógica pura, sin
// DOM. `available` se siembra desde cualquier sistema porque es un `status` del
// contrato, no una consulta a la plataforma.
// =============================================================================

import type { UpdateState } from '../../../../../../shared/update-ipc'

/** Escenas que el selector de desarrollo sabe sembrar. */
export const ESCENAS = ['ciclo', 'ready', 'available', 'aplicada', 'fallo', 'error'] as const
export type Escena = (typeof ESCENAS)[number]

/** Un paso del ciclo simulado: el estado que se pinta tras `retardo` ms. */
export interface PasoCiclo {
  retardo: number
  estado: UpdateState
}

/** Estado base de la simulación: el ciclo normal, con el motor armado y sin avisos. */
export function semillaUpdate(base: string): UpdateState {
  return {
    status: 'checking',
    currentVersion: base,
    aplicable: true,
    newVersion: null,
    percent: 0,
    errorMessage: null,
    errorDetail: null,
    installerPath: null,
    ultimoChequeoMs: Date.now(),
    preparadaDesdeArranque: false,
    seAplicaAlCerrar: false,
    avisoAplicada: null,
    avisoFallo: null
  }
}

const ESTADOS_FIJOS: Record<Exclude<Escena, 'ciclo'>, (seed: UpdateState) => UpdateState> = {
  ready: (seed) => ({
    ...seed,
    status: 'ready',
    newVersion: '99.0.0',
    percent: 100,
    preparadaDesdeArranque: true,
    seAplicaAlCerrar: true
  }),
  // Como lo emite el main donde la copia no puede auto-instalar: versión conocida,
  // nada descargado y sin promesa de aplicarse al cerrar.
  available: (seed) => ({ ...seed, status: 'available', newVersion: '99.0.0', aplicable: false }),
  aplicada: (seed) => ({
    ...seed,
    status: 'idle',
    avisoAplicada: { desde: seed.currentVersion, hasta: '99.0.0' }
  }),
  fallo: (seed) => ({
    ...seed,
    status: 'idle',
    avisoFallo: {
      versionEsperada: '99.0.0',
      intentos: 2,
      agotado: true,
      mensaje: null,
      detalle: null
    }
  }),
  error: (seed) => ({
    ...seed,
    status: 'error',
    errorMessage: 'No se pudo contactar con el servidor de actualizaciones.',
    errorDetail: 'Error: connect ECONNREFUSED 192.0.2.10:443'
  })
}

/** Estado fijo de una escena, o `null` si es el ciclo (que se recorre por pasos). */
export function estadoDeEscena(escena: Escena, seed: UpdateState): UpdateState | null {
  return escena === 'ciclo' ? null : ESTADOS_FIJOS[escena](seed)
}

/** Pasos del ciclo simulado: empieza a bajar a los 800 ms y llega a `ready` en cinco tramos. */
export function pasosDelCiclo(seed: UpdateState): PasoCiclo[] {
  const pasos: PasoCiclo[] = [
    { retardo: 800, estado: { ...seed, status: 'downloading', newVersion: '99.0.0', percent: 0 } }
  ]
  for (let i = 1; i <= 5; i++) {
    const pct = i * 20
    pasos.push({
      retardo: 800 + i * 500,
      estado: {
        ...seed,
        status: pct >= 100 ? 'ready' : 'downloading',
        newVersion: '99.0.0',
        percent: pct,
        seAplicaAlCerrar: pct >= 100
      }
    })
  }
  return pasos
}
