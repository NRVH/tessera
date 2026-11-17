// =============================================================================
// Apertura y recarga de un agente MANUAL: el comando que definió el usuario, en el contenedor de
// su cuenta (con la carpeta de la cuenta montada como su `HOME`, como las credenciales de los de
// serie) o en la shell nativa. Sin conversaciones, turnos, sonda de versión ni aviso por opción
// de arranque: lo que Tessera no sabe leer de un CLI que no conoce.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { construirComandoLanzamientoAgenteManual } from '../lineaArranqueAgente'
import { crearRastreadorInerte } from '../actividadAgente'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/erroresDocker'
import { invocacionAgenteManual, validarDefinicion, type DefinicionAgente } from '../../../shared/agentesManuales'
import type { Perfil } from '../../perfiles/types'
import { AGENT_TERMINAL_CHANNELS, type MensajeDatosAgente, type MensajeSalidaAgente,type PeticionAbrirAgente, type ResultadoAbrirAgente } from '../../../shared/agent-terminal-ipc'
import { crearDetectorEnvio } from '../lineaEnviada'
import { txAgentes } from '../textos.ts'
import { adquirirRefConfig, claveRefConfig, contenedorDe, releaseConfigRef } from './credenciales'
import { conSitio, mientrasSeAbre } from './cupo'
import type { PoliticaCupo } from '../../../shared/semaforoContenedores'
import { emitirSalidaTerminalAgente } from './turnos'
import { marcarEs, medidasDeProcesoNuevo, motivoSalidaNativa } from './hibernacion'
import { CUENTA_HOST_ID, errMsg, type NucleoAgente, type SesionAgenteAbierta } from './tipos'

/** ¿Es la sesión de un agente manual? (Estrecha el tipo para no repetir la comprobación.) */
export function esSesionManual(sesionAbierta: SesionAgenteAbierta): sesionAbierta is SesionAgenteAbierta & { manual: DefinicionAgente } {
  // `!= null`: una sesión de serie sin el campo (`undefined`) tampoco es manual.
  return sesionAbierta.manual != null
}

/** La definición que llega con la petición, validada otra vez aquí: el main no se fía del renderer. */
export function definicionDePeticion(req: PeticionAbrirAgente): DefinicionAgente {
  const r = validarDefinicion(req.manual, req.modo !== 'host')
  if (!r.ok) throw new Error(txAgentes().manual.noValido(r.error))
  if (r.valor.id !== req.agente) throw new Error(txAgentes().manual.definicionAjena(req.agente))
  return r.valor
}

function suscribirDatos(n: NucleoAgente, sesionId: string): () => void {
  return n.terminales.onData(sesionId, (datos) => {
    const mensaje: MensajeDatosAgente = { sessionId: sesionId, data: datos }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.DATA, mensaje)
    marcarEs(n, sesionId)
  })
}

type DatosManual = Pick<SesionAgenteAbierta, 'sesionId' | 'perfilId' | 'cuentaId' | 'rutaHostProyecto' | 'host' | 'manual' | 'homeManual'> & {
  manual: DefinicionAgente
}

/** La sesión de un agente manual: rastreador inerte y sin ancla de conversación. */
function sesionManual(n: NucleoAgente, d: DatosManual, desuscribirDatos: () => void, desuscribirSalida: () => void): SesionAgenteAbierta {
  return {
    ...d,
    agente: d.manual.id,
    actividad: crearRastreadorInerte(),
    claveAncla: '',
    detectorEnvio: crearDetectorEnvio(),
    versionLanzada: null,
    lanzamiento: 1,
    ...medidasDeProcesoNuevo(n),
    desuscribirDatos,
    desuscribirSalida
  }
}

/** Abre un agente manual; en el contenedor toma el refcount de su carpeta antes de tocar Docker. */
export async function abrirManual(n: NucleoAgente, perfil: Perfil, req: PeticionAbrirAgente): Promise<ResultadoAbrirAgente> {
  const def = definicionDePeticion(req)
  const reanudar = req.reanudarManual !== false
  if (req.modo === 'host') return abrirManualNativo(n, perfil, def, req, reanudar)
  // La cuenta elegida, si es de este agente en este perfil; sin ninguna, la predeterminada.
  const cuenta = n.cuentas.cuentaManual(perfil.id, def.id, req.cuentaId).id
  const claveCfg = claveRefConfig(perfil.id, def.id, cuenta)
  adquirirRefConfig(n.configRefs, claveCfg)
  try {
    return await mientrasSeAbre(contenedorDe(perfil, def.id, cuenta).id, () =>
      abrirManualEnContenedor(n, perfil, def, req, reanudar, cuenta)
    )
  } catch (err) {
    if (releaseConfigRef(n.configRefs, claveCfg)) {
      await n.sandbox
        .unmountAgentConfig(contenedorDe(perfil, def.id, cuenta), def.id, cuenta)
        .catch((e) => n.log(`rollback del agente manual: ${errMsg(e)}`))
    }
    throw err
  }
}

/** Su contenedor, el proyecto y la carpeta de la cuenta montada; devuelve dónde quedó (su `HOME`). */
async function prepararContenedorManual(
  n: NucleoAgente,
  perfil: Perfil,
  def: DefinicionAgente,
  rutaHostProyecto: string,
  cuenta: string,
  cupo?: PoliticaCupo
): Promise<{ proyecto: string; home: string }> {
  const docker = await n.sandbox.asegurarDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)
  const destino = contenedorDe(perfil, def.id, cuenta)
  await conSitio(n, destino, cupo, () => n.sandbox.ensureContainer(destino))
  const montaje = await n.sandbox.addProject(destino, rutaHostProyecto)
  const carpeta = n.cuentas.dirHostDe(n.cuentas.cuentaManual(perfil.id, def.id, cuenta))
  const cfg = await n.sandbox.mountAgentConfig(destino, def.id, cuenta, carpeta)
  return { proyecto: montaje.projectHostPath, home: cfg.containerPath }
}

async function abrirManualEnContenedor(
  n: NucleoAgente,
  perfil: Perfil,
  def: DefinicionAgente,
  req: PeticionAbrirAgente,
  reanudar: boolean,
  cuenta: string
): Promise<ResultadoAbrirAgente> {
  const preparado = await prepararContenedorManual(n, perfil, def, req.rutaHostProyecto, cuenta, req.cupo)
  const extraEnv = n.obtenerEntornoContenedor(perfil.id, req.rutaHostProyecto, req.conexionDbIds ?? [], n.sandbox.dbBridgeContainerPath)
  const comandoLanzamiento = construirComandoLanzamientoAgenteManual(invocacionAgenteManual(def, reanudar), preparado.home, extraEnv)
  const destino = contenedorDe(perfil, def.id, cuenta)
  const sesion = await n.terminales.crearSesion(destino, { proyecto: req.rutaHostProyecto, comandoLanzamiento, extraEnv, tamano: req.tamano })
  n.vincularSesionDb(extraEnv, claveSesionAgente(sesion.id))
  n.sandbox.retainSession(destino.id, claveSesionAgente(sesion.id))
  n.log(`open() [MANUAL] perfil=${perfil.id} agente=${def.id} id=${sesion.id} home=${preparado.home}`)
  const desuscribirDatos = suscribirDatos(n, sesion.id)
  const desuscribirSalida = n.terminales.onExit(sesion.id, (codigoSalida) => void emitirSalidaTerminalAgente(n, destino, sesion.id, codigoSalida))
  const datos = {
    sesionId: sesion.id,
    perfilId: perfil.id,
    cuentaId: cuenta,
    rutaHostProyecto: req.rutaHostProyecto,
    host: false,
    manual: def,
    homeManual: preparado.home
  }
  n.sesiones.set(sesion.id, sesionManual(n, datos, desuscribirDatos, desuscribirSalida))
  return {
    sesionId: sesion.id,
    perfilId: perfil.id,
    agente: def.id,
    cuentaId: cuenta,
    rutaHostProyecto: preparado.proyecto,
    rutaWorkspace: sesion.rutaWorkspace,
    rutaContenedorConfig: preparado.home
  }
}

async function abrirManualNativo(
  n: NucleoAgente,
  perfil: Perfil,
  def: DefinicionAgente,
  req: PeticionAbrirAgente,
  reanudar: boolean
): Promise<ResultadoAbrirAgente> {
  const extraEnv = n.obtenerEntornoHost(perfil.id, req.rutaHostProyecto, req.conexionDbIds ?? [])
  const comandoLanzamiento = invocacionAgenteManual(def, reanudar)
  const sesion = await n.terminales.crearSesion(perfil, { proyecto: req.rutaHostProyecto, comandoLanzamiento, host: true, extraEnv, tamano: req.tamano })
  n.vincularSesionDb(extraEnv, claveSesionAgente(sesion.id))
  n.log(`open() [MANUAL NATIVO] perfil=${perfil.id} agente=${def.id} id=${sesion.id}`)
  const desuscribirDatos = suscribirDatos(n, sesion.id)
  const desuscribirSalida = n.terminales.onExit(sesion.id, (codigoSalida) => {
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, { sessionId: sesion.id, codigoSalida, motivo: motivoSalidaNativa(n, codigoSalida) } satisfies MensajeSalidaAgente)
    n.alCambiarSesiones()
  })
  const datos = { sesionId: sesion.id, perfilId: perfil.id, cuentaId: CUENTA_HOST_ID, rutaHostProyecto: req.rutaHostProyecto, host: true, manual: def }
  n.sesiones.set(sesion.id, sesionManual(n, datos, desuscribirDatos, desuscribirSalida))
  n.alCambiarSesiones()
  return {
    sesionId: sesion.id,
    perfilId: perfil.id,
    agente: def.id,
    cuentaId: CUENTA_HOST_ID,
    rutaHostProyecto: req.rutaHostProyecto,
    rutaWorkspace: sesion.rutaWorkspace,
    rutaContenedorConfig: ''
  }
}

/** La definición editada que llega con el reinicio, validada otra vez; sin ella, la de la sesión. */
function adoptarDefinicion(sesionAbierta: SesionAgenteAbierta & { manual: DefinicionAgente }, nueva: unknown): void {
  if (nueva === undefined || nueva === null) return
  const r = validarDefinicion(nueva, !sesionAbierta.host)
  if (!r.ok) throw new Error(txAgentes().manual.noValido(r.error))
  if (r.valor.id !== sesionAbierta.manual.id) throw new Error(txAgentes().manual.definicionAjena(sesionAbierta.manual.id))
  sesionAbierta.manual = r.valor
}

/**
 * Relanza un agente manual reanudando SIEMPRE (recargar no es empezar de cero), con la
 * definición de ahora (reiniciar aplica lo editado) y, en el contenedor, volviendo a poner en
 * pie Docker, el proyecto y su carpeta antes.
 */
export async function recargarManual(
  n: NucleoAgente,
  sesionAbierta: SesionAgenteAbierta & { manual: DefinicionAgente },
  perfil: Perfil,
  conexionDbIds?: string[],
  nueva?: unknown
): Promise<ResultadoAbrirAgente> {
  adoptarDefinicion(sesionAbierta, nueva)
  const ids = conexionDbIds ?? []
  let comandoLanzamiento: string
  let extraEnv: Record<string, string>
  let home = ''
  if (sesionAbierta.host) {
    extraEnv = n.obtenerEntornoHost(sesionAbierta.perfilId, sesionAbierta.rutaHostProyecto, ids)
    comandoLanzamiento = invocacionAgenteManual(sesionAbierta.manual, true)
  } else {
    home = (await prepararContenedorManual(n, perfil, sesionAbierta.manual, sesionAbierta.rutaHostProyecto, sesionAbierta.cuentaId)).home
    sesionAbierta.homeManual = home
    extraEnv = n.obtenerEntornoContenedor(sesionAbierta.perfilId, sesionAbierta.rutaHostProyecto, ids, n.sandbox.dbBridgeContainerPath)
    comandoLanzamiento = construirComandoLanzamientoAgenteManual(invocacionAgenteManual(sesionAbierta.manual, true), home, extraEnv)
  }
  n.vincularSesionDb(extraEnv, claveSesionAgente(sesionAbierta.sesionId))
  const sesion = await n.terminales.recargarSesion(sesionAbierta.sesionId, { comandoLanzamiento, extraEnv })
  Object.assign(sesionAbierta, medidasDeProcesoNuevo(n))
  sesionAbierta.lanzamiento++
  n.log(`reload [MANUAL] OK -> id=${sesion.id} agente=${sesionAbierta.manual.id}`)
  return {
    sesionId: sesion.id,
    perfilId: sesionAbierta.perfilId,
    agente: sesionAbierta.manual.id,
    cuentaId: sesionAbierta.cuentaId,
    rutaHostProyecto: sesion.proyecto,
    rutaWorkspace: sesion.rutaWorkspace,
    rutaContenedorConfig: home
  }
}
