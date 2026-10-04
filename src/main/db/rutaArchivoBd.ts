// =============================================================================
// La ruta del archivo de una conexión de un motor de archivo (SQLite): guardarla canónica y compararla.
// Funciones puras con la plataforma y el `realpath` inyectados, para probar las dos plataformas desde una;
// sin `electron`. La guarda y la resuelve el main: el renderer solo ve el nombre.
// Decisiones: docs/decisiones/bd/conexiones-archivos-de-base-de-datos.md
// =============================================================================

import { realpathSync } from 'node:fs'
import path from 'node:path'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { nunca } from '../../shared/nunca.ts'

/** La ruta canónica de un archivo y si se pudo comprobar que existe. */
export interface RutaCanonica {
  /** Absoluta: la real (`realpath`) si existe; si no, la normalizada tal cual. */
  ruta: string
  existe: boolean
  /** El código del error al resolverla, si no fue un simple «no existe» (EPERM, EACCES…). */
  codigoError?: string
}

/** Lo que `canonizarRutaArchivo` necesita del sistema (inyectable en los tests). */
export interface DepsRutaArchivo {
  plataforma: Plataforma
  realpath: (ruta: string) => string
}

/** Las dependencias de verdad: la plataforma actual y el `realpath` nativo. */
export function depsDeSerie(): DepsRutaArchivo {
  return { plataforma: plataformaActual(), realpath: (r) => realpathSync.native(r) }
}

/** El `path` de la plataforma (el de Windows entiende `C:\` y `\\srv\`; el POSIX, no). */
function pathDe(plataforma: Plataforma): path.PlatformPath {
  return plataforma === 'windows' ? path.win32 : path.posix
}

/**
 * La ruta que se GUARDA para un archivo elegido (ver el ADR). Lanza si la ruta no es
 * absoluta en esa plataforma o está vacía.
 */
export function canonizarRutaArchivo(ruta: string, deps: DepsRutaArchivo = depsDeSerie()): RutaCanonica {
  const p = pathDe(deps.plataforma)
  if (typeof ruta !== 'string' || ruta.trim() === '') throw new Error('Falta la ruta del archivo.')
  if (!p.isAbsolute(ruta)) throw new Error(`La ruta del archivo tiene que ser absoluta: ${ruta}`)
  const normal = p.normalize(ruta)
  try {
    return { ruta: deps.realpath(normal), existe: true }
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException)?.code
    if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return { ruta: normal, existe: false }
    return { ruta: normal, existe: false, codigoError: typeof codigo === 'string' ? codigo : 'DESCONOCIDO' }
  }
}

/** El NOMBRE del archivo de una ruta guardada (`DbConnection.archivoVisible`). */
export function nombreArchivoDeRuta(ruta: string, plataforma: Plataforma = plataformaActual()): string {
  return pathDe(plataforma).basename(ruta)
}

/** La clave con la que se comparan dos rutas guardadas en esa plataforma (ver el ADR). */
export function claveRutaArchivo(ruta: string, plataforma: Plataforma = plataformaActual()): string {
  const nfc = ruta.normalize('NFC')
  switch (plataforma) {
    case 'windows':
      return path.win32.normalize(nfc).toLowerCase()
    case 'mac':
      return path.posix.normalize(nfc).toLowerCase()
    case 'otra':
      return path.posix.normalize(nfc)
    default:
      return nunca(plataforma, 'claveRutaArchivo')
  }
}

/** ¿Son el mismo archivo dos rutas GUARDADAS (ya canónicas)? */
export function mismoArchivo(a: string, b: string, plataforma: Plataforma = plataformaActual()): boolean {
  return claveRutaArchivo(a, plataforma) === claveRutaArchivo(b, plataforma)
}
