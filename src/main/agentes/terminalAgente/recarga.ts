// =============================================================================
// Reinicio de una sesión del agente conservando su id y sus suscriptores. En contenedor
// vuelve a poner en pie todo (Docker, el contenedor de su cuenta, proyecto, credencial) antes de
// relanzar; en nativo espera el candado de la actualización. La conversación con la que
// corre la sesión manda sobre la que resuelva el renderer.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { construirComandoLanzamientoAgente, construirComandoLanzamientoAgenteNativo } from '../lineaArranqueAgente'
import { briefingCompuesto } from '../briefingCompuesto'
import { hayCuentasParaDelegar } from '../delegacion/cuentasDelegables'
import { prepararCapaCompartida } from '../configAgente/configCompartida'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/erroresDocker'
import type { Agente, Perfil } from '../../perfiles/types'
import type { ResultadoAbrirAgente } from '../../../shared/agent-terminal-ipc'
import { crearDetectorEnvio } from '../lineaEnviada'
import { anclarApertura, sondearTrasLanzar } from './turnos'
import { capasDeSesion, contenedorDe, reservarLoginCodex } from './credenciales'
import { medidasDeProcesoNuevo } from './hibernacion'
import { GRACIA_ARRANQUE_ACTIVIDAD_MS, type NucleoAgente, type SesionAgenteAbierta } from './tipos'
import { esSesionManual, recargarManual } from './aperturaManual'
import { txAgentes } from '../textos.ts'
import { contextoEfectivo } from '../../../shared/contexto'

type Relanzamiento = { comandoLanzamiento: string; extraEnv: Record<string, string> }

/**
 * Relanza el proceso de una sesión. Con `conexionDbIds` se reconstruyen entorno y línea
 * de arranque (así se aplica un cambio de montaje de bases); sin ellos, lo guardado.
 */
export async function recargar(
  n: NucleoAgente,
  sesionId: string,
  conexionDbIds?: string[],
  conversacionReanudarId?: string,
  manual?: unknown
): Promise<ResultadoAbrirAgente> {
  const sesionAbierta = n.sesiones.get(sesionId)
  if (!sesionAbierta) throw new Error(`No existe una sesión de agente con id «${sesionId}».`)
  const perfil = n.perfiles.get(sesionAbierta.perfilId)
  if (!perfil) throw new Error(`Perfil desconocido: «${sesionAbierta.perfilId}».`)
  // Un agente manual no tiene candado de actualización, cuenta ni conversación que fijar.
  if (esSesionManual(sesionAbierta)) return recargarManual(n, sesionAbierta, perfil, conexionDbIds, manual)

  // Nativo: se espera el candado antes de tocar nada, y la sesión pudo cerrarse entretanto.
  if (sesionAbierta.host) {
    await n.esperarCandado(deSerie(sesionAbierta))
    if (n.sesiones.get(sesionId) !== sesionAbierta) {
      throw new Error(txAgentes().manual.cerradaEsperando(sesionId))
    }
  }

  if (sesionAbierta.host) return recargarNativo(n, sesionAbierta, sesionId, conexionDbIds, conversacionReanudarId)
  return recargarEnContenedor(n, sesionAbierta, perfil, sesionId, conexionDbIds, conversacionReanudarId)
}

/** El agente de una sesión de serie: las manuales salen antes por `recargarManual`. */
function deSerie(sesionAbierta: SesionAgenteAbierta): Agente {
  return sesionAbierta.agente as Agente
}

/** Manda el chat de la sesión; el del renderer solo si la sesión arrancó sin reanudar. */
function fijarReanudacion(sesionAbierta: SesionAgenteAbierta, conversacionReanudarId?: string): string | undefined {
  const reanudar = sesionAbierta.conversacionReanudarId ?? conversacionReanudarId
  // El ancla la pone `desarmarParaRelanzar` con este valor, ya justo antes de relanzar.
  if (reanudar) sesionAbierta.conversacionReanudarId = reanudar
  return reanudar
}

/**
 * Desarma la sesión para el proceso nuevo, JUSTO antes de relanzar: si algo falla antes
 * (Docker caído, el contenedor), la sesión sigue con su pty viejo armada y con su ancla.
 */
function desarmarParaRelanzar(n: NucleoAgente, sesionAbierta: SesionAgenteAbierta): void {
  // El turno en vuelo muere con el proceso; la supresión del arranque se abre después.
  sesionAbierta.actividad.terminar()
  // La marca de envío y el `desde` son del proceso viejo: `arm` los reinicia, porque `pin` no
  // toca un ancla que ya está en ese chat y los heredaría (la regla (a) con evidencia vieja).
  if (n.anclas && sesionAbierta.claveAncla && sesionAbierta.conversacionReanudarId) n.anclas.prepararAncla(sesionAbierta.claveAncla)
  // Solo el chat de la sesión, nunca el del renderer: es el que el CLI va a reabrir.
  anclarApertura(n, sesionAbierta.claveAncla, sesionAbierta.conversacionReanudarId)
  sesionAbierta.detectorEnvio = crearDetectorEnvio()
  sesionAbierta.actividad.congelar(GRACIA_ARRANQUE_ACTIVIDAD_MS)
}

/** El aviso de arranque de la sesión al relanzarla: el contexto es el vigente, no el de cuando se abrió. */
function avisoDeArranque(n: NucleoAgente, sesionAbierta: SesionAgenteAbierta, conexionDbIds: string[], enContenedor: boolean): string | null {
  return briefingCompuesto({
    bd: n.obtenerAvisoBd(sesionAbierta.perfilId, sesionAbierta.rutaHostProyecto, conexionDbIds),
    ssh: n.obtenerAvisoSsh(sesionAbierta.perfilId),
    contexto: contextoEfectivo(n.perfiles.get(sesionAbierta.perfilId) ?? {}, n.contextoGlobal()),
    historial: true,
    traspaso: sesionAbierta.avisoTraspaso ?? null,
    enContenedor,
    delegacion: !enContenedor && hayCuentasParaDelegar(n.cuentas, sesionAbierta.perfilId)
  })
}

async function recargarNativo(
  n: NucleoAgente,
  sesionAbierta: SesionAgenteAbierta,
  sesionId: string,
  conexionDbIds: string[] | undefined,
  conversacionReanudarId: string | undefined
): Promise<ResultadoAbrirAgente> {
  const reanudar = fijarReanudacion(sesionAbierta, conversacionReanudarId)
  const foto = conexionDbIds !== undefined && deSerie(sesionAbierta) === 'claude-code' && !!reanudar && (await n.admiteFotoNativa())
  const sustituciones: Relanzamiento | undefined =
    conexionDbIds !== undefined
      ? {
          comandoLanzamiento: construirComandoLanzamientoAgenteNativo(
            n.binarios[deSerie(sesionAbierta)],
            deSerie(sesionAbierta),
            reanudar,
            avisoDeArranque(n, sesionAbierta, conexionDbIds, false),
            undefined,
            undefined,
            foto
          ),
          extraEnv: n.obtenerEntornoHost(sesionAbierta.perfilId, sesionAbierta.rutaHostProyecto, conexionDbIds)
        }
      : undefined
  // Token nuevo: `bind` suelta el anterior de esta sesión.
  if (sustituciones) n.vincularSesionDb(sustituciones.extraEnv, claveSesionAgente(sesionId))
  desarmarParaRelanzar(n, sesionAbierta)
  const sesion = await n.terminales.recargarSesion(sesionId, sustituciones)
  n.log(`reload [NATIVO] OK -> id=${sesion.id} bd=${conexionDbIds?.length ?? '(sin cambio)'}`)
  // Proceso nuevo, quizá con otro binario: su versión es desconocida hasta la sonda.
  Object.assign(sesionAbierta, medidasDeProcesoNuevo(n))
  sesionAbierta.lanzamiento++
  sesionAbierta.versionLanzada = null
  sondearTrasLanzar(n, sesionAbierta)
  n.alCambiarSesiones()
  return {
    sesionId: sesion.id,
    perfilId: sesionAbierta.perfilId,
    agente: sesionAbierta.agente,
    cuentaId: sesionAbierta.cuentaId,
    rutaHostProyecto: sesion.proyecto,
    rutaWorkspace: sesion.rutaWorkspace,
    rutaContenedorConfig: ''
  }
}

/** Entorno y línea de arranque reconstruidos con la credencial ya montada, y el token atado. */
function relanzamientoContenedor(
  n: NucleoAgente,
  sesionAbierta: SesionAgenteAbierta,
  sesionId: string,
  rutaContenedorConfig: string,
  conCapa: boolean,
  conexionDbIds: string[],
  conversacionReanudarId: string | undefined
): Relanzamiento {
  const reanudar = fijarReanudacion(sesionAbierta, conversacionReanudarId)
  const extraEnv = n.obtenerEntornoContenedor(sesionAbierta.perfilId, sesionAbierta.rutaHostProyecto, conexionDbIds, n.sandbox.dbBridgeContainerPath)
  const sustituciones: Relanzamiento = {
    comandoLanzamiento: construirComandoLanzamientoAgente(
      n.binarios[deSerie(sesionAbierta)],
      deSerie(sesionAbierta),
      rutaContenedorConfig,
      reanudar,
      extraEnv,
      avisoDeArranque(n, sesionAbierta, conexionDbIds, true),
      undefined,
      conCapa
    ),
    extraEnv
  }
  n.vincularSesionDb(extraEnv, claveSesionAgente(sesionId))
  return sustituciones
}

async function recargarEnContenedor(
  n: NucleoAgente,
  sesionAbierta: SesionAgenteAbierta,
  perfil: Perfil,
  sesionId: string,
  conexionDbIds: string[] | undefined,
  conversacionReanudarId: string | undefined
): Promise<ResultadoAbrirAgente> {
  const docker = await n.sandbox.asegurarDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)

  const cuenta = n.cuentas.obtener(sesionAbierta.cuentaId)
  if (!cuenta) throw new Error(`Cuenta de agente desconocida: «${sesionAbierta.cuentaId}».`)
  // Relanzar una cuenta sin credencial vuelve a iniciar sesión: la misma regla que al abrir.
  reservarLoginCodex(n, perfil, sesionAbierta.agente, cuenta, sesionId)

  const destino = contenedorDe(perfil, sesionAbierta.agente, cuenta.id)
  await n.sandbox.ensureContainer(destino)
  await n.sandbox.addProject(destino, sesionAbierta.rutaHostProyecto)
  const dirConfigHost = n.cuentas.dirHostDe(cuenta)
  const montajeCfg = await n.sandbox.mountAgentConfig(destino, sesionAbierta.agente, cuenta.id, dirConfigHost)
  // La capa compartida, como al abrir: la vigente, no la de cuando se abrió.
  const agente = deSerie(sesionAbierta)
  const conCapa = agente === 'claude-code' || agente === 'codex' ? await prepararCapaCompartida(dirConfigHost, agente, capasDeSesion(n, perfil, agente, cuenta.id), (m) => n.log(m)) : false

  // Sin lista de montajes (el reintento automático tras una caída) se relanza lo guardado.
  const sustituciones =
    conexionDbIds !== undefined
      ? relanzamientoContenedor(n, sesionAbierta, sesionId, montajeCfg.containerPath, conCapa, conexionDbIds, conversacionReanudarId)
      : undefined

  desarmarParaRelanzar(n, sesionAbierta)
  const sesion = await n.terminales.recargarSesion(sesionId, sustituciones)
  n.log(`reload OK -> id=${sesion.id} cfg=${montajeCfg.containerPath} (host=${dirConfigHost})`)
  Object.assign(sesionAbierta, medidasDeProcesoNuevo(n))
  return {
    sesionId: sesion.id,
    perfilId: sesionAbierta.perfilId,
    agente: sesionAbierta.agente,
    cuentaId: sesionAbierta.cuentaId,
    rutaHostProyecto: sesion.proyecto,
    rutaWorkspace: sesion.rutaWorkspace,
    rutaContenedorConfig: montajeCfg.containerPath
  }
}
