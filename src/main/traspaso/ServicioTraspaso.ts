// =============================================================================
// «Continuar en…»: prepara el destino de la sesión de un pane. Con el mismo agente copia su conversación a la
// cuenta de destino (sin pisar otra) y deja la frase de las rutas; con otro, arma el traspaso derivado con lo
// último de la conversación y el estado de git. Deja el pendiente en el registro y devuelve con qué abrir.
// Sin electron: recibe las sesiones, las carpetas de cuenta y git. Lo registra `ipc.ts`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import path from 'node:path'
import type { ContinuarEnRequest, ContinuarEnResult, DestinoTraspaso } from '../../shared/traspaso-ipc'
import type { SesionDeOrigen } from '../agents/AgentTerminalController'
import { ID_CONVERSACION } from '../agents/lineaArranqueAgente.ts'
import { leerCabezaParseada } from '../transcripts/cabezaJsonl.ts'
import { esComprimido } from '../transcripts/listadoTranscripts.ts'
import { metaDeCabecera } from '../transcripts/formatoTranscript.ts'
import { leerLineasJsonl, type LineaJsonl } from '../util/jsonlCola.ts'
import { armarTraspaso, avisoTraspaso, mensajesDeTexto, promptInicialTraspaso } from './armarTraspaso.ts'
import { archivosBajo, buscarTranscript, bytesHastaLineaCompleta, compararConDestino, copiarArchivos } from './copiaTranscript.ts'
import type { RegistroTraspasos } from './RegistroTraspasos.ts'
import { carpetaClaudeConocida, fraseRutas, planCopia, tramosDestino, type AgenteTraspaso, type ArchivoACopiar } from './rutasTraspaso.ts'
import { txTraspaso } from './textos.ts'

/** La cola del transcript de origen que se lee para el traspaso derivado: lo reciente cabe de sobra. */
const COLA_TRASPASO = 2 * 1024 * 1024

/** Lo que necesita. */
export interface DepsServicioTraspaso {
  origenDe: (sessionId: string) => SesionDeOrigen | null
  /** Hace que el anillo de contexto lea el transcript vivo y fije su ancla: así se sabe la conversación. */
  aprenderConversacion: (o: SesionDeOrigen) => Promise<void>
  /** La carpeta de la cuenta (`BaseDeCuenta`); la del sistema con `host`. */
  baseDe: (agente: AgenteTraspaso, accountId: string, host: boolean) => string | null
  rutaEnContenedor: (profileId: string, agente: AgenteTraspaso, accountId: string, projectHostPath: string) => string | null
  /** La cuenta de Docker si es de ese perfil y ese agente, con el nombre que se enseña; si no, null. */
  cuenta: (accountId: string, profileId: string, agente: AgenteTraspaso) => { nombre: string } | null
  /** Corre git en el proyecto (en el equipo); null si falla o no es un repositorio. */
  git: (args: string[], cwd: string) => Promise<string | null>
  registro: Pick<RegistroTraspasos, 'preparar'>
  log?: (mensaje: string) => void
}

const NOMBRE_AGENTE: Record<AgenteTraspaso, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

function esAgente(v: unknown): v is AgenteTraspaso {
  return v === 'claude-code' || v === 'codex'
}

/** La petición con sus formas comprobadas, o un error. */
function validar(req: unknown): ContinuarEnRequest {
  const r = req as Partial<ContinuarEnRequest> | null
  const o = r?.origen
  const d = r?.destino
  const ok =
    !!o && !!d && typeof o.profileId === 'string' && typeof o.projectHostPath === 'string' && typeof o.sessionId === 'string' &&
    esAgente(o.agente) && esAgente(d.agente) && (d.modo === 'nativo' || d.modo === 'docker') &&
    (d.modo === 'nativo' || typeof d.accountId === 'string')
  if (!ok) throw new Error(txTraspaso().peticion)
  return r as ContinuarEnRequest
}

/** Prepara los traspasos de «Continuar en…». */
export class ServicioTraspaso {
  private readonly d: DepsServicioTraspaso

  constructor(d: DepsServicioTraspaso) {
    this.d = d
  }

  async continuarEn(peticion: unknown): Promise<ContinuarEnResult> {
    const { origen, destino } = validar(peticion)
    const o = this.d.origenDe(origen.sessionId)
    if (!o || o.profileId !== origen.profileId || o.projectHostPath !== origen.projectHostPath || o.agente !== origen.agente) {
      throw new Error(txTraspaso().sinSesion)
    }
    // En nativo no hay cuenta: la carpeta es la del sistema.
    const cuentaDestino = destino.modo === 'nativo' ? '' : (destino.accountId as string)
    if (destino.modo === 'docker' && !this.d.cuenta(cuentaDestino, o.profileId, destino.agente)) throw new Error(txTraspaso().sinCuenta)
    if (destino.agente === o.agente && (destino.modo === 'nativo') === o.host && (o.host || cuentaDestino === o.accountId)) {
      throw new Error(txTraspaso().mismoDestino)
    }
    const conversacion = await this.conversacion(o, origen.sessionId)
    if (destino.agente === o.agente) return this.mismoAgente(o, destino, cuentaDestino, conversacion)
    return this.otroAgente(o, destino.agente, conversacion)
  }

  /** La conversación de la sesión; si el ancla aún no la sabe, se aprende leyendo el transcript vivo. */
  private async conversacion(o: SesionDeOrigen, sessionId: string): Promise<string | undefined> {
    if (o.conversacion) return o.conversacion
    try {
      await this.d.aprenderConversacion(o)
    } catch (err) {
      this.d.log?.(`no se pudo leer el contexto de la sesión de origen: ${String(err)}`)
    }
    return this.d.origenDe(sessionId)?.conversacion
  }

  /** El transcript de origen, o un error. */
  private async transcriptDeOrigen(o: SesionDeOrigen, conversacion: string): Promise<{ base: string; archivo: string }> {
    const base = this.d.baseDe(o.agente, o.accountId, o.host)
    const archivo = base ? await buscarTranscript(o.agente, base, conversacion, o.projectHostPath) : null
    if (!base || !archivo) throw new Error(txTraspaso().noEncontrada)
    return { base, archivo }
  }

  private async mismoAgente(o: SesionDeOrigen, destino: DestinoTraspaso, cuentaDestino: string, conversacion: string | undefined): Promise<ContinuarEnResult> {
    // El id acaba en rutas del disco y sale del transcript: solo la forma de id que escriben los CLIs.
    if (!conversacion || !ID_CONVERSACION.test(conversacion)) throw new Error(txTraspaso().sinConversacion)
    const { base, archivo } = await this.transcriptDeOrigen(o, conversacion)
    const nativo = destino.modo === 'nativo'
    const baseDestino = this.d.baseDe(o.agente, cuentaDestino, nativo)
    const cwdDestino = nativo ? o.projectHostPath : this.d.rutaEnContenedor(o.profileId, o.agente, cuentaDestino, o.projectHostPath)
    if (!baseDestino || !cwdDestino) throw new Error(txTraspaso().sinCarpeta)
    if (o.agente === 'claude-code' && !carpetaClaudeConocida(cwdDestino)) throw new Error(txTraspaso().rutaLarga)
    const principal = path.join(baseDestino, ...tramosDestino(o.agente, { cwdDestino, id: conversacion, relOrigen: path.relative(base, archivo).split(path.sep) }))
    const pares: Array<{ origen: string; destino: string }> = [{ origen: archivo, destino: principal }]
    // Claude Code guarda los hilos de sus subagentes en una carpeta hermana con el id.
    if (o.agente === 'claude-code') {
      const hermana = path.join(path.dirname(archivo), conversacion)
      for (const rel of await archivosBajo(hermana)) pares.push({ origen: path.join(hermana, rel), destino: path.join(path.dirname(principal), conversacion, rel) })
    }
    const archivos = await Promise.all(pares.map(archivoACopiar))
    const plan = planCopia(archivos)
    if (!plan.ok) throw new Error(txTraspaso().conflicto(plan.conflicto))
    await copiarArchivos(plan.copiar)
    this.d.log?.(`traspaso ${o.agente} ${conversacion}: ${plan.copiar.length} de ${archivos.length} archivos copiados a la cuenta ${nativo ? 'del sistema' : cuentaDestino}`)
    const aviso = fraseRutas({ modoOrigen: o.host ? 'nativo' : 'docker', cwdOrigen: await cwdDe(o.agente, archivo), cwdDestino })
    const traspasoId = this.d.registro.preparar({ profileId: o.profileId, projectHostPath: o.projectHostPath, agente: o.agente, aviso, promptInicial: null, contenido: null })
    return { traspasoId, reanudar: conversacion }
  }

  private async otroAgente(o: SesionDeOrigen, agenteDestino: AgenteTraspaso, conversacion: string | undefined): Promise<ContinuarEnResult> {
    let lineas: LineaJsonl[] = []
    if (conversacion) {
      // Sin su archivo, el traspaso va igual con el estado de git: es lo que el destino puede leer solo.
      const archivo = await this.transcriptDeOrigen(o, conversacion).then((t) => t.archivo, () => null)
      // Una conversación comprimida está fría: Codex la restaura antes de seguir escribiendo en ella.
      if (archivo && !esComprimido(archivo)) lineas = await leerLineasJsonl(archivo, 0, COLA_TRASPASO, 'tail')
    }
    const [gitStatus, gitLog] = await Promise.all([
      this.d.git(['status', '--short'], o.projectHostPath),
      this.d.git(['log', '--oneline', '-5'], o.projectHostPath)
    ])
    const nombre = NOMBRE_AGENTE[o.agente]
    const cuenta = o.host ? 'cuenta del sistema' : `cuenta ${this.d.cuenta(o.accountId, o.profileId, o.agente)?.nombre ?? o.accountId}`
    const contenido = armarTraspaso({ agente: nombre, cuenta, mensajes: mensajesDeTexto(o.agente, lineas), gitStatus, gitLog })
    const traspasoId = this.d.registro.preparar({
      profileId: o.profileId,
      projectHostPath: o.projectHostPath,
      agente: agenteDestino,
      aviso: avisoTraspaso(nombre),
      promptInicial: promptInicialTraspaso(nombre),
      contenido
    })
    this.d.log?.(`traspaso derivado ${o.agente} -> ${agenteDestino}: ${contenido.length} caracteres`)
    return { traspasoId, reanudar: null }
  }
}

/** Un par origen-destino con lo que hay en el destino y cuánto del origen se copia. */
async function archivoACopiar(p: { origen: string; destino: string }): Promise<ArchivoACopiar> {
  if (path.resolve(p.origen) === path.resolve(p.destino)) return { ...p, estado: 'igual' }
  // El CLI de origen puede seguir escribiendo: un .jsonl se copia solo hasta su última línea completa.
  const bytes = p.origen.endsWith('.jsonl') ? await bytesHastaLineaCompleta(p.origen) : undefined
  return { ...p, estado: await compararConDestino(p.origen, p.destino, bytes), ...(bytes !== undefined ? { bytes } : {}) }
}

/** El `cwd` que declara la cabecera de un transcript, o null. */
async function cwdDe(agente: AgenteTraspaso, archivo: string): Promise<string | null> {
  try {
    const lineas = await leerCabezaParseada(archivo, { presupuesto: 64 * 1024, lecturaMax: 32 * 1024 * 1024, trozo: 16 * 1024 })
    return metaDeCabecera(agente, lineas).cwd
  } catch {
    return null
  }
}
