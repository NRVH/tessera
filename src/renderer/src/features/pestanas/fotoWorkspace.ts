// =============================================================================
// fotoWorkspace: puente puro entre el estado en memoria de las pestañas
// (EstadoArbolPestanas, modeloPestanas) y el documento persistido (EstadoWorkspace). Sin React ni IPC.
// serializeWorkspace proyecta el esqueleto (perfil activo, proyectos con path, nombre y
// estado, activo por perfil) y descarta lo derivado (estadoRepos) y lo efímero (sesiones);
// pestanasPerfilDesdeGuardado y sesionRestauradaDesdeEstado hacen el camino inverso, y un
// proyecto hibernado amanece hibernado. Lo usa usePersistenciaPestanas.
// =============================================================================

import type { EstadoPestanasPerfil, SesionRestaurada, EstadoArbolPestanas } from './modeloPestanas'
import type {
  PestanasPerfilPersistidas,
  EstadoWorkspace
} from '../../../../shared/workspace-state-ipc'

/**
 * Proyecta el EstadoArbolPestanas vivo al documento persistible. Omite los perfiles SIN
 * proyectos abiertos (entrada innecesaria: al restaurar caen al estado por
 * defecto vacío) y todo lo derivado/efímero. `activeProfileId` se conserva
 * aunque su perfil esté vacío.
 */
export function serializeWorkspace(estado: EstadoArbolPestanas): EstadoWorkspace {
  const byProfile: Record<string, PestanasPerfilPersistidas> = {}
  for (const [perfilId, pestanas] of Object.entries(estado.porPerfil)) {
    if (pestanas.proyectosAbiertos.length === 0) continue // perfil vacío: no se persiste
    byProfile[perfilId] = {
      // La marca solo se escribe cuando existe: un proyecto sin ella sale byte a byte igual.
      openProjects: pestanas.proyectosAbiertos.map((p) => ({
        projectHostPath: p.rutaHostProyecto,
        name: p.nombre,
        // 'agente-hibernado' es de la sesión: en disco es un hibernado más.
        estado: p.estado === 'active' ? ('active' as const) : ('hibernated' as const),
        ...(p.agenteDiferido === true ? { agenteDiferido: true as const } : {})
      })),
      activePath: pestanas.rutaActiva
    }
  }
  // `version: 1` literal (no un import de valor a propósito): así este módulo solo
  // tiene imports de TIPO y corre bajo `node` en los tests, igual que modeloPestanas. El
  // tipo EstadoWorkspace fija `version: 1`, de modo que el compilador lo verifica.
  return { version: 1, activeProfileId: estado.perfilActivoId, byProfile }
}

/**
 * Reconstruye el EstadoPestanasPerfil en memoria de UN perfil a partir de su estado
 * persistido. `estadoRepos` arranca VACÍO: los repos son nivel 3 derivado del
 * escaneo, que se vuelve a disparar al activar el proyecto (no se persisten).
 */
export function pestanasPerfilDesdeGuardado(guardado: PestanasPerfilPersistidas): EstadoPestanasPerfil {
  return {
    proyectosAbiertos: guardado.openProjects.map((p) => ({
      rutaHostProyecto: p.projectHostPath,
      nombre: p.name,
      // Un proyecto hibernado se restaura hibernado, no forzado a 'active'.
      estado: p.estado,
      ...(p.agenteDiferido === true ? { agenteDiferido: true as const } : {})
    })),
    rutaActiva: guardado.activePath,
    estadoRepos: {}
  }
}

/**
 * Convierte el estado persistido COMPLETO (o null) a la sesión restaurada que
 * consume el reducer (`init.restored`). PURO: no filtra por perfiles actuales —
 * eso lo hace estadoInicialArbolPestanas al iterar los perfiles reales (un id obsoleto aquí
 * es inofensivo). `null` (sin archivo / corrupto) -> sesión vacía = arranque
 * limpio. Las rutas inexistentes ya vienen podadas del `load` del main.
 */
export function sesionRestauradaDesdeEstado(estado: EstadoWorkspace | null): SesionRestaurada {
  if (estado === null) return { perfilActivoId: null, porPerfil: {} }
  const porPerfil: Record<string, EstadoPestanasPerfil> = {}
  for (const [perfilId, pestanas] of Object.entries(estado.byProfile)) {
    porPerfil[perfilId] = pestanasPerfilDesdeGuardado(pestanas)
  }
  return { perfilActivoId: estado.activeProfileId, porPerfil }
}
