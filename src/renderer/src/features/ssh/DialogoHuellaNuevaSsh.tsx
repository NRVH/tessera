// =============================================================================
// El diálogo de la huella de un servidor nuevo: antes de enviarle la contraseña (o de identificarse con la
// clave), la persona compara la huella por otra vía y decide. «Confiar y conectar» la guarda (el main la tiene
// pendiente por su ficha; el renderer no le manda la huella) y la operación sigue; Cancelar, la ✕ o Esc no
// guardan nada y no se conecta. El foco empieza en Cancelar: confiar no se hace por reflejo con Intro.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md, docs/decisiones/renderer/dialogos-foco-y-teclado.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { SshHuella, SshHuellaNueva } from '../../../../shared/ssh-ipc'
import { IconoCopiar } from '../../comun/iconosMenu'
import { AvisoConPresencia, AvisoModal, Modal, PieModal } from '../../comun/Modal'
import { Grupo } from '../../comun/piezasAjustes'
import { notifyError } from '../../comun/notifications'
import { useConfirmacionCopiar } from '../../comun/useConfirmacionCopiar'
import { mensajeDeErrorSsh } from './erroresSsh'
import { destinoHuella } from './huellaNuevaSsh'
import { etiquetaAlgoritmo } from './pistasPruebaSsh'
import { resolverHuella, useStoreHuellaNueva } from './storeHuellaNueva'
import { txSsh } from './textos.ts'
import './conexionesSsh.css'

/** Una huella: su tipo, su valor (que parte en vez de salirse) y copiarla, con la confirmación en el propio botón. */
function FilaHuella({ h }: { h: SshHuella }): React.JSX.Element {
  const { copiado, confirmar } = useConfirmacionCopiar()
  const t = txSsh()
  const valor = `SHA256:${h.sha256}`
  const copiar = (): void => {
    window.tessera.clipboard
      .write(valor)
      .then(confirmar)
      .catch((err: unknown) => notifyError(t.huellaNoCopiada, err))
  }
  const rotulo = copiado ? t.huellaCopiada : t.huellaCopiar
  return (
    <div className="ajustes-fila huella-nueva-fila">
      <span className="ajustes-fila-etiqueta huella-nueva-algoritmo">{etiquetaAlgoritmo(h.algoritmo)}</span>
      <code className="huella-nueva-valor">{valor}</code>
      <button type="button" className="btn btn-icon" onClick={copiar} title={rotulo} aria-label={rotulo}>
        <IconoCopiar copiado={copiado} />
      </button>
    </div>
  )
}

/** El diálogo de una huella pendiente. */
function DialogoHuella({ h }: { h: SshHuellaNueva }): React.JSX.Element {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelarRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelarRef.current?.focus(), [])
  const t = txSsh()
  const cancelar = (): void => {
    if (ocupado) return
    window.tessera.ssh.descartarHuella({ ficha: h.ficha }).catch((err: unknown) => console.error('[ssh] descartar la huella falló:', err))
    resolverHuella(h.ficha, false)
  }
  const confiar = async (): Promise<void> => {
    setOcupado(true)
    setError(null)
    try {
      await window.tessera.ssh.confiarHuella({ ficha: h.ficha })
      resolverHuella(h.ficha, true)
    } catch (err) {
      setError(mensajeDeErrorSsh(err))
      setOcupado(false)
    }
  }
  const [antes, despues] = t.huellaPrimeraVez(destinoHuella(h.host, h.puerto))
  return (
    <Modal
      titulo={t.huellaTitulo}
      severidad="advertencia"
      tamano="m"
      className="huella-nueva"
      cierraConVelo={false}
      cerrable={!ocupado}
      ocupado={ocupado}
      onCerrar={cancelar}
      pie={
        <PieModal>
          <button ref={cancelarRef} type="button" className="btn btn-ghost" onClick={cancelar} disabled={ocupado}>
            {t.cancelar}
          </button>
          <button type="button" className="btn primary" onClick={() => void confiar()} disabled={ocupado}>
            {t.huellaConfiar}
          </button>
        </PieModal>
      }
    >
      <p className="modal-message">
        {antes}
        <strong>{h.alias}</strong>
        {despues} {t.huellaCompruebe(h.metodo === 'contrasena')}
      </p>
      {h.bastionDe !== undefined && <p className="modal-message">{t.huellaBastion(h.bastionDe)}</p>}
      <Grupo titulo={t.huellaGrupo}>
        {h.huellas.map((x) => (
          <FilaHuella key={`${x.algoritmo} ${x.sha256}`} h={x} />
        ))}
      </Grupo>
      <AvisoConPresencia>{error && <AvisoModal tono="error">{error}</AvisoModal>}</AvisoConPresencia>
    </Modal>
  )
}

/** Monta el diálogo de la primera huella pendiente, si hay alguna. */
export function DialogoHuellaNuevaSsh(): React.JSX.Element | null {
  const actual = useStoreHuellaNueva((s) => s.cola[0] ?? null)
  if (actual === null) return null
  // Otra huella es otro diálogo: no hereda el estado del anterior.
  return <DialogoHuella key={actual.ficha} h={actual} />
}
