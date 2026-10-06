// =============================================================================
// Modal «Actualizar agentes» de Docker: rehornea la imagen base (`docker build
// --no-cache`, última versión publicada) y recrea los contenedores, con el progreso
// del build en vivo y las versiones resultantes. Se hace desde el host porque el
// auto-update dentro del contenedor no persiste (npm global de root, usuario neutro).
// Depende de `comun/useDialogo` (Esc, foco y pila de diálogos).
// =============================================================================

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { AgentsUpdateResult } from '../../../../shared/agents-update-ipc'
import { useDialogo } from '../../comun/useDialogo'

interface AgentsUpdateModalProps {
  onClose: () => void
}

type Phase = 'confirm' | 'running' | 'done'

/** Líneas de log que se conservan a la vista (las últimas). */
const MAX_LOG_LINES = 500

/**
 * Ventana deslizante: el build escupe miles de líneas y, sin tope, cada una
 * reconstruía el array entero y re-renderizaba todas las anteriores.
 */
function anadirConTope(prev: string[], line: string): string[] {
  const next = [...prev, line]
  return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
}

function Cabecera({ phase, onClose }: { phase: Phase; onClose: () => void }): React.JSX.Element {
  return (
    <header className="conv-header">
      <div className="conv-header-title">
        <span>Actualizar agentes</span>
        <span className="conv-header-profile">Codex · Claude Code</span>
      </div>
      {phase !== 'running' && (
        <button className="btn btn-icon conv-close" onClick={onClose} title="Cerrar" aria-label="Cerrar">
          ✕
        </button>
      )}
    </header>
  )
}

interface CuerpoProps {
  phase: Phase
  log: string[]
  result: AgentsUpdateResult | null
  logRef: RefObject<HTMLDivElement>
}

function Cuerpo({ phase, log, result, logRef }: CuerpoProps): React.JSX.Element {
  return (
    <div className="agents-update-body">
      {phase === 'confirm' && (
        <p className="agents-update-intro">
          Descarga e instala la última versión de <strong>Codex</strong> y <strong>Claude Code</strong>{' '}
          reconstruyendo la imagen base (unos minutos) y reiniciando los contenedores. Los agentes que
          tengas abiertos se reiniciarán solos sobre la versión nueva.
        </p>
      )}

      {phase !== 'confirm' && (
        <div className="agents-update-log" ref={logRef}>
          {log.map((line, i) => (
            <div key={i} className="agents-update-line">{line}</div>
          ))}
          {phase === 'running' && <div className="agents-update-line dim">…</div>}
        </div>
      )}

      {phase === 'done' && result && (
        <div className={`agents-update-result ${result.ok ? 'ok' : 'err'}`}>
          {result.ok ? (
            <>✓ Agentes actualizados. Ahora: <strong>{result.codex}</strong> · <strong>{result.claude}</strong>.</>
          ) : (
            <>✕ No se pudo actualizar: {result.error}</>
          )}
        </div>
      )}
    </div>
  )
}

function Pie({ phase, onClose, onRun }: { phase: Phase; onClose: () => void; onRun: () => void }): React.JSX.Element {
  return (
    <footer className="agents-update-footer">
      {phase === 'confirm' && (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={onRun}>Actualizar</button>
        </>
      )}
      {phase === 'running' && <span className="agents-update-working">Actualizando… no cierres la app.</span>}
      {phase === 'done' && (
        <button className="btn primary" onClick={onClose}>Cerrar</button>
      )}
    </footer>
  )
}

/** Modal que actualiza los agentes de Docker rehorneando la imagen base. */
export function AgentsUpdateModal({ onClose }: AgentsUpdateModalProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('confirm')
  // Esc y devolución del foco: no se cierra mientras corre (no dejar el build a medias sin querer).
  const dlg = useDialogo({ onClose, cerrable: phase !== 'running' })
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<AgentsUpdateResult | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  /**
   * Desuscripción del progreso, atada al ciclo de vida y no sólo al `finally` de
   * `run()`: el modal puede desmontarse con el build aún en marcha.
   */
  const unsubRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  // Auto-scroll del log al final conforme llegan líneas.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  async function run(): Promise<void> {
    setPhase('running')
    setLog([])
    unsubRef.current = window.tessera.agentsUpdate.onProgress((p) => setLog((prev) => anadirConTope(prev, p.line)))
    try {
      const res = await window.tessera.agentsUpdate.run()
      setResult(res)
    } catch (err) {
      setResult({ ok: false, codex: '?', claude: '?', error: err instanceof Error ? err.message : String(err) })
    } finally {
      unsubRef.current?.()
      unsubRef.current = null
      setPhase('done')
    }
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={() => {
        if (phase !== 'running') onClose()
      }}
    >
      <div ref={dlg.ref} className="agents-update-modal" role="dialog" aria-modal="true" aria-label="Actualizar agentes" onMouseDown={(e) => e.stopPropagation()}>
        <Cabecera phase={phase} onClose={onClose} />
        <Cuerpo phase={phase} log={log} result={result} logRef={logRef} />
        <Pie phase={phase} onClose={onClose} onRun={() => void run()} />
      </div>
    </div>
  )
}
