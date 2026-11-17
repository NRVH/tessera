// =============================================================================
// Qué terminal se ve y qué ofrece su botón de reinicio, en lógica pura: la pestaña SSH elegida del
// contexto si hay, si no la terminal local activa del proyecto, si no hay local la primera SSH del
// perfil, y si nada, ninguna. Sin React ni DOM: se fija bajo `node` (`test-pestanas-ssh.mts`).
// Depende de los modelos de las terminales locales y de las pestañas SSH y de `botonReinicio`.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { botonReinicio, textosReconexionSsh, textosReinicioShell, type SalidaBotonReinicio } from './botonReinicio.ts'
import { txTerminales } from './textos.ts'
import { clavePaneTerminal, type ShellTerminal, type EstadoTerminalesShell } from './modeloTerminalesShell.ts'
import { esPestanaSftp, sshDePerfil, clavePaneSsh, type DatosPestanaSsh, type EstadoPestanasSsh } from './modeloPestanasSsh.ts'
import type { TerminalPaneInfo, DestinoProyectoTerminal } from './terminalPaneTipos.ts'

/** El pane que se ve: uno de las terminales locales de un proyecto o uno de las pestañas SSH del perfil. */
export type PaneActivo =
  | { tipo: 'local'; clavePane: string; claveProyecto: string; terminalId: string }
  | { tipo: 'ssh'; clavePane: string; perfilId: string; pestana: DatosPestanaSsh }

/** Lo que decide qué se ve. */
export interface EntradaPaneActivo {
  perfilId: string
  sshLista: readonly DatosPestanaSsh[]
  /** La pestaña SSH elegida en el contexto, si hay (puede apuntar a una que ya no existe). */
  sshElegidaId: string | null
  /** El proyecto que se mira, o `null` sin proyecto. */
  claveProyecto: string | null
  /** La terminal local activa de ese proyecto, o `null` si no tiene ninguna. */
  localActivaId: string | null
}

/**
 * El pane que se ve. La SSH elegida del contexto manda; sin ella, la local activa; sin local (un
 * proyecto sin terminales, o ningún proyecto), la primera SSH del perfil que no esté recién restaurada; y sin
 * nada, `null`.
 */
export function derivarPaneActivo(e: EntradaPaneActivo): PaneActivo | null {
  const ssh = (pestana: DatosPestanaSsh): PaneActivo => ({ tipo: 'ssh', clavePane: clavePaneSsh(e.perfilId, pestana.id), perfilId: e.perfilId, pestana })
  const elegida = e.sshElegidaId === null ? undefined : e.sshLista.find((t) => t.id === e.sshElegidaId)
  if (elegida) return ssh(elegida)
  if (e.claveProyecto !== null && e.localActivaId !== null) {
    return { tipo: 'local', clavePane: clavePaneTerminal(e.claveProyecto, e.localActivaId), claveProyecto: e.claveProyecto, terminalId: e.localActivaId }
  }
  // Una restaurada aún sin elegir no: verse la conectaría sola.
  const primera = e.sshLista.find((t) => t.restaurada === undefined)
  return primera ? ssh(primera) : null
}

/**
 * La conexión de la pestaña SSH que se ve, para marcar su fila en la lista de conexiones; `null` si lo
 * que se ve es una terminal local o nada.
 */
export function conexionDelPane(pane: PaneActivo | null): string | null {
  return pane?.tipo === 'ssh' && !esPestanaSftp(pane.pestana) ? pane.pestana.conexionId : null
}

/** Lo que se ve y lo que ofrece su botón de reinicio, derivado de los modelos y de lo que reportan los panes. */
export interface ActivoTerminales {
  proyectoActivo: DestinoProyectoTerminal | null
  /** Las terminales locales del proyecto que se mira. */
  listaActiva: ShellTerminal[]
  /** Las pestañas SSH del perfil. */
  sshLista: readonly DatosPestanaSsh[]
  /** La terminal local que se VE (`null` si se ve una SSH o nada): la que la tira marca como activa. */
  localActivaId: string | null
  /** La pestaña SSH que se VE (`null` si se ve una local o nada). */
  sshActivaId: string | null
  pane: PaneActivo | null
  clavePaneActivo: string | null
  /** El botón de reinicio del pane que se ve; `null` si no se ve ninguno. */
  boton: SalidaBotonReinicio | null
}

/** Lo que `derivarActivo` lee del panel. */
export interface EntradaActivo {
  proyectos: readonly DestinoProyectoTerminal[]
  claveProyectoActivo: string | null
  terminales: EstadoTerminalesShell
  /** El perfil de la terminal: el activo. */
  perfilId: string
  /** El contexto de la terminal (`contextoSsh`). */
  contexto: string
  ssh: EstadoPestanasSsh
  infoPorPane: Readonly<Record<string, TerminalPaneInfo | undefined>>
  clavesProyectoHibernado: ReadonlySet<string>
  basesListas?: boolean
  /** Las conexiones SSH que existen: de las demás no se puede reconectar. */
  conexionesVivas: ReadonlySet<string>
}

/** Por qué no se puede reconectar una pestaña cuya conexión se eliminó. */
export function motivoConexionEliminada(): string {
  return txTerminales().conexionEliminadaMotivo
}

/** El botón de una terminal local, el de siempre: sin cuenta que pedir, solo espera a los ajustes. */
function botonLocal(info: TerminalPaneInfo | undefined, hibernado: boolean, puedeAbrir: boolean): SalidaBotonReinicio {
  return botonReinicio({
    estadoTerminal: info?.estadoTerminal ?? 'booting',
    sesionId: info?.sessionId ?? null,
    recargando: info?.recargando ?? false,
    hibernado,
    puedeAbrir,
    etiquetaNormal: txTerminales().reiniciar,
    etiquetaProgreso: txTerminales().reiniciando,
    textos: textosReinicioShell()
  })
}

/** El botón de una pestaña SSH: «Reconectar», sin hibernación y bloqueado si su conexión ya no existe. */
function botonSsh(info: TerminalPaneInfo | undefined, existe: boolean): SalidaBotonReinicio {
  return botonReinicio({
    estadoTerminal: info?.estadoTerminal ?? 'booting',
    sesionId: info?.sessionId ?? null,
    recargando: info?.recargando ?? false,
    hibernado: false,
    puedeAbrir: true,
    etiquetaNormal: txTerminales().reconectar,
    etiquetaProgreso: txTerminales().reconectando,
    textos: textosReconexionSsh(),
    ...(existe ? {} : { bloqueo: motivoConexionEliminada() })
  })
}

/** El botón de reinicio del pane que se ve, según sea una SSH o una local; `null` si no se ve ninguno. */
function botonDelPane(pane: PaneActivo | null, e: EntradaActivo): SalidaBotonReinicio | null {
  if (pane === null) return null
  const info = e.infoPorPane[pane.clavePane]
  // El explorador SFTP no tiene pty que reiniciar: él mismo ofrece «Reintentar» / «Reconectar» si algo falla.
  if (pane.tipo === 'ssh') return esPestanaSftp(pane.pestana) ? null : botonSsh(info, e.conexionesVivas.has(pane.pestana.conexionId))
  // La terminal local espera a que los ajustes de montaje estén hidratados.
  return botonLocal(info, e.clavesProyectoHibernado.has(pane.claveProyecto), e.basesListas ?? true)
}

/** Cuál de las dos clases de pestaña se ve y con qué id: la otra es `null`. */
function idsVistos(pane: PaneActivo | null): Pick<ActivoTerminales, 'localActivaId' | 'sshActivaId'> {
  return {
    localActivaId: pane?.tipo === 'local' ? pane.terminalId : null,
    sshActivaId: pane?.tipo === 'ssh' ? pane.pestana.id : null
  }
}

/** Lo que decide qué pane se ve. */
type EntradaPane = Pick<EntradaActivo, 'proyectos' | 'claveProyectoActivo' | 'terminales' | 'perfilId' | 'contexto' | 'ssh'>

/** El pane que se ve con lo que hay: el proyecto activo, sus terminales y las pestañas SSH del perfil. */
function paneDe(e: EntradaPane): { proyectoActivo: DestinoProyectoTerminal | null; sshLista: readonly DatosPestanaSsh[]; pane: PaneActivo | null } {
  const proyectoActivo = e.proyectos.find((p) => p.clave === e.claveProyectoActivo) ?? null
  const proyecto = e.claveProyectoActivo ? e.terminales[e.claveProyectoActivo] : undefined
  const sshLista = sshDePerfil(e.ssh, e.perfilId)
  const pane = derivarPaneActivo({
    perfilId: e.perfilId,
    sshLista,
    sshElegidaId: e.ssh.activaPorContexto[e.contexto] ?? null,
    claveProyecto: proyectoActivo?.clave ?? null,
    localActivaId: proyecto?.activoId ?? null
  })
  return { proyectoActivo, sshLista, pane }
}

/**
 * ¿Hay alguna terminal (local o SSH) que enseñar? La misma regla que el panel, para quien no lo monta. Un
 * proyecto que aún no tiene lista cuenta como que sí: su primera terminal nace en el efecto que sigue a este
 * render (`asegurar`), y contarlo como vacío haría que el layout se plegara y desplegara en dos commits.
 */
export function hayTerminalQueEnsenar(e: EntradaPane): boolean {
  const { proyectoActivo, pane } = paneDe(e)
  return pane !== null || (proyectoActivo !== null && e.terminales[proyectoActivo.clave] === undefined)
}

/** Lo que se ve y el botón de reinicio de ese pane. */
export function derivarActivo(e: EntradaActivo): ActivoTerminales {
  const { proyectoActivo, sshLista, pane } = paneDe(e)
  const proyecto = e.claveProyectoActivo ? e.terminales[e.claveProyectoActivo] : undefined
  return {
    proyectoActivo,
    listaActiva: proyecto?.lista ?? [],
    sshLista,
    ...idsVistos(pane),
    pane,
    clavePaneActivo: pane?.clavePane ?? null,
    boton: botonDelPane(pane, e)
  }
}
