// =============================================================================
// Estado ÚNICO del gestor del sandbox: contenedores, montajes, sesiones, candados, extras y
// sumideros que el main cablea. Las operaciones de `gestor/` lo comparten por referencia;
// ningún mapa ni candado existe dos veces.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import type { SshSetup } from '../sshSetup.ts'
import { EXTRAS_VACIOS, type SandboxExtras } from '../../../shared/sandboxExtras.ts'
import { KeyedMutex } from '../../util/mutex.ts'
import type { AvisoRed } from '../../../shared/sandbox-red-ipc.ts'
import type { AgentConfigMount, CapacidadesSandbox, ContainerHandle, ProjectMount } from './tipos.ts'

/** Fase del progreso de un rebuild automático de la imagen. */
export type FaseImagen = 'inicio' | 'fin' | 'error'

/** El estado compartido del sandbox y sus `set*`. */
export class NucleoSandbox {
  readonly dockerfileDir: string
  readonly handles = new Map<string, ContainerHandle>()
  /** profileId -> (nombreEnWorkspace -> mount): índice en memoria del estado del daemon. */
  readonly projectMounts = new Map<string, Map<string, ProjectMount>>()
  /** profileId -> (`<agente>/<cuenta>` -> mount). */
  readonly agentConfigMounts = new Map<string, Map<string, AgentConfigMount>>()
  /** Creaciones de contenedor EN VUELO por perfil: coalescen las llamadas simultáneas. */
  readonly ensureInFlight = new Map<string, Promise<ContainerHandle>>()
  /** Sesiones vivas por perfil (`term:`/`agent:`): SOLO informativo, nunca para el contenedor. */
  readonly liveSessions = new Map<string, Set<string>>()
  /** Barrido de arranque en vuelo; `ensureContainer` lo espera. `null` = no lanzado. */
  startupSweep: Promise<void> | null = null
  /** Serializa por perfil el ciclo de vida del contenedor y sus montajes. */
  readonly profileLock = new KeyedMutex()
  /** Setup ssh GLOBAL que se monta READ-ONLY en todo contenedor; `null` = sin ssh. */
  sshSetup: SshSetup | null = null
  /** Paquetes extra a hornear; cambiarlos deja la imagen obsoleta (van en el sello). */
  extras: SandboxExtras = EXTRAS_VACIOS
  /** Build de la imagen en vuelo, por sello. */
  imageInFlight: { sello: string; promesa: Promise<void> } | null = null
  /** Sello de unos extras cuyo build automático falló: se construye sin ellos. */
  selloExtrasFallido: string | null = null
  /** Sumidero del progreso de un rebuild automático (lo reemite el main). */
  onImageBuildLog: ((line: string, fase?: FaseImagen) => void) | null = null
  /** Sumidero de los avisos de red; opcional porque las pruebas no tienen ventana. */
  avisoRed?: (aviso: AvisoRed) => void
  /** Última medida de la sonda de red en este proceso (propiedad de la máquina). */
  redAnfitrionMedida: boolean | null = null
  /** Perfiles a los que ya se avisó de que la red del anfitrión no llega. */
  readonly redAvisados = new Set<string>()
  /** Caché de `capacidades` por perfil, invalidada por el Id del contenedor. */
  readonly capsCache = new Map<string, { containerId: string; caps: CapacidadesSandbox }>()
  /** Prepara el buzón del puente de BD de un perfil y devuelve su carpeta en el host. */
  prepararBuzonDb: ((profileId: string) => string) | null = null
  /** Avisa al puente de BD de que el contenedor del perfil murió. */
  olvidarBuzonDb: ((profileId: string) => void) | null = null

  constructor(dockerfileDir: string, sshSetup: SshSetup | null) {
    this.dockerfileDir = dockerfileDir
    this.sshSetup = sshSetup
  }

  /** Cablea el puente de BD: `preparar` en cada `ensureContainer`, `olvidar` en cada `stopContainer`. */
  setDbBridge(
    prepararBuzon: (profileId: string) => string,
    olvidarBuzon?: (profileId: string) => void
  ): void {
    this.prepararBuzonDb = prepararBuzon
    this.olvidarBuzonDb = olvidarBuzon ?? null
  }

  /** (Re)fija el setup ssh global. Los contenedores ya vivos lo toman al recrearse. */
  setSshSetup(setup: SshSetup | null): void {
    this.sshSetup = setup
  }

  /** (Re)fija los extras; no reconstruye nada: la imagen se rehornea en el siguiente `ensureImage`. */
  setExtras(extras: SandboxExtras): void {
    this.extras = extras
  }

  /** Sumidero del progreso de un rebuild automático de la imagen. */
  setImageBuildLogger(onLog: ((line: string, fase?: FaseImagen) => void) | null): void {
    this.onImageBuildLog = onLog
  }

  /** Sumidero de los avisos de red (la sonda, el choque del 1455). */
  setAvisoRedHandler(onAviso: ((aviso: AvisoRed) => void) | null): void {
    this.avisoRed = onAviso ?? undefined
  }
}
