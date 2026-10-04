#!/usr/bin/env node
// =============================================================================
// Prueba del modelo puro de la lista de terminales por proyecto.
// (node src/renderer/src/features/terminales/test-shell-terminals.mts)
// Cubre ensureProject (idempotente, no resucita), addTerminal, ids únicos y nunca
// reutilizados, sucesión al cerrar, selección, poda, aislamiento entre proyectos,
// inmutabilidad, nombres y reciclaje del número visible.
// =============================================================================

import {
  initialShellTerminalsState,
  terminalProjectKey,
  terminalName,
  ensureProject,
  addTerminal,
  closeTerminal,
  selectTerminal,
  renameTerminal,
  pruneProjects,
  type ShellTerminalsState
} from './shellTerminalsModel.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
let fallos = 0
function check(nombre: string, cond: boolean, detalle = ''): void {
  if (cond) {
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✕ ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  }
}
/** Atajo: ids de la lista de un proyecto, en orden. */
function ids(s: ShellTerminalsState, k: string): string {
  return (s[k]?.list ?? []).map((t) => t.id).join(',')
}

const A = terminalProjectKey('perfil-1', 'D:\\repos\\app')
const B = terminalProjectKey('perfil-2', 'D:\\repos\\otro')

console.log('\n[1] ensureProject')
{
  const s = ensureProject(initialShellTerminalsState, A)
  check('crea el proyecto con UNA terminal', ids(s, A) === 't1')
  check('y la deja activa', s[A].activeId === 't1')
  check('nextN avanzó a 2', s[A].nextN === 2)

  const s2 = ensureProject(s, A)
  check('es idempotente (mismo objeto, no duplica)', s2 === s)

  // (3) NO resucita: si cerraste la última a mano, el proyecto se queda en cero.
  const vacio = closeTerminal(s, A, 't1')
  const s3 = ensureProject(vacio, A)
  check('no resucita una lista vaciada a mano', s3 === vacio && s3[A].list.length === 0)
}

console.log('\n[2] addTerminal')
{
  let s = ensureProject(initialShellTerminalsState, A)
  s = addTerminal(s, A)
  check('añade al FINAL', ids(s, A) === 't1,t2')
  check('la nueva queda ACTIVA', s[A].activeId === 't2')
  s = addTerminal(s, A)
  check('tercera terminal', ids(s, A) === 't1,t2,t3' && s[A].activeId === 't3')
}

console.log('\n[3] ids únicos, nunca reutilizados')
{
  let s = ensureProject(initialShellTerminalsState, A) // t1
  s = addTerminal(s, A) // t2
  s = addTerminal(s, A) // t3
  s = closeTerminal(s, A, 't2') // cierro la de en medio
  s = addTerminal(s, A) // debe ser t4, NO t2
  check('el id cerrado NO se recicla', ids(s, A) === 't1,t3,t4', ids(s, A))
  check('nextN es monótono', s[A].nextN === 5)
}

console.log('\n[4] closeTerminal: sucesión de la activa')
{
  let base = ensureProject(initialShellTerminalsState, A)
  base = addTerminal(base, A) // t2
  base = addTerminal(base, A) // t3  (activa)

  // (6) cerrar la activa de EN MEDIO -> sucede la de la derecha
  const s1 = closeTerminal(selectTerminal(base, A, 't2'), A, 't2')
  check('cerrar la activa de en medio -> sucede la DERECHA', s1[A].activeId === 't3', String(s1[A].activeId))

  // (7) cerrar la activa que es la ÚLTIMA -> sucede la de la izquierda
  const s2 = closeTerminal(base, A, 't3') // t3 era la activa y la última
  check('cerrar la última activa -> sucede la IZQUIERDA', s2[A].activeId === 't2', String(s2[A].activeId))

  // (8) cerrar una NO activa no toca la activa
  const s3 = closeTerminal(base, A, 't1')
  check('cerrar una NO activa deja la activa intacta', s3[A].activeId === 't3' && ids(s3, A) === 't2,t3')

  // (9) cerrar la única
  const sola = ensureProject(initialShellTerminalsState, B)
  const s4 = closeTerminal(sola, B, 't1')
  check('cerrar la única -> lista vacía y activeId null', s4[B].list.length === 0 && s4[B].activeId === null)

  // (10) no-ops
  check('cerrar un id inexistente es no-op', closeTerminal(base, A, 'tX') === base)
  check('cerrar en un proyecto inexistente es no-op', closeTerminal(base, 'nadie', 't1') === base)
}

console.log('\n[5] selectTerminal')
{
  let s = ensureProject(initialShellTerminalsState, A)
  s = addTerminal(s, A) // t2 activa
  const sel = selectTerminal(s, A, 't1')
  check('cambia la activa', sel[A].activeId === 't1')
  check('id inexistente: no-op', selectTerminal(s, A, 'tX') === s)
  check('ya activa: no-op (identidad estable)', selectTerminal(sel, A, 't1') === sel)
}

console.log('\n[6] pruneProjects')
{
  let s = ensureProject(initialShellTerminalsState, A)
  s = ensureProject(s, B)
  const podado = pruneProjects(s, [A])
  check('olvida el proyecto cerrado', podado[B] === undefined && podado[A] !== undefined)
  check('conserva el abierto intacto', podado[A] === s[A])
  check('sin nada que podar: MISMO objeto (no re-render)', pruneProjects(s, [A, B]) === s)
  check('poda a vacío', Object.keys(pruneProjects(s, [])).length === 0)
}

console.log('\n[7] aislamiento entre proyectos')
{
  // El bug original: una sola terminal global. Aquí cada proyecto lleva su lista y
  // su activa; tocar uno no puede alterar el otro.
  let s = ensureProject(initialShellTerminalsState, A)
  s = ensureProject(s, B)
  s = addTerminal(s, A)
  s = addTerminal(s, A)
  check('A tiene 3 y B sigue con 1', ids(s, A) === 't1,t2,t3' && ids(s, B) === 't1')
  check('la activa de B no se movió', s[B].activeId === 't1')
  const antesB = s[B]
  s = closeTerminal(s, A, 't1')
  check('cerrar en A no toca el objeto de B', s[B] === antesB)
}

console.log('\n[8] inmutabilidad')
{
  let s = ensureProject(initialShellTerminalsState, A)
  s = addTerminal(s, A)
  const snapshot = JSON.stringify(s)
  addTerminal(s, A)
  closeTerminal(s, A, 't1')
  selectTerminal(s, A, 't1')
  ensureProject(s, B)
  pruneProjects(s, [])
  check('ninguna acción muta la entrada', JSON.stringify(s) === snapshot)
}

console.log('\n[9] nombres y claves')
{
  const t1 = { id: 't1', n: 1, indice: 1 }
  const t2 = { id: 't2', n: 2, indice: 2 }
  check('la PRIMERA no lleva número', terminalName(t1, true) === 'Local', terminalName(t1, true))
  check('la segunda sí', terminalName(t2, true) === 'Local (2)', terminalName(t2, true))
  check('dentro del contenedor es Docker', terminalName(t2, false) === 'Docker (2)', terminalName(t2, false))
  check(
    'el mismo hueco cambia de nombre con el MODO',
    terminalName(t1, true) === 'Local' && terminalName(t1, false) === 'Docker'
  )
  check('un nombre a mano gana al de por defecto', terminalName({ ...t2, nombre: 'dev server' }, true) === 'dev server')
  check(
    'clave de proyecto = perfil|ruta',
    terminalProjectKey('p1', 'D:\\x') === 'p1|D:\\x'
  )
}

console.log('\n[10] el número de la pestaña SE RECICLA (a diferencia del id)')
{
  let s: ShellTerminalsState = ensureProject(initialShellTerminalsState, A)
  s = addTerminal(s, A)
  s = addTerminal(s, A)
  const nombres = (st: ShellTerminalsState): string =>
    st[A].list.map((t) => terminalName(t, true)).join(',')
  check('tres seguidas', nombres(s) === 'Local,Local (2),Local (3)', nombres(s))
  s = closeTerminal(s, A, 't2') // cierra "Local (2)"
  s = addTerminal(s, A)
  check('la nueva OCUPA el hueco libre más bajo', nombres(s) === 'Local,Local (3),Local (2)', nombres(s))
  check('pero su id sigue siendo nuevo', s[A].list.map((t) => t.id).join(',') === 't1,t3,t4')
  s = closeTerminal(s, A, 't1')
  s = addTerminal(s, A)
  check('recicla también el 1', nombres(s) === 'Local (3),Local (2),Local', nombres(s))
}

console.log('\n[11] renameTerminal')
{
  const base: ShellTerminalsState = addTerminal(ensureProject(initialShellTerminalsState, A), A)
  const nombre = (st: ShellTerminalsState, id: string): string =>
    terminalName(st[A].list.find((t) => t.id === id)!, true)

  const r1 = renameTerminal(base, A, 't2', '  dev server  ')
  check('renombra y recorta espacios', nombre(r1, 't2') === 'dev server', nombre(r1, 't2'))
  check('no toca a las demás', nombre(r1, 't1') === 'Local')

  const r2 = renameTerminal(r1, A, 't2', '   ')
  check('un nombre en blanco DEVUELVE el automático', nombre(r2, 't2') === 'Local (2)', nombre(r2, 't2'))

  const r3 = renameTerminal(base, A, 't2', 'Local (2)')
  check(
    'escribir justo el automático no lo materializa (sigue siguiendo al modo)',
    r3[A].list[1].nombre === undefined && terminalName(r3[A].list[1], false) === 'Docker (2)'
  )

  // La trampa que abría comparar solo contra el modo VIGENTE: en Docker, escribir
  // "Local (2)" no coincidía con "Docker (2)", se guardaba como nombre propio y esa
  // pestaña quedaba clavada mientras sus hermanas seguían al modo.
  const r4 = renameTerminal(base, A, 't2', 'Docker (2)')
  check(
    'tampoco materializa el automático del OTRO modo',
    r4[A].list[1].nombre === undefined && terminalName(r4[A].list[1], true) === 'Local (2)',
    String(r4[A].list[1].nombre)
  )

  check('renombrar con el mismo valor es no-op (identidad estable)', renameTerminal(r1, A, 't2', 'dev server') === r1)
  check('id inexistente: no-op', renameTerminal(base, A, 'tX', 'x') === base)
  check('proyecto inexistente: no-op', renameTerminal(base, 'nadie', 't1', 'x') === base)

  const antes = JSON.stringify(base)
  renameTerminal(base, A, 't2', 'otro')
  check('no muta la entrada', JSON.stringify(base) === antes)
}

console.log(
  fallos === 0 ? '\n✅ shellTerminalsModel: todo verde\n' : `\n❌ ${fallos} fallo(s)\n`
)
process.exit(fallos === 0 ? 0 : 1)
