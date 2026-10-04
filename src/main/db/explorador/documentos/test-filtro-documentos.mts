#!/usr/bin/env node
// =============================================================================
// Prueba pura del compilador del filtro guiado y del orden de la cabecera para MongoDB (`filtroDocumentos.ts`): cada texto
// compilado pasa por el parser real del trabajador y se mira el BSON que sale. Contra el servidor: `test-db-mongo.mts`.
// (node src/main/db/explorador/documentos/test-filtro-documentos.mts  ·  npm run test:filtro-documentos)
// =============================================================================

import { createRequire } from 'node:module'
import type { DbFiltroGuiado, DbCondicionFiltro } from '../../../../shared/filtroGuiado.ts'
import {
  compilarConsultaDocs,
  compilarFiltroDocs,
  compilarOrdenDocs,
  condicionEnPosicion,
  escaparRegex,
  literalNumero,
  ubicarErrorGuiado
} from './filtroDocumentos.ts'

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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)

const require_ = createRequire(import.meta.url)
const parser = require_('@mongodb-js/shell-bson-parser') as { parse(t: string, o: { mode: string }): unknown }
const parsear = (t: string): any => parser.parse(t, { mode: 'loose' })

const una = (c: DbCondicionFiltro, union: DbFiltroGuiado['union'] = 'todas'): DbFiltroGuiado => ({ union, condiciones: [c] })
/** Compila UNA condición y devuelve lo que el parser da para su campo (o el error). */
function exprDe(c: DbCondicionFiltro): { texto: string; valor: any; error?: unknown } {
  const r = compilarFiltroDocs(una(c))
  if (!r.ok) return { texto: '', valor: undefined, error: r.error }
  const doc = parsear(r.valor.texto)
  return { texto: r.valor.texto, valor: doc[c.columna] }
}
const tipo = (x: any): string => (x && typeof x === 'object' ? (x._bsontype ?? x.constructor?.name) : typeof x)
const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : `no es Date: ${String(d)}`)

function main(): void {
  hr('(1) Texto')
  {
    const c = exprDe({ columna: 'nombre', categoria: 'texto', operador: 'contiene', valor: 'a.b*(c)[d]$^|\\' })
    const re = new RegExp(c.valor?.$regex, c.valor?.$options)
    check(
      'contiene: $regex con los metacaracteres escapados y $options "i"',
      c.valor?.$regex === 'a\\.b\\*\\(c\\)\\[d\\]\\$\\^\\|\\\\' && c.valor?.$options === 'i' && re.test('xxA.B*(C)[D]$^|\\yy') && !re.test('axb*(c)[d]$^|\\'),
      j(c)
    )
    check('escaparRegex deja los caracteres normales (y % _ - /) como están', escaparRegex('50%_a-b/c') === '50%_a-b/c', escaparRegex('50%_a-b/c'))
    const e = exprDe({ columna: 'nombre', categoria: 'texto', operador: 'empiezaPor', valor: 'Ma.' })
    const ree = new RegExp(e.valor?.$regex, e.valor?.$options)
    check('empieza por: anclado con ^, sin mayúsculas, el punto literal', e.valor?.$regex === '^Ma\\.' && ree.test('mA.ria') && !ree.test('xMa.') && !ree.test('Maria'), j(e))
    const malicioso = '"}, { "$where": "sleep(1000)" }, {"x": "'
    const ig = exprDe({ columna: 'estatus', categoria: 'texto', operador: 'igual', valor: malicioso })
    check('= exacto: un valor con comillas y llaves es SOLO un texto (sin $where en ninguna parte)', ig.valor?.$eq === malicioso && Object.keys(ig.valor).length === 1 && !/"\$where":/.test(ig.texto.replace(JSON.stringify(malicioso), '')), j(ig))
    const dist = exprDe({ columna: 'estatus', categoria: 'texto', operador: 'distinto', valor: 'NOMINA PROCESADA' })
    check('≠ es $ne (en MongoDB ya incluye los que no tienen el campo)', dist.valor?.$ne === 'NOMINA PROCESADA', j(dist))
    const esp = exprDe({ columna: 'nombre', categoria: 'texto', operador: 'igual', valor: ' con espacios ' })
    check('el texto de = va tal cual (sin recortar)', esp.valor?.$eq === ' con espacios ', j(esp))
  }

  hr('(2) Vacío / no vacío')
  {
    const tv = exprDe({ columna: 't', categoria: 'texto', operador: 'vacio' })
    check('texto vacío: $in [null, ""]', j(tv.valor) === j({ $in: [null, ''] }), j(tv))
    const tn = exprDe({ columna: 't', categoria: 'texto', operador: 'noVacio' })
    check('texto no vacío: $nin [null, ""]', j(tn.valor) === j({ $nin: [null, ''] }), j(tn))
    const nv = exprDe({ columna: 'n', categoria: 'numero', operador: 'vacio' })
    const on = exprDe({ columna: 'o', categoria: 'otro', operador: 'noVacio' })
    check('número vacío: $eq null; otro no vacío: $ne null', j(nv.valor) === j({ $eq: null }) && j(on.valor) === j({ $ne: null }), j({ nv, on }))
  }

  hr('(3) Números')
  {
    const num = (v: string): any => exprDe({ columna: 'n', categoria: 'numero', operador: 'igual', valor: v }).valor?.$eq
    check('entero: 12 → number 12', num('12') === 12, String(num('12')))
    check('con signo y ceros: "-0012.50" → -12.5 (double)', num('-0012.50') === -12.5, String(num('-0012.50')))
    check('"+5" → 5; "12.0" → 12', num('+5') === 5 && num('12.0') === 12, j([num('+5'), num('12.0')]))
    check('el mayor entero seguro, 9007199254740991, va como number', num('9007199254740991') === 9007199254740991, String(num('9007199254740991')))
    const grande = num('9007199254740993')
    check('9007199254740993 (fuera de 2^53) → Decimal128 EXACTO', tipo(grande) === 'Decimal128' && grande.toString() === '9007199254740993', `${tipo(grande)} ${String(grande)}`)
    const neg = num('-9007199254740993')
    check('-9007199254740993 → Decimal128 negativo', tipo(neg) === 'Decimal128' && neg.toString() === '-9007199254740993', `${tipo(neg)} ${String(neg)}`)
    const treinta = num('123456789012345678901234567890')
    check('un entero de 30 cifras → Decimal128 exacto', tipo(treinta) === 'Decimal128' && treinta.toString() === '123456789012345678901234567890', String(treinta))
    check('la forma corta de un double (0.30000000000000004, 17 cifras) → double', num('0.30000000000000004') === 0.1 + 0.2, String(num('0.30000000000000004')))
    const largo = num('0.1234567890123456789')
    check('un decimal que no es un double exacto (19 cifras) → Decimal128', tipo(largo) === 'Decimal128' && largo.toString() === '0.1234567890123456789', `${tipo(largo)} ${String(largo)}`)
    const diminuto = num('0.' + '0'.repeat(400) + '1')
    check('0.000…1 (fuera del rango del double) → Decimal128, no 0', tipo(diminuto) === 'Decimal128' && diminuto.toString() === '1E-401', `${tipo(diminuto)} ${String(diminuto)}`)
    const redondo = num('1' + '0'.repeat(40))
    check('1 con 40 ceros → Decimal128 (1 cifra significativa)', tipo(redondo) === 'Decimal128', `${tipo(redondo)} ${String(redondo)}`)
    const mucho = exprDe({ columna: 'n', categoria: 'numero', operador: 'igual', valor: '1'.repeat(35) })
    check('35 cifras significativas: error de la condición (no redondea en silencio)', (mucho.error as any)?.campo === 'filtro' && (mucho.error as any)?.condicion === 0 && /34 cifras/.test((mucho.error as any)?.mensaje), j(mucho.error))
    const entre = exprDe({ columna: 'n', categoria: 'numero', operador: 'entre', valor: '1', valor2: '2.5' })
    check('entre 1 y 2.5: $gte 1, $lte 2.5', entre.valor?.$gte === 1 && entre.valor?.$lte === 2.5, j(entre))
    const mayor = exprDe({ columna: 'n', categoria: 'numero', operador: 'mayor', valor: '40' })
    const menor = exprDe({ columna: 'n', categoria: 'numero', operador: 'menor', valor: '-1' })
    check('> y <: $gt / $lt', mayor.valor?.$gt === 40 && menor.valor?.$lt === -1, j({ mayor: mayor.valor, menor: menor.valor }))
    check('literalNumero("0") y ("-0") → "0"', literalNumero('0') === '0' && literalNumero('-0') === '0', j([literalNumero('0'), literalNumero('-0')]))
  }

  hr('(4) Fechas (UTC, día entero)')
  {
    const f = (operador: DbCondicionFiltro['operador'], valor: string, valor2?: string): any =>
      exprDe({ columna: 'f', categoria: 'fecha', operador, valor, ...(valor2 !== undefined ? { valor2 } : {}) }).valor
    const ig = f('igual', '2026-09-28')
    check('= día: [28 00:00Z, 29 00:00Z)', iso(ig?.$gte) === '2026-09-28T00:00:00.000Z' && iso(ig?.$lt) === '2026-09-29T00:00:00.000Z', j(ig))
    const di = f('distinto', '2026-09-28')
    check('≠ día: $not de ese rango (incluye ausentes)', iso(di?.$not?.$gte) === '2026-09-28T00:00:00.000Z' && iso(di?.$not?.$lt) === '2026-09-29T00:00:00.000Z', j(di))
    const ma = f('mayor', '2026-09-28')
    const me = f('menor', '2026-09-28')
    check('> día: desde el 29; < día: antes del 28', iso(ma?.$gte) === '2026-09-29T00:00:00.000Z' && Object.keys(ma).length === 1 && iso(me?.$lt) === '2026-09-28T00:00:00.000Z', j({ ma, me }))
    const en = f('entre', '2026-09-01', '2026-09-03')
    check('entre días: [1, 4)', iso(en?.$gte) === '2026-09-01T00:00:00.000Z' && iso(en?.$lt) === '2026-09-04T00:00:00.000Z', j(en))
    const enH = f('entre', '2026-09-01', '2026-09-03 12:00')
    check('entre con hora al final: $lte exacto', iso(enH?.$gte) === '2026-09-01T00:00:00.000Z' && iso(enH?.$lte) === '2026-09-03T12:00:00.000Z', j(enH))
    const hora = f('igual', '2026-09-28T14:30:05')
    check('con hora: comparación exacta ($eq) en UTC', iso(hora?.$eq) === '2026-09-28T14:30:05.000Z', j(hora))
    const mayH = f('mayor', '2026-09-28 14:30')
    check('> con hora: $gt exacto', iso(mayH?.$gt) === '2026-09-28T14:30:00.000Z', j(mayH))
    const fin = f('igual', '9999-12-31')
    check('9999-12-31: el día siguiente sale como ISODate(ms) y el parser lo admite', iso(fin?.$gte) === '9999-12-31T00:00:00.000Z' && fin?.$lt instanceof Date && fin.$lt.getTime() === Date.UTC(10000, 0, 1), j(fin))
    const bis = f('igual', '2028-02-29')
    check('29 de febrero bisiesto: hasta el 1 de marzo', iso(bis?.$lt) === '2028-03-01T00:00:00.000Z', j(bis))
  }

  hr('(5) Booleano e id')
  {
    const b = exprDe({ columna: 'activo', categoria: 'booleano', operador: 'igual', valor: 'sí' })
    const nb = exprDe({ columna: 'activo', categoria: 'booleano', operador: 'distinto', valor: 'false' })
    check('booleano: $eq true («sí»); ≠ false es $ne false', b.valor?.$eq === true && nb.valor?.$ne === false, j({ b: b.valor, nb: nb.valor }))
    const hex = '65A1B2C3D4E5F60718293A4B'
    const id = exprDe({ columna: '_id', categoria: 'id', operador: 'igual', valor: ` ${hex} ` })
    const lista = id.valor?.$in as any[]
    check(
      'id de 24 hex: $in [ObjectId, el texto] (un _id de texto de 24 hex también casa)',
      Array.isArray(lista) && lista.length === 3 && tipo(lista[0]) === 'ObjectId' && lista[0].toHexString() === hex.toLowerCase() && lista[1] === hex.toLowerCase() && lista[2] === hex,
      j(id)
    )
    const idMin = exprDe({ columna: '_id', categoria: 'id', operador: 'igual', valor: hex.toLowerCase() })
    check('id en minúsculas: sin repetir el texto', Array.isArray(idMin.valor?.$in) && idMin.valor.$in.length === 2, j(idMin))
    const nid = exprDe({ columna: '_id', categoria: 'id', operador: 'distinto', valor: hex })
    check('id ≠: $nin de las mismas formas', Array.isArray(nid.valor?.$nin) && nid.valor.$nin.length === 3 && tipo(nid.valor.$nin[0]) === 'ObjectId', j(nid))
    const txt = exprDe({ columna: '_id', categoria: 'id', operador: 'igual', valor: 'cliente-7' })
    check('id que no es hex: el texto tal cual', txt.valor?.$eq === 'cliente-7', j(txt))
  }

  hr('(6) Unión y rangos')
  {
    const f: DbFiltroGuiado = {
      union: 'cualquiera',
      condiciones: [
        { columna: 'edad', categoria: 'numero', operador: 'mayor', valor: '40' },
        { columna: 'edad', categoria: 'numero', operador: 'menor', valor: '18' },
        { columna: 'direccion.ciudad', categoria: 'texto', operador: 'igual', valor: 'Ñuñoa 😀' }
      ]
    }
    const r = compilarFiltroDocs(f)
    const doc = r.ok ? parsear(r.valor.texto) : null
    check(
      'cualquiera → $or con una condición por elemento (dos sobre el mismo campo no chocan) y el punto como ruta',
      r.ok && Array.isArray(doc?.$or) && doc.$or.length === 3 && doc.$or[0].edad.$gt === 40 && doc.$or[1].edad.$lt === 18 && doc.$or[2]['direccion.ciudad'].$eq === 'Ñuñoa 😀',
      r.ok ? r.valor.texto : j(r)
    )
    const trozos = r.ok ? r.valor.rangos.map((x) => r.valor.texto.slice(x.desde, x.hasta)) : []
    check('cada rango es exactamente el documento de su condición', trozos.length === 3 && trozos.every((t) => t.startsWith('{') && t.endsWith('}') && typeof parsear(t) === 'object'), j(trozos))
    const todas = compilarFiltroDocs({ ...f, union: 'todas' })
    check('todas → $and', todas.ok && Array.isArray(parsear(todas.valor.texto).$and), todas.ok ? todas.valor.texto : j(todas))
    const sola = compilarFiltroDocs({ union: 'todas', condiciones: [f.condiciones[0]] })
    check('una sola condición va sin $and', sola.ok && j(Object.keys(parsear(sola.valor.texto))) === j(['edad']) && sola.valor.rangos[0].desde === 0, sola.ok ? sola.valor.texto : j(sola))
    const vacio = compilarFiltroDocs({ union: 'todas', condiciones: [] })
    check('sin condiciones: texto vacío (= todos)', vacio.ok && vacio.valor.texto === '', j(vacio))
    if (r.ok) {
      const x = r.valor.rangos[1]
      check('condicionEnPosicion: dentro del rango 1 → 1; entre rangos → null', condicionEnPosicion(r.valor.rangos, x.desde + 2) === 1 && condicionEnPosicion(r.valor.rangos, 0) === null, j(r.valor.rangos))
    }
  }

  hr('(7) Errores del filtro')
  {
    const e = (f: unknown) => {
      const r = compilarFiltroDocs(f)
      return r.ok ? null : r.error
    }
    const dolar = e({ union: 'todas', condiciones: [{ columna: 'a', categoria: 'texto', operador: 'igual', valor: 'x' }, { columna: '$where', categoria: 'texto', operador: 'igual', valor: 'x' }] })
    check('un campo que empieza por $: error de la condición 1', dolar?.campo === 'filtro' && dolar.condicion === 1 && dolar.motivo === 'servidor' && /\$/.test(dolar.mensaje), j(dolar))
    const segmento = e(una({ columna: 'a.$b', categoria: 'texto', operador: 'igual', valor: 'x' }))
    const hueca = e(una({ columna: 'a..b', categoria: 'texto', operador: 'igual', valor: 'x' }))
    const nulo = e(una({ columna: 'a\u0000b', categoria: 'texto', operador: 'igual', valor: 'x' }))
    check('a.$b, a..b y un carácter nulo: error de la condición 0', segmento?.condicion === 0 && hueca?.condicion === 0 && nulo?.condicion === 0, j({ segmento, hueca, nulo }))
    const ajeno = e(una({ columna: 'n', categoria: 'numero', operador: 'contiene', valor: '1' }))
    check('operador de otra categoría (validarFiltro): campo filtro + condición 0', ajeno?.campo === 'filtro' && ajeno.condicion === 0, j(ajeno))
    const malo = e(una({ columna: 'f', categoria: 'fecha', operador: 'igual', valor: '2026-02-30' }))
    check('fecha imposible: error de la condición', malo?.condicion === 0, j(malo))
    const rota = e({ union: 'quizá', condiciones: [] })
    check('estructura rota: campo filtro SIN condición', rota?.campo === 'filtro' && rota.condicion === undefined, j(rota))
    const noObj = e('{ edad: 1 }')
    check('un texto donde va el filtro guiado: error', noObj?.campo === 'filtro', j(noObj))
  }

  hr('(8) Orden de la cabecera')
  {
    const o = compilarOrdenDocs([
      { columna: 'b', dir: 'asc' },
      { columna: 'a', dir: 'desc' },
      { columna: 'x.y', dir: 'asc' }
    ])
    const doc = o.ok ? parsear(o.valor) : null
    check('prioridad conservada: b 1, a -1, x.y 1', o.ok && j(Object.entries(doc)) === j([['b', 1], ['a', -1], ['x.y', 1]]), o.ok ? o.valor : j(o))
    const vacio = compilarOrdenDocs([])
    check('sin columnas: texto vacío (el orden natural)', vacio.ok && vacio.valor === '', j(vacio))
    const numPrimero = compilarOrdenDocs([
      { columna: '2', dir: 'desc' },
      { columna: 'b', dir: 'asc' }
    ])
    check('un campo numérico el PRIMERO: vale', numPrimero.ok && j(Object.keys(parsear(numPrimero.valor))) === j(['2', 'b']), j(numPrimero))
    const numDetras = compilarOrdenDocs([
      { columna: 'b', dir: 'asc' },
      { columna: '2', dir: 'desc' }
    ])
    check('un campo numérico DETRÁS de otro: error con campo orden (en vez de ordenar mal)', !numDetras.ok && numDetras.error.campo === 'orden' && /«2»/.test(numDetras.error.mensaje), j(numDetras))
    const dup = compilarOrdenDocs([
      { columna: 'a', dir: 'asc' },
      { columna: 'a', dir: 'desc' }
    ])
    const dolar = compilarOrdenDocs([{ columna: '$natural', dir: 'asc' }])
    const roto = compilarOrdenDocs([{ columna: 'a', dir: 'arriba' }])
    check('duplicado, $ y dirección rota: error con campo orden', !dup.ok && dup.error.campo === 'orden' && !dolar.ok && dolar.error.campo === 'orden' && !roto.ok && roto.error.campo === 'orden', j({ dup, dolar, roto }))
  }

  hr('(9) Exclusión con la barra de texto y errores del trabajador')
  {
    const guiado: DbFiltroGuiado = una({ columna: 'edad', categoria: 'numero', operador: 'mayor', valor: '40' })
    const base = { filtro: '', orden: '' }
    const g = compilarConsultaDocs({ ...base, filtroGuiado: guiado, ordenColumnas: [{ columna: 'edad', dir: 'desc' }] })
    check('guiado + cabecera: los textos compilados, con rangos y ordenGuiado', g.ok && g.valor.filtro === '{ "edad": { "$gt": 40 } }' && g.valor.orden === '{ "edad": -1 }' && g.valor.rangos?.length === 1 && g.valor.ordenGuiado, j(g))
    const texto = compilarConsultaDocs({ filtro: '{ a: 1 }', orden: '{ a: -1 }' })
    check('solo texto: pasa tal cual, sin rangos', texto.ok && texto.valor.filtro === '{ a: 1 }' && texto.valor.orden === '{ a: -1 }' && texto.valor.rangos === null && !texto.valor.ordenGuiado, j(texto))
    const choque = compilarConsultaDocs({ filtro: '{ a: 1 }', orden: '', filtroGuiado: guiado })
    check('guiado con condiciones + filtro de texto: petición inválida (interno)', !choque.ok && choque.error.motivo === 'interno', j(choque))
    const choqueOrden = compilarConsultaDocs({ filtro: '', orden: '{ a: 1 }', ordenColumnas: [{ columna: 'a', dir: 'asc' }] })
    check('cabecera + orden de texto: petición inválida (interno)', !choqueOrden.ok && choqueOrden.error.motivo === 'interno', j(choqueOrden))
    const vacios = compilarConsultaDocs({ filtro: '{ a: 1 }', orden: '{ a: 1 }', filtroGuiado: { union: 'todas', condiciones: [] }, ordenColumnas: [] })
    check('guiado VACÍO y cabecera vacía no excluyen el texto', vacios.ok && vacios.valor.filtro === '{ a: 1 }' && vacios.valor.orden === '{ a: 1 }', j(vacios))
    const blanco = compilarConsultaDocs({ filtro: '   ', orden: '', filtroGuiado: guiado })
    check('un filtro de texto en blanco no cuenta como texto', blanco.ok && blanco.valor.rangos !== null, j(blanco))
    if (g.ok) {
      const conPos = ubicarErrorGuiado({ motivo: 'servidor', campo: 'filtro', mensaje: 'x', posicion: 5 }, g.valor)
      check('error del trabajador en el filtro guiado: condición 0 y sin posición', conPos.condicion === 0 && conPos.posicion === undefined, j(conPos))
      const ord = ubicarErrorGuiado({ motivo: 'servidor', campo: 'orden', mensaje: 'x', posicion: 3 }, g.valor)
      check('… en el orden de la cabecera: sin posición', ord.posicion === undefined && ord.campo === 'orden', j(ord))
    }
    if (texto.ok) {
      const e = { motivo: 'servidor' as const, campo: 'filtro' as const, mensaje: 'x', posicion: 5 }
      check('en modo texto, el error queda como estaba (posición en la barra)', ubicarErrorGuiado(e, texto.valor) === e, '')
    }
  }

  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
