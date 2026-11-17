#!/usr/bin/env node
// =============================================================================
// Prueba del reducer puro de modeloPestanas (node src/renderer/src/features/pestanas/test-modelo-pestanas.mts).
// Corre bajo `node` a secas: modeloPestanas no usa React, DOM ni IPC. Cubre el nivel 3
// (repo activo por proyecto): openProject, setScannedRepos (raíz o primero por defecto,
// repo recordado, re-escaneo idempotente), setActiveRepo, closeProject y
// seleccionarRutaObjetivoGit; y el objetivo de git: seleccionarObjetivoGit (repos null frente a []).
// =============================================================================

import {
  ID_PERFIL_SEMILLA,
  estadoInicialArbolPestanas,
  reducirPestanas,
  seleccionarRepoActivoGlobal,
  seleccionarReposProyectoActivo,
  seleccionarEstadoReposActivoGlobal,
  seleccionarRutaObjetivoGit,
  seleccionarObjetivoGit,
  seleccionarObjetivoGitMostrado,
  seleccionarTodosLosProyectosAbiertos,
  seleccionarTodosLosDestinosAbiertos,
  seleccionarClavesDestinoHibernados,
  claveDestinoAgente,
  type EstadoArbolPestanas,
  type AccionPestanas
} from './modeloPestanas.ts'
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function crearPerfil(id: string): Perfil {
  return {
    id,
    nombre: id.toUpperCase(),
    color: '#112233',
    agentes: [{ tipo: 'claude-code', configDir: `./${id}` }],
    sandbox: { habilitado: false }
  }
}
const PERFILES: Perfil[] = [crearPerfil('alfa'), crearPerfil('beta')]

function repo(nombre: string, rutaHostRepo: string, esRaiz: boolean): RepoDetectado {
  return { name: nombre, repoHostPath: rutaHostRepo, isRoot: esRaiz }
}

/** Aplica una secuencia de acciones a un estado inicial. */
function ejecutarAcciones(estado: EstadoArbolPestanas, acciones: AccionPestanas[]): EstadoArbolPestanas {
  return acciones.reduce(reducirPestanas, estado)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const PROYECTO = 'C:\\proyectos\\multi'
  const RAIZ = PROYECTO // el repo raíz comparte ruta con la carpeta abierta
  const HIJO_A = 'C:\\proyectos\\multi\\alpha'
  const HIJO_B = 'C:\\proyectos\\multi\\beta'

  // --- (0) init: cada perfil arranca con estadoRepos vacío --------------------
  hr('(0) init crea estadoRepos:{} por perfil')
  const base = estadoInicialArbolPestanas(PERFILES, 'alfa')
  check(
    '(0) ambos perfiles tienen estadoRepos y proyectosAbiertos vacíos',
    JSON.stringify(base.porPerfil.alfa.estadoRepos) === '{}' &&
      JSON.stringify(base.porPerfil.beta.estadoRepos) === '{}' &&
      base.porPerfil.alfa.proyectosAbiertos.length === 0,
    JSON.stringify(base.porPerfil.alfa)
  )

  // --- (0b) perfil inicial: el sembrado solo es una PREFERENCIA ---------------
  // Una instalación con sus propios perfiles (sin el sembrado) debe arrancar en los suyos
  // sin que aparezca ni se active el perfil por defecto.
  hr('(0b) perfil inicial: restaurado -> preferido -> el primero de la lista')
  const sinSembrado = estadoInicialArbolPestanas(PERFILES)
  check(
    `(0b.1) sin «${ID_PERFIL_SEMILLA}» ni sesión restaurada se activa el PRIMERO y no se crea otro perfil`,
    sinSembrado.perfilActivoId === 'alfa' &&
      JSON.stringify(Object.keys(sinSembrado.porPerfil).sort()) === JSON.stringify(['alfa', 'beta']) &&
      sinSembrado.perfiles === PERFILES,
    `activo=${sinSembrado.perfilActivoId} perfiles=${JSON.stringify(Object.keys(sinSembrado.porPerfil))}`
  )
  const conSembrado = estadoInicialArbolPestanas([crearPerfil('beta'), crearPerfil(ID_PERFIL_SEMILLA)])
  check(
    '(0b.2) si el sembrado existe y no hay sesión restaurada, gana sobre el orden de la lista',
    conSembrado.perfilActivoId === ID_PERFIL_SEMILLA,
    `activo=${conSembrado.perfilActivoId}`
  )
  const restauradoGana = estadoInicialArbolPestanas([crearPerfil(ID_PERFIL_SEMILLA), crearPerfil('beta')], undefined, {
    perfilActivoId: 'beta',
    porPerfil: {}
  })
  check(
    '(0b.3) el activo RESTAURADO gana al sembrado aunque exista',
    restauradoGana.perfilActivoId === 'beta',
    `activo=${restauradoGana.perfilActivoId}`
  )
  check('(0b.4) sin perfiles no hay activo', estadoInicialArbolPestanas([]).perfilActivoId === null, 'null')

  // --- (1) openProject inicializa estadoRepos "sin escanear" ------------------
  hr('(1) openProject -> estadoRepos = { repos: null, rutaHostRepoActivo: null }')
  const abierto = ejecutarAcciones(base, [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: PROYECTO, name: 'multi' } }
  ])
  const rs1 = seleccionarEstadoReposActivoGlobal(abierto)
  check(
    '(1) proyecto activo sin escanear: repos=null, sin repo activo',
    rs1 !== null && rs1.repos === null && rs1.rutaHostRepoActivo === null,
    JSON.stringify(rs1)
  )
  check(
    '(1b) backendTarget cae al contenedor (projectHostPath) mientras no hay repo',
    seleccionarRutaObjetivoGit(abierto) === PROYECTO,
    String(seleccionarRutaObjetivoGit(abierto))
  )
  check(
    '(1c) seleccionarReposProyectoActivo = null (aún no escaneado) y repo activo = null',
    seleccionarReposProyectoActivo(abierto) === null && seleccionarRepoActivoGlobal(abierto) === null,
    `repos=${JSON.stringify(seleccionarReposProyectoActivo(abierto))}`
  )

  // --- (2) setScannedRepos elige la RAÍZ por defecto ------------------------
  hr('(2) escaneo root+hijos elige la raíz (isRoot) por defecto')
  const raizEscaneada = ejecutarAcciones(abierto, [
    {
      tipo: 'setScannedRepos',
      perfilId: 'alfa',
      rutaHostProyecto: PROYECTO,
      repos: [repo('multi', RAIZ, true), repo('alpha', HIJO_A, false), repo('beta', HIJO_B, false)]
    }
  ])
  const repoActivo2 = seleccionarRepoActivoGlobal(raizEscaneada)
  check(
    '(2) repo activo = la raíz; backendTarget = repoHostPath de la raíz (=== PROJ)',
    repoActivo2?.repoHostPath === RAIZ &&
      repoActivo2.isRoot === true &&
      seleccionarRutaObjetivoGit(raizEscaneada) === RAIZ,
    `repoActivo=${JSON.stringify(repoActivo2)} backend=${seleccionarRutaObjetivoGit(raizEscaneada)}`
  )

  // --- (3) contenedor SIN raíz elige el primero -----------------------------
  hr('(3) escaneo de contenedor sin raíz elige el PRIMERO de la lista')
  const contenedorEscaneado = ejecutarAcciones(abierto, [
    {
      tipo: 'setScannedRepos',
      perfilId: 'alfa',
      rutaHostProyecto: PROYECTO,
      repos: [repo('alpha', HIJO_A, false), repo('beta', HIJO_B, false)]
    }
  ])
  check(
    '(3) repo activo = alpha (primero); backendTarget = su repoHostPath (!= PROJ)',
    seleccionarRepoActivoGlobal(contenedorEscaneado)?.repoHostPath === HIJO_A &&
      seleccionarRutaObjetivoGit(contenedorEscaneado) === HIJO_A,
    `backend=${seleccionarRutaObjetivoGit(contenedorEscaneado)}`
  )

  // --- (4) lista VACÍA -> sin repo activo (válido) --------------------------
  hr('(4) escaneo vacío -> sin repo activo; backendTarget cae al contenedor')
  const escaneadoSinRepos = ejecutarAcciones(abierto, [
    { tipo: 'setScannedRepos', perfilId: 'alfa', rutaHostProyecto: PROYECTO, repos: [] }
  ])
  const rs4 = seleccionarEstadoReposActivoGlobal(escaneadoSinRepos)
  check(
    '(4) repos=[], rutaHostRepoActivo=null, repo activo=null, backend=PROJ (contenedor)',
    rs4?.repos?.length === 0 &&
      rs4?.rutaHostRepoActivo === null &&
      seleccionarRepoActivoGlobal(escaneadoSinRepos) === null &&
      seleccionarRutaObjetivoGit(escaneadoSinRepos) === PROYECTO,
    JSON.stringify(rs4)
  )

  // --- (5) respetar el repo recordado si sigue existiendo tras reescanear ---
  hr('(5) reescaneo respeta el repo recordado si sigue en la lista')
  const hijoElegido = ejecutarAcciones(raizEscaneada, [
    { tipo: 'setActiveRepo', perfilId: 'alfa', rutaHostProyecto: PROYECTO, rutaHostRepo: HIJO_A }
  ])
  const rescanned = ejecutarAcciones(hijoElegido, [
    {
      tipo: 'setScannedRepos',
      perfilId: 'alfa',
      rutaHostProyecto: PROYECTO,
      repos: [repo('multi', RAIZ, true), repo('alpha', HIJO_A, false), repo('beta', HIJO_B, false)]
    }
  ])
  check(
    '(5) tras reescanear con alpha activo, sigue alpha (NO vuelve a la raíz)',
    seleccionarRepoActivoGlobal(rescanned)?.repoHostPath === HIJO_A,
    `repoActivo=${seleccionarRepoActivoGlobal(rescanned)?.repoHostPath}`
  )
  // El re-escaneo ahora es AUTOMÁTICO (watcher de FS, reactivar el tab, foco), así
  // que la MISMA lista debe devolver el MISMO estado: sin identidad nueva no hay
  // re-render de la cadena que cuelga de `repos` (panel de git, leerEstadoRepos…).
  check(
    '(5b) reescaneo con lista IDÉNTICA -> mismo objeto de estado (no-op referencial)',
    rescanned === hijoElegido,
    `same=${rescanned === hijoElegido}`
  )

  // --- (5c/5d) la carpeta cambió por fuera: repos que salen y que entran ------
  hr('(5c/5d) reescaneo con la carpeta cambiada (borrar/clonar repos por fuera)')
  // El repo activo (alpha) desaparece de la carpeta: no puede quedarse activo
  // (git apuntaría a un fantasma); cae al criterio por defecto (la raíz).
  const sinAlfa = ejecutarAcciones(hijoElegido, [
    {
      tipo: 'setScannedRepos',
      perfilId: 'alfa',
      rutaHostProyecto: PROYECTO,
      repos: [repo('multi', RAIZ, true), repo('beta', HIJO_B, false)]
    }
  ])
  check(
    '(5c) el repo activo ya no existe -> lista sin alpha y activo = raíz',
    seleccionarReposProyectoActivo(sinAlfa)?.length === 2 &&
      !seleccionarReposProyectoActivo(sinAlfa)?.some((r) => r.repoHostPath === HIJO_A) &&
      seleccionarRepoActivoGlobal(sinAlfa)?.repoHostPath === RAIZ,
    `repos=${JSON.stringify(seleccionarReposProyectoActivo(sinAlfa)?.map((r) => r.name))} activo=${seleccionarRepoActivoGlobal(sinAlfa)?.repoHostPath}`
  )
  // Y un repo NUEVO (recién clonado) entra en la lista sin mover el activo.
  const HIJO_C = 'C:\\proyectos\\multi\\gamma'
  const conGamma = ejecutarAcciones(sinAlfa, [
    {
      tipo: 'setScannedRepos',
      perfilId: 'alfa',
      rutaHostProyecto: PROYECTO,
      repos: [repo('multi', RAIZ, true), repo('beta', HIJO_B, false), repo('gamma', HIJO_C, false)]
    }
  ])
  check(
    '(5d) repo recién clonado aparece en la lista y el activo (raíz) no se mueve',
    seleccionarReposProyectoActivo(conGamma)?.some((r) => r.repoHostPath === HIJO_C) === true &&
      seleccionarRepoActivoGlobal(conGamma)?.repoHostPath === RAIZ,
    `repos=${JSON.stringify(seleccionarReposProyectoActivo(conGamma)?.map((r) => r.name))}`
  )

  // --- (6) setActiveRepo no-op si el repo no está / no escaneado ------------
  hr('(6) setActiveRepo no-op si el repo no está en la lista o no se escaneó')
  const sinEfectoDesconocido = ejecutarAcciones(raizEscaneada, [
    {
      tipo: 'setActiveRepo',
      perfilId: 'alfa',
      rutaHostProyecto: PROYECTO,
      rutaHostRepo: 'C:\\ruta\\que\\no\\existe'
    }
  ])
  const sinEfectoSinEscanear = ejecutarAcciones(abierto, [
    { tipo: 'setActiveRepo', perfilId: 'alfa', rutaHostProyecto: PROYECTO, rutaHostRepo: HIJO_A }
  ])
  check(
    '(6) repo desconocido -> mismo objeto de estado (no-op referencial)',
    sinEfectoDesconocido === raizEscaneada,
    `same=${sinEfectoDesconocido === raizEscaneada}`
  )
  check(
    '(6b) sin escanear (repos=null) -> setActiveRepo es no-op referencial',
    sinEfectoSinEscanear === abierto,
    `same=${sinEfectoSinEscanear === abierto}`
  )

  // --- (7) setActiveRepo válido cambia el repo activo -----------------------
  hr('(7) setActiveRepo válido cambia el repo activo y el backendTarget')
  check(
    '(7) activar beta -> repo activo = beta, backendTarget = HIJO_B',
    (() => {
      const s = ejecutarAcciones(raizEscaneada, [
        { tipo: 'setActiveRepo', perfilId: 'alfa', rutaHostProyecto: PROYECTO, rutaHostRepo: HIJO_B }
      ])
      return seleccionarRepoActivoGlobal(s)?.repoHostPath === HIJO_B && seleccionarRutaObjetivoGit(s) === HIJO_B
    })(),
    'ver aserción'
  )

  // --- (8) reabrir un proyecto ya abierto NO resetea su repo recordado ------
  hr('(8) reabrir un proyecto ya abierto conserva su repo activo recordado')
  const reabierto = ejecutarAcciones(hijoElegido, [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: PROYECTO, name: 'multi' } }
  ])
  check(
    '(8) tras reabrir PROJ, alpha sigue siendo el repo activo (no vuelve a null/raíz)',
    seleccionarRepoActivoGlobal(reabierto)?.repoHostPath === HIJO_A,
    `repoActivo=${seleccionarRepoActivoGlobal(reabierto)?.repoHostPath}`
  )

  // --- (9) closeProject borra el estadoRepos del proyecto ---------------------
  hr('(9) closeProject elimina el estadoRepos del proyecto cerrado')
  const proyectoCerrado = ejecutarAcciones(raizEscaneada, [
    { tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: PROYECTO }
  ])
  check(
    '(9) tras cerrar, no queda entrada de estadoRepos para PROJ',
    !(PROYECTO in proyectoCerrado.porPerfil.alfa.estadoRepos) && proyectoCerrado.porPerfil.alfa.proyectosAbiertos.length === 0,
    JSON.stringify(proyectoCerrado.porPerfil.alfa.estadoRepos)
  )

  // --- (10) regresión un solo repo: root cuyo repoHostPath === projectHostPath
  hr('(10) un solo repo (carpeta ES el repo): backendTarget === projectHostPath')
  const SOLO = 'C:\\proyectos\\proyecto-alfa'
  const soloEscaneado = ejecutarAcciones(base, [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: SOLO, name: 'proyecto-alfa' } },
    {
      tipo: 'setScannedRepos',
      perfilId: 'alfa',
      rutaHostProyecto: SOLO,
      repos: [repo('proyecto-alfa', SOLO, true)]
    }
  ])
  check(
    '(10) 1 repo isRoot activo solo; backendTarget === projectHostPath (== hoy)',
    seleccionarRepoActivoGlobal(soloEscaneado)?.repoHostPath === SOLO &&
      seleccionarRutaObjetivoGit(soloEscaneado) === SOLO,
    `backend=${seleccionarRutaObjetivoGit(soloEscaneado)}`
  )

  // --- (13) replaceProject: sustituir un tab por otro en su mismo hueco ------
  hr('(13) replaceProject reemplaza en el mismo hueco, conserva orden y activa')
  const P_A = 'C:\\proyectos\\a'
  const P_B = 'C:\\proyectos\\b'
  const P_C = 'C:\\proyectos\\c'
  const RUTA_NUEVA = 'C:\\proyectos\\nuevo'
  const tresAbiertos = ejecutarAcciones(base, [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: P_A, name: 'a' } },
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: P_B, name: 'b' } },
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: P_C, name: 'c' } }
  ])
  // Reemplazar el de en medio (B) por uno nuevo: mismo índice, orden A,NEW,C, activo NEW.
  const reemplazadoIntermedio = ejecutarAcciones(tresAbiertos, [
    {
      tipo: 'replaceProject',
      perfilId: 'alfa',
      rutaAnterior: P_B,
      proyecto: { projectHostPath: RUTA_NUEVA, name: 'nuevo' }
    }
  ])
  const rutasIntermedias = reemplazadoIntermedio.porPerfil.alfa.proyectosAbiertos.map((p) => p.rutaHostProyecto)
  check(
    '(13a) reemplaza en su MISMO hueco (A,NEW,C), activa el nuevo y olvida el viejo',
    JSON.stringify(rutasIntermedias) === JSON.stringify([P_A, RUTA_NUEVA, P_C]) &&
      reemplazadoIntermedio.porPerfil.alfa.rutaActiva === RUTA_NUEVA &&
      !(P_B in reemplazadoIntermedio.porPerfil.alfa.estadoRepos) &&
      JSON.stringify(reemplazadoIntermedio.porPerfil.alfa.estadoRepos[RUTA_NUEVA]) ===
        JSON.stringify({ repos: null, rutaHostRepoActivo: null }),
    `paths=${JSON.stringify(rutasIntermedias)} activo=${reemplazadoIntermedio.porPerfil.alfa.rutaActiva}`
  )
  // Reemplazar por uno YA abierto (C): no duplica; cierra B, activa C, orden A,C.
  const reemplazadoDuplicado = ejecutarAcciones(tresAbiertos, [
    {
      tipo: 'replaceProject',
      perfilId: 'alfa',
      rutaAnterior: P_B,
      proyecto: { projectHostPath: P_C, name: 'c' }
    }
  ])
  const rutasDuplicadas = reemplazadoDuplicado.porPerfil.alfa.proyectosAbiertos.map((p) => p.rutaHostProyecto)
  check(
    '(13b) reemplazar por uno ya abierto NO duplica: cierra el viejo y activa el existente',
    JSON.stringify(rutasDuplicadas) === JSON.stringify([P_A, P_C]) &&
      reemplazadoDuplicado.porPerfil.alfa.rutaActiva === P_C,
    `paths=${JSON.stringify(rutasDuplicadas)} activo=${reemplazadoDuplicado.porPerfil.alfa.rutaActiva}`
  )
  // Reemplazar una rutaAnterior inexistente -> no-op referencial.
  const reemplazadoSinEfecto = ejecutarAcciones(tresAbiertos, [
    {
      tipo: 'replaceProject',
      perfilId: 'alfa',
      rutaAnterior: 'C:\\no\\existe',
      proyecto: { projectHostPath: RUTA_NUEVA, name: 'nuevo' }
    }
  ])
  check(
    '(13c) rutaAnterior inexistente -> no-op referencial (mismo objeto de estado)',
    reemplazadoSinEfecto === tresAbiertos,
    `same=${reemplazadoSinEfecto === tresAbiertos}`
  )

  // --- (14) reordenarProyectos: arrastrar una pestaña de proyecto -------------
  hr('(14) reordenarProyectos cambia el orden y nada más')
  const reordenar = (s: EstadoArbolPestanas, rutasOrdenadas: string[], perfilId = 'alfa'): EstadoArbolPestanas =>
    ejecutarAcciones(s, [{ tipo: 'reordenarProyectos', perfilId, rutasOrdenadas }])
  const rutasDe = (s: EstadoArbolPestanas): string[] => s.porPerfil.alfa.proyectosAbiertos.map((p) => p.rutaHostProyecto)
  {
    const antes = tresAbiertos.porPerfil.alfa
    const movido = reordenar(tresAbiertos, [P_C, P_A, P_B])
    const despues = movido.porPerfil.alfa
    check('(14a) el orden es el pedido', JSON.stringify(rutasDe(movido)) === JSON.stringify([P_C, P_A, P_B]), JSON.stringify(rutasDe(movido)))
    check('(14a.2) el activo no cambia (arrastrar no activa)', despues.rutaActiva === antes.rutaActiva, `activo=${despues.rutaActiva}`)
    check(
      '(14a.3) son los MISMOS objetos de proyecto y el mismo estadoRepos',
      despues.estadoRepos === antes.estadoRepos && antes.proyectosAbiertos.every((p) => despues.proyectosAbiertos.includes(p)),
      'identidad conservada'
    )
    check(
      '(14a.4) los demás perfiles y la lista de perfiles no se tocan',
      movido.perfiles === tresAbiertos.perfiles && movido.porPerfil.beta === tresAbiertos.porPerfil.beta,
      'misma referencia'
    )
    check('(14b) el mismo orden devuelve el MISMO state', reordenar(tresAbiertos, [P_A, P_B, P_C]) === tresAbiertos, 'same')
    const malos: [string, string[], string?][] = [
      ['una repetida', [P_A, P_A, P_C]],
      ['una que falta', [P_A, P_B]],
      ['una de más', [P_A, P_B, P_C, RUTA_NUEVA]],
      ['una ajena', [P_A, P_B, RUTA_NUEVA]],
      ['vacío', []],
      ['perfil inexistente', [P_C, P_A, P_B], 'no-existe']
    ]
    for (const [nombre, orden, perfil] of malos) {
      check(`(14c) ${nombre}: el MISMO state (no duplica ni pierde proyectos)`, reordenar(tresAbiertos, orden, perfil) === tresAbiertos, 'same')
    }
    const dormido = ejecutarAcciones(tresAbiertos, [{ tipo: 'hibernateProfile', perfilId: 'alfa' }])
    const dormidoMovido = reordenar(dormido, [P_B, P_C, P_A])
    check(
      '(14d) reordenar un perfil hibernado no despierta ninguno',
      dormidoMovido.porPerfil.alfa.proyectosAbiertos.every((p) => p.estado === 'hibernated') &&
        JSON.stringify(rutasDe(dormidoMovido)) === JSON.stringify([P_B, P_C, P_A]),
      dormidoMovido.porPerfil.alfa.proyectosAbiertos.map((p) => p.estado).join(',')
    )
    // C es el activo; tras [B, C, A], cerrar C activa a su vecino VISUAL (A), no a B.
    const cerrado = ejecutarAcciones(reordenar(tresAbiertos, [P_B, P_C, P_A]), [{ tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: P_C }])
    check('(14e) al cerrar el activo hereda su vecino del orden NUEVO', cerrado.porPerfil.alfa.rutaActiva === P_A, `activo=${cerrado.porPerfil.alfa.rutaActiva}`)
  }

  // --- (15) agenteDiferido: el proyecto que nace para ver un archivo ----------
  hr('(15) agenteDiferido nace con el proyecto, se conserva y solo se quita a propósito')
  {
    const P_D = 'C:\\proyectos\\suelto'
    const abrir = (s: EstadoArbolPestanas, ruta: string, agenteDiferido?: boolean): EstadoArbolPestanas =>
      ejecutarAcciones(s, [{ tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: ruta, name: 'x' }, agenteDiferido }])
    const de = (s: EstadoArbolPestanas, ruta: string) => s.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === ruta)
    const conMarca = abrir(tresAbiertos, P_D, true)
    check('(15a) openProject con `agenteDiferido` crea el proyecto con la marca', de(conMarca, P_D)?.agenteDiferido === true, JSON.stringify(de(conMarca, P_D)))
    check('(15a.2) sin la opción (o en false) no hay marca ni clave', !('agenteDiferido' in (de(abrir(tresAbiertos, P_D), P_D) ?? {})) && !('agenteDiferido' in (de(abrir(tresAbiertos, P_D, false), P_D) ?? {})), 'sin clave')
    const yaAbierto = abrir(tresAbiertos, P_A, true)
    check('(15b) sobre uno YA abierto no la pone (su agente ya estaba a la vista) ni lo duplica', de(yaAbierto, P_A)?.agenteDiferido === undefined && yaAbierto.porPerfil.alfa.proyectosAbiertos.length === 3, `n=${yaAbierto.porPerfil.alfa.proyectosAbiertos.length}`)
    const otroArchivo = abrir(conMarca, P_D, true)
    check('(15b.2) otro archivo de la misma carpeta (con la opción) la conserva', de(otroArchivo, P_D)?.agenteDiferido === true, 'conserva')
    const comoProyecto = abrir(conMarca, P_D)
    check(
      '(15b.3) reabrirlo como PROYECTO (sin la opción) se la quita: quien lo abre así quiere su agente',
      de(comoProyecto, P_D) !== undefined && !('agenteDiferido' in de(comoProyecto, P_D)!) && comoProyecto.porPerfil.alfa.proyectosAbiertos.length === 4,
      JSON.stringify(de(comoProyecto, P_D))
    )

    const conservan: [string, AccionPestanas][] = [
      ['setActiveProject a otro', { tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: P_A }],
      ['hibernateProfile', { tipo: 'hibernateProfile', perfilId: 'alfa' }],
      ['wakeProject', { tipo: 'wakeProject', perfilId: 'alfa', rutaHostProyecto: P_D }],
      ['reordenarProyectos', { tipo: 'reordenarProyectos', perfilId: 'alfa', rutasOrdenadas: [P_D, P_A, P_B, P_C] }]
    ]
    for (const [nombre, accion] of conservan) {
      check(`(15c) ${nombre} conserva la marca`, de(ejecutarAcciones(conMarca, [accion]), P_D)?.agenteDiferido === true, 'conserva')
    }
    const dormidoYDespierto = ejecutarAcciones(conMarca, [{ tipo: 'hibernateProfile', perfilId: 'alfa' }, { tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: P_D }])
    check('(15c.2) hibernar y volver a entrar la conserva', de(dormidoYDespierto, P_D)?.agenteDiferido === true && de(dormidoYDespierto, P_D)?.estado === 'active', JSON.stringify(de(dormidoYDespierto, P_D)))

    const quitar = (s: EstadoArbolPestanas, ruta: string, perfilId = 'alfa'): EstadoArbolPestanas => ejecutarAcciones(s, [{ tipo: 'quitarAgenteDiferido', perfilId, rutaHostProyecto: ruta }])
    const sinMarca = quitar(conMarca, P_D)
    check('(15d) quitarAgenteDiferido la quita (sin dejar la clave) y no toca nada más', de(sinMarca, P_D) !== undefined && !('agenteDiferido' in de(sinMarca, P_D)!) && sinMarca.porPerfil.alfa.rutaActiva === conMarca.porPerfil.alfa.rutaActiva && de(sinMarca, P_A) === de(conMarca, P_A), JSON.stringify(de(sinMarca, P_D)))
    check('(15e) sin marca, sin proyecto o sin perfil: el MISMO state', quitar(sinMarca, P_D) === sinMarca && quitar(conMarca, P_A) === conMarca && quitar(conMarca, 'C:\\no') === conMarca && quitar(conMarca, P_D, 'no-existe') === conMarca, 'same')

    const cerradoYReabierto = abrir(ejecutarAcciones(conMarca, [{ tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: P_D }]), P_D)
    check('(15f) cerrar y abrir de nuevo (sin la opción) no arrastra la marca', de(cerradoYReabierto, P_D)?.agenteDiferido === undefined, 'sin marca')
    const reemplazado = ejecutarAcciones(conMarca, [{ tipo: 'replaceProject', perfilId: 'alfa', rutaAnterior: P_D, proyecto: { projectHostPath: RUTA_NUEVA, name: 'nuevo' } }])
    check('(15f.2) reemplazarlo por otro tampoco', de(reemplazado, RUTA_NUEVA)?.agenteDiferido === undefined, 'sin marca')
  }

  // --- (11) seleccionarTodosLosDestinosAbiertos: aplana TODOS los perfiles (A2) ------------
  hr('(11) seleccionarTodosLosDestinosAbiertos aplana los targets de agente abiertos de TODOS los perfiles')

  check(
    '(11a) sin proyectos abiertos -> lista vacía',
    seleccionarTodosLosDestinosAbiertos(base, PERFILES).length === 0,
    `len=${seleccionarTodosLosDestinosAbiertos(base, PERFILES).length}`
  )

  const T1 = 'C:\\p\\uno'
  const T2 = 'C:\\p\\dos'
  const dosProyectos = ejecutarAcciones(base, [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: T1, name: 'uno' } },
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: T2, name: 'dos' } }
  ])
  const t2 = seleccionarTodosLosDestinosAbiertos(dosProyectos, PERFILES)
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

  const ambosPerfiles = ejecutarAcciones(dosProyectos, [
    { tipo: 'openProject', perfilId: 'beta', proyecto: { projectHostPath: 'C:\\p\\alfa1', name: 'alfa1' } }
  ])
  const destinosAmbos = seleccionarTodosLosDestinosAbiertos(ambosPerfiles, PERFILES)
  check(
    '(11c) 2 perfiles con proyectos -> targets de AMBOS (6 = 3 proyectos × 2 agentes); activo sigue alfa',
    ambosPerfiles.perfilActivoId === 'alfa' &&
      destinosAmbos.length === 6 &&
      destinosAmbos.some((t) => t.profileId === 'alfa') &&
      destinosAmbos.some((t) => t.profileId === 'beta'),
    `activo=${ambosPerfiles.perfilActivoId} perfiles=${[...new Set(destinosAmbos.map((t) => t.profileId))].join(',')} len=${destinosAmbos.length}`
  )

  check(
    '(11d) un perfil sin proyectos abiertos no aporta targets',
    seleccionarTodosLosDestinosAbiertos(dosProyectos, PERFILES).every((t) => t.profileId !== 'beta'),
    'beta sin proyectos -> 0 de sus targets'
  )

  const VARIOS: Perfil = {
    id: 'multi',
    nombre: 'MULTI',
    color: '#112233',
    agentes: [
      { tipo: 'claude-code', configDir: './c' },
      { tipo: 'codex', configDir: './x' }
    ],
    sandbox: { habilitado: false }
  }
  const estadoVarios = ejecutarAcciones(estadoInicialArbolPestanas([VARIOS], 'multi'), [
    { tipo: 'openProject', perfilId: 'multi', proyecto: { projectHostPath: 'C:\\p\\m', name: 'm' } }
  ])
  const destinosVarios = seleccionarTodosLosDestinosAbiertos(estadoVarios, [VARIOS])
  check(
    '(11e) perfil con 2 agentes -> 2 targets (uno por agente: claude-code y codex)',
    destinosVarios.length === 2 &&
      destinosVarios.some((t) => t.agente === 'claude-code') &&
      destinosVarios.some((t) => t.agente === 'codex') &&
      destinosVarios.every((t) => t.projectHostPath === 'C:\\p\\m'),
    JSON.stringify(destinosVarios.map((t) => t.agente))
  )

  // --- (12) HIBERNACIÓN: solo por PERFIL (la de proyecto se retiró) + despertar --
  hr('(12) hibernateProfile marca todos sus proyectos; entrar despierta (flip a active)')
  const H1 = 'C:\\h\\uno'
  const H2 = 'C:\\h\\dos'
  const HT = 'C:\\h\\tres'
  // alfa con dos proyectos (uno activo dos), beta con uno.
  const hibBase = ejecutarAcciones(estadoInicialArbolPestanas(PERFILES, 'alfa'), [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: H1, name: 'uno' } },
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: H2, name: 'dos' } },
    { tipo: 'openProject', perfilId: 'beta', proyecto: { projectHostPath: HT, name: 'tres' } }
  ])
  check(
    '(12a) al abrir, todos arrancan estado active',
    hibBase.porPerfil.alfa.proyectosAbiertos.every((p) => p.estado === 'active') &&
      hibBase.porPerfil.beta.proyectosAbiertos.every((p) => p.estado === 'active'),
    JSON.stringify(hibBase.porPerfil.alfa.proyectosAbiertos.map((p) => p.estado))
  )

  const hibProf = ejecutarAcciones(hibBase, [{ tipo: 'hibernateProfile', perfilId: 'alfa' }])
  check(
    '(12c) hibernateProfile marca TODOS los de alfa; beta NO se toca (aislado)',
    hibProf.porPerfil.alfa.proyectosAbiertos.every((p) => p.estado === 'hibernated') &&
      hibProf.porPerfil.beta.proyectosAbiertos.every((p) => p.estado === 'active'),
    `alfa=${JSON.stringify(hibProf.porPerfil.alfa.proyectosAbiertos.map((p) => p.estado))} beta=${JSON.stringify(hibProf.porPerfil.beta.proyectosAbiertos.map((p) => p.estado))}`
  )

  // Entrar a H1 (hibernado) lo DESPIERTA (flip a active) SOLO a él; H2 sigue hibernado.
  // Es la única vía de tener un estado MIXTO ahora: despertar deja hermanos dormidos.
  const woke = ejecutarAcciones(hibProf, [{ tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: H1 }])
  check(
    '(12d) entrar (setActiveProject) a un proyecto hibernado lo despierta (flip a active) y lo activa',
    woke.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H1)?.estado === 'active' &&
      woke.porPerfil.alfa.rutaActiva === H1 &&
      woke.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H2)?.estado === 'hibernated',
    `H1=${woke.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H1)?.estado} activo=${woke.porPerfil.alfa.rutaActiva}`
  )

  // `wakeProject` es la MITAD de eso: despierta sin activar. Lo usa el mosaico, donde
  // traer un proyecto dormido a una casilla no debe mover dónde aterriza la vista
  // normal de ese perfil (ni, si es el activo, el objetivo de git).
  const soloDespierto = ejecutarAcciones(hibProf, [{ tipo: 'wakeProject', perfilId: 'alfa', rutaHostProyecto: H1 }])
  check(
    '(12e) wakeProject despierta H1 y NO toca el activo del perfil',
    soloDespierto.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H1)?.estado === 'active' &&
      soloDespierto.porPerfil.alfa.rutaActiva === hibProf.porPerfil.alfa.rutaActiva &&
      soloDespierto.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H2)?.estado === 'hibernated',
    `H1=${soloDespierto.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H1)?.estado} activo=${soloDespierto.porPerfil.alfa.rutaActiva}`
  )

  // Ir a H1 (alfa dormido, con H2 como su activo) mirando beta, como «Abrir con Tessera» o saltar
  // a su agente: `setActiveProject` con `entrar` activa H1 y entra en alfa en UNA acción, sin
  // despertar H2, que nadie pidió.
  const enBeta = ejecutarAcciones(hibProf, [{ tipo: 'setActiveProfile', perfilId: 'beta' }])
  const estadoEnAlfa = (s: EstadoArbolPestanas, ruta: string): string | undefined => s.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === ruta)?.estado
  const entrando = ejecutarAcciones(enBeta, [{ tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: H1, entrar: true }])
  check(
    '(12i) setActiveProject con entrar: activa H1, entra en alfa y despierta SOLO H1',
    entrando.perfilActivoId === 'alfa' &&
      entrando.porPerfil.alfa.rutaActiva === H1 &&
      estadoEnAlfa(entrando, H1) === 'active' &&
      estadoEnAlfa(entrando, H2) === 'hibernated',
    `perfil=${entrando.perfilActivoId} H1=${estadoEnAlfa(entrando, H1)} H2=${estadoEnAlfa(entrando, H2)}`
  )
  const sinEntrar = ejecutarAcciones(enBeta, [{ tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: H1 }])
  check('(12i2) sin entrar, el perfil activo no cambia', sinEntrar.perfilActivoId === 'beta' && sinEntrar.porPerfil.alfa.rutaActiva === H1, String(sinEntrar.perfilActivoId))
  check(
    '(12i3) entrar donde ya se está, con el proyecto ya activo y despierto -> MISMA referencia',
    ejecutarAcciones(entrando, [{ tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: H1, entrar: true }]) === entrando,
    'no-op'
  )
  check(
    '(12e2) wakeProject sobre uno ya despierto (o no abierto) -> MISMA referencia',
    ejecutarAcciones(soloDespierto, [{ tipo: 'wakeProject', perfilId: 'alfa', rutaHostProyecto: H1 }]) === soloDespierto &&
      ejecutarAcciones(soloDespierto, [{ tipo: 'wakeProject', perfilId: 'alfa', rutaHostProyecto: 'C:\\no\\existe' }]) ===
        soloDespierto,
    'sin cambios'
  )

  // Entrar a un PERFIL despierta su proyecto ACTIVO (dot deja de estar gris).
  // hibProf tiene alfa totalmente hibernado (activo H2). Salir a beta y volver a alfa.
  const vueltaAAlfa = ejecutarAcciones(hibProf, [
    { tipo: 'setActiveProfile', perfilId: 'beta' },
    { tipo: 'setActiveProfile', perfilId: 'alfa' }
  ])
  check(
    '(12f) setActiveProfile despierta el proyecto ACTIVO del perfil al entrar (H2 activo -> active)',
    vueltaAAlfa.perfilActivoId === 'alfa' &&
      vueltaAAlfa.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H2)?.estado === 'active' &&
      vueltaAAlfa.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H1)?.estado === 'hibernated',
    `H2=${vueltaAAlfa.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H2)?.estado} H1=${vueltaAAlfa.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === H1)?.estado}`
  )

  // (12g) seleccionarClavesDestinoHibernados sobre el estado MIXTO `woke`: solo alfa/H2 sigue
  // hibernado (H1 despierto) -> sus 2 agentes; H1 y beta fuera.
  const clavesHibernados = seleccionarClavesDestinoHibernados(woke, PERFILES)
  check(
    '(12g) seleccionarClavesDestinoHibernados (mixto): alfa/H2 hibernado -> sus 2 agentes; H1 y beta fuera',
    clavesHibernados.size === 2 &&
      clavesHibernados.has(claveDestinoAgente('alfa', H2, 'claude-code')) &&
      clavesHibernados.has(claveDestinoAgente('alfa', H2, 'codex')) &&
      !clavesHibernados.has(claveDestinoAgente('alfa', H1, 'claude-code')) &&
      !clavesHibernados.has(claveDestinoAgente('beta', HT, 'claude-code')),
    `keys=${JSON.stringify([...clavesHibernados])}`
  )
  // Perfil entero hibernado -> sus 2 proyectos × 2 agentes = 4 targets; beta ausente.
  const clavesPerfilHibernado = seleccionarClavesDestinoHibernados(hibProf, PERFILES)
  check(
    '(12h) perfil hibernado entero -> sus 2 proyectos × 2 agentes = 4 targets; otro perfil fuera',
    clavesPerfilHibernado.size === 4 &&
      clavesPerfilHibernado.has(claveDestinoAgente('alfa', H1, 'claude-code')) &&
      clavesPerfilHibernado.has(claveDestinoAgente('alfa', H1, 'codex')) &&
      clavesPerfilHibernado.has(claveDestinoAgente('alfa', H2, 'claude-code')) &&
      clavesPerfilHibernado.has(claveDestinoAgente('alfa', H2, 'codex')) &&
      !clavesPerfilHibernado.has(claveDestinoAgente('beta', HT, 'claude-code')),
    `keys=${JSON.stringify([...clavesPerfilHibernado])}`
  )

  // ---------------------------------------------------------------------------
  // (13) EL OBJETIVO DE GIT: identidad SÍNCRONA del perfil mostrado. Es lo que quita el parpadeo al cambiar de perfil: la vista
  //      deja de derivar su identidad del objetivo CONFIRMADO (que llega tras un
  //      round-trip) y pasa a derivarla de aquí, que cambia con el clic.
  // ---------------------------------------------------------------------------
  hr('(13) seleccionarObjetivoGit / reposHuerfanos')

  const O_ALFA = 'C:\\p\\alfa-proj'
  const O_BETA = 'C:\\p\\beta-proj'
  const O_ALFA_REPO = 'C:\\p\\alfa-proj\\uno'
  const O_BETA_REPO = 'C:\\p\\beta-proj\\dos'

  // Los dos perfiles con proyecto abierto y escaneado; el ACTIVO es 'alfa'.
  const dosPerfiles = ejecutarAcciones(estadoInicialArbolPestanas(PERFILES, 'alfa'), [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: O_ALFA, name: 'alfa-proj' } },
    { tipo: 'openProject', perfilId: 'beta', proyecto: { projectHostPath: O_BETA, name: 'beta-proj' } },
    {
      tipo: 'setScannedRepos',
      perfilId: 'alfa',
      rutaHostProyecto: O_ALFA,
      repos: [repo('uno', O_ALFA_REPO, false)]
    },
    {
      tipo: 'setScannedRepos',
      perfilId: 'beta',
      rutaHostProyecto: O_BETA,
      repos: [repo('dos', O_BETA_REPO, false)]
    }
  ])

  // (13a) LO ESENCIAL: se puede preguntar por un perfil que NO es el activo. Sin
  // esto no hay forma de pintar el perfil al que llegas antes de que el backend
  // confirme, que es el arreglo entero.
  const objBeta = seleccionarObjetivoGit(dosPerfiles, 'beta')
  check(
    '(13a) seleccionarObjetivoGit da el objetivo de un perfil que NO es el activo',
    objBeta?.perfilId === 'beta' &&
      objBeta.proyecto.rutaHostProyecto === O_BETA &&
      objBeta.repo?.repoHostPath === O_BETA_REPO,
    JSON.stringify(objBeta)
  )

  const objMostrado = seleccionarObjetivoGitMostrado(dosPerfiles)
  check(
    '(13b) seleccionarObjetivoGitMostrado sigue al perfil activo',
    objMostrado?.perfilId === 'alfa' && objMostrado.repo?.repoHostPath === O_ALFA_REPO,
    JSON.stringify(objMostrado)
  )

  // (13c) Perfil sin proyecto abierto -> null (y NO un objetivo a medias).
  check(
    '(13c) perfil sin proyecto abierto -> null',
    seleccionarObjetivoGit(dosPerfiles, 'nadie') === null &&
      seleccionarObjetivoGit(estadoInicialArbolPestanas(PERFILES, 'alfa'), 'alfa') === null,
    'ambos null'
  )

  // (13d) LA DISTINCIÓN QUE MÁS SE ROMPE: "no se sabe" (null) vs "se sabe y no
  // hay" ([]). Colapsarlas hace que la UI diga "esto no es un repositorio de git"
  // mientras todavía está escaneando.
  const sinEscanear = ejecutarAcciones(estadoInicialArbolPestanas(PERFILES, 'alfa'), [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: O_ALFA, name: 'alfa-proj' } }
  ])
  const escaneadoVacio = ejecutarAcciones(sinEscanear, [
    { tipo: 'setScannedRepos', perfilId: 'alfa', rutaHostProyecto: O_ALFA, repos: [] }
  ])
  const oSin = seleccionarObjetivoGit(sinEscanear, 'alfa')
  const oVacio = seleccionarObjetivoGit(escaneadoVacio, 'alfa')
  check(
    '(13d) repos: null (escaneo en vuelo) y [] (sin repos) NO se colapsan',
    oSin?.repos === null && oSin.repo === null && oVacio?.repos?.length === 0 && oVacio.repo === null,
    `sinEscanear.repos=${JSON.stringify(oSin?.repos)} escaneadoVacio.repos=${JSON.stringify(oVacio?.repos)}`
  )

  // (13j) "El proyecto ya no está" se resuelve SOLO, porque el objetivo es
  // derivado: cerrarlo lo saca del modelo y con él del objetivo.
  const cerrado = ejecutarAcciones(dosPerfiles, [
    { tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: O_ALFA }
  ])
  check(
    '(13j) cerrar el proyecto lo saca del objetivo (no hay memoria que invalidar)',
    seleccionarObjetivoGit(cerrado, 'alfa') === null,
    'null tras closeProject'
  )

  // ---------------------------------------------------------------------------
  // (14) AGENTE HIBERNADO por inactividad: solo el agente, no el proyecto entero.
  // ---------------------------------------------------------------------------
  hr("(14) hibernarAgentes: 'active' -> 'agente-hibernado', y cada despertar lo devuelve")
  const I1 = 'C:\\inactivo\\uno'
  const I2 = 'C:\\inactivo\\dos'
  const dosAbiertos = ejecutarAcciones(base, [
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: I1, name: 'uno' } },
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: I2, name: 'dos' } }
  ])
  const estadoDe = (s: EstadoArbolPestanas, ruta: string): string | undefined =>
    s.porPerfil.alfa.proyectosAbiertos.find((p) => p.rutaHostProyecto === ruta)?.estado
  const dormido = ejecutarAcciones(dosAbiertos, [{ tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: I1 }])
  check(
    "(14a) marca SOLO ese proyecto, y no cambia el activo",
    estadoDe(dormido, I1) === 'agente-hibernado' && estadoDe(dormido, I2) === 'active' && dormido.porPerfil.alfa.rutaActiva === I2,
    `uno=${estadoDe(dormido, I1)} dos=${estadoDe(dormido, I2)} activo=${dormido.porPerfil.alfa.rutaActiva}`
  )
  check(
    '(14b) repetirla, o pedirla para un proyecto o un perfil que no existen, devuelve el MISMO estado',
    ejecutarAcciones(dormido, [{ tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: I1 }]) === dormido &&
      ejecutarAcciones(dormido, [{ tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: 'C:\\no\\existe' }]) === dormido &&
      ejecutarAcciones(dormido, [{ tipo: 'hibernarAgentes', perfilId: 'nadie', rutaHostProyecto: I1 }]) === dormido,
    'misma referencia'
  )
  const perfilDormido = ejecutarAcciones(dosAbiertos, [{ tipo: 'hibernateProfile', perfilId: 'alfa' }])
  check(
    "(14c) NO rebaja un 'hibernated' (ahí también murió la terminal)",
    ejecutarAcciones(perfilDormido, [{ tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: I1 }]) === perfilDormido,
    `uno=${estadoDe(perfilDormido, I1)}`
  )
  const despertares: Array<[string, AccionPestanas]> = [
    ['setActiveProject', { tipo: 'setActiveProject', perfilId: 'alfa', rutaHostProyecto: I1 }],
    ['wakeProject', { tipo: 'wakeProject', perfilId: 'alfa', rutaHostProyecto: I1 }],
    ['openProject', { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: I1, name: 'uno' } }]
  ]
  const trasDespertar = despertares.map(([nombre, accion]) => `${nombre}=${estadoDe(ejecutarAcciones(dormido, [accion]), I1)}`)
  check(
    "(14d) activarlo, despertarlo o reabrirlo lo devuelven a 'active'",
    trasDespertar.every((t) => t.endsWith('=active')),
    trasDespertar.join(' ')
  )
  // El activo es I2: se duerme el ACTIVO y entrar al perfil lo despierta.
  const activoDormido = ejecutarAcciones(dosAbiertos, [
    { tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: I2 },
    { tipo: 'setActiveProfile', perfilId: 'beta' },
    { tipo: 'setActiveProfile', perfilId: 'alfa' }
  ])
  check("(14e) entrar a su perfil despierta su proyecto activo", estadoDe(activoDormido, I2) === 'active', `dos=${estadoDe(activoDormido, I2)}`)
  const conPerfil = ejecutarAcciones(dormido, [{ tipo: 'hibernateProfile', perfilId: 'alfa' }])
  check(
    "(14f) hibernar el perfil lo convierte en 'hibernated', como a los demás",
    estadoDe(conPerfil, I1) === 'hibernated' && estadoDe(conPerfil, I2) === 'hibernated',
    `uno=${estadoDe(conPerfil, I1)} dos=${estadoDe(conPerfil, I2)}`
  )
  const clavesDormido = seleccionarClavesDestinoHibernados(dormido, PERFILES)
  check(
    '(14g) sus targets de agente cuentan como hibernados (el pane suelta su sesión); los del otro proyecto no',
    clavesDormido.has(claveDestinoAgente('alfa', I1, 'claude-code')) &&
      clavesDormido.has(claveDestinoAgente('alfa', I1, 'codex')) &&
      !clavesDormido.has(claveDestinoAgente('alfa', I2, 'claude-code')),
    `keys=${JSON.stringify([...clavesDormido])}`
  )
  const enteros = seleccionarTodosLosProyectosAbiertos(dormido, PERFILES).filter((p) => p.estado === 'hibernated')
  check(
    "(14h) pero NO es un hibernado ENTERO: la terminal de abajo, que solo mira 'hibernated', lo ignora",
    enteros.length === 0,
    `enteros=${enteros.length}`
  )
  // Lo que queda EN PANTALLA sin pasar por ningún despertar: el heredero de una pestaña cerrada.
  const heredero = ejecutarAcciones(dormido, [{ tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: I2 }])
  check(
    '(14i) cerrar la pestaña activa despierta al heredero que tenía el agente hibernado',
    heredero.porPerfil.alfa.rutaActiva === I1 && estadoDe(heredero, I1) === 'active',
    `activo=${heredero.porPerfil.alfa.rutaActiva} uno=${estadoDe(heredero, I1)}`
  )
  const enPantalla = ejecutarAcciones(dosAbiertos, [{ tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: I2 }])
  check(
    '(14j) la propia hibernarAgentes SÍ puede marcar al que está en pantalla (la carrera del orquestador)',
    enPantalla.porPerfil.alfa.rutaActiva === I2 && estadoDe(enPantalla, I2) === 'agente-hibernado',
    `dos=${estadoDe(enPantalla, I2)}`
  )
  const enOtroPerfil = ejecutarAcciones(dormido, [
    { tipo: 'setActiveProfile', perfilId: 'beta' },
    { tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: I2 }
  ])
  check(
    '(14k) el heredero de un perfil que NO se está mirando sigue dormido',
    estadoDe(enOtroPerfil, I1) === 'agente-hibernado',
    `uno=${estadoDe(enOtroPerfil, I1)}`
  )
  const trasBorrarPerfil = ejecutarAcciones(dormido, [
    { tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: I2 },
    { tipo: 'hibernarAgentes', perfilId: 'alfa', rutaHostProyecto: I1 },
    { tipo: 'setActiveProfile', perfilId: 'beta' },
    { tipo: 'deleteProfile', perfilId: 'beta' }
  ])
  check(
    '(14l) borrar el perfil activo despierta el proyecto activo del perfil que hereda la pantalla',
    trasBorrarPerfil.perfilActivoId === 'alfa' && estadoDe(trasBorrarPerfil, I1) === 'active',
    `perfil=${trasBorrarPerfil.perfilActivoId} uno=${estadoDe(trasBorrarPerfil, I1)}`
  )
  const perfilEntero = ejecutarAcciones(dosAbiertos, [
    { tipo: 'hibernateProfile', perfilId: 'alfa' },
    { tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: I2 }
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
