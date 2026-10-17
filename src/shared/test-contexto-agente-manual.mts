// =============================================================================
// Pruebas de `contextoAgenteManual.ts`: la validación de la fuente, los campos con puntos y
// corchetes, la lectura de un JSON entero o de un JSON Lines y el porcentaje; y que la
// definición del agente la guarda y la copia en JSON.
// Uso: node src/shared/test-contexto-agente-manual.mts
// =============================================================================

import { leerContexto, validarFuenteContexto, valorEnCampo } from './contextoAgenteManual.ts'
import { definicionComoJson, definicionDesdeJson, validarDefinicion } from './agentesManuales.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const fuente = { origen: 'comando', valor: 'lince stats --json', usado: 'context.used', maximo: 'context.max' }

function validacion(): void {
  hr('(1) La fuente')
  const sin = validarFuenteContexto(undefined)
  check('sin fuente: vale y no hay contexto', sin.ok && sin.valor === undefined, JSON.stringify(sin))
  const ok = validarFuenteContexto({ ...fuente, valor: '  lince stats --json  ' })
  check('comando con campos: vale y se recorta', ok.ok && ok.valor?.valor === 'lince stats --json', JSON.stringify(ok))
  const fijo = validarFuenteContexto({ ...fuente, maximo: '200000' })
  check('el máximo puede ser un número fijo', fijo.ok && fijo.valor?.maximo === '200000', JSON.stringify(fijo))
  const corchetes = validarFuenteContexto({ ...fuente, origen: 'archivo', valor: '~/.lince/uso.jsonl', usado: 'turnos[-1].tokens' })
  check('campos con índices (también negativos)', corchetes.ok, JSON.stringify(corchetes))
  const casos: Array<[string, unknown]> = [
    ['origen desconocido', { ...fuente, origen: 'url' }],
    ['sin comando', { ...fuente, valor: '' }],
    ['comando de varias líneas', { ...fuente, valor: 'a\nb' }],
    ['lo usado como número', { ...fuente, usado: '5' }],
    ['campo con espacios', { ...fuente, usado: 'context used' }],
    ['campo con punto suelto', { ...fuente, usado: 'context..used' }],
    ['sin máximo', { ...fuente, maximo: '' }],
    ['no es un objeto', 'lince']
  ]
  for (const [nombre, raw] of casos) {
    const r = validarFuenteContexto(raw)
    check(`no vale: ${nombre}`, !r.ok, JSON.stringify(r))
  }
}

function campos(): void {
  hr('(2) Campos con puntos y corchetes')
  const dato = { a: { b: [{ c: 1 }, { c: 2 }] }, 'x-y': 3 }
  check('a.b[0].c', valorEnCampo(dato, 'a.b[0].c') === 1, String(valorEnCampo(dato, 'a.b[0].c')))
  check('a.b[-1].c es el último', valorEnCampo(dato, 'a.b[-1].c') === 2, String(valorEnCampo(dato, 'a.b[-1].c')))
  check('a.b.1.c: un índice también con punto', valorEnCampo(dato, 'a.b.1.c') === 2, String(valorEnCampo(dato, 'a.b.1.c')))
  check('nombres con guiones', valorEnCampo(dato, 'x-y') === 3, String(valorEnCampo(dato, 'x-y')))
  check('un camino que no existe: undefined', valorEnCampo(dato, 'a.z.c') === undefined && valorEnCampo(null, 'a') === undefined, '')
  check('[0] sobre un objeto: undefined', valorEnCampo(dato, 'a[0]') === undefined, '')
}

function lectura(): void {
  hr('(3) Lectura y porcentaje')
  const json = leerContexto('{"context":{"used":50000,"max":200000}}', fuente)
  check('JSON entero: 25 %', json.ok && json.percent === 25 && json.usado === 50000 && json.maximo === 200000, JSON.stringify(json))
  const fijo = leerContexto('{"context":{"used":"1000"}}', { usado: 'context.used', maximo: '4000' })
  check('máximo fijo y número en texto', fijo.ok && fijo.percent === 25, JSON.stringify(fijo))
  const jsonl = ['{"tipo":"inicio"}', '{"context":{"used":10,"max":100}}', '{"context":{"used":30,"max":100}}', '{"tipo":"otro"}', ''].join('\n')
  const l = leerContexto(jsonl, fuente)
  check('JSON Lines: la línea más reciente que trae los campos', l.ok && l.percent === 30, JSON.stringify(l))
  const cortada = leerContexto('ed":1,"max":2}}\r\n{"context":{"used":5,"max":10}}\r\n', fuente)
  check('primera línea cortada por el tope y CRLF', cortada.ok && cortada.percent === 50, JSON.stringify(cortada))
  const pasado = leerContexto('{"context":{"used":300,"max":200}}', fuente)
  check('más de lo que cabe: 100 %, no más', pasado.ok && pasado.percent === 100, JSON.stringify(pasado))
  const cero = leerContexto('{"context":{"used":3,"max":0}}', fuente)
  check('máximo 0: error, no un porcentaje infinito', !cero.ok, JSON.stringify(cero))
  const nada = leerContexto('esto no es json', fuente)
  check('sin JSON: error que dice el campo', !nada.ok && nada.error.includes('context.used'), JSON.stringify(nada))
  const negativo = leerContexto('{"context":{"used":-5,"max":10}}', fuente)
  check('un negativo no es un dato', !negativo.ok, JSON.stringify(negativo))
}

function definicion(): void {
  hr('(4) La definición del agente la guarda y la copia')
  const def = { id: 'm-lince', nombre: 'Lince', comando: 'lince', contexto: fuente }
  const r = validarDefinicion(def, false)
  check('se guarda validada', r.ok && r.valor.contexto?.usado === 'context.used', JSON.stringify(r))
  const mala = validarDefinicion({ ...def, contexto: { ...fuente, usado: '' } }, false)
  check('una fuente mala tumba la definición con su error', !mala.ok && mala.error.includes('usado'), JSON.stringify(mala))
  const vuelta = r.ok ? definicionDesdeJson(definicionComoJson(r.valor), [], false) : null
  check('ida y vuelta por JSON', vuelta?.ok === true && JSON.stringify(vuelta.valor.contexto) === JSON.stringify(fuente), JSON.stringify(vuelta))
  const sin = validarDefinicion({ id: 'm-lince', nombre: 'Lince', comando: 'lince' }, false)
  check('sin contexto no aparece el campo', sin.ok && !('contexto' in sin.valor), JSON.stringify(sin))
}

validacion()
campos()
lectura()
definicion()
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
