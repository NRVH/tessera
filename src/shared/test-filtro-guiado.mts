#!/usr/bin/env node
// =============================================================================
// Prueba del contrato PURO del filtro guiado (`shared/filtroGuiado.ts`).
// (node src/shared/test-filtro-guiado.mts)
// -----------------------------------------------------------------------------
// Cubre lo que comparten el renderer y el main: operadores por categoría, categoría por
// tipo lógico (SQL) y por tipos de la muestra (Mongo), lectura de números, fechas y
// booleanos, y la validación de la estructura que el main repite como segunda barrera
// (un renderer que mande un operador que no toca, un valor de más o 51 condiciones).
// =============================================================================

import {
  aridad,
  categoriaDeDocTipos,
  categoriaDeTipoLogico,
  diaSiguiente,
  leerBooleano,
  leerFecha,
  leerNumero,
  MAX_CONDICIONES,
  OPERADORES_POR_CATEGORIA,
  problemaDeValor,
  validarFiltro,
  validarOrden
} from './filtroGuiado.ts'

const results: Array<{ name: string; pass: boolean }> = []
function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}
function check(name: string, pass: boolean, evidence?: unknown): void {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined ? `  -> ${JSON.stringify(evidence)}` : ''}`)
}

function main(): void {
  hr('Operadores y aridad')
  check('texto: contiene y empieza por, sin > ni entre', OPERADORES_POR_CATEGORIA.texto.includes('contiene') && !OPERADORES_POR_CATEGORIA.texto.includes('mayor') && !OPERADORES_POR_CATEGORIA.texto.includes('entre'))
  check('número y fecha: entre, sin contiene', ['numero', 'fecha'].every((c) => OPERADORES_POR_CATEGORIA[c as 'numero'].includes('entre') && !OPERADORES_POR_CATEGORIA[c as 'numero'].includes('contiene')))
  check('todas las categorías: vacío y no vacío', Object.values(OPERADORES_POR_CATEGORIA).every((ops) => ops.includes('vacio') && ops.includes('noVacio')))
  check('aridad', aridad('vacio') === 0 && aridad('igual') === 1 && aridad('entre') === 2)

  hr('Categorías')
  check('tipo lógico', categoriaDeTipoLogico('texto') === 'texto' && categoriaDeTipoLogico('fechaHora') === 'fecha' && categoriaDeTipoLogico('lob') === 'otro' && categoriaDeTipoLogico('booleano') === 'booleano')
  check('Mongo: manda el más frecuente que no sea null', categoriaDeDocTipos(['null', 'string']) === 'texto' && categoriaDeDocTipos(['long', 'string']) === 'numero')
  check('Mongo: _id es id, subdocumento es otro', categoriaDeDocTipos(['objectId']) === 'id' && categoriaDeDocTipos(['objeto']) === 'otro' && categoriaDeDocTipos([]) === 'otro')

  hr('Valores')
  check('número con punto', leerNumero(' 12.5 ') === '12.5' && leerNumero('+7') === '7' && leerNumero('-.5') === '-.5')
  check('número: coma, miles y exponente no', leerNumero('12,5') === null && leerNumero('1e3') === null && leerNumero('1 000') === null)
  check('número grande se conserva como texto', leerNumero('123456789012345678901234567890') === '123456789012345678901234567890')
  check('fecha sin hora', JSON.stringify(leerFecha('2026-09-28')) === JSON.stringify({ dia: '2026-09-28', hora: null }))
  check('fecha con hora (espacio y T, segundos opcionales)', leerFecha('2026-09-28 14:30')?.hora === '14:30:00' && leerFecha('2026-09-28T14:30:05')?.hora === '14:30:05')
  check('fecha imposible', leerFecha('2026-02-30') === null && leerFecha('2026-13-01') === null && leerFecha('2026-09-28 24:00') === null && leerFecha('28/09/2026') === null)
  check('día siguiente cruza mes y año bisiesto', diaSiguiente('2024-02-28') === '2024-02-29' && diaSiguiente('2024-02-29') === '2024-03-01' && diaSiguiente('2026-12-31') === '2027-01-01')
  check('booleano', leerBooleano('TRUE') === true && leerBooleano('no') === false && leerBooleano('quizá') === null)
  check('valor vacío pide «está vacío»', (problemaDeValor('texto', '  ') ?? '').includes('está vacío'))
  check('texto admite comillas y cualquier cosa', problemaDeValor('texto', `NOMINA "PROCESADA"'; DROP`) === null)

  hr('validarFiltro')
  const ok = { union: 'todas', condiciones: [{ columna: 'ESTATUS', categoria: 'texto', operador: 'igual', valor: 'NOMINA PROCESADA' }] }
  check('filtro correcto', validarFiltro(ok) === null)
  check('sin condiciones es válido', validarFiltro({ union: 'cualquiera', condiciones: [] }) === null)
  check('unión inválida', validarFiltro({ union: 'y', condiciones: [] })?.indice === -1)
  check('operador que no toca a la categoría', validarFiltro({ union: 'todas', condiciones: [{ columna: 'N', categoria: 'numero', operador: 'contiene', valor: '1' }] })?.indice === 0)
  check('entre sin segundo valor', validarFiltro({ union: 'todas', condiciones: [ok.condiciones[0], { columna: 'N', categoria: 'numero', operador: 'entre', valor: '1' }] })?.indice === 1)
  check('valor de más con «está vacío»', validarFiltro({ union: 'todas', condiciones: [{ columna: 'N', categoria: 'numero', operador: 'vacio', valor: '1' }] }) !== null)
  check('número mal escrito', (validarFiltro({ union: 'todas', condiciones: [{ columna: 'N', categoria: 'numero', operador: 'mayor', valor: '1,5' }] })?.mensaje ?? '').includes('punto decimal'))
  check('columna vacía', validarFiltro({ union: 'todas', condiciones: [{ columna: '', categoria: 'texto', operador: 'vacio' }] }) !== null)
  check('categoría inventada', validarFiltro({ union: 'todas', condiciones: [{ columna: 'X', categoria: 'sql', operador: 'vacio' }] }) !== null)
  const muchas = Array.from({ length: MAX_CONDICIONES + 1 }, () => ok.condiciones[0])
  check('más del tope de condiciones', validarFiltro({ union: 'todas', condiciones: muchas })?.indice === -1)
  check('no es un objeto', validarFiltro(null) !== null && validarFiltro('ESTATUS = 1') !== null)

  hr('validarOrden')
  check('orden correcto', validarOrden([{ columna: 'A', dir: 'asc' }, { columna: 'B', dir: 'desc' }]) === null)
  check('columna repetida', validarOrden([{ columna: 'A', dir: 'asc' }, { columna: 'A', dir: 'desc' }]) !== null)
  check('dirección inventada', validarOrden([{ columna: 'A', dir: 'ASC; DROP' }]) !== null)
  check('no es un array', validarOrden('A DESC') !== null)

  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
