// =============================================================================
// «Continuar en…»: prepara el destino de la sesión de un pane. Con el mismo agente copia su conversación a la
// cuenta de destino (sin pisar otra: si las dos copias divergieron, devuelve las dos para que el usuario elija, y
// la que pierde se aparta) y deja la frase de las rutas; con otro, arma el traspaso derivado con lo
// último de la conversación y el estado de git. Deja el pendiente en el registro y devuelve con qué abrir.
// Sin electron: recibe las sesiones, las carpetas de cuenta y git. Lo registra `ipc.ts`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { createReadStream } from 'node:fs'
import { rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { PeticionContinuarEn, ResultadoContinuarEn, CopiaConversacion, DestinoTraspaso, EleccionDivergencia } from '../../shared/traspaso-ipc'
import type { SesionDeOrigen } from '../agentes/ControladorTerminalAgente'
import { ID_CONVERSACION } from '../agentes/lineaArranqueAgente.ts'
import { leerCabezaParseada } from '../transcripts/cabezaJsonl.ts'
import { esComprimido } from '../transcripts/listadoTranscripciones.ts'
import { metaDeCabecera } from '../transcripts/formatoTranscripcion.ts'
import { leerLineasJsonl, type LineaJsonl } from '../util/jsonlCola.ts'
import { armarTraspaso, avisoTraspaso, mensajesDeTexto, promptInicialTraspaso } from './armarTraspaso.ts'
import { archivosBajo, buscarTranscripcion, bytesHastaLineaCompleta, compararConDestino, copiarArchivos, exigirSinEnlaces } from './copiaTranscripcion.ts'
import type { RegistroTraspasos } from './RegistroTraspasos.ts'
import { carpetaClaudeConocida, fraseRutas, nombreApartado, planCopia, resolverDivergencia, tramosDestino, type AgenteTraspaso, type ArchivoACopiar } from './rutasTraspaso.ts'
import { txTraspaso } from './textos.ts'

/** La cola del transcript de origen que se lee para el traspaso derivado: lo reciente cabe de sobra. */
const COLA_TRASPASO = 2 * 1024 * 1024

/** Lo que necesita. */
export interface DependenciasServicioTraspaso {
  origenDe: (sesionId: string) => SesionDeOrigen | null
  /** Hace que el anillo de contexto lea el transcript vivo y fije su ancla: así se sabe la conversación. */
  aprenderConversacion: (o: SesionDeOrigen) => Promise<void>
  /** La carpeta de la cuenta (`BaseDeCuenta`); la del sistema con `host`. */
  baseDe: (agente: AgenteTraspaso, cuentaId: string, host: boolean) => string | null
  rutaEnContenedor: (perfilId: string, agente: AgenteTraspaso, cuentaId: string, rutaHostProyecto: string) => string | null
  /** La cuenta de Docker si es de ese perfil y ese agente, con el nombre que se enseña; si no, null. */
  cuenta: (cuentaId: string, perfilId: string, agente: AgenteTraspaso) => { nombre: string } | null
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
function validar(req: unknown): PeticionContinuarEn {
  const r = req as Partial<PeticionContinuarEn> | null
  const o = r?.origen
  const d = r?.destino
  const ok =
    !!o && !!d && typeof o.profileId === 'string' && typeof o.projectHostPath === 'string' && typeof o.sessionId === 'string' &&
    esAgente(o.agente) && esAgente(d.agente) && (d.modo === 'nativo' || d.modo === 'docker') &&
    (d.modo === 'nativo' || typeof d.accountId === 'string') &&
    (r.divergencia === undefined || r.divergencia === 'origen' || r.divergencia === 'destino')
  if (!ok) throw new Error(txTraspaso().peticion)
  return r as PeticionContinuarEn
}

/** Prepara los traspasos de «Continuar en…». */
export class ServicioTraspaso {
  private readonly d: DependenciasServicioTraspaso

  constructor(d: DependenciasServicioTraspaso) {
    this.d = d
  }

  async continuarEn(peticion: unknown): Promise<ResultadoContinuarEn> {
    const { origen, destino, divergencia } = validar(peticion)
    const o = this.d.origenDe(origen.sessionId)
    if (!o || o.perfilId !== origen.profileId || o.rutaHostProyecto !== origen.projectHostPath || o.agente !== origen.agente) {
      throw new Error(txTraspaso().sinSesion)
    }
    // En nativo no hay cuenta: la carpeta es la del sistema.
    const cuentaDestino = destino.modo === 'nativo' ? '' : (destino.accountId as string)
    if (destino.modo === 'docker' && !this.d.cuenta(cuentaDestino, o.perfilId, destino.agente)) throw new Error(txTraspaso().sinCuenta)
    if (destino.agente === o.agente && (destino.modo === 'nativo') === o.host && (o.host || cuentaDestino === o.cuentaId)) {
      throw new Error(txTraspaso().mismoDestino)
    }
    const conversacion = await this.conversacion(o, origen.sessionId)
    if (destino.agente === o.agente) return this.mismoAgente(o, destino, cuentaDestino, conversacion, divergencia)
    return this.otroAgente(o, destino.agente, conversacion)
  }

  /** La conversación de la sesión; si el ancla aún no la sabe, se aprende leyendo el transcript vivo. */
  private async conversacion(o: SesionDeOrigen, sesionId: string): Promise<string | undefined> {
    if (o.conversacion) return o.conversacion
    try {
      await this.d.aprenderConversacion(o)
    } catch (err) {
      this.d.log?.(`no se pudo leer el contexto de la sesión de origen: ${String(err)}`)
    }
    return this.d.origenDe(sesionId)?.conversacion
  }

  /** El transcript de origen, o un error. */
  private async transcripcionDeOrigen(o: SesionDeOrigen, conversacion: string): Promise<{ base: string; archivo: string }> {
    const base = this.d.baseDe(o.agente, o.cuentaId, o.host)
    const archivo = base ? await buscarTranscripcion(o.agente, base, conversacion, o.rutaHostProyecto) : null
    if (!base || !archivo) throw new Error(txTraspaso().noEncontrada)
    if (!o.host) await exigirSinEnlaces(base, archivo)
    return { base, archivo }
  }

  private async mismoAgente(o: SesionDeOrigen, destino: DestinoTraspaso, cuentaDestino: string, conversacion: string | undefined, eleccion?: EleccionDivergencia): Promise<ResultadoContinuarEn> {
    // El id acaba en rutas del disco y sale del transcript: solo la forma de id que escriben los CLIs.
    if (!conversacion || !ID_CONVERSACION.test(conversacion)) throw new Error(txTraspaso().sinConversacion)
    const { base, archivo } = await this.transcripcionDeOrigen(o, conversacion)
    const nativo = destino.modo === 'nativo'
    const baseDestino = this.d.baseDe(o.agente, cuentaDestino, nativo)
    const cwdDestino = nativo ? o.rutaHostProyecto : this.d.rutaEnContenedor(o.perfilId, o.agente, cuentaDestino, o.rutaHostProyecto)
    if (!baseDestino || !cwdDestino) throw new Error(txTraspaso().sinCarpeta)
    if (o.agente === 'claude-code' && !carpetaClaudeConocida(cwdDestino)) throw new Error(txTraspaso().rutaLarga)
    const principal = path.join(baseDestino, ...tramosDestino(o.agente, { cwdDestino, id: conversacion, relOrigen: path.relative(base, archivo).split(path.sep) }))
    const pares: Array<{ origen: string; destino: string }> = [{ origen: archivo, destino: principal }]
    // Claude Code guarda los hilos de sus subagentes en una carpeta hermana con el id.
    if (o.agente === 'claude-code') {
      const hermana = path.join(path.dirname(archivo), conversacion)
      for (const rel of await archivosBajo(hermana)) pares.push({ origen: path.join(hermana, rel), destino: path.join(path.dirname(principal), conversacion, rel) })
    }
    // Antes de leer el contenido de ningún archivo: un enlace en una carpeta de contenedor llevaría al main fuera.
    for (const p of pares) {
      if (!o.host) await exigirSinEnlaces(base, p.origen)
      if (!nativo) await exigirSinEnlaces(baseDestino, p.destino)
    }
    const archivos = await Promise.all(pares.map(archivoACopiar))
    const plan = planCopia(archivos)
    let copiar = plan.ok ? plan.copiar : []
    // Solo se pregunta si la conversación misma divergió: el diálogo compara los principales. Si solo difiere el hilo
    // de un subagente, la conversación del origen es la que sigue, y ese hilo se aparta como cualquier otra copia.
    let elegida = eleccion
    if (!plan.ok && archivos[0].estado !== 'distinto') elegida = 'origen'
    if (!plan.ok) {
      // Las dos copias siguieron por separado: no se decide por el usuario, se le enseñan para que elija.
      if (!elegida) {
        const [deOrigen, deDestino] = await Promise.all([resumenCopia(o.agente, archivo), resumenCopia(o.agente, principal)])
        return { divergencia: { origen: deOrigen, destino: deDestino } }
      }
      const r = resolverDivergencia(archivos, elegida)
      const ahora = new Date()
      for (const ruta of r.apartar) await rename(ruta, await apartadoLibre(ruta, ahora))
      copiar = r.copiar
      this.d.log?.(`traspaso ${o.agente} ${conversacion}: divergencia resuelta con la de ${elegida}; ${r.apartar.length} archivo(s) apartado(s)`)
    }
    await copiarArchivos(copiar, nativo ? null : baseDestino)
    this.d.log?.(`traspaso ${o.agente} ${conversacion}: ${copiar.length} de ${archivos.length} archivos copiados a la cuenta ${nativo ? 'del sistema' : cuentaDestino}`)
    // Si sigue la de destino, su ruta ya es la de allí.
    const aviso = fraseRutas({ modoOrigen: o.host ? 'nativo' : 'docker', cwdOrigen: await cwdDe(o.agente, elegida === 'destino' ? principal : archivo), cwdDestino })
    const traspasoId = this.d.registro.preparar({ profileId: o.perfilId, projectHostPath: o.rutaHostProyecto, agente: o.agente, aviso, promptInicial: null, contenido: null })
    return { traspasoId, reanudar: conversacion }
  }

  private async otroAgente(o: SesionDeOrigen, agenteDestino: AgenteTraspaso, conversacion: string | undefined): Promise<ResultadoContinuarEn> {
    let lineas: LineaJsonl[] = []
    if (conversacion) {
      // Sin su archivo, el traspaso va igual con el estado de git: es lo que el destino puede leer solo.
      const archivo = await this.transcripcionDeOrigen(o, conversacion).then((t) => t.archivo, () => null)
      // Una conversación comprimida está fría: Codex la restaura antes de seguir escribiendo en ella.
      if (archivo && !esComprimido(archivo)) lineas = await leerLineasJsonl(archivo, 0, COLA_TRASPASO, 'tail')
    }
    const [estadoGit, logGit] = await Promise.all([
      this.d.git(['status', '--short'], o.rutaHostProyecto),
      this.d.git(['log', '--oneline', '-5'], o.rutaHostProyecto)
    ])
    const nombre = NOMBRE_AGENTE[o.agente]
    const cuenta = o.host ? 'cuenta del sistema' : `cuenta ${this.d.cuenta(o.cuentaId, o.perfilId, o.agente)?.nombre ?? o.cuentaId}`
    const contenido = armarTraspaso({ agente: nombre, cuenta, mensajes: mensajesDeTexto(o.agente, lineas), estadoGit, logGit })
    const traspasoId = this.d.registro.preparar({
      profileId: o.perfilId,
      projectHostPath: o.rutaHostProyecto,
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

/** Un nombre de apartado que no exista: `rename` pisaría sin avisar el de otra resolución del mismo segundo. */
async function apartadoLibre(ruta: string, fecha: Date): Promise<string> {
  const base = nombreApartado(ruta, fecha)
  for (let n = 1; ; n++) {
    const candidato = n === 1 ? base : `${base}-${n}`
    if (!(await stat(candidato).then(() => true, () => false))) return candidato
  }
}

/** Cuándo cambió una copia y cuántos mensajes de texto tiene, leída por trozos (una conversación pesa decenas de MB). */
async function resumenCopia(agente: AgenteTraspaso, ruta: string): Promise<CopiaConversacion> {
  const modificada = await stat(ruta).then((s) => s.mtimeMs, () => null)
  if (modificada === null || esComprimido(ruta)) return { modificada, mensajes: null }
  let mensajes = 0
  let lote: LineaJsonl[] = []
  try {
    for await (const linea of createInterface({ input: createReadStream(ruta), crlfDelay: Infinity })) {
      try {
        lote.push(JSON.parse(linea) as LineaJsonl)
      } catch {
        // Una línea a medio escribir no cuenta.
      }
      if (lote.length >= 2000) {
        mensajes += mensajesDeTexto(agente, lote).length
        lote = []
      }
    }
    return { modificada, mensajes: mensajes + mensajesDeTexto(agente, lote).length }
  } catch {
    return { modificada, mensajes: null }
  }
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
