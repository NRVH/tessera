// =============================================================================
// Prueba de la lógica pura de la pestaña de colección (`coleccionDocs.ts`, `tokensDocs.ts`
// y `camposDocs.ts`), con `node` a secas (`npm run test:coleccion-docs`). Fija el
// tokenizador y el formato, los campos de primer nivel, el tipo y la vista de un valor
// editado, los cambios pendientes por `_id`, el envío sin transacción, las filas de la tabla
// y la consulta (modos guiado y JSON, orden de cabecera, destino de un error, columnas).
// =============================================================================

import {
  BARRA_DOCS_VACIA,
  CONSULTA_INICIAL,
  EDICION_VACIA,
  alternarBorrado,
  camposDeConsulta,
  columnasFiltrables,
  consultaConOrden,
  consultaFiltra,
  consultaJsonAplicada,
  consultaProyecta,
  destinoDelError,
  filtroParaConsola,
  mismaPeticion,
  motivoNoGuiarCampo,
  type ConsultaColeccion,
  camposDeTexto,
  celdaDeValorTexto,
  claveDelCambio,
  claveDoc,
  claveNuevo,
  cambiosDeEdicion,
  columnasConEdicion,
  compactarTexto,
  descartarDoc,
  edicionDeCambios,
  esCampoBarra,
  filasConEdicion,
  formatearDocumento,
  insertarDoc,
  numCambiosDocs,
  ponerCampo,
  quitarCampo,
  quitarInsertado,
  reemplazarDoc,
  restanTrasEnvio,
  restaurarCampo,
  resumenEnvio,
  textoConCambios,
  tipoDeValorTexto,
  tokenizar,
  unirColumnas,
  valorDeCampo
} from './coleccionDocs.ts'
import type { DbDocCampoMuestra, DbDocDocumento } from '../../../../../shared/db-documentos-ipc.ts'
import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from '../../../../../shared/filtroGuiado.ts'

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
const j = (v: unknown): string => JSON.stringify(v)

const SHELL = '{ _id: ObjectId("65a1b2c3d4e5f60718293a4b"), nombre: "Ana, {la} de \\"Lugo\\"", edad: 34, saldo: NumberLong("9007199254740993"), activo: true, patron: /a,b/i, tags: ["x", "y", ["z"]], dir: { calle: "Mayor", num: 3 }, vacio: {}, nada: null }'
const EJSON = '{"_id": {"$oid": "65a1b2c3d4e5f60718293a4b"}, "creado": {"$date": "2024-01-02T03:04:05Z"}, "a b": 1.5}'

function main(): void {
  hr('(1) tokens y formato del panel JSON')
  const tk = tokenizar(SHELL).filter((t) => t.clase !== 'espacio')
  check('las claves se reconocen', tk.filter((t) => t.clase === 'clave').map((t) => t.texto).join(',') === '_id,nombre,edad,saldo,activo,patron,tags,dir,calle,num,vacio,nada', j(tk.filter((t) => t.clase === 'clave').map((t) => t.texto)))
  check('ObjectId y NumberLong son constructores', tk.filter((t) => t.clase === 'constructor').map((t) => t.texto).join(',') === 'ObjectId,NumberLong', j(tk.filter((t) => t.clase === 'constructor').map((t) => t.texto)))
  check('la regex es UN token (su coma no parte nada)', tk.some((t) => t.clase === 'regex' && t.texto === '/a,b/i'), 'regex')
  check('la cadena con comas, llaves y comillas escapadas es UN token', tk.some((t) => t.clase === 'cadena' && t.texto === '"Ana, {la} de \\"Lugo\\""'), 'cadena')
  const fmt = formatearDocumento('{a: 1, b: {c: [1, 2], d: {}}, e: ObjectId("x")}')
  const esperado = '{\n  a: 1,\n  b: {\n    c: [\n      1,\n      2\n    ],\n    d: {}\n  },\n  e: ObjectId("x")\n}'
  check('sangrado: una clave por línea, {} junto y ObjectId en su línea', fmt === esperado, j(fmt))
  check('formatear lo ya formateado no cambia nada', formatearDocumento(fmt) === fmt, 'idempotente')
  const ts = formatearDocumento('{t: Timestamp({ t: 1, i: 2 })}')
  check('lo de dentro de paréntesis va en una línea', ts === '{\n  t: Timestamp({ t: 1, i: 2 })\n}', j(ts))
  check('una cadena no se toca al formatear', formatearDocumento('{a: "x  ,  y"}').includes('"x  ,  y"'), 'intacta')
  check('texto que no es un objeto: no lanza', formatearDocumento('esto no ( es') !== undefined, 'ok')

  hr('(2) campos de primer nivel')
  const campos = camposDeTexto(SHELL)
  check('los diez campos, en su orden', j(campos?.map((c) => c.nombre)) === j(['_id', 'nombre', 'edad', 'saldo', 'activo', 'patron', 'tags', 'dir', 'vacio', 'nada']), j(campos?.map((c) => c.nombre)))
  check('el valor ENTERO de un subdocumento', campos?.find((c) => c.nombre === 'dir')?.valor === '{ calle: "Mayor", num: 3 }', String(campos?.find((c) => c.nombre === 'dir')?.valor))
  check('la cadena con comas se queda entera', campos?.find((c) => c.nombre === 'nombre')?.valor === '"Ana, {la} de \\"Lugo\\""', String(campos?.find((c) => c.nombre === 'nombre')?.valor))
  const ce = camposDeTexto(EJSON)
  check('EJSON relajado: claves entre comillas, sin comillas en el nombre', j(ce?.map((c) => c.nombre)) === j(['_id', 'creado', 'a b']), j(ce?.map((c) => c.nombre)))
  check('la clave se guarda como venía escrita', ce?.[2].claveTexto === '"a b"', String(ce?.[2].claveTexto))
  check('clave con comillas simples', j(camposDeTexto("{'x y': 1}")?.map((c) => c.nombre)) === j(['x y']), 'x y')
  check('documento vacío: ningún campo', j(camposDeTexto('{}')) === '[]', j(camposDeTexto('{}')))
  check('rechazos: no objeto, sin cerrar, sin valor, basura detrás', [camposDeTexto('[1]'), camposDeTexto('{a: 1'), camposDeTexto('{a: }'), camposDeTexto('{a: 1} x')].every((x) => x === null), 'null')
  check('valorDeCampo compacta', valorDeCampo(SHELL, 'dir') === '{calle: "Mayor", num: 3}', String(valorDeCampo(SHELL, 'dir')))
  check('valorDeCampo de un campo que no está: null', valorDeCampo(SHELL, 'nope') === null, 'null')
  check('compactarTexto', compactarTexto('{ a :  [1 ,2] }') === '{a: [1, 2]}', compactarTexto('{ a :  [1 ,2] }'))

  hr('(3) tipo y vista de un valor editado')
  const tipos = ['"x"', '3', '3.5', 'true', 'null', 'ObjectId("a")', 'ISODate("2024-01-01")', 'new Date()', 'NumberLong("1")', 'NumberDecimal("1.1")', '[1]', '{a: 1}', '{"$oid": "a"}', '{"$date": "x"}', '/x/', '-4', 'rarezas']
  const vistos = tipos.map(tipoDeValorTexto)
  check(
    'tipos por el primer token (y los envoltorios EJSON)',
    j(vistos) === j(['string', 'int', 'double', 'bool', 'null', 'objectId', 'date', 'date', 'long', 'decimal', 'array', 'objeto', 'objectId', 'date', 'regex', 'int', 'otro']),
    j(vistos)
  )
  check('subdocumento resumido como el serializador', j(celdaDeValorTexto('{a: 1, b: {c: 2}}')) === j({ tipo: 'objeto', vista: '{ 2 campos }' }), j(celdaDeValorTexto('{a: 1, b: {c: 2}}')))
  check('un campo en singular', celdaDeValorTexto('{a: 1}').vista === '{ 1 campo }', celdaDeValorTexto('{a: 1}').vista)
  check('array resumido por elementos', celdaDeValorTexto('[1, [2, 3], {a: 4}]').vista === '[ 3 ]' && celdaDeValorTexto('[]').vista === '[ 0 ]', celdaDeValorTexto('[1, [2, 3], {a: 4}]').vista)
  check('una cadena larga se recorta', celdaDeValorTexto(JSON.stringify('x'.repeat(500))).vista.length === 200, String(celdaDeValorTexto(JSON.stringify('x'.repeat(500))).vista.length))

  hr('(4) cambios pendientes por _id')
  const A = '{"$oid":"a"}'
  const B = '{"$oid":"b"}'
  let e = EDICION_VACIA
  e = ponerCampo(e, A, 'edad', '35')
  e = ponerCampo(e, A, 'nombre', '"Eva"')
  e = quitarCampo(e, A, 'activo')
  check('una celda puesta y otra quitada: UN cambio de actualizar', numCambiosDocs(e) === 1 && j(cambiosDeEdicion(e)) === j([{ tipo: 'actualizar', idEjson: A, poner: { edad: '35', nombre: '"Eva"' }, quitar: ['activo'] }]), j(cambiosDeEdicion(e)))
  check('poner después de quitar el mismo campo lo saca de quitar', j(cambiosDeEdicion(ponerCampo(e, A, 'activo', 'false'))[0]) === j({ tipo: 'actualizar', idEjson: A, poner: { edad: '35', nombre: '"Eva"', activo: 'false' }, quitar: [] }), 'ok')
  check('el _id no se toca', ponerCampo(e, A, '_id', '1') === e && quitarCampo(e, A, '_id') === e, 'mismo objeto')
  const r1 = restaurarCampo(restaurarCampo(restaurarCampo(e, A, 'edad'), A, 'nombre'), A, 'activo')
  check('restaurar todos los campos saca el documento', numCambiosDocs(r1) === 0, j(r1))
  e = reemplazarDoc(e, B, '{_id: 2, x: 1}')
  e = ponerCampo(e, B, 'y', '2')
  check('una celda de un documento reemplazado se aplica sobre su texto nuevo', j(cambiosDeEdicion(e)[1]) === j({ tipo: 'reemplazar', idEjson: B, documento: '{ _id: 2, x: 1, y: 2 }' }), j(cambiosDeEdicion(e)[1]))
  const borrado = alternarBorrado(e, A)
  check('borrar pisa lo pendiente del documento y mantiene su sitio', j(cambiosDeEdicion(borrado).map((c) => c.tipo)) === j(['borrar', 'reemplazar']), j(cambiosDeEdicion(borrado).map((c) => c.tipo)))
  check('sobre un borrado no se edita', ponerCampo(borrado, A, 'x', '1') === borrado && reemplazarDoc(borrado, A, '{}') === borrado, 'mismo objeto')
  check('volver a alternar lo desmarca', numCambiosDocs(alternarBorrado(borrado, A)) === 1, 'uno menos')
  e = insertarDoc(insertarDoc(e, '{n: 1}'), '{n: 2}')
  check('los nuevos van detrás', j(cambiosDeEdicion(e).map((c) => c.tipo)) === j(['actualizar', 'reemplazar', 'insertar', 'insertar']), j(cambiosDeEdicion(e).map((c) => c.tipo)))
  check('ida y vuelta cambios <-> edición', j(edicionDeCambios(cambiosDeEdicion(e))) === j(e), 'igual')
  check('quitar un nuevo', j(quitarInsertado(e, 0).insertados) === j(['{n: 2}']), j(quitarInsertado(e, 0).insertados))
  check('descartar un documento', numCambiosDocs(descartarDoc(e, B)) === 3, String(numCambiosDocs(descartarDoc(e, B))))
  check('a qué fila va cada cambio', j([0, 1, 2, 3, 4, -1].map((i) => claveDelCambio(e, i))) === j([claveDoc(A), claveDoc(B), claveNuevo(0), claveNuevo(1), null, null]), j([0, 1, 2, 3, 4].map((i) => claveDelCambio(e, i))))

  hr('(5) D11: lo que queda tras un envío sin transacción')
  const tras = restanTrasEnvio(e, 2)
  check('aplicados 2 de 4: quedan los dos nuevos', j(cambiosDeEdicion(tras)) === j([{ tipo: 'insertar', documento: '{n: 1}' }, { tipo: 'insertar', documento: '{n: 2}' }]), j(cambiosDeEdicion(tras)))
  check('aplicados 0: no cambia nada', restanTrasEnvio(e, 0) === e, 'mismo objeto')
  check('aplicados todos: vacío', numCambiosDocs(restanTrasEnvio(e, 4)) === 0, 'vacío')

  hr('(6) filas y columnas de la tabla')
  const docs: DbDocDocumento[] = [
    { idEjson: A, texto: '{ _id: 1, nombre: "Ana", edad: 34, activo: true }', celdas: { _id: { tipo: 'int', vista: '1' }, nombre: { tipo: 'string', vista: 'Ana' }, edad: { tipo: 'int', vista: '34' }, activo: { tipo: 'bool', vista: 'true' } } },
    { idEjson: B, texto: '{ _id: 2, x: 0 }', celdas: { _id: { tipo: 'int', vista: '2' }, x: { tipo: 'int', vista: '0' } } },
    { idEjson: '{"$oid":"c"}', texto: '{ _id: 3 }', celdas: { _id: { tipo: 'int', vista: '3' } } }
  ]
  let e2 = ponerCampo(quitarCampo(EDICION_VACIA, A, 'activo'), A, 'edad', '35')
  e2 = reemplazarDoc(e2, B, '{ _id: 2, x: 0, nuevo: "s" }')
  e2 = alternarBorrado(e2, '{"$oid":"c"}')
  e2 = insertarDoc(e2, '{ extra: [1, 2] }')
  const filas = filasConEdicion(docs, e2)
  check('estados', j(filas.map((f) => f.estado)) === j(['cambiado', 'reemplazado', 'borrado', 'nuevo']), j(filas.map((f) => f.estado)))
  check('la celda editada con su nuevo valor y la quitada fuera', filas[0].documento.celdas.edad?.vista === '35' && !('activo' in filas[0].documento.celdas), j(filas[0].documento.celdas))
  check('los campos cambiados se marcan', j([...filas[0].cambiados].sort()) === j(['activo', 'edad']), j([...filas[0].cambiados]))
  check('el texto del panel refleja lo pendiente', filas[0].documento.texto === '{ _id: 1, nombre: "Ana", edad: 35 }', filas[0].documento.texto)
  check('reemplazado: solo lo que difiere va marcado', j([...filas[1].cambiados]) === j(['nuevo']), j([...filas[1].cambiados]))
  check('el nuevo lleva su posición y su clave', filas[3].insertado === 0 && filas[3].clave === claveNuevo(0), filas[3].clave)
  check('columnas: las de la página y detrás las de lo editado', j(columnasConEdicion(['_id', 'nombre', 'edad', 'activo', 'x'], filas)) === j(['_id', 'nombre', 'edad', 'activo', 'x', 'nuevo', 'extra']), j(columnasConEdicion(['_id', 'nombre', 'edad', 'activo', 'x'], filas)))
  check('unirColumnas sin repetir', j(unirColumnas(['a', 'b'], ['b', 'c', 'a'])) === j(['a', 'b', 'c']), 'ok')
  check('textoConCambios con clave rara nueva la entrecomilla', textoConCambios('{a: 1}', { 'x y': '2' }, []) === '{ a: 1, "x y": 2 }', textoConCambios('{a: 1}', { 'x y': '2' }, []))
  check('textoConCambios que lo quita todo: {}', textoConCambios('{a: 1}', {}, ['a']) === '{}', textoConCambios('{a: 1}', {}, ['a']))

  hr('(7) aviso tras «Enviar» y campos de la barra')
  check('todo aplicado', j(resumenEnvio({ transaccion: true, aplicados: 3 }, 3)) === j({ tono: 'exito', titulo: '3 cambios aplicados' }), j(resumenEnvio({ transaccion: true, aplicados: 3 }, 3)))
  const conTx = resumenEnvio({ transaccion: true, aplicados: 0, fallo: { indice: 1, mensaje: 'E11000 duplicado' } }, 3)
  check('con transacción: nada aplicado, y qué falló', conTx.titulo === 'No se aplicó ningún cambio' && conTx.detalle === 'El cambio 2 falló: E11000 duplicado. Se deshizo todo.', j(conTx))
  const sinTx = resumenEnvio({ transaccion: false, aplicados: 2, fallo: { indice: 2, mensaje: 'x' } }, 4)
  check('sin transacción: cuántos entraron', sinTx.titulo === 'Se aplicaron 2 de 4 cambios' && (sinTx.detalle ?? '').includes('siguen pendientes'), j(sinTx))
  check('campos de la barra', esCampoBarra('filtro') && esCampoBarra('orden') && esCampoBarra('proyeccion') && !esCampoBarra('where'), 'ok')

  hr('(8) modo guiado / JSON, orden de la cabecera, columnas y errores')
  const guiado: DbFiltroGuiado = { union: 'todas', condiciones: [{ columna: 'nombre', categoria: 'texto', operador: 'contiene', valor: 'lu' }] }
  const ordenCab: DbOrdenColumna[] = [{ columna: 'edad', dir: 'desc' }, { columna: 'nombre', dir: 'asc' }]
  const barraJ = { filtro: '{ edad: 3 }', proyeccion: '{ nombre: 1 }', orden: '' }
  const cG: ConsultaColeccion = { ...CONSULTA_INICIAL, guiado, barra: barraJ, orden: ordenCab }
  check(
    'guiado: manda filtroGuiado y el orden de la cabecera, y NINGÚN texto (tampoco la proyección JSON)',
    j(camposDeConsulta(cG)) === j({ filtro: '', proyeccion: '', orden: '', filtroGuiado: guiado, ordenColumnas: ordenCab }),
    j(camposDeConsulta(cG))
  )
  check(
    'guiado sin condiciones ni orden: ni filtroGuiado ni ordenColumnas',
    j(camposDeConsulta(CONSULTA_INICIAL)) === j({ filtro: '', proyeccion: '', orden: '' }),
    j(camposDeConsulta(CONSULTA_INICIAL))
  )
  const cJ: ConsultaColeccion = { ...cG, modo: 'json' }
  check(
    'JSON: los tres textos (sin filtroGuiado) y el orden de la cabecera',
    j(camposDeConsulta(cJ)) === j({ filtro: '{ edad: 3 }', proyeccion: '{ nombre: 1 }', orden: '', ordenColumnas: ordenCab }),
    j(camposDeConsulta(cJ))
  )
  check(
    'JSON con orden de texto: gana el texto, nunca los dos',
    camposDeConsulta({ ...cJ, barra: { ...barraJ, orden: '{ _id: -1 }' } }).ordenColumnas === undefined,
    j(camposDeConsulta({ ...cJ, barra: { ...barraJ, orden: '{ _id: -1 }' } }))
  )
  const conTexto: ConsultaColeccion = { ...cJ, barra: { ...barraJ, orden: '{ _id: -1 }' }, orden: [] }
  const trasCab = consultaConOrden(conTexto, [{ columna: 'edad', dir: 'asc' }])
  check('ordenar por la cabecera VACÍA el orden de texto', trasCab.barra.orden === '' && trasCab.barra.filtro === '{ edad: 3 }' && j(trasCab.orden) === j([{ columna: 'edad', dir: 'asc' }]), j(trasCab))
  check('… y en guiado también (para cuando se vuelva a JSON)', consultaConOrden({ ...conTexto, modo: 'guiado' }, []).barra.orden === '', 'vacío')
  const trasJson = consultaJsonAplicada(cG, { filtro: '', proyeccion: '', orden: '{ nombre: 1 }' })
  check('aplicar un orden de texto vacía el de la cabecera y pasa a JSON', trasJson.modo === 'json' && trasJson.orden.length === 0 && trasJson.guiado === guiado, j(trasJson))
  check('aplicar JSON sin orden de texto conserva el de la cabecera', j(consultaJsonAplicada(cG, barraJ).orden) === j(ordenCab), 'conservado')
  check('cambiar de modo con lo mismo aplicado no repite la petición', mismaPeticion(CONSULTA_INICIAL, { ...CONSULTA_INICIAL, modo: 'json' }), 'misma')
  check('cambiar de modo con un filtro en el otro sí', !mismaPeticion(cG, cJ), 'distinta')
  check('¿filtra?', consultaFiltra(cG) && !consultaFiltra(CONSULTA_INICIAL) && consultaFiltra(cJ) && !consultaFiltra({ ...cJ, barra: BARRA_DOCS_VACIA }), 'ok')
  check('la proyección solo cuenta en JSON (documento parcial)', consultaProyecta(cJ) && !consultaProyecta(cG), 'ok')
  check('consola: el filtro JSON, o {} en guiado', filtroParaConsola(cJ) === '{ edad: 3 }' && filtroParaConsola(cG) === '{}' && filtroParaConsola({ ...cJ, barra: BARRA_DOCS_VACIA }) === '{}', filtroParaConsola(cJ))

  const errG: DbErrorSql = { mensaje: 'No es un número', motivo: 'servidor', campo: 'filtro', condicion: 2 }
  check('error con condición en guiado → su fila', j(destinoDelError(errG, 'guiado')) === j({ tipo: 'guiado', condicion: 2 }), j(destinoDelError(errG, 'guiado')))
  check('error del filtro entero en guiado → la barra', j(destinoDelError({ ...errG, condicion: undefined }, 'guiado')) === j({ tipo: 'guiado', condicion: null }), 'null')
  check('una condición inventada (-1, 1.5) no señala ninguna fila', [-1, 1.5].every((i) => j(destinoDelError({ ...errG, condicion: i }, 'guiado')) === j({ tipo: 'guiado', condicion: null })), 'null')
  check('en JSON, el campo de la barra', j(destinoDelError({ ...errG, campo: 'proyeccion' }, 'json')) === j({ tipo: 'campo', campo: 'proyeccion' }), 'proyeccion')
  check('sin campo → la tabla', destinoDelError({ mensaje: 'x', motivo: 'servidor' } as DbErrorSql, 'guiado').tipo === 'general', 'general')
  // El error del orden de la cabecera en modo guiado va bajo la barra, sin tirar la tabla.
  check('guiado + campo orden → bajo la barra guiada, sin fila', j(destinoDelError({ ...errG, campo: 'orden' }, 'guiado')) === j({ tipo: 'guiado', condicion: null }), 'orden')

  check('campos que no se guían: $, punto, vacío', motivoNoGuiarCampo('$x') !== null && motivoNoGuiarCampo('a.b') !== null && motivoNoGuiarCampo('') !== null && motivoNoGuiarCampo('nombre') === null, 'ok')
  const docsF: DbDocDocumento[] = [
    { idEjson: '1', texto: '', celdas: { _id: { tipo: 'objectId', vista: 'x' }, extra: { tipo: 'string', vista: 'a' }, raro: { tipo: 'int', vista: '1' }, nota: { tipo: 'bool', vista: 'true' } } },
    { idEjson: '2', texto: '', celdas: { _id: { tipo: 'objectId', vista: 'y' }, extra: { tipo: 'int', vista: '2' }, raro: { tipo: 'string', vista: 's' } } },
    { idEjson: '3', texto: '', celdas: { raro: { tipo: 'string', vista: 't' } } }
  ]
  const muestra: DbDocCampoMuestra[] = [
    { nombre: '_id', tipos: ['objectId'], presencia: 10 },
    { nombre: 'edad', tipos: ['null', 'int'], presencia: 9 },
    { nombre: 'alta', tipos: ['date'], presencia: 5 },
    { nombre: 'nota', tipos: ['null'], presencia: 2 },
    { nombre: '$raro', tipos: ['string'], presencia: 1 },
    { nombre: 'a.b', tipos: ['string'], presencia: 1 }
  ]
  const cols = columnasFiltrables(muestra, ['_id', 'edad', 'alta', 'nota', '$raro', 'a.b', 'extra', 'raro'], docsF)
  check(
    'columnas: las de la muestra y detrás las de la página, sin $ ni punto',
    j(cols) ===
      j([
        { nombre: '_id', categoria: 'id' },
        { nombre: 'edad', categoria: 'numero' },
        { nombre: 'alta', categoria: 'fecha' },
        { nombre: 'nota', categoria: 'booleano' },
        { nombre: 'extra', categoria: 'texto' },
        { nombre: 'raro', categoria: 'texto' }
      ]),
    j(cols)
  )
  check('sin muestra todavía: todo sale de la página', j(columnasFiltrables(null, ['_id', 'raro'], docsF)) === j([{ nombre: '_id', categoria: 'id' }, { nombre: 'raro', categoria: 'texto' }]), j(columnasFiltrables(null, ['_id', 'raro'], docsF)))
  check('un campo sin celdas ni muestra: «otro» (solo vacío / no vacío)', j(columnasFiltrables(null, ['fantasma'], docsF)) === j([{ nombre: 'fantasma', categoria: 'otro' }]), 'otro')

  hr('RESULTADO (PASS/FAIL)')
  for (const res of results) {
    console.log(`${res.pass ? 'PASS' : 'FAIL'}  ${res.name}`)
    console.log(`      -> ${res.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
