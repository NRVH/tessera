// =============================================================================
// ¿La copia del disco de un borrado preparado es la de HEAD? Compara BYTES: primero con el blob
// crudo (un `cat-file --batch` por tanda) y, si difiere, con lo que escribiría `checkout` tras
// filtros, fin de línea y codificación (`cat-file --filters`, uno por ruta). Lo usa
// `clasificarDescartes`, bajo el candado del repo.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import { promises as fs } from 'node:fs'
import { leerBlobFiltrado, leerLoteCatFile } from './adaptadores/procesoCatFile'
import { errorDeGit } from './errores'
import type { RepoCtx } from './tipos'

/** Por encima, no se compara (se rechaza): leer la copia y el blob enteros costaría memoria. */
export const TOPE_COMPARACION = 64 * 1024 * 1024
/** Bytes de copia en disco por tanda de `cat-file --batch` (el tope de lo que retiene en memoria). */
const BYTES_POR_TANDA = 32 * 1024 * 1024
/** `cat-file --filters` simultáneos del mismo repo: solo leen. */
const FILTRADOS_A_LA_VEZ = 4

/** Una copia del disco que hay que comparar con su blob de HEAD. */
export interface CopiaAComparar {
  repoPath: string
  abs: string
  /** El blob de HEAD (de `ls-tree`), no `HEAD:<ruta>`: es el que se clasificó. */
  oid: string
  /** HEAD la tiene como enlace simbólico (modo 120000): `checkout` escribe el blob CRUDO. */
  esEnlace: boolean
  /** En disco es un enlace de verdad: se compara su destino (`readlink`), no un contenido. */
  enlaceEnDisco: boolean
  /** Bytes del contenido (de un enlace en disco, los de su destino: su `lstat` no siempre los da). */
  tamano: number
}

/** El veredicto de una copia. */
export type Comparacion = 'igual' | 'distinta' | 'grande' | { error: string }

/**
 * Compara cada copia con HEAD. Igual al blob crudo ya vale: lo que hay en el disco está en HEAD
 * y nada se pierde. Si no, solo vale igual a lo que escribiría `checkout`: un `hash-object`
 * (lo que git VE tras el filtro clean) daría por igual lo que un filtro con pérdida esconde.
 */
export async function compararConHead(
  ctx: RepoCtx,
  copias: readonly CopiaAComparar[]
): Promise<Map<string, Comparacion>> {
  const veredictos = new Map<string, Comparacion>()
  const comparables = copias.filter((c) => {
    if (c.tamano <= TOPE_COMPARACION) return true
    veredictos.set(c.repoPath, 'grande')
    return false
  })
  const aFiltrar: CopiaAComparar[] = []
  for (const tanda of tandasPorTamano(comparables)) {
    await compararCrudas(ctx, tanda, veredictos, aFiltrar)
  }
  await enParalelo(aFiltrar, FILTRADOS_A_LA_VEZ, async (c) => {
    veredictos.set(c.repoPath, await compararFiltrada(ctx, c))
  })
  return veredictos
}

/**
 * Tandas en orden de tamaño, con `n × mayor ≤ BYTES_POR_TANDA`: el tope por objeto de la tanda
 * es su copia mayor, y un blob más grande que su copia ya no puede ser igual (se corta ahí).
 */
function tandasPorTamano(copias: readonly CopiaAComparar[]): CopiaAComparar[][] {
  const ordenadas = [...copias].sort((a, b) => a.tamano - b.tamano)
  const tandas: CopiaAComparar[][] = []
  let actual: CopiaAComparar[] = []
  for (const c of ordenadas) {
    if (actual.length > 0 && (actual.length + 1) * Math.max(c.tamano, 1) > BYTES_POR_TANDA) {
      tandas.push(actual)
      actual = []
    }
    actual.push(c)
  }
  if (actual.length > 0) tandas.push(actual)
  return tandas
}

/** Una tanda contra los blobs crudos; lo que no casa va a `aFiltrar` (o es distinto, si es un enlace). */
async function compararCrudas(
  ctx: RepoCtx,
  tanda: readonly CopiaAComparar[],
  veredictos: Map<string, Comparacion>,
  aFiltrar: CopiaAComparar[]
): Promise<void> {
  const tope = Math.max(...tanda.map((c) => c.tamano))
  let pendientes = tanda
  while (pendientes.length > 0) {
    let lote: Awaited<ReturnType<typeof leerLoteCatFile>>
    try {
      lote = await leerLoteCatFile(
        pendientes.map((c) => c.oid),
        ctx.root,
        tope
      )
    } catch (err) {
      for (const c of pendientes) veredictos.set(c.repoPath, { error: errorDeGit(err) })
      return
    }
    for (let i = 0; i < lote.resultados.length; i++) {
      const c = pendientes[i]
      const blob = lote.resultados[i]
      const igual = blob.bytes !== null && (await igualAlDisco(c, blob.bytes))
      if (igual === true) veredictos.set(c.repoPath, 'igual')
      else if (typeof igual === 'object') veredictos.set(c.repoPath, igual)
      else if (c.esEnlace) veredictos.set(c.repoPath, 'distinta')
      else aFiltrar.push(c)
    }
    pendientes = lote.cortadoEn < 0 ? [] : pendientes.slice(lote.cortadoEn + 1)
  }
}

/** La copia contra lo que escribiría `checkout` (solo archivos: un enlace se escribe crudo). */
async function compararFiltrada(ctx: RepoCtx, c: CopiaAComparar): Promise<Comparacion> {
  let filtrado: Buffer | null
  try {
    filtrado = await leerBlobFiltrado(c.oid, c.repoPath, ctx.root, c.tamano)
  } catch (err) {
    return { error: errorDeGit(err) }
  }
  if (filtrado === null) return 'distinta'
  const igual = await igualAlDisco(c, filtrado)
  return igual === true ? 'igual' : igual === false ? 'distinta' : igual
}

/** ¿Los bytes del disco son `esperado`? Lo que no se puede leer no se presume igual. */
async function igualAlDisco(c: CopiaAComparar, esperado: Buffer): Promise<boolean | { error: string }> {
  if (esperado.length !== c.tamano) return false
  try {
    const disco = c.enlaceEnDisco ? await fs.readlink(c.abs, { encoding: 'buffer' }) : await fs.readFile(c.abs)
    return disco.equals(esperado)
  } catch (err) {
    return { error: `No se pudo leer la copia del disco: ${(err as { code?: string }).code ?? String(err)}` }
  }
}

/** Corre `fn` sobre `items` con a lo sumo `n` a la vez. */
async function enParalelo<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let siguiente = 0
  const obrero = async (): Promise<void> => {
    while (siguiente < items.length) await fn(items[siguiente++])
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, obrero))
}
