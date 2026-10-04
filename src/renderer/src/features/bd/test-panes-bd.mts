#!/usr/bin/env node
// =============================================================================
// Prueba de `panesBd.ts` (npm run test:db-panes): el orden de la cabecera en posiciones con
// su prioridad y su `title`, la selección tras un error, el orden estable, la píldora, el
// titular por motivo de error (con el bloqueo y sus dos botones), la fuente por motor, el
// ancho de columna, qué ids cancela Detener y «Abrir consola» con tres partes.
// =============================================================================

import {
  ordenEnRejilla,
  lineasOrdenCabecera,
  rangoError,
  sinOrdenEstable,
  consultaParaConsola,
  textoPildora,
  metadatosDatos,
  describirError,
  motivoSinLector,
  mensajeDeInvoke,
  errorDeInvoke,
  textoError,
  lenguajeFuente,
  rutaModeloFuente,
  anchoColumnaRejilla,
  peticionesEnVuelo,
  accionesDeError,
  ETIQUETA_ACCION_ERROR,
  MARCA_SIN_ESPERAR
} from './panesBd.ts'
import { OPCIONES_ANCHO } from './rejilla/anchoColumnas.ts'
import { SEPARADOR_MILES } from './rejilla/celdasRejilla.ts'
import type { DbCelda, DbErrorSql } from '../../../../shared/db-explorador-ipc.ts'
import { IDS_MOTORES_SQL, descriptorSql } from '../../../../shared/motores/index.ts'

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
const NB = SEPARADOR_MILES

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) orden de la cabecera en posiciones de la rejilla')
  // -------------------------------------------------------------------------
  const cols = [{ nombre: 'ID' }, { nombre: 'NOMBRE' }, { nombre: 'Ventas' }, { nombre: 'A"B' }]
  check('(1a) sin orden -> []', j(ordenEnRejilla([], cols)) === '[]', j(ordenEnRejilla([], cols)))
  check(
    '(1b) una columna -> su posición, sin número de prioridad',
    j(ordenEnRejilla([{ columna: 'Ventas', dir: 'desc' }], cols)) === j([{ columna: 2, dir: 'desc', prioridad: null }]),
    j(ordenEnRejilla([{ columna: 'Ventas', dir: 'desc' }], cols))
  )
  const varias = ordenEnRejilla(
    [
      { columna: 'NOMBRE', dir: 'asc' },
      { columna: 'ID', dir: 'desc' }
    ],
    cols
  )
  check(
    '(1c) varias -> cada una en su posición con prioridad 1, 2 (el orden del array)',
    j(varias) === j([
      { columna: 1, dir: 'asc', prioridad: 1 },
      { columna: 0, dir: 'desc', prioridad: 2 }
    ]),
    j(varias)
  )
  check(
    '(1d) comparación EXACTA: «ventas» no es «Ventas» (el nombre viene del resultado, no se pliega)',
    j(ordenEnRejilla([{ columna: 'ventas', dir: 'asc' }], cols)) === '[]',
    j(ordenEnRejilla([{ columna: 'ventas', dir: 'asc' }], cols))
  )
  const faltaUna = ordenEnRejilla(
    [
      { columna: 'NO_ESTA', dir: 'asc' },
      { columna: 'A"B', dir: 'desc' }
    ],
    cols
  )
  check(
    '(1e) una que ya no está no pinta flecha, y la otra conserva SU prioridad (2)',
    j(faltaUna) === j([{ columna: 3, dir: 'desc', prioridad: 2 }]),
    j(faltaUna)
  )
  check(
    '(1f) nombre repetido en el resultado -> sin flecha (sería una apuesta)',
    j(ordenEnRejilla([{ columna: 'ID', dir: 'asc' }], [{ nombre: 'ID' }, { nombre: 'ID' }])) === '[]',
    j(ordenEnRejilla([{ columna: 'ID', dir: 'asc' }], [{ nombre: 'ID' }, { nombre: 'ID' }]))
  )

  // -------------------------------------------------------------------------
  hr('(2) el title de una cabecera ordenable')
  // -------------------------------------------------------------------------
  const sinOrden = lineasOrdenCabecera(null, 0)
  check(
    '(2a) sin orden: solo los dos gestos (clic y Mayús+clic)',
    sinOrden.length === 2 && /^Clic: /.test(sinOrden[0]) && /^Mayús\+clic: /.test(sinOrden[1]),
    j(sinOrden)
  )
  check(
    '(2b) una sola: «Orden: ascendente» delante',
    lineasOrdenCabecera({ dir: 'asc', prioridad: null }, 1)[0] === 'Orden: ascendente',
    lineasOrdenCabecera({ dir: 'asc', prioridad: null }, 1)[0]
  )
  check(
    '(2c) varias: «Orden 2.º de 3: descendente»',
    lineasOrdenCabecera({ dir: 'desc', prioridad: 2 }, 3)[0] === 'Orden 2.º de 3: descendente',
    lineasOrdenCabecera({ dir: 'desc', prioridad: 2 }, 3)[0]
  )

  // -------------------------------------------------------------------------
  hr('(3) selección del token tras un error con posición')
  // -------------------------------------------------------------------------
  const w = "ID = 1 AND NOMBRRE = 'x'"
  check('(3a) selecciona el identificador', j(rangoError(w, 11)) === j({ desde: 11, hasta: 18 }), j(rangoError(w, 11)))
  check('(3b) en el primer carácter', j(rangoError(w, 0)) === j({ desde: 0, hasta: 2 }), j(rangoError(w, 0)))
  check('(3c) sobre un blanco: solo cursor', j(rangoError(w, 2)) === j({ desde: 2, hasta: 2 }), j(rangoError(w, 2)))
  check('(3d) fuera del texto: cursor al final', j(rangoError('abc', 99)) === j({ desde: 3, hasta: 3 }), j(rangoError('abc', 99)))
  check('(3e) negativa -> 0', j(rangoError('abc', -4)) === j({ desde: 0, hasta: 3 }), j(rangoError('abc', -4)))
  check('(3f) NaN -> final', j(rangoError('abc', Number.NaN)) === j({ desde: 3, hasta: 3 }), j(rangoError('abc', Number.NaN)))
  check('(3g) se para en el paréntesis', j(rangoError('F(x)', 0)) === j({ desde: 0, hasta: 1 }), j(rangoError('F(x)', 0)))
  check('(3h) un paréntesis en la posición se selecciona él solo', j(rangoError('(x', 0)) === j({ desde: 0, hasta: 1 }), j(rangoError('(x', 0)))

  // -------------------------------------------------------------------------
  hr('(4) sin orden estable')
  // -------------------------------------------------------------------------
  check('(4a) PG sin orden ni PK -> true', sinOrdenEstable('postgres', [], []) === true, 'true')
  check('(4b) PG con PK -> false', sinOrdenEstable('postgres', [], ['id']) === false, 'false')
  check('(4c) PG con orden de la cabecera -> false', sinOrdenEstable('postgres', [{ columna: 'nombre' }], []) === false, 'false')
  check(
    '(4d) PG con orden de VARIAS columnas -> false',
    sinOrdenEstable('postgres', [{ columna: 'a' }, { columna: 'b' }], []) === false,
    'false'
  )
  check('(4e) Oracle nunca (cursor vivo)', sinOrdenEstable('oracle', [], []) === false, 'false')

  // -------------------------------------------------------------------------
  hr('(5) píldora y metadatos')
  // -------------------------------------------------------------------------
  const p1 = textoPildora({ cargadas: 500, hayMas: false, total: 500, contando: false })
  check('(5a) todas cargadas: "500 filas", no contable', p1.texto === '500 filas' && !p1.contable, j(p1))
  const p2 = textoPildora({ cargadas: 500, hayMas: true, total: null, contando: false })
  check('(5b) hay más: "500+ filas", contable', p2.texto === '500+ filas' && p2.contable, j(p2))
  const p3 = textoPildora({ cargadas: 500, hayMas: true, total: 12345, contando: false })
  check('(5c) contado: "500 de 12 345" con espacio duro', p3.texto === `500 de 12${NB}345` && !p3.contable, j(p3))
  const p4 = textoPildora({ cargadas: 500, hayMas: true, total: null, contando: true })
  check('(5d) contando: "Contando…"', p4.texto === 'Contando…' && !p4.contable, j(p4))
  const p5 = textoPildora({ cargadas: 1, hayMas: false, total: 1, contando: false })
  check('(5e) singular: "1 fila"', p5.texto === '1 fila', j(p5))
  const p6 = textoPildora({ cargadas: 0, hayMas: false, total: 0, contando: false })
  check('(5f) cero: "0 filas"', p6.texto === '0 filas', j(p6))
  const p7 = textoPildora({ cargadas: 600, hayMas: true, total: 500, contando: false })
  check('(5g) cargadas > contado (insertaron entretanto): no dice "600 de 500"', p7.texto === '600 de 600', j(p7))
  const p8 = textoPildora({ cargadas: 12345, hayMas: false, total: null, contando: false })
  check('(5h) miles sin contar ni más', p8.texto === `12${NB}345 filas`, j(p8))
  check('(5i) metadatos con más', metadatosDatos(500, true, 671) === '500+ filas cargadas · 671 ms', metadatosDatos(500, true, 671))
  check('(5j) metadatos una fila', metadatosDatos(1, false, 2270) === '1 fila cargada · 2 s 270 ms', metadatosDatos(1, false, 2270))
  check('(5k) metadatos sin tiempo', metadatosDatos(0, false, null) === '0 filas cargadas', metadatosDatos(0, false, null))

  // -------------------------------------------------------------------------
  hr('(6) errores: un titular por motivo')
  // -------------------------------------------------------------------------
  const err = (motivo: DbErrorSql['motivo'], extra: Partial<DbErrorSql> = {}): DbErrorSql => ({
    motivo,
    mensaje: 'x',
    ...extra
  })
  const motivos: DbErrorSql['motivo'][] = [
    'servidor',
    'cancelada',
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
  const titulos = motivos.map((m) => describirError(err(m), 'leer la tabla').titulo)
  check('(6a) todos los motivos tienen titular no vacío', titulos.every((t) => t.length > 0), j(titulos))
  check(
    '(6b) detener NO es un error (tono info)',
    describirError(err('cancelada'), 'leer la tabla').tono === 'info',
    describirError(err('cancelada'), 'leer la tabla').tono
  )
  check(
    '(6c) sinSecreto y driver dicen cosas distintas',
    describirError(err('sinSecreto'), 'x').titulo !== describirError(err('driver'), 'x').titulo,
    describirError(err('sinSecreto'), 'x').titulo + ' | ' + describirError(err('driver'), 'x').titulo
  )
  check(
    '(6d) el detalle lleva el código',
    describirError(err('servidor', { codigo: 'ORA-00942', mensaje: 'tabla no existe' }), 'x').detalle ===
      '[ORA-00942] tabla no existe',
    describirError(err('servidor', { codigo: 'ORA-00942', mensaje: 'tabla no existe' }), 'x').detalle
  )
  check('(6e) textoError sin código', textoError({ mensaje: 'hola' }) === 'hola', textoError({ mensaje: 'hola' }))
  check(
    '(6f) servidor habla del objeto ("leer la fuente")',
    describirError(err('servidor'), 'leer la fuente').titulo.includes('leer la fuente'),
    describirError(err('servidor'), 'leer la fuente').titulo
  )
  check(
    '(6g) servidor con campo sugiere revisar el filtro',
    describirError(err('servidor', { campo: 'where' }), 'x').sugerencia === 'Revisa el filtro.',
    String(describirError(err('servidor', { campo: 'where' }), 'x').sugerencia)
  )
  const envuelto = new Error("Error invoking remote method 'dbx:tabla:abrir': Error: se cayó el canal")
  check(
    '(6j) mensajeDeInvoke quita el envoltorio de Electron',
    mensajeDeInvoke(envuelto) === 'se cayó el canal',
    mensajeDeInvoke(envuelto)
  )
  check(
    '(6k) errorDeInvoke es interno (no llegó al servidor)',
    errorDeInvoke('x').motivo === 'interno' && errorDeInvoke('x').mensaje === 'x',
    j(errorDeInvoke('x'))
  )
  check('(6h) motivoSinLector de cancelada', motivoSinLector(err('cancelada')) === 'Lectura detenida', motivoSinLector(err('cancelada')))
  check(
    '(6i) motivoSinLector de uno cualquiera tiene texto',
    motivoSinLector(err('interno')).length > 0,
    motivoSinLector(err('interno'))
  )

  // -------------------------------------------------------------------------
  hr('(7) fuente y consola')
  // -------------------------------------------------------------------------
  check('(7a) oracle -> sql', lenguajeFuente('oracle') === 'sql', lenguajeFuente('oracle'))
  check('(7b) postgres -> pgsql', lenguajeFuente('postgres') === 'pgsql', lenguajeFuente('postgres'))
  // Cada motor, lo de SU descriptor (lenguaje de la fuente y páginas sin orden). La fuente
  // y la rejilla son caminos SQL: MongoDB y Redis no pasan por aquí.
  const ajenos = IDS_MOTORES_SQL.filter(
    (m) => lenguajeFuente(m) !== descriptorSql(m).sql.lenguajeFuente || sinOrdenEstable(m, [], []) !== descriptorSql(m).sesion.paginasInestablesSinOrden
  )
  check('(7b2) cada motor -> su descriptor (lenguajeFuente, sinOrdenEstable)', ajenos.length === 0, j(ajenos))
  const clave = 'perfil' + String.fromCharCode(0) + '["fuente","c1","ESQ","paquete","P",null]'
  const ruta = rutaModeloFuente(clave)
  check(
    '(7c) la ruta del modelo codifica NUL, comillas y barras (una sola pieza)',
    ruta.startsWith('/') && !ruta.slice(1).includes('/') && !ruta.includes('"') && ruta.includes('%00'),
    ruta
  )
  check(
    '(7d) paneKeys distintas -> rutas distintas',
    rutaModeloFuente('a' + String.fromCharCode(0) + 'b') !== rutaModeloFuente('a' + String.fromCharCode(0) + 'c'),
    'distintas'
  )
  check(
    '(7e) consulta para consola, oracle',
    consultaParaConsola({ esquema: 'ADMDEMO', nombre: 'ES_CONFIG' }, 'oracle') === 'SELECT * FROM ADMDEMO.ES_CONFIG',
    consultaParaConsola({ esquema: 'ADMDEMO', nombre: 'ES_CONFIG' }, 'oracle')
  )
  check(
    '(7f) consulta para consola, postgres con mayúsculas se cita',
    consultaParaConsola({ esquema: 'public', nombre: 'Ventas' }, 'postgres') === 'SELECT * FROM public."Ventas"',
    consultaParaConsola({ esquema: 'public', nombre: 'Ventas' }, 'postgres')
  )

  // -------------------------------------------------------------------------
  hr('(8) ancho de columna: cabecera y celdas, cada una con su fuente')
  // -------------------------------------------------------------------------
  // La celda mide 7 px por carácter; la cabecera, 9 (seminegrita más ancha).
  const celda = (s: string): number => s.length * 7
  const cab = (s: string): number => s.length * 9
  const filas: DbCelda[][] = [['a'], ['bb'], [null]]
  const col = { nombre: 'DESCRIPCION', tipoLogico: 'texto' as const }
  const a1 = anchoColumnaRejilla(col, 0, filas, 100, celda, cab, false, OPCIONES_ANCHO)
  // cabecera: 11*9 = 99 + icono 16 + relleno 17 = 132 (la caja real: ver OPCIONES_ANCHO)
  check('(8a) manda la cabecera medida con SU fuente', a1 === 132, String(a1))
  const a2 = anchoColumnaRejilla(col, 0, filas, 100, celda, cab, true, OPCIONES_ANCHO)
  check('(8b) con llave de PK suma otro icono', a2 === 132 + OPCIONES_ANCHO.icono, String(a2))
  const largas: DbCelda[][] = [['x'.repeat(30)]]
  const a3 = anchoColumnaRejilla({ nombre: 'C', tipoLogico: 'texto' }, 0, largas, 100, celda, cab, false, OPCIONES_ANCHO)
  // celdas: 30*7 = 210 + 17 = 227 (sin icono)
  check('(8c) manda la celda más ancha, sin icono', a3 === 227, String(a3))
  const a4 = anchoColumnaRejilla({ nombre: 'C', tipoLogico: 'texto' }, 0, [['x'.repeat(200)]], 100, celda, cab, false, OPCIONES_ANCHO)
  check('(8d) tope de 360', a4 === OPCIONES_ANCHO.max, String(a4))
  const a5 = anchoColumnaRejilla({ nombre: 'C', tipoLogico: 'texto' }, 0, [], 100, celda, cab, false, OPCIONES_ANCHO)
  check('(8e) sin filas: el mínimo', a5 === OPCIONES_ANCHO.min, String(a5))
  const a6 = anchoColumnaRejilla(
    { nombre: 'C', tipoLogico: 'texto' },
    0,
    [['x'.repeat(200)]],
    100,
    celda,
    cab,
    false,
    { ...OPCIONES_ANCHO, max: 2000 }
  )
  // 200 caracteres * 7 + 17 = 1417 (el ajuste al contenido sube el techo)
  check('(8f) ajuste al contenido con techo manual', a6 === 1417, String(a6))

  // ---------------------------------------------------------------------------
  hr('(9) peticionesEnVuelo: qué ids cancela Detener')
  // ---------------------------------------------------------------------------
  // Caso: la consulta ya terminó y lo que corre es «más filas». Mandar el id del
  // `abrirTabla` terminado no casaría con nada.
  const soloMas = peticionesEnVuelo({ consulta: 'tabla-1', cargando: false, mas: 'mas-1', contar: null })
  check('(9a) con «más» en vuelo: su id, y NO el del abrirTabla terminado', soloMas.join() === 'mas-1', soloMas.join())
  const cargandoTabla = peticionesEnVuelo({ consulta: 'tabla-1', cargando: true, mas: null, contar: null })
  check('(9b) cargando la consulta: su id', cargandoTabla.join() === 'tabla-1', cargandoTabla.join())
  const todo = peticionesEnVuelo({ consulta: 'tabla-1', cargando: true, mas: 'mas-1', contar: 'contar-1' })
  check('(9c) las tres a la vez: las tres, en orden', todo.join() === 'tabla-1,mas-1,contar-1', todo.join())
  const nada = peticionesEnVuelo({ consulta: 'tabla-1', cargando: false, mas: null, contar: null })
  check('(9d) nada en vuelo: nada (un id terminado no se manda)', nada.length === 0, JSON.stringify(nada))
  const repetido = peticionesEnVuelo({ consulta: 'x', cargando: true, mas: 'x', contar: '' })
  check('(9e) sin repetidos ni vacíos', repetido.join() === 'x', JSON.stringify(repetido))
  const sinConsulta = peticionesEnVuelo({ consulta: null, cargando: true, mas: null, contar: 'contar-2' })
  check('(9f) cargando sin id de consulta (cerrada): solo el conteo', sinConsulta.join() === 'contar-2', sinConsulta.join())

  // -------------------------------------------------------------------------
  hr('(10) el bloqueo, leer sin esperar y el nombre de tres partes')
  // -------------------------------------------------------------------------
  const bloqueo = describirError(err('bloqueo', { codigo: '1222', mensaje: 'Se superó el tiempo de espera del bloqueo.' }), 'leer la tabla')
  check('(10a) bloqueo: titular propio, tono informativo (no es una avería)', bloqueo.titulo.includes('bloqueada') && bloqueo.tono === 'info', j(bloqueo))
  check('(10b) su sugerencia nombra las dos salidas', (bloqueo.sugerencia ?? '').includes('«Reintentar»') && (bloqueo.sugerencia ?? '').includes('«Leer sin esperar»'), String(bloqueo.sugerencia))
  check('(10c) el detalle lleva el código del servidor', bloqueo.detalle === '[1222] Se superó el tiempo de espera del bloqueo.', bloqueo.detalle)
  check('(10d) con bloqueo, los dos botones en ese orden', j(accionesDeError(err('bloqueo'))) === j(['reintentar', 'sinEsperar']), j(accionesDeError(err('bloqueo'))))
  check(
    '(10e) con cualquier otro motivo (o sin error), ningún botón',
    motivos.every((m) => accionesDeError(err(m)).length === 0) && accionesDeError(null).length === 0,
    'ninguno'
  )
  check('(10f) lo que dicen', ETIQUETA_ACCION_ERROR.reintentar === 'Reintentar' && ETIQUETA_ACCION_ERROR.sinEsperar === 'Leer sin esperar', j(ETIQUETA_ACCION_ERROR))
  check('(10g) la marca de lo leído sin esperar avisa de lo sin confirmar', MARCA_SIN_ESPERAR.includes('sin confirmar'), MARCA_SIN_ESPERAR)
  check(
    '(10h) «Abrir consola» con base: nombre de tres partes',
    consultaParaConsola({ esquema: 'dbo', nombre: 't', base: 'ventas' }, 'sqlserver').endsWith('ventas.dbo.t'),
    consultaParaConsola({ esquema: 'dbo', nombre: 't', base: 'ventas' }, 'sqlserver')
  )
  check(
    '(10i) sin base: la de siempre (PG)',
    consultaParaConsola({ esquema: 'public', nombre: 'emp' }, 'postgres') === 'SELECT * FROM public.emp',
    consultaParaConsola({ esquema: 'public', nombre: 'emp' }, 'postgres')
  )

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
