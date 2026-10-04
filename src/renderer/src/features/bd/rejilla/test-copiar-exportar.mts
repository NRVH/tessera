#!/usr/bin/env node
// =============================================================================
// Prueba de «Copiar como» (`copiarComo.ts` sobre `shared/formatosFilas.ts`) y de los textos
// y el repartidor de «Exportar» (`exportarBd.ts`), en las DOS plataformas
// (npm run test:db-rejilla-copiar-exportar): CSV, JSON, INSERT y Markdown sobre un subrango,
// celdas recortadas, tamaño con la base de cada gestor y UN oyente para todas las exportaciones.
// =============================================================================

import { copiarComo } from './copiarComo.ts'
import { aplicarRecortes, SIN_RECORTES } from './celdasRejilla.ts'
import {
  avisoDetenida,
  avisoExportado,
  crearRepartidorProgreso,
  formatoTamano,
  FORMATOS_COPIAR_COMO,
  FORMATOS_EXPORTAR,
  nuevoIdExportacion,
  textoExportando
} from './exportarBd.ts'
import type { DbCelda, DbColumnaResultado, DbProgresoExportacion } from '../../../../../shared/db-explorador-ipc.ts'

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

const COLUMNAS: DbColumnaResultado[] = [
  { nombre: 'ID', tipoLogico: 'numero', tipoMotor: 'NUMBER' },
  { nombre: 'NOMBRE', tipoLogico: 'texto', tipoMotor: 'VARCHAR2' },
  { nombre: 'ALTA', tipoLogico: 'fecha', tipoMotor: 'DATE' },
  { nombre: 'ACTIVO', tipoLogico: 'booleano', tipoMotor: 'boolean' },
  { nombre: 'NOTA', tipoLogico: 'texto', tipoMotor: 'VARCHAR2' }
]
const FILAS: DbCelda[][] = [
  ['1', 'Ana, la de "arriba"', '2024-01-31', true, null],
  ['.5', 'a|b', '2024-02-29', false, 'dos\nlíneas'],
  ['12345678901234567890', 'Ciro', null, null, 'x']
]
const TODO = { f0: 0, f1: 2, c0: 0, c1: 4 }

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) CSV')
  // -------------------------------------------------------------------------
  const csv = copiarComo('csv', { columnas: COLUMNAS, filas: FILAS, rango: { f0: 0, f1: 1, c0: 0, c1: 1 } })
  check('(1a) cabecera, CRLF, comillas RFC 4180, solo las columnas del rango', csv.texto === 'ID,NOMBRE\r\n1,"Ana, la de ""arriba"""\r\n.5,a|b', j(csv.texto))
  check('(1b) sin BOM ni salto final al copiar', csv.texto.charCodeAt(0) !== 0xfeff && !csv.texto.endsWith('\n'), 'ok')
  check('(1c) cuenta filas y columnas del rango', csv.filas === 2 && csv.columnas === 2, j({ f: csv.filas, c: csv.columnas }))

  // -------------------------------------------------------------------------
  hr('(2) JSON')
  // -------------------------------------------------------------------------
  const json = copiarComo('json', { columnas: COLUMNAS, filas: FILAS, rango: { f0: 1, f1: 2, c0: 0, c1: 1 } })
  const parseado = JSON.parse(json.texto) as Array<Record<string, unknown>>
  check('(2a) es JSON válido, un objeto por fila', Array.isArray(parseado) && parseado.length === 2, json.texto)
  check('(2b) el número va como número y `.5` se normaliza a 0.5', json.texto.includes('"ID": 0.5'), json.texto)
  check('(2c) el número grande conserva su texto exacto', json.texto.includes('"ID": 12345678901234567890'), json.texto)
  check('(2d) el texto con `|` va tal cual', parseado[0].NOMBRE === 'a|b', j(parseado[0]))

  // -------------------------------------------------------------------------
  hr('(3) SQL INSERT')
  // -------------------------------------------------------------------------
  const ins = copiarComo('insert', {
    columnas: COLUMNAS,
    filas: FILAS,
    rango: { f0: 0, f1: 0, c0: 0, c1: 3 },
    motor: 'oracle',
    tablaInsert: 'VENTAS.CLIENTE'
  })
  check(
    '(3a) Oracle: la tabla del dueño, columnas del rango, TO_DATE y booleano 1',
    ins.texto === "INSERT INTO VENTAS.CLIENTE (ID, NOMBRE, ALTA, ACTIVO) VALUES (1, 'Ana, la de \"arriba\"', TO_DATE('2024-01-31', 'YYYY-MM-DD'), 1);\n",
    j(ins.texto)
  )
  const insPg = copiarComo('insert', { columnas: COLUMNAS, filas: FILAS, rango: { f0: 2, f1: 2, c0: 2, c1: 4 }, motor: 'postgres' })
  check(
    // En PG un nombre en mayúsculas se cita: sin comillas se plegaría a minúsculas.
    '(3b) PG sin tabla: `tabla`, columnas en mayúsculas citadas, NULL y el texto',
    insPg.texto === "INSERT INTO tabla (\"ALTA\", \"ACTIVO\", \"NOTA\") VALUES (NULL, NULL, 'x');\n",
    j(insPg.texto)
  )
  const todas = copiarComo('insert', { columnas: COLUMNAS, filas: FILAS, rango: TODO, motor: 'oracle' }).texto
  // En Oracle el salto sale FUERA de las comillas como CHR(10). Con el salto
  // crudo, SQL*Plus corta la sentencia (medido en 11.2 y 21c), así que cada fila
  // es exactamente UNA línea.
  const lineasTodas = todas.replace(/\n$/, '').split('\n')
  check(
    '(3c) Oracle: una sentencia por fila, cada una en UNA línea, con el salto como CHR(10)',
    lineasTodas.length === 3 &&
      lineasTodas.every((l) => l.startsWith('INSERT INTO ') && l.endsWith(');')) &&
      todas.includes("'dos' || CHR(10) || 'líneas'") &&
      !todas.includes("'dos\nlíneas'"),
    j(todas)
  )
  // La mitad negativa: PG no pasa por SQL*Plus y psql lee bien el salto dentro de la
  // cadena, así que allí el literal sigue siendo el de siempre (sin CHR).
  const todasPg = copiarComo('insert', { columnas: COLUMNAS, filas: FILAS, rango: TODO, motor: 'postgres' }).texto
  check(
    '(3c-bis) PG: el salto sigue DENTRO del literal y no hay CHR(10)',
    (todasPg.match(/^INSERT INTO /gm) ?? []).length === 3 && todasPg.includes("'dos\nlíneas'") && !todasPg.includes('CHR('),
    j(todasPg)
  )
  const sinMotor = copiarComo('insert', { columnas: COLUMNAS, filas: FILAS, rango: { f0: 0, f1: 0, c0: 3, c1: 3 } })
  check('(3d) sin motor, SQL estándar (el de PG): TRUE', sinMotor.texto.includes('VALUES (TRUE);'), j(sinMotor.texto))

  // -------------------------------------------------------------------------
  hr('(4) Markdown')
  // -------------------------------------------------------------------------
  const md = copiarComo('markdown', { columnas: COLUMNAS, filas: FILAS, rango: { f0: 1, f1: 1, c0: 0, c1: 4 } })
  const lineas = md.texto.split('\n')
  check('(4a) cabecera y separador con el número a la derecha', lineas[0] === '| ID | NOMBRE | ALTA | ACTIVO | NOTA |' && lineas[1] === '| ---: | --- | --- | --- | --- |', j(lineas.slice(0, 2)))
  check('(4b) `|` escapado y el salto como <br>', lineas[2] === '| .5 | a\\|b | 2024-02-29 | false | dos<br>líneas |', j(lineas[2]))
  const mdNulo = copiarComo('markdown', { columnas: COLUMNAS, filas: FILAS, rango: { f0: 0, f1: 0, c0: 4, c1: 4 } })
  check('(4c) NULL escrito (en un documento, vacío y nulo no se distinguirían)', mdNulo.texto.split('\n')[2] === '| NULL |', j(mdNulo.texto))

  // -------------------------------------------------------------------------
  hr('(5) incompletas en todos los formatos')
  // -------------------------------------------------------------------------
  const recortes = aplicarRecortes(SIN_RECORTES, [[1, 4, 99_999], [2, 1, 70_000]], 0, { filas: 3, columnas: 5 })
  const cuentas = (['tsv', 'tsvCabecera', 'csv', 'json', 'insert', 'markdown'] as const).map(
    (f) => copiarComo(f, { columnas: COLUMNAS, filas: FILAS, rango: TODO, recortes, motor: 'oracle' }).incompletas
  )
  check('(5a) las dos recortadas cuentan igual en los seis formatos', cuentas.every((n) => n === 2), j(cuentas))
  const soloUna = copiarComo('csv', { columnas: COLUMNAS, filas: FILAS, rango: { f0: 1, f1: 2, c0: 3, c1: 4 }, recortes })
  check('(5b) solo las que caen DENTRO del rango', soloUna.incompletas === 1, String(soloUna.incompletas))
  check('(5c) rango sin columnas: vacío', copiarComo('json', { columnas: [], filas: [], rango: TODO }).texto === '', 'vacío')

  // -------------------------------------------------------------------------
  hr('(6) exportarBd')
  // -------------------------------------------------------------------------
  check('(6a) bytes: singular y plural', formatoTamano(1, 'windows') === '1 byte' && formatoTamano(850, 'mac') === '850 bytes', 'ok')
  check('(6b) base 1024 aquí: 1536 bytes = 1,5 KB', formatoTamano(1536, 'windows') === '1,5 KB', formatoTamano(1536, 'windows'))
  check('(6c) base 1000 en Mac (la del Finder): 1500 bytes = 1,5 KB', formatoTamano(1500, 'mac') === '1,5 KB', formatoTamano(1500, 'mac'))
  check('(6d) NEGATIVO: 1000 bytes aquí siguen siendo bytes; en Mac ya es 1 KB', formatoTamano(1000, 'windows') === `1000 bytes` && formatoTamano(1000, 'mac') === '1 KB', `${formatoTamano(1000, 'windows')} / ${formatoTamano(1000, 'mac')}`)
  check('(6e) sin «,0» y entero por encima de 100', formatoTamano(12 * 1024 * 1024, 'windows') === '12 MB' && formatoTamano(250 * 1024 * 1024, 'windows') === '250 MB', 'ok')
  check('(6f) absurdos: 0 bytes', formatoTamano(Number.NaN, 'otra') === '0 bytes' && formatoTamano(-5, 'windows') === '0 bytes', 'ok')
  const hecho = { archivo: 'VENTAS.CLIENTE.csv', filas: 12345, bytes: 2048, token: 't' }
  const avW = avisoExportado(hecho, 'windows')
  const avM = avisoExportado(hecho, 'mac')
  check('(6g) título con el NOMBRE del archivo, sin ruta', avW.titulo === `Exportadas 12${NBSP}345 filas a VENTAS.CLIENTE.csv`, avW.titulo)
  check('(6h) la acción nombra el gestor de ESTA plataforma', avW.accion === 'Mostrar en el Explorador' && avM.accion === 'Mostrar en el Finder', `${avW.accion} / ${avM.accion}`)
  check('(6i) NEGATIVO: Mac no dice el gestor de la otra plataforma', !avM.accion.includes('Explorador') && !avW.accion.includes('Finder'), 'ok')
  check('(6j) otra plataforma: el genérico', avisoExportado(hecho, 'otra').accion === 'Mostrar en el gestor de archivos', avisoExportado(hecho, 'otra').accion)
  check('(6k) singular', avisoExportado({ ...hecho, filas: 1 }, 'windows').titulo === 'Exportada 1 fila a VENTAS.CLIENTE.csv', 'ok')
  check('(6l) el detalle es el tamaño', avW.detalle === '2 KB' && avM.detalle === '2 KB', `${avW.detalle} / ${avM.detalle}`)
  check('(6m) sin recortes ni aviso: éxito', avW.tipo === 'success', avW.tipo)
  const conRecorte = avisoExportado({ ...hecho, recortadas: 3 }, 'windows')
  check(
    '(6n) celdas recortadas: aviso ámbar que lo dice',
    conRecorte.tipo === 'warn' && conRecorte.detalle === '2 KB · 3 celdas pasaban de 16 MiB y se escribieron recortadas',
    conRecorte.detalle
  )
  const sinOrden = avisoExportado({ ...hecho, aviso: 'Sin orden estable.' }, 'mac')
  check('(6o) aviso del main: ámbar y al final del detalle', sinOrden.tipo === 'warn' && sinOrden.detalle.endsWith('· Sin orden estable.'), sinOrden.detalle)
  check('(6p) NEGATIVO: recortadas 0 no avisa', avisoExportado({ ...hecho, recortadas: 0 }, 'windows').tipo === 'success', 'ok')
  check('(6m) píldora: sin cifra hasta el primer progreso', textoExportando(0) === 'Exportando…' && textoExportando(Number.NaN) === 'Exportando…', 'ok')
  check('(6n) píldora: con cifra', textoExportando(45000) === `Exportando: 45${NBSP}000 filas` && textoExportando(1) === 'Exportando: 1 fila', textoExportando(45000))
  check('(6o) detenida por Stop / por cerrar la pestaña', avisoDetenida(false).detalle === undefined && avisoDetenida(true).detalle === 'Se cerró la pestaña que la lanzó.', 'ok')
  check('(6p) menús: exportar los cinco, CSV primero; copiar como sin TSV', j(FORMATOS_EXPORTAR) === j(['csv', 'tsv', 'json', 'insert', 'markdown']) && !FORMATOS_COPIAR_COMO.includes('tsv') && FORMATOS_COPIAR_COMO.length === 4, 'ok')
  const a = nuevoIdExportacion()
  const b = nuevoIdExportacion()
  check('(6q) ids únicos y con prefijo', a !== b && a.startsWith('exportar-'), `${a} / ${b}`)

  // -------------------------------------------------------------------------
  hr('(7) el repartidor del progreso de exportar')
  // -------------------------------------------------------------------------
  {
    /** Un canal como el de `ipcRenderer`: difunde a TODOS sus oyentes. */
    type Cb = (e: DbProgresoExportacion) => void
    const canal = { oyentes: new Set<Cb>(), altas: 0, bajas: 0, maximo: 0 }
    const emitir = (e: DbProgresoExportacion): void => {
      for (const cb of [...canal.oyentes]) cb(e)
    }
    const rep = crearRepartidorProgreso((cb) => {
      canal.altas++
      canal.oyentes.add(cb)
      canal.maximo = Math.max(canal.maximo, canal.oyentes.size)
      return () => {
        canal.bajas++
        canal.oyentes.delete(cb)
      }
    })
    const estado = (): string =>
      j({ oyentes: canal.oyentes.size, altas: canal.altas, bajas: canal.bajas, maximo: canal.maximo, escuchando: rep.escuchando })
    check('(7a) sin exportaciones, el canal no tiene oyente', canal.oyentes.size === 0 && canal.altas === 0, estado())

    const recibido = new Map<string, number[]>()
    const bajas: Array<() => void> = []
    for (let i = 0; i < 50; i++) {
      const id = `exp-${i}`
      bajas.push(
        rep.escuchar(id, (filas) => {
          recibido.set(id, [...(recibido.get(id) ?? []), filas])
        })
      )
    }
    check(
      '(7b) 50 exportaciones escuchando: UN oyente en el canal (con uno por hook, 50 y el aviso de fuga desde el 11.º)',
      canal.oyentes.size === 1 && canal.maximo === 1 && canal.altas === 1 && rep.escuchando === 50,
      estado()
    )
    emitir({ peticionId: 'exp-7', filas: 5000 })
    check('(7c) el progreso llega SOLO a la suya', j([...recibido]) === j([['exp-7', [5000]]]), j([...recibido]))
    emitir({ peticionId: 'exp-que-nadie-escucha', filas: 1 })
    check('(7d) NEGATIVO: el de una exportación que nadie escucha no llega a ninguna', recibido.size === 1, j([...recibido]))
    emitir(null as unknown as DbProgresoExportacion)
    emitir({ filas: 3 } as unknown as DbProgresoExportacion)
    check('(7e) un aviso malformado no rompe ni llega a nadie', recibido.size === 1, j([...recibido]))

    bajas[7]()
    emitir({ peticionId: 'exp-7', filas: 10000 })
    check(
      '(7f) tras su baja ya no le llega, y el canal sigue para las otras 49',
      j(recibido.get('exp-7')) === j([5000]) && canal.oyentes.size === 1 && rep.escuchando === 49,
      `${j(recibido.get('exp-7'))} ${estado()}`
    )
    bajas[7]()
    check('(7g) NEGATIVO: una baja repetida no se lleva la de otra ni el canal', rep.escuchando === 49 && canal.bajas === 0, estado())
    for (const quitar of bajas) quitar()
    check('(7h) sin nadie escuchando, el canal se da de baja: 0 oyentes', canal.oyentes.size === 0 && canal.bajas === 1 && rep.escuchando === 0, estado())
    emitir({ peticionId: 'exp-3', filas: 7 })
    check('(7i) y un aviso tardío ya no llega a nadie', !recibido.has('exp-3'), j([...recibido]))

    const nueva: number[] = []
    const bajaNueva = rep.escuchar('exp-nueva', (f) => nueva.push(f))
    emitir({ peticionId: 'exp-nueva', filas: 42 })
    check(
      '(7j) la siguiente exportación vuelve a suscribir el canal, una vez',
      canal.altas === 2 && canal.oyentes.size === 1 && j(nueva) === j([42]),
      `${j(nueva)} ${estado()}`
    )
    bajaNueva()

    const primero: number[] = []
    const segundo: number[] = []
    const b1 = rep.escuchar('dup', (f) => primero.push(f))
    const b2 = rep.escuchar('dup', (f) => segundo.push(f))
    b1()
    emitir({ peticionId: 'dup', filas: 9 })
    check(
      '(7k) un id repetido: la baja del primero no se lleva al que lo sustituyó',
      primero.length === 0 && j(segundo) === j([9]) && canal.oyentes.size === 1,
      `${j(primero)} ${j(segundo)} ${estado()}`
    )
    b2()
    check('(7l) al irse el último, el canal vuelve a quedar sin oyentes', canal.oyentes.size === 0 && rep.escuchando === 0, estado())
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
