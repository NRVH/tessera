// =============================================================================
// Store de la vista de bases de datos que comparte la ventana: pestañas, árbol y
// selección por perfil (el modelo de dbVistaEstado), bases montadas por proyecto,
// espacios de datos y su visibilidad, las peticiones al árbol y el menú de conexiones.
// =============================================================================
import { create } from 'zustand'
import type { PeticionToken } from './propsBd'
import { MAPA_VISTA_VACIO, type DbVistaMapa } from './dbVistaEstado.ts'

/** Menú para elegir conexión, anclado a una posición. */
export interface MenuConexiones {
  x: number
  y: number
  perfilId: string
}

/** Estado compartido de la vista de bases de datos. */
export interface EstadoBd {
  /** Vista de BD de cada perfil (pestañas, nodos expandidos, selección); no se persiste. */
  vistaBd: DbVistaMapa
  /** `${profileId}|${projectHostPath}` → ids de conexión montados; se persiste. */
  dbMounts: Record<string, string[]>
  /** Ruta del espacio de datos de cada perfil, tal como la da el main. */
  dbWorkspacePaths: Record<string, string>
  /** Perfiles con el espacio de datos abierto en esta sesión (no se persiste). */
  espaciosAbiertos: Set<string>
  /** Agente de datos a la vista, por perfil; sin entrada = oculto. Se persiste. */
  dbAgenteVisiblePorPerfil: Record<string, boolean>
  pedirNuevaConexion: PeticionToken<null> | null
  pedirEditarConexion: PeticionToken<string> | null
  menuConexiones: MenuConexiones | null
}

/** Estado compartido de la vista de bases de datos. */
export const useStoreBd = create<EstadoBd>()(() => ({
  vistaBd: MAPA_VISTA_VACIO,
  dbMounts: {},
  dbWorkspacePaths: {},
  espaciosAbiertos: new Set(),
  dbAgenteVisiblePorPerfil: {},
  pedirNuevaConexion: null,
  pedirEditarConexion: null,
  menuConexiones: null
}))

/** Cambia el mapa de la vista de BD; si devuelve el mismo mapa, no avisa a nadie. */
export function actualizarVistaBd(f: (m: DbVistaMapa) => DbVistaMapa): void {
  useStoreBd.setState((s) => {
    const vistaBd = f(s.vistaBd)
    return vistaBd === s.vistaBd ? s : { vistaBd }
  })
}

/** Oculta el agente de datos de un perfil borrando su entrada (oculto es el valor por defecto). */
export function ocultarAgenteDb(perfilId: string): void {
  useStoreBd.setState((s) => {
    if (!(perfilId in s.dbAgenteVisiblePorPerfil)) return {}
    const next = { ...s.dbAgenteVisiblePorPerfil }
    delete next[perfilId]
    return { dbAgenteVisiblePorPerfil: next }
  })
}

/**
 * Último token emitido. Vive FUERA del estado a propósito: al salir de la vista las
 * peticiones se olvidan (`olvidarPeticionesArbol`), y un contador que partiera de la petición
 * vigente volvería a 1 y repetiría un token que el árbol ya dio por atendido.
 */
let ultimoToken = 0

function siguientePeticion<T>(valor: T): PeticionToken<T> {
  ultimoToken += 1
  return { valor, token: ultimoToken }
}

/** Pide al árbol el diálogo de alta de conexión. */
export function pedirAltaConexion(): void {
  useStoreBd.setState({ pedirNuevaConexion: siguientePeticion(null) })
}

/** Pide al árbol el diálogo de edición de una conexión. */
export function pedirEdicionConexion(conexionId: string): void {
  useStoreBd.setState({ pedirEditarConexion: siguientePeticion(conexionId) })
}

/** Olvida las peticiones al árbol que nadie atendió (al salir de la vista). */
export function olvidarPeticionesArbol(): void {
  useStoreBd.setState({ pedirNuevaConexion: null, pedirEditarConexion: null })
}

/**
 * ¿Queda `pedida` por atender, si la última atendida fue `atendida`? Cada token se atiende
 * una sola vez, se monte el árbol las veces que se monte.
 */
export function peticionPorAtender<T>(
  pedida: PeticionToken<T> | null,
  atendida: number | null
): pedida is PeticionToken<T> {
  return pedida !== null && pedida.token !== atendida
}
