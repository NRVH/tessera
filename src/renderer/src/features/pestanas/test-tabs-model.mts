#!/usr/bin/env node
// =============================================================================
// Prueba del reducer puro de tabsModel (node src/renderer/src/features/pestanas/test-tabs-model.mts).
// Corre bajo `node` a secas: tabsModel no usa React, DOM ni IPC. Cubre el nivel 3
// (repo activo por proyecto): openProject, setScannedRepos (raíz o primero por defecto,
// repo recordado, re-escaneo idempotente), setActiveRepo, closeProject y
// selectGitTargetPath; y el objetivo de git: selectObjetivoGit (repos null frente a [])
// y backendAnclado, la única puerta de «pedir».
// =============================================================================

import {
  BOOTSTRAP_PROFILE_ID,
  initialTabsState,
  tabsReducer,
  selectGlobalActiveRepo,
  selectGlobalActiveRepos,
  selectGlobalActiveRepoState,
  selectGitTargetPath,
  selectObjetivoGit,
  selectObjetivoGitMostrado,
  backendAnclado,
  selectAllOpenProjects,
  selectAllOpenTargets,
  selectHibernatedTargetKeys,
  agentTargetKey,
  type TabsState,
  type TabsAction
} from './tabsModel.ts'
import type { DetectedRepo } from '../../../../shared/workspace-ipc.ts'
import type { Profile } from '../../../../main/profiles/types.ts'

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function profile(id: string): Profile {
  return {
    id,
    nombre: id.toUpperCase(),
    color: '#112233',
    agentes: [{ tipo: 'claude-code', configDir: `./${id}` }],
    sandbox: { habilitado: false }
  }
}
const PROFILES: Profile[] = [profile('alfa'), profile('beta')]

function repo(name: string, repoHostPath: string, isRoot: boolean): DetectedRepo {
  return { name, repoHostPath, isRoot }
}

/** Aplica una secuencia de acciones a un estado inicial. */
function run(state: TabsState, actions: TabsAction[]): TabsState {
  return actions.reduce(tabsReducer, state)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const PROJ = 'C:\\proyectos\\multi'
  const ROOT = PROJ // el repo raíz comparte ruta con la carpeta abierta
  const CHILD_A = 'C:\\proyectos\\multi\\alpha'
  const CHILD_B = 'C:\\proyectos\\multi\\beta'

  // --- (0) init: cada perfil arranca con repoState vacío --------------------
  hr('(0) init crea repoState:{} por perfil')
  const base = initialTabsState(PROFILES, 'alfa')
  check(
    '(0) ambos perfiles tienen repoState y openProjects vacíos',
    JSON.stringify(base.byProfile.alfa.repoState) === '{}' &&
      JSON.stringify(base.byProfile.beta.repoState) === '{}' &&
      base.byProfile.alfa.openProjects.length === 0,
    JSON.stringify(base.byProfile.alfa)
  )

  // --- (0b) perfil inicial: el sembrado solo es una PREFERENCIA ---------------
  // Una instalación con sus propios perfiles (sin el sembrado) debe arrancar en los suyos
  // sin que aparezca ni se active el perfil por defecto.
  hr('(0b) perfil inicial: restaurado -> preferido -> el primero de la lista')
  const sinSembrado = initialTabsState(PROFILES)
  check(
    `(0b.1) sin «${BOOTSTRAP_PROFILE_ID}» ni sesión restaurada se activa el PRIMERO y no se crea otro perfil`,
    sinSembrado.activeProfileId === 'alfa' &&
      JSON.stringify(Object.keys(sinSembrado.byProfile).sort()) === JSON.stringify(['alfa', 'beta']) &&
      sinSembrado.profiles === PROFILES,
    `activo=${sinSembrado.activeProfileId} perfiles=${JSON.stringify(Object.keys(sinSembrado.byProfile))}`
  )
  const conSembrado = initialTabsState([profile('beta'), profile(BOOTSTRAP_PROFILE_ID)])
  check(
    '(0b.2) si el sembrado existe y no hay sesión restaurada, gana sobre el orden de la lista',
    conSembrado.activeProfileId === BOOTSTRAP_PROFILE_ID,
    `activo=${conSembrado.activeProfileId}`
  )
  const restauradoGana = initialTabsState([profile(BOOTSTRAP_PROFILE_ID), profile('beta')], undefined, {
    activeProfileId: 'beta',
    byProfile: {}
  })
  check(
    '(0b.3) el activo RESTAURADO gana al sembrado aunque exista',
    restauradoGana.activeProfileId === 'beta',
    `activo=${restauradoGana.activeProfileId}`
  )
  check('(0b.4) sin perfiles no hay activo', initialTabsState([]).activeProfileId === null, 'null')

  // --- (1) openProject inicializa repoState "sin escanear" ------------------
  hr('(1) openProject -> repoState = { repos: null, activeRepoHostPath: null }')
  const opened = run(base, [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: PROJ, name: 'multi' } }
  ])
  const rs1 = selectGlobalActiveRepoState(opened)
  check(
    '(1) proyecto activo sin escanear: repos=null, sin repo activo',
    rs1 !== null && rs1.repos === null && rs1.activeRepoHostPath === null,
    JSON.stringify(rs1)
  )
  check(
    '(1b) backendTarget cae al contenedor (projectHostPath) mientras no hay repo',
    selectGitTargetPath(opened) === PROJ,
    String(selectGitTargetPath(opened))
  )
  check(
    '(1c) selectGlobalActiveRepos = null (aún no escaneado) y repo activo = null',
    selectGlobalActiveRepos(opened) === null && selectGlobalActiveRepo(opened) === null,
    `repos=${JSON.stringify(selectGlobalActiveRepos(opened))}`
  )

  // --- (2) setScannedRepos elige la RAÍZ por defecto ------------------------
  hr('(2) escaneo root+hijos elige la raíz (isRoot) por defecto')
  const scannedRoot = run(opened, [
    {
      type: 'setScannedRepos',
      profileId: 'alfa',
      projectHostPath: PROJ,
      repos: [repo('multi', ROOT, true), repo('alpha', CHILD_A, false), repo('beta', CHILD_B, false)]
    }
  ])
  const activeRepo2 = selectGlobalActiveRepo(scannedRoot)
  check(
    '(2) repo activo = la raíz; backendTarget = repoHostPath de la raíz (=== PROJ)',
    activeRepo2?.repoHostPath === ROOT &&
      activeRepo2.isRoot === true &&
      selectGitTargetPath(scannedRoot) === ROOT,
    `activeRepo=${JSON.stringify(activeRepo2)} backend=${selectGitTargetPath(scannedRoot)}`
  )

  // --- (3) contenedor SIN raíz elige el primero -----------------------------
  hr('(3) escaneo de contenedor sin raíz elige el PRIMERO de la lista')
  const scannedContainer = run(opened, [
    {
      type: 'setScannedRepos',
      profileId: 'alfa',
      projectHostPath: PROJ,
      repos: [repo('alpha', CHILD_A, false), repo('beta', CHILD_B, false)]
    }
  ])
  check(
    '(3) repo activo = alpha (primero); backendTarget = su repoHostPath (!= PROJ)',
    selectGlobalActiveRepo(scannedContainer)?.repoHostPath === CHILD_A &&
      selectGitTargetPath(scannedContainer) === CHILD_A,
    `backend=${selectGitTargetPath(scannedContainer)}`
  )

  // --- (4) lista VACÍA -> sin repo activo (válido) --------------------------
  hr('(4) escaneo vacío -> sin repo activo; backendTarget cae al contenedor')
  const scannedEmpty = run(opened, [
    { type: 'setScannedRepos', profileId: 'alfa', projectHostPath: PROJ, repos: [] }
  ])
  const rs4 = selectGlobalActiveRepoState(scannedEmpty)
  check(
    '(4) repos=[], activeRepoHostPath=null, repo activo=null, backend=PROJ (contenedor)',
    rs4?.repos?.length === 0 &&
      rs4?.activeRepoHostPath === null &&
      selectGlobalActiveRepo(scannedEmpty) === null &&
      selectGitTargetPath(scannedEmpty) === PROJ,
    JSON.stringify(rs4)
  )

  // --- (5) respetar el repo recordado si sigue existiendo tras reescanear ---
  hr('(5) reescaneo respeta el repo recordado si sigue en la lista')
  const chosenChild = run(scannedRoot, [
    { type: 'setActiveRepo', profileId: 'alfa', projectHostPath: PROJ, repoHostPath: CHILD_A }
  ])
  const rescanned = run(chosenChild, [
    {
      type: 'setScannedRepos',
      profileId: 'alfa',
      projectHostPath: PROJ,
      repos: [repo('multi', ROOT, true), repo('alpha', CHILD_A, false), repo('beta', CHILD_B, false)]
    }
  ])
  check(
    '(5) tras reescanear con alpha activo, sigue alpha (NO vuelve a la raíz)',
    selectGlobalActiveRepo(rescanned)?.repoHostPath === CHILD_A,
    `activeRepo=${selectGlobalActiveRepo(rescanned)?.repoHostPath}`
  )
  // El re-escaneo ahora es AUTOMÁTICO (watcher de FS, reactivar el tab, foco), así
  // que la MISMA lista debe devolver el MISMO estado: sin identidad nueva no hay
  // re-render de la cadena que cuelga de `repos` (panel de git, multiStatus…).
  check(
    '(5b) reescaneo con lista IDÉNTICA -> mismo objeto de estado (no-op referencial)',
    rescanned === chosenChild,
    `same=${rescanned === chosenChild}`
  )

  // --- (5c/5d) la carpeta cambió por fuera: repos que salen y que entran ------
  hr('(5c/5d) reescaneo con la carpeta cambiada (borrar/clonar repos por fuera)')
  // El repo activo (alpha) desaparece de la carpeta: no puede quedarse activo
  // (git apuntaría a un fantasma); cae al criterio por defecto (la raíz).
  const alphaGone = run(chosenChild, [
    {
      type: 'setScannedRepos',
      profileId: 'alfa',
      projectHostPath: PROJ,
      repos: [repo('multi', ROOT, true), repo('beta', CHILD_B, false)]
    }
  ])
  check(
    '(5c) el repo activo ya no existe -> lista sin alpha y activo = raíz',
    selectGlobalActiveRepos(alphaGone)?.length === 2 &&
      !selectGlobalActiveRepos(alphaGone)?.some((r) => r.repoHostPath === CHILD_A) &&
      selectGlobalActiveRepo(alphaGone)?.repoHostPath === ROOT,
    `repos=${JSON.stringify(selectGlobalActiveRepos(alphaGone)?.map((r) => r.name))} activo=${selectGlobalActiveRepo(alphaGone)?.repoHostPath}`
  )
  // Y un repo NUEVO (recién clonado) entra en la lista sin mover el activo.
  const CHILD_C = 'C:\\proyectos\\multi\\gamma'
  const gammaAdded = run(alphaGone, [
    {
      type: 'setScannedRepos',
      profileId: 'alfa',
      projectHostPath: PROJ,
      repos: [repo('multi', ROOT, true), repo('beta', CHILD_B, false), repo('gamma', CHILD_C, false)]
    }
  ])
  check(
    '(5d) repo recién clonado aparece en la lista y el activo (raíz) no se mueve',
    selectGlobalActiveRepos(gammaAdded)?.some((r) => r.repoHostPath === CHILD_C) === true &&
      selectGlobalActiveRepo(gammaAdded)?.repoHostPath === ROOT,
    `repos=${JSON.stringify(selectGlobalActiveRepos(gammaAdded)?.map((r) => r.name))}`
  )

  // --- (6) setActiveRepo no-op si el repo no está / no escaneado ------------
  hr('(6) setActiveRepo no-op si el repo no está en la lista o no se escaneó')
  const noopUnknown = run(scannedRoot, [
    {
      type: 'setActiveRepo',
      profileId: 'alfa',
      projectHostPath: PROJ,
      repoHostPath: 'C:\\ruta\\que\\no\\existe'
    }
  ])
  const noopUnscanned = run(opened, [
    { type: 'setActiveRepo', profileId: 'alfa', projectHostPath: PROJ, repoHostPath: CHILD_A }
  ])
  check(
    '(6) repo desconocido -> mismo objeto de estado (no-op referencial)',
    noopUnknown === scannedRoot,
    `same=${noopUnknown === scannedRoot}`
  )
  check(
    '(6b) sin escanear (repos=null) -> setActiveRepo es no-op referencial',
    noopUnscanned === opened,
    `same=${noopUnscanned === opened}`
  )

  // --- (7) setActiveRepo válido cambia el repo activo -----------------------
  hr('(7) setActiveRepo válido cambia el repo activo y el backendTarget')
  check(
    '(7) activar beta -> repo activo = beta, backendTarget = CHILD_B',
    (() => {
      const s = run(scannedRoot, [
        { type: 'setActiveRepo', profileId: 'alfa', projectHostPath: PROJ, repoHostPath: CHILD_B }
      ])
      return selectGlobalActiveRepo(s)?.repoHostPath === CHILD_B && selectGitTargetPath(s) === CHILD_B
    })(),
    'ver aserción'
  )

  // --- (8) reabrir un proyecto ya abierto NO resetea su repo recordado ------
  hr('(8) reabrir un proyecto ya abierto conserva su repo activo recordado')
  const reopened = run(chosenChild, [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: PROJ, name: 'multi' } }
  ])
  check(
    '(8) tras reabrir PROJ, alpha sigue siendo el repo activo (no vuelve a null/raíz)',
    selectGlobalActiveRepo(reopened)?.repoHostPath === CHILD_A,
    `activeRepo=${selectGlobalActiveRepo(reopened)?.repoHostPath}`
  )

  // --- (9) closeProject borra el repoState del proyecto ---------------------
  hr('(9) closeProject elimina el repoState del proyecto cerrado')
  const closed = run(scannedRoot, [
    { type: 'closeProject', profileId: 'alfa', projectHostPath: PROJ }
  ])
  check(
    '(9) tras cerrar, no queda entrada de repoState para PROJ',
    !(PROJ in closed.byProfile.alfa.repoState) && closed.byProfile.alfa.openProjects.length === 0,
    JSON.stringify(closed.byProfile.alfa.repoState)
  )

  // --- (10) regresión un solo repo: root cuyo repoHostPath === projectHostPath
  hr('(10) un solo repo (carpeta ES el repo): backendTarget === projectHostPath')
  const SOLO = 'C:\\proyectos\\proyecto-alfa'
  const soloScanned = run(base, [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: SOLO, name: 'proyecto-alfa' } },
    {
      type: 'setScannedRepos',
      profileId: 'alfa',
      projectHostPath: SOLO,
      repos: [repo('proyecto-alfa', SOLO, true)]
    }
  ])
  check(
    '(10) 1 repo isRoot activo solo; backendTarget === projectHostPath (== hoy)',
    selectGlobalActiveRepo(soloScanned)?.repoHostPath === SOLO &&
      selectGitTargetPath(soloScanned) === SOLO,
    `backend=${selectGitTargetPath(soloScanned)}`
  )

  // --- (13) replaceProject: sustituir un tab por otro en su mismo hueco ------
  hr('(13) replaceProject reemplaza en el mismo hueco, conserva orden y activa')
  const P_A = 'C:\\proyectos\\a'
  const P_B = 'C:\\proyectos\\b'
  const P_C = 'C:\\proyectos\\c'
  const P_NEW = 'C:\\proyectos\\nuevo'
  const threeOpen = run(base, [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: P_A, name: 'a' } },
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: P_B, name: 'b' } },
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: P_C, name: 'c' } }
  ])
  // Reemplazar el de en medio (B) por uno nuevo: mismo índice, orden A,NEW,C, activo NEW.
  const replacedMid = run(threeOpen, [
    {
      type: 'replaceProject',
      profileId: 'alfa',
      oldPath: P_B,
      project: { projectHostPath: P_NEW, name: 'nuevo' }
    }
  ])
  const midPaths = replacedMid.byProfile.alfa.openProjects.map((p) => p.projectHostPath)
  check(
    '(13a) reemplaza en su MISMO hueco (A,NEW,C), activa el nuevo y olvida el viejo',
    JSON.stringify(midPaths) === JSON.stringify([P_A, P_NEW, P_C]) &&
      replacedMid.byProfile.alfa.activePath === P_NEW &&
      !(P_B in replacedMid.byProfile.alfa.repoState) &&
      JSON.stringify(replacedMid.byProfile.alfa.repoState[P_NEW]) ===
        JSON.stringify({ repos: null, activeRepoHostPath: null }),
    `paths=${JSON.stringify(midPaths)} activo=${replacedMid.byProfile.alfa.activePath}`
  )
  // Reemplazar por uno YA abierto (C): no duplica; cierra B, activa C, orden A,C.
  const replacedDup = run(threeOpen, [
    {
      type: 'replaceProject',
      profileId: 'alfa',
      oldPath: P_B,
      project: { projectHostPath: P_C, name: 'c' }
    }
  ])
  const dupPaths = replacedDup.byProfile.alfa.openProjects.map((p) => p.projectHostPath)
  check(
    '(13b) reemplazar por uno ya abierto NO duplica: cierra el viejo y activa el existente',
    JSON.stringify(dupPaths) === JSON.stringify([P_A, P_C]) &&
      replacedDup.byProfile.alfa.activePath === P_C,
    `paths=${JSON.stringify(dupPaths)} activo=${replacedDup.byProfile.alfa.activePath}`
  )
  // Reemplazar un oldPath inexistente -> no-op referencial.
  const replacedNoop = run(threeOpen, [
    {
      type: 'replaceProject',
      profileId: 'alfa',
      oldPath: 'C:\\no\\existe',
      project: { projectHostPath: P_NEW, name: 'nuevo' }
    }
  ])
  check(
    '(13c) oldPath inexistente -> no-op referencial (mismo objeto de estado)',
    replacedNoop === threeOpen,
    `same=${replacedNoop === threeOpen}`
  )

  // --- (14) reordenarProyectos: arrastrar una pestaña de proyecto -------------
  hr('(14) reordenarProyectos cambia el orden y nada más')
  const reordenar = (s: TabsState, orderedPaths: string[], profileId = 'alfa'): TabsState =>
    run(s, [{ type: 'reordenarProyectos', profileId, orderedPaths }])
  const rutasDe = (s: TabsState): string[] => s.byProfile.alfa.openProjects.map((p) => p.projectHostPath)
  {
    const antes = threeOpen.byProfile.alfa
    const movido = reordenar(threeOpen, [P_C, P_A, P_B])
    const despues = movido.byProfile.alfa
    check('(14a) el orden es el pedido', JSON.stringify(rutasDe(movido)) === JSON.stringify([P_C, P_A, P_B]), JSON.stringify(rutasDe(movido)))
    check('(14a.2) el activo no cambia (arrastrar no activa)', despues.activePath === antes.activePath, `activo=${despues.activePath}`)
    check(
      '(14a.3) son los MISMOS objetos de proyecto y el mismo repoState',
      despues.repoState === antes.repoState && antes.openProjects.every((p) => despues.openProjects.includes(p)),
      'identidad conservada'
    )
    check(
      '(14a.4) los demás perfiles y la lista de perfiles no se tocan',
      movido.profiles === threeOpen.profiles && movido.byProfile.beta === threeOpen.byProfile.beta,
      'misma referencia'
    )
    check('(14b) el mismo orden devuelve el MISMO state', reordenar(threeOpen, [P_A, P_B, P_C]) === threeOpen, 'same')
    const malos: [string, string[], string?][] = [
      ['una repetida', [P_A, P_A, P_C]],
      ['una que falta', [P_A, P_B]],
      ['una de más', [P_A, P_B, P_C, P_NEW]],
      ['una ajena', [P_A, P_B, P_NEW]],
      ['vacío', []],
      ['perfil inexistente', [P_C, P_A, P_B], 'no-existe']
    ]
    for (const [nombre, orden, perfil] of malos) {
      check(`(14c) ${nombre}: el MISMO state (no duplica ni pierde proyectos)`, reordenar(threeOpen, orden, perfil) === threeOpen, 'same')
    }
    const dormido = run(threeOpen, [{ type: 'hibernateProfile', profileId: 'alfa' }])
    const dormidoMovido = reordenar(dormido, [P_B, P_C, P_A])
    check(
      '(14d) reordenar un perfil hibernado no despierta ninguno',
      dormidoMovido.byProfile.alfa.openProjects.every((p) => p.estado === 'hibernated') &&
        JSON.stringify(rutasDe(dormidoMovido)) === JSON.stringify([P_B, P_C, P_A]),
      dormidoMovido.byProfile.alfa.openProjects.map((p) => p.estado).join(',')
    )
    // C es el activo; tras [B, C, A], cerrar C activa a su vecino VISUAL (A), no a B.
    const cerrado = run(reordenar(threeOpen, [P_B, P_C, P_A]), [{ type: 'closeProject', profileId: 'alfa', projectHostPath: P_C }])
    check('(14e) al cerrar el activo hereda su vecino del orden NUEVO', cerrado.byProfile.alfa.activePath === P_A, `activo=${cerrado.byProfile.alfa.activePath}`)
  }

  // --- (15) agenteDiferido: el proyecto que nace para ver un archivo ----------
  hr('(15) agenteDiferido nace con el proyecto, se conserva y solo se quita a propósito')
  {
    const P_D = 'C:\\proyectos\\suelto'
    const abrir = (s: TabsState, ruta: string, agenteDiferido?: boolean): TabsState =>
      run(s, [{ type: 'openProject', profileId: 'alfa', project: { projectHostPath: ruta, name: 'x' }, agenteDiferido }])
    const de = (s: TabsState, ruta: string) => s.byProfile.alfa.openProjects.find((p) => p.projectHostPath === ruta)
    const conMarca = abrir(threeOpen, P_D, true)
    check('(15a) openProject con `agenteDiferido` crea el proyecto con la marca', de(conMarca, P_D)?.agenteDiferido === true, JSON.stringify(de(conMarca, P_D)))
    check('(15a.2) sin la opción (o en false) no hay marca ni clave', !('agenteDiferido' in (de(abrir(threeOpen, P_D), P_D) ?? {})) && !('agenteDiferido' in (de(abrir(threeOpen, P_D, false), P_D) ?? {})), 'sin clave')
    const yaAbierto = abrir(threeOpen, P_A, true)
    check('(15b) sobre uno YA abierto no la pone (su agente ya estaba a la vista) ni lo duplica', de(yaAbierto, P_A)?.agenteDiferido === undefined && yaAbierto.byProfile.alfa.openProjects.length === 3, `n=${yaAbierto.byProfile.alfa.openProjects.length}`)
    const otroArchivo = abrir(conMarca, P_D, true)
    check('(15b.2) otro archivo de la misma carpeta (con la opción) la conserva', de(otroArchivo, P_D)?.agenteDiferido === true, 'conserva')
    const comoProyecto = abrir(conMarca, P_D)
    check(
      '(15b.3) reabrirlo como PROYECTO (sin la opción) se la quita: quien lo abre así quiere su agente',
      de(comoProyecto, P_D) !== undefined && !('agenteDiferido' in de(comoProyecto, P_D)!) && comoProyecto.byProfile.alfa.openProjects.length === 4,
      JSON.stringify(de(comoProyecto, P_D))
    )

    const conservan: [string, TabsAction][] = [
      ['setActiveProject a otro', { type: 'setActiveProject', profileId: 'alfa', projectHostPath: P_A }],
      ['hibernateProfile', { type: 'hibernateProfile', profileId: 'alfa' }],
      ['wakeProject', { type: 'wakeProject', profileId: 'alfa', projectHostPath: P_D }],
      ['reordenarProyectos', { type: 'reordenarProyectos', profileId: 'alfa', orderedPaths: [P_D, P_A, P_B, P_C] }]
    ]
    for (const [nombre, accion] of conservan) {
      check(`(15c) ${nombre} conserva la marca`, de(run(conMarca, [accion]), P_D)?.agenteDiferido === true, 'conserva')
    }
    const dormidoYDespierto = run(conMarca, [{ type: 'hibernateProfile', profileId: 'alfa' }, { type: 'setActiveProject', profileId: 'alfa', projectHostPath: P_D }])
    check('(15c.2) hibernar y volver a entrar la conserva', de(dormidoYDespierto, P_D)?.agenteDiferido === true && de(dormidoYDespierto, P_D)?.estado === 'active', JSON.stringify(de(dormidoYDespierto, P_D)))

    const quitar = (s: TabsState, ruta: string, profileId = 'alfa'): TabsState => run(s, [{ type: 'quitarAgenteDiferido', profileId, projectHostPath: ruta }])
    const sinMarca = quitar(conMarca, P_D)
    check('(15d) quitarAgenteDiferido la quita (sin dejar la clave) y no toca nada más', de(sinMarca, P_D) !== undefined && !('agenteDiferido' in de(sinMarca, P_D)!) && sinMarca.byProfile.alfa.activePath === conMarca.byProfile.alfa.activePath && de(sinMarca, P_A) === de(conMarca, P_A), JSON.stringify(de(sinMarca, P_D)))
    check('(15e) sin marca, sin proyecto o sin perfil: el MISMO state', quitar(sinMarca, P_D) === sinMarca && quitar(conMarca, P_A) === conMarca && quitar(conMarca, 'C:\\no') === conMarca && quitar(conMarca, P_D, 'no-existe') === conMarca, 'same')

    const cerradoYReabierto = abrir(run(conMarca, [{ type: 'closeProject', profileId: 'alfa', projectHostPath: P_D }]), P_D)
    check('(15f) cerrar y abrir de nuevo (sin la opción) no arrastra la marca', de(cerradoYReabierto, P_D)?.agenteDiferido === undefined, 'sin marca')
    const reemplazado = run(conMarca, [{ type: 'replaceProject', profileId: 'alfa', oldPath: P_D, project: { projectHostPath: P_NEW, name: 'nuevo' } }])
    check('(15f.2) reemplazarlo por otro tampoco', de(reemplazado, P_NEW)?.agenteDiferido === undefined, 'sin marca')
  }

  // --- (11) selectAllOpenTargets: aplana TODOS los perfiles (A2) ------------
  hr('(11) selectAllOpenTargets aplana los targets de agente abiertos de TODOS los perfiles')

  check(
    '(11a) sin proyectos abiertos -> lista vacía',
    selectAllOpenTargets(base, PROFILES).length === 0,
    `len=${selectAllOpenTargets(base, PROFILES).length}`
  )

  const T1 = 'C:\\p\\uno'
  const T2 = 'C:\\p\\dos'
  const twoProj = run(base, [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: T1, name: 'uno' } },
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: T2, name: 'dos' } }
  ])
  const t2 = selectAllOpenTargets(twoProj, PROFILES)
  check(
    '(11b) 1 perfil con 2 proyectos -> 4 targets (2 proyectos × 2 agentes fijos) con keys distintas',
    t2.length === 4 &&
      t2.every((t) => t.profileId === 'alfa') &&
      new Set(t2.map((t) => t.key)).size === 4 &&
      t2.some((t) => t.key === 'alfa|C:\\p\\uno|claude-code') &&
      t2.some((t) => t.key === 'alfa|C:\\p\\uno|codex') &&
      t2.some((t) => t.key === 'alfa|C:\\p\\dos|claude-code') &&
      t2.some((t) => t.key === 'alfa|C:\\p\\dos|codex'),
    JSON.stringify(t2.map((t) => t.key))
  )

  const bothProfiles = run(twoProj, [
    { type: 'openProject', profileId: 'beta', project: { projectHostPath: 'C:\\p\\alfa1', name: 'alfa1' } }
  ])
  const tBoth = selectAllOpenTargets(bothProfiles, PROFILES)
  check(
    '(11c) 2 perfiles con proyectos -> targets de AMBOS (6 = 3 proyectos × 2 agentes); activo sigue alfa',
    bothProfiles.activeProfileId === 'alfa' &&
      tBoth.length === 6 &&
      tBoth.some((t) => t.profileId === 'alfa') &&
      tBoth.some((t) => t.profileId === 'beta'),
    `activo=${bothProfiles.activeProfileId} perfiles=${[...new Set(tBoth.map((t) => t.profileId))].join(',')} len=${tBoth.length}`
  )

  check(
    '(11d) un perfil sin proyectos abiertos no aporta targets',
    selectAllOpenTargets(twoProj, PROFILES).every((t) => t.profileId !== 'beta'),
    'beta sin proyectos -> 0 de sus targets'
  )

  const MULTI: Profile = {
    id: 'multi',
    nombre: 'MULTI',
    color: '#112233',
    agentes: [
      { tipo: 'claude-code', configDir: './c' },
      { tipo: 'codex', configDir: './x' }
    ],
    sandbox: { habilitado: false }
  }
  const multiState = run(initialTabsState([MULTI], 'multi'), [
    { type: 'openProject', profileId: 'multi', project: { projectHostPath: 'C:\\p\\m', name: 'm' } }
  ])
  const tMulti = selectAllOpenTargets(multiState, [MULTI])
  check(
    '(11e) perfil con 2 agentes -> 2 targets (uno por agente: claude-code y codex)',
    tMulti.length === 2 &&
      tMulti.some((t) => t.agente === 'claude-code') &&
      tMulti.some((t) => t.agente === 'codex') &&
      tMulti.every((t) => t.projectHostPath === 'C:\\p\\m'),
    JSON.stringify(tMulti.map((t) => t.agente))
  )

  // --- (12) HIBERNACIÓN: solo por PERFIL (la de proyecto se retiró) + despertar --
  hr('(12) hibernateProfile marca todos sus proyectos; entrar despierta (flip a active)')
  const H1 = 'C:\\h\\uno'
  const H2 = 'C:\\h\\dos'
  const HT = 'C:\\h\\tres'
  // alfa con dos proyectos (uno activo dos), beta con uno.
  const hibBase = run(initialTabsState(PROFILES, 'alfa'), [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: H1, name: 'uno' } },
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: H2, name: 'dos' } },
    { type: 'openProject', profileId: 'beta', project: { projectHostPath: HT, name: 'tres' } }
  ])
  check(
    '(12a) al abrir, todos arrancan estado active',
    hibBase.byProfile.alfa.openProjects.every((p) => p.estado === 'active') &&
      hibBase.byProfile.beta.openProjects.every((p) => p.estado === 'active'),
    JSON.stringify(hibBase.byProfile.alfa.openProjects.map((p) => p.estado))
  )

  const hibProf = run(hibBase, [{ type: 'hibernateProfile', profileId: 'alfa' }])
  check(
    '(12c) hibernateProfile marca TODOS los de alfa; beta NO se toca (aislado)',
    hibProf.byProfile.alfa.openProjects.every((p) => p.estado === 'hibernated') &&
      hibProf.byProfile.beta.openProjects.every((p) => p.estado === 'active'),
    `alfa=${JSON.stringify(hibProf.byProfile.alfa.openProjects.map((p) => p.estado))} beta=${JSON.stringify(hibProf.byProfile.beta.openProjects.map((p) => p.estado))}`
  )

  // Entrar a H1 (hibernado) lo DESPIERTA (flip a active) SOLO a él; H2 sigue hibernado.
  // Es la única vía de tener un estado MIXTO ahora: despertar deja hermanos dormidos.
  const woke = run(hibProf, [{ type: 'setActiveProject', profileId: 'alfa', projectHostPath: H1 }])
  check(
    '(12d) entrar (setActiveProject) a un proyecto hibernado lo despierta (flip a active) y lo activa',
    woke.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H1)?.estado === 'active' &&
      woke.byProfile.alfa.activePath === H1 &&
      woke.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H2)?.estado === 'hibernated',
    `H1=${woke.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H1)?.estado} activo=${woke.byProfile.alfa.activePath}`
  )

  // `wakeProject` es la MITAD de eso: despierta sin activar. Lo usa el mosaico, donde
  // traer un proyecto dormido a una casilla no debe mover dónde aterriza la vista
  // normal de ese perfil (ni, si es el activo, el objetivo de git).
  const soloDespierto = run(hibProf, [{ type: 'wakeProject', profileId: 'alfa', projectHostPath: H1 }])
  check(
    '(12e) wakeProject despierta H1 y NO toca el activo del perfil',
    soloDespierto.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H1)?.estado === 'active' &&
      soloDespierto.byProfile.alfa.activePath === hibProf.byProfile.alfa.activePath &&
      soloDespierto.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H2)?.estado === 'hibernated',
    `H1=${soloDespierto.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H1)?.estado} activo=${soloDespierto.byProfile.alfa.activePath}`
  )
  check(
    '(12e2) wakeProject sobre uno ya despierto (o no abierto) -> MISMA referencia',
    run(soloDespierto, [{ type: 'wakeProject', profileId: 'alfa', projectHostPath: H1 }]) === soloDespierto &&
      run(soloDespierto, [{ type: 'wakeProject', profileId: 'alfa', projectHostPath: 'C:\\no\\existe' }]) ===
        soloDespierto,
    'sin cambios'
  )

  // Entrar a un PERFIL despierta su proyecto ACTIVO (dot deja de estar gris).
  // hibProf tiene alfa totalmente hibernado (activo H2). Salir a beta y volver a alfa.
  const backToAlfa = run(hibProf, [
    { type: 'setActiveProfile', profileId: 'beta' },
    { type: 'setActiveProfile', profileId: 'alfa' }
  ])
  check(
    '(12f) setActiveProfile despierta el proyecto ACTIVO del perfil al entrar (H2 activo -> active)',
    backToAlfa.activeProfileId === 'alfa' &&
      backToAlfa.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H2)?.estado === 'active' &&
      backToAlfa.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H1)?.estado === 'hibernated',
    `H2=${backToAlfa.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H2)?.estado} H1=${backToAlfa.byProfile.alfa.openProjects.find((p) => p.projectHostPath === H1)?.estado}`
  )

  // (12g) selectHibernatedTargetKeys sobre el estado MIXTO `woke`: solo alfa/H2 sigue
  // hibernado (H1 despierto) -> sus 2 agentes; H1 y beta fuera.
  const hibKeys = selectHibernatedTargetKeys(woke, PROFILES)
  check(
    '(12g) selectHibernatedTargetKeys (mixto): alfa/H2 hibernado -> sus 2 agentes; H1 y beta fuera',
    hibKeys.size === 2 &&
      hibKeys.has(agentTargetKey('alfa', H2, 'claude-code')) &&
      hibKeys.has(agentTargetKey('alfa', H2, 'codex')) &&
      !hibKeys.has(agentTargetKey('alfa', H1, 'claude-code')) &&
      !hibKeys.has(agentTargetKey('beta', HT, 'claude-code')),
    `keys=${JSON.stringify([...hibKeys])}`
  )
  // Perfil entero hibernado -> sus 2 proyectos × 2 agentes = 4 targets; beta ausente.
  const hibProfKeys = selectHibernatedTargetKeys(hibProf, PROFILES)
  check(
    '(12h) perfil hibernado entero -> sus 2 proyectos × 2 agentes = 4 targets; otro perfil fuera',
    hibProfKeys.size === 4 &&
      hibProfKeys.has(agentTargetKey('alfa', H1, 'claude-code')) &&
      hibProfKeys.has(agentTargetKey('alfa', H1, 'codex')) &&
      hibProfKeys.has(agentTargetKey('alfa', H2, 'claude-code')) &&
      hibProfKeys.has(agentTargetKey('alfa', H2, 'codex')) &&
      !hibProfKeys.has(agentTargetKey('beta', HT, 'claude-code')),
    `keys=${JSON.stringify([...hibProfKeys])}`
  )

  // ---------------------------------------------------------------------------
  // (13) EL OBJETIVO DE GIT: identidad SÍNCRONA del perfil mostrado, y la puerta
  //      de "pedir". Es lo que quita el parpadeo al cambiar de perfil: la vista
  //      deja de derivar su identidad del objetivo CONFIRMADO (que llega tras un
  //      round-trip) y pasa a derivarla de aquí, que cambia con el clic.
  // ---------------------------------------------------------------------------
  hr('(13) selectObjetivoGit / backendAnclado / reposHuerfanos')

  const O_ALFA = 'C:\\p\\alfa-proj'
  const O_BETA = 'C:\\p\\beta-proj'
  const O_ALFA_REPO = 'C:\\p\\alfa-proj\\uno'
  const O_BETA_REPO = 'C:\\p\\beta-proj\\dos'

  // Los dos perfiles con proyecto abierto y escaneado; el ACTIVO es 'alfa'.
  const dosPerfiles = run(initialTabsState(PROFILES, 'alfa'), [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: O_ALFA, name: 'alfa-proj' } },
    { type: 'openProject', profileId: 'beta', project: { projectHostPath: O_BETA, name: 'beta-proj' } },
    {
      type: 'setScannedRepos',
      profileId: 'alfa',
      projectHostPath: O_ALFA,
      repos: [repo('uno', O_ALFA_REPO, false)]
    },
    {
      type: 'setScannedRepos',
      profileId: 'beta',
      projectHostPath: O_BETA,
      repos: [repo('dos', O_BETA_REPO, false)]
    }
  ])

  // (13a) LO ESENCIAL: se puede preguntar por un perfil que NO es el activo. Sin
  // esto no hay forma de pintar el perfil al que llegas antes de que el backend
  // confirme, que es el arreglo entero.
  const objBeta = selectObjetivoGit(dosPerfiles, 'beta')
  check(
    '(13a) selectObjetivoGit da el objetivo de un perfil que NO es el activo',
    objBeta?.profileId === 'beta' &&
      objBeta.project.projectHostPath === O_BETA &&
      objBeta.repo?.repoHostPath === O_BETA_REPO,
    JSON.stringify(objBeta)
  )

  const objMostrado = selectObjetivoGitMostrado(dosPerfiles)
  check(
    '(13b) selectObjetivoGitMostrado sigue al perfil activo',
    objMostrado?.profileId === 'alfa' && objMostrado.repo?.repoHostPath === O_ALFA_REPO,
    JSON.stringify(objMostrado)
  )

  // (13c) Perfil sin proyecto abierto -> null (y NO un objetivo a medias).
  check(
    '(13c) perfil sin proyecto abierto -> null',
    selectObjetivoGit(dosPerfiles, 'nadie') === null &&
      selectObjetivoGit(initialTabsState(PROFILES, 'alfa'), 'alfa') === null,
    'ambos null'
  )

  // (13d) LA DISTINCIÓN QUE MÁS SE ROMPE: "no se sabe" (null) vs "se sabe y no
  // hay" ([]). Colapsarlas hace que la UI diga "esto no es un repositorio de git"
  // mientras todavía está escaneando.
  const sinEscanear = run(initialTabsState(PROFILES, 'alfa'), [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: O_ALFA, name: 'alfa-proj' } }
  ])
  const escaneadoVacio = run(sinEscanear, [
    { type: 'setScannedRepos', profileId: 'alfa', projectHostPath: O_ALFA, repos: [] }
  ])
  const oSin = selectObjetivoGit(sinEscanear, 'alfa')
  const oVacio = selectObjetivoGit(escaneadoVacio, 'alfa')
  check(
    '(13d) repos: null (escaneo en vuelo) y [] (sin repos) NO se colapsan',
    oSin?.repos === null && oSin.repo === null && oVacio?.repos?.length === 0 && oVacio.repo === null,
    `sinEscanear.repos=${JSON.stringify(oSin?.repos)} escaneadoVacio.repos=${JSON.stringify(oVacio?.repos)}`
  )

  // (13e) LA PUERTA DE PEDIR. Este es el test que garantiza que no se puede
  // preguntar al backend antes de que se haya re-apuntado: `ctxForRepo` rechazaría
  // el repo y contestaría VACÍO, que es indistinguible de "repo sin commits" — y
  // además se cachearía.
  const confirmadoAlfa = {
    profileId: 'alfa',
    project: { projectHostPath: O_ALFA },
    repo: { repoHostPath: O_ALFA_REPO }
  }
  check(
    '(13e) backendAnclado: false con el confirmado de OTRO perfil',
    backendAnclado(objBeta, confirmadoAlfa) === false,
    'objetivo=beta confirmado=alfa -> false'
  )
  check(
    '(13f) backendAnclado: false con otro proyecto y con otro repo del mismo perfil',
    backendAnclado(objMostrado, {
      profileId: 'alfa',
      project: { projectHostPath: 'C:\\p\\otro' },
      repo: { repoHostPath: O_ALFA_REPO }
    }) === false &&
      backendAnclado(objMostrado, {
        profileId: 'alfa',
        project: { projectHostPath: O_ALFA },
        repo: { repoHostPath: 'C:\\p\\otro-repo' }
      }) === false,
    'ambos false'
  )
  check(
    '(13g) backendAnclado: true solo cuando perfil, proyecto y repo coinciden',
    backendAnclado(objMostrado, confirmadoAlfa) === true,
    'true'
  )
  check(
    '(13h) backendAnclado: false si falta cualquiera de los dos lados',
    backendAnclado(objMostrado, null) === false && backendAnclado(null, confirmadoAlfa) === false,
    'ambos false'
  )
  // Sin repo escaneado en los dos lados, el objetivo es la contenedora: eso SÍ
  // está anclado (es el caso de un proyecto que aún no ha escaneado).
  check(
    '(13i) backendAnclado: true con repo null en ambos lados (contenedora)',
    backendAnclado(oSin, { profileId: 'alfa', project: { projectHostPath: O_ALFA }, repo: null }) === true,
    'true'
  )

  // (13j) "El proyecto ya no está" se resuelve SOLO, porque el objetivo es
  // derivado: cerrarlo lo saca del modelo y con él del objetivo.
  const cerrado = run(dosPerfiles, [
    { type: 'closeProject', profileId: 'alfa', projectHostPath: O_ALFA }
  ])
  check(
    '(13j) cerrar el proyecto lo saca del objetivo (no hay memoria que invalidar)',
    selectObjetivoGit(cerrado, 'alfa') === null,
    'null tras closeProject'
  )

  // ---------------------------------------------------------------------------
  // (14) AGENTE HIBERNADO por inactividad: solo el agente, no el proyecto entero.
  // ---------------------------------------------------------------------------
  hr("(14) hibernarAgentes: 'active' -> 'agente-hibernado', y cada despertar lo devuelve")
  const I1 = 'C:\\inactivo\\uno'
  const I2 = 'C:\\inactivo\\dos'
  const dosAbiertos = run(base, [
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: I1, name: 'uno' } },
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: I2, name: 'dos' } }
  ])
  const estadoDe = (s: TabsState, ruta: string): string | undefined =>
    s.byProfile.alfa.openProjects.find((p) => p.projectHostPath === ruta)?.estado
  const dormido = run(dosAbiertos, [{ type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: I1 }])
  check(
    "(14a) marca SOLO ese proyecto, y no cambia el activo",
    estadoDe(dormido, I1) === 'agente-hibernado' && estadoDe(dormido, I2) === 'active' && dormido.byProfile.alfa.activePath === I2,
    `uno=${estadoDe(dormido, I1)} dos=${estadoDe(dormido, I2)} activo=${dormido.byProfile.alfa.activePath}`
  )
  check(
    '(14b) repetirla, o pedirla para un proyecto o un perfil que no existen, devuelve el MISMO estado',
    run(dormido, [{ type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: I1 }]) === dormido &&
      run(dormido, [{ type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: 'C:\\no\\existe' }]) === dormido &&
      run(dormido, [{ type: 'hibernarAgentes', profileId: 'nadie', projectHostPath: I1 }]) === dormido,
    'misma referencia'
  )
  const perfilDormido = run(dosAbiertos, [{ type: 'hibernateProfile', profileId: 'alfa' }])
  check(
    "(14c) NO rebaja un 'hibernated' (ahí también murió la terminal)",
    run(perfilDormido, [{ type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: I1 }]) === perfilDormido,
    `uno=${estadoDe(perfilDormido, I1)}`
  )
  const despertares: Array<[string, TabsAction]> = [
    ['setActiveProject', { type: 'setActiveProject', profileId: 'alfa', projectHostPath: I1 }],
    ['wakeProject', { type: 'wakeProject', profileId: 'alfa', projectHostPath: I1 }],
    ['openProject', { type: 'openProject', profileId: 'alfa', project: { projectHostPath: I1, name: 'uno' } }]
  ]
  const trasDespertar = despertares.map(([nombre, accion]) => `${nombre}=${estadoDe(run(dormido, [accion]), I1)}`)
  check(
    "(14d) activarlo, despertarlo o reabrirlo lo devuelven a 'active'",
    trasDespertar.every((t) => t.endsWith('=active')),
    trasDespertar.join(' ')
  )
  // El activo es I2: se duerme el ACTIVO y entrar al perfil lo despierta.
  const activoDormido = run(dosAbiertos, [
    { type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: I2 },
    { type: 'setActiveProfile', profileId: 'beta' },
    { type: 'setActiveProfile', profileId: 'alfa' }
  ])
  check("(14e) entrar a su perfil despierta su proyecto activo", estadoDe(activoDormido, I2) === 'active', `dos=${estadoDe(activoDormido, I2)}`)
  const conPerfil = run(dormido, [{ type: 'hibernateProfile', profileId: 'alfa' }])
  check(
    "(14f) hibernar el perfil lo convierte en 'hibernated', como a los demás",
    estadoDe(conPerfil, I1) === 'hibernated' && estadoDe(conPerfil, I2) === 'hibernated',
    `uno=${estadoDe(conPerfil, I1)} dos=${estadoDe(conPerfil, I2)}`
  )
  const clavesDormido = selectHibernatedTargetKeys(dormido, PROFILES)
  check(
    '(14g) sus targets de agente cuentan como hibernados (el pane suelta su sesión); los del otro proyecto no',
    clavesDormido.has(agentTargetKey('alfa', I1, 'claude-code')) &&
      clavesDormido.has(agentTargetKey('alfa', I1, 'codex')) &&
      !clavesDormido.has(agentTargetKey('alfa', I2, 'claude-code')),
    `keys=${JSON.stringify([...clavesDormido])}`
  )
  const enteros = selectAllOpenProjects(dormido, PROFILES).filter((p) => p.estado === 'hibernated')
  check(
    "(14h) pero NO es un hibernado ENTERO: la terminal de abajo, que solo mira 'hibernated', lo ignora",
    enteros.length === 0,
    `enteros=${enteros.length}`
  )
  // Lo que queda EN PANTALLA sin pasar por ningún despertar: el heredero de una pestaña cerrada.
  const heredero = run(dormido, [{ type: 'closeProject', profileId: 'alfa', projectHostPath: I2 }])
  check(
    '(14i) cerrar la pestaña activa despierta al heredero que tenía el agente hibernado',
    heredero.byProfile.alfa.activePath === I1 && estadoDe(heredero, I1) === 'active',
    `activo=${heredero.byProfile.alfa.activePath} uno=${estadoDe(heredero, I1)}`
  )
  const enPantalla = run(dosAbiertos, [{ type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: I2 }])
  check(
    '(14j) la propia hibernarAgentes SÍ puede marcar al que está en pantalla (la carrera del orquestador)',
    enPantalla.byProfile.alfa.activePath === I2 && estadoDe(enPantalla, I2) === 'agente-hibernado',
    `dos=${estadoDe(enPantalla, I2)}`
  )
  const enOtroPerfil = run(dormido, [
    { type: 'setActiveProfile', profileId: 'beta' },
    { type: 'closeProject', profileId: 'alfa', projectHostPath: I2 }
  ])
  check(
    '(14k) el heredero de un perfil que NO se está mirando sigue dormido',
    estadoDe(enOtroPerfil, I1) === 'agente-hibernado',
    `uno=${estadoDe(enOtroPerfil, I1)}`
  )
  const trasBorrarPerfil = run(dormido, [
    { type: 'closeProject', profileId: 'alfa', projectHostPath: I2 },
    { type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: I1 },
    { type: 'setActiveProfile', profileId: 'beta' },
    { type: 'deleteProfile', profileId: 'beta' }
  ])
  check(
    '(14l) borrar el perfil activo despierta el proyecto activo del perfil que hereda la pantalla',
    trasBorrarPerfil.activeProfileId === 'alfa' && estadoDe(trasBorrarPerfil, I1) === 'active',
    `perfil=${trasBorrarPerfil.activeProfileId} uno=${estadoDe(trasBorrarPerfil, I1)}`
  )
  const perfilEntero = run(dosAbiertos, [
    { type: 'hibernateProfile', profileId: 'alfa' },
    { type: 'closeProject', profileId: 'alfa', projectHostPath: I2 }
  ])
  check(
    "(14m) un heredero 'hibernated' (perfil entero) no se despierta por aquí",
    estadoDe(perfilEntero, I1) === 'hibernated',
    `uno=${estadoDe(perfilEntero, I1)}`
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
