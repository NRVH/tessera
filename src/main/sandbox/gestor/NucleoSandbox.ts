// =============================================================================
// Estado ÚNICO del gestor del sandbox: contenedores, montajes, sesiones, candados, extras y
// sumideros que el main cablea. Las operaciones de `gestor/` lo comparten por referencia;
// ningún mapa ni candado existe dos veces.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import os from 'node:os'
import { EXTRAS_VACIOS, type SandboxExtras } from '../../../shared/sandboxExtras.ts'
import { MutexPorClave } from '../../util/mutex.ts'
import type { AvisoRed } from '../../../shared/sandbox-red-ipc.ts'
import type { MontajeConfigAgente, CapacidadesSandbox, DescriptorContenedor, MontajeProyecto } from './tipos.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { nombreImagen, usuarioImagenPara, type UsuarioImagen } from './usuarioImagen.ts'
import { IMAGEN_SANDBOX, instanciaDePruebas } from './nombres.ts'
import type { CausaMuerte } from './eventosDocker.ts'
import type { EstadoDocker } from '../../../shared/sandbox-estado-ipc.ts'

/** El usuario del equipo, si esta plataforma lo hornea en la imagen; `null` si no se puede leer. */
function usuarioDelEquipo(): UsuarioImagen | null {
  try {
    const { uid, gid } = os.userInfo()
    return usuarioImagenPara(plataformaActual(), uid, gid)
  } catch {
    return null
  }
}

/** La imagen de esta instancia: la base o la del uid horneado, y la de pruebas fuera de la app del usuario. */
export function imagenDeLaInstancia(): string {
  return nombreImagen(IMAGEN_SANDBOX, usuarioDelEquipo(), instanciaDePruebas())
}

/** Fase del progreso de un rebuild automático de la imagen. */
export type FaseImagen = 'inicio' | 'fin' | 'error'

/** El estado compartido del sandbox y sus `set*`. */
export class NucleoSandbox {
  readonly dirDockerfile: string
  readonly descriptores = new Map<string, DescriptorContenedor>()
  /** profileId -> (nombreEnWorkspace -> mount): índice en memoria del estado del daemon. */
  readonly montajesProyecto = new Map<string, Map<string, MontajeProyecto>>()
  /** profileId -> (`<agente>/<cuenta>` -> mount). */
  readonly montajesConfigAgente = new Map<string, Map<string, MontajeConfigAgente>>()
  /** Creaciones de contenedor EN VUELO por perfil: coalescen las llamadas simultáneas. */
  readonly creacionesEnCurso = new Map<string, Promise<DescriptorContenedor>>()
  /**
   * Sesiones vivas por id de contenedor (el de la cuenta), cada una con clave `agent:<sesión>`: nunca
   * paran el contenedor; solo impiden parar uno con sesiones al vencer su plazo de inactividad.
   */
  readonly sesionesVivas = new Map<string, Set<string>>()
  /** Barrido de arranque en vuelo; `ensureContainer` lo espera. `null` = no lanzado. */
  barridoArranque: Promise<void> | null = null
  /** Serializa por perfil el ciclo de vida del contenedor y sus montajes. */
  readonly candadoPerfil = new MutexPorClave()
  /** Paquetes extra a hornear; cambiarlos deja la imagen obsoleta (van en el sello). */
  extras: SandboxExtras = EXTRAS_VACIOS
  /** Uid y gid del `agente` horneado; `null` = el de la imagen (fuera de Linux). Va en el sello. */
  readonly usuario: UsuarioImagen | null = usuarioDelEquipo()
  /** Imagen de la que nacen los contenedores (`imagenDeLaInstancia`). */
  readonly imagen: string = imagenDeLaInstancia()
  /** Build de la imagen en vuelo, por sello. */
  construccionImagenEnCurso: { sello: string; promesa: Promise<void> } | null = null
  /** Sello de unos extras cuyo build automático falló: se construye sin ellos. */
  selloExtrasFallido: string | null = null
  /** Sumidero del progreso de un rebuild automático (lo reemite el main). */
  onRegistrarConstruccionImagen: ((linea: string, fase?: FaseImagen) => void) | null = null
  /** Sumidero de los avisos de red; opcional porque las pruebas no tienen ventana. */
  avisoRed?: (aviso: AvisoRed) => void
  /** Última medida de la sonda de red en este proceso (propiedad de la máquina). */
  redAnfitrionMedida: boolean | null = null
  /** Perfiles a los que ya se avisó de que la red del anfitrión no llega. */
  readonly redAvisados = new Set<string>()
  /** Caché de `capacidades` por perfil, invalidada por el Id del contenedor. */
  readonly cacheCapacidades = new Map<string, { contenedorId: string; capacidades: CapacidadesSandbox }>()
  /** Prepara el buzón del puente de BD de un perfil y devuelve su carpeta en el host. */
  prepararBuzonDb: ((perfilId: string) => string) | null = null
  /** Avisa al puente de BD de que el contenedor del perfil murió. */
  olvidarBuzonDb: ((perfilId: string) => void) | null = null
  /**
   * Contenedores que Tessera está parando o borrando ella misma (nombre -> paradas en curso): su
   * `die` no es una muerte para el supervisor.
   */
  readonly paradasEsperadas = new Map<string, number>()
  /** Por qué murió el último contenedor de cada perfil que cayó sin que Tessera lo parara. */
  readonly muertes = new Map<string, { causa: CausaMuerte; en: number }>()
  /**
   * Cuándo avisó Docker del último OOM en el contenedor vivo de cada perfil. El kernel mata el
   * proceso que más ocupa (un agente) y el contenedor sigue: sin esto, el agente solo «terminó».
   */
  readonly oomRecientes = new Map<string, number>()
  /** ¿Docker dejó de responder según el supervisor? Falso mientras no se sepa lo contrario. */
  dockerCaido = false
  /** Arranca la vigilancia de los contenedores; la cablea la fachada. */
  iniciarSupervision: (() => void) | null = null
  /**
   * Un diagnóstico vio a Docker sin responder: el supervisor lo da por caído y sondea, para avisar
   * cuando vuelva aunque su `docker events` no se hubiera cortado. Lo cablea la fachada.
   */
  alVerDockerCaido: (() => void) | null = null
  /** Sumidero de los cambios de disponibilidad de Docker (lo reemite el main). */
  onEstadoDocker: ((estado: EstadoDocker) => void) | null = null

  /** La causa de muerte del contenedor del perfil si fue hace menos de `ventanaMs`; null si no. */
  muerteReciente(perfilId: string, ahora: number, ventanaMs = 120_000): CausaMuerte | null {
    const m = this.muertes.get(perfilId)
    return m && ahora - m.en < ventanaMs ? m.causa : null
  }

  /** ¿Avisó Docker de un OOM en el contenedor del perfil hace menos de `ventanaMs`? */
  oomReciente(perfilId: string, ahora: number, ventanaMs = 60_000): boolean {
    const en = this.oomRecientes.get(perfilId)
    return en !== undefined && ahora - en < ventanaMs
  }

  constructor(dirDockerfile: string) {
    this.dirDockerfile = dirDockerfile
  }

  /** Cablea el puente de BD: `preparar` en cada `ensureContainer`, `olvidar` en cada `detenerContenedor`. */
  fijarPuenteDb(
    prepararBuzon: (perfilId: string) => string,
    olvidarBuzon?: (perfilId: string) => void
  ): void {
    this.prepararBuzonDb = prepararBuzon
    this.olvidarBuzonDb = olvidarBuzon ?? null
  }


  /** (Re)fija los extras; no reconstruye nada: la imagen se rehornea en el siguiente `asegurarImagen`. */
  fijarExtras(extras: SandboxExtras): void {
    this.extras = extras
  }

  /** Sumidero del progreso de un rebuild automático de la imagen. */
  fijarRegistroConstruccionImagen(onRegistrar: ((linea: string, fase?: FaseImagen) => void) | null): void {
    this.onRegistrarConstruccionImagen = onRegistrar
  }

  /** Sumidero de los avisos de red (la sonda, el choque del 1455). */
  fijarManejadorAvisoRed(onAviso: ((aviso: AvisoRed) => void) | null): void {
    this.avisoRed = onAviso ?? undefined
  }
}
