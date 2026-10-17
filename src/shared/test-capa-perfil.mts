// =============================================================================
// Pruebas de `capaPerfil.ts`: qué agentes entran en la capa, el nombre de la imagen, el sello
// (cambia con la base y con las órdenes, no con lo demás), el guion y el Dockerfile, y la
// comprobación de programas con nombres que una shell interpretaría.
// Uso: node src/shared/test-capa-perfil.mts
// =============================================================================

import {
  dockerfileCapa,
  guionInstalacion,
  instalacionesDe,
  nombreImagenCapa,
  ordenComprobarProgramas,
  PREFIJO_IMAGEN_CAPA,
  programasQueFaltan,
  selloCapa
} from './capaPerfil.ts'
import type { DefinicionAgente } from './agentesManuales.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const lince: DefinicionAgente = { id: 'm-lince', nombre: 'Lince', comando: 'lince --rapido', instalacion: 'npm i -g lince-cli' }
const sinInstalar: DefinicionAgente = { id: 'm-otro', nombre: 'Otro', comando: 'otro' }

hr('(1) Qué entra en la capa y cómo se llama')
const inst = instalacionesDe([lince, sinInstalar])
check('solo los que tienen órdenes, con su programa', inst.length === 1 && inst[0].programa === 'lince', JSON.stringify(inst))
const nombre = nombreImagenCapa('Perfil de Trabajo/1')
check('nombre de imagen válido para Docker', nombre.startsWith(PREFIJO_IMAGEN_CAPA) && /^[a-z0-9-]+$/.test(nombre), nombre)
check('estable para el mismo perfil y distinto para otro', nombreImagenCapa('a') === nombreImagenCapa('a') && nombreImagenCapa('a') !== nombreImagenCapa('b'), '')

hr('(2) El sello')
const s1 = selloCapa('sha256:base1', inst)
check('igual base y órdenes: igual sello', s1 === selloCapa('sha256:base1', instalacionesDe([lince, sinInstalar])), s1)
check('otra base (Actualizar agentes): otro sello', s1 !== selloCapa('sha256:base2', inst), '')
check('otra orden: otro sello', s1 !== selloCapa('sha256:base1', instalacionesDe([{ ...lince, instalacion: 'npm i -g lince-cli@2' }])), '')
check('NEGATIVO: cambiar solo el nombre no rehace la capa', s1 === selloCapa('sha256:base1', instalacionesDe([{ ...lince, nombre: 'Lince 2' }])), '')

hr('(3) Guion y Dockerfile')
const guion = guionInstalacion(inst)
check('el guion corta en el primer fallo y lleva las órdenes tal cual', guion.includes('set -euo pipefail') && guion.includes('npm i -g lince-cli'), guion)
const df = dockerfileCapa('tessera-sandbox-base:u1000', 'abc', 'agente')
check('Dockerfile: base, root para instalar y de vuelta al usuario',
  df.startsWith('FROM tessera-sandbox-base:u1000\nUSER root') && df.trimEnd().endsWith('USER agente') && df.includes('tessera.capa.sello="abc"'), df)

hr('(4) Comprobar los programas')
const orden = ordenComprobarProgramas(['lince', `x'; rm -rf / #`])
check('cada programa va citado', orden.includes(`command -v 'lince'`) && orden.includes(`'x'\\''; rm -rf / #'`), orden)
check('se lee lo que falta', JSON.stringify(programasQueFaltan('ruido\nTESSERA_FALTA:lince\r\nTESSERA_FALTA:otro\n')) === '["lince","otro"]', '')
check('sin marcas: no falta nada', programasQueFaltan('/usr/local/bin/lince\n').length === 0, '')

const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
