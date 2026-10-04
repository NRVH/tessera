// =============================================================================
// Persistencia de `workspace-state.json` (`userData`): el esqueleto de pestañas por perfil y el
// slice de ajustes globales, dos slices del MISMO archivo que se mezclan al guardar. La verdad
// vive en memoria; cada guardado programa una escritura asíncrona con debounce y
// `flushWorkspaceState` la fuerza al cerrar. Lee cayendo al `.bak`, archiva intacto un archivo
// de una versión más nueva antes de degradarlo y poda los proyectos ausentes con `stat` en
// paralelo, distinguiendo «borrado» de «el volumen no está». La ruta entra por `util/infoApp`.
// Decisiones: docs/decisiones/workspace/estado-persistido-crash-safe.md
// =============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { copyFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { rutaUserData } from '../util/infoApp'
import { writeFileAtomic } from '../util/atomicWrite'
import {
  clasificarPresencia,
  DEFAULT_SETTINGS,
  normalizeWorkspaceState,
  pruneMissingProjects,
  raizDeVolumen,
  WORKSPACE_STATE_VERSION,
  type PresenciaProyecto,
  type WorkspaceSettings,
  type WorkspaceState
} from '../../shared/workspace-state-ipc'
import type { ProyectoAbierto } from '../../shared/shell-windows-ipc'
import { proyectosDeEstado } from '../shell/abiertosEfectivos'

/** Ruta del estado de workspace persistido (junto a profiles.json en userData). */
function statePath(): string {
  return join(rutaUserData(), 'workspace-state.json')
}

/** Milisegundos de espera tras el último cambio antes de escribir (colapsa ráfagas). */
const WRITE_DEBOUNCE_MS = 200

/**
 * FUENTE DE VERDAD en memoria del documento completo (esqueleto + settings). Se siembra
 * perezosamente del disco (load async al arrancar, o lectura síncrona puntual la primera
 * vez que se guarda antes de que el load haya corrido). null = aún no sembrado.
 */
let current: WorkspaceState | null = null
/** Timer del debounce de escritura; se reinicia con cada cambio. */
let writeTimer: ReturnType<typeof setTimeout> | null = null
/** Cadena de escrituras: las serializa para que no colisionen en el tmp+rename. */
let writeChain: Promise<void> = Promise.resolve()

/** Lee el doc CRUDO del disco de forma SÍNCRONA. Solo para sembrar `current` la primera
 *  vez que se guarda si el load async aún no corrió (caso raro). Cae al respaldo `.bak`
 *  si el principal está corrupto. `null` si no hay ninguno legible. */
function readRawStateSync(): WorkspaceState | null {
  const target = statePath()
  for (const path of [target, `${target}.bak`]) {
    if (!existsSync(path)) continue
    try {
      return normalizeWorkspaceState(JSON.parse(readFileSync(path, 'utf-8')))
    } catch {
      // corrupto: prueba el siguiente (el .bak).
    }
  }
  return null
}

/** Lee y normaliza el estado de `path` (async). null si no existe o es ilegible/corrupto. */
async function tryReadState(path: string): Promise<WorkspaceState | null> {
  try {
    return normalizeWorkspaceState(JSON.parse(await readFile(path, 'utf-8')))
  } catch (err) {
    if (!isEnoent(err)) console.error(`[workspace-state] no se pudo leer ${path}:`, err)
    return null
  }
}

/** Estado en memoria, sembrado perezosamente. Nunca null tras esta llamada. */
function ensureCurrent(): WorkspaceState {
  if (!current) {
    current = readRawStateSync() ?? {
      version: 1,
      activeProfileId: null,
      byProfile: {},
      settings: { ...DEFAULT_SETTINGS }
    }
  }
  return current
}

/**
 * GUARDA DE DOWNGRADE: si el archivo persistido es de una versión de esquema MÁS NUEVA que la
 * que este build entiende, sus campos nuevos se perderían al normalizar y reescribir. Se ARCHIVA
 * una copia intacta en `workspace-state.v<N>.json` (una sola vez) antes de que el flujo normal
 * lo degrade; el arranque continúa con lo compatible.
 */
async function archiveIfNewerVersion(target: string): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(target, 'utf-8'))
  } catch {
    return // inexistente/corrupto: lo maneja el flujo normal (tryReadState + .bak)
  }
  const v = (raw as { version?: unknown } | null)?.version
  if (typeof v !== 'number' || v <= WORKSPACE_STATE_VERSION) return
  const archive = join(rutaUserData(), `workspace-state.v${v}.json`)
  if (existsSync(archive)) return // ya archivado en un arranque anterior
  try {
    await copyFile(target, archive)
    console.warn(
      `[workspace-state] archivo de versión ${v} (> ${WORKSPACE_STATE_VERSION} que entiende este build): ` +
        `archivado intacto en ${archive} para no perder datos; se arranca con lo compatible.`
    )
  } catch (err) {
    console.error('[workspace-state] no se pudo archivar el estado de versión más nueva:', err)
  }
}

/**
 * Lee el estado de workspace persistido (ASÍNCRONO), normalizándolo y podando los proyectos
 * cuya carpeta ya no existe. Devuelve `null` si no existe todavía (primer arranque) o si el
 * contenido es irrecuperable: en ambos casos el renderer arranca limpio. Siembra `current` con
 * el estado CRUDO (sin podar) para que los merges de settings posteriores preserven el
 * esqueleto íntegro.
 */
export async function loadWorkspaceState(): Promise<WorkspaceState | null> {
  const target = statePath()
  // Antes de normalizar (que descartaría campos de un esquema más nuevo), preserva el
  // archivo si viene de un build posterior: evita el downgrade destructivo silencioso.
  await archiveIfNewerVersion(target)
  let normalized = await tryReadState(target)
  if (normalized === null) {
    // El principal no se pudo leer (corrupto/truncado por un cierre sucio). Antes de
    // rendirse a un arranque limpio, intenta el RESPALDO del último guardado bueno.
    const backup = await tryReadState(`${target}.bak`)
    if (backup !== null) {
      console.warn('[workspace-state] principal ilegible; recuperado del respaldo .bak')
      normalized = backup
    }
  }
  if (normalized === null) {
    current = null
    return null
  }
  // Semilla en memoria SIN podar (para que un save de settings preserve el esqueleto).
  current = normalized
  // Poda con `stat` en PARALELO: se clasifica cada ruta y se le pasa el veredicto SÍNCRONO a
  // pruneMissingProjects.
  const paths = new Set<string>()
  for (const tabs of Object.values(normalized.byProfile)) {
    for (const p of tabs.openProjects) paths.add(p.projectHostPath)
  }
  const veredicto = new Map<string, PresenciaProyecto>()
  await Promise.all(
    [...paths].map(async (p) => {
      veredicto.set(p, await presenciaDe(p))
    })
  )
  // Se avisa de lo que NO se pudo comprobar. Sin esta línea, el día que un proyecto no
  // abra por permisos no habrá ni un rastro de por qué, y el sitio donde mirar
  // (Privacidad y seguridad › Archivos y carpetas) no se le ocurre a nadie.
  const dudosos = [...veredicto].filter(([, v]) => v === 'indeterminada').map(([p]) => p)
  if (dudosos.length > 0) {
    console.warn(
      `[workspace-state] no se pudo comprobar si ${dudosos.length} proyecto(s) siguen en disco; ` +
        `se conservan (en macOS suele ser el permiso de Archivos y carpetas): ${dudosos.join(', ')}`
    )
  }
  return pruneMissingProjects(normalized, (p) => veredicto.get(p) ?? 'indeterminada')
}

/**
 * ¿Sigue ahí la carpeta de un proyecto? Distingue «no está» de «no se ha podido mirar», que es
 * la diferencia entre podar y conservar (ver `pruneMissingProjects`). `clasificarPresencia`
 * traduce el errno, pero ENOENT es AMBIGUO: lo da tanto una carpeta borrada como un volumen sin
 * montar, porque el punto de montaje solo existe mientras el volumen lo está. Ante un ENOENT se
 * mira si la RAÍZ DEL VOLUMEN sigue ahí: si tampoco, lo que falta es el disco y no la carpeta.
 */
async function presenciaDe(ruta: string): Promise<PresenciaProyecto> {
  try {
    await stat(ruta)
    return 'presente'
  } catch (err) {
    const clase = clasificarPresencia((err as { code?: unknown } | null)?.code)
    if (clase !== 'ausente') return clase
    const raiz = raizDeVolumen(ruta)
    // Sin raíz que comprobar (volumen del sistema): si no estuviera montado no habría app.
    if (raiz === null) return 'ausente'
    try {
      await stat(raiz)
      return 'ausente' // el volumen está y la carpeta no: borrada de verdad.
    } catch {
      return 'indeterminada' // no está ni el volumen: es el disco, no el proyecto.
    }
  }
}

/**
 * Persiste el ESQUELETO de workspace (perfiles -> proyectos + activo). Actualiza el
 * estado en memoria y programa una escritura async debounced. MERGE POR SLICES: el
 * esqueleto y los ajustes globales (zoom) son slices independientes del MISMO archivo;
 * el renderer proyecta el esqueleto SIN conocer el zoom, así que aquí PRESERVAMOS los
 * `settings` que ya haya en memoria/disco.
 */
export function saveWorkspaceState(state: WorkspaceState): void {
  const normalized = normalizeWorkspaceState(state)
  if (normalized === null) {
    throw new Error('saveWorkspaceState: estado no serializable (no es un objeto).')
  }
  const base = ensureCurrent()
  current = { ...normalized, settings: base.settings ?? normalized.settings }
  scheduleWrite()
}

/**
 * Lee SOLO el slice de ajustes globales (SÍNCRONO, desde memoria/disco). Se usa en el
 * camino de zoom por menú (read-modify-write) donde conviene una lectura inmediata.
 */
export function loadWorkspaceSettings(): WorkspaceSettings {
  return ensureCurrent().settings ?? { ...DEFAULT_SETTINGS }
}

/**
 * Los proyectos abiertos según lo PERSISTIDO (memoria o disco, síncrono), de todos los
 * perfiles y sin podar. Es lo que el renderer va a restaurar mientras aún no lo ha hecho.
 */
export function proyectosPersistidos(): ProyectoAbierto[] {
  return proyectosDeEstado(ensureCurrent().byProfile)
}

/**
 * Persiste SOLO el slice de ajustes globales, PRESERVANDO el esqueleto en memoria (el
 * reverso del merge de saveWorkspaceState). Así cambiar el zoom no toca las pestañas.
 */
export function saveWorkspaceSettings(settings: WorkspaceSettings): void {
  const base = ensureCurrent()
  const normalized = normalizeWorkspaceState({ ...base, settings })
  if (normalized === null) return // base siempre es objeto: inalcanzable, pero best-effort
  current = normalized
  scheduleWrite()
}

/**
 * Fuerza la escritura pendiente y espera a que termine (incluida cualquiera en vuelo).
 * Lo llama el cierre de la app (`iniciarCierre`) para no perder el último cambio debounced.
 */
export async function flushWorkspaceState(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  await enqueueWrite()
}

/** Programa (o reprograma) la escritura debounced del estado en memoria. */
function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void enqueueWrite()
  }, WRITE_DEBOUNCE_MS)
}

/** Encola una escritura del `current` vigente detrás de la anterior (serializadas). */
function enqueueWrite(): Promise<void> {
  const snapshot = current
  if (!snapshot) return writeChain
  writeChain = writeChain.then(() => writeStateAtomic(snapshot)).catch((err) => {
    console.error('[workspace-state] escritura falló:', err)
  })
  return writeChain
}

/** Escribe el documento de forma CRASH-SAFE (tmp + fsync + respaldo .bak + rename). */
async function writeStateAtomic(state: WorkspaceState): Promise<void> {
  await writeFileAtomic(statePath(), JSON.stringify(state, null, 2) + '\n')
}

/** true si el error de fs es un ENOENT (archivo inexistente: primer arranque). */
function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ENOENT'
}
