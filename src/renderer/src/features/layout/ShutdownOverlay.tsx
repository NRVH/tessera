// =============================================================================
// ShutdownOverlay: modal a pantalla completa que refleja el progreso del cierre de la app
// (`shutdown:progress`, emitido por el main mientras detiene los contenedores). No controla
// el cierre. Se mantiene montado siempre y pinta null hasta el primer evento; una vez
// visible no se oculta, salvo si el cierre se aborta.
// Depende de `shared/shutdown-ipc` y de `window.tessera.shutdown`.
// =============================================================================

import { useEffect, useState } from 'react'
import type { ShutdownProgress } from '../../../../shared/shutdown-ipc'

/** Overlay de cierre: pinta el progreso de `shutdown:progress` mientras la app sale. */
export function ShutdownOverlay(): React.JSX.Element | null {
  const [progress, setProgress] = useState<ShutdownProgress | null>(null)
  useEffect(() => window.tessera.shutdown.onProgress((p) => setProgress(p)), [])

  // `aborted`: el cierre se canceló (p.ej. una actualización que no pudo arrancar
  // su instalador). La app SIGUE viva, así que el overlay se retira y deja ver la
  // interfaz —y el error— en vez de congelarla sobre un cierre que no ocurrirá.
  if (!progress || progress.phase === 'aborted') return null
  const { phase, done, total, label, sub } = progress
  // Determinada si hay contenedores que contar; indeterminada mientras aún no
  // sabemos el total (fase inicial) o en las fases de desmontaje/verificación.
  const determinate = total > 0 && phase === 'stopping'
  const pct = determinate ? Math.round((done / total) * 100) : phase === 'done' ? 100 : 0

  return (
    <div className="shutdown-overlay" role="alertdialog" aria-label="Cerrando Tessera" aria-busy={phase !== 'done'}>
      <div className="shutdown-card">
        <div className="shutdown-title">
          {phase === 'installing' ? 'Actualizando Tessera' : 'Cerrando Tessera'}
        </div>
        {/* El subtítulo lo manda el main cuando lo sabe: solo él conoce si el
            instalador va a relanzar la app (aplicar-al-cerrar no la relanza). */}
        <div className="shutdown-sub">
          {sub ??
            (phase === 'installing'
              ? 'Tessera volverá a abrirse sola al terminar.'
              : 'Deteniendo contenedores Docker…')}
        </div>
        <div className={`shutdown-bar${determinate || phase === 'done' ? '' : ' indeterminate'}`}>
          <div
            className="shutdown-bar-fill"
            style={determinate || phase === 'done' ? { width: `${pct}%` } : undefined}
          />
        </div>
        <div className="shutdown-label">
          {label}
          {total > 0 ? <span className="shutdown-count"> · {done}/{total}</span> : null}
        </div>
      </div>
    </div>
  )
}
