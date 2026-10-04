// =============================================================================
// De una ruta del sistema a algo que Tessera sabe abrir: la mitad de «Abrir con Tessera» que toca
// el DISCO (¿existe?, ¿archivo o carpeta?, ¿dónde acaba la contenedora?). La aritmética de rutas
// vive probada en `shared/rutasHost.ts`, y que la ruta «parezca» una ruta ya lo miró
// `shared/rutasDesdeArgv.ts` al encolarla. Corre en el main porque el renderer no ve rutas del
// host: aporta qué proyectos tiene abiertos y recibe una contenedora elegida. Reglas, en orden:
// un proyecto abierto que la contenga (evita abrir el mismo árbol por dos caminos); para un
// archivo, la raíz de su repo git; la carpeta que lo contiene (una carpeta pedida ES el proyecto).
// Decisiones: docs/decisiones/sistema/cola-de-aperturas.md
// =============================================================================

import { promises as fsp } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  contenedoraMasProfunda,
  nombreRutaHost,
  normalizarRutaHost,
  padreRutaHost,
  relativaPosixHost
} from '../../shared/rutasHost.ts' // con extensión: `test-resolver-apertura.mts` corre con `node` a secas
import type {
  MotivoFalloApertura,
  ProyectoAbierto,
  ResultadoApertura
} from '../../shared/shell-windows-ipc'

/** Hasta dónde se sube buscando el `.git`. Tope anti-bucle, no un límite de diseño. */
const MAX_NIVELES = 64

/** Traduce el fallo de `stat` a un motivo que el renderer sepa contar en español. */
function motivoDeError(err: unknown): MotivoFalloApertura {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'no-existe'
  if (code === 'EACCES' || code === 'EPERM') return 'sin-permiso'
  return 'ruta-invalida'
}

/**
 * La raíz del repo git que contiene esta carpeta, o `null`.
 *
 * Se acepta `.git` como archivo y no solo como carpeta a propósito: en un worktree y
 * en un submódulo, `.git` es un fichero con un puntero dentro. Comprobar solo la
 * carpeta habría hecho que abrir un archivo de un worktree se llevara la contenedora
 * equivocada, y es justo el tipo de repo donde más duele.
 */
export function raizRepoGit(desde: string): string | null {
  let actual: string | null = normalizarRutaHost(desde)
  for (let i = 0; i < MAX_NIVELES && actual !== null; i++) {
    if (existsSync(join(actual, '.git'))) return actual
    actual = padreRutaHost(actual)
  }
  return null
}

/**
 * Identidad de un sitio del disco (dispositivo + inodo), o null si el sistema de archivos no la
 * da. Lanza si la ruta no existe. Inyectable para simular un volumen sensible a mayúsculas.
 */
export type IdentidadDisco = (ruta: string) => Promise<string | null>

async function identidadPorStat(ruta: string): Promise<string | null> {
  const st = await fsp.stat(ruta, { bigint: true })
  return st.ino === 0n ? null : `${st.dev}:${st.ino}`
}

/**
 * El proyecto abierto más profundo que contiene `objetivo`, con su relativo. La aritmética
 * compara sin distinguir mayúsculas; cuando la caja difiere se pregunta al disco, porque en un
 * volumen sensible (APFS sensible, carpetas con distinción en Windows) `Proyecto` y `proyecto`
 * son sitios distintos y activar el primero abriría OTRO archivo con el mismo nombre.
 */
async function abiertoQueContiene(
  abiertos: readonly ProyectoAbierto[],
  objetivo: string,
  identidad: IdentidadDisco
): Promise<{ proyecto: ProyectoAbierto; rel: string | null } | null> {
  let restantes = abiertos
  for (;;) {
    const proyecto = contenedoraMasProfunda(restantes, objetivo)
    if (proyecto === null) return null
    const rel = relativaPosixHost(proyecto.projectHostPath, objetivo)
    if (rel === null || (await mismoSitio(proyecto.projectHostPath, rel, objetivo, identidad))) {
      return { proyecto, rel }
    }
    restantes = restantes.filter((p) => p !== proyecto)
  }
}

/** ¿`base` + `rel` es el mismo sitio que `objetivo`? Con la misma caja no se toca el disco. */
async function mismoSitio(base: string, rel: string, objetivo: string, identidad: IdentidadDisco): Promise<boolean> {
  const enElProyecto = normalizarRutaHost(rel === '' ? base : `${base}/${rel}`)
  if (enElProyecto === objetivo) return true
  try {
    const [a, b] = await Promise.all([identidad(enElProyecto), identidad(objetivo)])
    // Sin identidad (algunos recursos de red) se queda la comparación sin caja de siempre.
    return a === null || b === null || a === b
  } catch {
    return false // con la caja del proyecto no existe: es otro sitio
  }
}

/**
 * Convierte una ruta que entregó el Explorador en una apertura resuelta.
 *
 * `abiertos` son los proyectos abiertos de todos los perfiles: los que manda el
 * renderer y, mientras no haya restaurado sus pestañas, también los persistidos
 * (`abiertosEfectivos`). Si la ruta cae en uno, se devuelve su `profileId` para que el
 * renderer lo active en vez de abrir otro.
 */
export async function resolverApertura(
  ruta: string,
  abiertos: readonly ProyectoAbierto[],
  identidad: IdentidadDisco = identidadPorStat
): Promise<ResultadoApertura> {
  const objetivo = normalizarRutaHost(ruta)
  const nombre = nombreRutaHost(objetivo) || objetivo

  let esCarpeta: boolean
  try {
    const st = await fsp.stat(objetivo)
    esCarpeta = st.isDirectory()
  } catch (err) {
    return { ok: false, nombre, motivo: motivoDeError(err) }
  }

  // Regla 1: ¿cae dentro de algo que ya está abierto?
  const abierto = await abiertoQueContiene(abiertos, objetivo, identidad)
  if (abierto !== null) {
    const { proyecto: yaAbierto, rel } = abierto
    if (rel === null) return { ok: false, nombre, motivo: 'fuera-de-la-contenedora' }
    return {
      ok: true,
      apertura: {
        contenedora: {
          projectHostPath: yaAbierto.projectHostPath,
          name: nombreRutaHost(yaAbierto.projectHostPath)
        },
        profileIdExistente: yaAbierto.profileId,
        // `rel === ''` significa "es la propia contenedora": no hay archivo que abrir
        // ni nada que desplegar, solo activar la pestaña.
        archivo: !esCarpeta && rel !== '' ? { path: rel, name: nombre } : null,
        revelar: rel === '' ? null : rel
      }
    }
  }

  // Reglas 2 y 3: no está abierto en ningún sitio, hay que acuñar una contenedora.
  const contenedora = esCarpeta
    ? objetivo
    : (raizRepoGit(padreRutaHost(objetivo) ?? objetivo) ?? padreRutaHost(objetivo) ?? objetivo)

  const rel = relativaPosixHost(contenedora, objetivo)
  if (rel === null) return { ok: false, nombre, motivo: 'fuera-de-la-contenedora' }

  return {
    ok: true,
    apertura: {
      contenedora: { projectHostPath: contenedora, name: nombreRutaHost(contenedora) },
      profileIdExistente: null,
      archivo: !esCarpeta && rel !== '' ? { path: rel, name: nombre } : null,
      revelar: rel === '' ? null : rel
    }
  }
}
