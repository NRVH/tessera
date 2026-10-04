// =============================================================================
// Clasificación de un descarte: qué se le hace a cada ruta (revertir a HEAD, borrar del disco) o
// por qué no se toca. Mira el índice (`ls-files -s`), HEAD (`ls-tree`) y el DISCO, porque lo que
// `checkout HEAD --` pisaría sin preguntar solo se ve ahí. Lo usa `descartes.ts`, uno y lote.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import { compararConHead, type CopiaAComparar } from './copiaDeHead'
import { FS, errorDeGit } from './errores'
import { anotarAncestros, pathspecDe, trocearPathspecs } from './lotes'
import type { NucleoGit } from './NucleoGit'
import { claveNombreGit, resolveInsideRepo } from './rutasRepo'
import type { Clasificacion, EntradaRepo, RepoCtx } from './tipos'

/** Rechazo de una carpeta: su pathspec casaría todo lo de debajo, y el gesto es de un archivo. */
export const ES_CARPETA = 'Es una carpeta: descarta sus archivos uno a uno.'
/** Rechazo de una ruta que, traducida, cae fuera del repo (anti-traversal). */
export const FUERA_DEL_REPO = 'Ruta fuera del repositorio.'
const EN_CONFLICTO = 'Está en conflicto: resuélvelo (o aborta la fusión) antes de descartar.'
const CARPETA_SOBRE_ARCHIVO = 'Hay una carpeta donde estaba el archivo: muévela antes de descartar.'
const ARCHIVO_SOBRE_CARPETA = 'Hay un archivo donde estaba una de sus carpetas: muévelo antes de descartar.'
const BORRADO_CON_CAMBIOS =
  'Su borrado ya está preparado y la copia del disco tiene cambios: quítalo de preparados antes de descartar.'
const BORRADO_GRANDE =
  'Su borrado ya está preparado y la copia del disco es demasiado grande para comprobarla: quítalo de preparados antes de descartar.'
const FUERA_DEL_ARBOL =
  'Está marcado para no tocarse en el árbol de trabajo (skip-worktree): quita la marca antes de descartar.'
const RAMA_ROTA = 'La rama actual no apunta a un commit válido (su referencia está dañada): no se descarta nada.'

/** Un submódulo: en disco es una carpeta, y `checkout` no entra en ella. */
const MODO_SUBMODULO = '160000'
/** Un enlace simbólico: en disco, un enlace o (sin `core.symlinks`) un archivo con su destino. */
const MODO_ENLACE = '120000'
/** Los modos de un archivo normal. */
const MODOS_ARCHIVO = new Set(['100644', '100755'])

/** La clasificación de un repo, o el error por el que se aborta entero sin tocar nada. */
export type Clasificado = { ok: true; clases: Map<string, Clasificacion> } | { ok: false; error: string }

/** Qué hay en disco en una ruta, sin seguir enlaces. */
type EnDisco = 'nada' | 'carpeta' | 'archivo' | 'enlace' | 'otro'

/** Lo que git dice de las rutas de un repo, por su clave (`claveNombreGit`). */
interface Listado {
  indice: Set<string>
  conflicto: Set<string>
  fueraDelArbol: Set<string>
  head: Map<string, { modo: string; objeto: string }>
  carpetas: Set<string>
}

/** Los registros `<campos>\t<ruta>` de una salida `-z` de `ls-files -s` o `ls-tree`. */
function registros(stdout: string): Array<{ campos: string[]; clave: string }> {
  const salida: Array<{ campos: string[]; clave: string }> = []
  for (const r of stdout.split(FS)) {
    const tab = r.indexOf('\t')
    if (tab === -1) continue
    salida.push({ campos: r.slice(0, tab).split(' '), clave: claveNombreGit(r.slice(tab + 1)) })
  }
  return salida
}

async function enDisco(abs: string): Promise<EnDisco> {
  return (await mirarDisco(abs)).tipo
}

/** Qué hay en disco y cuánto mide (de un enlace, su destino). */
async function mirarDisco(abs: string): Promise<{ tipo: EnDisco; tamano: number }> {
  try {
    const st = await fs.lstat(abs)
    if (st.isSymbolicLink()) {
      return { tipo: 'enlace', tamano: (await fs.readlink(abs, { encoding: 'buffer' })).length }
    }
    return { tipo: st.isDirectory() ? 'carpeta' : st.isFile() ? 'archivo' : 'otro', tamano: st.size }
  } catch (err) {
    const code = (err as { code?: unknown }).code
    // Lo que no se puede mirar no se presume vacío: «otro» lleva al lado que no pisa.
    return { tipo: code === 'ENOENT' || code === 'ENOTDIR' ? 'nada' : 'otro', tamano: 0 }
  }
}

/** ¿El error de git es la salida 1? `rev-parse --verify -q` la usa para «no existe». */
function salioConUno(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 1
}

/**
 * Clasifica las rutas de UN repo: dos órdenes de git por trozo (`-z`: con `core.quotePath` los
 * acentos no casarían), un `lstat` por ruta y, para las copias de borrados preparados, la
 * comparación por bytes de `copiaDeHead`. `ok: false` si git no contestó o HEAD no es fiable:
 * el que llama aborta el repo entero sin revertir ni borrar nada.
 */
export async function clasificarDescartes(
  n: NucleoGit,
  ctx: RepoCtx,
  entradas: readonly EntradaRepo[]
): Promise<Clasificado> {
  const l: Listado = {
    indice: new Set(),
    conflicto: new Set(),
    fueraDelArbol: new Set(),
    head: new Map(),
    carpetas: new Set()
  }
  let hayHead = true
  for (const trozo of trocearPathspecs(entradas)) {
    const specs = trozo.map(pathspecDe)
    try {
      // `-t` antepone la etiqueta: «S» = skip-worktree, que `checkout` no toca («no casa»).
      const { stdout } = await n.git(['ls-files', '-z', '-t', '-s', '--', ...specs], ctx)
      for (const { campos, clave } of registros(stdout)) {
        l.indice.add(clave)
        if (campos[3] !== '0') l.conflicto.add(clave)
        if (campos[0] === 'S') l.fueraDelArbol.add(clave)
        anotarAncestros(clave, l.carpetas)
      }
    } catch (err) {
      return { ok: false, error: errorDeGit(err) } // sin listado, «sin seguimiento» propondría BORRAR
    }
    if (!hayHead) continue
    try {
      const { stdout } = await n.git(['ls-tree', '-r', '-z', 'HEAD', '--', ...specs], ctx)
      for (const { campos, clave } of registros(stdout)) {
        l.head.set(clave, { modo: campos[0] ?? '', objeto: campos[2] ?? '' })
        anotarAncestros(clave, l.carpetas)
      }
    } catch (err) {
      const motivo = await motivoSinHead(n, ctx, err)
      if (motivo !== null) return { ok: false, error: motivo }
      hayHead = false
    }
  }
  const clases = new Map<string, Clasificacion>()
  const caminos = new Map<string, boolean>()
  const copias: CopiaAComparar[] = []
  for (const e of entradas) {
    const clase = await clasificarUna(ctx, e, l, caminos)
    if (typeof clase === 'object' && 'oid' in clase) copias.push(clase)
    else clases.set(e.repoPath, clase)
  }
  await resolverCopias(ctx, copias, clases)
  return { ok: true, clases }
}

/** Las copias de borrados preparados: solo se revierte la que la comparación da por igual. */
async function resolverCopias(
  ctx: RepoCtx,
  copias: readonly CopiaAComparar[],
  clases: Map<string, Clasificacion>
): Promise<void> {
  if (copias.length === 0) return
  const veredictos = await compararConHead(ctx, copias)
  for (const c of copias) {
    const v = veredictos.get(c.repoPath) ?? 'distinta'
    const clase: Clasificacion =
      v === 'igual'
        ? 'revertir'
        : v === 'grande'
          ? { rechazo: BORRADO_GRANDE }
          : v === 'distinta'
            ? { rechazo: BORRADO_CON_CAMBIOS }
            : { rechazo: v.error }
    clases.set(c.repoPath, clase)
  }
}

/**
 * Una ruta. Lo que no está en HEAD se borra (confirmando); lo que está se revierte, salvo que
 * `checkout HEAD --` fuera a pisar algo del disco que no se puede devolver: una carpeta donde HEAD
 * pone el archivo (la vacía entera), un archivo donde pone una carpeta, o la copia con cambios de
 * un archivo cuyo borrado ya está preparado (esa sale como `CopiaAComparar`). Eso se RECHAZA: ni
 * git lo avisa ni hay diálogo que pueda listar lo que se perdería.
 */
async function clasificarUna(
  ctx: RepoCtx,
  e: EntradaRepo,
  l: Listado,
  caminos: Map<string, boolean>
): Promise<Clasificacion | CopiaAComparar> {
  const clave = claveNombreGit(e.repoPath)
  if (l.carpetas.has(clave)) return { rechazo: ES_CARPETA }
  if (l.conflicto.has(clave)) return { rechazo: EN_CONFLICTO }
  const abs = resolveInsideRepo(e.repoPath, ctx)
  if (abs === null) return { rechazo: FUERA_DEL_REPO }
  const disco = await mirarDisco(abs)
  const enHead = l.head.get(clave)
  if (!enHead) {
    // Una carpeta sin seguimiento no la lista git: la delata el disco, y `unlink` no la borraría.
    if (disco.tipo === 'carpeta') return { rechazo: ES_CARPETA }
    return l.indice.has(clave) ? 'borrar-indexado' : 'borrar'
  }
  if (l.fueraDelArbol.has(clave)) return { rechazo: FUERA_DEL_ARBOL }
  if (disco.tipo === 'carpeta' && enHead.modo !== MODO_SUBMODULO) return { rechazo: CARPETA_SOBRE_ARCHIVO }
  if (await archivoEnElCamino(ctx.root, abs, caminos)) return { rechazo: ARCHIVO_SOBRE_CARPETA }
  // En HEAD y fuera del índice: un borrado ya preparado. Revertir lo restaura, y pisaría el disco.
  if (!l.indice.has(clave) && disco.tipo !== 'nada') {
    return copiaAComparar(e.repoPath, abs, disco, enHead) ?? { rechazo: BORRADO_CON_CAMBIOS }
  }
  return 'revertir'
}

/**
 * Lo que `checkout` escribe en el sitio de la copia y se puede comparar con ella: un archivo
 * normal donde HEAD tiene un archivo, o un enlace (de verdad, o como archivo con su destino)
 * donde HEAD tiene un enlace. `null` si no casan: la copia no es la de HEAD.
 */
function copiaAComparar(
  repoPath: string,
  abs: string,
  disco: { tipo: EnDisco; tamano: number },
  enHead: { modo: string; objeto: string }
): CopiaAComparar | null {
  const base = { repoPath, abs, oid: enHead.objeto, tamano: disco.tamano }
  if (MODOS_ARCHIVO.has(enHead.modo) && disco.tipo === 'archivo') {
    return { ...base, esEnlace: false, enlaceEnDisco: false }
  }
  if (enHead.modo === MODO_ENLACE && (disco.tipo === 'archivo' || disco.tipo === 'enlace')) {
    return { ...base, esEnlace: true, enlaceEnDisco: disco.tipo === 'enlace' }
  }
  return null
}

/** ¿Alguna carpeta de la ruta, dentro del repo, es en disco otra cosa (archivo, enlace)? Con caché por lote. */
async function archivoEnElCamino(root: string, abs: string, caminos: Map<string, boolean>): Promise<boolean> {
  for (let dir = path.dirname(abs); dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
    let malo = caminos.get(dir)
    if (malo === undefined) {
      const tipo = await enDisco(dir)
      malo = tipo !== 'nada' && tipo !== 'carpeta'
      caminos.set(dir, malo)
    }
    if (malo) return true
  }
  return false
}

/**
 * `ls-tree HEAD` falló: `null` si es un repo sin commits (nada en HEAD, se sigue), o el motivo
 * para abortar. `rev-parse` sale con 1 también si la ref de la rama tiene basura o está vacía
 * (un apagón al escribirla); tomarlo por «sin commits» pasaría lo del último commit a BORRAR.
 */
async function motivoSinHead(n: NucleoGit, ctx: RepoCtx, errLsTree: unknown): Promise<string | null> {
  try {
    await n.git(['rev-parse', '--verify', '-q', 'HEAD'], ctx)
    return errorDeGit(errLsTree) // HEAD resuelve y aun así no se lee: un objeto que falta
  } catch (err) {
    if (!salioConUno(err)) return errorDeGit(err)
  }
  return (await ramaSinNacer(n, ctx)) ? null : RAMA_ROTA
}

/**
 * ¿HEAD apunta a una rama que de verdad no existe todavía? Ni su archivo de ref, ni una línea en
 * `packed-refs`, ni un registro de movimientos con algo dentro. Ante cualquier duda, `false`.
 */
async function ramaSinNacer(n: NucleoGit, ctx: RepoCtx): Promise<boolean> {
  try {
    const rama = (await n.git(['symbolic-ref', '-q', 'HEAD'], ctx)).stdout.trim()
    if (!rama.startsWith('refs/heads/')) return false
    const { stdout } = await n.git(
      ['rev-parse', '--git-path', rama, '--git-path', 'packed-refs', '--git-path', `logs/${rama}`],
      ctx
    )
    const [ref, empaquetadas, registro] = stdout
      .split(/\r?\n/)
      .filter((p) => p.trim() !== '')
      .map((p) => path.resolve(ctx.root, p.trim()))
    if (!ref || !empaquetadas || !registro) return false
    if ((await enDisco(ref)) !== 'nada') return false
    if ((await enDisco(registro)) !== 'nada' && (await fs.stat(registro)).size > 0) return false
    if ((await enDisco(empaquetadas)) === 'nada') return true
    const lineas = (await fs.readFile(empaquetadas, 'utf8')).split(/\r?\n/)
    return !lineas.some((linea) => linea.endsWith(` ${rama}`))
  } catch {
    return false
  }
}
