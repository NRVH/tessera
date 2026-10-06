// =============================================================================
// Store de las conexiones SSH de la ventana: las conexiones y los grupos de TODOS los perfiles
// (el main los manda juntos; cada lista filtra por el suyo), el diálogo abierto, si el lanzador
// (la lista flotante) está desplegado, los grupos plegados de cada perfil, el riel de pantalla
// completa (su ancho y qué perfiles lo ocultan) y las conexiones recientes de cada perfil, que son lo
// que recuerda el lanzador; esto último se persiste. Las reglas de plegar, ocultar, recordar y podar
// son las de `shared/ajustesTerminal`, puras y con su prueba.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/riel-de-conexiones.md,
// docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================
import { create } from 'zustand'
import {
  SSH_RIEL_ANCHO_POR_DEFECTO,
  conPlegado,
  conReciente,
  conRielVisible,
  normalizarAnchoRiel,
  podarMapaPorPerfil,
  podarRecientes,
  type SshGruposPlegadosPorPerfil,
  type SshRecientesPorPerfil,
  type SshRielVisiblePorPerfil
} from '../../../../shared/ajustesTerminal'
import type { SshConexion, SshGrupo, SshLecturaOpenSsh, SshListaConexiones } from '../../../../shared/ssh-ipc'
import type { ImportacionEnFormulario } from './importacionOpenSsh'

/** Las conexiones y los grupos de UN perfil, con identidad estable entre cargas iguales. */
export interface DatosPerfilSsh {
  conexiones: readonly SshConexion[]
  grupos: readonly SshGrupo[]
}

/** Lo que no hay: una constante, para que un selector de un perfil sin datos no devuelva un objeto nuevo en cada render. */
export const SIN_DATOS_SSH: DatosPerfilSsh = { conexiones: [], grupos: [] }

/** El diálogo abierto (o ninguno). Uno solo a la vez; el de «Nuevo grupo…» del formulario es suyo, no de aquí. */
export type DialogoSsh =
  | {
      tipo: 'conexion'
      perfilId: string
      conexion: SshConexion | null
      grupoId: string | null
      enfocarGrupo: boolean
      /** Un alta que nace rellena con el único `Host` de un archivo de OpenSSH. */
      importada?: ImportacionEnFormulario
    }
  | { tipo: 'importarOpenSsh'; perfilId: string; lectura: SshLecturaOpenSsh }
  | { tipo: 'grupo'; perfilId: string; grupo: SshGrupo | null }
  | { tipo: 'eliminarConexion'; conexion: SshConexion }
  | { tipo: 'eliminarGrupo'; grupo: SshGrupo; conexiones: number }

/** Estado de las conexiones SSH. */
export interface EstadoSsh {
  /** ¿Ya llegó la primera lista? Hasta entonces la lista dice «Cargando…», no «Sin conexiones». */
  cargado: boolean
  conexiones: readonly SshConexion[]
  porPerfil: Readonly<Record<string, DatosPerfilSsh>>
  /** El archivo de conexiones es de una versión que esta no sabe escribir: no se ofrecen altas. */
  avisoFormatoAjeno: string | null
  /** Se usan las conexiones de la copia de respaldo porque el archivo no era JSON válido. */
  avisoRecuperado: string | null
  dialogo: DialogoSsh | null
  /** El lanzador (la lista flotante) está desplegado: lo abre la ▾ de la cabecera o «Conectar por SSH…». */
  listaAbierta: boolean
  /** Perfil -> ids de los grupos plegados en el riel (`''` = «Sin grupo»). Se persiste. */
  plegadosPorPerfil: SshGruposPlegadosPorPerfil
  /** Ancho (px) del riel de conexiones a pantalla completa. GLOBAL; se persiste. */
  rielAncho: number
  /** Perfil -> el riel se ve a pantalla completa. Sin entrada = se ve. Se persiste. */
  rielVisiblePorPerfil: SshRielVisiblePorPerfil
  /** Perfil -> ids de sus últimas conexiones abiertas, la más reciente primero. Se persiste. */
  recientesPorPerfil: SshRecientesPorPerfil
}

/** Estado de las conexiones SSH. */
export const useStoreSsh = create<EstadoSsh>()(() => ({
  cargado: false,
  conexiones: [],
  porPerfil: {},
  avisoFormatoAjeno: null,
  avisoRecuperado: null,
  dialogo: null,
  listaAbierta: false,
  plegadosPorPerfil: {},
  rielAncho: SSH_RIEL_ANCHO_POR_DEFECTO,
  rielVisiblePorPerfil: {},
  recientesPorPerfil: {}
}))

/** Reparte conexiones y grupos por perfil. */
function repartirPorPerfil(conexiones: readonly SshConexion[], grupos: readonly SshGrupo[]): Record<string, DatosPerfilSsh> {
  const out: Record<string, { conexiones: SshConexion[]; grupos: SshGrupo[] }> = {}
  const de = (perfil: string): { conexiones: SshConexion[]; grupos: SshGrupo[] } => (out[perfil] ??= { conexiones: [], grupos: [] })
  for (const c of conexiones) de(c.profileId).conexiones.push(c)
  for (const g of grupos) de(g.profileId).grupos.push(g)
  return out
}

/**
 * Las recientes del lanzador, sin las conexiones que ya no existen. Solo con una lista de fiar: con el
 * archivo de una versión ajena llega vacía aunque esté lleno, y la copia de respaldo puede no traer lo último.
 */
function olvidarLoQueNoExiste(s: EstadoSsh, l: SshListaConexiones): Partial<EstadoSsh> {
  if (l.formatoAjeno || l.recuperado) return {}
  return { recientesPorPerfil: podarRecientes(s.recientesPorPerfil, new Set(l.conexiones.map((c) => c.id))) }
}

/** Las conexiones y los grupos de un perfil (una constante vacía si no tiene). */
export function datosDePerfil(s: Pick<EstadoSsh, 'porPerfil'>, perfilId: string): DatosPerfilSsh {
  return s.porPerfil[perfilId] ?? SIN_DATOS_SSH
}

/** Una conexión por su id, entre las de todos los perfiles. */
export function conexionPorId(s: Pick<EstadoSsh, 'conexiones'>, conexionId: string): SshConexion | undefined {
  return s.conexiones.find((c) => c.id === conexionId)
}

/** Acciones estables sobre el store. */
export const accionesSsh = {
  /** Reemplaza lo cargado por la lista que mandó el main y olvida lo recordado de lo que ya no está en ella. */
  cargar: (l: SshListaConexiones): void =>
    useStoreSsh.setState((s) => ({
      cargado: true,
      conexiones: l.conexiones,
      porPerfil: repartirPorPerfil(l.conexiones, l.grupos),
      avisoFormatoAjeno: l.formatoAjeno ? l.aviso : null,
      avisoRecuperado: !l.formatoAjeno && l.recuperado ? l.recuperado : null,
      ...olvidarLoQueNoExiste(s, l)
    })),
  nuevaConexion: (perfilId: string, grupoId: string | null = null, importada?: ImportacionEnFormulario): void =>
    useStoreSsh.setState({ dialogo: { tipo: 'conexion', perfilId, conexion: null, grupoId, enfocarGrupo: false, ...(importada ? { importada } : {}) } }),
  /** La revisión de un archivo de OpenSSH con varios `Host`: sustituye al diálogo que hubiera (el alta). */
  revisarImportacion: (perfilId: string, lectura: SshLecturaOpenSsh): void => useStoreSsh.setState({ dialogo: { tipo: 'importarOpenSsh', perfilId, lectura } }),
  editarConexion: (conexion: SshConexion, enfocarGrupo = false): void =>
    useStoreSsh.setState({
      dialogo: { tipo: 'conexion', perfilId: conexion.profileId, conexion, grupoId: conexion.grupoId, enfocarGrupo }
    }),
  nuevoGrupo: (perfilId: string): void => useStoreSsh.setState({ dialogo: { tipo: 'grupo', perfilId, grupo: null } }),
  renombrarGrupo: (grupo: SshGrupo): void => useStoreSsh.setState({ dialogo: { tipo: 'grupo', perfilId: grupo.profileId, grupo } }),
  pedirEliminarConexion: (conexion: SshConexion): void => useStoreSsh.setState({ dialogo: { tipo: 'eliminarConexion', conexion } }),
  pedirEliminarGrupo: (grupo: SshGrupo, conexiones: number): void =>
    useStoreSsh.setState({ dialogo: { tipo: 'eliminarGrupo', grupo, conexiones } }),
  cerrarDialogo: (): void => useStoreSsh.setState({ dialogo: null }),
  abrirLista: (): void => useStoreSsh.setState({ listaAbierta: true }),
  cerrarLista: (): void => useStoreSsh.setState({ listaAbierta: false }),
  alternarLista: (): void => useStoreSsh.setState((s) => ({ listaAbierta: !s.listaAbierta })),
  /** Pliega o despliega un grupo de un perfil; no hace nada si ya está así. */
  plegar: (perfilId: string, grupoId: string, plegado: boolean): void =>
    useStoreSsh.setState((s) => {
      const plegadosPorPerfil = conPlegado(s.plegadosPorPerfil, perfilId, grupoId, plegado)
      return plegadosPorPerfil === s.plegadosPorPerfil ? s : { plegadosPorPerfil }
    }),
  /** Fija el ancho del riel (saneado: entero y dentro de su rango); no hace nada si ya es ese. */
  fijarAnchoRiel: (px: number): void =>
    useStoreSsh.setState((s) => {
      const rielAncho = normalizarAnchoRiel(px)
      return rielAncho === s.rielAncho ? s : { rielAncho }
    }),
  /** Muestra u oculta el riel de un perfil; no hace nada si ya está así. */
  fijarRielVisible: (perfilId: string, visible: boolean): void =>
    useStoreSsh.setState((s) => {
      const rielVisiblePorPerfil = conRielVisible(s.rielVisiblePorPerfil, perfilId, visible)
      return rielVisiblePorPerfil === s.rielVisiblePorPerfil ? s : { rielVisiblePorPerfil }
    }),
  /** Alterna el riel de un perfil: se ve (no hay entrada, o `true`) y pasa a ocultarse, o al revés. */
  alternarRiel: (perfilId: string): void =>
    useStoreSsh.setState((s) => ({
      rielVisiblePorPerfil: conRielVisible(s.rielVisiblePorPerfil, perfilId, s.rielVisiblePorPerfil[perfilId] === false)
    })),
  /** Anota una conexión abierta como la más reciente de su perfil; no hace nada si ya lo era. */
  registrarReciente: (perfilId: string, conexionId: string): void =>
    useStoreSsh.setState((s) => {
      const recientesPorPerfil = conReciente(s.recientesPorPerfil, perfilId, conexionId)
      return recientesPorPerfil === s.recientesPorPerfil ? s : { recientesPorPerfil }
    }),
  /** Olvida lo recordado de los perfiles que ya no existen: plegados, riel y lanzador (nunca con una lista vacía). */
  podarPerfiles: (perfilesVivos: string[]): void =>
    useStoreSsh.setState((s) => {
      const plegadosPorPerfil = podarMapaPorPerfil(s.plegadosPorPerfil, perfilesVivos)
      const rielVisiblePorPerfil = podarMapaPorPerfil(s.rielVisiblePorPerfil, perfilesVivos)
      const recientesPorPerfil = podarMapaPorPerfil(s.recientesPorPerfil, perfilesVivos)
      const igual =
        plegadosPorPerfil === s.plegadosPorPerfil &&
        rielVisiblePorPerfil === s.rielVisiblePorPerfil &&
        recientesPorPerfil === s.recientesPorPerfil
      return igual ? s : { plegadosPorPerfil, rielVisiblePorPerfil, recientesPorPerfil }
    })
}
