#!/usr/bin/env node
// =============================================================================
// Prueba de reorderByDrag y gruposRiel (node src/renderer/src/util/test-reorder-by-drag.mts).
// Cubre la semántica direccional (izquierda inserta antes, derecha después), los no-ops y, desde
// la sección (7), mover un icono de un grupo del riel al otro: son las dos mitades de la misma
// interacción y se prueban juntas. La (12) fija que la raya del arrastre (`ladoDeSoltar`) coincide
// con lo que hará el soltar. Dependen de `reorderByDrag.ts` y `gruposRiel.ts`, puros.
// =============================================================================

import { ladoDeSoltar, reorderByDrag } from './reorderByDrag.ts'
import { moverEntreGrupos } from './gruposRiel.ts'
// `normalizarParticion` vive en `shared` porque es saneado del ARCHIVO de
// ajustes, pero se prueba aquí: es la otra mitad de la misma interacción y sin
// ella el icono movido volvería a su grupo en el siguiente arranque.
import { normalizarParticion } from '../../../shared/workspace-state-ipc.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const eq = (a: string[] | null, b: string[] | null): boolean => JSON.stringify(a) === JSON.stringify(b)

const base = ['a', 'b', 'c', 'd']

// Mover a la DERECHA (a sobre c): inserta DESPUÉS del destino -> b,c,a,d.
check('(1) mover a la derecha inserta DESPUÉS', eq(reorderByDrag(base, 'a', 'c'), ['b', 'c', 'a', 'd']), `${JSON.stringify(reorderByDrag(base, 'a', 'c'))}`)

// Mover a la IZQUIERDA (d sobre b): inserta ANTES del destino -> a,d,b,c.
check('(2) mover a la izquierda inserta ANTES', eq(reorderByDrag(base, 'd', 'b'), ['a', 'd', 'b', 'c']), `${JSON.stringify(reorderByDrag(base, 'd', 'b'))}`)

// Soltar sobre el vecino inmediato a la derecha (a sobre b): b,a,c,d (NO no-op).
check('(3) sobre el vecino de la derecha SÍ mueve', eq(reorderByDrag(base, 'a', 'b'), ['b', 'a', 'c', 'd']), `${JSON.stringify(reorderByDrag(base, 'a', 'b'))}`)

// Soltar sobre sí mismo => null (sin cambio).
check('(4) sobre sí mismo => null', reorderByDrag(base, 'a', 'a') === null, `${reorderByDrag(base, 'a', 'a')}`)

// Id inexistente => null.
check('(5) id desconocido => null', reorderByDrag(base, 'x', 'b') === null && reorderByDrag(base, 'a', 'x') === null, 'ok')

// No muta el arreglo original.
{
  const copy = [...base]
  reorderByDrag(copy, 'a', 'd')
  check('(6) no muta el arreglo de entrada', eq(copy, base), `${JSON.stringify(copy)}`)
}

// (7) LOS DOS GRUPOS DEL RIEL, ahora que SÍ se puede cruzar.
//
// Este bloque afirmaba lo contrario: que arrastrar de un grupo al otro devolvía
// `null` y por tanto era imposible. Era cierto y era deliberado —el separador
// del riel significaba "los de abajo abren otra cosa"—, pero pasó a ser decisión
// del usuario dónde quiere cada botón. Se REESCRIBE, no se parchea: lo que se
// prueba ahora es que `reorderByDrag` sigue siendo de UNA lista (y por eso
// devuelve null ante un id ajeno, que es correcto), y que cruzar es trabajo de
// `moverEntreGrupos`, que es de dos.
{
  const arriba = ['files', 'git', 'db']
  const abajo = ['terminal', 'gitlog']
  check(
    '(7) reorderByDrag sigue rechazando un id que no es de su lista',
    reorderByDrag(arriba, 'terminal', 'git') === null,
    `${reorderByDrag(arriba, 'terminal', 'git')}`
  )
  check(
    '(7) dentro de su propio grupo SÍ reordena',
    eq(reorderByDrag(abajo, 'terminal', 'gitlog'), ['gitlog', 'terminal']),
    `${JSON.stringify(reorderByDrag(abajo, 'terminal', 'gitlog'))}`
  )
}

// (8) moverEntreGrupos: cruzar de un grupo al otro.
{
  const arriba = ['files', 'git', 'db']
  const abajo = ['terminal', 'gitlog']

  const subido = moverEntreGrupos(abajo, arriba, 'gitlog', 'db')
  check(
    '(8) sube un icono y lo inserta DELANTE del destino',
    eq(subido?.desde ?? null, ['terminal']) &&
      eq(subido?.hasta ?? null, ['files', 'git', 'gitlog', 'db']),
    JSON.stringify(subido)
  )

  const alFinal = moverEntreGrupos(abajo, arriba, 'gitlog', null)
  check(
    '(8) con destino null va al FINAL del grupo (soltar en el hueco)',
    eq(alFinal?.hasta ?? null, ['files', 'git', 'db', 'gitlog']),
    JSON.stringify(alFinal?.hasta)
  )

  const bajado = moverEntreGrupos(arriba, abajo, 'db', 'terminal')
  check(
    '(8) y también baja, con las listas al revés',
    eq(bajado?.desde ?? null, ['files', 'git']) &&
      eq(bajado?.hasta ?? null, ['db', 'terminal', 'gitlog']),
    JSON.stringify(bajado)
  )
}

// (9) LA GUARDA DE PRODUCTO: un grupo no puede quedarse VACÍO.
{
  const soloUno = ['gitlog']
  const arriba = ['files', 'git']
  check(
    '(9) con UN solo icono, arrastrarlo fuera no hace nada',
    moverEntreGrupos(soloUno, arriba, 'gitlog', 'git') === null,
    `${moverEntreGrupos(soloUno, arriba, 'gitlog', 'git')}`
  )
  check(
    '(9) con DOS sí se puede sacar uno',
    moverEntreGrupos(['terminal', 'gitlog'], arriba, 'gitlog', 'git') !== null,
    JSON.stringify(moverEntreGrupos(['terminal', 'gitlog'], arriba, 'gitlog', 'git'))
  )
}

// (10) NO-OPS y no mutación.
{
  const arriba = ['files', 'git']
  const abajo = ['terminal', 'gitlog']
  check(
    '(10) un id que no está en el origen => null',
    moverEntreGrupos(abajo, arriba, 'files', 'git') === null,
    `${moverEntreGrupos(abajo, arriba, 'files', 'git')}`
  )
  check(
    '(10) un destino que no está en el grupo de llegada => null',
    moverEntreGrupos(abajo, arriba, 'gitlog', 'terminal') === null,
    `${moverEntreGrupos(abajo, arriba, 'gitlog', 'terminal')}`
  )
  const copiaA = [...abajo]
  const copiaB = [...arriba]
  moverEntreGrupos(copiaA, copiaB, 'gitlog', 'git')
  check(
    '(10) no muta ninguna de las dos listas de entrada',
    eq(copiaA, abajo) && eq(copiaB, arriba),
    `${JSON.stringify(copiaA)} ${JSON.stringify(copiaB)}`
  )
}

// (11) normalizarParticion: repartir lo guardado al arrancar.
{
  const CANON = ['files', 'git', 'db', 'terminal', 'gitlog']
  const arribaPorDefecto = (id: string): boolean => !['terminal', 'gitlog'].includes(id)

  // EL CASO QUE MOTIVA TODO: el usuario subió `gitlog`. El saneado por grupo lo
  // habría descartado en silencio y el icono habría vuelto abajo al reiniciar.
  const guardado = normalizarParticion(
    ['files', 'gitlog', 'git', 'db'],
    ['terminal'],
    CANON,
    arribaPorDefecto
  )
  check(
    '(11) un icono movido de grupo SOBREVIVE al arranque',
    eq(guardado.arriba, ['files', 'gitlog', 'git', 'db']) &&
      eq(guardado.abajo, ['terminal']),
    JSON.stringify(guardado)
  )

  const conBasura = normalizarParticion(
    ['files', 'files', 'fantasma', 42, 'git'],
    ['terminal', 'gitlog'],
    CANON,
    arribaPorDefecto
  )
  check(
    '(11) descarta duplicados, desconocidos y no-strings',
    eq(conBasura.arriba, ['files', 'git', 'db']),
    JSON.stringify(conBasura.arriba)
  )

  const enDos = normalizarParticion(['files', 'gitlog'], ['gitlog', 'terminal'], CANON, arribaPorDefecto)
  check(
    '(11) un id declarado en LOS DOS grupos se queda en el primero',
    enDos.arriba.includes('gitlog') && !enDos.abajo.includes('gitlog'),
    JSON.stringify(enDos)
  )

  // Un icono NUEVO de una versión futura tiene que aparecer donde su autor lo
  // pensó, no en un cajón común donde el usuario no lo encontraría.
  const faltando = normalizarParticion(['files'], ['terminal'], CANON, arribaPorDefecto)
  check(
    '(11) lo que falta va a su grupo POR DEFECTO',
    eq(faltando.arriba, ['files', 'git', 'db']) &&
      eq(faltando.abajo, ['terminal', 'gitlog']),
    JSON.stringify(faltando)
  )

  const vacio = normalizarParticion(undefined, undefined, CANON, arribaPorDefecto)
  check(
    '(11) sin nada guardado se reparte por defecto',
    eq(vacio.arriba, ['files', 'git', 'db']) && eq(vacio.abajo, ['terminal', 'gitlog']),
    JSON.stringify(vacio)
  )

  // Archivo manipulado a mano: todo en un grupo. El riel no puede amanecer con
  // un lado en blanco, porque no hay forma de deshacerlo desde la interfaz.
  const todoArriba = normalizarParticion(CANON, [], CANON, arribaPorDefecto)
  check(
    '(11) un grupo vacío recibe un icono prestado',
    todoArriba.abajo.length === 1 && todoArriba.arriba.length === CANON.length - 1,
    JSON.stringify(todoArriba)
  )
}

// (12) `ladoDeSoltar`: la raya que se pinta durante el arrastre dice lo mismo que hará
// `reorderByDrag` al soltar. Se recorren TODOS los pares para que no pueda mentir.
{
  check('(12a) a sobre c: la raya va DESPUÉS de c', ladoDeSoltar(base, 'a', 'c') === 'despues', String(ladoDeSoltar(base, 'a', 'c')))
  check('(12b) d sobre b: la raya va ANTES de b', ladoDeSoltar(base, 'd', 'b') === 'antes', String(ladoDeSoltar(base, 'd', 'b')))
  check(
    '(12c) sobre sí mismo o con un id desconocido: sin raya',
    ladoDeSoltar(base, 'b', 'b') === null && ladoDeSoltar(base, 'x', 'b') === null && ladoDeSoltar(base, 'b', 'x') === null,
    'null'
  )
  let coherentes = 0
  const incoherentes: string[] = []
  for (const drag of base) {
    for (const destino of base) {
      const lado = ladoDeSoltar(base, drag, destino)
      const orden = reorderByDrag(base, drag, destino)
      const bien =
        lado === null || orden === null
          ? lado === null && orden === null
          : orden.indexOf(drag) === orden.indexOf(destino) + (lado === 'despues' ? 1 : -1)
      if (bien) coherentes++
      else incoherentes.push(`${drag}->${destino}`)
    }
  }
  check('(12d) en los 16 pares, lo arrastrado queda pegado al destino del lado que dice la raya', incoherentes.length === 0, `${coherentes}/16 ${incoherentes.join(',')}`)
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(60))
console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
