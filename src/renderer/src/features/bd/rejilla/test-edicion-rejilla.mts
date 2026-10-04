#!/usr/bin/env node
// =============================================================================
// Prueba de la edición de la rejilla (npm run test:db-rejilla-edicion): el modelo de cambios,
// qué se edita, `aCambiosFila` con su orden y sus originales, la vista previa, el teclado de
// edición en las DOS plataformas con sus mitades negativas, las operaciones en bloque
// (iguales a fila a fila y lineales), los CRLF del editor, la selección al quitar filas
// nuevas, el diálogo de «Enviar» tras un fallo y los registros de cierre (el último: asíncrono).
// =============================================================================

import {
  COLUMNA_ROWID,
  MOTIVO_BINARIA,
  MOTIVO_BORRADA,
  MOTIVO_RECORTADA,
  MOTIVO_ROWID,
  SIN_CAMBIOS,
  aCambiosFila,
  anadirFila,
  columnaComparable,
  borrarFilas,
  editarCelda,
  editarCeldas,
  estaBorrada,
  estadoTrasFallo,
  filaDeIndice,
  filaEnVista,
  filasEnRango,
  hayCambios,
  hayCambiosEnRango,
  hayColumnaOculta,
  identidadParaEditar,
  focoEnvio,
  focoTrasCerrarEnvio,
  esEnvioIncierto,
  estadoAlAbrirEnvio,
  sigueIncierto,
  AVISO_ENVIO_INCIERTO,
  mensajeFallo,
  mismaFormaVista,
  mismoValor,
  motivoCeldaNoEditable,
  motivosColumnas,
  noEditablesPorNombre,
  normalizarSaltos,
  numCambios,
  numFilasVista,
  posicionEnVista,
  previaEnvio,
  resumenCambios,
  reubicarCelda,
  reubicarSeleccion,
  revertirCelda,
  revertirFilas,
  revertirRango,
  sePuedeEditar,
  textoCambios,
  textoEditorCambiado,
  textoParaEditar,
  textoResumen,
  tiposPorNombre,
  valorDesdeEditor,
  valorVisto,
  type CambiosRejilla,
  type EstadoEnvio,
  type FalloEnvio,
  type RefFila,
  type VistaFilas
} from './cambiosRejilla.ts'
import { rango, type Seleccion } from './seleccionRejilla.ts'
import {
  accionEdicion,
  accionEditorCelda,
  accionTecla,
  caracterQueEscribe,
  type TeclaEdicion
} from './tecladoRejilla.ts'
import {
  cambiosPendientesDatos,
  cambiosPendientesDeConexion,
  datosRegistrados,
  etiquetaSalidaDatos,
  etiquetarDatos,
  pestanasSinEnviar,
  registrarDatos,
  solicitarCierreDatos
} from './registroEdicion.ts'
import type { DbCelda, DbColumnaResultado, DbIdentidadFila } from '../../../../../shared/db-explorador-ipc.ts'

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

const j = (x: unknown): string =>
  JSON.stringify(x, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const col = (nombre: string, tipoLogico: DbColumnaResultado['tipoLogico'] = 'texto', tipoMotor = 'text'): DbColumnaResultado => ({
  nombre,
  tipoLogico,
  tipoMotor
})

/** personas(id PK, nombre, activo bool, foto bytea) + 3 filas. */
const COLS: DbColumnaResultado[] = [col('id', 'numero', 'int4'), col('nombre'), col('activo', 'booleano', 'bool'), col('foto', 'binario', 'bytea')]
const FILAS: DbCelda[][] = [
  ['1', 'Ana', true, '0x00'],
  ['2', 'Bea', false, null],
  ['3', 'Carla', null, null]
]
const S = (f: number): RefFila => ({ tipo: 'servidor', f })
const N = (id: number): RefFila => ({ tipo: 'nueva', id })

function tecla(key: string, mods: Partial<Omit<TeclaEdicion, 'key'>> = {}): TeclaEdicion {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods }
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) recuento y resumen')
  check('(1a) sin cambios: 0 y hayCambios=false', numCambios(SIN_CAMBIOS) === 0 && !hayCambios(SIN_CAMBIOS), 'ok')
  check('(1b) textoCambios en singular y plural', textoCambios(1) === '1 cambio' && textoCambios(3) === '3 cambios', textoCambios(3))
  check(
    '(1c) textoResumen solo con lo que hay, «y» antes del último',
    textoResumen({ actualizar: 1, insertar: 2, borrar: 1 }) === '1 actualización, 2 inserciones y 1 borrado' &&
      textoResumen({ actualizar: 0, insertar: 0, borrar: 2 }) === '2 borrados' &&
      textoResumen({ actualizar: 2, insertar: 1, borrar: 0 }) === '2 actualizaciones y 1 inserción',
    textoResumen({ actualizar: 1, insertar: 2, borrar: 1 })
  )

  // -------------------------------------------------------------------------
  hr('(2) editar celdas de filas del servidor')
  let c: CambiosRejilla = editarCelda(SIN_CAMBIOS, S(0), 1, 'Ana María', FILAS[0][1])
  check('(2a) una celda cambiada cuenta 1', numCambios(c) === 1 && c.editadas.get(0)?.valores.get(1) === 'Ana María', j(c.editadas))
  const c2 = editarCelda(c, S(0), 1, 'Ana María', FILAS[0][1])
  check('(2b) escribir lo mismo otra vez es un no-op (MISMO objeto)', c2 === c, 'mismo')
  c = editarCelda(c, S(0), 1, 'Ana', FILAS[0][1])
  check('(2c) volver al ORIGINAL quita el cambio y la fila desaparece', numCambios(c) === 0 && c.editadas.size === 0, j(c.editadas))
  check('(2d) escribir el original sin cambio previo: MISMO objeto', editarCelda(SIN_CAMBIOS, S(0), 1, 'Ana', 'Ana') === SIN_CAMBIOS, 'mismo')
  c = editarCelda(SIN_CAMBIOS, S(1), 1, null, FILAS[1][1])
  check('(2e) Poner NULL es un cambio', numCambios(c) === 1 && c.editadas.get(1)?.valores.get(1) === null, j(c.editadas))
  check('(2f) NULL sobre un NULL no es cambio', editarCelda(SIN_CAMBIOS, S(2), 2, null, null) === SIN_CAMBIOS, 'mismo')
  check('(2g) la cadena vacía NO es NULL (en PG son distintas)', numCambios(editarCelda(SIN_CAMBIOS, S(2), 2, '', null)) === 1, 'cuenta')
  check(
    '(2h) un booleano se compara con su texto (true/false)',
    mismoValor(true, 'true') && !mismoValor(true, 't') && mismoValor(false, 'false') && editarCelda(SIN_CAMBIOS, S(0), 2, 'true', true) === SIN_CAMBIOS,
    'ok'
  )
  check('(2i) textoParaEditar: NULL vacío, booleano como texto', textoParaEditar(null) === '' && textoParaEditar(false) === 'false' && textoParaEditar('x') === 'x', 'ok')
  let d = editarCelda(SIN_CAMBIOS, S(0), 1, 'A', 'Ana')
  d = editarCelda(d, S(0), 2, 'false', true)
  d = revertirCelda(d, S(0), 1)
  check('(2j) revertir UNA celda deja la otra', d.editadas.get(0)?.valores.size === 1 && d.editadas.get(0)?.valores.get(2) === 'false', j(d.editadas))
  check('(2k) revertir una celda sin cambio: MISMO objeto', revertirCelda(d, S(0), 1) === d, 'mismo')

  // -------------------------------------------------------------------------
  hr('(3) filas nuevas')
  const a1 = anadirFila(SIN_CAMBIOS)
  const a2 = anadirFila(a1.cambios)
  check('(3a) añadir da ids crecientes y cuenta cada fila nueva', a1.id === 1 && a2.id === 2 && numCambios(a2.cambios) === 2, j(a2.cambios.nuevas))
  let n = editarCelda(a2.cambios, N(1), 0, '10', undefined)
  n = editarCelda(n, N(1), 1, 'Nuevo', undefined)
  check('(3b) escribir en una nueva no cambia el recuento (sigue siendo UN insert)', numCambios(n) === 2 && n.nuevas[0].valores.size === 2, j(n.nuevas))
  check('(3c) en una nueva, escribir el mismo valor: MISMO objeto', editarCelda(n, N(1), 1, 'Nuevo', undefined) === n, 'mismo')
  n = revertirCelda(n, N(1), 1)
  check('(3d) revertir una celda de la nueva la devuelve a su DEFAULT', !n.nuevas[0].valores.has(1) && n.nuevas[0].valores.has(0), j(n.nuevas))
  n = borrarFilas(n, [N(2)])
  check('(3e) borrar una fila NUEVA la quita sin más (no hay DELETE)', n.nuevas.length === 1 && numCambios(n) === 1 && n.editadas.size === 0, j(n))
  check('(3f) editar una nueva que ya no existe: MISMO objeto', editarCelda(n, N(99), 0, 'x', undefined) === n, 'mismo')

  // -------------------------------------------------------------------------
  hr('(4) borrar y revertir filas del servidor')
  let b = editarCelda(SIN_CAMBIOS, S(1), 1, 'Beatriz', 'Bea')
  b = borrarFilas(b, [S(1), S(2)])
  check('(4a) borrar MARCA las filas (2 cambios) y conserva la edición de debajo', numCambios(b) === 2 && estaBorrada(b, S(1)) && b.editadas.get(1)?.valores.get(1) === 'Beatriz', j(b.editadas))
  check('(4b) una fila borrada no se edita (MISMO objeto)', editarCelda(b, S(1), 1, 'Otra', 'Bea') === b, 'mismo')
  check('(4c) borrar otra vez lo borrado: MISMO objeto', borrarFilas(b, [S(1)]) === b, 'mismo')
  const rb = revertirFilas(b, [S(1)])
  check('(4d) revertir la fila quita TODO (borrado y edición)', !rb.editadas.has(1) && estaBorrada(rb, S(2)) && numCambios(rb) === 1, j(rb.editadas))
  check('(4e) revertir filas sin cambios: MISMO objeto', revertirFilas(SIN_CAMBIOS, [S(0)]) === SIN_CAMBIOS, 'mismo')
  // Rango: columnas 1..1 de las filas 0..1; la 0 tiene dos celdas cambiadas.
  let r = editarCelda(SIN_CAMBIOS, S(0), 1, 'A', 'Ana')
  r = editarCelda(r, S(0), 2, 'false', true)
  r = borrarFilas(r, [S(1)])
  const rr = revertirRango(r, [S(0), S(1)], 1, 1, 4)
  check('(4f) revertir un rango: solo las celdas de esas columnas', rr.editadas.get(0)?.valores.size === 1 && rr.editadas.get(0)?.valores.has(2) === true, j(rr.editadas))
  check('(4g) y la fila borrada del rango deja de estarlo', !rr.editadas.has(1), j(rr.editadas))
  const nuevaParcial = editarCelda(editarCelda(anadirFila(SIN_CAMBIOS).cambios, N(1), 0, '7', undefined), N(1), 1, 'x', undefined)
  const rp = revertirRango(nuevaParcial, [N(1)], 1, 1, 4)
  check('(4h) en una nueva, un rango parcial devuelve esas celdas a DEFAULT', rp.nuevas.length === 1 && !rp.nuevas[0].valores.has(1) && rp.nuevas[0].valores.has(0), j(rp.nuevas))
  const re = revertirRango(nuevaParcial, [N(1)], 0, 3, 4)
  check('(4i) y un rango que cubre TODAS las columnas quita la fila nueva', re.nuevas.length === 0, j(re.nuevas))
  check(
    '(4j) hayCambiosEnRango, y su mitad negativa (un rango sin nada pendiente)',
    hayCambiosEnRango(r, [S(0)], 1, 1, 4) && !hayCambiosEnRango(r, [S(2)], 0, 3, 4) && !hayCambiosEnRango(r, [S(0)], 3, 3, 4),
    'ok'
  )

  // -------------------------------------------------------------------------
  hr('(5) la vista: nuevas ARRIBA, luego las cargadas')
  const v = editarCelda(anadirFila(anadirFila(SIN_CAMBIOS).cambios).cambios, N(2), 1, 'Z', undefined)
  check('(5a) numFilasVista = nuevas + cargadas', numFilasVista(v, 3) === 5, String(numFilasVista(v, 3)))
  check(
    '(5b) filaEnVista: 0-1 nuevas (en orden de creación), 2-4 servidor, fuera = null',
    j(filaEnVista(v, 0, 3)) === j(N(1)) && j(filaEnVista(v, 1, 3)) === j(N(2)) && j(filaEnVista(v, 2, 3)) === j(S(0)) && j(filaEnVista(v, 4, 3)) === j(S(2)) && filaEnVista(v, 5, 3) === null && filaEnVista(v, -1, 3) === null,
    'ok'
  )
  check(
    '(5c) posicionEnVista es la inversa (y null si ya no existe)',
    posicionEnVista(v, N(2), 3) === 1 && posicionEnVista(v, S(1), 3) === 3 && posicionEnVista(v, N(9), 3) === null && posicionEnVista(v, S(3), 3) === null,
    'ok'
  )
  check('(5d) filasEnRango recorta lo que no existe', filasEnRango(v, 3, 9, 3).length === 2, j(filasEnRango(v, 3, 9, 3)))
  const vn = valorVisto(v, N(1), 1, FILAS)
  const vz = valorVisto(v, N(2), 1, FILAS)
  check('(5e) una celda de una nueva sin escribir: DEFAULT; escrita: su valor, cambiada', vn.porDefecto && !vn.cambiada && vz.valor === 'Z' && vz.cambiada && !vz.porDefecto, j([vn, vz]))
  const ve = valorVisto(editarCelda(SIN_CAMBIOS, S(0), 1, 'X', 'Ana'), S(0), 1, FILAS)
  const vo = valorVisto(SIN_CAMBIOS, S(0), 1, FILAS)
  check('(5f) del servidor: el pendiente manda; sin él, el cargado', ve.valor === 'X' && ve.cambiada && vo.valor === 'Ana' && !vo.cambiada, j([ve, vo]))

  // -------------------------------------------------------------------------
  hr('(6) qué NO se edita')
  const colsRowid: DbColumnaResultado[] = [col('ID'), col('DATOS', 'lob', 'BLOB'), col('NOTAS', 'lob', 'CLOB'), col('RAWC', 'binario', 'RAW'), col('X', 'texto'), col('Y', 'texto'), col(COLUMNA_ROWID, 'texto', 'VARCHAR2')]
  const delMain = noEditablesPorNombre([
    { columna: 'X', motivo: 'Columna generada: la calcula el servidor.' },
    { columna: 'Y', motivo: '' },
    { columna: 'X', motivo: 'la segunda no manda' }
  ])
  const motivos = motivosColumnas(colsRowid, delMain)
  check('(6a) BLOB y RAW (binarias) no, aunque el main no lo diga; CLOB sí', motivos[1] === MOTIVO_BINARIA && motivos[3] === MOTIVO_BINARIA && motivos[2] === null, j(motivos))
  check('(6b) la columna oculta del ROWID (la ÚLTIMA) no', motivos[6] === MOTIVO_ROWID, String(motivos[6]))
  check('(6c) lo que dice el main manda, con su texto (y la primera si se repite)', motivos[4] === 'Columna generada: la calcula el servidor.', j(motivos))
  check('(6d) un motivo vacío del main no deja la columna editable (motivo genérico)', typeof motivos[5] === 'string' && motivos[5] !== '', String(motivos[5]))
  check('(6d2) una normal sí (null)', motivos[0] === null, String(motivos[0]))
  check('(6d3) NEGATIVO: el main por nombre EXACTO («x» no es «X»)', motivosColumnas([col('x')], delMain)[0] === null, 'null')
  check('(6d4) sin lista del main: solo la binaria y el ROWID', j(motivosColumnas(colsRowid)) === j([null, MOTIVO_BINARIA, null, MOTIVO_BINARIA, null, null, MOTIVO_ROWID]), j(motivosColumnas(colsRowid)))
  const motivoMitad = motivosColumnas([col(COLUMNA_ROWID), col('b')])
  check('(6e) NEGATIVO: una columna que se llama como el ROWID pero NO es la última sí se edita', motivoMitad[0] === null, j(motivoMitad))
  const borr = borrarFilas(SIN_CAMBIOS, [S(0)])
  check(
    '(6f) celda recortada no (ni del servidor); en una nueva la marca de recortada no aplica',
    motivoCeldaNoEditable(SIN_CAMBIOS, S(0), null, true) === MOTIVO_RECORTADA && motivoCeldaNoEditable(SIN_CAMBIOS, N(1), null, true) === null,
    'ok'
  )
  check('(6g) una fila marcada para borrar no', motivoCeldaNoEditable(borr, S(0), null, false) === MOTIVO_BORRADA, 'ok')
  check('(6h) el motivo de la columna manda sobre el de la celda', motivoCeldaNoEditable(borr, S(0), MOTIVO_BINARIA, true) === MOTIVO_BINARIA, 'ok')

  // -------------------------------------------------------------------------
  hr('(7) la identidad con la que se edita')
  check('(7a) sin identidad (main anterior): ninguna, SIN motivo', j(identidadParaEditar(undefined, COLS)) === j({ tipo: 'ninguna', motivo: '' }), 'ok')
  // (7b) La casilla «Solo lectura» es de los AGENTES. La rejilla no la
  // recibe: una pk del main se edita (si el main IMPONE la solo lectura, manda él 'ninguna').
  check('(7b) la pk del main vale sin mirar la casilla de los agentes (dos argumentos: no la recibe)', identidadParaEditar.length === 2 && identidadParaEditar({ tipo: 'pk', columnas: ['id'] }, COLS).tipo === 'pk', String(identidadParaEditar.length))
  check('(7c) pk con todas sus columnas en el resultado: vale tal cual', identidadParaEditar({ tipo: 'pk', columnas: ['id'] }, COLS).tipo === 'pk', 'ok')
  check('(7d) NEGATIVO: pk por nombre EXACTO («ID» no es «id»)', identidadParaEditar({ tipo: 'pk', columnas: ['ID'] }, COLS).tipo === 'ninguna', 'ok')
  check('(7e) rowid con la columna la ÚLTIMA: vale', identidadParaEditar({ tipo: 'rowid', columna: COLUMNA_ROWID }, colsRowid).tipo === 'rowid', 'ok')
  check('(7f) NEGATIVO: rowid sin la columna al final', identidadParaEditar({ tipo: 'rowid', columna: COLUMNA_ROWID }, COLS).tipo === 'ninguna', 'ok')
  check('(7g) ninguna del main pasa con su motivo', j(identidadParaEditar({ tipo: 'ninguna', motivo: 'Es una vista' }, COLS)) === j({ tipo: 'ninguna', motivo: 'Es una vista' }), 'ok')
  check('(7h) hayColumnaOculta: solo si la última es la del ROWID', hayColumnaOculta(colsRowid) && !hayColumnaOculta(COLS) && !hayColumnaOculta([]), 'ok')

  // -------------------------------------------------------------------------
  hr('(8) aCambiosFila: orden, claves y origen')
  let e = anadirFila(SIN_CAMBIOS).cambios
  e = editarCelda(e, N(1), 1, 'Nueva', undefined)
  e = editarCelda(e, N(1), 0, '9', undefined)
  e = editarCelda(e, S(2), 1, 'Carlota', 'Carla')
  e = editarCelda(e, S(0), 2, 'false', true)
  e = borrarFilas(e, [S(1)])
  const PK_ID: DbIdentidadFila = { tipo: 'pk', columnas: ['id'] }
  const ctx = { columnas: COLS, identidad: PK_ID, filas: FILAS }
  const rs = resumenCambios(e)
  check('(8-) el resumen cuenta cada tipo (1 actualización por fila, no por celda)', j(rs) === j({ actualizar: 2, insertar: 1, borrar: 1 }), j(rs))
  const conv = aCambiosFila(e, ctx)
  check('(8a) convierte', conv.ok, j(conv))
  if (conv.ok) {
    check('(8b) ORDEN: borrados, luego actualizaciones (por fila), luego inserciones', j(conv.cambios.map((x) => x.tipo)) === j(['borrar', 'actualizar', 'actualizar', 'insertar']), j(conv.cambios.map((x) => x.tipo)))
    check('(8c) la clave es la PK TAL COMO SE LEYÓ', j(conv.cambios[0]) === j({ tipo: 'borrar', clave: ['2'] }), j(conv.cambios[0]))
    check('(8d) actualizaciones en el orden de la rejilla (fila 0 antes que la 2)', j(conv.cambios[1]) === j({ tipo: 'actualizar', clave: ['1'], valores: { activo: 'false' } }) && j(conv.cambios[2]) === j({ tipo: 'actualizar', clave: ['3'], valores: { nombre: 'Carlota' } }), j(conv.cambios.slice(1, 3)))
    check('(8e) el INSERT nombra SOLO lo escrito, en el orden de las columnas (no el de edición)', j(conv.cambios[3]) === j({ tipo: 'insertar', valores: { id: '9', nombre: 'Nueva' } }), j(conv.cambios[3]))
    check('(8f) origen: qué fila produjo cada cambio', j(conv.origen) === j([S(1), S(0), S(2), N(1)]), j(conv.origen))
    check('(8g) filaDeIndice, y fuera de rango = null', j(filaDeIndice(conv.origen, 3)) === j(N(1)) && filaDeIndice(conv.origen, 4) === null && filaDeIndice(conv.origen, -1) === null, 'ok')
  }
  const borradaYEditada = borrarFilas(editarCelda(SIN_CAMBIOS, S(0), 1, 'X', 'Ana'), [S(0)])
  const cb = aCambiosFila(borradaYEditada, ctx)
  check('(8h) una fila editada Y borrada solo manda el DELETE', cb.ok && cb.cambios.length === 1 && cb.cambios[0].tipo === 'borrar', j(cb))
  // PG: "ID" e id son columnas distintas; la clave es la de nombre EXACTO.
  const colsCaja = [col('ID'), col('id'), col('v')]
  const cc = aCambiosFila(editarCelda(SIN_CAMBIOS, S(0), 2, 'z', 'a'), { columnas: colsCaja, identidad: { tipo: 'pk', columnas: ['id'] }, filas: [['MAYUS', 'minus', 'a']] })
  check('(8i) clave por nombre EXACTO: «id» y no «ID»', cc.ok && j(cc.cambios[0]) === j({ tipo: 'actualizar', clave: ['minus'], valores: { v: 'z' } }), j(cc))
  const filasRowid: DbCelda[][] = [['1', null, null, null, 'a', 'b', 'AAAR1dAAEAAAAFbAAA']]
  const cr = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0)]), { columnas: colsRowid, identidad: { tipo: 'rowid', columna: COLUMNA_ROWID }, filas: filasRowid })
  check('(8j) ROWID: la clave es la columna OCULTA (la última)', cr.ok && j(cr.cambios[0]) === j({ tipo: 'borrar', clave: ['AAAR1dAAEAAAAFbAAA'] }), j(cr))
  const crec = aCambiosFila(editarCelda(SIN_CAMBIOS, S(0), 1, 'X', 'Ana'), { ...ctx, recortada: (f, c) => f === 0 && c === 0 })
  check('(8k) una clave RECORTADA no sirve: falla con la fila', !crec.ok && j(crec.fila) === j(S(0)) && /recortado/.test(crec.error), j(crec))
  const cn = aCambiosFila(editarCelda(SIN_CAMBIOS, S(0), 1, 'X', 'Ana'), { ...ctx, identidad: { tipo: 'ninguna', motivo: 'Sin clave' } })
  check('(8l) identidad ninguna: falla con su motivo', !cn.ok && cn.error === 'Sin clave', j(cn))
  const cv = aCambiosFila(SIN_CAMBIOS, ctx)
  check('(8m) sin cambios: lista vacía', cv.ok && cv.cambios.length === 0, j(cv))

  // -------------------------------------------------------------------------
  hr('(9) vista previa y mensaje de fallo')
  if (conv.ok) {
    const p = previaEnvio('postgres', { esquema: 'public', nombre: 'personas' }, ctx.identidad, conv.cambios, tiposPorNombre(COLS))
    check('(9a) una línea por cambio, terminada en «;»', p.ok && p.lineas.length === 4 && p.lineas.every((l) => l.endsWith(';')), j(p))
    check('(9b) el DELETE por la PK citada, con el literal', p.ok && p.lineas[0] === 'DELETE FROM "public"."personas" WHERE "id" = 2;', p.ok ? p.lineas[0] : '')
    check('(9c) el INSERT solo con lo escrito', p.ok && p.lineas[3].startsWith('INSERT INTO "public"."personas" ("id", "nombre") VALUES ('), p.ok ? p.lineas[3] : '')
  }
  const vacia = anadirFila(SIN_CAMBIOS).cambios
  const cvac = aCambiosFila(vacia, ctx)
  const pOra = cvac.ok ? previaEnvio('oracle', { esquema: 'HR', nombre: 'T' }, ctx.identidad, cvac.cambios) : null
  check('(9d) Oracle: una fila nueva sin valores no se puede construir: dice CUÁL (índice)', pOra !== null && !pOra.ok && pOra.indice === 0, j(pOra))
  const pPg = cvac.ok ? previaEnvio('postgres', { esquema: 'public', nombre: 't' }, ctx.identidad, cvac.cambios) : null
  check('(9e) PG sí: DEFAULT VALUES', pPg !== null && pPg.ok && pPg.lineas[0] === 'INSERT INTO "public"."t" DEFAULT VALUES;', j(pPg))
  if (conv.ok) {
    // Un salto en el nombre de la tabla: en Oracle, cada
    // sentencia de la vista previa es un bloque que acaba en su `/`, y «Copiar el SQL» (que
    // junta `lineas` con saltos) da un guion que SQL*Plus corre (medido en la 11.2 y la 21c).
    const pSalto = previaEnvio('oracle', { esquema: 'HR', nombre: 'PER' + String.fromCharCode(10) + 'SONAS' }, ctx.identidad, conv.cambios, tiposPorNombre(COLS))
    check(
      '(9e-bis) Oracle con un salto en el nombre: una entrada por cambio, cada una un bloque terminado en «/»',
      pSalto.ok && pSalto.lineas.length === 4 && pSalto.lineas.every((l) => /^(?:DECLARE|BEGIN)\n[\s\S]*\nEND;\n\/$/.test(l)) && pSalto.texto === pSalto.lineas.join('\n'),
      pSalto.ok ? j(pSalto.lineas[0].slice(0, 60)) : j(pSalto)
    )
  }
  check('(9f) filas = 0: «la fila cambió o ya no existe»', /cambió o ya no existe/.test(mensajeFallo({ mensaje: 'x' }, 0)), mensajeFallo({ mensaje: 'x' }, 0))
  check('(9g) filas = 2: dice cuántas', /2 filas/.test(mensajeFallo({ mensaje: 'x' }, 2)), mensajeFallo({ mensaje: 'x' }, 2))
  check('(9h) sin filas: el error del servidor con su código', mensajeFallo({ mensaje: 'duplicada', codigo: '23505' }, undefined) === '[23505] duplicada' && mensajeFallo({ mensaje: 'x' }, 1) === 'x', 'ok')

  // -------------------------------------------------------------------------
  hr('(9-bis) concurrencia optimista con el ROWID: los originales')
  // Una tabla de Oracle sin PK con una columna de cada familia, como las describe el
  // trabajador (`tipoLogicoOracle` / `tipoMotorOracle` de src/tdb/celdas.cjs).
  const colsOra: DbColumnaResultado[] = [
    col('ID', 'numero', 'NUMBER(10)'), // 0  sí
    col('NOMBRE', 'texto', 'VARCHAR2(40)'), // 1  sí
    col('CODIGO', 'texto', 'CHAR(5)'), // 2  sí (con su relleno)
    col('NOMBRE_N', 'texto', 'NVARCHAR2(20)'), // 3  no: juego nacional
    col('ALTA', 'fechaHora', 'DATE'), // 4  sí
    col('MARCA', 'fechaHora', 'TIMESTAMP'), // 5  no: FF6
    col('PESO', 'numero', 'BINARY_DOUBLE'), // 6  no: coma flotante
    col('RATIO', 'numero', 'FLOAT(126)'), // 7  no: FLOAT
    col('NOTAS', 'lob', 'CLOB'), // 8  no
    col('FOTO', 'binario', 'BLOB'), // 9  no
    col('CRUDO', 'binario', 'RAW(16)'), // 10 no
    col('LARGO', 'texto', 'LONG'), // 11 no
    col('DOC_XML', 'texto', 'XMLTYPE'), // 12 no
    col('PLAZO', 'otro', 'INTERVAL DAY TO SECOND'), // 13 no
    col('ACTIVO', 'booleano', 'BOOLEAN'), // 14 no
    col('DOC', 'json', 'JSON'), // 15 no
    col('RESUMEN', 'texto', 'VARCHAR2(4000)'), // 16 sí, salvo si llega recortada
    col('VACIA', 'texto', 'VARCHAR2(10)'), // 17 sí (NULL también se compara)
    col(COLUMNA_ROWID, 'texto', 'VARCHAR2') // 18 la identidad
  ]
  const filaOra: DbCelda[] = [
    '7', 'Ana', 'AB   ', 'Ñandú', '2024-01-02 03:04:05', '2024-01-02 03:04:05.123456', '0.1', '1.5',
    'texto largo', '0x00', '0xAB', 'largo', '<a/>', '+01 02:03:04.000000', true, '{"a":1}', 'resumen', null,
    'AAAR1dAAEAAAAFbAAA'
  ]
  const filaRara: DbCelda[] = ['~', 'Luis', null, null, '-0044-03-15 00:00:00', null, null, null, null, null, null, null, null, null, null, null, 'r', 'v', 'AAAR1dAAEAAAAFbAAB']
  const RID: DbIdentidadFila = { tipo: 'rowid', columna: COLUMNA_ROWID }
  // Lo que el main manda al abrir (`DbTablaAbierta.comparables`, por su catálogo). MARCA
  // está (su catálogo dice TIMESTAMP(6)), pero aquí llega 'TIMESTAMP' a secas: la rejilla
  // no la manda, porque solo QUITA de la lista del main, nunca pone.
  const COMPARABLES_MAIN = ['ID', 'NOMBRE', 'CODIGO', 'ALTA', 'MARCA', 'RESUMEN', 'VACIA']
  const ctxOra = { columnas: colsOra, identidad: RID, filas: [filaOra, filaRara], comparables: COMPARABLES_MAIN }
  const ORIG_0 = { ID: '7', NOMBRE: 'Ana', CODIGO: 'AB   ', ALTA: '2024-01-02 03:04:05', RESUMEN: 'resumen', VACIA: null }
  let eo = editarCelda(SIN_CAMBIOS, S(0), 1, 'Eva', 'Ana')
  eo = borrarFilas(eo, [S(1)])
  const co = aCambiosFila(eo, ctxOra)
  check('(9-bis a) convierte', co.ok, j(co))
  if (co.ok) {
    const borrar = co.cambios[0]
    const actualizar = co.cambios[1]
    check(
      '(9-bis b) UPDATE con ROWID: originales = SOLO las comparables, con lo LEÍDO (NOMBRE vale «Ana», no «Eva»)',
      actualizar.tipo === 'actualizar' && j(actualizar.originales) === j(ORIG_0) && j(actualizar.valores) === j({ NOMBRE: 'Eva' }),
      j(actualizar)
    )
    check(
      '(9-bis c) DELETE con ROWID: también; y por CELDA fuera un NUMBER «~» y una fecha antes de Cristo',
      borrar.tipo === 'borrar' && j(borrar.originales) === j({ NOMBRE: 'Luis', CODIGO: null, RESUMEN: 'r', VACIA: 'v' }),
      j(borrar)
    )
    check(
      '(9-bis d) NEGATIVO: nunca la columna oculta del ROWID (ya es la clave)',
      co.cambios.every((x) => x.tipo === 'insertar' || !(x.originales && COLUMNA_ROWID in x.originales)),
      'ok'
    )
    const previa = previaEnvio('oracle', { esquema: 'HR', nombre: 'T' }, RID, co.cambios, tiposPorNombre(colsOra))
    const upd = previa.ok ? previa.lineas[1] : ''
    check(
      '(9-bis e) la vista previa (el constructor del main) ENSEÑA las comprobaciones, detrás del ROWID',
      previa.ok &&
        upd.startsWith('UPDATE "HR"."T" SET "NOMBRE" = ') &&
        upd.includes('ROWID = ') &&
        upd.includes(`"NOMBRE" = 'Ana'`) &&
        upd.includes(`"CODIGO" = 'AB   '`) &&
        upd.includes('"VACIA" IS NULL') &&
        !/"(PESO|NOTAS|MARCA|NOMBRE_N|DOC)"/.test(upd),
      upd
    )
  }
  const cRecortada = aCambiosFila(editarCelda(SIN_CAMBIOS, S(0), 1, 'Eva', 'Ana'), { ...ctxOra, recortada: (f, c) => f === 0 && c === 16 })
  check(
    '(9-bis f) una celda RECORTADA no se compara (lo leído no es el valor entero)',
    cRecortada.ok && cRecortada.cambios[0].tipo === 'actualizar' && !('RESUMEN' in (cRecortada.cambios[0].originales ?? {})) && 'NOMBRE' in (cRecortada.cambios[0].originales ?? {}),
    j(cRecortada)
  )
  const soloNoComparables = [col('NOTAS', 'lob', 'CLOB'), col('PESO', 'numero', 'BINARY_DOUBLE'), col(COLUMNA_ROWID, 'texto', 'VARCHAR2')]
  const cNinguna = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0)]), {
    columnas: soloNoComparables,
    identidad: RID,
    filas: [['x', '0.5', 'AAAR1dAAEAAAAFbAAA']],
    // Aunque el main las listara (no lo haría): el tipo manda igual.
    comparables: ['NOTAS', 'PESO']
  })
  check(
    '(9-bis g) sin ninguna comparable por su tipo (aunque vinieran en la lista del main): el cambio va SIN `originales` (como en las fases 1-3)',
    cNinguna.ok && j(cNinguna.cambios[0]) === j({ tipo: 'borrar', clave: ['AAAR1dAAEAAAAFbAAA'] }),
    j(cNinguna)
  )
  const pkOra: DbIdentidadFila = { tipo: 'pk', columnas: ['ID'] }
  const cPk = aCambiosFila(eo, { ...ctxOra, identidad: pkOra })
  check(
    '(9-bis h) NEGATIVO: con PK no se manda NINGÚN original (identifica por valor)',
    cPk.ok && cPk.cambios.every((x) => !('originales' in x)),
    j(cPk)
  )
  const repetida = [col('A', 'texto', 'VARCHAR2(5)'), col('A', 'texto', 'VARCHAR2(5)'), col('B', 'texto', 'VARCHAR2(5)'), col(COLUMNA_ROWID, 'texto', 'VARCHAR2')]
  const cRep = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0)]), { columnas: repetida, identidad: RID, filas: [['1', '2', 'b', 'AAAR1dAAEAAAAFbAAA']], comparables: ['A', 'B'] })
  check(
    '(9-bis i) un nombre REPETIDO no se compara (no se sabe cuál de las dos es)',
    cRep.ok && cRep.cambios[0].tipo === 'borrar' && j(cRep.cambios[0].originales) === j({ B: 'b' }),
    j(cRep)
  )
  check(
    '(9-bis j) columnaComparable: la lista blanca y sus mitades negativas',
    columnaComparable(col('X', 'texto', 'VARCHAR2(40)')) &&
      columnaComparable(col('X', 'numero', 'NUMBER')) &&
      columnaComparable(col('X', 'fechaHora', 'DATE')) &&
      !columnaComparable(col('X', 'numero', 'FLOAT(63)')) &&
      !columnaComparable(col('X', 'fechaHora', 'TIMESTAMP WITH TIME ZONE')) &&
      !columnaComparable(col('X', 'texto', 'NCHAR(3)')) &&
      // Del revisor: la lista es la MISMA que la del main (`comparacionOracle`), que no
      // conoce VARCHAR (Oracle lo guarda como VARCHAR2): elegirla enseñaría en la vista
      // previa una comprobación que el main quita.
      !columnaComparable(col('X', 'texto', 'VARCHAR(40)')) &&
      !columnaComparable(col('X', 'lob', 'VARCHAR2(40)')) && // familia que no casa con el tipo
      !columnaComparable(col(COLUMNA_ROWID, 'texto', 'VARCHAR2')) &&
      !columnaComparable(col('X', 'texto', 'constructor')), // nada del prototipo cuela
    'ok'
  )
  check(
    '(9-bis k) TIMESTAMP: solo con la precisión a la vista (la que da el trabajador) y ≤ 6; «TIMESTAMP» a secas, NO; LOCAL, nunca',
    !columnaComparable(col('X', 'fechaHora', 'TIMESTAMP')) &&
      !columnaComparable(col('X', 'fechaHora', 'TIMESTAMP WITH TIME ZONE')) &&
      columnaComparable(col('X', 'fechaHora', 'TIMESTAMP(6)')) &&
      columnaComparable(col('X', 'fechaHora', 'TIMESTAMP(3) WITH TIME ZONE')) &&
      !columnaComparable(col('X', 'fechaHora', 'TIMESTAMP(9)')) &&
      !columnaComparable(col('X', 'fechaHora', 'TIMESTAMP(6) WITH LOCAL TIME ZONE')) &&
      !columnaComparable(col('X', 'texto', 'TIMESTAMP(6)')),
    'ok'
  )
  const colsTs = [col('M', 'fechaHora', 'TIMESTAMP(6)'), col('Z', 'fechaHora', 'TIMESTAMP(6) WITH TIME ZONE'), col('D', 'fechaHora', 'DATE'), col(COLUMNA_ROWID, 'texto', 'VARCHAR2')]
  const filasTs: DbCelda[][] = [
    ['2024-01-02 03:04:05.123456', '2024-01-02 03:04:05.123456 +02:00', '2024-01-02 03:04:05', 'AAAR1dAAEAAAAFbAAA'],
    ['2024-01-02 03:04:05.1234567', '2024-01-02 03:04:05 Europe/Madrid', '2024-01-02 03:04:05.1', 'AAAR1dAAEAAAAFbAAB']
  ]
  const cTs = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0), S(1)]), { columnas: colsTs, identidad: RID, filas: filasTs, comparables: ['M', 'Z', 'D'] })
  check(
    '(9-bis l) cada valor con la forma que la sesión sabe leer (FF6, TZH:TZM, DATE sin decimales); lo demás, fuera',
    cTs.ok &&
      j(cTs.cambios.map((x) => (x.tipo === 'insertar' ? null : x.originales))) ===
        j([{ M: '2024-01-02 03:04:05.123456', Z: '2024-01-02 03:04:05.123456 +02:00', D: '2024-01-02 03:04:05' }, undefined]),
    j(cTs)
  )
  // SQLite: la regla de tipo es del MOTOR (`comparacionOriginal`, por el dialecto del
  // contexto). Con la lista blanca de Oracle, INTEGER y TEXT no se compararían nunca: el
  // envío iría solo por el rowid, sin concurrencia optimista.
  const colsSq = [
    col('ID', 'numero', 'INTEGER'),
    col('NOMBRE', 'texto', 'TEXT'),
    col('ALTA', 'texto', 'DATE'),
    col('PRECIO', 'numero', 'DECIMAL(10,2)'),
    col('FOTO', 'binario', 'BLOB'),
    col('SUELTA', 'otro', ''),
    col('FUERA', 'texto', 'TEXT'),
    col(COLUMNA_ROWID, 'numero', 'INTEGER')
  ]
  const filaSq: DbCelda[] = ['7', 'Ana', '2024-01-02', '1.5', '0x00ff', '42', 'no', '7']
  const ctxSq = { columnas: colsSq, identidad: RID, filas: [filaSq], comparables: ['ID', 'NOMBRE', 'ALTA', 'PRECIO', 'FOTO', 'SUELTA'] }
  const cSq = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0)]), { ...ctxSq, dialecto: 'sqlite' })
  check(
    '(9-ter a) SQLite: se comparan INTEGER, TEXT, DATE y DECIMAL (afinidad); BLOB, sin tipo y lo que el main no lista, no',
    cSq.ok && cSq.cambios[0].tipo === 'borrar' && j(cSq.cambios[0].originales) === j({ ID: '7', NOMBRE: 'Ana', ALTA: '2024-01-02', PRECIO: '1.5' }),
    j(cSq)
  )
  const cSqSin = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0)]), ctxSq)
  check(
    '(9-ter b) NEGATIVO: los mismos tipos SIN dialecto caen en la regla de Oracle y no se compara nada',
    cSqSin.ok && j(cSqSin.cambios[0]) === j({ tipo: 'borrar', clave: ['7'] }),
    j(cSqSin)
  )
  check(
    '(9-ter c) la FAMILIA del resultado tiene que casar con la de la regla, y la regla de Oracle no cambia con dialecto explícito; PG no compara nada',
    !columnaComparable(col('ID', 'texto', 'INTEGER'), 'sqlite') &&
      columnaComparable(col('ID', 'numero', 'INTEGER'), 'sqlite') &&
      !columnaComparable(col(COLUMNA_ROWID, 'numero', 'INTEGER'), 'sqlite') &&
      columnaComparable(col('X', 'numero', 'NUMBER'), 'oracle') === columnaComparable(col('X', 'numero', 'NUMBER')) &&
      !columnaComparable(col('X', 'numero', 'INTEGER'), 'oracle') &&
      !columnaComparable(col('X', 'texto', 'text'), 'postgres'),
    'ok'
  )
  // La lista del MAIN acota lo que se manda (la vista previa no
  // puede enseñar una comprobación que el main quite), y la regla del valor es la suya.
  const cSinLista = aCambiosFila(eo, { columnas: colsOra, identidad: RID, filas: [filaOra, filaRara] })
  check(
    '(9-bis m) sin la lista `comparables` del main: NINGÚN original (no se adivina lo que el main compara)',
    cSinLista.ok && cSinLista.cambios.every((x) => !('originales' in x)),
    j(cSinLista)
  )
  const cVieja = aCambiosFila(eo, { ...ctxOra, comparables: COMPARABLES_MAIN.filter((n) => n !== 'NOMBRE') })
  check(
    '(9-bis n) una columna comparable por su tipo que el main NO lista (su catálogo dice otra cosa: un DDL de fuera) no se manda; las demás sí',
    cVieja.ok &&
      cVieja.cambios[1]?.tipo === 'actualizar' &&
      !('NOMBRE' in (cVieja.cambios[1].originales ?? {})) &&
      j(cVieja.cambios[1].originales) === j({ ID: '7', CODIGO: 'AB   ', ALTA: '2024-01-02 03:04:05', RESUMEN: 'resumen', VACIA: null }),
    j(cVieja)
  )
  const filaPerdida: DbCelda[] = [...filaOra]
  filaPerdida[1] = 'A' + String.fromCharCode(0xfffd) + 'B' // un VARCHAR2 leído con pérdida
  const cPerdida = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0)]), { ...ctxOra, filas: [filaPerdida] })
  check(
    '(9-bis o) un texto leído con pérdida (U+FFFD) no se manda, como en el main (antes la vista previa lo enseñaba y el main lo quitaba); el resto de la fila sí',
    cPerdida.ok &&
      cPerdida.cambios[0]?.tipo === 'borrar' &&
      !('NOMBRE' in (cPerdida.cambios[0].originales ?? {})) &&
      (cPerdida.cambios[0].originales ?? {}).CODIGO === 'AB   ',
    j(cPerdida)
  )
  const colsMarcas = [
    col('M6', 'fechaHora', 'TIMESTAMP(6)'),
    col('M0', 'fechaHora', 'TIMESTAMP(0)'),
    col('MZ', 'fechaHora', 'TIMESTAMP(3) WITH TIME ZONE'),
    col('M9', 'fechaHora', 'TIMESTAMP(9)'),
    col('ML', 'fechaHora', 'TIMESTAMP(6) WITH LOCAL TIME ZONE'),
    col(COLUMNA_ROWID, 'texto', 'VARCHAR2')
  ]
  const filaMarcas: DbCelda[] = [
    '2024-01-02 03:04:05.123456',
    '2024-01-02 03:04:05',
    '2024-01-02 03:04:05.123 +01:00',
    '2024-01-02 03:04:05.123456',
    '2024-01-02 03:04:05.500000',
    'AAAR1dAAEAAAAFbAAA'
  ]
  const cMarcas = aCambiosFila(borrarFilas(SIN_CAMBIOS, [S(0)]), { columnas: colsMarcas, identidad: RID, filas: [filaMarcas], comparables: ['M6', 'M0', 'MZ'] })
  check(
    '(9-bis p) con el tipoMotor que da el trabajador, los TIMESTAMP(≤6) y de zona SE MANDAN; el (9) y el LOCAL, no',
    cMarcas.ok &&
      cMarcas.cambios[0]?.tipo === 'borrar' &&
      j(cMarcas.cambios[0].originales) === j({ M6: filaMarcas[0], M0: filaMarcas[1], MZ: filaMarcas[2] }),
    j(cMarcas)
  )

  // -------------------------------------------------------------------------
  hr('(10) teclado de EDICIÓN en WINDOWS')
  const W = 'windows' as const
  const tipo = (a: ReturnType<typeof accionEdicion>): string => (a ? a.tipo : 'null')
  check('(10a) F2 e Intro editan', tipo(accionEdicion(tecla('F2'), W)) === 'editar' && tipo(accionEdicion(tecla('Enter'), W)) === 'editar', 'ok')
  check('(10b) NEGATIVO: Ctrl+F2 (Detener) y Mayús+F2 NO editan', tipo(accionEdicion(tecla('F2', { ctrlKey: true }), W)) === 'null' && tipo(accionEdicion(tecla('F2', { shiftKey: true }), W)) === 'null', 'null')
  const esc = accionEdicion(tecla('a'), W)
  check('(10c) una letra empieza a editar CON ella', esc?.tipo === 'escribir' && esc.texto === 'a', j(esc))
  check('(10d) Mayús+letra también (mayúscula), y el espacio', j(accionEdicion(tecla('A', { shiftKey: true }), W)) === j({ tipo: 'escribir', texto: 'A' }) && j(accionEdicion(tecla(' '), W)) === j({ tipo: 'escribir', texto: ' ' }), 'ok')
  check('(10e) AltGr DE VERDAD escribe (@ en el teclado español)', j(accionEdicion(tecla('@', { ctrlKey: true, altKey: true, altGraph: true }), W)) === j({ tipo: 'escribir', texto: '@' }), 'ok')
  check('(10f) NEGATIVO: Ctrl+Alt+B sin AltGr NO escribe «b» (es alternar el agente)', accionEdicion(tecla('b', { ctrlKey: true, altKey: true, code: 'KeyB' }), W) === null, 'null')
  check('(10g) NEGATIVO: Ctrl+letra, Alt+letra y ⊞+letra no escriben', accionEdicion(tecla('x', { ctrlKey: true }), W) === null && accionEdicion(tecla('x', { altKey: true }), W) === null && accionEdicion(tecla('x', { metaKey: true }), W) === null, 'null')
  check('(10h) NEGATIVO: teclas con nombre (Tab, Dead, flechas) no escriben', accionEdicion(tecla('Tab'), W) === null && accionEdicion(tecla('Dead'), W) === null && accionEdicion(tecla('ArrowDown'), W) === null, 'null')
  check('(10i) un emoji (par sustituto) sí es UN carácter', caracterQueEscribe(tecla(String.fromCodePoint(0x1f600)), W) !== null, 'ok')
  check('(10j) Supr borra filas; ⌫ a secas edita la celda VACÍA', tipo(accionEdicion(tecla('Delete'), W)) === 'borrarFilas' && tipo(accionEdicion(tecla('Backspace'), W)) === 'editarVacia', 'ok')
  check('(10k) NEGATIVO: Ctrl+Supr, Ctrl+⌫, Mayús+Supr y Alt+Supr no borran', accionEdicion(tecla('Delete', { ctrlKey: true }), W) === null && accionEdicion(tecla('Backspace', { ctrlKey: true }), W) === null && accionEdicion(tecla('Delete', { shiftKey: true }), W) === null && accionEdicion(tecla('Delete', { altKey: true }), W) === null, 'null')
  check('(10l) Ctrl+Alt+N = Poner NULL (por la tecla física)', tipo(accionEdicion(tecla('n', { ctrlKey: true, altKey: true, code: 'KeyN' }), W)) === 'nulo', 'ok')
  check('(10m) NEGATIVO: AltGr+N (ñ/ń) no pone NULL: escribe', j(accionEdicion(tecla('ń', { ctrlKey: true, altKey: true, code: 'KeyN', altGraph: true }), W)) === j({ tipo: 'escribir', texto: 'ń' }), 'escribe')
  check('(10n) NEGATIVO: Ctrl+N (nueva consola) y Ctrl+Alt+Mayús+N no', accionEdicion(tecla('n', { ctrlKey: true, code: 'KeyN' }), W) === null && accionEdicion(tecla('N', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyN' }), W) === null, 'null')
  check('(10o) Ctrl+Alt+Z = revertir; NEGATIVO: Ctrl+Z (deshacer) no', tipo(accionEdicion(tecla('z', { ctrlKey: true, altKey: true, code: 'KeyZ' }), W)) === 'revertir' && accionEdicion(tecla('z', { ctrlKey: true, code: 'KeyZ' }), W) === null, 'ok')
  check('(10p) Ctrl+Intro = Enviar', tipo(accionEdicion(tecla('Enter', { ctrlKey: true }), W)) === 'enviar', 'ok')
  check('(10q) NEGATIVO: Ctrl+Mayús+Intro, ⊞+Intro, Alt+Intro no envían', accionEdicion(tecla('Enter', { ctrlKey: true, shiftKey: true }), W) === null && accionEdicion(tecla('Enter', { metaKey: true }), W) === null && accionEdicion(tecla('Enter', { altKey: true }), W) === null, 'null')
  check('(10r) NEGATIVO: Mayús+Intro no es de la edición (es el visor, de `accionTecla`)', accionEdicion(tecla('Enter', { shiftKey: true }), W) === null && accionTecla(tecla('Enter', { shiftKey: true }), W)?.tipo === 'verValor', 'ok')
  check('(10s) NEGATIVO: Mod+A y Mod+C siguen siendo de `accionTecla`', accionEdicion(tecla('a', { ctrlKey: true }), W) === null && accionEdicion(tecla('c', { ctrlKey: true }), W) === null, 'null')
  check('(10t) Linux (otra) como Windows', tipo(accionEdicion(tecla('Enter', { ctrlKey: true }), 'otra')) === 'enviar' && accionEdicion(tecla('Enter', { metaKey: true }), 'otra') === null, 'ok')

  // -------------------------------------------------------------------------
  hr('(11) teclado de EDICIÓN en MAC')
  const M = 'mac' as const
  check('(11a) F2 e ↩ editan; una letra escribe', tipo(accionEdicion(tecla('F2'), M)) === 'editar' && tipo(accionEdicion(tecla('Enter'), M)) === 'editar' && tipo(accionEdicion(tecla('q'), M)) === 'escribir', 'ok')
  check('(11b) ⌥ compone y ESCRIBE (⌥2 = «€» en el teclado español)', j(accionEdicion(tecla('€', { altKey: true, code: 'Digit2' }), M)) === j({ tipo: 'escribir', texto: '€' }), 'ok')
  check('(11c) NEGATIVO: ⌘+letra y ⌃+letra no escriben', accionEdicion(tecla('x', { metaKey: true }), M) === null && accionEdicion(tecla('x', { ctrlKey: true }), M) === null, 'null')
  check('(11d) ⌘⌫ borra filas (el gesto del Finder); ⌦ (Supr) también', tipo(accionEdicion(tecla('Backspace', { metaKey: true }), M)) === 'borrarFilas' && tipo(accionEdicion(tecla('Delete'), M)) === 'borrarFilas', 'ok')
  check('(11e) NEGATIVO: ⌃⌫ y ⌥⌫ no borran filas; ⌫ a secas edita vacía', accionEdicion(tecla('Backspace', { ctrlKey: true }), M) === null && accionEdicion(tecla('Backspace', { altKey: true }), M) === null && tipo(accionEdicion(tecla('Backspace'), M)) === 'editarVacia', 'ok')
  check('(11f) ⌥⌘N = Poner NULL aunque ⌥ componga la `key`', tipo(accionEdicion(tecla('˜', { metaKey: true, altKey: true, code: 'KeyN' }), M)) === 'nulo', 'ok')
  check('(11g) NEGATIVO: ⌃⌥N (el modificador ajeno) y ⌘N (nueva consola) no', accionEdicion(tecla('n', { ctrlKey: true, altKey: true, code: 'KeyN' }), M) === null && accionEdicion(tecla('n', { metaKey: true, code: 'KeyN' }), M) === null, 'null')
  check('(11h) ⌥⌘Z revierte; NEGATIVO: ⌘Z (deshacer) no', tipo(accionEdicion(tecla('Ω', { metaKey: true, altKey: true, code: 'KeyZ' }), M)) === 'revertir' && accionEdicion(tecla('z', { metaKey: true, code: 'KeyZ' }), M) === null, 'ok')
  check('(11i) ⌘↩ envía; NEGATIVO: ⌃↩ y ⌘⇧↩ no', tipo(accionEdicion(tecla('Enter', { metaKey: true }), M)) === 'enviar' && accionEdicion(tecla('Enter', { ctrlKey: true }), M) === null && accionEdicion(tecla('Enter', { metaKey: true, shiftKey: true }), M) === null, 'ok')
  check('(11j) NEGATIVO: en Mac no hay AltGr que valga para Ctrl+Alt', caracterQueEscribe(tecla('@', { ctrlKey: true, altKey: true, altGraph: true }), M) === null, 'null')

  // -------------------------------------------------------------------------
  hr('(12) el editor de una celda')
  const ed = (k: TeclaEdicion, p: 'windows' | 'mac'): string => j(accionEditorCelda(k, p))
  for (const p of [W, M]) {
    const modK = p === 'mac' ? { metaKey: true } : { ctrlKey: true }
    const ajeno = p === 'mac' ? { ctrlKey: true } : { metaKey: true }
    check(`(12a ${p}) Intro baja, Mayús+Intro sube`, ed(tecla('Enter'), p) === j({ tipo: 'confirmar', mov: 'abajo' }) && ed(tecla('Enter', { shiftKey: true }), p) === j({ tipo: 'confirmar', mov: 'arriba' }), 'ok')
    check(`(12b ${p}) Tab avanza, Mayús+Tab retrocede`, ed(tecla('Tab'), p) === j({ tipo: 'confirmar', mov: 'derecha' }) && ed(tecla('Tab', { shiftKey: true }), p) === j({ tipo: 'confirmar', mov: 'izquierda' }), 'ok')
    check(`(12c ${p}) Esc cancela`, ed(tecla('Escape'), p) === j({ tipo: 'cancelar' }), 'ok')
    check(`(12d ${p}) Alt/⌥+Intro = salto de línea`, ed(tecla('Enter', { altKey: true }), p) === j({ tipo: 'salto' }), 'ok')
    check(`(12e ${p}) Mod+Intro confirma y envía`, ed(tecla('Enter', modK), p) === j({ tipo: 'enviar' }), 'ok')
    check(`(12f ${p}) NEGATIVO: el modificador ajeno + Intro, Mod+Mayús+Intro y Mod+Tab no son del editor`, accionEditorCelda(tecla('Enter', ajeno), p) === null && accionEditorCelda(tecla('Enter', { ...modK, shiftKey: true }), p) === null && accionEditorCelda(tecla('Tab', modK), p) === null, 'null')
    check(`(12g ${p}) NEGATIVO: letras, flechas, Mod+C/V/Z son del campo de texto`, accionEditorCelda(tecla('a'), p) === null && accionEditorCelda(tecla('ArrowLeft'), p) === null && accionEditorCelda(tecla('v', modK), p) === null && accionEditorCelda(tecla('z', modK), p) === null, 'null')
  }
  check('(12h) Poner NULL también desde el editor (Ctrl+Alt+N / ⌥⌘N)', ed(tecla('n', { ctrlKey: true, altKey: true, code: 'KeyN' }), W) === j({ tipo: 'nulo' }) && ed(tecla('˜', { metaKey: true, altKey: true, code: 'KeyN' }), M) === j({ tipo: 'nulo' }), 'ok')
  check('(12i) NEGATIVO: AltGr+Intro no es un salto de línea del editor', accionEditorCelda(tecla('Enter', { ctrlKey: true, altKey: true, altGraph: true }), W) === null, 'null')

  // -------------------------------------------------------------------------
  hr('(13) `accionTecla` NO cambia: la consola y las tablas de solo lectura siguen igual')
  check('(13a) Intro a secas sigue sin hacer nada en la rejilla de solo lectura', accionTecla(tecla('Enter'), W) === null && accionTecla(tecla('Enter'), M) === null, 'null')
  check('(13b) F2, Supr y una letra tampoco', accionTecla(tecla('F2'), W) === null && accionTecla(tecla('Delete'), W) === null && accionTecla(tecla('a'), W) === null, 'null')

  // -------------------------------------------------------------------------
  hr('(15) operaciones EN BLOQUE: lo mismo que fila a fila, y LINEALES')
  // Estados al azar (semilla fija) y, sobre cada uno, la operación en bloque contra la
  // de UNA fila encadenada (que es como estaba escrita antes: su resultado es la
  // referencia). Con repetidas y con filas nuevas que no existen.
  let semilla = 0x5eed
  const azar = (n: number): number => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla % n
  }
  const refAzar = (cs: CambiosRejilla): RefFila =>
    azar(4) === 0 ? N(cs.nuevas.length > 0 && azar(3) > 0 ? cs.nuevas[azar(cs.nuevas.length)].id : 99) : S(azar(12))
  const estadoAzar = (): CambiosRejilla => {
    let s: CambiosRejilla = SIN_CAMBIOS
    for (let k = 0; k < 25; k++) {
      const op = azar(5)
      if (op === 0) s = anadirFila(s).cambios
      else if (op === 1) s = borrarFilas(s, [refAzar(s)])
      else s = editarCelda(s, refAzar(s), azar(4), azar(3) === 0 ? null : `v${azar(3)}`, 'v0')
    }
    return s
  }
  let equivalentes = 0
  const fallos: string[] = []
  for (let k = 0; k < 300; k++) {
    const s = estadoAzar()
    const refs = Array.from({ length: 1 + azar(8) }, () => refAzar(s))
    const c0 = azar(4)
    const c1 = c0 + azar(4 - c0)
    const enBloque = {
      borrar: borrarFilas(s, refs),
      revertirFilas: revertirFilas(s, refs),
      revertirRango: revertirRango(s, refs, c0, c1, 4)
    }
    const filaAFila = {
      borrar: refs.reduce((acc, r) => borrarFilas(acc, [r]), s),
      revertirFilas: refs.reduce((acc, r) => revertirFilas(acc, [r]), s),
      revertirRango: refs.reduce((acc, r) => revertirRango(acc, [r], c0, c1, 4), s)
    }
    const ediciones = refs.map((r, i) => ({ ref: r, col: (c0 + i) % 4, valor: i % 3 === 0 ? null : `v${i % 2}`, original: 'v0' as DbCelda }))
    const bloqueEd = editarCeldas(s, ediciones)
    const unaAUna = ediciones.reduce((acc, e) => editarCelda(acc, e.ref, e.col, e.valor, e.original), s)
    const hay = hayCambiosEnRango(s, refs, c0, c1, 4)
    const ok =
      j(enBloque) === j(filaAFila) &&
      j(bloqueEd) === j(unaAUna) &&
      hay === (revertirRango(s, refs, c0, c1, 4) !== s) &&
      // Donde fila a fila no cambiaba NADA (el mismo objeto), en bloque tampoco.
      (filaAFila.borrar !== s || enBloque.borrar === s) &&
      (filaAFila.revertirFilas !== s || enBloque.revertirFilas === s) &&
      (filaAFila.revertirRango !== s || enBloque.revertirRango === s) &&
      (unaAUna !== s || bloqueEd === s)
    if (ok) equivalentes++
    else if (fallos.length < 2) fallos.push(j({ s, refs, c0, c1 }))
  }
  check('(15a) 300 casos al azar: bloque = fila a fila (borrar, revertir filas/rango, editar celdas) y hayCambiosEnRango = revertirRango !== c', equivalentes === 300, `${equivalentes}/300 ${fallos.join(' | ')}`)
  const unaEditada = editarCelda(SIN_CAMBIOS, S(0), 1, 'X', 'Ana')
  const conBorrada = borrarFilas(unaEditada, [S(1)])
  check(
    '(15b) no-ops en bloque: MISMO objeto (NULL sobre NULL, borrar lo borrado, revertir lo limpio)',
    editarCeldas(SIN_CAMBIOS, [{ ref: S(2), col: 2, valor: null, original: null }]) === SIN_CAMBIOS &&
      conBorrada !== unaEditada &&
      borrarFilas(conBorrada, [S(1), S(1)]) === conBorrada &&
      revertirRango(unaEditada, [S(0)], 3, 3, 4) === unaEditada &&
      revertirFilas(unaEditada, [S(5), N(7)]) === unaEditada,
    'ok'
  )
  // LINEALES. Fila a fila copiaban el mapa entero en cada paso: MEDIDO, 20 000 filas
  // borradas = 9,8 s (y lo mismo cada render, por `hayCambiosEnRango` en el menú).
  const MUCHAS = 20_000
  const todas: RefFila[] = Array.from({ length: MUCHAS }, (_x, f) => S(f))
  let t0 = performance.now()
  const borradas = borrarFilas(SIN_CAMBIOS, todas)
  const msBorrar = performance.now() - t0
  t0 = performance.now()
  const hayEnTodas = hayCambiosEnRango(borradas, todas, 0, 3, 4)
  const msHay = performance.now() - t0
  t0 = performance.now()
  const revertidas = revertirRango(borradas, todas, 0, 3, 4)
  const msRevertir = performance.now() - t0
  t0 = performance.now()
  const nulos = editarCeldas(
    SIN_CAMBIOS,
    todas.slice(0, 5000).flatMap((r) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((col) => ({ ref: r, col, valor: null, original: 'x' as DbCelda })))
  )
  const msNulos = performance.now() - t0
  check(
    `(15c) borrar ${MUCHAS} filas en bloque, lineal (< 1 s)`,
    numCambios(borradas) === MUCHAS && msBorrar < 1000,
    `${msBorrar.toFixed(0)} ms`
  )
  check(`(15d) hayCambiosEnRango sobre ${MUCHAS} borradas, sin construir nada (< 200 ms)`, hayEnTodas && msHay < 200, `${msHay.toFixed(1)} ms`)
  check(`(15e) revertir el rango de ${MUCHAS} filas, lineal (< 1 s)`, numCambios(revertidas) === 0 && msRevertir < 1000, `${msRevertir.toFixed(0)} ms`)
  check('(15f) Poner NULL en 5 000 × 10 celdas en bloque, lineal (< 1,5 s)', numCambios(nulos) === 5000 && nulos.editadas.get(4999)?.valores.size === 10 && msNulos < 1500, `${msNulos.toFixed(0)} ms`)

  // -------------------------------------------------------------------------
  hr('(16) el editor y los CRLF (el <textarea> los devuelve como LF)')
  const conCrlf = 'calle 1\r\npiso 2'
  // Lo que el <textarea> devuelve en `value` sin que nadie lo toque (MEDIDO en Chromium).
  const valueDelTextarea = normalizarSaltos(conCrlf)
  check('(16a) normalizarSaltos: CRLF y CR pasan a LF', normalizarSaltos('a\r\nb\rc\nd') === 'a\nb\nc\nd', normalizarSaltos('a\r\nb\rc\nd'))
  check(
    '(16b) F2 + Intro sin tocar un valor con CRLF NO es un cambio (antes lo era: se comparaba el value a pelo)',
    !textoEditorCambiado(false, conCrlf, valueDelTextarea),
    'sin cambio'
  )
  check('(16c) NEGATIVO: tocarlo sí es un cambio; y abierto escribiendo (sucio), siempre', textoEditorCambiado(false, conCrlf, valueDelTextarea + 'A') && textoEditorCambiado(true, 'x', 'x'), 'ok')
  check(
    '(16d) lo confirmado devuelve los CRLF a un valor que los usaba TODOS (también el salto nuevo)',
    valorDesdeEditor(conCrlf, valueDelTextarea + ' B') === 'calle 1\r\npiso 2 B' && valorDesdeEditor(conCrlf, 'a\nb\nc') === 'a\r\nb\r\nc',
    j(valorDesdeEditor(conCrlf, 'a\nb\nc'))
  )
  check(
    '(16e) NEGATIVO: con LF, sin saltos o con saltos MEZCLADOS se queda como está',
    valorDesdeEditor('a\nb', 'a\nbX') === 'a\nbX' && valorDesdeEditor('ab', 'a\nb') === 'a\nb' && valorDesdeEditor('a\r\nb\nc', 'a\nb\ncX') === 'a\nb\ncX' && valorDesdeEditor('\nb\r\nc', 'x\ny') === 'x\ny',
    'ok'
  )
  const tocado = valorDesdeEditor(conCrlf, valueDelTextarea + 'X')
  check(
    '(16f) de punta a punta: editar y volver al texto original quita el cambio (los CRLF vuelven)',
    editarCelda(SIN_CAMBIOS, S(0), 1, valorDesdeEditor(conCrlf, valueDelTextarea), conCrlf) === SIN_CAMBIOS &&
      numCambios(editarCelda(SIN_CAMBIOS, S(0), 1, tocado, conCrlf)) === 1,
    j(tocado)
  )

  // -------------------------------------------------------------------------
  hr('(17) no se edita mientras llega OTRO resultado')
  const pk: DbIdentidadFila = { tipo: 'pk', columnas: ['id'] }
  check('(17a) con identidad y sin lectura en vuelo, se edita', sePuedeEditar(pk, false) && sePuedeEditar({ tipo: 'rowid', columna: COLUMNA_ROWID }, false), 'ok')
  check('(17b) NEGATIVO: con otra lectura en vuelo, no (la rejilla enseña el resultado VIEJO)', !sePuedeEditar(pk, true), 'no')
  check('(17c) NEGATIVO: sin identidad o sin resultado, tampoco', !sePuedeEditar({ tipo: 'ninguna', motivo: 'x' }, false) && !sePuedeEditar(null, false), 'no')

  // -------------------------------------------------------------------------
  hr('(18) la selección cuando quitar filas NUEVAS mueve las del servidor')
  // La rejilla guarda la selección como POSICIONES de la vista. El caso: 2
  // nuevas arriba, se eligen las posiciones 0-4 (las 2 nuevas + servidor 0-2) y Supr.
  const NS = 10
  const vista = (cs: CambiosRejilla, numServidor = NS): VistaFilas => ({ cambios: cs, numServidor })
  const sel = (f0: number, c0: number, f1: number, c1: number): Seleccion => ({ ancla: { f: f0, c: c0 }, foco: { f: f1, c: c1 } })
  const filasDe = (cs: CambiosRejilla, s: Seleccion, numServidor = NS): RefFila[] => {
    const rg = rango(s)
    return rg ? filasEnRango(cs, rg.f0, rg.f1, numServidor) : []
  }
  const dosNuevas = anadirFila(anadirFila(SIN_CAMBIOS).cambios).cambios
  const elegida = sel(0, 0, 4, 2)
  const elegidas = filasDe(dosNuevas, elegida)
  const trasSupr = borrarFilas(dosNuevas, elegidas)
  const reubicada = reubicarSeleccion(elegida, vista(dosNuevas), vista(trasSupr))
  check(
    '(18a) tras quitar las 2 nuevas, la selección cubre servidor 0-2 (las ELEGIDAS que quedan), en las posiciones 0-2',
    j(elegidas) === j([N(1), N(2), S(0), S(1), S(2)]) && j(reubicada) === j(sel(0, 0, 2, 2)) && j(filasDe(trasSupr, reubicada)) === j([S(0), S(1), S(2)]),
    `${j(reubicada)} -> ${j(filasDe(trasSupr, reubicada))}`
  )
  // Sin reubicar, la MISMA selección (posiciones 0-4) ya nombraba servidor 0-4, y otro Supr
  // marcaba la 3 y la 4, que nadie eligió. Con ella reubicada, otro Supr no toca nada.
  check(
    '(18b) otro Supr sobre la selección reubicada no marca filas que nadie eligió (no-op: MISMO objeto)',
    j(filasDe(trasSupr, elegida)) === j([S(0), S(1), S(2), S(3), S(4)]) && borrarFilas(trasSupr, filasDe(trasSupr, reubicada)) === trasSupr,
    `sin reubicar habría cubierto ${j(filasDe(trasSupr, elegida))}`
  )
  check(
    '(18c) la dirección se conserva (elegida de abajo arriba: el ancla sigue abajo) y las columnas no cambian',
    j(reubicarSeleccion(sel(4, 2, 0, 1), vista(dosNuevas), vista(trasSupr))) === j(sel(2, 2, 0, 1)),
    j(reubicarSeleccion(sel(4, 2, 0, 1), vista(dosNuevas), vista(trasSupr)))
  )
  const soloNuevas = sel(0, 0, 1, 2)
  check(
    '(18d) si se quitan TODAS las elegidas (eran nuevas): sin selección, no la celda del hueco (otro Supr marcaría la fila que lo ocupa)',
    reubicarSeleccion(soloNuevas, vista(dosNuevas), vista(borrarFilas(dosNuevas, filasDe(dosNuevas, soloNuevas)))) === null,
    'null'
  )
  const conNuevaEditada = editarCelda(dosNuevas, N(2), 1, 'x', undefined)
  const soloServidor = borrarFilas(dosNuevas, [S(3)])
  check(
    '(18e) NEGATIVO: sin cambio de FORMA (marcar una del servidor, escribir en una nueva) la MISMA selección',
    mismaFormaVista(dosNuevas, conNuevaEditada) &&
      conNuevaEditada.nuevas !== dosNuevas.nuevas &&
      reubicarSeleccion(elegida, vista(dosNuevas), vista(conNuevaEditada)) === elegida &&
      reubicarSeleccion(elegida, vista(dosNuevas), vista(soloServidor)) === elegida &&
      reubicarSeleccion(elegida, vista(dosNuevas), vista(dosNuevas, 500)) === elegida &&
      reubicarSeleccion(null, vista(dosNuevas), vista(trasSupr)) === null,
    'misma'
  )
  check(
    '(18f) «Revertir cambios» (todo a SIN_CAMBIOS): la celda activa sigue en SU fila del servidor (la 5), no en la que ocupe su posición',
    j(reubicarSeleccion(sel(7, 1, 7, 1), vista(dosNuevas), vista(SIN_CAMBIOS))) === j(sel(5, 1, 5, 1)),
    j(reubicarSeleccion(sel(7, 1, 7, 1), vista(dosNuevas), vista(SIN_CAMBIOS)))
  )
  const tresNuevas = anadirFila(dosNuevas).cambios
  const sinLaDos = revertirFilas(tresNuevas, [N(2)])
  check(
    '(18g) se quita una nueva de EN MEDIO del rango: quedan la otra nueva y las del servidor, juntas',
    j(reubicarSeleccion(sel(1, 0, 4, 2), vista(tresNuevas), vista(sinLaDos))) === j(sel(1, 0, 3, 2)) &&
      j(filasDe(sinLaDos, reubicarSeleccion(sel(1, 0, 4, 2), vista(tresNuevas), vista(sinLaDos)))) === j([N(3), S(0), S(1)]),
    j(reubicarSeleccion(sel(1, 0, 4, 2), vista(tresNuevas), vista(sinLaDos)))
  )
  check(
    '(18h) y al revés: si reaparecen las nuevas arriba (vuelve la edición), la selección baja con su fila del servidor',
    j(reubicarSeleccion(sel(0, 1, 1, 1), vista(SIN_CAMBIOS), vista(dosNuevas))) === j(sel(2, 1, 3, 1)),
    j(reubicarSeleccion(sel(0, 1, 1, 1), vista(SIN_CAMBIOS), vista(dosNuevas)))
  )
  // Una vista con una nueva colada EN MEDIO de las elegidas (no la produce quitar filas; se
  // arma a mano): la selección no puede cubrir una fila que no se eligió.
  const colada: CambiosRejilla = {
    editadas: new Map(),
    nuevas: [
      { id: 1, valores: new Map() },
      { id: 3, valores: new Map() },
      { id: 2, valores: new Map() }
    ],
    siguienteId: 4
  }
  check(
    '(18i) si entre las que quedan se colara una fila que no se eligió: sin selección',
    reubicarSeleccion(sel(0, 0, 1, 0), vista(dosNuevas), vista(colada)) === null &&
      j(reubicarSeleccion(sel(1, 0, 1, 0), vista(dosNuevas), vista(colada))) === j(sel(2, 0, 2, 0)),
    'null'
  )
  check(
    '(18j) el VISOR sigue a su fila (servidor 1: de la posición 3 a la 1); en una nueva quitada se cierra; sin cambio de forma, la MISMA celda',
    j(reubicarCelda({ f: 3, c: 1 }, vista(dosNuevas), vista(trasSupr))) === j({ f: 1, c: 1 }) &&
      reubicarCelda({ f: 0, c: 1 }, vista(dosNuevas), vista(trasSupr)) === null &&
      reubicarCelda(null, vista(dosNuevas), vista(trasSupr)) === null &&
      (() => {
        const celdaVisor = { f: 3, c: 1 }
        return reubicarCelda(celdaVisor, vista(dosNuevas), vista(conNuevaEditada)) === celdaVisor
      })(),
    j(reubicarCelda({ f: 3, c: 1 }, vista(dosNuevas), vista(trasSupr)))
  )
  check(
    '(18k) las del servidor que ya no están cargadas no cuentan (el rango se recorta a lo que hay)',
    j(reubicarSeleccion(sel(1, 0, 9, 0), vista(dosNuevas), vista(trasSupr, 4))) === j(sel(0, 0, 3, 0)),
    j(reubicarSeleccion(sel(1, 0, 9, 0), vista(dosNuevas), vista(trasSupr, 4)))
  )
  // Mod+A tras «Traer todas» y quitar las nuevas: las del servidor NO se recorren una a una.
  const MILES = 200_000
  t0 = performance.now()
  const todaLaVista = reubicarSeleccion(sel(0, 0, MILES + 1, 3), vista(dosNuevas, MILES), vista(SIN_CAMBIOS, MILES))
  const msReubicar = performance.now() - t0
  check(
    `(18l) Mod+A sobre ${MILES} filas y quitar las nuevas: todas las del servidor, sin recorrerlas (< 5 ms)`,
    j(todaLaVista) === j(sel(0, 0, MILES - 1, 3)) && msReubicar < 5,
    `${msReubicar.toFixed(2)} ms`
  )

  // -------------------------------------------------------------------------
  hr('(19) el diálogo de «Enviar» tras un fallo, y a dónde va el foco')
  const T = { totalMs: 1, ejecucionMs: 1, lecturaMs: 0 }
  const fallo = (indice: number, motivo: FalloEnvio['error']['motivo'], mensaje: string, extra: { codigo?: string; filas?: number } = {}): FalloEnvio => ({
    tipo: 'error',
    indice,
    error: { motivo, mensaje, ...(extra.codigo ? { codigo: extra.codigo } : {}) },
    ...(extra.filas !== undefined ? { filas: extra.filas } : {}),
    tiempos: T
  })
  const perdido = estadoTrasFallo(fallo(-1, 'sesionPerdida', 'No se sabe si el COMMIT llegó a aplicarse: conexión cortada'), 3)
  check(
    '(19a) COMMIT con la conexión perdida: INCIERTO, lo dice el título, sin sentencia culpable, y el mensaje del main',
    perdido.estado.incierto === true &&
      perdido.estado.titulo === 'No se sabe si se aplicó: refresca la tabla antes de reenviar' &&
      perdido.estado.indice === null &&
      /No se sabe si el COMMIT/.test(perdido.estado.mensaje),
    j(perdido.estado)
  )
  check(
    '(19b) con el COMMIT incierto el foco va a CANCELAR también FUERA de producción (un Intro reflejo no reenvía el lote)',
    focoEnvio(perdido.estado, false) === 'cancelar' && focoEnvio(perdido.estado, true) === 'cancelar',
    `${focoEnvio(perdido.estado, false)} / ${focoEnvio(perdido.estado, true)}`
  )
  const diferida = estadoTrasFallo(fallo(-1, 'servidor', 'Falló al confirmar (COMMIT): violación', { codigo: '23503' }), 3)
  const duplicada = estadoTrasFallo(fallo(1, 'servidor', 'duplicada', { codigo: '23505' }), 2)
  check(
    '(19c) MITAD NEGATIVA: si se SABE que no se aplicó nada (el servidor rechazó el COMMIT o un cambio), no es incierto y el foco sigue en Enviar (reintentar con Intro)',
    diferida.estado.incierto === undefined &&
      diferida.estado.titulo === 'Falló al confirmar: no se aplicó ninguno' &&
      focoEnvio(diferida.estado, false) === 'enviar' &&
      duplicada.estado.incierto === undefined &&
      duplicada.estado.titulo === 'Falló el cambio 2 de 2: no se aplicó ninguno' &&
      duplicada.estado.indice === 1 &&
      duplicada.mensaje === '[23505] duplicada' &&
      !duplicada.detenido &&
      focoEnvio(duplicada.estado, false) === 'enviar',
    j([diferida.estado, duplicada.estado])
  )
  const parado = estadoTrasFallo(fallo(0, 'cancelada', 'Envío detenido: no se aplicó nada.'), 2)
  const paradoServidor = estadoTrasFallo(fallo(1, 'servidor', 'cancelada por el usuario', { codigo: '57014' }), 2)
  check(
    '(19d) Stop: «se revirtió todo», sin mensaje, `detenido` (la fila no se señala); también por el código 57014 / ORA-01013',
    parado.detenido &&
      parado.estado.titulo === 'Envío detenido: se revirtió todo' &&
      parado.estado.mensaje === '' &&
      parado.estado.incierto === undefined &&
      paradoServidor.detenido &&
      estadoTrasFallo(fallo(0, 'servidor', 'x', { codigo: 'ORA-01013' }), 1).detenido,
    j(parado.estado)
  )
  const paradoEnCommit = estadoTrasFallo(fallo(-1, 'cancelada', 'Stop con el COMMIT en camino'), 2)
  check(
    '(19e) un Stop que coincide con el COMMIT tampoco sabe si llegó: manda lo INCIERTO (título, mensaje y foco en Cancelar)',
    paradoEnCommit.estado.incierto === true &&
      paradoEnCommit.estado.titulo.startsWith('No se sabe si se aplicó') &&
      paradoEnCommit.estado.mensaje !== '' &&
      focoEnvio(paradoEnCommit.estado, false) === 'cancelar',
    j(paradoEnCommit.estado)
  )
  check(
    '(19f) un índice FUERA de la lista (≥ n) también es el COMMIT: con un plazo vencido, incierto',
    estadoTrasFallo(fallo(2, 'timeout', 'plazo'), 2).estado.incierto === true,
    j(estadoTrasFallo(fallo(2, 'timeout', 'plazo'), 2).estado)
  )
  const listo: EstadoEnvio = { tipo: 'listo' }
  const enviando: EstadoEnvio = { tipo: 'enviando' }
  check(
    '(19g) el resto del foco no cambia: al abrir, Enviar (y Cancelar en producción); enviando, Detener',
    focoEnvio(listo, false) === 'enviar' && focoEnvio(listo, true) === 'cancelar' && focoEnvio(enviando, false) === 'detener' && focoEnvio(enviando, true) === 'detener',
    'ok'
  )
  // Al CERRAR con el COMMIT incierto, el foco no puede volver al botón «Enviar cambios» de
  // la barra (quien abrió el diálogo, y sigue activo): el segundo Intro lo reabría con el
  // foco en Enviar y el tercero reenviaba; con Intro mantenido, la repetición del teclado.
  check(
    '(19h) al CERRAR con el COMMIT incierto el foco va a la REJILLA (Intro edita, no reabre el diálogo)',
    focoTrasCerrarEnvio(perdido.estado) === 'rejilla' && focoTrasCerrarEnvio(paradoEnCommit.estado) === 'rejilla',
    `${focoTrasCerrarEnvio(perdido.estado)} / ${focoTrasCerrarEnvio(paradoEnCommit.estado)}`
  )
  check(
    '(19i) MITAD NEGATIVA: en el resto (se sabe que no se aplicó nada, un Stop, o sin enviar) vuelve a quien lo abrió, como siempre',
    [diferida.estado, duplicada.estado, parado.estado, listo, enviando].every((s) => focoTrasCerrarEnvio(s) === 'quienLoAbrio'),
    j([diferida.estado, duplicada.estado, parado.estado, listo, enviando].map((s) => focoTrasCerrarEnvio(s)))
  )

  // -------------------------------------------------------------------------
  // Antes, cerrar la APP (la X, Salir/⌘Q, «Reiniciar para actualizar») tiraba los cambios
  // sin enviar sin preguntar: el diálogo de salida del main solo miraba transacciones.
  // Ahora el main pregunta y `useBdApp` contesta con `pestanasSinEnviar`. Deja el registro
  // VACÍO al terminar: (14) cuenta las pestañas registradas.
  hr('(19c) la marca de «último envío incierto»: la duda sobrevive al diálogo')
  {
    // Sin la marca, cerrar el diálogo tras un COMMIT incierto y volver a pulsar «Enviar
    // cambios» lo reabría LIMPIO (foco en Enviar, sin aviso) y un Intro reenviaba el lote
    // que quizá ya se aplicó. La marca solo informa: no quita ni apaga nada.
    const uno = editarCelda(SIN_CAMBIOS, S(0), 1, 'Ana María', FILAS[0][1])
    const dos = editarCelda(uno, S(1), 1, 'Bea', FILAS[1][1])
    const reabierto = estadoAlAbrirEnvio(true)
    check(
      '(19c1) reabierto con la marca: avisa (incierto) y el foco va a Cancelar, también fuera de producción',
      esEnvioIncierto(reabierto) && focoEnvio(reabierto, false) === 'cancelar' && reabierto.tipo === 'listo',
      j(reabierto)
    )
    check(
      '(19c2) y al cerrarlo el foco va a la rejilla, no al botón «Enviar cambios»',
      focoTrasCerrarEnvio(reabierto) === 'rejilla',
      focoTrasCerrarEnvio(reabierto)
    )
    check(
      '(19c3) NEGATIVO: sin la marca, el de siempre (foco en Enviar, sin aviso, y al cerrar a quien lo abrió)',
      !esEnvioIncierto(estadoAlAbrirEnvio(false)) &&
        focoEnvio(estadoAlAbrirEnvio(false), false) === 'enviar' &&
        focoTrasCerrarEnvio(estadoAlAbrirEnvio(false)) === 'quienLoAbrio',
      j(estadoAlAbrirEnvio(false))
    )
    check(
      '(19c4) editar MÁS celdas no la quita: el lote anterior sigue dentro de lo pendiente',
      sigueIncierto(true, dos) === true,
      'sigue'
    )
    check(
      '(19c5) sin nada pendiente se quita (envío correcto, Refrescar/filtrar/ordenar, Revertir cambios)',
      sigueIncierto(true, SIN_CAMBIOS) === false,
      'quitada'
    )
    check(
      '(19c6) NEGATIVO: nada la pone salvo el fallo incierto (cambiar lo pendiente sin marca no la inventa)',
      sigueIncierto(false, dos) === false,
      'no'
    )
    check(
      '(19c7) el aviso dice qué pasó y qué hacer, sin nombrar el sistema',
      /no se sabe|sin saber/i.test(AVISO_ENVIO_INCIERTO.titulo) && /Refresca/.test(AVISO_ENVIO_INCIERTO.texto),
      AVISO_ENVIO_INCIERTO.titulo
    )
  }

  hr('(20) cerrar la APP: las pestañas con cambios sin enviar, para el diálogo del main')
  check(
    '(20a) la etiqueta es `alias · ESQUEMA.TABLA` (sin alias, la tabla; sin esquema, el objeto)',
    etiquetaSalidaDatos('ED', 'public', 'personas') === 'ED · public.personas' &&
      etiquetaSalidaDatos(undefined, 'public', 'personas') === 'public.personas' &&
      etiquetaSalidaDatos('ED', '', 't') === 'ED · t',
    j([etiquetaSalidaDatos('ED', 'public', 'personas'), etiquetaSalidaDatos(undefined, 'public', 'personas'), etiquetaSalidaDatos('ED', '', 't')])
  )
  const conCambios = { conexionId: 'c1', solicitarCierre: async (): Promise<boolean> => true, cambiosPendientes: (): number => 40 }
  const bajasSalida = [
    registrarDatos('p1|s1', conCambios),
    registrarDatos('p1|s2', { ...conCambios, cambiosPendientes: (): number => 0 }),
    registrarDatos('p1|s3', {
      ...conCambios,
      cambiosPendientes: (): number => {
        throw new Error('pane roto')
      }
    }),
    // De OTRO perfil (keep-alive): cuenta igual, la app se cierra entera.
    registrarDatos('p2|s4', { ...conCambios, conexionId: 'c9', cambiosPendientes: (): number => 2 })
  ]
  const etiquetaVieja = etiquetarDatos('p1|s1', 'ED · public.personas')
  const etiquetaRota = etiquetarDatos('p1|s3', 'ED · public.rota')
  // Si lanzara, el caso tiene que FALLAR con su evidencia, no tumbar la prueba entera.
  let e20b: unknown
  try {
    e20b = pestanasSinEnviar()
  } catch (err) {
    e20b = `lanzó: ${String(err)}`
  }
  check(
    '(20b) solo las que tienen cambios, de todos los perfiles; una rota se salta y las demás salen igual',
    j(e20b) === j([{ etiqueta: 'ED · public.personas', cambios: 40 }, { etiqueta: 'Pestaña de tabla', cambios: 2 }]),
    j(e20b)
  )
  // La rota ya dijo lo suyo: fuera, para que lo que sigue no dependa de ella.
  bajasSalida[2]()
  etiquetaRota()
  // Un re-render que recalcula la MISMA etiqueta: la baja de la vieja llega después.
  const etiquetaNueva = etiquetarDatos('p1|s1', 'ED · public.personas')
  etiquetaVieja()
  check(
    '(20c) la baja de una etiqueta VIEJA no quita la nueva, aunque diga lo mismo',
    pestanasSinEnviar()[0]?.etiqueta === 'ED · public.personas',
    j(pestanasSinEnviar()[0])
  )
  etiquetaNueva()
  check('(20d) sin etiqueta, un nombre genérico (nunca una respuesta vacía)', pestanasSinEnviar()[0]?.etiqueta === 'Pestaña de tabla', j(pestanasSinEnviar()[0]))
  for (const baja of bajasSalida) baja()
  check('(20e) sin pestañas, nada que perder', pestanasSinEnviar().length === 0 && datosRegistrados() === 0, j([pestanasSinEnviar(), datosRegistrados()]))

  // -------------------------------------------------------------------------
  hr('(14) registro de cierre de las pestañas de datos')
  let preguntado = 0
  const api = {
    conexionId: 'c1',
    solicitarCierre: async (): Promise<boolean> => {
      preguntado++
      return false
    },
    cambiosPendientes: (): number => 3
  }
  const baja = registrarDatos('perfil|d1', api)
  check('(14a) registrada', datosRegistrados() === 1 && cambiosPendientesDatos('perfil|d1') === 3, String(datosRegistrados()))
  const otra = { conexionId: 'c1', solicitarCierre: async (): Promise<boolean> => true, cambiosPendientes: (): number => 0 }
  const bajaOtra = registrarDatos('perfil|d1', otra)
  baja()
  check('(14b) la baja de la API VIEJA no quita la nueva (remontaje rápido)', datosRegistrados() === 1 && cambiosPendientesDatos('perfil|d1') === 0, String(datosRegistrados()))
  bajaOtra()
  registrarDatos('perfil|d2', api)
  const bajaD3 = registrarDatos('perfil|d3', { ...api, cambiosPendientes: (): number => 2 })
  const bajaOtraCon = registrarDatos('perfil|d4', { ...api, conexionId: 'c2', cambiosPendientes: (): number => 7 })
  check(
    '(14d) lo sin enviar de una conexión suma SUS pestañas y no las de otra (aviso de «Eliminar conexión»)',
    cambiosPendientesDeConexion('c1') === 5 && cambiosPendientesDeConexion('c2') === 7 && cambiosPendientesDeConexion('c3') === 0,
    j([cambiosPendientesDeConexion('c1'), cambiosPendientesDeConexion('c2'), cambiosPendientesDeConexion('c3')])
  )
  bajaD3()
  bajaOtraCon()
  void Promise.all([solicitarCierreDatos('perfil|d2'), solicitarCierreDatos('no-registrada')]).then(([uno, dos]) => {
    check('(14c) una con cambios pregunta y puede NO cerrarse; una sin registrar se cierra', uno === false && dos === true && preguntado === 1, j([uno, dos, preguntado]))
    informe()
  })
}

function informe(): void {
  hr('RESULTADO (PASS/FAIL)')
  const total = results.length
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === total
  for (const r of results) if (!r.pass) console.log(`  FAIL: ${r.name} -> ${r.evidence}`)
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
