#!/usr/bin/env node
// =============================================================================
// Prueba de los lotes de ServicioGit (npm run test:git-lote) en repos temporales: UN lote = UNA
// confirmación, antes de tocar nada; cancelar no revierte ni borra; una ruta vacía no toca nada (`checkout HEAD --
// :/` arrasaría el repo); `-z` con acentos y espacios; multi-repo con una ruta mala que no tumba
// al resto; 300 rutas troceadas; e ignorar (carpeta entera a una línea, lo rastreado se omite,
// repetir no duplica); una carpeta o un git que no contesta no borran nada, y los rechazos del
// descarte singular (conflicto, borrado preparado, ref dañada) y del preparar valen en lote;
// nada se toca antes del diálogo y todo se re-clasifica tras él.
// =============================================================================

import '../../../scripts/pruebas/temporal-hooks-git.mts'
import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
  statSync
} from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { ResultadoDescarte } from '../../shared/git-ipc.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`.
const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs))
const { ServicioGit } = await import('./ServicioGit.ts')
const { relDeArchivo } = await import('./rutasRepo.ts')

/** Hace fallar en `svc` los subcomandos de git dados, como si git no contestara (techo de la cola, `index.lock`). */
function fallarSubcomandos(svc: InstanceType<typeof ServicioGit>, subcomandos: readonly string[]): void {
  type Git = (args: string[], ...resto: unknown[]) => Promise<{ stdout: string; stderr: string }>
  const nucleo = (svc as unknown as { n: { git: Git } }).n
  const original = nucleo.git.bind(nucleo)
  nucleo.git = async (args, ...resto) => {
    if (subcomandos.includes(args[0] ?? '')) throw new Error(`simulado: git ${args[0]} no respondió`)
    return original(args, ...resto)
  }
}

// -----------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const temporales: string[] = []

/** Repo desechable con `archivos` ya commiteados. */
function nuevoRepo(prefijo: string, archivos: Record<string, string>): string {
  const repo = realpathSync(crearCarpetaTemporal(path.join(os.tmpdir(), `tessera-${prefijo}-`)))
  temporales.push(repo)
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'commit.gpgsign', 'false'])
  for (const [rel, contenido] of Object.entries(archivos)) escribir(repo, rel, contenido)
  if (Object.keys(archivos).length > 0) {
    git(['add', '-A'])
    git(['commit', '-m', 'base'])
  }
  return repo
}

function escribir(raiz: string, rel: string, contenido: string): void {
  const abs = path.join(raiz, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, contenido, 'utf8')
}

function leerEstadoDe(repo: string): string[] {
  const salida = execFileSync('git', ['status', '--porcelain', '-z'], {
    cwd: repo,
    encoding: 'utf8'
  })
  return salida
    .split('\0')
    .filter((l) => l !== '')
    .map((l) => l.slice(3))
}

function nuevoServicio(
  raiz: string,
  opciones: { contenedora?: string; confirmar?: (aBorrar: string[], aRevertir: string[]) => Promise<boolean> } = {}
): InstanceType<typeof ServicioGit> {
  const g = new ServicioGit({
    raizProyecto: raiz,
    log: () => {},
    confirmarDescarteVarios: opciones.confirmar ?? (async () => true)
  })
  g.fijarRaizProyecto(raiz, opciones.contenedora ?? raiz)
  return g
}

/** Lo que ve preparado el índice de `repo` (`diff --cached --name-status`), para comparar antes y después. */
function preparadosDe(repo: string): string {
  return execFileSync('git', ['diff', '--cached', '--name-status'], { cwd: repo, encoding: 'utf8' })
}

/**
 * (20-24) Los mismos agujeros que el singular, en lote: carpeta donde HEAD tiene un archivo,
 * conflicto, borrado ya preparado, carpeta sin seguimiento y preparar o quitar una carpeta.
 */
async function lotesQuePerdianDatos(): Promise<void> {
  hr('20) LOTE: carpeta donde HEAD tiene el archivo -> error, el trabajo de dentro intacto')
  {
    const repo = nuevoRepo('lote-dirsobre', { x: 'v1\n', 'uno.txt': 'uno\n' })
    rmSync(path.join(repo, 'x'))
    escribir(repo, 'x/trabajo.txt', 'IMPORTANTE\n')
    escribir(repo, 'uno.txt', 'CAMBIADO\n')
    const res = await nuevoServicio(repo).descartarCambiosVarios(['x', 'uno.txt'])
    const porRuta = new Map(res.map((r) => [r.ruta, r]))
    check(
      '(20) "x" sale en error «carpeta», x/trabajo.txt sigue y uno.txt se revierte',
      porRuta.get('x')?.estado === 'error' &&
        /carpeta/i.test(porRuta.get('x')?.error ?? '') &&
        existsSync(path.join(repo, 'x', 'trabajo.txt')) &&
        porRuta.get('uno.txt')?.estado === 'revertido',
      JSON.stringify(res)
    )
  }

  hr('21) LOTE: archivo en conflicto -> error, ni se confirma ni se revierte')
  {
    const repo = nuevoRepo('lote-conflicto', { 'c.txt': 'base\n' })
    const cli = (args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
    cli(['checkout', '-q', '-b', 'otra'])
    escribir(repo, 'c.txt', 'otra\n')
    cli(['commit', '-q', '-am', 'otra'])
    cli(['checkout', '-q', 'main'])
    escribir(repo, 'c.txt', 'main\n')
    cli(['commit', '-q', '-am', 'main'])
    try {
      cli(['merge', 'otra'])
    } catch {
      // el conflicto es lo que se busca
    }
    escribir(repo, 'c.txt', 'RESOLUCION A MEDIAS\n')
    let nombres: string[] = []
    const res = await nuevoServicio(repo, {
      confirmar: async (n) => {
        nombres = n
        return true
      }
    }).descartarCambiosVarios(['c.txt'])
    check(
      '(21) c.txt en error «conflicto», sin confirmar, resolución y etapas intactas',
      res.length === 1 &&
        res[0].estado === 'error' &&
        /conflicto/i.test(res[0].error ?? '') &&
        nombres.length === 0 &&
        readFileSync(path.join(repo, 'c.txt'), 'utf8') === 'RESOLUCION A MEDIAS\n' &&
        cli(['ls-files', '-s', '--', 'c.txt']).trim().split(/\r?\n/).length === 3,
      `nombres=${JSON.stringify(nombres)} ${JSON.stringify(res)}`
    )
  }

  hr('22) LOTE: borrados ya preparados -> se restauran; con cambios en disco, error y el disco intacto')
  {
    const repo = nuevoRepo('lote-rmprep', { 'd.txt': 'v1\n', 'k.txt': 'v1\n', 'm.txt': 'v1\n' })
    const cli = (args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
    cli(['rm', '-q', 'd.txt'])
    cli(['rm', '-q', '--cached', 'k.txt', 'm.txt'])
    escribir(repo, 'm.txt', 'v1 + TRABAJO\n')
    let nombres: string[] = []
    const res = await nuevoServicio(repo, {
      confirmar: async (n) => {
        nombres = n
        return true
      }
    }).descartarCambiosVarios(['d.txt', 'k.txt', 'm.txt'])
    const porRuta = new Map(res.map((r) => [r.ruta, r]))
    check(
      '(22a) d.txt y k.txt se REVIERTEN (no se borran) y no entran en la confirmación',
      porRuta.get('d.txt')?.estado === 'revertido' &&
        porRuta.get('k.txt')?.estado === 'revertido' &&
        existsSync(path.join(repo, 'd.txt')) &&
        existsSync(path.join(repo, 'k.txt')) &&
        nombres.length === 0,
      `nombres=${JSON.stringify(nombres)} ${JSON.stringify(res)}`
    )
    check(
      '(22b) m.txt (cambios en disco) sale en error y conserva el trabajo',
      porRuta.get('m.txt')?.estado === 'error' &&
        existsSync(path.join(repo, 'm.txt')) &&
        readFileSync(path.join(repo, 'm.txt'), 'utf8') === 'v1 + TRABAJO\n',
      JSON.stringify(porRuta.get('m.txt'))
    )
  }

  hr('23) LOTE: carpeta SIN SEGUIMIENTO -> «Es una carpeta…» antes de confirmar, intacta')
  {
    const repo = nuevoRepo('lote-suelta', { 'uno.txt': 'uno\n' })
    escribir(repo, 'suelta/n.txt', 'suelto\n')
    let nombres: string[] = []
    const res = await nuevoServicio(repo, {
      confirmar: async (n) => {
        nombres = n
        return true
      }
    }).descartarCambiosVarios(['suelta'])
    check(
      '(23) "suelta" en error «carpeta», fuera del diálogo y con su contenido',
      res.length === 1 &&
        res[0].estado === 'error' &&
        /carpeta/i.test(res[0].error ?? '') &&
        nombres.length === 0 &&
        existsSync(path.join(repo, 'suelta', 'n.txt')),
      `nombres=${JSON.stringify(nombres)} ${JSON.stringify(res)}`
    )
  }

  hr('24) LOTE: preparar o quitar una CARPETA sin barra -> error por ruta, el resto sí')
  {
    const repo = nuevoRepo('lote-stage-carpeta', { 'sub/a.txt': 'a\n', 'uno.txt': 'uno\n' })
    escribir(repo, 'sub/b.txt', 'b\n')
    escribir(repo, 'sub/a.txt', 'A!\n')
    escribir(repo, 'uno.txt', 'UNO!\n')
    const git = nuevoServicio(repo)
    const antes = preparadosDe(repo)
    const res = await git.prepararArchivos(['sub', 'uno.txt'])
    const porRuta = new Map(res.map((r) => [r.ruta, r]))
    const despues = preparadosDe(repo)
    check(
      '(24a) prepararArchivos(["sub","uno.txt"]) -> sub en error «carpeta», uno.txt preparado, nada de sub/',
      porRuta.get('sub')?.ok === false &&
        /carpeta/i.test(porRuta.get('sub')?.error ?? '') &&
        porRuta.get('uno.txt')?.ok === true &&
        !despues.includes('sub/') &&
        despues.includes('uno.txt') &&
        antes === '',
      `${JSON.stringify(res)} preparados=${JSON.stringify(despues)}`
    )
    execFileSync('git', ['add', '--', 'sub/a.txt', 'sub/b.txt'], { cwd: repo })
    const conSub = preparadosDe(repo)
    const res2 = await git.quitarArchivosDelIndice(['sub'])
    check(
      '(24b) quitarArchivosDelIndice(["sub"]) -> error «carpeta», sub/ sigue preparado',
      res2.length === 1 && res2[0].ok === false && /carpeta/i.test(res2[0].error ?? '') && preparadosDe(repo) === conSub,
      `${JSON.stringify(res2)} preparados=${JSON.stringify(preparadosDe(repo))}`
    )
  }

  hr('25) LOTE: la ref de la rama con basura NO es «repo sin commits» -> error, nada borrado')
  {
    const repo = nuevoRepo('lote-refrota', { 'a.txt': 'v1\n' })
    writeFileSync(path.join(repo, '.git', 'refs', 'heads', 'main'), 'zzzz\n')
    let llamadas = 0
    const res = await nuevoServicio(repo, {
      confirmar: async () => {
        llamadas++
        return true
      }
    }).descartarCambiosVarios(['a.txt'])
    check(
      '(25) a.txt en error, sin confirmar, sigue en disco y en el índice',
      res.length === 1 &&
        res[0].estado === 'error' &&
        llamadas === 0 &&
        existsSync(path.join(repo, 'a.txt')) &&
        execFileSync('git', ['ls-files', '--', 'a.txt'], { cwd: repo, encoding: 'utf8' }).trim() === 'a.txt',
      `llamadas=${llamadas} ${JSON.stringify(res)}`
    )
  }
}


/**
 * (26-28) La copia de un borrado preparado se compara por bytes también en lote (y en tandas),
 * nada se toca antes del diálogo, y lo que se iba a revertir o borrar se re-clasifica después.
 */
async function lotesDeLaCopiaYElDialogo(): Promise<void> {
  hr('26) LOTE: borrados preparados en tanda; un filtro clean con pérdida no esconde trabajo')
  {
    const archivos: Record<string, string> = { '.gitattributes': '*.nb filter=strip\n', 'c.nb': 'celda\n' }
    for (let i = 0; i < 300; i++) archivos[`d/f${i}.txt`] = `contenido ${i}\n`
    const repo = nuevoRepo('lote-filtro', archivos)
    const cli = (args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
    cli(['config', 'filter.strip.clean', "sed -e '/^OUT/d'"])
    cli(['config', 'filter.strip.smudge', 'cat'])
    escribir(repo, 'c.nb', 'celda\nOUT resultado\n')
    cli(['rm', '-q', '-r', '--cached', 'd', 'c.nb'])
    let llamadas = 0
    let listados: string[] = []
    const rutas = ['c.nb', ...Array.from({ length: 300 }, (_, i) => `d/f${i}.txt`)]
    const res = await nuevoServicio(repo, {
      confirmar: async (aBorrar, aRevertir) => {
        llamadas++
        listados = [...aBorrar, ...aRevertir]
        return true
      }
    }).descartarCambiosVarios(rutas)
    const porRuta = new Map(res.map((r) => [r.ruta, r]))
    check(
      '(26a) c.nb (líneas que el filtro esconde) en error, fuera del diálogo, las líneas siguen en disco',
      porRuta.get('c.nb')?.estado === 'error' &&
        llamadas === 1 &&
        !listados.includes('c.nb') &&
        readFileSync(path.join(repo, 'c.nb'), 'utf8') === 'celda\nOUT resultado\n',
      `${JSON.stringify(porRuta.get('c.nb'))} llamadas=${llamadas}`
    )
    const revertidos = res.filter((r) => r.ruta.startsWith('d/') && r.estado === 'revertido').length
    check('(26b) las 300 copias iguales a HEAD vuelven al índice', revertidos === 300 && cli(['ls-files', 'd']).split('\n').filter(Boolean).length === 300, `revertidos=${revertidos}`)
  }

  hr('27) LOTE: nada se revierte antes del diálogo; lo que cambie durante él no se pisa')
  {
    // `x` borrado del disco (se revertiría) + `nuevo.txt` sin seguimiento. Durante el diálogo,
    // sin candado, otro proceso pone `x/trabajo.txt`; primero el usuario cancela y luego aprueba.
    const repo = nuevoRepo('lote-dialogo', { x: 'v1\n' })
    rmSync(path.join(repo, 'x'))
    escribir(repo, 'nuevo.txt', 'n\n')
    let xAlAbrir = 'sin preguntar'
    const res = await nuevoServicio(repo, {
      confirmar: async () => {
        const abs = path.join(repo, 'x')
        xAlAbrir = existsSync(abs) ? (statSync(abs).isDirectory() ? 'carpeta' : 'archivo') : 'nada'
        return false
      }
    }).descartarCambiosVarios(['x', 'nuevo.txt'])
    const porRuta = new Map(res.map((r) => [r.ruta, r]))
    check(
      '(27a) al abrir el diálogo x sigue sin restaurar, y cancelar lo deja así',
      xAlAbrir === 'nada' && porRuta.get('x')?.estado === 'cancelado' && !existsSync(path.join(repo, 'x')),
      `xAlAbrir=${xAlAbrir} ${JSON.stringify(res)}`
    )
    check(
      '(27b) cancelar no borra nuevo.txt',
      porRuta.get('nuevo.txt')?.estado === 'cancelado' && existsSync(path.join(repo, 'nuevo.txt')),
      JSON.stringify(porRuta.get('nuevo.txt'))
    )
    const aprobado = await nuevoServicio(repo, {
      confirmar: async () => {
        escribir(repo, 'x/trabajo.txt', 'IMPORTANTE\n')
        return true
      }
    }).descartarCambiosVarios(['x'])
    check(
      '(27c) aprobado, pero x pasó a ser una carpeta durante el diálogo: error y x/trabajo.txt intacto',
      aprobado.length === 1 &&
        aprobado[0].estado === 'error' &&
        readFileSync(path.join(repo, 'x', 'trabajo.txt'), 'utf8') === 'IMPORTANTE\n',
      JSON.stringify(aprobado)
    )
  }

  hr('28) LOTE: lo que se iba a borrar y se commitea durante el diálogo ya no se borra')
  {
    const repo = nuevoRepo('lote-commit-dialogo', { 'base.txt': 'b\n' })
    escribir(repo, 'nuevo.txt', 'TRABAJO\n')
    const cli = (args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
    const res = await nuevoServicio(repo, {
      confirmar: async () => {
        cli(['add', '--', 'nuevo.txt'])
        cli(['commit', '-q', '-m', 'durante el diálogo'])
        return true
      }
    }).descartarCambiosVarios(['nuevo.txt'])
    check(
      '(28) nuevo.txt sale en error («cambió de estado», que el usuario ve) y sigue en disco',
      res.length === 1 &&
        res[0].estado === 'error' &&
        /cambió de estado/.test(res[0].error ?? '') &&
        readFileSync(path.join(repo, 'nuevo.txt'), 'utf8') === 'TRABAJO\n',
      JSON.stringify(res)
    )
  }
}

async function main(): Promise<void> {
  try {
    // -------------------------------------------------------------------------
    hr('1) STAGE en lote: 3 archivos en UNA llamada')
    {
      const repo = nuevoRepo('lote-stage', { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' })
      escribir(repo, 'a.txt', 'A!\n')
      escribir(repo, 'b.txt', 'B!\n')
      escribir(repo, 'nuevo.txt', 'nuevo\n')
      const git = nuevoServicio(repo)

      const res = await git.prepararArchivos(['a.txt', 'b.txt', 'nuevo.txt'])
      check(
        '(1a) los 3 vuelven ok',
        res.length === 3 && res.every((r) => r.ok),
        JSON.stringify(res)
      )
      const estado = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: repo,
        encoding: 'utf8'
      })
        .split('\n')
        .filter((l) => l !== '')
        .sort()
      check(
        '(1b) los 3 están en el ÍNDICE',
        estado.join(',') === 'a.txt,b.txt,nuevo.txt',
        estado.join(',')
      )

      const quitados = await git.quitarArchivosDelIndice(['a.txt', 'b.txt', 'nuevo.txt'])
      const trasQuitar = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: repo,
        encoding: 'utf8'
      }).trim()
      check(
        '(1c) quitarArchivosDelIndice los saca del índice',
        quitados.every((r) => r.ok) && trasQuitar === '',
        `staged tras quitar: ${JSON.stringify(trasQuitar)}`
      )
    }

    // -------------------------------------------------------------------------
    hr('2) GUARDA DE RUTA VACÍA (el riesgo nº1)')
    {
      const repo = nuevoRepo('lote-vacia', { 'x.txt': 'x\n', 'y.txt': 'y\n' })
      escribir(repo, 'x.txt', 'MODIFICADO\n')
      escribir(repo, 'y.txt', 'TAMBIEN\n')
      const git = nuevoServicio(repo)

      const res = await git.descartarCambiosVarios([''])
      check(
        '(2a) una ruta VACÍA se rechaza, no se ejecuta',
        res.length === 1 && res[0].estado === 'error',
        JSON.stringify(res)
      )
      check(
        '(2b) y NADA se descartó: los dos archivos siguen modificados',
        readFileSync(path.join(repo, 'x.txt'), 'utf8') === 'MODIFICADO\n' &&
          readFileSync(path.join(repo, 'y.txt'), 'utf8') === 'TAMBIEN\n',
        leerEstadoDe(repo).join(',')
      )
      const vacio = await git.prepararArchivos([])
      check('(2c) lista vacía -> no-op', vacio.length === 0, JSON.stringify(vacio))
      const traversal = await git.descartarCambiosVarios(['../fuera.txt'])
      check(
        '(2d) una ruta con ".." se rechaza',
        traversal.length === 1 && traversal[0].estado === 'error',
        JSON.stringify(traversal)
      )
    }

    // -------------------------------------------------------------------------
    hr('3) DESCARTE en lote: UNA sola confirmación')
    {
      const repo = nuevoRepo('lote-descarte', { 'uno.txt': 'uno\n', 'dos.txt': 'dos\n' })
      escribir(repo, 'uno.txt', 'CAMBIADO\n')
      escribir(repo, 'dos.txt', 'CAMBIADO\n')
      escribir(repo, 'nuevo.txt', 'sin git\n')
      let llamadas = 0
      let nombresVistos: string[] = []
      let revertirVistos: string[] = []
      let intactoAlPreguntar = false
      const git = nuevoServicio(repo, {
        confirmar: async (nombres, revertir) => {
          llamadas++
          nombresVistos = nombres
          // `?? []`: así la mutación (un servicio que no pase la lista) falla en el check, no en un TypeError.
          revertirVistos = revertir ?? []
          intactoAlPreguntar =
            readFileSync(path.join(repo, 'uno.txt'), 'utf8') === 'CAMBIADO\n' &&
            readFileSync(path.join(repo, 'dos.txt'), 'utf8') === 'CAMBIADO\n' &&
            existsSync(path.join(repo, 'nuevo.txt'))
          return true
        }
      })

      const res = await git.descartarCambiosVarios(['uno.txt', 'dos.txt', 'nuevo.txt'])
      check('(3a) EXACTAMENTE 1 confirmación para 3 archivos', llamadas === 1, `llamadas=${llamadas}`)
      check(
        '(3b) la confirmación lista aparte lo que se borra y lo que vuelve a HEAD',
        nombresVistos.join(',') === 'nuevo.txt' && [...revertirVistos].sort().join(',') === 'dos.txt,uno.txt',
        `borrar=${nombresVistos.join(',')} revertir=${revertirVistos.join(',')}`
      )
      check('(3b-bis) al preguntar, nada se ha tocado todavía', intactoAlPreguntar, String(intactoAlPreguntar))
      const porRuta = new Map(res.map((r) => [r.ruta, r.estado]))
      check(
        '(3c) los 2 trackeados salen "revertido" y el nuevo "borrado"',
        porRuta.get('uno.txt') === 'revertido' &&
          porRuta.get('dos.txt') === 'revertido' &&
          porRuta.get('nuevo.txt') === 'borrado',
        JSON.stringify(res)
      )
      check(
        '(3d) el working-tree quedó limpio',
        leerEstadoDe(repo).length === 0 && !existsSync(path.join(repo, 'nuevo.txt')),
        leerEstadoDe(repo).join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('3b) DESCARTE en lote de un nombre con CORCHETES: no toca al vecino que el glob casaría')
    {
      const repo = nuevoRepo('lote-glob', { 'r1.txt': 'uno\n', 'r[1].txt': 'dos\n' })
      escribir(repo, 'r1.txt', 'CAMBIADO\n')
      escribir(repo, 'r[1].txt', 'CAMBIADO\n')
      const git = nuevoServicio(repo)
      const res = await git.descartarCambiosVarios(['r[1].txt'])
      check('(3b-a) r[1].txt sale "revertido"', res.length === 1 && res[0].estado === 'revertido', JSON.stringify(res))
      check('(3b-b) r1.txt sigue modificado', leerEstadoDe(repo).join(',') === 'r1.txt', leerEstadoDe(repo).join(','))
    }

    // -------------------------------------------------------------------------
    hr('4) CANCELAR: no revierte ni borra nada')
    {
      const repo = nuevoRepo('lote-cancelar', { 'uno.txt': 'uno\n' })
      escribir(repo, 'uno.txt', 'CAMBIADO\n')
      escribir(repo, 'nuevo.txt', 'sin git\n')
      const git = nuevoServicio(repo, { confirmar: async () => false })

      const res: ResultadoDescarte[] = await git.descartarCambiosVarios(['uno.txt', 'nuevo.txt'])
      const porRuta = new Map(res.map((r) => [r.ruta, r.estado]))
      check(
        '(4a) el que volvería a HEAD sale "cancelado" y conserva sus cambios',
        porRuta.get('uno.txt') === 'cancelado' &&
          readFileSync(path.join(repo, 'uno.txt'), 'utf8') === 'CAMBIADO\n',
        JSON.stringify(res)
      )
      check(
        '(4b) el nuevo vuelve "cancelado" y SIGUE en disco',
        porRuta.get('nuevo.txt') === 'cancelado' && existsSync(path.join(repo, 'nuevo.txt')),
        JSON.stringify(res)
      )
    }

    // -------------------------------------------------------------------------
    hr('5) ACENTOS y ESPACIOS (esto es lo que valida el -z)')
    {
      const repo = nuevoRepo('lote-acentos', {
        'año.txt': 'anio\n',
        'con espacio.txt': 'esp\n'
      })
      escribir(repo, 'año.txt', 'CAMBIADO\n')
      escribir(repo, 'con espacio.txt', 'CAMBIADO\n')
      escribir(repo, 'ñandú nuevo.txt', 'nuevo\n')
      const git = nuevoServicio(repo)

      const res = await git.descartarCambiosVarios(['año.txt', 'con espacio.txt', 'ñandú nuevo.txt'])
      const porRuta = new Map(res.map((r) => [r.ruta, r.estado]))
      check(
        '(5a) los acentuados se CLASIFICAN bien (revertido, no borrado)',
        porRuta.get('año.txt') === 'revertido' && porRuta.get('con espacio.txt') === 'revertido',
        JSON.stringify(res)
      )
      check(
        '(5b) y el untracked acentuado se borra',
        porRuta.get('ñandú nuevo.txt') === 'borrado' &&
          !existsSync(path.join(repo, 'ñandú nuevo.txt')),
        JSON.stringify(res)
      )
      check(
        '(5c) el working-tree quedó limpio',
        leerEstadoDe(repo).length === 0,
        leerEstadoDe(repo).join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('6) MULTI-REPO en una sola llamada + ruta sin repo')
    {
      const contenedora = realpathSync(crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-lote-multi-')))
      temporales.push(contenedora)
      const repoInterfaz = path.join(contenedora, 'front')
      const repoServidor = path.join(contenedora, 'back')
      for (const [dir, nombre] of [
        [repoInterfaz, 'front'],
        [repoServidor, 'back']
      ] as const) {
        mkdirSync(dir, { recursive: true })
        const git = (args: string[]): string =>
          execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env } })
        git(['init', '-b', 'main'])
        git(['config', 'user.name', 'Fixture Bot'])
        git(['config', 'user.email', 'fixture@example.com'])
        git(['config', 'commit.gpgsign', 'false'])
        writeFileSync(path.join(dir, `${nombre}.txt`), 'original\n', 'utf8')
        git(['add', '-A'])
        git(['commit', '-m', 'base'])
        writeFileSync(path.join(dir, `${nombre}.txt`), 'MODIFICADO\n', 'utf8')
      }
      const git = nuevoServicio(contenedora, { contenedora })

      const res = await git.prepararArchivos(['front/front.txt', 'back/back.txt'])
      check(
        '(6a) un lote que cruza DOS repos prepara en los dos',
        res.length === 2 && res.every((r) => r.ok),
        JSON.stringify(res)
      )
      const preparados = (dir: string): string =>
        execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim()
      check(
        '(6b) cada archivo quedó en el índice de SU repo',
        preparados(repoInterfaz) === 'front.txt' && preparados(repoServidor) === 'back.txt',
        `front=${preparados(repoInterfaz)} back=${preparados(repoServidor)}`
      )
    }

    // -------------------------------------------------------------------------
    hr('7) TROCEADO: 300 rutas')
    {
      const archivos: Record<string, string> = {}
      for (let i = 0; i < 300; i++) {
        archivos[`carpeta-con-nombre-bastante-largo/archivo-${String(i).padStart(4, '0')}.txt`] =
          'v1\n'
      }
      const repo = nuevoRepo('lote-troceo', archivos)
      const rutas = Object.keys(archivos)
      for (const rel of rutas) escribir(repo, rel, 'v2\n')
      const git = nuevoServicio(repo)

      const res = await git.prepararArchivos(rutas)
      const preparados = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: repo,
        encoding: 'utf8'
      })
        .split('\n')
        .filter((l) => l !== '')
      check(
        '(7a) las 300 se preparan (en varios procesos de git)',
        res.length === 300 && res.every((r) => r.ok) && preparados.length === 300,
        `resultados=${res.length} staged=${preparados.length}`
      )
    }

    // -------------------------------------------------------------------------
    hr('8) IGNORAR en .gitignore: carpeta entera -> UNA línea')
    {
      const repo = nuevoRepo('lote-ignore', { 'README.md': 'hola\n' })
      escribir(repo, '.idea/workspace.xml', '<x/>\n')
      escribir(repo, '.idea/modules.xml', '<x/>\n')
      escribir(repo, '.idea/inspection/perfil.xml', '<x/>\n')
      const git = nuevoServicio(repo)
      const rutas = ['.idea/workspace.xml', '.idea/modules.xml', '.idea/inspection/perfil.xml']

      check(
        '(8a) antes: git status ve los 3 (como .idea/)',
        leerEstadoDe(repo).some((p) => p.startsWith('.idea/')),
        leerEstadoDe(repo).join(',')
      )

      const res = await git.ignorarEnGitignore(rutas)
      check(
        '(8b) UNA sola línea, colapsada al ancestro más alto',
        res.patrones.join(',') === '/.idea/',
        JSON.stringify(res.patrones)
      )
      check('(8c) los 3 cuentan como ignorados, 0 omitidos', res.ignorados.length === 3 && res.omitidos.length === 0, JSON.stringify(res))
      check(
        '(8d) git status ya NO los ve',
        !leerEstadoDe(repo).some((p) => p.startsWith('.idea/')),
        leerEstadoDe(repo).join(',')
      )
      check(
        '(8e) y aparece .gitignore como archivo nuevo (hay que commitearlo)',
        leerEstadoDe(repo).includes('.gitignore'),
        leerEstadoDe(repo).join(',')
      )

      // Idempotencia: repetir no duplica.
      escribir(repo, '.idea/otro.xml', '<x/>\n')
      const res2 = await git.ignorarEnGitignore(['.idea/otro.xml'])
      const contenido = readFileSync(path.join(repo, '.gitignore'), 'utf8')
      check(
        '(8f) repetir NO duplica la línea',
        (contenido.match(/\/\.idea\//g) ?? []).length === 1,
        JSON.stringify(contenido)
      )
      check('(8g) y no añade patrones nuevos', res2.patrones.length === 0, JSON.stringify(res2))
    }

    // -------------------------------------------------------------------------
    hr('9) IGNORAR: un TRACKEADO se omite (ignorar no lo saca de git)')
    {
      const repo = nuevoRepo('lote-ignore-track', { 'seguido.txt': 'v1\n' })
      escribir(repo, 'seguido.txt', 'v2\n')
      escribir(repo, 'temporal.log', 'basura\n')
      const git = nuevoServicio(repo)

      const res = await git.ignorarEnGitignore(['seguido.txt', 'temporal.log'])
      check(
        '(9a) el rastreado va a omitidos y el nuevo a ignorados',
        res.omitidos.join(',') === 'seguido.txt' && res.ignorados.join(',') === 'temporal.log',
        JSON.stringify(res)
      )
      check(
        '(9b) no se escribe patrón para el rastreado',
        res.patrones.join(',') === '/temporal.log',
        JSON.stringify(res.patrones)
      )
      const estado = leerEstadoDe(repo)
      check(
        '(9c) el rastreado SIGUE en git status; el nuevo no',
        estado.includes('seguido.txt') && !estado.includes('temporal.log'),
        estado.join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('10) EXCLUSIÓN LOCAL: .git/info/exclude, sin ensuciar el working-tree')
    {
      const repo = nuevoRepo('lote-exclude', { 'README.md': 'hola\n' })
      escribir(repo, '.idea/workspace.xml', '<x/>\n')
      escribir(repo, '.idea/modules.xml', '<x/>\n')
      const git = nuevoServicio(repo)

      const res = await git.ignorarEnExclusionLocal(['.idea/workspace.xml', '.idea/modules.xml'])
      check('(10a) una sola línea /.idea/', res.patrones.join(',') === '/.idea/', JSON.stringify(res.patrones))
      const exclusiones = readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')
      check('(10b) la línea está en .git/info/exclude', exclusiones.includes('/.idea/'), JSON.stringify(exclusiones.slice(-40)))
      check(
        '(10c) git status queda LIMPIO (no aparece ningún archivo nuevo)',
        leerEstadoDe(repo).length === 0,
        leerEstadoDe(repo).join(',')
      )
      check(
        '(10d) el archivo conservó su contenido previo (solo se ANEXA)',
        exclusiones.split('\n').length > 2 && !exclusiones.startsWith('/.idea/'),
        JSON.stringify(exclusiones.split('\n').slice(0, 2))
      )
    }

    // -------------------------------------------------------------------------
    hr('11) IGNORAR: carpeta a MEDIAS no se colapsa')
    {
      const repo = nuevoRepo('lote-ignore-medias', { 'README.md': 'hola\n' })
      escribir(repo, 'tmp/uno.log', 'a\n')
      escribir(repo, 'tmp/dos.log', 'b\n')
      const git = nuevoServicio(repo)

      // Solo uno de los dos se MARCA, pero bajo tmp/ hay dos: la carpeta NO está
      // entera y no puede colapsarse (se llevaría por delante al otro).
      const res = await git.ignorarEnGitignore(['tmp/uno.log'])
      check(
        '(11a) una línea por archivo, sin colapsar la carpeta',
        res.patrones.join(',') === '/tmp/uno.log',
        JSON.stringify(res.patrones)
      )
      const estado = leerEstadoDe(repo)
      check(
        '(11b) el otro archivo de la carpeta SIGUE visible',
        estado.some((p) => p.startsWith('tmp/')),
        estado.join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('12) IGNORAR: una carpeta con archivos RASTREADOS no se colapsa')
    // -------------------------------------------------------------------------
    // EL FALLO QUE ESTA SECCIÓN FIJA. El universo lo mandaba el renderer con lo
    // que la lista tenía a la vista, y la sección "Sin versionar" NO contiene los
    // archivos que git ya rastrea. Con `src/` lleno de código commiteado, crear
    // `src/nuevo.tsx` y darle a "Agregar a .gitignore" escribía `/src/`: el
    // proyecto ENTERO invisible para git, en un archivo que además se commitea y
    // se lleva el equipo. Ahora el universo lo calcula el main con
    // `ls-files --cached --others`, así que ve los rastreados y no colapsa.
    {
      const repo = nuevoRepo('lote-ignore-trackeados', {
        'src/App.tsx': 'export const App = 1\n',
        'src/main.tsx': 'export const main = 2\n',
        'src/util.ts': 'export const u = 3\n'
      })
      escribir(repo, 'src/nuevo.tsx', 'export const nuevo = 4\n')
      const git = nuevoServicio(repo)

      const res = await git.ignorarEnGitignore(['src/nuevo.tsx'])
      check(
        '(12a) NO colapsa a /src/: una línea para el archivo',
        res.patrones.join(',') === '/src/nuevo.tsx',
        JSON.stringify(res.patrones)
      )
      const contenido = readFileSync(path.join(repo, '.gitignore'), 'utf8')
      check('(12b) el .gitignore no contiene /src/', !/^\/src\/$/m.test(contenido), JSON.stringify(contenido))
      // La comprobación que de verdad importa: que git siga viendo el resto.
      escribir(repo, 'src/otroNuevo.tsx', 'export const otro = 5\n')
      check(
        '(12c) un archivo nuevo bajo src/ NO queda ignorado',
        leerEstadoDe(repo).includes('src/otroNuevo.tsx'),
        leerEstadoDe(repo).join(',')
      )
      escribir(repo, 'src/App.tsx', 'export const App = 99\n')
      check(
        '(12d) y un rastreado modificado sigue apareciendo',
        leerEstadoDe(repo).includes('src/App.tsx'),
        leerEstadoDe(repo).join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('13) IGNORAR: nombre con METACARACTERES, escapado e idempotente')
    // -------------------------------------------------------------------------
    // `#temp.txt` escrito tal cual sería un COMENTARIO y no ignoraría nada: falla
    // en silencio, que es lo peor que puede hacer. Se comprueba de punta a punta
    // que git deja de verlo, y que repetir la acción no duplica la línea.
    // (El espacio FINAL escapado se prueba en test:patrones-ignorar, en puro:
    // Windows no admite nombres de archivo acabados en espacio.)
    {
      const repo = nuevoRepo('lote-ignore-meta', { 'README.md': 'hola\n' })
      escribir(repo, '#temp.txt', 'x\n')
      const git = nuevoServicio(repo)

      const r1 = await git.ignorarEnGitignore(['#temp.txt'])
      check('(13a) escapa la almohadilla', r1.patrones.join(',') === '/\\#temp.txt', JSON.stringify(r1.patrones))
      check(
        '(13b) git deja de ver el archivo (el escape SIRVE)',
        !leerEstadoDe(repo).includes('#temp.txt'),
        leerEstadoDe(repo).join(',')
      )
      const r2 = await git.ignorarEnGitignore(['#temp.txt'])
      check('(13c) repetir NO vuelve a anexar', r2.patrones.length === 0, JSON.stringify(r2.patrones))
      const contenido = readFileSync(path.join(repo, '.gitignore'), 'utf8')
      check(
        '(13d) la línea aparece UNA sola vez',
        (contenido.match(/\\#temp\.txt/g) ?? []).length === 1,
        JSON.stringify(contenido)
      )
    }

    // -------------------------------------------------------------------------
    hr('14) GUARDA DE RUTA VACÍA en los SINGULARES')
    // -------------------------------------------------------------------------
    // La guarda se añadió solo en el camino de lote. En los singulares, una ruta
    // que traduce a '' deja el pathspec en `:/`, que casa el REPO ENTERO:
    // `quitarArchivoDelIndice('')` corría `restore --staged -- :/` y vaciaba el índice.
    {
      const repo = nuevoRepo('singular-vacio', { 'a.txt': 'a\n', 'b.txt': 'b\n' })
      escribir(repo, 'a.txt', 'a2\n')
      escribir(repo, 'nuevo.txt', 'n\n')
      const git = nuevoServicio(repo)
      // Índice con algo dentro, para notar si se vacía.
      await git.prepararArchivo('a.txt')
      const indiceAntes = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: repo,
        encoding: 'utf8'
      }).trim()

      const rStage = await git.prepararArchivo('')
      check('(14a) prepararArchivo("") no es ok', rStage.ok === false, JSON.stringify(rStage))
      const rUnstage = await git.quitarArchivoDelIndice('')
      check('(14b) quitarArchivoDelIndice("") no es ok', rUnstage.ok === false, JSON.stringify(rUnstage))
      const resultadoDescarte = await git.descartarCambios('')
      check('(14c) descartarCambios("") no es ok', resultadoDescarte.ok === false, JSON.stringify(resultadoDescarte))

      const indiceDespues = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: repo,
        encoding: 'utf8'
      }).trim()
      check(
        '(14d) el ÍNDICE quedó intacto (no se vació con :/)',
        indiceDespues === indiceAntes && indiceAntes === 'a.txt',
        `antes=${indiceAntes} despues=${indiceDespues}`
      )
      const siguen = ['a.txt', 'b.txt', 'nuevo.txt'].filter((f) =>
        existsSync(path.join(repo, f))
      )
      check(
        '(14e) el working-tree quedó intacto (nada se borró)',
        siguen.length === 3,
        siguen.join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('15) TOPE DE LOTE: lo recortado se REPORTA, no se pierde en silencio')
    // -------------------------------------------------------------------------
    // Antes, las rutas que pasaban del tope se caían sin producir resultado: el
    // lote devolvía menos entradas de las pedidas, App no veía ningún fallo y la
    // UI daba por preparados archivos que nadie llegó a tocar.
    {
      const repo = nuevoRepo('lote-tope', { 'README.md': 'hola\n' })
      escribir(repo, 'uno.txt', '1\n')
      const git = nuevoServicio(repo)
      // El tope se llena REPITIENDO la misma ruta real: `agruparPorRepo` recorta
      // ANTES de deduplicar, así que se rebasa el límite sin crear 20 000
      // archivos en disco ni provocar 20 000 spawns de git. Las dos rutas que se
      // pasan del corte son las que hay que ver reportadas.
      const MAX_LOTE = 20000 // espejo de MAX_RUTAS_LOTE en ServicioGit
      const rutas = [
        ...Array.from({ length: MAX_LOTE }, () => 'uno.txt'),
        'sobrante-a.txt',
        'sobrante-b.txt'
      ]
      const res = await git.prepararArchivos(rutas)
      const recortadas = res.filter((r) => !r.ok && (r.error ?? '').includes('demasiados archivos'))
      check(
        '(15a) las 2 sobrantes se reportan como FALLO (no se pierden)',
        recortadas.length === 2 &&
          recortadas.map((r) => r.ruta).sort().join(',') === 'sobrante-a.txt,sobrante-b.txt',
        JSON.stringify(recortadas)
      )
      check(
        '(15b) la ruta que sí entró se preparó',
        res.find((r) => r.ruta === 'uno.txt')?.ok === true,
        JSON.stringify(res.find((r) => r.ruta === 'uno.txt'))
      )
      check(
        '(15c) no se inventan resultados de más (las repetidas se deduplican)',
        res.length === 3,
        `${res.length} resultados`
      )
    }

    // -------------------------------------------------------------------------
    hr('16) GIT QUE NO CONTESTA al clasificar: el grupo entero sale en error y NADA se borra')
    for (const [caso, subcomandos] of [
      ['ls-files', ['ls-files']],
      ['ls-tree con HEAD', ['ls-tree']]
    ] as const) {
      const repo = nuevoRepo('lote-sin-respuesta', { 'uno.txt': 'uno\n' })
      escribir(repo, 'uno.txt', 'TRABAJO\n')
      escribir(repo, 'nuevo.txt', 'sin git\n')
      let llamadas = 0
      const git = nuevoServicio(repo, {
        confirmar: async () => {
          llamadas++
          return true
        }
      })
      fallarSubcomandos(git, subcomandos)
      const res = await git.descartarCambiosVarios(['uno.txt', 'nuevo.txt'])
      check(
        `(16) ${caso}: las dos rutas salen en error y no se pide confirmación`,
        res.length === 2 && res.every((r) => r.estado === 'error') && llamadas === 0,
        `llamadas=${llamadas} ${JSON.stringify(res)}`
      )
      check(
        `(16) ${caso}: uno.txt conserva su trabajo y nuevo.txt sigue en disco`,
        readFileSync(path.join(repo, 'uno.txt'), 'utf8') === 'TRABAJO\n' && existsSync(path.join(repo, 'nuevo.txt')),
        leerEstadoDe(repo).join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('17) Repo SIN commits: `ls-tree HEAD` falla y eso es «nada en HEAD», no un error')
    {
      const repo = nuevoRepo('lote-sin-commits', {})
      escribir(repo, 'primero.txt', 'nuevo\n')
      execFileSync('git', ['add', '--', 'primero.txt'], { cwd: repo, encoding: 'utf8' })
      const git = nuevoServicio(repo)
      const res = await git.descartarCambiosVarios(['primero.txt'])
      check(
        '(17) el añadido sin commit se borra (confirmado)',
        res.length === 1 && res[0].estado === 'borrado' && !existsSync(path.join(repo, 'primero.txt')),
        JSON.stringify(res)
      )
    }

    // -------------------------------------------------------------------------
    hr('18) Una CARPETA sin barra en el lote: error propio, sin confirmarla ni tocarla')
    {
      const repo = nuevoRepo('lote-carpeta', { 'sub/a.txt': 'a\n', 'uno.txt': 'uno\n' })
      escribir(repo, 'sub/a.txt', 'TRABAJO\n')
      escribir(repo, 'uno.txt', 'CAMBIADO\n')
      let nombres: string[] = []
      const git = nuevoServicio(repo, {
        confirmar: async (n) => {
          nombres = n
          return true
        }
      })
      const res = await git.descartarCambiosVarios(['sub', 'uno.txt'])
      const porRuta = new Map(res.map((r) => [r.ruta, r]))
      check(
        '(18a) "sub" sale en error «Es una carpeta…» y no se lista para borrar',
        porRuta.get('sub')?.estado === 'error' && /carpeta/i.test(porRuta.get('sub')?.error ?? '') && nombres.length === 0,
        `nombres=${JSON.stringify(nombres)} ${JSON.stringify(res)}`
      )
      check(
        '(18b) sub/a.txt conserva su trabajo y uno.txt se revierte',
        readFileSync(path.join(repo, 'sub', 'a.txt'), 'utf8') === 'TRABAJO\n' && porRuta.get('uno.txt')?.estado === 'revertido',
        leerEstadoDe(repo).join(',')
      )
    }

    // -------------------------------------------------------------------------
    hr('19) La forma de la ruta: los blancos de los extremos son parte del nombre')
    check('(19a) "a.txt " no se recorta a "a.txt"', relDeArchivo('a.txt ') === 'a.txt ', JSON.stringify(relDeArchivo('a.txt ')))
    check('(19b) "  " cuenta como vacía', relDeArchivo('  ') === null, JSON.stringify(relDeArchivo('  ')))

    await lotesQuePerdianDatos()
    await lotesDeLaCopiaYElDialogo()
  } finally {
    for (const dir of temporales) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch (err) {
        console.log('AVISO: no se pudo borrar el temporal:', String(err))
      }
    }
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
