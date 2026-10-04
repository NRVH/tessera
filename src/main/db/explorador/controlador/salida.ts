// =============================================================================
// Ganchos de `DbController` y ciclo de vida: cambios de conexión, ajustes, cierre de la app y sus diálogos.
// Sin `electron`: los diálogos y la ventana llegan inyectados por `OpcionesExplorador`.
// Decisiones: docs/decisiones/bd/explorador-salida-de-la-app.md
// =============================================================================

import type { BrowserWindow } from 'electron'

import type { AjustesSesionesBd } from '../../../../shared/ajustesBd.ts'
import {
  type DbEstadoTx,
  type DbPestanaSinEnviar,
  DBX_CHANNELS
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { descriptor, esDeClaves, esDeDocumentos, esMotor } from '../../../../shared/motores/index.ts'

import { emisorDeVentana } from '../../../util/emisorEventos.ts'
import { type ErrorResolucion, esperar } from '../GestorSesiones.ts'
import { ACUSE_VACIADO_MS, CIERRE_TRABAJADORES_MS } from '../limites.ts'
import {
  bloqueSinEnviar,
  dialogoSoloSinEnviar,
  fraseCambios,
  leerSinEnviar,
  PLAZO_SIN_ENVIAR_MS,
  RESPUESTA_DESCARTAR_Y_SALIR,
  totalSinEnviar
} from '../salidaSinEnviar.ts'

import type { TablaExplorador } from './tabla.ts'
import type { ContextoExplorador, OpcionesExplorador } from './tipos.ts'
import { mensajeDe, PLAZO_COMMIT_SALIDA_MS, PLAZO_ROLLBACK_SALIDA_MS } from './validacion.ts'

/** Ganchos de `DbController` y ciclo de vida: cambios de conexión, ajustes, cierre de la app y sus diálogos. */
export class SalidaExplorador {
  private readonly c: ContextoExplorador
  private readonly pestana: TablaExplorador

  constructor(c: ContextoExplorador, pestana: TablaExplorador) {
    this.c = c
    this.pestana = pestana
  }

  /** Tras un UPDATE correcto: se retiran sus sesiones y se invalida su catálogo. */
  alCambiarConexion(previo: DbConnection, nuevo: DbConnection, soloCasillaAgentes = false): void {
    // Solo la casilla de los agentes: las sesiones, las consolas y la caché
    // siguen valiendo. `tdb` lee el registro en cada llamada y ya ve la casilla nueva.
    if (this.casillaSinEfecto(previo, soloCasillaAgentes)) return
    this.c.gestor.alCambiarConexion(previo, nuevo)
    this.c.cache.invalidar(nuevo.id, { motivo: 'edicion' })
    // Lo abierto en MongoDB usa la configuración vieja: se cierra.
    if (esMotor(previo.motor) && esDeDocumentos(descriptor(previo.motor))) this.c.opciones.documentos?.alCambiarConexion(nuevo.id)
    // Y en Redis.
    if (esMotor(previo.motor) && esDeClaves(descriptor(previo.motor))) this.c.opciones.claves?.alCambiarConexion(nuevo.id)
  }

  /** Tras un DELETE correcto: fuera sesiones (con rollback), caché y consolas (a la papelera). */
  alBorrarConexion(conexionId: string, profileId: string): void {
    this.c.gestor.alBorrarConexion(conexionId)
    // Si era de documentos, su proceso sale (si no, no hay nada que cerrar).
    this.c.opciones.documentos?.alBorrarConexion(conexionId)
    this.c.opciones.claves?.alBorrarConexion(conexionId)
    this.c.cache.olvidarConexion(conexionId)
    this.c.estado.olvidarConsolasDeConexion(conexionId)
    this.c.consolas
      .borrarDeConexion(profileId, conexionId)
      .then((n) => {
        if (n > 0) this.c.log(`${n} consola(s) de ${conexionId} a la papelera`)
      })
      .catch((e: unknown) => this.c.log(`no se pudieron borrar las consolas de ${conexionId}: ${mensajeDe(e)}`))
    // Su historial también: el id no volverá a existir y sus entradas quedarían huérfanas.
    this.c.historial
      ?.borrarConexion(profileId, conexionId)
      .catch((e: unknown) => this.c.log(`no se pudo borrar el historial de ${conexionId}: ${mensajeDe(e)}`))
  }

  /**
   * Tras un DELETE que borró la copia de un perfil cuya conocida vive en OTRO: la mitad por perfil de
   * `alBorrarConexion`. Las consolas de ESE perfil atadas al id van a la papelera, su historial se
   * borra y se olvidan sus claves `perfil|consola`. No toca las sesiones, los procesos ni la caché
   * del id: son de la conocida del otro perfil, y cerrarlas revertiría su transacción pendiente.
   */
  alOlvidarConexionEnPerfil(conexionId: string, profileId: string): void {
    this.c.estado.olvidarConsolasDeConexion(conexionId, profileId)
    this.c.consolas
      .borrarDeConexion(profileId, conexionId)
      .then((n) => {
        if (n > 0) this.c.log(`${n} consola(s) de ${conexionId} en ${profileId} a la papelera (la conocida del id es de otro perfil)`)
      })
      .catch((e: unknown) => this.c.log(`no se pudieron borrar las consolas de ${conexionId} en ${profileId}: ${mensajeDe(e)}`))
    this.c.historial
      ?.borrarConexion(profileId, conexionId)
      .catch((e: unknown) => this.c.log(`no se pudo borrar el historial de ${conexionId} en ${profileId}: ${mensajeDe(e)}`))
  }

  /**
   * Un perfil se BORRÓ (lo llama `main/agents/componer.ts` desde el guardado de perfiles): fuera
   * su historial de consultas, que vive fuera de su espacio de datos y nadie más limpia.
   */
  alBorrarPerfil(perfilId: string): Promise<void> {
    if (!this.c.historial) return Promise.resolve()
    return this.c.historial.borrar(perfilId, null).catch((e: unknown) => {
      this.c.log(`no se pudo borrar el historial de un perfil borrado: ${mensajeDe(e)}`)
    })
  }

  /** Al arrancar: borra el historial de los perfiles que ya no existen (como `pruneProfiles`). */
  podarHistorial(perfilesVivos: readonly string[]): Promise<void> {
    if (!this.c.historial) return Promise.resolve()
    return this.c.historial
      .podar(perfilesVivos)
      .then((n) => {
        if (n > 0) this.c.log(`historial: ${n} archivo(s) de perfiles borrados`)
      })
      .catch((e: unknown) => this.c.log(`no se pudo podar el historial: ${mensajeDe(e)}`))
  }

  /** Antes del UPDATE: editar con una transacción pendiente queda bloqueado. */
  puedeEditarConexion(id: string, soloCasillaAgentes = false): { ok: true } | { ok: false; mensaje: string } {
    // Solo la casilla de los agentes: no se retira nada, así que tampoco hay nada que
    // revertir (lo decide `ConnectionStore.soloCambiaLaCasillaDeAgentes`).
    const previo = this.c.conexiones.get(id)
    if (previo && this.casillaSinEfecto(previo, soloCasillaAgentes)) return { ok: true }
    if (!this.c.gestor.hayTxPendiente(id)) return { ok: true }
    return { ok: false, mensaje: 'Confirma o revierte primero las transacciones pendientes de esta conexión.' }
  }

  /**
   * ¿La edición solo cambia la casilla de los agentes Y el explorador no la mira? En el
   * producto no la mira nunca (`sinSoloLecturaImpuesta`); un test o el humo pueden imponer
   * una solo lectura que SÍ dependa de ella, y ahí guardar sigue siendo una edición.
   */
  private casillaSinEfecto(previo: DbConnection, soloCasillaAgentes: boolean): boolean {
    return soloCasillaAgentes && this.pestana.roDe(previo) === this.pestana.roDe({ ...previo, readonly: !previo.readonly })
  }

  /** Antes de instalar u olvidar un cliente: cierra los procesos que lo usan (EBUSY). */
  async antesDeCambiarDriver(packId: string): Promise<void> {
    await this.c.gestor.cerrarProcesosDelDriver(packId)
  }

  // =============================================================================
  // CICLO DE VIDA
  // =============================================================================

  /**
   * Ajustes del usuario que aplica el gestor: los manda el main al
   * arrancar y en cada `SAVE_SETTINGS`, ya pasados por `ajustesSesionesDe`. No lanza: el
   * gestor solo re-sanea con la regla compartida y asigna.
   */
  fijarAjustes(a: AjustesSesionesBd): void {
    this.c.gestor.fijarAjustes(a)
  }

  barrer(ahora?: number): void {
    try {
      this.c.gestor.barrer(ahora)
    } catch (e) {
      this.c.log(`barrido falló: ${mensajeDe(e)}`)
    }
    try {
      this.c.opciones.documentos?.barrer(ahora)
    } catch (e) {
      this.c.log(`barrido de documentos falló: ${mensajeDe(e)}`)
    }
    try {
      this.c.opciones.claves?.barrer(ahora)
    } catch (e) {
      this.c.log(`barrido de claves falló: ${mensajeDe(e)}`)
    }
  }

  /**
   * `alias · consola` de cada sesión con transacción pendiente. Una tx `fallida` va
   * marcada: «Confirmar y salir» no puede confirmarla (el COMMIT de PG sobre una tx
   * en 'E' es un ROLLBACK que se daría por bueno), así que el gestor la REVIERTE en
   * ese bloque —y confirma las demás—, y eso tiene que leerse ANTES de elegir.
   */
  private async describir(
    items: ReadonlyArray<{ ref: ErrorResolucion['ref']; conexionId: string; mensaje?: string; tx?: DbEstadoTx }>
  ): Promise<string[]> {
    const nombres = new Map<string, Map<string, string>>()
    const lineas: string[] = []
    for (const it of items) {
      const alias = this.c.conexiones.get(it.conexionId)?.alias ?? 'conexión'
      let quien: string = it.ref.rol
      if (it.ref.rol === 'consola') {
        const perfil = it.ref.perfilId
        let delPerfil = nombres.get(perfil)
        if (!delPerfil) {
          delPerfil = new Map()
          try {
            for (const i of await this.c.consolas.listar(perfil)) delPerfil.set(i.id, i.nombre)
          } catch {
            // sin nombres: se enseña el id
          }
          nombres.set(perfil, delPerfil)
        }
        quien = delPerfil.get(it.ref.consolaId) ?? 'consola'
      }
      if (it.tx === 'fallida') quien = `${quien} (fallida: se revertirá)`
      lineas.push(it.mensaje ? `${alias} · ${quien}: ${it.mensaje}` : `${alias} · ${quien}`)
    }
    return lineas
  }

  /**
   * Diálogo NATIVO de salida: antes pregunta al renderer por los cambios de la rejilla sin enviar
   * (con plazo) y, si hay transacciones pendientes, ofrece Confirmar y salir / Revertir y salir /
   * Cancelar. Sin nada pendiente no hay diálogo, por eso el llamador la invoca SIEMPRE. `cancelar`
   * = la app sigue viva.
   */
  async confirmarSalida(
    win: BrowserWindow | null,
    plazoSinEnviarMs: number = PLAZO_SIN_ENVIAR_MS
  ): Promise<'seguir' | 'cancelar'> {
    // Primero lo que solo sabe el renderer: las pestañas de tabla con cambios SIN ENVIAR.
    // `null` = no contestó a tiempo; no se sabe y se sigue como antes.
    const sinEnviar = (await this.pedirSinEnviar(win, plazoSinEnviarMs)) ?? []
    // Las transacciones se leen DESPUÉS de la espera: son las de ahora, no las de antes.
    const pendientes = this.c.gestor.pendientes()
    if (pendientes.length === 0 && sinEnviar.length === 0) return 'seguir'
    const mostrar = this.c.opciones.mostrarMensaje
    if (!mostrar) {
      this.c.log('salida con transacciones pendientes o cambios sin enviar y sin diálogo: se pierden al cerrar')
      return 'seguir'
    }
    // Hay algo que preguntar: la ventana, A LA VISTA antes del diálogo. Sin nada pendiente la app
    // se cierra sin asomarse.
    this.ponerALaVista(win)
    if (pendientes.length === 0) {
      // Solo cambios sin enviar: nada que resolver en el servidor; mueren con el renderer.
      const r0 = await mostrar(win, dialogoSoloSinEnviar(sinEnviar))
      return r0.response === RESPUESTA_DESCARTAR_Y_SALIR ? 'seguir' : 'cancelar'
    }
    return this.preguntarPorTransacciones(win, mostrar, pendientes, sinEnviar)
  }

  /** El diálogo de salida con transacciones pendientes: Confirmar y salir / Revertir y salir / Cancelar. */
  private async preguntarPorTransacciones(
    win: BrowserWindow | null,
    mostrar: NonNullable<OpcionesExplorador['mostrarMensaje']>,
    pendientes: ReturnType<ContextoExplorador['gestor']['pendientes']>,
    sinEnviar: DbPestanaSinEnviar[]
  ): Promise<'seguir' | 'cancelar'> {
    const n = pendientes.length
    const lineas = await this.describir(pendientes)
    // Con alguna fallida, se dice qué hace «Confirmar y salir» con ella ANTES de elegir.
    const hayFallidas = pendientes.some((p) => p.tx === 'fallida')
    const notaFallidas = hayFallidas
      ? '\n\nLas marcadas como fallidas no se pueden confirmar: se revierten con cualquiera de las dos opciones.'
      : ''
    // Con cambios sin enviar, el MISMO diálogo los nombra; sin ellos, queda exactamente como era.
    const txFrase = n === 1 ? 'una transacción sin confirmar' : `${n} transacciones sin confirmar`
    const conCambios = sinEnviar.length > 0 ? ` y ${fraseCambios(totalSinEnviar(sinEnviar))} sin enviar` : ''
    const r = await mostrar(win, {
      type: 'warning',
      title: 'Transacciones sin confirmar',
      message: `Hay ${txFrase}${conCambios}.`,
      detail: `${lineas.join('\n')}\n\nSi sales revirtiendo, se pierden sus cambios.${notaFallidas}${bloqueSinEnviar(sinEnviar)}`,
      buttons: ['Confirmar y salir', 'Revertir y salir', 'Cancelar'],
      defaultId: 2,
      cancelId: 2,
      noLink: true
    })
    if (r.response === 2) return 'cancelar'
    if (r.response === 1) {
      await this.c.gestor.resolverTodas('rollback', PLAZO_ROLLBACK_SALIDA_MS)
      return 'seguir'
    }
    return this.confirmarEnBloque(win, mostrar)
  }

  /**
   * Confirma en bloque: las pendientes se confirman y las fallidas se REVIERTEN. Solo sale un
   * segundo diálogo por un COMMIT que el servidor rechazó de verdad o que no llegó a tiempo.
   */
  private async confirmarEnBloque(
    win: BrowserWindow | null,
    mostrar: NonNullable<OpcionesExplorador['mostrarMensaje']>
  ): Promise<'seguir' | 'cancelar'> {
    const res = await this.c.gestor.resolverTodas('commit', PLAZO_COMMIT_SALIDA_MS)
    if (res.revertidas.length > 0) {
      this.c.log(`salida: ${res.revertidas.length} transacción(es) fallida(s) revertida(s); el resto se confirmó`)
    }
    if (res.ok) return 'seguir'
    const fallidas = await this.describir(res.errores)
    const r2 = await mostrar(win, {
      type: 'error',
      title: 'No se pudo confirmar',
      message: '¿Salir revirtiendo?',
      detail: `No se pudieron confirmar:\n${fallidas.join('\n')}\n\nSi sales, el servidor revertirá esos cambios.`,
      buttons: ['Salir revirtiendo', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (r2.response !== 0) return 'cancelar'
    await this.c.gestor.resolverTodas('rollback', PLAZO_ROLLBACK_SALIDA_MS)
    return 'seguir'
  }

  /**
   * Trae la ventana A LA VISTA antes del diálogo de salida: con la ventana minimizada el diálogo
   * caía en la esquina de otro monitor (medido en Windows). No es una barrera y no lanza nunca:
   * si la ventana no se deja, el diálogo sale igual.
   */
  private ponerALaVista(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) return
    try {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    } catch (e) {
      this.c.log(`salida: no se pudo traer la ventana a la vista: ${mensajeDe(e)}`)
    }
  }

  /**
   * Pregunta al renderer qué pestañas de tabla tienen cambios SIN ENVIAR y
   * espera como mucho `plazoMs`. `null` = no se sabe: sin ventana viva, o no contestó a
   * tiempo (colgado, recargando). La salida nunca se queda esperando por esto.
   */
  private async pedirSinEnviar(win: BrowserWindow | null, plazoMs: number): Promise<DbPestanaSinEnviar[] | null> {
    const destino = emisorDeVentana(() => win)
    if (!this.c.opciones.emitir && !destino.hayDestino()) return null
    let id = 0
    let temporizador: ReturnType<typeof setTimeout> | undefined
    const respuesta = new Promise<DbPestanaSinEnviar[] | null>((resolve) => {
      id = this.c.estado.abrirEsperaSinEnviar(resolve)
      temporizador = setTimeout(() => resolve(null), plazoMs)
    })
    try {
      if (this.c.opciones.emitir) this.c.opciones.emitir(DBX_CHANNELS.EV_PEDIR_SIN_ENVIAR, { id })
      else destino.emitir(DBX_CHANNELS.EV_PEDIR_SIN_ENVIAR, { id })
    } catch (e) {
      this.c.log(`salida: no se pudo preguntar por los cambios sin enviar: ${mensajeDe(e)}`)
      clearTimeout(temporizador)
      this.c.estado.cerrarEsperaSinEnviar(id)
      return null
    }
    const r = await respuesta
    clearTimeout(temporizador)
    this.c.estado.cerrarEsperaSinEnviar(id)
    if (r === null) this.c.log('salida: el renderer no dijo a tiempo si hay cambios sin enviar; se sigue sin saberlo')
    return r
  }

  /** `dbx:sinEnviar` del renderer: solo vale la respuesta a la pregunta EN CURSO. */
  alSinEnviar(payload: unknown): void {
    this.c.estado.responderSinEnviar((id) => leerSinEnviar(payload, id))
  }

  /** Acuse `dbx:consolas:vaciadas` del renderer. */
  alAcuseVaciado(): void {
    this.c.estado.acusarVaciado()
  }

  /**
   * Pide al renderer su texto de consola pendiente (debounce de 300 ms) y espera el
   * acuse como mucho `plazoMs`; después vacía la cadena de escritura del store.
   */
  async vaciarConsolas(win: BrowserWindow | null, plazoMs: number = ACUSE_VACIADO_MS): Promise<void> {
    const destino = emisorDeVentana(() => win)
    if (this.c.opciones.emitir || destino.hayDestino()) {
      const acuse = this.c.estado.esperarVaciado()
      if (this.c.opciones.emitir) this.c.opciones.emitir(DBX_CHANNELS.EV_VACIAR_CONSOLAS)
      else destino.emitir(DBX_CHANNELS.EV_VACIAR_CONSOLAS)
      await Promise.race([acuse, esperar(plazoMs)])
      this.c.estado.olvidarEsperasDeVaciado()
    }
    try {
      await this.c.consolas.vaciar()
    } catch (e) {
      this.c.log(`vaciar consolas falló: ${mensajeDe(e)}`)
    }
  }

  /** Cierre: sale de todos los procesos (SIGKILL de respaldo tras `plazoMs`). */
  async cerrarTodo(plazoMs: number = CIERRE_TRABAJADORES_MS): Promise<void> {
    // Los procesos de documentos salen A LA VEZ que los SQL: el plazo de
    // la salida es uno solo, no la suma.
    const docs = this.c.opciones.documentos
    const cierreDocs = docs
      ? docs.cerrarTodo(plazoMs).catch((e: unknown) => this.c.log(`cerrarTodo de documentos falló: ${mensajeDe(e)}`))
      : Promise.resolve()
    // Y los de claves, también a la vez.
    const kv = this.c.opciones.claves
    const cierreKv = kv
      ? kv.cerrarTodo(plazoMs).catch((e: unknown) => this.c.log(`cerrarTodo de claves falló: ${mensajeDe(e)}`))
      : Promise.resolve()
    try {
      await this.c.gestor.cerrarTodo(plazoMs)
    } catch (e) {
      this.c.log(`cerrarTodo falló: ${mensajeDe(e)}`)
    }
    await Promise.all([cierreDocs, cierreKv])
    // Lo último que se ejecutó aún puede estar anotándose en el historial: se le da un
    // momento (son `appendFile` de una línea), sin retener la salida si el disco se atasca.
    if (this.c.historial) await Promise.race([this.c.historial.esperar(), esperar(Math.min(plazoMs, 1000))])
  }

  /** El cierre se abortó y la app sigue: ver `GestorSesiones.reanudarTrasCierreAbortado`. */
  reanudarTrasCierreAbortado(): void {
    this.c.gestor.reanudarTrasCierreAbortado()
    this.c.opciones.documentos?.reanudarTrasCierreAbortado()
    this.c.opciones.claves?.reanudarTrasCierreAbortado()
  }
}
