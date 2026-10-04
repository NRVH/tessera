#!/usr/bin/env node
// =============================================================================
// Prueba del estado de la lista de resultados de la búsqueda en archivos, puro y bajo `node`.
// Cubre: iniciar y fijar el id, ignorar lotes y fines de otra búsqueda, la selección de la
// primera fila, la acumulación de lotes, los contadores («N+» incluido), mover sin circular,
// seleccionar fuera de rango y `carpetaDe` con rutas virtuales de un .jar.
// Ejecución: node src/renderer/src/features/busqueda/test-filas-resultado.mts
// =============================================================================

import {
  ESTADO_INICIAL,
  agregarLote,
  carpetaDe,
  filaSeleccionada,
  iniciarBusqueda,
  mover,
  seleccionar,
  terminarBusqueda,
  textoContador
} from './filasResultado.ts'
import type { CoincidenciaArchivo } from '../../../../shared/search-ipc.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      -> ${evidence}`)
}

function fila(path: string, linea = 1): CoincidenciaArchivo {
  return {
    path,
    nombre: path.slice(path.lastIndexOf('/') + 1),
    linea,
    columna: 1,
    columnaArchivo: 1,
    longitud: 3,
    texto: 'foo',
    origen: 'texto'
  }
}

hr('Arranque y filtro por id')

{
  const s = iniciarBusqueda(7)
  check('(1) iniciar: id fijado, lista vacía, buscando',
    s.busquedaId === 7 && s.filas.length === 0 && s.buscando && s.seleccion === -1,
    `id=${s.busquedaId} n=${s.filas.length} buscando=${s.buscando}`)
}

{
  // El caso que de verdad justifica el id: al teclear, la búsqueda 7 se cancela y
  // arranca la 8, pero los lotes de la 7 que ya estaban en la cola siguen llegando.
  let s = iniciarBusqueda(8)
  s = agregarLote(s, { busquedaId: 7, coincidencias: [fila('viejo.java')] })
  check('(2) un lote de la búsqueda ANTERIOR se ignora', s.filas.length === 0, `n=${s.filas.length}`)
}

hr('Acumulación de lotes')

{
  let s = iniciarBusqueda(1)
  s = agregarLote(s, { busquedaId: 1, coincidencias: [fila('a.java'), fila('b.java')] })
  check('(3) la primera fila se selecciona sola', s.seleccion === 0, `sel=${s.seleccion}`)
  s = seleccionar(s, 1)
  s = agregarLote(s, { busquedaId: 1, coincidencias: [fila('c.java')] })
  check('(4) lotes sucesivos acumulan sin mover la selección',
    s.filas.length === 3 && s.seleccion === 1, `n=${s.filas.length} sel=${s.seleccion}`)
  check('(4b) filaSeleccionada devuelve la correcta',
    filaSeleccionada(s)?.path === 'b.java', String(filaSeleccionada(s)?.path))
}

{
  let s = iniciarBusqueda(1)
  const antes = s
  s = agregarLote(s, { busquedaId: 1, coincidencias: [] })
  check('(4c) un lote vacío no crea objeto nuevo', s === antes, `misma=${s === antes}`)
}

hr('Fin de búsqueda')

{
  let s = iniciarBusqueda(2)
  s = agregarLote(s, { busquedaId: 2, coincidencias: [fila('a.java')] })
  s = terminarBusqueda(s, {
    busquedaId: 2, totalCoincidencias: 1, archivos: 1, truncado: false, cancelado: false
  })
  check('(5a) terminar apaga `buscando` y guarda el recuento',
    !s.buscando && s.archivos === 1 && !s.truncado, `buscando=${s.buscando} archivos=${s.archivos}`)
}

{
  let s = iniciarBusqueda(3)
  s = terminarBusqueda(s, {
    busquedaId: 3, totalCoincidencias: 0, archivos: 0, truncado: false, cancelado: false,
    error: 'No hay proyecto activo.'
  })
  check('(5b) el error llega al estado', s.error === 'No hay proyecto activo.', String(s.error))
}

{
  let s = iniciarBusqueda(4)
  s = agregarLote(s, { busquedaId: 4, coincidencias: [fila('a.java')] })
  const antes = s
  s = terminarBusqueda(s, {
    busquedaId: 99, totalCoincidencias: 0, archivos: 0, truncado: false, cancelado: false
  })
  check('(6) un fin de OTRA búsqueda se ignora', s === antes && s.buscando, `misma=${s === antes}`)
}

hr('Navegación (NO circular)')

{
  let s = iniciarBusqueda(1)
  s = agregarLote(s, { busquedaId: 1, coincidencias: [fila('a'), fila('b'), fila('c')] })
  s = mover(s, 'abajo')
  check('(7a) abajo avanza', s.seleccion === 1, `sel=${s.seleccion}`)
  s = mover(s, 'abajo')
  const enElFinal = s
  s = mover(s, 'abajo')
  check('(7b) abajo en el ÚLTIMO se queda (no da la vuelta)',
    s.seleccion === 2 && s === enElFinal, `sel=${s.seleccion}`)
  s = mover(s, 'arriba')
  s = mover(s, 'arriba')
  const enElPrimero = s
  s = mover(s, 'arriba')
  check('(7c) arriba en el PRIMERO se queda',
    s.seleccion === 0 && s === enElPrimero, `sel=${s.seleccion}`)
}

{
  const vacio = iniciarBusqueda(1)
  check('(7d) mover sin filas no hace nada', mover(vacio, 'abajo') === vacio, 'misma referencia')
}

hr('Selección')

{
  let s = iniciarBusqueda(1)
  s = agregarLote(s, { busquedaId: 1, coincidencias: [fila('a'), fila('b')] })
  check('(8a) fuera de rango no hace nada', seleccionar(s, 9) === s, 'misma referencia')
  check('(8b) el mismo índice no crea objeto', seleccionar(s, 0) === s, 'misma referencia')
  check('(8c) índice negativo no hace nada', seleccionar(s, -5) === s, 'misma referencia')
}

hr('Contador: no miente al truncar')

{
  const s = iniciarBusqueda(1)
  check('(9a) sin consulta: vacío', textoContador(s, false) === '', `"${textoContador(s, false)}"`)
  check('(9b) buscando sin resultados aún', textoContador(s, true) === 'Buscando…',
    `"${textoContador(s, true)}"`)
}

{
  let s = iniciarBusqueda(1)
  s = terminarBusqueda(s, {
    busquedaId: 1, totalCoincidencias: 0, archivos: 0, truncado: false, cancelado: false
  })
  check('(9c) terminó sin nada', textoContador(s, true) === 'Ningún resultado',
    `"${textoContador(s, true)}"`)
}

{
  let s = iniciarBusqueda(1)
  s = agregarLote(s, { busquedaId: 1, coincidencias: [fila('a.java')] })
  s = terminarBusqueda(s, {
    busquedaId: 1, totalCoincidencias: 1, archivos: 1, truncado: false, cancelado: false
  })
  check('(9d) singular bien escrito',
    textoContador(s, true) === '1 coincidencia en 1 archivo', `"${textoContador(s, true)}"`)
}

{
  let s = iniciarBusqueda(1)
  s = agregarLote(s, {
    busquedaId: 1,
    coincidencias: [fila('a.java'), fila('a.java', 2), fila('b.java')]
  })
  s = terminarBusqueda(s, {
    busquedaId: 1, totalCoincidencias: 3, archivos: 2, truncado: false, cancelado: false
  })
  check('(9e) plural y archivos distintos (no coincidencias)',
    textoContador(s, true) === '3 coincidencias en 2 archivos', `"${textoContador(s, true)}"`)
}

{
  // Lo que importa: al truncar, el "+" y los archivos DE LO QUE HAY.
  let s = iniciarBusqueda(1)
  s = agregarLote(s, { busquedaId: 1, coincidencias: [fila('a.java'), fila('b.java')] })
  s = terminarBusqueda(s, {
    busquedaId: 1, totalCoincidencias: 5000, archivos: 300, truncado: true, cancelado: false
  })
  const t = textoContador(s, true)
  check('(9f) truncado: "N+" y archivos coherentes con las filas',
    t === '2+ coincidencias en 2+ archivos', `"${t}"`)
}

{
  let s = iniciarBusqueda(1)
  s = agregarLote(s, { busquedaId: 1, coincidencias: [fila('a.java')] })
  check('(9g) mientras busca lo dice, sin ocultar lo que ya hay',
    textoContador(s, true).endsWith('· buscando…'), `"${textoContador(s, true)}"`)
}

{
  let s = iniciarBusqueda(1)
  s = terminarBusqueda(s, {
    busquedaId: 1, totalCoincidencias: 0, archivos: 0, truncado: false, cancelado: false,
    error: 'Se rompió algo.'
  })
  check('(9h) el error manda sobre el contador', textoContador(s, true) === 'Se rompió algo.',
    `"${textoContador(s, true)}"`)
}

hr('carpetaDe')

check('(10a) ruta normal', carpetaDe('codigo/java/com/Foo.java') === 'codigo/java/com',
  carpetaDe('codigo/java/com/Foo.java'))
check('(10b) en la raíz -> vacío', carpetaDe('pom.xml') === '', `"${carpetaDe('pom.xml')}"`)
check('(10c) dentro de un .jar conserva el contenedor',
  carpetaDe('lib/x.jar!/com/ejemplo/A.class') === 'lib/x.jar!/com/ejemplo',
  carpetaDe('lib/x.jar!/com/ejemplo/A.class'))
check('(10d) en la RAÍZ de un .jar',
  carpetaDe('lib/x.jar!/A.class') === 'lib/x.jar!', carpetaDe('lib/x.jar!/A.class'))

check('(extra) ESTADO_INICIAL no se muta',
  ESTADO_INICIAL.filas.length === 0 && ESTADO_INICIAL.seleccion === -1 && !ESTADO_INICIAL.buscando,
  JSON.stringify({ n: ESTADO_INICIAL.filas.length, sel: ESTADO_INICIAL.seleccion }))

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(78))
console.log(
  `VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`
)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
