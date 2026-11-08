// =============================================================================
// El contexto global de los agentes en el renderer: se pide al main al montar la ventana y se actualiza con su
// aviso de cambio, venga de este diálogo, de una propuesta aceptada o de una importación. El dueño es el main.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import { create } from 'zustand'
import { CONTEXTO_GLOBAL_VACIO, type ContextoGlobal } from '../../../../../shared/contexto.ts'

export const useStoreContextoGlobal = create<{ global: ContextoGlobal }>()(() => ({ global: CONTEXTO_GLOBAL_VACIO }))

/** Lo lee una vez y escucha sus cambios; devuelve cómo dejar de escuchar. */
export function iniciarContextoGlobal(): () => void {
  let vivo = true
  void window.tessera.contextoGlobal
    .leer()
    .then((global) => vivo && useStoreContextoGlobal.setState({ global }))
    .catch(() => undefined)
  const quitar = window.tessera.contextoGlobal.onCambio((global) => useStoreContextoGlobal.setState({ global }))
  return () => {
    vivo = false
    quitar()
  }
}

/** Guarda una parte del contexto global (el main la pone sobre lo vigente) y deja en el store lo guardado. */
export async function guardarContextoGlobal(cambio: Partial<ContextoGlobal>): Promise<ContextoGlobal> {
  const global = await window.tessera.contextoGlobal.guardar(cambio)
  useStoreContextoGlobal.setState({ global })
  return global
}
