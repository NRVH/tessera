#!/usr/bin/env node
// =============================================================================
// Corre el banco de rendimiento (`e2e/banco-rendimiento.spec.ts`) sobre la app ya empaquetada y
// compara su informe con la línea base guardada de esta plataforma (`docs/rendimiento/`), criterio
// por criterio de la línea de corte. `--solo-comparar` no corre nada y compara el último informe;
// `--guardar-base` guarda el último informe como la nueva línea base.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const plataforma = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : process.platform
const INFORME = join('e2e', '.resultados', `banco-rendimiento-${plataforma}.json`)
const BASE = join('docs', 'rendimiento', `linea-base-${plataforma}.json`)

/** Umbrales de la línea de corte, traducidos a lo que mide el banco (15 repeticiones por gesto). */
const CORTE = {
  /** Una fuga que suma ~100 MB en un día: con ~50 gestos al día, más de ~2 MB por gesto. */
  mbPorGesto: 2,
  /** Traba visible: la ventana tarda más de medio segundo o una tarea suya pasa de eso. */
  ms: 500,
  /** CPU en reposo sostenida (suma de los procesos de la app). */
  cpu: 2,
  /** Crecimiento del escalado frente a la base antes de mirarlo: un 20 % más con el mismo escenario. */
  escalado: 1.2
}

const args = new Set(process.argv.slice(2))

if (!args.has('--solo-comparar') && !args.has('--guardar-base')) {
  const r = spawnSync('npx', ['playwright', 'test', 'e2e/banco-rendimiento.spec.ts'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, TESSERA_E2E_BANCO: '1' }
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!existsSync(INFORME)) {
  console.error(`No hay informe en ${INFORME}: corre antes el banco.`)
  process.exit(1)
}

if (args.has('--guardar-base')) {
  const inf = JSON.parse(readFileSync(INFORME, 'utf8'))
  if (!inf.reposo || (inf.ciclos ?? []).length < 5) {
    console.error('El informe está incompleto: no se guarda como línea base.')
    process.exit(1)
  }
  mkdirSync(join('docs', 'rendimiento'), { recursive: true })
  copyFileSync(INFORME, BASE)
  console.log(`Línea base de ${plataforma} guardada en ${BASE}`)
  process.exit(0)
}

const leer = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'))
const nuevo = leer(INFORME)
// El banco reescribe el informe tras cada fase: uno cortado a medias no se compara como si estuviera entero.
if (!nuevo.reposo || (nuevo.ciclos ?? []).length < 5 || (nuevo.escalado ?? []).length < 5) {
  console.error(`El informe ${INFORME} está incompleto (el banco no llegó al final): vuelve a correrlo.`)
  process.exit(1)
}
const base = existsSync(BASE) ? leer(BASE) : null
const filas = []
const fila = (criterio, medida, valor, limite, cruza) => filas.push({ criterio, medida, valor, limite, '': cruza ? 'CRUZA' : 'ok' })

// 1 · Fugas: lo que dejan 15 repeticiones de cada gesto, por gesto.
for (const c of nuevo.ciclos ?? []) {
  const porGesto = c.cambio.appMb / c.veces
  fila('1 fuga', `${c.gesto}: app por gesto`, `${porGesto.toFixed(1)} MB`, `< ${CORTE.mbPorGesto} MB`, porGesto >= CORTE.mbPorGesto)
  fila('1 fuga', `${c.gesto}: instancias`, `xterm ${c.cambio.xterms}, editores ${c.cambio.editores}, rejillas ${c.cambio.rejillas}`, '0', c.cambio.xterms > 0 || c.cambio.editores > 0 || c.cambio.rejillas > 0)
  // 4 · Huérfanos: procesos de más cuando la cola de cierres ya se vació.
  fila('4 huérfanos', `${c.gesto}: procesos`, String(c.cambio.hijos), '<= 0', c.cambio.hijos > 0)
}

// 2 · Trabas al volver a un perfil y a su vista de BD.
for (const v of nuevo.volver ?? []) {
  const peor = Math.max(v.aPerfil.ms, v.aPerfil.tareaMasLarga, v.aBd.ms, v.aBd.tareaMasLarga)
  fila('2 traba', `volver a ${v.perfil}`, `${peor} ms`, `< ${CORTE.ms} ms`, peor >= CORTE.ms)
}

// 3 · CPU en reposo.
if (nuevo.reposo) {
  const total = Object.values(nuevo.reposo.cpu).reduce((a, p) => a + p.media, 0)
  fila('3 reposo', 'CPU media de la app', `${total.toFixed(1)} %`, `< ${CORTE.cpu} %`, total >= CORTE.cpu)
}

// Escalado frente a la base (no es un criterio de corte: avisa de que algo ocupa más que antes).
const ultimo = (inf) => inf?.escalado?.at(-1)?.foto
if (ultimo(nuevo) && ultimo(base)) {
  const n = ultimo(nuevo).appMb
  const b = ultimo(base).appMb
  fila('escalado', '5 perfiles cargados, app', `${n} MB (base ${b})`, `< ${Math.round(b * CORTE.escalado)} MB`, n >= b * CORTE.escalado)
}

console.log(`\nBanco de rendimiento · ${plataforma}${base ? '' : ' (sin línea base guardada: solo la línea de corte)'}`)
console.table(filas)
const cruzan = filas.filter((f) => f[''] === 'CRUZA')
console.log(cruzan.length === 0 ? 'Nada cruza la línea de corte.' : `${cruzan.length} medida(s) cruzan la línea.`)
process.exit(cruzan.length === 0 ? 0 : 1)
