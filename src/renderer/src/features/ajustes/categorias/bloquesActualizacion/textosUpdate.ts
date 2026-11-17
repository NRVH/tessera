// =============================================================================
// Línea de estado del bloque «Tessera» de la categoría Actualizaciones, en
// lenguaje de usuario. Lógica pura: los avisos terminales mandan sobre el ciclo
// porque son lo único que le pide algo al usuario.
// =============================================================================

import type { EstadoActualizacion, FaseActualizacionApp } from '../../../../../../shared/update-ipc'
import { txLineasActualizacion } from '../../textosSistema.ts'

/** Lo que la línea de estado necesita del bloque. */
export interface EntradaLineaActualizacion {
  estado: EstadoActualizacion | null
  fase: FaseActualizacionApp
  version: string
  esDesarrollo: boolean
}

function lineaAviso({ estado, version }: EntradaLineaActualizacion): string | null {
  const t = txLineasActualizacion().aviso
  const fallo = estado?.avisoFallo
  if (fallo) {
    return (
      t.noSePudo(fallo.versionEsperada) +
      (fallo.mensaje ?? t.sigues(version)) +
      (fallo.agotado ? t.agotado : '')
    )
  }
  const aplicada = estado?.avisoAplicada
  return aplicada ? t.actualizada(aplicada.desde, aplicada.hasta) : null
}

function lineaPreparada(estado: EstadoActualizacion | null): string {
  const t = txLineasActualizacion()
  return estado?.seAplicaAlCerrar
    ? t.preparadaAlCerrar(estado?.newVersion ?? '')
    : t.preparadaEsperando(estado?.newVersion ?? '')
}

function lineaDescarga(estado: EstadoActualizacion | null): string {
  return txLineasActualizacion().descargando(estado?.newVersion ?? '', estado?.percent ?? 0)
}

function lineaDisponible(estado: EstadoActualizacion | null): string {
  return txLineasActualizacion().disponible(estado?.newVersion ?? '')
}

function lineaCiclo({ estado, fase, esDesarrollo }: EntradaLineaActualizacion): string {
  const t = txLineasActualizacion()
  if (fase === 'checking') return t.buscando
  if (fase === 'downloading') return lineaDescarga(estado)
  if (fase === 'ready') return lineaPreparada(estado)
  if (fase === 'available') return lineaDisponible(estado)
  if (fase === 'installing') return t.instalando
  if (fase === 'error') return estado?.mensajeError ?? t.fallo
  if (esDesarrollo) return t.desarrollo
  return t.solas
}

/** Texto de la línea de estado: primero los avisos terminales, después el ciclo. */
export function lineaEstadoActualizacion(entrada: EntradaLineaActualizacion): string {
  return lineaAviso(entrada) ?? lineaCiclo(entrada)
}
