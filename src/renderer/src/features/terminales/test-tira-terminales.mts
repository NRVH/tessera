#!/usr/bin/env node
// =============================================================================
// Prueba del orden de la tira de terminales (npm run test:tira-terminales): locales y SSH intercaladas por
// proyecto, lo nuevo al final, mover sin elegir ni reconectar, la vecina en la tira al cerrar (sin conectar sola
// una SSH restaurada), la lista del perfil cuando no hay proyecto, la poda y las marcas que sobreviven al reinicio.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { addTerminal, ensureProject, selectTerminal, type ShellTerminalsState } from './shellTerminalsModel.ts'
import { abrirSsh, contextoSsh, initialSshTabsState, restaurarSsh, sshDePerfil, reordenarSsh, type SshTabsState } from './sshTabsModel.ts'
import {
  abrirSshEnTira,
  cerrarLocalEnTira,
  cerrarSshEnTira,
  claveLocal,
  claveSsh,
  clavesDeContexto,
  marcasDeOrden,
  moverEnTira,
  ordenDesdeMarcas,
  ordenVisible,
  podarOrden,
  type EstadoTira
} from './tiraTerminalesModel.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence = ''): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence ? ` -> ${evidence}` : ''}`)
}

const PERFIL = 'alfa'
const A = `${PERFIL}|/obra/tienda`
const B = `${PERFIL}|/obra/pagos`
const SIN = contextoSsh(PERFIL, null)

/** Dos proyectos con dos locales cada uno y dos SSH del perfil; se mira la primera local. */
function base(): EstadoTira {
  let shell: ShellTerminalsState = {}
  for (const k of [A, B]) {
    shell = addTerminal(ensureProject(shell, k), k)
    shell = selectTerminal(shell, k, 't1')
  }
  let ssh: SshTabsState = initialSshTabsState
  ssh = abrirSsh(ssh, SIN, PERFIL, 'c-web', 'web')
  ssh = abrirSsh(ssh, SIN, PERFIL, 'c-bd', 'bd')
  ssh = { ...ssh, activaPorContexto: {} }
  return { shellTerminals: shell, ssh, orden: {} }
}

const tira = (e: EstadoTira, c: string): string => clavesDeContexto(e, c).join(' ')

function main(): void {
  hr('(1) El orden que se ve')
  const e0 = base()
  check('sin acomodar: primero las SSH y luego las locales', tira(e0, A) === 's:s1 s:s2 l:t1 l:t2', tira(e0, A))
  check('lo guardado que ya no existe se ignora y lo que falta va detrás', ordenVisible(['l:t9', 'l:t2', 's:s2'], [{ id: 's1' }, { id: 's2' }], [{ id: 't1' }, { id: 't2' }]).join(' ') === 'l:t2 s:s2 s:s1 l:t1')

  hr('(2) Mover')
  const e1 = moverEnTira(e0, A, claveLocal('t1'), claveSsh('s1'))
  check('una local puede quedar antes que una SSH', tira(e1, A) === 'l:t1 s:s1 s:s2 l:t2', tira(e1, A))
  check('los demás proyectos no se mueven', tira(e1, B) === 's:s1 s:s2 l:t1 l:t2', tira(e1, B))
  const e2 = moverEnTira(e1, A, claveSsh('s1'), null)
  check('antesDe null: al final', tira(e2, A) === 'l:t1 s:s2 l:t2 s:s1', tira(e2, A))
  check('mover no elige la pestaña', e2.ssh.activaPorContexto[A] === undefined && e2.shellTerminals[A].activeId === 't1')
  check('mover no toca las listas', e2.shellTerminals === e0.shellTerminals && e2.ssh === e0.ssh)
  check('sin cambio: el MISMO estado', moverEnTira(e1, A, claveLocal('t1'), claveSsh('s1')) === e1)
  check('clave desconocida: el MISMO estado', moverEnTira(e1, A, 'l:t9', null) === e1)
  check('destino desconocido: el MISMO estado', moverEnTira(e1, A, claveLocal('t1'), 'l:t9') === e1)

  hr('(3) Sin proyecto el orden es la lista del perfil')
  const e3 = moverEnTira(e0, SIN, claveSsh('s2'), claveSsh('s1'))
  check('reordena la lista', sshDePerfil(e3.ssh, PERFIL).map((t) => t.id).join(' ') === 's2 s1')
  check('y no guarda orden por contexto', e3.orden[SIN] === undefined)
  check('reordenarSsh exige exactamente sus ids', reordenarSsh(e0.ssh, PERFIL, ['s1']) === e0.ssh && reordenarSsh(e0.ssh, PERFIL, ['s1', 's1']) === e0.ssh && reordenarSsh(e0.ssh, PERFIL, ['s1', 's9']) === e0.ssh)

  hr('(4) Lo nuevo entra al final')
  const e4 = abrirSshEnTira(e0, A, PERFIL, 'c-nas', 'nas')
  check('una SSH nueva, tras las locales del proyecto en que se abrió', tira(e4, A) === 's:s1 s:s2 l:t1 l:t2 s:s3', tira(e4, A))
  check('y queda a la vista', e4.ssh.activaPorContexto[A] === 's3')
  check('en un proyecto sin acomodar sigue entre las SSH', tira(e4, B) === 's:s1 s:s2 s:s3 l:t1 l:t2', tira(e4, B))
  const e5 = abrirSshEnTira(e1, B, PERFIL, 'c-nas', 'nas')
  check('en uno acomodado, detrás de todo', tira(e5, A) === 'l:t1 s:s1 s:s2 l:t2 s:s3', tira(e5, A))
  const e6 = { ...e1, shellTerminals: addTerminal(e1.shellTerminals, A) }
  check('una local nueva, al final', tira(e6, A) === 'l:t1 s:s1 s:s2 l:t2 l:t3', tira(e6, A))

  hr('(5) Al cerrar se pasa a la vecina de la tira')
  const c1 = cerrarLocalEnTira(e1, A, 't1')
  check('cerrar la primera local: pasa a la SSH de su derecha', c1.ssh.activaPorContexto[A] === 's1', c1.ssh.activaPorContexto[A])
  const v = moverEnTira(e0, A, claveLocal('t2'), claveSsh('s2'))
  const v2 = cerrarLocalEnTira({ ...v, shellTerminals: selectTerminal(v.shellTerminals, A, 't1') }, A, 't1')
  check('la última de la tira: pasa a la de su izquierda', v2.ssh.activaPorContexto[A] === 's2', tira(v, A))
  const s1 = moverEnTira(e0, A, claveLocal('t2'), claveSsh('s2'))
  const conSsh = { ...s1, ssh: { ...s1.ssh, activaPorContexto: { [A]: 's1' } } }
  const s2 = cerrarSshEnTira(conSsh, PERFIL, 's1')
  check('cerrar una SSH: pasa a la local de su derecha', s2.ssh.activaPorContexto[A] === undefined && s2.shellTerminals[A].activeId === 't2', JSON.stringify(s2.ssh.activaPorContexto))
  const noVista = cerrarLocalEnTira(e1, A, 't2')
  check('cerrar una que no se veía no cambia cuál se ve', noVista.ssh.activaPorContexto[A] === undefined && noVista.shellTerminals[A].activeId === 't1')

  const restaurado: EstadoTira = {
    shellTerminals: e0.shellTerminals,
    ssh: restaurarSsh(initialSshTabsState, { [PERFIL]: [{ conexionId: 'c-web', alias: 'web' }] }),
    orden: { [A]: [claveLocal('t1'), claveSsh('s1'), claveLocal('t2')] }
  }
  const r1 = cerrarLocalEnTira(restaurado, A, 't1')
  check('una SSH restaurada se salta: no se conecta sola', r1.ssh.activaPorContexto[A] === undefined && r1.shellTerminals[A].activeId === 't2', JSON.stringify(r1.ssh.activaPorContexto))
  check('y sigue marcada como restaurada', sshDePerfil(r1.ssh, PERFIL)[0].restaurada === true)

  const unaLocal: ShellTerminalsState = ensureProject({}, A)
  const conAbierta: EstadoTira = { shellTerminals: unaLocal, ssh: { ...abrirSsh(restaurado.ssh, SIN, PERFIL, 'c-bd', 'bd'), activaPorContexto: {} }, orden: {} }
  const r2 = cerrarLocalEnTira(conAbierta, A, 't1')
  check('cerrar la última local con otra SSH abierta: pasa a esa', r2.ssh.activaPorContexto[A] === 's2', JSON.stringify(r2.ssh.activaPorContexto))
  check('sin quitarle la marca a la restaurada que se saltó', sshDePerfil(r2.ssh, PERFIL)[0].restaurada === true)
  const soloRestaurada: EstadoTira = { shellTerminals: unaLocal, ssh: restaurado.ssh, orden: {} }
  check('si solo queda una restaurada, se elige: el panel no se queda vacío', cerrarLocalEnTira(soloRestaurada, A, 't1').ssh.activaPorContexto[A] === 's1')

  hr('(6) Poda')
  check('olvida el orden de los proyectos cerrados', Object.keys(podarOrden({ [A]: ['l:t1'], [B]: ['l:t1'] }, [A])).join() === A)
  const o = { [A]: ['l:t1'] }
  check('sin nada que podar: el MISMO objeto', podarOrden(o, [A, B]) === o)

  hr('(7) Las marcas sobreviven al reinicio, aunque cambien los ids')
  let antes = base().ssh
  antes = abrirSsh(antes, SIN, PERFIL, 'c-web', 'web')
  antes = abrirSsh(antes, SIN, PERFIL, 'c-web', 'web', true)
  const ssh = sshDePerfil(antes, PERFIL)
  const locales = base().shellTerminals[A].list
  const guardado = [claveLocal('t2'), claveSsh('s3'), claveSsh('s4'), claveSsh('s1'), claveLocal('t1'), claveSsh('s2')]
  const marcas = marcasDeOrden(guardado, ssh, locales) as string[]
  check('sin orden propio no se guarda nada', marcasDeOrden(undefined, ssh, locales) === undefined)
  check('dos pestañas de una conexión no se confunden', new Set(marcas).size === marcas.length, marcas.join(' '))
  check('ni la SSH con el explorador de la misma conexión', marcas[1] !== marcas[2] && marcas[2].startsWith('s:f:'), marcas[2])
  const guardadas = ssh.map((t) => ({ conexionId: t.conexionId, alias: t.aliasConocido, ...(t.sftp ? { sftp: true as const } : {}) }))
  const conDesfase: SshTabsState = { ...initialSshTabsState, porPerfil: { [PERFIL]: { lista: [], siguiente: 41 } } }
  const nuevas = sshDePerfil(restaurarSsh(conDesfase, { [PERFIL]: guardadas }), PERFIL)
  check('los ids de esta sesión son otros', nuevas[0].id === 's41')
  const vuelta = ordenDesdeMarcas(marcas, nuevas, locales)
  check('el orden vuelve con los ids nuevos', vuelta.join(' ') === 'l:t2 s:s43 s:s44 s:s41 l:t1 s:s42', vuelta.join(' '))
  check('lo que ya no existe se descarta', ordenDesdeMarcas(['s:t:c-borrada:0', 'l:7', 'l:0'], nuevas, locales).join(' ') === 'l:t1')

  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
