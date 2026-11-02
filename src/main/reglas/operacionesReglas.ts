// =============================================================================
// Las operaciones de `tctx`, con el token de SESIÓN: `ctx.reglas` (las vigentes del perfil) y `ctx.proponer`
// (deja la propuesta pendiente y avisa). El perfil sale siempre de la sesión, nunca de la petición. Los
// rechazos van como código (`rechazo`), y el texto lo pone `tctx` en su idioma. Las registra en el puente
// y las atiende también el buzón de Docker (`buzonTctx.ts`). Sin electron.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { MAX_MOTIVO_PROPUESTA, MAX_REGLAS_PERFIL, normalizarReglas } from '../../shared/reglasPerfil.ts'
import { enUnaLinea } from '../../shared/textoParaAviso.ts'
import type { PuertaPuente, RespuestaOperacion, SesionDelPuente } from '../db/dbBridge.ts'
import type { PropuestasReglas } from './propuestasReglas.ts'

export const OP_REGLAS = 'ctx.reglas'
export const OP_PROPONER = 'ctx.proponer'

/** Los códigos de salida de `tctx` (los mismos en `src/tctx/tctxSalida.cjs`, que lo fija `test:tctx`). */
export const CODIGOS_TCTX = { uso: 2, puente: 3, rechazo: 4 } as const

/** Lo que necesitan. */
export interface DepsOperacionesReglas {
  /** Las reglas vigentes de un perfil (`''` sin reglas), o `null` si el perfil ya no existe. */
  reglasDe: (profileId: string) => string | null
  propuestas: Pick<PropuestasReglas, 'guardar'>
  /** Avisa de que ha llegado una propuesta (el evento al renderer). */
  alProponer: (profileId: string) => void
  ahora?: () => number
  log?: (mensaje: string) => void
}

/** El nombre de la carpeta del proyecto, sin la ruta del equipo; nada si la sesión es del espacio de datos. */
function nombreProyecto(s: SesionDelPuente): string | undefined {
  if (s.espacioDatos) return undefined
  const partes = s.projectHostPath.split(/[\\/]/).filter(Boolean)
  return partes.length > 0 ? partes[partes.length - 1] : undefined
}

/** Las operaciones de `tctx`. */
export class OperacionesReglas {
  private readonly d: DepsOperacionesReglas

  constructor(d: DepsOperacionesReglas) {
    this.d = d
  }

  /** Las registra en el puente; sin puente, `tctx` dirá que Tessera no contesta. */
  registrar(puerta: PuertaPuente | null): void {
    if (!puerta) return
    puerta.registrarOperacion(OP_REGLAS, { token: 'sesion', manejar: (_p, s) => this.reglas(s) })
    puerta.registrarOperacion(OP_PROPONER, { token: 'sesion', manejar: (p, s) => this.proponer(p, s) })
  }

  /** Atiende una operación por su nombre (el buzón de Docker); una desconocida, como el puente. */
  atender(op: unknown, peticion: Readonly<Record<string, unknown>>, sesion: SesionDelPuente): RespuestaOperacion {
    if (op === OP_REGLAS) return this.reglas(sesion)
    if (op === OP_PROPONER) return this.proponer(peticion, sesion)
    return { ok: false, error: 'operacion desconocida' }
  }

  /** Las reglas vigentes del perfil de la sesión. */
  reglas(s: SesionDelPuente): RespuestaOperacion {
    const reglas = this.d.reglasDe(s.profileId)
    if (reglas === null) return { ok: false, rechazo: 'sin-perfil' }
    return { ok: true, reglas }
  }

  /** Deja la propuesta del perfil de la sesión, si es una propuesta de verdad, y avisa. */
  proponer(p: Readonly<Record<string, unknown>>, s: SesionDelPuente): RespuestaOperacion {
    const vigentes = this.d.reglasDe(s.profileId)
    if (vigentes === null) return { ok: false, rechazo: 'sin-perfil' }
    if (typeof p.texto !== 'string' || (p.motivo !== undefined && typeof p.motivo !== 'string')) return { ok: false, rechazo: 'peticion' }
    const texto = normalizarReglas(p.texto)
    if (texto === '') return { ok: false, rechazo: 'vacia' }
    if (texto.length > MAX_REGLAS_PERFIL) return { ok: false, rechazo: 'larga', largo: texto.length, max: MAX_REGLAS_PERFIL }
    if (texto === normalizarReglas(vigentes)) return { ok: false, rechazo: 'igual' }
    const motivo = enUnaLinea(typeof p.motivo === 'string' ? p.motivo : '')
    if (motivo.length > MAX_MOTIVO_PROPUESTA) return { ok: false, rechazo: 'motivo-largo', max: MAX_MOTIVO_PROPUESTA }
    const proyecto = nombreProyecto(s)
    const en = (this.d.ahora ?? Date.now)()
    this.d.propuestas.guardar({ profileId: s.profileId, texto, motivo, en, ...(proyecto ? { proyecto } : {}) })
    this.d.log?.(`propuesta de reglas del perfil ${s.profileId} (${texto.length} caracteres)`)
    this.d.alProponer(s.profileId)
    return { ok: true }
  }
}
