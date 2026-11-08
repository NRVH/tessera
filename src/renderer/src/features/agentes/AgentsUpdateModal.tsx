// =============================================================================
// Modal «Actualizar agentes» de Docker: rehornea la imagen base (`docker build
// --no-cache`, última versión publicada) y recrea los contenedores, con el progreso
// del build en vivo y las versiones resultantes. Se hace desde el host porque el
// auto-update dentro del contenedor no persiste (npm global de root, usuario neutro).
// Depende de `comun/Modal` (Esc, foco y pila de diálogos).
// =============================================================================

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { AgentsUpdateResult } from '../../../../shared/agents-update-ipc'
import { AvisoModal, Modal, PieModal } from '../../comun/Modal'
import { txActualizacion } from './textosActualizacion.ts'

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

interface CuerpoProps {
  phase: Phase
  log: string[]
  result: AgentsUpdateResult | null
  logRef: RefObject<HTMLDivElement>
}

function Cuerpo({ phase, log, result, logRef }: CuerpoProps): React.JSX.Element {
  const t = txActualizacion().modal
  return (
    <div className="agents-update-body">
      {phase === 'confirm' && (
        <p className="agents-update-intro">
          {t.introA}
          <strong>Codex</strong>
          {t.introY}
          <strong>Claude Code</strong>
          {t.introB}
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
        <AvisoModal tono={result.ok ? 'exito' : 'error'}>
          {result.ok ? (
            <>
              {t.okAntes}
              <strong>{result.codex}</strong>
              {t.okSep}
              <strong>{result.claude}</strong>
              {t.okDespues}
            </>
          ) : (
            <>
              {t.fallo}
              {result.error}
            </>
          )}
        </AvisoModal>
      )}
      {phase === 'running' && <div className="agents-update-working" role="status">{t.trabajando}</div>}
    </div>
  )
}

/** Modal que actualiza los agentes de Docker rehorneando la imagen base. */
export function AgentsUpdateModal({ onClose }: AgentsUpdateModalProps): React.JSX.Element {
  const t = txActualizacion().modal
  const [phase, setPhase] = useState<Phase>('confirm')
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
    <Modal titulo={t.titulo} subtitulo={t.agentes} className="agents-update-modal" tamano="m"
      cerrable={phase !== 'running'} cierraConVelo={phase !== 'running'} ocupado={phase === 'running'} onCerrar={onClose}
      pie={phase === 'confirm' ? <PieModal>
        <button className="btn btn-ghost" onClick={onClose}>{t.cancelar}</button>
        <button className="btn primary" onClick={() => void run()}>{t.actualizar}</button>
      </PieModal> : undefined}>
      <Cuerpo phase={phase} log={log} result={result} logRef={logRef} />
    </Modal>
  )
}
