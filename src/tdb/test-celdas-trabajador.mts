#!/usr/bin/env node
// =============================================================================
// Prueba de `celdas.cjs` y sus piezas (`celdasOracle`, `celdasPostgres`, `fechasOracle`): cómo el
// proceso de sesión convierte lo que devuelven oracledb y pg en `DbCelda` y arma `filasJson`.
// Sin red ni base: metadatos, OIDs y bytes falsos con la forma exacta de oracledb 6.10 y pg 8.22,
// salvo `parchearFechasThin`, que se prueba contra el oracledb instalado.
// Fija números exactos, fechas de Oracle desde sus bytes, el `fetchTypeHandler`, binario, topes,
// tipos y tamaños de texto, intervalos, la salida del servidor y los binds de texto.
// Decisiones: docs/decisiones/bd/celdas-valores-exactos-y-topes.md
// =============================================================================

import { createRequire } from 'node:module'
import { comparacionOriginalOracle } from '../shared/sql/originalesSql.ts'

const require_ = createRequire(import.meta.url)
const celdas = require_('./celdas.cjs')

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

// Bytes TTC de una fecha de Oracle: siglo+100, año+100, mes, día, hora+1, min+1, seg+1.
function bytesFecha(a: number, mes: number, dia: number, h: number, mi: number, s: number, ns?: number, tz?: [number, number]): Buffer {
  const largo = tz ? 13 : ns !== undefined ? 11 : 7
  const b = Buffer.alloc(largo)
  b[0] = Math.floor(a / 100) + 100
  b[1] = (a % 100) + 100
  b[2] = mes
  b[3] = dia
  b[4] = h + 1
  b[5] = mi + 1
  b[6] = s + 1
  if (largo >= 11) b.writeUInt32BE(ns ?? 0, 7)
  if (tz) {
    b[11] = tz[0] + 20
    b[12] = tz[1] + 60
  }
  return b
}

// oracledb falso: solo los DbType que usa el manejador (identidad por objeto).
function tipo(name: string): { name: string } {
  return { name }
}
const oracledbFalso = {
  DB_TYPE_VARCHAR: tipo('DB_TYPE_VARCHAR'),
  DB_TYPE_CLOB: tipo('DB_TYPE_CLOB'),
  DB_TYPE_NCLOB: tipo('DB_TYPE_NCLOB'),
  DB_TYPE_BLOB: tipo('DB_TYPE_BLOB'),
  DB_TYPE_BFILE: tipo('DB_TYPE_BFILE'),
  DB_TYPE_RAW: tipo('DB_TYPE_RAW')
}
function meta(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'C', dbType: tipo(name), dbTypeName: name.replace('DB_TYPE_', ''), ...extra }
}

async function main(): Promise<void> {
  const topes = celdas.topesDe({})

  hr('(1) Números de Oracle: texto exacto')
  {
    const n38 = '12345678901234567890123456789012345678'
    check('NUMBER de 38 dígitos intacto', celdas.numeroOracleATexto(n38) === n38, celdas.numeroOracleATexto(n38))
    const neg = '-98765432109876543210987654321098765.123'
    check('negativo con decimales intacto', celdas.numeroOracleATexto(neg) === neg, neg)
    check("'.5' -> '0.5'", celdas.numeroOracleATexto('.5') === '0.5', celdas.numeroOracleATexto('.5'))
    check("'-.25' -> '-0.25'", celdas.numeroOracleATexto('-.25') === '-0.25', celdas.numeroOracleATexto('-.25'))
    check('null sigue null', celdas.numeroOracleATexto(null) === null, 'null')
    const r = await celdas.celdaOracle(n38, topes)
    check('la celda de un NUMBER ya convertido no cambia', r.valor === n38 && r.original === null, JSON.stringify(r))
  }

  hr('(2) Fechas de Oracle desde sus bytes')
  {
    const d = celdas.textoFechaDeBytes(bytesFecha(2024, 1, 15, 10, 30, 5), 'fecha')
    check('DATE', d === '2024-01-15 10:30:05', d)
    // 02:30 del último domingo de marzo NO existe en Europa central: un Date local
    // lo movería a las 03:30. Desde los bytes sale tal cual.
    const hueco = celdas.textoFechaDeBytes(bytesFecha(2024, 3, 31, 2, 30, 0), 'fecha')
    check('hora del hueco de marzo intacta', hueco === '2024-03-31 02:30:00', hueco)
    const ts = celdas.textoFechaDeBytes(bytesFecha(2024, 1, 15, 10, 30, 5, 123456789), 'ts')
    check('TIMESTAMP con microsegundos (FF6)', ts === '2024-01-15 10:30:05.123456', ts)
    // WITH TIME ZONE: los bytes van en UTC; +05:30 -> hora de pared 15:00.
    const tz = celdas.textoFechaDeBytes(bytesFecha(2024, 1, 15, 9, 30, 0, 500000000, [5, 30]), 'tstz')
    check('TIMESTAMP WITH TIME ZONE +05:30', tz === '2024-01-15 15:00:00.500000 +05:30', tz)
    const tzNeg = celdas.textoFechaDeBytes(bytesFecha(2024, 1, 1, 2, 0, 0, 0, [-3, -30]), 'tstz')
    check('desplazamiento negativo cruza el día', tzNeg === '2023-12-31 22:30:00.000000 -03:30', tzNeg)
    const antiguo = celdas.textoFechaDeBytes(bytesFecha(45, 6, 1, 0, 0, 0), 'fecha')
    check('año de dos cifras no se convierte en 19xx', antiguo === '0045-06-01 00:00:00', antiguo)
    // Respaldo sin bytes: desde el Date local, con milisegundos.
    const sinBytes = celdas.textoFechaOracle(new Date(2024, 0, 15, 10, 30, 5, 250), 'ts')
    check('respaldo sin bytes (Date local)', sinBytes === '2024-01-15 10:30:05.250000', sinBytes)
    check('thick ya trae texto: se respeta', celdas.textoFechaOracle('2024-01-15 10:30:05', 'fecha') === '2024-01-15 10:30:05', 'string')
  }

  hr('(3) Parche de fechas de thin sobre el oracledb instalado')
  {
    const instalado = celdas.parchearFechasThin(require_)
    check('se instala', instalado === true, String(instalado))
    check('es idempotente', celdas.parchearFechasThin(require_) === true, 'segunda llamada')
    if (instalado) {
      const { BaseBuffer } = require_('oracledb/lib/impl/datahandlers/buffer.js')
      const bytes = bytesFecha(2024, 3, 31, 2, 30, 0, 987654321)
      const d = BaseBuffer.prototype.parseOracleDate.call(null, bytes, true)
      const texto = celdas.textoFechaOracle(d, 'ts')
      check('el Date decodificado lleva sus bytes', Boolean(d[celdas.BYTES_FECHA]), String(d))
      check('y el texto sale exacto desde ellos', texto === '2024-03-31 02:30:00.987654', texto)
      bytes[0] = 0
      check('los bytes se COPIAN (el paquete se reutiliza)', celdas.textoFechaOracle(d, 'ts') === texto, 'buf mutado')
    }
  }

  hr('(4) fetchTypeHandler')
  {
    const thin = celdas.manejadorFetchOracle(oracledbFalso, { thin: true })
    const thick = celdas.manejadorFetchOracle(oracledbFalso, { thin: false })
    const num = thin(meta('DB_TYPE_NUMBER'))
    check('NUMBER -> VARCHAR con normalización', num.type === oracledbFalso.DB_TYPE_VARCHAR && num.converter('.5') === '0.5', JSON.stringify(num.type))
    const clob = thin(meta('DB_TYPE_CLOB'))
    check('CLOB -> locator EXPLÍCITO (no undefined)', clob !== undefined && clob.type === oracledbFalso.DB_TYPE_CLOB, JSON.stringify(clob))
    const nclob = thin(meta('DB_TYPE_NCLOB'))
    check('NCLOB -> locator explícito', nclob.type === oracledbFalso.DB_TYPE_NCLOB, JSON.stringify(nclob))
    const blob = thin(meta('DB_TYPE_BLOB'))
    check('BLOB -> locator explícito', blob.type === oracledbFalso.DB_TYPE_BLOB, JSON.stringify(blob))
    const fThin = thin(meta('DB_TYPE_DATE'))
    check('DATE en thin: conversor, sin VARCHAR (que haría Date#toString)', fThin.type === undefined && typeof fThin.converter === 'function', Object.keys(fThin).join(','))
    const fThick = thick(meta('DB_TYPE_TIMESTAMP_TZ'))
    check('TIMESTAMP_TZ en thick: VARCHAR con el NLS de la sesión', fThick.type === oracledbFalso.DB_TYPE_VARCHAR, JSON.stringify(fThick.type))
    const rowid = thin(meta('DB_TYPE_ROWID'))
    check('ROWID -> VARCHAR', rowid.type === oracledbFalso.DB_TYPE_VARCHAR, JSON.stringify(rowid.type))
    const iv = thin(meta('DB_TYPE_INTERVAL_DS'))
    check('INTERVAL -> conversor a texto', typeof iv.converter === 'function', Object.keys(iv).join(','))
    check('VARCHAR2 se deja al driver', thin(meta('DB_TYPE_VARCHAR')) === undefined, 'undefined')
    const cat = celdas.manejadorFetchOracle(oracledbFalso, { thin: true, proposito: 'catalogo' })
    check('catálogo: NUMBER como Number de JS', cat(meta('DB_TYPE_NUMBER')) === undefined, 'undefined')
    check('catálogo: CLOB entero como texto', cat(meta('DB_TYPE_CLOB')).type === oracledbFalso.DB_TYPE_VARCHAR, 'VARCHAR')
    check('catálogo: BLOB como RAW (sin locator que serializar)', cat(meta('DB_TYPE_BLOB')).type === oracledbFalso.DB_TYPE_RAW, 'RAW')
  }

  hr('(5) Binario en hex, recortado en bytes')
  {
    const pg = celdas.byteaPgAHex('\\x0a0bff', 0)
    check('bytea de PG -> 0x0A0BFF', pg.valor === '0x0A0BFF' && pg.original === null, JSON.stringify(pg))
    const largo = '\\x' + 'ab'.repeat(100)
    const pgCorto = celdas.byteaPgAHex(largo, 10)
    check('bytea recortado a 10 bytes, original 100', pgCorto.valor === '0x' + 'AB'.repeat(10) && pgCorto.original === 100, JSON.stringify(pgCorto))
    const celdaBytea = celdas.celdaPg('\\x00ff', 17, topes)
    check('celdaPg de bytea', celdaBytea.valor === '0x00FF', JSON.stringify(celdaBytea))
    const raw = await celdas.celdaOracle(Buffer.from([1, 2, 255]), topes)
    check('RAW/BLOB de Oracle en hex', raw.valor === '0x0102FF' && raw.original === null, JSON.stringify(raw))
    const rawLargo = await celdas.celdaOracle(Buffer.alloc(50, 7), { ...topes, topeBinario: 4 })
    check('RAW recortado con su longitud en bytes', rawLargo.valor === '0x07070707' && rawLargo.original === 50, JSON.stringify(rawLargo))
    // LOB falso con la forma de oracledb: getData + length + type.
    let soltado = false
    const blobFalso = {
      type: { name: 'DB_TYPE_BLOB' },
      length: 100000,
      getData: async (offset: number, amount: number) => Buffer.alloc(amount, offset === 1 ? 0xab : 0),
      destroy: () => {
        soltado = true
      }
    }
    const b = await celdas.celdaOracle(blobFalso, topes)
    check(
      'BLOB: lee solo el tope y declara la longitud total',
      b.valor.length === 2 + topes.topeBinario * 2 && b.original === 100000,
      `largo=${b.valor.length} original=${b.original}`
    )
    check('el locator se suelta después de leer', soltado, String(soltado))
    const clobFalso = {
      type: { name: 'DB_TYPE_CLOB' },
      length: 3,
      getData: async () => 'año',
      destroy: () => undefined
    }
    const c = await celdas.celdaOracle(clobFalso, topes)
    check('CLOB corto entero y sin recorte', c.valor === 'año' && c.original === null, JSON.stringify(c))
  }

  hr('(6) Recortes por celda y por respuesta')
  {
    const t = celdas.recortarTexto('x'.repeat(10), 4)
    check('texto recortado a 4, original 10', t.valor === 'xxxx' && t.original === 10, JSON.stringify(t))
    const emoji = 'abc\u{1F600}def'
    const e = celdas.recortarTexto(emoji, 4)
    check('no parte un par sustituto', e.valor === 'abc' && e.original === emoji.length, JSON.stringify(e))
    const sin = celdas.recortarTexto('corto', celdas.TOPE_CELDA)
    check('sin recorte no hay original', sin.original === null, JSON.stringify(sin))
    const grande = await celdas.celdaOracle('z'.repeat(celdas.TOPE_CELDA + 5), topes)
    check('celda de texto de 64 KiB + 5 se recorta', grande.valor.length === celdas.TOPE_CELDA && grande.original === celdas.TOPE_CELDA + 5, `original=${grande.original}`)

    const acc = new celdas.AcumuladorPagina(60)
    const f1 = acc.agregar(['a'.repeat(80)], [[0, 999]])
    check('la primera fila entra aunque pase el tope', f1 && acc.n === 1, `n=${acc.n}`)
    const f2 = acc.agregar(['b'], null)
    check('la segunda ya no entra y no se añade', !f2 && acc.n === 1, `n=${acc.n}`)
    const acc2 = new celdas.AcumuladorPagina(1000)
    acc2.agregar(['1', null, true], null)
    acc2.agregar(['2', 'x', false], [[1, 42]])
    const parseado = JSON.parse(acc2.json())
    check('filasJson es DbCelda[][] válido', JSON.stringify(parseado) === '[["1",null,true],["2","x",false]]', acc2.json())
    check('recortes relativos a la página', JSON.stringify(acc2.recortes) === '[[1,1,42]]', JSON.stringify(acc2.recortes))
    const catalogo = celdas.topesDe({ proposito: 'catalogo' })
    check('catálogo sin tope de celda', catalogo.topeCelda === 0 && catalogo.topeRespuesta === celdas.TOPE_RESPUESTA_CATALOGO, JSON.stringify(catalogo))
    check('usuario: 64 KiB / 4 MiB / 32 KiB binario', topes.topeCelda === 65536 && topes.topeRespuesta === 4194304 && topes.topeBinario === 32768, JSON.stringify(topes))
  }

  hr('(7) Columnas duplicadas no se pisan')
  {
    const fields = [
      { name: 'id', dataTypeID: 23, dataTypeModifier: -1 },
      { name: 'id', dataTypeID: 23, dataTypeModifier: -1 },
      { name: 'nombre', dataTypeID: 1043, dataTypeModifier: 44 }
    ]
    const cols = celdas.columnasPg(fields)
    check('tres columnas, dos llamadas id', cols.length === 3 && cols[0].nombre === 'id' && cols[1].nombre === 'id', JSON.stringify(cols.map((c: any) => c.nombre)))
    const fila = celdas.filaPg(['1', '2', 'Ana'], [23, 23, 1043], topes)
    const acc = new celdas.AcumuladorPagina(0)
    acc.agregar(fila.celdas, fila.recortes)
    check('la fila conserva los dos id', acc.json() === '[["1","2","Ana"]]', acc.json())
    const colsOra = celdas.columnasOracle([
      { name: 'ID', dbType: tipo('DB_TYPE_NUMBER'), dbTypeName: 'NUMBER', precision: 10, scale: 0, nullable: false },
      { name: 'ID', dbType: tipo('DB_TYPE_NUMBER'), dbTypeName: 'NUMBER', precision: 0, scale: -127, nullable: true }
    ])
    check('Oracle: dos ID distintos', colsOra.length === 2 && colsOra[0].tipoMotor === 'NUMBER(10)' && colsOra[1].tipoMotor === 'NUMBER', JSON.stringify(colsOra))
  }

  hr('(8) Tipos lógicos y nombres')
  {
    check('Oracle NUMBER -> numero', celdas.tipoLogicoOracle(meta('DB_TYPE_NUMBER')) === 'numero', 'numero')
    check('Oracle DATE -> fechaHora (lleva hora)', celdas.tipoLogicoOracle(meta('DB_TYPE_DATE')) === 'fechaHora', 'fechaHora')
    check('Oracle CLOB -> lob', celdas.tipoLogicoOracle(meta('DB_TYPE_CLOB')) === 'lob', 'lob')
    check('Oracle BLOB -> binario', celdas.tipoLogicoOracle(meta('DB_TYPE_BLOB')) === 'binario', 'binario')
    check('Oracle OBJECT -> otro', celdas.tipoLogicoOracle(meta('DB_TYPE_OBJECT')) === 'otro', 'otro')
    check('PG numeric -> numero', celdas.tipoLogicoPg(1700) === 'numero', 'numero')
    check('PG date -> fecha', celdas.tipoLogicoPg(1082) === 'fecha', 'fecha')
    check('PG timestamptz -> fechaHora', celdas.tipoLogicoPg(1184) === 'fechaHora', 'fechaHora')
    check('PG jsonb -> json', celdas.tipoLogicoPg(3802) === 'json', 'json')
    check('PG tipo de usuario -> texto', celdas.tipoLogicoPg(90001) === 'texto', 'texto')
    check('numeric(10,2) desde typmod', celdas.nombreTipoPg(1700, ((10 << 16) | 2) + 4) === 'numeric(10,2)', celdas.nombreTipoPg(1700, ((10 << 16) | 2) + 4))
    check('varchar(40) desde typmod', celdas.nombreTipoPg(1043, 44) === 'varchar(40)', celdas.nombreTipoPg(1043, 44))
    const extra = new Map([[90001, 'estado_pedido']])
    check('tipo de usuario resuelto por la sesión', celdas.nombreTipoPg(90001, -1, extra) === 'estado_pedido', 'estado_pedido')
    // el TIMESTAMP con su precisión, con la forma de `data_type` de ALL_TAB_COLS
    // (la del main). Los metadatos, como los da oracledb 6.10 en thin y en thick (medido).
    const ts = (clave: string, nombre: string, precision?: unknown): string =>
      celdas.tipoMotorOracle({ dbType: tipo(clave), dbTypeName: nombre, ...(precision === undefined ? {} : { precision }) })
    const t6 = ts('DB_TYPE_TIMESTAMP', 'TIMESTAMP', 6)
    const t0 = ts('DB_TYPE_TIMESTAMP', 'TIMESTAMP', 0)
    const t9 = ts('DB_TYPE_TIMESTAMP', 'TIMESTAMP', 9)
    const tz3 = ts('DB_TYPE_TIMESTAMP_TZ', 'TIMESTAMP WITH TIME ZONE', 3)
    const ltz6 = ts('DB_TYPE_TIMESTAMP_LTZ', 'TIMESTAMP WITH LOCAL TIME ZONE', 6)
    check(
      'TIMESTAMP con su precisión, también 0, y la de zona DETRÁS de la palabra TIMESTAMP',
      t6 === 'TIMESTAMP(6)' && t0 === 'TIMESTAMP(0)' && t9 === 'TIMESTAMP(9)' && tz3 === 'TIMESTAMP(3) WITH TIME ZONE' && ltz6 === 'TIMESTAMP(6) WITH LOCAL TIME ZONE',
      JSON.stringify([t6, t0, t9, tz3, ltz6])
    )
    const sinP = ts('DB_TYPE_TIMESTAMP', 'TIMESTAMP')
    const nulo = ts('DB_TYPE_TIMESTAMP', 'TIMESTAMP', null)
    const rara = ts('DB_TYPE_TIMESTAMP_TZ', 'TIMESTAMP WITH TIME ZONE', '6')
    check(
      'NEGATIVO: sin precisión, con null o con texto queda el nombre a secas (Number(null) sería un 0 falso)',
      sinP === 'TIMESTAMP' && nulo === 'TIMESTAMP' && rara === 'TIMESTAMP WITH TIME ZONE',
      JSON.stringify([sinP, nulo, rara])
    )
    check(
      'NEGATIVO: un DATE no gana precisión aunque el metadato la trajera (es solo del TIMESTAMP)',
      celdas.tipoMotorOracle({ dbType: tipo('DB_TYPE_DATE'), dbTypeName: 'DATE', precision: 6 }) === 'DATE',
      celdas.tipoMotorOracle({ dbType: tipo('DB_TYPE_DATE'), dbTypeName: 'DATE', precision: 6 })
    )
    // Y con eso la regla compartida de los originales (la del main y la rejilla) decide.
    check(
      'la regla de los originales compara TIMESTAMP(≤6) [WITH TIME ZONE] por este tipoMotor, y NO el (9), el LOCAL ni el que no trae precisión',
      comparacionOriginalOracle(t6) === 'marca' &&
        comparacionOriginalOracle(t0) === 'marca' &&
        comparacionOriginalOracle(tz3) === 'marcaZona' &&
        comparacionOriginalOracle(t9) === null &&
        comparacionOriginalOracle(ltz6) === null &&
        comparacionOriginalOracle(sinP) === null,
      JSON.stringify([t6, t0, tz3, t9, ltz6, sinP].map((t) => comparacionOriginalOracle(t)))
    )
    // los TAMAÑOS DE TEXTO. Los metadatos, como los dio oracledb 6.10
    // en la sonda (11.2 thick, 21c thin y thick; base AL32UTF8, nacional AL16UTF16): thin da
    // el número declarado sin su unidad, y thick el máximo en bytes (ver `tipoMotorOracle`).
    const THIN = { thin: true, juegoNacional: 'AL16UTF16' }
    const THICK = { thin: false, juegoNacional: 'AL16UTF16' }
    const tt = (clave: string, nombre: string, byteSize: number, contexto?: unknown): string =>
      celdas.tipoMotorOracle({ dbType: tipo(clave), dbTypeName: nombre, byteSize }, contexto)
    // [declarado, clave, nombre, byteSize en thin, byteSize en thick, lo que se enseña]
    const medidos: Array<[string, string, string, number, number, string]> = [
      ['VARCHAR2(40 BYTE)', 'DB_TYPE_VARCHAR', 'VARCHAR2', 40, 40, 'VARCHAR2'],
      ['VARCHAR2(40 CHAR)', 'DB_TYPE_VARCHAR', 'VARCHAR2', 40, 160, 'VARCHAR2'],
      ['VARCHAR2(160 BYTE)', 'DB_TYPE_VARCHAR', 'VARCHAR2', 160, 160, 'VARCHAR2'],
      ['VARCHAR2(1000 CHAR)', 'DB_TYPE_VARCHAR', 'VARCHAR2', 1000, 4000, 'VARCHAR2'],
      ['CHAR(5 BYTE)', 'DB_TYPE_CHAR', 'CHAR', 5, 5, 'CHAR'],
      ['CHAR(5 CHAR)', 'DB_TYPE_CHAR', 'CHAR', 5, 20, 'CHAR'],
      ['NVARCHAR2(20)', 'DB_TYPE_NVARCHAR', 'NVARCHAR2', 20, 40, 'NVARCHAR2(20)'],
      ['NVARCHAR2(2000)', 'DB_TYPE_NVARCHAR', 'NVARCHAR2', 2000, 4000, 'NVARCHAR2(2000)'],
      ['NCHAR(3)', 'DB_TYPE_NCHAR', 'NCHAR', 3, 6, 'NCHAR(3)'],
      ['RAW(16)', 'DB_TYPE_RAW', 'RAW', 16, 16, 'RAW(16)']
    ]
    const malMedidos = medidos.flatMap(([declarado, clave, nombre, enThin, enThick, esperado]) => {
      const a = tt(clave, nombre, enThin, THIN)
      const b = tt(clave, nombre, enThick, THICK)
      return a === esperado && b === esperado ? [] : [`${declarado}: thin=${a} thick=${b} (se esperaba ${esperado})`]
    })
    check(
      'tamaños de texto: el MISMO tipo en thin y en thick, y nunca un número que no es el declarado (160 por un VARCHAR2(40 CHAR), 40 por una NVARCHAR2(20))',
      malMedidos.length === 0,
      malMedidos.join('; ') || medidos.map((m) => `${m[0]} -> ${m[5]}`).join(', ')
    )
    const nvUtf8 = tt('DB_TYPE_NVARCHAR', 'NVARCHAR2', 60, { thin: false, juegoNacional: 'UTF8' })
    const nvSinJuego = tt('DB_TYPE_NVARCHAR', 'NVARCHAR2', 40, { thin: false, juegoNacional: null })
    const nvSinContexto = tt('DB_TYPE_NVARCHAR', 'NVARCHAR2', 40)
    const nvImpar = tt('DB_TYPE_NCHAR', 'NCHAR', 7, THICK)
    check(
      'NEGATIVO: en thick, una NVARCHAR2 con otro juego nacional (UTF8), sin saberlo, sin contexto o con bytes impares va SIN tamaño (no se divide a ciegas)',
      nvUtf8 === 'NVARCHAR2' && nvSinJuego === 'NVARCHAR2' && nvSinContexto === 'NVARCHAR2' && nvImpar === 'NCHAR',
      JSON.stringify([nvUtf8, nvSinJuego, nvSinContexto, nvImpar])
    )
    const nvThinUtf8 = tt('DB_TYPE_NVARCHAR', 'NVARCHAR2', 20, { thin: true, juegoNacional: 'UTF8' })
    check('en thin, la NVARCHAR2 lleva sus caracteres con cualquier juego nacional (thin ya los cuenta)', nvThinUtf8 === 'NVARCHAR2(20)', nvThinUtf8)
    const numNeg = celdas.tipoMotorOracle({ dbType: tipo('DB_TYPE_NUMBER'), dbTypeName: 'NUMBER', precision: 5, scale: -2 })
    check('NUMBER con escala NEGATIVA (medido: NUMBER(5,-2) da precision 5 y scale -2): no se pierde', numNeg === 'NUMBER(5,-2)', numNeg)
    check(
      'y la regla de los originales sigue igual: VARCHAR2 y CHAR sin tamaño se comparan, la NVARCHAR2 no, y el NUMBER de escala negativa sí',
      comparacionOriginalOracle('VARCHAR2') === 'texto' &&
        comparacionOriginalOracle('CHAR') === 'texto' &&
        comparacionOriginalOracle('NVARCHAR2(20)') === null &&
        comparacionOriginalOracle(numNeg) === 'numero',
      JSON.stringify(['VARCHAR2', 'CHAR', 'NVARCHAR2(20)', numNeg].map((t) => comparacionOriginalOracle(t)))
    )
    const colsCtx = celdas.columnasOracle([{ name: 'NV', dbType: tipo('DB_TYPE_NVARCHAR'), dbTypeName: 'NVARCHAR2', byteSize: 40 }], THICK)
    check('columnasOracle pasa el contexto de la sesión a cada columna', colsCtx[0]?.tipoMotor === 'NVARCHAR2(20)', JSON.stringify(colsCtx))
    check('bool de PG por el parser crudo', celdas.TIPOS_CRUDOS_PG.getTypeParser(16)('t') === true, 'true')
    check('int8 de PG queda en texto crudo', celdas.TIPOS_CRUDOS_PG.getTypeParser(20)('9223372036854775807') === '9223372036854775807', 'texto')
  }

  hr('(9) Intervalos de Oracle')
  {
    const ym = celdas.textoIntervalo({ years: 1, months: 2 })
    check('YEAR TO MONTH', ym === '+01-02', ym)
    const ds = celdas.textoIntervalo({ days: 1, hours: 2, minutes: 3, seconds: 4, fseconds: 500000000 })
    check('DAY TO SECOND', ds === '+01 02:03:04.500000', ds)
    const neg = celdas.textoIntervalo({ days: -3, hours: -1, minutes: 0, seconds: 0, fseconds: 0 })
    check('negativo', neg === '-03 01:00:00.000000', neg)
  }

  hr('(10) Errores de Oracle (sin servidor)')
  {
    const ora = require_('./sesionOracle.cjs')
    // 'ñññ' ocupa 6 bytes en UTF-8: el offset que manda Oracle (bytes) cae 3 puntos
    // de código antes de lo que diría un conteo ingenuo.
    const sql = "SELECT 'ñññ' FROM dual\nSELEC x"
    const bytesHasta = Buffer.byteLength("SELECT 'ñññ' FROM dual\n", 'utf8')
    const e = ora.normalizarError(Object.assign(new Error('ORA-00900: invalid SQL statement'), { code: 'ORA-00900', offset: bytesHasta }), sql)
    const cpEsperado = Array.from("SELECT 'ñññ' FROM dual\n").length
    check('offset en bytes UTF-8 -> puntos de código', e.offsetCp === cpEsperado && e.clase === 'servidor' && e.codigo === 'ORA-00900', `offsetCp=${e.offsetCp} esperado=${cpEsperado} bytes=${bytesHasta}`)
    const cero = ora.normalizarError(Object.assign(new Error('ORA-01476: divisor is equal to zero'), { code: 'ORA-01476', offset: 0 }), 'SELECT 1/0 FROM dual')
    check('offset 0 (error de ejecución) no se informa', cero.offsetCp === undefined, JSON.stringify(cero))
    const astral = ora.bytesAPuntosDeCodigo('a😀b', 5)
    check('emoji: 4 bytes = 1 punto de código', astral === 2, String(astral))
    const perd = ora.normalizarError(Object.assign(new Error('ORA-03113: end-of-file on communication channel'), { code: 'ORA-03113' }), 'x')
    check('ORA-03113 -> perdida', perd.clase === 'perdida', perd.clase)
    const njs = ora.normalizarError(Object.assign(new Error('NJS-500: connection to the Oracle Database was broken'), { code: 'NJS-500' }), 'x')
    check('NJS-500 -> perdida', njs.clase === 'perdida' && ora.esPerdida({ code: 'NJS-500' }), njs.clase)
    const can = ora.normalizarError(Object.assign(new Error('ORA-01013: user requested cancel of current operation'), { code: 'ORA-01013' }), 'x')
    check('ORA-01013 -> cancelada', can.clase === 'cancelada', can.clase)
    const to = ora.normalizarError(Object.assign(new Error('NJS-123: call timeout of 60000 ms exceeded'), { code: 'NJS-123' }), 'x')
    check('NJS-123 sin Stop -> timeout', to.clase === 'timeout', to.clase)
    const ro = ora.normalizarError(Object.assign(new Error('ORA-01456: may not perform insert/delete/update operation inside a READ ONLY transaction'), { code: 'ORA-01456' }), 'x')
    check('ORA-01456 -> soloLectura', ro.clase === 'soloLectura', ro.clase)
    const req = { packId: 'oracle-ic-19', motivo: 'Oracle 11.2 necesita el cliente' }
    const drv = ora.normalizarError(Object.assign(new Error('QA es anterior a Oracle 12.1'), { requiereDriver: req }), 'x')
    check('requiereDriver -> driver con el pack', drv.clase === 'driver' && drv.requiereDriver?.packId === 'oracle-ic-19', JSON.stringify(drv))
    const win = ora.normalizarError(
      new Error('DPI-1047: Cannot locate a 64-bit Oracle Client library: "C:\\Users\\ana\\AppData\\Roaming\\Tessera\\drivers\\oracle\\ic 19\\oci.dll is not the correct architecture". See https://oracle.github.io/node-oracledb/doc/api.html#windowsinstallation for help'),
      'x'
    )
    check(
      'DPI-1047 (Windows): ruta del host -> <cliente>, la URL intacta',
      !win.mensaje.includes('ana') && win.mensaje.includes('<cliente>') && win.mensaje.includes('https://oracle.github.io/node-oracledb/doc/api.html') && win.clase === 'driver',
      win.mensaje
    )
    const mac = ora.normalizarError(
      new Error("DPI-1047: Cannot locate a 64-bit Oracle Client library: \"dlopen(libclntsh.dylib, 0x0001): tried: '/Users/ana/Library/Application Support/Tessera/drivers/oracle/ic/libclntsh.dylib' (no such file)\". See https://oracle.github.io/odpi/doc/installation.html#macos for help"),
      'x'
    )
    check('DPI-1047 (Mac): ruta con espacios -> <cliente>', !mac.mensaje.includes('ana') && mac.mensaje.includes('<cliente>') && mac.mensaje.includes('https://oracle.github.io/odpi/doc/installation.html'), mac.mensaje)
    const normal = ora.normalizarError(new Error('ORA-00942: table or view does not exist'), 'x')
    check('un error normal no pasa por la limpieza', normal.mensaje === 'ORA-00942: table or view does not exist' && normal.codigo === 'ORA-00942', normal.mensaje)
    // El aviso de «creado con errores de compilación», tal como llega de cada modo
    // (medido contra la 11.2 en thick y la 21c en thin): los dos dan el código del
    // servidor, no el NJS-700 del driver.
    const avisoThick = ora.advertenciaOracle(
      Object.assign(new Error('NJS-700: creation succeeded with compilation errors\nORA-24344: success with compilation error'), {
        code: 'NJS-700',
        errorNum: 24344
      })
    )
    const avisoThin = ora.advertenciaOracle(Object.assign(new Error('NJS-700: creation succeeded with compilation errors'), { code: 'NJS-700' }))
    check(
      'aviso de compilación: ORA-24344 en thick y en thin, con el mismo mensaje',
      avisoThick.codigo === 'ORA-24344' && JSON.stringify(avisoThick) === JSON.stringify(avisoThin) && /^ORA-24344:/.test(avisoThin.mensaje),
      `${JSON.stringify(avisoThick)} / ${JSON.stringify(avisoThin)}`
    )
    const otroAviso = ora.advertenciaOracle(Object.assign(new Error('ORA-28002: the password will expire within 7 days'), { code: 'ORA-28002' }))
    check('otro aviso pasa tal cual, con su código', otroAviso.codigo === 'ORA-28002' && otroAviso.mensaje.startsWith('ORA-28002'), JSON.stringify(otroAviso))
  }

  hr('(11) Errores de PostgreSQL (sin servidor)')
  {
    const pg = require_('./sesionPostgres.cjs')
    const sintaxis = pg.normalizarError(Object.assign(new Error('syntax error at or near "SELECT"'), { code: '42601', position: '17', hint: 'h', detail: 'd' }))
    check('position (base 1) -> offsetCp (base 0) con detalle y pista', sintaxis.offsetCp === 16 && sintaxis.detalle === 'd' && sintaxis.pista === 'h', JSON.stringify(sintaxis))
    const interna = pg.normalizarError(Object.assign(new Error('x'), { code: '42703', internalPosition: '5' }))
    check('internalPosition -> offsetInternoCp', interna.offsetInternoCp === 4, JSON.stringify(interna))
    // Sin `position` (DO, función SQL) el main marca con estos dos: tienen que llegarle.
    const enDo = pg.normalizarError(
      Object.assign(new Error('x'), { code: 'P0001', internalQuery: ' SELECT x FROM nope ', where: 'PL/pgSQL function inline_code_block line 2 at RAISE' })
    )
    check(
      'internalQuery -> consultaInterna y where -> donde',
      enDo.consultaInterna === ' SELECT x FROM nope ' && enDo.donde === 'PL/pgSQL function inline_code_block line 2 at RAISE' && enDo.offsetCp === undefined,
      JSON.stringify(enDo)
    )
    const stop = pg.normalizarError(Object.assign(new Error('canceling statement due to user request'), { code: '57014', __cancelPedido: true }))
    const tiempo = pg.normalizarError(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }))
    check('57014 con Stop -> cancelada; sin Stop -> timeout', stop.clase === 'cancelada' && tiempo.clase === 'timeout', `${stop.clase}/${tiempo.clase}`)
    const perdidas = ['08006', '57P01', '57P05', '25P03'].map((c) => pg.normalizarError(Object.assign(new Error('m'), { code: c })).clase)
    check('clase 08, 57P01-05 y 25P03 -> perdida', perdidas.every((c: string) => c === 'perdida'), perdidas.join(','))
    const term = pg.normalizarError(new Error('Connection terminated unexpectedly'))
    check('"Connection terminated" -> perdida', term.clase === 'perdida', term.clase)
    const ro = pg.normalizarError(Object.assign(new Error('cannot execute UPDATE in a read-only transaction'), { code: '25006' }))
    check('25006 -> soloLectura', ro.clase === 'soloLectura', ro.clase)
  }

  hr('(12) Salida del servidor: topes y aviso de lo descartado')
  {
    const a = new celdas.AcumuladorSalida(3, 1000)
    a.agregar('uno', false)
    a.agregar(null, false)
    a.agregar('aviso', true)
    const lleno = a.lleno
    const cuarta = a.agregar('cuatro', false)
    a.agregar('cinco', false)
    const l = a.lineas()
    check(
      'tope de líneas: 3 dentro, el resto contado y una última línea que lo dice',
      lleno && !cuarta && l.length === 4 && l[1].texto === '' && l[2].aviso === true && l[0].aviso === undefined &&
        /se muestran 3 líneas; se descartaron 2 líneas más/.test(l[3].texto) && l[3].aviso === true,
      JSON.stringify(l)
    )
    const b = new celdas.AcumuladorSalida(100, 10)
    b.agregar('12345678', false)
    b.agregar('abcdefgh', false)
    b.agregar('fuera', false)
    const lb = b.lineas()
    check(
      'tope de caracteres: la línea que no cabe se corta y lo que sigue se descarta',
      lb[0].texto === '12345678' && lb[1].texto === 'ab' && /se descartó 1 línea más/.test(lb[lb.length - 1].texto),
      JSON.stringify(lb)
    )
    const c = new celdas.AcumuladorSalida()
    c.agregar('x', false)
    c.marcarPurgada()
    check('purgada sin leer (Oracle): el aviso no inventa cuántas', /el resto se descartó sin leerlo/.test(c.lineas()[1].texto), JSON.stringify(c.lineas()))
    check('sin nada que avisar, sin línea extra', new celdas.AcumuladorSalida().lineas().length === 0, 'vacío')
    check('topes por defecto: 1000 líneas y 1 Mi', celdas.TOPE_SALIDA_LINEAS === 1000 && celdas.TOPE_SALIDA_CARACTERES === 1024 * 1024, 'ok')
  }

  hr('(13) Binds de salida de texto de Oracle (el DDL de DBMS_METADATA)')
  {
    const ora = require_('./sesionOracle.cjs')
    const falso = { BIND_OUT: 3003, DB_TYPE_CLOB: { name: 'DB_TYPE_CLOB' } }
    const p = ora.prepararBinds(falso, { esq: 'HR', obj: null, ddl: { salida: 'texto', tope: 50 } })
    check(
      '{ salida: "texto" } -> BIND_OUT de CLOB con su tope; lo demás, tal cual',
      p.binds.esq === 'HR' && p.binds.obj === null && p.binds.ddl.dir === 3003 && p.binds.ddl.type === falso.DB_TYPE_CLOB && p.salidas.ddl === 50,
      JSON.stringify(p)
    )
    const posicionales = ora.prepararBinds(falso, ['a', 1])
    check('binds posicionales: sin salidas', Array.isArray(posicionales.binds) && posicionales.salidas === null, JSON.stringify(posicionales))
  }

  hr('(13b) Binds de ENTRADA hacia un CLOB y en el juego nacional («Enviar» de la rejilla)')
  {
    const ora = require_('./sesionOracle.cjs')
    const pg = require_('./sesionPostgres.cjs')
    const falso = { BIND_IN: 3001, BIND_OUT: 3003, DB_TYPE_CLOB: { name: 'DB_TYPE_CLOB' }, DB_TYPE_NCLOB: { name: 'DB_TYPE_NCLOB' } }
    const largo = 'ñ'.repeat(5000)
    const p = ora.prepararBinds(falso, ['x', { entrada: 'clob', valor: largo }, { entrada: 'nclob', valor: null }, null, '7'])
    check(
      'posicionales: { entrada: "clob" } -> BIND_IN de CLOB con su valor; NCLOB con NULL; el resto tal cual',
      p.binds[0] === 'x' &&
        p.binds[1].dir === 3001 && p.binds[1].type === falso.DB_TYPE_CLOB && p.binds[1].val === largo &&
        p.binds[2].type === falso.DB_TYPE_NCLOB && p.binds[2].val === null &&
        p.binds[3] === null && p.binds[4] === '7' && p.salidas === null,
      JSON.stringify(p.binds.map((b: unknown) => (b && typeof b === 'object' ? { ...(b as Record<string, unknown>), val: '…' } : b)))
    )
    const n = ora.prepararBinds(falso, { a: { entrada: 'clob', valor: 'hola' }, b: 'c' })
    check('con nombre también', n.binds.a.type === falso.DB_TYPE_CLOB && n.binds.a.val === 'hola' && n.binds.b === 'c', JSON.stringify(n.binds))
    const otro = ora.prepararBinds(falso, [{ entrada: 'blob', valor: 'x' }])
    check('NEGATIVO: una forma desconocida no se convierte (pasa tal cual)', otro.binds[0].entrada === 'blob' && otro.binds[0].type === undefined, JSON.stringify(otro.binds))
    // el texto hacia una NCHAR/NVARCHAR2 va en el juego NACIONAL.
    const falsoN = { ...falso, DB_TYPE_NVARCHAR: { name: 'DB_TYPE_NVARCHAR' } }
    const nac = ora.prepararBinds(falsoN, [{ entrada: 'nvarchar', valor: '漢字 😀' }, 'x'])
    const nacNombre = ora.prepararBinds(falsoN, { k: { entrada: 'nvarchar', valor: 'ñ' } })
    check(
      '{ entrada: "nvarchar" } -> BIND_IN de NVARCHAR con su valor, posicional y con nombre; el resto tal cual',
      nac.binds[0].dir === 3001 && nac.binds[0].type === falsoN.DB_TYPE_NVARCHAR && nac.binds[0].val === '漢字 😀' && nac.binds[1] === 'x' &&
        nacNombre.binds.k.type === falsoN.DB_TYPE_NVARCHAR && nacNombre.binds.k.val === 'ñ',
      JSON.stringify([nac.binds, nacNombre.binds])
    )
    check(
      'PG: el bind de LOB y el nacional se reducen a su valor (pg lo serializaría como JSON)',
      pg.valorDeBind({ entrada: 'clob', valor: 'x' }) === 'x' && pg.valorDeBind({ entrada: 'nclob', valor: null }) === null && pg.valorDeBind({ entrada: 'nvarchar', valor: 'ñ' }) === 'ñ',
      'ok'
    )
    check('NEGATIVO PG: lo demás no se toca (texto, null, array de texto)', pg.valorDeBind('a') === 'a' && pg.valorDeBind(null) === null && JSON.stringify(pg.valorDeBind(['a'])) === '["a"]', 'ok')
  }

  hr('(14) Escalada thin -> thick: las clases de oracledb vuelven a las base (LOB tras la escalada)')
  {
    // Lo que hace un intento thin fallido: cargar el driver thin, que sustituye las
    // clases compartidas. Se comprueba contra el oracledb INSTALADO: depende de un
    // interno que puede cambiar al actualizarlo.
    const impl = require_('oracledb/lib/impl/index.js')
    const baseLob = require_('oracledb/lib/impl/lob.js')
    const baseCon = require_('oracledb/lib/impl/connection.js')
    require_('oracledb/lib/thin')
    const sustituidas = impl.LobImpl !== baseLob && impl.ConnectionImpl !== baseCon
    require_('./oracle.cjs').restaurarClasesThick()
    check(
      'cargar thin sustituye LobImpl/ConnectionImpl y restaurarClasesThick las repone',
      sustituidas && impl.LobImpl === baseLob && impl.ConnectionImpl === baseCon && impl.ResultSetImpl === require_('oracledb/lib/impl/resultset.js'),
      `sustituidas=${sustituidas} ahora=${impl.LobImpl?.name}/${impl.ConnectionImpl?.name}`
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
