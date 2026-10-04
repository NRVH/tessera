// =============================================================================
// Entorno del pty nativo: cómo se fusionan las variables extra (conexiones de BD y el atajo `tdb`)
// sobre el entorno heredado en cada sistema.
// Puro, con la plataforma como parámetro: el delimitador del PATH (`;` o `:`) y la caja de la clave
// (Windows la colapsa, POSIX no).
// Sin `process.env` ni `node-pty`. Lo usan `TerminalService`, `java/decompilerArgs` y
// `util/pathDeLogin`.
// Decisiones: docs/decisiones/terminales/pty-shell-nativo-y-entorno.md
// =============================================================================

import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** Separador de segmentos del PATH: `;` en Windows, `:` en cualquier POSIX. */
export function delimitadorPath(plataforma: Plataforma = plataformaActual()): string {
  return plataforma === 'windows' ? ';' : ':'
}

/**
 * ¿Es este nombre de variable "el PATH" en esta plataforma? En Windows, cualquier caja
 * (`Path`, `PATH`, `path`); en POSIX, sólo `PATH` exacto.
 */
function esClavePath(nombre: string, plataforma: Plataforma): boolean {
  return plataforma === 'windows' ? nombre.toUpperCase() === 'PATH' : nombre === 'PATH'
}

/**
 * Nombre real (con su caja) de la variable PATH dentro de un entorno, si existe. En
 * Windows encuentra `Path` o `PATH` indistintamente; en POSIX sólo `PATH`.
 */
export function clavePath(
  env: Record<string, string>,
  plataforma: Plataforma = plataformaActual()
): string | undefined {
  return Object.keys(env).find((c) => esClavePath(c, plataforma))
}

/**
 * Copia del entorno con UNA sola variable PATH. SÓLO Windows: si venían varias con
 * distinta caja, se conserva el nombre de la primera y sus segmentos se concatenan en
 * orden y sin repetir (comparación case-insensitive, que es como Windows compara rutas),
 * así no se pierde ninguna carpeta que ya estuviera. En POSIX devuelve una copia tal
 * cual: allí `Path` y `PATH` son variables distintas y no hay nada que colapsar.
 */
export function colapsarPath(
  base: Record<string, string>,
  plataforma: Plataforma = plataformaActual()
): Record<string, string> {
  const out = { ...base }
  if (plataforma !== 'windows') return out
  const claves = Object.keys(out).filter((c) => esClavePath(c, plataforma))
  if (claves.length <= 1) return out
  const delim = delimitadorPath(plataforma)
  const vistos = new Set<string>()
  const segmentos: string[] = []
  for (const clave of claves) {
    for (const seg of String(out[clave]).split(delim)) {
      const limpio = seg.trim()
      const norm = limpio.toLowerCase()
      if (!limpio || vistos.has(norm)) continue
      vistos.add(norm)
      segmentos.push(limpio)
    }
    delete out[clave]
  }
  out[claves[0]] = segmentos.join(delim)
  return out
}

/**
 * Fusiona variables extra sobre un entorno base y devuelve SIEMPRE una copia (el base
 * no se muta). `PATH` recibe trato especial: se ANTEPONE en vez de sustituirse, porque
 * el entorno extra solo quiere añadir la carpeta del atajo `tdb` y pisar el PATH del
 * sistema dejaría la terminal sin java, git, node ni los scripts del proyecto.
 *
 * El delimitador y la identificación de la clave PATH dependen de la plataforma (ver
 * la cabecera): con `;` clavado, en macOS el atajo nunca se encontraba.
 */
export function mergeEnv(
  base: Record<string, string>,
  extra: Record<string, string> | undefined,
  plataforma: Plataforma = plataformaActual()
): Record<string, string> {
  const out = colapsarPath(base, plataforma)
  if (!extra || Object.keys(extra).length === 0) return out
  const delim = delimitadorPath(plataforma)
  for (const [k, v] of Object.entries(extra)) {
    if (esClavePath(k, plataforma)) {
      const claveBase = clavePath(out, plataforma) ?? 'PATH'
      out[claveBase] = out[claveBase] ? `${v}${delim}${out[claveBase]}` : v
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Primer segmento del PATH de un entorno ya fusionado. Solo para el registro: es lo
 * que responde "¿llegó el atajo `tdb` hasta el proceso?" sin volcar el PATH entero,
 * que son kilobytes y dejaría el log ilegible. Parte por el delimitador de la
 * plataforma: con `;` fijo, en macOS esta línea decía que el atajo había llegado
 * cuando el shell veía un primer segmento inexistente.
 */
export function primerPath(
  env: Record<string, string>,
  plataforma: Plataforma = plataformaActual()
): string {
  const clave = clavePath(env, plataforma)
  if (!clave) return '(sin PATH)'
  return String(env[clave]).split(delimitadorPath(plataforma))[0] || '(vacio)'
}
