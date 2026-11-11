// =============================================================================
// Alta y confirmación de cuentas, compartidas por la cabecera y Configuración.
// Mantiene los avisos de sesiones en otros panes y los errores dentro del diálogo.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import './cuentaAgente.css'
import { useState } from 'react'
import { PromptDialog } from '../../comun/PromptDialog'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { Segmentado } from '../../comun/Segmentado'
import { Cruce } from '../../comun/Presente'
import { esAgenteManual, type IdAgente } from '../../../../shared/agentesManuales'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { nombreVisible } from './selectorCuenta'
import { txPane } from './textosPane'
import type { AccionesCuenta } from './useCuentasAgente'
import type { ConfirmacionCuenta } from './controlesCuenta'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import { AGENTES_DELEGABLES, type AgenteDelegable } from '../../../../shared/delegacion-ipc'
import { AGENT_LABEL } from './agentPaneTipos'
import { crearCuenta } from './accionesCuentas'
import { ModalLoginCuenta } from './ModalLoginCuenta'

/** Confirmación de cerrar sesión o eliminar la cuenta. */
export function ConfirmarCuenta({ cuenta, confirm, onCerrar }: { cuenta: AccionesCuenta; confirm: ConfirmacionCuenta; onCerrar: () => void }): React.JSX.Element {
  const borrar = confirm.kind === 'delete'
  const t = txPane().menus
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Se cuenta al abrir: lo que diga es lo que el usuario confirmó.
  const [otros] = useState(() => cuenta.otrosQueLaUsan(confirm.account.id))
  const nombre = nombreVisible(confirm.account, t.predeterminada)
  const aviso = (confirm.account.global ? `\n\n${t.globalAfectaATodos}` : '') + (otros > 0 ? `\n\n${t.usadaPorOtros(otros)}` : '')
  return (
    <ConfirmDialog
      danger={borrar}
      severidad={borrar ? 'peligro' : 'info'}
      ocupado={ocupado ? (borrar ? t.eliminando : t.cerrandoSesion) : null}
      error={error}
      title={borrar ? t.eliminarCuenta(nombre) : t.cerrarSesionPregunta(nombre)}
      message={(borrar ? t.mensajeEliminar() : t.mensajeCerrarSesion()) + aviso}
      confirmLabel={borrar ? t.eliminar : t.cerrarSesion}
      // Se cierra cuando la acción terminó y la lista ya no la enseña: cerrar las sesiones o parar el
      // contenedor tarda, y un diálogo cerrado antes deja ver como viva la cuenta que se está borrando.
      onConfirm={() => {
        const { kind, account } = confirm
        setOcupado(true)
        setError(null)
        const accion = kind === 'delete' ? cuenta.handleDeleteAccount(account.id) : cuenta.handleLogoutAccount(account.id)
        accion.then(
          () => onCerrar(),
          (err: unknown) => {
            setOcupado(false)
            setError(normalizarErrorIpc(err instanceof Error ? err.message : String(err)))
          }
        )
      }}
      onCancel={() => onCerrar()}
    />
  )
}

/**
 * Desde la cabecera de un agente de serie también se crean cuentas del OTRO: con ese agente oculto, esta es la única
 * cabecera que queda. La de otro agente no cambia la pestaña: se crea y se abre su inicio de sesión sin pestaña.
 */
export interface OtroAgenteCuenta {
  profileId: string
  projectHostPath: string
  agente: AgenteDelegable
}


/** El alta de una cuenta: si el main la rechaza (un nombre repetido), el diálogo sigue abierto y lo dice. */
export function NuevaCuenta({ cuenta, primera, nombre, agente, onCerrar, otro }: { cuenta: AccionesCuenta; primera: boolean; nombre: string; agente: IdAgente; onCerrar: () => void; otro?: OtroAgenteCuenta }): React.JSX.Element {
  const t = txPane().menus
  const [error, setError] = useState<string | null>(null)
  const [elegido, setElegido] = useState<AgenteDelegable | null>(otro?.agente ?? null)
  const [login, setLogin] = useState<AgentAccount | null>(null)
  const [disponibilidad, setDisponibilidad] = useState<'privada' | 'global'>('privada')
  const delOtro = otro !== undefined && elegido !== null && elegido !== otro.agente
  const global = disponibilidad === 'global'
  // De un agente manual no se sabe qué archivos son su credencial: sus cuentas son siempre del perfil.
  const admiteGlobal = !esAgenteManual(elegido ?? agente)
  if (login && otro && elegido) {
    return <ModalLoginCuenta cuenta={login} projectHostPath={otro.projectHostPath} releer={() => window.tessera.agentAccounts.list({ profileId: otro.profileId, agente: elegido })} onCerrar={onCerrar} />
  }
  const fallo = (err: unknown): void => setError(normalizarErrorIpc(err instanceof Error ? err.message : String(err)))
  return (
    <PromptDialog
      // Con la elección del agente, el título no lo repite: lo dice el conmutador, y cambiaría con él.
      title={otro && elegido ? t.nuevaCuentaDockerTitulo : primera ? t.iniciarSesionTitulo(nombre) : t.nuevaCuentaTitulo(nombre)}
      label={t.nombreCuenta}
      confirmLabel={t.crearEIniciar}
      hint={delOtro ? t.nuevaCuentaOtroAviso(AGENT_LABEL[elegido]) : admiteGlobal ? undefined : t.nuevaCuentaAviso}
      error={error}
      onConfirm={(nm) => {
        setError(null)
        if (delOtro && otro) void crearCuenta(otro.profileId, elegido, nm, admiteGlobal && global).then(setLogin, fallo)
        else void cuenta.handleCreateAccount(nm, admiteGlobal && global).catch(fallo)
      }}
      onCancel={() => onCerrar()}
      despues={admiteGlobal && (
        <div className="cuenta-disponibilidad">
          <span className="modal-label">{t.disponibilidad}</span>
          <Segmentado etiqueta={t.disponibilidad} opciones={[{ valor: 'privada' as const, etiqueta: t.privada }, { valor: 'global' as const, etiqueta: t.global }]} valor={disponibilidad} onCambio={setDisponibilidad} />
          <Cruce clave={disponibilidad} className="cuenta-disponibilidad-aviso">
            <div className="modal-hint">{global ? t.globalAviso : t.privadaAviso}</div>
          </Cruce>
          <div className="modal-hint">{t.disponibilidadFija}</div>
        </div>
      )}
    >
      {otro && elegido && (
        <div className="cuenta-agente-eleccion">
          <span className="modal-label">{t.agenteDeLaCuenta}</span>
          <Segmentado etiqueta={t.agenteDeLaCuenta} opciones={AGENTES_DELEGABLES.map((a) => ({ valor: a, etiqueta: AGENT_LABEL[a] }))} valor={elegido} onCambio={setElegido} />
        </div>
      )}
    </PromptDialog>
  )
}
