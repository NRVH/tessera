#!/usr/bin/env node
// =============================================================================
// Prueba de «Traer todas» (`traerTodas.ts`) contra el registro de celdas DE VERDAD, no un
// doble (npm run test:db-rejilla-traer-todas): el tamaño de cada página, un bucle simulado
// que nunca pasa del tope, los textos, que Detener no pierde el lector y reanudar tras el tope
// al bajar las filas por página.
// =============================================================================

import {
  filasSiguientePagina,
  siguientePaso,
  motivoTopeTraerTodas,
  textoTrayendo,
  motivoSinTraerTodas,
  reanudarTrasTope,
  trasFalloPagina,
  type MedidorCeldas
} from './traerTodas.ts'
import { crearRegistroCeldas, type DuenoRejilla } from './presupuestoCeldas.ts'
import { TOPE_CELDAS_MEMORIA } from './celdasRejilla.ts'
import { DB_PAGINA_MAX, type DbMotivoError } from '../../../../../shared/db-explorador-ipc.ts'

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
const NBSP = String.fromCharCode(160)

/** Una rejilla de mentira con cifras mutables. */
function dueno(id: string, cifras: { celdas: number; primera: number; visible: boolean }): DuenoRejilla & { cifras: typeof cifras; liberaciones: number } {
  const d = {
    id,
    cifras,
    liberaciones: 0,
    celdas: () => d.cifras.celdas,
    celdasPrimeraPagina: () => d.cifras.primera,
    visible: () => d.cifras.visible,
    ultimoUso: () => 0,
    liberar: () => {
      d.liberaciones++
      d.cifras.celdas = Math.min(d.cifras.celdas, d.cifras.primera)
    }
  }
  return d
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) filasSiguientePagina')
  // -------------------------------------------------------------------------
  {
    const r = crearRegistroCeldas(1000)
    const yo = dueno('yo', { celdas: 100, primera: 100, visible: true })
    r.registrar(yo)
    check('(1a) cabe entera: la página máxima', filasSiguientePagina(r, 10, 50) === 50, String(filasSiguientePagina(r, 10, 50)))
    check('(1b) no cabe entera: las que quepan (900 libres / 10 columnas = 90)', filasSiguientePagina(r, 10, 500) === 90, String(filasSiguientePagina(r, 10, 500)))
    yo.cifras.celdas = 1000
    check('(1c) al tope: 0', filasSiguientePagina(r, 10, 500) === 0, '0')
    yo.cifras.celdas = 995
    check('(1d) quedan menos celdas que una fila: 0 (no se pide media fila)', filasSiguientePagina(r, 10, 500) === 0, '0')
  }
  {
    const r = crearRegistroCeldas(1000)
    const yo = dueno('yo', { celdas: 500, primera: 100, visible: true })
    const oculta = dueno('oculta', { celdas: 400, primera: 100, visible: false })
    r.registrar(yo)
    r.registrar(oculta)
    check('(1e) sin soltar nada caben 10 filas de 10: no se suelta a nadie', filasSiguientePagina(r, 10, 10) === 10 && oculta.liberaciones === 0, `lib=${oculta.liberaciones}`)
    const n = filasSiguientePagina(r, 10, 500)
    check('(1f) si hace falta, suelta la oculta y cuenta con su sitio (400 libres = 40 filas)', n === 40 && oculta.liberaciones === 1, `n=${n} lib=${oculta.liberaciones}`)
  }
  {
    const cuenta = { cabe: 0 }
    const falso: MedidorCeldas = {
      cabe: () => {
        cuenta.cabe++
        return true
      },
      alcanzable: () => Number.NaN
    }
    check('(1g) un alcanzable absurdo cuenta como 0 y no se pregunta a cabe', filasSiguientePagina(falso, 10) === 0 && cuenta.cabe === 0, j(cuenta))
    const libre: MedidorCeldas = { cabe: () => true, alcanzable: () => 1e12 }
    check('(1h) columnas 0 o NaN cuentan como 1', filasSiguientePagina(libre, 0, 7) === 7 && filasSiguientePagina(libre, Number.NaN, 7) === 7, 'ok')
    check('(1i) por defecto, páginas de DB_PAGINA_MAX (5000)', filasSiguientePagina(libre, 3) === DB_PAGINA_MAX && DB_PAGINA_MAX === 5000, String(DB_PAGINA_MAX))
    const tacano: MedidorCeldas = { cabe: () => false, alcanzable: () => 1000 }
    check('(1j) si cabe dice que no (un dueño que no suelta), 0', filasSiguientePagina(tacano, 1) === 0, '0')
  }

  // -------------------------------------------------------------------------
  hr('(2) siguientePaso')
  // -------------------------------------------------------------------------
  {
    const libre: MedidorCeldas = { cabe: () => true, alcanzable: () => 1e12 }
    const lleno: MedidorCeldas = { cabe: () => true, alcanzable: () => 0 }
    check('(2a) detenido manda sobre todo', j(siguientePaso({ hayMas: true, detenido: true, columnas: 3 }, libre)) === j({ tipo: 'detenido' }), 'detenido')
    check('(2b) sin más: completo (aunque no quepa nada)', j(siguientePaso({ hayMas: false, detenido: false, columnas: 3 }, lleno)) === j({ tipo: 'completo' }), 'completo')
    check('(2c) con más y sitio: pedir', j(siguientePaso({ hayMas: true, detenido: false, columnas: 3 }, libre, 800)) === j({ tipo: 'pedir', filas: 800 }), 'pedir')
    check('(2d) con más y sin sitio: tope', j(siguientePaso({ hayMas: true, detenido: false, columnas: 3 }, lleno)) === j({ tipo: 'tope' }), 'tope')
  }

  // -------------------------------------------------------------------------
  hr('(3) el bucle entero con el tope de la app')
  // -------------------------------------------------------------------------
  {
    // 23 456 filas × 200 columnas = 4,7 M celdas: no cabe en los 2 M de la app.
    const COLS = 200
    const TABLA = 23_456
    const r = crearRegistroCeldas() // tope real: 2 M celdas
    const yo = dueno('pestana', { celdas: 500 * COLS, primera: 500 * COLS, visible: true })
    const otra = dueno('otra-oculta', { celdas: 300_000, primera: 20_000, visible: false })
    r.registrar(yo)
    r.registrar(otra)
    let cargadas = 500
    let maxTotal = r.total()
    let vueltas = 0
    let final = ''
    for (; vueltas < 100; vueltas++) {
      const paso = siguientePaso({ hayMas: cargadas < TABLA, detenido: false, columnas: COLS }, r)
      if (paso.tipo !== 'pedir') {
        final = paso.tipo
        break
      }
      // El servidor devuelve como mucho lo que queda.
      const llegan = Math.min(paso.filas, TABLA - cargadas)
      cargadas += llegan
      yo.cifras.celdas = cargadas * COLS
      maxTotal = Math.max(maxTotal, r.total())
    }
    check('(3a) nunca se pasa del tope de memoria', maxTotal <= TOPE_CELDAS_MEMORIA, `máximo ${maxTotal} <= ${TOPE_CELDAS_MEMORIA}`)
    check('(3b) acaba en «tope» (la tabla no cabe entera)', final === 'tope', final)
    // 2 M − 20 000 (la primera página que la oculta conserva) = 1 980 000 / 200 = 9900 filas.
    check('(3b2) con la cifra justa: 9900 filas', cargadas === 9900, String(cargadas))
    check('(3c) la oculta soltó lo suyo para hacer sitio, una vez', otra.liberaciones === 1, String(otra.liberaciones))
    check('(3d) llenó hasta donde cabía: el sitio que queda es menos de una fila', TOPE_CELDAS_MEMORIA - r.total() < COLS, `quedan ${TOPE_CELDAS_MEMORIA - r.total()} celdas`)
    check('(3e) sin bucles de más', vueltas < 20, `${vueltas} vueltas`)
  }
  {
    const COLS = 40
    const TABLA = 12_345
    const r = crearRegistroCeldas()
    const yo = dueno('pestana', { celdas: 500 * COLS, primera: 500 * COLS, visible: true })
    r.registrar(yo)
    let cargadas = 500
    let final = ''
    const pedidas: number[] = []
    for (let v = 0; v < 100; v++) {
      const paso = siguientePaso({ hayMas: cargadas < TABLA, detenido: false, columnas: COLS }, r)
      if (paso.tipo !== 'pedir') {
        final = paso.tipo
        break
      }
      pedidas.push(paso.filas)
      cargadas += Math.min(paso.filas, TABLA - cargadas)
      yo.cifras.celdas = cargadas * COLS
    }
    check('(3f) una tabla que cabe acaba en «completo» con todas las filas', final === 'completo' && cargadas === TABLA, `${final} ${cargadas}`)
    check('(3g) en páginas de 5000 (3 viajes para 11 845 filas)', j(pedidas) === j([5000, 5000, 5000]), j(pedidas))
  }

  // -------------------------------------------------------------------------
  hr('(4) textos')
  // -------------------------------------------------------------------------
  check(
    '(4a) el motivo del tope dice cuántas y qué hacer',
    motivoTopeTraerTodas(49500) === `Se trajeron 49${NBSP}500 filas; el resto no cabe en memoria: expórtalo a archivo`,
    motivoTopeTraerTodas(49500)
  )
  check('(4b) singular', motivoTopeTraerTodas(1).startsWith('Se trajeron 1 fila;'), motivoTopeTraerTodas(1))
  check('(4c) la píldora mientras trae', textoTrayendo(12500) === `Trayendo filas… 12${NBSP}500`, textoTrayendo(12500))
  const base = { hayDatos: true, hayMas: true, trayendo: false, sinLector: null }
  check('(4d) se puede', motivoSinTraerTodas(base) === null, 'null')
  check('(4e) sin datos', motivoSinTraerTodas({ ...base, hayDatos: false }) === 'Todavía no hay datos', 'ok')
  check('(4f) ya trayendo', motivoSinTraerTodas({ ...base, trayendo: true }) === 'Ya se están trayendo todas las filas', 'ok')
  check('(4g) sin más', motivoSinTraerTodas({ ...base, hayMas: false }) === 'Ya están todas las filas cargadas', 'ok')
  check('(4h) sin lector: su motivo', motivoSinTraerTodas({ ...base, sinLector: 'Se perdió la sesión' }) === 'Se perdió la sesión', 'ok')

  // -------------------------------------------------------------------------
  hr('(5) trasFalloPagina: Detener no es perder el lector')
  // -------------------------------------------------------------------------
  {
    const cancelada = { motivo: 'cancelada' as const }
    check(
      '(5a) Detener de «Traer todas»: seguir (ni motivo en la píldora, ni aviso, ni soltar el lector)',
      trasFalloPagina(cancelada, 'traerTodas') === 'seguir',
      trasFalloPagina(cancelada, 'traerTodas')
    )
    check(
      '(5b) Detener de una página AL DESPLAZAR: se dice (la rejilla no vuelve a pedir sola), pero no es un lector perdido',
      trasFalloPagina(cancelada, 'desplazar') === 'detenida',
      trasFalloPagina(cancelada, 'desplazar')
    )
    const otros: DbMotivoError[] = [
      'servidor',
      'sesionPerdida',
      'soloLectura',
      'timeout',
      'driver',
      'limite',
      'txPendiente',
      'sinSecreto',
      'noReleible',
      'ocupada',
      'interno'
    ]
    const mal = otros.flatMap((motivo) =>
      (['traerTodas', 'desplazar'] as const)
        .filter((origen) => trasFalloPagina({ motivo }, origen) !== 'perdido')
        .map((origen) => `${motivo}/${origen}`)
    )
    check(
      '(5c) NEGATIVO: cualquier fallo que no es Detener SÍ pierde el lector, venga de «Traer todas» o de desplazar',
      mal.length === 0,
      mal.length === 0 ? `${otros.length} motivos × 2 orígenes = perdido` : mal.join(', ')
    )
    check(
      '(5d) NEGATIVO: una sesión perdida durante «Traer todas» no se confunde con Detener',
      trasFalloPagina({ motivo: 'sesionPerdida' }, 'traerTodas') === 'perdido',
      trasFalloPagina({ motivo: 'sesionPerdida' }, 'traerTodas')
    )
  }

  hr('(6) reanudarTrasTope: bajar «Filas por página» suelta el tope')
  {
    // Un registro de verdad con 1000 celdas de tope y una rejilla visible de 700: cabe
    // una página de 50 filas × 5 columnas (250), no una de 100 × 5 (500).
    const r = crearRegistroCeldas(1000)
    r.registrar({ id: 'visible', celdas: () => 700, celdasPrimeraPagina: () => 700, visible: () => true, ultimoUso: () => 1, liberar: () => {} })
    const base = { visible: true, tope: true, hayLector: true, columnas: 5 }
    check('(6a) con 100 filas por página no cabe: sigue en tope', !reanudarTrasTope({ ...base, filasPorPagina: 100 }, r), 'tope')
    check(
      '(6b) con las filas por página BAJADAS a 50, la misma rejilla sí cabe: se suelta el tope',
      reanudarTrasTope({ ...base, filasPorPagina: 50 }, r),
      'reanuda'
    )
    let preguntas = 0
    const contador = {
      cabe: (): boolean => {
        preguntas++
        return true
      }
    }
    const negativos = [
      { ...base, visible: false, filasPorPagina: 50 },
      { ...base, tope: false, filasPorPagina: 50 },
      { ...base, hayLector: false, filasPorPagina: 50 }
    ]
    check(
      '(6c) NO: oculta, sin tope o sin lector no se reanuda, y ni se pregunta al registro (cabe puede soltar otras rejillas)',
      negativos.every((p) => !reanudarTrasTope(p, contador)) && preguntas === 0,
      `${preguntas} preguntas`
    )
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
