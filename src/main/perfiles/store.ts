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
import { rutaAplicacion, rutaDatosUsuario } from '../util/infoApp'
import type { Perfil } from './types'
import { cargarPerfiles } from './cargador'
import { validarFormaDePerfil } from './validar'
import { escribirArchivoAtomicoSync } from '../util/escrituraAtomica'

/** Ruta EDITABLE de los perfiles (persistente entre reinicios). */
function rutaEditable(): string {
  return join(rutaDatosUsuario(), 'profiles.json')
}

/** Ruta de la SEMILLA empaquetada (perfiles por defecto). */
function rutaEmpaquetada(): string {
  return join(rutaAplicacion(), 'config', 'profiles.json')
}

/**
 * Carga los perfiles desde la copia mutable, sembrándola desde el bundled la
 * primera vez. Valida vía el loader (misma validación de forma que siempre).
 */
export function cargarPerfilesEditables(): Perfil[] {
  const destino = rutaEditable()
  if (!existsSync(destino)) {
    const semilla = readFileSync(rutaEmpaquetada(), 'utf-8')
    escribirArchivoAtomicoSync(destino, semilla)
  }
  try {
    return cargarPerfiles(destino)
  } catch (err) {
    // profiles.json corrupto (un cierre sucio): recupera del respaldo .bak si existe, antes de
    // rendirse.
    const bak = `${destino}.bak`
    if (existsSync(bak)) {
      try {
        const recovered = cargarPerfiles(bak)
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
export function guardarPerfilesEditables(perfiles: Perfil[]): void {
  if (!Array.isArray(perfiles)) throw new Error('guardarPerfilesEditables: se esperaba un arreglo de perfiles.')
  perfiles.forEach((p, i) => {
    const errores = validarFormaDePerfil(p)
    if (errores.length > 0) {
      throw new Error(`Perfil inválido en el índice ${i}: ${errores.join('; ')}`)
    }
  })
  const ids = new Set<string>()
  for (const p of perfiles) {
    if (ids.has(p.id)) throw new Error(`guardarPerfilesEditables: id de perfil duplicado "${p.id}".`)
    ids.add(p.id)
  }
  escribirArchivoAtomicoSync(rutaEditable(), JSON.stringify(perfiles, null, 2) + '\n')
}
