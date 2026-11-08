// =============================================================================
// Comprueba con git real que preparar el entorno respeta la cola y sus cancelaciones.
// Observa los procesos lanzados sin sustituir git ni alterar su resultado.
// Decisiones: docs/decisiones/sandbox/proyecto-montado-no-confiable.md
// =============================================================================
import assert from 'node:assert/strict'
import procesos from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { register, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\\.[mc]?[jt]s$/.test(s))return n(s+'.ts',c);throw e}}`))
const { colaGit } = await import('./colaGit.ts')
const lanzamientos: { args: readonly string[]; enVuelo: number; opciones: unknown }[] = []
const original = procesos.execFile
function observar(argumentos: unknown[]): void {
  if (argumentos[0] === 'git') lanzamientos.push({ args: argumentos[1] as string[], enVuelo: colaGit.enVuelo, opciones: argumentos[2] })
}
// Se conserva también la variante promisificada y todos sus argumentos.
const observada = function (...argumentos: unknown[]) {
  observar(argumentos)
  return Reflect.apply(original, procesos, argumentos)
} as typeof procesos.execFile
Object.defineProperty(observada, promisify.custom, {
  value: function (...argumentos: unknown[]) {
    observar(argumentos)
    return Reflect.apply(Reflect.get(original, promisify.custom), procesos, argumentos)
  }
})
procesos.execFile = observada
syncBuiltinESMExports()
const { cancelarAmbito, ejecutarGit } = await import('./procesoGit.ts')
const carpeta = mkdtempSync(path.join(tmpdir(), 'tessera-cola-config-'))
try {
  procesos.execFileSync('git', ['init', '-q', carpeta])
  cancelarAmbito('cancelada')
  await assert.rejects(ejecutarGit(['status', '--porcelain'], carpeta, undefined, 'cancelada'))
  assert.equal(lanzamientos.length, 0, 'una lectura cancelada no prepara su entorno')
  await assert.rejects(ejecutarGit(['add', '.'], carpeta, undefined, '', () => false))
  assert.equal(lanzamientos.length, 0, 'una escritura descartada no prepara su entorno')
  await ejecutarGit(['status', '--porcelain'], carpeta)
  assert.ok(lanzamientos.some((p) => p.args[0] === 'config'))
  assert.ok(lanzamientos.every((p) => p.enVuelo > 0), 'cada proceso se lanza dentro de la cola')
  const configuraciones = lanzamientos.filter((p) => p.args[0] === 'config')
  assert.ok(configuraciones.every((p) => (p.opciones as { timeout: number }).timeout === 20_000), 'git config tiene techo de tiempo')
  console.log('PASS: cancelación, entorno dentro de la cola y techo de git config')
} finally {
  procesos.execFile = original
  syncBuiltinESMExports()
  rmSync(carpeta, { recursive: true, force: true })
}
