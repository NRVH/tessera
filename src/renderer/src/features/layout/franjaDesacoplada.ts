// =============================================================================
// Reparto de la franja, qué controles lleva cada cabecera y barra lateral, su vista compacta y los
// agentes cuando un perfil tiene ventana propia.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { ANCHO_CC_MIN } from '../../../../shared/workspace-state-ipc.ts'
import type { PanelInferiorCentro } from './layoutCentro.ts'

/**
 * Lo que la terminal a pantalla completa conserva junto a su agente (el suelo que también respeta el
 * riel de conexiones, `TERMINAL_ANCHO_MIN`), más el riel de actividad y los canales del lienzo.
 */
export const TERMINAL_JUNTO_AL_AGENTE = 420 + 60

/** Por debajo de este ancho (px) de la ventana hija, la vista compacta se impone sola. */
export const ANCHO_COMPLETA_FRANJA_MIN = TERMINAL_JUNTO_AL_AGENTE + ANCHO_CC_MIN

function compactaPorAncho(ancho: number): boolean {
  return ancho > 0 && ancho < ANCHO_COMPLETA_FRANJA_MIN
}

export function agenteVisibleEnFranja(hayAgente: boolean, compactaPedida: boolean, ancho: number): boolean {
  return hayAgente && !compactaPedida && !compactaPorAncho(ancho)
}

export interface EntradaVistaFranja {
  compactaPedida: boolean
  anchoVentana: number
  panel: PanelInferiorCentro
  hayAgente: boolean
  agentePedido: boolean
  hayTerminales: boolean
  agenteMaximizadoPedido: boolean
}

export interface VistaFranjaDesacoplada {
  compacta: boolean
  compactaPedida: boolean
  impuestaPorAncho: boolean
  rielVisible: boolean
  rielSshOculto: boolean
  agenteVisible: boolean
  botonAgenteActivo: boolean
  /** El botón del agente solo existe en la vista completa: en la compacta el agente está oculto por definición. */
  botonAgenteVisible: boolean
  terminalPlegada: boolean
  agenteMaximizado: boolean
}

export function conVentanaDeFranja<T>(desacopladas: ReadonlyMap<string, T>, perfil: string, ventana?: T): ReadonlyMap<string, T> {
  const siguientes = new Map(desacopladas)
  if (ventana === undefined) siguientes.delete(perfil)
  else siguientes.set(perfil, ventana)
  return siguientes
}

export function conCompactaDeFranja(
  compactas: Readonly<Record<string, boolean>>,
  perfil: string,
  valor: boolean
): Readonly<Record<string, boolean>> {
  if (Boolean(compactas[perfil]) === valor) return compactas
  return { ...compactas, [perfil]: valor }
}

export function sinPerfilDeFranja(
  compactas: Readonly<Record<string, boolean>>,
  perfil: string
): Readonly<Record<string, boolean>> {
  if (!(perfil in compactas)) return compactas
  const siguientes = { ...compactas }
  delete siguientes[perfil]
  return siguientes
}

export function panelDeHija(guardado: string | undefined, inicial: PanelInferiorCentro): PanelInferiorCentro {
  return guardado === 'terminal' || guardado === 'gitlog' ? guardado : inicial
}

export function repartirFranja(
  desacopladas: { has(perfil: string): boolean },
  perfil: string,
  panel: PanelInferiorCentro | null
): { panelPrincipal: PanelInferiorCentro | null; acoplarEnRiel: boolean } {
  const acoplarEnRiel = desacopladas.has(perfil)
  return { panelPrincipal: acoplarEnRiel ? null : panel, acoplarEnRiel }
}

export function entraEnMosaico(
  desacopladas: { has(perfil: string): boolean },
  perfil: string,
  lugar: string
): boolean {
  return lugar !== 'terminal' || !desacopladas.has(perfil)
}

/** Los cinco casos de cabecera y barra lateral de la franja. */
export type CasoControlesFranja =
  | 'principal'
  | 'principal-completa'
  | 'hija-completa'
  | 'hija-compacta-pedida'
  | 'hija-compacta-impuesta'

export function casoDeControlesFranja(e: {
  enHija: boolean
  pantallaCompleta: boolean
  vista: Pick<VistaFranjaDesacoplada, 'compacta' | 'impuestaPorAncho'> | null
}): CasoControlesFranja {
  if (!e.enHija || e.vista === null) return e.pantallaCompleta ? 'principal-completa' : 'principal'
  if (!e.vista.compacta) return 'hija-completa'
  return e.vista.impuestaPorAncho ? 'hija-compacta-impuesta' : 'hija-compacta-pedida'
}

/** Una entrada del menú de la flecha de la vista de la ventana desacoplada. */
export type EntradaMenuVista = 'vistaCompleta' | 'acoplar'

/** Qué controles lleva la cabecera de un panel de la franja y su barra lateral en cada caso. */
export interface ControlesFranja {
  /** Maximizar: botón dividido cuya flecha ofrece pantalla completa y desacoplar. */
  maximizar: 'dividido' | null
  /** Desacoplar suelto: solo con la franja a pantalla completa, donde maximizar y ocultar viven en el riel. */
  desacoplarIcono: boolean
  /** El conmutador al otro panel, porque la compacta no tiene barra lateral. */
  conmutador: boolean
  /** La vista: un icono (completa) o el botón dividido «Vista ▾» (compacta). */
  vista: 'icono' | 'dividido' | null
  /** La parte principal de la vista no se puede usar: el ancho impone la compacta. */
  vistaPrincipalDeshabilitada: boolean
  /** Las entradas del menú de la flecha de la vista, en su orden. */
  menuVista: readonly EntradaMenuVista[]
}

export function controlesDeFranja(caso: CasoControlesFranja): ControlesFranja {
  const base: ControlesFranja = {
    maximizar: null,
    desacoplarIcono: false,
    conmutador: false,
    vista: null,
    vistaPrincipalDeshabilitada: false,
    menuVista: []
  }
  switch (caso) {
    case 'principal':
      return { ...base, maximizar: 'dividido' }
    case 'principal-completa':
      return { ...base, desacoplarIcono: true }
    case 'hija-completa':
      return { ...base, vista: 'icono' }
    case 'hija-compacta-pedida':
      return { ...base, conmutador: true, vista: 'dividido', menuVista: ['vistaCompleta', 'acoplar'] }
    case 'hija-compacta-impuesta':
      return { ...base, conmutador: true, vista: 'dividido', vistaPrincipalDeshabilitada: true, menuVista: ['vistaCompleta', 'acoplar'] }
  }
}

/** El proyecto activo del perfil y la vista que se pinta en su ventana desacoplada. */
export interface EstadoVistaFranja {
  proyecto: string | null
  vista: VistaFranjaDesacoplada
  panel: PanelInferiorCentro
}

/** Las zonas de la ventana desacoplada que entran o salen por su lado: la barra lateral y la columna del agente. */
export type ZonaVistaFranja = 'riel' | 'agente'

/** Cómo se anima pasar de una vista a otra de la ventana desacoplada. */
export interface CambioDeVistaFranja {
  /** `apertura` si aparece alguna zona; si solo se van, es un cierre (más rápido). */
  tipo: 'apertura' | 'cierre'
  seVan: ZonaVistaFranja[]
  aparecen: ZonaVistaFranja[]
  /** El panel de la franja cambia (Terminal y Git·Log ocupan el mismo hueco): un fundido cruzado en su sitio. */
  cruce: boolean
  /** La lista de conexiones SSH de la terminal se abre o se cierra por la izquierda, desplazando el texto. */
  morfa: boolean
}

/** El contexto y los cambios de vista que afectan al reparto. */
export function firmaVistaFranja(e: EstadoVistaFranja | null): string {
  if (e === null) return ''
  const v = e.vista
  return JSON.stringify([e.proyecto, e.panel, v.compacta, v.rielVisible, v.rielSshOculto, v.agenteVisible, v.terminalPlegada, v.agenteMaximizado])
}

/**
 * Cómo se anima el cambio de vista de la ventana desacoplada, o `null` si es instantáneo. Que la vista compacta se
 * imponga o se retire por el ancho no se anima: la ventana se está redimensionando y redimensionar no se anima.
 */
export function cambioDeVistaFranja(antes: EstadoVistaFranja, despues: EstadoVistaFranja): CambioDeVistaFranja | null {
  if (antes.proyecto !== despues.proyecto || firmaVistaFranja(antes) === firmaVistaFranja(despues)) return null
  const soloElAncho = antes.vista.compactaPedida === despues.vista.compactaPedida && antes.vista.compacta !== despues.vista.compacta
  if (soloElAncho) return null
  const seVan: ZonaVistaFranja[] = []
  const aparecen: ZonaVistaFranja[] = []
  const zonas: readonly [ZonaVistaFranja, boolean, boolean][] = [
    ['riel', antes.vista.rielVisible, despues.vista.rielVisible],
    ['agente', antes.vista.agenteVisible, despues.vista.agenteVisible]
  ]
  for (const [zona, estaba, esta] of zonas) {
    if (estaba && !esta) seVan.push(zona)
    if (!estaba && esta) aparecen.push(zona)
  }
  const cruce = antes.panel !== despues.panel
  const morfa = !cruce && despues.panel === 'terminal' && antes.vista.rielSshOculto !== despues.vista.rielSshOculto
  return { tipo: aparecen.length > 0 ? 'apertura' : 'cierre', seVan, aparecen, cruce, morfa }
}

/**
 * Decide si la vista de la franja desacoplada es compacta y qué muestran sus rieles y paneles.
 */
export function vistaDeFranjaDesacoplada(e: EntradaVistaFranja): VistaFranjaDesacoplada {
  const impuestaPorAncho = compactaPorAncho(e.anchoVentana)
  const compacta = e.compactaPedida || impuestaPorAncho
  const agenteVisible = agenteVisibleEnFranja(e.hayAgente, e.compactaPedida, e.anchoVentana)
  const agenteMaximizado = agenteVisible && e.panel === 'terminal' && e.hayTerminales && e.agenteMaximizadoPedido
  const terminalPlegada = agenteVisible && e.panel === 'terminal' && (!e.hayTerminales || agenteMaximizado)
  return {
    compacta,
    compactaPedida: e.compactaPedida,
    impuestaPorAncho,
    rielVisible: !compacta,
    rielSshOculto: compacta,
    agenteVisible,
    botonAgenteActivo: e.agentePedido,
    botonAgenteVisible: !compacta,
    terminalPlegada,
    agenteMaximizado
  }
}
