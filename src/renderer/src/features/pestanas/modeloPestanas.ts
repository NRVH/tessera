// =============================================================================
// modeloPestanas: estado PURO y transiciones de las pestañas de tres niveles (perfiles,
// proyectos abiertos por perfil, repo activo por proyecto). Sin React, DOM ni IPC.
// El activo global es un selector derivado (la `rutaActiva` del perfil activo), no un
// campo; una ruta de proyecto es opaca (solo clave de igualdad). Cada acción tiene su
// reductor en reductoresPestanas.ts. Lo envuelve el hook usePestanas (usePestanas.ts).
// Decisiones: docs/decisiones/renderer/objetivo-de-git-derivado.md
// =============================================================================

// Extensión .ts explícita: es un import de VALOR y los test-*.mts cargan este módulo con `node`.
import { AGENTES_DISPONIBLES, type Perfil } from '../../../../main/perfiles/types.ts'
import type { IdAgente } from '../../../../shared/agentesManuales.ts'
import type { RepoDetectado } from '../../../../shared/workspace-ipc.ts'
import type { EstadoProyectoPersistido } from '../../../../shared/workspace-state-ipc.ts'
import {
  despertarAgenteEnPantalla,
  reducirAnadirPerfil,
  reducirCerrarProyecto,
  reducirEliminarPerfil,
  reducirHibernarAgentes,
  reducirHibernarPerfil,
  reducirAbrirProyecto,
  reducirQuitarAgenteDiferido,
  reducirCambiarColorPerfil,
  reducirRenombrarPerfil,
  reducirReordenarProyectos,
  reducirReordenarPerfiles,
  reducirReemplazarProyecto,
  reducirActivarPerfil,
  reducirActivarProyecto,
  reducirActivarRepo,
  reducirFijarReglasPerfil,
  reducirFijarDocumentosPerfil,
  reducirFijarContextoGlobalPerfil,
  reducirFijarRedHostPerfil,
  reducirFijarReposEscaneados,
  reducirDespertarProyecto,
  pestanasVacias
} from './reductoresPestanas.ts'

/**
 * Estado de un proyecto EN MEMORIA: los persistidos más 'agente-hibernado', que es solo su
 * AGENTE cerrado por inactividad (la terminal de abajo sigue viva). Se guarda como
 * 'hibernated': al reabrir la app, lo que no está activo amanece hibernado igualmente.
 */
export type EstadoProyecto = EstadoProyectoPersistido | 'agente-hibernado'

/**
 * Un proyecto ABIERTO dentro de un perfil (nivel 2). `rutaHostProyecto` es la
 * clave de identidad (opaca); `nombre` es solo para pintar el tab.
 */
export interface ProyectoAbiertoDePerfil {
  /** Ruta host opaca (de abrirDialogoProyecto / bootstrap). Clave de igualdad. */
  rutaHostProyecto: string
  /** Nombre neutro para mostrar en el tab. */
  nombre: string
  /**
   * Estado de hibernación. 'active' por defecto; 'hibernated' cuando el usuario hiberna su
   * perfil y 'agente-hibernado' cuando su agente se cerró por inactividad. El flip a
   * 'active' ocurre al ENTRAR al proyecto (activarlo o despertarlo).
   */
  estado: EstadoProyecto
  /**
   * El proyecto se abrió desde el sistema para ver un ARCHIVO: su agente no arranca y su
   * columna va plegada hasta que el usuario lo pide. Solo existe como `true`; se persiste
   * con el proyecto y muere con él.
   */
  agenteDiferido?: true
}

/**
 * NIVEL 3 = el REPO ACTIVO dentro de un proyecto. Estado de SESIÓN derivado del
 * escaneo (workspace.escanearRepos): se descubre al activar el proyecto y se pierde al
 * cerrarlo.
 *
 * - `repos === null` -> "aún no escaneado". Distinto de `repos === []`, que es
 *   "escaneado y la carpeta NO contiene ningún repo git".
 * - `rutaHostRepoActivo` es el repo activo de ESTE proyecto, o null si aún no hay.
 *   Se recuerda por proyecto: volver a un proyecto restaura su repo activo.
 */
export interface EstadoReposProyecto {
  /** Repos detectados en este proyecto; null = aún no escaneado. */
  repos: RepoDetectado[] | null
  /** Ruta host del repo activo de este proyecto, o null si no hay. */
  rutaHostRepoActivo: string | null
}

/**
 * Estado de nivel 2 de UN perfil: sus proyectos abiertos (en orden de tab) y
 * cuál está activo DENTRO de este perfil. `rutaActiva` es null sii el perfil no
 * tiene proyectos abiertos (perfil vacío, estado válido).
 */
export interface EstadoPestanasPerfil {
  /** Proyectos abiertos, en orden de aparición (orden de pestañas). */
  proyectosAbiertos: ProyectoAbiertoDePerfil[]
  /** rutaHostProyecto del proyecto activo de ESTE perfil, o null si está vacío. */
  rutaActiva: string | null
  /**
   * Estado de repos (nivel 3) por proyecto, indexado por rutaHostProyecto. Mapa
   * paralelo a `proyectosAbiertos` para que ProyectoAbiertoDePerfil siga siendo pura identidad.
   * Solo hay entrada para proyectos abiertos; cerrar uno la borra.
   */
  estadoRepos: Record<string, EstadoReposProyecto>
}

/**
 * Estado completo del árbol de tabs. `profiles` es la config estática; el estado
 * de sesión vive en `byProfile` (uno por cada perfil, creado en el init).
 */
export interface EstadoArbolPestanas {
  /** Perfiles de config (nivel 1), tal cual los devolvió obtenerPerfiles. */
  perfiles: Perfil[]
  /** Perfil activo (nivel 1). null solo si NO hay perfiles en absoluto. */
  perfilActivoId: string | null
  /** Estado de sesión de nivel 2, indexado por profileId. */
  porPerfil: Record<string, EstadoPestanasPerfil>
}

/**
 * Sesión de tabs RESTAURADA del disco, ya en forma de modelo (la produce
 * fotoWorkspace). `byProfile` puede traer ids de perfiles que ya no existen:
 * `estadoInicialArbolPestanas` solo lee las entradas de los perfiles ACTUALES, así que un id
 * obsoleto se descarta sin más.
 */
export interface SesionRestaurada {
  /** Perfil activo recordado (o null). Se valida contra los perfiles actuales. */
  perfilActivoId: string | null
  /** Estado de sesión por perfil (posiblemente con ids obsoletos, ignorados). */
  porPerfil: Record<string, EstadoPestanasPerfil>
}

export type AccionPestanas =
  /**
   * Carga inicial: fija perfiles, RESTAURA la sesión persistida (si la hay) y
   * elige perfil activo. `restored` ausente/vacío = arranque limpio.
   */
  | { tipo: 'init'; perfiles: Perfil[]; perfilPreferidoId?: string; restaurada?: SesionRestaurada }
  /** Cambia el perfil activo (nivel 1). No-op si el id no existe. */
  | { tipo: 'setActiveProfile'; perfilId: string }
  /**
   * Un proyecto ELEGIDO se abre en un perfil: se añade (sin duplicar) y se activa.
   * Su identidad (path + nombre); el `estado` lo fija el reducer ('active'). Con
   * `agenteDiferido`, y solo si el proyecto se CREA, nace con el agente sin arrancar.
   */
  | {
      tipo: 'openProject'
      perfilId: string
      proyecto: { projectHostPath: string; name: string }
      agenteDiferido?: boolean
    }
  /** Quita la marca de agente diferido de un proyecto: su agente puede arrancar ya. */
  | { tipo: 'quitarAgenteDiferido'; perfilId: string; rutaHostProyecto: string }
  /** Marca un proyecto ya abierto como activo dentro de su perfil. Al entrar, lo
   *  despierta (flip 'hibernated' -> 'active'). */
  /**
   * `entrar`: además pasa a ese perfil, en la MISMA acción. `setActiveProfile` despierta el activo
   * del perfil; dar los dos pasos por separado despertaba (y arrancaba el agente de) uno que nadie pidió.
   */
  | { tipo: 'setActiveProject'; perfilId: string; rutaHostProyecto: string; entrar?: boolean }
  /** Cierra un proyecto de un perfil; si era el activo, elige un vecino. */
  | { tipo: 'closeProject'; perfilId: string; rutaHostProyecto: string }
  /**
   * REEMPLAZA un proyecto abierto (`rutaAnterior`) por otro ELEGIDO, en el MISMO hueco
   * de la banda (conserva el orden) y lo activa. Si el nuevo ya está abierto en
   * otro tab NO duplica: cierra el viejo y activa el existente.
   */
  | { tipo: 'replaceProject'; perfilId: string; rutaAnterior: string; proyecto: { projectHostPath: string; name: string } }
  /**
   * Reordena las pestañas de proyecto de un perfil (arrastre). `rutasOrdenadas` tiene que
   * ser EXACTAMENTE sus rutas abiertas; no cambia el activo ni despierta nada.
   */
  | { tipo: 'reordenarProyectos'; perfilId: string; rutasOrdenadas: string[] }
  /**
   * DESPIERTA un proyecto sin activarlo: flip 'hibernated' -> 'active' y nada más.
   * Lo usa el mosaico, donde traer un proyecto dormido a una casilla no debe mover
   * la vista normal de ese perfil ni el objetivo de git.
   */
  | { tipo: 'wakeProject'; perfilId: string; rutaHostProyecto: string }
  /** Hiberna un PERFIL entero: marca 'hibernated' TODOS sus proyectos abiertos. */
  | { tipo: 'hibernateProfile'; perfilId: string }
  /**
   * El main cerró por inactividad el AGENTE de un proyecto: pasa de 'active' a
   * 'agente-hibernado'. Con cualquier otro estado, o sin el proyecto, no hace nada.
   */
  | { tipo: 'hibernarAgentes'; perfilId: string; rutaHostProyecto: string }
  /**
   * Guarda el resultado del escaneo de un proyecto (nivel 3). Si el proyecto no
   * tenía repo activo válido, aplica la elección por defecto (raíz -> primero).
   * No-op si el perfil o el proyecto no existen (escaneo obsoleto tras cerrar).
   */
  | { tipo: 'setScannedRepos'; perfilId: string; rutaHostProyecto: string; repos: RepoDetectado[] }
  /**
   * Marca el repo activo de un proyecto. No-op si el repo no está en la lista
   * escaneada de ese proyecto (o si aún no se ha escaneado).
   */
  | { tipo: 'setActiveRepo'; perfilId: string; rutaHostProyecto: string; rutaHostRepo: string }
  /** Añade un perfil YA construido (id/agentes los arma usePestanas) y lo activa. */
  | { tipo: 'addProfile'; profile: Perfil }
  /** Renombra un perfil (solo `nombre`; el `id` NO cambia: contenedor/creds intactos). */
  | { tipo: 'renameProfile'; perfilId: string; nombre: string }
  /** Cambia el color de un perfil. */
  | { tipo: 'recolorProfile'; perfilId: string; color: string }
  | { tipo: 'setProfileRedHost'; perfilId: string; redHost: boolean }
  | { tipo: 'setProfileReglas'; perfilId: string; reglas: string }
  | { tipo: 'fijarClavesSsh'; perfil: string; claves: string[] }
  /** Sustituye las carpetas de documentos de referencia del perfil (vacía: las quita). */
  | { tipo: 'setProfileDocumentos'; perfilId: string; documentos: string[] }
  /** Si el perfil usa el contexto global de los agentes. */
  | { tipo: 'setProfileContextoGlobal'; perfilId: string; usar: boolean }
  /** Elimina un perfil (y su estado de sesión); si era el activo, hereda un vecino. */
  | { tipo: 'deleteProfile'; perfilId: string }
  /** Reordena los perfiles a la secuencia de ids dada (drag & drop). */
  | { tipo: 'reorderProfiles'; idsOrdenados: string[] }

/**
 * Perfil preferido al arrancar sin sesión restaurada: el que siembra `config/profiles.json`.
 * Si no existe (el usuario lo borró o renombró su id), se activa el primero de la lista.
 */
export const ID_PERFIL_SEMILLA = 'personal'

/** Estado vacío inicial (antes de cargar perfiles). El hook parte de aquí. */
export const ESTADO_ARBOL_PESTANAS_VACIO: EstadoArbolPestanas = {
  perfiles: [],
  perfilActivoId: null,
  porPerfil: {}
}

/**
 * Construye el estado inicial a partir de los perfiles cargados y, si se pasa,
 * la sesión RESTAURADA del disco. Sin `restored`, cada perfil arranca sin proyectos.
 *
 * Solo se restauran las entradas de perfiles que existen HOY (se itera `profiles`):
 * un id persistido de un perfil borrado se descarta solo, y un perfil sin entrada
 * persistida arranca vacío. El perfil activo inicial es, por prioridad: el
 * restaurado (si sigue existiendo) -> el preferido (bootstrap) -> el primero.
 *
 * No se pre-abre ningún proyecto bootstrap: el renderer no conoce su ruta y toda
 * ruta de proyecto debe venir opaca del diálogo nativo.
 *
 * Política de arranque: solo se "enciende" UN proyecto, el activo del perfil activo;
 * todos los demás amanecen 'hibernated' hasta que el usuario entra en ellos (los
 * despierta `wakeProject`). Un proyecto restaurado 'active' que nunca se visita
 * arrancaría su pane perezoso y su dot se quedaría cargando.
 */
export function estadoInicialArbolPestanas(
  perfiles: Perfil[],
  perfilPreferidoId: string = ID_PERFIL_SEMILLA,
  restaurada?: SesionRestaurada
): EstadoArbolPestanas {
  const porPerfil: Record<string, EstadoPestanasPerfil> = {}
  for (const p of perfiles) {
    const pestanasRestauradas = restaurada?.porPerfil[p.id]
    porPerfil[p.id] = pestanasRestauradas ?? pestanasVacias()
  }
  const perfilActivoId = elegirPerfilInicial(perfiles, perfilPreferidoId, restaurada?.perfilActivoId ?? null)
  return {
    perfiles,
    perfilActivoId,
    porPerfil: hibernarTodosMenosActivo(porPerfil, perfilActivoId)
  }
}

/**
 * Aplica la política de arranque: deja 'active' SOLO al proyecto activo del
 * perfil activo y marca 'hibernated' todos los demás (de cualquier perfil). Puro
 * y referencialmente estable: devuelve el mismo EstadoPestanasPerfil/ProyectoAbiertoDePerfil cuando su
 * estado no cambia, y un perfil sin proyectos se pasa tal cual.
 */
function hibernarTodosMenosActivo(
  porPerfil: Record<string, EstadoPestanasPerfil>,
  perfilActivoId: string | null
): Record<string, EstadoPestanasPerfil> {
  const rutaActiva =
    perfilActivoId !== null ? porPerfil[perfilActivoId]?.rutaActiva ?? null : null
  const salida: Record<string, EstadoPestanasPerfil> = {}
  for (const [perfilId, pestanas] of Object.entries(porPerfil)) {
    if (pestanas.proyectosAbiertos.length === 0) {
      salida[perfilId] = pestanas
      continue
    }
    let cambiado = false
    const proyectosAbiertos = pestanas.proyectosAbiertos.map((p) => {
      const mantenerActivo = perfilId === perfilActivoId && p.rutaHostProyecto === rutaActiva
      const estado: EstadoProyectoPersistido = mantenerActivo ? 'active' : 'hibernated'
      if (p.estado === estado) return p
      cambiado = true
      return { ...p, estado }
    })
    salida[perfilId] = cambiado ? { ...pestanas, proyectosAbiertos } : pestanas
  }
  return salida
}

/**
 * Perfil activo inicial, por prioridad: el RESTAURADO si sigue existiendo -> el
 * preferido (bootstrap) -> el primero -> null si no hay perfiles.
 */
function elegirPerfilInicial(
  perfiles: Perfil[],
  perfilPreferidoId: string,
  perfilActivoRestauradoId: string | null
): string | null {
  if (perfilActivoRestauradoId !== null && perfiles.some((p) => p.id === perfilActivoRestauradoId)) {
    return perfilActivoRestauradoId
  }
  if (perfiles.some((p) => p.id === perfilPreferidoId)) return perfilPreferidoId
  return perfiles[0]?.id ?? null
}

/**
 * Reducer PURO. Nunca muta la entrada; una acción sobre un id o path inexistente
 * es un no-op y devuelve el mismo estado (React compara por referencia).
 *
 * Tras cada acción, el proyecto que queda EN PANTALLA no puede seguir con su agente
 * hibernado por inactividad: cerrar la pestaña activa o borrar el perfil activo dejan de
 * heredero a uno dormido sin pasar por ningún despertar. La única excepción es la propia
 * `hibernarAgentes`: el orquestador marca a propósito un proyecto en pantalla (el usuario
 * entró mientras viajaba la ronda) y lo despierta en otra tarea.
 */
export function reducirPestanas(estado: EstadoArbolPestanas, accion: AccionPestanas): EstadoArbolPestanas {
  const siguiente = reducirAccion(estado, accion)
  return accion.tipo === 'hibernarAgentes' ? siguiente : despertarAgenteEnPantalla(siguiente)
}

function reducirAccion(estado: EstadoArbolPestanas, accion: AccionPestanas): EstadoArbolPestanas {
  switch (accion.tipo) {
    case 'init':
      return estadoInicialArbolPestanas(accion.perfiles, accion.perfilPreferidoId, accion.restaurada)
    case 'setActiveProfile':
      return reducirActivarPerfil(estado, accion)
    case 'openProject':
      return reducirAbrirProyecto(estado, accion)
    case 'setActiveProject':
      return reducirActivarProyecto(estado, accion)
    case 'wakeProject':
      return reducirDespertarProyecto(estado, accion)
    case 'hibernateProfile':
      return reducirHibernarPerfil(estado, accion)
    case 'hibernarAgentes':
      return reducirHibernarAgentes(estado, accion)
    case 'closeProject':
      return reducirCerrarProyecto(estado, accion)
    case 'replaceProject':
      return reducirReemplazarProyecto(estado, accion)
    case 'reordenarProyectos':
      return reducirReordenarProyectos(estado, accion)
    case 'quitarAgenteDiferido':
      return reducirQuitarAgenteDiferido(estado, accion)
    default:
      return reducirReposYPerfiles(estado, accion)
  }
}

/** Segunda mitad del despacho de `reducirPestanas`: repos (nivel 3) y CRUD de perfiles. */
function reducirReposYPerfiles(
  estado: EstadoArbolPestanas,
  accion: Exclude<
    AccionPestanas,
    {
      tipo:
        | 'init'
        | 'setActiveProfile'
        | 'openProject'
        | 'setActiveProject'
        | 'wakeProject'
        | 'hibernateProfile'
        | 'hibernarAgentes'
        | 'closeProject'
        | 'replaceProject'
        | 'reordenarProyectos'
        | 'quitarAgenteDiferido'
    }
  >
): EstadoArbolPestanas {
  switch (accion.tipo) {
    case 'setScannedRepos':
      return reducirFijarReposEscaneados(estado, accion)
    case 'setActiveRepo':
      return reducirActivarRepo(estado, accion)
    case 'addProfile':
      return reducirAnadirPerfil(estado, accion)
    case 'renameProfile':
      return reducirRenombrarPerfil(estado, accion)
    case 'recolorProfile':
      return reducirCambiarColorPerfil(estado, accion)
    case 'setProfileRedHost':
      return reducirFijarRedHostPerfil(estado, accion)
    case 'setProfileReglas':
      return reducirFijarReglasPerfil(estado, accion)
    case 'fijarClavesSsh':
      return { ...estado, perfiles: estado.perfiles.map((perfil) => perfil.id === accion.perfil ? { ...perfil, clavesSshPermitidas: accion.claves } : perfil) }
    case 'setProfileDocumentos':
      return reducirFijarDocumentosPerfil(estado, accion)
    case 'setProfileContextoGlobal':
      return reducirFijarContextoGlobalPerfil(estado, accion)
    case 'deleteProfile':
      return reducirEliminarPerfil(estado, accion)
    case 'reorderProfiles':
      return reducirReordenarPerfiles(estado, accion)
    default:
      return garantizarExhaustivo(accion)
  }
}

/**
 * Slug seguro (filesystem/contenedor) a partir del nombre: minúsculas, sin
 * acentos, solo [a-z0-9-]. Base del `id` de un perfil nuevo.
 */
export function crearSlugIdPerfil(nombre: string): string {
  const slug = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // quita acentos (marcas combinantes)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return slug || 'perfil'
}

/** id ÚNICO para un perfil nuevo: slug del nombre + sufijo -N si colisiona. */
export function generarIdPerfilUnico(nombre: string, perfiles: Perfil[]): string {
  const base = crearSlugIdPerfil(nombre)
  const taken = new Set(perfiles.map((p) => p.id))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Garantiza en compilación que el switch cubre todas las acciones. */
function garantizarExhaustivo(accion: never): never {
  throw new Error(`Acción de tabs no manejada: ${JSON.stringify(accion)}`)
}

// -----------------------------------------------------------------------------
// SELECTORES. La UI lee SOLO por aquí; todos puros y baratos.
// -----------------------------------------------------------------------------

/** Todos los perfiles (nivel 1). */
export function seleccionarPerfiles(estado: EstadoArbolPestanas): Perfil[] {
  return estado.perfiles
}

/** Perfil activo completo, o null si no hay perfiles. */
export function seleccionarPerfilActivo(estado: EstadoArbolPestanas): Perfil | null {
  if (estado.perfilActivoId === null) return null
  return estado.perfiles.find((p) => p.id === estado.perfilActivoId) ?? null
}

/** Proyectos abiertos del perfil `profileId` (vacío si no existe). */
export function seleccionarProyectosAbiertos(estado: EstadoArbolPestanas, perfilId: string): ProyectoAbiertoDePerfil[] {
  return estado.porPerfil[perfilId]?.proyectosAbiertos ?? []
}

/** Proyectos abiertos del perfil ACTIVO (lo que pinta la barra de subpestañas). */
export function seleccionarProyectosPerfilActivo(estado: EstadoArbolPestanas): ProyectoAbiertoDePerfil[] {
  if (estado.perfilActivoId === null) return []
  return seleccionarProyectosAbiertos(estado, estado.perfilActivoId)
}

/** path del proyecto activo de un perfil concreto (null si vacío/inexistente). */
export function seleccionarRutaActiva(estado: EstadoArbolPestanas, perfilId: string): string | null {
  return estado.porPerfil[perfilId]?.rutaActiva ?? null
}

/**
 * PROYECTO ACTIVO GLOBAL = el activo del perfil activo. `null` en un estado
 * válido: no hay perfiles, o el perfil activo no tiene proyectos abiertos.
 */
export function seleccionarRutaActivaGlobal(estado: EstadoArbolPestanas): string | null {
  if (estado.perfilActivoId === null) return null
  return seleccionarRutaActiva(estado, estado.perfilActivoId)
}

/** Objeto del proyecto activo global (para pintar nombre/estado), o null. */
export function seleccionarProyectoActivoGlobal(estado: EstadoArbolPestanas): ProyectoAbiertoDePerfil | null {
  const ruta = seleccionarRutaActivaGlobal(estado)
  if (ruta === null || estado.perfilActivoId === null) return null
  return (
    seleccionarProyectosAbiertos(estado, estado.perfilActivoId).find((p) => p.rutaHostProyecto === ruta) ?? null
  )
}

/** Estado de repos de un proyecto concreto (null si no existe la entrada). */
export function seleccionarEstadoRepos(
  estado: EstadoArbolPestanas,
  perfilId: string,
  rutaHostProyecto: string
): EstadoReposProyecto | null {
  return estado.porPerfil[perfilId]?.estadoRepos[rutaHostProyecto] ?? null
}

/** Estado de repos del proyecto activo GLOBAL (null si no hay proyecto activo). */
export function seleccionarEstadoReposActivoGlobal(estado: EstadoArbolPestanas): EstadoReposProyecto | null {
  if (estado.perfilActivoId === null) return null
  const ruta = seleccionarRutaActiva(estado, estado.perfilActivoId)
  if (ruta === null) return null
  return seleccionarEstadoRepos(estado, estado.perfilActivoId, ruta)
}

/**
 * Repos escaneados del proyecto activo, o `null` si aún no se ha escaneado (o no
 * hay proyecto activo): con el `null` el hook sabe que debe disparar el escaneo.
 */
export function seleccionarReposProyectoActivo(estado: EstadoArbolPestanas): RepoDetectado[] | null {
  return seleccionarEstadoReposActivoGlobal(estado)?.repos ?? null
}

/**
 * Repo activo del proyecto activo (objeto `RepoDetectado`), o `null` si no hay
 * proyecto activo, aún no se escaneó, o la lista quedó vacía.
 */
export function seleccionarRepoActivoGlobal(estado: EstadoArbolPestanas): RepoDetectado | null {
  const rs = seleccionarEstadoReposActivoGlobal(estado)
  if (!rs || rs.repos === null || rs.rutaHostRepoActivo === null) return null
  return rs.repos.find((r) => r.repoHostPath === rs.rutaHostRepoActivo) ?? null
}

/**
 * Ruta host que la vista de GIT debe re-apuntar con `workspace.setActiveProject`
 * (solo ServicioGit; el explorador se ancla aparte a la contenedora):
 *  - hay repo activo -> su `repoHostPath`;
 *  - sin repo activo (sin escanear, o carpeta sin repos) -> el `projectHostPath`
 *    del contenedor, para que git caiga a "sin repositorios";
 *  - sin proyecto activo -> `null`.
 * Con un solo repo (repoHostPath === projectHostPath) manda el mismo path antes y
 * después del escaneo, así que no hay doble re-apuntado.
 */
export function seleccionarRutaObjetivoGit(estado: EstadoArbolPestanas): string | null {
  const proyecto = seleccionarProyectoActivoGlobal(estado)
  if (proyecto === null) return null
  const rs = seleccionarEstadoReposActivoGlobal(estado)
  return rs?.rutaHostRepoActivo ?? proyecto.rutaHostProyecto
}

/**
 * Qué está mirando la vista de GIT de un perfil concreto.
 *
 * `repos` conserva la distinción de `EstadoReposProyecto`: `null` es "escaneo en
 * vuelo, NO SE SABE" y `[]` es "escaneado, y la carpeta no tiene repos". Colapsarlos
 * haría que la UI afirmara "esto no es un repositorio" mientras aún está mirando.
 */
export interface ObjetivoGit {
  perfilId: string
  proyecto: ProyectoAbiertoDePerfil
  /** Repo activo del proyecto. `null` = aún no escaneado, o sin repos. */
  repo: RepoDetectado | null
  /** Lista escaneada. `null` = NO SE SABE todavía; `[]` = se sabe, y no hay. */
  repos: RepoDetectado[] | null
}

/** El objetivo de git de un perfil CUALQUIERA (no solo el activo). */
export function seleccionarObjetivoGit(estado: EstadoArbolPestanas, perfilId: string): ObjetivoGit | null {
  const ruta = seleccionarRutaActiva(estado, perfilId)
  if (ruta === null) return null
  const proyecto = seleccionarProyectosAbiertos(estado, perfilId).find((p) => p.rutaHostProyecto === ruta)
  if (proyecto === undefined) return null
  const rs = seleccionarEstadoRepos(estado, perfilId, ruta)
  const repos = rs?.repos ?? null
  const repo =
    repos !== null && rs?.rutaHostRepoActivo != null
      ? repos.find((r) => r.repoHostPath === rs.rutaHostRepoActivo) ?? null
      : null
  return { perfilId, proyecto, repo, repos }
}

/**
 * El objetivo del perfil que se está MOSTRANDO. Gobierna lo que se pinta y cambia
 * en el mismo commit de React que el clic en la pestaña.
 */
export function seleccionarObjetivoGitMostrado(estado: EstadoArbolPestanas): ObjetivoGit | null {
  if (estado.perfilActivoId === null) return null
  return seleccionarObjetivoGit(estado, estado.perfilActivoId)
}


/**
 * Unidad del multiplexado: un target de agente ABIERTO. `key` es estable y sirve
 * como React key (y para dedupe).
 */
export interface DestinoAgenteAbierto {
  profileId: string
  projectHostPath: string
  agente: IdAgente
  /** `${profileId}|${projectHostPath}|${agente}` — estable e inequívoca. */
  key: string
}

/** Clave estable de un target (React key + dedupe). Fuente única de la forma. */
export function claveDestinoAgente(perfilId: string, rutaHostProyecto: string, agente: IdAgente): string {
  return `${perfilId}|${rutaHostProyecto}|${agente}`
}

/**
 * Los agentes de un proyecto (pestañas de agente). Lo da quien sabe el modo del proyecto y los
 * agentes manuales; por defecto, los de serie, iguales en todos los proyectos.
 */
export type AgentesDeProyecto = (perfilId: string, rutaHostProyecto: string) => readonly IdAgente[]

const agentesDeSerie: AgentesDeProyecto = () => AGENTES_DISPONIBLES

/**
 * Aplana TODOS los targets de agente abiertos de TODOS los perfiles: producto
 * (proyectos abiertos del perfil) × (agentes de cada proyecto). Orden determinista:
 * perfiles en el orden de `profiles`, proyectos en el de sus pestañas (el de apertura
 * hasta que el usuario las reordena arrastrando), agentes en el de `agentesDe`. Quien
 * monte nodos vivos con esta lista no puede usar su orden (ver `util/ordenEstable`).
 */
export function seleccionarTodosLosDestinosAbiertos(estado: EstadoArbolPestanas, perfiles: Perfil[], agentesDe: AgentesDeProyecto = agentesDeSerie): DestinoAgenteAbierto[] {
  const destinos: DestinoAgenteAbierto[] = []
  for (const perfil of perfiles) {
    const pestanas = estado.porPerfil[perfil.id]
    if (!pestanas) continue
    for (const proyecto of pestanas.proyectosAbiertos) {
      for (const agente of agentesDe(perfil.id, proyecto.rutaHostProyecto)) {
        destinos.push({
          profileId: perfil.id,
          projectHostPath: proyecto.rutaHostProyecto,
          agente,
          key: claveDestinoAgente(perfil.id, proyecto.rutaHostProyecto, agente)
        })
      }
    }
  }
  return destinos
}

/**
 * Un proyecto abierto de CUALQUIER perfil, con su nombre para mostrar: lo consume
 * el mosaico, que titula cada casilla con el nombre de su proyecto aunque su perfil
 * no sea el activo (`DestinoAgenteAbierto` no lleva el `name`).
 */
export interface ReferenciaProyectoAbierto {
  profileId: string
  projectHostPath: string
  name: string
  estado: EstadoProyecto
}

/** Aplana los proyectos abiertos de TODOS los perfiles, en orden determinista. */
export function seleccionarTodosLosProyectosAbiertos(estado: EstadoArbolPestanas, perfiles: Perfil[]): ReferenciaProyectoAbierto[] {
  const salida: ReferenciaProyectoAbierto[] = []
  for (const perfil of perfiles) {
    const pestanas = estado.porPerfil[perfil.id]
    if (!pestanas) continue
    for (const proyecto of pestanas.proyectosAbiertos) {
      salida.push({
        profileId: perfil.id,
        projectHostPath: proyecto.rutaHostProyecto,
        name: proyecto.nombre,
        estado: proyecto.estado
      })
    }
  }
  return salida
}

/**
 * Claves (claveDestinoAgente) de los targets cuyo AGENTE está hibernado, de TODOS los perfiles:
 * por la hibernación de su perfil ('hibernated') o por inactividad ('agente-hibernado'). La
 * columna de agente las usa para relanzar la sesión de un pane al despertar (el backend
 * cierra la sesión al hibernar y el pane no se entera solo).
 */
export function seleccionarClavesDestinoHibernados(estado: EstadoArbolPestanas, perfiles: Perfil[], agentesDe: AgentesDeProyecto = agentesDeSerie): Set<string> {
  const claves = new Set<string>()
  for (const perfil of perfiles) {
    const pestanas = estado.porPerfil[perfil.id]
    if (!pestanas) continue
    for (const proyecto of pestanas.proyectosAbiertos) {
      if (proyecto.estado === 'active') continue
      for (const agente of agentesDe(perfil.id, proyecto.rutaHostProyecto)) {
        claves.add(claveDestinoAgente(perfil.id, proyecto.rutaHostProyecto, agente))
      }
    }
  }
  return claves
}
