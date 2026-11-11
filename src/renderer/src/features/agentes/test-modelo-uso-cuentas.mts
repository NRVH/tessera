#!/usr/bin/env node
// =============================================================================
// Prueba del modelo de «Uso de las cuentas» (npm run test:uso-cuentas).
// Cubre los grupos sin las cuentas a la vista, el filtro, las ventanas del resumen, qué fijadas se enseñan en la barra
// y el máximo de fijadas. Se ejecuta con node sin React, DOM ni canales de lectura de cuentas.
// =============================================================================
import { alternarFijada, construirGrupos, estaALaVista, fijadasEnBarra, fijadasVigentes, filtrarGrupos, mismaCuenta, nombreCorto, peorVentana, sinHueco, ventanasCuenta, type CuentaUso } from './modeloUsoCuentas.ts'
import type { UsageSnapshot } from '../../../../shared/usage-ipc.ts'

function hr(titulo: string): void { console.log('\n' + '='.repeat(78) + '\n' + titulo + '\n' + '='.repeat(78)) }
const resultados: boolean[] = []
function check(nombre: string, pasa: boolean, evidencia: unknown): void {
  resultados.push(pasa)
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre} -> ${JSON.stringify(evidencia)}`)
}
const ids = (grupos: ReturnType<typeof construirGrupos>): string => grupos.map((g) => `${g.agente}:${g.filas.map((f) => f.accountId ?? 'nativa').join(',')}`).join(' ')
const snap: UsageSnapshot = { agente: 'codex', fetchedAt: 1, windows: [{ key: 'a', label: '5h', percent: 24 }, { key: 'b', label: '7d', percent: 52 }, { key: 'c', label: 'Fable 7d', percent: 99 }] }
const codexNativa: CuentaUso = { agente: 'codex', accountId: null, cuenta: null, snap }
const lince: CuentaUso = { agente: 'codex', accountId: 'lince', cuenta: { id: 'lince', nombre: 'Lince', agente: 'codex', profileId: 'casa', conSesion: true }, snap: null }
const nutria: CuentaUso = { ...lince, accountId: 'nutria', cuenta: { ...lince.cuenta!, id: 'nutria', nombre: 'Nutria', conSesion: false } }
const garza: CuentaUso = { agente: 'claude-code', accountId: 'garza', cuenta: { id: 'garza', nombre: 'Garza', agente: 'claude-code', profileId: 'cuentas--globales', global: true, conSesion: true }, snap }
const claudeNativa: CuentaUso = { agente: 'claude-code', accountId: null, cuenta: null, snap }
const todas = [lince, codexNativa, nutria, garza, claudeNativa]

hr('Grupos: todas las cuentas del perfil, sin las que están a la vista')
check('los dos agentes, Claude Code primero; nativa primero aunque llegue después', ids(construirGrupos(todas, [])) === 'claude-code:nativa,garza codex:nativa,lince,nutria', ids(construirGrupos(todas, [])))
check('la nativa a la vista no se lista; la de Docker del mismo agente sí', ids(construirGrupos(todas, [claudeNativa])) === 'claude-code:garza codex:nativa,lince,nutria', ids(construirGrupos(todas, [claudeNativa])))
check('una de Docker a la vista no se lista', ids(construirGrupos(todas, [lince])) === 'claude-code:nativa,garza codex:nativa,nutria', ids(construirGrupos(todas, [lince])))
check('mosaico: las de todos los paneles a la vista fuera', ids(construirGrupos(todas, [claudeNativa, lince])) === 'claude-code:garza codex:nativa,nutria', ids(construirGrupos(todas, [claudeNativa, lince])))
check('un agente sin filas no deja grupo vacío', ids(construirGrupos(todas, [claudeNativa, garza])) === 'codex:nativa,lince,nutria', ids(construirGrupos(todas, [claudeNativa, garza])))
check('todas a la vista: sin grupos', construirGrupos([claudeNativa], [claudeNativa]).length === 0, [])
check('nativa sin ventanas no aparece', ids(construirGrupos([{ ...codexNativa, snap: null }], [])) === '', [])
check('nativa con lista vacía no aparece', ids(construirGrupos([{ ...codexNativa, snap: { ...snap, windows: [] } }], [])) === '', [])
check('nativa fijada sin ventanas sigue en la lista para poder quitarla', ids(construirGrupos([{ ...codexNativa, snap: null }], [], [codexNativa])) === 'codex:nativa', [])
check('una fijada a la vista sí se lista, para poder quitarla', ids(construirGrupos(todas, [claudeNativa, lince], [lince])) === 'claude-code:garza codex:nativa,lince,nutria', ids(construirGrupos(todas, [claudeNativa, lince], [lince])))
check('Docker sin sesión y sin ventanas aparece', ids(construirGrupos([nutria], [])) === 'codex:nutria', [])
check('mismo id de otro agente no es la misma cuenta', !mismaCuenta(lince, { ...lince, agente: 'claude-code' }) && !estaALaVista(lince, [{ agente: 'claude-code', accountId: 'lince' }]), lince)
check('identidades ausentes no coinciden', !mismaCuenta(undefined, undefined), null)

hr('Filtro')
const grupos = construirGrupos(todas, [])
const nombre = (f: CuentaUso): string => f.cuenta?.nombre ?? 'En su equipo'
check('sin texto, todo', ids(filtrarGrupos(grupos, '  ', nombre)) === ids(grupos), [])
check('sin distinguir mayúsculas; los grupos sin filas fuera', ids(filtrarGrupos(grupos, 'GAR', nombre)) === 'claude-code:garza', ids(filtrarGrupos(grupos, 'GAR', nombre)))
check('ninguna coincide: vacío', filtrarGrupos(grupos, 'zorro', nombre).length === 0, [])

hr('Ventanas y nombres')
check('selecciona solo 5h y 7d', ventanasCuenta(snap).map((v) => v?.percent).join() === '24,52', ventanasCuenta(snap))
check('ventana ausente queda vacía', ventanasCuenta({ ...snap, windows: [snap.windows[1]] })[0] === undefined, ventanasCuenta(null))
const otroPlan = { ...snap, windows: [{ key: 'a', label: '1d', percent: 10 }, { key: 'b', label: '30d', percent: 40 }, { key: 'c', label: 'Fable 7d', percent: 99 }] }
check('otras duraciones del plan también se resumen', ventanasCuenta(otroPlan).map((v) => v?.label).join() === '1d,30d', ventanasCuenta(otroPlan))
const mixto = { ...snap, windows: [{ key: 'a', label: '30d', percent: 10 }, { key: 'b', label: '7d', percent: 40 }] }
check('una general distinta ocupa solo la columna libre', ventanasCuenta(mixto).map((v) => v?.label).join() === '30d,7d', ventanasCuenta(mixto))
check('peor ignora modelos', peorVentana(snap) === 1, peorVentana(snap))
check('empate conserva la primera', peorVentana({ ...snap, windows: [{ ...snap.windows[0], percent: 52 }, snap.windows[1]] }) === 0, 0)
check('sin ventanas elige una celda', peorVentana(null) === 0, peorVentana(null))
check('Claude y Codex cortos', nombreCorto('claude-code') === 'Claude' && nombreCorto('codex') === 'Codex', nombreCorto('claude-code'))

hr('Fijadas en la barra')
const metadatos = [lince.cuenta!, nutria.cuenta!, garza.cuenta!]
check('nativa y Docker con sesión, en su orden', JSON.stringify(fijadasEnBarra([garza, codexNativa], [], metadatos)) === JSON.stringify([garza, codexNativa]), fijadasEnBarra([garza, codexNativa], [], metadatos))
check('la que está a la vista en un panel no se repite; la elección se conserva', fijadasEnBarra([garza, codexNativa], [codexNativa], metadatos).length === 1, fijadasEnBarra([garza, codexNativa], [codexNativa], metadatos))
check('Docker sin sesión no se enseña', fijadasEnBarra([nutria], [], metadatos).length === 0, [])
check('Docker borrada no se enseña', fijadasEnBarra([lince], [], []).length === 0, [])
check('sesión desconocida no equivale a sesión cerrada', fijadasEnBarra([lince], [], [{ ...lince.cuenta!, conSesion: undefined }]).length === 1, [])
check('la cuenta tiene que ser de su agente', fijadasEnBarra([{ agente: 'claude-code', accountId: 'lince' }], [], metadatos).length === 0, [])

hr('Fijar y quitar')
const una = alternarFijada([], lince)
check('fijar solo guarda la identidad', JSON.stringify(una) === '[{"agente":"codex","accountId":"lince"}]', una)
const dos = alternarFijada(una, codexNativa)
check('la segunda va detrás', JSON.stringify(dos) === '[{"agente":"codex","accountId":"lince"},{"agente":"codex","accountId":null}]', dos)
check('con dos no hay hueco y una tercera no entra', sinHueco(dos) && alternarFijada(dos, garza).length === 2 && !alternarFijada(dos, garza).some((c) => mismaCuenta(c, garza)), alternarFijada(dos, garza))
check('pulsar una fijada la quita, también con el máximo', JSON.stringify(alternarFijada(dos, lince)) === '[{"agente":"codex","accountId":null}]', alternarFijada(dos, lince))
check('quitar la última deja la lista vacía', alternarFijada(una, lince).length === 0 && !sinHueco([]), [])
const fantasma = { agente: 'claude-code' as const, accountId: 'borrada' }
const conFantasma = [fantasma, codexNativa]
const leidos = new Set(['claude-code', 'codex'] as const)
const vigentes = fijadasVigentes(conFantasma, todas, leidos)
check('una de Docker que ya no está en su lista leída no es vigente', JSON.stringify(vigentes) === JSON.stringify([codexNativa]), vigentes)
check('sin la lista de su agente leída, se conserva: no se sabe si existe', fijadasVigentes(conFantasma, todas, new Set(['codex'] as const)).length === 2, [])
check('la borrada no ocupa hueco', sinHueco(conFantasma) && !sinHueco(vigentes), [])
const tras = alternarFijada(conFantasma, garza, vigentes)
check('al fijar otra, la borrada sale de lo guardado y entra la nueva', JSON.stringify(tras) === JSON.stringify([{ agente: 'codex', accountId: null }, { agente: 'claude-code', accountId: 'garza' }]), tras)
check('quitar con una borrada guardada no toca las demás', JSON.stringify(alternarFijada(conFantasma, codexNativa, vigentes)) === JSON.stringify([fantasma]), alternarFijada(conFantasma, codexNativa, vigentes))
console.log(`\nVEREDICTO: ${resultados.filter(Boolean).length}/${resultados.length} PASS`)
process.exit(resultados.every(Boolean) ? 0 : 1)
