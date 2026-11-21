// =============================================================================
// El diálogo con que el usuario contesta lo que ssh pregunta y Tessera no contesta sola: un código de un
// segundo factor, la contraseña tras rechazar el servidor la guardada, o la del explorador SFTP, que no
// tiene terminal. Las preguntas llegan del main en cola y se enseñan de una en una; la respuesta va al
// programa de contraseñas y no se guarda. Lo que escribió el servidor se enseña como suyo.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { Presente } from '../../comun/Presente'
import { useEffect, useId, useRef, useState } from 'react'
import type { SshPreguntaAskpass } from '../../../../shared/ssh-ipc'
import { AnfitrionDialogoGlobal, ModalAviso, Modal, ModalPie } from '../../comun/Modal'
import { documentoEnfocado, ventanaSecundariaDe } from '../../util/ventanaDe'
import { useStoreSsh } from './store'
import { txSsh } from './textos.ts'
import './conexionesSsh.css'

interface PreguntaEnCola {
  pregunta: SshPreguntaAskpass
  documento: Document
}

/** Resuelve en qué ventana abrir la pregunta: la enfocada si es secundaria, o la hija dueña de esa conexión. */
function documentoDePregunta(p: SshPreguntaAskpass): Document {
  const enfocado = documentoEnfocado()
  if (enfocado !== document) return enfocado
  const conexion = useStoreSsh.getState().conexiones.find((c) => c.alias === p.alias)
  return (conexion ? ventanaSecundariaDe(conexion.profileId)?.document : undefined) ?? document
}

/** Las preguntas pendientes, en el orden en que llegaron. */
function usePreguntasAskpass(): { actual: PreguntaEnCola | null; contestar: (id: string, respuesta: string | null) => void } {
  const [cola, setCola] = useState<PreguntaEnCola[]>([])
  useEffect(() => {
    const baja = window.tessera.ssh.alPreguntarAskpass((p) =>
      setCola((c) => [...c, { pregunta: p, documento: documentoDePregunta(p) }])
    )
    const bajaRetirada = window.tessera.ssh.alRetirarPregunta(({ id }) => setCola((c) => c.filter((entrada) => entrada.pregunta.id !== id)))
    return () => {
      baja()
      bajaRetirada()
    }
  }, [])
  const contestar = (id: string, respuesta: string | null): void => {
    setCola((c) => c.filter((entrada) => entrada.pregunta.id !== id))
    window.tessera.ssh.responderAskpass({ id, respuesta }).catch((err) => console.error('[ssh] responder al askpass falló:', err))
  }
  return { actual: cola[0] ?? null, contestar }
}

/** La pregunta y su campo. */
function DialogoPregunta({ p, contestar }: { p: SshPreguntaAskpass; contestar: (respuesta: string | null) => void }): React.JSX.Element {
  const cancelar = (): void => contestar(null)
  const [valor, setValor] = useState('')
  const campo = useRef<HTMLInputElement>(null)
  const idCampo = useId()
  useEffect(() => campo.current?.focus(), [])
  const enviar = (): void => contestar(valor)
  const t = txSsh()
  return (
    <Modal titulo={t.preguntaConexion(p.alias)} tamano="s" className="pregunta-askpass" cierraConVelo={false} onCerrar={cancelar}
      pie={<ModalPie>
        <button type="button" className="btn btn-ghost" onClick={cancelar}>{t.cancelar}</button>
        <button type="button" className="btn primary" onClick={enviar}>{t.preguntaEnviar}</button>
      </ModalPie>}
    >
      <Presente visible={p.rechazada} className="mov-despliega"><ModalAviso tono="aviso">{t.preguntaRechazada}</ModalAviso></Presente>
      <div className="modal-campo">
        <label className="modal-label" htmlFor={idCampo}>
          {p.delServidor ? t.preguntaDelServidor : p.texto}
        </label>
        <Presente visible={p.delServidor} className="mov-despliega"><div className="pregunta-askpass-servidor">{p.texto}</div></Presente>
        <input
          id={idCampo}
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
        <div className="modal-hint">{t.preguntaNoSeGuarda}</div>
      </div>
    </Modal>
  )
}

/** Monta el diálogo de la primera pregunta pendiente, si hay alguna. */
export function PreguntaAskpassSsh(): React.JSX.Element | null {
  const { actual, contestar } = usePreguntasAskpass()
  if (actual === null) return null
  // Otra pregunta es otro diálogo: no hereda lo escrito en la anterior.
  return (
    <AnfitrionDialogoGlobal key={actual.pregunta.id} documento={actual.documento}>
      <DialogoPregunta p={actual.pregunta} contestar={(r) => contestar(actual.pregunta.id, r)} />
    </AnfitrionDialogoGlobal>
  )
}
