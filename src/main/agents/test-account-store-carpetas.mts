// =============================================================================
// Prueba de las carpetas de credenciales de `AccountStore` (npm run test:cuentas-carpetas): una
// cuenta creada vive HERMANA de la predeterminada y no dentro de ella; la que quedó anidada se
// mueve con su login al arrancar; la predeterminada no se puede borrar; y renombrar valida el nombre.
// Decisiones: docs/decisiones/sandbox/contenedor-por-cuenta.md
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { Profile } from '../profiles/types.ts'

// `AccountStore` importa sin extensión: el hook reintenta con ".ts" (el mismo de `test-agent-terminal`).
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
register('data:text/javascript,' + encodeURIComponent(resolveTsHook), import.meta.url)
const { AccountStore } = await import('./AccountStore.ts')

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

const PERFIL: Profile = {
  id: 'p',
  nombre: 'P',
  color: '#61afef',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/p/claude' }],
  sandbox: { habilitado: true }
}

function main(): void {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'tessera-cuentas-carpetas-'))
  try {
    const storePath = path.join(raiz, 'agent-accounts.json')
    const legacy = path.join(raiz, '.tessera', 'perfiles', 'p', 'claude')
    const anidada = path.join(legacy, 'cuenta-1')
    mkdirSync(anidada, { recursive: true })
    writeFileSync(path.join(anidada, '.credentials.json'), 'login-de-la-cuenta-1')
    writeFileSync(path.join(legacy, '.credentials.json'), 'login-de-la-predeterminada')
    writeFileSync(storePath, JSON.stringify({ version: 1, accounts: [{ id: 'cuenta-1', nombre: 'Uno', agente: 'claude-code', profileId: 'p' }] }))

    hr('(1) la cuenta anidada se mueve con su login al arrancar')
    const store = new AccountStore({ storePath, dataRoot: raiz })
    const nueva = path.join(raiz, '.tessera', 'perfiles', 'p', 'claude-cuentas', 'cuenta-1')
    check('ya no está dentro de la carpeta de la predeterminada', !existsSync(anidada), anidada)
    check('está en su sitio, con su login', readFileSync(path.join(nueva, '.credentials.json'), 'utf8') === 'login-de-la-cuenta-1', nueva)
    const cuenta = store.get('cuenta-1')
    check('hostDirFor la resuelve ahí', cuenta !== undefined && store.hostDirFor(cuenta) === nueva, cuenta ? store.hostDirFor(cuenta) : '?')

    hr('(2) la predeterminada')
    store.ensureDefaults([PERFIL])
    const def = store.defaultFor('p', 'claude-code')
    check('su carpeta es la del perfil y su login sigue', store.hostDirFor(def) === legacy && readFileSync(path.join(legacy, '.credentials.json'), 'utf8') === 'login-de-la-predeterminada', store.hostDirFor(def))
    let error = ''
    try {
      store.remove(def.id)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    check('NEGATIVO: no se puede borrar, y su carpeta sigue', error !== '' && existsSync(legacy) && store.get(def.id) !== undefined, error)
    store.remove('cuenta-1')
    check('borrar una creada no toca la predeterminada', !existsSync(nueva) && existsSync(path.join(legacy, '.credentials.json')), 'ok')

    hr('(3) una segunda vez no mueve nada')
    const otra = new AccountStore({ storePath, dataRoot: raiz })
    check('arranca sin errores y sin la borrada', otra.get('cuenta-1') === undefined, 'ok')

    hr('(4) renombrar')
    const fallo = (f: () => unknown): string => {
      try {
        f()
        return ''
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    }
    const trabajo = store.create({ nombre: 'Trabajo', agente: 'claude-code', profileId: 'p' })
    const personal = store.create({ nombre: 'Personal', agente: 'claude-code', profileId: 'p' })
    const dirAntes = store.hostDirFor(trabajo)
    store.rename(trabajo.id, '  Oficina  ')
    const releida = new AccountStore({ storePath, dataRoot: raiz }).get(trabajo.id)
    check('cambia el nombre (recortado), se persiste y la carpeta no se mueve', releida?.nombre === 'Oficina' && store.hostDirFor(trabajo) === dirAntes, `${releida?.nombre}`)
    check('la misma cuenta puede cambiar solo mayúsculas', fallo(() => store.rename(trabajo.id, 'OFICINA')) === '' && store.get(trabajo.id)?.nombre === 'OFICINA', String(store.get(trabajo.id)?.nombre))
    check('NEGATIVO: no repite el de otra del mismo agente', fallo(() => store.rename(trabajo.id, 'personal')) !== '' && store.get(trabajo.id)?.nombre === 'OFICINA', String(store.get(personal.id)?.nombre))
    check('NEGATIVO: ni vacío ni el de la predeterminada', fallo(() => store.rename(trabajo.id, '   ')) !== '' && fallo(() => store.rename(trabajo.id, 'Default')) !== '', 'ok')
    check('NEGATIVO: la predeterminada no se renombra', fallo(() => store.rename(def.id, 'Mía')) !== '', 'ok')
    check('NEGATIVO: una que no existe da error, no se crea', fallo(() => store.rename('no-existe', 'X')) !== '' && store.get('no-existe') === undefined, 'ok')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }

  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(passed === results.length ? 0 : 1)
}

main()
