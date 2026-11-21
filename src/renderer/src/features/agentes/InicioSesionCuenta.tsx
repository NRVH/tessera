// =============================================================================
// Inicio de sesión compartido por Configuración y los paneles de uso.
// El diálogo vive en la ventana para que pueda cerrarse el panel que lo abrió.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import './cuentasConfiguracion.css'
import { create } from 'zustand'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import type { DefinicionAgente } from '../../../../shared/agentesManuales'
import { AnfitrionDialogoGlobal } from '../../comun/Modal'
import { documentoEnfocado } from '../../util/ventanaDe'
import { seleccionarRutaActiva, useStorePestanas } from '../pestanas'
import { ModalLoginCuenta } from './ModalLoginCuenta'

interface OpcionesInicioSesion {
  manual?: DefinicionAgente
  releer?: () => Promise<CuentaAgente[]>
  documento?: Document
}

type Solicitud = Omit<React.ComponentProps<typeof ModalLoginCuenta>, 'onCerrar'> & { documento: Document }
const useSolicitud = create<{ solicitud: Solicitud | null; cierresPorPerfil: Record<string, number> }>(() => ({ solicitud: null, cierresPorPerfil: {} }))

export function useCierresInicioSesion(perfilId: string | null): number {
  return useSolicitud((s) => perfilId ? (s.cierresPorPerfil[perfilId] ?? 0) : 0)
}

export function useInicioSesionCuenta(perfilId: string) {
  const proyecto = useStorePestanas((s) => seleccionarRutaActiva(s.pestanas, perfilId) ?? undefined)
  const iniciar = (cuenta: CuentaAgente, opciones: OpcionesInicioSesion = {}): void => {
    useSolicitud.setState({ solicitud: {
      cuenta: cuenta.global ? { ...cuenta, profileId: perfilId } : cuenta,
      rutaHostProyecto: proyecto,
      manual: opciones.manual,
      documento: opciones.documento ?? documentoEnfocado(),
      releer: opciones.releer ?? (() => window.tessera.cuentasAgente.listar({ profileId: perfilId, agente: cuenta.agente }))
    } })
  }
  return { proyecto, iniciar }
}

function cerrar(): void {
  useSolicitud.setState((s) => {
    if (!s.solicitud) return s
    const perfilId = s.solicitud.cuenta.profileId
    return { solicitud: null, cierresPorPerfil: { ...s.cierresPorPerfil, [perfilId]: (s.cierresPorPerfil[perfilId] ?? 0) + 1 } }
  })
}

export function AnfitrionInicioSesionCuenta(): React.JSX.Element | null {
  const solicitud = useSolicitud((s) => s.solicitud)
  if (!solicitud) return null
  const { documento, ...acceso } = solicitud
  return (
    <AnfitrionDialogoGlobal documento={documento}>
      <ModalLoginCuenta {...acceso} onCerrar={cerrar} />
    </AnfitrionDialogoGlobal>
  )
}
