// =============================================================================
// Las operaciones de `tctx`, con el token de SESIÓN: `ctx.reglas` (las vigentes del perfil y las globales que
// recibe) y `ctx.proponer` (deja la propuesta pendiente, del perfil o de las globales, y avisa). El perfil sale siempre de la sesión, nunca de la petición. Los
// rechazos van como código (`rechazo`), y el texto lo pone `tctx` en su idioma. Las registra en el puente
// y las atiende también el buzón de Docker (`buzonTctx.ts`). Sin electron.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { MAX_MOTIVO_PROPUESTA, MAX_REGLAS_PERFIL, normalizarReglas } from '../../shared/reglasPerfil.ts'
import { enUnaLinea } from '../../shared/textoParaAviso.ts'
import type { PuertaPuente, RespuestaOperacion, SesionDelPuente } from '../db/puenteBd.ts'
import type { PropuestasReglas } from './propuestasReglas.ts'
import { ID_REGLAS_GLOBALES } from '../../shared/reglas-ipc.ts'

export const OP_REGLAS = 'ctx.reglas'
export const OP_PROPONER = 'ctx.proponer'

/** Los códigos de salida de `tctx` (los mismos en `src/tctx/tctxSalida.cjs`, que lo fija `test:tctx`). */
export const CODIGOS_TCTX = { uso: 2, puente: 3, rechazo: 4, fallida: 5, cancelada: 6, enMarcha: 7, interrumpida: 8 } as const

/** Lo que necesitan. */
export interface DependenciasOperacionesReglas {
  /** Las reglas vigentes de un perfil (`''` sin reglas), o `null` si el perfil ya no existe. */
  reglasDe: (perfilId: string) => string | null
  /** Las reglas globales vigentes (`''` sin reglas). */
  reglasGlobales: () => string
  /** Si los agentes del perfil reciben las globales. */
  usaGlobales: (perfilId: string) => boolean
  propuestas: Pick<PropuestasReglas, 'guardar'>
  /** Avisa de que ha llegado una propuesta (el evento al renderer). */
  alProponer: (perfilId: string) => void
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
  private readonly d: DependenciasOperacionesReglas

  constructor(d: DependenciasOperacionesReglas) {
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

  /** Las reglas vigentes del perfil de la sesión y, si las usa, las globales. */
  reglas(s: SesionDelPuente): RespuestaOperacion {
    const reglas = this.d.reglasDe(s.profileId)
    if (reglas === null) return { ok: false, rechazo: 'sin-perfil' }
    return { ok: true, reglas, reglasGlobales: this.d.usaGlobales(s.profileId) ? this.d.reglasGlobales() : '' }
  }

  /**
   * Deja la propuesta de las reglas del perfil de la sesión o, con `nivel: 'global'`, de las globales, si es una
   * propuesta de verdad, y avisa.
   */
  proponer(p: Readonly<Record<string, unknown>>, s: SesionDelPuente): RespuestaOperacion {
    const delPerfil = this.d.reglasDe(s.profileId)
    if (delPerfil === null) return { ok: false, rechazo: 'sin-perfil' }
    if (p.nivel !== undefined && p.nivel !== 'global') return { ok: false, rechazo: 'peticion' }
    const global = p.nivel === 'global'
    // Un perfil sin el global no ve las vigentes: una versión entera suya las sustituiría a ciegas.
    if (global && !this.d.usaGlobales(s.profileId)) return { ok: false, rechazo: 'sin-global' }
    const vigentes = global ? this.d.reglasGlobales() : delPerfil
    if (typeof p.texto !== 'string' || (p.motivo !== undefined && typeof p.motivo !== 'string')) return { ok: false, rechazo: 'peticion' }
    const texto = normalizarReglas(p.texto)
    if (texto === '') return { ok: false, rechazo: 'vacia' }
    if (texto.length > MAX_REGLAS_PERFIL) return { ok: false, rechazo: 'larga', largo: texto.length, max: MAX_REGLAS_PERFIL }
    if (texto === normalizarReglas(vigentes)) return { ok: false, rechazo: 'igual' }
    const motivo = enUnaLinea(typeof p.motivo === 'string' ? p.motivo : '')
    if (motivo.length > MAX_MOTIVO_PROPUESTA) return { ok: false, rechazo: 'motivo-largo', max: MAX_MOTIVO_PROPUESTA }
    const proyecto = nombreProyecto(s)
    const en = (this.d.ahora ?? Date.now)()
    const destino = global ? ID_REGLAS_GLOBALES : s.profileId
    this.d.propuestas.guardar({ profileId: destino, texto, motivo, en, ...(proyecto ? { proyecto } : {}), ...(global ? { desdePerfil: s.profileId } : {}) })
    this.d.log?.(`propuesta de reglas ${global ? 'globales' : `del perfil ${s.profileId}`} (${texto.length} caracteres)`)
    this.d.alProponer(destino)
    return { ok: true }
  }
}
