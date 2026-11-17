// =============================================================================
// Efectos de la sesión del agente, en el orden en que los registra el pane: traspaso pendiente, cambio de
// cuenta, reconcile (abre si se mira, con cuenta y con los ajustes cargados),
// hibernación, la vuelta de Docker y la API que publica para la actualización nativa. Devuelve las acciones
// de la interfaz atadas al contexto de este render.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { C_DIM, C_ERR, C_RST, CUENTA_HOST_ID, agenteManualDe, type PropsPaneAgente, type EstadoRecuperacion } from './tiposPaneAgente'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import {
  abrirConTraspaso, abrirSesion, alRecargar, liberarActualizacion, prepararActualizacion, puedeAbrirConTraspaso,
  recuperarContenedor, relanzarSesion, reanudarConversacion, iniciarConversacionNueva, type CtxBloqueo, type CtxSesion
} from './sesionAgente'
import { tomarTraspaso, useStoreAgentes } from './store'
import { txSesion } from './textosSesion.ts'
import { txTraspaso } from './textosTraspaso.ts'
import { decidirTraspaso } from './traspasoPendiente.ts'
import { notifyError } from '../../comun/notificaciones'
import type { ApiPaneAgente } from './tipos'
import type { EstadoSesion } from './useEstadoPaneAgente'
import type { RefsPaneAgente } from './useRefsPaneAgente'

/** Acciones de sesión que dispara la interfaz del pane. */
export interface AccionesSesion {
  reanudar: (convId: string) => void
  nueva: () => void
  reiniciar: (accion: 'reload' | 'open' | 'nada') => void
}

/**
 * TRASPASO de «Continuar en…»: lo toma el pane de su target cuando ya corre en su modo y con su cuenta (los
 * fija el mismo cambio del store, que remonta el pane o le cambia la cuenta). Se registra ANTES que el cambio
 * de cuenta y el reconcile: en ese mismo commit, la apertura que hagan ya lo lleva. Con una sesión viva de la
 * misma cuenta, nadie más la cierra: se cambia de conversación aquí. Con una apertura en vuelo, espera a que acabe.
 */
function useTraspasoPendiente(p: PropsPaneAgente, ctx: CtxSesion): void {
  const { key: clave } = p.target
  const { modoNativo, cuentaSeleccionadaId } = p
  const pendiente = useStoreAgentes((s) => s.traspasosPendientes[clave])
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const estado = ctx.s.estado
  // El traspaso que ya vio al pane en su modo y cuenta: si luego cambia a otro, ya no es lo que se pidió.
  const yaCoincidio = useRef<string | null>(null)
  // Pasada su vida el main ya no lo tiene: no se queda esperando a un pane que quizá nunca llegue a su modo.
  useEffect(() => {
    if (!pendiente) return
    const t = setTimeout(() => tomarTraspaso(clave, pendiente.traspasoId), Math.max(0, pendiente.caduca - Date.now()))
    return () => clearTimeout(t)
  }, [pendiente, clave])
  useEffect(() => {
    if (!pendiente) return
    const decision = decidirTraspaso(pendiente, {
      ahora: Date.now(),
      modoNativo: !!modoNativo,
      cuenta: cuentaSeleccionadaId,
      yaCoincidio: yaCoincidio.current === pendiente.traspasoId
    })
    if (decision === 'esperar') return
    if (decision === 'caducado' || decision === 'descartar') {
      tomarTraspaso(clave, pendiente.traspasoId)
      if (decision === 'caducado') notifyError(txTraspaso().caducado)
      return
    }
    yaCoincidio.current = pendiente.traspasoId
    const { r } = ctxRef.current
    if (r.sesion.abriendo()) return
    if (!modoNativo && r.sesion.abiertaConOtraCuenta(cuentaSeleccionadaId)) {
      tomarTraspaso(clave, pendiente.traspasoId)
      r.sesion.pedirTraspaso(pendiente.traspasoId, pendiente.reanudar)
    } else if (puedeAbrirConTraspaso(ctxRef.current)) {
      tomarTraspaso(clave, pendiente.traspasoId)
      void abrirConTraspaso(ctxRef.current, pendiente.traspasoId, pendiente.reanudar)
    }
  }, [pendiente, modoNativo, cuentaSeleccionadaId, clave, estado])
}

/**
 * CAMBIO DE CUENTA: cierra la sesión abierta con OTRA cuenta; el reconcile (declarado
 * después, mismo commit) la ve libre y la reabre con la nueva.
 */
function useCambioDeCuenta(p: PropsPaneAgente, r: RefsPaneAgente): void {
  const { cuentaSeleccionadaId, modoNativo } = p
  useEffect(() => {
    if (modoNativo) return // modo nativo: no hay cambio de cuenta
    if (r.sesion.abiertaConOtraCuenta(cuentaSeleccionadaId)) void r.sesion.soltar('cuenta')
  }, [cuentaSeleccionadaId, modoNativo, r])
}

/**
 * RECONCILE: abre cuando el pane se MIRA (seleccionado o casilla a la vista), activado,
 * sin hibernar, con cuenta (salvo en nativo) y con los ajustes cargados en los DOS modos.
 * Un pane oculto vivo no se toca.
 */
function useReconcile(p: PropsPaneAgente, ctx: CtxSesion, activado: boolean): void {
  const { r } = ctx
  const { seEstaMirando, hibernado, cuentaSeleccionadaId, modoNativo, basesListas } = p
  useEffect(() => {
    if (!activado || !seEstaMirando || hibernado) return
    if (!modoNativo && !cuentaSeleccionadaId) return
    // Abrir antes de hidratar los ajustes borraría el ámbito de montaje del proyecto.
    if (!basesListas) return
    if (!r.term.current || !r.sesion.puedeAbrir()) return
    void abrirSesion(ctx, modoNativo ? CUENTA_HOST_ID : cuentaSeleccionadaId!)
    // `ctx` cambia en cada render: como dep reabriría la sesión sin parar. Solo reacciona
    // a la visibilidad y la cuenta; lo demás que lee son refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activado, seEstaMirando, hibernado, cuentaSeleccionadaId, modoNativo, basesListas])
}

/**
 * Publica UNA vez por pane y target la API de la actualización nativa, y la retira al
 * desmontar. Sus funciones leen refs al llamarse; relanzar va por `r.relanzarApi`.
 */
function usePublicarApi(p: PropsPaneAgente, c: CtxBloqueo): void {
  const { key: clave, agente, profileId: perfilId, projectHostPath: rutaHostProyecto } = p.target
  const { r, setActualizando, setVerHistorial, setMenuCuenta } = c
  useEffect(() => {
    const publicar = r.onApi.current
    // Un agente manual no se actualiza desde Tessera: no publica API para la actualización nativa.
    if (!publicar || esAgenteManual(agente)) return
    const bloqueo = { r, setActualizando, setVerHistorial, setMenuCuenta }
    const api: ApiPaneAgente = {
      clave,
      agente,
      perfilId,
      rutaHostProyecto,
      sesionId: () => r.sesion.id(),
      modoNativo: () => r.modoNativo.current,
      preparar: () => prepararActualizacion(bloqueo),
      relanzar: (o) => r.relanzarApi.current(o),
      liberar: () => liberarActualizacion(bloqueo),
      reanudarCon: (conversacionId) => r.sesion.pedirReanudar(conversacionId),
      reanudarSiHuboDesde: (desde) => r.sesion.pedirSiNadaDesde(desde)
    }
    publicar(clave, api)
    return () => publicar(clave, null)
  }, [clave, agente, perfilId, rutaHostProyecto, r, setActualizando, setVerHistorial, setMenuCuenta])
}

/** Efectos de la sesión y acciones de la interfaz ligadas a este render. */
export function useSesionAgente(
  p: PropsPaneAgente,
  r: RefsPaneAgente,
  s: EstadoSesion,
  bloqueo: Omit<CtxBloqueo, 'r' | 'setActualizando'>,
  activado: boolean
): AccionesSesion {
  const { profileId: perfilId, agente, projectHostPath: rutaHostProyecto } = p.target
  const { modoNativo, cuentaSeleccionadaId, hibernado, basesListas } = p
  const manual = agenteManualDe(p.pestanasAgente, agente)
  const ctx: CtxSesion = {
    r, s, d: { perfilId, agente, manual, rutaHostProyecto, modoNativo, cuentaSeleccionadaId, hibernado, basesListas, recargando: s.recargando }
  }
  useTraspasoPendiente(p, ctx)
  useCambioDeCuenta(p, r)
  useReconcile(p, ctx, activado)
  useHibernar(r, hibernado)
  useReanudarConDocker(ctx, s.recuperacion?.fase ?? null)
  useAvisarInicioDeDocker(ctx)
  // Una API vieja de un pane que ya no es nativo no relanza nada: solo lo deja suelto.
  r.relanzarApi.current = async ({ banner, error }) => {
    if (!r.modoNativo.current) {
      liberarActualizacion({ r, setActualizando: s.setActualizando })
      return 'saltada'
    }
    return relanzarSesion(ctx, { enfocar: false, banner: `\r\n${error ? C_ERR : C_DIM}${banner}${C_RST}\r\n` })
  }
  usePublicarApi(p, { r, setActualizando: s.setActualizando, ...bloqueo })
  return {
    reanudar: (convId) => void reanudarConversacion(ctx, convId),
    nueva: () => void iniciarConversacionNueva(ctx),
    reiniciar: (accion) => void alRecargar(ctx, accion)
  }
}

/**
 * Docker volvió: la sesión que lo esperaba (caído, o con los reintentos agotados) se recupera
 * sola, sin que haga falta pulsar «Reintentar». El contexto va por ref: la suscripción vive
 * mientras dure la espera, no un render.
 */
function useReanudarConDocker(ctx: CtxSesion, fase: EstadoRecuperacion['fase'] | null): void {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const esperando = fase === 'docker-down' || fase === 'failed'
  useEffect(() => {
    if (!esperando) return
    return window.tessera.estadoDocker.alCambiar((estado) => {
      // Con un «Reintentar» en curso, ese mismo reinicio ya está esperando a Docker: otro competiría con él.
      if (estado === 'disponible' && !ctxRef.current.d.recargando) void recuperarContenedor(ctxRef.current)
    })
  }, [esperando])
}

/** Abrir puede tardar minutos si hay que iniciar Docker: la pestaña que lo espera lo dice en su terminal. */
function useAvisarInicioDeDocker(ctx: CtxSesion): void {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const avisado = useRef(false)
  useEffect(() => {
    return window.tessera.estadoDocker.alCambiar((estado) => {
      const { r, d } = ctxRef.current
      const esperandolo = !d.modoNativo && (r.sesion.abriendo() || d.recargando)
      if (estado !== 'iniciando' || !esperandolo) {
        avisado.current = false
        return
      }
      // Cada pestaña o tarea que se suma a la espera vuelve a avisar: esta terminal lo dice una vez.
      if (avisado.current) return
      avisado.current = true
      r.term.current?.write(`\r\n${C_DIM}${txSesion().iniciandoDocker}${C_RST}\r\n`)
    })
  }, [])
}

/**
 * HIBERNAR: el backend cerró la sesión sin avisar. El xterm sobrevive; se suelta el id
 * muerto para que el reconcile la reabra al volver a mirarse.
 */
function useHibernar(r: RefsPaneAgente, hibernado: boolean): void {
  useEffect(() => {
    if (hibernado) void r.sesion.soltar('hibernada')
  }, [hibernado, r])
}
