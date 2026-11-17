// =============================================================================
// Descartar cambios: revierte a HEAD (el archivo sigue; lo no commiteado se pierde) o BORRA del
// disco. Las dos cosas pierden trabajo: uno y lote piden UNA confirmación, FUERA de todo candado y
// ANTES de tocar nada, y bajo el candado RE-CLASIFICAN tras ella. Qué se hace con cada ruta lo
// decide `clasificarDescartes`.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import type {
  ResultadoDescarteCambios,
  ResultadoDescarte
} from '../../shared/git-ipc'
import { fueraDelRepo, clasificarDescartes } from './clasificarDescartes'
import { gitNoResponde, rutaNoValida, mensajeError, errorDeGit, esEnoent } from './errores'
import { txGit } from './textos.ts'
import { agruparPorRepo, pathspecDe, pathspecLiteral, trocearPathspecs } from './lotes'
import type { NucleoGit } from './NucleoGit'
import { relDeArchivo, rutaRepoDeArchivo, resolverDentroDelRepo } from './rutasRepo'
import type { ClaseDescarte, Clasificacion, EntradaRepo, GrupoRepo, RepoCtx } from './tipos'

/** Descartar un archivo o un lote. */
export class Descartes {
  private readonly n: NucleoGit

  constructor(n: NucleoGit) {
    this.n = n
  }

  /**
   * Descarta los cambios de un archivo (todo respecto a HEAD, staged y unstaged). En HEAD,
   * `checkout HEAD`: el archivo sigue y pierde lo no commiteado. Añadido sin commit o sin
   * seguimiento: se borra del disco. Las dos piden `confirmarDescarte` con el candado SOLTADO (un
   * diálogo no retiene `index.lock`); cancelar no toca nada y no es error. Tras el diálogo, bajo
   * el candado, se RE-CLASIFICA: si la ruta cambió de clase, no se hace nada.
   */
  async descartarCambios(relPosix: string): Promise<ResultadoDescarteCambios> {
    const rel = relDeArchivo(relPosix)
    if (rel === null) return { ok: false, estabaSinSeguimiento: false, error: rutaNoValida() }
    const ctx = await this.n.obtenerCtxParaRuta(rel)
    if (!ctx) return { ok: false, estabaSinSeguimiento: false, error: txGit().sinRepo }
    // `''` traducido (la ruta igual al prefijo del repo) revertiría el repo ENTERO.
    const rutaRepo = rutaRepoDeArchivo(rel, ctx)
    if (rutaRepo === null) return { ok: false, estabaSinSeguimiento: false, error: rutaNoValida() }
    const entrada: EntradaRepo = { rel, rutaRepo }
    const clase = await this.n.candadoEscritura.ejecutarExclusivo(ctx.raiz, () => this.clasificarUna(entrada, ctx))
    if (typeof clase === 'object') return { ok: false, estabaSinSeguimiento: false, error: clase.rechazo }
    const estabaSinSeguimiento = clase === 'borrar'
    if (esBorrado(clase) && resolverDentroDelRepo(entrada.rutaRepo, ctx) === null) {
      return { ok: false, estabaSinSeguimiento, error: fueraDelRepo() }
    }
    if (!(await this.n.confirmarDescarte(path.basename(entrada.rel), esBorrado(clase)))) return { ok: false, estabaSinSeguimiento }
    return this.n.candadoEscritura.ejecutarExclusivo(ctx.raiz, () => this.aplicarUna(entrada, ctx, clase))
  }

  /** La clase de una ruta. Sin respuesta de git no se sabe qué rastrea: «sin seguimiento» propondría BORRAR. */
  private async clasificarUna(entrada: EntradaRepo, ctx: RepoCtx): Promise<Clasificacion> {
    const clasificado = await clasificarDescartes(this.n, ctx, [entrada])
    return clasificado.ok ? claseDe(clasificado.clases, entrada) : { rechazo: clasificado.error }
  }

  /** Ya confirmado y bajo el candado: re-clasifica y, si la clase sigue siendo la confirmada, la aplica. */
  private async aplicarUna(entrada: EntradaRepo, ctx: RepoCtx, confirmada: ClaseDescarte): Promise<ResultadoDescarteCambios> {
    const estabaSinSeguimiento = confirmada === 'borrar'
    const clase = await this.clasificarUna(entrada, ctx)
    if (typeof clase === 'object') return { ok: false, estabaSinSeguimiento, error: clase.rechazo }
    if (!mismaAccion(clase, confirmada)) return { ok: false, estabaSinSeguimiento, error: txGit().cambioDeEstado }
    try {
      if (clase === 'revertir') {
        try {
          await this.n.git(['checkout', 'HEAD', '--', pathspecLiteral(entrada.rutaRepo)], ctx)
        } catch (err) {
          return { ok: false, estabaSinSeguimiento: false, error: errorDeGit(err) }
        }
        return { ok: true, estabaSinSeguimiento: false }
      }
      const abs = resolverDentroDelRepo(entrada.rutaRepo, ctx)
      if (abs === null) return { ok: false, estabaSinSeguimiento, error: fueraDelRepo() }
      if (clase === 'borrar-indexado') {
        await this.n.git(['rm', '--cached', '--', pathspecLiteral(entrada.rutaRepo)], ctx)
      }
      await this.borrarSiExiste(abs)
      return { ok: true, estabaSinSeguimiento }
    } catch (err) {
      return { ok: false, estabaSinSeguimiento, error: mensajeError(err) }
    }
  }

  /**
   * Descarta varios archivos con UNA confirmación, en cuatro fases: (1) agrupar por repo; (2)
   * bajo el candado de cada repo, en paralelo, clasificar SIN tocar nada; (3) CONFIRMAR con los
   * candados soltados (un diálogo no retiene `index.lock`), con lo que se revierte y, aparte, lo
   * que se borra; (4) bajo el candado, RE-CLASIFICAR y aplicar solo lo que conserva la clase
   * confirmada. Cancelar no toca nada. Un rename preparado se clasifica como añadido sin commit
   * y se borra: limitación heredada del singular.
   */
  async descartarCambiosVarios(rutas: readonly string[]): Promise<ResultadoDescarte[]> {
    const { grupos, invalidas } = await agruparPorRepo(this.n, rutas)
    const resultados: ResultadoDescarte[] = invalidas.map((i) => ({
      ruta: i.ruta,
      estado: 'error' as const,
      error: i.error
    }))
    if (grupos.length === 0) return resultados

    // (2) Cada repo bajo SU candado y todos en paralelo.
    const fases = await Promise.all(
      grupos.map((g) => this.n.candadoEscritura.ejecutarExclusivo(g.ctx.raiz, () => this.clasificarLote(g)))
    )
    for (const f of fases) resultados.push(...f.rechazos)

    // (3) Una sola confirmación, con los candados ya soltados y nada tocado todavía.
    const aBorrar = fases.flatMap((f) => f.planes.filter((p) => esBorrado(p.clase)).map((p) => path.basename(p.e.rel)))
    const aRevertir = fases.flatMap((f) => f.planes.filter((p) => p.clase === 'revertir').map((p) => path.basename(p.e.rel)))
    if (aBorrar.length === 0 && aRevertir.length === 0) return resultados
    const aprobado = await this.n.confirmarDescarteVarios(aBorrar, aRevertir)

    // (4) Aplicar bajo el candado, re-verificando antes.
    const porGrupo = await Promise.all(
      grupos.map((g, i) => {
        const planes = fases[i].planes
        if (planes.length === 0) return []
        if (!aprobado) return planes.map((p): ResultadoDescarte => ({ ruta: p.e.rel, estado: 'cancelado' }))
        return this.n.candadoEscritura.ejecutarExclusivo(g.ctx.raiz, () => this.aplicarReclasificando(g, planes))
      })
    )
    for (const lista of porGrupo) resultados.push(...lista)
    return resultados
  }

  /**
   * Fase 2 del lote, bajo el candado del repo: aparta los rechazos y anota qué se haría con
   * cada ruta, para el diálogo. No toca nada. Un repo cuyo git no contestó no se toca.
   */
  private async clasificarLote(grupo: GrupoRepo): Promise<{ rechazos: ResultadoDescarte[]; planes: Plan[] }> {
    const c = await clasificarDescartes(this.n, grupo.ctx, grupo.entradas)
    if (!c.ok) return { rechazos: grupo.entradas.map((e) => errorDe(e, c.error)), planes: [] }
    const rechazos: ResultadoDescarte[] = []
    const planes: Plan[] = []
    for (const e of grupo.entradas) {
      const clase = claseDe(c.clases, e)
      if (typeof clase === 'object') rechazos.push(errorDe(e, clase.rechazo))
      else planes.push({ e, clase })
    }
    return { rechazos, planes }
  }

  /**
   * Fase 4, ya confirmada y bajo el candado: RE-CLASIFICA, porque entre el diálogo y aquí el
   * archivo pudo commitearse (borrarlo perdería lo que git sí podía devolver) o cambiar de
   * forma. Solo se aplica lo que conserva la clase que el usuario aprobó.
   */
  private async aplicarReclasificando(grupo: GrupoRepo, planes: Plan[]): Promise<ResultadoDescarte[]> {
    const ahora = await clasificarDescartes(this.n, grupo.ctx, planes.map((p) => p.e))
    if (!ahora.ok) return planes.map((p) => errorDe(p.e, ahora.error))
    const salida: ResultadoDescarte[] = []
    const aRevertir: EntradaRepo[] = []
    const aBorrar: Array<{ e: EntradaRepo; clase: 'borrar' | 'borrar-indexado' }> = []
    for (const p of planes) {
      const clase = claseDe(ahora.clases, p.e)
      if (typeof clase === 'object') salida.push(errorDe(p.e, clase.rechazo))
      else if (!mismaAccion(clase, p.clase)) salida.push(errorDe(p.e, txGit().cambioDeEstado))
      else if (clase === 'revertir') aRevertir.push(p.e)
      else aBorrar.push({ e: p.e, clase })
    }
    salida.push(...(await this.revertir(grupo, aRevertir)))
    salida.push(...(await this.borrar(grupo, aBorrar)))
    return salida
  }

  /** `checkout HEAD` por trozos; un trozo que falla marca en error solo a los suyos. */
  private async revertir(grupo: GrupoRepo, aRevertir: EntradaRepo[]): Promise<ResultadoDescarte[]> {
    const salida: ResultadoDescarte[] = []
    for (const trozo of trocearPathspecs(aRevertir)) {
      try {
        await this.n.git(['checkout', 'HEAD', '--', ...trozo.map(pathspecDe)], grupo.ctx)
        for (const e of trozo) salida.push({ ruta: e.rel, estado: 'revertido' })
      } catch (err) {
        const mensaje = errorDeGit(err)
        for (const e of trozo) salida.push(errorDe(e, mensaje))
      }
    }
    return salida
  }

  /** Borra del disco lo ya re-clasificado (y, si estaba en el índice, antes `rm --cached`). */
  private async borrar(
    grupo: GrupoRepo,
    aBorrar: Array<{ e: EntradaRepo; clase: 'borrar' | 'borrar-indexado' }>
  ): Promise<ResultadoDescarte[]> {
    const salida: ResultadoDescarte[] = []
    for (const { e, clase } of aBorrar) {
      const abs = resolverDentroDelRepo(e.rutaRepo, grupo.ctx)
      if (abs === null) {
        salida.push(errorDe(e, fueraDelRepo()))
        continue
      }
      try {
        if (clase === 'borrar-indexado') {
          await this.n.git(['rm', '--cached', '--', pathspecDe(e)], grupo.ctx)
        }
        await this.borrarSiExiste(abs)
        salida.push({ ruta: e.rel, estado: 'borrado' })
      } catch (err) {
        salida.push(errorDe(e, mensajeError(err)))
      }
    }
    return salida
  }

  /** Borra un archivo; ENOENT es éxito (el objetivo, que no esté, ya se cumple). */
  private async borrarSiExiste(abs: string): Promise<void> {
    try {
      await fs.unlink(abs)
    } catch (err) {
      if (!esEnoent(err)) throw err
    }
  }
}

/** La clase de una entrada; la clasificación las trae todas, y si faltara una no se toca. */
function claseDe(clases: Map<string, Clasificacion>, e: EntradaRepo): Clasificacion {
  return clases.get(e.rutaRepo) ?? { rechazo: gitNoResponde() }
}

/** ¿La clasificación lleva a BORRAR del disco? */
function esBorrado(clase: Clasificacion): clase is 'borrar' | 'borrar-indexado' {
  return clase === 'borrar' || clase === 'borrar-indexado'
}

/** ¿Lo que se aprobó (revertir o borrar) es lo que la clase de ahora haría? */
function mismaAccion(ahora: ClaseDescarte, aprobada: ClaseDescarte): boolean {
  return ahora === aprobada || (esBorrado(ahora) && esBorrado(aprobada))
}

/** Lo que el lote haría con una ruta, según la clasificación de antes del diálogo. */
interface Plan {
  e: EntradaRepo
  clase: ClaseDescarte
}

/** Resultado de error de una entrada del lote. */
function errorDe(e: EntradaRepo, error: string): ResultadoDescarte {
  return { ruta: e.rel, estado: 'error', error }
}
