// =============================================================================
// Apertura de una sesión del agente: en el contenedor de su cuenta (cuenta, refcount de la
// credencial ANTES de tocar Docker, contenedor, montajes, memoria del sandbox, línea de
// arranque bajo `env -i`) o nativa en el host (candado de la actualización y shell nativa).
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { construirComandoLanzamientoAgente, construirComandoLanzamientoAgenteNativo } from '../lineaArranqueAgente'
import { briefingCompuesto } from '../briefingCompuesto'
import { hayCuentasParaDelegar } from '../delegacion/cuentasDelegables'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { escribirBloqueSandbox } from '../memoriaSandbox'
import { prepararCapaCompartida } from '../configAgente/configCompartida'
import { contextoEfectivo } from '../../../shared/contexto'
import { AGENTES_DISPONIBLES, type Agente, type Perfil } from '../../perfiles/types'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/erroresDocker'
import {
  AGENT_TERMINAL_CHANNELS,
  type MensajeDatosAgente,
  type MensajeSalidaAgente,
  type PeticionAbrirAgente,
  type ResultadoAbrirAgente
} from '../../../shared/agent-terminal-ipc'
import type { CuentaAgente } from '../../../shared/agent-accounts-ipc'
import type { RastreadorActividad } from '../actividadAgente'
import { crearDetectorEnvio } from '../lineaEnviada'
import { adquirirRefConfig, alVerLoginCodex, capasDeSesion, claveRefConfig, contenedorDe, releaseConfigRef, reservarLoginCodex } from './credenciales'
import { crearDetectorLoginCodex } from '../loginCodex'
import { conSitio, mientrasSeAbre } from './cupo'
import { anclarNuevaSesion, emitirSalidaTerminalAgente, crearRastreadorSesionAgente, sondearTrasLanzar } from './turnos'
import { marcarEs, medidasDeProcesoNuevo, motivoSalidaNativa } from './hibernacion'
import { GRACIA_ARRANQUE_ACTIVIDAD_MS, CUENTA_HOST_ID, errMsg, esDeVentanaAgente, type NucleoAgente, type SesionAgenteAbierta } from './tipos'
import { abrirManual } from './aperturaManual'
import type { TraspasoPendiente } from '../../traspaso/RegistroTraspasos'
import { txTraspaso } from '../../traspaso/textos'
import { MARCA_TRASPASO_CADUCADO } from '../../../shared/traspaso-ipc'
import { esAgenteManual } from '../../../shared/agentesManuales'

type DatosSesion = Omit<
  SesionAgenteAbierta,
  'detectorEnvio' | 'versionLanzada' | 'lanzamiento' | 'ultimaEsEn' | 'lanzadaEn' | 'segundoPlano'
>

/** Sesión recién lanzada: detector nuevo, primer lanzamiento y versión aún desconocida. */
function sesionNueva(n: NucleoAgente, datos: DatosSesion): SesionAgenteAbierta {
  return {
    ...datos,
    detectorEnvio: crearDetectorEnvio(),
    versionLanzada: null,
    lanzamiento: 1,
    ...medidasDeProcesoNuevo(n)
  }
}

/**
 * Reenvía la salida del pty al renderer y al rastreador de actividad, y apunta la E/S. Con
 * `verLogin` (Codex en contenedor), mira además si Codex empezó un login por navegador.
 */
function suscribirDatos(n: NucleoAgente, sesionId: string, actividad: RastreadorActividad, verLogin = false): () => void {
  const detector = verLogin ? crearDetectorLoginCodex() : null
  return n.terminales.onData(sesionId, (datos) => {
    const mensaje: MensajeDatosAgente = { sessionId: sesionId, data: datos }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.DATA, mensaje)
    actividad.onDatos(datos)
    marcarEs(n, sesionId)
    if (detector?.(datos)) alVerLoginCodex(n, sesionId)
  })
}

/** La cuenta pedida o la predeterminada del (perfil, agente); nunca la de otro perfil. */
function resolverCuenta(n: NucleoAgente, perfil: Perfil, agente: Agente, req: PeticionAbrirAgente): CuentaAgente {
  const cuenta = req.cuentaId ? n.cuentas.obtener(req.cuentaId) : n.cuentas.predeterminadaDe(perfil.id, agente)
  if (!cuenta) throw new Error(`Cuenta de agente desconocida: "${req.cuentaId}".`)
  if (cuenta.agente !== agente) {
    throw new Error(`La cuenta "${cuenta.id}" no es del agente "${agente}".`)
  }
  if (cuenta.global !== true && cuenta.profileId !== perfil.id) {
    throw new Error(`La cuenta "${cuenta.id}" no pertenece al perfil "${perfil.id}".`)
  }
  return cuenta
}

/**
 * Una petición de una ventana de agente, impuesta por el main: siempre nativa, en la carpeta del
 * usuario y sin bases, pida lo que pida el renderer.
 */
function peticionDeVentana(n: NucleoAgente, req: PeticionAbrirAgente): PeticionAbrirAgente {
  return { ...req, modo: 'host', rutaHostProyecto: n.carpetaVentana(), conexionDbIds: [], cuentaId: undefined }
}

/**
 * Abre una sesión de agente y la apunta a la ventana que la pidió. El dueño se fija en la misma
 * tanda de microtareas en que la sesión entra en el mapa, antes de que el pty entregue nada.
 */
export async function abrir(n: NucleoAgente, req: PeticionAbrirAgente, ventana?: number): Promise<ResultadoAbrirAgente> {
  const pedida = esDeVentanaAgente(req.perfilId) ? peticionDeVentana(n, req) : req
  const res = await abrirSinDueno(n, pedida)
  const sesionAbierta = n.sesiones.get(res.sesionId)
  if (sesionAbierta && ventana !== undefined) sesionAbierta.ventana = ventana
  return res
}

/**
 * Abre una sesión de agente. En contenedor, el refcount de la credencial se toma antes
 * del primer `await` de Docker y se devuelve (desmontando si era la última) si falla.
 */
async function abrirSinDueno(n: NucleoAgente, req: PeticionAbrirAgente): Promise<ResultadoAbrirAgente> {
  const perfil = n.perfiles.get(req.perfilId)
  if (!perfil) throw new Error(`Perfil desconocido: "${req.perfilId}".`)
  if (esAgenteManual(req.agente)) return abrirManual(n, perfil, req)
  const agente = req.agente as Agente
  if (!AGENTES_DISPONIBLES.includes(agente)) {
    throw new Error(`Agente desconocido: "${agente}".`)
  }
  if (req.modo === 'host') return abrirNativo(n, perfil, agente, req)

  const cuenta = resolverCuenta(n, perfil, agente, req)
  n.log(`open() perfil=${perfil.id} agente=${agente} cuenta=${cuenta.id} proyecto=${req.rutaHostProyecto}`)

  // Antes de tocar Docker: si otra cuenta está iniciando sesión en Codex, esta no se abre.
  const login = reservarLoginCodex(n, perfil, agente, cuenta)
  const claveCfg = claveRefConfig(perfil.id, agente, cuenta.id)
  adquirirRefConfig(n.configRefs, claveCfg)
  try {
    const res = await mientrasSeAbre(contenedorDe(perfil, agente, cuenta.id).id, () => abrirEnContenedor(n, perfil, agente, cuenta, req))
    login?.asignar(res.sesionId)
    return res
  } catch (err) {
    login?.soltar()
    if (releaseConfigRef(n.configRefs, claveCfg)) {
      try {
        await n.sandbox.unmountAgentConfig(contenedorDe(perfil, agente, cuenta.id), agente, cuenta.id)
      } catch (errorDesmontaje) {
        n.log(`open() rollback unmountAgentConfig error: ${errMsg(errorDesmontaje)}`)
      }
    }
    throw err
  }
}

/**
 * El contenedor de la cuenta, el proyecto, la credencial montada y la memoria del sandbox que el CLI lee al arrancar.
 * También lo usa una tarea delegada (`agents/delegacion/`), que corre en el mismo contenedor que la pestaña.
 */
export async function prepararContenedor(
  n: NucleoAgente,
  perfil: Perfil,
  agente: Agente,
  cuenta: CuentaAgente,
  req: PeticionAbrirAgente
): Promise<{ rutaHostProyecto: string; rutaContenedorConfig: string; conCapa: boolean }> {
  const docker = await n.sandbox.asegurarDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)

  const destino = contenedorDe(perfil, agente, cuenta.id)
  await conSitio(n, destino, req.cupo, () => n.sandbox.ensureContainer(destino))

  const montaje = await n.sandbox.addProject(destino, req.rutaHostProyecto)

  const dirConfigHost = n.cuentas.dirHostDe(cuenta)
  const montajeCfg = await n.sandbox.mountAgentConfig(destino, agente, cuenta.id, dirConfigHost)
  n.log(`mountAgentConfig OK -> ${agente}/${cuenta.id} => ${montajeCfg.containerPath} (host=${dirConfigHost})`)

  // Antes de que arranque el CLI: lee su configuración al empezar.
  const conCapa = agente === 'claude-code' || agente === 'codex' ? await prepararCapaCompartida(dirConfigHost, agente, capasDeSesion(n, perfil, agente, cuenta.id), (m) => n.log(m)) : false

  // Las capacidades se preguntan al contenedor vivo (su imagen), no a los ajustes.
  const capacidades = await n.sandbox.capacidades(destino)
  escribirBloqueSandbox(
    dirConfigHost,
    agente,
    {
      puedeInstalar: capacidades.puedeInstalar,
      horneados: capacidades.extras.apt,
      depsNavegador: capacidades.extras.depsNavegador
    },
    (m) => n.log(m)
  )
  return { rutaHostProyecto: montaje.projectHostPath, rutaContenedorConfig: montajeCfg.containerPath, conCapa }
}

/**
 * El de bases tal cual delante y, detrás, el de SSH (también en Docker hay `tssh`, por el buzón del puente) y
 * el contexto (reglas globales y del perfil, documentos), que se lee del perfil vivo y del global al abrir.
 */
function avisoDeArranque(
  n: NucleoAgente,
  perfil: Perfil,
  rutaHostProyecto: string,
  dbIds: string[],
  traspaso: TraspasoPendiente | null,
  enContenedor: boolean
): string | null {
  return briefingCompuesto({
    bd: n.obtenerAvisoBd(perfil.id, rutaHostProyecto, dbIds),
    ssh: n.obtenerAvisoSsh(perfil.id),
    contexto: contextoEfectivo(perfil, n.contextoGlobal()),
    historial: true,
    traspaso: traspaso?.aviso ?? null,
    enContenedor,
    // Solo delega una sesión nativa, y solo hay a quién si el perfil tiene una cuenta de Docker con sesión.
    delegacion: !enContenedor && hayCuentasParaDelegar(n.cuentas, perfil.id)
  })
}

/**
 * Toma el traspaso de «Continuar en…» de esta apertura, si la petición lo trae. Uno que no existe, que caducó,
 * que ya tomó otra apertura o que es de otra apertura falla: abrir un chat sin él dejaría al usuario sin el
 * trabajo que pidió continuar, y sin saberlo.
 */
function traspasoDe(n: NucleoAgente, perfil: Perfil, agente: Agente, req: PeticionAbrirAgente): TraspasoPendiente | null {
  if (!req.traspasoId || !n.traspasos) return null
  const t = n.traspasos.reservar(req.traspasoId, { profileId: perfil.id, projectHostPath: req.rutaHostProyecto, agente })
  if (!t) throw new Error(`${MARCA_TRASPASO_CADUCADO}: ${txTraspaso().caducado}`)
  return t
}

/** Corre lo que crea la sesión; si falla, el traspaso vuelve a estar pendiente para el reintento. */
async function devolviendoSiFalla<T>(n: NucleoAgente, req: PeticionAbrirAgente, traspaso: TraspasoPendiente | null, crear: () => Promise<T> | T): Promise<T> {
  try {
    return await crear()
  } catch (err) {
    if (traspaso && req.traspasoId) n.traspasos?.devolver(req.traspasoId)
    throw err
  }
}

/** La sesión ya existe: el traspaso se gasta y lo que leerá `tctx traspaso` queda atado a ella. */
function consumirTraspaso(n: NucleoAgente, req: PeticionAbrirAgente, traspaso: TraspasoPendiente | null, sesionId: string): void {
  if (traspaso && req.traspasoId) n.traspasos?.consumir(req.traspasoId, claveSesionAgente(sesionId))
}

/** La línea de arranque en el contenedor, con el aviso (y el primer mensaje del traspaso, si lo hay). */
function lineaEnContenedor(
  n: NucleoAgente,
  perfil: Perfil,
  agente: Agente,
  req: PeticionAbrirAgente,
  o: { rutaConfig: string; conCapa: boolean; extraEnv: Record<string, string>; traspaso: TraspasoPendiente | null }
): string {
  const aviso = avisoDeArranque(n, perfil, req.rutaHostProyecto, req.conexionDbIds ?? [], o.traspaso, true)
  return construirComandoLanzamientoAgente(n.binarios[agente], agente, o.rutaConfig, req.conversacionReanudarId, o.extraEnv, aviso, o.traspaso?.promptInicial, o.conCapa)
}

async function abrirEnContenedor(
  n: NucleoAgente,
  perfil: Perfil,
  agente: Agente,
  cuenta: CuentaAgente,
  req: PeticionAbrirAgente
): Promise<ResultadoAbrirAgente> {
  const preparado = await prepararContenedor(n, perfil, agente, cuenta, req)
  const destino = contenedorDe(perfil, agente, cuenta.id)
  // Antes de `launch`: la línea corre bajo `env -i` y tiene que llevar estas variables dentro.
  const extraEnv = n.obtenerEntornoContenedor(perfil.id, req.rutaHostProyecto, req.conexionDbIds ?? [], n.sandbox.dbBridgeContainerPath)
  const traspaso = traspasoDe(n, perfil, agente, req)
  const sesion = await devolviendoSiFalla(n, req, traspaso, () => {
    const comandoLanzamiento = lineaEnContenedor(n, perfil, agente, req, { rutaConfig: preparado.rutaContenedorConfig, conCapa: preparado.conCapa, extraEnv, traspaso })
    return n.terminales.crearSesion(destino, { proyecto: req.rutaHostProyecto, comandoLanzamiento, extraEnv, tamano: req.tamano })
  })
  n.vincularSesionDb(extraEnv, claveSesionAgente(sesion.id))
  consumirTraspaso(n, req, traspaso, sesion.id)
  // Refcount del contenedor con clave `agent:` para no chocar con la terminal de abajo.
  n.sandbox.retainSession(destino.id, claveSesionAgente(sesion.id))
  n.log(`crearSesion OK -> id=${sesion.id} cwd=${sesion.rutaWorkspace}`)

  const actividad = crearRastreadorSesionAgente(n, sesion.id, perfil.id, req.rutaHostProyecto, agente)
  actividad.congelar(GRACIA_ARRANQUE_ACTIVIDAD_MS)
  const desuscribirDatos = suscribirDatos(n, sesion.id, actividad, agente === 'codex')
  const desuscribirSalida = n.terminales.onExit(sesion.id, (codigoSalida) => {
    // Cierra el turno en silencio: una muerte no es novedad que revisar.
    actividad.terminar()
    void emitirSalidaTerminalAgente(n, destino, sesion.id, codigoSalida)
  })

  const clave = anclarNuevaSesion(n, sesion.id, agente, cuenta.id, false, req.rutaHostProyecto, req.conversacionReanudarId)
  n.sesiones.set(
    sesion.id,
    sesionNueva(n, {
      sesionId: sesion.id,
      perfilId: perfil.id,
      agente,
      cuentaId: cuenta.id,
      rutaHostProyecto: req.rutaHostProyecto,
      host: false,
      conversacionReanudarId: req.conversacionReanudarId,
      ...(traspaso?.aviso ? { avisoTraspaso: traspaso.aviso } : {}),
      claveAncla: clave,
      manual: null,
      actividad,
      desuscribirDatos,
      desuscribirSalida
    })
  )

  return {
    sesionId: sesion.id,
    perfilId: perfil.id,
    agente,
    cuentaId: cuenta.id,
    rutaHostProyecto: preparado.rutaHostProyecto,
    rutaWorkspace: sesion.rutaWorkspace,
    rutaContenedorConfig: preparado.rutaContenedorConfig
  }
}

/** Salida de una sesión nativa: sin contenedor que diagnosticar; si terminó mal con poca memoria, se dice. */
function suscribirSalidaNativa(n: NucleoAgente, sesionId: string, actividad: RastreadorActividad): () => void {
  return n.terminales.onExit(sesionId, (codigoSalida) => {
    actividad.terminar()
    const mensaje: MensajeSalidaAgente = { sessionId: sesionId, codigoSalida, motivo: motivoSalidaNativa(n, codigoSalida) }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, mensaje)
    n.log(`agente [NATIVO] EXIT session=${sesionId} exitCode=${codigoSalida}`)
    n.alCambiarSesiones()
  })
}

/** Sesión nativa del host con la cuenta personal: sin Docker, cuentas ni montajes. */
async function abrirNativo(
  n: NucleoAgente,
  perfil: Perfil,
  agente: Agente,
  req: PeticionAbrirAgente
): Promise<ResultadoAbrirAgente> {
  const dbIds = req.conexionDbIds ?? []
  n.log(`open() [NATIVO] perfil=${perfil.id} agente=${agente} proyecto=${req.rutaHostProyecto} bd=${dbIds.length}`)
  // El candado va lo primero, antes de acuñar tokens o entornos que la espera envejecería.
  await n.esperarCandado(agente)
  const traspaso = traspasoDe(n, perfil, agente, req)
  const { sesion, extraEnv } = await devolviendoSiFalla(n, req, traspaso, async () => {
    const briefing = avisoDeArranque(n, perfil, req.rutaHostProyecto, dbIds, traspaso, false)
    // Solo se sondea al reanudar Claude Code: es lo único que lo necesita.
    const foto = agente === 'claude-code' && !!req.conversacionReanudarId && (await n.admiteFotoNativa())
    const comandoLanzamiento = construirComandoLanzamientoAgenteNativo(n.binarios[agente], agente, req.conversacionReanudarId, briefing, undefined, traspaso?.promptInicial, foto)
    const env = n.obtenerEntornoHost(perfil.id, req.rutaHostProyecto, dbIds)
    return { extraEnv: env, sesion: await n.terminales.crearSesion(perfil, { proyecto: req.rutaHostProyecto, comandoLanzamiento, host: true, extraEnv: env, tamano: req.tamano }) }
  })
  n.vincularSesionDb(extraEnv, claveSesionAgente(sesion.id))
  consumirTraspaso(n, req, traspaso, sesion.id)
  n.log(`crearSesion [NATIVO] OK -> id=${sesion.id} cwd=${sesion.rutaWorkspace}`)

  const actividad = crearRastreadorSesionAgente(n, sesion.id, perfil.id, req.rutaHostProyecto, agente)
  actividad.congelar(GRACIA_ARRANQUE_ACTIVIDAD_MS)
  const desuscribirDatos = suscribirDatos(n, sesion.id, actividad)
  const desuscribirSalida = suscribirSalidaNativa(n, sesion.id, actividad)

  const claveHost = anclarNuevaSesion(n, sesion.id, agente, CUENTA_HOST_ID, true, req.rutaHostProyecto, req.conversacionReanudarId)
  const nueva = sesionNueva(n, {
    sesionId: sesion.id,
    perfilId: perfil.id,
    agente,
    cuentaId: CUENTA_HOST_ID,
    rutaHostProyecto: req.rutaHostProyecto,
    host: true,
    conversacionReanudarId: req.conversacionReanudarId,
    ...(traspaso?.aviso ? { avisoTraspaso: traspaso.aviso } : {}),
    claveAncla: claveHost,
    manual: null,
    actividad,
    desuscribirDatos,
    desuscribirSalida
  })
  n.sesiones.set(sesion.id, nueva)
  sondearTrasLanzar(n, nueva)
  n.alCambiarSesiones()

  return {
    sesionId: sesion.id,
    perfilId: perfil.id,
    agente,
    cuentaId: CUENTA_HOST_ID,
    rutaHostProyecto: req.rutaHostProyecto,
    rutaWorkspace: sesion.rutaWorkspace,
    rutaContenedorConfig: ''
  }
}
