// =============================================================================
// Persistencia de `workspace-state.json` (`userData`): el esqueleto de pestañas por perfil, el
// slice de ajustes globales y la sesión de cada proyecto, tres slices del MISMO archivo que se
// mezclan al guardar. La verdad
// vive en memoria; cada guardado programa una escritura asíncrona con debounce y
// `vaciarEstadoWorkspace` la fuerza al cerrar. Lee cayendo al `.bak`, archiva intacto un archivo
// de una versión más nueva antes de degradarlo y poda los proyectos ausentes con `stat` en
// paralelo, distinguiendo «borrado» de «el volumen no está». La ruta entra por `util/infoApp`.
// Decisiones: docs/decisiones/workspace/estado-persistido-crash-safe.md
// =============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { copyFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { rutaDatosUsuario } from '../util/infoApp'
import { escribirArchivoAtomico } from '../util/escrituraAtomica'
import { normalizarSesiones, type SesionProyecto } from '../../shared/sesionProyecto'
import {
  clasificarPresencia,
  AJUSTES_DEFECTO,
  normalizarEstadoWorkspace,
  proyectosAbiertosDe,
  depurarProyectosAusentes,
  raizDeVolumen,
  VERSION_ESTADO_WORKSPACE,
  type PresenciaProyecto,
  type AjustesWorkspace,
  type EstadoWorkspace
} from '../../shared/workspace-state-ipc'
import type { ProyectoAbierto } from '../../shared/shell-windows-ipc'
import { proyectosDeEstado } from '../sistema/abiertosEfectivos'

/** Ruta del estado de workspace persistido (junto a profiles.json en userData). */
function rutaEstado(): string {
  return join(rutaDatosUsuario(), 'workspace-state.json')
}

/** Milisegundos de espera tras el último cambio antes de escribir (colapsa ráfagas). */
const DEMORA_ESCRITURA_MS = 200

/**
 * FUENTE DE VERDAD en memoria del documento completo (esqueleto + settings). Se siembra
 * perezosamente del disco (load async al arrancar, o lectura síncrona puntual la primera
 * vez que se guarda antes de que el load haya corrido). null = aún no sembrado.
 */
let actual: EstadoWorkspace | null = null
/** Timer del debounce de escritura; se reinicia con cada cambio. */
let temporizadorEscritura: ReturnType<typeof setTimeout> | null = null
/** Cadena de escrituras: las serializa para que no colisionen en el tmp+rename. */
let cadenaEscritura: Promise<void> = Promise.resolve()

/** Lee el doc CRUDO del disco de forma SÍNCRONA. Solo para sembrar `current` la primera
 *  vez que se guarda si el load async aún no corrió (caso raro). Cae al respaldo `.bak`
 *  si el principal está corrupto. `null` si no hay ninguno legible. */
function leerEstadoCrudoSync(): EstadoWorkspace | null {
  const destino = rutaEstado()
  for (const ruta of [destino, `${destino}.bak`]) {
    if (!existsSync(ruta)) continue
    try {
      return normalizarEstadoWorkspace(JSON.parse(readFileSync(ruta, 'utf-8')))
    } catch {
      // corrupto: prueba el siguiente (el .bak).
    }
  }
  return null
}

/** Lee y normaliza el estado de `path` (async). null si no existe o es ilegible/corrupto. */
async function intentarLeerEstado(ruta: string): Promise<EstadoWorkspace | null> {
  try {
    return normalizarEstadoWorkspace(JSON.parse(await readFile(ruta, 'utf-8')))
  } catch (err) {
    if (!esErrorEnoent(err)) console.error(`[workspace-state] no se pudo leer ${ruta}:`, err)
    return null
  }
}

/** Estado en memoria, sembrado perezosamente. Nunca null tras esta llamada. */
function asegurarActual(): EstadoWorkspace {
  if (!actual) {
    actual = leerEstadoCrudoSync() ?? {
      version: 1,
      activeProfileId: null,
      byProfile: {},
      settings: { ...AJUSTES_DEFECTO }
    }
  }
  return actual
}

/**
 * GUARDA DE DOWNGRADE: si el archivo persistido es de una versión de esquema MÁS NUEVA que la
 * que este build entiende, sus campos nuevos se perderían al normalizar y reescribir. Se ARCHIVA
 * una copia intacta en `workspace-state.v<N>.json` (una sola vez) antes de que el flujo normal
 * lo degrade; el arranque continúa con lo compatible.
 */
async function archivarSiVersionMasNueva(destino: string): Promise<void> {
  let crudo: unknown
  try {
    crudo = JSON.parse(await readFile(destino, 'utf-8'))
  } catch {
    return // inexistente/corrupto: lo maneja el flujo normal (intentarLeerEstado + .bak)
  }
  const v = (crudo as { version?: unknown } | null)?.version
  if (typeof v !== 'number' || v <= VERSION_ESTADO_WORKSPACE) return
  const archivo = join(rutaDatosUsuario(), `workspace-state.v${v}.json`)
  if (existsSync(archivo)) return // ya archivado en un arranque anterior
  try {
    await copyFile(destino, archivo)
    console.warn(
      `[workspace-state] archivo de versión ${v} (> ${VERSION_ESTADO_WORKSPACE} que entiende este build): ` +
        `archivado intacto en ${archivo} para no perder datos; se arranca con lo compatible.`
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
export async function cargarEstadoWorkspace(): Promise<EstadoWorkspace | null> {
  const destino = rutaEstado()
  // Antes de normalizar (que descartaría campos de un esquema más nuevo), preserva el
  // archivo si viene de un build posterior: evita el downgrade destructivo silencioso.
  await archivarSiVersionMasNueva(destino)
  let normalizado = await intentarLeerEstado(destino)
  if (normalizado === null) {
    // El principal no se pudo leer (corrupto/truncado por un cierre sucio). Antes de
    // rendirse a un arranque limpio, intenta el RESPALDO del último guardado bueno.
    const respaldo = await intentarLeerEstado(`${destino}.bak`)
    if (respaldo !== null) {
      console.warn('[workspace-state] principal ilegible; recuperado del respaldo .bak')
      normalizado = respaldo
    }
  }
  if (normalizado === null) {
    actual = null
    return null
  }
  // Semilla en memoria SIN podar (para que un save de settings preserve el esqueleto).
  actual = normalizado
  // Poda con `stat` en PARALELO: se clasifica cada ruta y se le pasa el veredicto SÍNCRONO a
  // depurarProyectosAusentes.
  const rutas = new Set<string>()
  for (const pestanas of Object.values(normalizado.byProfile)) {
    for (const p of pestanas.openProjects) rutas.add(p.projectHostPath)
  }
  const veredicto = new Map<string, PresenciaProyecto>()
  await Promise.all(
    [...rutas].map(async (p) => {
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
  return depurarProyectosAusentes(normalizado, (p) => veredicto.get(p) ?? 'indeterminada')
}

/**
 * ¿Sigue ahí la carpeta de un proyecto? Distingue «no está» de «no se ha podido mirar», que es
 * la diferencia entre podar y conservar (ver `depurarProyectosAusentes`). `clasificarPresencia`
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
export function guardarEstadoWorkspace(estado: EstadoWorkspace): void {
  const normalizado = normalizarEstadoWorkspace(estado)
  if (normalizado === null) {
    throw new Error('guardarEstadoWorkspace: estado no serializable (no es un objeto).')
  }
  const base = asegurarActual()
  // Las sesiones se podan contra el esqueleto nuevo: la de un proyecto recién cerrado se va con él.
  actual = {
    ...normalizado,
    settings: base.settings ?? normalizado.settings,
    sesiones: normalizarSesiones(base.sesiones, proyectosAbiertosDe(normalizado.byProfile))
  }
  programarEscritura()
}

/** Lee SOLO la sesión de cada proyecto abierto (SÍNCRONO, desde memoria/disco). */
export function cargarSesionesProyecto(): Record<string, SesionProyecto> {
  return asegurarActual().sesiones ?? {}
}

/**
 * Persiste SOLO la sesión de cada proyecto, PRESERVANDO el esqueleto y los ajustes. Lo recibido viene del
 * renderer y se sanea entero (`normalizarSesiones`): rutas relativas, topes, y solo las de los proyectos
 * abiertos. Se sanea solo este slice: llega con cada pausa al mover el cursor.
 */
export function guardarSesionesProyecto(sesiones: unknown): void {
  const base = asegurarActual()
  actual = { ...base, sesiones: normalizarSesiones(sesiones, proyectosAbiertosDe(base.byProfile)) }
  programarEscritura()
}

/**
 * Lee SOLO el slice de ajustes globales (SÍNCRONO, desde memoria/disco). Se usa en el
 * camino de zoom por menú (read-modify-write) donde conviene una lectura inmediata.
 */
export function cargarAjustesWorkspace(): AjustesWorkspace {
  return asegurarActual().settings ?? { ...AJUSTES_DEFECTO }
}

/**
 * Los proyectos abiertos según lo PERSISTIDO (memoria o disco, síncrono), de todos los
 * perfiles y sin podar. Es lo que el renderer va a restaurar mientras aún no lo ha hecho.
 */
export function proyectosPersistidos(): ProyectoAbierto[] {
  return proyectosDeEstado(asegurarActual().byProfile)
}

/**
 * Persiste SOLO el slice de ajustes globales, PRESERVANDO el esqueleto en memoria (el
 * reverso del merge de guardarEstadoWorkspace). Así cambiar el zoom no toca las pestañas.
 */
export function guardarAjustesWorkspace(ajustes: AjustesWorkspace): void {
  const base = asegurarActual()
  const normalizado = normalizarEstadoWorkspace({ ...base, settings: ajustes })
  if (normalizado === null) return // base siempre es objeto: inalcanzable, pero best-effort
  actual = normalizado
  programarEscritura()
}

/**
 * Fuerza la escritura pendiente y espera a que termine (incluida cualquiera en vuelo).
 * Lo llama el cierre de la app (`iniciarCierre`) para no perder el último cambio debounced.
 */
export async function vaciarEstadoWorkspace(): Promise<void> {
  if (temporizadorEscritura) {
    clearTimeout(temporizadorEscritura)
    temporizadorEscritura = null
  }
  await encolarEscritura()
}

/** Programa (o reprograma) la escritura debounced del estado en memoria. */
function programarEscritura(): void {
  if (temporizadorEscritura) clearTimeout(temporizadorEscritura)
  temporizadorEscritura = setTimeout(() => {
    temporizadorEscritura = null
    void encolarEscritura()
  }, DEMORA_ESCRITURA_MS)
}

/** Encola una escritura del `current` vigente detrás de la anterior (serializadas). */
function encolarEscritura(): Promise<void> {
  const foto = actual
  if (!foto) return cadenaEscritura
  cadenaEscritura = cadenaEscritura.then(() => escribirEstadoAtomico(foto)).catch((err) => {
    console.error('[workspace-state] escritura falló:', err)
  })
  return cadenaEscritura
}

/** Escribe el documento de forma CRASH-SAFE (tmp + fsync + respaldo .bak + rename). */
async function escribirEstadoAtomico(estado: EstadoWorkspace): Promise<void> {
  await escribirArchivoAtomico(rutaEstado(), JSON.stringify(estado, null, 2) + '\n')
}

/** true si el error de fs es un ENOENT (archivo inexistente: primer arranque). */
function esErrorEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ENOENT'
}
