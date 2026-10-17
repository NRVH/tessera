// =============================================================================
// Pruebas de `ordenAgentes.ts`: aplicar el orden guardado (lo que falta va detrás en su orden de
// siempre), soltar una pestaña sobre otra en las dos direcciones y mover un paso arriba o abajo,
// con sus extremos y los casos que no cambian nada.
// Uso: node src/renderer/src/features/agentes/test-orden-agentes.mts
// =============================================================================

import { aplicarOrden, moverUnPaso, soltarSobre } from './ordenAgentes.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}
const j = (x: unknown): string => JSON.stringify(x)
const id = (x: string): string => x

hr('(1) Aplicar el orden guardado')
const base = ['claude-code', 'codex', 'm-eco', 'm-orca']
check('sin orden: el de siempre (y una copia)', j(aplicarOrden(base, id, undefined)) === j(base) && aplicarOrden(base, id, undefined) !== base, '')
check('orden vacío: el de siempre', j(aplicarOrden(base, id, [])) === j(base), '')
check('los nombrados primero, en su orden', j(aplicarOrden(base, id, ['m-orca', 'codex'])) === j(['m-orca', 'codex', 'claude-code', 'm-eco']), j(aplicarOrden(base, id, ['m-orca', 'codex'])))
check('un id del orden que ya no existe no estorba', j(aplicarOrden(base, id, ['m-borrado', 'm-eco'])) === j(['m-eco', 'claude-code', 'codex', 'm-orca']), '')
check('un agente nuevo (no nombrado) va al final', j(aplicarOrden([...base, 'm-nuevo'], id, base)) === j([...base, 'm-nuevo']), '')
check('con objetos, por su id', j(aplicarOrden([{ k: 'a' }, { k: 'b' }], (x) => x.k, ['b']).map((x) => x.k)) === j(['b', 'a']), '')

hr('(2) Soltar sobre otra pestaña')
check('hacia la derecha: queda detrás del destino', j(soltarSobre(base, 'claude-code', 'm-eco')) === j(['codex', 'm-eco', 'claude-code', 'm-orca']), j(soltarSobre(base, 'claude-code', 'm-eco')))
check('hacia la izquierda: queda delante del destino', j(soltarSobre(base, 'm-orca', 'codex')) === j(['claude-code', 'm-orca', 'codex', 'm-eco']), j(soltarSobre(base, 'm-orca', 'codex')))
check('al último', j(soltarSobre(base, 'claude-code', 'm-orca')) === j(['codex', 'm-eco', 'm-orca', 'claude-code']), '')
check('al primero', j(soltarSobre(base, 'm-orca', 'claude-code')) === j(['m-orca', 'claude-code', 'codex', 'm-eco']), '')
check('NEGATIVO: sobre sí mismo no cambia nada', soltarSobre(base, 'codex', 'codex') === null, '')
check('NEGATIVO: uno que no está, tampoco', soltarSobre(base, 'm-x', 'codex') === null && soltarSobre(base, 'codex', 'm-x') === null, '')

hr('(3) Un paso arriba o abajo')
check('abajo', j(moverUnPaso(base, 'codex', 1)) === j(['claude-code', 'm-eco', 'codex', 'm-orca']), '')
check('arriba', j(moverUnPaso(base, 'codex', -1)) === j(['codex', 'claude-code', 'm-eco', 'm-orca']), '')
check('NEGATIVO: el primero no sube ni el último baja', moverUnPaso(base, 'claude-code', -1) === null && moverUnPaso(base, 'm-orca', 1) === null, '')
check('NEGATIVO: uno que no está', moverUnPaso(base, 'm-x', 1) === null, '')
check('no toca la lista de entrada', j(base) === j(['claude-code', 'codex', 'm-eco', 'm-orca']), j(base))

const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
