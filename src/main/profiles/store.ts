// =============================================================================
// La copia EDITABLE de los perfiles: `userData/profiles.json`, sembrada la primera vez desde la
// semilla empaquetada (`config/profiles.json`, de solo lectura dentro del asar). El CRUD edita
// solo esa copia; se valida la forma antes de escribir y se escribe crash-safe
// (`util/atomicWrite`), cayendo al `.bak` si el principal está corrupto. Las `configDir` de los
// agentes son relativas a la app, así que mover el JSON a `userData` no mueve las credenciales.
// Decisiones: docs/decisiones/workspace/estado-persistido-crash-safe.md
// =============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rutaAppPath, rutaUserData } from '../util/infoApp'
import type { Profile } from './types'
import { loadProfiles } from './loader'
import { validateProfileShape } from './validate'
import { writeFileAtomicSync } from '../util/atomicWrite'

/** Ruta EDITABLE de los perfiles (persistente entre reinicios). */
function mutablePath(): string {
  return join(rutaUserData(), 'profiles.json')
}

/** Ruta de la SEMILLA empaquetada (perfiles por defecto). */
function bundledPath(): string {
  return join(rutaAppPath(), 'config', 'profiles.json')
}

/**
 * Carga los perfiles desde la copia mutable, sembrándola desde el bundled la
 * primera vez. Valida vía el loader (misma validación de forma que siempre).
 */
export function loadProfilesMutable(): Profile[] {
  const target = mutablePath()
  if (!existsSync(target)) {
    const seed = readFileSync(bundledPath(), 'utf-8')
    writeFileAtomicSync(target, seed)
  }
  try {
    return loadProfiles(target)
  } catch (err) {
    // profiles.json corrupto (un cierre sucio): recupera del respaldo .bak si existe, antes de
    // rendirse.
    const bak = `${target}.bak`
    if (existsSync(bak)) {
      try {
        const recovered = loadProfiles(bak)
        console.warn('[profiles] profiles.json ilegible; recuperado del respaldo .bak')
        return recovered
      } catch {
        // .bak también inservible: cae al error original.
      }
    }
    throw err
  }
}

/**
 * Persiste el arreglo COMPLETO de perfiles a la copia mutable. Valida la forma de
 * cada uno ANTES de escribir (misma regla que el loader): un perfil inválido
 * aborta el guardado con error legible, sin corromper el fichero.
 */
export function saveProfilesMutable(profiles: Profile[]): void {
  if (!Array.isArray(profiles)) throw new Error('saveProfiles: se esperaba un arreglo de perfiles.')
  profiles.forEach((p, i) => {
    const errors = validateProfileShape(p)
    if (errors.length > 0) {
      throw new Error(`Perfil inválido en el índice ${i}: ${errors.join('; ')}`)
    }
  })
  const ids = new Set<string>()
  for (const p of profiles) {
    if (ids.has(p.id)) throw new Error(`saveProfiles: id de perfil duplicado "${p.id}".`)
    ids.add(p.id)
  }
  writeFileAtomicSync(mutablePath(), JSON.stringify(profiles, null, 2) + '\n')
}
