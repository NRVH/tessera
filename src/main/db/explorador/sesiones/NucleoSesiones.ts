// =============================================================================
// Núcleo del gestor de sesiones: el ÚNICO dueño del estado (procesos, sesiones, lectores,
// secuencias, ajustes) y lo que lo toca directamente: aplicar eventos a la máquina y sus
// efectos síncronos, emitir, perder y terminar, crear y olvidar sesiones y el registro de
// lectores. Las operaciones de esta carpeta lo reciben y no guardan estado propio (el
// `correlador.ts` de al lado es del transporte de cada proceso, no una operación).
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbEstadoSesion, DbEstadoTx, DbRefSesion, DbTxModo } from '../../../../shared/db-explorador-ipc.ts'
import { descriptor, pideUsuarioYClave } from '../../../../shared/motores/index.ts'
import type { ClaseSentencia } from '../../../../shared/sql/clasificarSql.ts'
import { AJUSTES_SESIONES_POR_DEFECTO, type AjustesSesionesBd } from '../../../../shared/ajustesBd.ts'
import { PREFIJO_SESION_EDICION } from '../edicionRejilla.ts'
import { txModoInicialConsola } from '../produccion.ts'
import { sinSoloLecturaImpuesta } from '../soloLecturaImpuesta.ts'
import { ColaSesion } from '../colaSesion.ts'
import { type EfectoSesion, estadoInicial, type EventoSesion, transicion } from '../maquinaSesion.ts'
import { aEstadoSesion } from './estadoMaquina.ts'
import { MAX_LECTORES_POR_SESION } from '../limites.ts'
import { esFalloTrabajador, type ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { ErrorGestor, mensajeDe } from './errores.ts'
import { claveDeRef, exigirSql } from './reglas.ts'
import type { DependenciasGestor, Lector, Proceso, RefConsola, Sesion } from './tipos.ts'

/** Estado del gestor de sesiones y las operaciones que lo tocan directamente. */
export class NucleoSesiones {
  /** Lo inyectado al construir el gestor: solo se leen y se llaman sus funciones. */
  readonly deps: Readonly<DependenciasGestor>

  /** El proceso VIGENTE de cada clave (conexión, o consola con proceso propio). */
  private readonly vigentes = new Map<string, Proceso>()

  /** Todos los procesos vivos, incluidos los retirados que aún no salieron. */
  private readonly todos = new Set<Proceso>()

  /** Sesiones por clave (`meta|con`, `datos|con`, `consola|perfil|consola`). */
  private readonly porClave = new Map<string, Sesion>()

  private readonly lectores = new Map<string, Lector>()

  private secuenciaProceso = 0

  private secuenciaLector = 0

  /** Ids de plan de Oracle (`STATEMENT_ID` de PLAN_TABLE, una temporal de SESIÓN). */
  private secuenciaPlan = 0

  private cerrando = false

  /**
   * Ajustes del usuario que aplica el gestor: la preferencia de Tx de las consolas nuevas
   * y el umbral de inactividad de las consolas. Los fija el controlador al arrancar y en
   * cada guardado (`fijarAjustes`). Se leen EN CADA USO (`nuevaSesion`, `barrer`), así que
   * un cambio de umbral vale para las sesiones abiertas desde el siguiente barrido.
   */
  private ajustesVigentes: AjustesSesionesBd = AJUSTES_SESIONES_POR_DEFECTO

  constructor(deps: DependenciasGestor) {
    this.deps = deps
  }

  ajustes(): AjustesSesionesBd {
    return this.ajustesVigentes
  }

  fijarAjustes(a: AjustesSesionesBd): void {
    this.ajustesVigentes = a
  }

  /** Pestillo del cierre de la app: desde `empezarCierre` no se lanza ningún proceso. */
  estaCerrando(): boolean {
    return this.cerrando
  }

  empezarCierre(): void {
    this.cerrando = true
  }

  /** Quita el pestillo de un cierre abortado; false si no se estaba cerrando. */
  cancelarCierre(): boolean {
    if (!this.cerrando) return false
    this.cerrando = false
    return true
  }

  /** Las sesiones conocidas, para recorrerlas (quien borre mientras recorre, que copie). */
  sesiones(): IterableIterator<Sesion> {
    return this.porClave.values()
  }

  sesionDeConsola(perfilId: string, consolaId: string): Sesion | undefined {
    return this.porClave.get(claveDeRef({ rol: 'consola', perfilId, consolaId }))
  }

  /** Todos los procesos que aún no se olvidaron, retirados incluidos. */
  procesos(): IterableIterator<Proceso> {
    return this.todos.values()
  }

  procesoVigente(clave: string): Proceso | undefined {
    return this.vigentes.get(clave)
  }

  siguienteIdProceso(): number {
    return ++this.secuenciaProceso
  }

  siguienteIdPlan(): number {
    return ++this.secuenciaPlan
  }

  /** Un proceso recién lanzado pasa a ser el vigente de su clave. */
  registrarProceso(p: Proceso): void {
    this.vigentes.set(p.clave, p)
    this.todos.add(p)
  }

  /** No admite sesiones nuevas: deja de ser el vigente de su clave (si aún lo era). */
  retirarProceso(p: Proceso): void {
    p.retirado = true
    this.quitarDeVigentes(p)
  }

  /** El proceso salió o no llegó a arrancar: fuera de todas partes. */
  olvidarProceso(p: Proceso): void {
    this.todos.delete(p)
    this.quitarDeVigentes(p)
  }

  private quitarDeVigentes(p: Proceso): void {
    if (this.vigentes.get(p.clave) === p) this.vigentes.delete(p.clave)
  }

  lector(id: string): Lector | undefined {
    return this.lectores.get(id)
  }

  olvidarLector(id: string): void {
    this.lectores.delete(id)
  }

  ahora(): number {
    return this.deps.ahora ? this.deps.ahora() : Date.now()
  }

  /**
   * ¿El explorador trata `con` como de solo lectura? La que IMPONE quien construye el gestor
   * (`soloLecturaImpuesta.ts`), NUNCA la casilla `con.readonly`, que es solo de los
   * agentes. En el producto, ninguna.
   */
  ro(con: DbConnection): boolean {
    return (this.deps.soloLecturaImpuesta ?? sinSoloLecturaImpuesta)(con)
  }

  log(linea: string): void {
    try {
      this.deps.log?.(linea)
    } catch {
      // el registro no puede romper lo que registra
    }
  }

  dto(s: Sesion): DbEstadoSesion {
    return aEstadoSesion(s.estado, s.ref, s.conexionId, s.driver)
  }

  /**
   * Emite `dbx:ev:sesion` si lo que ve el renderer cambió. Una sesión `interna`
   * (exportar una tabla de PG) nunca: el renderer no la conoce.
   */
  emitir(s: Sesion): void {
    if (s.eliminada || s.interna) return
    const dto = this.dto(s)
    const clave = JSON.stringify(dto)
    if (clave === s.ultimoEmitido) return
    s.ultimoEmitido = clave
    try {
      this.deps.emitirSesion(dto)
    } catch (e) {
      this.log(`emitir sesión falló: ${mensajeDe(e)}`)
    }
  }

  aplicar(s: Sesion, evento: EventoSesion): EfectoSesion[] {
    const t = transicion(s.estado, evento)
    if (t.estado !== s.estado) {
      s.estado = t.estado
      if (s.manualPendiente) this.aplicarManualPendiente(s)
      this.emitir(s)
    }
    return t.efectos
  }

  /**
   * La consola que estaba ocupada cuando
   * su conexión pasó a producción se pone en Manual en cuanto deja de estarlo. Con la
   * MISMA regla de la máquina (`cambioModo`), que lo rechaza ocupada o abriendo (sigue
   * pendiente), sobre el «solo lectura» de la conexión de AHORA (ver dentro). Si la
   * conexión ya no es de producción de escritura, se olvida sin tocar nada: salir de
   * producción no decide por el usuario (ver `alCambiarConexion`). No emite: lo hace
   * quien la llama.
   */
  aplicarManualPendiente(s: Sesion): void {
    const f = s.estado.fase
    if (f === 'ocupada' || f === 'abriendo') return
    const motivo = s.manualPendiente
    delete s.manualPendiente
    const con = this.deps.conexion(s.conexionId)
    // 'preferencia': con la preferencia de Configuración, que en
    // producción no cambia nada (ya es Manual) y en solo lectura tampoco (Auto); y NUNCA
    // sobre una transacción pendiente, que es del usuario.
    const preferencia = motivo === 'preferencia' ? this.ajustesVigentes.txInicial : undefined
    if (!con || txModoInicialConsola(con, this.ro(con), preferencia) !== 'manual') return
    if (motivo === 'preferencia' && s.estado.tx !== 'ninguna') return
    // Con el «solo lectura» de la conexión de AHORA, no el de la sesión: el de la sesión es el
    // de cuando se ABRIÓ, y con él una consola que pasaba de solo lectura a producción de
    // escritura rechazaba el Manual y renacía en Auto contra producción. Es el mismo valor que
    // le dará `abrir` al reabrir (`alCambiarConexion` ya retiró su proceso).
    const ro = this.ro(con)
    const actual = s.estado.soloLectura === ro ? s.estado : { ...s.estado, soloLectura: ro }
    // Con su propio `ultimoUso`: cambiar el modo por la conexión no es un uso de la consola.
    const t = transicion(actual, { tipo: 'cambioModo', ahora: s.estado.ultimoUso, modo: 'manual' })
    if (!t.efectos.some((e) => e.tipo === 'rechazar')) s.estado = t.estado
  }

  /** Efectos que no necesitan esperar al trabajador. Devuelve los avisos para la Salida. */
  efectosSincronos(s: Sesion, efectos: EfectoSesion[]): string[] {
    const avisos: string[] = []
    for (const e of efectos) {
      switch (e.tipo) {
        case 'cerrarSesion':
          this.enviarCerrar(s)
          break
        case 'olvidarLectores':
          this.olvidarLectoresDe(s)
          break
        case 'aviso':
          avisos.push(e.mensaje)
          break
        case 'avisoReapertura':
          this.log(`reapertura de ${s.rol} en ${s.conexionId} tras ${e.aviso.tipo}`)
          break
        default:
          // abrirSesion, tx, rechazar y rollbackSilencioso los atiende quien llama.
          break
      }
    }
    return avisos
  }

  /** Como `efectosSincronos`, más el ROLLBACK silencioso de solo lectura. */
  async efectos(s: Sesion, efectos: EfectoSesion[]): Promise<string[]> {
    if (efectos.some((e) => e.tipo === 'rollbackSilencioso')) {
      const p = s.proceso
      if (p && p.trabajador.vivo) {
        try {
          await p.trabajador.enviar<'tx'>({ op: 'tx', sesion: s.idTrabajador, accion: 'rollback' })
        } catch (e) {
          this.log(`rollback silencioso falló en ${s.conexionId}: ${esFalloTrabajador(e) ? (e.error.codigo ?? e.error.clase) : 'error'}`)
        }
      }
    }
    return this.efectosSincronos(s, efectos)
  }

  private enviarCerrar(s: Sesion): void {
    const p = s.proceso
    s.proceso = null
    if (p) this.enviarCerrarEn(p, s.idTrabajador)
  }

  enviarCerrarEn(p: Proceso, idTrabajador: string): void {
    if (!p.trabajador.vivo || p.salido) return
    p.trabajador.enviar<'cerrar'>({ op: 'cerrar', sesion: idTrabajador }).catch((e: unknown) => {
      this.log(`cerrar ${idTrabajador} falló: ${esFalloTrabajador(e) ? (e.error.codigo ?? e.error.clase) : 'error'}`)
    })
  }

  perder(s: Sesion, caida = false): void {
    s.enTrabajador = null
    // Con una confirmación en camino, el aviso dice que no se sabe si se aplicó.
    const ef = this.aplicar(s, {
      tipo: 'perdida',
      ahora: this.ahora(),
      caida,
      commitEnCamino: s.commitEnCamino !== undefined,
      porDentro: s.commitEnCamino === 'porDentro'
    })
    this.efectosSincronos(s, ef)
    s.proceso = null
  }

  terminar(
    s: Sesion,
    ev: { clase: ClaseSentencia; ok: boolean; tx?: DbEstadoTx; esquema?: string | null }
  ): EfectoSesion[] {
    s.enTrabajador = null
    const evento: EventoSesion = { tipo: 'terminada', ahora: this.ahora(), clase: ev.clase, ok: ev.ok }
    if (ev.tx !== undefined) evento.tx = ev.tx
    if (ev.esquema !== undefined) evento.esquema = ev.esquema
    return this.aplicar(s, evento)
  }

  /**
   * La sesión de `ref`, o una nueva. `txPreferida`: la preferencia de Tx que trae la
   * petición que la CREA (`DbEjecutarConsola.txInicial`); solo cuenta si la sesión es nueva.
   */
  sesionDe(ref: DbRefSesion, con: DbConnection, txPreferida?: DbTxModo): Sesion {
    const clave = claveDeRef(ref)
    const previa = this.porClave.get(clave)
    if (previa) {
      if (previa.conexionId !== con.id) {
        throw new ErrorGestor('interno', 'La consola está atada a otra conexión.')
      }
      return previa
    }
    return this.nuevaSesion(clave, ref, con, ref.rol === 'consola' ? `consola:${ref.consolaId}` : ref.rol, txPreferida)
  }

  private nuevaSesion(clave: string, ref: DbRefSesion, con: DbConnection, idTrabajador: string, txPreferida?: DbTxModo): Sesion {
    const s: Sesion = {
      clave,
      ref,
      rol: ref.rol,
      conexionId: con.id,
      idTrabajador,
      cola: new ColaSesion(),
      // Una consola de PRODUCCIÓN (de escritura) nace en Manual (`produccion.ts`);
      // `estadoInicial` sigue forzando Auto en solo lectura. Lo demás nace con la
      // preferencia de Configuración: la que trae la petición si la trae
      // (es la que pinta la barra), y si no la última que llegó por `fijarAjustes`.
      estado: estadoInicial({
        soloLectura: this.ro(con),
        ahora: this.ahora(),
        txModo: ref.rol === 'consola' ? txModoInicialConsola(con, this.ro(con), txPreferida ?? this.ajustesVigentes.txInicial) : 'auto'
      }),
      proceso: null,
      operacionUsuario: null,
      enTrabajador: null,
      cancelada: null,
      eliminada: false,
      ultimoEmitido: '',
      esquemaConexion: null,
      avisosPendientes: []
    }
    this.porClave.set(clave, s)
    return s
  }

  /**
   * Sesión EFÍMERA para exportar una tabla con su cursor vivo, propia de ESA exportación, en el mismo proceso de la conexión y con el rol de
   * `datos` para el trabajador (mismo candado de solo lectura). Está en `porClave`
   * para que la encuentren el Stop (por su `peticionId`), la pérdida del proceso y el
   * cálculo de procesos ociosos, pero es `interna`: ni se emite ni se lista.
   */
  sesionExportacion(con: DbConnection, peticionId: string): Sesion {
    const clave = `exportacion|${peticionId}`
    if (this.porClave.has(clave)) throw new ErrorGestor('ocupada', 'Ya hay una exportación con ese identificador en curso.')
    const s = this.nuevaSesion(clave, { rol: 'datos', conexionId: con.id }, con, `exportacion:${peticionId}`)
    s.interna = true
    s.accion = 'exportar'
    return s
  }

  /**
   * Sesión EFÍMERA de «Enviar»: propia de ESE envío, como la de exportar, y
   * NUNCA `datos`: allí la transacción se mezclaría con las lecturas de todas las
   * pestañas de la conexión, y un fallo a medias dejaría `datos` con cambios pendientes
   * que ninguna pestaña sabe confirmar ni revertir. Con su propia conexión, el todo o
   * nada es de verdad (un ROLLBACK no toca nada ajeno) y cerrarla revierte lo que quede.
   * `interna` (ni se emite ni se lista) y `pararEntreSentencias` (ver `Sesion`).
   */
  sesionEdicion(con: DbConnection, peticionId: string): Sesion {
    const clave = `edicion|${peticionId}`
    if (this.porClave.has(clave)) throw new ErrorGestor('ocupada', 'Ya hay un envío con ese identificador en curso.')
    const s = this.nuevaSesion(clave, { rol: 'datos', conexionId: con.id }, con, `${PREFIJO_SESION_EDICION}${peticionId}`)
    s.interna = true
    s.accion = 'enviar'
    s.pararEntreSentencias = true
    return s
  }

  /**
   * Cierra en el trabajador y olvida una sesión efímera (exportar o enviar). Nunca
   * lanza. `usado`: el proceso en que corrió, porque una pérdida ya le quitó
   * `s.proceso` y el trabajador se quedaría con su lápida para siempre (su id no se
   * vuelve a abrir, que es lo que sustituye la de una sesión normal). El `cerrar` del
   * trabajador hace ROLLBACK de lo que quede antes de cerrar la conexión.
   */
  soltarSesionEfimera(s: Sesion, usado: Proceso | null): void {
    const p = s.proceso ?? usado
    this.olvidarSesion(s)
    s.proceso = null
    // `cerrar` cierra el cursor vivo si quedó abierto y revierte el envoltorio RO.
    if (p) this.enviarCerrarEn(p, s.idTrabajador)
  }

  sesionesDe(p: Proceso): Sesion[] {
    return [...this.porClave.values()].filter((s) => s.proceso === p)
  }

  sesionesDeConexion(conexionId: string): Sesion[] {
    return [...this.porClave.values()].filter((s) => s.conexionId === conexionId && !s.eliminada)
  }

  /** Tira el estado entero de una sesión (cerrar la pestaña, borrar la conexión). */
  olvidarSesion(s: Sesion): void {
    s.eliminada = true
    this.porClave.delete(s.clave)
    this.olvidarLectoresDe(s)
    s.cola.descartarTodas()
  }

  conexionOError(id: string): DbConnection {
    const con = this.deps.conexion(id)
    if (!con) throw new ErrorGestor('interno', 'La conexión ya no existe.')
    exigirSql(con)
    return con
  }

  conexionDeConsola(ref: RefConsola): DbConnection {
    const con = this.deps.conexion(ref.conexionId)
    if (!con) throw new ErrorGestor('interno', 'La conexión de esta consola ya no existe.')
    if (con.profileId !== ref.perfilId) throw new ErrorGestor('interno', 'La consola no pertenece a este perfil.')
    exigirSql(con)
    return con
  }

  secretoDe(con: DbConnection): string {
    // Un motor sin credenciales (SQLite) no tiene contraseña que pedir: el trabajador la
    // ignora, y el protocolo exige un texto.
    if (!pideUsuarioYClave(descriptor(con.motor))) return ''
    const secreto = con.tieneSecreto ? this.deps.secreto(con.id) : null
    if (secreto !== null) return secreto
    if (con.tieneSecreto) {
      throw new ErrorGestor(
        'sinSecreto',
        'La contraseña guardada no se puede descifrar en este equipo. Edita la conexión y vuelve a escribirla.'
      )
    }
    throw new ErrorGestor('sinSecreto', 'Esta conexión no tiene contraseña guardada. Edítala para añadirla.')
  }

  /**
   * La ruta del archivo de un motor de archivo (del registro, justo antes de abrir), o null
   * en un motor de red. Sin ruta guardada no se abre: el error lo dice.
   */
  archivoDe(con: DbConnection): string | null {
    if (!descriptor(con.motor).conexion.deArchivo) return null
    let ruta: string | null = null
    try {
      ruta = this.deps.rutaArchivo ? this.deps.rutaArchivo(con.id) : null
    } catch {
      ruta = null
    }
    if (!ruta) throw new ErrorGestor('interno', 'La conexión no tiene archivo de base guardado. Edítala y elige el archivo.')
    return ruta
  }

  nuevoIdLector(): string {
    return `L${++this.secuenciaLector}`
  }

  registrarLector(s: Sesion, l: Omit<Lector, 'sesion' | 'usadoEn'>): string {
    const lector: Lector = { ...l, sesion: s, usadoEn: this.ahora() }
    this.lectores.set(lector.id, lector)
    const deLaSesion = [...this.lectores.values()].filter((x) => x.sesion === s).sort((a, b) => a.usadoEn - b.usadoEn)
    while (deLaSesion.length > MAX_LECTORES_POR_SESION) {
      const viejo = deLaSesion.shift()
      if (viejo && viejo !== lector) void this.cerrarLector(viejo.id)
    }
    return lector.id
  }

  private olvidarLectoresDe(s: Sesion): void {
    for (const [id, l] of [...this.lectores]) if (l.sesion === s) this.lectores.delete(id)
  }

  /** El trabajador cerró cursores por su tope LRU: se leerán re-ejecutando. */
  marcarExpulsados(r: ResultadoTrabajador): void {
    if (r.tipo !== 'filas' || !r.lectoresExpulsados) return
    for (const id of r.lectoresExpulsados) {
      for (const l of this.lectores.values()) if (l.cursor === id) l.cursor = null
    }
  }

  /** Suelta un lector (pestaña de resultado sustituida o cerrada). Nunca falla. */
  async cerrarLector(id: string): Promise<void> {
    const l = this.lectores.get(id)
    if (!l) return
    this.lectores.delete(id)
    const cursor = l.cursor
    const s = l.sesion
    if (!cursor) return
    try {
      await s.cola.correr(
        async () => {
          const p = s.proceso
          if (!p || !p.trabajador.vivo || s.estado.fase !== 'lista') return
          await p.trabajador.enviar<'cerrarLector'>({ op: 'cerrarLector', sesion: s.idTrabajador, lector: cursor })
        },
        { prioridad: 'baja' }
      )
    } catch {
      // Si falla, el cursor muere con su tope LRU o con la sesión.
    }
  }

  manual(s: Sesion, con: DbConnection): boolean {
    return !this.ro(con) && s.estado.txModo === 'manual'
  }
}
