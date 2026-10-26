// =============================================================================
// Efectos de sesión de un `TerminalPane`: reconcile de apertura, hibernación, fit al volver a ser
// visible, el primer dato de una sesión SSH, la recuperación del contenedor en modo Docker,
// reconectar o cancelar una SSH desde el propio pane y publicación de estado y acciones hacia el panel. Se
// llaman en este orden (React corre los efectos de un componente en el orden de declaración).
// Una sesión SSH no depende del contenedor ni de los ajustes de montaje, ignora la hibernación y se
// abre sola solo la primera vez que se ve.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { abrirSesion, cancelarConexion, manejarReload, recuperarShell, type ContextoSesion } from './sesionShell'
import { hayTextoVisible } from './textoSesionSsh'
import type { RefsTerminal, TerminalPaneProps } from './terminalPaneTipos'
import type { EstadoSesion } from './useEstadoTerminalPane'

/** Contexto de sesión del pane en este render (recreado en cada render, como los cierres que reemplaza). */
function contextoSesion(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  fitAndSyncNow: () => void
): ContextoSesion {
  const { profileId, origen, dbReady = true, hibernated = false } = props
  return { profileId, origen, dbReady, hibernated, refs, estado, fitAndSyncNow }
}

/** Modo nativo de una terminal local; una SSH no lo tiene. */
function esModoNativo(props: TerminalPaneProps): boolean {
  return props.origen.tipo === 'local' && props.origen.hostMode
}

/**
 * Reconcile: abre la sesión cuando el pane es visible, está activo y NO tiene una viva
 * (primer visible, o al despertar de una hibernación). Un pane oculto vivo no se toca:
 * eso es el keep-alive. Una SSH solo se abre sola la primera vez que se ve.
 */
export function useAperturaSesion(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  activated: boolean,
  fitAndSyncNow: () => void
): void {
  const { visible, dbReady = true, hibernated = false } = props
  const hostMode = esModoNativo(props)
  const esSsh = props.origen.tipo === 'ssh'
  const { setSessionId, setStatus } = estado
  const c = contextoSesion(props, refs, estado, fitAndSyncNow)
  const abrir = (): Promise<void> => abrirSesion(c)

  useEffect(() => {
    if (!activated || !visible) return
    if (esSsh) {
      // Si falló o se cerró, mirar la pestaña otra vez no reintenta: eso es de «Reconectar» o de Intro.
      if (refs.intentado.current) return
    } else {
      if (hibernated) return
      // Modo nativo: esperar a que los ajustes estén cargados (de ahí sale el montaje de bases).
      if (hostMode && !dbReady) return
    }
    if (!refs.term.current || refs.session.current !== null || refs.opening.current) return
    refs.intentado.current = true
    void abrir()
    // `abrir` se redefine en cada render: como dep reabriría en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, visible, hibernated, hostMode, dbReady, esSsh])

  // El backend mata las sesiones al hibernar SIN avisar: se limpia el sessionId muerto
  // y el reconcile la reabre al despertar. El xterm y su scrollback sobreviven. Las SSH no se matan.
  useEffect(() => {
    if (esSsh || !hibernated || refs.session.current === null) return
    refs.session.current = null
    setSessionId(null)
    setStatus('exited')
  }, [esSsh, hibernated, refs, setSessionId, setStatus])

  // Al volver a visible el contenedor recupera tamaño: fit en el siguiente frame.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => {
      fitAndSyncNow()
      refs.term.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
}

/**
 * Marca el primer TEXTO de la sesión SSH: hasta entonces el pane dice «Conectando a…» (las secuencias
 * de control con que el sistema abre el pty no cuentan). La salida es un broadcast de todas las
 * sesiones, de ahí el filtro por la sesión del momento.
 */
export function usePrimerDatoSsh(props: TerminalPaneProps, refs: RefsTerminal, estado: EstadoSesion): void {
  const esSsh = props.origen.tipo === 'ssh'
  const { datosRecibidos, setDatosRecibidos } = estado
  useEffect(() => {
    if (!esSsh || datosRecibidos) return
    return window.tessera.terminal.onData((msg) => {
      if (msg.sessionId === refs.session.current && hayTextoVisible(msg.data)) setDatosRecibidos(true)
    })
  }, [esSsh, datosRecibidos, refs, setDatosRecibidos])
}

/**
 * El contenedor de un shell en modo Docker murió: con 'recrear' se recupera ya; con
 * 'esperar-docker' se recupera cuando Docker vuelva a responder. El contexto va por ref: la
 * suscripción vive lo que dura la espera, no un render.
 */
export function useRecuperacionContenedor(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  fitAndSyncNow: () => void
): void {
  const ctx = useRef(contextoSesion(props, refs, estado, fitAndSyncNow))
  ctx.current = contextoSesion(props, refs, estado, fitAndSyncNow)
  const caida = estado.caidaContenedor
  useEffect(() => {
    if (caida === 'recrear') {
      void recuperarShell(ctx.current)
      return
    }
    if (caida !== 'esperar-docker') return
    return window.tessera.estadoDocker.onCambio((e) => {
      if (e === 'disponible') void recuperarShell(ctx.current)
    })
  }, [caida])
}

/** Reconectar y cancelar una sesión SSH desde su propio pane. */
export interface AccionesSsh {
  reconectar: () => void
  cancelar: () => void
}

/**
 * Las acciones SSH del pane: reconectar (relanza la sesión que hay o, sin ella, abre otra) y cancelar
 * la conexión en curso. Con la sesión terminada, Intro en la terminal también reconecta, salvo si la
 * conexión se eliminó; la entrada ya no llega a nadie, así que no se le roba nada a la sesión.
 */
export function useAccionesSsh(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  fitAndSyncNow: () => void,
  conexionExiste: boolean
): AccionesSsh {
  const c = contextoSesion(props, refs, estado, fitAndSyncNow)
  // Guarda SÍNCRONA: dos Intro antes del siguiente render verían los dos `reloading` en falso.
  const enVuelo = useRef(false)
  const acciones: AccionesSsh = {
    reconectar: () => {
      if (enVuelo.current) return
      enVuelo.current = true
      void manejarReload(refs.session.current ? 'reload' : 'open', c).finally(() => {
        enVuelo.current = false
      })
    },
    cancelar: () => cancelarConexion(c)
  }
  const ultimas = useRef(acciones)
  ultimas.current = acciones
  const esSsh = props.origen.tipo === 'ssh'
  const terminada = estado.status === 'exited' || estado.status === 'error'
  useEffect(() => {
    const term = refs.term.current
    if (!esSsh || !terminada || !conexionExiste || !term) return
    const sub = term.onData((data) => {
      if (data === '\r') ultimas.current.reconectar()
    })
    return () => sub.dispose()
  }, [esSsh, terminada, conexionExiste, refs])
  return acciones
}

/** Publica el estado y las acciones del pane hacia el header del panel (solo pinta el ACTIVO). */
export function usePublicacionPane(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  fitAndSyncNow: () => void
): void {
  const { paneKey, dbReady = true, hibernated = false, onInfo, onApi } = props
  const hostMode = esModoNativo(props)
  const { status, sessionId, exitCode, error, reloading } = estado
  const c = contextoSesion(props, refs, estado, fitAndSyncNow)
  const handleReload = (accion: 'reload' | 'open' | 'nada'): Promise<void> =>
    manejarReload(accion, c)

  useEffect(() => {
    onInfo?.(paneKey, { status, sessionId, exitCode, error, reloading })
  }, [paneKey, status, sessionId, exitCode, error, reloading, onInfo])

  useEffect(() => {
    onApi?.(paneKey, { reload: handleReload, focus: () => refs.term.current?.focus() })
    return () => onApi?.(paneKey, null)
    // `handleReload` captura props: además de `reloading`, las guardas del reintento en
    // frío leen `hibernated`, `hostMode` y `dbReady`. Todas van en las deps para que la
    // api publicada nunca quede obsoleta (un «Reintentar» habilitado e inerte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey, onApi, reloading, hibernated, hostMode, dbReady])
}
