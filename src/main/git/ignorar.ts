// =============================================================================
// Ignorar archivos: añade patrones a `.gitignore` (se commitea) o a `.git/info/exclude` (solo esta
// máquina). Ignorar NO saca de la lista a lo que git ya rastrea: se clasifica ANTES de escribir y
// lo rastreado va a `omitidos`. Escribe un archivo del repo, bajo el candado del repo.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import type { ResultadoIgnorar } from '../../shared/git-ipc'
import { FS, errMessage, isEnoent } from './errores'
import { agruparPorRepo, pathspecDe, trocearPathspecs } from './lotes'
import type { NucleoGit } from './NucleoGit'
import { anexarPatrones, construirPatrones, patronesQueFaltan } from './patronesIgnore'
import type { EntradaRepo, GrupoRepo, RepoCtx } from './tipos'

/** Las dos acciones de «ignorar». */
export class Ignorar {
  private readonly n: NucleoGit

  constructor(n: NucleoGit) {
    this.n = n
  }

  /** Añade patrones al `.gitignore` de la RAÍZ DEL REPO: se commitea y vale para todo el equipo. */
  async ignorarEnGitignore(paths: readonly string[]): Promise<ResultadoIgnorar> {
    return this.ignorarEn(paths, (ctx) => path.join(ctx.root, '.gitignore'))
  }

  /**
   * Añade patrones a `.git/info/exclude`: mismo efecto, pero dentro de `.git/`, así que nunca se
   * sube. Ese archivo puede no existir en repos clonados con plantillas mínimas: se crea con su directorio.
   */
  async ignorarEnExcludeLocal(paths: readonly string[]): Promise<ResultadoIgnorar> {
    return this.ignorarEn(paths, (ctx) => path.join(ctx.root, '.git', 'info', 'exclude'))
  }

  /**
   * Motor de las dos acciones; solo cambia el archivo de destino. Se descartó ofrecer `git rm
   * --cached` para sacar lo rastreado: modificaría el repo y el equipo lo vería como borrado.
   */
  private async ignorarEn(
    paths: readonly string[],
    archivoDe: (ctx: RepoCtx) => string
  ): Promise<ResultadoIgnorar> {
    const { grupos, invalidas } = await agruparPorRepo(this.n, paths)
    const resultado: ResultadoIgnorar = { patrones: [], ignorados: [], omitidos: [] }
    if (invalidas.length > 0) resultado.error = invalidas[0].error
    if (grupos.length === 0) return resultado

    // Bajo el candado del repo: un `git add` concurrente no debe colarse entre clasificar y escribir.
    const porGrupo = await Promise.all(
      grupos.map((g) => this.n.writeLock.runExclusive(g.ctx.root, () => this.ignorarGrupo(g, archivoDe)))
    )
    for (const p of porGrupo) {
      resultado.patrones.push(...p.patrones)
      resultado.ignorados.push(...p.ignorados)
      resultado.omitidos.push(...p.omitidos)
      if (p.error && !resultado.error) resultado.error = p.error
    }
    return resultado
  }

  /** El trabajo de UN repo, ya bajo su candado: clasifica lo rastreado, calcula los patrones y escribe. */
  private async ignorarGrupo(
    g: GrupoRepo,
    archivoDe: (ctx: RepoCtx) => string
  ): Promise<ResultadoIgnorar> {
    const parcial: ResultadoIgnorar = { patrones: [], ignorados: [], omitidos: [] }
    const trackeadas = new Set<string>()
    for (const trozo of trocearPathspecs(g.entradas)) {
      try {
        const { stdout } = await this.n.git(['ls-files', '-z', '--', ...trozo.map(pathspecDe)], g.ctx)
        for (const p of stdout.split(FS)) if (p !== '') trackeadas.add(p)
      } catch {
        // Sin listado no se sabe qué rastrea git: se sigue como si nada lo estuviera (el patrón sobra, no rompe).
      }
    }
    const nuevas = g.entradas.filter((e) => !trackeadas.has(e.repoPath))
    for (const e of g.entradas) {
      if (trackeadas.has(e.repoPath)) parcial.omitidos.push(e.rel)
    }
    if (nuevas.length === 0) return parcial

    const patrones = construirPatrones(
      nuevas.map((e) => e.repoPath),
      await this.universoBajo(g.ctx, nuevas)
    )
    const destino = archivoDe(g.ctx)
    try {
      let previo = ''
      try {
        previo = await fs.readFile(destino, 'utf8')
      } catch (err) {
        if (!isEnoent(err)) throw err
        await fs.mkdir(path.dirname(destino), { recursive: true })
      }
      const faltan = patronesQueFaltan(previo, patrones)
      if (faltan.length > 0) await fs.writeFile(destino, anexarPatrones(previo, faltan), 'utf8')
      parcial.patrones.push(...faltan)
      parcial.ignorados.push(...nuevas.map((e) => e.rel))
    } catch (err) {
      parcial.error = errMessage(err)
    }
    return parcial
  }

  /**
   * TODO lo que existe bajo las carpetas que tocan `entradas`, rastreado o no: el universo con el
   * que `construirPatrones` decide si una carpeta está ENTERA. Tiene que venir de git (`ls-files
   * --cached --others --exclude-standard`, un spawn por trozo) y no de lo que la interfaz tenga a la
   * vista. Se acota a los primeros segmentos. Si el listado falla devuelve `null` («no se sabe»):
   * no se colapsa, que ignora de menos en vez de ignorar de más.
   */
  private async universoBajo(ctx: RepoCtx, entradas: readonly EntradaRepo[]): Promise<string[] | null> {
    const raices = new Set<string>()
    for (const e of entradas) {
      const seg = e.repoPath.split('/')[0]
      if (seg !== '') raices.add(seg)
    }
    if (raices.size === 0) return null
    const universo: string[] = []
    for (const trozo of trocearPathspecs([...raices].map((rel) => ({ rel, repoPath: rel })))) {
      try {
        const { stdout } = await this.n.git(
          ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...trozo.map(pathspecDe)],
          ctx
        )
        for (const p of stdout.split(FS)) if (p !== '') universo.push(p)
      } catch {
        return null
      }
    }
    return universo
  }
}
