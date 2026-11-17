// =============================================================================
// Montajes en caliente del sandbox: el helper privilegiado efímero (`nsenter -t 1 -m` en
// `alpine`), las raíces `rshared` de cada perfil, los proyectos bajo `/workspace` y el buzón
// del puente de BD. Toda ruta que va al `sh -c` pasa por `citarSh`.
// Decisiones: docs/decisiones/sandbox/montajes-en-caliente.md
// =============================================================================
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Perfil } from '../../perfiles/types.ts'
import { PERFIL_CUENTAS_GLOBALES } from '../../../shared/agent-accounts-ipc.ts'
import { citarSh } from '../../../shared/citarShell.ts'
import { ejecutarDocker, type ResultadoComandoDocker } from '../adaptadores/docker.ts'
import {
  CONTENEDOR_PUENTE_DB,
  IMAGEN_AUXILIAR_PRIVILEGIADO,
  RAIZ_WORKSPACE,
  raizConfigAgentePara,
  nombreContenedorPara,
  textoErrorSandbox,
  idBase,
  raizGestionadaPara,
  normalizarRutaHostSandbox,
  sanearNombreWorkspace,
  aRutaDaemon
} from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { MontajeProyecto } from './tipos.ts'
import { txSandbox } from '../textos.ts'

/**
 * El nombre bajo `/workspace` que no usa otro proyecto: el de la carpeta, o `<carpeta>-2`, `-3`… Los nombres
 * reservados (ruta del host en minúsculas -> nombre) cuentan como ocupados para los demás proyectos, y el
 * proyecto que tiene reserva recibe la suya. Con `estable`, la ruta decide el nombre: en un contenedor que comparten
 * varios perfiles, el orden en que llegan no puede cambiar la ruta de la que cuelgan las conversaciones de un proyecto.
 */
export function nombreLibre(
  montajes: ReadonlyMap<string, MontajeProyecto>,
  rutaHostNormalizada: string,
  reservas: ReadonlyMap<string, string> = new Map(),
  estable = false
): string {
  const clave = rutaHostNormalizada.toLowerCase()
  if (estable) return `${sanearNombreWorkspace(path.basename(rutaHostNormalizada))}-${createHash('sha256').update(clave).digest('hex').slice(0, 8)}`
  const propio = reservas.get(clave)
  if (propio !== undefined && !montajes.has(propio)) return propio
  const ocupado = (nombre: string): boolean => montajes.has(nombre) || [...reservas].some(([k, v]) => k !== clave && v === nombre)
  const base = sanearNombreWorkspace(path.basename(rutaHostNormalizada))
  let nombre = base
  for (let n = 2; ocupado(nombre); n++) nombre = `${base}-${n}`
  return nombre
}

/** El helper privilegiado, las raíces del perfil y los proyectos montados. */
export class MontajesSandbox {
  private readonly n: NucleoSandbox
  /** Por contenedor: nombre prometido a un proyecto aún sin montar (ruta del host en minúsculas -> nombre). */
  private readonly reservas = new Map<string, Map<string, string>>()

  constructor(n: NucleoSandbox) {
    this.n = n
  }

  /**
   * Única puerta al privilegio: un contenedor EFÍMERO `--privileged --pid=host` que entra
   * al namespace de montaje del daemon y ejecuta `operacionesMontaje` con `sh -c` (por argv, sin
   * shell del host de por medio). Muere al terminar (`--rm`).
   */
  ejecutarPrivilegiado(operacionesMontaje: string): Promise<ResultadoComandoDocker> {
    return ejecutarDocker([
      'run',
      '--rm',
      '--privileged',
      '--pid=host',
      IMAGEN_AUXILIAR_PRIVILEGIADO,
      'nsenter',
      '-t',
      '1',
      '-m',
      '--',
      'sh',
      '-c',
      operacionesMontaje
    ])
  }

  /** Prepara `root` como punto `rshared` en el namespace del daemon. Idempotente. */
  private async asegurarRaizRshared(raiz: string, descripcion: string): Promise<void> {
    const r = citarSh(raiz)
    const ops =
      `mkdir -p ${r} && ` +
      `( mountpoint -q ${r} || mount --bind ${r} ${r} ) && ` +
      `mount --make-rshared ${r}`
    const res = await this.ejecutarPrivilegiado(ops)
    if (res.status !== 0) {
      throw new Error(
        txSandbox().montajes.noSePrepararon(
          descripcion,
          raiz,
          res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
        )
      )
    }
  }

  /** Raíz `rshared` de los proyectos del perfil. */
  asegurarRaizGestionada(perfil: Perfil): Promise<void> {
    return this.asegurarRaizRshared(raizGestionadaPara(perfil), `la raíz gestionada del perfil "${perfil.id}"`)
  }

  /** Raíz `rshared` de las credenciales del perfil, en un árbol separado. */
  asegurarRaizConfigAgente(perfil: Perfil): Promise<void> {
    return this.asegurarRaizRshared(raizConfigAgentePara(perfil), `la raíz de credenciales del perfil "${perfil.id}"`)
  }

  /** Mapa de proyectos montados del perfil (se crea vacío si no existe). */
  montajesPara(perfilId: string): Map<string, MontajeProyecto> {
    let m = this.n.montajesProyecto.get(perfilId)
    if (!m) {
      m = new Map<string, MontajeProyecto>()
      this.n.montajesProyecto.set(perfilId, m)
    }
    return m
  }

  /** El montaje de ese proyecto en el perfil, comparando sin distinguir mayúsculas. */
  buscarMontaje(perfilId: string, rutaHost: string): MontajeProyecto | null {
    const normalizada = normalizarRutaHostSandbox(rutaHost).toLowerCase()
    for (const pm of this.montajesPara(perfilId).values()) {
      if (pm.projectHostPath.toLowerCase() === normalizada) return pm
    }
    return null
  }

  /**
   * Dónde está montado el proyecto en ese contenedor o, si aún no lo está, dónde lo montará `addProject`:
   * el nombre queda reservado para ese proyecto hasta que se monte, así que otro con la misma carpeta no se
   * lo quita. Sin Docker: lo dice el registro de montajes.
   */
  reservarRuta(perfilId: string, rutaHostProyecto: string): string {
    const normalizada = normalizarRutaHostSandbox(rutaHostProyecto)
    const ya = this.buscarMontaje(perfilId, normalizada)
    if (ya) return ya.rutaWorkspace
    let delContenedor = this.reservas.get(perfilId)
    if (!delContenedor) {
      delContenedor = new Map<string, string>()
      this.reservas.set(perfilId, delContenedor)
    }
    const nombre = nombreLibre(this.montajesPara(perfilId), normalizada, delContenedor, idBase(perfilId) === PERFIL_CUENTAS_GLOBALES)
    delContenedor.set(normalizada.toLowerCase(), nombre)
    return `${RAIZ_WORKSPACE}/${nombre}`
  }

  /**
   * Monta el proyecto EN CALIENTE en `/workspace/<nombre>` sin recrear el contenedor.
   * Idempotente; si dos proyectos distintos comparten basename, los siguientes reciben
   * `<base>-2`, `<base>-3`… Bajo el `candadoPerfil`: el check-then-act es atómico.
   */
  async anadirProyecto(perfil: Perfil, rutaHostProyecto: string): Promise<MontajeProyecto> {
    return this.n.candadoPerfil.ejecutarExclusivo(perfil.id, async () => {
      const descriptor = this.n.descriptores.get(perfil.id)
      if (!descriptor) {
        throw new Error(
          `No hay contenedor activo para el perfil "${perfil.id}". Llama a ensureContainer() primero.`
        )
      }

      const normalizada = normalizarRutaHostSandbox(rutaHostProyecto)

      const already = this.buscarMontaje(perfil.id, normalizada)
      if (already) return already

      const montajes = this.montajesPara(perfil.id)
      const reservas = this.reservas.get(perfil.id)
      const nombre = nombreLibre(montajes, normalizada, reservas, idBase(perfil.id) === PERFIL_CUENTAS_GLOBALES)

      const raiz = raizGestionadaPara(perfil)
      const rutaDaemon = aRutaDaemon(normalizada)
      const destino = `${raiz}/${nombre}`
      const res = await this.ejecutarPrivilegiado(`mkdir -p ${citarSh(destino)} && mount --bind ${citarSh(rutaDaemon)} ${citarSh(destino)}`)
      if (res.status !== 0) {
        throw new Error(
          txSandbox().montajes.noSeMontoProyecto(
            normalizada,
            perfil.id,
            res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
          )
        )
      }

      const montaje: MontajeProyecto = {
        perfilId: perfil.id,
        projectHostPath: normalizada,
        rutaWorkspace: `${RAIZ_WORKSPACE}/${nombre}`
      }
      montajes.set(nombre, montaje)
      reservas?.delete(normalizada.toLowerCase())
      return montaje
    })
  }

  /** Desmonta ese proyecto en caliente (umount + rmdir). Idempotente. */
  async quitarProyecto(perfil: Perfil, rutaHostProyecto: string): Promise<void> {
    return this.n.candadoPerfil.ejecutarExclusivo(perfil.id, async () => {
      const montajes = this.montajesPara(perfil.id)
      const normalizada = normalizarRutaHostSandbox(rutaHostProyecto).toLowerCase()

      let nombreEncontrado: string | null = null
      for (const [nombre, pm] of montajes) {
        if (pm.projectHostPath.toLowerCase() === normalizada) {
          nombreEncontrado = nombre
          break
        }
      }
      if (!nombreEncontrado) return

      const destino = `${raizGestionadaPara(perfil)}/${nombreEncontrado}`
      const res = await this.ejecutarPrivilegiado(`umount ${citarSh(destino)} && rmdir ${citarSh(destino)}`)
      if (res.status !== 0) {
        throw new Error(
          txSandbox().montajes.noSeDesmontoProyecto(
            nombreEncontrado,
            perfil.id,
            res.stderr.trim() || res.stdout.trim() || txSandbox().montajes.nsenterSalio(res.status)
          )
        )
      }
      montajes.delete(nombreEncontrado)
    })
  }

  /** Proyectos montados en el perfil. */
  async listarProyectos(perfil: Perfil): Promise<MontajeProyecto[]> {
    return [...this.montajesPara(perfil.id).values()]
  }


  /**
   * Monta el buzón del puente de BD y enlaza `tdb`, `tssh` y `tctx` en el PATH del contenedor. Best-effort:
   * si falla, el perfil se queda sin bases pero el contenedor y el agente siguen.
   */
  async montarPuenteDb(perfil: Perfil): Promise<void> {
    if (!this.n.prepararBuzonDb) return
    try {
      const dirHost = this.n.prepararBuzonDb(perfil.id)
      const destino = `${raizConfigAgentePara(perfil)}/dbbridge`
      const rutaDaemon = aRutaDaemon(normalizarRutaHostSandbox(dirHost))
      // Idempotente: nunca se apila un segundo bind sobre el mismo destino.
      const res = await this.ejecutarPrivilegiado(
        `mkdir -p ${citarSh(destino)} && ` +
          `( mountpoint -q ${citarSh(destino)} || ` +
          `mount --bind ${citarSh(rutaDaemon)} ${citarSh(destino)} )`
      )
      if (res.status !== 0) {
        console.log(
          `[sandbox] puente de BD no montado en "${perfil.id}": ` +
            (res.stderr.trim() || res.stdout.trim() || `nsenter salió con ${res.status}`)
        )
        return
      }
      // `tdb`, `tssh` y `tctx` (los programas que registran SSH y las reglas en el mismo buzón), en un solo `exec`.
      const enlace = await ejecutarDocker([
        'exec',
        '-u',
        'root',
        nombreContenedorPara(perfil),
        'sh',
        '-c',
        ['tdb', 'tssh', 'tctx'].map((p) => `ln -sf ${citarSh(`${CONTENEDOR_PUENTE_DB}/${p}`)} /usr/local/bin/${p}`).join(' && ')
      ])
      if (enlace.status !== 0) {
        console.log(`[sandbox] no se pudo enlazar tdb, tssh y tctx en "${perfil.id}": ${enlace.stderr.trim()}`)
      }
    } catch (err) {
      console.log(`[sandbox] puente de BD no disponible en "${perfil.id}": ${textoErrorSandbox(err)}`)
    }
  }
}
