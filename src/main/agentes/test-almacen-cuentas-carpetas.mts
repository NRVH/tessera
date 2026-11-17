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
import type { Perfil } from '../perfiles/types.ts'

// `AlmacenCuentas` importa sin extensión: el hook reintenta con ".ts" (el mismo de `test-terminal-agente`).
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
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs), import.meta.url)
const { AlmacenCuentas } = await import('./AlmacenCuentas.ts')

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

const PERFIL: Perfil = {
  id: 'p',
  nombre: 'P',
  color: '#61afef',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/p/claude' }],
  sandbox: { habilitado: true }
}

function main(): void {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'tessera-cuentas-carpetas-'))
  try {
    const rutaAlmacen = path.join(raiz, 'agent-accounts.json')
    const dirAnteriorFormato = path.join(raiz, '.tessera', 'perfiles', 'p', 'claude')
    const anidada = path.join(dirAnteriorFormato, 'cuenta-1')
    mkdirSync(anidada, { recursive: true })
    writeFileSync(path.join(anidada, '.credentials.json'), 'login-de-la-cuenta-1')
    writeFileSync(path.join(dirAnteriorFormato, '.credentials.json'), 'login-de-la-predeterminada')
    writeFileSync(rutaAlmacen, JSON.stringify({ version: 1, accounts: [{ id: 'cuenta-1', nombre: 'Uno', agente: 'claude-code', profileId: 'p' }] }))

    hr('(1) la cuenta anidada se mueve con su login al arrancar')
    const store = new AlmacenCuentas({ rutaAlmacen, raizDatos: raiz })
    const nueva = path.join(raiz, '.tessera', 'perfiles', 'p', 'claude-cuentas', 'cuenta-1')
    check('ya no está dentro de la carpeta de la predeterminada', !existsSync(anidada), anidada)
    check('está en su sitio, con su login', readFileSync(path.join(nueva, '.credentials.json'), 'utf8') === 'login-de-la-cuenta-1', nueva)
    const cuenta = store.obtener('cuenta-1')
    check('dirHostDe la resuelve ahí', cuenta !== undefined && store.dirHostDe(cuenta) === nueva, cuenta ? store.dirHostDe(cuenta) : '?')

    hr('(2) la predeterminada')
    store.asegurarPredeterminadas([PERFIL])
    const def = store.predeterminadaDe('p', 'claude-code')
    check('su carpeta es la del perfil y su login sigue', store.dirHostDe(def) === dirAnteriorFormato && readFileSync(path.join(dirAnteriorFormato, '.credentials.json'), 'utf8') === 'login-de-la-predeterminada', store.dirHostDe(def))
    let error = ''
    try {
      store.quitar(def.id)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    check('NEGATIVO: no se puede borrar, y su carpeta sigue', error !== '' && existsSync(dirAnteriorFormato) && store.obtener(def.id) !== undefined, error)
    store.quitar('cuenta-1')
    check('borrar una creada no toca la predeterminada', !existsSync(nueva) && existsSync(path.join(dirAnteriorFormato, '.credentials.json')), 'ok')

    hr('(3) una segunda vez no mueve nada')
    const otra = new AlmacenCuentas({ rutaAlmacen, raizDatos: raiz })
    check('arranca sin errores y sin la borrada', otra.obtener('cuenta-1') === undefined, 'ok')

    hr('(4) renombrar')
    const fallo = (f: () => unknown): string => {
      try {
        f()
        return ''
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    }
    const trabajo = store.crear({ nombre: 'Trabajo', agente: 'claude-code', profileId: 'p' })
    const personal = store.crear({ nombre: 'Personal', agente: 'claude-code', profileId: 'p' })
    const dirAnterior = store.dirHostDe(trabajo)
    store.renombrar(trabajo.id, '  Oficina  ')
    const releida = new AlmacenCuentas({ rutaAlmacen, raizDatos: raiz }).obtener(trabajo.id)
    check('cambia el nombre (recortado), se persiste y la carpeta no se mueve', releida?.nombre === 'Oficina' && store.dirHostDe(trabajo) === dirAnterior, `${releida?.nombre}`)
    check('la misma cuenta puede cambiar solo mayúsculas', fallo(() => store.renombrar(trabajo.id, 'OFICINA')) === '' && store.obtener(trabajo.id)?.nombre === 'OFICINA', String(store.obtener(trabajo.id)?.nombre))
    check('NEGATIVO: no repite el de otra del mismo agente', fallo(() => store.renombrar(trabajo.id, 'personal')) !== '' && store.obtener(trabajo.id)?.nombre === 'OFICINA', String(store.obtener(personal.id)?.nombre))
    check('NEGATIVO: ni vacío ni el de la predeterminada', fallo(() => store.renombrar(trabajo.id, '   ')) !== '' && fallo(() => store.renombrar(trabajo.id, 'Default')) !== '', 'ok')
    check('NEGATIVO: la predeterminada no se renombra', fallo(() => store.renombrar(def.id, 'Mía')) !== '', 'ok')
    check('NEGATIVO: una que no existe da error, no se crea', fallo(() => store.renombrar('no-existe', 'X')) !== '' && store.obtener('no-existe') === undefined, 'ok')

    hr('(5) rutaDe: la misma carpeta que dirHostDe, sin crear ni mover nada')
    const fantasma = { id: 'sin-carpeta', nombre: 'Fantasma', agente: 'claude-code' as const, profileId: 'p' }
    const prevista = store.rutaDe(fantasma)
    check('una cuenta sin carpeta: da su ruta y no la crea', prevista === path.join(raiz, '.tessera', 'perfiles', 'p', 'claude-cuentas', 'sin-carpeta') && !existsSync(prevista), prevista)
    check('una existente: la misma que dirHostDe', store.rutaDe(personal) === store.dirHostDe(personal) && store.rutaDe(def) === store.dirHostDe(def), store.rutaDe(personal))
    const rezagada = { id: 'rezagada', nombre: 'Rezagada', agente: 'claude-code' as const, profileId: 'p' }
    const dentro = path.join(dirAnteriorFormato, 'rezagada')
    mkdirSync(dentro, { recursive: true })
    const ruta = store.rutaDe(rezagada)
    check('una que sigue anidada: apunta a donde está y no la mueve', ruta === dentro && existsSync(dentro) && !existsSync(path.join(raiz, '.tessera', 'perfiles', 'p', 'claude-cuentas', 'rezagada')), ruta)
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
