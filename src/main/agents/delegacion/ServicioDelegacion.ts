// =============================================================================
// Las tareas delegadas: cada una corre el modo no interactivo del CLI en el contenedor de su cuenta con todo lo que
// tendría una pestaña de esa cuenta en el proyecto (montaje, credencial, capa, bases montadas, conexiones, `tctx`,
// aviso), pero sin pestaña: Tessera ya acota a ese agente al nacer y la tarea no le pone más candados. Cada ejecución (la primera y cada `--continuar`) toma las
// referencias del contenedor y de la credencial mientras corre, lee su salida y la guarda para `tctx tarea`;
// el renderer se entera de cada cambio. Una tarea sin nadie que la vigile (la sesión que la lanzó terminó) se cancela.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgenteDelegable,
  CuentaDelegable,
  MotivoFallo,
  VentanaUsoDelegable,
  VistaTarea,
  VistaTareaConResultado
} from '../../../shared/delegacion-ipc'
import type { AgentAccount } from '../../../shared/agent-accounts-ipc'
import { contextoEfectivo } from '../../../shared/contexto'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/dockerErrors'
import type { Profile } from '../../profiles/types'
import { AVISO_SOLO_LECTURA, briefingCompuesto } from '../briefingCompuesto'
import { prepararContenedor } from '../terminalAgente/apertura'
import { acquireConfigRef, cfgRefKey, contenedorDe, releaseConfigRef } from '../terminalAgente/credenciales'
import { PARADA_CONTENEDOR_INACTIVO_MS } from '../terminalAgente/cierre'
import { errMsg, type NucleoAgente } from '../terminalAgente/tipos'
import { conCredencial, cuentasDelPerfil } from './cuentasDelegables'
import { elegirCuenta, estadoDe, type CuentaCandidata, type Eleccion } from './eleccionCuenta'
import { decidirFinal } from './finalTarea'
import { lineaDelegada } from './lineaDelegada'
import { crearLectorSalida, type LectorSalida } from './salidaDelegada'
import { txAgentes } from '../textos.ts'

/** Quién delega: la sesión nativa del token, con su perfil y su proyecto. */
export interface OrigenDelegacion {
  profileId: string
  projectHostPath: string
  /** La clave de la sesión (`agent:<id>` o el id de la terminal). */
  clave: string
}

/** Lo que pide `ctx.delegar`, ya comprobado: la orden es texto. */
export interface EncargoDelegacion {
  agente: AgenteDelegable
  cuenta: string
  soloLectura: boolean
  orden: string
}

export type ResultadoDelegar = { ok: true; tarea: VistaTarea } | Exclude<Eleccion, { ok: true }> | { ok: false; rechazo: 'sin-docker' }

/** Lo que necesita de fuera. */
export interface DepsDelegacion {
  /** Las ventanas de uso de una cuenta de Docker, ya leídas (con su caché). */
  uso: (agente: AgenteDelegable, accountId: string) => Promise<VentanaUsoDelegable[]>
  /** La lista de tareas a la vista, para el renderer. */
  emitir: (tareas: VistaTarea[]) => void
  /** Las bases montadas en el proyecto: las mismas que recibe una pestaña de agente de ese proyecto. */
  montajesDe: (profileId: string, projectHostPath: string) => string[]
  ahora?: () => number
}

/** Lo que dura una tarea terminada para `tctx tarea`, y cuántas se guardan. */
const VIDA_TERMINADA_MS = 6 * 60 * 60_000
const MAX_TERMINADAS = 100
/** Cada cuánto, como mucho, se avisa de la actividad (los cambios de estado van al momento). */
const AVISO_ACTIVIDAD_MS = 1000
/** Dónde se deja la orden, dentro de la carpeta de la cuenta (montada en el contenedor). */
const CARPETA_ORDENES = '.tessera-delegadas'

/** Una ejecución del CLI: la primera de la tarea o un `--continuar`. */
interface Ejecucion {
  sesion: string | null
  /** La clave con la que su token del puente quedó atado: se revoca al terminar. */
  claveToken: string | null
  lector: LectorSalida | null
  /** Por qué la paró Tessera o el usuario: manda sobre lo que diga la salida. */
  parada: MotivoFallo | null
  archivoOrden: string | null
  /** Suelta las referencias que tomó; una vez. */
  soltar: (() => Promise<void>) | null
  /** Se cumple cuando la ejecución terminó del todo (estado escrito y referencias sueltas). */
  hecha: Promise<void>
  cerrar: () => void
}

interface Tarea {
  vista: VistaTarea
  accountId: string
  projectHostPath: string
  ej: Ejecucion
  resultado: string | null
  descartada: boolean
}

const resumenOrden = (orden: string): string => {
  const l = orden.split(/\r?\n/).find((x) => x.trim() !== '')?.trim() ?? ''
  return l.length > 80 ? `${l.slice(0, 79)}…` : l
}

function nuevaEjecucion(): Ejecucion {
  let cerrar = (): void => {}
  const hecha = new Promise<void>((r) => {
    cerrar = r
  })
  return { sesion: null, claveToken: null, lector: null, parada: null, archivoOrden: null, soltar: null, hecha, cerrar }
}

/**
 * El id de sesión de agente con el que se identifica la tarea ante el puente. Tiene la forma de una sesión de agente
 * (`claveSesionAgente`) para que `tctx` la trate como lo que es, un agente en Docker de su cuenta: busca solo en su
 * cuenta y no delega. Con la clave de una terminal pasaría por el usuario.
 */
export const PREFIJO_SESION_DELEGADA = 'delegada-'

export class ServicioDelegacion {
  private readonly tareas = new Map<string, Tarea>()
  private readonly ahora: () => number
  private avisoPendiente: ReturnType<typeof setTimeout> | null = null
  // Campos explícitos: las pruebas cargan este módulo con `node` a secas, que no admite propiedades de parámetro.
  private readonly n: NucleoAgente
  private readonly deps: DepsDelegacion

  constructor(n: NucleoAgente, deps: DepsDelegacion) {
    this.n = n
    this.deps = deps
    this.ahora = deps.ahora ?? Date.now
  }

  /** Las cuentas del perfil para `tctx cuentas`. */
  async cuentas(profileId: string): Promise<CuentaDelegable[]> {
    const candidatas = await this.candidatas(profileId)
    return candidatas.map((c) => ({
      agente: c.agente,
      nombre: c.nombre,
      estado: estadoDe(c),
      ventanas: c.ventanas,
      enMarcha: [...this.tareas.values()].filter((t) => t.accountId === c.id && t.vista.estado === 'en-marcha').length
    }))
  }

  /** Elige la cuenta y lanza la tarea; no espera a que termine. */
  async delegar(origen: OrigenDelegacion, e: EncargoDelegacion): Promise<ResultadoDelegar> {
    const docker = await this.n.sandbox.checkDocker()
    if (!docker.ok) return { ok: false, rechazo: 'sin-docker' }
    // El uso solo hace falta para elegir con `auto`: una cuenta nombrada no lo espera.
    const eleccion = elegirCuenta(await this.candidatas(origen.profileId, e.agente, e.cuenta.trim().toLowerCase() === 'auto'), e.agente, e.cuenta)
    if (!eleccion.ok) return eleccion
    const id = randomBytes(4).toString('hex')
    const inicio = this.ahora()
    const tarea: Tarea = {
      vista: {
        id,
        origen: origen.clave,
        profileId: origen.profileId,
        agente: e.agente,
        cuenta: eleccion.cuenta.nombre,
        soloLectura: e.soloLectura,
        estado: 'en-marcha',
        resumen: resumenOrden(e.orden),
        inicio,
        ultimaActividad: inicio,
        actividad: []
      },
      accountId: eleccion.cuenta.id,
      projectHostPath: origen.projectHostPath,
      ej: nuevaEjecucion(),
      resultado: null,
      descartada: false
    }
    this.recortar()
    this.tareas.set(id, tarea)
    this.contar(tarea, +1)
    this.avisar(true)
    void this.lanzar(tarea, tarea.ej, e.orden, null)
    return { ok: true, tarea: { ...tarea.vista } }
  }

  /** La tarea, si es del mismo perfil y proyecto que quien pregunta. */
  ver(origen: OrigenDelegacion, id: string): VistaTareaConResultado | null {
    const t = this.deQuien(origen, id)
    if (!t) return null
    return { ...this.vistaViva(t), ...(t.vista.estado === 'hecha' && t.resultado !== null ? { resultado: t.resultado } : {}) }
  }

  /** Cancela una tarea; `false` si no existe o no es de quien pregunta. Espera a que termine del todo. */
  async cancelar(origen: OrigenDelegacion | null, id: string, motivo: MotivoFallo = 'cancelada-por-usuario'): Promise<boolean> {
    const t = origen ? this.deQuien(origen, id) : (this.tareas.get(id) ?? null)
    if (!t) return false
    if (t.vista.estado !== 'en-marcha') return true
    const ej = t.ej
    ej.parada ??= motivo
    // Sin sesión aún, la apertura la ve al volver y termina ella: así suelta lo que montó.
    if (ej.sesion) await this.n.terminals.closeSession(ej.sesion).catch((err) => this.n.log(`delegacion: cerrar ${id}: ${errMsg(err)}`))
    await ej.hecha
    return true
  }

  /** Sigue la misma conversación con una orden nueva; si la tarea seguía en marcha, primero la para. */
  async continuar(origen: OrigenDelegacion, id: string, orden: string): Promise<VistaTarea | 'no-existe' | 'sin-conversacion'> {
    const t = this.deQuien(origen, id)
    if (!t) return 'no-existe'
    const conversacion = t.vista.conversacion ?? t.ej.lector?.resumen().conversacion ?? null
    if (!conversacion) return 'sin-conversacion'
    const previa = t.ej
    if (t.vista.estado === 'en-marcha') await this.cancelar(origen, id, 'cancelada-por-usuario')
    // Otro `--continuar` llegó a la vez y ya lanzó la suya: dos ejecuciones sobre la misma conversación no.
    if (t.ej !== previa || t.vista.estado === 'en-marcha') return { ...this.vistaViva(t) }
    const ahora = this.ahora()
    t.vista = {
      ...t.vista,
      estado: 'en-marcha',
      resumen: resumenOrden(orden),
      inicio: ahora,
      ultimaActividad: ahora,
      actividad: [],
      fin: undefined,
      motivo: undefined,
      detalle: undefined,
      conversacion
    }
    t.resultado = null
    t.descartada = false
    t.ej = nuevaEjecucion()
    this.contar(t, +1)
    this.avisar(true)
    void this.lanzar(t, t.ej, orden, conversacion)
    return { ...t.vista }
  }

  /**
   * Cancela las tareas en marcha que cumplan `filtro` y espera a que suelten su credencial: cerrar la sesión de una
   * cuenta, borrarla o parar su perfil no deja una tarea gastándola con la credencial montada.
   */
  async cancelarDonde(filtro: (t: { profileId: string; agente: AgenteDelegable; accountId: string }) => boolean): Promise<void> {
    const vivas = [...this.tareas.values()].filter((t) => t.vista.estado === 'en-marcha' && filtro({ profileId: t.vista.profileId, agente: t.vista.agente, accountId: t.accountId }))
    await Promise.allSettled(vivas.map((t) => this.cancelar(null, t.vista.id, 'cancelada-por-usuario')))
  }

  /** De quién es la sesión de agente `delegada-<id>` de una tarea en marcha, o null: lo pregunta el puente. */
  sesionDe(sessionId: string): { profileId: string; agente: string; accountId: string; host: false } | null {
    if (!sessionId.startsWith(PREFIJO_SESION_DELEGADA)) return null
    const t = this.tareas.get(sessionId.slice(PREFIJO_SESION_DELEGADA.length))
    if (!t || t.vista.estado !== 'en-marcha') return null
    return { profileId: t.vista.profileId, agente: t.vista.agente, accountId: t.accountId, host: false }
  }

  /** La sesión que delegó terminó: sus tareas se cancelan, que nadie las vigila. */
  alCerrarOrigen(clave: string): void {
    for (const t of this.tareas.values()) {
      if (t.vista.origen === clave && t.vista.estado === 'en-marcha') void this.cancelar(null, t.vista.id, 'origen-cerrado')
    }
  }

  /** Lo que pinta el renderer: las en marcha y las terminadas que aún no se descartaron. */
  vistas(): VistaTarea[] {
    return [...this.tareas.values()].filter((t) => !t.descartada).map((t) => this.vistaViva(t))
  }

  /** El usuario ya vio una terminada: deja de pintarse (sigue para `tctx tarea`). */
  descartar(id: string): void {
    const t = this.tareas.get(id)
    if (!t || t.vista.estado === 'en-marcha') return
    t.descartada = true
    this.avisar(true)
  }

  private deQuien(origen: OrigenDelegacion, id: string): Tarea | null {
    const t = this.tareas.get(id)
    if (!t || t.vista.profileId !== origen.profileId || t.projectHostPath !== origen.projectHostPath) return null
    return t
  }

  private vistaViva(t: Tarea): VistaTarea {
    if (t.vista.estado !== 'en-marcha' || !t.ej.lector) return { ...t.vista, actividad: [...t.vista.actividad] }
    const r = t.ej.lector.resumen()
    return { ...t.vista, actividad: r.actividad, ...(r.conversacion ? { conversacion: r.conversacion } : {}) }
  }

  /** Las cuentas del perfil (o solo las de un agente), con su uso si `conUso`. */
  private async candidatas(profileId: string, agente?: AgenteDelegable, conUso = true): Promise<CuentaCandidata[]> {
    const cuentas = cuentasDelPerfil(this.n.accounts, profileId).filter((c) => !agente || c.agente === agente)
    return Promise.all(
      cuentas.map(async (c) => {
        const agente = c.agente as AgenteDelegable
        const credencial = conCredencial(this.n.accounts, c)
        const ventanas = credencial && conUso ? await this.deps.uso(agente, c.id).catch(() => []) : []
        return { id: c.id, nombre: c.nombre, agente, credencial, ventanas }
      })
    )
  }

  /** Suma o resta la tarea en los contadores que protegen su contenedor y su sesión de origen. */
  private contar(t: Tarea, d: 1 | -1): void {
    const profile = this.n.profiles.get(t.vista.profileId)
    const sumar = (m: Map<string, number>, k: string): void => {
      const v = (m.get(k) ?? 0) + d
      if (v > 0) m.set(k, v)
      else m.delete(k)
    }
    if (profile) sumar(this.n.delegadasPorContenedor, contenedorDe(profile, t.vista.agente, t.accountId).id)
    sumar(this.n.delegadasPorOrigen, t.vista.origen)
  }

  /** Prepara el contenedor como para una pestaña de la cuenta y arranca el CLI; cualquier fallo termina la ejecución. */
  private async lanzar(t: Tarea, ej: Ejecucion, orden: string, reanudar: string | null): Promise<void> {
    const profile = this.n.profiles.get(t.vista.profileId)
    const cuenta = this.n.accounts.get(t.accountId)
    if (!profile || !cuenta) return this.terminar(t, ej, null, { motivo: 'agente' })
    const agente = t.vista.agente
    const destino = contenedorDe(profile, agente, cuenta.id)
    ej.soltar = this.referencias(profile, cuenta, destino, `delegada:${t.vista.id}`)
    try {
      const prep = await prepararContenedor(this.n, profile, agente, cuenta, { profileId: profile.id, agente, projectHostPath: t.projectHostPath, accountId: cuenta.id, mode: 'container' })
      if (ej.parada) return this.terminar(t, ej, null)
      const rutaOrden = this.escribirOrden(t, ej, cuenta, orden, prep.configContainerPath)
      // Lo mismo que una pestaña de la cuenta en este proyecto: sus bases montadas y su token del puente.
      const dbIds = this.deps.montajesDe(profile.id, t.projectHostPath)
      const entorno = this.n.getContainerEnv(profile.id, t.projectHostPath, dbIds, this.n.sandbox.dbBridgeContainerPath)
      const launch = lineaDelegada({
        binario: this.n.binaries[agente],
        agente,
        rutaConfig: prep.configContainerPath,
        rutaOrden,
        soloLectura: t.vista.soloLectura,
        reanudar,
        aviso: this.aviso(profile, t.projectHostPath, dbIds, t.vista.soloLectura),
        conCapa: prep.conCapa,
        entorno
      })
      // Ancho grande: lo que no es JSON (avisos del CLI) no se parte en líneas.
      const sesion = await this.n.terminals.createSession(destino, { project: t.projectHostPath, launch, extraEnv: entorno, tamano: { cols: 400, rows: 50 } })
      ej.sesion = sesion.id
      ej.claveToken = claveSesionAgente(`${PREFIJO_SESION_DELEGADA}${t.vista.id}`)
      this.n.bindDbSession(entorno, ej.claveToken)
      ej.lector = crearLectorSalida(agente)
      this.seguir(t, ej, sesion.id)
      this.n.log(`delegacion: ${t.vista.id} en ${agente}/${cuenta.id} (perfil ${profile.id}) sesion=${sesion.id}`)
      if (ej.parada) await this.n.terminals.closeSession(sesion.id).catch(() => undefined)
    } catch (err) {
      const m = errMsg(err)
      this.n.log(`delegacion: ${t.vista.id} no arrancó: ${m}`)
      return this.terminar(t, ej, null, { motivo: m.startsWith(PREFIJO_DOCKER_NO_DISPONIBLE) ? 'docker' : 'agente', detalle: m.split('\n').slice(-1)[0] })
    }
  }

  /**
   * Toma la credencial y el contenedor (con la clave `delegada:`, que la parada por inactividad respeta) y devuelve
   * cómo soltarlos. Sin otra sesión ni tarea en el contenedor, se programa su parada como al cerrar una pestaña.
   */
  private referencias(profile: Profile, cuenta: AgentAccount, destino: Profile, clave: string): () => Promise<void> {
    const agente = cuenta.agente as AgenteDelegable
    const cfgKey = cfgRefKey(profile.id, agente, cuenta.id)
    acquireConfigRef(this.n.configRefs, cfgKey)
    this.n.sandbox.retainSession(destino.id, clave)
    return async () => {
      this.n.sandbox.releaseSession(destino, clave)
      if (releaseConfigRef(this.n.configRefs, cfgKey)) {
        await this.n.sandbox.unmountAgentConfig(destino, agente, cuenta.id).catch((err) => this.n.log(`delegacion: desmontar: ${errMsg(err)}`))
      }
      const otra = [...this.n.sessions.values()].some((s) => !s.host && s.profileId === profile.id && contenedorDe(profile, s.agente, s.accountId).id === destino.id)
      if (!otra && (this.n.delegadasPorContenedor.get(destino.id) ?? 0) === 0) this.n.sandbox.programarParada(destino, PARADA_CONTENEDOR_INACTIVO_MS)
    }
  }

  /** Lee la salida de la ejecución y la termina cuando el proceso sale. */
  private seguir(t: Tarea, ej: Ejecucion, sesion: string): void {
    const lector = ej.lector
    const fuera = this.n.terminals.onData(sesion, (data) => {
      if (lector?.alimentar(data) && t.ej === ej) {
        t.vista.ultimaActividad = this.ahora()
        this.avisar(false)
      }
    })
    const finExit = this.n.terminals.onExit(sesion, (codigo) => {
      fuera()
      finExit()
      void this.n.terminals.closeSession(sesion).catch(() => undefined)
      void this.terminar(t, ej, codigo)
    })
  }

  /**
   * El aviso de una pestaña de la cuenta en el proyecto (bases, conexiones, reglas, documentos y búsqueda) y lo que
   * oye un subagente. En una tarea de solo lectura también se le dice: en Codex es la única barrera que funciona en
   * el contenedor.
   */
  private aviso(profile: Profile, proyecto: string, dbIds: string[], soloLectura: boolean): string | null {
    const base = briefingCompuesto({
      bd: this.n.getDbBriefing(profile.id, proyecto, dbIds),
      ssh: this.n.getSshBriefing(profile.id),
      contexto: contextoEfectivo(profile, this.n.contextoGlobal()),
      historial: true,
      subagente: true,
      enContenedor: true
    })
    return soloLectura ? `${base ?? ''}\n\n${AVISO_SOLO_LECTURA}`.trim() : base
  }

  /** La orden, en un archivo de la carpeta de la cuenta: el contenedor la ve montada y el CLI la lee por la entrada. */
  private escribirOrden(t: Tarea, ej: Ejecucion, cuenta: AgentAccount, orden: string, rutaConfig: string): string {
    const nombre = `${t.vista.id}-${this.ahora()}.md`
    const carpeta = join(this.n.accounts.hostDirFor(cuenta), CARPETA_ORDENES)
    mkdirSync(carpeta, { recursive: true })
    // El contenedor monta la carpeta de la cuenta con escritura: si dejó un enlace en lugar de la de órdenes, o un
    // archivo con el nombre de esta orden, no se escribe a través de él (`wx` falla si la entrada ya existe).
    if (lstatSync(carpeta).isSymbolicLink()) throw new Error(txAgentes().fallos.ordenesEnlazadas)
    const archivo = join(carpeta, nombre)
    writeFileSync(archivo, orden, { encoding: 'utf8', flag: 'wx' })
    ej.archivoOrden = archivo
    return `${rutaConfig}/${CARPETA_ORDENES}/${nombre}`
  }

  /** Cierra una ejecución: estado, resultado, referencias y archivo de la orden. Una vez por ejecución. */
  private async terminar(t: Tarea, ej: Ejecucion, codigo: number | null, forzado?: { motivo: MotivoFallo; detalle?: string }): Promise<void> {
    if (t.ej !== ej || t.vista.estado !== 'en-marcha') return
    const r = ej.lector?.resumen(true) ?? null
    const final = decidirFinal(r, codigo, ej.parada, forzado)
    t.vista = {
      ...t.vista,
      estado: final.estado,
      fin: this.ahora(),
      actividad: r?.actividad ?? t.vista.actividad,
      ...(r?.conversacion ? { conversacion: r.conversacion } : {}),
      ...(final.motivo ? { motivo: final.motivo } : {}),
      ...(final.detalle ? { detalle: final.detalle } : {})
    }
    t.resultado = final.estado === 'hecha' ? (r?.resultado ?? '') : null
    ej.sesion = null
    // Lo primero de lo que suelta: su token deja de valer.
    if (ej.claveToken) this.n.revokeDbSession(ej.claveToken)
    ej.claveToken = null
    this.contar(t, -1)
    if (ej.archivoOrden) rmSync(ej.archivoOrden, { force: true })
    ej.archivoOrden = null
    const soltar = ej.soltar
    ej.soltar = null
    this.avisar(true)
    this.n.log(`delegacion: ${t.vista.id} ${final.estado}${final.motivo ? ` (${final.motivo})` : ''} codigo=${codigo}`)
    if (soltar) await soltar().catch((err) => this.n.log(`delegacion: soltar ${t.vista.id}: ${errMsg(err)}`))
    ej.cerrar()
  }

  /** Avisa al renderer: los cambios de estado al momento; la actividad, como mucho una vez por segundo. */
  private avisar(ya: boolean): void {
    if (ya) {
      if (this.avisoPendiente) clearTimeout(this.avisoPendiente)
      this.avisoPendiente = null
      this.deps.emitir(this.vistas())
      return
    }
    if (this.avisoPendiente) return
    this.avisoPendiente = setTimeout(() => {
      this.avisoPendiente = null
      this.deps.emitir(this.vistas())
    }, AVISO_ACTIVIDAD_MS)
    this.avisoPendiente.unref?.()
  }

  /** Olvida las terminadas viejas, y las que sobran por encima del tope. */
  private recortar(): void {
    const ahora = this.ahora()
    const terminadas = [...this.tareas.values()].filter((t) => t.vista.estado !== 'en-marcha').sort((a, b) => (a.vista.fin ?? 0) - (b.vista.fin ?? 0))
    for (const [i, t] of terminadas.entries()) {
      if (ahora - (t.vista.fin ?? ahora) > VIDA_TERMINADA_MS || terminadas.length - i > MAX_TERMINADAS) this.tareas.delete(t.vista.id)
    }
  }
}
