// =============================================================================
// Lotes de rutas: agrupa por repo, rechaza lo que convertiría un pathspec en `:/` (el repo
// ENTERO) y trocea para que quepa en una línea de comando. Lo usan preparar, descartar e ignorar.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import { FS, rutaNoValida } from './errores'
import { txGit } from './textos.ts'
import { claveNombreGit, relDeArchivo, rutaRepoDeArchivo } from './rutasRepo'
import type { EntradaRepo, GrupoRepo, RepoCtx } from './tipos'

/** Tope de rutas de un lote: freno contra una selección desbocada, no un límite de producto. */
export const MAX_RUTAS_LOTE = 20000

/** Presupuesto de caracteres de argv por invocación de git (holgado a propósito por el límite de Windows). */
export const MAX_CARACTERES_ARGV = 6000

/** Lo que `agruparPorRepo` necesita del servicio. */
export interface ResolutorDeRutas {
  obtenerCtxParaRuta(relPosix: string): Promise<RepoCtx | null>
  log(msg: string): void
}

/** Rutas de un lote que no se pudieron procesar, con su motivo. */
export type RutaInvalida = { ruta: string; error: string }

/**
 * Pathspec de git de una entrada: `top` = relativo al TOPLEVEL del repo; `literal` = sin glob,
 * porque `*`, `?` y `[...]` en un nombre (`informe[1].pdf`) casarían también a sus vecinos.
 */
export function pathspecDe(entrada: EntradaRepo): string {
  return pathspecLiteral(entrada.rutaRepo)
}

/** El pathspec literal y desde el toplevel de una ruta del repo (ver `pathspecDe`). */
export function pathspecLiteral(rutaRepo: string): string {
  return `:(top,literal)${rutaRepo}`
}

/**
 * Parte las entradas en trozos que quepan en una línea de comando. Una entrada suelta que
 * ya pase del presupuesto va en su propio trozo: recortarla sería operar sobre otro archivo.
 */
export function trocearPathspecs(entradas: readonly EntradaRepo[]): EntradaRepo[][] {
  const trozos: EntradaRepo[][] = []
  let actual: EntradaRepo[] = []
  let coste = 0
  for (const entrada of entradas) {
    const suyo = entrada.rutaRepo.length + 4
    if (actual.length > 0 && coste + suyo > MAX_CARACTERES_ARGV) {
      trozos.push(actual)
      actual = []
      coste = 0
    }
    actual.push(entrada)
    coste += suyo
  }
  if (actual.length > 0) trozos.push(actual)
  return trozos
}

/** Anota en `carpetas` cada carpeta ancestro de una clave de ruta (`claveNombreGit`). */
export function anotarAncestros(clave: string, carpetas: Set<string>): void {
  for (let i = clave.indexOf('/'); i !== -1; i = clave.indexOf('/', i + 1)) carpetas.add(clave.slice(0, i))
}

/**
 * Las carpetas que delata una salida `-z` de rutas de git: una ruta pedida que es ancestro de
 * algo listado nombra una CARPETA, y su pathspec casaría todo lo de debajo.
 */
export function carpetasDeSalida(stdout: string): Set<string> {
  const carpetas = new Set<string>()
  for (const p of stdout.split(FS)) if (p !== '') anotarAncestros(claveNombreGit(p), carpetas)
  return carpetas
}

/** Las rutas que pasan del tope se REPORTAN como inválidas (y se registran), no se caen en silencio. */
function sobrantesDelLote(
  n: ResolutorDeRutas,
  rutas: readonly string[],
  invalidas: RutaInvalida[]
): void {
  if (rutas.length <= MAX_RUTAS_LOTE) return
  n.log(`lote recortado a ${MAX_RUTAS_LOTE} rutas (llegaron ${rutas.length})`)
  for (const sobrante of rutas.slice(MAX_RUTAS_LOTE)) {
    invalidas.push({
      ruta: sobrante,
      error: txGit().demasiadosEnLote(MAX_RUTAS_LOTE)
    })
  }
}

/**
 * Agrupa rutas contenedora-relativas por el REPO al que pertenecen, con un contexto por
 * PRIMER SEGMENTO distinto. GUARDA DE RUTA VACÍA: se descarta toda ruta que no nombre un
 * archivo por su forma o que traduzca a vacía (`relDeArchivo` + `rutaRepoDeArchivo`); sin ella, un elemento vacío convierte el pathspec en `:/` y `checkout HEAD -- :/`
 * arrasa el árbol de trabajo entero.
 */
export async function agruparPorRepo(
  n: ResolutorDeRutas,
  rutas: readonly string[]
): Promise<{ grupos: GrupoRepo[]; invalidas: RutaInvalida[] }> {
  const invalidas: RutaInvalida[] = []
  const grupos = new Map<string, GrupoRepo>()
  const ctxPorCarpeta = new Map<string, RepoCtx | null>()
  const vistas = new Set<string>()

  for (const original of rutas.slice(0, MAX_RUTAS_LOTE)) {
    const rel = relDeArchivo(original)
    if (rel === null) {
      invalidas.push({ ruta: original, error: rutaNoValida() })
      continue
    }
    if (vistas.has(rel)) continue
    vistas.add(rel)

    // El repo lo deciden las carpetas de la ruta, así que se resuelve una vez por carpeta. En la
    // raíz cuenta la propia entrada, que puede ser la carpeta de un repo.
    const carpeta = rel.slice(0, Math.max(0, rel.lastIndexOf('/')))
    const clave = carpeta === '' ? rel : carpeta
    if (!ctxPorCarpeta.has(clave)) ctxPorCarpeta.set(clave, await n.obtenerCtxParaRuta(clave))
    const ctx = ctxPorCarpeta.get(clave) ?? null
    if (!ctx) {
      invalidas.push({ ruta: original, error: txGit().sinRepoRuta })
      continue
    }
    const rutaRepo = rutaRepoDeArchivo(rel, ctx)
    if (rutaRepo === null) {
      invalidas.push({ ruta: original, error: rutaNoValida() })
      continue
    }
    let grupo = grupos.get(ctx.raiz)
    if (!grupo) {
      grupo = { ctx, entradas: [] }
      grupos.set(ctx.raiz, grupo)
    }
    grupo.entradas.push({ rel, rutaRepo })
  }
  sobrantesDelLote(n, rutas, invalidas)
  return { grupos: [...grupos.values()], invalidas }
}
