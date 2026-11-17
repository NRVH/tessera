// =============================================================================
// La conversación divergida que espera respuesta: lo necesario para volver a pedir el traspaso con la elección.
// La abre `continuarEn` y la pinta `DialogoDivergencia`, montado una vez en la raíz de la ventana.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { create } from 'zustand'
import type { CopiaConversacion } from '../../../../shared/traspaso-ipc'
import type { DestinoAgenteAbierto } from '../pestanas'
import type { DestinoContinuar } from './continuarEn'
import type { ExtremoTraspaso } from './modeloDivergencia.ts'

export interface Divergencia {
  origen: DestinoAgenteAbierto
  sesionId: string
  destino: DestinoContinuar
  lados: { origen: ExtremoTraspaso; destino: ExtremoTraspaso }
  copias: { origen: CopiaConversacion; destino: CopiaConversacion }
}

export const useStoreDivergencia = create<{ abierta: Divergencia | null }>(() => ({ abierta: null }))

export function abrirDivergencia(d: Divergencia): void {
  useStoreDivergencia.setState({ abierta: d })
}

export function cerrarDivergencia(): void {
  useStoreDivergencia.setState({ abierta: null })
}
