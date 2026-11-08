#!/usr/bin/env node
// =============================================================================
// Prueba de `configSegura.ts` (npm run test:config-segura): el parseo de `git config -z`, qué claves se anulan y
// con qué valor, y con el git real que un repo con fsmonitor, filtros, drivers de diff y merge y firma plantados
// en su `.git/config` (lo que puede escribir el contenedor) ejecuta sus programas con git a secas, el control, y
// ninguno por `ejecutarGit` ni por `cat-file`, que siguen funcionando. Fixture desechable en os.tmpdir().
// =============================================================================

import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'

const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { parsearListaConfig, claveNormalizada, valorInocuo, neutralizaciones, entornoCon, conDiffSeguro, neutralizacionGit } = await import('./configSegura.ts')
const { ejecutarGit } = await import('./procesoGit.ts')
const { leerBlobFiltrado } = await import('./procesoCatFile.ts')

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

hr('1. Parseo y decisión, sin git')
const salida = 'local\0file:.git/config\0core.repositoryformatversion\n0\0local\0file:.git/config\0filter.Mal.clean\nevil\0worktree\0file:.git/config.worktree\0core.bare\0'
const e = parsearListaConfig(salida)
check('1a', e.length === 3 && e[1].clave === 'filter.Mal.clean' && e[1].valor === 'evil' && e[2].valor === 'true' && e[2].ambito === 'worktree', JSON.stringify(e))
check('1b', claveNormalizada('Filter.Mal.CLEAN') === 'filter.Mal.clean' && claveNormalizada('CORE.FsMonitor') === 'core.fsmonitor', 'sección y variable en minúsculas, subsección tal cual')
check('1c', valorInocuo('core.fsmonitor') === 'false' && valorInocuo('filter.x.smudge') === '' && valorInocuo('merge.x.driver') === '' && valorInocuo('gpg.ssh.program') === 'ssh-keygen' && valorInocuo('gpg.ssh.defaultKeyCommand') === '' && valorInocuo('gpg.format') === 'openpgp' && valorInocuo('commit.gpgsign') === 'false', 'las claves que ejecutan algo tienen su valor inocuo')
check('1d', valorInocuo('user.name') === null && valorInocuo('core.autocrlf') === null && valorInocuo('diff.x.textconv') === null, 'las demás (y textconv, que va por bandera) no se tocan')
const n = neutralizaciones([
  { ambito: 'global', origen: 'f', clave: 'filter.lfs.clean', valor: 'git-lfs clean -- %f' },
  { ambito: 'local', origen: 'f', clave: 'filter.lfs.clean', valor: 'evil' },
  { ambito: 'worktree', origen: 'f', clave: 'core.fsmonitor', valor: 'evil' },
  { ambito: 'global', origen: 'f', clave: 'core.fsmonitor', valor: 'true' },
  { ambito: 'global', origen: 'f', clave: 'diff.external', valor: 'mio' },
  { ambito: 'local', origen: 'f', clave: 'user.name', valor: 'x' }
])
const mapa = new Map(n)
check('1e', mapa.get('filter.lfs.clean') === 'git-lfs clean -- %f' && mapa.get('filter.lfs.required') === 'false' && mapa.get('core.fsmonitor') === 'true' && !mapa.has('diff.external') && !mapa.has('user.name'), `lo del repo (local y worktree) toma el valor del usuario; lo que solo define el usuario no se toca -> ${JSON.stringify(n)}`)
const env = entornoCon({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' }, [['filter.a=b.clean', '']])
check('1e2', env.GIT_CONFIG_COUNT === '2' && env.GIT_CONFIG_KEY_0 === 'a.b' && env.GIT_CONFIG_KEY_1 === 'filter.a=b.clean' && env.GIT_CONFIG_VALUE_1 === '', 'por entorno, detrás de lo que ya trajera, y la clave entera aunque lleve «=»')
check('1f', JSON.stringify(conDiffSeguro(['log', '-p'])) === '["log","--no-textconv","--no-ext-diff","-p"]' && JSON.stringify(conDiffSeguro(['status'])) === '["status"]', 'textconv y diff externo apagados solo donde hay diff')

hr('2. Con git real: lo plantado en .git/config no se ejecuta')
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-config-segura-')))
const repo = path.join(tmp, 'repo')
const marca = (n: string): string => path.join(tmp, `marca-${n}`).replace(/\\/g, '/')
const marcas = (): string[] => readdirSync(tmp).filter((x) => x.startsWith('marca-'))
const borrarMarcas = (): void => {
  for (const m of marcas()) rmSync(path.join(tmp, m))
}
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
try {
  execFileSync('git', ['init', '-q', repo])
  git('config', 'user.email', 'pruebas@example.invalid')
  git('config', 'user.name', 'Pruebas')
  writeFileSync(path.join(repo, 'a.txt'), 'uno\n')
  git('add', 'a.txt')
  git('commit', '-qm', 'uno')
  const oid = git('rev-parse', 'HEAD:a.txt').trim()
  git('config', 'core.fsmonitor', `touch ${marca('fsmonitor')}`)
  git('config', 'filter.mal.clean', `sh -c 'touch ${marca('clean')}; cat'`)
  git('config', 'filter.mal.smudge', `sh -c 'touch ${marca('smudge')}; cat'`)
  git('config', 'diff.mal.textconv', `sh -c 'touch ${marca('textconv')}; cat'`)
  git('config', 'diff.external', `touch ${marca('externo')}`)
  writeFileSync(path.join(repo, '.git', 'info', 'attributes'), '* filter=mal diff=mal merge=mal\n')
  writeFileSync(path.join(repo, 'a.txt'), 'dos\n')

  try {
    git('status', '--porcelain')
    git('log', '-p', '-1')
    execFileSync('git', ['cat-file', '--filters', '--path=a.txt', oid], { cwd: repo, stdio: 'ignore' })
  } catch {
    // El control solo importa por lo que ejecutó.
  }
  const control = marcas()
  check('2a', control.includes('marca-fsmonitor') && control.includes('marca-clean') && control.includes('marca-smudge'), `control: con git a secas el repo ejecuta lo plantado -> ${control.join(', ')}`)
  borrarMarcas()

  const st = await ejecutarGit(['status', '--porcelain=v2', '--branch'], repo)
  check('2b', st.stdout.includes('a.txt'), 'status por la cola funciona y ve el cambio')
  await ejecutarGit(['log', '-p', '-1', '--format=%h'], repo)
  await ejecutarGit(['show', 'HEAD', '--format=%h'], repo)
  await ejecutarGit(['diff-tree', '-p', 'HEAD~0', '--root'], repo)
  await ejecutarGit(['add', 'a.txt'], repo)
  await ejecutarGit(['commit', '-qm', 'dos'], repo)
  const filtrado = await leerBlobFiltrado(oid, 'a.txt', repo, 1024)
  check('2c', filtrado !== null && filtrado.toString('utf8').startsWith('uno'), 'cat-file --filters sigue devolviendo el blob')
  check('2d', marcas().length === 0, `nada de lo plantado se ejecutó por Tessera -> ${marcas().join(', ') || 'ninguna marca'}`)

  hr('3. La caché se renueva si el repo cambia su configuración')
  const tiene = (pares: [string, string][], clave: string, valor: string): boolean => pares.some(([c, v]) => c === clave && v === valor)
  const antes = await neutralizacionGit(repo)
  git('config', 'commit.gpgsign', 'true')
  const despues = await neutralizacionGit(repo)
  check('3a', !tiene(antes, 'commit.gpgsign', 'false') && tiene(despues, 'commit.gpgsign', 'false'), 'una clave nueva en .git/config se anula en la siguiente orden')
  git('config', '--unset', 'commit.gpgsign')
  git('config', 'extensions.worktreeConfig', 'true')
  git('config', '--worktree', 'core.fsmonitor', `touch ${marca('worktree')}`)
  git('config', 'filter.a=b.clean', `sh -c 'touch ${marca('igual')}; cat'`)
  writeFileSync(path.join(repo, '.git', 'info', 'attributes'), '* filter=a=b\n')
  writeFileSync(path.join(repo, 'a.txt'), 'tres\n')
  await ejecutarGit(['status', '--porcelain'], repo)
  await ejecutarGit(['add', 'a.txt'], repo)
  check('3a2', !existsSync(path.join(tmp, 'marca-worktree')) && !existsSync(path.join(tmp, 'marca-igual')), `config.worktree y un filtro con «=» en el nombre tampoco se ejecutan -> ${marcas().join(', ') || 'ninguna marca'}`)
  const inc = path.join(repo, '.git', 'extra.inc')
  writeFileSync(inc, '')
  git('config', 'include.path', 'extra.inc')
  await neutralizacionGit(repo)
  writeFileSync(inc, `[core]\n\tfsmonitor = touch ${marca('incluido')}\n`)
  await ejecutarGit(['status', '--porcelain'], repo)
  check('3b', !existsSync(path.join(tmp, 'marca-incluido')), 'un archivo incluido que se llena después también se vigila')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

hr(`VEREDICTO: ${passed}/${passed + failed} PASS${failed ? ' — HAY FAIL' : ' — TODO PASS'}`)
process.exit(failed ? 1 : 0)
