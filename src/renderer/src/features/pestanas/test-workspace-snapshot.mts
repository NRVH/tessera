#!/usr/bin/env node
// =============================================================================
// Prueba de la persistencia del workspace (node src/renderer/src/features/pestanas/test-workspace-snapshot.mts).
// serializeWorkspace, persistedToProfileTabs y normalizeWorkspaceState son puros y corren bajo `node`; la
// escritura y lectura a disco se replica con node:fs contra un directorio temporal. Cubre: el esqueleto sin
// repoState, el round-trip a disco, la reconstrucción de openProjects y activePath, la proyección incremental
// (no cambia al escanear repos, sí al abrir, cerrar, activar o reordenar), la normalización defensiva y los
// ajustes por perfil: vistas, mosaico, grupos SSH plegados, el riel de conexiones SSH (ancho global y
// visibilidad), el lanzador (las conexiones recientes, y que un archivo con el grupo abierto que ya no se
// guarda se lea sin error) y si se ve el agente de la terminal.
// =============================================================================

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initialTabsState, tabsReducer, type TabsState, type TabsAction } from './tabsModel.ts'
import {
  serializeWorkspace,
  persistedToProfileTabs,
  restoredSessionFromState
} from './workspaceSnapshot.ts'
import {
  clasificarPresencia,
  DEFAULT_SETTINGS,
  DEFAULT_SIDEBAR_WIDTH,
  normalizeWorkspaceState,
  pruneMissingProjects,
  raizDeVolumen,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type PresenciaProyecto,
  type WorkspaceState
} from '../../../../shared/workspace-state-ipc.ts'
import {
  conAgenteTerminalVisible,
  conPlegado,
  conReciente,
  conRielVisible,
  podarMapaPorPerfil,
  podarRecientes,
  SSH_RECIENTES_MAX,
  SSH_RIEL_ANCHO_MAX,
  SSH_RIEL_ANCHO_MIN,
  SSH_RIEL_ANCHO_POR_DEFECTO,
  type AgenteTerminalVisiblePorPerfil,
  type SshGruposPlegadosPorPerfil,
  type SshRecientesPorPerfil,
  type SshRielVisiblePorPerfil
} from '../../../../shared/ajustesTerminal.ts'
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
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function profile(id: string): Profile {
  return {
    id,
    nombre: id.toUpperCase(),
    color: '#61afef',
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: false }
  }
}
function apply(state: TabsState, ...actions: TabsAction[]): TabsState {
  return actions.reduce(tabsReducer, state)
}
const PROFILES = [profile('alfa'), profile('beta')]
const repos = (paths: string[]): DetectedRepo[] =>
  paths.map((p, i) => ({ name: path.basename(p), repoHostPath: p, isRoot: i === 0 }))

// Estado base: 'alfa' con dos proyectos abiertos (B activo), 'beta' con uno.
function baseState(): TabsState {
  let s = initialTabsState(PROFILES, 'alfa')
  s = apply(
    s,
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: 'C:\\proj\\A', name: 'A' } },
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: 'C:\\proj\\B', name: 'B' } },
    { type: 'setActiveProfile', profileId: 'beta' },
    { type: 'openProject', profileId: 'beta', project: { projectHostPath: 'C:\\proj\\C', name: 'C' } },
    { type: 'setActiveProfile', profileId: 'alfa' }
  )
  return s
}

// ---------------------------------------------------------------------------
hr('(1) serialize proyecta SOLO el esqueleto (perfil activo + proyectos + activo)')
// ---------------------------------------------------------------------------
{
  const s = baseState()
  const ws = serializeWorkspace(s)
  check(
    '(1.1) version=1 y activeProfileId es el activo (alfa)',
    ws.version === 1 && ws.activeProfileId === 'alfa',
    `version=${ws.version} activeProfileId=${ws.activeProfileId}`
  )
  check(
    "(1.2) alfa -> [A,B] con activo B; beta -> [C] con activo C",
    eq(ws.byProfile.alfa.openProjects.map((p) => p.projectHostPath), ['C:\\proj\\A', 'C:\\proj\\B']) &&
      ws.byProfile.alfa.activePath === 'C:\\proj\\B' &&
      eq(ws.byProfile.beta.openProjects.map((p) => p.projectHostPath), ['C:\\proj\\C']) &&
      ws.byProfile.beta.activePath === 'C:\\proj\\C',
    JSON.stringify(ws.byProfile)
  )
  check(
    "(1.3) cada proyecto trae name + estado 'active' (default; B1 lo poblará)",
    ws.byProfile.alfa.openProjects.every((p) => p.estado === 'active' && typeof p.name === 'string'),
    JSON.stringify(ws.byProfile.alfa.openProjects)
  )
  // Escanear repos rellena repoState (nivel 3); serialize NO debe reflejarlo.
  const scanned = apply(s, {
    type: 'setScannedRepos',
    profileId: 'alfa',
    projectHostPath: 'C:\\proj\\B',
    repos: repos(['C:\\proj\\B', 'C:\\proj\\B\\sub'])
  })
  check(
    '(1.4) serialize descarta repoState (no aparece nada de repos en la proyección)',
    !JSON.stringify(serializeWorkspace(scanned)).includes('repoHostPath') &&
      !JSON.stringify(serializeWorkspace(scanned)).includes('sub'),
    'la proyección no contiene repoHostPath ni la subcarpeta escaneada'
  )
}

// ---------------------------------------------------------------------------
hr('(2) ROUND-TRIP A DISCO: escribir estado -> leerlo -> coincide (replica el store)')
// ---------------------------------------------------------------------------
{
  const s = baseState()
  const ws = serializeWorkspace(s)
  // Replica EXACTA de lo que hace saveWorkspaceState/loadWorkspaceState del main,
  // pero contra un tmpdir (sin electron): write JSON -> read -> normalize.
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-ws-'))
  const file = path.join(dir, 'workspace-state.json')
  writeFileSync(file, JSON.stringify(normalizeWorkspaceState(ws), null, 2) + '\n', 'utf-8')
  const readBack = normalizeWorkspaceState(JSON.parse(readFileSync(file, 'utf-8')))
  check(
    '(2.1) el documento releído del disco es IDÉNTICO al normalizado escrito',
    eq(readBack, normalizeWorkspaceState(ws)),
    `disco=${JSON.stringify(readBack)}`
  )
  check(
    '(2.2) sobrevive el activo por perfil y el perfil activo global',
    readBack !== null &&
      readBack.activeProfileId === 'alfa' &&
      readBack.byProfile.alfa.activePath === 'C:\\proj\\B' &&
      readBack.byProfile.beta.activePath === 'C:\\proj\\C',
    JSON.stringify(readBack)
  )
}

// ---------------------------------------------------------------------------
hr('(3) persistedToProfileTabs reconstruye el ProfileTabs (repoState vacío)')
// ---------------------------------------------------------------------------
{
  const ws = serializeWorkspace(baseState())
  const rebuilt = persistedToProfileTabs(ws.byProfile.alfa)
  check(
    '(3.1) openProjects (path+name+estado) y activePath reconstruidos; repoState vacío',
    eq(rebuilt.openProjects, [
      { projectHostPath: 'C:\\proj\\A', name: 'A', estado: 'active' },
      { projectHostPath: 'C:\\proj\\B', name: 'B', estado: 'active' }
    ]) &&
      rebuilt.activePath === 'C:\\proj\\B' &&
      eq(rebuilt.repoState, {}),
    JSON.stringify(rebuilt)
  )
}

// ---------------------------------------------------------------------------
hr('(3b) ESTADO hibernado: serialize/deserialize lo preservan (round-trip)')
// ---------------------------------------------------------------------------
{
  // Estado MIXTO (B hibernado, A activo): hibernar el perfil (ambos hibernated) y
  // despertar A (setActiveProject). Luego serializar -> disco -> restaurar.
  const s = apply(
    baseState(),
    { type: 'hibernateProfile', profileId: 'alfa' },
    { type: 'setActiveProject', profileId: 'alfa', projectHostPath: 'C:\\proj\\A' }
  )
  const ws = serializeWorkspace(s)
  const bPersisted = ws.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\B')
  const aPersisted = ws.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\A')
  check(
    '(3b.1) serialize emite el estado REAL: B hibernated, A active',
    bPersisted?.estado === 'hibernated' && aPersisted?.estado === 'active',
    `A=${aPersisted?.estado} B=${bPersisted?.estado}`
  )
  const rebuilt = persistedToProfileTabs(normalizeWorkspaceState(ws)!.byProfile.alfa)
  const bRebuilt = rebuilt.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\B')
  check(
    '(3b.2) deserialize respeta hibernated (round-trip por normalize + persistedToProfileTabs)',
    bRebuilt?.estado === 'hibernated',
    `B_rebuilt=${bRebuilt?.estado}`
  )
}

// ---------------------------------------------------------------------------
hr('(3c) AGENTE HIBERNADO por inactividad: en disco es un hibernado más')
// ---------------------------------------------------------------------------
{
  const s = apply(baseState(), { type: 'hibernarAgentes', profileId: 'alfa', projectHostPath: 'C:\\proj\\B' })
  const enMemoria = s.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\B')
  const ws = serializeWorkspace(s)
  const enDisco = ws.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\B')
  check(
    "(3c.1) en memoria es 'agente-hibernado' y se guarda como 'hibernated'",
    enMemoria?.estado === 'agente-hibernado' && enDisco?.estado === 'hibernated',
    `memoria=${enMemoria?.estado} disco=${enDisco?.estado}`
  )
  check(
    '(3c.2) el documento guardado pasa el normalizador sin perder el proyecto',
    normalizeWorkspaceState(ws)?.byProfile.alfa.openProjects.length === ws.byProfile.alfa.openProjects.length,
    `proyectos=${normalizeWorkspaceState(ws)?.byProfile.alfa.openProjects.length}`
  )
  const ajuste = (v: unknown): unknown =>
    normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: v === undefined ? {} : { agenteInactividadMin: v } })
      ?.settings?.agenteInactividadMin
  check('(3c.3) el ajuste ausente vale 5 minutos', ajuste(undefined) === 5, String(ajuste(undefined)))
  check('(3c.4) «Nunca» (0) y los valores de la lista se conservan', ajuste(0) === 0 && ajuste(30) === 30, `${ajuste(0)} ${ajuste(30)}`)
  check('(3c.5) la basura cae a 5, nunca a «Nunca»', ajuste(7) === 5 && ajuste('10') === 5 && ajuste(null) === 5, `${ajuste(7)} ${ajuste('10')} ${ajuste(null)}`)
}

// ---------------------------------------------------------------------------
hr('(4) INCREMENTAL: la proyección cambia SOLO en los cambios que deben persistir')
// ---------------------------------------------------------------------------
{
  const s = baseState()
  const j = (st: TabsState): string => JSON.stringify(serializeWorkspace(st))
  const before = j(s)

  const afterScan = apply(s, {
    type: 'setScannedRepos',
    profileId: 'alfa',
    projectHostPath: 'C:\\proj\\B',
    repos: repos(['C:\\proj\\B'])
  })
  check(
    '(4.1) escanear repos NO cambia la proyección (no dispararía escritura)',
    j(afterScan) === before,
    'proyección idéntica tras setScannedRepos'
  )

  const afterOpen = apply(s, {
    type: 'openProject',
    profileId: 'alfa',
    project: { projectHostPath: 'C:\\proj\\D', name: 'D' }
  })
  const afterClose = apply(s, { type: 'closeProject', profileId: 'alfa', projectHostPath: 'C:\\proj\\A' })
  const afterActivate = apply(s, {
    type: 'setActiveProject',
    profileId: 'alfa',
    projectHostPath: 'C:\\proj\\A'
  })
  const afterProfile = apply(s, { type: 'setActiveProfile', profileId: 'beta' })
  check(
    '(4.2) abrir / cerrar / activar proyecto y cambiar de perfil SÍ cambian la proyección',
    j(afterOpen) !== before &&
      j(afterClose) !== before &&
      j(afterActivate) !== before &&
      j(afterProfile) !== before,
    `open≠ ${j(afterOpen) !== before}, close≠ ${j(afterClose) !== before}, ` +
      `activate≠ ${j(afterActivate) !== before}, profile≠ ${j(afterProfile) !== before}`
  )

  const reordenado = apply(s, { type: 'reordenarProyectos', profileId: 'alfa', orderedPaths: ['C:\\proj\\B', 'C:\\proj\\A'] })
  check('(4.3) reordenar los proyectos SÍ cambia la proyección (se guarda)', j(reordenado) !== before, `cambia=${j(reordenado) !== before}`)
  const mismoOrden = apply(s, { type: 'reordenarProyectos', profileId: 'alfa', orderedPaths: ['C:\\proj\\A', 'C:\\proj\\B'] })
  check('(4.4) «reordenar» al mismo orden no cambia nada (mismo state, misma proyección)', mismoOrden === s && j(mismoOrden) === before, 'same')
}

// ---------------------------------------------------------------------------
hr('(4c) La marca de AGENTE DIFERIDO se guarda con el proyecto y vuelve al restaurar')
// ---------------------------------------------------------------------------
{
  const j = (st: TabsState): string => JSON.stringify(serializeWorkspace(st))
  const base = baseState()
  const D = 'C:\\proj\\suelto'
  const conMarca = apply(base, { type: 'openProject', profileId: 'alfa', project: { projectHostPath: D, name: 'suelto' }, agenteDiferido: true })
  const sinMarca = apply(base, { type: 'openProject', profileId: 'alfa', project: { projectHostPath: D, name: 'suelto' } })
  const ws = serializeWorkspace(conMarca)
  const guardado = ws.byProfile.alfa.openProjects.find((p) => p.projectHostPath === D)
  check('(4c.1) serialize escribe `agenteDiferido: true` en el proyecto marcado', guardado?.agenteDiferido === true, JSON.stringify(guardado))
  check(
    '(4c.2) un proyecto sin marca no lleva la clave: su JSON es el de siempre',
    !j(sinMarca).includes('agenteDiferido') && j(base) === JSON.stringify(serializeWorkspace(baseState())),
    'sin clave'
  )
  check('(4c.3) poner la marca cambia la proyección (se guarda)', j(conMarca) !== j(sinMarca), 'distinta')
  const quitada = apply(conMarca, { type: 'quitarAgenteDiferido', profileId: 'alfa', projectHostPath: D })
  check('(4c.4) y quitarla también, dejándola igual que si nunca la hubo', j(quitada) !== j(conMarca) && j(quitada) === j(sinMarca), 'vuelve a la de sin marca')

  const leido = normalizeWorkspaceState(JSON.parse(JSON.stringify(normalizeWorkspaceState(ws))))
  const podado = leido === null ? null : pruneMissingProjects(leido, () => 'presente')
  const restaurado = initialTabsState(PROFILES, undefined, restoredSessionFromState(podado))
  const vuelto = restaurado.byProfile.alfa.openProjects.find((p) => p.projectHostPath === D)
  check('(4c.5) guardar, normalizar, podar y restaurar conserva la marca', vuelto?.agenteDiferido === true, JSON.stringify(vuelto))
  check('(4c.6) y los demás proyectos vuelven sin ella', restaurado.byProfile.alfa.openProjects.filter((p) => p.agenteDiferido).length === 1, 'solo uno')

  const raro = (valor: unknown): boolean => {
    const doc = normalizeWorkspaceState({
      version: 1,
      activeProfileId: 'alfa',
      byProfile: { alfa: { openProjects: [{ projectHostPath: D, name: 'suelto', estado: 'active', agenteDiferido: valor }], activePath: D } }
    })
    return doc !== null && 'agenteDiferido' in doc.byProfile.alfa.openProjects[0]
  }
  check(
    '(4c.7) normalize solo acepta `true`: false, "true", 1 y null quedan como ausente',
    raro(true) && !raro(false) && !raro('true') && !raro(1) && !raro(null),
    'solo true'
  )
}

// ---------------------------------------------------------------------------
hr('(4b) EL ORDEN de los proyectos sobrevive a guardar, podar y restaurar')
// ---------------------------------------------------------------------------
{
  const s = apply(baseState(), { type: 'reordenarProyectos', profileId: 'alfa', orderedPaths: ['C:\\proj\\B', 'C:\\proj\\A'] })
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-ws-'))
  const file = path.join(dir, 'workspace-state.json')
  writeFileSync(file, JSON.stringify(normalizeWorkspaceState(serializeWorkspace(s)), null, 2) + '\n', 'utf-8')
  const leido = normalizeWorkspaceState(JSON.parse(readFileSync(file, 'utf-8')))
  const podado = leido === null ? null : pruneMissingProjects(leido, () => 'presente')
  const restaurado = initialTabsState(PROFILES, undefined, restoredSessionFromState(podado))
  const rutas = (id: string): string[] => restaurado.byProfile[id].openProjects.map((p) => p.projectHostPath)
  check(
    '(4b.1) el perfil reordenado vuelve en su orden nuevo, con el mismo activo',
    eq(rutas('alfa'), ['C:\\proj\\B', 'C:\\proj\\A']) && restaurado.byProfile.alfa.activePath === 'C:\\proj\\B',
    `alfa=${JSON.stringify(rutas('alfa'))} activo=${restaurado.byProfile.alfa.activePath}`
  )
  check('(4b.2) el otro perfil queda como estaba', eq(rutas('beta'), ['C:\\proj\\C']), JSON.stringify(rutas('beta')))
}

// ---------------------------------------------------------------------------
hr('(5) normalize DEFENSIVO (robusto a cierre sucio / archivo corrupto)')
// ---------------------------------------------------------------------------
{
  const raw = {
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {
      alfa: {
        activePath: 'C:\\ghost', // fantasma: no está en openProjects -> se corrige
        openProjects: [
          { projectHostPath: 'C:\\proj\\A', name: 'A', estado: 'hibernated' },
          { projectHostPath: 'C:\\proj\\B' }, // sin name/estado -> defaults
          { name: 'sin-path' }, // sin path -> descartado
          { projectHostPath: 'C:\\proj\\A', name: 'dup' } // duplicado -> descartado
        ]
      },
      vacio: { openProjects: [] } // perfil sin proyectos -> se omite
    }
  }
  const n = normalizeWorkspaceState(raw)
  check(
    '(5.1) descarta proyecto sin path y el duplicado (quedan A y B)',
    n !== null &&
      eq(n.byProfile.alfa.openProjects.map((p) => p.projectHostPath), ['C:\\proj\\A', 'C:\\proj\\B']),
    JSON.stringify(n?.byProfile.alfa.openProjects)
  )
  check(
    "(5.2) estado preservado (A hibernated) y default 'active' (B); name derivado del path",
    n !== null &&
      n.byProfile.alfa.openProjects[0].estado === 'hibernated' &&
      n.byProfile.alfa.openProjects[1].estado === 'active' &&
      n.byProfile.alfa.openProjects[1].name === 'B',
    JSON.stringify(n?.byProfile.alfa.openProjects)
  )
  check(
    '(5.3) activePath fantasma corregido al primer proyecto; perfil vacío omitido',
    n !== null && n.byProfile.alfa.activePath === 'C:\\proj\\A' && n.byProfile.vacio === undefined,
    `activePath=${n?.byProfile.alfa.activePath} vacio=${JSON.stringify(n?.byProfile.vacio)}`
  )
  check(
    '(5.4) basura total (no-objeto) -> null (el store lo trata como arranque limpio)',
    normalizeWorkspaceState('nope') === null && normalizeWorkspaceState(null) === null,
    'string y null devuelven null'
  )
}

// ---------------------------------------------------------------------------
hr('(6) RESTAURACIÓN: reconciliar estado persistido con los perfiles ACTUALES')
// ---------------------------------------------------------------------------
{
  // Estado persistido con 3 perfiles: alfa (A,B activo B), beta (C), y un ghost que
  // ya no existe; el activo global persistido es 'beta'.
  const persisted: WorkspaceState = {
    version: 1,
    activeProfileId: 'beta',
    byProfile: {
      alfa: {
        openProjects: [
          { projectHostPath: 'C:\\proj\\A', name: 'A', estado: 'hibernated' }, // amanece hibernado
          { projectHostPath: 'C:\\proj\\B', name: 'B', estado: 'active' }
        ],
        activePath: 'C:\\proj\\B'
      },
      beta: {
        openProjects: [{ projectHostPath: 'C:\\proj\\C', name: 'C', estado: 'active' }],
        activePath: 'C:\\proj\\C'
      },
      ghost: {
        openProjects: [{ projectHostPath: 'C:\\proj\\Z', name: 'Z', estado: 'active' }],
        activePath: 'C:\\proj\\Z'
      }
    }
  }
  const restored = restoredSessionFromState(persisted)

  // Perfiles ACTUALES: alfa + gamma. beta fue BORRADO; ghost nunca existió; gamma es
  // nuevo (sin entrada persistida).
  const current = [profile('alfa'), profile('gamma')]
  const st = initialTabsState(current, 'alfa', restored)

  check(
    '(6.1) perfil borrado (beta) y ghost descartados: byProfile solo tiene perfiles actuales',
    eq(Object.keys(st.byProfile).sort(), ['alfa', 'gamma']),
    `keys=${JSON.stringify(Object.keys(st.byProfile))}`
  )
  check(
    '(6.2) alfa se restaura (A,B activo B); gamma (actual sin entrada) arranca vacío',
    eq(st.byProfile.alfa.openProjects.map((p) => p.projectHostPath), ['C:\\proj\\A', 'C:\\proj\\B']) &&
      st.byProfile.alfa.activePath === 'C:\\proj\\B' &&
      eq(st.byProfile.gamma.openProjects, []) &&
      st.byProfile.gamma.activePath === null,
    `alfa=${JSON.stringify(st.byProfile.alfa)} gamma=${JSON.stringify(st.byProfile.gamma)}`
  )
  check(
    '(6.2b) la restauración RESPETA el estado: A amanece hibernated, B active',
    st.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\A')?.estado === 'hibernated' &&
      st.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\B')?.estado === 'active',
    JSON.stringify(st.byProfile.alfa.openProjects.map((p) => ({ p: p.projectHostPath, e: p.estado })))
  )
  check(
    '(6.3) repoState restaurado VACÍO (se re-escanea perezoso al activar)',
    eq(st.byProfile.alfa.repoState, {}),
    JSON.stringify(st.byProfile.alfa.repoState)
  )
  check(
    "(6.4) activo persistido inválido (beta borrado) -> fallback al preferido 'alfa'",
    st.activeProfileId === 'alfa',
    `activeProfileId=${st.activeProfileId}`
  )

  // Mismo estado pero con beta AÚN presente: el activo persistido SÍ se respeta.
  const withBeta = initialTabsState([profile('alfa'), profile('beta')], 'alfa', restored)
  check(
    '(6.5) activo persistido válido (beta presente) -> se restaura como activo',
    withBeta.activeProfileId === 'beta' &&
      eq(withBeta.byProfile.beta.openProjects.map((p) => p.projectHostPath), ['C:\\proj\\C']),
    `activeProfileId=${withBeta.activeProfileId}`
  )
  // POLÍTICA DE ARRANQUE: con beta activo, SOLO su proyecto activo (C) queda
  // 'active'; los proyectos de alfa (otro perfil), incluido B que se persistió
  // 'active', amanecen 'hibernated'. Solo se enciende un proyecto al abrir.
  check(
    '(6.5b) arranque: solo el proyecto activo del perfil activo (beta/C) queda active; el resto hibernado',
    withBeta.byProfile.beta.openProjects[0].estado === 'active' &&
      withBeta.byProfile.alfa.openProjects.every((p) => p.estado === 'hibernated'),
    `beta/C=${withBeta.byProfile.beta.openProjects[0].estado} alfa=${JSON.stringify(withBeta.byProfile.alfa.openProjects.map((p) => p.estado))}`
  )

  // Estado null (sin archivo / corrupto): arranque limpio como hoy.
  const empty = initialTabsState([profile('alfa'), profile('beta')], 'alfa', restoredSessionFromState(null))
  check(
    '(6.6) estado null -> byProfile vacío por perfil y activo por defecto (preferido)',
    eq(empty.byProfile.alfa.openProjects, []) &&
      eq(empty.byProfile.beta.openProjects, []) &&
      empty.activeProfileId === 'alfa',
    `active=${empty.activeProfileId} alfa=${JSON.stringify(empty.byProfile.alfa.openProjects)}`
  )
}

// ---------------------------------------------------------------------------
hr('(7) RESTAURACIÓN: pruneMissingProjects descarta rutas inexistentes en disco')
// ---------------------------------------------------------------------------
{
  const ws: WorkspaceState = {
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {
      alfa: {
        openProjects: [
          { projectHostPath: 'C:\\vive\\A', name: 'A', estado: 'active' },
          { projectHostPath: 'C:\\borrada\\B', name: 'B', estado: 'active' },
          { projectHostPath: 'C:\\borrada\\C', name: 'C', estado: 'active' }
        ],
        activePath: 'C:\\borrada\\C' // el activo apunta a una carpeta borrada
      },
      x: {
        openProjects: [{ projectHostPath: 'C:\\borrada\\Z', name: 'Z', estado: 'active' }],
        activePath: 'C:\\borrada\\Z'
      }
    }
  }
  // Fake: solo las rutas bajo C:\vive existen; las demás se han comprobado y NO están.
  const presencia = (p: string): PresenciaProyecto =>
    p.startsWith('C:\\vive') ? 'presente' : 'ausente'
  const pruned = pruneMissingProjects(ws, presencia)

  check(
    '(7.1) alfa conserva solo A (viva); B y C (borradas) descartadas',
    eq(pruned.byProfile.alfa.openProjects.map((p) => p.projectHostPath), ['C:\\vive\\A']),
    JSON.stringify(pruned.byProfile.alfa.openProjects)
  )
  check(
    '(7.2) activo apuntaba a una borrada (C) -> cae al primer superviviente (A)',
    pruned.byProfile.alfa.activePath === 'C:\\vive\\A',
    `activePath=${pruned.byProfile.alfa.activePath}`
  )
  check(
    '(7.3) perfil x, con todas sus rutas borradas, se omite entero',
    pruned.byProfile.x === undefined,
    `x=${JSON.stringify(pruned.byProfile.x)}`
  )

  // END-TO-END: prune -> restoredSessionFromState -> initialTabsState no revive nada.
  const st = initialTabsState([profile('alfa'), profile('x')], 'alfa', restoredSessionFromState(pruned))
  check(
    '(7.4) end-to-end: tras podar, initialTabsState restaura solo A y x queda vacío',
    eq(st.byProfile.alfa.openProjects.map((p) => p.projectHostPath), ['C:\\vive\\A']) &&
      eq(st.byProfile.x.openProjects, []),
    `alfa=${JSON.stringify(st.byProfile.alfa.openProjects)} x=${JSON.stringify(st.byProfile.x.openProjects)}`
  )

  // -------------------------------------------------------------------------
  // «NO SE PUDO COMPROBAR» NO ES «NO ESTÁ». Es el bug que se llevó por delante los
  // proyectos abiertos del usuario en un Mac: tras actualizar, la app perdía el permiso
  // de TCC sobre `~/Documents` (va atado a la firma, y con ad-hoc cada build tiene otro
  // cdhash), el `stat` devolvía EPERM, el `catch` lo leía como «borrada» y el proyecto
  // desaparecía. Y para SIEMPRE, porque la persistencia es incremental: el primer cambio
  // de UI escribe encima el workspace ya podado. No es sólo de macOS —una unidad de red
  // sin reconectar da el mismo falso positivo en Windows—, así que se prueba con las dos
  // formas de ruta.
  const todoDudoso = pruneMissingProjects(ws, () => 'indeterminada')
  check(
    '(7.5) con TODO indeterminado no se poda NADA: el workspace queda intacto',
    eq(
      todoDudoso.byProfile.alfa.openProjects.map((p) => p.projectHostPath),
      ['C:\\vive\\A', 'C:\\borrada\\B', 'C:\\borrada\\C']
    ) &&
      todoDudoso.byProfile.alfa.activePath === 'C:\\borrada\\C' &&
      todoDudoso.byProfile.x !== undefined,
    JSON.stringify(todoDudoso.byProfile)
  )
  // El caso real, mezclado: una carpeta de verdad borrada Y otra que no se pudo mirar.
  const mezcla = pruneMissingProjects(ws, (p) =>
    p === 'C:\\borrada\\B' ? 'ausente' : p.startsWith('C:\\vive') ? 'presente' : 'indeterminada'
  )
  check(
    '(7.6) sólo cae la que se comprobó ausente; la indeterminada se conserva',
    eq(
      mezcla.byProfile.alfa.openProjects.map((p) => p.projectHostPath),
      ['C:\\vive\\A', 'C:\\borrada\\C']
    ),
    JSON.stringify(mezcla.byProfile.alfa.openProjects)
  )
  check(
    '(7.7) …y el activo indeterminado NO se reasigna: sigue siendo el que era',
    mezcla.byProfile.alfa.activePath === 'C:\\borrada\\C',
    `activePath=${mezcla.byProfile.alfa.activePath}`
  )
  // Rutas POSIX, que es como llegan en Mac (`~/Documents/...` es la carpeta protegida).
  const wsMac: WorkspaceState = {
    version: 1,
    activeProfileId: 'personal',
    byProfile: {
      personal: {
        openProjects: [
          { projectHostPath: '/Users/x/Documents/tessera', name: 'tessera', estado: 'active' }
        ],
        activePath: '/Users/x/Documents/tessera'
      }
    }
  }
  check(
    '(7.8) macOS: un proyecto en ~/Documents que no se pudo comprobar SOBREVIVE',
    eq(
      pruneMissingProjects(wsMac, () => 'indeterminada').byProfile.personal.openProjects.map(
        (p) => p.projectHostPath
      ),
      ['/Users/x/Documents/tessera']
    ),
    JSON.stringify(pruneMissingProjects(wsMac, () => 'indeterminada').byProfile.personal)
  )

  // -------------------------------------------------------------------------
  // LA CLASIFICACIÓN DEL ERRNO, que es la línea cuyo error causó la pérdida. Estaba
  // dentro del `catch` del store y por tanto sin probar: los casos de arriba le dan el
  // veredicto ya hecho. Extraída, se puede fijar la tabla entera.
  check(
    '(7.9) sólo ENOENT y ENOTDIR son ausencia',
    clasificarPresencia('ENOENT') === 'ausente' && clasificarPresencia('ENOTDIR') === 'ausente',
    `ENOENT=${clasificarPresencia('ENOENT')} ENOTDIR=${clasificarPresencia('ENOTDIR')}`
  )
  {
    // EPERM es el del TCC de macOS que provocó el bug; los demás son los que llegan de
    // un share que no responde, un permiso POSIX o un disco con problemas.
    const otros = ['EPERM', 'EACCES', 'ETIMEDOUT', 'EIO', 'EBUSY', 'ELOOP', undefined, null, 44]
    check(
      '(7.10) todo lo demás es indeterminado (EPERM del TCC incluido)',
      otros.every((c) => clasificarPresencia(c) === 'indeterminada'),
      otros.map((c) => `${String(c)}=${clasificarPresencia(c)}`).join(' ')
    )
  }

  // LA RAÍZ DEL VOLUMEN. Desempata el ENOENT ambiguo: un volumen sin montar da ENOENT
  // igual que una carpeta borrada, porque el punto de montaje sólo existe mientras el
  // volumen lo está. Sin esto, abrir Tessera con el disco externo desconectado borraba
  // sus proyectos de la lista para siempre.
  check(
    '(7.11) macOS: /Volumes/<disco>/... -> la raíz del volumen',
    raizDeVolumen('/Volumes/Trabajo/repos/api') === '/Volumes/Trabajo' &&
      raizDeVolumen('/Volumes/Disco con espacios/x') === '/Volumes/Disco con espacios',
    `${raizDeVolumen('/Volumes/Trabajo/repos/api')} | ${raizDeVolumen('/Volumes/Disco con espacios/x')}`
  )
  check(
    '(7.12) volumen del sistema -> null: no hay nada que comprobar',
    raizDeVolumen('/Users/x/Documents/tessera') === null && raizDeVolumen('/opt/cosas') === null,
    `${raizDeVolumen('/Users/x/Documents/tessera')} | ${raizDeVolumen('/opt/cosas')}`
  )
  check(
    '(7.13) Windows: unidad y UNC, clasificadas por la FORMA (se prueba desde un Mac)',
    raizDeVolumen('D:\\proyectos\\api') === 'D:\\' &&
      raizDeVolumen('d:/proyectos/api') === 'd:\\' &&
      raizDeVolumen('\\\\servidor\\recurso\\api') === '\\\\servidor\\recurso',
    `${raizDeVolumen('D:\\proyectos\\api')} | ${raizDeVolumen('d:/proyectos/api')} | ${raizDeVolumen('\\\\servidor\\recurso\\api')}`
  )
}

// ---------------------------------------------------------------------------
hr('(8) SETTINGS globales (zoom): default, saneado/clamp y round-trip')
// ---------------------------------------------------------------------------
{
  // (8.1) Ausente en disco -> normalize rellena el default (zoomLevel 0).
  const noSettings = normalizeWorkspaceState({ version: 1, activeProfileId: 'alfa', byProfile: {} })
  check(
    '(8.1) sin slice settings -> default zoomLevel 0 (nunca undefined)',
    noSettings !== null && noSettings.settings?.zoomLevel === 0,
    `settings=${JSON.stringify(noSettings?.settings)}`
  )

  // (8.2) Valores inválidos / fuera de rango -> saneados (NaN/no-numérico -> 0;
  // fuera de rango -> acotado; decimal -> redondeado).
  const garbage = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: 'mucho' }
  })
  const tooHigh = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: 99 }
  })
  const tooLow = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: -99 }
  })
  const decimal = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: 1.6 }
  })
  check(
    '(8.2) zoomLevel saneado: basura->0, >max->5, <min->-3, decimal->redondeo',
    garbage?.settings?.zoomLevel === 0 &&
      tooHigh?.settings?.zoomLevel === 5 &&
      tooLow?.settings?.zoomLevel === -3 &&
      decimal?.settings?.zoomLevel === 2,
    `garbage=${garbage?.settings?.zoomLevel} high=${tooHigh?.settings?.zoomLevel} ` +
      `low=${tooLow?.settings?.zoomLevel} decimal=${decimal?.settings?.zoomLevel}`
  )

  // (8.3) Round-trip a disco de un zoomLevel válido (replica saveSettings/load).
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-ws-set-'))
  const file = path.join(dir, 'workspace-state.json')
  const doc = normalizeWorkspaceState({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: { zoomLevel: 3 }
  })
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
  const back = normalizeWorkspaceState(JSON.parse(readFileSync(file, 'utf-8')))
  check(
    '(8.3) round-trip: zoomLevel 3 sobrevive escribir->leer->normalize',
    back?.settings?.zoomLevel === 3,
    `back=${JSON.stringify(back?.settings)}`
  )
}

// ---------------------------------------------------------------------------
hr('(9) SETTINGS de LAYOUT: tamaños de panel y colapso del inspector')
// ---------------------------------------------------------------------------
// Los tamaños de los paneles y el colapso por perfil se persisten. Lo que se
// verifica aquí es el SANEADO: un archivo viejo, corrupto o escrito en otro
// monitor no debe restaurar un panel inservible (0 px, 5000 px, vistas basura),
// y el tri-estado del colapso ('open' / 'closed' / AUSENTE) debe sobrevivir el
// round-trip, porque de él depende distinguir "lo cerré yo" de "nunca lo abrí".
{
  const settingsOf = (settings: unknown): Record<string, unknown> | undefined =>
    normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings })
      ?.settings as unknown as Record<string, unknown> | undefined

  // (9.1) Defaults cuando el archivo no trae nada de layout.
  const def = settingsOf(undefined)
  check(
    '(9.1) sin layout en disco -> defaults (lateral vacío, cc 340, terminal 260)',
    JSON.stringify(def?.sidebarWidthByView) === '{}' &&
      def?.ccWidth === 340 &&
      def?.terminalHeight === 260,
    `layout=${JSON.stringify({
      s: def?.sidebarWidthByView,
      cc: def?.ccWidth,
      t: def?.terminalHeight
    })}`
  )

  // (9.2) Anchos del lateral: se acotan a [180,480], se redondean, y se descartan por
  // DOS motivos distintos, que el caso ejercita por separado porque son dos guardas
  // independientes del saneador:
  //   · la CLAVE no es una vista conocida (`fantasma`, y `activity` desde que se
  //     retiró el inspector: un archivo viejo trae su ancho y ya no vale);
  //   · el VALOR no es un número (`db: 'ancho'`, escrito a mano o de otra versión).
  //     Sin una clave válida con basura dentro, quitar esa segunda guarda dejaría
  //     pasar un `clampInt('ancho', …)` -> NaN a la variable CSS del ancho, y esta
  //     prueba seguiría en verde.
  const side = settingsOf({
    sidebarWidthByView: { files: 5, git: 9999, settings: 412.7, db: 'ancho', activity: 300, fantasma: 300 }
  })?.sidebarWidthByView as Record<string, number> | undefined
  check(
    '(9.2) ancho lateral por vista: clamp [180,480], redondeo, clave desconocida fuera y valor no numérico fuera',
    side?.files === 180 &&
      side?.git === 480 &&
      side?.settings === 413 &&
      side?.db === undefined &&
      side?.activity === undefined &&
      side?.fantasma === undefined,
    `side=${JSON.stringify(side)}`
  )

  // (9.3) CC y terminal: clamp a su rango; basura -> default.
  const tight = settingsOf({ ccWidth: 10, terminalHeight: 10 })
  const huge = settingsOf({ ccWidth: 99999, terminalHeight: 99999 })
  const junk = settingsOf({ ccWidth: 'ancho', terminalHeight: null })
  check(
    '(9.3) ccWidth/terminalHeight: acotados a su rango y basura -> default',
    tight?.ccWidth === 330 &&
      tight?.terminalHeight === 140 &&
      huge?.ccWidth === 4000 &&
      huge?.terminalHeight === 640 &&
      junk?.ccWidth === 340 &&
      junk?.terminalHeight === 260,
    `tight=${tight?.ccWidth}/${tight?.terminalHeight} huge=${huge?.ccWidth}/${huge?.terminalHeight} ` +
      `junk=${junk?.ccWidth}/${junk?.terminalHeight}`
  )

  // (9.3b) Anchos de las columnas del panel Git·Log: mismo trato de clamp y
  // basura que los demás tamaños.
  const logTight = settingsOf({ gitLogRamasWidth: 10, gitLogDetalleWidth: 10 })
  const logHuge = settingsOf({ gitLogRamasWidth: 99999, gitLogDetalleWidth: 99999 })
  const logJunk = settingsOf({ gitLogRamasWidth: 'ancho', gitLogDetalleWidth: null })
  check(
    '(9.3b) anchos del panel Git·Log: acotados a [140,900] y basura -> default',
    logTight?.gitLogRamasWidth === 140 &&
      logTight?.gitLogDetalleWidth === 140 &&
      logHuge?.gitLogRamasWidth === 900 &&
      logHuge?.gitLogDetalleWidth === 900 &&
      logJunk?.gitLogRamasWidth === 210 &&
      logJunk?.gitLogDetalleWidth === 330,
    `tight=${logTight?.gitLogRamasWidth}/${logTight?.gitLogDetalleWidth} ` +
      `huge=${logHuge?.gitLogRamasWidth}/${logHuge?.gitLogDetalleWidth} ` +
      `junk=${logJunk?.gitLogRamasWidth}/${logJunk?.gitLogDetalleWidth}`
  )

  // (9.3c) `gitChangesHeight` se RETIRÓ con el commit box de la vista de git. Un
  // archivo viejo que aún lo traiga no debe resucitarlo: normalizeSettings
  // reconstruye el objeto entero, así que la clave muerta se cae sola.
  const viejo = settingsOf({ gitChangesHeight: 300, ccWidth: 500 })
  check(
    '(9.3c) gitChangesHeight (campo retirado) no sobrevive al saneado',
    viejo?.gitChangesHeight === undefined && viejo?.ccWidth === 500,
    `gitChangesHeight=${String(viejo?.gitChangesHeight)} ccWidth=${viejo?.ccWidth}`
  )

  // (9.3d) LOS DOS GRUPOS DEL RIEL, saneados como UNA PARTICIÓN.
  //
  // Este bloque comprobaba lo contrario: que cada grupo se saneaba contra su
  // conjunto fijo y por tanto un id del otro grupo se descartaba. Era el segundo
  // de los cuatro candados que impedían mover un icono de arriba abajo, y se
  // RETIRA a propósito, no se parchea. Lo que hay que fijar ahora es que la
  // partición se conserve: cada icono exactamente una vez, en el grupo donde el
  // usuario lo dejó.
  const riel = (arriba: unknown, abajo: unknown): { arriba: string[]; abajo: string[] } => {
    const s = settingsOf({ activityBarOrder: arriba, bottomBarOrder: abajo })
    return {
      arriba: (s?.activityBarOrder ?? []) as string[],
      abajo: (s?.bottomBarOrder ?? []) as string[]
    }
  }
  const TODOS = ['files', 'git', 'db', 'terminal', 'gitlog']
  const completo = (r: { arriba: string[]; abajo: string[] }): boolean =>
    [...r.arriba, ...r.abajo].sort().join(',') === [...TODOS].sort().join(',')

  {
    const def = riel(undefined, undefined)
    check(
      '(9.3d) sin nada guardado, el reparto por defecto',
      JSON.stringify(def.arriba) === '["files","git","db"]' &&
        JSON.stringify(def.abajo) === '["terminal","gitlog"]',
      JSON.stringify(def)
    )
    // EL CASO QUE MOTIVA EL CAMBIO: `gitlog` subido al grupo de arriba. Antes se
    // descartaba en silencio y el icono volvía abajo en este mismo punto.
    const movido = riel(['files', 'gitlog', 'git', 'db'], ['terminal'])
    check(
      '(9.3d) un icono MOVIDO de grupo sobrevive al saneado',
      JSON.stringify(movido.arriba) === '["files","gitlog","git","db"]' &&
        JSON.stringify(movido.abajo) === '["terminal"]',
      JSON.stringify(movido)
    )
    check(
      '(9.3d) y el orden dentro de cada grupo se respeta',
      JSON.stringify(riel(['git', 'files', 'db'], ['gitlog', 'terminal']).arriba) ===
        '["git","files","db"]',
      JSON.stringify(riel(['git', 'files', 'db'], ['gitlog', 'terminal']))
    )
    const sucio = riel(['files', 'files', 'fantasma', 42, null, 'git'], ['terminal', 'gitlog'])
    check(
      '(9.3d) duplicados, ids desconocidos y no-strings se descartan',
      JSON.stringify(sucio.arriba) === '["files","git","db"]' && completo(sucio),
      JSON.stringify(sucio)
    )
    const duplicadoEntreGrupos = riel(['files', 'gitlog'], ['gitlog', 'terminal'])
    check(
      '(9.3d) un id declarado en LOS DOS grupos aparece una sola vez',
      completo(duplicadoEntreGrupos) && duplicadoEntreGrupos.arriba.includes('gitlog'),
      JSON.stringify(duplicadoEntreGrupos)
    )
    // NINGÚN ICONO SE PIERDE, pase lo que pase en el archivo: es la propiedad de
    // la que depende que el riel siga siendo usable tras editarlo a mano.
    check(
      '(9.3d) nunca se pierde un icono, ni con el archivo a medias',
      completo(riel(['files'], undefined)) &&
        completo(riel([], [])) &&
        completo(riel('basura', 7)),
      `parcial=${JSON.stringify(riel(['files'], undefined))}`
    )
    const todoArriba = riel(TODOS, [])
    check(
      '(9.3d) si el archivo deja un grupo VACÍO, se le presta un icono',
      todoArriba.abajo.length === 1 && completo(todoArriba),
      JSON.stringify(todoArriba)
    )
  }

  // (9.4) El colapso del inspector de progreso YA NO SE PERSISTE (caduca en cuanto el
  // perfil cambia de estado, así que guardarlo era guardar algo que el primer turno del
  // día descartaba). Lo que se comprueba ahora es que un archivo VIEJO con esa clave no
  // la resucite: el saneado solo copia lo que conoce.
  const col = settingsOf({
    activityProfileCollapse: { alfa: 'open', beta: 'closed' }
  }) as Record<string, unknown> | undefined
  check(
    '(9.4) una clave de colapso en un archivo viejo se ignora (ya no se persiste)',
    col !== undefined && !('activityProfileCollapse' in col),
    `claves=${col ? Object.keys(col).length : 'sin settings'}`
  )

  // (9.6) MIGRACIÓN de la apariencia de terminal: al separarse en dos ajustes
  // (shell y agente), un archivo VIEJO solo trae `terminalFont*`. Si el agente
  // cayera al default, quien tuviera la fuente ajustada la vería cambiar sola al
  // actualizar; por eso se SIEMBRA con la de shell.
  const migrado = normalizeWorkspaceState({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: { terminalFontFamily: 'Consolas, monospace', terminalFontSize: 16 }
  })?.settings as Record<string, unknown> | undefined
  check(
    '(9.6) sin agentFont*: se siembra con la de shell (no con el default)',
    migrado?.agentFontFamily === 'Consolas, monospace' && migrado?.agentFontSize === 16,
    `agente=${JSON.stringify(migrado?.agentFontFamily)}/${migrado?.agentFontSize}`
  )
  // Y una vez separados, el del agente manda sobre el de shell.
  const separado = normalizeWorkspaceState({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: {
      terminalFontFamily: 'Consolas, monospace',
      terminalFontSize: 16,
      agentFontFamily: '"Fira Code", monospace',
      agentFontSize: 11
    }
  })?.settings as Record<string, unknown> | undefined
  check(
    '(9.6) con agentFont*: cada terminal conserva el suyo, independientes',
    separado?.agentFontSize === 11 && separado?.terminalFontSize === 16,
    `shell=${separado?.terminalFontSize} agente=${separado?.agentFontSize}`
  )
  // Tamaño de letra de la interfaz: 0 = predeterminado, y lo absurdo se acota.
  const ui = (v: unknown): unknown =>
    (
      normalizeWorkspaceState({
        version: 1,
        activeProfileId: 'alfa',
        byProfile: {},
        settings: { uiFontSize: v }
      })?.settings as Record<string, unknown> | undefined
    )?.uiFontSize
  check(
    '(9.7) uiFontSize: 0 se respeta (= predeterminado), 900 se acota, basura cae a 0',
    ui(0) === 0 && ui(900) === 18 && ui(3) === 9 && ui('grande') === 0,
    `0->${ui(0)} 900->${ui(900)} 3->${ui(3)} "grande"->${ui('grande')}`
  )

  // (9.8) Los DOS OVERRIDES de tamaño (explorador y vista de git). Se sanean igual
  // que la base, pero el 0 significa otra cosa: "igual que la interfaz".
  const sizes = (raw: Record<string, unknown>): Record<string, unknown> =>
    (normalizeWorkspaceState({
      version: 1,
      activeProfileId: 'alfa',
      byProfile: {},
      settings: raw
    })?.settings ?? {}) as Record<string, unknown>
  {
    const s = sizes({ explorerFontSize: 900, gitFontSize: 3 })
    check(
      '(9.8a) los overrides se acotan igual que la base',
      s.explorerFontSize === 18 && s.gitFontSize === 9,
      `explorer->${s.explorerFontSize} git->${s.gitFontSize}`
    )
    const basura = sizes({ explorerFontSize: 'enorme', gitFontSize: null })
    check(
      '(9.8b) basura cae a 0 (= hereda), no al default',
      basura.explorerFontSize === 0 && basura.gitFontSize === 0,
      `explorer->${basura.explorerFontSize} git->${basura.gitFontSize}`
    )
    // EL INVARIANTE QUE IMPORTA. Un archivo de una versión anterior solo trae la
    // base; los overrides tienen que nacer a 0 (heredando), NO sembrados con
    // `uiFontSize`. Es lo contrario de lo que se hizo con `agentFont*`: allí
    // copiar conservaba lo que el usuario ya veía, aquí heredar ES lo que ya
    // veía, y copiar el número solo dejaría dos overrides que nadie puso y que
    // dejarían de seguir a la interfaz para siempre.
    const viejo = sizes({ uiFontSize: 10 })
    check(
      '(9.8c) un archivo VIEJO deja los overrides en 0 (heredan), no en uiFontSize',
      viejo.uiFontSize === 10 && viejo.explorerFontSize === 0 && viejo.gitFontSize === 0,
      `ui->${viejo.uiFontSize} explorer->${viejo.explorerFontSize} git->${viejo.gitFontSize}`
    )
    const propios = sizes({ uiFontSize: 10, explorerFontSize: 16, gitFontSize: 0 })
    check(
      '(9.8d) un override propio manda y el otro sigue heredando',
      propios.explorerFontSize === 16 && propios.gitFontSize === 0,
      `explorer->${propios.explorerFontSize} git->${propios.gitFontSize}`
    )
  }

  // (9.5) Round-trip a disco de una configuración de layout REAL: lo que el
  // usuario dejó puesto es exactamente lo que amanece en el siguiente arranque.
  const dir2 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-layout-'))
  const file2 = path.join(dir2, 'workspace-state.json')
  const doc2 = normalizeWorkspaceState({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: {
      sidebarWidthByView: { files: 240, settings: 420 },
      ccWidth: 620,
      terminalHeight: 300
    }
  })
  writeFileSync(file2, JSON.stringify(doc2, null, 2) + '\n', 'utf-8')
  const back2 = normalizeWorkspaceState(JSON.parse(readFileSync(file2, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  const sideBack = back2?.sidebarWidthByView as Record<string, number> | undefined
  check(
    '(9.5) round-trip: anchos por vista y cc/terminal sobreviven al disco',
    sideBack?.files === 240 &&
      sideBack?.settings === 420 &&
      back2?.ccWidth === 620 &&
      back2?.terminalHeight === 300,
    `back=${JSON.stringify(back2)}`
  )
}

// ---------------------------------------------------------------------------
hr('(10) SETTINGS booleanos y lista: el caso AUSENCIA DE CLAVE')
// ---------------------------------------------------------------------------
// El caso que de verdad se rompe es el archivo escrito por una versión ANTERIOR,
// que no trae la clave. Ahí el saneado tiene que caer en el default declarado, y
// los dos sentidos conviven en el mismo archivo (`!== false` para lo que nace
// encendido, `=== true` para lo que nace apagado). Sin este bloque, invertir uno
// por descuido no lo nota nadie hasta que un usuario estrena la función al revés.
{
  const vacio = normalizeWorkspaceState({ version: 1, activeProfileId: 'alfa', byProfile: {} })
    ?.settings as Record<string, unknown> | undefined
  check(
    '(10.1) sin clave: aplicarUpdateAlCerrar cae en ACTIVADO (su default)',
    vacio?.aplicarUpdateAlCerrar === true,
    `aplicarUpdateAlCerrar=${String(vacio?.aplicarUpdateAlCerrar)}`
  )
  check(
    '(10.2) sin clave: diffColapsarSinCambios y sandboxDepsNavegador caen en APAGADO',
    vacio?.diffColapsarSinCambios === false && vacio?.sandboxDepsNavegador === false,
    `diff=${String(vacio?.diffColapsarSinCambios)} deps=${String(vacio?.sandboxDepsNavegador)}`
  )
  check(
    '(10.3) sin clave: paquetesExtraSandbox es [] y NUNCA undefined',
    Array.isArray(vacio?.paquetesExtraSandbox) &&
      (vacio?.paquetesExtraSandbox as string[]).length === 0,
    `paquetes=${JSON.stringify(vacio?.paquetesExtraSandbox)}`
  )

  // Basura en la lista: se sanea la FORMA (strings no vacíos, sin duplicados). La
  // validación de que cada nombre sea un paquete apt de verdad vive en
  // `shared/sandboxExtras` y corre al construir el --build-arg.
  const sucio = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { paquetesExtraSandbox: ['jq', '', 42, '  ', 'jq', ' ripgrep '], sandboxDepsNavegador: 'sí' }
  })?.settings as Record<string, unknown> | undefined
  check(
    '(10.4) lista saneada: fuera vacíos y no-strings, sin duplicados, con trim',
    JSON.stringify(sucio?.paquetesExtraSandbox) === JSON.stringify(['jq', 'ripgrep']),
    JSON.stringify(sucio?.paquetesExtraSandbox)
  )
  check(
    '(10.5) un booleano que no es booleano cae en false, no en truthy',
    sucio?.sandboxDepsNavegador === false,
    `deps=${String(sucio?.sandboxDepsNavegador)}`
  )
  const noEsLista = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { paquetesExtraSandbox: 'jq ripgrep' }
  })?.settings as Record<string, unknown> | undefined
  check(
    '(10.6) si la clave no es un array, se descarta entera (no se parte el string)',
    JSON.stringify(noEsLista?.paquetesExtraSandbox) === '[]',
    JSON.stringify(noEsLista?.paquetesExtraSandbox)
  )

  // Round-trip real a disco: es lo que fija que el campo esté en el `return` de
  // normalizeSettings. Un campo declarado y saneado pero no devuelto se pierde al
  // reiniciar sin dar ninguna señal.
  const dir3 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-sbx-'))
  const file3 = path.join(dir3, 'workspace-state.json')
  const doc3 = normalizeWorkspaceState({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: { paquetesExtraSandbox: ['libreoffice-writer', 'poppler-utils'], sandboxDepsNavegador: true }
  })
  writeFileSync(file3, JSON.stringify(doc3, null, 2) + '\n', 'utf-8')
  const back3 = normalizeWorkspaceState(JSON.parse(readFileSync(file3, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  check(
    '(10.7) round-trip: los paquetes y el flag sobreviven a escribir->leer->normalize',
    JSON.stringify(back3?.paquetesExtraSandbox) ===
      JSON.stringify(['libreoffice-writer', 'poppler-utils']) && back3?.sandboxDepsNavegador === true,
    `back=${JSON.stringify(back3?.paquetesExtraSandbox)} deps=${String(back3?.sandboxDepsNavegador)}`
  )
}

// ---------------------------------------------------------------------------
hr('(11) SETTINGS por PERFIL: qué vista y qué panel inferior mira cada uno')
// ---------------------------------------------------------------------------
// Estos dos mapas son lo que hace que abrir la terminal en un perfil no la abra
// en todos. Lo que hay que fijar es el saneado ENTRADA A ENTRADA: al estar
// indexados por perfil, descartar el mapa completo por una clave mala dejaría a
// TODOS los perfiles sin su pantalla por culpa de uno.
{
  const vacio = normalizeWorkspaceState({ version: 1, activeProfileId: 'alfa', byProfile: {} })
    ?.settings as Record<string, unknown> | undefined
  check(
    '(11.1) sin clave: los dos mapas son {} y nunca undefined',
    JSON.stringify(vacio?.vistaLateralPorPerfil) === '{}' &&
      JSON.stringify(vacio?.panelInferiorPorPerfil) === '{}',
    `vista=${JSON.stringify(vacio?.vistaLateralPorPerfil)} panel=${JSON.stringify(vacio?.panelInferiorPorPerfil)}`
  )

  const mezcla = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: {
      // 'alfa' y 'gamma' válidos; 'beta' con una vista que no existe; '' sin clave.
      vistaLateralPorPerfil: { alfa: 'git', gamma: 'db', beta: 'inventada', '': 'files', x: 42 },
      // '' es un estado CON significado (franja cerrada) y tiene que sobrevivir.
      panelInferiorPorPerfil: { alfa: 'gitlog', gamma: '', beta: 'otracosa' }
    }
  })?.settings as Record<string, unknown> | undefined
  const v = mezcla?.vistaLateralPorPerfil as Record<string, string>
  const p = mezcla?.panelInferiorPorPerfil as Record<string, string>
  check(
    '(11.2) se descartan SOLO las entradas inválidas, no el mapa entero',
    v.alfa === 'git' && v.gamma === 'db' && !('beta' in v) && !('x' in v) && !('' in v),
    JSON.stringify(v)
  )
  check(
    "(11.3) la franja cerrada ('') sobrevive al saneado; un id inventado no",
    p.alfa === 'gitlog' && p.gamma === '' && !('beta' in p),
    JSON.stringify(p)
  )
  check(
    '(11.4) un mapa que no es objeto (array/string/null) cae en {}',
    ['vistaLateralPorPerfil', 'panelInferiorPorPerfil'].every((k) => {
      const r = normalizeWorkspaceState({
        version: 1,
        activeProfileId: null,
        byProfile: {},
        settings: { [k]: ['alfa', 'git'] }
      })?.settings as Record<string, unknown> | undefined
      return JSON.stringify(r?.[k]) === '{}'
    }),
    'array -> {}'
  )

  // Round-trip: fija que los dos campos estén en el `return` de normalizeSettings.
  const dir4 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-ui-'))
  const file4 = path.join(dir4, 'workspace-state.json')
  const doc4 = normalizeWorkspaceState({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: {
      vistaLateralPorPerfil: { alfa: 'git', beta: 'files' },
      panelInferiorPorPerfil: { alfa: 'terminal' }
    }
  })
  writeFileSync(file4, JSON.stringify(doc4, null, 2) + '\n', 'utf-8')
  const back4 = normalizeWorkspaceState(JSON.parse(readFileSync(file4, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  check(
    '(11.5) round-trip: lo que mira cada perfil sobrevive a escribir->leer->normalize',
    JSON.stringify(back4?.vistaLateralPorPerfil) === JSON.stringify({ alfa: 'git', beta: 'files' }) &&
      JSON.stringify(back4?.panelInferiorPorPerfil) === JSON.stringify({ alfa: 'terminal' }),
    `vista=${JSON.stringify(back4?.vistaLateralPorPerfil)} panel=${JSON.stringify(back4?.panelInferiorPorPerfil)}`
  )
}

// ---------------------------------------------------------------------------
hr('(12) SETTINGS: la distribución del MOSAICO DE AGENTES')
// ---------------------------------------------------------------------------
// Sólo se persiste la distribución elegida, no el mosaico ni sus casillas (ver el
// campo). Lo que se fija: su valor por defecto, que un id desconocido —de una versión
// futura con otra distribución— vuelva a Automático, y que sobreviva al disco.
{
  const ajustes = (settings: unknown): Record<string, unknown> | undefined =>
    normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings })?.settings as
      | Record<string, unknown>
      | undefined
  check(
    "(12.1) sin clave: 'auto'",
    ajustes({})?.mosaicoPreset === 'auto',
    String(ajustes({})?.mosaicoPreset)
  )
  const validos = ['auto', 'cuadricula', 'columnas', 'filas', 'principal']
  check(
    '(12.2) las cinco distribuciones se conservan tal cual',
    validos.every((p) => ajustes({ mosaicoPreset: p })?.mosaicoPreset === p),
    validos.map((p) => `${p}->${ajustes({ mosaicoPreset: p })?.mosaicoPreset}`).join(' ')
  )
  check(
    "(12.3) un id desconocido o de otro tipo vuelve a 'auto'",
    ['diagonal', 42, null, ['filas']].every((p) => ajustes({ mosaicoPreset: p })?.mosaicoPreset === 'auto'),
    'diagonal/42/null/array -> auto'
  )
  const dir5 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-mosaico-'))
  const file5 = path.join(dir5, 'workspace-state.json')
  writeFileSync(
    file5,
    JSON.stringify(normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: { mosaicoPreset: 'cuadricula' } }), null, 2) + '\n',
    'utf-8'
  )
  const back5 = normalizeWorkspaceState(JSON.parse(readFileSync(file5, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  check(
    '(12.4) round-trip: la distribución sobrevive a escribir->leer->normalize',
    back5?.mosaicoPreset === 'cuadricula',
    String(back5?.mosaicoPreset)
  )
}

// ---------------------------------------------------------------------------
hr('(13) SETTINGS de SSH: los grupos de conexiones plegados, por PERFIL')
// ---------------------------------------------------------------------------
// Un mapa `perfil -> ids de grupo` (`''` = «Sin grupo»). Lo que se fija: el valor por defecto,
// que se descarta la ENTRADA mala y nunca el mapa entero (está indexado por perfil), que los
// ids se guardan sin repetir, que sobrevive al disco, y las dos operaciones puras que usan el
// store y la poda (`conPlegado` y `podarMapaPorPerfil`) con su identidad estable.
{
  const ajustes = (settings: unknown): Record<string, unknown> | undefined =>
    normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings })?.settings as
      | Record<string, unknown>
      | undefined
  const plegados = (raw: unknown): unknown => ajustes({ sshGruposPlegadosPorPerfil: raw })?.sshGruposPlegadosPorPerfil
  check('(13.1) sin clave: vacío', eq(plegados(undefined), {}), JSON.stringify(plegados(undefined)))
  check(
    '(13.2) lo válido se conserva, con «Sin grupo» como cadena vacía',
    eq(plegados({ alfa: ['g1', ''], beta: ['g2'] }), { alfa: ['g1', ''], beta: ['g2'] }),
    JSON.stringify(plegados({ alfa: ['g1', ''], beta: ['g2'] }))
  )
  check(
    '(13.3) una entrada mala se descarta sola y las demás sobreviven',
    eq(plegados({ alfa: ['g1'], malo: 'g2', otro: [1, null, {}], '': ['g3'], vacio: [] }), { alfa: ['g1'] }),
    JSON.stringify(plegados({ alfa: ['g1'], malo: 'g2', otro: [1, null, {}], '': ['g3'], vacio: [] }))
  )
  check(
    '(13.4) en un perfil, un id que no es de grupo o está repetido se descarta; el resto se queda',
    eq(plegados({ alfa: ['g1', 'g 1', 'g/1', 'g1', 7, 'g2'] }), { alfa: ['g1', 'g2'] }),
    JSON.stringify(plegados({ alfa: ['g1', 'g 1', 'g/1', 'g1', 7, 'g2'] }))
  )
  check(
    '(13.5) un mapa que no es un objeto plano vuelve a vacío, sin romper la carga',
    [null, 'alfa', 7, ['alfa'], true].every((raw) => eq(plegados(raw), {})),
    'null/texto/número/array/booleano -> {}'
  )
  const dir6 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-ssh-'))
  const file6 = path.join(dir6, 'workspace-state.json')
  writeFileSync(
    file6,
    JSON.stringify(normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: { sshGruposPlegadosPorPerfil: { alfa: ['g1', ''] } } }), null, 2) + '\n',
    'utf-8'
  )
  const back6 = normalizeWorkspaceState(JSON.parse(readFileSync(file6, 'utf-8')))?.settings as Record<string, unknown> | undefined
  check(
    '(13.6) round-trip: los plegados sobreviven a escribir->leer->normalize',
    eq(back6?.sshGruposPlegadosPorPerfil, { alfa: ['g1', ''] }),
    JSON.stringify(back6?.sshGruposPlegadosPorPerfil)
  )
  const base: SshGruposPlegadosPorPerfil = { alfa: ['g1'] }
  check(
    '(13.7) plegar añade, desplegar quita, y la última que se quita borra la entrada del perfil',
    eq(conPlegado(base, 'alfa', 'g2', true), { alfa: ['g1', 'g2'] }) &&
      eq(conPlegado(base, 'alfa', 'g1', false), {}) &&
      eq(conPlegado(base, 'beta', '', true), { alfa: ['g1'], beta: [''] }),
    JSON.stringify([conPlegado(base, 'alfa', 'g2', true), conPlegado(base, 'alfa', 'g1', false)])
  )
  check(
    '(13.8) lo que no cambia devuelve el MISMO objeto (no repinta ni dispara un guardado)',
    conPlegado(base, 'alfa', 'g1', true) === base && conPlegado(base, 'alfa', 'g9', false) === base,
    'plegar uno ya plegado y desplegar uno que no lo está -> misma referencia'
  )
  check(
    '(13.9) podar olvida los perfiles que ya no existen',
    eq(podarMapaPorPerfil({ alfa: ['g1'], beta: ['g2'] }, ['alfa']), { alfa: ['g1'] }),
    JSON.stringify(podarMapaPorPerfil({ alfa: ['g1'], beta: ['g2'] }, ['alfa']))
  )
  check(
    '(13.10) podar nunca contra una lista vacía (aún no hay perfiles cargados) y con todos vivos es la misma referencia',
    podarMapaPorPerfil(base, []) === base && podarMapaPorPerfil(base, ['alfa', 'beta']) === base,
    'lista vacía y perfiles vivos -> misma referencia'
  )
}

// ---------------------------------------------------------------------------
hr('(14) SETTINGS de SSH: el riel de conexiones a pantalla completa (ancho GLOBAL, visibilidad por PERFIL)')
// ---------------------------------------------------------------------------
// Dos claves nuevas: `sshRielAncho` (px, entero y dentro del rango del lateral) y
// `sshRielVisiblePorPerfil` (sin entrada = visible). Lo que se fija: el valor por defecto, que un
// valor malo cae a su por defecto SIN llevarse a los vecinos (y, en el mapa, se descarta la ENTRADA y
// no el mapa entero), que sobreviven al disco y las operaciones puras del store y de la poda.
{
  const ajustes = (settings: unknown): Record<string, unknown> | undefined =>
    normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings })?.settings as
      | Record<string, unknown>
      | undefined
  const ancho = (raw: unknown): unknown => ajustes({ sshRielAncho: raw })?.sshRielAncho
  const visibles = (raw: unknown): unknown => ajustes({ sshRielVisiblePorPerfil: raw })?.sshRielVisiblePorPerfil
  check(
    '(14.1) por defecto: 260 px y ningún perfil lo oculta, en DEFAULT_SETTINGS y sin la clave en el archivo',
    DEFAULT_SETTINGS.sshRielAncho === 260 &&
      eq(DEFAULT_SETTINGS.sshRielVisiblePorPerfil, {}) &&
      ancho(undefined) === 260 &&
      eq(visibles(undefined), {}),
    `${DEFAULT_SETTINGS.sshRielAncho} · ${JSON.stringify(DEFAULT_SETTINGS.sshRielVisiblePorPerfil)}`
  )
  check(
    '(14.2) el rango y el ancho por defecto son los del lateral de la app: no se separan',
    SSH_RIEL_ANCHO_POR_DEFECTO === DEFAULT_SIDEBAR_WIDTH &&
      SSH_RIEL_ANCHO_MIN === SIDEBAR_WIDTH_MIN &&
      SSH_RIEL_ANCHO_MAX === SIDEBAR_WIDTH_MAX,
    `${SSH_RIEL_ANCHO_MIN}/${SSH_RIEL_ANCHO_POR_DEFECTO}/${SSH_RIEL_ANCHO_MAX}`
  )
  check('(14.3) un ancho válido se conserva', ancho(300) === 300 && ancho(180) === 180 && ancho(480) === 480, `${ancho(300)} · ${ancho(180)} · ${ancho(480)}`)
  check(
    '(14.4) un ancho fuera de rango se acota y un decimal se redondea',
    ancho(10) === 180 && ancho(-5) === 180 && ancho(9999) === 480 && ancho(1e9) === 480 && ancho(300.4) === 300 && ancho(300.6) === 301,
    `${ancho(10)} · ${ancho(-5)} · ${ancho(9999)} · ${ancho(1e9)} · ${ancho(300.4)} · ${ancho(300.6)}`
  )
  check(
    '(14.5) lo que no es un número finito vuelve a 260',
    ['300', null, Number.NaN, Number.POSITIVE_INFINITY, {}, [], true].every((raw) => ancho(raw) === 260),
    'texto/null/NaN/infinito/objeto/array/booleano -> 260'
  )
  const conVecinos = ajustes({
    sshRielAncho: 'malo',
    sshRielVisiblePorPerfil: 7,
    sshGruposPlegadosPorPerfil: { alfa: ['g1'] },
    dbAgenteWidth: 500
  })
  check(
    '(14.6) dos valores malos no se llevan a sus vecinos (plegados SSH y ancho del agente de datos)',
    conVecinos?.sshRielAncho === 260 &&
      eq(conVecinos?.sshRielVisiblePorPerfil, {}) &&
      eq(conVecinos?.sshGruposPlegadosPorPerfil, { alfa: ['g1'] }) &&
      conVecinos?.dbAgenteWidth === 500,
    JSON.stringify([conVecinos?.sshRielAncho, conVecinos?.sshRielVisiblePorPerfil, conVecinos?.sshGruposPlegadosPorPerfil, conVecinos?.dbAgenteWidth])
  )
  check(
    '(14.7) la visibilidad conserva lo válido (true y false)',
    eq(visibles({ alfa: false, beta: true }), { alfa: false, beta: true }),
    JSON.stringify(visibles({ alfa: false, beta: true }))
  )
  check(
    '(14.8) una entrada mala se descarta sola y las demás sobreviven',
    eq(visibles({ alfa: false, malo: 'no', otro: 0, nulo: null, lista: [false], '': false, beta: true }), { alfa: false, beta: true }),
    JSON.stringify(visibles({ alfa: false, malo: 'no', otro: 0, nulo: null, lista: [false], '': false, beta: true }))
  )
  check(
    '(14.9) un mapa que no es un objeto plano vuelve a vacío, sin romper la carga',
    [null, 'alfa', 7, [false], true].every((raw) => eq(visibles(raw), {})),
    'null/texto/número/array/booleano -> {}'
  )
  const dir7 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-riel-'))
  const file7 = path.join(dir7, 'workspace-state.json')
  writeFileSync(
    file7,
    JSON.stringify(
      normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: { sshRielAncho: 333, sshRielVisiblePorPerfil: { alfa: false } } }),
      null,
      2
    ) + '\n',
    'utf-8'
  )
  const back7 = normalizeWorkspaceState(JSON.parse(readFileSync(file7, 'utf-8')))?.settings as Record<string, unknown> | undefined
  check(
    '(14.10) round-trip: el ancho y la visibilidad sobreviven a escribir->leer->normalize',
    back7?.sshRielAncho === 333 && eq(back7?.sshRielVisiblePorPerfil, { alfa: false }),
    JSON.stringify([back7?.sshRielAncho, back7?.sshRielVisiblePorPerfil])
  )
  const oculto: SshRielVisiblePorPerfil = { alfa: false }
  check(
    '(14.11) ocultar añade la entrada y mostrar la borra (verse es lo de por defecto): no se guarda un `true`',
    eq(conRielVisible({}, 'alfa', false), { alfa: false }) &&
      eq(conRielVisible(oculto, 'alfa', true), {}) &&
      eq(conRielVisible(oculto, 'beta', false), { alfa: false, beta: false }),
    JSON.stringify([conRielVisible({}, 'alfa', false), conRielVisible(oculto, 'alfa', true)])
  )
  const sinEntrada: SshRielVisiblePorPerfil = {}
  const trueAMano: SshRielVisiblePorPerfil = { alfa: true }
  check(
    '(14.12) lo que no cambia devuelve el MISMO objeto (no repinta ni dispara un guardado): ocultar uno oculto, mostrar uno que se ve',
    conRielVisible(oculto, 'alfa', false) === oculto && conRielVisible(sinEntrada, 'alfa', true) === sinEntrada,
    'misma referencia'
  )
  check(
    '(14.13) un `true` escrito a mano vale como «se ve»: mostrarlo no cambia nada y ocultarlo lo pasa a `false`',
    conRielVisible(trueAMano, 'alfa', true) === trueAMano && eq(conRielVisible(trueAMano, 'alfa', false), { alfa: false }),
    JSON.stringify(conRielVisible(trueAMano, 'alfa', false))
  )
  const dosOcultos: SshRielVisiblePorPerfil = { alfa: false, beta: false }
  check(
    '(14.14) la poda genérica olvida los perfiles que ya no existen, no con una lista vacía, y con todos vivos es la misma referencia',
    eq(podarMapaPorPerfil(dosOcultos, ['alfa']), { alfa: false }) &&
      podarMapaPorPerfil(dosOcultos, []) === dosOcultos &&
      podarMapaPorPerfil(dosOcultos, ['alfa', 'beta']) === dosOcultos,
    JSON.stringify(podarMapaPorPerfil(dosOcultos, ['alfa']))
  )
}

// ---------------------------------------------------------------------------
hr('(15) SETTINGS del agente de la terminal: si se ve a pantalla completa, por PERFIL')
// ---------------------------------------------------------------------------
// `agenteTerminalVisiblePorPerfil`: sin entrada = oculto, así que solo se guardan los `true`. Lo que se
// fija: el valor por defecto, que se descarta la ENTRADA mala y no el mapa entero (ni a los vecinos),
// que sobrevive al disco y las operaciones puras del store.
{
  const ajustes = (settings: unknown): Record<string, unknown> | undefined =>
    normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings })?.settings as
      | Record<string, unknown>
      | undefined
  const visibles = (raw: unknown): unknown => ajustes({ agenteTerminalVisiblePorPerfil: raw })?.agenteTerminalVisiblePorPerfil
  check(
    '(15.1) por defecto ningún perfil lo enseña, en DEFAULT_SETTINGS y sin la clave en el archivo',
    eq(DEFAULT_SETTINGS.agenteTerminalVisiblePorPerfil, {}) && eq(visibles(undefined), {}),
    JSON.stringify(DEFAULT_SETTINGS.agenteTerminalVisiblePorPerfil)
  )
  check(
    '(15.2) se conservan los `true`; un `false` es lo de por defecto y no ocupa entrada',
    eq(visibles({ alfa: true, beta: false }), { alfa: true }),
    JSON.stringify(visibles({ alfa: true, beta: false }))
  )
  check(
    '(15.3) una entrada mala se descarta sola y las demás sobreviven',
    eq(visibles({ alfa: true, malo: 'si', uno: 1, nulo: null, lista: [true], '': true, beta: true }), { alfa: true, beta: true }),
    JSON.stringify(visibles({ alfa: true, malo: 'si', uno: 1, nulo: null, lista: [true], '': true, beta: true }))
  )
  check(
    '(15.4) un mapa que no es un objeto plano vuelve a vacío, sin romper la carga',
    [null, 'alfa', 7, [true], true].every((raw) => eq(visibles(raw), {})),
    'null/texto/número/array/booleano -> {}'
  )
  const conVecinos = ajustes({ agenteTerminalVisiblePorPerfil: 'malo', sshRielVisiblePorPerfil: { alfa: false }, dbAgenteVisiblePorPerfil: { alfa: true } })
  check(
    '(15.5) un valor malo no se lleva a sus vecinos (el riel SSH y el agente de datos)',
    eq(conVecinos?.agenteTerminalVisiblePorPerfil, {}) &&
      eq(conVecinos?.sshRielVisiblePorPerfil, { alfa: false }) &&
      eq(conVecinos?.dbAgenteVisiblePorPerfil, { alfa: true }),
    JSON.stringify([conVecinos?.agenteTerminalVisiblePorPerfil, conVecinos?.sshRielVisiblePorPerfil, conVecinos?.dbAgenteVisiblePorPerfil])
  )
  const dir8 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-agente-terminal-'))
  const file8 = path.join(dir8, 'workspace-state.json')
  writeFileSync(
    file8,
    JSON.stringify(
      normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: { agenteTerminalVisiblePorPerfil: { alfa: true } } }),
      null,
      2
    ) + '\n',
    'utf-8'
  )
  const back8 = normalizeWorkspaceState(JSON.parse(readFileSync(file8, 'utf-8')))?.settings as Record<string, unknown> | undefined
  check(
    '(15.6) round-trip: la preferencia sobrevive a escribir->leer->normalize',
    eq(back8?.agenteTerminalVisiblePorPerfil, { alfa: true }),
    JSON.stringify(back8?.agenteTerminalVisiblePorPerfil)
  )
  const visible: AgenteTerminalVisiblePorPerfil = { alfa: true }
  const vacio: AgenteTerminalVisiblePorPerfil = {}
  check(
    '(15.7) mostrar añade la entrada y ocultar la borra: no se guarda un `false`',
    eq(conAgenteTerminalVisible({}, 'alfa', true), { alfa: true }) &&
      eq(conAgenteTerminalVisible(visible, 'alfa', false), {}) &&
      eq(conAgenteTerminalVisible(visible, 'beta', true), { alfa: true, beta: true }),
    JSON.stringify([conAgenteTerminalVisible({}, 'alfa', true), conAgenteTerminalVisible(visible, 'alfa', false)])
  )
  check(
    '(15.8) lo que no cambia devuelve el MISMO objeto: mostrar uno visible, ocultar uno oculto',
    conAgenteTerminalVisible(visible, 'alfa', true) === visible && conAgenteTerminalVisible(vacio, 'alfa', false) === vacio,
    'misma referencia'
  )
  check(
    '(15.9) la poda genérica olvida los perfiles que ya no existen',
    eq(podarMapaPorPerfil({ alfa: true, beta: true }, ['beta']), { beta: true }),
    JSON.stringify(podarMapaPorPerfil({ alfa: true, beta: true }, ['beta']))
  )
}

// ---------------------------------------------------------------------------
hr('(16) SETTINGS del lanzador de conexiones SSH: las conexiones recientes, por PERFIL')
// ---------------------------------------------------------------------------
// `sshRecientesPorPerfil` (ids de conexión, la más reciente primero, hasta tres). Lo que se fija: el valor
// por defecto, que se descarta la ENTRADA mala y nunca el mapa entero (ni a los vecinos), que los ids se
// guardan sin repetir y sin pasar de tres, que sobreviven al disco y las operaciones puras del store. Y que
// un archivo escrito antes de retirar `sshGrupoAbiertoPorPerfil` (el grupo que dejaba abierto el lanzador)
// se lee sin error, con esa clave ignorada y sin que los demás ajustes se resientan.
{
  const ajustes = (settings: unknown): Record<string, unknown> | undefined =>
    normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings })?.settings as
      | Record<string, unknown>
      | undefined
  const recientes = (raw: unknown): unknown => ajustes({ sshRecientesPorPerfil: raw })?.sshRecientesPorPerfil
  check(
    '(16.1) por defecto: ninguna reciente, en DEFAULT_SETTINGS y sin la clave en el archivo; y el grupo abierto ya no es un ajuste',
    eq(DEFAULT_SETTINGS.sshRecientesPorPerfil, {}) && eq(recientes(undefined), {}) && !('sshGrupoAbiertoPorPerfil' in DEFAULT_SETTINGS),
    JSON.stringify(Object.keys(DEFAULT_SETTINGS).filter((k) => k.startsWith('ssh')))
  )
  check(
    '(16.2) las recientes conservan lo válido y su orden (la más reciente primero)',
    eq(recientes({ alfa: ['c3', 'c1'], beta: ['c2'] }), { alfa: ['c3', 'c1'], beta: ['c2'] }),
    JSON.stringify(recientes({ alfa: ['c3', 'c1'], beta: ['c2'] }))
  )
  check(
    '(16.3) en un perfil, un id que no es de conexión, está repetido o no es texto se descarta; el resto se queda',
    eq(recientes({ alfa: ['c1', 'c 1', 'c/1', 'c1', 7, '', 'c2'] }), { alfa: ['c1', 'c2'] }),
    JSON.stringify(recientes({ alfa: ['c1', 'c 1', 'c/1', 'c1', 7, '', 'c2'] }))
  )
  check(
    '(16.4) no pasan de tres: se queda con las tres primeras, que son las más recientes',
    SSH_RECIENTES_MAX === 3 && eq(recientes({ alfa: ['c1', 'c2', 'c3', 'c4', 'c5'] }), { alfa: ['c1', 'c2', 'c3'] }),
    JSON.stringify(recientes({ alfa: ['c1', 'c2', 'c3', 'c4', 'c5'] }))
  )
  check(
    '(16.5) una entrada mala se descarta sola y un perfil sin ninguna no ocupa entrada',
    eq(recientes({ alfa: ['c1'], malo: 'c2', otro: [1, null, {}], '': ['c3'], vacio: [], beta: ['c2'] }), { alfa: ['c1'], beta: ['c2'] }),
    JSON.stringify(recientes({ alfa: ['c1'], malo: 'c2', otro: [1, null, {}], '': ['c3'], vacio: [], beta: ['c2'] }))
  )
  check(
    '(16.6) un mapa que no es un objeto plano vuelve a vacío, sin romper la carga',
    [null, 'alfa', 7, ['alfa'], true].every((raw) => eq(recientes(raw), {})),
    'null/texto/número/array/booleano -> {}'
  )
  const conVecinos = ajustes({
    sshRecientesPorPerfil: 7,
    sshGruposPlegadosPorPerfil: { alfa: ['g1'] },
    sshRielVisiblePorPerfil: { alfa: false }
  })
  check(
    '(16.7) un valor malo no se lleva a sus vecinos (los plegados y el riel de SSH)',
    eq(conVecinos?.sshRecientesPorPerfil, {}) &&
      eq(conVecinos?.sshGruposPlegadosPorPerfil, { alfa: ['g1'] }) &&
      eq(conVecinos?.sshRielVisiblePorPerfil, { alfa: false }),
    JSON.stringify([conVecinos?.sshRecientesPorPerfil, conVecinos?.sshGruposPlegadosPorPerfil, conVecinos?.sshRielVisiblePorPerfil])
  )
  const dir9 = mkdtempSync(path.join(tmpdir(), 'tessera-ws-lanzador-'))
  const file9 = path.join(dir9, 'workspace-state.json')
  writeFileSync(
    file9,
    JSON.stringify(
      normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: { sshRecientesPorPerfil: { alfa: ['c2', 'c1'] } } }),
      null,
      2
    ) + '\n',
    'utf-8'
  )
  const back9 = normalizeWorkspaceState(JSON.parse(readFileSync(file9, 'utf-8')))?.settings as Record<string, unknown> | undefined
  check(
    '(16.8) round-trip: las recientes sobreviven a escribir->leer->normalize',
    eq(back9?.sshRecientesPorPerfil, { alfa: ['c2', 'c1'] }),
    JSON.stringify(back9?.sshRecientesPorPerfil)
  )
  // El archivo de la versión anterior: todavía trae el grupo abierto. Se lee, la clave se ignora y, al volver a
  // guardar lo leído, ya no está en el disco.
  const dirViejo = mkdtempSync(path.join(tmpdir(), 'tessera-ws-grupo-abierto-'))
  const fileViejo = path.join(dirViejo, 'workspace-state.json')
  writeFileSync(
    fileViejo,
    JSON.stringify({
      version: 1,
      activeProfileId: null,
      byProfile: {},
      settings: {
        sshGrupoAbiertoPorPerfil: { alfa: 'g1', beta: '' },
        sshRecientesPorPerfil: { alfa: ['c2', 'c1'] },
        sshGruposPlegadosPorPerfil: { alfa: ['g1'] },
        sshRielVisiblePorPerfil: { alfa: false }
      }
    }),
    'utf-8'
  )
  const viejo = normalizeWorkspaceState(JSON.parse(readFileSync(fileViejo, 'utf-8')))
  check(
    '(16.9) un archivo que aún trae `sshGrupoAbiertoPorPerfil` se lee sin error y la clave no pasa a los ajustes',
    viejo !== null && !('sshGrupoAbiertoPorPerfil' in (viejo.settings ?? {})),
    viejo === null ? 'null' : JSON.stringify(Object.keys(viejo.settings ?? {}).filter((k) => k.startsWith('ssh')))
  )
  check(
    '(16.10) y sus vecinos se leen enteros: las recientes, los plegados y el riel',
    eq(viejo?.settings?.sshRecientesPorPerfil, { alfa: ['c2', 'c1'] }) &&
      eq(viejo?.settings?.sshGruposPlegadosPorPerfil, { alfa: ['g1'] }) &&
      eq(viejo?.settings?.sshRielVisiblePorPerfil, { alfa: false }),
    JSON.stringify([viejo?.settings?.sshRecientesPorPerfil, viejo?.settings?.sshGruposPlegadosPorPerfil, viejo?.settings?.sshRielVisiblePorPerfil])
  )
  writeFileSync(fileViejo, JSON.stringify(viejo, null, 2) + '\n', 'utf-8')
  check(
    '(16.11) al guardar lo leído el archivo se limpia solo: la clave retirada ya no está en el disco',
    !readFileSync(fileViejo, 'utf-8').includes('sshGrupoAbiertoPorPerfil'),
    'sin la clave'
  )
  check(
    '(16.12) un valor roto en esa clave retirada tampoco rompe la carga',
    [null, 'malo', 7, ['g1'], { alfa: 7 }].every((raw) => ajustes({ sshGrupoAbiertoPorPerfil: raw }) !== undefined),
    'null/texto/número/array/objeto raro -> se lee'
  )
  const base: SshRecientesPorPerfil = { alfa: ['c1', 'c2', 'c3'] }
  check(
    '(16.13) una conexión nueva se pone la primera y empuja a las demás, sin pasar de tres: la más antigua sale',
    eq(conReciente(base, 'alfa', 'c9'), { alfa: ['c9', 'c1', 'c2'] }) && eq(conReciente({}, 'alfa', 'c1'), { alfa: ['c1'] }) && eq(conReciente(base, 'beta', 'c7'), { alfa: ['c1', 'c2', 'c3'], beta: ['c7'] }),
    JSON.stringify([conReciente(base, 'alfa', 'c9'), conReciente(base, 'beta', 'c7')])
  )
  check(
    '(16.14) una ya anotada sube a la primera sin repetirse, y la que ya era la primera devuelve el MISMO objeto',
    eq(conReciente(base, 'alfa', 'c3'), { alfa: ['c3', 'c1', 'c2'] }) && conReciente(base, 'alfa', 'c1') === base && eq(base, { alfa: ['c1', 'c2', 'c3'] }),
    JSON.stringify(conReciente(base, 'alfa', 'c3'))
  )
  const dos: SshRecientesPorPerfil = { alfa: ['c1', 'c2'], beta: ['c3'] }
  check(
    '(16.15) podar las recientes olvida las conexiones que ya no existen, y un perfil que se queda sin ninguna pierde su entrada',
    eq(podarRecientes(dos, new Set(['c1', 'c3'])), { alfa: ['c1'], beta: ['c3'] }) && eq(podarRecientes(dos, new Set(['c2'])), { alfa: ['c2'] }) && eq(podarRecientes(dos, new Set()), {}),
    JSON.stringify([podarRecientes(dos, new Set(['c1', 'c3'])), podarRecientes(dos, new Set(['c2']))])
  )
  check(
    '(16.16) y con todas vivas devuelve el MISMO objeto',
    podarRecientes(dos, new Set(['c1', 'c2', 'c3', 'c4'])) === dos,
    'misma referencia'
  )
  check(
    '(16.17) la poda genérica por perfil sirve a las recientes: olvida los perfiles que ya no existen',
    eq(podarMapaPorPerfil(dos, ['beta']), { beta: ['c3'] }),
    JSON.stringify(podarMapaPorPerfil(dos, ['beta']))
  )
}

// ---------------------------------------------------------------------------
hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const allPass = results.every((r) => r.pass)
hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
