// =============================================================================
// Menús y diálogos del pane del agente, en el orden en que se pintan: menú contextual
// de la terminal, destinos y modo de la casilla, acciones de la cuenta, iniciar sesión,
// confirmación, historial de conversaciones y actualizar agentes.
// =============================================================================

import { IconoAbrir, IconoCerrar, IconoEliminar } from '../../comun/iconosMenu'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { PromptDialog } from '../../comun/PromptDialog'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { PuntoMosaico } from '../mosaico'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import { AgentsUpdateModal } from './AgentsUpdateModal'
import { ConversationsModal } from './ConversationsModal'
import { AGENT_LABEL, HOST_ACCOUNT_ID, type MosaicoPane } from './agentPaneTipos'
import { AgentContextMenu } from './iconosAgentPane'
import { copySelection, pasteFromClipboard } from './terminalAgente'
import type { ModeloAgentPane } from './useAgentPane'

type PropsParte = { m: ModeloAgentPane }

/**
 * Los proyectos abiertos DE SU PERFIL y, al final, abrir otro. Lo que ya tiene terminal
 * se ve pero no se elige (un proyecto no puede estar en dos casillas); el check dice
 * «es lo que ves aquí».
 */
function itemsDestinos(mosaico: MosaicoPane): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = mosaico.destinos.map((d) => {
    const aqui = d.proyectoKey === mosaico.proyectoKey
    return {
      icon: <PuntoMosaico color={d.color} enMarcha={d.enMarcha} trabajando={d.trabajando} sinVer={d.sinVer} />,
      label: `${d.proyecto}${aqui ? '' : d.esCasilla ? ' (terminal abierta)' : d.dormido ? ' (dormido)' : ''}`,
      checked: aqui,
      disabled: d.esCasilla,
      onClick: () => mosaico.onElegirDestino(d.key)
    }
  })
  items.push(SEP)
  items.push({
    icon: <IconoAbrir />,
    label: `Abrir otro proyecto en ${mosaico.perfil}…`,
    onClick: mosaico.onAbrirProyecto
  })
  return items
}

/** Los dos modos del PROYECTO, con el actual marcado; sin nombrar el sistema. */
function itemsModo(hostMode: boolean, cambiar: () => void): ContextMenuEntry[] {
  return [
    {
      label: 'Modo contenedor (aislado, cuenta del perfil)',
      checked: !hostMode,
      disabled: !hostMode,
      onClick: () => cambiar()
    },
    {
      label: 'Modo nativo (fuera del contenedor, cuenta personal)',
      checked: hostMode,
      disabled: hostMode,
      onClick: () => cambiar()
    }
  ]
}

/** Cerrar sesión (reversible) y, si no es la predeterminada, eliminar (al final y en rojo). */
function itemsCuenta(cuenta: AgentAccount, m: ModeloAgentPane): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [
    {
      icon: <IconoCerrar />,
      label: `Cerrar sesión de "${cuenta.nombre}"…`,
      onClick: () => m.ui.setConfirm({ kind: 'logout', account: cuenta })
    }
  ]
  if (!cuenta.isDefault) {
    items.push(SEP)
    items.push({
      icon: <IconoEliminar />,
      label: `Eliminar "${cuenta.nombre}"…`,
      onClick: () => m.ui.setConfirm({ kind: 'delete', account: cuenta }),
      danger: true
    })
  }
  return items
}

/** Menú contextual de la terminal y los dos menús de la cabecera de casilla. */
function MenusTerminalYCasilla({ m }: PropsParte): React.JSX.Element {
  const { ui, menus, r, uiTerm } = m
  const { mosaico, hostMode } = m.p
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
      {menus.menuModo && mosaico?.onCambiarModo && (
        <ContextMenu x={menus.menuModo.x} y={menus.menuModo.y} items={itemsModo(hostMode, mosaico.onCambiarModo)} onClose={() => menus.setMenuModo(null)} />
      )}
    </>
  )
}

/** Confirmación de cerrar sesión o eliminar la cuenta. */
function ConfirmarCuenta({ m, confirm }: PropsParte & { confirm: NonNullable<ModeloAgentPane['ui']['confirm']> }): React.JSX.Element {
  const borrar = confirm.kind === 'delete'
  return (
    <ConfirmDialog
      danger={borrar}
      title={borrar ? 'Eliminar cuenta' : 'Cerrar sesión'}
      message={
        borrar
          ? `¿Eliminar la cuenta "${confirm.account.nombre}"? Se borrará su credencial de este equipo (no afecta tu cuenta del proveedor).`
          : `¿Cerrar sesión de "${confirm.account.nombre}"? Tendrás que iniciar sesión otra vez para volver a usarla.`
      }
      confirmLabel={borrar ? 'Eliminar' : 'Cerrar sesión'}
      onConfirm={() => {
        const { kind, account } = confirm
        m.ui.setConfirm(null)
        if (kind === 'delete') void m.cuenta.handleDeleteAccount(account.id)
        else void m.cuenta.handleLogoutAccount(account.id)
      }}
      onCancel={() => m.ui.setConfirm(null)}
    />
  )
}

/** Menú de la cuenta, alta de la cuenta y su confirmación. */
function DialogosCuenta({ m }: PropsParte): React.JSX.Element {
  const { ui, currentAccount } = m
  return (
    <>
      {ui.accountMenu && currentAccount && (
        <ContextMenu
          x={ui.accountMenu.x}
          y={ui.accountMenu.y}
          items={itemsCuenta(currentAccount, m)}
          onClose={() => ui.setAccountMenu(null)}
        />
      )}
      {ui.addingAccount && (
        <PromptDialog
          title={`Iniciar sesión — ${AGENT_LABEL[m.p.target.agente]}`}
          label="Nombre de la cuenta"
          confirmLabel="Crear e iniciar sesión"
          onConfirm={(nm) => void m.cuenta.handleCreateAccount(nm)}
          onCancel={() => ui.setAddingAccount(false)}
        />
      )}
      {ui.confirm && <ConfirmarCuenta m={m} confirm={ui.confirm} />}
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
      {ui.showHistory && (
        <ConversationsModal
          profileId={profileId}
          agente={agente}
          // En nativo no hay cuenta: la sintética satisface el contrato y el main la ignora.
          accountId={p.hostMode ? HOST_ACCOUNT_ID : p.selectedAccountId}
          projectHostPath={projectHostPath}
          esEspacioDeDatos={p.esEspacioDeDatos}
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
