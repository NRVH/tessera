// =============================================================================
// LA BATERÍA: los scripts `test:*` (salvo test:e2e) uno tras otro, con resumen. Uso: node
// scripts/pruebas/bateria.mjs [--afectadas[=ref]] [--explicar] [--solo-lista] [filtro-regex].
// `--afectadas`: solo las que dependen de lo cambiado desde `ref` (HEAD; con lo no confirmado),
// ver `afectadas.mjs`. Uno tras otro porque unos 30 usan Docker y se pisarían: nunca dos a la
// vez ni junto al e2e. Oracle y SQL Server se saltan sin su destino (`oracle.sh`, `mssql.sh`).
// =============================================================================
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pruebasAfectadas } from './afectadas.mjs'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const afectadas = args.find((a) => a === '--afectadas' || a.startsWith('--afectadas='))
const explicar = args.includes('--explicar')
const patron = args.find((a) => !a.startsWith('--'))
const filtro = patron ? new RegExp(patron) : null
let nombres = Object.keys(pkg.scripts).filter((n) => n.startsWith('test:') && n !== 'test:e2e' && (!filtro || filtro.test(n)))

if (afectadas) {
  const ref = afectadas.includes('=') ? afectadas.slice(afectadas.indexOf('=') + 1) : 'HEAD'
  const r = pruebasAfectadas(raiz, ref, nombres, pkg.scripts)
  if (r.todas) {
    console.log(`Afectadas desde ${ref}: TODAS (${r.motivo})\n`)
  } else {
    console.log(`Afectadas desde ${ref}: ${r.elegidas.size} de ${nombres.length} scripts (${r.cambiados.length} archivos cambiados)\n`)
    if (explicar) for (const [n, por] of r.elegidas) console.log(`  ${n}  <-  ${por}`)
    if (explicar && r.elegidas.size) console.log('')
    nombres = nombres.filter((n) => r.elegidas.has(n))
  }
}
if (args.includes('--solo-lista')) {
  console.log(nombres.join('\n'))
  process.exit(0)
}

const fallos = []
for (const n of nombres) {
  const t0 = Date.now()
  const r = spawnSync('npm', ['run', '-s', n], { cwd: raiz, shell: true, encoding: 'utf8', timeout: 900000 })
  const salida = (r.stdout || '') + (r.stderr || '')
  const veredicto = (salida.match(/VEREDICTO[^\n]*/g) || []).pop() || ''
  const ok = r.status === 0
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n} (${((Date.now() - t0) / 1000).toFixed(1)} s) ${veredicto}`)
  if (!ok) fallos.push({ n, cola: salida.split('\n').filter((l) => /FAIL|Error|error/.test(l)).slice(-12).join('\n') })
}
console.log(`\n${nombres.length - fallos.length}/${nombres.length} scripts en verde`)
for (const f of fallos) console.log(`\n--- ${f.n}\n${f.cola}`)
process.exit(fallos.length ? 1 : 0)
