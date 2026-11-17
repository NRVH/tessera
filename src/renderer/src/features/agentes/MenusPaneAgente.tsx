// =============================================================================
// Menús y diálogos del pane del agente, en el orden en que se pintan: menú contextual
// de la terminal, destinos de la casilla, cuenta (y con ella el modo), iniciar sesión,
// confirmación, historial de conversaciones y actualizar agentes.
// =============================================================================

import { IconoAbrir } from '../../comun/iconosMenu'
import { MenuContextual, SEP, type EntradaMenuContextual } from '../../comun/MenuContextual'
import { PuntoMosaico } from '../mosaico'
import { ModalConversaciones } from './ModalConversaciones'
import { CUENTA_HOST_ID, nombreAgente, type InfoMosaicoPane } from './tiposPaneAgente'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import { MenuContextualAgente } from './iconosPaneAgente'
import { copiarSeleccionDelAgente, pegarDesdePortapapeles } from './terminalAgente'
import { NuevaCuenta, ConfirmarCuenta, type OtroAgenteCuenta } from './DialogosCuenta'
import { AGENTES_DELEGABLES, type AgenteDelegable } from '../../../../shared/delegacion-ipc'
import { PopoverCuenta } from './PopoverCuenta'
import { txPane } from './textosPane.ts'
import type { ModeloPaneAgente } from './usePaneAgente'

type PropsParte = { m: ModeloPaneAgente }

/**
 * Los proyectos abiertos DE SU PERFIL y, al final, abrir otro. Lo que ya tiene terminal
 * se ve pero no se elige (un proyecto no puede estar en dos casillas); el check dice
 * «es lo que ves aquí».
 */
function elementosDestinos(mosaico: InfoMosaicoPane): EntradaMenuContextual[] {
  const t = txPane().menus
  const elementos: EntradaMenuContextual[] = mosaico.destinos.map((d) => {
    const aqui = d.claveProyecto === mosaico.claveProyecto
    return {
      icon: <PuntoMosaico color={d.color} enMarcha={d.enMarcha} trabajando={d.trabajando} sinVer={d.sinVer} esperando={d.esperando} />,
      label: `${d.proyecto}${aqui ? '' : d.esCasilla ? t.terminalAbierta : d.dormido ? t.dormido : ''}`,
      checked: aqui,
      disabled: d.esCasilla,
      onClick: () => mosaico.onElegirDestino(d.key)
    }
  })
  elementos.push(SEP)
  elementos.push({
    icon: <IconoAbrir />,
    label: t.abrirOtro(mosaico.perfil),
    onClick: mosaico.onAbrirProyecto
  })
  return elementos
}

/** Menú contextual de la terminal y el de destinos de la cabecera de casilla. */
function MenusTerminalYCasilla({ m }: PropsParte): React.JSX.Element {
  const { ui, menus, r, uiTerm } = m
  const { mosaico } = m.p
  const cerrarYEnfocar = (): void => { ui.setCtxMenu(null); r.term.current?.focus() }
  return (
    <>
      {ui.ctxMenu && (
        <MenuContextualAgente
          x={ui.ctxMenu.x}
          y={ui.ctxMenu.y}
          puedeCopiar={ui.ctxMenu.haySeleccion}
          onCopiar={() => { copiarSeleccionDelAgente(r); cerrarYEnfocar() }}
          onPegar={() => { pegarDesdePortapapeles(r, uiTerm); cerrarYEnfocar() }}
          onCerrar={() => ui.setCtxMenu(null)}
        />
      )}
      {menus.menuDestinos && mosaico && (
        <MenuContextual x={menus.menuDestinos.x} y={menus.menuDestinos.y} items={elementosDestinos(mosaico)} onCerrar={() => menus.setMenuDestinos(null)} />
      )}
    </>
  )
}

/** En la cabecera de Claude Code o Codex, el alta deja elegir el agente de la cuenta; en un manual, no. */
function otroAgenteDe(m: PropsParte['m']): OtroAgenteCuenta | undefined {
  const agente = m.p.target.agente
  if (!(AGENTES_DELEGABLES as readonly string[]).includes(agente)) return undefined
  return { perfilId: m.p.target.profileId, rutaHostProyecto: m.p.target.projectHostPath, agente: agente as AgenteDelegable }
}

/** Menú de la cuenta, alta de la cuenta y su confirmación. */
function DialogosCuenta({ m }: PropsParte): React.JSX.Element {
  const { ui, cuentaActual } = m
  // Corriendo nativo no hay cuenta de Docker en uso, pero el menú sigue sirviendo para pasar a una.
  const hayMenu = cuentaActual !== null || m.p.onElegirModo !== undefined
  return (
    <>
      {ui.menuCuenta && hayMenu && <PopoverCuenta m={m} ancla={ui.menuCuenta} onCerrar={() => ui.setMenuCuenta(null)} />}
      {ui.anadiendoCuenta && (
        <NuevaCuenta
          cuenta={m.cuenta}
          primera={(m.s.cuentasCargadas ?? []).length === 0}
          nombre={nombreAgente(m.p.pestanasAgente, m.p.target.agente)}
          agente={m.p.target.agente}
          onCerrar={() => ui.setAnadiendoCuenta(false)}
          otro={otroAgenteDe(m)}
        />
      )}
      {ui.confirmacion && <ConfirmarCuenta cuenta={m.cuenta} confirmar={ui.confirmacion} onCerrar={() => ui.setConfirmacion(null)} />}
    </>
  )
}

/** Menús y diálogos del pane (fragmento: no añade nodos al DOM). */
export function MenusPaneAgente({ m }: PropsParte): React.JSX.Element {
  const { ui, p } = m
  const { profileId: perfilId, agente, projectHostPath: rutaHostProyecto } = p.target
  return (
    <>
      <MenusTerminalYCasilla m={m} />
      <DialogosCuenta m={m} />
      {ui.verHistorial && !esAgenteManual(agente) && (
        <ModalConversaciones
          perfilId={perfilId}
          agente={agente}
          // En nativo no hay cuenta: la sintética satisface el contrato y el main la ignora.
          cuentaId={p.modoNativo ? CUENTA_HOST_ID : p.cuentaSeleccionadaId}
          rutaHostProyecto={rutaHostProyecto}
          lugar={p.lugar}
          modo={p.modoNativo ? 'host' : 'container'}
          colorAcento={p.colorAcento}
          onReanudar={(sesionId) => m.sesion.reanudar(sesionId)}
          onCerrar={() => ui.setVerHistorial(false)}
        />
      )}
    </>
  )
}
