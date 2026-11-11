// =============================================================================
// Las tareas delegadas: cada una corre el modo no interactivo del CLI en el contenedor de su cuenta con todo lo que
// tendría una pestaña de esa cuenta en el proyecto (montaje, credencial, capa, bases montadas, conexiones, `tctx`,
// aviso), pero sin pestaña: Tessera ya acota a ese agente al nacer y la tarea no le pone más candados. Cada ejecución (la primera y cada `--continuar`) toma las
// referencias del contenedor y de la credencial mientras corre, lee su salida y la guarda para `tctx tarea`;
// el renderer se entera de cada cambio. Una tarea sin nadie que la vigile (la sesión que la lanzó terminó) se cancela.
// Las que siguen en marcha quedan registradas en disco: si Tessera o el equipo se apagan, vuelven como interrumpidas.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  AgenteDelegable,
  CuentaDelegable,
  ModeloDelegable,
  MotivoFallo,
  VentanaUsoDelegable,
  VistaTarea,
  VistaTareaConResultado,
  VistaTareaPanel
} from '../../../shared/delegacion-ipc'
import type { AgentAccount } from '../../../shared/agent-accounts-ipc'
import { contextoEfectivo } from '../../../shared/contexto'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/dockerErrors'
import type { Profile } from '../../profiles/types'
import { AVISO_SOLO_LECTURA, briefingCompuesto } from '../briefingCompuesto'
import { prepararContenedor } from '../terminalAgente/apertura'
import { acquireConfigRef, cfgRefKey, contenedorDe, enElMismoContenedor, releaseConfigRef } from '../terminalAgente/credenciales'
import { PARADA_CONTENEDOR_INACTIVO_MS } from '../terminalAgente/cierre'
import { errMsg, type NucleoAgente } from '../terminalAgente/tipos'
import { comprobarPeticion, esfuerzoAlContinuar, leerCatalogo, lineaCatalogo, type RechazoModelo } from './catalogoModelos'
import { conCredencial, cuentasDelPerfil } from './cuentasDelegables'
import { cuentasLibres, elegirCuenta, esAuto, estadoDe, type CuentaCandidata, type Eleccion } from './eleccionCuenta'
import { decidirFinal, puedeSerDocker, salidaDeDocker } from './finalTarea'
import { lineaDelegada } from './lineaDelegada'
import { trasApagado, type EntradaRegistro, type RegistroTareas } from './registroTareas'
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
  modelo?: string
  esfuerzo?: string
}

/** El modelo y el esfuerzo de una tarea o de su continuación. */
export interface AjustesModelo {
  modelo?: string
  esfuerzo?: string
}

export type ResultadoDelegar =
  /** `escribiendo`: las otras tareas que pueden modificar este proyecto en este momento. */
  | { ok: true; tarea: VistaTarea; escribiendo: number }
  | Exclude<Eleccion, { ok: true }>
  | { ok: false; rechazo: 'sin-docker' }
  | RechazoModelo

export type ResultadoModelos =
  | { ok: true; agente: AgenteDelegable; cuenta: string; leido: number; modelos: ModeloDelegable[] }
  | Exclude<Eleccion, { ok: true }>
  | { ok: false; rechazo: 'sin-docker' | 'catalogo-no-disponible' | 'docker-iniciando' }

/** Lo que resuelve la promesa dentro del plazo, o null. */
function conTope<T>(promesa: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const reloj = setTimeout(() => resolve(null), ms)
    reloj.unref?.()
    void promesa.then(
      (v) => {
        clearTimeout(reloj)
        resolve(v)
      },
      () => resolve(null)
    )
  })
}

/** Lo que necesita de fuera. */
export interface DepsDelegacion {
  /** Las ventanas de uso de una cuenta de Docker, ya leídas (con su caché). */
  uso: (agente: AgenteDelegable, accountId: string) => Promise<VentanaUsoDelegable[]>
  /** La lista de tareas a la vista, para el renderer. */
  emitir: (tareas: VistaTareaPanel[]) => void
  /** Las bases montadas en el proyecto: las mismas que recibe una pestaña de agente de ese proyecto. */
  montajesDe: (profileId: string, projectHostPath: string) => string[]
  /** Dónde sobreviven las tareas sin terminar a un apagado. */
  registro?: RegistroTareas
  ahora?: () => number
  topeCancelarMs?: number
}

/** Lo que se espera a que una tarea cancelada termine: muy por debajo del tope de `tctx` (60 s), que así siempre recibe respuesta. */
const TOPE_CANCELAR_MS = 15_000

/** Lo que dura una tarea terminada para `tctx tarea`, y cuántas se guardan. */
const VIDA_TERMINADA_MS = 6 * 60 * 60_000
const MAX_TERMINADAS = 100
/** Lo que dura una interrumpida: se la encuentra aunque se vuelva a ella días después del corte. */
const VIDA_INTERRUMPIDA_MS = 7 * 24 * 60 * 60_000
/** Cuántas enseña `tctx tareas`. */
const MAX_TAREAS_LISTADAS = 20
/** Lo que vale el catálogo de una cuenta: cambia con las versiones del CLI, no entre una tarea y otra. */
const VIDA_CATALOGO_MS = 60 * 60_000
/** Lo que se espera a los catálogos en total: bajo el tope de `tctx` (60 s) para que este reciba siempre una respuesta. */
const TOPE_CATALOGO_MS = 45_000
/** Donde corre el CLI al leer el catálogo: en la carpeta del proyecto cargaría sus hooks y sus servidores MCP. */
const CARPETA_NEUTRA = '/tmp'
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
  /** Se cumple al pedir pararla: una espera larga, como la de Docker, no retiene a quien la cancela. */
  alParar: Promise<void>
  parar: () => void
  /**
   * Se dio por cancelada sin que su proceso saliera (venció el tope de cancelar). Lo que tiene tomado (credencial,
   * contenedor) se suelta cuando salga de verdad, y mientras no se puede continuar su conversación.
   */
  forzada: boolean
  /** Ya salió del todo: estado escrito y referencias sueltas. */
  terminada: boolean
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
  let parar = (): void => {}
  const alParar = new Promise<void>((r) => {
    parar = r
  })
  return { sesion: null, claveToken: null, lector: null, parada: null, archivoOrden: null, soltar: null, hecha, cerrar, alParar, parar, forzada: false, terminada: false }
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
  private readonly topeCancelarMs: number
  private avisoPendiente: ReturnType<typeof setTimeout> | null = null
  private readonly catalogos = new Map<string, { modelos: ModeloDelegable[]; leido: number }>()
  private readonly leyendoCatalogo = new Map<string, Promise<{ modelos: ModeloDelegable[]; leido: number } | null>>()
  /** Con la app cerrándose, las tareas mueren con ella: el registro se queda como estaba y vuelven como interrumpidas. */
  private cerrandoApp = false
  /** El registro existía y no se pudo leer: mientras tanto no se escribe encima. */
  private registroPendiente = false
  // Campos explícitos: las pruebas cargan este módulo con `node` a secas, que no admite propiedades de parámetro.
  private readonly n: NucleoAgente
  private readonly deps: DepsDelegacion

  constructor(n: NucleoAgente, deps: DepsDelegacion) {
    this.n = n
    this.deps = deps
    this.ahora = deps.ahora ?? Date.now
    this.topeCancelarMs = deps.topeCancelarMs ?? TOPE_CANCELAR_MS
    this.restaurar()
  }

  /** Empieza el cierre de la app. */
  alCerrarApp(): void {
    this.cerrandoApp = true
  }

  /** Lo que seguía en marcha cuando se apagó Tessera vuelve como interrumpido; su orden ya no la lee nadie. */
  private restaurar(): void {
    const entradas = this.leerRegistro()
    this.registroPendiente = entradas === null
    if (entradas === null) return
    const ahora = this.ahora()
    for (const e of entradas) {
      const vista = trasApagado(e.vista, ahora)
      this.tareas.set(vista.id, { vista, accountId: e.accountId, projectHostPath: e.projectHostPath, ej: nuevaEjecucion(), resultado: null, descartada: true })
      if (e.archivoOrden) this.borrarOrdenHuerfana(e.accountId, e.archivoOrden)
    }
    this.recortar()
    this.guardarRegistro()
  }

  /** Las tareas registradas, o null si el archivo existe y no se pudo leer. */
  private leerRegistro(): EntradaRegistro[] | null {
    try {
      return this.deps.registro?.leer() ?? []
    } catch (err) {
      this.n.log(`delegacion: leer el registro: ${errMsg(err)}`)
      return null
    }
  }

  /** El contenedor monta la carpeta de la cuenta con escritura: a través de un enlace que haya dejado allí no se borra. */
  private borrarOrdenHuerfana(accountId: string, nombre: string): void {
    try {
      const cuenta = this.n.accounts.get(accountId)
      if (!cuenta) return
      const carpeta = join(this.n.accounts.hostDirFor(cuenta), CARPETA_ORDENES)
      if (!lstatSync(carpeta).isSymbolicLink()) rmSync(join(carpeta, nombre), { force: true })
    } catch (err) {
      this.n.log(`delegacion: borrar la orden ${nombre}: ${errMsg(err)}`)
    }
  }

  /** Escribe las tareas sin terminar. Un fallo no para la tarea: solo se perdería la posibilidad de reanudarla. */
  private guardarRegistro(): void {
    if (this.cerrandoApp || !this.deps.registro) return
    // Un bloqueo pasajero al arrancar no puede acabar con las interrumpidas: se reintenta antes de escribir encima.
    if (this.registroPendiente) this.restaurar()
    if (this.registroPendiente) return
    const entradas = [...this.tareas.values()]
      .filter((t) => t.vista.estado === 'en-marcha' || t.vista.estado === 'interrumpida')
      .map((t) => ({ vista: t.vista, accountId: t.accountId, projectHostPath: t.projectHostPath, archivoOrden: t.ej.archivoOrden ? basename(t.ej.archivoOrden) : null }))
    try {
      this.deps.registro.escribir(entradas)
    } catch (err) {
      this.n.log(`delegacion: escribir el registro: ${errMsg(err)}`)
    }
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
    if (!docker.ok && !docker.motorCaido) return { ok: false, rechazo: 'sin-docker' }
    // El uso solo hace falta para elegir con `auto`: una cuenta nombrada no lo espera.
    const candidatas = await this.candidatas(origen.profileId, e.agente, esAuto(e.cuenta))
    const primera = elegirCuenta(candidatas, e.agente, e.cuenta)
    if (!primera.ok) return primera
    // Con el motor parado la tarea se acepta y lo inicia ella: sin contenedor no hay catálogo, y el CLI dirá si el modelo no vale.
    const eleccion = docker.ok ? await this.conElModelo(origen, primera.cuenta, candidatas, e) : primera
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
        ...(e.modelo ? { modelo: e.modelo } : {}),
        ...(e.esfuerzo ? { esfuerzo: e.esfuerzo } : {}),
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
    const escribiendo = e.soloLectura ? 0 : [...this.tareas.values()].filter((t) => t.vista.estado === 'en-marcha' && !t.vista.soloLectura && t.projectHostPath === origen.projectHostPath).length
    this.tareas.set(id, tarea)
    this.contar(tarea, +1)
    this.guardarRegistro()
    this.avisar(true)
    void this.lanzar(tarea, tarea.ej, e.orden, null)
    return { ok: true, tarea: { ...tarea.vista }, escribiendo }
  }

  /**
   * La cuenta que ofrece lo pedido: con `auto`, la primera de las libres que lo tenga. Si un catálogo no se puede leer
   * no se bloquea: la petición pasa tal cual y, si no vale, el CLI lo dice al empezar.
   */
  private async conElModelo(origen: OrigenDelegacion, primera: CuentaCandidata, candidatas: readonly CuentaCandidata[], e: EncargoDelegacion): Promise<{ ok: true; cuenta: CuentaCandidata } | RechazoModelo> {
    if (e.modelo === undefined && e.esfuerzo === undefined) return { ok: true, cuenta: primera }
    const probar = esAuto(e.cuenta) ? cuentasLibres(candidatas, e.agente) : [primera]
    let rechazo: RechazoModelo | null = null
    const limite = this.ahora() + TOPE_CATALOGO_MS
    for (const cuenta of probar) {
      const restante = limite - this.ahora()
      if (restante <= 0) return { ok: true, cuenta }
      const catalogo = await this.catalogoDe(origen, cuenta.id, false, restante)
      const motivo = catalogo ? comprobarPeticion(catalogo.modelos, e.modelo, e.esfuerzo) : null
      if (!motivo) return { ok: true, cuenta }
      rechazo ??= motivo
    }
    return rechazo ?? { ok: true, cuenta: primera }
  }

  /** Los modelos que anuncia una cuenta para `tctx modelos`. */
  async modelos(origen: OrigenDelegacion, agente: AgenteDelegable, pedida: string, actualizar: boolean): Promise<ResultadoModelos> {
    const limite = this.ahora() + TOPE_CATALOGO_MS
    const docker = await conTope(this.n.sandbox.asegurarDocker(), TOPE_CATALOGO_MS)
    if (!docker) return { ok: false, rechazo: 'docker-iniciando' }
    if (!docker.ok) return { ok: false, rechazo: 'sin-docker' }
    const candidatas = await this.candidatas(origen.profileId, agente, esAuto(pedida))
    const eleccion = elegirCuenta(candidatas, agente, pedida)
    // Consultar no gasta uso: una cuenta agotada también sirve para ver qué ofrece.
    const cuenta = eleccion.ok ? eleccion.cuenta : esAuto(pedida) ? candidatas.find((c) => c.agente === agente && c.credencial) : undefined
    if (!cuenta) return eleccion.ok ? { ok: false, rechazo: 'catalogo-no-disponible' } : eleccion
    const catalogo = await this.catalogoDe(origen, cuenta.id, actualizar, Math.max(1, limite - this.ahora()))
    return catalogo ? { ok: true, agente, cuenta: cuenta.nombre, leido: catalogo.leido, modelos: catalogo.modelos } : { ok: false, rechazo: 'catalogo-no-disponible' }
  }

  /** El catálogo de la cuenta: el guardado o uno recién leído, sin dos lecturas a la vez; null si no llega a tiempo. */
  private catalogoDe(origen: OrigenDelegacion, accountId: string, actualizar: boolean, topeMs = TOPE_CATALOGO_MS): Promise<{ modelos: ModeloDelegable[]; leido: number } | null> {
    const guardado = this.catalogos.get(accountId)
    if (!actualizar && guardado && this.ahora() - guardado.leido < VIDA_CATALOGO_MS) return Promise.resolve(guardado)
    let lectura = this.leyendoCatalogo.get(accountId)
    if (!lectura) {
      lectura = this.leerCatalogo(origen, accountId)
        .catch((err) => {
          this.n.log(`delegacion: catalogo de ${accountId}: ${errMsg(err)}`)
          return null
        })
        .then((c) => {
          this.leyendoCatalogo.delete(accountId)
          if (c) this.catalogos.set(accountId, c)
          return c
        })
      this.leyendoCatalogo.set(accountId, lectura)
    }
    return new Promise((resolve) => {
      const reloj = setTimeout(() => resolve(null), topeMs)
      reloj.unref?.()
      void lectura.then((c) => {
        clearTimeout(reloj)
        resolve(c)
      })
    })
  }

  /** Pregunta al CLI dentro del contenedor de la cuenta, con las mismas referencias que una tarea. */
  private async leerCatalogo(origen: OrigenDelegacion, accountId: string): Promise<{ modelos: ModeloDelegable[]; leido: number } | null> {
    const profile = this.n.profiles.get(origen.profileId)
    const cuenta = this.n.accounts.get(accountId)
    if (!profile || !cuenta) return null
    const agente = cuenta.agente as AgenteDelegable
    const destino = contenedorDe(profile, agente, cuenta.id)
    const soltar = this.referencias(profile, cuenta, destino, `delegada:catalogo-${randomBytes(4).toString('hex')}`)
    try {
      const prep = await prepararContenedor(this.n, profile, agente, cuenta, { profileId: profile.id, agente, projectHostPath: origen.projectHostPath, accountId: cuenta.id, mode: 'container' })
      const r = await this.n.sandbox.exec(destino, lineaCatalogo(agente, this.n.binaries[agente], prep.configContainerPath), { cwd: CARPETA_NEUTRA })
      const leido = leerCatalogo(agente, r.stdout)
      if (!leido.ok) {
        this.n.log(`delegacion: catalogo de ${agente}/${cuenta.id}: ${leido.motivo}`)
        return null
      }
      return { modelos: leido.modelos, leido: this.ahora() }
    } finally {
      await soltar()
    }
  }

  /** Las tareas del proyecto, de la más reciente a la más antigua: lo que permite recuperar un id perdido. */
  listar(origen: OrigenDelegacion): VistaTarea[] {
    return [...this.tareas.values()]
      .filter((t) => t.vista.profileId === origen.profileId && t.projectHostPath === origen.projectHostPath)
      .sort((a, b) => b.vista.inicio - a.vista.inicio)
      .slice(0, MAX_TAREAS_LISTADAS)
      .map((t) => this.vistaViva(t))
  }

  /** La tarea, si es del mismo perfil y proyecto que quien pregunta. */
  ver(origen: OrigenDelegacion, id: string): VistaTareaConResultado | null {
    const t = this.deQuien(origen, id)
    if (!t) return null
    return { ...this.vistaViva(t), ...(t.vista.estado === 'hecha' && t.resultado !== null ? { resultado: t.resultado } : {}) }
  }

  /**
   * Cancela una tarea; `false` si no existe o no es de quien pregunta. Espera a que termine del todo, con tope: un
   * proceso que no sale (Docker recién reiniciado, un montaje colgado) no puede retener a quien cancela. Vencido el
   * tope se da por cancelada; su proceso, si sigue, lo remata el cierre de la sesión o el de la app.
   */
  async cancelar(origen: OrigenDelegacion | null, id: string, motivo: MotivoFallo = 'cancelada-por-usuario'): Promise<boolean> {
    const t = origen ? this.deQuien(origen, id) : (this.tareas.get(id) ?? null)
    if (!t) return false
    if (t.vista.estado === 'interrumpida') {
      t.vista = { ...t.vista, estado: 'cancelada', motivo }
      this.guardarRegistro()
      return true
    }
    if (t.vista.estado !== 'en-marcha') return true
    const ej = t.ej
    ej.parada ??= motivo
    ej.parar()
    const sesion = ej.sesion
    // Sin sesión aún, la apertura la ve al volver y termina ella: así suelta lo que montó.
    const cierre = (async (): Promise<void> => {
      if (sesion) await this.n.terminals.closeSession(sesion).catch((err) => this.n.log(`delegacion: cerrar ${id}: ${errMsg(err)}`))
      await ej.hecha
    })()
    let reloj: ReturnType<typeof setTimeout> | undefined
    const vencido = new Promise<boolean>((r) => {
      reloj = setTimeout(() => r(true), this.topeCancelarMs)
    })
    const sinTerminar = await Promise.race([cierre.then(() => false), vencido])
    clearTimeout(reloj)
    if (sinTerminar && t.ej === ej && t.vista.estado === 'en-marcha') {
      this.n.log(`delegacion: ${id} no terminó en ${this.topeCancelarMs} ms al cancelarla (sesion=${sesion ?? 'ninguna'}): se da por cancelada`)
      ej.forzada = true
      // Lo que escribe su estado (y revoca su token) va antes de su primera espera: al volver, ya consta cancelada.
      void this.terminar(t, ej, null)
    }
    return true
  }

  /**
   * Sigue la misma conversación con una orden nueva; si la tarea seguía en marcha, primero la para. Conserva el modelo
   * y el esfuerzo salvo que se pidan otros. Pasa a depender de quien continúa, que puede ser una sesión nueva tras un corte.
   */
  async continuar(origen: OrigenDelegacion, id: string, orden: string, ajustes: AjustesModelo = {}): Promise<VistaTarea | 'no-existe' | 'sin-conversacion' | 'sigue-cerrandose' | RechazoModelo> {
    const t = this.deQuien(origen, id)
    if (!t) return 'no-existe'
    const conversacion = t.vista.conversacion ?? t.ej.lector?.resumen().conversacion ?? null
    if (!conversacion) return 'sin-conversacion'
    const modelo = ajustes.modelo ?? t.vista.modelo
    let esfuerzo = ajustes.esfuerzo ?? t.vista.esfuerzo
    if (ajustes.modelo !== undefined || ajustes.esfuerzo !== undefined) {
      const catalogo = await this.catalogoDe(origen, t.accountId, false)
      if (catalogo) {
        esfuerzo = esfuerzoAlContinuar(catalogo.modelos, ajustes.modelo, ajustes.esfuerzo, t.vista.esfuerzo)
        const motivo = comprobarPeticion(catalogo.modelos, modelo, esfuerzo)
        if (motivo) return motivo
      }
    }
    const previa = t.ej
    if (t.vista.estado === 'en-marcha') await this.cancelar(origen, id, 'cancelada-por-usuario')
    // Otro `--continuar` llegó a la vez y ya lanzó la suya: dos ejecuciones sobre la misma conversación no.
    if (t.ej !== previa || t.vista.estado === 'en-marcha') return { ...this.vistaViva(t) }
    // Ni con la anterior viva, aunque conste cancelada: escribirían las dos en el mismo transcript.
    if (previa.forzada && !previa.terminada) return 'sigue-cerrandose'
    const ahora = this.ahora()
    t.vista = {
      ...t.vista,
      origen: origen.clave,
      modelo,
      esfuerzo,
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
    this.guardarRegistro()
    this.avisar(true)
    void this.lanzar(t, t.ej, orden, conversacion)
    return { ...t.vista }
  }

  /**
   * Cancela las tareas en marcha que cumplan `filtro` y espera a que suelten su credencial: cerrar la sesión de una
   * cuenta, borrarla o parar su perfil no deja una tarea gastándola con la credencial montada. Con el tope de cancelar,
   * una cuyo proceso no sale vuelve sin token de bases y con su credencial aún montada hasta que salga: es un proceso
   * colgado, que no avanza, y esperarlo dejaría colgada la acción del usuario.
   */
  async cancelarDonde(filtro: (t: { profileId: string; agente: AgenteDelegable; accountId: string }) => boolean, motivo: MotivoFallo = 'cancelada-por-usuario'): Promise<void> {
    const vivas = [...this.tareas.values()].filter((t) => t.vista.estado === 'en-marcha' && filtro({ profileId: t.vista.profileId, agente: t.vista.agente, accountId: t.accountId }))
    await Promise.allSettled(vivas.map((t) => this.cancelar(null, t.vista.id, motivo)))
  }

  /** Las tareas en marcha, de cualquier perfil. */
  enMarcha(): { id: string; cuenta: string; resumen: string }[] {
    return [...this.tareas.values()].filter((t) => t.vista.estado === 'en-marcha').map((t) => ({ id: t.vista.id, cuenta: t.vista.cuenta, resumen: t.vista.resumen }))
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
  vistas(): VistaTareaPanel[] {
    return [...this.tareas.values()].filter((t) => !t.descartada).map((t) => ({ ...this.vistaViva(t), accountId: t.accountId }))
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
        const enMarcha = [...this.tareas.values()].filter((t) => t.accountId === c.id && t.vista.estado === 'en-marcha').length
        return { id: c.id, nombre: c.nombre, agente, credencial, ventanas, enMarcha }
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
    // Tras un corte Docker suele estar apagado: el primer paso es intentar levantarlo, a la vista de quien consulta la tarea.
    const asegurado = this.n.sandbox
      .asegurarDocker(() => {
        t.vista.actividad = [txAgentes().fallos.iniciandoDocker]
        this.avisar(true)
      })
      .catch((err: unknown) => ({ ok: false, detalle: errMsg(err) }))
    const docker = await Promise.race([asegurado, ej.alParar.then(() => null)])
    if (ej.parada || !docker) return this.terminar(t, ej, null)
    if (!docker.ok) return this.terminar(t, ej, null, { motivo: 'docker', detalle: docker.detalle.split('\n')[0] })
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
        ...(t.vista.modelo ? { modelo: t.vista.modelo } : {}),
        ...(t.vista.esfuerzo ? { esfuerzo: t.vista.esfuerzo } : {}),
        aviso: this.aviso(profile, t.projectHostPath, dbIds, t.vista.soloLectura),
        conCapa: prep.conCapa,
        entorno
      })
      // Ancho grande: lo que no es JSON (avisos del CLI) no se parte en líneas.
      const sesion = await this.n.terminals.createSession(destino, { project: t.projectHostPath, launch, extraEnv: entorno, tamano: { cols: 400, rows: 50 } })
      ej.sesion = sesion.id
      // Cancelada mientras se abría (quizá ya dada por cancelada por el tope): su token no se ata, o nadie lo revocaría.
      if (!ej.parada) {
        ej.claveToken = claveSesionAgente(`${PREFIJO_SESION_DELEGADA}${t.vista.id}`)
        this.n.bindDbSession(entorno, ej.claveToken)
      }
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
      const otra = [...this.n.sessions.values()].some((s) => enElMismoContenedor(s, profile, destino))
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
      // En cuanto se conoce: es lo que permite reanudarla si todo se apaga un segundo después.
      if (t.ej === ej && !t.vista.conversacion) {
        const conversacion = lector?.resumen().conversacion
        if (conversacion) {
          t.vista.conversacion = conversacion
          this.guardarRegistro()
        }
      }
    })
    const finExit = this.n.terminals.onExit(sesion, (codigo) => {
      fuera()
      finExit()
      void this.n.terminals.closeSession(sesion).catch(() => undefined)
      void this.causaDeSalida(ej).then((forzado) => this.terminar(t, ej, codigo, forzado))
    })
  }

  /** Si Docker cortó la ejecución, se dice que fue Docker y no lo último que escribió su cliente. */
  private async causaDeSalida(ej: Ejecucion): Promise<{ motivo: MotivoFallo } | undefined> {
    const r = ej.lector?.resumen(true) ?? null
    if (ej.parada || !puedeSerDocker(r)) return undefined
    const caido = salidaDeDocker(r) || !(await this.n.sandbox.checkDocker().catch(() => ({ ok: false }))).ok
    return caido ? { motivo: 'docker' } : undefined
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
    this.guardarRegistro()
    return `${rutaConfig}/${CARPETA_ORDENES}/${nombre}`
  }

  /**
   * Cierra una ejecución: estado, resultado, referencias y archivo de la orden. Una vez por ejecución. La que se dio por
   * cancelada sin salir escribe su estado entonces y suelta lo que tiene cuando sale de verdad (la siguiente llamada).
   */
  private async terminar(t: Tarea, ej: Ejecucion, codigo: number | null, forzado?: { motivo: MotivoFallo; detalle?: string }): Promise<void> {
    if (t.ej !== ej || ej.terminada) return
    if (t.vista.estado !== 'en-marcha') {
      if (ej.forzada) await this.soltarEjecucion(t, ej)
      return
    }
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
    this.guardarRegistro()
    this.avisar(true)
    this.n.log(`delegacion: ${t.vista.id} ${final.estado}${final.motivo ? ` (${final.motivo})` : ''} codigo=${codigo}`)
    // Dada por cancelada con el proceso vivo: la credencial y el contenedor siguen tomados hasta que salga.
    if (ej.forzada) return
    await this.soltarEjecucion(t, ej)
  }

  /** Suelta la credencial y el contenedor de una ejecución y la da por terminada del todo. */
  private async soltarEjecucion(t: Tarea, ej: Ejecucion): Promise<void> {
    const soltar = ej.soltar
    ej.soltar = null
    ej.terminada = true
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
    const terminadas = [...this.tareas.values()].filter((t) => t.vista.estado !== 'en-marcha' && t.vista.estado !== 'interrumpida').sort((a, b) => (a.vista.fin ?? 0) - (b.vista.fin ?? 0))
    for (const [i, t] of terminadas.entries()) {
      if (ahora - (t.vista.fin ?? ahora) > VIDA_TERMINADA_MS || terminadas.length - i > MAX_TERMINADAS) this.tareas.delete(t.vista.id)
    }
    for (const t of this.tareas.values()) {
      if (t.vista.estado === 'interrumpida' && ahora - (t.vista.fin ?? ahora) > VIDA_INTERRUMPIDA_MS) this.tareas.delete(t.vista.id)
    }
  }
}
