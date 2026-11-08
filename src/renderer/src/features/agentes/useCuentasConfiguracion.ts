// =============================================================================
// Carga y acciones de cuentas Docker desde Configuración.
// Relee al desplegar y tras cada acción, sin elegir cuentas en los panes.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { IdAgente } from '../../../../shared/agentesManuales'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { crearStoreCuentasConfiguracion } from './storeCuentasConfiguracion'
import { crearCuenta, renombrarCuenta, retirarCuenta, EMISOR_CONFIGURACION } from './accionesCuentas'
import { otrosQueUsan } from './retiroDeCuentas'
import type { AccionesCuenta } from './useCuentasAgente'

export function useCuentasConfiguracion(profileId: string, agente: IdAgente) {
  const [store] = useState(crearStoreCuentasConfiguracion)
  const estado = useStore(store)
  const releer = useCallback(async () => {
    const cuentas = await window.tessera.agentAccounts.list({ profileId, agente })
    store.setState({ cuentas, error: null })
    return cuentas
  }, [profileId, agente, store])
  // Plegada, la fila enseña cuántas cuentas hay: la lista se lee una vez al abrir Configuración.
  useEffect(() => {
    void releer().catch(() => undefined)
  }, [releer])
  useEffect(() => {
    if (!estado.desplegado) return
    let vigente = true
    const actualizar = async (): Promise<void> => {
      try {
        const cuentas = await releer()
        if (agente !== 'claude-code' && agente !== 'codex') return
        const usos = await Promise.all(cuentas.filter((c) => c.conSesion).map(async (c) => {
          const uso = await window.tessera.usage.get({ agente, accountId: c.id, mode: 'container' }).catch(() => null)
          return [c.id, uso] as const
        }))
        if (vigente) store.setState({ usos: Object.fromEntries(usos) })
      } catch (error) {
        if (vigente) store.setState({ error: normalizarErrorIpc(String(error)) })
      }
    }
    void actualizar()
    const reloj = setInterval(() => void actualizar(), 30_000)
    return () => { vigente = false; clearInterval(reloj) }
  }, [estado.desplegado, agente, releer, store])
  // La operación ya terminó en el main: un fallo al releer no debe ofrecer repetirla.
  const releerSinFallar = async (): Promise<void> => {
    await releer().catch((error: unknown) => store.setState({ error: normalizarErrorIpc(String(error)) }))
  }
  const acciones: AccionesCuenta = {
    recargar: () => { void releerSinFallar() },
    otrosQueLaUsan: (id) => otrosQueUsan(id, EMISOR_CONFIGURACION),
    handleCreateAccount: async (nombre) => {
      const cuenta = await crearCuenta(profileId, agente, nombre)
      store.setState({ creando: false, login: cuenta })
      await releerSinFallar()
    },
    handleRenameAccount: async (id, nombre) => {
      await renombrarCuenta(id, nombre, EMISOR_CONFIGURACION)
      await releerSinFallar()
    },
    handleLogoutAccount: async (id) => {
      await retirarCuenta(id, 'logout', EMISOR_CONFIGURACION)
      await releerSinFallar()
    },
    handleDeleteAccount: async (id) => {
      await retirarCuenta(id, 'eliminada', EMISOR_CONFIGURACION)
      await releerSinFallar()
    }
  }
  return { estado, store, acciones, releer }
}
