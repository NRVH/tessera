// =============================================================================
// reductoresPestanas: un reductor puro por cada acción de `AccionPestanas` y los ayudantes
// que comparten (parchear un perfil, despertar, elegir vecino o repo activo).
// Devuelven el MISMO `state` cuando la acción no cambia nada, para que el store no
// avise a nadie. Los tipos vienen de modeloPestanas (solo `import type`); el despacho por
// `switch` vive en `reducirPestanas` (modeloPestanas.ts).
// =============================================================================

import type { Perfil } from '../../../../main/perfiles/types.ts'
import { MAX_REGLAS_PERFIL, normalizarReglas } from '../../../../shared/reglasPerfil.ts'
import { normalizarCarpetasDocumentos } from '../../../../shared/documentosPerfil.ts'
import type { RepoDetectado } from '../../../../shared/workspace-ipc.ts'
import type { EstadoProyecto, ProyectoAbiertoDePerfil, EstadoPestanasPerfil, AccionPestanas, EstadoArbolPestanas } from './modeloPestanas.ts'

/** La acción de `AccionPestanas` cuyo `type` es `T`. */
type Accion<T extends AccionPestanas['tipo']> = Extract<AccionPestanas, { tipo: T }>

/** EstadoPestanasPerfil de un perfil recién creado o sin sesión restaurada. */
export function pestanasVacias(): EstadoPestanasPerfil {
  return { proyectosAbiertos: [], rutaActiva: null, estadoRepos: {} }
}

/** Devuelve un nuevo EstadoArbolPestanas con el EstadoPestanasPerfil de `perfilId` parcheado. */
function modificarPerfil(
  estado: EstadoArbolPestanas,
  perfilId: string,
  cambios: Partial<EstadoPestanasPerfil>
): EstadoArbolPestanas {
  const actual = estado.porPerfil[perfilId]
  return {
    ...estado,
    porPerfil: { ...estado.porPerfil, [perfilId]: { ...actual, ...cambios } }
  }
}

/**
 * Devuelve `openProjects` con el `estado` del proyecto `path` fijado. Devuelve la
 * MISMA referencia si no hay cambio (proyecto ausente o ya en ese estado), para no
 * disparar re-renders ni escrituras de persistencia inútiles.
 */
function fijarEstadoProyecto(
  proyectosAbiertos: ProyectoAbiertoDePerfil[],
  ruta: string,
  estado: EstadoProyecto
): ProyectoAbiertoDePerfil[] {
  let cambiado = false
  const siguiente = proyectosAbiertos.map((p) => {
    if (p.rutaHostProyecto !== ruta || p.estado === estado) return p
    cambiado = true
    return { ...p, estado }
  })
  return cambiado ? siguiente : proyectosAbiertos
}

/** Despierta un proyecto (flip a 'active'). Misma referencia si ya estaba 'active'/ausente. */
function despertarEnLista(proyectosAbiertos: ProyectoAbiertoDePerfil[], ruta: string): ProyectoAbiertoDePerfil[] {
  return fijarEstadoProyecto(proyectosAbiertos, ruta, 'active')
}

/**
 * Elige el proyecto que hereda el "activo" tras cerrar el que estaba en `idx`.
 * Tras el filtro, el vecino que ocupa el hueco es el de índice `idx` (el que
 * estaba a la derecha), acotado al último; null si la lista quedó vacía.
 */
function rutaVecina(proyectosAbiertos: ProyectoAbiertoDePerfil[], idx: number): string | null {
  if (proyectosAbiertos.length === 0) return null
  const idxSiguiente = Math.min(idx, proyectosAbiertos.length - 1)
  return proyectosAbiertos[idxSiguiente].rutaHostProyecto
}

/**
 * Elige el repo activo tras un (re)escaneo, dado el recordado previo:
 *  1) si el recordado SIGUE existiendo en la nueva lista, se respeta;
 *  2) si no, por defecto la RAÍZ (isRoot) si existe; si no, el primero;
 *  3) lista vacía -> null (git mostrará "sin repositorios").
 */
function elegirRepoActivo(repos: RepoDetectado[], remembered: string | null): string | null {
  if (remembered !== null && repos.some((r) => r.repoHostPath === remembered)) return remembered
  const raiz = repos.find((r) => r.isRoot)
  if (raiz) return raiz.repoHostPath
  return repos[0]?.repoHostPath ?? null
}

/**
 * ¿Dos escaneos detectaron EXACTAMENTE los mismos repos? Compara en orden por los
 * tres campos de `RepoDetectado`: es lo que hace idempotente al re-escaneo (mismo
 * resultado -> mismo estado -> cero re-renders).
 */
function esMismaListaRepos(a: RepoDetectado[], b: RepoDetectado[]): boolean {
  if (a.length !== b.length) return false
  return a.every(
    (r, i) => r.repoHostPath === b[i].repoHostPath && r.name === b[i].name && r.isRoot === b[i].isRoot
  )
}

/** Devuelve un nuevo record sin `key` (o el mismo si no estaba). Nunca muta. */
function quitarClave<T>(registro: Record<string, T>, clave: string): Record<string, T> {
  if (!(clave in registro)) return registro
  const siguiente = { ...registro }
  delete siguiente[clave]
  return siguiente
}

/** Entrar a un perfil despierta su proyecto ACTIVO; no-op si nada cambia. */
export function reducirActivarPerfil(estado: EstadoArbolPestanas, accion: Accion<'setActiveProfile'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado // id desconocido: no-op
  const woken =
    pestanas.rutaActiva !== null ? despertarEnLista(pestanas.proyectosAbiertos, pestanas.rutaActiva) : pestanas.proyectosAbiertos
  const perfilCambiado = estado.perfilActivoId !== accion.perfilId
  if (!perfilCambiado && woken === pestanas.proyectosAbiertos) return estado // nada cambia
  let siguiente = estado
  if (woken !== pestanas.proyectosAbiertos) siguiente = modificarPerfil(siguiente, accion.perfilId, { proyectosAbiertos: woken })
  if (perfilCambiado) siguiente = { ...siguiente, perfilActivoId: accion.perfilId }
  return siguiente
}

/** `openProjects` sin la marca de agente diferido en `path`; la MISMA referencia si no la llevaba. */
function sinMarcaDiferido(proyectosAbiertos: ProyectoAbiertoDePerfil[], ruta: string): ProyectoAbiertoDePerfil[] {
  if (!proyectosAbiertos.some((p) => p.rutaHostProyecto === ruta && p.agenteDiferido)) return proyectosAbiertos
  return proyectosAbiertos.map((p) => {
    if (p.rutaHostProyecto !== ruta) return p
    const { agenteDiferido: _quitada, ...resto } = p
    return resto
  })
}

/** Abrir un proyecto ya abierto no duplica: lo activa y lo despierta. */
export function reducirAbrirProyecto(estado: EstadoArbolPestanas, accion: Accion<'openProject'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado // perfil desconocido: no-op
  const { projectHostPath: rutaHostProyecto, name: nombre } = accion.proyecto
  const already = pestanas.proyectosAbiertos.some((p) => p.rutaHostProyecto === rutaHostProyecto)
  const diferido = accion.agenteDiferido === true
  const proyectosAbiertos = already
    ? // Uno ya abierto no gana la marca. Y si se reabre como PROYECTO (sin la opción), la
      // pierde: quien lo abre así lo quiere con su agente.
      despertarEnLista(diferido ? pestanas.proyectosAbiertos : sinMarcaDiferido(pestanas.proyectosAbiertos, rutaHostProyecto), rutaHostProyecto)
    : [...pestanas.proyectosAbiertos, { rutaHostProyecto, nombre, estado: 'active' as const, ...(diferido ? { agenteDiferido: true as const } : {}) }]
  // Reabrir uno ya abierto conserva su escaneo y su repo activo recordado.
  const estadoRepos = already
    ? pestanas.estadoRepos
    : { ...pestanas.estadoRepos, [rutaHostProyecto]: { repos: null, rutaHostRepoActivo: null } }
  return modificarPerfil(estado, accion.perfilId, {
    proyectosAbiertos,
    rutaActiva: rutaHostProyecto,
    estadoRepos
  })
}

/** Quita la marca de agente diferido; el mismo `state` si el proyecto no existe o no la lleva. */
export function reducirQuitarAgenteDiferido(estado: EstadoArbolPestanas, accion: Accion<'quitarAgenteDiferido'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const proyectosAbiertos = sinMarcaDiferido(pestanas.proyectosAbiertos, accion.rutaHostProyecto)
  return proyectosAbiertos === pestanas.proyectosAbiertos ? estado : modificarPerfil(estado, accion.perfilId, { proyectosAbiertos })
}

/** Activa un proyecto abierto y lo despierta, incluso si ya era el activo. */
export function reducirActivarProyecto(estado: EstadoArbolPestanas, accion: Accion<'setActiveProject'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const existe = pestanas.proyectosAbiertos.some((p) => p.rutaHostProyecto === accion.rutaHostProyecto)
  if (!existe) return estado
  const proyectosAbiertos = despertarEnLista(pestanas.proyectosAbiertos, accion.rutaHostProyecto)
  const cambiaPerfil = accion.entrar === true && estado.perfilActivoId !== accion.perfilId
  // No-op solo si NADA cambia (ya activo Y ya 'active', y ya en su perfil si se pidió entrar).
  if (proyectosAbiertos === pestanas.proyectosAbiertos && pestanas.rutaActiva === accion.rutaHostProyecto && !cambiaPerfil) return estado
  const siguiente = modificarPerfil(estado, accion.perfilId, {
    proyectosAbiertos,
    rutaActiva: accion.rutaHostProyecto
  })
  return cambiaPerfil ? { ...siguiente, perfilActivoId: accion.perfilId } : siguiente
}

/** Despierta un proyecto sin activarlo. */
export function reducirDespertarProyecto(estado: EstadoArbolPestanas, accion: Accion<'wakeProject'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const proyectosAbiertos = despertarEnLista(pestanas.proyectosAbiertos, accion.rutaHostProyecto)
  if (proyectosAbiertos === pestanas.proyectosAbiertos) return estado
  return modificarPerfil(estado, accion.perfilId, { proyectosAbiertos })
}

/** Marca 'hibernated' todos los proyectos del perfil que no lo estén ya. */
export function reducirHibernarPerfil(estado: EstadoArbolPestanas, accion: Accion<'hibernateProfile'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  let cambiado = false
  const proyectosAbiertos = pestanas.proyectosAbiertos.map((p) => {
    if (p.estado === 'hibernated') return p
    cambiado = true
    return { ...p, estado: 'hibernated' as const }
  })
  if (!cambiado) return estado
  return modificarPerfil(estado, accion.perfilId, { proyectosAbiertos })
}

/**
 * El agente de un proyecto se cerró por inactividad: 'active' pasa a 'agente-hibernado'. Un
 * 'hibernated' no se rebaja (su terminal también murió), y sin cambio vuelve el mismo `state`.
 */
export function reducirHibernarAgentes(estado: EstadoArbolPestanas, accion: Accion<'hibernarAgentes'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const proyecto = pestanas.proyectosAbiertos.find((p) => p.rutaHostProyecto === accion.rutaHostProyecto)
  if (!proyecto || proyecto.estado !== 'active') return estado
  const proyectosAbiertos = fijarEstadoProyecto(pestanas.proyectosAbiertos, accion.rutaHostProyecto, 'agente-hibernado')
  return modificarPerfil(estado, accion.perfilId, { proyectosAbiertos })
}

/**
 * Si el proyecto activo del perfil activo tiene el agente hibernado por inactividad, lo
 * despierta; si no, el MISMO `state`. Un 'hibernated' (perfil entero) no se toca aquí.
 */
export function despertarAgenteEnPantalla(estado: EstadoArbolPestanas): EstadoArbolPestanas {
  const perfilId = estado.perfilActivoId
  const pestanas = perfilId === null ? undefined : estado.porPerfil[perfilId]
  if (perfilId === null || !pestanas || pestanas.rutaActiva === null) return estado
  const activo = pestanas.proyectosAbiertos.find((p) => p.rutaHostProyecto === pestanas.rutaActiva)
  if (activo?.estado !== 'agente-hibernado') return estado
  return modificarPerfil(estado, perfilId, { proyectosAbiertos: despertarEnLista(pestanas.proyectosAbiertos, pestanas.rutaActiva) })
}

/** Cierra un proyecto: el vecino hereda el activo y se olvida su escaneo. */
export function reducirCerrarProyecto(estado: EstadoArbolPestanas, accion: Accion<'closeProject'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const idx = pestanas.proyectosAbiertos.findIndex((p) => p.rutaHostProyecto === accion.rutaHostProyecto)
  if (idx === -1) return estado // no estaba abierto: no-op
  const proyectosAbiertos = pestanas.proyectosAbiertos.filter((_, i) => i !== idx)
  const eraActivo = pestanas.rutaActiva === accion.rutaHostProyecto
  const rutaActiva = eraActivo ? rutaVecina(proyectosAbiertos, idx) : pestanas.rutaActiva
  const estadoRepos = quitarClave(pestanas.estadoRepos, accion.rutaHostProyecto)
  return modificarPerfil(estado, accion.perfilId, { proyectosAbiertos, rutaActiva, estadoRepos })
}

/** Reemplaza un proyecto por otro en el mismo hueco, sin duplicar uno ya abierto. */
export function reducirReemplazarProyecto(estado: EstadoArbolPestanas, accion: Accion<'replaceProject'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const idx = pestanas.proyectosAbiertos.findIndex((p) => p.rutaHostProyecto === accion.rutaAnterior)
  if (idx === -1) return estado // el tab a reemplazar ya no existe: no-op
  const { projectHostPath: rutaHostProyecto, name: nombre } = accion.proyecto

  // Reemplazar por el MISMO proyecto: solo despertarlo y activarlo.
  if (rutaHostProyecto === accion.rutaAnterior) {
    const proyectosAbiertos = despertarEnLista(pestanas.proyectosAbiertos, rutaHostProyecto)
    if (proyectosAbiertos === pestanas.proyectosAbiertos && pestanas.rutaActiva === rutaHostProyecto) return estado
    return modificarPerfil(estado, accion.perfilId, { proyectosAbiertos, rutaActiva: rutaHostProyecto })
  }

  // El nuevo YA está abierto en otro tab: cierra el viejo y activa el existente.
  const idxExistente = pestanas.proyectosAbiertos.findIndex((p) => p.rutaHostProyecto === rutaHostProyecto)
  if (idxExistente !== -1) {
    const proyectosAbiertos = despertarEnLista(pestanas.proyectosAbiertos, rutaHostProyecto).filter(
      (p) => p.rutaHostProyecto !== accion.rutaAnterior
    )
    return modificarPerfil(estado, accion.perfilId, {
      proyectosAbiertos,
      rutaActiva: rutaHostProyecto,
      estadoRepos: quitarClave(pestanas.estadoRepos, accion.rutaAnterior)
    })
  }

  // Caso normal: sustituir en el mismo índice; el nuevo arranca 'active' y sin escanear.
  const proyectosAbiertos = pestanas.proyectosAbiertos.map((p, i) =>
    i === idx ? { rutaHostProyecto, nombre, estado: 'active' as const } : p
  )
  const estadoRepos = {
    ...quitarClave(pestanas.estadoRepos, accion.rutaAnterior),
    [rutaHostProyecto]: { repos: null, rutaHostRepoActivo: null }
  }
  return modificarPerfil(estado, accion.perfilId, {
    proyectosAbiertos,
    rutaActiva: rutaHostProyecto,
    estadoRepos
  })
}

/**
 * Reordena las pestañas de proyecto de un perfil. Solo acepta EXACTAMENTE sus rutas
 * abiertas (ni repetidas, ni de más, ni de menos): con menos comprobación, un orden mal
 * formado duplicaría un proyecto y perdería otro, y así se guardaría. Reutiliza los mismos
 * `ProyectoAbiertoDePerfil` y solo cambia `proyectosAbiertos`: ni activa ni despierta nada.
 */
export function reducirReordenarProyectos(estado: EstadoArbolPestanas, accion: Accion<'reordenarProyectos'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const { rutasOrdenadas } = accion
  if (rutasOrdenadas.length !== pestanas.proyectosAbiertos.length) return estado
  const porRuta = new Map(pestanas.proyectosAbiertos.map((p) => [p.rutaHostProyecto, p]))
  const proyectosAbiertos: ProyectoAbiertoDePerfil[] = []
  for (const ruta of rutasOrdenadas) {
    const proyecto = porRuta.get(ruta)
    if (proyecto === undefined) return estado // ajena al perfil, o repetida (ya se consumió)
    porRuta.delete(ruta)
    proyectosAbiertos.push(proyecto)
  }
  if (proyectosAbiertos.every((p, i) => p === pestanas.proyectosAbiertos[i])) return estado
  return modificarPerfil(estado, accion.perfilId, { proyectosAbiertos })
}

/** Guarda el escaneo de un proyecto abierto; un re-escaneo idéntico no cambia el estado. */
export function reducirFijarReposEscaneados(estado: EstadoArbolPestanas, accion: Accion<'setScannedRepos'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  // Escaneo de un proyecto ya cerrado durante el await: resultado obsoleto.
  if (!pestanas.proyectosAbiertos.some((p) => p.rutaHostProyecto === accion.rutaHostProyecto)) return estado
  const prev = pestanas.estadoRepos[accion.rutaHostProyecto] ?? { repos: null, rutaHostRepoActivo: null }
  if (prev.repos !== null && esMismaListaRepos(prev.repos, accion.repos)) return estado
  const rutaHostRepoActivo = elegirRepoActivo(accion.repos, prev.rutaHostRepoActivo)
  const estadoRepos = {
    ...pestanas.estadoRepos,
    [accion.rutaHostProyecto]: { repos: accion.repos, rutaHostRepoActivo }
  }
  return modificarPerfil(estado, accion.perfilId, { estadoRepos })
}

/** Marca el repo activo de un proyecto; no-op si no está en la lista escaneada. */
export function reducirActivarRepo(estado: EstadoArbolPestanas, accion: Accion<'setActiveRepo'>): EstadoArbolPestanas {
  const pestanas = estado.porPerfil[accion.perfilId]
  if (!pestanas) return estado
  const prev = pestanas.estadoRepos[accion.rutaHostProyecto]
  if (!prev || prev.repos === null) return estado
  if (!prev.repos.some((r) => r.repoHostPath === accion.rutaHostRepo)) return estado
  if (prev.rutaHostRepoActivo === accion.rutaHostRepo) return estado
  const estadoRepos = {
    ...pestanas.estadoRepos,
    [accion.rutaHostProyecto]: { ...prev, rutaHostRepoActivo: accion.rutaHostRepo }
  }
  return modificarPerfil(estado, accion.perfilId, { estadoRepos })
}

/** Añade un perfil ya construido y lo activa; no-op si el id colisiona. */
export function reducirAnadirPerfil(estado: EstadoArbolPestanas, accion: Accion<'addProfile'>): EstadoArbolPestanas {
  if (estado.perfiles.some((p) => p.id === accion.profile.id)) return estado // id colisiona: no-op
  return {
    ...estado,
    perfiles: [...estado.perfiles, accion.profile],
    perfilActivoId: accion.profile.id, // el perfil recién creado pasa a activo
    porPerfil: {
      ...estado.porPerfil,
      [accion.profile.id]: pestanasVacias()
    }
  }
}

/** Renombra un perfil (el id no cambia); un nombre vacío es no-op. */
export function reducirRenombrarPerfil(estado: EstadoArbolPestanas, accion: Accion<'renameProfile'>): EstadoArbolPestanas {
  const nombre = accion.nombre.trim()
  if (nombre === '' || !estado.perfiles.some((p) => p.id === accion.perfilId)) return estado
  return {
    ...estado,
    perfiles: estado.perfiles.map((p) => (p.id === accion.perfilId ? { ...p, nombre } : p))
  }
}

/** Cambia el color de un perfil; solo acepta `#rrggbb`. */
export function reducirCambiarColorPerfil(estado: EstadoArbolPestanas, accion: Accion<'recolorProfile'>): EstadoArbolPestanas {
  if (!/^#[0-9a-fA-F]{6}$/.test(accion.color)) return estado
  if (!estado.perfiles.some((p) => p.id === accion.perfilId)) return estado
  return {
    ...estado,
    perfiles: estado.perfiles.map((p) =>
      p.id === accion.perfilId ? { ...p, color: accion.color } : p
    )
  }
}

/** Fija `sandbox.redHost` de un perfil. */
export function reducirFijarRedHostPerfil(estado: EstadoArbolPestanas, accion: Accion<'setProfileRedHost'>): EstadoArbolPestanas {
  if (!estado.perfiles.some((p) => p.id === accion.perfilId)) return estado
  return {
    ...estado,
    perfiles: estado.perfiles.map((p) =>
      p.id === accion.perfilId
        ? { ...p, sandbox: { ...p.sandbox, redHost: accion.redHost } }
        : p
    )
  }
}

/**
 * Enciende o apaga el contexto global en un perfil. Encendido es lo de serie, así que solo se guarda apagado.
 * Apagarlo no toca las cuentas de Docker: se quedan con lo que ya tenían escrito.
 */
export function reducirFijarContextoGlobalPerfil(estado: EstadoArbolPestanas, accion: Accion<'setProfileContextoGlobal'>): EstadoArbolPestanas {
  const actual = estado.perfiles.find((p) => p.id === accion.perfilId)
  if (!actual || (actual.contextoGlobal !== false) === accion.usar) return estado
  return {
    ...estado,
    perfiles: estado.perfiles.map((p) => {
      if (p.id !== accion.perfilId) return p
      const siguiente: Perfil = { ...p }
      if (accion.usar) delete siguiente.contextoGlobal
      else siguiente.contextoGlobal = false
      return siguiente
    })
  }
}

/** Fija las carpetas de documentos de un perfil: normalizadas, y sin ninguna quitan el campo. */
export function reducirFijarDocumentosPerfil(estado: EstadoArbolPestanas, accion: Accion<'setProfileDocumentos'>): EstadoArbolPestanas {
  const documentos = normalizarCarpetasDocumentos(accion.documentos)
  const actual = estado.perfiles.find((p) => p.id === accion.perfilId)
  if (!actual || JSON.stringify(actual.documentos ?? []) === JSON.stringify(documentos)) return estado
  return {
    ...estado,
    perfiles: estado.perfiles.map((p) => {
      if (p.id !== accion.perfilId) return p
      const siguiente: Perfil = { ...p }
      if (documentos.length === 0) delete siguiente.documentos
      else siguiente.documentos = documentos
      return siguiente
    })
  }
}

/**
 * Fija las reglas de un perfil: normalizadas, y vacías quitan el campo. Pasado el tope no cambia nada
 * (el diálogo ya no deja guardar).
 */
export function reducirFijarReglasPerfil(estado: EstadoArbolPestanas, accion: Accion<'setProfileReglas'>): EstadoArbolPestanas {
  const reglas = normalizarReglas(accion.reglas)
  if (reglas.length > MAX_REGLAS_PERFIL) return estado
  const actual = estado.perfiles.find((p) => p.id === accion.perfilId)
  if (!actual || (actual.reglas ?? '') === reglas) return estado
  return {
    ...estado,
    perfiles: estado.perfiles.map((p) => {
      if (p.id !== accion.perfilId) return p
      const siguiente: Perfil = { ...p }
      if (reglas === '') delete siguiente.reglas
      else siguiente.reglas = reglas
      return siguiente
    })
  }
}

/** Elimina un perfil y su sesión; si era el activo, hereda el vecino de su hueco. */
export function reducirEliminarPerfil(estado: EstadoArbolPestanas, accion: Accion<'deleteProfile'>): EstadoArbolPestanas {
  const idx = estado.perfiles.findIndex((p) => p.id === accion.perfilId)
  if (idx === -1) return estado
  const perfiles = estado.perfiles.filter((p) => p.id !== accion.perfilId)
  const porPerfil = { ...estado.porPerfil }
  delete porPerfil[accion.perfilId]
  let perfilActivoId = estado.perfilActivoId
  if (perfilActivoId === accion.perfilId) {
    perfilActivoId = perfiles[Math.min(idx, perfiles.length - 1)]?.id ?? null
  }
  return { ...estado, perfiles, porPerfil, perfilActivoId }
}

/** Reordena los perfiles; solo vale una permutación exacta de los actuales. */
export function reducirReordenarPerfiles(estado: EstadoArbolPestanas, accion: Accion<'reorderProfiles'>): EstadoArbolPestanas {
  const porId = new Map(estado.perfiles.map((p) => [p.id, p]))
  const ordenados = accion.idsOrdenados.map((id) => porId.get(id)).filter(Boolean) as Perfil[]
  if (ordenados.length !== estado.perfiles.length) return estado
  return { ...estado, perfiles: ordenados }
}
