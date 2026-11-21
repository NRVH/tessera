// =============================================================================
// Las huellas de servidores nuevos que esperan a que la persona las compruebe: una cola (se enseñan de una en
// una), el documento desde el que se pidió cada una y quién espera la decisión. `asegurarHuella` es lo que
// llaman «Probar», la terminal y el explorador SFTP antes de conectar; el flujo es el de `huellaNuevaSsh.ts`.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================
import { create } from 'zustand'
import type { SshHuellaNueva } from '../../../../shared/ssh-ipc'
import { documentoEnfocado, ventanaSecundariaDe } from '../../util/ventanaDe'
import { asegurarHuellaCon, unaPorConexion } from './huellaNuevaSsh'

/** Las huellas pendientes, en el orden en que llegaron. */
export const useStoreHuellaNueva = create<{ cola: readonly SshHuellaNueva[] }>(() => ({ cola: [] }))

/** Quién espera la decisión de cada ficha. Fuera del store: no es estado que se pinte. */
const esperando = new Map<string, (confiada: boolean) => void>()

/** Documento origen de cada ficha, para mostrar el diálogo en la ventana que inició la conexión. */
const documentoPorFicha = new Map<string, Document>()

/** Pone la huella en la cola y espera a que la persona decida. */
function preguntar(h: SshHuellaNueva, documento: Document): Promise<boolean> {
  return new Promise((resolver) => {
    esperando.set(h.ficha, resolver)
    documentoPorFicha.set(h.ficha, documento)
    useStoreHuellaNueva.setState((s) => ({ cola: [...s.cola, h] }))
  })
}

/** Documento desde el que se pidió la huella. */
export function documentoDeHuella(ficha: string): Document | undefined {
  return documentoPorFicha.get(ficha)
}

/** La decisión sobre una huella (`true`: confirmada y ya guardada); la saca de la cola. */
export function resolverHuella(ficha: string, confiada: boolean): void {
  esperando.get(ficha)?.(confiada)
  esperando.delete(ficha)
  documentoPorFicha.delete(ficha)
  useStoreHuellaNueva.setState((s) => ({ cola: s.cola.filter((h) => h.ficha !== ficha) }))
}

/** Que la conexión (y sus bastiones) tenga la huella confirmada antes de conectar; ver `asegurarHuellaCon`. */
export const asegurarHuella = unaPorConexion((req) => {
  const doc = (req.profileId ? ventanaSecundariaDe(req.profileId)?.document : undefined) ?? documentoEnfocado()
  return asegurarHuellaCon({ reconocer: (r) => window.tessera.ssh.reconocerHuella(r), preguntar: (h) => preguntar(h, doc) }, req)
})
