#!/usr/bin/env node
// =============================================================================
// Prueba de la persistencia del workspace (node src/renderer/src/features/pestanas/test-foto-workspace.mts).
// serializeWorkspace, pestanasPerfilDesdeGuardado y normalizarEstadoWorkspace son puros y corren bajo `node`; la
// escritura y lectura a disco se replica con node:fs contra un directorio temporal. Cubre: el esqueleto sin
// estadoRepos, el round-trip a disco, la reconstrucción de openProjects y activePath, la proyección incremental
// (no cambia al escanear repos, sí al abrir, cerrar, activar o reordenar), la normalización defensiva y los
// ajustes por perfil: vistas, mosaico, grupos SSH plegados, el riel de conexiones SSH (ancho global y
// visibilidad), el lanzador (que un archivo con ajustes que ya no se guardan se lea sin error) y si se ve el agente de la terminal.
// =============================================================================

import { crearCarpetaTemporal } from '../../../../../scripts/pruebas/temporales.mts'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { estadoInicialArbolPestanas, reducirPestanas, type EstadoArbolPestanas, type AccionPestanas } from './modeloPestanas.ts'
import {
  serializeWorkspace,
  pestanasPerfilDesdeGuardado,
  sesionRestauradaDesdeEstado
} from './fotoWorkspace.ts'
import {
  clasificarPresencia,
  AJUSTES_DEFECTO,
  ANCHO_LATERAL_DEFECTO,
  normalizarEstadoWorkspace,
  depurarProyectosAusentes,
  raizDeVolumen,
  ANCHO_LATERAL_MAX,
  ANCHO_LATERAL_MIN,
  TAMANO_LETRA_TERMINAL_MAX,
  type PresenciaProyecto,
  type EstadoWorkspace
} from '../../../../shared/workspace-state-ipc.ts'
import {
  conAgenteTerminalVisible,
  conPlegado,
  podarMapaPorPerfil,
  SSH_RIEL_ANCHO_MAX,
  SSH_RIEL_ANCHO_MIN,
  SSH_RIEL_ANCHO_POR_DEFECTO,
  type AgenteTerminalVisiblePorPerfil,
  type SshGruposPlegadosPorPerfil
} from '../../../../shared/ajustesTerminal.ts'
import type { RepoDetectado } from '../../../../shared/workspace-ipc.ts'
import type { Perfil } from '../../../../main/perfiles/types.ts'

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
function crearPerfil(id: string): Perfil {
  return {
    id,
    nombre: id.toUpperCase(),
    color: '#61afef',
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: false }
  }
}
function aplicar(estado: EstadoArbolPestanas, ...acciones: AccionPestanas[]): EstadoArbolPestanas {
  return acciones.reduce(reducirPestanas, estado)
}
const PERFILES = [crearPerfil('alfa'), crearPerfil('beta')]
const repos = (rutas: string[]): RepoDetectado[] =>
  rutas.map((p, i) => ({ name: path.basename(p), repoHostPath: p, isRoot: i === 0 }))

// Estado base: 'alfa' con dos proyectos abiertos (B activo), 'beta' con uno.
function estadoBase(): EstadoArbolPestanas {
  let s = estadoInicialArbolPestanas(PERFILES, 'alfa')
  s = aplicar(
    s,
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: 'C:\\proj\\A', name: 'A' } },
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: 'C:\\proj\\B', name: 'B' } },
    { tipo: 'setActiveProfile', perfilId: 'beta' },
    { tipo: 'openProject', perfilId: 'beta', proyecto: { projectHostPath: 'C:\\proj\\C', name: 'C' } },
    { tipo: 'setActiveProfile', perfilId: 'alfa' }
  )
  return s
}

// ---------------------------------------------------------------------------
hr('(1) serialize proyecta SOLO el esqueleto (perfil activo + proyectos + activo)')
// ---------------------------------------------------------------------------
{
  const s = estadoBase()
  const workspace = serializeWorkspace(s)
  check(
    '(1.1) version=1 y activeProfileId es el activo (alfa)',
    workspace.version === 1 && workspace.activeProfileId === 'alfa',
    `version=${workspace.version} activeProfileId=${workspace.activeProfileId}`
  )
  check(
    "(1.2) alfa -> [A,B] con activo B; beta -> [C] con activo C",
    eq(workspace.byProfile.alfa.openProjects.map((p) => p.projectHostPath), ['C:\\proj\\A', 'C:\\proj\\B']) &&
      workspace.byProfile.alfa.activePath === 'C:\\proj\\B' &&
      eq(workspace.byProfile.beta.openProjects.map((p) => p.projectHostPath), ['C:\\proj\\C']) &&
      workspace.byProfile.beta.activePath === 'C:\\proj\\C',
    JSON.stringify(workspace.byProfile)
  )
  check(
    "(1.3) cada proyecto trae name + estado 'active' (default; B1 lo poblará)",
    workspace.byProfile.alfa.openProjects.every((p) => p.estado === 'active' && typeof p.name === 'string'),
    JSON.stringify(workspace.byProfile.alfa.openProjects)
  )
  // Escanear repos rellena estadoRepos (nivel 3); serialize NO debe reflejarlo.
  const escaneado = aplicar(s, {
    tipo: 'setScannedRepos',
    perfilId: 'alfa',
    rutaHostProyecto: 'C:\\proj\\B',
    repos: repos(['C:\\proj\\B', 'C:\\proj\\B\\sub'])
  })
  check(
    '(1.4) serialize descarta estadoRepos (no aparece nada de repos en la proyección)',
    !JSON.stringify(serializeWorkspace(escaneado)).includes('repoHostPath') &&
      !JSON.stringify(serializeWorkspace(escaneado)).includes('sub'),
    'la proyección no contiene repoHostPath ni la subcarpeta escaneada'
  )
}

// ---------------------------------------------------------------------------
hr('(2) ROUND-TRIP A DISCO: escribir estado -> leerlo -> coincide (replica el store)')
// ---------------------------------------------------------------------------
{
  const s = estadoBase()
  const workspace = serializeWorkspace(s)
  // Replica EXACTA de lo que hace guardarEstadoWorkspace/cargarEstadoWorkspace del main,
  // pero contra un tmpdir (sin electron): write JSON -> read -> normalize.
  const dir = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-'))
  const archivo = path.join(dir, 'workspace-state.json')
  writeFileSync(archivo, JSON.stringify(normalizarEstadoWorkspace(workspace), null, 2) + '\n', 'utf-8')
  const releido = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo, 'utf-8')))
  check(
    '(2.1) el documento releído del disco es IDÉNTICO al normalizado escrito',
    eq(releido, normalizarEstadoWorkspace(workspace)),
    `disco=${JSON.stringify(releido)}`
  )
  check(
    '(2.2) sobrevive el activo por perfil y el perfil activo global',
    releido !== null &&
      releido.activeProfileId === 'alfa' &&
      releido.byProfile.alfa.activePath === 'C:\\proj\\B' &&
      releido.byProfile.beta.activePath === 'C:\\proj\\C',
    JSON.stringify(releido)
  )
}

// ---------------------------------------------------------------------------
hr('(3) pestanasPerfilDesdeGuardado reconstruye el EstadoPestanasPerfil (estadoRepos vacío)')
// ---------------------------------------------------------------------------
{
  const workspace = serializeWorkspace(estadoBase())
  const reconstruido = pestanasPerfilDesdeGuardado(workspace.byProfile.alfa)
  check(
    '(3.1) openProjects (path+name+estado) y activePath reconstruidos; estadoRepos vacío',
    eq(reconstruido.proyectosAbiertos, [
      { rutaHostProyecto: 'C:\\proj\\A', nombre: 'A', estado: 'active' },
      { rutaHostProyecto: 'C:\\proj\\B', nombre: 'B', estado: 'active' }
    ]) &&
      reconstruido.rutaActiva === 'C:\\proj\\B' &&
      eq(reconstruido.estadoRepos, {}),
    JSON.stringify(reconstruido)
  )
}

// ---------------------------------------------------------------------------
hr('(3b) ESTADO hibernado: serialize/deserialize lo preservan (round-trip)')
// ---------------------------------------------------------------------------
{
  // Estado MIXTO (B hibernado, A activo): hibernar el perfil (ambos hibernated) y
  // despertar A (setActiveProject). Luego serializar -> disco -> restaurar.
  const s = aplicar(
    estadoBase(),
    { tipo: 'hibernateProfile', perfilId: 'alfa' },
    { tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: 'C:\\proj\\A' }
  )
  const workspace = serializeWorkspace(s)
  const bGuardado = workspace.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\B')
  const aGuardado = workspace.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\A')
  check(
    '(3b.1) serialize emite el estado REAL: B hibernated, A active',
    bGuardado?.estado === 'hibernated' && aGuardado?.estado === 'active',
    `A=${aGuardado?.estado} B=${bGuardado?.estado}`
  )
  const reconstruido = pestanasPerfilDesdeGuardado(normalizarEstadoWorkspace(workspace)!.byProfile.alfa)
  const bReconstruido = reconstruido.proyectosAbiertos.find((p) => p.rutaHostProyecto === 'C:\\proj\\B')
  check(
    '(3b.2) deserialize respeta hibernated (round-trip por normalize + pestanasPerfilDesdeGuardado)',
    bReconstruido?.estado === 'hibernated',
    `B_rebuilt=${bReconstruido?.estado}`
  )
}

// ---------------------------------------------------------------------------
hr('(3c) AGENTE HIBERNADO por inactividad: en disco es un hibernado más')
// ---------------------------------------------------------------------------
{
  const s = aplicar(estadoBase(), { tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: 'C:\\proj\\B' })
  const enMemoria = s.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === 'C:\\proj\\B')
  const workspace = serializeWorkspace(s)
  const enDisco = workspace.byProfile.alfa.openProjects.find((p) => p.projectHostPath === 'C:\\proj\\B')
  check(
    "(3c.1) en memoria es 'agente-hibernado' y se guarda como 'hibernated'",
    enMemoria?.estado === 'agente-hibernado' && enDisco?.estado === 'hibernated',
    `memoria=${enMemoria?.estado} disco=${enDisco?.estado}`
  )
  check(
    '(3c.2) el documento guardado pasa el normalizador sin perder el proyecto',
    normalizarEstadoWorkspace(workspace)?.byProfile.alfa.openProjects.length === workspace.byProfile.alfa.openProjects.length,
    `proyectos=${normalizarEstadoWorkspace(workspace)?.byProfile.alfa.openProjects.length}`
  )
  const ajuste = (v: unknown): unknown =>
    normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: v === undefined ? {} : { agenteInactividadMin: v } })
      ?.settings?.agenteInactividadMin
  check('(3c.3) el ajuste ausente vale 5 minutos', ajuste(undefined) === 5, String(ajuste(undefined)))
  check('(3c.4) «Nunca» (0) y los valores de la lista se conservan', ajuste(0) === 0 && ajuste(30) === 30, `${ajuste(0)} ${ajuste(30)}`)
  check('(3c.5) la basura cae a 5, nunca a «Nunca»', ajuste(7) === 5 && ajuste('10') === 5 && ajuste(null) === 5, `${ajuste(7)} ${ajuste('10')} ${ajuste(null)}`)
}

// ---------------------------------------------------------------------------
hr('(4) INCREMENTAL: la proyección cambia SOLO en los cambios que deben persistir')
// ---------------------------------------------------------------------------
{
  const s = estadoBase()
  const j = (st: EstadoArbolPestanas): string => JSON.stringify(serializeWorkspace(st))
  const antes = j(s)

  const trasEscanear = aplicar(s, {
    tipo: 'setScannedRepos',
    perfilId: 'alfa',
    rutaHostProyecto: 'C:\\proj\\B',
    repos: repos(['C:\\proj\\B'])
  })
  check(
    '(4.1) escanear repos NO cambia la proyección (no dispararía escritura)',
    j(trasEscanear) === antes,
    'proyección idéntica tras setScannedRepos'
  )

  const trasAbrir = aplicar(s, {
    tipo: 'openProject',
    perfilId: 'alfa',
    proyecto: { projectHostPath: 'C:\\proj\\D', name: 'D' }
  })
  const trasCerrar = aplicar(s, { tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: 'C:\\proj\\A' })
  const trasActivar = aplicar(s, {
    tipo: 'setActiveProject',
    perfilId: 'alfa',
    rutaHostProyecto: 'C:\\proj\\A'
  })
  const trasPerfil = aplicar(s, { tipo: 'setActiveProfile', perfilId: 'beta' })
  check(
    '(4.2) abrir / cerrar / activar proyecto y cambiar de perfil SÍ cambian la proyección',
    j(trasAbrir) !== antes &&
      j(trasCerrar) !== antes &&
      j(trasActivar) !== antes &&
      j(trasPerfil) !== antes,
    `open≠ ${j(trasAbrir) !== antes}, close≠ ${j(trasCerrar) !== antes}, ` +
      `activate≠ ${j(trasActivar) !== antes}, profile≠ ${j(trasPerfil) !== antes}`
  )

  const reordenado = aplicar(s, { tipo: 'reordenarProyectos', perfilId: 'alfa', rutasOrdenadas: ['C:\\proj\\B', 'C:\\proj\\A'] })
  check('(4.3) reordenar los proyectos SÍ cambia la proyección (se guarda)', j(reordenado) !== antes, `cambia=${j(reordenado) !== antes}`)
  const mismoOrden = aplicar(s, { tipo: 'reordenarProyectos', perfilId: 'alfa', rutasOrdenadas: ['C:\\proj\\A', 'C:\\proj\\B'] })
  check('(4.4) «reordenar» al mismo orden no cambia nada (mismo state, misma proyección)', mismoOrden === s && j(mismoOrden) === antes, 'same')
}

// ---------------------------------------------------------------------------
hr('(4c) La marca de AGENTE DIFERIDO se guarda con el proyecto y vuelve al restaurar')
// ---------------------------------------------------------------------------
{
  const j = (st: EstadoArbolPestanas): string => JSON.stringify(serializeWorkspace(st))
  const base = estadoBase()
  const D = 'C:\\proj\\suelto'
  const conMarca = aplicar(base, { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: D, name: 'suelto' }, agenteDiferido: true })
  const sinMarca = aplicar(base, { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: D, name: 'suelto' } })
  const workspace = serializeWorkspace(conMarca)
  const guardado = workspace.byProfile.alfa.openProjects.find((p) => p.projectHostPath === D)
  check('(4c.1) serialize escribe `agenteDiferido: true` en el proyecto marcado', guardado?.agenteDiferido === true, JSON.stringify(guardado))
  check(
    '(4c.2) un proyecto sin marca no lleva la clave: su JSON es el de siempre',
    !j(sinMarca).includes('agenteDiferido') && j(base) === JSON.stringify(serializeWorkspace(estadoBase())),
    'sin clave'
  )
  check('(4c.3) poner la marca cambia la proyección (se guarda)', j(conMarca) !== j(sinMarca), 'distinta')
  const quitada = aplicar(conMarca, { tipo: 'quitarAgenteDiferido', perfilId: 'alfa', rutaHostProyecto: D })
  check('(4c.4) y quitarla también, dejándola igual que si nunca la hubo', j(quitada) !== j(conMarca) && j(quitada) === j(sinMarca), 'vuelve a la de sin marca')

  const leido = normalizarEstadoWorkspace(JSON.parse(JSON.stringify(normalizarEstadoWorkspace(workspace))))
  const podado = leido === null ? null : depurarProyectosAusentes(leido, () => 'presente')
  const restaurado = estadoInicialArbolPestanas(PERFILES, undefined, sesionRestauradaDesdeEstado(podado))
  const vuelto = restaurado.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === D)
  check('(4c.5) guardar, normalizar, podar y restaurar conserva la marca', vuelto?.agenteDiferido === true, JSON.stringify(vuelto))
  check('(4c.6) y los demás proyectos vuelven sin ella', restaurado.porPerfil.alfa.proyectosAbiertos.filter((p) => p.agenteDiferido).length === 1, 'solo uno')

  const raro = (valor: unknown): boolean => {
    const doc = normalizarEstadoWorkspace({
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
  const s = aplicar(estadoBase(), { tipo: 'reordenarProyectos', perfilId: 'alfa', rutasOrdenadas: ['C:\\proj\\B', 'C:\\proj\\A'] })
  const dir = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-'))
  const archivo = path.join(dir, 'workspace-state.json')
  writeFileSync(archivo, JSON.stringify(normalizarEstadoWorkspace(serializeWorkspace(s)), null, 2) + '\n', 'utf-8')
  const leido = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo, 'utf-8')))
  const podado = leido === null ? null : depurarProyectosAusentes(leido, () => 'presente')
  const restaurado = estadoInicialArbolPestanas(PERFILES, undefined, sesionRestauradaDesdeEstado(podado))
  const rutas = (id: string): string[] => restaurado.porPerfil[id].proyectosAbiertos.map((p) => p.rutaHostProyecto)
  check(
    '(4b.1) el perfil reordenado vuelve en su orden nuevo, con el mismo activo',
    eq(rutas('alfa'), ['C:\\proj\\B', 'C:\\proj\\A']) && restaurado.porPerfil.alfa.rutaActiva === 'C:\\proj\\B',
    `alfa=${JSON.stringify(rutas('alfa'))} activo=${restaurado.porPerfil.alfa.rutaActiva}`
  )
  check('(4b.2) el otro perfil queda como estaba', eq(rutas('beta'), ['C:\\proj\\C']), JSON.stringify(rutas('beta')))
}

// ---------------------------------------------------------------------------
hr('(5) normalize DEFENSIVO (robusto a cierre sucio / archivo corrupto)')
// ---------------------------------------------------------------------------
{
  const crudo = {
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
  const n = normalizarEstadoWorkspace(crudo)
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
    normalizarEstadoWorkspace('nope') === null && normalizarEstadoWorkspace(null) === null,
    'string y null devuelven null'
  )
}

// ---------------------------------------------------------------------------
hr('(6) RESTAURACIÓN: reconciliar estado persistido con los perfiles ACTUALES')
// ---------------------------------------------------------------------------
{
  // Estado persistido con 3 perfiles: alfa (A,B activo B), beta (C), y un ghost que
  // ya no existe; el activo global persistido es 'beta'.
  const guardado: EstadoWorkspace = {
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
  const restaurada = sesionRestauradaDesdeEstado(guardado)

  // Perfiles ACTUALES: alfa + gamma. beta fue BORRADO; ghost nunca existió; gamma es
  // nuevo (sin entrada persistida).
  const perfilesActuales = [crearPerfil('alfa'), crearPerfil('gamma')]
  const st = estadoInicialArbolPestanas(perfilesActuales, 'alfa', restaurada)

  check(
    '(6.1) perfil borrado (beta) y ghost descartados: byProfile solo tiene perfiles actuales',
    eq(Object.keys(st.porPerfil).sort(), ['alfa', 'gamma']),
    `keys=${JSON.stringify(Object.keys(st.porPerfil))}`
  )
  check(
    '(6.2) alfa se restaura (A,B activo B); gamma (actual sin entrada) arranca vacío',
    eq(st.porPerfil.alfa.proyectosAbiertos.map((p) => p.rutaHostProyecto), ['C:\\proj\\A', 'C:\\proj\\B']) &&
      st.porPerfil.alfa.rutaActiva === 'C:\\proj\\B' &&
      eq(st.porPerfil.gamma.proyectosAbiertos, []) &&
      st.porPerfil.gamma.rutaActiva === null,
    `alfa=${JSON.stringify(st.porPerfil.alfa)} gamma=${JSON.stringify(st.porPerfil.gamma)}`
  )
  check(
    '(6.2b) la restauración RESPETA el estado: A amanece hibernated, B active',
    st.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === 'C:\\proj\\A')?.estado === 'hibernated' &&
      st.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === 'C:\\proj\\B')?.estado === 'active',
    JSON.stringify(st.porPerfil.alfa.proyectosAbiertos.map((p) => ({ p: p.rutaHostProyecto, e: p.estado })))
  )
  check(
    '(6.3) estadoRepos restaurado VACÍO (se re-escanea perezoso al activar)',
    eq(st.porPerfil.alfa.estadoRepos, {}),
    JSON.stringify(st.porPerfil.alfa.estadoRepos)
  )
  check(
    "(6.4) activo persistido inválido (beta borrado) -> fallback al preferido 'alfa'",
    st.perfilActivoId === 'alfa',
    `activeProfileId=${st.perfilActivoId}`
  )

  // Mismo estado pero con beta AÚN presente: el activo persistido SÍ se respeta.
  const conBeta = estadoInicialArbolPestanas([crearPerfil('alfa'), crearPerfil('beta')], 'alfa', restaurada)
  check(
    '(6.5) activo persistido válido (beta presente) -> se restaura como activo',
    conBeta.perfilActivoId === 'beta' &&
      eq(conBeta.porPerfil.beta.proyectosAbiertos.map((p) => p.rutaHostProyecto), ['C:\\proj\\C']),
    `activeProfileId=${conBeta.perfilActivoId}`
  )
  // POLÍTICA DE ARRANQUE: con beta activo, SOLO su proyecto activo (C) queda
  // 'active'; los proyectos de alfa (otro perfil), incluido B que se persistió
  // 'active', amanecen 'hibernated'. Solo se enciende un proyecto al abrir.
  check(
    '(6.5b) arranque: solo el proyecto activo del perfil activo (beta/C) queda active; el resto hibernado',
    conBeta.porPerfil.beta.proyectosAbiertos[0].estado === 'active' &&
      conBeta.porPerfil.alfa.proyectosAbiertos.every((p) => p.estado === 'hibernated'),
    `beta/C=${conBeta.porPerfil.beta.proyectosAbiertos[0].estado} alfa=${JSON.stringify(conBeta.porPerfil.alfa.proyectosAbiertos.map((p) => p.estado))}`
  )

  // Estado null (sin archivo / corrupto): arranque limpio como hoy.
  const sinSesion = estadoInicialArbolPestanas([crearPerfil('alfa'), crearPerfil('beta')], 'alfa', sesionRestauradaDesdeEstado(null))
  check(
    '(6.6) estado null -> byProfile vacío por perfil y activo por defecto (preferido)',
    eq(sinSesion.porPerfil.alfa.proyectosAbiertos, []) &&
      eq(sinSesion.porPerfil.beta.proyectosAbiertos, []) &&
      sinSesion.perfilActivoId === 'alfa',
    `active=${sinSesion.perfilActivoId} alfa=${JSON.stringify(sinSesion.porPerfil.alfa.proyectosAbiertos)}`
  )
}

// ---------------------------------------------------------------------------
hr('(7) RESTAURACIÓN: depurarProyectosAusentes descarta rutas inexistentes en disco')
// ---------------------------------------------------------------------------
{
  const workspace: EstadoWorkspace = {
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
  const podado = depurarProyectosAusentes(workspace, presencia)

  check(
    '(7.1) alfa conserva solo A (viva); B y C (borradas) descartadas',
    eq(podado.byProfile.alfa.openProjects.map((p) => p.projectHostPath), ['C:\\vive\\A']),
    JSON.stringify(podado.byProfile.alfa.openProjects)
  )
  check(
    '(7.2) activo apuntaba a una borrada (C) -> cae al primer superviviente (A)',
    podado.byProfile.alfa.activePath === 'C:\\vive\\A',
    `activePath=${podado.byProfile.alfa.activePath}`
  )
  check(
    '(7.3) perfil x, con todas sus rutas borradas, se omite entero',
    podado.byProfile.x === undefined,
    `x=${JSON.stringify(podado.byProfile.x)}`
  )

  // END-TO-END: prune -> sesionRestauradaDesdeEstado -> estadoInicialArbolPestanas no revive nada.
  const st = estadoInicialArbolPestanas([crearPerfil('alfa'), crearPerfil('x')], 'alfa', sesionRestauradaDesdeEstado(podado))
  check(
    '(7.4) end-to-end: tras podar, estadoInicialArbolPestanas restaura solo A y x queda vacío',
    eq(st.porPerfil.alfa.proyectosAbiertos.map((p) => p.rutaHostProyecto), ['C:\\vive\\A']) &&
      eq(st.porPerfil.x.proyectosAbiertos, []),
    `alfa=${JSON.stringify(st.porPerfil.alfa.proyectosAbiertos)} x=${JSON.stringify(st.porPerfil.x.proyectosAbiertos)}`
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
  const todoDudoso = depurarProyectosAusentes(workspace, () => 'indeterminada')
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
  const mezcla = depurarProyectosAusentes(workspace, (p) =>
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
  const workspaceMac: EstadoWorkspace = {
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
      depurarProyectosAusentes(workspaceMac, () => 'indeterminada').byProfile.personal.openProjects.map(
        (p) => p.projectHostPath
      ),
      ['/Users/x/Documents/tessera']
    ),
    JSON.stringify(depurarProyectosAusentes(workspaceMac, () => 'indeterminada').byProfile.personal)
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
  const sinAjustes = normalizarEstadoWorkspace({ version: 1, activeProfileId: 'alfa', byProfile: {} })
  check(
    '(8.1) sin slice settings -> default zoomLevel 0 (nunca undefined)',
    sinAjustes !== null && sinAjustes.settings?.zoomLevel === 0,
    `settings=${JSON.stringify(sinAjustes?.settings)}`
  )

  // (8.2) Valores inválidos / fuera de rango -> saneados (NaN/no-numérico -> 0;
  // fuera de rango -> acotado; decimal -> redondeado).
  const garbage = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: 'mucho' }
  })
  const demasiadoAlto = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: 99 }
  })
  const demasiadoBajo = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: -99 }
  })
  const decimal = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: { zoomLevel: 1.6 }
  })
  check(
    '(8.2) zoomLevel saneado: basura->0, >max->5, <min->-3, decimal->redondeo',
    garbage?.settings?.zoomLevel === 0 &&
      demasiadoAlto?.settings?.zoomLevel === 5 &&
      demasiadoBajo?.settings?.zoomLevel === -3 &&
      decimal?.settings?.zoomLevel === 2,
    `garbage=${garbage?.settings?.zoomLevel} high=${demasiadoAlto?.settings?.zoomLevel} ` +
      `low=${demasiadoBajo?.settings?.zoomLevel} decimal=${decimal?.settings?.zoomLevel}`
  )

  // (8.3) Round-trip a disco de un zoomLevel válido (replica guardarAjustes/load).
  const dir = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-set-'))
  const archivo = path.join(dir, 'workspace-state.json')
  const doc = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: { zoomLevel: 3 }
  })
  writeFileSync(archivo, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
  const releido = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo, 'utf-8')))
  check(
    '(8.3) round-trip: zoomLevel 3 sobrevive escribir->leer->normalize',
    releido?.settings?.zoomLevel === 3,
    `back=${JSON.stringify(releido?.settings)}`
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
  const ajustesDe = (ajustesCrudos: unknown): Record<string, unknown> | undefined =>
    normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: ajustesCrudos })
      ?.settings as unknown as Record<string, unknown> | undefined

  // (9.1) Defaults cuando el archivo no trae nada de layout.
  const def = ajustesDe(undefined)
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
  const lateral = ajustesDe({
    sidebarWidthByView: { files: 5, git: 9999, settings: 412.7, db: 'ancho', activity: 300, fantasma: 300 }
  })?.sidebarWidthByView as Record<string, number> | undefined
  check(
    '(9.2) ancho lateral por vista: clamp [180,480], redondeo, clave desconocida fuera y valor no numérico fuera',
    lateral?.files === 180 &&
      lateral?.git === 480 &&
      lateral?.settings === 413 &&
      lateral?.db === undefined &&
      lateral?.activity === undefined &&
      lateral?.fantasma === undefined,
    `side=${JSON.stringify(lateral)}`
  )

  // (9.3) CC y terminal: clamp a su rango; basura -> default.
  const tight = ajustesDe({ ccWidth: 10, terminalHeight: 10 })
  const huge = ajustesDe({ ccWidth: 99999, terminalHeight: 99999 })
  const junk = ajustesDe({ ccWidth: 'ancho', terminalHeight: null })
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
  const logEstrecho = ajustesDe({ gitLogRamasWidth: 10, gitLogDetalleWidth: 10 })
  const logEnorme = ajustesDe({ gitLogRamasWidth: 99999, gitLogDetalleWidth: 99999 })
  const logBasura = ajustesDe({ gitLogRamasWidth: 'ancho', gitLogDetalleWidth: null })
  check(
    '(9.3b) anchos del panel Git·Log: acotados a [140,900] y basura -> default',
    logEstrecho?.gitLogRamasWidth === 140 &&
      logEstrecho?.gitLogDetalleWidth === 140 &&
      logEnorme?.gitLogRamasWidth === 900 &&
      logEnorme?.gitLogDetalleWidth === 900 &&
      logBasura?.gitLogRamasWidth === 210 &&
      logBasura?.gitLogDetalleWidth === 330,
    `tight=${logEstrecho?.gitLogRamasWidth}/${logEstrecho?.gitLogDetalleWidth} ` +
      `huge=${logEnorme?.gitLogRamasWidth}/${logEnorme?.gitLogDetalleWidth} ` +
      `junk=${logBasura?.gitLogRamasWidth}/${logBasura?.gitLogDetalleWidth}`
  )

  // (9.3c) `gitChangesHeight` ya no es un ajuste. Un archivo viejo que aún lo traiga
  // no debe resucitarlo: normalizarAjustes
  // reconstruye el objeto entero, así que la clave muerta se cae sola.
  const viejo = ajustesDe({ gitChangesHeight: 300, ccWidth: 500 })
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
    const s = ajustesDe({ activityBarOrder: arriba, bottomBarOrder: abajo })
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
  const col = ajustesDe({
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
  const migrado = normalizarEstadoWorkspace({
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
  const separado = normalizarEstadoWorkspace({
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
  // La letra del editor de código: sin el campo, la predeterminada (no la de la terminal), y lo absurdo se sanea.
  check(
    '(9.6b) sin editorFont*: la predeterminada, no la de la terminal',
    migrado?.editorFontFamily === '' && migrado?.editorFontSize === 0,
    `editor=${JSON.stringify(migrado?.editorFontFamily)}/${migrado?.editorFontSize}`
  )
  const editorRaro = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: { editorFontFamily: 42, editorFontSize: 999 }
  })?.settings as Record<string, unknown> | undefined
  check(
    '(9.6b) editorFont* inválidos: la familia cae a la predeterminada y el tamaño se acota',
    editorRaro?.editorFontFamily === '' && editorRaro?.editorFontSize === TAMANO_LETRA_TERMINAL_MAX,
    `editor=${JSON.stringify(editorRaro?.editorFontFamily)}/${editorRaro?.editorFontSize}`
  )
  // Tamaño de letra de la interfaz: 0 = predeterminado, y lo absurdo se acota.
  const ui = (v: unknown): unknown =>
    (
      normalizarEstadoWorkspace({
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
  const tamanos = (crudo: Record<string, unknown>): Record<string, unknown> =>
    (normalizarEstadoWorkspace({
      version: 1,
      activeProfileId: 'alfa',
      byProfile: {},
      settings: crudo
    })?.settings ?? {}) as Record<string, unknown>
  {
    const s = tamanos({ explorerFontSize: 900, gitFontSize: 3 })
    check(
      '(9.8a) los overrides se acotan igual que la base',
      s.explorerFontSize === 18 && s.gitFontSize === 9,
      `explorer->${s.explorerFontSize} git->${s.gitFontSize}`
    )
    const basura = tamanos({ explorerFontSize: 'enorme', gitFontSize: null })
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
    const viejo = tamanos({ uiFontSize: 10 })
    check(
      '(9.8c) un archivo VIEJO deja los overrides en 0 (heredan), no en uiFontSize',
      viejo.uiFontSize === 10 && viejo.explorerFontSize === 0 && viejo.gitFontSize === 0,
      `ui->${viejo.uiFontSize} explorer->${viejo.explorerFontSize} git->${viejo.gitFontSize}`
    )
    const propios = tamanos({ uiFontSize: 10, explorerFontSize: 16, gitFontSize: 0 })
    check(
      '(9.8d) un override propio manda y el otro sigue heredando',
      propios.explorerFontSize === 16 && propios.gitFontSize === 0,
      `explorer->${propios.explorerFontSize} git->${propios.gitFontSize}`
    )
  }

  // (9.5) Round-trip a disco de una configuración de layout REAL: lo que el
  // usuario dejó puesto es exactamente lo que amanece en el siguiente arranque.
  const dir2 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-layout-'))
  const archivo2 = path.join(dir2, 'workspace-state.json')
  const doc2 = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: {
      sidebarWidthByView: { files: 240, settings: 420 },
      ccWidth: 620,
      terminalHeight: 300
    }
  })
  writeFileSync(archivo2, JSON.stringify(doc2, null, 2) + '\n', 'utf-8')
  const releido2 = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo2, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  const lateralReleido = releido2?.sidebarWidthByView as Record<string, number> | undefined
  check(
    '(9.5) round-trip: anchos por vista y cc/terminal sobreviven al disco',
    lateralReleido?.files === 240 &&
      lateralReleido?.settings === 420 &&
      releido2?.ccWidth === 620 &&
      releido2?.terminalHeight === 300,
    `back=${JSON.stringify(releido2)}`
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
  const vacio = normalizarEstadoWorkspace({ version: 1, activeProfileId: 'alfa', byProfile: {} })
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
  const sucio = normalizarEstadoWorkspace({
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
  const noEsLista = normalizarEstadoWorkspace({
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
  // normalizarAjustes. Un campo declarado y saneado pero no devuelto se pierde al
  // reiniciar sin dar ninguna señal.
  const dir3 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-sbx-'))
  const archivo3 = path.join(dir3, 'workspace-state.json')
  const doc3 = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: { paquetesExtraSandbox: ['libreoffice-writer', 'poppler-utils'], sandboxDepsNavegador: true }
  })
  writeFileSync(archivo3, JSON.stringify(doc3, null, 2) + '\n', 'utf-8')
  const releido3 = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo3, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  check(
    '(10.7) round-trip: los paquetes y el flag sobreviven a escribir->leer->normalize',
    JSON.stringify(releido3?.paquetesExtraSandbox) ===
      JSON.stringify(['libreoffice-writer', 'poppler-utils']) && releido3?.sandboxDepsNavegador === true,
    `back=${JSON.stringify(releido3?.paquetesExtraSandbox)} deps=${String(releido3?.sandboxDepsNavegador)}`
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
  const vacio = normalizarEstadoWorkspace({ version: 1, activeProfileId: 'alfa', byProfile: {} })
    ?.settings as Record<string, unknown> | undefined
  check(
    '(11.1) sin clave: los dos mapas son {} y nunca undefined',
    JSON.stringify(vacio?.vistaLateralPorPerfil) === '{}' &&
      JSON.stringify(vacio?.panelInferiorPorPerfil) === '{}',
    `vista=${JSON.stringify(vacio?.vistaLateralPorPerfil)} panel=${JSON.stringify(vacio?.panelInferiorPorPerfil)}`
  )

  const mezcla = normalizarEstadoWorkspace({
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
      const r = normalizarEstadoWorkspace({
        version: 1,
        activeProfileId: null,
        byProfile: {},
        settings: { [k]: ['alfa', 'git'] }
      })?.settings as Record<string, unknown> | undefined
      return JSON.stringify(r?.[k]) === '{}'
    }),
    'array -> {}'
  )

  // Round-trip: fija que los dos campos estén en el `return` de normalizarAjustes.
  const dir4 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-ui-'))
  const archivo4 = path.join(dir4, 'workspace-state.json')
  const doc4 = normalizarEstadoWorkspace({
    version: 1,
    activeProfileId: 'alfa',
    byProfile: {},
    settings: {
      vistaLateralPorPerfil: { alfa: 'git', beta: 'files' },
      panelInferiorPorPerfil: { alfa: 'terminal' }
    }
  })
  writeFileSync(archivo4, JSON.stringify(doc4, null, 2) + '\n', 'utf-8')
  const releido4 = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo4, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  check(
    '(11.5) round-trip: lo que mira cada perfil sobrevive a escribir->leer->normalize',
    JSON.stringify(releido4?.vistaLateralPorPerfil) === JSON.stringify({ alfa: 'git', beta: 'files' }) &&
      JSON.stringify(releido4?.panelInferiorPorPerfil) === JSON.stringify({ alfa: 'terminal' }),
    `vista=${JSON.stringify(releido4?.vistaLateralPorPerfil)} panel=${JSON.stringify(releido4?.panelInferiorPorPerfil)}`
  )
}

// ---------------------------------------------------------------------------
hr('(12) SETTINGS: la distribución del MOSAICO DE AGENTES')
// ---------------------------------------------------------------------------
// Sólo se persiste la distribución elegida, no el mosaico ni sus casillas (ver el
// campo). Lo que se fija: su valor por defecto, que un id desconocido —de una versión
// futura con otra distribución— vuelva a Automático, y que sobreviva al disco.
{
  const ajustes = (ajustesCrudos: unknown): Record<string, unknown> | undefined =>
    normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: ajustesCrudos })?.settings as
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
  const dir5 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-mosaico-'))
  const archivo5 = path.join(dir5, 'workspace-state.json')
  writeFileSync(
    archivo5,
    JSON.stringify(normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: { mosaicoPreset: 'cuadricula' } }), null, 2) + '\n',
    'utf-8'
  )
  const releido5 = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo5, 'utf-8')))?.settings as
    | Record<string, unknown>
    | undefined
  check(
    '(12.4) round-trip: la distribución sobrevive a escribir->leer->normalize',
    releido5?.mosaicoPreset === 'cuadricula',
    String(releido5?.mosaicoPreset)
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
  const ajustes = (ajustesCrudos: unknown): Record<string, unknown> | undefined =>
    normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: ajustesCrudos })?.settings as
      | Record<string, unknown>
      | undefined
  const plegados = (crudo: unknown): unknown => ajustes({ sshGruposPlegadosPorPerfil: crudo })?.sshGruposPlegadosPorPerfil
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
    [null, 'alfa', 7, ['alfa'], true].every((crudo) => eq(plegados(crudo), {})),
    'null/texto/número/array/booleano -> {}'
  )
  const dir6 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-ssh-'))
  const archivo6 = path.join(dir6, 'workspace-state.json')
  writeFileSync(
    archivo6,
    JSON.stringify(normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: { sshGruposPlegadosPorPerfil: { alfa: ['g1', ''] } } }), null, 2) + '\n',
    'utf-8'
  )
  const releido6 = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo6, 'utf-8')))?.settings as Record<string, unknown> | undefined
  check(
    '(13.6) round-trip: los plegados sobreviven a escribir->leer->normalize',
    eq(releido6?.sshGruposPlegadosPorPerfil, { alfa: ['g1', ''] }),
    JSON.stringify(releido6?.sshGruposPlegadosPorPerfil)
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
hr('(14) SETTINGS de SSH: el riel de conexiones a pantalla completa (ancho GLOBAL)')
// ---------------------------------------------------------------------------
// `sshRielAncho` (px, entero y dentro del rango del lateral). Lo que se fija: el valor por defecto, que un
// valor malo cae a su por defecto SIN llevarse a los vecinos, que sobrevive al disco, que la clave antigua de
// ocultar el riel se ignora y la poda por perfil.
{
  const ajustes = (ajustesCrudos: unknown): Record<string, unknown> | undefined =>
    normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: ajustesCrudos })?.settings as
      | Record<string, unknown>
      | undefined
  const ancho = (crudo: unknown): unknown => ajustes({ sshRielAncho: crudo })?.sshRielAncho
  check(
    '(14.1) por defecto: 260 px, en AJUSTES_DEFECTO y sin la clave en el archivo',
    AJUSTES_DEFECTO.sshRielAncho === 260 && ancho(undefined) === 260,
    `${AJUSTES_DEFECTO.sshRielAncho}`
  )
  check(
    '(14.2) el rango y el ancho por defecto son los del lateral de la app: no se separan',
    SSH_RIEL_ANCHO_POR_DEFECTO === ANCHO_LATERAL_DEFECTO &&
      SSH_RIEL_ANCHO_MIN === ANCHO_LATERAL_MIN &&
      SSH_RIEL_ANCHO_MAX === ANCHO_LATERAL_MAX,
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
    ['300', null, Number.NaN, Number.POSITIVE_INFINITY, {}, [], true].every((crudo) => ancho(crudo) === 260),
    'texto/null/NaN/infinito/objeto/array/booleano -> 260'
  )
  const conVecinos = ajustes({
    sshRielAncho: 'malo',
    sshGruposPlegadosPorPerfil: { alfa: ['g1'] },
    dbAgenteWidth: 500
  })
  check(
    '(14.6) un ancho malo no se lleva a sus vecinos (plegados SSH y ancho del agente de datos)',
    conVecinos?.sshRielAncho === 260 && eq(conVecinos?.sshGruposPlegadosPorPerfil, { alfa: ['g1'] }) && conVecinos?.dbAgenteWidth === 500,
    JSON.stringify([conVecinos?.sshRielAncho, conVecinos?.sshGruposPlegadosPorPerfil, conVecinos?.dbAgenteWidth])
  )
  const dir7 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-riel-'))
  const archivo7 = path.join(dir7, 'workspace-state.json')
  writeFileSync(
    archivo7,
    JSON.stringify(
      normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: { sshRielAncho: 333 } }),
      null,
      2
    ) + '\n',
    'utf-8'
  )
  const releido7 = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo7, 'utf-8')))?.settings as Record<string, unknown> | undefined
  check('(14.10) round-trip: el ancho sobrevive a escribir->leer->normalize', releido7?.sshRielAncho === 333, JSON.stringify(releido7?.sshRielAncho))
  const dosOcultos: Record<string, boolean> = { alfa: false, beta: false }
  check(
    '(14.11) la poda genérica olvida los perfiles que ya no existen, no con una lista vacía, y con todos vivos es la misma referencia',
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
  const ajustes = (ajustesCrudos: unknown): Record<string, unknown> | undefined =>
    normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: ajustesCrudos })?.settings as
      | Record<string, unknown>
      | undefined
  const visibles = (crudo: unknown): unknown => ajustes({ agenteTerminalVisiblePorPerfil: crudo })?.agenteTerminalVisiblePorPerfil
  check(
    '(15.1) por defecto ningún perfil lo enseña, en AJUSTES_DEFECTO y sin la clave en el archivo',
    eq(AJUSTES_DEFECTO.agenteTerminalVisiblePorPerfil, {}) && eq(visibles(undefined), {}),
    JSON.stringify(AJUSTES_DEFECTO.agenteTerminalVisiblePorPerfil)
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
    [null, 'alfa', 7, [true], true].every((crudo) => eq(visibles(crudo), {})),
    'null/texto/número/array/booleano -> {}'
  )
  const conVecinos = ajustes({ agenteTerminalVisiblePorPerfil: 'malo', sshRielAncho: 300, dbAgenteVisiblePorPerfil: { alfa: true } })
  check(
    '(15.5) un valor malo no se lleva a sus vecinos (el riel SSH y el agente de datos)',
    eq(conVecinos?.agenteTerminalVisiblePorPerfil, {}) && conVecinos?.sshRielAncho === 300 && eq(conVecinos?.dbAgenteVisiblePorPerfil, { alfa: true }),
    JSON.stringify([conVecinos?.agenteTerminalVisiblePorPerfil, conVecinos?.sshRielAncho, conVecinos?.dbAgenteVisiblePorPerfil])
  )
  const dir8 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-agente-terminal-'))
  const archivo8 = path.join(dir8, 'workspace-state.json')
  writeFileSync(
    archivo8,
    JSON.stringify(
      normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: { agenteTerminalVisiblePorPerfil: { alfa: true } } }),
      null,
      2
    ) + '\n',
    'utf-8'
  )
  const releido8 = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivo8, 'utf-8')))?.settings as Record<string, unknown> | undefined
  check(
    '(15.6) round-trip: la preferencia sobrevive a escribir->leer->normalize',
    eq(releido8?.agenteTerminalVisiblePorPerfil, { alfa: true }),
    JSON.stringify(releido8?.agenteTerminalVisiblePorPerfil)
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
hr('(16) SETTINGS de SSH: las claves retiradas se ignoran')
// ---------------------------------------------------------------------------
// Un archivo escrito con `sshGrupoAbiertoPorPerfil` (el grupo que dejaba abierto el lanzador), con
// `sshRecientesPorPerfil` (sus conexiones recientes) o con `sshRielVisiblePorPerfil` (qué perfiles ocultaban
// el riel) se lee sin error, con esas claves ignoradas y sin que
// los demás ajustes se resientan; al volver a guardar lo leído ya no están en el disco.
{
  const ajustes = (ajustesCrudos: unknown): Record<string, unknown> | undefined =>
    normalizarEstadoWorkspace({ version: 1, activeProfileId: null, byProfile: {}, settings: ajustesCrudos })?.settings as
      | Record<string, unknown>
      | undefined
  const RETIRADAS = ['sshGrupoAbiertoPorPerfil', 'sshRecientesPorPerfil', 'sshRielVisiblePorPerfil']
  check(
    '(16.1) por defecto no hay ajustes de grupo abierto, de recientes ni de riel oculto',
    RETIRADAS.every((k) => !(k in AJUSTES_DEFECTO)),
    JSON.stringify(Object.keys(AJUSTES_DEFECTO).filter((k) => k.startsWith('ssh')))
  )
  const dirViejo = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-ws-retiradas-'))
  const archivoViejo = path.join(dirViejo, 'workspace-state.json')
  writeFileSync(
    archivoViejo,
    JSON.stringify({
      version: 1,
      activeProfileId: null,
      byProfile: {},
      settings: {
        sshGrupoAbiertoPorPerfil: { alfa: 'g1', beta: '' },
        sshRecientesPorPerfil: { alfa: ['c2', 'c1'] },
        sshGruposPlegadosPorPerfil: { alfa: ['g1'] },
        sshRielAncho: 300,
        sshRielVisiblePorPerfil: { alfa: false }
      }
    }),
    'utf-8'
  )
  const viejo = normalizarEstadoWorkspace(JSON.parse(readFileSync(archivoViejo, 'utf-8')))
  check(
    '(16.2) un archivo que aún trae las claves retiradas se lee sin error y no pasan a los ajustes',
    viejo !== null && RETIRADAS.every((k) => !(k in (viejo.settings ?? {}))),
    viejo === null ? 'null' : JSON.stringify(Object.keys(viejo.settings ?? {}).filter((k) => k.startsWith('ssh')))
  )
  check(
    '(16.3) y sus vecinos se leen enteros: los plegados y el ancho del riel',
    eq(viejo?.settings?.sshGruposPlegadosPorPerfil, { alfa: ['g1'] }) && viejo?.settings?.sshRielAncho === 300,
    JSON.stringify([viejo?.settings?.sshGruposPlegadosPorPerfil, viejo?.settings?.sshRielAncho])
  )
  writeFileSync(archivoViejo, JSON.stringify(viejo, null, 2) + '\n', 'utf-8')
  check(
    '(16.4) al guardar lo leído el archivo se limpia solo: las claves retiradas ya no están en el disco',
    RETIRADAS.every((k) => !readFileSync(archivoViejo, 'utf-8').includes(k)),
    'sin las claves'
  )
  check(
    '(16.5) un valor roto en esas claves tampoco rompe la carga',
    [null, 'malo', 7, ['g1'], { alfa: 7 }].every((crudo) => ajustes({ sshGrupoAbiertoPorPerfil: crudo, sshRecientesPorPerfil: crudo }) !== undefined),
    'null/texto/número/array/objeto raro -> se lee'
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
