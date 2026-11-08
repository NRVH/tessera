// =============================================================================
// Las huellas de servidores nuevos que esperan a que la persona las compruebe: una cola (se enseñan de una en
// una) y, por ficha, quién espera la decisión. `asegurarHuella` es lo que llaman «Probar», la terminal y el
// explorador SFTP antes de conectar; el flujo es el de `huellaNuevaSsh.ts` sobre el IPC del preload.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================
import { create } from 'zustand'
import type { SshHuellaNueva } from '../../../../shared/ssh-ipc'
import { asegurarHuellaCon, unaPorConexion } from './huellaNuevaSsh'

/** Las huellas pendientes, en el orden en que llegaron. */
export const useStoreHuellaNueva = create<{ cola: readonly SshHuellaNueva[] }>(() => ({ cola: [] }))

/** Quién espera la decisión de cada ficha. Fuera del store: no es estado que se pinte. */
const esperando = new Map<string, (confiada: boolean) => void>()

/** Pone la huella en la cola y espera a que la persona decida. */
function preguntar(h: SshHuellaNueva): Promise<boolean> {
  return new Promise((resolver) => {
    esperando.set(h.ficha, resolver)
    useStoreHuellaNueva.setState((s) => ({ cola: [...s.cola, h] }))
  })
}

/** La decisión sobre una huella (`true`: confirmada y ya guardada); la saca de la cola. */
export function resolverHuella(ficha: string, confiada: boolean): void {
  esperando.get(ficha)?.(confiada)
  esperando.delete(ficha)
  useStoreHuellaNueva.setState((s) => ({ cola: s.cola.filter((h) => h.ficha !== ficha) }))
}

/** Que la conexión (y sus bastiones) tenga la huella confirmada antes de conectar; ver `asegurarHuellaCon`. */
export const asegurarHuella = unaPorConexion((req) => asegurarHuellaCon({ reconocer: (r) => window.tessera.ssh.reconocerHuella(r), preguntar }, req))
