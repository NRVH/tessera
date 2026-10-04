#!/usr/bin/env node
// =============================================================================
// Prueba de `modeloFiltro.ts` (npm run test:modelo-filtro): la condición nueva y sus
// cambios de columna u operador, podar sin repintar en bucle (el MISMO objeto si no cambia),
// el ciclo de la cabecera (clic y Mayús+clic) con su prioridad, las columnas filtrables, lo
// que se manda al main (nunca `where` y `filtro` a la vez ni `orderBy`) y el error en su fila.
// =============================================================================

import {
  camposDeFiltroTabla,
  cambiarColumna,
  cambiarOperador,
  ciclarOrden,
  columnasFiltrablesSql,
  conCondicion,
  condicionNueva,
  conectorCondicion,
  FILTRO_GUIADO_VACIO,
  FILTRO_TABLA_VACIO,
  mismoFiltro,
  ordenDeColumna,
  podarColumnas,
  podarOrden,
  problemaDelGuiado,
  sinCondicion,
  type ColumnaFiltrable
} from './modeloFiltro.ts'
import { MAX_CONDICIONES, type DbFiltroGuiado, type DbOrdenColumna } from '../../../../../shared/filtroGuiado.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

const COLS: ColumnaFiltrable[] = [
  { nombre: 'NOMBRE', categoria: 'texto' },
  { nombre: 'IMPORTE', categoria: 'numero' },
  { nombre: 'ALTA', categoria: 'fecha' },
  { nombre: 'ACTIVO', categoria: 'booleano' },
  { nombre: 'FOTO', categoria: 'otro' }
]

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) condición nueva')
  // -------------------------------------------------------------------------
  const c0 = condicionNueva(COLS)
  check('(1a) sin columna: la primera, texto → contiene con valor vacío', j(c0) === j({ columna: 'NOMBRE', categoria: 'texto', operador: 'contiene', valor: '' }), j(c0))
  const cNum = condicionNueva(COLS, 'IMPORTE')
  check('(1b) número → «=» con valor', j(cNum) === j({ columna: 'IMPORTE', categoria: 'numero', operador: 'igual', valor: '' }), j(cNum))
  const cOtro = condicionNueva(COLS, 'FOTO')
  check('(1c) lo que no se compara → «no está vacío», SIN valor', j(cOtro) === j({ columna: 'FOTO', categoria: 'otro', operador: 'noVacio' }), j(cOtro))
  check('(1d) sin columnas → null (no se puede añadir)', condicionNueva([]) === null, String(condicionNueva([])))
  check('(1e) columna que no existe → la primera', condicionNueva(COLS, 'NO_ESTA')?.columna === 'NOMBRE', j(condicionNueva(COLS, 'NO_ESTA')))

  // -------------------------------------------------------------------------
  hr('(2) cambiar columna y operador')
  // -------------------------------------------------------------------------
  const texto = { columna: 'NOMBRE', categoria: 'texto' as const, operador: 'igual' as const, valor: 'Ana' }
  const aNum = cambiarColumna(texto, COLS[1])
  check('(2a) «=» vale para número: se conserva el operador y el valor', j(aNum) === j({ columna: 'IMPORTE', categoria: 'numero', operador: 'igual', valor: 'Ana' }), j(aNum))
  const contiene = { columna: 'NOMBRE', categoria: 'texto' as const, operador: 'contiene' as const, valor: 'x' }
  const aFecha = cambiarColumna(contiene, COLS[2])
  check('(2b) «contiene» no vale para fecha: pasa a «=»', aFecha.operador === 'igual' && aFecha.categoria === 'fecha', j(aFecha))
  const aOtro = cambiarColumna(contiene, COLS[4])
  check('(2c) a una columna «otro»: «no está vacío» y SIN valor', aOtro.operador === 'noVacio' && !('valor' in aOtro), j(aOtro))
  const recienNacida = condicionNueva(COLS, 'IMPORTE')!
  const aTextoSinValor = cambiarColumna(recienNacida, COLS[0])
  check(
    '(2c-bis) SIN valor escrito y a otro tipo: el operador inicial del nuevo («=» de número → «contiene» de texto)',
    aTextoSinValor.operador === 'contiene' && aTextoSinValor.valor === '',
    j(aTextoSinValor)
  )
  const mismoTipo = cambiarColumna({ ...recienNacida, operador: 'mayor' }, { nombre: 'OTRO_NUM', categoria: 'numero' })
  check('(2c-ter) sin valor pero del MISMO tipo: se respeta el operador elegido', mismoTipo.operador === 'mayor', j(mismoTipo))
  const vacioElegido = cambiarColumna({ columna: 'IMPORTE', categoria: 'numero', operador: 'vacio' }, COLS[0])
  check('(2c-quater) «está vacío» (no lleva valor) se respeta al cambiar de tipo', vacioElegido.operador === 'vacio', j(vacioElegido))
  const entre = cambiarOperador({ columna: 'IMPORTE', categoria: 'numero', operador: 'igual', valor: '5' }, 'entre')
  check('(2d) a «entre»: conserva el primero y crea el segundo vacío', j(entre) === j({ columna: 'IMPORTE', categoria: 'numero', operador: 'entre', valor: '5', valor2: '' }), j(entre))
  const vacio = cambiarOperador(entre, 'vacio')
  check('(2e) a «está vacío»: sin valores (validarFiltro rechaza uno que sobre)', !('valor' in vacio) && !('valor2' in vacio), j(vacio))
  const deVuelta = cambiarOperador({ ...entre, valor2: '9' }, 'mayor')
  check('(2f) de «entre» a «>»: quita el segundo valor', j(deVuelta) === j({ columna: 'IMPORTE', categoria: 'numero', operador: 'mayor', valor: '5' }), j(deVuelta))

  // -------------------------------------------------------------------------
  hr('(3) quitar y reemplazar sin mutar')
  // -------------------------------------------------------------------------
  const f: DbFiltroGuiado = { union: 'todas', condiciones: [c0!, cNum!, cOtro!] }
  const congelado = j(f)
  const sin1 = sinCondicion(f, 1)
  check('(3a) quitar la del medio', j(sin1.condiciones.map((c) => c.columna)) === j(['NOMBRE', 'FOTO']), j(sin1.condiciones.map((c) => c.columna)))
  const con = conCondicion(f, 0, texto)
  check('(3b) reemplazar la primera', con.condiciones[0] === texto && con.condiciones[1] === f.condiciones[1], j(con.condiciones[0]))
  check('(3c) el original no cambia', j(f) === congelado, 'inmutable')
  check('(3d) mismoFiltro compara por valor', mismoFiltro(f, JSON.parse(congelado)) && !mismoFiltro(f, sin1), 'ok')

  // -------------------------------------------------------------------------
  hr('(4) podar lo que ya no está')
  // -------------------------------------------------------------------------
  const podado = podarColumnas(f, COLS.slice(0, 2))
  check('(4a) quita la condición de FOTO', j(podado.condiciones.map((c) => c.columna)) === j(['NOMBRE', 'IMPORTE']), j(podado.condiciones.map((c) => c.columna)))
  check('(4b) sin nada que quitar devuelve el MISMO objeto', podarColumnas(f, COLS) === f, 'identidad')
  const orden: DbOrdenColumna[] = [
    { columna: 'ALTA', dir: 'desc' },
    { columna: 'BORRADA', dir: 'asc' }
  ]
  check('(4c) orden: quita la columna que no está', j(podarOrden(orden, COLS)) === j([{ columna: 'ALTA', dir: 'desc' }]), j(podarOrden(orden, COLS)))
  const conBorrada: ColumnaFiltrable[] = [...COLS, { nombre: 'BORRADA', categoria: 'texto' }]
  check('(4d) orden: sin nada que quitar, el MISMO array', podarOrden(orden, conBorrada) === orden, 'identidad')

  // -------------------------------------------------------------------------
  hr('(5) el ciclo de la cabecera (clic y Mayús+clic)')
  // -------------------------------------------------------------------------
  const a1 = ciclarOrden([], 'A', false)
  const a2 = ciclarOrden(a1, 'A', false)
  const a3 = ciclarOrden(a2, 'A', false)
  check('(5a) clic: asc → desc → sin orden', j([a1, a2, a3]) === j([[{ columna: 'A', dir: 'asc' }], [{ columna: 'A', dir: 'desc' }], []]), j([a1, a2, a3]))
  const ab = ciclarOrden(a1, 'B', true)
  check('(5b) Mayús+clic en otra: se AÑADE al final en asc', j(ab) === j([{ columna: 'A', dir: 'asc' }, { columna: 'B', dir: 'asc' }]), j(ab))
  const abD = ciclarOrden(ab, 'A', true)
  check('(5c) Mayús+clic en una del orden: cicla EN SU SITIO', j(abD) === j([{ columna: 'A', dir: 'desc' }, { columna: 'B', dir: 'asc' }]), j(abD))
  const soloB = ciclarOrden(abD, 'A', true)
  check('(5d) Mayús+clic en su desc: sale, y la otra sube a 1.ª', j(soloB) === j([{ columna: 'B', dir: 'asc' }]), j(soloB))
  const clicSinMayus = ciclarOrden(ab, 'B', false)
  check('(5e) clic SIN Mayús en una de varias: esa sola, siguiendo su ciclo (asc → desc)', j(clicSinMayus) === j([{ columna: 'B', dir: 'desc' }]), j(clicSinMayus))
  const clicOtra = ciclarOrden(ab, 'C', false)
  check('(5f) clic SIN Mayús en una nueva: sustituye a todas', j(clicOtra) === j([{ columna: 'C', dir: 'asc' }]), j(clicOtra))

  // -------------------------------------------------------------------------
  hr('(6) flecha, prioridad y conector')
  // -------------------------------------------------------------------------
  check('(6a) una sola columna: sin número', j(ordenDeColumna(a1, 'A')) === j({ dir: 'asc', prioridad: null }), j(ordenDeColumna(a1, 'A')))
  check('(6b) varias: la segunda es la 2', j(ordenDeColumna(ab, 'B')) === j({ dir: 'asc', prioridad: 2 }), j(ordenDeColumna(ab, 'B')))
  check('(6c) fuera del orden: null', ordenDeColumna(ab, 'Z') === null, 'null')
  check(
    '(6d) conector: donde · y · y (todas) / donde · o (cualquiera)',
    j([0, 1, 2].map((i) => conectorCondicion('todas', i))) === j(['donde', 'y', 'y']) && conectorCondicion('cualquiera', 1) === 'o' && conectorCondicion('cualquiera', 0) === 'donde',
    j([0, 1, 2].map((i) => conectorCondicion('cualquiera', i)))
  )

  // -------------------------------------------------------------------------
  hr('(7) columnas filtrables de un resultado SQL')
  // -------------------------------------------------------------------------
  const filt = columnasFiltrablesSql([
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'NOMBRE', tipoLogico: 'texto' },
    { nombre: 'ALTA', tipoLogico: 'fechaHora' },
    { nombre: 'DOC', tipoLogico: 'lob' },
    { nombre: 'ID', tipoLogico: 'texto' }
  ])
  check(
    '(7a) categoría por tipo lógico (fechaHora → fecha, lob → otro) y el repetido UNA vez (la primera)',
    j(filt) ===
      j([
        { nombre: 'ID', categoria: 'numero' },
        { nombre: 'NOMBRE', categoria: 'texto' },
        { nombre: 'ALTA', categoria: 'fecha' },
        { nombre: 'DOC', categoria: 'otro' }
      ]),
    j(filt)
  )

  // -------------------------------------------------------------------------
  hr('(8) lo que se manda al main')
  // -------------------------------------------------------------------------
  const guiado: DbFiltroGuiado = { union: 'cualquiera', condiciones: [{ columna: 'NOMBRE', categoria: 'texto', operador: 'contiene', valor: 'a' }] }
  const ord: DbOrdenColumna[] = [{ columna: 'NOMBRE', dir: 'desc' }]
  check('(8a) vacío: nada de nada', j(camposDeFiltroTabla(FILTRO_TABLA_VACIO)) === '{}', j(camposDeFiltroTabla(FILTRO_TABLA_VACIO)))
  const g = camposDeFiltroTabla({ modo: 'guiado', guiado, where: 'ID = 1', orden: ord })
  check('(8b) modo guiado: filtro + orden, SIN el where escrito en la otra barra', j(g) === j({ filtro: guiado, orden: ord }), j(g))
  const s = camposDeFiltroTabla({ modo: 'sql', guiado, where: 'ID = 1', orden: [] })
  check('(8c) modo SQL: where, SIN el guiado; sin orden no manda `orden`', j(s) === j({ where: 'ID = 1' }), j(s))
  const sb = camposDeFiltroTabla({ modo: 'sql', guiado, where: '   ', orden: ord })
  check('(8d) WHERE en blanco no se manda', j(sb) === j({ orden: ord }), j(sb))
  const gv = camposDeFiltroTabla({ modo: 'guiado', guiado: FILTRO_GUIADO_VACIO, where: '', orden: [] })
  check('(8e) guiado sin condiciones: sin `filtro`', !('filtro' in gv), j(gv))
  const todas = [g, s, sb, gv, camposDeFiltroTabla({ modo: 'sql', guiado, where: 'x', orden: ord })]
  check(
    '(8f) NINGUNA salida lleva `orderBy`, ni `where` y `filtro` juntos',
    todas.every((x) => !('orderBy' in x) && !('where' in x && 'filtro' in x)),
    j(todas)
  )
  check('(8g) el orden va COPIADO (el estado de React no viaja por referencia al IPC)', g.orden !== ord && j(g.orden) === j(ord), 'copia')

  // -------------------------------------------------------------------------
  hr('(9) el error antes de mandar')
  // -------------------------------------------------------------------------
  check('(9a) un filtro bueno: null', problemaDelGuiado(guiado) === null, 'null')
  const sinValor = problemaDelGuiado({ union: 'todas', condiciones: [guiado.condiciones[0], { columna: 'IMPORTE', categoria: 'numero', operador: 'igual', valor: '' }] })
  check('(9b) la 2.ª sin valor: señala la fila 1', sinValor?.condicion === 1 && /valor/.test(sinValor.mensaje), j(sinValor))
  const malNum = problemaDelGuiado({ union: 'todas', condiciones: [{ columna: 'IMPORTE', categoria: 'numero', operador: 'igual', valor: '12,5' }] })
  check('(9c) «12,5» no es un número: lo dice en su fila', malNum?.condicion === 0 && /número/.test(malNum.mensaje), j(malNum))
  const muchas = problemaDelGuiado({ union: 'todas', condiciones: Array.from({ length: MAX_CONDICIONES + 1 }, () => guiado.condiciones[0]) })
  check('(9d) un problema del filtro ENTERO (índice -1) va a la barra (null)', muchas?.condicion === null, j(muchas))

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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
