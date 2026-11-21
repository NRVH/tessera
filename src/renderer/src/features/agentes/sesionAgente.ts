// =============================================================================
// Ciclo de la sesión del agente en su pane: abrir (reanudando la última conversación),
// reanudar otra, empezar una nueva o una con traspaso, recuperarse de la muerte del contenedor, reiniciar
// y el bloqueo de la actualización nativa. Cada función recibe el contexto del render
// que la llama (refs, setters y sus valores); el estado de la sesión lo cambia `r.sesion`.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import type { Dispatch, SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import { esAgenteManual, type DefinicionAgente, type IdAgente } from '../../../../shared/agentesManuales'
import { ESPERAS_RECUPERACION_MS, esperarMs } from '../../../../shared/esperasRecuperacion'
import type { PoliticaCupo } from '../../../../shared/semaforoContenedores'
import { cupoDeApertura, useStoreAjustes, useStoreRecursosDocker } from '../ajustes'
import { enSiguienteFotogramaXterm } from '../terminales'
import {
  C_DIM, C_ERR, C_OK, C_RST, C_AVISO, CUENTA_HOST_ID, MAX_INTENTOS_RECUPERACION_CONTENEDOR, bannerReanudado, bannerReinicio
} from './tiposPaneAgente'
import { txSesion } from './textosSesion.ts'
import { txTraspaso } from './textosTraspaso.ts'
import { esTraspasoCaducado } from './traspasoPendiente.ts'
import { apuntarTamanoDeNacimiento, ajustarYSincronizarAhora, tamanoParaAbrir } from './terminalAgente'
import type { ResultadoRelanzar } from './tipos'
import { conversacionAReanudar, type PedidoApertura, type UltimaConversacion } from './sesionViva'
import type { AnclaCuenta, EstadoSesion } from './useEstadoPaneAgente'
import type { RefsPaneAgente } from './useRefsPaneAgente'

/** Contexto de un render del pane para las operaciones de sesión. */
export interface CtxSesion {
  r: RefsPaneAgente
  s: EstadoSesion
  d: {
    perfilId: string
    agente: IdAgente
    /** La definición si es un agente manual: viaja al main con la apertura; sin conversaciones que leer. */
    manual: DefinicionAgente | null
    rutaHostProyecto: string
    modoNativo: boolean
    cuentaSeleccionadaId: string | null
    hibernado: boolean
    basesListas: boolean
    recargando: boolean
  }
}

/**
 * La última conversación de este (perfil, agente, cuenta, proyecto), para reanudarla al
 * abrir o despertar; undefined si no hay o ante cualquier fallo. `soloUltima` evita que
 * el main parsee todos los transcripts en el camino crítico.
 */
async function ultimaConversacion(ctx: CtxSesion, cuentaId: string): Promise<UltimaConversacion | undefined> {
  const { perfilId, agente, rutaHostProyecto, modoNativo } = ctx.d
  // De un agente manual no se leen conversaciones: reanuda con sus propios argumentos.
  if (esAgenteManual(agente)) return undefined
  try {
    const lista = await window.tessera.conversaciones.listar({
      profileId: perfilId,
      agente,
      accountId: cuentaId,
      projectHostPath: rutaHostProyecto,
      modo: modoNativo ? 'host' : 'container',
      soloUltima: true
    })
    const c = lista[0]
    return c ? { id: c.id, actualizadaEn: c.actualizadaEn } : undefined
  } catch {
    return undefined
  }
}

/** Enfoca y ajusta en el próximo frame tras abrir o relanzar, si puede llevarse el foco. */
function ajustarTrasAbrir(r: RefsPaneAgente, term: Terminal, enfocar: boolean): void {
  enSiguienteFotogramaXterm(r.host.current, () => {
    if (r.term.current !== term) return
    ajustarYSincronizarAhora(r)
    if (enfocar && r.puedeEnfocar.current) term.focus()
  })
}

function textoError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Qué se devuelve al pedido y qué dice el pane cuando la apertura falla. Si fue porque el main ya no tiene el
 * traspaso, este se suelta (reintentarlo fallaría igual) y el pane lo dice.
 */
function pedidoTrasFallo(pedido: PedidoApertura, err: unknown): { pedido: PedidoApertura; texto: string } {
  if (pedido.traspaso !== null && esTraspasoCaducado(err)) return { pedido: { ...pedido, traspaso: null }, texto: txTraspaso().caducado }
  return { pedido, texto: textoError(err) }
}

/** El cupo de la apertura: solo en Docker (en el equipo no hay contenedor que contar). */
function cupoDeLaApertura(modoNativo: boolean): { cupo: PoliticaCupo } | Record<string, never> {
  if (modoNativo) return {}
  const a = useStoreAjustes.getState()
  const cupo = cupoDeApertura(
    a.limiteContenedores,
    useStoreRecursosDocker.getState().recursos?.memoriaBytes ?? null,
    a.primeroEnPararse,
    a.protegerTrabajando
  )
  return cupo ? { cupo } : {}
}

/**
 * ABRE la sesión en el xterm ya montado. Idempotente: no abre con otra en vuelo ni con
 * una viva. En una re-apertura escribe el banner "reanudado". Si el open falla, devuelve
 * lo pedido consumido para que el reintento no reanude otra conversación.
 */
export async function abrirSesion(ctx: CtxSesion, cuentaId: string): Promise<void> {
  const { r, s, d } = ctx
  const term = r.term.current
  if (!term) return
  const apertura = r.sesion.empezarApertura(cuentaId)
  if (!apertura) return
  if (apertura.banner) term.write(bannerReanudado())
  const { pedido } = apertura
  const ultima = !pedido.reanudar && !pedido.deCero ? await ultimaConversacion(ctx, cuentaId) : undefined
  const conversacionReanudarId = conversacionAReanudar(pedido, ultima)
  // Un desmontaje o una segunda apertura pudieron ocurrir durante el await.
  if (!r.term.current || r.sesion.id() !== null) {
    r.sesion.terminarApertura()
    return
  }
  // Sin sesión viva su espejo ya vale null: solo `SesionAgente` lo escribe.
  s.setEstado('booting'); s.setError(null); s.setRecuperacion(null)
  try {
    const tamano = tamanoParaAbrir(r)
    const res = await window.tessera.terminalAgente.abrir({
      perfilId: d.perfilId,
      agente: d.agente,
      rutaHostProyecto: d.rutaHostProyecto,
      cuentaId,
      conversacionReanudarId,
      ...(pedido.traspaso ? { traspasoId: pedido.traspaso } : {}),
      modo: d.modoNativo ? 'host' : 'container',
      // Del ref: cambiar el montaje no reabre la sesión; se aplica al reiniciar.
      conexionDbIds: r.basesMontadas.current,
      // Un agente manual reanuda con sus argumentos salvo en «Nueva conversación».
      ...(d.manual ? { manual: d.manual, reanudarManual: !pedido.deCero } : {}),
      ...cupoDeLaApertura(d.modoNativo),
      tamano
    })
    // Desmontado durante el open: no dejar la sesión huérfana.
    if (!r.term.current) {
      void window.tessera.terminalAgente.cerrar(res.sesionId)
      return
    }
    r.sesion.adoptar(res.sesionId)
    apuntarTamanoDeNacimiento(r, res.sesionId, tamano)
    s.setEstado('live')
    ajustarTrasAbrir(r, term, true)
  } catch (err) {
    if (!r.term.current) return
    // Un traspaso que el main ya no tiene no se reintenta ni se sustituye en silencio por un chat vacío: se dice.
    const fallo = pedidoTrasFallo(pedido, err)
    r.sesion.devolverPedido(fallo.pedido)
    s.setError(fallo.texto)
    s.setEstado('error')
  } finally {
    r.sesion.terminarApertura()
  }
}

/**
 * Cambia de conversación (reanudar otra o empezar una nueva, según lo ya pedido a la
 * sesión): suelta la viva limpiando la terminal, espera a que el main la cierre y reabre.
 */
async function cambiarDeConversacion(ctx: CtxSesion, acc: string, pedir: () => void): Promise<void> {
  const { r } = ctx
  pedir()
  const cierre = r.sesion.soltar('conversacion')
  if (cierre) {
    await cierre
    if (!r.term.current) return // desmontado durante el cierre
  }
  await abrirSesion(ctx, acc)
}

/** Cuenta para cambiar de conversación, o null si ahora no se puede. */
function cuentaParaCambiar(ctx: CtxSesion): string | null {
  const { r, d } = ctx
  const acc = d.modoNativo ? CUENTA_HOST_ID : d.cuentaSeleccionadaId
  // Preparado para actualizar: cambiar de sesión dejaría al orquestador sin relanzar.
  if (!acc || !r.term.current || r.sesion.abriendo() || r.actualizando.current) return null
  return acc
}

/** Reanuda una conversación del historial: cierra la viva, limpia y reabre con ella. */
export async function reanudarConversacion(ctx: CtxSesion, convId: string): Promise<void> {
  const acc = cuentaParaCambiar(ctx)
  if (acc) await cambiarDeConversacion(ctx, acc, () => ctx.r.sesion.pedirReanudar(convId))
}

/** Nueva conversación: cierra la viva, limpia y reabre sin reanudar la última. */
export async function iniciarConversacionNueva(ctx: CtxSesion): Promise<void> {
  const acc = cuentaParaCambiar(ctx)
  if (acc) await cambiarDeConversacion(ctx, acc, () => ctx.r.sesion.pedirNueva())
}

/**
 * Abre con un traspaso: con una sesión viva la cierra y reabre con él; sin ella, queda pedido para la apertura
 * que el pane hace a continuación (si el main ya no lo tiene, esa apertura lo dice). Con una sesión viva que
 * ahora no se puede cambiar (preparada para actualizar) no hace nada y devuelve false: el traspaso sigue
 * esperando, con su caducidad, donde estaba.
 */
export async function abrirConTraspaso(ctx: CtxSesion, traspasoId: string, reanudar: string | null): Promise<boolean> {
  const pedir = (): void => ctx.r.sesion.pedirTraspaso(traspasoId, reanudar)
  const acc = cuentaParaCambiar(ctx)
  if (ctx.r.sesion.id() === null) pedir()
  else if (acc) await cambiarDeConversacion(ctx, acc, pedir)
  else return false
  return true
}

/** ¿Se puede aplicar ahora un traspaso en este pane? Con una sesión viva, solo si se puede cambiar de conversación. */
export function puedeAbrirConTraspaso(ctx: CtxSesion): boolean {
  return ctx.r.sesion.id() === null || cuentaParaCambiar(ctx) !== null
}

/**
 * Recuperación AUTOMÁTICA y ACOTADA ante la muerte del contenedor con Docker vivo: cada
 * intento es un reload que recrea el contenedor y vuelve a montar proyecto y
 * credenciales, con esperas crecientes entre ellos. Tras N intentos se para; si Docker
 * vuelve más tarde, `useReanudarConDocker` la lanza otra vez.
 */
export async function recuperarContenedor(ctx: Pick<CtxSesion, 'r' | 's'>): Promise<void> {
  const { r, s } = ctx
  if (r.recovering.current) return // ya hay una recuperación en curso
  const id = r.sesion.id()
  const term = r.term.current
  if (!id || !term) return
  r.recovering.current = true
  s.setRecuperando(true)
  try {
    for (let intento = 1; intento <= MAX_INTENTOS_RECUPERACION_CONTENEDOR; intento++) {
      s.setRecuperacion({ fase: 'recovering', intento })
      await esperarMs(ESPERAS_RECUPERACION_MS[intento - 1])
      if (!r.term.current) return // desmontado durante la espera
      s.setEstado('booting') // el punto del perfil gira "recuperando"
      term.write(
        `\r\n${C_AVISO}${txSesion().contenedorCaido(intento, MAX_INTENTOS_RECUPERACION_CONTENEDOR)}${C_RST}\r\n`
      )
      try {
        await window.tessera.terminalAgente.recargar(id)
        if (!r.term.current) return // desmontado durante el intento
        s.setEstado('live'); s.setRecuperacion(null)
        term.write(`${C_OK}${txSesion().contenedorReiniciado}${C_RST}\r\n`)
        ajustarTrasAbrir(r, term, true)
        return
      } catch (err) {
        if (!r.term.current) return
        term.write(`${C_ERR}${txSesion().intentoFallo(intento, textoError(err))}${C_RST}\r\n`)
      }
    }
    if (!r.term.current) return
    s.setEstado('exited'); s.setRecuperacion({ fase: 'failed' })
    term.write(
      `\r\n${C_ERR}${txSesion().noRecuperado(MAX_INTENTOS_RECUPERACION_CONTENEDOR)}${C_RST}\r\n` +
        `${C_DIM}${txSesion().revisaDocker}${C_RST}\r\n`
    )
  } finally {
    r.recovering.current = false
    s.setRecuperando(false)
  }
}

/**
 * Botón del pie. La acción la decide `botonReinicio` y llega por parámetro: 'reload'
 * relanza la sesión viva, 'open' vuelve a ABRIR tras un arranque fallido (con las mismas
 * guardas que el reconcile) y 'nada' no hace nada.
 */
export async function alRecargar(ctx: CtxSesion, accion: 'reload' | 'open' | 'nada'): Promise<void> {
  const { r, s, d } = ctx
  const term = r.term.current
  if (!term || accion === 'nada' || d.recargando || r.recovering.current || r.actualizando.current) return
  if (accion === 'open') {
    const acc = d.modoNativo ? CUENTA_HOST_ID : d.cuentaSeleccionadaId
    if (d.hibernado || !acc) return
    if (!d.basesListas) return
    s.setRecargando(true)
    try {
      await abrirSesion(ctx, acc)
    } finally {
      s.setRecargando(false)
    }
    return
  }
  await relanzarSesion(ctx, { enfocar: true, banner: bannerReinicio() })
}

/** Cuenta con la que se busca la conversación a reanudar al relanzar. */
function cuentaDeReanudacion(d: CtxSesion['d']): string {
  return d.modoNativo ? CUENTA_HOST_ID : (d.cuentaSeleccionadaId ?? CUENTA_HOST_ID)
}

/**
 * El «Reiniciar» del pane sin la guarda de `reloading` (lo usan el pie y la API de
 * actualización): relanza el proceso reanudando la conversación viva y con el montaje
 * vigente. SIEMPRE deja el pane liberado, salga por donde salga.
 */
export async function relanzarSesion(ctx: CtxSesion, opts: { enfocar: boolean; banner: string }): Promise<ResultadoRelanzar> {
  const { r, s } = ctx
  try {
    const term = r.term.current
    if (!term || r.recovering.current || r.hibernado.current) return 'saltada'
    const id = r.sesion.id()
    if (!id) return 'saltada'
    s.setRecargando(true)
    term.write(opts.banner)
    try {
      const conversacionReanudarId = (await ultimaConversacion(ctx, cuentaDeReanudacion(ctx.d)))?.id
      // Durante el await el pane pudo desmontarse, hibernar o cambiar de sesión.
      if (!r.term.current || r.hibernado.current || r.sesion.id() !== id) return 'saltada'
      // La entrada se reabre ANTES de relanzar: `disableStdin` corta también las
      // respuestas del xterm a las preguntas que el CLI hace al arrancar (ver el ADR).
      if (r.actualizando.current) term.options.disableStdin = false
      // Un agente manual relanza con su definición de ahora: reiniciar aplica lo editado.
      await window.tessera.terminalAgente.recargar(id, r.basesMontadas.current, conversacionReanudarId, ctx.d.manual ?? undefined)
      s.setEstado('live'); s.setRecuperacion(null)
      ajustarTrasAbrir(r, term, opts.enfocar)
      return 'ok'
    } catch (err) {
      s.setEstado('exited')
      term.write(`\r\n${C_ERR}${txSesion().falloReinicio(textoError(err))}${C_RST}\r\n`)
      return 'fallo'
    }
  } finally {
    s.setRecargando(false)
    liberarActualizacion({ r, setActualizando: s.setActualizando })
  }
}

/** Lo que tocan preparar y liberar: refs y setters estables, sin valores de un render. */
export interface CtxBloqueo {
  r: RefsPaneAgente
  setActualizando: Dispatch<SetStateAction<boolean>>
  setVerHistorial: Dispatch<SetStateAction<boolean>>
  setMenuCuenta: Dispatch<SetStateAction<AnclaCuenta | null>>
}

/** Bloquea el pane para la actualización nativa: entrada, historial y menú de cuenta (cambiar de modo remonta el pane). */
export function prepararActualizacion(c: CtxBloqueo): void {
  const { r } = c
  r.actualizando.current = true
  c.setActualizando(true)
  const term = r.term.current
  if (term) term.options.disableStdin = true
  c.setVerHistorial(false)
  c.setMenuCuenta(null)
}

/** Deshace `prepararActualizacion` (no hace nada si el pane no estaba preparado). */
export function liberarActualizacion(c: Pick<CtxBloqueo, 'r' | 'setActualizando'>): void {
  const { r } = c
  if (!r.actualizando.current) return
  r.actualizando.current = false
  c.setActualizando(false)
  const term = r.term.current
  if (term) term.options.disableStdin = false
}
