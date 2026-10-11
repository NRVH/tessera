// =============================================================================
// El diálogo con que el usuario contesta lo que ssh pregunta y Tessera no contesta sola: un código de un
// segundo factor, la contraseña tras rechazar el servidor la guardada, o la del explorador SFTP, que no
// tiene terminal. Las preguntas llegan del main en cola y se enseñan de una en una; la respuesta va al
// programa de contraseñas y no se guarda. Lo que escribió el servidor se enseña como suyo.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { SshPreguntaAskpass } from '../../../../shared/ssh-ipc'
import { useDialogo } from '../../comun/useDialogo'
import './conexionesSsh.css'

/** Las preguntas pendientes, en el orden en que llegaron. */
function usePreguntasAskpass(): { actual: SshPreguntaAskpass | null; contestar: (id: string, respuesta: string | null) => void } {
  const [cola, setCola] = useState<SshPreguntaAskpass[]>([])
  useEffect(() => {
    const baja = window.tessera.ssh.onPreguntaAskpass((p) => setCola((c) => [...c, p]))
    const bajaRetirada = window.tessera.ssh.onPreguntaRetirada(({ id }) => setCola((c) => c.filter((p) => p.id !== id)))
    return () => {
      baja()
      bajaRetirada()
    }
  }, [])
  const contestar = (id: string, respuesta: string | null): void => {
    setCola((c) => c.filter((p) => p.id !== id))
    window.tessera.ssh.responderAskpass({ id, respuesta }).catch((err) => console.error('[ssh] responder al askpass falló:', err))
  }
  return { actual: cola[0] ?? null, contestar }
}

/** La pregunta y su campo. */
function DialogoPregunta({ p, contestar }: { p: SshPreguntaAskpass; contestar: (respuesta: string | null) => void }): React.JSX.Element {
  const cancelar = (): void => contestar(null)
  const dlg = useDialogo({ onClose: cancelar })
  const [valor, setValor] = useState('')
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => campo.current?.focus(), [])
  const enviar = (): void => contestar(valor)
  return (
    // Un clic fuera NO cancela: cancelar corta la conexión, y volver de otra ventana a por el código no es eso.
    <div className="modal-overlay" role="presentation">
      <div
        ref={dlg.ref}
        className="modal-card pregunta-askpass"
        role="dialog"
        aria-modal="true"
        aria-label={`Conexión SSH «${p.alias}»`}
        onKeyDown={dlg.alPulsarTecla}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{`Conexión SSH «${p.alias}»`}</div>
        {p.rechazada && <div className="modal-message">La guardada no sirvió. Escríbela; Tessera no la guardará.</div>}
        <label className="modal-label" htmlFor="pregunta-askpass-campo">
          {p.delServidor ? 'El servidor pregunta:' : p.texto}
        </label>
        {p.delServidor && <div className="pregunta-askpass-servidor">{p.texto}</div>}
        <input
          id="pregunta-askpass-campo"
          ref={campo}
          className="modal-input"
          type="password"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            enviar()
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="modal-hint">La respuesta no se guarda. Cancelar corta la conexión.</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={cancelar}>
            Cancelar
          </button>
          <button className="btn primary" onClick={enviar}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Monta el diálogo de la primera pregunta pendiente, si hay alguna. */
export function PreguntaAskpassSsh(): React.JSX.Element | null {
  const { actual, contestar } = usePreguntasAskpass()
  if (actual === null) return null
  // Otra pregunta es otro diálogo: no hereda lo escrito en la anterior.
  return <DialogoPregunta key={actual.id} p={actual} contestar={(r) => contestar(actual.id, r)} />
}
