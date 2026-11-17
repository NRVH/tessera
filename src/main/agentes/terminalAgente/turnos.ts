// =============================================================================
// Actividad y conversación de cada sesión del agente: el rastreador de turnos, el ancla
// del anillo de contexto, el vigilante del transcript y los eventos ACTIVITY y EXIT.
// El fin del turno lo dice el transcript (`VigilanteTurno`); el rastreador solo dice
// «trabajando». Todo opera sobre el `NucleoAgente` de la fachada.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import type { Agente, Perfil } from '../../perfiles/types'
import {
  AGENT_TERMINAL_CHANNELS,
  type MensajeActividadAgente,
  type EstadoActividadAgente,
  type MotivoEsperaAgente,
  type MensajeSalidaAgente,
  type MotivoSalidaAgente
} from '../../../shared/agent-terminal-ipc'
import { crearRastreadorActividad, esEnvio, realScheduler, type RastreadorActividad } from '../actividadAgente'
import { RESPUESTA_SONDA } from '../estadoPrograma'
import { esCambioDeConversacion, esConversacionVacia } from '../lineaEnviada'
import { claveAncla } from '../../contextoConversacion/anclaConversacion'
import { basenameSuelto } from '../../conversaciones/slugProyecto'
import {
  GRACIA_ECO_ACTIVIDAD_MS,
  TOLERANCIA_MARCA_ACTIVIDAD_MS,
  MAX_PAUSA_ACTIVIDAD_MS,
  MAX_SUPRESION_ACTIVIDAD_MS,
  MAX_TICKS_TURNO_ACTIVIDAD,
  BYTES_APERTURA_ACTIVIDAD,
  TICKS_SILENCIO_ACTIVIDAD,
  TICK_ACTIVIDAD_MS,
  TICKS_VENTANA_ACTIVIDAD,
  errMsg,
  type NucleoAgente,
  type SesionAgenteAbierta
} from './tipos'

/** Estado crudo ('working' / 'idle') de cada sesión viva: un 'done' es un evento y no se reemite. */
export function fotoActividad(n: NucleoAgente): MensajeActividadAgente[] {
  return [...n.sesiones.values()].map((s) => ({
    sesionId: s.sesionId,
    perfilId: s.perfilId,
    rutaHostProyecto: s.rutaHostProyecto,
    agente: s.agente,
    estado: s.actividad.estado(),
    motivo: s.actividad.motivoEspera()
  }))
}

/**
 * Antes de parar una sesión para relanzarla, fija con qué chat volverá según su ancla, y
 * solo si nadie más comparte la clave: 'anclada' → su id; 'dudosa' → ninguno (decide el
 * renderer); 'esperando' → nada.
 */
export function alinearChatConAncla(n: NucleoAgente, sesionAbierta: SesionAgenteAbierta): void {
  if (!n.anclas || !sesionAbierta.claveAncla) return
  const ancla = n.anclas.get(sesionAbierta.claveAncla)
  if (!ancla || ancla.refs !== 1) return
  if (ancla.estado.tipo === 'anclada') sesionAbierta.conversacionReanudarId = ancla.estado.sesionId
  else if (ancla.estado.tipo === 'dudosa') sesionAbierta.conversacionReanudarId = undefined
}

/**
 * Desde cuándo la sesión está en una conversación VACÍA sin chat conocido: arrancó sin reanudar
 * ('esperando') o lo último fue un `/clear` o `/new` ('dudosa'). Al volver, la más reciente de
 * la carpeta solo es la suya si tuvo actividad desde entonces; si no, se empieza de cero.
 * Undefined si se sabe el chat, la clave es compartida o lo último fue un `/resume` (ese va a
 * una conversación que ya existe: se sigue reanudando la más reciente).
 */
export function sinChatDesde(n: NucleoAgente, sesionAbierta: SesionAgenteAbierta): number | undefined {
  if (!n.anclas || !sesionAbierta.claveAncla || sesionAbierta.conversacionReanudarId) return undefined
  const ancla = n.anclas.get(sesionAbierta.claveAncla)
  if (!ancla || ancla.refs !== 1) return undefined
  if (ancla.estado.tipo === 'esperando') return ancla.estado.desde
  return ancla.estado.tipo === 'dudosa' ? sesionAbierta.chatVacioDesde : undefined
}

/** Lanza sin esperarla la sonda de versión de una sesión nativa y la guarda si sigue vigente. */
export function sondearTrasLanzar(n: NucleoAgente, sesionAbierta: SesionAgenteAbierta): void {
  const sondear = n.sondearVersion
  if (!sondear || !sesionAbierta.host || sesionAbierta.manual) return
  const lanzamiento = sesionAbierta.lanzamiento
  sondear(sesionAbierta.agente as Agente).then(
    (version) => {
      if (n.sesiones.get(sesionAbierta.sesionId) !== sesionAbierta || sesionAbierta.lanzamiento !== lanzamiento) return
      sesionAbierta.versionLanzada = version
      n.alCambiarSesiones()
    },
    (err) => n.log(`sonda de versión (${sesionAbierta.agente}) falló: ${errMsg(err)}`)
  )
}

/** Vigila el transcript de la sesión si hay vigilante y se resolvió su carpeta de credenciales. */
export function vigilarTurnos(
  n: NucleoAgente,
  sesionId: string,
  agente: Agente,
  cuentaId: string,
  host: boolean,
  rutaHostProyecto: string
): void {
  if (!n.turnos) return
  const base = n.obtenerBaseAgente(agente, cuentaId, host)
  if (!base) return
  n.turnos.iniciarVigilancia(sesionId, { base, agente, proyecto: basenameSuelto(rutaHostProyecto) })
}

/**
 * Fija el ancla al abrir o relanzar: con `--resume`, el chat exacto; sin él, «esperando».
 * `retain` solo al abrir (`nueva`): un reload contaría la sesión dos veces.
 */
export function anclarApertura(n: NucleoAgente, clave: string, conversacionReanudarId?: string, nueva = false): void {
  if (!n.anclas || !clave) return
  if (nueva) n.anclas.retener(clave)
  if (conversacionReanudarId) n.anclas.anclar(clave, conversacionReanudarId, 'resume')
  else n.anclas.prepararAncla(clave)
}

/**
 * Traduce lo tecleado a lo que el ancla necesita: cuándo se envió algo y si era un
 * `/clear` o `/resume`. El detector se alimenta siempre (lo pregunta el reinicio masivo).
 */
export function anclarPorEntrada(n: NucleoAgente, sesionAbierta: SesionAgenteAbierta, datos: string): void {
  const linea = sesionAbierta.detectorEnvio.alEscribir(datos)
  if (!n.anclas || !sesionAbierta.claveAncla) return
  // `dudar` reinicia el estado: la marca de envío va después para fecharla con este Enter.
  if (linea !== null && esCambioDeConversacion(linea)) {
    n.anclas.dudar(sesionAbierta.claveAncla)
    // El ÚLTIMO cambio decide: un `/clear` deja una conversación vacía; un `/resume`, una que existe.
    sesionAbierta.chatVacioDesde = esConversacionVacia(linea) ? Date.now() : undefined
  }
  if (esEnvio(datos)) n.anclas.marcarEnvio(sesionAbierta.claveAncla)
}

/**
 * Clave del ancla, o '' si no hay con qué anclar. El proyecto entra por su ruta COMPLETA
 * del host, la misma que usa el lector del anillo: si no casan, el ancla no se encuentra.
 */
export function claveAnclaDe(
  n: NucleoAgente,
  agente: Agente,
  cuentaId: string,
  host: boolean,
  rutaHostProyecto: string
): string {
  if (!n.anclas) return ''
  const base = n.obtenerBaseAgente(agente, cuentaId, host)
  if (!base) return ''
  return claveAncla(agente, base, rutaHostProyecto)
}

/** Ancla y vigila una sesión recién abierta; devuelve su clave de ancla. */
export function anclarNuevaSesion(
  n: NucleoAgente,
  sesionId: string,
  agente: Agente,
  cuentaId: string,
  host: boolean,
  rutaHostProyecto: string,
  conversacionReanudarId: string | undefined
): string {
  const clave = claveAnclaDe(n, agente, cuentaId, host, rutaHostProyecto)
  anclarApertura(n, clave, conversacionReanudarId, true)
  vigilarTurnos(n, sesionId, agente, cuentaId, host, rutaHostProyecto)
  return clave
}

/**
 * Motivo de la muerte de una sesión de contenedor (`diagnosticarPerfil`), enviado con EXIT.
 * Si el diagnóstico falla se envía 'unknown', no 'ok', para que la interfaz avise.
 */
export async function emitirSalidaTerminalAgente(
  n: NucleoAgente,
  perfil: Perfil,
  sesionId: string,
  codigoSalida: number | null
): Promise<void> {
  let motivo: MotivoSalidaAgente = 'ok'
  try {
    motivo = await n.sandbox.diagnosticarPerfil(perfil, codigoSalida)
  } catch (err) {
    n.log(`diagnosticarPerfil error: ${errMsg(err)}`)
    motivo = 'unknown'
  }
  const mensaje: MensajeSalidaAgente = { sessionId: sesionId, codigoSalida, motivo }
  n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, mensaje)
  n.log(`agente EXIT session=${sesionId} exitCode=${codigoSalida} reason=${motivo}`)
}

function emitirActividadTerminalAgente(
  n: NucleoAgente,
  sesionId: string,
  perfilId: string,
  rutaHostProyecto: string,
  agente: Agente,
  estado: EstadoActividadAgente,
  motivo: MotivoEsperaAgente | null
): void {
  const mensaje: MensajeActividadAgente = { sesionId, perfilId, rutaHostProyecto, agente, estado, motivo }
  n.eventos.emitir(AGENT_TERMINAL_CHANNELS.ACTIVITY, mensaje)
  // «Trabajando» bloquea el reinicio masivo: el botón de los agentes nativos se entera aquí.
  if (n.sesiones.get(sesionId)?.host) n.alCambiarSesiones()
}

/** Rastreador de actividad de una sesión, que emite ACTIVITY con la identidad del target. */
export function crearRastreadorSesionAgente(
  n: NucleoAgente,
  sesionId: string,
  perfilId: string,
  rutaHostProyecto: string,
  agente: Agente
): RastreadorActividad {
  return crearRastreadorActividad({
    tickMs: TICK_ACTIVIDAD_MS,
    ticksVentana: TICKS_VENTANA_ACTIVIDAD,
    bytesApertura: BYTES_APERTURA_ACTIVIDAD,
    graciaEcoMs: GRACIA_ECO_ACTIVIDAD_MS,
    ticksSilencio: TICKS_SILENCIO_ACTIVIDAD,
    maxTicksTurno: MAX_TICKS_TURNO_ACTIVIDAD,
    maxCongelacionMs: MAX_SUPRESION_ACTIVIDAD_MS,
    maxPausaMs: MAX_PAUSA_ACTIVIDAD_MS,
    toleranciaMarcaMs: TOLERANCIA_MARCA_ACTIVIDAD_MS,
    programar: realScheduler,
    onCambio: (estado, motivo) => emitirActividadTerminalAgente(n, sesionId, perfilId, rutaHostProyecto, agente, estado, motivo ?? null),
    // Sin respuesta, el agente no informa de su estado y queda la deducción. Se escribe en el acto,
    // antes de que la terminal conteste al `CSI c` que sigue a la sonda (eso sería «no lo entiendo»).
    responderSonda: () => n.terminales.write(sesionId, RESPUESTA_SONDA),
    // Codex informa sin preguntar.
    ...(agente === 'codex' ? { informaSinSonda: 'codex' } : {}),
    // «Espera tu respuesta» no es un estado de actividad: el botón se entera por aquí.
    alCambiarEspera: () => {
      if (n.sesiones.get(sesionId)?.host) n.alCambiarSesiones()
    }
  })
}
