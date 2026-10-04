// =============================================================================
// Registro de las cuentas de agente del modo contenedor: como mucho una por (perfil,
// agente), privada del perfil. Persiste solo metadatos en `agent-accounts.json`; las
// credenciales viven en su carpeta del host, resuelta contra `dataRoot`.
// Lo usan el controlador del agente, sus handlers IPC y los lectores de uso y contexto.
// Decisiones: docs/decisiones/agentes/cuentas-una-por-perfil-y-agente.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomicSync } from '../util/atomicWrite'
import {
  AGENT_CONFIG_SUBDIR,
  AGENTES_DISPONIBLES,
  agentConfigDir,
  type Agente,
  type Profile
} from '../profiles/types'
import type { AgentAccount, CreateAccountRequest } from '../../shared/agent-accounts-ipc'

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

  /** La cuenta de (perfil, agente): 0 o 1 (no hay multicuenta ni globales). */
  list(profileId: string, agente: Agente): AgentAccount[] {
    return this.accounts.filter((a) => a.agente === agente && a.profileId === profileId)
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
   * - creada: `./.tessera/perfiles/<perfil>/<sub>/<id>`.
   */
  hostDirFor(account: AgentAccount): string {
    const sub = AGENT_CONFIG_SUBDIR[account.agente as Agente]
    let rel: string
    if (account.isDefault) {
      // Cuenta migrada: respeta el `configDir` DECLARADO del perfil si existe (así no
      // se pierde el login de perfiles que apuntan a una carpeta propia); si no, cae
      // a la convención `./.tessera/perfiles/<id>/<sub>`.
      const profile = this.profilesById.get(account.profileId)
      rel = profile
        ? agentConfigDir(profile, account.agente as Agente)
        : `./.tessera/perfiles/${account.profileId}/${sub}`
    } else {
      rel = `./.tessera/perfiles/${account.profileId}/${sub}/${account.id}`
    }
    const abs = path.isAbsolute(rel) ? rel : path.resolve(this.dataRoot, rel)
    mkdirSync(abs, { recursive: true })
    return abs
  }

  // --- Mutaciones ------------------------------------------------------------

  /**
   * Crea LA cuenta de (perfil, agente) (registro + carpeta vacía) y la devuelve.
   * Modelo de una sola cuenta: si ya hay una para ese (perfil, agente), es un error
   * (la UI solo ofrece "Iniciar sesión" cuando no hay ninguna).
   */
  create(req: CreateAccountRequest): AgentAccount {
    // Validación de forma en RUNTIME (los tipos TS no existen en runtime): un payload
    // malformado debe dar un error claro, no un TypeError por `.trim()` sobre no-string
    // ni escribir basura en el registro persistido.
    const nombre = typeof req?.nombre === 'string' ? req.nombre.trim() : ''
    if (!nombre) throw new Error('El nombre de la cuenta no puede estar vacío.')
    if (!AGENTES_DISPONIBLES.includes(req.agente as Agente)) {
      throw new Error(`Agente desconocido: "${req.agente}".`)
    }
    if (typeof req.profileId !== 'string' || !req.profileId) {
      throw new Error('Una cuenta requiere un perfil.')
    }
    if (this.list(req.profileId, req.agente as Agente).length > 0) {
      throw new Error('Este perfil ya tiene una cuenta para este agente.')
    }
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

  /** Cierra sesión: borra el/los archivo(s) de credencial. La cuenta permanece. */
  logout(id: string): void {
    const account = this.get(id)
    if (!account) throw new Error(`Cuenta desconocida: "${id}".`)
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

  /** Elimina la cuenta por completo: carpeta de credenciales + entrada del registro. */
  remove(id: string): void {
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
}

/** Validación mínima de forma al leer el JSON (defensa ante ediciones manuales). */
function isAccountShape(value: unknown): value is AgentAccount {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  const agenteOk = a.agente === 'claude-code' || a.agente === 'codex'
  // Tolera el `scope` del modelo viejo (la migración lo procesa y lo quita).
  return typeof a.id === 'string' && typeof a.nombre === 'string' && agenteOk
}
