// =============================================================================
// Línea de estado del bloque «Tessera» de la categoría Actualizaciones, en
// lenguaje de usuario. Lógica pura: los avisos terminales mandan sobre el ciclo
// porque son lo único que le pide algo al usuario.
// =============================================================================

import type { UpdateState, UpdateStatus } from '../../../../../../shared/update-ipc'

/** Lo que la línea de estado necesita del bloque. */
export interface EntradaLineaUpdate {
  state: UpdateState | null
  status: UpdateStatus
  version: string
  isDev: boolean
}

function lineaAviso({ state, version }: EntradaLineaUpdate): string | null {
  const fallo = state?.avisoFallo
  if (fallo) {
    return (
      `No se pudo aplicar la versión ${fallo.versionEsperada}. ` +
      (fallo.mensaje ?? `Sigues en la ${version}.`) +
      (fallo.agotado ? ' Se dejó de intentar.' : '')
    )
  }
  const aplicada = state?.avisoAplicada
  return aplicada ? `Actualizada de ${aplicada.desde} a ${aplicada.hasta}.` : null
}

function lineaPreparada(state: UpdateState | null): string {
  return state?.seAplicaAlCerrar
    ? `La versión ${state?.newVersion ?? ''} está preparada; se aplicará al cerrar Tessera.`
    : `La versión ${state?.newVersion ?? ''} está preparada y esperando a que la instales.`
}

function lineaDescarga(state: UpdateState | null): string {
  return `Descargando ${state?.newVersion ?? ''}… ${state?.percent ?? 0}%`
}

function lineaDisponible(state: UpdateState | null): string {
  return (
    `La versión ${state?.newVersion ?? ''} está disponible. ` +
    'Esta copia no puede instalarse sola: descárgala y sustituye la app.'
  )
}

function lineaCiclo({ state, status, isDev }: EntradaLineaUpdate): string {
  if (status === 'checking') return 'Buscando actualizaciones…'
  if (status === 'downloading') return lineaDescarga(state)
  if (status === 'ready') return lineaPreparada(state)
  if (status === 'available') return lineaDisponible(state)
  if (status === 'installing') return 'Instalando…'
  if (status === 'error') return state?.errorMessage ?? 'La comprobación falló.'
  if (isDev) return 'Modo desarrollo: el selector simula los estados (no hay instalador real).'
  return 'Se comprueban solas en segundo plano.'
}

/** Texto de la línea de estado: primero los avisos terminales, después el ciclo. */
export function lineaEstadoUpdate(entrada: EntradaLineaUpdate): string {
  return lineaAviso(entrada) ?? lineaCiclo(entrada)
}
