// =============================================================================
// Avisos permanentes del sandbox: el rebuild automático de la imagen (solo las
// líneas marcadas con `fase`) y los avisos de la red del contenedor que empuja el
// main cuando no hay ningún diálogo abierto. Suscripciones IPC de por vida.
// =============================================================================
import { useEffect } from 'react'
import { notify } from '../../comun/notifications'

/** Suscribe los avisos del sandbox a los toasts mientras la app está montada. */
export function useAvisosSandbox(): void {
  useEffect(
    () =>
      window.tessera.agentsUpdate.onProgress((p) => {
        if (p.fase === 'inicio') notify('info', 'Preparando la imagen del sandbox…', p.line)
        else if (p.fase === 'fin') notify('success', 'Sandbox listo', p.line)
        else if (p.fase === 'error') notify('warn', 'Paquetes extra del sandbox', p.line)
      }),
    []
  )
  useEffect(() => window.tessera.redContenedor.onAviso((a) => notify('warn', a.titulo, a.detalle)), [])
}
