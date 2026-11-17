#!/usr/bin/env node
// =============================================================================
// Prueba del modelo puro de la lista de terminales por proyecto.
// (node src/renderer/src/features/terminales/test-terminales-shell.mts)
// Cubre asegurarProyecto (idempotente, no resucita), anadirTerminal, ids únicos y nunca
// reutilizados, sucesión al cerrar, selección, poda, aislamiento entre proyectos,
// inmutabilidad, nombres y reciclaje del número visible.
// =============================================================================

import {
  estadoInicialTerminalesShell,
  claveProyectoTerminal,
  nombreTerminal,
  asegurarProyecto,
  anadirTerminal,
  cerrarTerminal,
  seleccionarTerminal,
  renombrarTerminal,
  podarProyectosTerminales,
  type EstadoTerminalesShell
} from './modeloTerminalesShell.ts'

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
function ids(s: EstadoTerminalesShell, k: string): string {
  return (s[k]?.lista ?? []).map((t) => t.id).join(',')
}

const A = claveProyectoTerminal('perfil-1', 'D:\\repos\\app')
const B = claveProyectoTerminal('perfil-2', 'D:\\repos\\otro')

console.log('\n[1] asegurarProyecto')
{
  const s = asegurarProyecto(estadoInicialTerminalesShell, A)
  check('crea el proyecto con UNA terminal', ids(s, A) === 't1')
  check('y la deja activa', s[A].activoId === 't1')
  check('siguienteOrdinal avanzó a 2', s[A].siguienteOrdinal === 2)

  const s2 = asegurarProyecto(s, A)
  check('es idempotente (mismo objeto, no duplica)', s2 === s)

  // (3) NO resucita: si cerraste la última a mano, el proyecto se queda en cero.
  const vacio = cerrarTerminal(s, A, 't1')
  const s3 = asegurarProyecto(vacio, A)
  check('no resucita una lista vaciada a mano', s3 === vacio && s3[A].lista.length === 0)
}

console.log('\n[2] anadirTerminal')
{
  let s = asegurarProyecto(estadoInicialTerminalesShell, A)
  s = anadirTerminal(s, A)
  check('añade al FINAL', ids(s, A) === 't1,t2')
  check('la nueva queda ACTIVA', s[A].activoId === 't2')
  s = anadirTerminal(s, A)
  check('tercera terminal', ids(s, A) === 't1,t2,t3' && s[A].activoId === 't3')
}

console.log('\n[3] ids únicos, nunca reutilizados')
{
  let s = asegurarProyecto(estadoInicialTerminalesShell, A) // t1
  s = anadirTerminal(s, A) // t2
  s = anadirTerminal(s, A) // t3
  s = cerrarTerminal(s, A, 't2') // cierro la de en medio
  s = anadirTerminal(s, A) // debe ser t4, NO t2
  check('el id cerrado NO se recicla', ids(s, A) === 't1,t3,t4', ids(s, A))
  check('siguienteOrdinal es monótono', s[A].siguienteOrdinal === 5)
}

console.log('\n[4] cerrarTerminal: sucesión de la activa')
{
  let base = asegurarProyecto(estadoInicialTerminalesShell, A)
  base = anadirTerminal(base, A) // t2
  base = anadirTerminal(base, A) // t3  (activa)

  // (6) cerrar la activa de EN MEDIO -> sucede la de la derecha
  const s1 = cerrarTerminal(seleccionarTerminal(base, A, 't2'), A, 't2')
  check('cerrar la activa de en medio -> sucede la DERECHA', s1[A].activoId === 't3', String(s1[A].activoId))

  // (7) cerrar la activa que es la ÚLTIMA -> sucede la de la izquierda
  const s2 = cerrarTerminal(base, A, 't3') // t3 era la activa y la última
  check('cerrar la última activa -> sucede la IZQUIERDA', s2[A].activoId === 't2', String(s2[A].activoId))

  // (8) cerrar una NO activa no toca la activa
  const s3 = cerrarTerminal(base, A, 't1')
  check('cerrar una NO activa deja la activa intacta', s3[A].activoId === 't3' && ids(s3, A) === 't2,t3')

  // (9) cerrar la única
  const sola = asegurarProyecto(estadoInicialTerminalesShell, B)
  const s4 = cerrarTerminal(sola, B, 't1')
  check('cerrar la única -> lista vacía y activoId null', s4[B].lista.length === 0 && s4[B].activoId === null)

  // (10) no-ops
  check('cerrar un id inexistente es no-op', cerrarTerminal(base, A, 'tX') === base)
  check('cerrar en un proyecto inexistente es no-op', cerrarTerminal(base, 'nadie', 't1') === base)
}

console.log('\n[5] seleccionarTerminal')
{
  let s = asegurarProyecto(estadoInicialTerminalesShell, A)
  s = anadirTerminal(s, A) // t2 activa
  const sel = seleccionarTerminal(s, A, 't1')
  check('cambia la activa', sel[A].activoId === 't1')
  check('id inexistente: no-op', seleccionarTerminal(s, A, 'tX') === s)
  check('ya activa: no-op (identidad estable)', seleccionarTerminal(sel, A, 't1') === sel)
}

console.log('\n[6] podarProyectosTerminales')
{
  let s = asegurarProyecto(estadoInicialTerminalesShell, A)
  s = asegurarProyecto(s, B)
  const podado = podarProyectosTerminales(s, [A])
  check('olvida el proyecto cerrado', podado[B] === undefined && podado[A] !== undefined)
  check('conserva el abierto intacto', podado[A] === s[A])
  check('sin nada que podar: MISMO objeto (no re-render)', podarProyectosTerminales(s, [A, B]) === s)
  check('poda a vacío', Object.keys(podarProyectosTerminales(s, [])).length === 0)
}

console.log('\n[7] aislamiento entre proyectos')
{
  // El bug original: una sola terminal global. Aquí cada proyecto lleva su lista y
  // su activa; tocar uno no puede alterar el otro.
  let s = asegurarProyecto(estadoInicialTerminalesShell, A)
  s = asegurarProyecto(s, B)
  s = anadirTerminal(s, A)
  s = anadirTerminal(s, A)
  check('A tiene 3 y B sigue con 1', ids(s, A) === 't1,t2,t3' && ids(s, B) === 't1')
  check('la activa de B no se movió', s[B].activoId === 't1')
  const antesB = s[B]
  s = cerrarTerminal(s, A, 't1')
  check('cerrar en A no toca el objeto de B', s[B] === antesB)
}

console.log('\n[8] inmutabilidad')
{
  let s = asegurarProyecto(estadoInicialTerminalesShell, A)
  s = anadirTerminal(s, A)
  const foto = JSON.stringify(s)
  anadirTerminal(s, A)
  cerrarTerminal(s, A, 't1')
  seleccionarTerminal(s, A, 't1')
  asegurarProyecto(s, B)
  podarProyectosTerminales(s, [])
  check('ninguna acción muta la entrada', JSON.stringify(s) === foto)
}

console.log('\n[9] nombres y claves')
{
  const t1 = { id: 't1', n: 1, indice: 1 }
  const t2 = { id: 't2', n: 2, indice: 2 }
  check('la PRIMERA no lleva número', nombreTerminal(t1) === 'Local', nombreTerminal(t1))
  check('la segunda sí', nombreTerminal(t2) === 'Local (2)', nombreTerminal(t2))
  check('un nombre a mano gana al de por defecto', nombreTerminal({ ...t2, nombre: 'dev server' }) === 'dev server')
  check(
    'clave de proyecto = perfil|ruta',
    claveProyectoTerminal('p1', 'D:\\x') === 'p1|D:\\x'
  )
}

console.log('\n[10] el número de la pestaña SE RECICLA (a diferencia del id)')
{
  let s: EstadoTerminalesShell = asegurarProyecto(estadoInicialTerminalesShell, A)
  s = anadirTerminal(s, A)
  s = anadirTerminal(s, A)
  const nombres = (st: EstadoTerminalesShell): string =>
    st[A].lista.map((t) => nombreTerminal(t)).join(',')
  check('tres seguidas', nombres(s) === 'Local,Local (2),Local (3)', nombres(s))
  s = cerrarTerminal(s, A, 't2') // cierra "Local (2)"
  s = anadirTerminal(s, A)
  check('la nueva OCUPA el hueco libre más bajo', nombres(s) === 'Local,Local (3),Local (2)', nombres(s))
  check('pero su id sigue siendo nuevo', s[A].lista.map((t) => t.id).join(',') === 't1,t3,t4')
  s = cerrarTerminal(s, A, 't1')
  s = anadirTerminal(s, A)
  check('recicla también el 1', nombres(s) === 'Local (3),Local (2),Local', nombres(s))
}

console.log('\n[11] renombrarTerminal')
{
  const base: EstadoTerminalesShell = anadirTerminal(asegurarProyecto(estadoInicialTerminalesShell, A), A)
  const nombre = (st: EstadoTerminalesShell, id: string): string =>
    nombreTerminal(st[A].lista.find((t) => t.id === id)!)

  const r1 = renombrarTerminal(base, A, 't2', '  dev server  ')
  check('renombra y recorta espacios', nombre(r1, 't2') === 'dev server', nombre(r1, 't2'))
  check('no toca a las demás', nombre(r1, 't1') === 'Local')

  const r2 = renombrarTerminal(r1, A, 't2', '   ')
  check('un nombre en blanco DEVUELVE el automático', nombre(r2, 't2') === 'Local (2)', nombre(r2, 't2'))

  const r3 = renombrarTerminal(base, A, 't2', 'Local (2)')
  check(
    'escribir justo el automático no lo materializa (sigue siguiendo al índice)',
    r3[A].lista[1].nombre === undefined && nombreTerminal(r3[A].lista[1]) === 'Local (2)'
  )

  check('renombrar con el mismo valor es no-op (identidad estable)', renombrarTerminal(r1, A, 't2', 'dev server') === r1)
  check('id inexistente: no-op', renombrarTerminal(base, A, 'tX', 'x') === base)
  check('proyecto inexistente: no-op', renombrarTerminal(base, 'nadie', 't1', 'x') === base)

  const antes = JSON.stringify(base)
  renombrarTerminal(base, A, 't2', 'otro')
  check('no muta la entrada', JSON.stringify(base) === antes)
}

console.log(
  fallos === 0 ? '\n✅ modeloTerminalesShell: todo verde\n' : `\n❌ ${fallos} fallo(s)\n`
)
process.exit(fallos === 0 ? 0 : 1)
