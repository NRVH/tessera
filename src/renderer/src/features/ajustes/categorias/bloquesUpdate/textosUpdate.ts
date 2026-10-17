// =============================================================================
// Línea de estado del bloque «Tessera» de la categoría Actualizaciones, en
// lenguaje de usuario. Lógica pura: los avisos terminales mandan sobre el ciclo
// porque son lo único que le pide algo al usuario.
// =============================================================================

import type { UpdateState, UpdateStatus } from '../../../../../../shared/update-ipc'
import { txLineasUpdate } from '../../textosSistema.ts'

/** Lo que la línea de estado necesita del bloque. */
export interface EntradaLineaUpdate {
  state: UpdateState | null
  status: UpdateStatus
  version: string
  isDev: boolean
}

function lineaAviso({ state, version }: EntradaLineaUpdate): string | null {
  const t = txLineasUpdate().aviso
  const fallo = state?.avisoFallo
  if (fallo) {
    return (
      t.noSePudo(fallo.versionEsperada) +
      (fallo.mensaje ?? t.sigues(version)) +
      (fallo.agotado ? t.agotado : '')
    )
  }
  const aplicada = state?.avisoAplicada
  return aplicada ? t.actualizada(aplicada.desde, aplicada.hasta) : null
}

function lineaPreparada(state: UpdateState | null): string {
  const t = txLineasUpdate()
  return state?.seAplicaAlCerrar
    ? t.preparadaAlCerrar(state?.newVersion ?? '')
    : t.preparadaEsperando(state?.newVersion ?? '')
}

function lineaDescarga(state: UpdateState | null): string {
  return txLineasUpdate().descargando(state?.newVersion ?? '', state?.percent ?? 0)
}

function lineaDisponible(state: UpdateState | null): string {
  return txLineasUpdate().disponible(state?.newVersion ?? '')
}

function lineaCiclo({ state, status, isDev }: EntradaLineaUpdate): string {
  const t = txLineasUpdate()
  if (status === 'checking') return t.buscando
  if (status === 'downloading') return lineaDescarga(state)
  if (status === 'ready') return lineaPreparada(state)
  if (status === 'available') return lineaDisponible(state)
  if (status === 'installing') return t.instalando
  if (status === 'error') return state?.errorMessage ?? t.fallo
  if (isDev) return t.desarrollo
  return t.solas
}

/** Texto de la línea de estado: primero los avisos terminales, después el ciclo. */
export function lineaEstadoUpdate(entrada: EntradaLineaUpdate): string {
  return lineaAviso(entrada) ?? lineaCiclo(entrada)
}
