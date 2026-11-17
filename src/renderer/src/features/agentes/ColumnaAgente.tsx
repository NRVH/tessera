// =============================================================================
// Columna derecha de la ventana: el divisor que toque (el de siempre contra el editor, el del
// agente de datos en la vista de BD o el del agente de la terminal a pantalla completa) y las
// terminales de agente multiplexadas de todos los perfiles (CCPanel), que nunca se desmontan.
// También decide quién se lleva el teclado cuando la columna cambia de dueño.
// Decisiones: docs/decisiones/agentes/columna-del-agente.md, docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ANCHO_CC_MIN } from '../../../../shared/workspace-state-ipc'
import { Divisor } from '../../comun/Divisor'
import { PanelCc, type InfoMosaicoColumna } from './PanelCc'
import { elegirModoAgente, anotarEstadoDestino, anotarVivoDestino, seleccionarCuenta, seleccionarAgente, useStoreAgentes } from './store'
import { cerrarAgenteTerminal, elegirAgenteTerminal, soltarFocoAgenteTerminal, useStoreAgenteTerminal } from './storeAgenteTerminal'
import type { AgentesApp } from './useAgentesApp'
import type { AgenteTerminalApp } from './useAgenteTerminal'
import type { ColumnaAgenteEstado } from './useColumnaAgente'
import type { SesionesNativas } from './useSesionesNativas'
import { fijadoresLayout, fijarMaximizado, useStoreLayout, type SalidaLayoutCentro, type Tamanos } from '../layout'
import type { UsePestanas } from '../pestanas'
import { useStoreBd, type EspaciosDatos, type MontajesBd } from '../bd'
import { useStoreAjustes } from '../ajustes'
import { ampliarCasilla, enfocarCasilla, fijarDisposicionMosaico, useStoreMosaico, type MosaicoApp } from '../mosaico'
import type { ActividadAgentes } from './useActividadAgentes'
import { txPane } from './textosPane.ts'

interface Props {
  pestanas: UsePestanas
  agentes: AgentesApp
  columna: ColumnaAgenteEstado
  tamanos: Tamanos
  mosaico: MosaicoApp
  actividad: ActividadAgentes
  espacios: EspaciosDatos
  agenteTerminal: AgenteTerminalApp
  montajes: MontajesBd
  sesiones: SesionesNativas
  /** El agente de la terminal maximizado sobre las terminales, ya coherente (de App). */
  maximizarAgenteTerminal: { puedeExpandir: boolean; expandido: boolean }
  /**
   * De quién es la columna en el reparto de destino. `agentes.lay` es el que se pinta, que durante un cambio
   * animado va un render por detrás del agente activo: el foco se decide con este, o el agente que se activa en
   * ese render se lo llevaría sin saber que cambió de dueño.
   */
  agenteDestino: SalidaLayoutCentro['agente']
}

/** Lo que el mosaico pinta en la columna; null fuera del mosaico. */
function usePanelMosaico(p: Pick<Props, 'mosaico' | 'actividad'>): InfoMosaicoColumna | null {
  const m = useStoreMosaico(
    useShallow((s) => ({
      activo: s.mosaicoActivo,
      teselas: s.teselas,
      enfocada: s.enfocada,
      ampliada: s.ampliada,
      preset: s.mosaicoPreset
    }))
  )
  if (!m.activo) return null
  return {
    teselas: m.teselas,
    enMarcha: p.mosaico.candidatosVivos.length,
    enfocada: m.enfocada,
    ampliada: m.ampliada,
    preset: m.preset,
    nombresProyecto: p.mosaico.nombresProyecto,
    trabajando: p.actividad.conjuntoTrabajando,
    sinVer: p.actividad.estadoActividad.sinVer,
    esperando: p.actividad.conjuntoEsperando,
    opciones: p.mosaico.opcionesMosaico,
    onElegirDestino: p.mosaico.elegirDestinoCasilla,
    onAbrirProyecto: p.mosaico.abrirProyectoEnCasilla,
    onEnfocar: enfocarCasilla,
    onAmpliar: ampliarCasilla,
    onIrAlProyecto: p.mosaico.irAlProyectoDesdeMosaico,
    onDisposicion: fijarDisposicionMosaico
  }
}

/** El divisor que toque contra el centro: el del editor, el del agente de datos, el del agente de la terminal, o ninguno. */
function DivisorAgente({
  divisor,
  tamanos
}: {
  divisor: SalidaLayoutCentro['divisorAgente']
  tamanos: Tamanos
}): React.JSX.Element | null {
  const anchoCc = useStoreLayout((s) => s.ccWidth)
  if (divisor === null) return null
  const t = txPane().columna
  const porDivisor = {
    editor: { tamano: anchoCc, max: tamanos.ccMax, onRedimensionar: fijadoresLayout.ccWidth, etiqueta: t.redimensionarCc },
    db: { tamano: tamanos.anchoAgenteDbVisible, max: tamanos.ccMaxDb, onRedimensionar: fijadoresLayout.dbAgenteWidth, etiqueta: t.redimensionarAgente },
    terminal: {
      tamano: tamanos.agenteTerminalAnchoVisible,
      max: tamanos.ccMaxTerminal,
      onRedimensionar: fijadoresLayout.agenteTerminalAncho,
      etiqueta: t.redimensionarTerminal
    }
  }[divisor]
  // `splitter-agente`: el CSS del agente de la terminal lo deja a la vista y aparta a sus hermanos.
  return <Divisor orientacion="vertical" min={ANCHO_CC_MIN} direccion={-1} className="splitter-agente splitter-hueco" {...porDivisor} />
}

/**
 * ¿Cambia en este render la columna hacia o desde el agente de la terminal? Lo compara con el último
 * commit: entrar o salir de pantalla completa (por cualquier vía) cambia de dueño sin que nadie haya
 * pedido el teclado, y en ese commit ningún pane se lo lleva.
 */
function useCambiaAgenteTerminal(agente: SalidaLayoutCentro['agente']): boolean {
  const anterior = useRef(agente)
  const cambia = anterior.current !== agente && (anterior.current === 'terminal' || agente === 'terminal')
  useEffect(() => {
    anterior.current = agente
  })
  return cambia
}

/** Quién se lleva el teclado: la salida del mosaico y los cambios de dueño no; un gesto en el agente de la terminal sí. */
function useFocoDeLaColumna(agente: SalidaLayoutCentro['agente']): { tokenFoco: number; sinRobarFoco: boolean; focoAgenteTerminal: boolean } {
  const { tokenFocoMosaico, salidaSinFoco } = useStoreMosaico(
    useShallow((s) => ({ tokenFocoMosaico: s.tokenFocoMosaico, salidaSinFoco: s.salidaSinFoco }))
  )
  const focoPedido = useStoreAgenteTerminal((s) => s.focoPedido)
  const cambia = useCambiaAgenteTerminal(agente)
  // Vive un commit: los panes (hijos) ya decidieron cuando corre este efecto del padre.
  useEffect(() => {
    if (focoPedido) soltarFocoAgenteTerminal()
  }, [focoPedido])
  return { tokenFoco: tokenFocoMosaico, sinRobarFoco: salidaSinFoco || (cambia && !focoPedido), focoAgenteTerminal: focoPedido }
}

/**
 * Maximizar el agente: sobre los archivos abiertos (el de la columna), el de datos sobre las pestañas de
 * BD o, el de la terminal, sobre las terminales, que solo se ofrece si hay alguna que tapar.
 */
function maximizarDe(
  disposicion: SalidaLayoutCentro,
  columna: Props['columna'],
  terminal: Props['maximizarAgenteTerminal']
): { puedeExpandir: boolean; expandido: boolean; onAlternarExpandir: () => void } {
  if (disposicion.agente === 'espacio') {
    const expandido = disposicion.agenteDbMaximizado
    return { puedeExpandir: disposicion.cc.puedeExpandir, expandido, onAlternarExpandir: () => fijarMaximizado('agenteDb', !expandido) }
  }
  if (disposicion.agente !== 'terminal') {
    return { puedeExpandir: disposicion.cc.puedeExpandir, expandido: columna.ccExpandido, onAlternarExpandir: columna.alternarCcMaximizado }
  }
  return { ...terminal, onAlternarExpandir: () => fijarMaximizado('agenteTerminal', !terminal.expandido) }
}

export function ColumnaAgente(props: Props): React.JSX.Element {
  const { pestanas, agentes, columna, tamanos, espacios, agenteTerminal, montajes, sesiones } = props
  const disposicion = agentes.disposicion
  const cuentaPorDestino = useStoreAgentes((s) => s.cuentaPorDestino)
  const modoPorDestino = useStoreAgentes((s) => s.modoPorDestino)
  const foco = useFocoDeLaColumna(props.agenteDestino)
  const montajesDb = useStoreBd((s) => s.montajesPorProyecto)
  const ajustesCargados = useStoreAjustes((s) => s.ajustesCargados)
  const mosaicoPanel = usePanelMosaico(props)
  const maximizar = maximizarDe(disposicion, columna, props.maximizarAgenteTerminal)
  return (
    <>
      <DivisorAgente divisor={disposicion.divisorAgente} tamanos={tamanos} />
      <PanelCc
        crece={disposicion.cc.crece}
        destinos={agentes.destinosAgente}
        claveDestinoActivo={agentes.claveDestinoActivoEfectivo}
        clavesDestinoHibernados={agentes.clavesDestinoHibernados}
        perfiles={pestanas.perfiles}
        {...maximizar}
        oculta={disposicion.cc.oculta}
        onEstadoDestino={anotarEstadoDestino}
        onVivoDestino={anotarVivoDestino}
        mosaico={mosaicoPanel}
        {...foco}
        onSeleccionarAgente={seleccionarAgente}
        cuentaPorDestino={cuentaPorDestino}
        onSeleccionarCuenta={seleccionarCuenta}
        modoPorDestino={modoPorDestino}
        onElegirModoAgente={elegirModoAgente}
        montajesDbPorProyecto={montajesDb}
        onCambioBasesMontadas={montajes.fijarMontadasDeProyecto}
        basesListas={ajustesCargados}
        rutasEspacioDatos={espacios.rutasEspacioDatos}
        rutasAgenteTerminal={agenteTerminal.conjuntoRutas}
        onSeleccionarAgenteTerminal={elegirAgenteTerminal}
        onCerrarAgenteTerminal={cerrarAgenteTerminal}
        onApiAgente={sesiones.actualizacionNativa.registrarApi}
        estadoAgentesNativos={sesiones.actualizacionNativa.estado}
        enEspera={
          disposicion.agente === 'proyecto' && columna.textosDiferido
            ? { ...columna.textosDiferido, onIniciar: columna.iniciarAgenteDiferido }
            : null
        }
      />
    </>
  )
}
