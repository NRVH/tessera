// =============================================================================
// Registro de las cuentas de agente del modo contenedor: las privadas de cada (perfil, agente), en
// `agent-accounts.json`, y las globales, en un registro propio que una versión anterior no descarta.
// Persiste solo metadatos; las credenciales viven en su carpeta del host, resuelta contra `raizDatos`.
// Lo usan el controlador del agente, sus handlers IPC y los lectores de uso y contexto.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { escribirArchivoAtomicoSync } from '../util/escrituraAtomica'
import { txAgentes } from './textos.ts'
import {
  SUBCARPETA_CONFIG_AGENTE,
  AGENTES_DISPONIBLES,
  dirConfigAgente,
  type Agente,
  type Perfil
} from '../perfiles/types'
import { MAX_NOMBRE_CUENTA, PERFIL_CUENTAS_GLOBALES, esCuentaGlobal, idCuentaGlobal, type CuentaAgente, type PeticionCrearCuenta } from '../../shared/agent-accounts-ipc'
import { CUENTA_AGENTE_MANUAL, esAgenteManual, type IdAgente, type IdAgenteManual } from '../../shared/agentesManuales'

/** Archivos de credencial por agente (para "cerrar sesión" sin tocar el resto). */
const ARCHIVOS_CREDENCIALES: Record<Agente, string[]> = {
  // Claude Code guarda el token OAuth aquí dentro de CLAUDE_CONFIG_DIR.
  'claude-code': ['.credentials.json'],
  // Codex guarda el login en $CODEX_HOME/auth.json.
  codex: ['auth.json']
}

export interface AlmacenCuentasPersistido {
  version: number
  accounts: CuentaAgente[]
}

export { MAX_NOMBRE_CUENTA }

/** Cómo se enseña la predeterminada en cada idioma (`textosPane` `predeterminada`): reservados para ella. */
const NOMBRES_PREDETERMINADA = ['predeterminada', 'default']

/** Id determinista de la cuenta default de un (perfil, agente): único y estable. */
function idCuentaPredeterminada(perfilId: string, agente: Agente): string {
  return `default-${perfilId}-${agente}`
}

/** Registro de cuentas de agente por (perfil, agente) y sus carpetas de credenciales. */
export class AlmacenCuentas {
  /** Ruta del JSON de registro (mutable, en userData). */
  private readonly rutaAlmacen: string
  /** Base host para resolver las carpetas de credenciales (= appPath). */
  private readonly raizDatos: string
  private cuentas: CuentaAgente[]
  /** Junto al registro de las privadas. */
  private readonly rutaAlmacenGlobales: string
  private globales: CuentaAgente[]
  /** Las que esta versión no sabe usar (otro agente, otra forma): se conservan tal cual al reescribir el registro. */
  private readonly globalesAjenas: unknown[]
  /** Perfiles conocidos (se refresca en asegurarPredeterminadas): la cuenta default respeta su `configDir` declarado. */
  private readonly perfilesPorId = new Map<string, Perfil>()

  constructor(opts: { rutaAlmacen: string; raizDatos: string }) {
    this.rutaAlmacen = opts.rutaAlmacen
    this.rutaAlmacenGlobales = path.join(path.dirname(opts.rutaAlmacen), 'agent-accounts-globales.json')
    this.raizDatos = opts.raizDatos
    this.cuentas = this.leerDeDisco(this.rutaAlmacen).filter(tieneFormaCuenta)
    const globales = this.leerDeDisco(this.rutaAlmacenGlobales)
    const valida = (a: unknown): a is CuentaAgente => tieneFormaCuenta(a) && esGlobalValida(a)
    this.globales = globales.filter(valida).map((a) => ({ ...a, profileId: PERFIL_CUENTAS_GLOBALES, global: true }))
    this.globalesAjenas = globales.filter((a) => !valida(a))
    this.migrarDescartandoGlobales()
    this.migrarCarpetasAnidadas()
  }

  // --- Persistencia ----------------------------------------------------------

  private leerDeDisco(ruta: string): unknown[] {
    // El primario manda si es LEGIBLE (aunque esté vacío o con otra forma): así vaciar
    // o editar el registro a mano NO resucita cuentas borradas desde el .bak. Solo si el
    // primario está AUSENTE o CORRUPTO (parse falla, p. ej. cierre sucio) se recupera del
    // respaldo .bak.
    const principal = this.leerArchivoCuentas(ruta)
    if (principal !== null) return principal
    return this.leerArchivoCuentas(`${ruta}.bak`) ?? []
  }

  /** Lee un archivo de cuentas, sin filtrar: array (aunque vacío) si es JSON legible; null si no
   *  existe o el JSON está corrupto (parse falla). */
  private leerArchivoCuentas(ruta: string): unknown[] | null {
    try {
      const analizado = JSON.parse(readFileSync(ruta, 'utf-8')) as { accounts?: unknown }
      if (!analizado || !Array.isArray(analizado.accounts)) return [] // JSON válido, forma rara -> vacío
      return analizado.accounts
    } catch {
      return null // ausente (ENOENT) o corrupto -> intenta el .bak
    }
  }

  private persistir(): void {
    const doc: AlmacenCuentasPersistido = { version: 1, accounts: this.cuentas }
    escribirArchivoAtomicoSync(this.rutaAlmacen, JSON.stringify(doc, null, 2) + '\n')
  }

  private persistirGlobales(): void {
    const doc = { version: 1, accounts: [...this.globales, ...this.globalesAjenas] }
    escribirArchivoAtomicoSync(this.rutaAlmacenGlobales, JSON.stringify(doc, null, 2) + '\n')
  }

  // --- Migración -------------------------------------------------------------

  /**
   * Al construir: borra las cuentas «global» heredadas (registro y carpeta), quita el
   * `scope` de las privadas y descarta las que no tienen perfil. Persiste solo si cambió.
   */
  private migrarDescartandoGlobales(): void {
    const esGlobal = (a: CuentaAgente): boolean => (a as { scope?: string }).scope === 'global'
    let hayCambios = false
    for (const g of this.cuentas.filter(esGlobal)) {
      const sub = SUBCARPETA_CONFIG_AGENTE[g.agente as Agente]
      const rel = `./.tessera/global/${sub}/${g.id}`
      const abs = path.isAbsolute(rel) ? rel : path.resolve(this.raizDatos, rel)
      try {
        rmSync(abs, { recursive: true, force: true })
      } catch {
        // Si la carpeta está en uso, al menos quitamos la entrada del registro.
      }
      hayCambios = true
    }
    // Deja solo privadas y normaliza (quita `scope` del modelo viejo).
    this.cuentas = this.cuentas
      .filter((a) => !esGlobal(a))
      .map((a) => {
        if (!('scope' in (a as object))) return a
        hayCambios = true
        const limpia = { ...a } as CuentaAgente & { scope?: string }
        delete limpia.scope
        return limpia
      })
    // Descarta entradas SIN perfil (globales viejas sin scope, o json editado a mano):
    // toda cuenta es privada de un perfil, y sin él dirHostDe resolvería a
    // `.../perfiles/undefined/...`. Mejor ignorarlas que escribir credenciales ahí.
    const antes = this.cuentas.length
    this.cuentas = this.cuentas.filter(
      (a) => typeof a.profileId === 'string' && a.profileId.length > 0
    )
    if (this.cuentas.length !== antes) hayCambios = true
    if (hayCambios) this.persistir()
  }

  // --- Defaults --------------------------------------------------------------

  /**
   * Crea la cuenta «Predeterminada» solo para los (perfil, agente) que ya tienen login en
   * disco; un perfil nuevo queda sin cuenta. Idempotente: al arrancar y tras el CRUD.
   */
  asegurarPredeterminadas(perfiles: Perfil[]): void {
    this.perfilesPorId.clear()
    for (const p of perfiles) this.perfilesPorId.set(p.id, p)
    let hayCambios = false
    for (const perfil of perfiles) {
      for (const agente of AGENTES_DISPONIBLES) {
        const id = idCuentaPredeterminada(perfil.id, agente)
        if (this.cuentas.some((a) => a.id === id)) continue
        if (!this.tieneCredencialHeredada(perfil, agente)) continue // perfil nuevo -> sin default
        this.cuentas.push({
          id,
          nombre: 'Predeterminada',
          agente,
          profileId: perfil.id,
          isDefault: true
        })
        hayCambios = true
      }
    }
    if (hayCambios) this.persistir()
  }

  /** true si la carpeta legacy de credenciales de (perfil, agente) ya tiene un login. */
  private tieneCredencialHeredada(perfil: Perfil, agente: Agente): boolean {
    const rel = dirConfigAgente(perfil, agente)
    const abs = path.isAbsolute(rel) ? rel : path.resolve(this.raizDatos, rel)
    return ARCHIVOS_CREDENCIALES[agente].some((f) => existsSync(path.join(abs, f)))
  }

  // --- Consultas -------------------------------------------------------------

  obtener(id: string): CuentaAgente | undefined {
    return this.cuentas.find((a) => a.id === id) ?? this.globales.find((a) => a.id === id)
  }

  /**
   * Lo que un agente de ese perfil puede usar: las privadas del perfil y, detrás, las globales. Quien no tiene cuenta
   * elegida toma la primera, y debe ser una del perfil antes que la que comparten todos.
   */
  disponibles(perfilId: string, agente: IdAgente): CuentaAgente[] {
    return [...this.listar(perfilId, agente), ...this.globales.filter((a) => a.agente === agente)]
  }

  /**
   * Las cuentas privadas de (perfil, agente), en el orden en que se crearon. Un agente
   * manual siempre tiene la predeterminada primero: su carpeta del perfil, sin entrada en el registro.
   */
  listar(profileId: string, agente: IdAgente): CuentaAgente[] {
    const creadas = this.cuentas.filter((a) => a.agente === agente && a.profileId === profileId)
    if (!esAgenteManual(agente)) return creadas
    return [{ id: CUENTA_AGENTE_MANUAL, nombre: 'Predeterminada', agente, profileId, isDefault: true }, ...creadas]
  }

  /**
   * La cuenta `id` de un agente manual en el perfil: la predeterminada o una creada para ese agente.
   * Lanza si no es suya: la carpeta de otra cuenta no se monta nunca.
   */
  cuentaManual(perfilId: string, agente: IdAgenteManual, id: string | undefined): CuentaAgente {
    const cuenta = this.listar(perfilId, agente).find((a) => a.id === (id || CUENTA_AGENTE_MANUAL))
    if (!cuenta) throw new Error(txAgentes().cuentas.cuentaDesconocida(String(id)))
    return cuenta
  }

  /** Cuenta default (migrada) de un (perfil, agente); siempre existe tras asegurarPredeterminadas. */
  predeterminadaDe(profileId: string, agente: Agente): CuentaAgente {
    const id = idCuentaPredeterminada(profileId, agente)
    const existente = this.obtener(id)
    if (existente) return existente
    // Salvaguarda: si aún no se sembró, créala al vuelo (y persiste).
    this.cuentas.push({ id, nombre: 'Predeterminada', agente, profileId, isDefault: true })
    this.persistir()
    return this.obtener(id)!
  }

  // --- Rutas host ------------------------------------------------------------

  /**
   * Carpeta host ABSOLUTA de credenciales de una cuenta (la crea si no existe).
   * - default (migrada): carpeta LEGACY del perfil, sin subcarpeta por cuenta.
   * - creada: `./.tessera/perfiles/<perfil>/<sub>-cuentas/<id>`, HERMANA de la legacy y no dentro
   *   de ella: dentro, la default vería las credenciales de las demás y borrarla las borraría.
   */
  dirHostDe(cuenta: CuentaAgente): string {
    if (esAgenteManual(cuenta.agente) && cuenta.id === CUENTA_AGENTE_MANUAL) return this.carpetaAgenteManual(cuenta.profileId, cuenta.agente)
    const abs = cuenta.global ? this.carpetaGlobal(cuenta) : cuenta.isDefault ? this.carpetaPredeterminada(cuenta) : this.carpetaCreada(cuenta)
    mkdirSync(abs, { recursive: true })
    return abs
  }

  /**
   * Dónde está o estaría la carpeta de una cuenta, sin crear ni mover nada: para quien solo lee (una carpeta
   * que no existe no tiene nada que leer).
   */
  rutaDe(cuenta: CuentaAgente): string {
    if (esAgenteManual(cuenta.agente) && cuenta.id === CUENTA_AGENTE_MANUAL) return this.rutaAgenteManual(cuenta.profileId, cuenta.agente)
    if (cuenta.global) return this.carpetaGlobal(cuenta)
    if (cuenta.isDefault) return this.carpetaPredeterminada(cuenta)
    const { nueva, anidada } = this.rutasDeCreada(cuenta)
    return existsSync(nueva) || !existsSync(anidada) ? nueva : anidada
  }

  /** Fuera de las carpetas de los perfiles: borrar uno no se la lleva. */
  private carpetaGlobal(cuenta: CuentaAgente): string {
    return path.resolve(this.raizDatos, `./.tessera/cuentas-globales/${SUBCARPETA_CONFIG_AGENTE[cuenta.agente as Agente]}/${cuenta.id}`)
  }

  /**
   * Cuenta migrada: respeta el `configDir` DECLARADO del perfil si existe (así no se pierde el
   * login de perfiles que apuntan a una carpeta propia); si no, la convención `./.tessera/perfiles/<id>/<sub>`.
   */
  private carpetaPredeterminada(cuenta: CuentaAgente): string {
    const sub = SUBCARPETA_CONFIG_AGENTE[cuenta.agente as Agente]
    const perfil = this.perfilesPorId.get(cuenta.profileId)
    const rel = perfil ? dirConfigAgente(perfil, cuenta.agente as Agente) : `./.tessera/perfiles/${cuenta.profileId}/${sub}`
    return path.isAbsolute(rel) ? rel : path.resolve(this.raizDatos, rel)
  }

  /**
   * La carpeta de una cuenta creada. Si aún está en el sitio anterior (anidada en la legacy), se
   * mueve aquí con su login; si no se puede mover (algo la tiene abierta), se sigue usando allí.
   */
  private carpetaCreada(cuenta: CuentaAgente): string {
    const { nueva, anidada } = this.rutasDeCreada(cuenta)
    if (existsSync(nueva) || !existsSync(anidada)) return nueva
    try {
      mkdirSync(path.dirname(nueva), { recursive: true })
      renameSync(anidada, nueva)
      return nueva
    } catch (err) {
      // Mientras siga anidada, el contenedor de la predeterminada la ve: que conste. Se reintenta al arrancar.
      console.warn(
        `[cuentas] no se pudo sacar la cuenta "${cuenta.id}" de la carpeta de la predeterminada: ` +
          `${err instanceof Error ? err.message : String(err)}. Hasta moverla, esa cuenta no queda aislada.`
      )
      return anidada
    }
  }

  /** Las dos carpetas posibles de una cuenta creada: la actual y la anidada en la legacy. */
  private rutasDeCreada(cuenta: CuentaAgente): { nueva: string; anidada: string } {
    const sub = esAgenteManual(cuenta.agente) ? cuenta.agente : SUBCARPETA_CONFIG_AGENTE[cuenta.agente as Agente]
    const base = path.resolve(this.raizDatos, `./.tessera/perfiles/${cuenta.profileId}`)
    return { nueva: path.join(base, `${sub}-cuentas`, cuenta.id), anidada: path.join(base, sub, cuenta.id) }
  }

  /** Saca de la carpeta legacy las cuentas creadas que quedaron anidadas en ella. */
  private migrarCarpetasAnidadas(): void {
    for (const a of this.cuentas) if (!a.isDefault && a.profileId) this.carpetaCreada(a)
  }

  /**
   * Carpeta del host de un agente MANUAL en un perfil, junto a las de Claude Code y Codex: la de su
   * cuenta predeterminada, que no pasa por el registro (las creadas sí). En el contenedor es su `HOME`.
   */
  carpetaAgenteManual(perfilId: string, agente: IdAgenteManual): string {
    const abs = this.rutaAgenteManual(perfilId, agente)
    mkdirSync(abs, { recursive: true })
    return abs
  }

  private rutaAgenteManual(perfilId: string, agente: IdAgenteManual): string {
    return path.resolve(this.raizDatos, `./.tessera/perfiles/${perfilId}/${agente}`)
  }

  // --- Mutaciones ------------------------------------------------------------

  /**
   * Crea una cuenta (registro + carpeta vacía) y la devuelve. Puede haber varias; el nombre no se
   * repite entre las que un mismo selector enseña, sin distinguir mayúsculas.
   */
  crear(req: PeticionCrearCuenta): CuentaAgente {
    // Validación de forma en RUNTIME (los tipos TS no existen en runtime): un payload
    // malformado debe dar un error claro, no un TypeError por `.trim()` sobre no-string
    // ni escribir basura en el registro persistido.
    const nombre = typeof req?.nombre === 'string' ? req.nombre.trim() : ''
    if (!nombre) throw new Error(txAgentes().cuentas.sinNombre)
    if (!AGENTES_DISPONIBLES.includes(req.agente as Agente) && !esAgenteManual(String(req.agente))) {
      throw new Error(txAgentes().cuentas.agenteDesconocido(String(req.agente)))
    }
    if (typeof req.profileId !== 'string' || !req.profileId) {
      throw new Error(txAgentes().cuentas.sinPerfil)
    }
    if (req.global === true) return this.crearGlobal(nombre, req.agente)
    this.comprobarNombre(nombre, req.profileId, req.agente)
    const cuenta: CuentaAgente = {
      id: randomUUID(),
      nombre,
      agente: req.agente,
      profileId: req.profileId
    }
    this.cuentas.push(cuenta)
    this.persistir()
    this.dirHostDe(cuenta) // crea la carpeta vacía (el login la poblará)
    return cuenta
  }

  /** Solo Claude Code y Codex: de un agente manual no se sabe qué archivos son su credencial. */
  private crearGlobal(nombre: string, agente: IdAgente): CuentaAgente {
    if (!AGENTES_DISPONIBLES.includes(agente as Agente)) throw new Error(txAgentes().cuentas.agenteDesconocido(String(agente)))
    this.comprobarNombre(nombre, PERFIL_CUENTAS_GLOBALES, agente)
    const cuenta: CuentaAgente = { id: idCuentaGlobal(randomUUID()), nombre, agente, profileId: PERFIL_CUENTAS_GLOBALES, global: true }
    this.globales.push(cuenta)
    this.persistirGlobales()
    this.dirHostDe(cuenta)
    return cuenta
  }

  /**
   * Lanza si el nombre (ya recortado) no vale: vacío, largo o repetido. Una global se ve en todos los perfiles, así
   * que se compara con las privadas de todos; una privada, con las de su perfil y las globales.
   * `salvo` es la cuenta que se renombra, que puede quedarse con el suyo cambiando mayúsculas.
   */
  private comprobarNombre(nombre: string, perfilId: string, agente: IdAgente, salvo?: string): void {
    if (!nombre) throw new Error(txAgentes().cuentas.sinNombre)
    if (nombre.length > MAX_NOMBRE_CUENTA) throw new Error(txAgentes().cuentas.nombreLargo(MAX_NOMBRE_CUENTA))
    const clave = nombre.toLocaleLowerCase()
    const conLasQueConvive = perfilId === PERFIL_CUENTAS_GLOBALES ? [...this.globales, ...this.cuentas].filter((a) => a.agente === agente) : this.disponibles(perfilId, agente)
    // La predeterminada se enseña con el nombre del idioma de la interfaz: ninguno de los dos se puede repetir.
    if (
      NOMBRES_PREDETERMINADA.includes(clave) ||
      conLasQueConvive.some((a) => a.id !== salvo && a.nombre.trim().toLocaleLowerCase() === clave)
    ) {
      throw new Error(txAgentes().cuentas.nombreRepetido(nombre))
    }
  }

  /**
   * Cambia el nombre visible de una cuenta y la devuelve. Solo es su etiqueta: carpeta y contenedor van por
   * id. La predeterminada no: su nombre es el del idioma de la interfaz.
   */
  renombrar(id: string, nombreNuevo: unknown): CuentaAgente {
    const cuenta = typeof id === 'string' ? this.obtener(id) : undefined
    if (!cuenta) throw new Error(txAgentes().cuentas.cuentaDesconocida(String(id)))
    if (cuenta.isDefault) throw new Error(txAgentes().cuentas.predeterminadaNoSeRenombra)
    const nombre = typeof nombreNuevo === 'string' ? nombreNuevo.trim() : ''
    this.comprobarNombre(nombre, cuenta.profileId, cuenta.agente, cuenta.id)
    cuenta.nombre = nombre
    if (cuenta.global) this.persistirGlobales()
    else this.persistir()
    return cuenta
  }

  /**
   * Lanza si de esa cuenta no se puede cerrar sesión: la de un agente manual (no se sabe qué archivos
   * son su credencial) o una que no existe. Quien cierra la pregunta ANTES de cerrar sus sesiones.
   */
  comprobarCierreSesion(id: string): void {
    const cuenta = this.obtener(id)
    if (id === CUENTA_AGENTE_MANUAL || (cuenta && esAgenteManual(cuenta.agente))) throw new Error(txAgentes().cuentas.manualSinCierreSesion)
    if (!cuenta) throw new Error(txAgentes().cuentas.cuentaDesconocida(id))
  }

  /** Cierra sesión: borra el/los archivo(s) de credencial. La cuenta permanece. */
  cerrarSesion(id: string): void {
    this.comprobarCierreSesion(id)
    const cuenta = this.obtener(id)!
    const dir = this.dirHostDe(cuenta)
    for (const archivo of ARCHIVOS_CREDENCIALES[cuenta.agente as Agente]) {
      const p = path.join(dir, archivo)
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        // Un archivo bloqueado no debe romper el logout; el resto se intenta igual.
      }
    }
  }

  /** Lanza si la cuenta no se puede borrar (la predeterminada). Quien borra la pregunta ANTES de cerrar sus sesiones. */
  comprobarBorrable(id: string): void {
    // La de un agente manual no está en el registro, pero tampoco se borra (y su id es el de todas).
    if (id === CUENTA_AGENTE_MANUAL || this.obtener(id)?.isDefault) throw new Error(txAgentes().cuentas.predeterminadaNoSeBorra)
  }

  /**
   * Elimina la cuenta por completo: carpeta de credenciales + entrada del registro. La
   * predeterminada no: su carpeta es la del perfil y se recrearía en el siguiente arranque.
   */
  quitar(id: string): void {
    this.comprobarBorrable(id)
    const cuenta = this.obtener(id)
    if (!cuenta) return
    const dir = this.dirHostDe(cuenta)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Si la carpeta está en uso, al menos quitamos la entrada del registro.
    }
    if (cuenta.global) {
      this.globales = this.globales.filter((a) => a.id !== id)
      this.persistirGlobales()
      return
    }
    this.cuentas = this.cuentas.filter((a) => a.id !== id)
    this.persistir()
  }

  /**
   * Las cuentas creadas de un agente manual en un perfil (sin la predeterminada). Lanza si el perfil
   * no existe o el id no es de un agente manual: lo que devuelve se borra, y ambos acaban en rutas.
   */
  cuentasDeAgenteManual(perfilId: string, agente: string): CuentaAgente[] {
    if (typeof perfilId !== 'string' || !this.perfilesPorId.has(perfilId)) throw new Error(txAgentes().cuentas.perfilDesconocido(String(perfilId)))
    if (typeof agente !== 'string' || !esAgenteManual(agente)) throw new Error(txAgentes().cuentas.agenteDesconocido(String(agente)))
    return this.cuentas.filter((a) => a.agente === agente && a.profileId === perfilId)
  }

  /**
   * Borra lo que un agente manual dejó en un perfil al eliminarse: sus cuentas creadas y la carpeta
   * de la predeterminada. Sin esto, otro agente con el mismo nombre (el mismo id) heredaría su login.
   */
  olvidarAgenteManual(perfilId: string, agente: IdAgenteManual): void {
    for (const a of this.cuentasDeAgenteManual(perfilId, agente)) this.quitar(a.id)
    for (const carpeta of [agente, `${agente}-cuentas`]) {
      try {
        rmSync(path.resolve(this.raizDatos, `./.tessera/perfiles/${perfilId}/${carpeta}`), { recursive: true, force: true })
      } catch {
        // Una carpeta en uso se queda; las cuentas ya salieron del registro.
      }
    }
  }
}

/** Su id elige el contenedor y su agente, la carpeta: lo que no encaje en ambos no entra (ediciones manuales). */
function esGlobalValida(a: { id: string; agente: string }): boolean {
  return esCuentaGlobal(a.id) && /^[\w-]+$/.test(a.id) && AGENTES_DISPONIBLES.includes(a.agente as Agente)
}

/** Validación mínima de forma al leer el JSON (defensa ante ediciones manuales). */
function tieneFormaCuenta(valor: unknown): valor is CuentaAgente {
  if (typeof valor !== 'object' || valor === null) return false
  const a = valor as Record<string, unknown>
  const agenteOk = a.agente === 'claude-code' || a.agente === 'codex' || (typeof a.agente === 'string' && esAgenteManual(a.agente))
  // Tolera el `scope` del modelo viejo (la migración lo procesa y lo quita).
  return typeof a.id === 'string' && typeof a.nombre === 'string' && agenteOk
}
