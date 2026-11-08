// =============================================================================
// Avisos permanentes de error del sandbox y de la red del contenedor que empuja el
// main cuando no hay ningún diálogo abierto. Suscripciones IPC de por vida.
// El arranque del agente confirma el éxito de la preparación del sandbox.
// =============================================================================
import { useEffect } from 'react'
import { notify } from '../../comun/notifications'
import { txSesion } from './textosSesion.ts'

/** Suscribe los avisos del sandbox a los toasts mientras la app está montada. */
export function useAvisosSandbox(): void {
  useEffect(
    () =>
      window.tessera.agentsUpdate.onProgress((p) => {
        const t = txSesion()
        if (p.fase === 'error') notify('warn', t.sandboxPaquetes, p.line)
      }),
    []
  )
  useEffect(() => window.tessera.redContenedor.onAviso((a) => notify('warn', a.titulo, a.detalle)), [])
}
