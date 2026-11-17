// =============================================================================
// Antes de «Probar», abrir una terminal SSH o el explorador SFTP: que cada servidor de la cadena tenga su
// huella confirmada. Mientras el main encuentre uno sin ella, la persona la compara y decide, un servidor
// a la vez y en el orden en que se llega (los bastiones primero). Una sola comprobación por conexión a la
// vez: dos pestañas que se abren juntas esperan a la misma. Puro: el IPC y el diálogo llegan por parámetro
// y se fija bajo `node` (`test-huella-nueva-ssh.mts`).
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================

import { SSH_SALTOS_MAX, type SshHuellaNueva, type SshReconocerHuella, type SshReconocimiento, type SshResultadoPrueba } from '../../../../shared/ssh-ipc.ts'

/** En qué quedó: todo confirmado, la persona no confirmó una, o no se pudo traer (con el resultado como el de «Probar»). */
export type ResultadoHuellaSsh =
  | { tipo: 'lista' }
  | { tipo: 'cancelada' }
  | { tipo: 'fallo'; resultado: Extract<SshResultadoPrueba, { ok: false }> }

/** Lo que necesita. */
export interface DependenciasHuellaSsh {
  reconocer: (req: SshReconocerHuella) => Promise<SshReconocimiento>
  /** Enseña la huella; `true` cuando la persona la confirmó y quedó guardada, `false` si no la confirmó. */
  preguntar: (h: SshHuellaNueva) => Promise<boolean>
}

/**
 * Pregunta hasta que no quede servidor sin huella. Cada vuelta guarda uno, así que como mucho hay tantas como
 * bastiones más el destino; si aun así quedara alguno, la línea estricta de ssh lo rechaza y dice por qué.
 */
export async function asegurarHuellaCon(d: DependenciasHuellaSsh, req: SshReconocerHuella): Promise<ResultadoHuellaSsh> {
  for (let vuelta = 0; vuelta <= SSH_SALTOS_MAX; vuelta++) {
    const r = await d.reconocer(req)
    if (r.tipo === 'conocida') return { tipo: 'lista' }
    if (r.tipo === 'fallo') return r
    const { tipo: _tipo, ...nueva } = r
    if (!(await d.preguntar(nueva))) return { tipo: 'cancelada' }
  }
  return { tipo: 'lista' }
}

/** La misma comprobación para quien la pida mientras otra de esa conexión sigue en marcha. */
export function unaPorConexion<R>(f: (req: SshReconocerHuella) => Promise<R>): (req: SshReconocerHuella) => Promise<R> {
  const enCurso = new Map<string, Promise<R>>()
  return (req) => {
    const ya = enCurso.get(req.id)
    if (ya !== undefined) return ya
    const p = f(req).finally(() => enCurso.delete(req.id))
    enCurso.set(req.id, p)
    return p
  }
}

/** `host:puerto` como se escribe en un destino: una dirección IPv6 entre corchetes. */
export function destinoHuella(host: string, puerto: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${puerto}`
}
