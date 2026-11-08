// =============================================================================
// Qué contexto de los agentes está abierto: lo piden Configuración › Agentes, el menú de un perfil y el de una
// cuenta, y lo pinta una sola capa en la raíz de la ventana, por encima de Configuración.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import { create } from 'zustand'
import type { ContextoAbierto } from './modeloContexto.ts'

export const useStoreContextoAbierto = create<{ abierto: ContextoAbierto | null }>()(() => ({ abierto: null }))

export function abrirContexto(c: ContextoAbierto): void {
  useStoreContextoAbierto.setState({ abierto: c })
}

export function cerrarContexto(): void {
  useStoreContextoAbierto.setState({ abierto: null })
}
