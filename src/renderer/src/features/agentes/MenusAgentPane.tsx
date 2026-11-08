// =============================================================================
// Menús y diálogos del pane del agente, en el orden en que se pintan: menú contextual
// de la terminal, destinos de la casilla, cuenta (y con ella el modo), iniciar sesión,
// confirmación, historial de conversaciones y actualizar agentes.
// =============================================================================

import { IconoAbrir } from '../../comun/iconosMenu'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { PuntoMosaico } from '../mosaico'
import { AgentsUpdateModal } from './AgentsUpdateModal'
import { ConversationsModal } from './ConversationsModal'
import { HOST_ACCOUNT_ID, nombreAgente, type MosaicoPane } from './agentPaneTipos'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import { AgentContextMenu } from './iconosAgentPane'
import { copySelection, pasteFromClipboard } from './terminalAgente'
import { NuevaCuenta, ConfirmarCuenta, type OtroAgenteCuenta } from './DialogosCuenta'
import { AGENTES_DELEGABLES, type AgenteDelegable } from '../../../../shared/delegacion-ipc'
import { PopoverCuenta } from './PopoverCuenta'
import { txPane } from './textosPane.ts'
import type { ModeloAgentPane } from './useAgentPane'

type PropsParte = { m: ModeloAgentPane }

/**
 * Los proyectos abiertos DE SU PERFIL y, al final, abrir otro. Lo que ya tiene terminal
 * se ve pero no se elige (un proyecto no puede estar en dos casillas); el check dice
 * «es lo que ves aquí».
 */
function itemsDestinos(mosaico: MosaicoPane): ContextMenuEntry[] {
  const t = txPane().menus
  const items: ContextMenuEntry[] = mosaico.destinos.map((d) => {
    const aqui = d.proyectoKey === mosaico.proyectoKey
    return {
      icon: <PuntoMosaico color={d.color} enMarcha={d.enMarcha} trabajando={d.trabajando} sinVer={d.sinVer} esperando={d.esperando} />,
      label: `${d.proyecto}${aqui ? '' : d.esCasilla ? t.terminalAbierta : d.dormido ? t.dormido : ''}`,
      checked: aqui,
      disabled: d.esCasilla,
      onClick: () => mosaico.onElegirDestino(d.key)
    }
  })
  items.push(SEP)
  items.push({
    icon: <IconoAbrir />,
    label: t.abrirOtro(mosaico.perfil),
    onClick: mosaico.onAbrirProyecto
  })
  return items
}

/** Menú contextual de la terminal y el de destinos de la cabecera de casilla. */
function MenusTerminalYCasilla({ m }: PropsParte): React.JSX.Element {
  const { ui, menus, r, uiTerm } = m
  const { mosaico } = m.p
  const cerrarYEnfocar = (): void => { ui.setCtxMenu(null); r.term.current?.focus() }
  return (
    <>
      {ui.ctxMenu && (
        <AgentContextMenu
          x={ui.ctxMenu.x}
          y={ui.ctxMenu.y}
          canCopy={ui.ctxMenu.hasSelection}
          onCopy={() => { copySelection(r); cerrarYEnfocar() }}
          onPaste={() => { pasteFromClipboard(r, uiTerm); cerrarYEnfocar() }}
          onClose={() => ui.setCtxMenu(null)}
        />
      )}
      {menus.menuDestinos && mosaico && (
        <ContextMenu x={menus.menuDestinos.x} y={menus.menuDestinos.y} items={itemsDestinos(mosaico)} onClose={() => menus.setMenuDestinos(null)} />
      )}
    </>
  )
}

/** En la cabecera de Claude Code o Codex, el alta deja elegir el agente de la cuenta; en un manual, no. */
function otroAgenteDe(m: PropsParte['m']): OtroAgenteCuenta | undefined {
  const agente = m.p.target.agente
  if (!(AGENTES_DELEGABLES as readonly string[]).includes(agente)) return undefined
  return { profileId: m.p.target.profileId, projectHostPath: m.p.target.projectHostPath, agente: agente as AgenteDelegable }
}

/** Menú de la cuenta, alta de la cuenta y su confirmación. */
function DialogosCuenta({ m }: PropsParte): React.JSX.Element {
  const { ui, currentAccount } = m
  // Corriendo nativo no hay cuenta de Docker en uso, pero el menú sigue sirviendo para pasar a una.
  const hayMenu = currentAccount !== null || m.p.onElegirModo !== undefined
  return (
    <>
      {ui.accountMenu && hayMenu && <PopoverCuenta m={m} ancla={ui.accountMenu} onCerrar={() => ui.setAccountMenu(null)} />}
      {ui.addingAccount && (
        <NuevaCuenta
          cuenta={m.cuenta}
          primera={(m.s.accounts ?? []).length === 0}
          nombre={nombreAgente(m.p.pestanasAgente, m.p.target.agente)}
          onCerrar={() => ui.setAddingAccount(false)}
          otro={otroAgenteDe(m)}
        />
      )}
      {ui.confirm && <ConfirmarCuenta cuenta={m.cuenta} confirm={ui.confirm} onCerrar={() => ui.setConfirm(null)} />}
    </>
  )
}

/** Menús y diálogos del pane (fragmento: no añade nodos al DOM). */
export function MenusAgentPane({ m }: PropsParte): React.JSX.Element {
  const { ui, p } = m
  const { profileId, agente, projectHostPath } = p.target
  return (
    <>
      <MenusTerminalYCasilla m={m} />
      <DialogosCuenta m={m} />
      {ui.showHistory && !esAgenteManual(agente) && (
        <ConversationsModal
          profileId={profileId}
          agente={agente}
          // En nativo no hay cuenta: la sintética satisface el contrato y el main la ignora.
          accountId={p.hostMode ? HOST_ACCOUNT_ID : p.selectedAccountId}
          projectHostPath={projectHostPath}
          lugar={p.lugar}
          mode={p.hostMode ? 'host' : 'container'}
          accentColor={p.accentColor}
          onResume={(sessionId) => m.sesion.resume(sessionId)}
          onClose={() => ui.setShowHistory(false)}
        />
      )}
      {ui.showAgentsUpdate && <AgentsUpdateModal onClose={() => ui.setShowAgentsUpdate(false)} />}
    </>
  )
}
