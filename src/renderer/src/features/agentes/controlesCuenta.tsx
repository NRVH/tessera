// =============================================================================
// Menú de acciones y edición del nombre de las cuentas Docker.
// Compartidos entre el selector de la cabecera y la lista de Configuración.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { useRef, useState } from 'react'
import { IconoAjustes, IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { MAX_NOMBRE_CUENTA, type AgentAccount } from '../../../../shared/agent-accounts-ipc'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoContenedor, IconoGlobal, IconoMasAcciones, IconoSalir } from './iconosAgentPane'
import type { FilaCuenta } from './selectorCuenta'
import type { AccionesCuenta } from './useCuentasAgente'
import { txPane } from './textosPane'
import { abrirContexto } from './contexto/storeContextoAbierto'
import { PERFIL_VENTANA_AGENTE } from '../../../../shared/ventana-agente-ipc'

export type ConfirmacionCuenta = { kind: 'logout' | 'delete'; account: AgentAccount }
export interface ModeloControlesCuenta {
  profileId: string
  cuenta: Pick<AccionesCuenta, 'handleRenameAccount'>
  ui: { setConfirm: (valor: ConfirmacionCuenta | null) => void }
}

/**
 * El menú de una cuenta, tras su botón «⋯» (que aparece al pasar por la tarjeta o al llegar con el teclado):
 * agrupado por consecuencia, con eliminar al final y aislado. Ningún clic de la tarjeta cae en una acción: hace
 * falta abrir el menú.
 */
export function MenuCuenta({ nombre, entradas }: { nombre: string; entradas: ContextMenuEntry[] }): React.JSX.Element | null {
  const boton = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  if (!entradas.some((e) => e !== SEP)) return null
  const abrir = (): void => {
    const r = boton.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.bottom + 4 })
  }
  return (
    <>
      <span className={`cuenta-tarjeta-acciones${pos ? ' abierto' : ''}`}>
        <button
          ref={boton}
          type="button"
          className="cuenta-accion"
          title={txPane().menus.masAccionesDe(nombre)}
          aria-label={txPane().menus.masAccionesDe(nombre)}
          aria-haspopup="menu"
          aria-expanded={pos !== null}
          // El menú se cierra con el mousedown de fuera: con él abierto, sin esto el clic lo reabriría.
          onMouseDown={(e) => {
            if (pos) e.stopPropagation()
          }}
          onClick={() => (pos ? setPos(null) : abrir())}
        >
          <IconoMasAcciones />
        </button>
      </span>
      {pos && <ContextMenu x={pos.x} y={pos.y} items={entradas} onClose={() => setPos(null)} disparador={boton} />}
    </>
  )
}

/** Las entradas del menú de una cuenta de Docker: renombrar y cerrar sesión; eliminar. */
export function entradasCuenta(f: FilaCuenta, m: ModeloControlesCuenta, onRenombrar: () => void, onCerrarSelector: () => void): ContextMenuEntry[] {
  const t = txPane().menus
  // El selector no se cierra: el diálogo de confirmación va encima y, al terminar, se sigue aquí.
  const confirmar = (kind: 'logout' | 'delete'): void => m.ui.setConfirm({ kind, account: f.cuenta })
  const cambiar: ContextMenuEntry[] = []
  const { agente } = f.cuenta
  // El diálogo del contexto solo existe en la ventana principal: en la de agente la entrada no haría nada.
  const enVentanaPrincipal = m.profileId !== PERFIL_VENTANA_AGENTE
  if ((agente === 'claude-code' || agente === 'codex') && enVentanaPrincipal) {
    cambiar.push({
      label: t.configuracionItem,
      icon: <IconoAjustes />,
      onClick: () => {
        // Este diálogo ocupa la pantalla y, a diferencia de una confirmación, se puede tener abierto un buen rato.
        onCerrarSelector()
        // El perfil desde el que se administra: una global no es de ninguno.
        abrirContexto({ nivel: { tipo: 'cuenta', profileId: m.profileId, agente, accountId: f.cuenta.id } })
      }
    })
  }
  if (f.puedeRenombrar) cambiar.push({ label: t.renombrarItem, icon: <IconoRenombrar />, onClick: onRenombrar })
  if (f.puedeCerrarSesion) cambiar.push({ label: t.cerrarSesionItem, icon: <IconoSalir />, onClick: () => confirmar('logout') })
  return [
    ...cambiar,
    ...(f.puedeEliminar ? [SEP, { label: t.eliminarItem, icon: <IconoEliminar />, danger: true, onClick: () => confirmar('delete') }] : [])
  ]
}

/**
 * La tarjeta de una cuenta mientras se renombra: el nombre es un campo. Enter o salir del campo guardan,
 * Escape deja el que tenía; si el main lo rechaza (vacío, repetido), sigue editándose con el motivo.
 */
export function EditorNombre({ f, m, onTerminar }: { f: FilaCuenta; m: ModeloControlesCuenta; onTerminar: () => void }): React.JSX.Element {
  const t = txPane().menus
  const [valor, setValor] = useState(f.cuenta.nombre)
  const [error, setError] = useState<string | null>(null)
  const guardando = useRef(false)
  // Escape desmonta el campo con el foco dentro y el navegador aún puede mandar su blur: no debe guardar.
  const cancelado = useRef(false)
  const guardar = (): void => {
    if (guardando.current || cancelado.current) return
    if (valor.trim() === f.cuenta.nombre) return onTerminar()
    guardando.current = true
    m.cuenta.handleRenameAccount(f.cuenta.id, valor).then(onTerminar, (err: unknown) => {
      guardando.current = false
      setError(normalizarErrorIpc(err instanceof Error ? err.message : String(err)))
    })
  }
  return (
    <div className={`cuenta-tarjeta-caja${f.actual ? ' actual' : ''}`}>
      <div className={`cuenta-tarjeta editando${f.actual ? ' actual' : ''}`}>
        <span className="cuenta-tarjeta-icono">
          {f.cuenta.global ? <IconoGlobal /> : <IconoContenedor />}
        </span>
        <span className="cuenta-tarjeta-texto">
          <input
            className="cuenta-tarjeta-campo"
            aria-label={t.nombreCuenta}
            aria-invalid={error !== null}
            value={valor}
            maxLength={MAX_NOMBRE_CUENTA}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setValor(e.target.value)
              setError(null)
            }}
            onBlur={guardar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                guardar()
              } else if (e.key === 'Escape') {
                // Solo sale de la edición: el selector sigue abierto.
                e.preventDefault()
                e.stopPropagation()
                cancelado.current = true
                onTerminar()
              }
            }}
          />
          {error ? (
            <span className="cuenta-tarjeta-error" role="alert">
              {error}
            </span>
          ) : (
            <span className="cuenta-tarjeta-detalle">{f.cuenta.global ? t.globalDetalle : t.dockerDetalle}</span>
          )}
        </span>
      </div>
    </div>
  )
}
