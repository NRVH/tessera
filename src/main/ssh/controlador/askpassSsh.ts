// =============================================================================
// El programa de contraseñas visto desde el main: registra `ssh.askpass` en el puente (con fichas propias,
// nunca el token de sesión de un agente), decide cada pregunta con `preguntasAskpass.ts` y da el entorno
// con que se lanza un ssh que usará la contraseña o la frase guardada. Si no se puede (sin puente, sin el
// programa, un secreto ilegible), el ssh se lanza sin él y el motivo vuelve como aviso: nunca el secreto
// en el entorno. El registro apunta la conexión y la decisión, nunca la pregunta ni el secreto.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { nombresSistema } from '../../../shared/nombresSistema.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { PuertaPuente, RespuestaOperacion } from '../../db/dbBridge.ts'
import type { ConexionSshPersistida } from '../conservarAlEditarSsh.ts'
import { FichasAskpass, type UsoFicha } from '../fichasAskpass.ts'
import { decidirPreguntaAskpass } from '../preguntasAskpass.ts'
import { entornoAskpass } from '../programaAskpass.ts'

/** La operación del puente que contesta el programa de contraseñas. */
export const OP_ASKPASS = 'ssh.askpass'

const NO_AUTORIZADO: RespuestaOperacion = { ok: false, error: 'no autorizado' }
const CANCELADA: RespuestaOperacion = { ok: false, error: 'cancelada' }

/** Lo que necesita. */
export interface DepsAskpassSsh {
  /** El puente; sin él (o sin escuchar) no hay programa de contraseñas. */
  puerta: PuertaPuente | null
  conexion: (id: string) => ConexionSshPersistida | undefined
  /** El secreto descifrado; `null` si no tiene o no se puede descifrar aquí. */
  secretoDe: (id: string) => string | null
  /** La copia importada de la clave de una conexión. */
  rutaClave: (id: string) => string
  /** El programa que ssh lanza como `SSH_ASKPASS` (`programaAskpass.ts`). */
  programa: string
  existe: (ruta: string) => boolean
  /** El ejecutable de Tessera, para el lanzador `sh`. */
  exe: string
  plataforma: Plataforma
  fichas?: FichasAskpass
  log?: (mensaje: string) => void
}

/** Cómo se lanza un ssh respecto a su secreto guardado. */
export interface EntornoSecreto {
  /** Tessera contestará: la línea lleva `NumberOfPasswordPrompts=1`. */
  conAskpass: boolean
  env: Record<string, string>
  /** La ficha emitida, para revocarla al terminar; `null` sin programa de contraseñas. */
  ficha: string | null
  /** Hay un secreto guardado y no se usará: por qué, para el usuario. */
  aviso?: string
}

/** Un ssh lanzado sin el programa de contraseñas: el secreto, si lo pide, se teclea. */
export const SIN_SECRETO: EntornoSecreto = Object.freeze({ conAskpass: false, env: Object.freeze({}) as Record<string, string>, ficha: null })

/** El secreto de una conexión, nombrado para una frase («La contraseña guardada…»). */
function nombreSecreto(c: ConexionSshPersistida): string {
  return c.metodo === 'clave' ? 'La frase guardada de la clave' : 'La contraseña guardada'
}

/** El programa de contraseñas de las conexiones SSH. */
export class AskpassSsh {
  private readonly d: DepsAskpassSsh
  private readonly fichas: FichasAskpass
  private readonly log: (mensaje: string) => void
  /** Conexiones cuyo servidor pidió algo que Tessera no contesta: sus pestañas se teclean hasta que se editen. */
  private readonly aTeclear = new Set<string>()

  constructor(d: DepsAskpassSsh) {
    this.d = d
    this.fichas = d.fichas ?? new FichasAskpass()
    this.log = d.log ?? (() => {})
    d.puerta?.registrarOperacion(OP_ASKPASS, { token: 'propio', manejar: (p) => this.contestar(p) })
  }

  /**
   * El entorno de un ssh que usará el secreto guardado de `c`, con una ficha de `uso`. Una pestaña cuyo
   * servidor ya pidió algo que Tessera no contesta se lanza sin él (`pestana`); «Probar» lo intenta igual.
   */
  entorno(c: ConexionSshPersistida, uso: UsoFicha, pestana: boolean): EntornoSecreto {
    if (c.metodo === 'sistema' || typeof c.secretEnc !== 'string' || c.secretEnc === '') return SIN_SECRETO
    const nombre = nombreSecreto(c)
    const sin = (porque: string): EntornoSecreto => ({ ...SIN_SECRETO, aviso: `${nombre} no se usa: ${porque}` })
    if (this.d.secretoDe(c.id) === null) {
      return sin(`no se puede leer con ${nombresSistema(this.d.plataforma).almacenSecretos}. Escríbela cuando la pida y vuelve a guardarla editando la conexión.`)
    }
    if (pestana && this.aTeclear.has(c.id)) return sin('el servidor pidió algo que Tessera no contesta. Escribe tú las respuestas en la terminal.')
    const puerta = this.d.puerta
    if (puerta === null || !puerta.listo || puerta.pipe === '') return sin('el puente local de Tessera no está disponible. Escríbela cuando la pida.')
    if (!this.d.existe(this.d.programa)) return sin('falta el programa con que Tessera la da. Escríbela cuando la pida.')
    const ficha = this.fichas.emitir(c.id, uso)
    const env = entornoAskpass({ programa: this.d.programa, pipe: puerta.pipe, token: ficha, plataforma: this.d.plataforma, exe: this.d.exe })
    return { conAskpass: true, env, ficha }
  }

  /** La ficha deja de valer; devuelve si recibió alguna pregunta que Tessera no contesta. */
  soltar(ficha: string | null): boolean {
    if (ficha === null) return false
    const sinContestar = this.fichas.sinContestar(ficha)
    this.fichas.revocar(ficha)
    return sinContestar
  }

  /** La conexión cambió (o se borró): sus pestañas vuelven a intentar con el secreto guardado. */
  alCambiarConexion(id: string): void {
    this.aTeclear.delete(id)
  }

  /** `ssh.askpass`: la ficha, la pregunta y, solo si es la de esa conexión, su secreto. */
  private contestar(p: Record<string, unknown>): RespuestaOperacion {
    const token = typeof p.token === 'string' ? p.token : ''
    const id = this.fichas.usar(token)
    if (id === null) return NO_AUTORIZADO
    const cancelar = (motivo: string): RespuestaOperacion => {
      this.fichas.anotarSinContestar(token)
      this.aTeclear.add(id)
      this.log(`askpass conexion=${id} cancelada (${motivo})`)
      return CANCELADA
    }
    const c = this.d.conexion(id)
    if (c === undefined) return cancelar('la conexión ya no existe')
    const rutaClave = c.metodo === 'clave' ? this.d.rutaClave(c.id) : undefined
    const decision = decidirPreguntaAskpass(typeof p.prompt === 'string' ? p.prompt : '', { ...c, rutaClave }, this.d.plataforma)
    if (!decision.contesta) return cancelar(decision.motivo)
    const secreto = this.d.secretoDe(id)
    if (secreto === null) return cancelar('sin secreto legible')
    this.log(`askpass conexion=${id} contestada (${decision.que === 'frase' ? 'frase de la clave' : 'contraseña'})`)
    return { ok: true, respuesta: secreto }
  }
}
