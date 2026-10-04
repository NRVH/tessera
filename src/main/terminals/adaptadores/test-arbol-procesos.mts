#!/usr/bin/env node
// =============================================================================
// Prueba del plan para matar el árbol de un pty en POSIX (npm run test:arbol-procesos):
// qué grupos y procesos se señalan y, sobre todo, cuáles NO. Puro: corre en cualquier
// plataforma con tablas de `ps` escritas a mano.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import { leerTablaPs, planMuerte, planRemate, type ProcesoPs } from './arbolProcesos.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const TESSERA = 500
/** launchd → Tessera (grupo 500) → pty 600 (líder de sesión y de grupo) → … */
const BASE: ProcesoPs[] = [
  { pid: 1, ppid: 0, pgid: 1 },
  { pid: TESSERA, ppid: 1, pgid: 500 },
  { pid: 510, ppid: TESSERA, pgid: 500 }, // un ayudante de Tessera, en su grupo
  { pid: 900, ppid: 1, pgid: 900 } // otro programa del usuario
]
const ordenados = (xs: number[]): string => [...xs].sort((a, b) => a - b).join(',')

hr('1. Leer la tabla de ps')
{
  const t = leerTablaPs('  1     0     1\n  600   500   600\n basura\n 7 8\n -1 2 3\n 12 x 4\n\n 700 600 600 extra\n0 0 0\n')
  check('(1a) solo las filas de tres enteros; la basura se descarta', JSON.stringify(t.map((p) => p.pid)) === '[1,600]', JSON.stringify(t))
  check('(1b) una salida vacía da una tabla vacía', leerTablaPs('').length === 0, '0')
}

hr('2. Sin control de trabajos: todo en el grupo del pty')
{
  const tabla = [...BASE, { pid: 600, ppid: TESSERA, pgid: 600 }, { pid: 601, ppid: 600, pgid: 600 }, { pid: 602, ppid: 601, pgid: 600 }]
  const plan = planMuerte(tabla, 600, TESSERA)
  check('(2a) se señala el grupo del pty y ningún pid suelto', ordenados(plan.grupos) === '600' && plan.pids.length === 0, JSON.stringify(plan))
  check('(2b) el árbol son el pty y sus descendientes', ordenados(plan.miembros.map((m) => m.pid)) === '600,601,602', ordenados(plan.miembros.map((m) => m.pid)))
}

hr('3. Con control de trabajos y con un hijo que se cambió de grupo')
{
  const tabla = [
    ...BASE,
    { pid: 600, ppid: TESSERA, pgid: 600 }, // la shell
    { pid: 610, ppid: 600, pgid: 610 }, // el CLI, en su propio grupo de primer plano
    { pid: 611, ppid: 610, pgid: 610 }, // un MCP en el grupo del CLI
    { pid: 620, ppid: 610, pgid: 620 }, // un MCP `detached`: líder de su grupo
    { pid: 621, ppid: 620, pgid: 620 },
    { pid: 630, ppid: 611, pgid: 900 } // un nieto que se metió en el grupo de OTRO programa
  ]
  const plan = planMuerte(tabla, 600, TESSERA)
  check('(3a) los tres grupos que lidera un miembro del árbol', ordenados(plan.grupos) === '600,610,620', ordenados(plan.grupos))
  check('(3b) el nieto del grupo ajeno, como pid suelto', ordenados(plan.pids) === '630', ordenados(plan.pids))
  check('(3c) el grupo ajeno (900) NO se señala entero', !plan.grupos.includes(900), ordenados(plan.grupos))
}

hr('4. Lo que NUNCA se señala')
{
  const tabla = [...BASE, { pid: 600, ppid: TESSERA, pgid: 600 }, { pid: 601, ppid: 600, pgid: 0 }, { pid: 602, ppid: 600, pgid: 1 }, { pid: 603, ppid: 600, pgid: 500 }]
  const plan = planMuerte(tabla, 600, TESSERA)
  const prohibidos = plan.grupos.filter((g) => g <= 1 || g === 500)
  check('(4a) ni el grupo 0, ni el 1, ni el de Tessera', prohibidos.length === 0 && ordenados(plan.grupos) === '600', ordenados(plan.grupos))
  check('(4b) sus miembros caen como pids sueltos, que no arrastran a nadie', ordenados(plan.pids) === '601,602,603', ordenados(plan.pids))
  check('(4c) ni Tessera ni su ayudante ni el otro programa están en el plan', ![TESSERA, 510, 900, 1].some((p) => plan.pids.includes(p) || plan.grupos.includes(p)), JSON.stringify(plan))

  const sinRaiz = planMuerte(BASE, 600, TESSERA)
  check('(4d) la raíz no está en la tabla (ya murió): plan vacío', sinRaiz.grupos.length + sinRaiz.pids.length === 0, JSON.stringify(sinRaiz))
  const sinPropio = planMuerte([{ pid: 600, ppid: 1, pgid: 600 }], 600, TESSERA)
  check('(4e) no se conoce el grupo propio: plan vacío', sinPropio.grupos.length + sinPropio.pids.length === 0, JSON.stringify(sinPropio))
  const raices = [0, 1, -1, TESSERA].map((r) => planMuerte(tabla, r, TESSERA))
  check('(4f) raíz 0, 1, negativa o el propio Tessera: plan vacío', raices.every((p) => p.grupos.length + p.pids.length === 0), JSON.stringify(raices.map((p) => p.grupos)))
  // Una tabla incoherente en la que Tessera cuelga del pty.
  const ciclo = planMuerte([{ pid: 1, ppid: 0, pgid: 1 }, { pid: 600, ppid: 1, pgid: 600 }, { pid: TESSERA, ppid: 600, pgid: 500 }], 600, TESSERA)
  check('(4g) un árbol que contiene a Tessera: plan vacío', ciclo.grupos.length + ciclo.pids.length === 0, JSON.stringify(ciclo))
  const bucle = planMuerte([...BASE, { pid: 600, ppid: 601, pgid: 600 }, { pid: 601, ppid: 600, pgid: 600 }], 600, TESSERA)
  check('(4h) un ciclo de padres en la tabla no cuelga el plan', ordenados(bucle.miembros.map((m) => m.pid)) === '600,601', ordenados(bucle.miembros.map((m) => m.pid)))
}

hr('5. El remate solo alcanza a lo que sigue siendo lo mismo')
{
  const tabla = [...BASE, { pid: 600, ppid: TESSERA, pgid: 600 }, { pid: 610, ppid: 600, pgid: 610 }, { pid: 630, ppid: 610, pgid: 900 }]
  const plan = planMuerte(tabla, 600, TESSERA)
  const todoMuerto = planRemate(plan, BASE)
  check('(5a) si todo murió con el TERM, no se remata nada', todoMuerto.grupos.length + todoMuerto.pids.length === 0, JSON.stringify(todoMuerto))
  // 610 sobrevive; 600 murió y su pid lo tiene ahora OTRO proceso, en otro grupo; 630 sigue.
  const despues = [...BASE, { pid: 600, ppid: 1, pgid: 4242 }, { pid: 610, ppid: 1, pgid: 610 }, { pid: 630, ppid: 1, pgid: 900 }]
  const remate = planRemate(plan, despues)
  check('(5b) se remata el grupo del superviviente y el pid suelto', ordenados(remate.grupos) === '610' && ordenados(remate.pids) === '630', JSON.stringify(remate))
  check('(5c) un pid reciclado en otro grupo NO se remata', !remate.grupos.includes(600) && !remate.pids.includes(600), JSON.stringify(remate))
  // El líder murió pero queda un huérfano en su grupo, que no es miembro conocido: no se toca.
  const huerfano = planRemate(plan, [...BASE, { pid: 777, ppid: 1, pgid: 610 }])
  check('(5d) un grupo en el que ya no queda ningún miembro conocido no se señala', huerfano.grupos.length === 0, JSON.stringify(huerfano))
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
