// =============================================================================
// LA BATERÍA: todos los scripts `test:*` de package.json (salvo test:e2e) uno tras otro,
// con un resumen al final. Uso: node scripts/pruebas/bateria.mjs [filtro-regex]
//
// POR QUÉ UNO TRAS OTRO: unos 30 levantan o usan Docker (sandbox, terminales, agentes) y
// dos baterías a la vez se pisan los contenedores y las carpetas temporales (medido: cinco
// rojos falsos). Por lo mismo, NO correrla dos veces a la vez ni junto al e2e.
// Los de Oracle y SQL Server salen en verde SALTÁNDOSE sin su destino en el entorno: para
// correrlos de verdad, `oracle.sh correr …` y `mssql.sh correr …` de esta carpeta.
// =============================================================================
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8'))
const filtro = process.argv[2] ? new RegExp(process.argv[2]) : null
const nombres = Object.keys(pkg.scripts).filter((n) => n.startsWith('test:') && n !== 'test:e2e' && (!filtro || filtro.test(n)))
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
