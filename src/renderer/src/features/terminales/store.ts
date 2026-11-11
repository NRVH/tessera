// =============================================================================
// Store de las terminales de la ventana: las de shell de cada proyecto abierto (lista y activa) y las
// pestañas SSH de cada perfil (lista y elegida por contexto). Vive por encima de los panes para que
// las terminales sobrevivan a dejar de mirar el proyecto. Las reglas son las de shellTerminalsModel
// y sshTabsModel (puros, con su prueba), y el orden de la tira, el de tiraTerminalesModel. Elegir o
// crear una terminal local suelta la SSH elegida del contexto: el contexto de un proyecto es su
// clave, así que no hace falta pasarlo aparte. Las terminales guardadas en la sesión de cada proyecto
// se recrean la primera vez que se ve.
// =============================================================================
import { create } from 'zustand'
import {
  addTerminal,
  ensureProject,
  initialShellTerminalsState,
  pruneProjects,
  renameTerminal,
  restaurarTerminales,
  selectTerminal,
  type ShellTerminalsState
} from './shellTerminalsModel'
import {
  actualizarAliasSsh,
  elegirSsh,
  initialSshTabsState,
  perfilDeContexto,
  podarContextosSsh,
  podarSsh,
  renombrarSsh,
  restaurarSsh,
  soltarSsh,
  sshDePerfil,
  type SshTabsState
} from './sshTabsModel'
import {
  abrirSshEnTira,
  cerrarLocalEnTira,
  cerrarSshEnTira,
  initialOrdenTira,
  marcasDeOrden,
  moverEnTira,
  ordenDesdeMarcas,
  podarOrden,
  type EstadoTira
} from './tiraTerminalesModel'
import type { SshPestanasPorPerfil } from '../../../../shared/ajustesTerminal'

/** Estado de las terminales. */
export type EstadoTerminales = EstadoTira

/** Estado de las terminales. */
export const useStoreTerminales = create<EstadoTerminales>()(() => ({
  shellTerminals: initialShellTerminalsState,
  ssh: initialSshTabsState,
  orden: initialOrdenTira
}))

function aplicar(f: (s: ShellTerminalsState) => ShellTerminalsState): void {
  useStoreTerminales.setState((s) => ({ shellTerminals: f(s.shellTerminals) }))
}

/** Las terminales que un proyecto tenía al cerrar: nombres en orden, el índice de la activa y su sitio en la tira. */
export interface TerminalesGuardadas {
  nombres: readonly (string | undefined)[]
  activa: number
  orden?: readonly string[]
}

/**
 * Las guardadas de los proyectos que aún no se han visto en esta sesión (`perfil|ruta`). Se recrean al verse
 * el proyecto con el panel abierto, en el mismo punto que la primera terminal de serie, así que restaurar
 * no arranca shells que nadie mira. Hasta entonces se vuelven a guardar tal cual.
 */
const pendientes = new Map<string, TerminalesGuardadas>()

/** Las terminales guardadas al arrancar, por proyecto. */
export function fijarTerminalesPendientes(guardadas: ReadonlyMap<string, TerminalesGuardadas>): void {
  pendientes.clear()
  for (const [k, v] of guardadas) pendientes.set(k, v)
}

/** Las de un proyecto que todavía no se han recreado. */
export function terminalesPendientes(key: string): TerminalesGuardadas | undefined {
  return pendientes.get(key)
}

function aplicarSsh(f: (s: SshTabsState) => SshTabsState): void {
  useStoreTerminales.setState((s) => ({ ssh: f(s.ssh) }))
}

/** El orden guardado de los proyectos ya recreados, a la espera de las pestañas SSH, que llegan por otro camino. */
const ordenPorResolver = new Map<string, readonly string[]>()
let sshRestauradas = false

/** Pasa a ids de esta sesión el orden guardado, en cuanto están las locales del proyecto y las SSH del perfil. */
function resolverOrdenes(): void {
  if (!sshRestauradas) return
  for (const [key, marcas] of ordenPorResolver) {
    const { shellTerminals, ssh } = useStoreTerminales.getState()
    const locales = shellTerminals[key]?.list
    if (locales === undefined) continue
    ordenPorResolver.delete(key)
    const orden = ordenDesdeMarcas(marcas, sshDePerfil(ssh, perfilDeContexto(key)), locales)
    useStoreTerminales.setState((s) => ({ orden: { ...s.orden, [key]: orden } }))
  }
}

/** El orden de la tira de un proyecto tal como se guarda; `undefined` si no tiene uno propio. */
export function ordenTiraAGuardar(key: string): readonly string[] | undefined {
  const sinResolver = pendientes.get(key)?.orden ?? ordenPorResolver.get(key)
  if (sinResolver !== undefined) return sinResolver
  const { orden, shellTerminals, ssh } = useStoreTerminales.getState()
  return marcasDeOrden(orden[key], sshDePerfil(ssh, perfilDeContexto(key)), shellTerminals[key]?.list ?? [])
}

/** Acciones estables sobre las terminales de shell y las pestañas SSH. */
export const accionesTerminales = {
  /** La primera vez que se ve el proyecto con el panel abierto: sus terminales guardadas o la primera de serie. */
  asegurar: (key: string): void => {
    const guardadas = pendientes.get(key)
    pendientes.delete(key)
    aplicar((s) => (guardadas ? restaurarTerminales(s, key, guardadas.nombres, guardadas.activa) : ensureProject(s, key)))
    if (guardadas?.orden !== undefined) ordenPorResolver.set(key, guardadas.orden)
    resolverOrdenes()
  },
  podar: (valid: string[]): void =>
    useStoreTerminales.setState((s) => ({ shellTerminals: pruneProjects(s.shellTerminals, valid), orden: podarOrden(s.orden, valid) })),
  /** Mueve una pestaña en la tira del contexto; `antesDe` null = al final. No la elige ni toca su sesión. */
  moverPestana: (contexto: string, clave: string, antesDe: string | null): void =>
    useStoreTerminales.setState((s) => moverEnTira(s, contexto, clave, antesDe)),
  /** Nueva terminal local, activa y visible: suelta la SSH que se mirara en ese proyecto. */
  anadir: (key: string): void =>
    useStoreTerminales.setState((s) => ({ shellTerminals: addTerminal(s.shellTerminals, key), ssh: soltarSsh(s.ssh, key) })),
  /** Cierra una local; si era la que se veía, pasa a verse su vecina de la tira. */
  cerrar: (key: string, id: string): void => useStoreTerminales.setState((s) => cerrarLocalEnTira(s, key, id)),
  /** Elegir una local la hace visible: suelta la SSH que se mirara en ese proyecto. */
  elegir: (key: string, id: string): void =>
    useStoreTerminales.setState((s) => ({ shellTerminals: selectTerminal(s.shellTerminals, key, id), ssh: soltarSsh(s.ssh, key) })),
  renombrar: (key: string, id: string, nombre: string): void => aplicar((s) => renameTerminal(s, key, id, nombre)),
  /** Abre una pestaña SSH del perfil (o, con `sftp`, su explorador de archivos), visible en este contexto. */
  abrirSsh: (contexto: string, perfilId: string, conexionId: string, alias: string, sftp = false): void =>
    useStoreTerminales.setState((s) => abrirSshEnTira(s, contexto, perfilId, conexionId, alias, sftp)),
  cerrarSsh: (perfilId: string, id: string): void => useStoreTerminales.setState((s) => cerrarSshEnTira(s, perfilId, id)),
  elegirSsh: (perfilId: string, contexto: string, id: string): void => aplicarSsh((s) => elegirSsh(s, perfilId, contexto, id)),
  renombrarSsh: (perfilId: string, id: string, nombre: string): void => aplicarSsh((s) => renombrarSsh(s, perfilId, id, nombre)),
  /**
   * Olvida las pestañas SSH de los perfiles que ya no existen y cuál se miraba en los contextos que ya
   * no existen (un proyecto cerrado). Solo con listas de fiar: una vacía quiere decir «ninguno».
   */
  podarSsh: (perfilesVivos: string[], contextosVivos: string[]): void =>
    aplicarSsh((s) => podarContextosSsh(podarSsh(s, perfilesVivos), contextosVivos)),
  /** Pone al día el alias de las pestañas cuya conexión cambió de nombre. */
  sincronizarAliasSsh: (aliasPorConexion: ReadonlyMap<string, string>): void =>
    aplicarSsh((s) => actualizarAliasSsh(s, aliasPorConexion)),
  /** Las pestañas SSH del arranque anterior, sin elegir ninguna: no se conectan hasta que se miran. */
  restaurarSsh: (guardadas: SshPestanasPorPerfil): void => {
    aplicarSsh((s) => restaurarSsh(s, guardadas))
    sshRestauradas = true
    resolverOrdenes()
  }
}
