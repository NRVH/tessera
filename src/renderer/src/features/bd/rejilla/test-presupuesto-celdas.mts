#!/usr/bin/env node
// =============================================================================
// Prueba del presupuesto global de celdas (`presupuestoCeldas.ts`, npm run
// test:db-presupuesto-celdas): alta y baja, solo las ocultas y de la menos usada, parar al
// bajar del tope, reentrada sin cuelgues, `cabe` y `alcanzable`, números absurdos y el tope
// GLOBAL con varias consolas y una pestaña de tabla.
// =============================================================================

import { TOPE_CELDAS_MEMORIA } from './celdasRejilla.ts'
import { crearRegistroCeldas, type DuenoRejilla, type RegistroCeldas } from './presupuestoCeldas.ts'

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
const j = (x: unknown): string => JSON.stringify(x)

/** Un dueño de mentira: sus cifras son mutables y cuenta cuántas veces se liberó. */
interface Falso extends DuenoRejilla {
  cifras: { celdas: number; primera: number; visible: boolean; uso: number }
  liberaciones: number
}

function falso(
  id: string,
  cifras: { celdas: number; primera: number; visible?: boolean; uso: number },
  alLiberar?: (yo: Falso) => void
): Falso {
  const yo: Falso = {
    id,
    cifras: { visible: false, ...cifras },
    liberaciones: 0,
    celdas: () => yo.cifras.celdas,
    celdasPrimeraPagina: () => yo.cifras.primera,
    visible: () => yo.cifras.visible,
    ultimoUso: () => yo.cifras.uso,
    liberar: () => {
      yo.liberaciones++
      if (alLiberar) alLiberar(yo)
      else yo.cifras.celdas = Math.min(yo.cifras.celdas, yo.cifras.primera)
    }
  }
  return yo
}

function alta(r: RegistroCeldas, ...ds: Falso[]): Array<() => void> {
  return ds.map((d) => r.registrar(d))
}

hr('(1) registrar y dar de baja')
{
  const r = crearRegistroCeldas(1000)
  const a = falso('a', { celdas: 300, primera: 100, uso: 1 })
  const b = falso('b', { celdas: 200, primera: 100, uso: 2 })
  const [bajaA] = alta(r, a, b)
  check('el total suma a todos los dueños', r.total() === 500, String(r.total()))
  a.cifras.celdas = 400
  check('el total MIDE en cada llamada (no guarda cifras viejas)', r.total() === 600, String(r.total()))
  bajaA()
  check('la baja lo quita', r.total() === 200, String(r.total()))
  bajaA()
  check('la baja es idempotente', r.total() === 200, String(r.total()))
  // Remontaje: un dueño nuevo con el MISMO id sustituye al viejo; la baja tardía del
  // viejo no puede llevarse al nuevo.
  const b2 = falso('b', { celdas: 50, primera: 10, uso: 3 })
  const bajaB2 = r.registrar(b2)
  check('mismo id: sustituye (no suma dos veces)', r.total() === 50, String(r.total()))
  const r2 = crearRegistroCeldas(1000)
  const viejo = falso('x', { celdas: 10, primera: 10, uso: 0 })
  const bajaViejo = r2.registrar(viejo)
  const nuevo = falso('x', { celdas: 20, primera: 10, uso: 0 })
  r2.registrar(nuevo)
  bajaViejo()
  check('NO: la baja del sustituido no quita al nuevo', r2.total() === 20, String(r2.total()))
  bajaB2()
  check('vacío: total 0', r.total() === 0, String(r.total()))
}

hr('(2) bajo el tope no se libera nada')
{
  const r = crearRegistroCeldas(1000)
  const a = falso('a', { celdas: 600, primera: 100, uso: 1 })
  const b = falso('b', { celdas: 400, primera: 100, uso: 2 })
  alta(r, a, b)
  const lib = r.avisar()
  check('justo en el tope: nada', lib.length === 0 && a.liberaciones === 0 && b.liberaciones === 0, j(lib))
}

hr('(3) solo las ocultas, de la menos usada a la más; nunca la visible')
{
  const r = crearRegistroCeldas(1000)
  const visible = falso('visible', { celdas: 700, primera: 100, visible: true, uso: 0 })
  const vieja = falso('vieja', { celdas: 300, primera: 100, uso: 5 })
  const media = falso('media', { celdas: 300, primera: 100, uso: 10 })
  const reciente = falso('reciente', { celdas: 300, primera: 100, uso: 20 })
  alta(r, visible, vieja, media, reciente)
  // total 1600: soltar 'vieja' (-200) deja 1400; 'media' (-200) 1200; 'reciente' 1000.
  const lib = r.avisar()
  check('libera en orden de antigüedad hasta alcanzar', j(lib) === j(['vieja', 'media', 'reciente']), j(lib))
  check('y la visible NO, aunque sea la de uso más antiguo', visible.liberaciones === 0 && visible.cifras.celdas === 700, String(visible.cifras.celdas))
  check('queda en el tope', r.total() === 1000, String(r.total()))

  const r2 = crearRegistroCeldas(1000)
  const sola = falso('sola', { celdas: 5000, primera: 100, visible: true, uso: 0 })
  const chica = falso('chica', { celdas: 100, primera: 100, uso: 0 })
  alta(r2, sola, chica)
  const lib2 = r2.avisar()
  check('NO: la visible sola pasa del tope y nadie la toca', lib2.length === 0 && sola.liberaciones === 0, j(lib2))
  check('NO: una oculta con solo su primera página no es candidata', chica.liberaciones === 0, String(chica.liberaciones))
  check('el estado lo dice: excedido', r2.estado().excedido, j(r2.estado()))

  // La visibilidad se MIDE: la que deja de verse pasa a ser candidata.
  const r3 = crearRegistroCeldas(1000)
  const x = falso('x', { celdas: 900, primera: 100, visible: true, uso: 1 })
  const y = falso('y', { celdas: 900, primera: 100, visible: false, uso: 2 })
  alta(r3, x, y)
  r3.avisar()
  check('con x visible, se suelta y', y.liberaciones === 1 && x.liberaciones === 0, `x=${x.liberaciones} y=${y.liberaciones}`)
  x.cifras.visible = false
  y.cifras.visible = true
  y.cifras.celdas = 900
  r3.avisar()
  check('al cambiar de pestaña, se suelta x', x.liberaciones === 1 && y.liberaciones === 1, `x=${x.liberaciones} y=${y.liberaciones}`)
}

hr('(4) se para en cuanto baja del tope')
{
  // El plan previo (con las cifras de antes) pediría soltar 'a' (-5) y 'b' (-30), pero
  // el liberar REAL de 'a' suelta todo: con eso ya se baja y 'b' no se toca.
  const r = crearRegistroCeldas(100)
  const v = falso('v', { celdas: 60, primera: 10, visible: true, uso: 0 })
  const a = falso('a', { celdas: 30, primera: 25, uso: 1 }, (yo) => {
    yo.cifras.celdas = 0
  })
  const b = falso('b', { celdas: 30, primera: 0, uso: 2 })
  alta(r, v, a, b)
  const lib = r.avisar()
  check('solo la primera: tras ella ya se está bajo el tope', j(lib) === j(['a']) && b.liberaciones === 0, j(lib))
  check('total bajo el tope', r.total() <= 100, String(r.total()))
}

hr('(5) reentrada')
{
  // (5a) liberar() llama a avisar() (lo que hace un dueño de React que despacha).
  const r = crearRegistroCeldas(1000)
  let anidadas = 0
  const v = falso('v', { celdas: 800, primera: 100, visible: true, uso: 0 })
  const a = falso('a', { celdas: 500, primera: 100, uso: 1 }, (yo) => {
    yo.cifras.celdas = yo.cifras.primera
    anidadas++
    const dentro = r.avisar()
    if (dentro.length !== 0) anidadas += 100
  })
  const b = falso('b', { celdas: 500, primera: 100, uso: 2 })
  alta(r, v, a, b)
  const lib = r.avisar()
  check(
    '(5a) un avisar() anidado no hace nada y el de fuera ve el cambio',
    anidadas === 1 && j(lib) === j(['a', 'b']) && r.total() === 1000,
    `anidadas=${anidadas} lib=${j(lib)} total=${r.total()}`
  )
  check('(5a) cada una se liberó UNA vez', a.liberaciones === 1 && b.liberaciones === 1, `a=${a.liberaciones} b=${b.liberaciones}`)

  // (5b) liberar() da de baja al propio dueño (la pestaña se cierra al soltar).
  const r2 = crearRegistroCeldas(100)
  let bajaC: () => void = () => undefined
  const c = falso('c', { celdas: 150, primera: 10, uso: 1 }, () => bajaC())
  const d = falso('d', { celdas: 20, primera: 10, uso: 2 })
  bajaC = r2.registrar(c)
  r2.registrar(d)
  const lib2 = r2.avisar()
  check('(5b) un dueño que se da de baja al soltar: sale del total y no se repite', j(lib2) === j(['c']) && r2.total() === 20, `${j(lib2)} total=${r2.total()}`)

  // (5c) un dueño que no puede soltar (p. ej. recargando): se intenta una vez y se
  // sigue con el siguiente, sin bucle infinito.
  const r3 = crearRegistroCeldas(100)
  const terca = falso('terca', { celdas: 200, primera: 10, uso: 1 }, () => undefined)
  const docil = falso('docil', { celdas: 50, primera: 10, uso: 2 })
  alta(r3, terca, docil)
  const lib3 = r3.avisar()
  check('(5c) la que no suelta se intenta UNA vez y se sigue', terca.liberaciones === 1 && docil.liberaciones === 1 && j(lib3) === j(['terca', 'docil']), j(lib3))

  // (5d) un liberar que lanza no impide a los demás, ni deja el registro bloqueado.
  const r4 = crearRegistroCeldas(100)
  const rota = falso('rota', { celdas: 200, primera: 10, uso: 1 }, () => {
    throw new Error('boom')
  })
  const sana = falso('sana', { celdas: 200, primera: 10, uso: 2 })
  alta(r4, rota, sana)
  let lanzo = false
  try {
    r4.avisar()
  } catch {
    lanzo = true
  }
  check('(5d) un liberar que lanza no rompe el equilibrado', !lanzo && sana.liberaciones === 1, `lanzo=${lanzo} sana=${sana.liberaciones}`)
  rota.cifras.celdas = 10
  sana.cifras.celdas = 300
  const lib4 = r4.avisar()
  check('(5d) …ni deja el registro bloqueado para la siguiente vez', j(lib4) === j(['sana']), j(lib4))
}

hr('(6) cabe(extra)')
{
  const r = crearRegistroCeldas(1000)
  const v = falso('v', { celdas: 600, primera: 100, visible: true, uso: 0 })
  const oculta = falso('oculta', { celdas: 300, primera: 100, uso: 1 })
  alta(r, v, oculta)
  check('(6a) hay sitio: cabe y no se libera nada', r.cabe(100) && oculta.liberaciones === 0, String(r.total()))
  check('(6b) liberando la oculta cabe: cabe', r.cabe(250) && oculta.liberaciones === 1 && r.total() + 250 <= 1000, `total=${r.total()}`)

  const r2 = crearRegistroCeldas(1000)
  const v2 = falso('v2', { celdas: 950, primera: 100, visible: true, uso: 0 })
  const oculta2 = falso('oculta2', { celdas: 300, primera: 100, uso: 1 })
  alta(r2, v2, oculta2)
  // Mínimo alcanzable: 950 + 100 = 1050 > 1000 - 100: soltar la oculta no daría sitio.
  const cabe = r2.cabe(100)
  check('(6c) NO: si ni soltando todo cabría, no cabe…', !cabe, `total=${r2.total()}`)
  check('(6c) …y NO se tira el trabajo de nadie para nada', oculta2.liberaciones === 0, String(oculta2.liberaciones))
  check('(6d) un extra negativo o absurdo cuenta como 0', crearRegistroCeldas(10).cabe(Number.NaN) && crearRegistroCeldas(10).cabe(-5), 'ok')
  check('(6e) NO: un extra mayor que el tope no cabe nunca', !crearRegistroCeldas(10).cabe(11), 'extra 11 > 10')
}

hr('(6b) alcanzable(): lo que cabría soltando las ocultas, SIN soltar nada')
{
  const r = crearRegistroCeldas(1000)
  const v = falso('v', { celdas: 600, primera: 100, visible: true, uso: 0 })
  const oculta = falso('oculta', { celdas: 300, primera: 100, uso: 1 })
  alta(r, v, oculta)
  // Mínimo alcanzable: 600 (visible entera) + 100 (primera página de la oculta) = 700.
  check('(6f) cuenta las visibles enteras y las ocultas con su primera página', r.alcanzable() === 300, String(r.alcanzable()))
  check('(6f) …y no libera a nadie al calcularlo', oculta.liberaciones === 0 && r.total() === 900, `total=${r.total()}`)
  check('(6g) lo alcanzable es exactamente lo que cabe acepta', r.cabe(r.alcanzable()) && oculta.liberaciones === 1, `total=${r.total()}`)
  const lleno = crearRegistroCeldas(100)
  alta(lleno, falso('grande', { celdas: 150, primera: 10, visible: true, uso: 0 }))
  check('(6h) pasado del tope por la visible: 0, nunca negativo', lleno.alcanzable() === 0, String(lleno.alcanzable()))
  check('(6i) vacío: todo el tope', crearRegistroCeldas(50).alcanzable() === 50, 'ok')
}

hr('(7) números absurdos y estado')
{
  const r = crearRegistroCeldas(100)
  const rara = falso('rara', { celdas: Number.NaN, primera: -3, uso: Number.NaN })
  const negativa = falso('negativa', { celdas: -50, primera: 0, uso: 0 })
  const normal = falso('normal', { celdas: 40, primera: 10, uso: 1 })
  alta(r, rara, negativa, normal)
  check('NaN y negativos cuentan como 0', r.total() === 40, String(r.total()))
  const e = r.estado()
  check('estado(): usadas, tope y restantes', e.usadas === 40 && e.tope === 100 && e.restantes === 60 && !e.excedido, j(e))
  check('avisar() con cifras raras no libera nada ni lanza', r.avisar().length === 0, 'ok')
}

hr('(8) el tope es GLOBAL: muchas consolas y pestañas de tabla contra los 2 M reales')
{
  // El tope NO se cuenta por consola: aquí se fija con el
  // tope REAL y con los ids que ponen los dueños de verdad (`consola:<instancia>:<res>`
  // en useConsola, uno por pestaña de tabla en DbDatosPane). Cada consola, sola, está
  // por DEBAJO del tope; juntas, por encima. Contado por consola, nadie soltaría nada.
  const r = crearRegistroCeldas()
  const consolaA1 = falso('consola:A:r1', { celdas: 600_000, primera: 5_000, uso: 1 })
  const consolaA2 = falso('consola:A:r2', { celdas: 300_000, primera: 5_000, uso: 5 })
  const consolaB1 = falso('consola:B:r1', { celdas: 700_000, primera: 5_000, uso: 2 })
  const consolaC1 = falso('consola:C:r1', { celdas: 800_000, primera: 5_000, uso: 9, visible: true })
  const tabla = falso('tabla:HR.EMPLEADOS', { celdas: 400_000, primera: 5_000, uso: 3 })
  alta(r, consolaA1, consolaA2, consolaB1, consolaC1, tabla)
  const porConsola = [900_000, 700_000, 800_000]
  check(
    '(8a) cada consola por separado cabe en el tope; la suma de todo, no',
    r.tope === TOPE_CELDAS_MEMORIA && porConsola.every((n) => n < r.tope) && r.total() === 2_800_000,
    `tope=${r.tope} total=${r.total()}`
  )
  const lib = r.avisar()
  check(
    '(8b) se sueltan las ocultas menos usadas DE CUALQUIER consola o tabla, en orden de antigüedad',
    j(lib) === j(['consola:A:r1', 'consola:B:r1']),
    j(lib)
  )
  check('(8c) y queda por debajo del tope GLOBAL', r.total() <= r.tope, String(r.total()))
  check(
    '(8d) la visible (la consola que se mira) y las más recientes no se tocan',
    consolaC1.liberaciones === 0 && consolaA2.liberaciones === 0 && tabla.liberaciones === 0,
    `C=${consolaC1.liberaciones} A2=${consolaA2.liberaciones} tabla=${tabla.liberaciones}`
  )
  // «Cargar más» en la consola visible pregunta al MISMO registro: cuenta lo de las demás.
  // Tras (8b) quedan 1,51 M; una página de 600 000 celdas no cabe sin soltar nada.
  const pagina = 1_000 * 600
  const cabia = r.cabe(pagina)
  check(
    '(8e) «cargar más» de una consola pregunta por el total de TODAS: suelta otra oculta si así cabe',
    cabia && tabla.liberaciones === 1 && r.total() + pagina <= r.tope,
    `cabe=${cabia} total=${r.total()} tabla=${tabla.liberaciones}`
  )
}

const pasados = results.filter((r) => r.pass).length
const allPass = pasados === results.length
console.log(`\nVEREDICTO: ${pasados}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
