// =============================================================================
// Descartar cambios: revierte a HEAD (recuperable) o BORRA del disco (irrecuperable, siempre
// con confirmación). Son datos del usuario: cada orden a git y cada guarda sigue un orden fijo,
// bajo el candado del repo, y el lote pide UNA confirmación FUERA de todo candado. Qué se hace con
// cada ruta lo decide `clasificarDescartes`.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import type {
  DiscardChangesResult,
  ResultadoDescarte
} from '../../shared/git-ipc'
import { FUERA_DEL_REPO, clasificarDescartes } from './clasificarDescartes'
import { GIT_NO_RESPONDE, RUTA_NO_VALIDA, errMessage, errorDeGit, isEnoent } from './errores'
import { agruparPorRepo, pathspecDe, pathspecLiteral, trocearPathspecs } from './lotes'
import type { NucleoGit } from './NucleoGit'
import { relDeArchivo, repoPathDeArchivo, resolveInsideRepo } from './rutasRepo'
import type { Clasificacion, EntradaRepo, GrupoRepo, RepoCtx } from './tipos'

/** Descartar un archivo o un lote. */
export class Descartes {
  private readonly n: NucleoGit

  constructor(n: NucleoGit) {
    this.n = n
  }

  /**
   * Descarta los cambios de un archivo (todo respecto a HEAD, staged y unstaged). En HEAD:
   * `checkout HEAD` directo, es recuperable. Añadido sin commit o sin seguimiento: es borrar del
   * disco, irrecuperable, y pide `confirmDiscard`; cancelar no toca nada y no es error. Corre bajo
   * el candado del repo, también durante el diálogo: ningún stage ni commit debe colarse a mitad.
   */
  async discardChanges(relPosix: string): Promise<DiscardChangesResult> {
    const rel = relDeArchivo(relPosix)
    if (rel === null) return { ok: false, wasUntracked: false, error: RUTA_NO_VALIDA }
    const ctx = await this.n.ctxForPath(rel)
    if (!ctx) return { ok: false, wasUntracked: false, error: 'No hay repositorio activo.' }
    // `''` traducido (la ruta igual al prefijo del repo) revertiría el repo ENTERO sin confirmar.
    const repoPath = repoPathDeArchivo(rel, ctx)
    if (repoPath === null) return { ok: false, wasUntracked: false, error: RUTA_NO_VALIDA }
    return this.n.writeLock.runExclusive(ctx.root, () => this.discardChangesInner({ rel, repoPath }, ctx))
  }

  private async discardChangesInner(entrada: EntradaRepo, ctx: RepoCtx): Promise<DiscardChangesResult> {
    const clasificado = await clasificarDescartes(this.n, ctx, [entrada])
    // Sin respuesta de git no se sabe qué rastrea: tratarlo como «sin seguimiento» propondría BORRAR.
    if (!clasificado.ok) return { ok: false, wasUntracked: false, error: clasificado.error }
    const clase = claseDe(clasificado.clases, entrada)
    if (typeof clase === 'object') return { ok: false, wasUntracked: false, error: clase.rechazo }
    const wasUntracked = clase === 'borrar'
    try {
      if (clase === 'revertir') {
        try {
          await this.n.git(['checkout', 'HEAD', '--', pathspecLiteral(entrada.repoPath)], ctx)
        } catch (err) {
          return { ok: false, wasUntracked: false, error: errorDeGit(err) }
        }
        return { ok: true, wasUntracked: false }
      }
      const abs = resolveInsideRepo(entrada.repoPath, ctx)
      if (abs === null) return { ok: false, wasUntracked, error: FUERA_DEL_REPO }
      if (!(await this.n.confirmDiscard(path.basename(entrada.rel)))) return { ok: false, wasUntracked }
      if (clase === 'borrar-indexado') {
        await this.n.git(['rm', '--cached', '--', pathspecLiteral(entrada.repoPath)], ctx)
      }
      await this.unlinkIfExists(abs)
      return { ok: true, wasUntracked }
    } catch (err) {
      return { ok: false, wasUntracked, error: errMessage(err) }
    }
  }

  /**
   * Descarta varios archivos con UNA confirmación, en cuatro fases: (1) agrupar por repo; (2)
   * bajo el candado de cada repo, en paralelo, clasificar y REVERTIR ya lo recuperable, con esa
   * misma foto; (3) CONFIRMAR con los candados ya soltados y solo lo irrecuperable (un diálogo no
   * retiene `index.lock`); (4) borrar bajo el candado RE-CLASIFICANDO antes. Cancelar aborta solo
   * los borrados. Un rename preparado se clasifica como añadido sin commit y se borra: limitación
   * heredada del singular.
   */
  async discardChangesMany(paths: readonly string[]): Promise<ResultadoDescarte[]> {
    const { grupos, invalidas } = await agruparPorRepo(this.n, paths)
    const resultados: ResultadoDescarte[] = invalidas.map((i) => ({
      path: i.path,
      estado: 'error' as const,
      error: i.error
    }))
    if (grupos.length === 0) return resultados

    // (2) Cada repo bajo SU candado y todos en paralelo.
    const fases = await Promise.all(
      grupos.map((g) => this.n.writeLock.runExclusive(g.ctx.root, () => this.clasificarYRevertir(g)))
    )
    for (const f of fases) resultados.push(...f.hechos)

    // (3) Una sola confirmación, con los candados ya soltados.
    const nombres = fases.flatMap((f) => f.aBorrar.map((e) => path.basename(e.rel)))
    if (nombres.length === 0) return resultados
    const aprobado = await this.n.confirmDiscardMany(nombres)

    // (4) Borrar bajo el candado, re-verificando antes.
    const porGrupo = await Promise.all(
      grupos.map((g, i) => {
        const aBorrar = fases[i].aBorrar
        if (aBorrar.length === 0) return []
        if (!aprobado) return aBorrar.map((e): ResultadoDescarte => ({ path: e.rel, estado: 'cancelado' }))
        return this.n.writeLock.runExclusive(g.ctx.root, () => this.borrarReclasificando(g, aBorrar))
      })
    )
    for (const lista of porGrupo) resultados.push(...lista)
    return resultados
  }

  /**
   * Fase 2 del lote, ya bajo el candado del repo: rechaza, revierte (con la clasificación recién
   * hecha y sin soltar el candado: después del diálogo el disco podría ser otro) y aparta lo que
   * hay que borrar para el diálogo. Un repo cuyo git no contestó no se toca.
   */
  private async clasificarYRevertir(
    grupo: GrupoRepo
  ): Promise<{ hechos: ResultadoDescarte[]; aBorrar: EntradaRepo[] }> {
    const c = await clasificarDescartes(this.n, grupo.ctx, grupo.entradas)
    if (!c.ok) return { hechos: grupo.entradas.map((e) => errorDe(e, c.error)), aBorrar: [] }
    const hechos: ResultadoDescarte[] = []
    const aRevertir: EntradaRepo[] = []
    const aBorrar: EntradaRepo[] = []
    for (const e of grupo.entradas) {
      const clase = claseDe(c.clases, e)
      if (typeof clase === 'object') hechos.push(errorDe(e, clase.rechazo))
      else if (clase === 'revertir') aRevertir.push(e)
      else aBorrar.push(e)
    }
    for (const trozo of trocearPathspecs(aRevertir)) {
      try {
        await this.n.git(['checkout', 'HEAD', '--', ...trozo.map(pathspecDe)], grupo.ctx)
        for (const e of trozo) hechos.push({ path: e.rel, estado: 'revertido' })
      } catch (err) {
        const mensaje = errorDeGit(err)
        for (const e of trozo) hechos.push(errorDe(e, mensaje))
      }
    }
    return { hechos, aBorrar }
  }

  /**
   * RE-CLASIFICA justo antes de borrar: entre el diálogo y aquí el archivo pudo commitearse, y
   * entonces ya es recuperable y borrarlo perdería trabajo que git sí podía devolver.
   */
  private async borrarReclasificando(grupo: GrupoRepo, aBorrar: EntradaRepo[]): Promise<ResultadoDescarte[]> {
    const ahora = await clasificarDescartes(this.n, grupo.ctx, aBorrar)
    if (!ahora.ok) return aBorrar.map((e) => errorDe(e, ahora.error))
    const salida: ResultadoDescarte[] = []
    for (const e of aBorrar) {
      const clase = claseDe(ahora.clases, e)
      if (!esBorrado(clase)) {
        salida.push(
          typeof clase === 'object'
            ? errorDe(e, clase.rechazo)
            : { path: e.rel, estado: 'cancelado', error: 'El archivo cambió de estado durante la confirmación.' }
        )
        continue
      }
      const abs = resolveInsideRepo(e.repoPath, grupo.ctx)
      if (abs === null) {
        salida.push(errorDe(e, FUERA_DEL_REPO))
        continue
      }
      try {
        if (clase === 'borrar-indexado') {
          await this.n.git(['rm', '--cached', '--', pathspecDe(e)], grupo.ctx)
        }
        await this.unlinkIfExists(abs)
        salida.push({ path: e.rel, estado: 'borrado' })
      } catch (err) {
        salida.push(errorDe(e, errMessage(err)))
      }
    }
    return salida
  }

  /** Borra un archivo; ENOENT es éxito (el objetivo, que no esté, ya se cumple). */
  private async unlinkIfExists(abs: string): Promise<void> {
    try {
      await fs.unlink(abs)
    } catch (err) {
      if (!isEnoent(err)) throw err
    }
  }
}

/** La clase de una entrada; la clasificación las trae todas, y si faltara una no se toca. */
function claseDe(clases: Map<string, Clasificacion>, e: EntradaRepo): Clasificacion {
  return clases.get(e.repoPath) ?? { rechazo: GIT_NO_RESPONDE }
}

/** ¿La clasificación lleva a BORRAR del disco? */
function esBorrado(clase: Clasificacion): clase is 'borrar' | 'borrar-indexado' {
  return clase === 'borrar' || clase === 'borrar-indexado'
}

/** Resultado de error de una entrada del lote. */
function errorDe(e: EntradaRepo, error: string): ResultadoDescarte {
  return { path: e.rel, estado: 'error', error }
}
