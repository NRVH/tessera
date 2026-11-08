// =============================================================================
// Montaje y cierre de la terminal de acceso a una cuenta Docker.
// Sondea credenciales y cierra también las aperturas que terminan al desmontar.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { useContext, useEffect, useRef, useState } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { DefinicionAgente } from '../../../../shared/agentesManuales'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { AgentAppearanceContext, type TerminalAppearance } from '../../theme/terminalAppearance'
import { montarXterm, ajustarXterm, type RefsXterm } from '../terminales'
import { MS_CONFIRMACION } from '../../comun/BotonGuardar'
import { sesionIniciada } from './modeloCuentasConfiguracion'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion'

type Releer = () => Promise<AgentAccount[]>
interface AccesoCuenta {
  cuenta: AgentAccount
  manual?: DefinicionAgente
  projectHostPath: string
  host: HTMLDivElement
  apariencia: TerminalAppearance
  releer: Releer
  confirmar: () => void
  onCerrar: () => void
  error: (e: unknown) => void
}

/** El sondeo se cancela también durante una lectura o un cierre pendientes. */
function sondearAcceso(p: AccesoCuenta, cerrar: () => Promise<void>, confirmar: () => void): () => void {
  let activo = true
  let consultando = false
  const consultar = async (): Promise<void> => {
    if (!activo || consultando) return
    consultando = true
    try {
      const cuentas = await p.releer()
      if (!activo || !sesionIniciada(cuentas, p.cuenta.id)) return
      await cerrar()
      if (!activo) return
      activo = false
      clearInterval(reloj)
      confirmar()
    } catch (e) { if (activo) p.error(e) }
    finally { consultando = false }
  }
  const reloj = setInterval(() => void consultar(), 2000)
  void consultar()
  return () => { activo = false; clearInterval(reloj) }
}

/** Montaje común con portapapeles y tamaño sincronizados con el pty del acceso. */
function montarTerminalAcceso(p: AccesoCuenta, id: () => string | null, cerrar: () => Promise<void>) {
  const canal = window.tessera.agentTerminal
  const refs: RefsXterm = {
    host: { current: p.host }, term: { current: null }, fit: { current: null }, search: { current: null },
    webgl: { current: null }, flow: { current: null }, resizeTimer: { current: null },
    appearance: { current: p.apariencia }, accent: { current: null }
  }
  const ajustar = (): void => {
    if (!ajustarXterm(refs)) return
    const term = refs.term.current
    const sessionId = id()
    if (sessionId && term) canal.resize({ sessionId, cols: term.cols, rows: term.rows })
  }
  const pegar = (): void => {
    void window.tessera.clipboard.read().then((texto) => {
      if (id()) refs.term.current?.paste(texto)
    }).catch(p.error)
  }
  const desmontar = montarXterm(p.host, refs, {
    canal, idSesion: id,
    alSalir: () => p.error(txCuentasConfiguracion().errorSalida),
    atajos: {
      copiar: () => { const texto = refs.term.current?.getSelection(); if (texto) void window.tessera.clipboard.write(texto).catch(p.error) },
      pegar
    },
    pegar, soltarRutas: () => {}, ajustarConRebote: ajustar,
    cerrarSesion: () => { void cerrar().catch(p.error) }
  })
  ajustar()
  return { refs, ajustar, desmontar }
}

/** Posee una sola sesión: una apertura tardía también se cierra al desmontar. */
function montarAcceso(p: AccesoCuenta): () => void {
  let vigente = true
  let sesion: string | null = null
  let cerrando: Promise<void> | null = null
  let dejarSondeo = (): void => {}
  let salida: ReturnType<typeof setTimeout> | undefined
  const canal = window.tessera.agentTerminal
  const cerrar = (): Promise<void> => {
    if (cerrando) return cerrando
    if (!sesion) return Promise.resolve()
    cerrando = canal.close(sesion).then(() => { sesion = null }).catch((e: unknown) => { cerrando = null; throw e })
    return cerrando
  }
  const terminal = montarTerminalAcceso(p, () => sesion, cerrar)
  const term = terminal.refs.term.current
  void canal.open({
    profileId: p.cuenta.profileId, agente: p.cuenta.agente, mode: 'container',
    accountId: p.cuenta.id, projectHostPath: p.projectHostPath, manual: p.manual,
    tamano: term ? { cols: term.cols, rows: term.rows } : undefined
  }).then(async (resultado) => {
    sesion = resultado.sessionId
    if (!vigente) { await cerrar(); return }
    terminal.ajustar()
    terminal.refs.term.current?.focus()
    dejarSondeo = sondearAcceso(p, cerrar, () => {
      p.confirmar()
      salida = setTimeout(p.onCerrar, MS_CONFIRMACION)
    })
  }).catch(p.error)
  return () => {
    vigente = false
    dejarSondeo()
    clearTimeout(salida)
    terminal.desmontar()
  }
}

export function useLoginCuenta(cuenta: AgentAccount, projectHostPath: string | undefined, releer: Releer, onCerrar: () => void, manual?: DefinicionAgente) {
  const host = useRef<HTMLDivElement>(null)
  const apariencia = useContext(AgentAppearanceContext)
  const ultimo = useRef({ releer, onCerrar, apariencia, manual })
  ultimo.current = { releer, onCerrar, apariencia, manual }
  const [store] = useState(() => createStore(() => ({ exitos: 0, error: null as string | null })))
  const estado = useStore(store)
  // Reintentar vuelve a abrir la sesión de acceso desde cero (p. ej. cuando otra pestaña ya terminó su inicio de sesión).
  const [intento, setIntento] = useState(0)
  const reintentar = (): void => {
    store.setState({ error: null })
    setIntento((n) => n + 1)
  }
  useEffect(() => {
    if (!host.current || !projectHostPath) return
    let vigente = true
    const desmontar = montarAcceso({
      cuenta, projectHostPath, host: host.current, apariencia: ultimo.current.apariencia, manual: ultimo.current.manual,
      releer: () => ultimo.current.releer(),
      confirmar: () => { if (vigente) store.setState({ exitos: 1, error: null }) },
      onCerrar: () => ultimo.current.onCerrar(),
      error: (e) => {
        if (vigente) store.setState({ error: normalizarErrorIpc(e instanceof Error ? e.message : String(e)) })
        else console.error('[cuentas] cerrar la terminal de acceso falló:', e)
      }
    })
    return () => { vigente = false; desmontar() }
  }, [cuenta, projectHostPath, store, intento])
  return { host, ...estado, reintentar }
}
