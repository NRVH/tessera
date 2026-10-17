// =============================================================================
// El programa de contraseñas visto desde el main: registra `ssh.askpass` en el puente (con fichas propias,
// nunca el token de sesión de un agente), decide cada pregunta con `preguntasAskpass.ts` y da el entorno
// con que se lanza un ssh que usará la contraseña o la frase guardada. Con una ficha de diálogo, lo que
// Tessera no contesta sola (un código, la contraseña tras rechazar la guardada) lo contesta el usuario en
// la ventana, sin guardarlo. Si no se puede (sin puente, sin el programa, un secreto ilegible), el ssh se
// lanza sin él y el motivo vuelve como aviso: nunca el secreto en el entorno. El registro apunta la
// conexión y la decisión, nunca la pregunta, la respuesta ni el secreto.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { nombresSistema } from '../../../shared/nombresSistema.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { PuertaPuente, RespuestaOperacion } from '../../db/dbBridge.ts'
import type { ConexionSshPersistida } from '../conservarAlEditarSsh.ts'
import { FICHA_PESTANA, FichasAskpass, type UsoFicha } from '../fichasAskpass.ts'
import { decidirPreguntaAskpass, type DecisionAskpass } from '../preguntasAskpass.ts'
import { entornoAskpass } from '../programaAskpass.ts'
import { textoPregunta, type PreguntaUsuario } from './dialogoAskpass.ts'
import { txSsh } from '../textos.ts'

/** La operación del puente que contesta el programa de contraseñas. */
export const OP_ASKPASS = 'ssh.askpass'

const NO_AUTORIZADO: RespuestaOperacion = { ok: false, error: 'no autorizado' }
const CANCELADA: RespuestaOperacion = { ok: false, error: 'cancelada' }

/** Quien pregunta al usuario en la ventana (`DialogoAskpass`). */
export interface PreguntadorAskpass {
  preguntar(p: PreguntaUsuario, alAbrir?: (id: string) => void): Promise<string | null>
  retirar(id: string): void
}

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
  /** Sin él, lo que Tessera no contesta sola se cancela. */
  dialogo?: PreguntadorAskpass
  fichas?: FichasAskpass
  log?: (mensaje: string) => void
}

/** Cómo se lanza un ssh respecto a su secreto guardado. */
export interface EntornoSecreto {
  /** Tessera contestará: la línea lleva `NumberOfPasswordPrompts`. */
  conAskpass: boolean
  /** Lo que Tessera no contesta sola lo contesta el usuario en un diálogo: ssh puede volver a preguntar. */
  conDialogo: boolean
  env: Record<string, string>
  /** La ficha emitida, para revocarla al terminar; `null` sin programa de contraseñas. */
  ficha: string | null
  /** Hay un secreto guardado y no se usará: por qué, para el usuario. */
  aviso?: string
}

/** Un ssh lanzado sin el programa de contraseñas: el secreto, si lo pide, se teclea. */
export const SIN_SECRETO: EntornoSecreto = Object.freeze({
  conAskpass: false,
  conDialogo: false,
  env: Object.freeze({}) as Record<string, string>,
  ficha: null
})

/** El secreto de una conexión, nombrado para una frase («La contraseña guardada…»). */
function nombreSecreto(c: ConexionSshPersistida): string {
  return c.metodo === 'clave' ? txSsh().askpass.fraseGuardada : txSsh().askpass.passwordGuardada
}

/** ¿Tiene la conexión un secreto guardado que su método usa? */
function tieneSecreto(c: ConexionSshPersistida): boolean {
  return c.metodo !== 'sistema' && typeof c.secretEnc === 'string' && c.secretEnc !== ''
}

/**
 * Lo que el diálogo enseña de una pregunta: la propia de la conexión con palabras de Tessera; otra, tal cual.
 * Solo las de keyboard-interactive las escribe el servidor (ssh les antepone «(usuario@host) »); las demás
 * son del ssh local, como la frase de una clave del sistema.
 */
function preguntaParaUsuario(c: ConexionSshPersistida, prompt: string, decision: DecisionAskpass, rechazada: boolean): PreguntaUsuario {
  if (!decision.contesta) return { alias: c.alias, texto: textoPregunta(prompt), delServidor: /^\([^)]*\) /.test(prompt), rechazada: false }
  const texto = decision.que === 'frase' ? txSsh().askpass.preguntaFrase : txSsh().askpass.preguntaPassword(c.usuario, c.host)
  return { alias: c.alias, texto: textoPregunta(texto), delServidor: false, rechazada }
}

/** El programa de contraseñas de las conexiones SSH. */
export class AskpassSsh {
  private readonly d: DepsAskpassSsh
  private readonly fichas: FichasAskpass
  private readonly log: (mensaje: string) => void
  /** Conexiones cuyo servidor pidió algo que Tessera no contesta: sus pestañas se teclean hasta que se editen. */
  private readonly aTeclear = new Set<string>()
  /** ficha -> diálogos abiertos, para retirarlos cuando su ssh termina. */
  private readonly dialogos = new Map<string, Set<string>>()
  /** ficha -> cómo terminar su ssh si el usuario no contesta. */
  private readonly matarDe = new Map<string, () => void>()

  constructor(d: DepsAskpassSsh) {
    this.d = d
    this.fichas = d.fichas ?? new FichasAskpass()
    this.log = d.log ?? (() => {})
    d.puerta?.registrarOperacion(OP_ASKPASS, { token: 'propio', manejar: (p) => this.contestar(p) })
  }

  /**
   * El entorno de un ssh que usará el secreto guardado de `c` (y el de sus bastiones, `saltos`), con una ficha
   * de `uso`. Una pestaña cuyo servidor ya pidió algo que Tessera no contesta se lanza sin él (`pestana`);
   * «Probar» lo intenta igual. Con bastiones y diálogo, como el explorador SFTP: un bastión no tiene terminal
   * en la que teclear, así que lo que Tessera no contesta va al diálogo.
   */
  entorno(c: ConexionSshPersistida, uso: UsoFicha, pestana: boolean, saltos: readonly ConexionSshPersistida[] = []): EntornoSecreto {
    if (saltos.length > 0 && uso.dialogo === true && this.d.dialogo !== undefined && this.sinPrograma() === null) return this.conPrograma(c, uso, saltos)
    const conSecreto = [c, ...saltos].filter(tieneSecreto)
    if (conSecreto.length === 0) return SIN_SECRETO
    const ilegible = conSecreto.find((x) => this.d.secretoDe(x.id) === null)
    const t = txSsh().askpass
    const nombre = nombreSecreto(ilegible ?? conSecreto[0]) + (ilegible !== undefined && ilegible !== c ? t.delBastion(ilegible.alias) : '')
    const sin = (porque: string): EntornoSecreto => ({ ...SIN_SECRETO, aviso: t.noSeUsa(nombre, porque) })
    if (ilegible !== undefined) {
      return sin(t.noLegible(nombresSistema(this.d.plataforma).almacenSecretos))
    }
    if (pestana && this.aTeclear.has(c.id)) return sin(t.noContesta)
    const motivo = this.sinPrograma()
    if (motivo !== null) return sin(t.escribela(motivo))
    return this.conPrograma(c, uso, saltos)
  }

  /**
   * El explorador SFTP no tiene terminal: lo que ssh pregunte lo contesta el secreto guardado o, si no hay
   * (o no se puede leer, o el servidor lo rechaza), el usuario en un diálogo. Sin diálogo ni programa, lo de
   * una pestaña.
   */
  entornoSftp(c: ConexionSshPersistida, saltos: readonly ConexionSshPersistida[] = []): EntornoSecreto {
    if (this.d.dialogo === undefined || this.sinPrograma() !== null) return this.entorno(c, FICHA_PESTANA, false, saltos)
    return this.conPrograma(c, FICHA_PESTANA, saltos)
  }

  /** La ficha deja de valer; devuelve si recibió alguna pregunta que Tessera no contesta. */
  soltar(ficha: string | null): boolean {
    if (ficha === null) return false
    this.matarDe.delete(ficha)
    for (const id of this.dialogos.get(ficha) ?? []) this.d.dialogo?.retirar(id)
    this.dialogos.delete(ficha)
    const sinContestar = this.fichas.sinContestar(ficha)
    this.fichas.revocar(ficha)
    return sinContestar
  }

  /**
   * Cómo terminar el ssh de esa ficha. Si el usuario no contesta (cancela, vence o no hay ventana), se
   * termina: ssh mandaría una respuesta vacía y volvería a preguntar, y cada vuelta es un intento fallido en
   * el servidor (que puede bloquear la cuenta).
   */
  vincular(ficha: string | null, matar: () => void): void {
    if (ficha !== null) this.matarDe.set(ficha, matar)
  }

  /** La conexión cambió (o se borró): sus pestañas vuelven a intentar con el secreto guardado. */
  alCambiarConexion(id: string): void {
    this.aTeclear.delete(id)
  }

  /** Por qué no se puede usar el programa de contraseñas, o `null` si se puede. */
  private sinPrograma(): string | null {
    const puerta = this.d.puerta
    if (puerta === null || !puerta.listo || puerta.pipe === '') return txSsh().askpass.sinPuente
    if (!this.d.existe(this.d.programa)) return txSsh().askpass.sinPrograma
    return null
  }

  private conPrograma(c: ConexionSshPersistida, uso: UsoFicha, saltos: readonly ConexionSshPersistida[] = []): EntornoSecreto {
    const puerta = this.d.puerta as PuertaPuente
    const ficha = this.fichas.emitir(c.id, uso, saltos.map((s) => s.id))
    const env = entornoAskpass({ programa: this.d.programa, pipe: puerta.pipe, token: ficha, plataforma: this.d.plataforma, exe: this.d.exe })
    return { conAskpass: true, conDialogo: uso.dialogo === true && this.d.dialogo !== undefined, env, ficha }
  }

  private cancelar(token: string, id: string, motivo: string, aTeclear = true): RespuestaOperacion {
    this.fichas.anotarSinContestar(token)
    if (aTeclear) this.aTeclear.add(id)
    this.log(`askpass conexion=${id} cancelada (${motivo})`)
    return CANCELADA
  }

  /**
   * De qué conexión de la ficha es la pregunta: la primera que la contestaría con su secreto; si ninguna, la
   * primera que la reconoce como suya (un segundo factor de su servidor); si no, la conexión de la ficha.
   */
  private duenaDe(prompt: string, conexiones: readonly ConexionSshPersistida[]): { c: ConexionSshPersistida; decision: DecisionAskpass } {
    const decisiones = conexiones.map((c) => {
      const rutaClave = c.metodo === 'clave' ? this.d.rutaClave(c.id) : undefined
      return { c, decision: decidirPreguntaAskpass(prompt, { ...c, rutaClave }, this.d.plataforma) }
    })
    const ajena = (d: DecisionAskpass): boolean => !d.contesta && (d.motivo === 'otra-conexion' || d.motivo === 'otra-clave')
    return decisiones.find((x) => x.decision.contesta) ?? decisiones.find((x) => !ajena(x.decision)) ?? decisiones[0]
  }

  /**
   * `ssh.askpass`: la ficha, la pregunta y, solo si es la de esa conexión (o la de uno de sus bastiones), su
   * secreto. Con una ficha de diálogo el secreto guardado se da UNA vez por conexión: si ssh lo vuelve a pedir,
   * el servidor lo rechazó y contesta el usuario, como lo demás que Tessera no contesta sola.
   */
  private contestar(p: Record<string, unknown>): RespuestaOperacion | Promise<RespuestaOperacion> {
    const token = typeof p.token === 'string' ? p.token : ''
    const id = this.fichas.usar(token)
    if (id === null) return NO_AUTORIZADO
    const conexiones = this.fichas.conexiones(token).map((x) => this.d.conexion(x))
    if (conexiones.some((x) => x === undefined)) return this.cancelar(token, id, 'la conexión (o uno de sus bastiones) ya no existe')
    const prompt = typeof p.prompt === 'string' ? p.prompt : ''
    const { c, decision } = this.duenaDe(prompt, conexiones as ConexionSshPersistida[])
    const conDialogo = this.d.dialogo !== undefined && this.fichas.conDialogo(token)
    const rechazada = conDialogo && this.fichas.secretoDado(token, c.id)
    if (decision.contesta && !rechazada) {
      const secreto = this.d.secretoDe(c.id)
      if (secreto !== null) {
        this.fichas.anotarSecretoDado(token, c.id)
        this.log(`askpass conexion=${c.id} contestada (${decision.que === 'frase' ? 'frase de la clave' : 'contraseña'})`)
        return { ok: true, respuesta: secreto }
      }
    }
    if (!conDialogo) return this.cancelar(token, id, decision.contesta ? 'sin secreto legible' : decision.motivo)
    return this.preguntarAlUsuario(token, preguntaParaUsuario(c, prompt, decision, rechazada), c.id)
  }

  /** La pregunta, al usuario: su respuesta va a ssh y no se guarda. Cancelar no manda la pestaña a teclear. */
  private async preguntarAlUsuario(token: string, pregunta: PreguntaUsuario, id: string): Promise<RespuestaOperacion> {
    const dialogo = this.d.dialogo as PreguntadorAskpass
    let abierto: string | null = null
    const respuesta = await dialogo.preguntar(pregunta, (idDialogo) => {
      abierto = idDialogo
      const abiertos = this.dialogos.get(token) ?? new Set<string>()
      abiertos.add(idDialogo)
      this.dialogos.set(token, abiertos)
    })
    if (abierto !== null) this.dialogos.get(token)?.delete(abierto)
    if (respuesta === null) {
      const matar = this.matarDe.get(token)
      this.matarDe.delete(token)
      matar?.()
      return this.cancelar(token, id, `el usuario no contestó${matar ? ': se corta la conexión' : ''}`, false)
    }
    this.log(`askpass conexion=${id} contestada por el usuario`)
    return { ok: true, respuesta }
  }
}
