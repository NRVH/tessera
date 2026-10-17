// =============================================================================
// Las sesiones del explorador SFTP, una por pestaña: lanzan `ssh -s sftp` con la línea de la conexión (la
// misma huella, clave y contraseña guardada que una pestaña SSH), atienden lo que pide el renderer y llevan
// las operaciones largas (con avance cada 250 ms y cancelación) y los planes que pisarían algo, que esperan
// confirmación. Las rutas del equipo se quedan aquí: el renderer solo ve nombres y rutas remotas.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Plataforma } from '../../../shared/plataforma.ts'
import {
  SFTP_CHANNELS,
  type SftpCaida,
  type SftpEntrada,
  type SftpInicio,
  type SftpInicioTransferencia,
  type SftpListado,
  type SftpOperacion,
  type SftpProgreso,
  type SftpResultado,
  type SftpTipoOperacion
} from '../../../shared/sftp-ipc.ts'
import type { TerminalExitReason } from '../../../shared/terminal-ipc.ts'
import { nombreValido } from '../transferenciaBuzon.ts'
import { txSsh } from '../textos.ts'
import { ClienteSftp, ErrorSftp } from './ClienteSftp.ts'
import { textoPermisos, tipoDeModo } from './protocoloSftp.ts'
import { Cancelada, baseRemota, bajar, borrar, carpetaRemota, pesoDe, recorrerLocal, recorrerRemoto, rutaRemotaValida, subir, unirRemota, type Avance } from './transferenciasSftp.ts'

/** Lo que hace falta para lanzar el ssh de una conexión (lo da `ControladorSsh.prepararSftp`). */
export interface LineaSftp {
  exe: string
  args: string[]
  env: NodeJS.ProcessEnv
  /** Suelta la ficha del programa de contraseñas y avisa si ssh guardó una huella nueva. */
  alConectar: () => void
  /** Recibe cómo terminar este ssh si el usuario no contesta una pregunta del diálogo. */
  vincular?: (matar: () => void) => void
}

export interface DepsSesionesSftp {
  /** La línea de una conexión del perfil; lanza con un texto para el usuario si no se puede. */
  linea: (profileId: string, conexionId: string) => LineaSftp
  clasificar: (exitCode: number | null, cola: string) => TerminalExitReason | undefined
  /** Diálogos nativos (en el main): la carpeta donde bajar, o lo que subir. null si se cancela. */
  elegirCarpetaDescarga: () => Promise<string | null>
  elegirParaSubir: (carpeta: boolean) => Promise<string[] | null>
  mostrarEnCarpeta: (ruta: string) => void
  emitir: (canal: string, payload: unknown) => void
  plataforma: Plataforma
  log: (m: string) => void
}

/**
 * Tope del saludo: conectar (10 s) más autenticarse, que puede esperar a que el usuario conteste en el
 * diálogo de Tessera (`TOPE_DIALOGO_MS`). Un servidor que no llega lo corta antes `ConnectTimeout`.
 */
const TOPE_SALUDO_MS = 150_000
/** Cada cuánto se avisa del avance de una operación. */
const AVANCE_MS = 250
/** Un plan sin confirmar caduca. */
const PLAN_MS = 10 * 60_000
/** Lo que se guarda de la salida de errores de ssh para saber por qué se cortó. */
const COLA_ERRORES = 8192

interface Sesion {
  proceso: ChildProcess
  cliente: ClienteSftp
  errores: string
  ops: Set<string>
  /** Pasó el saludo: solo entonces una salida de ssh es una caída (antes, el fallo lo contesta `abrir`). */
  abierta: boolean
  /** De quién es: una sesión viva solo se reutiliza para el mismo perfil y la misma conexión. */
  profileId: string
  conexionId: string
}

interface Op {
  sesionId: string
  cancelada: boolean
  /** Lo bajado, para «Mostrar» al acabar. */
  local?: string
}

/** Una transferencia a falta de confirmar: lo que se movería y adónde. */
interface Plan {
  sesionId: string
  tipo: 'subida' | 'descarga'
  pares: Array<{ origen: string; destino: string }>
  carpetaRemota: string
  caduca: number
}

/** El texto de un fallo para el usuario (sin rutas del equipo: los nuestros no las llevan). */
function textoDe(e: unknown): string {
  if (e instanceof ErrorSftp) return e.message
  const codigo = (e as { code?: unknown })?.code
  const t = txSsh().sftp
  if (codigo === 'EACCES' || codigo === 'EPERM') return t.sinPermisoLocal
  if (codigo === 'ENOENT') return t.yaNoExisteLocal
  if (codigo === 'ENOSPC') return t.sinEspacio
  return t.fallo
}

/** Lo que dice el renderer de un fallo al abrir, según por qué salió ssh. */
function textoDeCaida(motivo: TerminalExitReason | undefined, errores: string): string {
  const t = txSsh().sftp
  if (motivo === 'ssh-huella-cambiada') return t.huellaCambiada
  if (motivo === 'ssh-autenticacion') return t.autenticacion
  if (motivo === 'ssh-inalcanzable') return t.inalcanzable
  if (motivo === 'ssh-algoritmos') return t.algoritmos
  if (/subsystem request failed/i.test(errores)) return t.sinSftp
  return t.noSeAbrio
}

export class SesionesSftp {
  private readonly d: DepsSesionesSftp
  private readonly sesiones = new Map<string, Sesion>()
  private readonly ops = new Map<string, Op>()
  private readonly planes = new Map<string, Plan>()

  constructor(deps: DepsSesionesSftp) {
    this.d = deps
  }

  /** Abre (o reabre) la sesión de una pestaña y dice su carpeta de inicio. */
  async abrir(sesionId: string, profileId: string, conexionId: string): Promise<SftpResultado<SftpInicio>> {
    const viva = this.sesiones.get(sesionId)
    if (viva && !viva.cliente.cortada && viva.profileId === profileId && viva.conexionId === conexionId) return this.intentar(async () => ({ inicio: await viva.cliente.realpath('.') }))
    if (viva) this.cerrar(sesionId)
    let linea: LineaSftp
    try {
      linea = this.d.linea(profileId, conexionId)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const proceso = spawn(linea.exe, linea.args, { env: linea.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    linea.vincular?.(() => proceso.kill())
    const cliente = new ClienteSftp(proceso.stdin!, proceso.stdout!)
    const sesion: Sesion = { proceso, cliente, errores: '', ops: new Set(), abierta: false, profileId, conexionId }
    this.sesiones.set(sesionId, sesion)
    proceso.stderr!.on('data', (t: Buffer) => {
      sesion.errores = (sesion.errores + t.toString('utf-8')).slice(-COLA_ERRORES)
    })
    const salida = new Promise<number | null>((resolve) => {
      proceso.on('error', () => resolve(null))
      proceso.on('close', (codigo) => resolve(codigo))
    })
    void salida.then((codigo) => this.alSalir(sesionId, sesion, codigo))
    // Que ssh salga antes del saludo es un fallo; después, lo atiende `alSalir` (sin rechazo suelto).
    const muerta = salida.then(() => Promise.reject(new Error('salió')))
    muerta.catch(() => {})
    try {
      await Promise.race([cliente.iniciar(TOPE_SALUDO_MS), muerta])
      sesion.abierta = true
      linea.alConectar()
      return { ok: true, valor: { inicio: await cliente.realpath('.') } }
    } catch {
      linea.alConectar()
      // Fuera del mapa antes de matarla: un fallo al abrir no es una caída que avisar.
      this.sesiones.delete(sesionId)
      proceso.kill()
      const codigo = await salida
      const motivo = this.d.clasificar(codigo ?? 255, sesion.errores)
      this.d.log(`sftp: no se abrió (codigo=${codigo}): ${sesion.errores.trim().split(/\r?\n/).slice(-3).join(' | ')}`)
      return { ok: false, error: textoDeCaida(motivo, sesion.errores), ...(motivo ? { motivo } : {}) }
    }
  }

  /** ssh salió: si la sesión seguía siendo la de la pestaña, se avisa de la caída. */
  private alSalir(sesionId: string, sesion: Sesion, codigo: number | null): void {
    sesion.cliente.cortar(txSsh().sftp.conexionPerdida)
    if (this.sesiones.get(sesionId) !== sesion || !sesion.abierta) return
    this.sesiones.delete(sesionId)
    const motivo = this.d.clasificar(codigo ?? 255, sesion.errores)
    const caida: SftpCaida = { sesionId, error: motivo ? textoDeCaida(motivo, sesion.errores) : txSsh().sftp.conexionPerdida, ...(motivo ? { motivo } : {}) }
    this.d.emitir(SFTP_CHANNELS.EV_CAIDA, caida)
  }

  /** Cierra la sesión de una pestaña y cancela lo suyo. */
  cerrar(sesionId: string): void {
    const s = this.sesiones.get(sesionId)
    if (!s) return
    this.sesiones.delete(sesionId)
    for (const id of s.ops) this.cancelar(id)
    s.cliente.cortar(txSsh().sftp.explorador)
    s.proceso.stdin?.end()
    s.proceso.kill()
  }

  cerrarTodas(): void {
    for (const id of [...this.sesiones.keys()]) this.cerrar(id)
  }

  private cliente(sesionId: string): ClienteSftp {
    const s = this.sesiones.get(sesionId)
    if (!s || s.cliente.cortada) throw new ErrorSftp(6, txSsh().sftp.sesionCerrada)
    return s.cliente
  }

  private async intentar<T>(f: () => Promise<T>): Promise<SftpResultado<T>> {
    try {
      return { ok: true, valor: await f() }
    } catch (e) {
      return { ok: false, error: textoDe(e) }
    }
  }

  listar(sesionId: string, ruta: string): Promise<SftpResultado<SftpListado>> {
    return this.intentar(async () => {
      const c = this.cliente(sesionId)
      const canonica = await c.realpath(ruta)
      const entradas = await c.listar(canonica)
      const resultado: SftpEntrada[] = []
      for (const e of entradas) {
        const tipo = tipoDeModo(e.atributos.permisos)
        const entrada: SftpEntrada = {
          nombre: e.nombre,
          tipo,
          tamano: e.atributos.tamano,
          modificado: e.atributos.mtime !== null ? e.atributos.mtime * 1000 : null,
          permisos: textoPermisos(e.atributos.permisos)
        }
        if (tipo === 'enlace') {
          const destino = await c.stat(unirRemota(canonica, e.nombre)).catch(() => null)
          const t = destino ? tipoDeModo(destino.permisos) : null
          entrada.destinoEnlace = t === 'carpeta' ? 'carpeta' : t === null ? 'roto' : 'archivo'
        }
        resultado.push(entrada)
      }
      return { ruta: canonica, entradas: resultado }
    })
  }

  crearCarpeta(sesionId: string, ruta: string): Promise<SftpResultado<null>> {
    return this.intentar(async () => {
      if (!rutaRemotaValida(ruta)) throw new ErrorSftp(4, txSsh().sftp.carpetaNoVale)
      await this.cliente(sesionId).mkdir(ruta)
      return null
    })
  }

  renombrar(sesionId: string, desde: string, a: string): Promise<SftpResultado<null>> {
    return this.intentar(async () => {
      if (!rutaRemotaValida(desde) || !rutaRemotaValida(a)) throw new ErrorSftp(4, txSsh().sftp.nombreNoVale)
      const c = this.cliente(sesionId)
      if (await c.lstatSiExiste(a)) throw new ErrorSftp(4, txSsh().sftp.yaExiste(baseRemota(a)))
      await c.rename(desde, a)
      return null
    })
  }

  // --- Operaciones largas -------------------------------------------------------

  /** Lanza una operación en segundo plano con su avance; resuelve en cuanto arranca. */
  private lanzar(sesionId: string, tipo: SftpTipoOperacion, carpeta: string, trabajo: (a: Avance, op: Op) => Promise<number | null>, total: () => number | null): SftpOperacion {
    const opId = randomUUID()
    const op: Op = { sesionId, cancelada: false }
    this.ops.set(opId, op)
    this.sesiones.get(sesionId)?.ops.add(opId)
    let hechos = 0
    let actual = ''
    let ultimo = 0
    const emitir = (fase: SftpProgreso['fase'], error?: string): void => {
      const p: SftpProgreso = { opId, sesionId, tipo, fase, hechos, total: total(), actual, carpetaRemota: carpeta, ...(error ? { error } : {}) }
      this.d.emitir(SFTP_CHANNELS.EV_PROGRESO, p)
    }
    const avance: Avance = {
      sumar: (n) => {
        hechos += n
        if (Date.now() - ultimo >= AVANCE_MS) {
          ultimo = Date.now()
          emitir('en-curso')
        }
      },
      actual: (nombre) => {
        actual = nombre
      },
      get cancelada() {
        return op.cancelada
      }
    }
    emitir('en-curso')
    void trabajo(avance, op)
      .then(() => emitir('hecha'))
      .catch((e) => {
        if (e instanceof Cancelada || op.cancelada) emitir('cancelada')
        else {
          this.d.log(`sftp: ${tipo} falló: ${e instanceof Error ? e.message : String(e)}`)
          emitir('error', textoDe(e))
        }
      })
      .finally(() => {
        this.sesiones.get(sesionId)?.ops.delete(opId)
        // Una descarga terminada se recuerda un rato para «Mostrar».
        if (op.local) setTimeout(() => this.ops.delete(opId), PLAN_MS).unref?.()
        else this.ops.delete(opId)
      })
    return { opId }
  }

  cancelar(opId: string): void {
    const op = this.ops.get(opId)
    if (op) op.cancelada = true
  }

  mostrarDescarga(opId: string): void {
    const local = this.ops.get(opId)?.local
    if (local && existsSync(local)) this.d.mostrarEnCarpeta(local)
  }

  borrar(sesionId: string, rutas: unknown): SftpResultado<SftpOperacion> {
    if (!Array.isArray(rutas) || rutas.length === 0 || !rutas.every(rutaRemotaValida)) return { ok: false, error: txSsh().sftp.nadaQueBorrar }
    try {
      const c = this.cliente(sesionId)
      // Sin total: lo que hay dentro de una carpeta se sabe al irlo borrando.
      const op = this.lanzar(sesionId, 'borrado', carpetaRemota(rutas[0]), async (a) => {
        for (const r of rutas) await borrar(c, r, a)
        return null
      }, () => null)
      return { ok: true, valor: op }
    } catch (e) {
      return { ok: false, error: textoDe(e) }
    }
  }

  /** Bajar: diálogo de la carpeta, conflictos (lo que ya existe allí) y, si no hay, en marcha. */
  async descargar(sesionId: string, rutas: unknown): Promise<SftpResultado<SftpInicioTransferencia | null>> {
    if (!Array.isArray(rutas) || rutas.length === 0 || !rutas.every(rutaRemotaValida)) return { ok: false, error: txSsh().sftp.nadaQueDescargar }
    try {
      this.cliente(sesionId)
      const carpeta = await this.d.elegirCarpetaDescarga()
      if (carpeta === null) return { ok: true, valor: null }
      const malo = rutas.find((r) => !nombreValido(baseRemota(r), this.d.plataforma))
      if (malo) return { ok: false, error: txSsh().sftp.nombreLocal(baseRemota(malo)) }
      const pares = rutas.map((r) => ({ origen: r, destino: path.join(carpeta, baseRemota(r)) }))
      const conflictos = pares.filter((p) => existsSync(p.destino)).map((p) => baseRemota(p.origen))
      return { ok: true, valor: this.planOOperacion({ sesionId, tipo: 'descarga', pares, carpetaRemota: carpetaRemota(rutas[0]), caduca: Date.now() + PLAN_MS }, conflictos) }
    } catch (e) {
      return { ok: false, error: textoDe(e) }
    }
  }

  /** Subir lo elegido en el diálogo nativo. */
  async subirElegidos(sesionId: string, destino: string, carpeta: boolean): Promise<SftpResultado<SftpInicioTransferencia | null>> {
    if (!rutaRemotaValida(destino) && destino !== '/') return { ok: false, error: txSsh().sftp.destinoNoVale }
    try {
      this.cliente(sesionId)
      const locales = await this.d.elegirParaSubir(carpeta)
      if (locales === null || locales.length === 0) return { ok: true, valor: null }
      return { ok: true, valor: await this.planSubida(sesionId, destino, locales) }
    } catch (e) {
      return { ok: false, error: textoDe(e) }
    }
  }

  /** Subir lo soltado (rutas del preload): solo las que existen en el equipo. */
  async subirSoltados(sesionId: string, destino: string, rutasLocales: unknown): Promise<SftpResultado<SftpInicioTransferencia>> {
    if (!rutaRemotaValida(destino) && destino !== '/') return { ok: false, error: txSsh().sftp.destinoNoVale }
    const locales = Array.isArray(rutasLocales) ? rutasLocales.filter((r): r is string => typeof r === 'string' && path.isAbsolute(r) && existsSync(r)) : []
    if (locales.length === 0) return { ok: false, error: txSsh().sftp.soltadoNoVale }
    try {
      this.cliente(sesionId)
      return { ok: true, valor: await this.planSubida(sesionId, destino, locales) }
    } catch (e) {
      return { ok: false, error: textoDe(e) }
    }
  }

  private async planSubida(sesionId: string, destino: string, locales: string[]): Promise<SftpInicioTransferencia> {
    const c = this.cliente(sesionId)
    const pares = locales.map((l) => ({ origen: l, destino: unirRemota(destino, path.basename(l)) }))
    const conflictos: string[] = []
    for (const p of pares) if (await c.lstatSiExiste(p.destino)) conflictos.push(baseRemota(p.destino))
    return this.planOOperacion({ sesionId, tipo: 'subida', pares, carpetaRemota: destino, caduca: Date.now() + PLAN_MS }, conflictos)
  }

  /** Sin conflictos, en marcha; con ellos, un plan que espera `confirmarPlan`. */
  private planOOperacion(plan: Plan, conflictos: string[]): SftpInicioTransferencia {
    if (conflictos.length === 0) return { tipo: 'operacion', ...this.ejecutarPlan(plan, false) }
    for (const [id, p] of this.planes) if (p.caduca < Date.now()) this.planes.delete(id)
    const planId = randomUUID()
    this.planes.set(planId, plan)
    return { tipo: 'plan', planId, conflictos }
  }

  confirmarPlan(planId: string, reemplazar: boolean): SftpResultado<SftpOperacion | null> {
    const plan = this.planes.get(planId)
    this.planes.delete(planId)
    if (!reemplazar) return { ok: true, valor: null }
    if (!plan || plan.caduca < Date.now()) return { ok: false, error: txSsh().sftp.copiaCaducada }
    try {
      return { ok: true, valor: this.ejecutarPlan(plan, true) }
    } catch (e) {
      return { ok: false, error: textoDe(e) }
    }
  }

  private ejecutarPlan(plan: Plan, reemplazar: boolean): SftpOperacion {
    const c = this.cliente(plan.sesionId)
    let total: number | null = null
    return this.lanzar(plan.sesionId, plan.tipo, plan.carpetaRemota, async (a, op) => {
      if (plan.tipo === 'descarga') {
        const arboles = await Promise.all(plan.pares.map((p) => recorrerRemoto(c, p.origen, a)))
        total = arboles.reduce((n, e) => n + pesoDe(e), 0)
        for (const p of plan.pares) await bajar(c, p.origen, p.destino, this.d.plataforma, a)
        op.local = plan.pares.length === 1 ? plan.pares[0].destino : path.dirname(plan.pares[0].destino)
      } else {
        const arboles = await Promise.all(plan.pares.map((p) => recorrerLocal(p.origen, a)))
        total = arboles.reduce((n, e) => n + pesoDe(e), 0)
        for (const p of plan.pares) await subir(c, p.origen, p.destino, reemplazar, a)
      }
      return null
    }, () => total)
  }
}
