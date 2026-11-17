// =============================================================================
// Las cuentas de (perfil, agente) de un pane en modo contenedor: carga perezosa y recarga al
// hacerse visible, auto-selección de la primera si la recordada ya no vale, y crear, renombrar,
// cerrar sesión y eliminar. La lista vive en el store del pane y se escribe en el MISMO turno que la
// selección (store de agentes), para que la auto-selección no vea una sin la otra.
// Decisiones: docs/decisiones/renderer/estado-de-app.md, docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { otrosQueUsan, registrarPaneConCuenta, type PaneConCuenta, type RetiroCuenta } from './retiroDeCuentas.ts'
import { crearCuenta, renombrarCuenta, retirarCuenta } from './accionesCuentas'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import type { PropsPaneAgente } from './tiposPaneAgente'
import type { IdAgente } from '../../../../shared/agentesManuales'

/** El agente de un pane con cuentas: uno de serie o uno manual (que siempre trae su predeterminada). */
function agenteConCuentas(p: PropsPaneAgente): IdAgente {
  return p.target.agente
}
import type { EstadoSesion } from './useEstadoPaneAgente'
import type { RefsPaneAgente } from './useRefsPaneAgente'

/** Acciones sobre la cuenta del pane que dispara la interfaz. */
export interface AccionesCuenta {
  alCrearCuenta: (nombre: string, global: boolean) => Promise<void>
  alRenombrarCuenta: (id: string, nombre: string) => Promise<void>
  alCerrarSesionCuenta: (id: string) => Promise<void>
  alEliminarCuenta: (id: string) => Promise<void>
  /** Relee la lista sin tocar la selección: al abrir el selector, que enseñe lo de ahora. */
  recargar: () => void
  /** Cuántos otros panes tienen una sesión abierta con la cuenta: cerrarla o eliminarla los corta. */
  otrosQueLaUsan: (id: string) => number
}

type Elegir = (lista: CuentaAgente[]) => string | null | undefined

/**
 * Escribe la lista solo si cambió: se relee cada vez que el pane se hace visible, y una lista nueva
 * con lo mismo repintaría todos los panes en cada cambio de perfil.
 */
function ponerLista(cuentas: EstadoSesion['cuentas'], lista: CuentaAgente[]): void {
  const antes = cuentas.getState().lista
  if (antes !== null && JSON.stringify(antes) === JSON.stringify(lista)) return
  cuentas.setState({ lista })
}

/** Carga y auto-selección de la cuenta; devuelve las acciones de la interfaz. */
export function useCuentasAgente(
  p: PropsPaneAgente,
  r: RefsPaneAgente,
  s: EstadoSesion,
  activado: boolean,
  setAnadiendoCuenta: Dispatch<SetStateAction<boolean>>
): AccionesCuenta {
  const { profileId } = p.target
  const agente = agenteConCuentas(p)
  const { modoNativo, visible, cuentaSeleccionadaId, onElegirModo } = p
  const { cuentas, cuentasCargadas } = s

  // Recarga también al hacerse visible (y al abrir el selector, `recargar`): otra pestaña del
  // perfil pudo crear o borrar cuentas; si borró la elegida, la auto-selección pasa a otra.
  useEffect(() => {
    // Nativo sin poder pasar a Docker (un manual, el de la terminal): sus cuentas no se ofrecen y no se cargan.
    // Si puede, se cargan igual: el menú de cuenta las enseña para pasar a una.
    if (!activado || (modoNativo && !onElegirModo)) return
    let cancelado = false
    window.tessera.cuentasAgente
      .listar({ profileId, agente })
      .then((lista) => {
        if (!cancelado) ponerLista(cuentas, lista)
      })
      .catch(() => {
        if (!cancelado) cuentas.setState({ lista: [] })
      })
    return () => {
      cancelado = true
    }
  }, [activado, visible, modoNativo, onElegirModo, profileId, agente, cuentas])

  // Si la recordada ya no vale, se adopta la primera; sin ninguna -> null.
  useEffect(() => {
    if (cuentasCargadas === null || modoNativo) return
    if (cuentaSeleccionadaId !== null && cuentasCargadas.some((a) => a.id === cuentaSeleccionadaId)) return
    r.onSeleccionarCuenta.current(cuentasCargadas[0]?.id ?? null)
  }, [cuentasCargadas, cuentaSeleccionadaId, modoNativo, r])

  // El pane en el registro de la ventana; lee siempre las props del último render.
  const ultimo = useRef({ p, s })
  ultimo.current = { p, s }
  const [yo] = useState<PaneConCuenta>(() => ({
    usa: (id) => r.sesion.abiertaCon(id),
    alRetirar: (id, motivo) => {
      // Solo le toca si la tenía abierta o elegida: los demás panes no tienen nada que releer.
      if (!r.sesion.abiertaCon(id) && ultimo.current.p.cuentaSeleccionadaId !== id) return
      void trasRetirar(ultimo.current.p, r, ultimo.current.s, id, motivo).catch((err: unknown) => console.error('[accounts] releer tras un retiro falló:', err))
    },
    alRenombrar: (id) => {
      if (ultimo.current.p.cuentaSeleccionadaId !== id) return
      void cargarCuentas(ultimo.current.p, r, ultimo.current.s).catch((err: unknown) => console.error('[accounts] releer tras un renombre falló:', err))
    }
  }))
  useEffect(() => registrarPaneConCuenta(yo), [yo])

  return accionesCuenta(p, r, s, setAnadiendoCuenta, yo)
}

/**
 * Tras cerrar la sesión de una cuenta o eliminarla (el main ya cerró sus sesiones): si este pane la tenía
 * abierta, la suelta con la terminal limpia y el reconcile reabre; eliminada y elegida, salta a otra (o null).
 */
async function trasRetirar(p: PropsPaneAgente, r: RefsPaneAgente, s: EstadoSesion, id: string, motivo: RetiroCuenta): Promise<void> {
  if (r.sesion.abiertaCon(id)) void r.sesion.soltar(motivo)
  await cargarCuentas(p, r, s, motivo === 'eliminada' ? (lista) => (p.cuentaSeleccionadaId === id ? (lista[0]?.id ?? null) : undefined) : undefined)
}

/**
 * Lo de después de una acción que el main ya hizo: si releer falla, no se propaga. El diálogo diría que
 * falló y su reintento iría contra una cuenta que ya no existe.
 */
async function trasRetirarSinFallar(p: PropsPaneAgente, r: RefsPaneAgente, s: EstadoSesion, id: string, motivo: RetiroCuenta): Promise<void> {
  await trasRetirar(p, r, s, id, motivo).catch((err: unknown) => console.error('[accounts] releer tras el retiro falló:', err))
}

/** `elegir` aplica la selección en el MISMO turno que la lista (undefined = no tocarla). */
async function cargarCuentas(p: PropsPaneAgente, r: RefsPaneAgente, s: EstadoSesion, elegir?: Elegir): Promise<CuentaAgente[]> {
  const { profileId } = p.target
  const agente = agenteConCuentas(p)
  const lista = await window.tessera.cuentasAgente.listar({ profileId, agente })
  ponerLista(s.cuentas, lista)
  const elegida = elegir?.(lista)
  if (elegida !== undefined) r.onSeleccionarCuenta.current(elegida)
  return lista
}

function accionesCuenta(
  p: PropsPaneAgente,
  r: RefsPaneAgente,
  s: EstadoSesion,
  setAnadiendoCuenta: Dispatch<SetStateAction<boolean>>,
  yo: PaneConCuenta
): AccionesCuenta {
  const { profileId } = p.target
  const agente = agenteConCuentas(p)
  return {
    otrosQueLaUsan: (id) => otrosQueUsan(id, yo),
    recargar: () => {
      void cargarCuentas(p, r, s).catch((err: unknown) => console.error('[accounts] recargar la lista falló:', err))
    },
    // Crea una cuenta, la selecciona y arranca su login. Si el main la rechaza (un nombre
    // repetido), lanza: el diálogo sigue abierto con el motivo y la pestaña no cambia de cuenta.
    alCrearCuenta: async (nombre, global) => {
      const acc = await crearCuenta(profileId, agente, nombre, global)
      setAnadiendoCuenta(false)
      // Corriendo nativo, una cuenta nueva es pasar a Docker con ella: el pane se remonta en ese modo.
      if (p.modoNativo && p.onElegirModo) return p.onElegirModo(p.target.key, 'docker', acc.id)
      await cargarCuentas(p, r, s, () => acc.id) // arranca con su config (login)
    },
    // Si el main lo rechaza (vacío, repetido), lanza: la tarjeta sigue en edición con el motivo.
    alRenombrarCuenta: async (id, nombre) => {
      await renombrarCuenta(id, nombre, yo)
      await cargarCuentas(p, r, s)
    },
    // Borra la credencial (el main cierra antes sus sesiones, las de todos los panes): el que la
    // tenía abierta pide login de cero.
    alCerrarSesionCuenta: async (id) => {
      await retirarCuenta(id, 'logout', yo)
      await trasRetirarSinFallar(p, r, s, id, 'logout')
    },
    alEliminarCuenta: async (id) => {
      await retirarCuenta(id, 'eliminada', yo)
      await trasRetirarSinFallar(p, r, s, id, 'eliminada')
    }
  }
}
