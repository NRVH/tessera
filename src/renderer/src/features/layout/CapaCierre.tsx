// =============================================================================
// CapaCierre: modal a pantalla completa que refleja el progreso del cierre de la app
// (`shutdown:progress`, emitido por el main mientras detiene los contenedores). No controla
// el cierre. Se mantiene montado siempre y pinta null hasta el primer evento; una vez
// visible no se oculta, salvo si el cierre se aborta.
// Depende de `shared/shutdown-ipc` y de `window.tessera.cierre`.
// =============================================================================

import { useEffect, useState } from 'react'
import type { AvanceCierre } from '../../../../shared/shutdown-ipc'
import { txLayout } from './textos.ts'

/** Overlay de cierre: pinta el progreso de `shutdown:progress` mientras la app sale. */
export function CapaCierre(): React.JSX.Element | null {
  const [progreso, setProgreso] = useState<AvanceCierre | null>(null)
  useEffect(() => window.tessera.cierre.alProgreso((p) => setProgreso(p)), [])

  // `aborted`: el cierre se canceló (p.ej. una actualización que no pudo arrancar
  // su instalador). La app SIGUE viva, así que el overlay se retira y deja ver la
  // interfaz —y el error— en vez de congelarla sobre un cierre que no ocurrirá.
  if (!progreso || progreso.fase === 'aborted') return null
  const { fase, hecho, total, etiqueta, sub } = progreso
  // Determinada si hay contenedores que contar; indeterminada mientras aún no
  // sabemos el total (fase inicial) o en las fases de desmontaje/verificación.
  const determinate = total > 0 && fase === 'stopping'
  const pct = determinate ? Math.round((hecho / total) * 100) : fase === 'done' ? 100 : 0
  const t = txLayout().cierre

  return (
    <div className="shutdown-overlay" role="alertdialog" aria-label={t.aria} aria-busy={fase !== 'done'}>
      <div className="shutdown-card">
        <div className="shutdown-title">
          {fase === 'installing' ? t.actualizando : t.cerrando}
        </div>
        {/* El subtítulo lo manda el main cuando lo sabe: solo él conoce si el
            instalador va a relanzar la app (aplicar-al-cerrar no la relanza). */}
        <div className="shutdown-sub">
          {sub ?? (fase === 'installing' ? t.reabre : t.deteniendo)}
        </div>
        <div className={`shutdown-bar${determinate || fase === 'done' ? '' : ' indeterminate'}`}>
          <div
            className="shutdown-bar-fill"
            style={determinate || fase === 'done' ? { width: `${pct}%` } : undefined}
          />
        </div>
        <div className="shutdown-label">
          {etiqueta}
          {total > 0 ? <span className="shutdown-count"> · {hecho}/{total}</span> : null}
        </div>
      </div>
    </div>
  )
}
