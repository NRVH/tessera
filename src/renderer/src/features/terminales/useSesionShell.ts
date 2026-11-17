// =============================================================================
// Efectos de sesión de un `TerminalPane`: reconcile de apertura, hibernación, fit al volver a ser
// visible, el primer dato de una sesión SSH, reconectar o cancelar una SSH desde el propio pane y
// publicación de estado y acciones hacia el panel. Se llaman en este orden (React corre los efectos
// de un componente en el orden de declaración).
// Una sesión SSH no depende de los ajustes de montaje, ignora la hibernación y se abre sola solo la
// primera vez que se ve.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { abrirSesion, cancelarConexion, manejarRecarga, type ContextoSesion } from './sesionShell'
import { hayTextoVisible } from './textoSesionSsh'
import type { RefsTerminal, TerminalPaneProps } from './terminalPaneTipos'
import type { EstadoSesion } from './useEstadoTerminalPane'

/** Contexto de sesión del pane en este render (recreado en cada render, como los cierres que reemplaza). */
function contextoSesion(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  ajustarYSincronizarAhora: () => void
): ContextoSesion {
  const { perfilId, origen, basesListas = true, hibernado = false } = props
  return { perfilId, origen, basesListas, hibernado, refs, estado, ajustarYSincronizarAhora }
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
  activado: boolean,
  ajustarYSincronizarAhora: () => void
): void {
  const { visible, basesListas = true, hibernado = false } = props
  const esSsh = props.origen.tipo === 'ssh'
  const { setSesionId, setEstado } = estado
  const c = contextoSesion(props, refs, estado, ajustarYSincronizarAhora)
  const abrir = (): Promise<void> => abrirSesion(c)

  useEffect(() => {
    if (!activado || !visible) return
    if (esSsh) {
      // Si falló o se cerró, mirar la pestaña otra vez no reintenta: eso es de «Reconectar» o de Intro.
      if (refs.intentado.current) return
    } else {
      if (hibernado) return
      // Esperar a que los ajustes estén cargados (de ahí sale el montaje de bases).
      if (!basesListas) return
    }
    if (!refs.term.current || refs.sesion.current !== null || refs.abriendo.current) return
    refs.intentado.current = true
    void abrir()
    // `abrir` se redefine en cada render: como dep reabriría en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activado, visible, hibernado, basesListas, esSsh])

  // El backend mata las sesiones al hibernar SIN avisar: se limpia el sessionId muerto
  // y el reconcile la reabre al despertar. El xterm y su scrollback sobreviven. Las SSH no se matan.
  useEffect(() => {
    if (esSsh || !hibernado || refs.sesion.current === null) return
    refs.sesion.current = null
    setSesionId(null)
    setEstado('exited')
  }, [esSsh, hibernado, refs, setSesionId, setEstado])

  // Al volver a visible el contenedor recupera tamaño: fit en el siguiente frame.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => {
      ajustarYSincronizarAhora()
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
    return window.tessera.terminal.alRecibirDatos((msg) => {
      if (msg.sessionId === refs.sesion.current && hayTextoVisible(msg.data)) setDatosRecibidos(true)
    })
  }, [esSsh, datosRecibidos, refs, setDatosRecibidos])
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
  ajustarYSincronizarAhora: () => void,
  conexionExiste: boolean
): AccionesSsh {
  const c = contextoSesion(props, refs, estado, ajustarYSincronizarAhora)
  // Guarda SÍNCRONA: dos Intro antes del siguiente render verían los dos `reloading` en falso.
  const enVuelo = useRef(false)
  const acciones: AccionesSsh = {
    reconectar: () => {
      if (enVuelo.current) return
      enVuelo.current = true
      void manejarRecarga(refs.sesion.current ? 'reload' : 'open', c).finally(() => {
        enVuelo.current = false
      })
    },
    cancelar: () => cancelarConexion(c)
  }
  const ultimas = useRef(acciones)
  ultimas.current = acciones
  const esSsh = props.origen.tipo === 'ssh'
  const terminada = estado.estadoTerminal === 'exited' || estado.estadoTerminal === 'error'
  useEffect(() => {
    const term = refs.term.current
    if (!esSsh || !terminada || !conexionExiste || !term) return
    const sub = term.onData((datos) => {
      if (datos === '\r') ultimas.current.reconectar()
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
  ajustarYSincronizarAhora: () => void
): void {
  const { clavePane, basesListas = true, hibernado = false, onInfo, onApi } = props
  const { estadoTerminal, sesionId, codigoSalida, error, recargando } = estado
  const c = contextoSesion(props, refs, estado, ajustarYSincronizarAhora)
  const alRecargar = (accion: 'reload' | 'open' | 'nada'): Promise<void> =>
    manejarRecarga(accion, c)

  useEffect(() => {
    onInfo?.(clavePane, { estadoTerminal, sessionId: sesionId, codigoSalida, error, recargando })
  }, [clavePane, estadoTerminal, sesionId, codigoSalida, error, recargando, onInfo])

  useEffect(() => {
    onApi?.(clavePane, { recargar: alRecargar, enfocar: () => refs.term.current?.focus() })
    return () => onApi?.(clavePane, null)
    // `alRecargar` captura props: además de `recargando`, las guardas del reintento en
    // frío leen `hibernado` y `basesListas`. Todas van en las deps para que la
    // api publicada nunca quede obsoleta (un «Reintentar» habilitado e inerte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavePane, onApi, recargando, hibernado, basesListas])
}
