// =============================================================================
// La operación `ctx.docs` de `tctx`: sin nombre, la lista de documentos del perfil de la sesión; con nombre,
// su contenido. El perfil sale del token de la sesión, nunca de la petición, así que un agente solo ve los
// documentos de su propio perfil. Los rechazos van como código y el texto lo pone `tctx`.
// Decisiones: docs/decisiones/agentes/documentos-del-perfil.md
// =============================================================================

import type { RespuestaOperacion, SesionDelPuente } from '../db/dbBridge.ts'
import { leerDocumento, listarDocumentos } from './documentosPerfil.ts'

export const OP_DOCS = 'ctx.docs'

/** Lo más largo que se acepta como nombre de un documento. */
const MAX_NOMBRE = 300

export interface DepsDocs {
  /** Las carpetas de un perfil (vacía si no tiene), o `null` si el perfil ya no existe. */
  carpetasDe: (profileId: string) => readonly string[] | null
}

export async function atenderDocs(d: DepsDocs, p: Readonly<Record<string, unknown>>, s: SesionDelPuente): Promise<RespuestaOperacion> {
  const carpetas = d.carpetasDe(s.profileId)
  if (carpetas === null) return { ok: false, rechazo: 'sin-perfil' }
  if (carpetas.length === 0) return { ok: false, rechazo: 'sin-documentos' }
  if (p.nombre === undefined) {
    const l = await listarDocumentos(carpetas)
    return { ok: true, documentos: l.documentos, noDisponibles: l.noDisponibles, truncado: l.truncado }
  }
  if (typeof p.nombre !== 'string' || p.nombre.trim() === '' || p.nombre.length > MAX_NOMBRE) return { ok: false, rechazo: 'peticion' }
  const r = await leerDocumento(carpetas, p.nombre.trim())
  switch (r.estado) {
    case 'ok':
      return { ok: true, nombre: r.nombre, contenido: r.contenido }
    case 'ambiguo':
      return { ok: false, rechazo: 'doc-ambiguo', candidatos: r.candidatos }
    case 'grande':
      return { ok: false, rechazo: 'doc-grande', bytes: r.bytes }
    case 'no-texto':
      return { ok: false, rechazo: 'doc-no-texto' }
    case 'no-existe':
      return { ok: false, rechazo: 'doc-no-existe' }
  }
}
