// =============================================================================
// Props de cada pane del agente en la columna (PanelCc): visibilidad, casilla del
// mosaico, bases montadas, cuenta y avisos, calculadas por target en el render.
// Son funciones y no un subcomponente para que el árbol siga siendo exactamente
// `ErrorBoundary` > `PaneTerminalAgente` con las mismas keys. Lo que no es del target
// se pasa con identidad estable, para que el memo del pane corte.
// Decisiones: docs/decisiones/agentes/columna-del-agente.md
// Decisiones: docs/decisiones/agentes/pane-del-agente-sin-re-render.md
// =============================================================================

import type { ComponentProps } from 'react'
import type { PaneTerminalAgente } from './PaneTerminalAgente'
import type { Perfil } from '../../../../main/perfiles/types'
import { esManualNativo, pestanasEstables, siguienteAgente, type FuenteAgentes, type PestanaAgente } from './agentesDelProyecto'
import { agenteNativo, puedeElegirModo } from './modoAgente'
import { claveDestinoAgente, tintaPerfil, type DestinoAgenteAbierto } from '../pestanas'
import { claveDestinoEditor } from '../editor'
import type { DisposicionMosaico, OpcionMosaico } from '../mosaico'
import type { PropsPanelCc, InfoMosaicoColumna } from './PanelCc'
import type { ColorPerfil, VersionesAgente } from './useCCPanelMosaico'
import type { LugarEnLaPrincipal } from './textosMontajeBases'

type PropsPane = ComponentProps<typeof PaneTerminalAgente>
type PropsVisibilidad = Pick<
  PropsPane,
  'visible' | 'enPantalla' | 'mostrado' | 'robaFoco' | 'tokenFoco' | 'enMosaico' | 'celda'
>
type PropsBasesYCuenta = Pick<
  PropsPane,
  | 'onSeleccionarAgente'
  | 'basesMontadas'
  | 'basesListas'
  | 'onCambioBasesMontadas'
  | 'lugar'
  | 'onCerrar'
  | 'onElegirModo'
  | 'cuentaSeleccionadaId'
  | 'onSeleccionarCuenta'
>
type PropsAvisos = Pick<PropsPane, 'onCambioEstado' | 'onCambioVivo' | 'onApi'>

/**
 * Valores que todos los panes comparten, con la MISMA identidad en cada render (el pane
 * va memoizado y una lista nueva lo repintaría). Congelados: un `push` por descuido lanza.
 */
const SIN_BASES_MONTADAS = Object.freeze([]) as unknown as string[]
function sinElegirCuenta(): void {}

/** El de los panes que no se ven: sin botón de maximizar, un manejador estable que no repinta. */
function sinMaximizar(): void {}

/** Lo que PanelCc calcula en el render y comparten todos los panes. */
export interface CalculoColumna {
  enMosaico: boolean
  mosaico: InfoMosaicoColumna | null
  disposicion: DisposicionMosaico | null
  perfiles: Perfil[]
  coloresPerfil: Record<string, ColorPerfil | undefined>
  opcionesPorPerfil: Map<string, OpcionMosaico[]>
  versionesPorDestino: Map<string, VersionesAgente>
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

function casillaDe(destino: DestinoAgenteAbierto, { enMosaico, mosaico, disposicion }: CalculoColumna): Casilla {
  const indice = enMosaico ? (mosaico?.teselas.indexOf(destino.key) ?? -1) : -1
  const esCasilla = indice >= 0
  const celda = esCasilla && disposicion ? (disposicion.celdas[indice] ?? null) : null
  return { esCasilla, celda, mostrado: esCasilla && celda !== null }
}

/**
 * ¿Se lleva el teclado al aparecer o al abrir? En el mosaico solo la ENFOCADA (si no, se lo robarían
 * entre sí). El agente de la terminal, solo en el commit en que el usuario lo pidió: aparecer al entrar
 * en pantalla completa no. Los demás, salvo en los commits sin foco (`sinRobarFoco`).
 */
function robaFocoDe(p: PropsPanelCc, c: CalculoColumna, enfocada: boolean, lugar: LugarEnLaPrincipal): boolean {
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
  destino: DestinoAgenteAbierto,
  p: PropsPanelCc,
  c: CalculoColumna,
  casilla: Casilla,
  lugar: LugarEnLaPrincipal
): PropsVisibilidad {
  const esActivo = destino.key === p.claveDestinoActivo
  const enfocada = destino.key === c.mosaico?.enfocada
  const provisional = c.disposicion?.origen === 'sin-medir'
  return {
    visible: esActivo && (!c.enMosaico || casilla.esCasilla),
    // `hidden` es la columna PLEGADA: sigue montada y visible, pero no en pantalla.
    enPantalla: c.enMosaico ? casilla.mostrado && (!provisional || enfocada) : esActivo && !(p.oculta ?? false),
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
function otroAgenteDe(destino: DestinoAgenteAbierto, mosaico: InfoMosaicoColumna, pestanas: readonly PestanaAgente[]): NonNullable<PropsPane['mosaico']>['otroAgente'] {
  const agente = siguienteAgente(pestanas.map((x) => x.id), destino.agente)
  if (!agente) return null
  const clave = claveDestinoAgente(destino.profileId, destino.projectHostPath, agente)
  const nombre = pestanas.find((x) => x.id === agente)?.nombre ?? agente
  return { clave, agente, nombre, trabajando: mosaico.trabajando.has(clave), sinVer: mosaico.sinVer.has(clave), esperando: mosaico.esperando.has(clave) }
}

/** Datos y acciones de la casilla; una casilla por proyecto y dentro se elige el agente. */
function propsMosaicoDe(
  destino: DestinoAgenteAbierto,
  perfil: Perfil | null,
  c: CalculoColumna,
  casilla: Casilla,
  pestanas: readonly PestanaAgente[]
): PropsPane['mosaico'] {
  const mosaico = c.mosaico
  if (!casilla.esCasilla || !mosaico) return null
  const color = c.coloresPerfil[destino.profileId]
  const { profileId: perfilId, projectHostPath: rutaHostProyecto } = destino
  return {
    perfil: perfil?.nombre ?? perfilId,
    proyecto: mosaico.nombresProyecto[`${perfilId}|${rutaHostProyecto}`] ?? nombreDeRuta(rutaHostProyecto),
    color: color?.tinta ?? null,
    colorClaro: color?.claro ?? null,
    trabajando: mosaico.trabajando.has(destino.key),
    terminadaSinVer: mosaico.sinVer.has(destino.key),
    esperando: mosaico.esperando.has(destino.key),
    ampliada: mosaico.ampliada === destino.key,
    enfocada: mosaico.enfocada === destino.key,
    claveProyecto: claveDestinoEditor(perfilId, rutaHostProyecto),
    // SÓLO los de SU perfil: ver `InfoMosaicoPane.destinos`.
    destinos: c.opcionesPorPerfil.get(perfilId) ?? [],
    onElegirDestino: (clave: string) => mosaico.onElegirDestino(destino.key, clave),
    onAbrirProyecto: () => mosaico.onAbrirProyecto(destino.key, perfilId),
    otroAgente: otroAgenteDe(destino, mosaico, pestanas),
    onAmpliar: () => mosaico.onAmpliar(destino.key),
    onIrAlProyecto: () => mosaico.onIrAlProyecto(destino),
    onEnfocar: () => mosaico.onEnfocar(destino.key)
  }
}

/** Dónde vive el agente de un target: decide los textos, de quién es su selector y si monta bases. */
function lugarDe(destino: DestinoAgenteAbierto, p: PropsPanelCc): LugarEnLaPrincipal {
  if (p.rutasAgenteTerminal?.has(destino.projectHostPath)) return 'terminal'
  return p.rutasEspacioDatos?.has(destino.projectHostPath) ? 'datos' : 'proyecto'
}

/** Bases montadas (por proyecto, no por agente), cuenta del target y lo propio del agente de la terminal. */
function propsBasesYCuenta(destino: DestinoAgenteAbierto, p: PropsPanelCc, lugar: LugarEnLaPrincipal): PropsBasesYCuenta {
  const { profileId: perfilId, projectHostPath: rutaHostProyecto } = destino
  const terminal = lugar === 'terminal'
  return {
    // El agente de la terminal elige el suyo: no cambia el agente de los proyectos del perfil.
    onSeleccionarAgente: terminal ? p.onSeleccionarAgenteTerminal : p.onSeleccionarAgente,
    basesMontadas: p.montajesDbPorProyecto?.[`${perfilId}|${rutaHostProyecto}`] ?? SIN_BASES_MONTADAS,
    basesListas: p.basesListas,
    // Sin `onCambioBasesMontadas` el pane NO pinta el selector de bases montadas: el de la terminal no monta (v1).
    onCambioBasesMontadas: terminal ? undefined : p.onCambioBasesMontadas,
    // Los TEXTOS de la cabecera: «este proyecto», «el agente de datos» o «el agente de la terminal».
    lugar,
    onCerrar: terminal ? p.onCerrarAgenteTerminal : undefined,
    // La MISMA función para todos los que pueden elegir: el pane va memoizado.
    onElegirModo: puedeElegirModo(lugar, destino.agente) ? p.onElegirModoAgente : undefined,
    cuentaSeleccionadaId: p.cuentaPorDestino?.[destino.key] ?? null,
    onSeleccionarCuenta: p.onSeleccionarCuenta ?? sinElegirCuenta
  }
}

function propsAvisos(p: PropsPanelCc): PropsAvisos {
  return { onCambioEstado: p.onEstadoDestino, onCambioVivo: p.onVivoDestino, onApi: p.onApiAgente }
}

/**
 * Props completas del pane de un target. Nativo o Docker es de cada AGENTE (`modoAgente.ts`); el
 * color del perfil baja EN TINTA, el mismo tono que en el resto de la ventana.
 */
export function propsPaneDeDestino(destino: DestinoAgenteAbierto, p: PropsPanelCc, c: CalculoColumna): PropsPane {
  const perfil = c.perfiles.find((x) => x.id === destino.profileId) ?? null
  const casilla = casillaDe(destino, c)
  const lugar = lugarDe(destino, p)
  const modoNativo = agenteNativo({
    lugar,
    agente: destino.agente,
    elegido: p.modoPorDestino?.[destino.key],
    manualNativo: esManualNativo(c.fuenteAgentes, destino.agente)
  })
  // El botón de maximizar solo existe en el pane a la vista. Dárselo a todos repintaría
  // todos los panes cada vez que el proyecto activo pasa de tener pestañas a no tenerlas.
  const esActivo = destino.key === p.claveDestinoActivo
  const pestanas = pestanasEstables(c.fuenteAgentes, destino.profileId, lugar)
  return {
    target: destino,
    modoNativo,
    ...propsVisibilidad(destino, p, c, casilla, lugar),
    mosaico: propsMosaicoDe(destino, perfil, c, casilla, pestanas),
    hibernado: p.clavesDestinoHibernados?.has(destino.key) ?? false,
    nombrePerfil: perfil?.nombre ?? null,
    colorAcento: perfil?.color ? tintaPerfil(perfil.color) : null,
    pestanasAgente: pestanas,
    ...propsBasesYCuenta(destino, p, lugar),
    puedeExpandir: esActivo && p.puedeExpandir,
    expandido: esActivo && p.expandido,
    onAlternarExpandir: esActivo ? p.onAlternarExpandir : sinMaximizar,
    ...propsAvisos(p),
    versionesAgente: modoNativo ? (c.versionesPorDestino.get(destino.key) ?? null) : null
  }
}
