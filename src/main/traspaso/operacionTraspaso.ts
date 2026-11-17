// =============================================================================
// `tctx traspaso`: la operación `ctx.traspaso` del puente, con el token de SESIÓN. Da el traspaso de la sesión
// que pregunta (la del token, nunca una de la petición) y solo dentro de su perfil; las veces que lo pida
// mientras viva, porque un agente puede perderlo al compactar o fallar la primera vez dentro de su sandbox.
// La registra `reglas/componer.ts` en el puente y en el buzón de Docker, con las de las reglas. Sin electron.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import type { RespuestaOperacion, SesionDelPuente } from '../db/puenteBd.ts'
import type { RegistroTraspasos } from './RegistroTraspasos.ts'

export const OP_TRASPASO = 'ctx.traspaso'

/** El traspaso de la sesión del token, o el rechazo `sin-traspaso` (el texto lo pone `tctx`). */
export function atenderTraspaso(registro: Pick<RegistroTraspasos, 'deSesion'>, s: SesionDelPuente): RespuestaOperacion {
  const contenido = registro.deSesion(s.sesion, s.profileId)
  if (contenido === null) return { ok: false, rechazo: 'sin-traspaso' }
  return { ok: true, traspaso: contenido }
}
