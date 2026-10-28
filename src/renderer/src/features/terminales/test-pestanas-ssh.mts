#!/usr/bin/env node
// =============================================================================
// Prueba de las pestañas SSH de las terminales (npm run test:pestanas-ssh): el modelo por perfil y
// por contexto (abrir, cerrar con su sucesora, elegir, soltar, renombrar, podar por perfil y por
// contexto, el alias que sigue a la conexión y los nombres con « (n)»), qué terminal se ve
// (`derivarActivo`: la SSH elegida, si no la local, si no la primera SSH, si nada ninguna) y qué
// se dice al terminar una sesión (`motivoFinSsh`) y qué conexión marca la lista (`conexionDelPane`),
// con sus mitades negativas.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import {
  conexionDelPane,
  derivarActivo,
  derivarPaneActivo,
  hayTerminalQueEnsenar,
  motivoConexionEliminada,
  type EntradaActivo
} from './activoTerminales.ts'
import { bannerFinSsh, motivoFinSsh } from './finSesionSsh.ts'
import { hayTextoVisible } from './textoSesionSsh.ts'
import { addTerminal, ensureProject, terminalProjectKey, type ShellTerminalsState } from './shellTerminalsModel.ts'
import { cerrarLocal } from './cierreLocal.ts'
import {
  abiertasPorConexion,
  abrirSsh,
  actualizarAliasSsh,
  cerrarSsh,
  contextoSsh,
  contextosVivosSsh,
  elegirSsh,
  initialSshTabsState,
  nombreSsh,
  perfilDeContexto,
  pestanasAGuardar,
  podarContextosSsh,
  podarSsh,
  renombrarSsh,
  restaurarSsh,
  soltarSsh,
  sshDePerfil,
  sshPaneKey,
  SIN_PESTANAS_SSH,
  type SshTabsState
} from './sshTabsModel.ts'
import type { TerminalPaneInfo, TerminalProjectTarget } from './terminalPaneTipos.ts'
import type { TerminalExitReason } from '../../../../shared/terminal-ipc.ts'
import { normalizarPestanasSshPorPerfil, SSH_PESTANAS_MAX } from '../../../../shared/ajustesTerminal.ts'

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

const CTX_A = contextoSsh('alfa', 'C:\\proj\\A')
const CTX_B = contextoSsh('alfa', 'C:\\proj\\B')
const CTX_SIN = contextoSsh('alfa', null)
const ids = (s: SshTabsState, perfil = 'alfa'): string => sshDePerfil(s, perfil).map((t) => t.id).join(',')

/** Abre `n` pestañas del perfil alfa (conexiones c1, c2, c3…) en el contexto A. */
function conTres(): SshTabsState {
  let s = initialSshTabsState
  s = abrirSsh(s, CTX_A, 'alfa', 'c1', 'Router')
  s = abrirSsh(s, CTX_A, 'alfa', 'c2', 'Base')
  s = abrirSsh(s, CTX_A, 'alfa', 'c3', 'Nube')
  return s
}

hr('(1) Los contextos y las claves: del perfil, no del proyecto')
{
  check('contexto con proyecto: perfil|ruta; sin proyecto: perfil|', CTX_A === 'alfa|C:\\proj\\A' && CTX_SIN === 'alfa|', `${CTX_A} · ${CTX_SIN}`)
  check('el perfil de un contexto es lo anterior al primer |', perfilDeContexto(CTX_A) === 'alfa' && perfilDeContexto(CTX_SIN) === 'alfa' && perfilDeContexto('sin-barra') === 'sin-barra', 'alfa · alfa')
  check('la clave del pane es ssh|perfil|sN y NO lleva el modo del proyecto', sshPaneKey('alfa', 's3') === 'ssh|alfa|s3' && !sshPaneKey('alfa', 's3').includes('host'), sshPaneKey('alfa', 's3'))
}

hr('(2) Abrir: al final de la lista del perfil, elegida en ese contexto, con id que nunca se reutiliza')
{
  const s = conTres()
  check('tres pestañas s1,s2,s3 en orden de creación', ids(s) === 's1,s2,s3', ids(s))
  check('la última abierta queda elegida en el contexto donde se abrió', s.activaPorContexto[CTX_A] === 's3', j(s.activaPorContexto))
  check('otro contexto del perfil NO la tiene elegida (cada proyecto mira lo suyo)', !(CTX_B in s.activaPorContexto) && !(CTX_SIN in s.activaPorContexto), j(Object.keys(s.activaPorContexto)))
  check('las pestañas son del perfil: se ven desde cualquier contexto del perfil', sshDePerfil(s, 'alfa').length === 3 && sshDePerfil(s, 'beta') === SIN_PESTANAS_SSH, 'alfa 3 · beta ninguna (constante)')
  const sinProyecto = abrirSsh(initialSshTabsState, CTX_SIN, 'alfa', 'c1', 'Router')
  check('se puede abrir sin ningún proyecto', ids(sinProyecto) === 's1' && sinProyecto.activaPorContexto[CTX_SIN] === 's1', j(sinProyecto.activaPorContexto))
  const cerrada = cerrarSsh(s, 'alfa', 's3')
  const otra = abrirSsh(cerrada, CTX_A, 'alfa', 'c9', 'Otra')
  check('el id no se reutiliza al cerrar: tras cerrar s3 la siguiente es s4', ids(otra) === 's1,s2,s4', ids(otra))
  const alias = abrirSsh(initialSshTabsState, CTX_A, 'alfa', 'c1', '  ')
  check('un alias en blanco (conexión aún sin cargar) se rotula «SSH»', sshDePerfil(alias, 'alfa')[0].aliasConocido === 'SSH', sshDePerfil(alias, 'alfa')[0].aliasConocido)
}

hr('(3) El nombre: el alias, con « (n)» si la conexión se repite; y el hueco más bajo se recicla')
{
  let s = abrirSsh(initialSshTabsState, CTX_A, 'alfa', 'c1', 'Router')
  s = abrirSsh(s, CTX_A, 'alfa', 'c1', 'Router')
  s = abrirSsh(s, CTX_A, 'alfa', 'c1', 'Router')
  const nombres = (): string => sshDePerfil(s, 'alfa').map(nombreSsh).join(' | ')
  check('la primera es «Router»; la 2.ª, «Router (2)»; la 3.ª, «Router (3)»', nombres() === 'Router | Router (2) | Router (3)', nombres())
  s = cerrarSsh(s, 'alfa', 's2')
  check('cerrar la del medio NO renombra a las demás (cada una conserva su número)', nombres() === 'Router | Router (3)', nombres())
  s = abrirSsh(s, CTX_A, 'alfa', 'c1', 'Router')
  check('la nueva ocupa el hueco libre más bajo: «Router (2)»', nombres() === 'Router | Router (3) | Router (2)', nombres())
  const otra = abrirSsh(s, CTX_A, 'alfa', 'c2', 'Base')
  check('otra conexión no se numera: «Base» a secas', nombreSsh(sshDePerfil(otra, 'alfa')[3]) === 'Base', nombreSsh(sshDePerfil(otra, 'alfa')[3]))
}

hr('(4) Cerrar: la sucesora es la derecha, si no la izquierda, si no la local; en cada contexto que la tenía')
{
  const s = conTres()
  const conElegida = (ctx: string, id: string): SshTabsState => elegirSsh(s, 'alfa', ctx, id)
  check('cerrar la elegida del medio pasa a la de la DERECHA', conElegida(CTX_A, 's2').activaPorContexto[CTX_A] === 's2' && cerrarSsh(conElegida(CTX_A, 's2'), 'alfa', 's2').activaPorContexto[CTX_A] === 's3', 's2 -> s3')
  check('cerrar la última (elegida) pasa a la de la IZQUIERDA', cerrarSsh(s, 'alfa', 's3').activaPorContexto[CTX_A] === 's2', 's3 -> s2')
  const unica = abrirSsh(initialSshTabsState, CTX_A, 'alfa', 'c1', 'Router')
  check('cerrar la única suelta la elección: se ve la local activa', !(CTX_A in cerrarSsh(unica, 'alfa', 's1').activaPorContexto) && ids(cerrarSsh(unica, 'alfa', 's1')) === '', j(cerrarSsh(unica, 'alfa', 's1').activaPorContexto))
  const dosContextos = elegirSsh(elegirSsh(s, 'alfa', CTX_B, 's2'), 'alfa', CTX_SIN, 's2')
  const tras = cerrarSsh(dosContextos, 'alfa', 's2')
  check('en TODOS los contextos que la tenían elegida: cada uno a su sucesora', tras.activaPorContexto[CTX_B] === 's3' && tras.activaPorContexto[CTX_SIN] === 's3' && tras.activaPorContexto[CTX_A] === 's3', j(tras.activaPorContexto))
  const noElegida = cerrarSsh(elegirSsh(s, 'alfa', CTX_B, 's1'), 'alfa', 's2')
  check('MITAD NEGATIVA: los contextos que miraban otra no cambian', noElegida.activaPorContexto[CTX_B] === 's1', j(noElegida.activaPorContexto))
  check('cerrar una que no existe no toca nada', cerrarSsh(s, 'alfa', 's99') === s && cerrarSsh(s, 'beta', 's1') === s, 'misma referencia')
  const ajeno = abrirSsh(abrirSsh(initialSshTabsState, contextoSsh('beta', null), 'beta', 'c1', 'Beta'), CTX_A, 'alfa', 'c1', 'Router')
  const trasAjeno = cerrarSsh(ajeno, 'alfa', 's1')
  check('MITAD NEGATIVA: el id s1 de OTRO perfil no se toca (los ids son por perfil)', ids(trasAjeno, 'beta') === 's1' && trasAjeno.activaPorContexto[contextoSsh('beta', null)] === 's1', j(trasAjeno.activaPorContexto))
}

hr('(5) Elegir, soltar y renombrar')
{
  const s = conTres()
  check('elegir una existente la deja elegida solo en ese contexto', elegirSsh(s, 'alfa', CTX_B, 's1').activaPorContexto[CTX_B] === 's1', 's1')
  check('elegir una que no existe, o la ya elegida, no cambia nada', elegirSsh(s, 'alfa', CTX_B, 's99') === s && elegirSsh(s, 'alfa', CTX_A, 's3') === s, 'misma referencia')
  check('soltar quita la elección del contexto (al elegir una terminal local)', !(CTX_A in soltarSsh(s, CTX_A).activaPorContexto) && soltarSsh(s, CTX_B) === s, 'sin entrada · sin cambios')
  const r = renombrarSsh(s, 'alfa', 's1', '  Casa  ')
  check('renombrar recorta y guarda el nombre a mano', sshDePerfil(r, 'alfa')[0].nombre === 'Casa' && nombreSsh(sshDePerfil(r, 'alfa')[0]) === 'Casa', nombreSsh(sshDePerfil(r, 'alfa')[0]))
  check('un nombre en blanco, o igual al automático, vuelve al automático', sshDePerfil(renombrarSsh(r, 'alfa', 's1', '   '), 'alfa')[0].nombre === undefined && sshDePerfil(renombrarSsh(r, 'alfa', 's1', 'Router'), 'alfa')[0].nombre === undefined, 'undefined')
  check('no cambiar nada devuelve el mismo estado', renombrarSsh(s, 'alfa', 's1', 'Router') === s && renombrarSsh(s, 'alfa', 's99', 'x') === s, 'misma referencia')
}

hr('(6) El alias sigue a la conexión, salvo renombrado a mano; una conexión eliminada conserva el último')
{
  let s = conTres()
  s = renombrarSsh(s, 'alfa', 's2', 'Mi base')
  const con = actualizarAliasSsh(s, new Map([['c1', 'Router casa'], ['c2', 'Base nueva']]))
  const nombres = sshDePerfil(con, 'alfa').map(nombreSsh).join(' | ')
  check('la sin renombrar sigue al alias nuevo; la renombrada a mano conserva su nombre', nombres === 'Router casa | Mi base | Nube', nombres)
  check('la renombrada guarda igualmente el alias nuevo debajo (para cuando se limpie el nombre)', sshDePerfil(con, 'alfa')[1].aliasConocido === 'Base nueva', sshDePerfil(con, 'alfa')[1].aliasConocido)
  check('una conexión que ya no está (c3) conserva el último alias que se supo', sshDePerfil(con, 'alfa')[2].aliasConocido === 'Nube', sshDePerfil(con, 'alfa')[2].aliasConocido)
  check('sin cambios devuelve el MISMO estado (se llama en cada recarga de conexiones)', actualizarAliasSsh(s, new Map([['c1', 'Router'], ['c2', 'Base']])) === s && actualizarAliasSsh(s, new Map()) === s, 'misma referencia')
}

hr('(7) Podar por perfiles vivos: la lista vacía es «ninguno» (si los perfiles ya cargaron lo decide quien llama)')
{
  let s = conTres()
  s = abrirSsh(s, contextoSsh('beta', null), 'beta', 'c1', 'Beta')
  const sinPerfiles = podarSsh(s, [])
  check('sin ningún perfil vivo (se cerró el último) se olvidan sus pestañas y sus elecciones', Object.keys(sinPerfiles.porPerfil).length === 0 && Object.keys(sinPerfiles.activaPorContexto).length === 0, j(sinPerfiles))
  check('con todos vivos, el mismo estado', podarSsh(s, ['alfa', 'beta']) === s, 'misma referencia')
  const p = podarSsh(s, ['alfa'])
  check('olvida las pestañas y las elecciones de un perfil que ya no existe', ids(p, 'beta') === '' && !(contextoSsh('beta', null) in p.activaPorContexto) && ids(p) === 's1,s2,s3', `${ids(p, 'beta')} · ${j(p.activaPorContexto)}`)
  check('MITAD NEGATIVA: cerrar un proyecto no toca las pestañas SSH (la poda es por perfil, no por proyecto)', podarSsh(s, ['alfa', 'beta']) === s && ids(s) === 's1,s2,s3', 'ids intactos')
}

hr('(7 bis) Podar por contextos vivos: un proyecto cerrado olvida cuál SSH se miraba, y las pestañas siguen')
{
  let s = conTres() // alfa: s1, s2, s3; en el proyecto A se mira s3
  s = elegirSsh(s, 'alfa', CTX_B, 's1')
  s = elegirSsh(s, 'alfa', CTX_SIN, 's2')
  s = abrirSsh(s, contextoSsh('beta', null), 'beta', 'c1', 'Beta')
  const CTX_BETA = contextoSsh('beta', null)
  const vivos = contextosVivosSsh([CTX_A], ['alfa', 'beta'])
  check('los contextos vivos son los proyectos abiertos y el «sin proyecto» de cada perfil vivo', j(vivos) === j([CTX_A, CTX_SIN, CTX_BETA]), j(vivos))
  check('sin proyectos ni perfiles no hay ninguno', contextosVivosSsh([], []).length === 0, '[]')
  const p = podarContextosSsh(s, vivos)
  check('el proyecto cerrado (B) olvida su elección; el abierto (A), el «sin proyecto» del perfil y el de otro perfil la conservan', !(CTX_B in p.activaPorContexto) && p.activaPorContexto[CTX_A] === 's3' && p.activaPorContexto[CTX_SIN] === 's2' && p.activaPorContexto[CTX_BETA] === 's1', j(p.activaPorContexto))
  check('MITAD NEGATIVA: no cierra ninguna pestaña (son del perfil): las listas de cada perfil, intactas', p.porPerfil === s.porPerfil && ids(p) === 's1,s2,s3' && ids(p, 'beta') === 's1', `${ids(p)} · ${ids(p, 'beta')}`)
  check('con todos los contextos vivos, el MISMO estado', podarContextosSsh(s, [CTX_A, CTX_B, CTX_SIN, CTX_BETA]) === s, 'misma referencia')
  const sinProyectos = podarContextosSsh(s, contextosVivosSsh([], ['alfa', 'beta']))
  const quedan = Object.keys(sinProyectos.activaPorContexto).sort()
  check('con todos los proyectos cerrados solo quedan los «sin proyecto» de los perfiles vivos: el mapa no crece con cada proyecto que pasó', j(quedan) === j([CTX_SIN, CTX_BETA].sort()), j(quedan))
  check('un perfil ya no vivo pierde también su «sin proyecto»', !(CTX_BETA in podarContextosSsh(s, contextosVivosSsh([CTX_A], ['alfa'])).activaPorContexto), 'sin beta|')
}

hr('(8) Cuántas pestañas tiene abierta cada conexión (lo que enseña la lista)')
{
  let s = abrirSsh(initialSshTabsState, CTX_A, 'alfa', 'c1', 'Router')
  s = abrirSsh(s, CTX_A, 'alfa', 'c1', 'Router')
  s = abrirSsh(s, CTX_A, 'alfa', 'c2', 'Base')
  check('c1 dos, c2 una, y las que no se abrieron no salen', j(abiertasPorConexion(sshDePerfil(s, 'alfa'))) === j({ c1: 2, c2: 1 }), j(abiertasPorConexion(sshDePerfil(s, 'alfa'))))
}

// --- Qué terminal se ve -----------------------------------------------------
const PROYECTO_A: TerminalProjectTarget = { profileId: 'alfa', projectHostPath: 'C:\\proj\\A', key: terminalProjectKey('alfa', 'C:\\proj\\A') }
const KEY_A = PROYECTO_A.key

function entrada(extra: Partial<EntradaActivo> = {}): EntradaActivo {
  const terminals: ShellTerminalsState = ensureProject({}, KEY_A)
  return {
    projects: [PROYECTO_A],
    activeProjectKey: KEY_A,
    terminals,
    perfilId: 'alfa',
    contexto: CTX_A,
    ssh: initialSshTabsState,
    infoByPane: {},
    hibernatedProjectKeys: new Set(),
    conexionesVivas: new Set(['c1', 'c2', 'c3']),
    ...extra
  }
}

hr('(9) Qué se ve: la SSH elegida, si no la local, si no la primera SSH, si nada ninguna')
{
  const s = conTres()
  const conElegida = { ...entrada({ ssh: elegirSsh(s, 'alfa', CTX_A, 's2') }) }
  const a = derivarActivo(conElegida)
  check('con una SSH elegida en el contexto, se ve ESA y no la local', a.pane?.tipo === 'ssh' && a.sshActivaId === 's2' && a.localActivaId === null && a.activePaneKey === 'ssh|alfa|s2', j({ k: a.activePaneKey, local: a.localActivaId }))
  const sinElegir = derivarActivo(entrada({ ssh: soltarSsh(s, CTX_A) }))
  check('sin SSH elegida, se ve la terminal local activa', sinElegir.pane?.tipo === 'local' && sinElegir.localActivaId === 't1' && sinElegir.sshActivaId === null && sinElegir.activePaneKey === `${KEY_A}|t1`, sinElegir.activePaneKey ?? 'null')
  const sinProyecto = derivarActivo(entrada({ activeProjectKey: null, projects: [], contexto: CTX_SIN, ssh: s }))
  check('sin proyecto ni local, se ve la PRIMERA SSH del perfil', sinProyecto.pane?.tipo === 'ssh' && sinProyecto.sshActivaId === 's1' && sinProyecto.activeProject === null, sinProyecto.activePaneKey ?? 'null')
  const sinNada = derivarActivo(entrada({ activeProjectKey: null, projects: [], contexto: CTX_SIN }))
  check('sin proyecto ni SSH, nada: sin pane y sin botón de reinicio', sinNada.pane === null && sinNada.activePaneKey === null && sinNada.boton === null, j({ k: sinNada.activePaneKey, b: sinNada.boton }))
  let proyectoVacio: ShellTerminalsState = ensureProject({}, KEY_A)
  proyectoVacio = { ...proyectoVacio, [KEY_A]: { list: [], activeId: null, nextN: 2 } }
  const sinLocales = derivarActivo(entrada({ terminals: proyectoVacio, ssh: soltarSsh(s, CTX_A) }))
  check('un proyecto sin terminales locales y con SSH sin elegir: se ve la primera SSH', sinLocales.pane?.tipo === 'ssh' && sinLocales.sshActivaId === 's1', sinLocales.activePaneKey ?? 'null')
  const sinLocalesElegida = derivarActivo(entrada({ terminals: proyectoVacio, ssh: s }))
  check('y con una elegida en el contexto (la última abierta), esa', sinLocalesElegida.sshActivaId === 's3', sinLocalesElegida.activePaneKey ?? 'null')
  check('MITAD NEGATIVA: una elegida que ya no existe no se ve; vuelve a la local', derivarActivo(entrada({ ssh: { ...s, activaPorContexto: { [CTX_A]: 's99' } } })).pane?.tipo === 'local', 'local')
  const otroPerfil = derivarActivo(entrada({ perfilId: 'beta', contexto: contextoSsh('beta', null), ssh: s }))
  check('MITAD NEGATIVA: nunca se ve una pestaña SSH de otro perfil', otroPerfil.sshLista.length === 0 && (otroPerfil.pane === null || otroPerfil.pane.tipo === 'local'), `${otroPerfil.sshLista.length} · ${otroPerfil.pane?.tipo ?? 'null'}`)
  const base = { perfilId: 'alfa', sshLista: sshDePerfil(s, 'alfa'), proyectoKey: KEY_A, localActivaId: 't1' }
  check('la regla pura: elegida > local > primera > nada', derivarPaneActivo({ ...base, sshElegidaId: 's3' })?.tipo === 'ssh' && derivarPaneActivo({ ...base, sshElegidaId: null })?.tipo === 'local' && derivarPaneActivo({ ...base, sshElegidaId: null, proyectoKey: null, localActivaId: null })?.tipo === 'ssh' && derivarPaneActivo({ ...base, sshElegidaId: null, proyectoKey: null, localActivaId: null, sshLista: [] }) === null, 'ssh · local · ssh · null')
  const trasCerrarA = podarContextosSsh(s, contextosVivosSsh([], ['alfa']))
  const reabierto = derivarActivo(entrada({ ssh: trasCerrarA }))
  check('al reabrir un proyecto cerrado se ve su terminal local nueva, no la SSH que se miraba antes de cerrarlo', derivarActivo(entrada({ ssh: s })).pane?.tipo === 'ssh' && reabierto.pane?.tipo === 'local' && reabierto.localActivaId === 't1', `antes: ssh · después: ${reabierto.pane?.tipo}`)
}

hr('(9b) ¿Hay terminal que enseñar? Un proyecto sin estrenar cuenta como que sí')
{
  const hay = (extra: Partial<EntradaActivo>): boolean => hayTerminalQueEnsenar(entrada(extra))
  const vacio: ShellTerminalsState = { [KEY_A]: { list: [], activeId: null, nextN: 2 } }
  check('con su terminal local, sí', hay({}), 'true')
  check(
    'un proyecto que aún no tiene lista, sí: su primera terminal nace en el efecto que sigue',
    hay({ terminals: {} }) && derivarActivo(entrada({ terminals: {} })).pane === null,
    'sin pane todavía, pero sí'
  )
  check('MITAD NEGATIVA: un proyecto con todas sus terminales cerradas a mano, no', !hay({ terminals: vacio }), 'false')
  check('MITAD NEGATIVA: sin proyecto ni SSH, no', !hay({ activeProjectKey: null, projects: [], contexto: CTX_SIN, terminals: {} }), 'false')
  check('sin locales pero con una SSH del perfil, sí', hay({ terminals: vacio, ssh: conTres() }), 'true')
}

hr('(10) El botón de reinicio del pane que se ve: «Reconectar» en SSH, el de siempre en local')
{
  const s = soltarSsh(conTres(), CTX_A)
  const vivo: TerminalPaneInfo = { status: 'live', sessionId: 'x', exitCode: null, error: null, reloading: false }
  const local = derivarActivo(entrada({ ssh: s, infoByPane: { [`${KEY_A}|t1`]: vivo } }))
  check('una local: «Reiniciar», solo icono y habilitado', local.boton?.etiqueta === 'Reiniciar' && local.boton.soloIcono && local.boton.habilitado, j(local.boton))
  const ssh = derivarActivo(entrada({ ssh: elegirSsh(s, 'alfa', CTX_A, 's2'), infoByPane: { 'ssh|alfa|s2': vivo } }))
  check('una SSH viva: «Reconectar», solo icono y habilitado', ssh.boton?.etiqueta === 'Reconectar' && ssh.boton.soloIcono && ssh.boton.habilitado && ssh.boton.accion === 'reload', j(ssh.boton))
  const muerta = derivarActivo(entrada({ ssh: elegirSsh(s, 'alfa', CTX_A, 's2'), infoByPane: { 'ssh|alfa|s2': { ...vivo, status: 'exited' } } }))
  check('una SSH terminada: «Reconectar» con etiqueta (no «Reabrir»)', muerta.boton?.etiqueta === 'Reconectar' && !muerta.boton.soloIcono && muerta.boton.habilitado, j(muerta.boton))
  const borrada = derivarActivo(entrada({ ssh: elegirSsh(s, 'alfa', CTX_A, 's2'), infoByPane: { 'ssh|alfa|s2': vivo }, conexionesVivas: new Set(['c1', 'c3']) }))
  check('una SSH cuya conexión se eliminó: botón deshabilitado y su motivo', borrada.boton?.habilitado === false && borrada.boton.accion === 'nada' && borrada.boton.titulo === motivoConexionEliminada(), j(borrada.boton))
  check('MITAD NEGATIVA: una local nunca se bloquea por conexiones; una SSH hibernada no existe (no se bloquea por hibernar)', local.boton?.habilitado === true && derivarActivo(entrada({ ssh: elegirSsh(s, 'alfa', CTX_A, 's2'), infoByPane: { 'ssh|alfa|s2': vivo }, hibernatedProjectKeys: new Set([KEY_A]) })).boton?.habilitado === true, 'habilitados')
  const hibernada = derivarActivo(entrada({ ssh: s, infoByPane: { [`${KEY_A}|t1`]: vivo }, hibernatedProjectKeys: new Set([KEY_A]) }))
  check('MITAD NEGATIVA: una local de un proyecto hibernado sí se bloquea (lo de siempre)', hibernada.boton?.habilitado === false, j(hibernada.boton))
  const dosLocales = addTerminal(ensureProject({}, KEY_A), KEY_A)
  check('la local que se ve es la activa del proyecto (la última creada)', derivarActivo(entrada({ terminals: dosLocales, ssh: s })).localActivaId === 't2', derivarActivo(entrada({ terminals: dosLocales, ssh: s })).localActivaId ?? 'null')
}

hr('(11) Qué se dice al terminar una sesión SSH')
{
  const razones: TerminalExitReason[] = ['ssh-autenticacion', 'ssh-inalcanzable', 'ssh-huella-cambiada', 'ssh-algoritmos']
  const m = (codigo: number | null, ms: number, r?: TerminalExitReason): string => motivoFinSsh(codigo, ms, r)
  check('255 en menos de 20 s sin motivo: «No se pudo conectar»', m(255, 400) === 'No se pudo conectar', m(255, 400))
  check('con el motivo de autenticación', m(255, 400, 'ssh-autenticacion') === 'No se pudo conectar: el servidor no aceptó las credenciales', m(255, 400, 'ssh-autenticacion'))
  check('con el de red inalcanzable (la VPN)', m(255, 400, 'ssh-inalcanzable') === 'No se pudo conectar: el servidor no responde: ¿falta la VPN?', m(255, 400, 'ssh-inalcanzable'))
  check(
    'con el de la huella cambiada, que dice dónde olvidarla',
    m(255, 400, 'ssh-huella-cambiada').startsWith('No se pudo conectar: la huella del servidor cambió;') && m(255, 400, 'ssh-huella-cambiada').includes('«Olvidar la huella guardada…»'),
    m(255, 400, 'ssh-huella-cambiada')
  )
  check('con el de algoritmos antiguos', m(255, 400, 'ssh-algoritmos') === 'No se pudo conectar: el servidor solo ofrece algoritmos antiguos', m(255, 400, 'ssh-algoritmos'))
  check('sin motivo (ssh no dejó escrito por qué) no se inventa ninguno: solo «No se pudo conectar»', m(255, 400, undefined) === 'No se pudo conectar' && !m(255, 400).includes(':'), m(255, 400))
  check('el borde son 20 s: a 19,999 no se pudo conectar; a 20 s ya se cortó', m(255, 19_999) === 'No se pudo conectar' && m(255, 20_000) === 'Se cortó la conexión', `${m(255, 19_999)} · ${m(255, 20_000)}`)
  check('MITAD NEGATIVA: 255 después de 20 s no habla de «conectar» ni lleva motivo', razones.every((r) => m(255, 60_000, r) === 'Se cortó la conexión'), 'Se cortó la conexión')
  check('0 y null: «La sesión terminó», sin código', m(0, 1) === 'La sesión terminó' && m(0, 90_000) === 'La sesión terminó' && m(null, 10) === 'La sesión terminó', m(0, 1))
  check('otro código: «La sesión terminó (código N)»', m(3, 10) === 'La sesión terminó (código 3)' && m(1, 90_000) === 'La sesión terminó (código 1)', m(3, 10))
  check('MITAD NEGATIVA: un código que no es de fallo, sin motivo del main, ignora la duración', m(1, 100) === 'La sesión terminó (código 1)', m(1, 100))
  const w = (codigo: number | null, ms: number, r?: TerminalExitReason): string => motivoFinSsh(codigo, ms, r, 'windows')
  const x = (codigo: number | null, ms: number, r?: TerminalExitReason): string => motivoFinSsh(codigo, ms, r, 'mac')
  check('el motivo del main manda aunque el código no sea 255', m(1, 100, 'ssh-autenticacion') === 'No se pudo conectar: el servidor no aceptó las credenciales', m(1, 100, 'ssh-autenticacion'))
  check(
    'Windows: -1 y 4294967295 SIN motivo del main no afirman nada (pudo ser un `exit` cuyo código perdió ConPTY): «La sesión terminó», sin código',
    [w(-1, 400), w(-1, 60_000), w(4294967295, 400), w(4294967295, 60_000)].every((t) => t === 'La sesión terminó'),
    `${w(-1, 400)} · ${w(-1, 60_000)} · ${w(4294967295, 60_000)}`
  )
  check(
    'Windows: el corte real llega con -1 Y el motivo del main: «Se cortó la conexión» (y rápido, «No se pudo conectar: …»)',
    w(-1, 60_000, 'ssh-inalcanzable') === 'Se cortó la conexión' &&
      w(4294967295, 60_000, 'ssh-inalcanzable') === 'Se cortó la conexión' &&
      w(-1, 400, 'ssh-inalcanzable') === 'No se pudo conectar: el servidor no responde: ¿falta la VPN?',
    `${w(-1, 60_000, 'ssh-inalcanzable')} · ${w(-1, 400, 'ssh-inalcanzable')}`
  )
  check('Windows: el 255 sin motivo sigue siendo fallo de ssh', w(255, 400) === 'No se pudo conectar' && w(255, 60_000) === 'Se cortó la conexión', `${w(255, 400)} · ${w(255, 60_000)}`)
  check('MITAD NEGATIVA: en mac, -1 y 4294967295 no son fallo de ssh', x(-1, 400) === 'La sesión terminó (código -1)' && x(4294967295, 400) === 'La sesión terminó (código 4294967295)', x(-1, 400))
  check('MITAD NEGATIVA: sin plataforma tampoco', m(-1, 400) === 'La sesión terminó (código -1)', m(-1, 400))
  check('el banner dice que Intro vuelve a conectar', bannerFinSsh('La sesión terminó') === 'La sesión terminó. Pulsa Intro para volver a conectar.', bannerFinSsh('La sesión terminó'))
  check('y no duplica la puntuación: «…¿falta la VPN?» ya cierra', bannerFinSsh('No se pudo conectar: el servidor no responde: ¿falta la VPN?') === 'No se pudo conectar: el servidor no responde: ¿falta la VPN? Pulsa Intro para volver a conectar.', 'una sola puntuación')
}

hr('(12) El «Conectando a…» se retira con el primer TEXTO, no con las secuencias con que se abre el pty')
{
  const E = String.fromCharCode(27)
  const BEL = String.fromCharCode(7)
  const titulo = `${E}]0;C:\\Windows\\System32\\OpenSSH\\ssh.exe${BEL}`
  const arranque = `${E}[?9001h${E}[?1004h${E}[2J${E}[m${E}[H${titulo}${E}[?25h`
  check('las secuencias de arranque del pty (título incluido) no cuentan como dato', !hayTextoVisible(arranque), j(arranque.length))
  check('un banner sí', hayTextoVisible('falso-ssh listo\r\n') && hayTextoVisible(`${arranque}pruebas@192.0.2.10's password: `), 'banner y prompt')
  check('con color: el texto entre secuencias cuenta', hayTextoVisible(`${E}[31mx${E}[0m`), 'rojo + x')
  check('los blancos y los saltos de línea no cuentan', !hayTextoVisible('  \r\n\t ') && !hayTextoVisible(''), 'blancos y vacío')
  check('un carácter de control suelto (BEL, DEL) tampoco', !hayTextoVisible(`${BEL}${String.fromCharCode(127)}`), 'BEL y DEL')
  check('un trozo cortado en mitad de una secuencia no revienta', typeof hayTextoVisible(`${E}[`) === 'boolean', String(hayTextoVisible(`${E}[`)))
}

hr('(13) La conexión que marca la lista (el riel y el popover): la de la pestaña SSH que se ve')
{
  const s = conTres()
  const ve = (ssh: SshTabsState, extra: Partial<EntradaActivo> = {}): string | null => conexionDelPane(derivarActivo(entrada({ ssh, ...extra })).pane)
  check('con una SSH elegida se marca su conexión', ve(elegirSsh(s, 'alfa', CTX_A, 's2')) === 'c2', String(ve(elegirSsh(s, 'alfa', CTX_A, 's2'))))
  check('la marca sigue a la pestaña que se elige', ve(elegirSsh(s, 'alfa', CTX_A, 's1')) === 'c1' && ve(elegirSsh(s, 'alfa', CTX_A, 's3')) === 'c3', `${ve(elegirSsh(s, 'alfa', CTX_A, 's1'))} · ${ve(elegirSsh(s, 'alfa', CTX_A, 's3'))}`)
  const dos = abrirSsh(s, CTX_A, 'alfa', 'c1', 'Router')
  check('dos pestañas de la misma conexión marcan la misma fila', ve(elegirSsh(dos, 'alfa', CTX_A, 's1')) === 'c1' && ve(dos) === 'c1', `${ve(elegirSsh(dos, 'alfa', CTX_A, 's1'))} · ${ve(dos)}`)
  check('MITAD NEGATIVA: con una terminal local a la vista no se marca ninguna', ve(soltarSsh(s, CTX_A)) === null, String(ve(soltarSsh(s, CTX_A))))
  check('MITAD NEGATIVA: sin nada que ver tampoco', ve(initialSshTabsState, { activeProjectKey: null, projects: [], contexto: CTX_SIN }) === null && conexionDelPane(null) === null, 'null · null')
  check('una pestaña cuya conexión se eliminó marca su id aunque ya no haya fila: la lista no la pinta', ve(elegirSsh(s, 'alfa', CTX_A, 's2'), { conexionesVivas: new Set(['c1', 'c3']) }) === 'c2', 'c2')
}

hr('R - Las pestañas vuelven al arrancar, sin conectarse')
{
  const ctx = contextoSsh('p1', null)
  let s = abrirSsh(initialSshTabsState, ctx, 'p1', 'c-web', 'web')
  s = abrirSsh(s, ctx, 'p1', 'c-web', 'web')
  s = abrirSsh(s, ctx, 'p1', 'c-db', 'db', true)
  s = renombrarSsh(s, 'p1', 's1', 'Logs')
  s = abrirSsh(s, contextoSsh('p2', null), 'p2', 'c-borrada', 'vieja')
  const g = pestanasAGuardar(s)
  check(
    '(R1) se guardan por perfil, en su orden, con su nombre a mano, su alias y si es SFTP',
    JSON.stringify(g.p1) === JSON.stringify([{ conexionId: 'c-web', alias: 'web', nombre: 'Logs' }, { conexionId: 'c-web', alias: 'web' }, { conexionId: 'c-db', alias: 'db', sftp: true }]),
    JSON.stringify(g.p1)
  )
  const sinBorrada = pestanasAGuardar(s, (id) => id !== 'c-borrada')
  check('(R2) con la lista de conexiones, sin las de una conexión que ya no existe (y sin entrada el perfil que se queda sin ninguna)', !('p2' in sinBorrada) && sinBorrada.p1.length === 3, JSON.stringify(Object.keys(sinBorrada)))
  const r = restaurarSsh(initialSshTabsState, g)
  const p1 = sshDePerfil(r, 'p1')
  check('(R3) vuelven las mismas, con sus nombres', JSON.stringify(p1.map((t) => nombreSsh(t))) === JSON.stringify(['Logs', 'web (2)', 'SFTP · db']), JSON.stringify(p1.map((t) => nombreSsh(t))))
  check('(R4) ninguna elegida: nada se conecta hasta que se mira', Object.keys(r.activaPorContexto).length === 0, JSON.stringify(r.activaPorContexto))
  const nueva = abrirSsh(r, ctx, 'p1', 'c-web', 'web')
  check('(R5) la siguiente que se abre sigue numerando (un id no se reutiliza) y toma el hueco libre', sshDePerfil(nueva, 'p1')[3].id === 's4' && nombreSsh(sshDePerfil(nueva, 'p1')[3]) === 'web (3)', JSON.stringify(sshDePerfil(nueva, 'p1')[3]))
  check('(R6) un perfil que ya tiene pestañas no se toca; sin nada que restaurar, el MISMO objeto', restaurarSsh(s, g) === s && restaurarSsh(r, {}) === r, 'mismo objeto')
  const conIds = { porPerfil: { p1: { lista: [], siguiente: 7 } }, activaPorContexto: {} } as SshTabsState
  check('(R7) tras cerrar todas, los ids restaurados siguen al último repartido', sshDePerfil(restaurarSsh(conIds, g), 'p1')[0].id === 's7', sshDePerfil(restaurarSsh(conIds, g), 'p1')[0].id)
  const sinNada = { perfilId: 'p1', sshLista: sshDePerfil(r, 'p1'), sshElegidaId: null, proyectoKey: null, localActivaId: null }
  check('(R9) sin proyecto ni terminal local, una restaurada sin elegir NO hace de pane de reserva (se conectaría sola)', derivarPaneActivo(sinNada) === null, JSON.stringify(derivarPaneActivo(sinNada)))
  const elegida = elegirSsh(r, 'p1', ctx, 's2')
  const t2 = sshDePerfil(elegida, 'p1').find((t) => t.id === 's2')
  check('(R10) elegirla la quita de restaurada (y ya puede hacer de reserva); las demás siguen sin conectarse', t2?.restaurada === undefined && sshDePerfil(elegida, 'p1')[0].restaurada === true && elegida.activaPorContexto[ctx] === 's2', JSON.stringify(t2))
  check(
    '(R11) tras soltarla, la reserva es esa y no una restaurada',
    derivarPaneActivo({ ...sinNada, sshLista: sshDePerfil(soltarSsh(elegida, ctx), 'p1') })?.paneKey === sshPaneKey('p1', 's2'),
    String(derivarPaneActivo({ ...sinNada, sshLista: sshDePerfil(soltarSsh(elegida, ctx), 'p1') })?.paneKey)
  )
  check('(R12) lo restaurado no se guarda como tal: al guardar, sin la marca', !JSON.stringify(pestanasAGuardar(r)).includes('restaurada'), 'sin marca')
  const n = normalizarPestanasSshPorPerfil({
    p1: [{ conexionId: 'c-1', alias: 'a', nombre: '  ', sftp: 'si' }, { conexionId: '../x', alias: 'b' }, { conexionId: 'c-2' }, 'basura'],
    '': [{ conexionId: 'c-3', alias: 'c' }],
    p3: 'no es una lista',
    p4: Array.from({ length: SSH_PESTANAS_MAX + 5 }, (_, i) => ({ conexionId: `c${i}`, alias: 'x' }))
  })
  check(
    '(R8) lo leído del archivo se sanea entrada a entrada: un id raro, sin alias o sin forma fuera; un nombre en blanco no cuenta; con tope por perfil',
    JSON.stringify(n.p1) === JSON.stringify([{ conexionId: 'c-1', alias: 'a' }]) && !('' in n) && !('p3' in n) && n.p4.length === SSH_PESTANAS_MAX,
    JSON.stringify({ p1: n.p1, perfiles: Object.keys(n), p4: n.p4?.length })
  )
}

hr('(C) Cerrar la última terminal local deja verse la SSH que queda, aunque venga restaurada')
{
  // La clave del proyecto es también su contexto SSH: `cerrarLocal` se apoya en eso.
  const ctx = terminalProjectKey('p1', 'D:/proy')
  check('(C0) la clave del proyecto es su contexto SSH', ctx === contextoSsh('p1', 'D:/proy'), ctx)
  const restauradas = restaurarSsh(initialSshTabsState, { p1: [{ conexionId: 'c-vpn', alias: 'vpn' }] })
  // `ensureProject` ya trae la primera terminal local del proyecto.
  const conLocal = ensureProject({} as ShellTerminalsState, ctx)
  const idLocal = conLocal[ctx].activeId!
  const r = cerrarLocal(conLocal, restauradas, ctx, idLocal)
  const pane = derivarPaneActivo({ perfilId: 'p1', sshLista: sshDePerfil(r.ssh, 'p1'), sshElegidaId: r.ssh.activaPorContexto[ctx] ?? null, proyectoKey: ctx, localActivaId: r.shell[ctx].activeId })
  check('(C1) sin otra local, se elige la SSH restaurada y se ve: el panel no se queda vacío', pane?.tipo === 'ssh' && r.ssh.activaPorContexto[ctx] !== undefined, JSON.stringify(pane))
  const dosLocales = addTerminal(conLocal, ctx)
  const otra = cerrarLocal(dosLocales, restauradas, ctx, dosLocales[ctx].activeId!)
  check('(C2) si queda otra local, pasa a verse esa y la SSH sigue sin elegir', otra.shell[ctx].activeId === idLocal && otra.ssh === restauradas, String(otra.shell[ctx].activeId))
  const conSshElegida = elegirSsh(restauradas, 'p1', ctx, sshDePerfil(restauradas, 'p1')[0].id)
  const vista = cerrarLocal(conLocal, conSshElegida, ctx, idLocal)
  check('(C3) si ya se veía una SSH, cerrar una local no toca la elección', vista.ssh === conSshElegida, 'mismo objeto')
  const sinSsh = cerrarLocal(conLocal, initialSshTabsState, ctx, idLocal)
  check('(C4) sin pestañas SSH, no se inventa nada', sinSsh.ssh === initialSshTabsState && sinSsh.shell[ctx].activeId === null, 'vacío')
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
