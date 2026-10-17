// =============================================================================
// Una pestaña SSH de la tira de terminales: el nombre (el alias de su conexión, o el que se le puso
// a mano), con el icono de servidor delante, un solo indicador (el ● de «desconectada») y su ✕; con
// clic derecho, su menú (reconectar, renombrar, cerrar).
// Reutiliza las clases base de las pestañas (`.terminal-tab*`, que comparten las de resultados de
// BD) con el modificador `.ssh`. Presentación pura: cambiar, cerrar y renombrar son del panel.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import './sshTerminal.css'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { conexionPorId, destinoSsh, IconoServidor, useStoreSsh } from '../ssh'
import { IconoSftp } from '../sftp'
import type { SshConexion } from '../../../../shared/ssh-ipc'
import { motivoConexionEliminada } from './activoTerminales'
import { CloseIcon } from './IconosTerminales'
import { CampoRenombrar, claveRenombradoSsh, teclaDePestana, type Renombrando } from './renombradoPestana'
import { esPestanaSftp, nombreSsh, type SshTab } from './sshTabsModel'
import { txTerminales } from './textos.ts'
import type { TerminalPaneInfo } from './terminalPaneTipos'

export interface PestanaSshProps {
  tab: SshTab
  perfilId: string
  activa: boolean
  info: TerminalPaneInfo | undefined
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, nombre: string) => void
  /** Reconecta la pestaña (la elige primero, para que se vea qué se reconecta). */
  onReconectar: (id: string) => void
}

/** Cómo está la sesión, para el tooltip. */
function estadoDe(info: TerminalPaneInfo | undefined): string {
  const t = txTerminales()
  if (info?.status === 'exited') return t.desconectada
  if (info?.status === 'error') return t.noSePudoAbrir
  return info?.status === 'live' ? t.conectada : t.conectando
}

/** El tooltip: el nombre, adónde conecta, cómo está y qué se puede hacer con la pestaña. */
function tituloDe(nombre: string, conexion: SshConexion | undefined, info: TerminalPaneInfo | undefined, sftp: boolean): string {
  const t = txTerminales()
  const destino = conexion ? destinoSsh(conexion) : t.conexionEliminadaDestino
  const atajoCerrar = t.teclaCerrar(window.tessera.plataforma === 'mac')
  // El explorador no lleva pty: su estado (conectando, error) lo cuenta él dentro de su pane.
  const estado = sftp ? t.archivosRemotos : estadoDe(info)
  const reconectar = sftp ? '' : t.clicDerechoReconectar
  return `${nombre}\n${destino}\n${estado}\n${t.dobleClicRenombrar(atajoCerrar)}${reconectar}`
}

/** ¿Ya no hay sesión viva (terminó o no abrió)? */
function terminoSesion(info: TerminalPaneInfo | undefined): boolean {
  return info?.status === 'exited' || info?.status === 'error'
}

/** Lo que lee un lector de pantalla: el nombre, de qué clase es y, si aplica, que está desconectada. */
function etiquetaDe(nombre: string, sftp: boolean, dead: boolean): string {
  const t = txTerminales()
  return `${nombre}, ${sftp ? t.etiquetaSftp : 'SSH'}${dead ? t.etiquetaDesconectada : ''}`
}

/** La ✕ de la pestaña: cierra la sesión SSH. */
function BotonCerrar({ nombre, onCerrar }: { nombre: string; onCerrar: () => void }): React.JSX.Element {
  return (
    // La ✕ NO se esconde en reposo: pertenece a la pestaña, no al panel.
    <button
      className="terminal-tab-kill"
      onClick={(e) => {
        e.stopPropagation() // no seleccionar la que estás cerrando
        onCerrar()
      }}
      tabIndex={-1}
      title={txTerminales().cerrarPestana}
      aria-label={txTerminales().cerrarNombre(nombre)}
    >
      <CloseIcon />
    </button>
  )
}

/**
 * El menú de la pestaña: reconectar (no en el explorador SFTP, que se reconecta desde dentro), renombrar
 * y cerrar. Cerrar es desconectar: no hay un «Desconectar» aparte.
 */
function itemsMenu(sftp: boolean, conexionExiste: boolean, acciones: { reconectar: () => void; renombrar: () => void; cerrar: () => void }): ContextMenuEntry[] {
  const t = txTerminales()
  const reconectar: ContextMenuEntry[] = sftp
    ? []
    : [{ label: t.reconectar, onClick: acciones.reconectar, disabled: !conexionExiste, ...(conexionExiste ? {} : { title: motivoConexionEliminada() }) }]
  return [...reconectar, { label: t.renombrar, onClick: acciones.renombrar }, SEP, { label: t.cerrar, onClick: acciones.cerrar }]
}

/** Una pestaña SSH. */
export function PestanaSsh(p: PestanaSshProps): React.JSX.Element {
  const { tab, perfilId, info, renombrando, setRenombrando } = p
  const conexion = useStoreSsh((s) => conexionPorId(s, tab.conexionId))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const sftp = esPestanaSftp(tab)
  const dead = !sftp && terminoSesion(info)
  const nombre = nombreSsh(tab)
  const clave = claveRenombradoSsh(perfilId)
  const editando = renombrando?.id === tab.id && renombrando.key === clave
  const abrirRenombrado = (): void => setRenombrando({ key: clave, id: tab.id, texto: nombre })
  const teclas = { seleccionar: () => p.onSelect(tab.id), renombrar: abrirRenombrado, cerrar: () => p.onClose(tab.id) }
  const acciones = { reconectar: () => p.onReconectar(tab.id), renombrar: abrirRenombrado, cerrar: () => p.onClose(tab.id) }
  return (
    <>
    <div
      className={`terminal-tab ssh${p.activa ? ' active' : ''}${editando ? ' editando' : ''}`}
      role="tab"
      aria-selected={p.activa}
      aria-label={editando ? undefined : etiquetaDe(nombre, sftp, dead)}
      tabIndex={editando ? -1 : 0}
      onClick={() => p.onSelect(tab.id)}
      // Doble clic = renombrar; el primer clic ya seleccionó, así renombras la que ves.
      onDoubleClick={abrirRenombrado}
      onContextMenu={(e) => {
        if (editando) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onKeyDown={(e) => teclaDePestana(e, teclas)}
      title={editando ? undefined : tituloDe(nombre, conexion, info, sftp)}
    >
      <span className="terminal-tab-icono" aria-hidden="true">
        {sftp ? <IconoSftp /> : <IconoServidor />}
      </span>
      {editando ? (
        <CampoRenombrar
          texto={renombrando.texto}
          nombre={nombre}
          onTexto={(texto) => setRenombrando({ key: clave, id: tab.id, texto })}
          onConfirmar={() => {
            p.onRename(tab.id, renombrando.texto)
            setRenombrando(null)
          }}
          onCancelar={() => setRenombrando(null)}
        />
      ) : (
        <span className="terminal-tab-name">{nombre}</span>
      )}
      {dead && !editando && (
        <span className="terminal-tab-dead" title={txTerminales().sesionTermino}>
          ●
        </span>
      )}
      <BotonCerrar nombre={nombre} onCerrar={() => p.onClose(tab.id)} />
    </div>
    {/* Hermano de la pestaña y no hijo: un clic en el menú no debe burbujear hasta seleccionarla. */}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsMenu(sftp, conexion !== undefined, acciones)} onClose={() => setMenu(null)} />}
    </>
  )
}
