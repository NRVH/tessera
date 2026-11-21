// =============================================================================
// Carga y acciones de cuentas Docker desde Configuración.
// Relee al desplegar y tras cada acción, sin elegir cuentas en los panes.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { DefinicionAgente, IdAgente } from '../../../../shared/agentesManuales'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import { normalizarErrorIpc } from '../../../../shared/erroresDocker'
import { crearStoreCuentasConfiguracion } from './storeCuentasConfiguracion'
import { crearCuenta, renombrarCuenta, retirarCuenta, EMISOR_CONFIGURACION } from './accionesCuentas'
import { otrosQueUsan } from './retiroDeCuentas'
import type { AccionesCuenta } from './useCuentasAgente'
import { useInicioSesionCuenta } from './InicioSesionCuenta'

export function useCuentasConfiguracion(perfilId: string, agente: IdAgente, manual?: DefinicionAgente) {
  const [store] = useState(crearStoreCuentasConfiguracion)
  const estado = useStore(store)
  const { proyecto, iniciar } = useInicioSesionCuenta(perfilId)
  const releer = useCallback(async () => {
    const cuentas = await window.tessera.cuentasAgente.listar({ profileId: perfilId, agente })
    store.setState({ cuentas, error: null })
    return cuentas
  }, [perfilId, agente, store])
  const iniciarSesion = (cuenta: CuentaAgente): void => iniciar(cuenta, { manual, releer })
  // Plegada, la fila enseña cuántas cuentas hay: la lista se lee una vez al abrir Configuración.
  useEffect(() => {
    void releer().catch(() => undefined)
  }, [releer])
  useEffect(() => {
    if (!estado.desplegado) return
    let vigente = true
    const actualizar = async (): Promise<void> => {
      try {
        await releer()
      } catch (error) {
        if (vigente) store.setState({ error: normalizarErrorIpc(String(error)) })
      }
    }
    void actualizar()
    const reloj = setInterval(() => void actualizar(), 30_000)
    return () => { vigente = false; clearInterval(reloj) }
  }, [estado.desplegado, releer, store])
  // La operación ya terminó en el main: un fallo al releer no debe ofrecer repetirla.
  const releerSinFallar = async (): Promise<void> => {
    await releer().catch((error: unknown) => store.setState({ error: normalizarErrorIpc(String(error)) }))
  }
  const acciones: AccionesCuenta = {
    recargar: () => { void releerSinFallar() },
    otrosQueLaUsan: (id) => otrosQueUsan(id, EMISOR_CONFIGURACION),
    alCrearCuenta: async (nombre, global) => {
      const cuenta = await crearCuenta(perfilId, agente, nombre, global)
      store.setState({ creando: false })
      iniciarSesion(cuenta)
      await releerSinFallar()
    },
    alRenombrarCuenta: async (id, nombre) => {
      await renombrarCuenta(id, nombre, EMISOR_CONFIGURACION)
      await releerSinFallar()
    },
    alCerrarSesionCuenta: async (id) => {
      await retirarCuenta(id, 'logout', EMISOR_CONFIGURACION)
      await releerSinFallar()
    },
    alEliminarCuenta: async (id) => {
      await retirarCuenta(id, 'eliminada', EMISOR_CONFIGURACION)
      await releerSinFallar()
    }
  }
  return { estado, store, acciones, proyecto, iniciarSesion }
}
