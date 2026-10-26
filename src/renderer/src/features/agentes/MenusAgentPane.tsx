// =============================================================================
// Menús y diálogos del pane del agente, en el orden en que se pintan: menú contextual
// de la terminal, destinos de la casilla, cuenta (y con ella el modo), iniciar sesión,
// confirmación, historial de conversaciones y actualizar agentes.
// =============================================================================

import { useState } from 'react'
import { IconoAbrir } from '../../comun/iconosMenu'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { PromptDialog } from '../../comun/PromptDialog'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { PuntoMosaico } from '../mosaico'
import { AgentsUpdateModal } from './AgentsUpdateModal'
import { ConversationsModal } from './ConversationsModal'
import { HOST_ACCOUNT_ID, nombreAgente, type MosaicoPane } from './agentPaneTipos'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { AgentContextMenu } from './iconosAgentPane'
import { copySelection, pasteFromClipboard } from './terminalAgente'
import { nombreVisible } from './selectorCuenta.ts'
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

/** Confirmación de cerrar sesión o eliminar la cuenta. */
function ConfirmarCuenta({ m, confirm }: PropsParte & { confirm: NonNullable<ModeloAgentPane['ui']['confirm']> }): React.JSX.Element {
  const borrar = confirm.kind === 'delete'
  const t = txPane().menus
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Se cuenta al abrir: lo que diga es lo que el usuario confirmó.
  const [otros] = useState(() => m.cuenta.otrosQueLaUsan(confirm.account.id))
  const aviso = otros > 0 ? `\n\n${t.usadaPorOtros(otros)}` : ''
  return (
    <ConfirmDialog
      danger={borrar}
      ocupado={ocupado ? (borrar ? t.eliminando : t.cerrandoSesion) : null}
      error={error}
      title={borrar ? t.eliminarCuenta : t.cerrarSesion}
      message={
        borrar
          ? t.mensajeEliminar(nombreVisible(confirm.account, t.predeterminada)) + aviso
          : t.mensajeCerrarSesion(nombreVisible(confirm.account, t.predeterminada)) + aviso
      }
      confirmLabel={borrar ? t.eliminar : t.cerrarSesion}
      // Se cierra cuando la acción terminó y la lista ya no la enseña: cerrar las sesiones o parar el
      // contenedor tarda, y un diálogo cerrado antes deja ver como viva la cuenta que se está borrando.
      onConfirm={() => {
        const { kind, account } = confirm
        setOcupado(true)
        setError(null)
        const accion = kind === 'delete' ? m.cuenta.handleDeleteAccount(account.id) : m.cuenta.handleLogoutAccount(account.id)
        accion.then(
          () => m.ui.setConfirm(null),
          (err: unknown) => {
            setOcupado(false)
            setError(normalizarErrorIpc(err instanceof Error ? err.message : String(err)))
          }
        )
      }}
      onCancel={() => m.ui.setConfirm(null)}
    />
  )
}

/** El alta de una cuenta: si el main la rechaza (un nombre repetido), el diálogo sigue abierto y lo dice. */
function NuevaCuenta({ m }: PropsParte): React.JSX.Element {
  const t = txPane().menus
  const [error, setError] = useState<string | null>(null)
  const primera = (m.s.accounts ?? []).length === 0
  return (
    <PromptDialog
      title={primera ? t.iniciarSesionTitulo(nombreAgente(m.p.pestanasAgente, m.p.target.agente)) : t.nuevaCuentaTitulo(nombreAgente(m.p.pestanasAgente, m.p.target.agente))}
      label={t.nombreCuenta}
      confirmLabel={t.crearEIniciar}
      hint={primera ? undefined : t.nuevaCuentaAviso}
      error={error}
      onConfirm={(nm) => {
        setError(null)
        void m.cuenta.handleCreateAccount(nm).catch((err: unknown) => setError(normalizarErrorIpc(err instanceof Error ? err.message : String(err))))
      }}
      onCancel={() => m.ui.setAddingAccount(false)}
    />
  )
}

/** Menú de la cuenta, alta de la cuenta y su confirmación. */
function DialogosCuenta({ m }: PropsParte): React.JSX.Element {
  const { ui, currentAccount } = m
  // Corriendo nativo no hay cuenta de Docker en uso, pero el menú sigue sirviendo para pasar a una.
  const hayMenu = currentAccount !== null || m.p.onElegirModo !== undefined
  return (
    <>
      {ui.accountMenu && hayMenu && <PopoverCuenta m={m} ancla={ui.accountMenu} onCerrar={() => ui.setAccountMenu(null)} />}
      {ui.addingAccount && <NuevaCuenta m={m} />}
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
