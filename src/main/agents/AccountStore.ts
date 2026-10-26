// =============================================================================
// Registro de las cuentas de agente del modo contenedor: las que quiera el usuario por (perfil,
// agente), privadas del perfil. Persiste solo metadatos en `agent-accounts.json`; las
// credenciales viven en su carpeta del host, resuelta contra `dataRoot`.
// Lo usan el controlador del agente, sus handlers IPC y los lectores de uso y contexto.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomicSync } from '../util/atomicWrite'
import { txAgentes } from './textos.ts'
import {
  AGENT_CONFIG_SUBDIR,
  AGENTES_DISPONIBLES,
  agentConfigDir,
  type Agente,
  type Profile
} from '../profiles/types'
import { MAX_NOMBRE_CUENTA, type AgentAccount, type CreateAccountRequest } from '../../shared/agent-accounts-ipc'
import { CUENTA_AGENTE_MANUAL, esAgenteManual, type IdAgente, type IdAgenteManual } from '../../shared/agentesManuales'

/** Archivos de credencial por agente (para "cerrar sesión" sin tocar el resto). */
const CREDENTIAL_FILES: Record<Agente, string[]> = {
  // Claude Code guarda el token OAuth aquí dentro de CLAUDE_CONFIG_DIR.
  'claude-code': ['.credentials.json'],
  // Codex guarda el login en $CODEX_HOME/auth.json.
  codex: ['auth.json']
}

interface PersistedStore {
  version: number
  accounts: AgentAccount[]
}

export { MAX_NOMBRE_CUENTA }

/** Cómo se enseña la predeterminada en cada idioma (`textosPane` `predeterminada`): reservados para ella. */
const NOMBRES_PREDETERMINADA = ['predeterminada', 'default']

/** Id determinista de la cuenta default de un (perfil, agente): único y estable. */
function defaultAccountId(profileId: string, agente: Agente): string {
  return `default-${profileId}-${agente}`
}

/** Registro de cuentas de agente por (perfil, agente) y sus carpetas de credenciales. */
export class AccountStore {
  /** Ruta del JSON de registro (mutable, en userData). */
  private readonly storePath: string
  /** Base host para resolver las carpetas de credenciales (= appPath). */
  private readonly dataRoot: string
  private accounts: AgentAccount[]
  /** Perfiles conocidos (se refresca en ensureDefaults): la cuenta default respeta su `configDir` declarado. */
  private readonly profilesById = new Map<string, Profile>()

  constructor(opts: { storePath: string; dataRoot: string }) {
    this.storePath = opts.storePath
    this.dataRoot = opts.dataRoot
    this.accounts = this.read()
    this.migrateDropGlobals()
    this.migrarCarpetasAnidadas()
  }

  // --- Persistencia ----------------------------------------------------------

  private read(): AgentAccount[] {
    // El primario manda si es LEGIBLE (aunque esté vacío o con otra forma): así vaciar
    // o editar el registro a mano NO resucita cuentas borradas desde el .bak. Solo si el
    // primario está AUSENTE o CORRUPTO (parse falla, p. ej. cierre sucio) se recupera del
    // respaldo .bak.
    const primary = this.readAccountsFile(this.storePath)
    if (primary !== null) return primary
    return this.readAccountsFile(`${this.storePath}.bak`) ?? []
  }

  /** Lee un archivo de cuentas: array (aunque vacío) si es JSON legible; null si no
   *  existe o el JSON está corrupto (parse falla). */
  private readAccountsFile(path: string): AgentAccount[] | null {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as PersistedStore
      if (!parsed || !Array.isArray(parsed.accounts)) return [] // JSON válido, forma rara -> vacío
      return parsed.accounts.filter(isAccountShape)
    } catch {
      return null // ausente (ENOENT) o corrupto -> intenta el .bak
    }
  }

  private persist(): void {
    const doc: PersistedStore = { version: 1, accounts: this.accounts }
    writeFileAtomicSync(this.storePath, JSON.stringify(doc, null, 2) + '\n')
  }

  // --- Migración -------------------------------------------------------------

  /**
   * Al construir: borra las cuentas «global» heredadas (registro y carpeta), quita el
   * `scope` de las privadas y descarta las que no tienen perfil. Persiste solo si cambió.
   */
  private migrateDropGlobals(): void {
    const isGlobal = (a: AgentAccount): boolean => (a as { scope?: string }).scope === 'global'
    let changed = false
    for (const g of this.accounts.filter(isGlobal)) {
      const sub = AGENT_CONFIG_SUBDIR[g.agente as Agente]
      const rel = `./.tessera/global/${sub}/${g.id}`
      const abs = path.isAbsolute(rel) ? rel : path.resolve(this.dataRoot, rel)
      try {
        rmSync(abs, { recursive: true, force: true })
      } catch {
        // Si la carpeta está en uso, al menos quitamos la entrada del registro.
      }
      changed = true
    }
    // Deja solo privadas y normaliza (quita `scope` del modelo viejo).
    this.accounts = this.accounts
      .filter((a) => !isGlobal(a))
      .map((a) => {
        if (!('scope' in (a as object))) return a
        changed = true
        const clean = { ...a } as AgentAccount & { scope?: string }
        delete clean.scope
        return clean
      })
    // Descarta entradas SIN perfil (globales viejas sin scope, o json editado a mano):
    // toda cuenta es privada de un perfil, y sin él hostDirFor resolvería a
    // `.../perfiles/undefined/...`. Mejor ignorarlas que escribir credenciales ahí.
    const before = this.accounts.length
    this.accounts = this.accounts.filter(
      (a) => typeof a.profileId === 'string' && a.profileId.length > 0
    )
    if (this.accounts.length !== before) changed = true
    if (changed) this.persist()
  }

  // --- Defaults --------------------------------------------------------------

  /**
   * Crea la cuenta «Predeterminada» solo para los (perfil, agente) que ya tienen login en
   * disco; un perfil nuevo queda sin cuenta. Idempotente: al arrancar y tras el CRUD.
   */
  ensureDefaults(profiles: Profile[]): void {
    this.profilesById.clear()
    for (const p of profiles) this.profilesById.set(p.id, p)
    let changed = false
    for (const profile of profiles) {
      for (const agente of AGENTES_DISPONIBLES) {
        const id = defaultAccountId(profile.id, agente)
        if (this.accounts.some((a) => a.id === id)) continue
        if (!this.hasLegacyCredential(profile, agente)) continue // perfil nuevo -> sin default
        this.accounts.push({
          id,
          nombre: 'Predeterminada',
          agente,
          profileId: profile.id,
          isDefault: true
        })
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /** true si la carpeta legacy de credenciales de (perfil, agente) ya tiene un login. */
  private hasLegacyCredential(profile: Profile, agente: Agente): boolean {
    const rel = agentConfigDir(profile, agente)
    const abs = path.isAbsolute(rel) ? rel : path.resolve(this.dataRoot, rel)
    return CREDENTIAL_FILES[agente].some((f) => existsSync(path.join(abs, f)))
  }

  // --- Consultas -------------------------------------------------------------

  get(id: string): AgentAccount | undefined {
    return this.accounts.find((a) => a.id === id)
  }

  /**
   * Las cuentas de (perfil, agente), en el orden en que se crearon (no hay globales). Un agente
   * manual siempre tiene la predeterminada primero: su carpeta del perfil, sin entrada en el registro.
   */
  list(profileId: string, agente: IdAgente): AgentAccount[] {
    const creadas = this.accounts.filter((a) => a.agente === agente && a.profileId === profileId)
    if (!esAgenteManual(agente)) return creadas
    return [{ id: CUENTA_AGENTE_MANUAL, nombre: 'Predeterminada', agente, profileId, isDefault: true }, ...creadas]
  }

  /**
   * La cuenta `id` de un agente manual en el perfil: la predeterminada o una creada para ese agente.
   * Lanza si no es suya: la carpeta de otra cuenta no se monta nunca.
   */
  cuentaManual(profileId: string, agente: IdAgenteManual, id: string | undefined): AgentAccount {
    const cuenta = this.list(profileId, agente).find((a) => a.id === (id || CUENTA_AGENTE_MANUAL))
    if (!cuenta) throw new Error(txAgentes().cuentas.cuentaDesconocida(String(id)))
    return cuenta
  }

  /** Cuenta default (migrada) de un (perfil, agente); siempre existe tras ensureDefaults. */
  defaultFor(profileId: string, agente: Agente): AgentAccount {
    const id = defaultAccountId(profileId, agente)
    const existing = this.get(id)
    if (existing) return existing
    // Salvaguarda: si aún no se sembró, créala al vuelo (y persiste).
    this.accounts.push({ id, nombre: 'Predeterminada', agente, profileId, isDefault: true })
    this.persist()
    return this.get(id)!
  }

  // --- Rutas host ------------------------------------------------------------

  /**
   * Carpeta host ABSOLUTA de credenciales de una cuenta (la crea si no existe).
   * - default (migrada): carpeta LEGACY del perfil, sin subcarpeta por cuenta.
   * - creada: `./.tessera/perfiles/<perfil>/<sub>-cuentas/<id>`, HERMANA de la legacy y no dentro
   *   de ella: dentro, la default vería las credenciales de las demás y borrarla las borraría.
   */
  hostDirFor(account: AgentAccount): string {
    if (esAgenteManual(account.agente) && account.id === CUENTA_AGENTE_MANUAL) return this.carpetaAgenteManual(account.profileId, account.agente)
    const abs = account.isDefault ? this.carpetaDefault(account) : this.carpetaCreada(account)
    mkdirSync(abs, { recursive: true })
    return abs
  }

  /**
   * Cuenta migrada: respeta el `configDir` DECLARADO del perfil si existe (así no se pierde el
   * login de perfiles que apuntan a una carpeta propia); si no, la convención `./.tessera/perfiles/<id>/<sub>`.
   */
  private carpetaDefault(account: AgentAccount): string {
    const sub = AGENT_CONFIG_SUBDIR[account.agente as Agente]
    const profile = this.profilesById.get(account.profileId)
    const rel = profile ? agentConfigDir(profile, account.agente as Agente) : `./.tessera/perfiles/${account.profileId}/${sub}`
    return path.isAbsolute(rel) ? rel : path.resolve(this.dataRoot, rel)
  }

  /**
   * La carpeta de una cuenta creada. Si aún está en el sitio anterior (anidada en la legacy), se
   * mueve aquí con su login; si no se puede mover (algo la tiene abierta), se sigue usando allí.
   */
  private carpetaCreada(account: AgentAccount): string {
    const sub = esAgenteManual(account.agente) ? account.agente : AGENT_CONFIG_SUBDIR[account.agente as Agente]
    const base = path.resolve(this.dataRoot, `./.tessera/perfiles/${account.profileId}`)
    const nueva = path.join(base, `${sub}-cuentas`, account.id)
    const anidada = path.join(base, sub, account.id)
    if (existsSync(nueva) || !existsSync(anidada)) return nueva
    try {
      mkdirSync(path.dirname(nueva), { recursive: true })
      renameSync(anidada, nueva)
      return nueva
    } catch (err) {
      // Mientras siga anidada, el contenedor de la predeterminada la ve: que conste. Se reintenta al arrancar.
      console.warn(
        `[cuentas] no se pudo sacar la cuenta "${account.id}" de la carpeta de la predeterminada: ` +
          `${err instanceof Error ? err.message : String(err)}. Hasta moverla, esa cuenta no queda aislada.`
      )
      return anidada
    }
  }

  /** Saca de la carpeta legacy las cuentas creadas que quedaron anidadas en ella. */
  private migrarCarpetasAnidadas(): void {
    for (const a of this.accounts) if (!a.isDefault && a.profileId) this.carpetaCreada(a)
  }

  /**
   * Carpeta del host de un agente MANUAL en un perfil, junto a las de Claude Code y Codex: la de su
   * cuenta predeterminada, que no pasa por el registro (las creadas sí). En el contenedor es su `HOME`.
   */
  carpetaAgenteManual(profileId: string, agente: IdAgenteManual): string {
    const abs = path.resolve(this.dataRoot, `./.tessera/perfiles/${profileId}/${agente}`)
    mkdirSync(abs, { recursive: true })
    return abs
  }

  // --- Mutaciones ------------------------------------------------------------

  /**
   * Crea una cuenta de (perfil, agente) (registro + carpeta vacía) y la devuelve. Puede haber
   * varias; el nombre no se repite en el mismo (perfil, agente), sin distinguir mayúsculas, para
   * que el selector no enseñe dos iguales.
   */
  create(req: CreateAccountRequest): AgentAccount {
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
    this.comprobarNombre(nombre, req.profileId, req.agente)
    const account: AgentAccount = {
      id: randomUUID(),
      nombre,
      agente: req.agente,
      profileId: req.profileId
    }
    this.accounts.push(account)
    this.persist()
    this.hostDirFor(account) // crea la carpeta vacía (el login la poblará)
    return account
  }

  /**
   * Lanza si el nombre (ya recortado) no vale para una cuenta de (perfil, agente): vacío, largo o repetido.
   * `salvo` es la cuenta que se renombra, que puede quedarse con el suyo cambiando mayúsculas.
   */
  private comprobarNombre(nombre: string, profileId: string, agente: IdAgente, salvo?: string): void {
    if (!nombre) throw new Error(txAgentes().cuentas.sinNombre)
    if (nombre.length > MAX_NOMBRE_CUENTA) throw new Error(txAgentes().cuentas.nombreLargo(MAX_NOMBRE_CUENTA))
    const clave = nombre.toLocaleLowerCase()
    // La predeterminada se enseña con el nombre del idioma de la interfaz: ninguno de los dos se puede repetir.
    if (
      NOMBRES_PREDETERMINADA.includes(clave) ||
      this.list(profileId, agente as Agente).some((a) => a.id !== salvo && a.nombre.trim().toLocaleLowerCase() === clave)
    ) {
      throw new Error(txAgentes().cuentas.nombreRepetido(nombre))
    }
  }

  /**
   * Cambia el nombre visible de una cuenta y la devuelve. Solo es su etiqueta: carpeta y contenedor van por
   * id. La predeterminada no: su nombre es el del idioma de la interfaz.
   */
  rename(id: string, nombreNuevo: unknown): AgentAccount {
    const account = typeof id === 'string' ? this.get(id) : undefined
    if (!account) throw new Error(txAgentes().cuentas.cuentaDesconocida(String(id)))
    if (account.isDefault) throw new Error(txAgentes().cuentas.predeterminadaNoSeRenombra)
    const nombre = typeof nombreNuevo === 'string' ? nombreNuevo.trim() : ''
    this.comprobarNombre(nombre, account.profileId, account.agente, account.id)
    account.nombre = nombre
    this.persist()
    return account
  }

  /**
   * Lanza si de esa cuenta no se puede cerrar sesión: la de un agente manual (no se sabe qué archivos
   * son su credencial) o una que no existe. Quien cierra la pregunta ANTES de cerrar sus sesiones.
   */
  comprobarCierreSesion(id: string): void {
    const account = this.get(id)
    if (id === CUENTA_AGENTE_MANUAL || (account && esAgenteManual(account.agente))) throw new Error(txAgentes().cuentas.manualSinCierreSesion)
    if (!account) throw new Error(txAgentes().cuentas.cuentaDesconocida(id))
  }

  /** Cierra sesión: borra el/los archivo(s) de credencial. La cuenta permanece. */
  logout(id: string): void {
    this.comprobarCierreSesion(id)
    const account = this.get(id)!
    const dir = this.hostDirFor(account)
    for (const file of CREDENTIAL_FILES[account.agente as Agente]) {
      const p = path.join(dir, file)
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
    if (id === CUENTA_AGENTE_MANUAL || this.get(id)?.isDefault) throw new Error(txAgentes().cuentas.predeterminadaNoSeBorra)
  }

  /**
   * Elimina la cuenta por completo: carpeta de credenciales + entrada del registro. La
   * predeterminada no: su carpeta es la del perfil y se recrearía en el siguiente arranque.
   */
  remove(id: string): void {
    this.comprobarBorrable(id)
    const account = this.get(id)
    if (!account) return
    const dir = this.hostDirFor(account)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Si la carpeta está en uso, al menos quitamos la entrada del registro.
    }
    this.accounts = this.accounts.filter((a) => a.id !== id)
    this.persist()
  }

  /**
   * Las cuentas creadas de un agente manual en un perfil (sin la predeterminada). Lanza si el perfil
   * no existe o el id no es de un agente manual: lo que devuelve se borra, y ambos acaban en rutas.
   */
  cuentasDeAgenteManual(profileId: string, agente: string): AgentAccount[] {
    if (typeof profileId !== 'string' || !this.profilesById.has(profileId)) throw new Error(txAgentes().cuentas.perfilDesconocido(String(profileId)))
    if (typeof agente !== 'string' || !esAgenteManual(agente)) throw new Error(txAgentes().cuentas.agenteDesconocido(String(agente)))
    return this.accounts.filter((a) => a.agente === agente && a.profileId === profileId)
  }

  /**
   * Borra lo que un agente manual dejó en un perfil al eliminarse: sus cuentas creadas y la carpeta
   * de la predeterminada. Sin esto, otro agente con el mismo nombre (el mismo id) heredaría su login.
   */
  olvidarAgenteManual(profileId: string, agente: IdAgenteManual): void {
    for (const a of this.cuentasDeAgenteManual(profileId, agente)) this.remove(a.id)
    for (const carpeta of [agente, `${agente}-cuentas`]) {
      try {
        rmSync(path.resolve(this.dataRoot, `./.tessera/perfiles/${profileId}/${carpeta}`), { recursive: true, force: true })
      } catch {
        // Una carpeta en uso se queda; las cuentas ya salieron del registro.
      }
    }
  }
}

/** Validación mínima de forma al leer el JSON (defensa ante ediciones manuales). */
function isAccountShape(value: unknown): value is AgentAccount {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  const agenteOk = a.agente === 'claude-code' || a.agente === 'codex' || (typeof a.agente === 'string' && esAgenteManual(a.agente))
  // Tolera el `scope` del modelo viejo (la migración lo procesa y lo quita).
  return typeof a.id === 'string' && typeof a.nombre === 'string' && agenteOk
}
