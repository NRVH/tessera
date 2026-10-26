// =============================================================================
// Props de cada pane del agente en la columna (CCPanel): visibilidad, casilla del
// mosaico, bases montadas, cuenta y avisos, calculadas por target en el render.
// Son funciones y no un subcomponente para que el árbol siga siendo exactamente
// `ErrorBoundary` > `AgentTerminalPane` con las mismas keys. Lo que no es del target
// se pasa con identidad estable, para que el memo del pane corte.
// Decisiones: docs/decisiones/agentes/columna-del-agente.md
// Decisiones: docs/decisiones/agentes/pane-del-agente-sin-re-render.md
// =============================================================================

import type { ComponentProps } from 'react'
import type { AgentTerminalPane } from './AgentTerminalPane'
import type { Profile } from '../../../../main/profiles/types'
import { esManualNativo, pestanasEstables, siguienteAgente, type FuenteAgentes, type PestanaAgente } from './agentesDelProyecto'
import { agenteNativo, puedeElegirModo } from './modoAgente'
import { agentTargetKey, tintaPerfil, type OpenAgentTarget } from '../pestanas'
import { editorTargetKey } from '../editor'
import type { DisposicionMosaico, OpcionMosaico } from '../mosaico'
import type { CCPanelProps, MosaicoPanel } from './CCPanel'
import type { ColorPerfil, VersionesAgente } from './useCCPanelMosaico'
import type { LugarEnLaPrincipal } from './textosMontajeBases'

type PropsPane = ComponentProps<typeof AgentTerminalPane>
type PropsVisibilidad = Pick<
  PropsPane,
  'visible' | 'enPantalla' | 'mostrado' | 'robaFoco' | 'tokenFoco' | 'enMosaico' | 'celda'
>
type PropsBasesYCuenta = Pick<
  PropsPane,
  | 'onSelectAgent'
  | 'dbMounted'
  | 'dbReady'
  | 'onChangeDbMounted'
  | 'lugar'
  | 'onCerrar'
  | 'onElegirModo'
  | 'selectedAccountId'
  | 'onSelectAccount'
>
type PropsAvisos = Pick<PropsPane, 'onStatusChange' | 'onVivoChange' | 'onApi'>

/**
 * Valores que todos los panes comparten, con la MISMA identidad en cada render (el pane
 * va memoizado y una lista nueva lo repintaría). Congelados: un `push` por descuido lanza.
 */
const SIN_BASES_MONTADAS = Object.freeze([]) as unknown as string[]
function sinElegirCuenta(): void {}

/** El de los panes que no se ven: sin botón de maximizar, un manejador estable que no repinta. */
function sinMaximizar(): void {}

/** Lo que CCPanel calcula en el render y comparten todos los panes. */
export interface CalculoColumna {
  enMosaico: boolean
  mosaico: MosaicoPanel | null
  disposicion: DisposicionMosaico | null
  profiles: Profile[]
  coloresPerfil: Record<string, ColorPerfil | undefined>
  opcionesPorPerfil: Map<string, OpcionMosaico[]>
  versionesPorTarget: Map<string, VersionesAgente>
  /** Agentes manuales y ocultos: de aquí salen las pestañas de cada pane. */
  fuenteAgentes: FuenteAgentes
}

interface Casilla {
  esCasilla: boolean
  celda: DisposicionMosaico['celdas'][number] | null
  mostrado: boolean
}

/** Último tramo de una ruta, para titular una casilla cuyo proyecto no trae nombre. */
function nombreDeRuta(ruta: string): string {
  const partes = ruta.split(/[\\/]/).filter(Boolean)
  return partes[partes.length - 1] ?? ruta
}

function casillaDe(target: OpenAgentTarget, { enMosaico, mosaico, disposicion }: CalculoColumna): Casilla {
  const indice = enMosaico ? (mosaico?.teselas.indexOf(target.key) ?? -1) : -1
  const esCasilla = indice >= 0
  const celda = esCasilla && disposicion ? (disposicion.celdas[indice] ?? null) : null
  return { esCasilla, celda, mostrado: esCasilla && celda !== null }
}

/**
 * ¿Se lleva el teclado al aparecer o al abrir? En el mosaico solo la ENFOCADA (si no, se lo robarían
 * entre sí). El agente de la terminal, solo en el commit en que el usuario lo pidió: aparecer al entrar
 * en pantalla completa no. Los demás, salvo en los commits sin foco (`sinRobarFoco`).
 */
function robaFocoDe(p: CCPanelProps, c: CalculoColumna, enfocada: boolean, lugar: LugarEnLaPrincipal): boolean {
  if (c.enMosaico) return enfocada
  return lugar === 'terminal' ? (p.focoAgenteTerminal ?? false) : !(p.sinRobarFoco ?? false)
}

/**
 * En el mosaico, `visible` solo sigue encendido si además es casilla: nada de fuera
 * (abrir desde el explorador del sistema, cerrar el activo) arranca una sesión que
 * nadie mira. La primera pasada de cada entrada es provisional (sin medir): en ella
 * solo la casilla ENFOCADA se pone en pantalla (WebGL, sondeos del pie).
 */
function propsVisibilidad(
  target: OpenAgentTarget,
  p: CCPanelProps,
  c: CalculoColumna,
  casilla: Casilla,
  lugar: LugarEnLaPrincipal
): PropsVisibilidad {
  const esActivo = target.key === p.activeTargetKey
  const enfocada = target.key === c.mosaico?.enfocada
  const provisional = c.disposicion?.origen === 'sin-medir'
  return {
    visible: esActivo && (!c.enMosaico || casilla.esCasilla),
    // `hidden` es la columna PLEGADA: sigue montada y visible, pero no en pantalla.
    enPantalla: c.enMosaico ? casilla.mostrado && (!provisional || enfocada) : esActivo && !(p.hidden ?? false),
    mostrado: c.enMosaico ? casilla.mostrado : undefined,
    robaFoco: robaFocoDe(p, c, enfocada, lugar),
    // El MISMO token para todos: decide `robaFoco`. Con 0 al resto, enfocar una casilla
    // desde su buscador haría saltar su token y la terminal le robaría el foco.
    tokenFoco: p.tokenFoco ?? 0,
    // CASILLA y no «el mosaico está abierto»: la que deja de serlo recupera YA su tamaño.
    enMosaico: casilla.esCasilla,
    celda: casilla.celda
  }
}

/**
 * El chip de agente es un ciclo: EL SIGUIENTE de las pestañas del proyecto, no «el otro», para
 * que ningún agente (los manuales tampoco) quede inalcanzable desde el mosaico.
 */
function otroAgenteDe(target: OpenAgentTarget, mosaico: MosaicoPanel, pestanas: readonly PestanaAgente[]): NonNullable<PropsPane['mosaico']>['otroAgente'] {
  const agente = siguienteAgente(pestanas.map((x) => x.id), target.agente)
  if (!agente) return null
  const key = agentTargetKey(target.profileId, target.projectHostPath, agente)
  const nombre = pestanas.find((x) => x.id === agente)?.nombre ?? agente
  return { key, agente, nombre, trabajando: mosaico.trabajando.has(key), sinVer: mosaico.sinVer.has(key), esperando: mosaico.esperando.has(key) }
}

/** Datos y acciones de la casilla; una casilla por proyecto y dentro se elige el agente. */
function propsMosaicoDe(
  target: OpenAgentTarget,
  profile: Profile | null,
  c: CalculoColumna,
  casilla: Casilla,
  pestanas: readonly PestanaAgente[]
): PropsPane['mosaico'] {
  const mosaico = c.mosaico
  if (!casilla.esCasilla || !mosaico) return null
  const color = c.coloresPerfil[target.profileId]
  const { profileId, projectHostPath } = target
  return {
    perfil: profile?.nombre ?? profileId,
    proyecto: mosaico.nombresProyecto[`${profileId}|${projectHostPath}`] ?? nombreDeRuta(projectHostPath),
    color: color?.tinta ?? null,
    colorClaro: color?.claro ?? null,
    trabajando: mosaico.trabajando.has(target.key),
    terminadaSinVer: mosaico.sinVer.has(target.key),
    esperando: mosaico.esperando.has(target.key),
    ampliada: mosaico.ampliada === target.key,
    enfocada: mosaico.enfocada === target.key,
    proyectoKey: editorTargetKey(profileId, projectHostPath),
    // SÓLO los de SU perfil: ver `MosaicoPane.destinos`.
    destinos: c.opcionesPorPerfil.get(profileId) ?? [],
    onElegirDestino: (key: string) => mosaico.onElegirDestino(target.key, key),
    onAbrirProyecto: () => mosaico.onAbrirProyecto(target.key, profileId),
    otroAgente: otroAgenteDe(target, mosaico, pestanas),
    onAmpliar: () => mosaico.onAmpliar(target.key),
    onIrAlProyecto: () => mosaico.onIrAlProyecto(target),
    onEnfocar: () => mosaico.onEnfocar(target.key)
  }
}

/** Dónde vive el agente de un target: decide los textos, de quién es su selector y si monta bases. */
function lugarDe(target: OpenAgentTarget, p: CCPanelProps): LugarEnLaPrincipal {
  if (p.rutasAgenteTerminal?.has(target.projectHostPath)) return 'terminal'
  return p.rutasEspacioDatos?.has(target.projectHostPath) ? 'datos' : 'proyecto'
}

/** Bases montadas (por proyecto, no por agente), cuenta del target y lo propio del agente de la terminal. */
function propsBasesYCuenta(target: OpenAgentTarget, p: CCPanelProps, lugar: LugarEnLaPrincipal): PropsBasesYCuenta {
  const { profileId, projectHostPath } = target
  const terminal = lugar === 'terminal'
  return {
    // El agente de la terminal elige el suyo: no cambia el agente de los proyectos del perfil.
    onSelectAgent: terminal ? p.onSelectAgentTerminal : p.onSelectAgent,
    dbMounted: p.dbMountsByProject?.[`${profileId}|${projectHostPath}`] ?? SIN_BASES_MONTADAS,
    dbReady: p.dbReady,
    // Sin `onChangeDbMounted` el pane NO pinta el selector de bases montadas: el de la terminal no monta (v1).
    onChangeDbMounted: terminal ? undefined : p.onChangeDbMounted,
    // Los TEXTOS de la cabecera: «este proyecto», «el agente de datos» o «el agente de la terminal».
    lugar,
    onCerrar: terminal ? p.onCerrarAgenteTerminal : undefined,
    // La MISMA función para todos los que pueden elegir: el pane va memoizado.
    onElegirModo: puedeElegirModo(lugar, target.agente) ? p.onElegirModoAgente : undefined,
    selectedAccountId: p.accountByTarget?.[target.key] ?? null,
    onSelectAccount: p.onSelectAccount ?? sinElegirCuenta
  }
}

function propsAvisos(p: CCPanelProps): PropsAvisos {
  return { onStatusChange: p.onTargetStatus, onVivoChange: p.onTargetVivo, onApi: p.onApiAgente }
}

/**
 * Props completas del pane de un target. Nativo o Docker es de cada AGENTE (`modoAgente.ts`); el
 * color del perfil baja EN TINTA, el mismo tono que en el resto de la ventana.
 */
export function propsPaneDeTarget(target: OpenAgentTarget, p: CCPanelProps, c: CalculoColumna): PropsPane {
  const profile = c.profiles.find((x) => x.id === target.profileId) ?? null
  const casilla = casillaDe(target, c)
  const lugar = lugarDe(target, p)
  const hostMode = agenteNativo({
    lugar,
    agente: target.agente,
    elegido: p.modoPorTarget?.[target.key],
    manualNativo: esManualNativo(c.fuenteAgentes, target.agente)
  })
  // El botón de maximizar solo existe en el pane a la vista. Dárselo a todos repintaría
  // todos los panes cada vez que el proyecto activo pasa de tener pestañas a no tenerlas.
  const esActivo = target.key === p.activeTargetKey
  const pestanas = pestanasEstables(c.fuenteAgentes, target.profileId, lugar)
  return {
    target,
    hostMode,
    ...propsVisibilidad(target, p, c, casilla, lugar),
    mosaico: propsMosaicoDe(target, profile, c, casilla, pestanas),
    hibernated: p.hibernatedTargetKeys?.has(target.key) ?? false,
    profileName: profile?.nombre ?? null,
    accentColor: profile?.color ? tintaPerfil(profile.color) : null,
    pestanasAgente: pestanas,
    ...propsBasesYCuenta(target, p, lugar),
    canExpand: esActivo && p.canExpand,
    expanded: esActivo && p.expanded,
    onToggleExpand: esActivo ? p.onToggleExpand : sinMaximizar,
    ...propsAvisos(p),
    versionesAgente: hostMode ? (c.versionesPorTarget.get(target.key) ?? null) : null
  }
}
