// =============================================================================
// DbController: dueño del subsistema de conexiones en el main (registro, puente, drivers, espacio de
// datos). El main nunca carga `oracledb` ni `pg`: todo pasa por `tdb` como subproceso.
// No conoce Electron: recibe el emisor de eventos y los diálogos ya compuestos; sus canales los
// registra `ipc.ts`. Las piezas por tema viven en `controlador/`.
// Decisiones: docs/decisiones/bd/conexiones-tdb-como-subproceso.md, docs/decisiones/bd/conexiones-edicion-y-ganchos.md
// =============================================================================
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  DB_CHANNELS,
  ENV_BUZON,
  ENV_MODO,
  ENV_SESION,
  type DbArchivoElegido,
  type DbBorrarConexion,
  type DbConexionBorrada,
  type DbConexionDeArchivo,
  type DbConnection,
  type DbConnectionInput,
  type DbListaConexiones,
  type DbMontarArchivoRespuesta,
  type DbMontarArchivoRequest,
  type DbMotor,
  type DbTestResult,
  type DriverProgress,
  type DriverStatus
} from '../../shared/db-ipc'
import type { APapelera } from '../util/carpetaDePerfil'
import type { EmisorEventos } from '../util/emisorEventos'
import type { ConnectionStore } from './ConnectionStore'
import type { DriverManager } from './DriverManager'
import { AVISO_SIN_BASES, briefingBasesAgente } from './briefingAgente'
import { escribirAtajos } from './controlador/atajosTdb'
import { EdicionRegistro, sinRutasDelHost, type GanchosConexion } from './controlador/edicionRegistro'
import { EspacioDatos } from './controlador/espacioDatos'
import { contextoDeDrivers, InvocadorTdb } from './controlador/invocacionTdb'
import { MotoresDeArchivo, type DialogosBd } from './controlador/motoresDeArchivo'
import { probarConexion } from './controlador/probarConexion'
import { DbBridge, type PuertaPuente } from './dbBridge'
import { dbLog } from './dbLog'
import { DockerBridge, type PuertaBuzon } from './dockerBridge'
import type { CtxDrivers } from './explorador/protocoloTrabajador'
import { avisosDeDescartados, construirEntornoHost, registroParaDescartes } from './hostEnv'
import { SHIM_DIR } from './shims'
import { GestorTuneles, type DestinoTunel, type LineaTunel } from './tuneles/GestorTuneles'
import { escucha, lanzarTunel, puertoLibre } from './tuneles/sistemaTuneles'
import { txDb } from './textosDb.ts'
import { VARIABLE_IDIOMA, idiomaActual } from '../../shared/i18n.ts'

/** Lo que los túneles de las bases piden al módulo SSH (lo cumple `ControladorSsh`). */
export interface SshParaTuneles {
  prepararTunelBd(profileId: string, conexionId: string, destino: { host: string; puerto: number }, puertoLocal: number): LineaTunel
  aliasDe(conexionId: string): string | null
  existeEnPerfil(profileId: string, id: string): boolean
}

export { mensajeFalloTdb } from './controlador/invocacionTdb'
export type { DialogosBd } from './controlador/motoresDeArchivo'

/** Lo que el registro pide al explorador de BD; lo cumple `ExploradorController`. */
export interface ExploradorDelRegistro {
  puedeEditarConexion: GanchosConexion['puedeEditarConexion']
  alCambiarConexion: GanchosConexion['onConexionEditada']
  alBorrarConexion: GanchosConexion['onConexionBorrada']
  alOlvidarConexionEnPerfil: GanchosConexion['onConexionOlvidadaEnPerfil']
  antesDeCambiarDriver: (packId: string) => Promise<void>
}

/**
 * Lo que `DbController` recibe al construirse; los ganchos del explorador son opcionales (las
 * pruebas sin explorador). La app los engancha con `conectarExplorador`.
 */
export interface DbControllerOptions extends Partial<GanchosConexion> {
  connections: ConnectionStore
  drivers: DriverManager
  /** Raíz de datos mutables (= app.getPath('userData')). */
  userDataDir: string
  /** Carpeta de la app (= app.getAppPath()); de ahí cuelga `src/tdb`. */
  appDir: string
  /** Emisor hacia el renderer para `CHANGED` y `DRIVERS_PROGRESS`. */
  eventos: EmisorEventos
  /** Diálogos nativos ya anclados a la ventana. */
  dialogos: DialogosBd
  /** La papelera del sistema (`shell.trashItem`): adonde va el espacio de datos de un perfil borrado. */
  papelera: APapelera
  /** Se llama tras cada alta, baja o edición; el main regenera con él la memoria de los agentes. */
  onChanged?: (profileId: string) => void
  /** Se ESPERA antes de instalar, registrar u olvidar un pack: el explorador cierra ahí los procesos que lo cargan. */
  antesDeCambiarDriver?: (packId: string) => Promise<void>
  /** La contenedora que el explorador de archivos tiene anclada ahora, o `null`: solo de ella se monta un archivo. */
  contenedoraAnclada?: () => string | null
  log?: (msg: string) => void
}

/** Dueño de las conexiones de bases de datos y de su puente hacia `tdb`. */
export class DbController {
  private readonly connections: ConnectionStore
  private readonly drivers: DriverManager
  private readonly userDataDir: string
  private readonly appDir: string
  private readonly eventos: EmisorEventos
  private readonly dialogos: DialogosBd
  private readonly onChanged: (profileId: string) => void
  private antesDeCambiarDriver: (packId: string) => Promise<void>
  /** Los ganchos vigentes; `edicion` los lee en cada llamada, así que `conectarExplorador` los sustituye. */
  private ganchos: GanchosConexion
  private readonly log: (msg: string) => void
  /** Puente local: permite montar y desmontar en caliente, sin reiniciar la sesión del agente. */
  private readonly puente: DbBridge
  /** Puente al host para el modo Docker: el contenedor deja la petición en un buzón y `tdb` corre aquí. */
  private readonly puenteDocker: DockerBridge
  private readonly tdb: InvocadorTdb
  private readonly espacio: EspacioDatos
  private readonly archivos: MotoresDeArchivo
  private readonly edicion: EdicionRegistro
  /** El módulo SSH, que nace después (necesita el puente): sin él no se abre ningún túnel. */
  private ssh: SshParaTuneles | null = null
  private readonly tuneles: GestorTuneles

  constructor(opts: DbControllerOptions) {
    this.connections = opts.connections
    this.drivers = opts.drivers
    this.userDataDir = opts.userDataDir
    this.appDir = opts.appDir
    this.eventos = opts.eventos
    this.dialogos = opts.dialogos
    this.onChanged = opts.onChanged ?? (() => {})
    this.antesDeCambiarDriver = opts.antesDeCambiarDriver ?? (() => Promise.resolve())
    this.log = opts.log ?? ((m) => console.log(`[db] ${m}`))
    this.espacio = new EspacioDatos(this.userDataDir, this.connections, opts.papelera, this.log)
    this.archivos = new MotoresDeArchivo({
      connections: this.connections,
      tdbScriptDir: () => this.tdbScriptDir(),
      contenedoraAnclada: opts.contenedoraAnclada ?? (() => null),
      dialogos: this.dialogos,
      avisarCambio: () => this.sendChanged(),
      onChanged: (profileId) => this.onChanged(profileId)
    })
    this.ganchos = {
      puedeEditarConexion: opts.puedeEditarConexion ?? (() => ({ ok: true })),
      onConexionEditada: opts.onConexionEditada ?? (() => {}),
      onConexionBorrada: opts.onConexionBorrada ?? (() => {}),
      onConexionOlvidadaEnPerfil: opts.onConexionOlvidadaEnPerfil ?? (() => {})
    }
    this.edicion = new EdicionRegistro({
      connections: this.connections,
      ganchos: {
        puedeEditarConexion: (id, soloCasilla) => this.ganchos.puedeEditarConexion(id, soloCasilla),
        onConexionEditada: (previo, nuevo, soloCasilla) => this.ganchos.onConexionEditada(previo, nuevo, soloCasilla),
        onConexionBorrada: (id, profileId) => this.ganchos.onConexionBorrada(id, profileId),
        onConexionOlvidadaEnPerfil: (id, profileId) => this.ganchos.onConexionOlvidadaEnPerfil(id, profileId)
      },
      resolverEntrada: (input) => this.archivos.resolverEntrada(input),
      onChanged: (profileId) => this.onChanged(profileId),
      avisarCambio: () => this.sendChanged()
    })
    this.tuneles = new GestorTuneles({
      preparar: (profileId, sshId, destino, puertoLocal) => {
        if (this.ssh === null) throw new Error(txDb().conexion.sinTuneles)
        return this.ssh.prepararTunelBd(profileId, sshId, destino, puertoLocal)
      },
      aliasSsh: (id) => this.ssh?.aliasDe(id) ?? null,
      lanzar: lanzarTunel,
      puertoLibre,
      escucha,
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      ahora: () => Date.now(),
      log: (m) => dbLog('tuneles', m)
    })
    this.puente = new DbBridge({
      conexionesDelPerfil: (id) => this.connections.list(id),
      secretoDe: (id) => this.connections.secretOf(id),
      tunelDe: (c) => {
        const con = this.connections.get(c.id)
        return con ? this.tunelDe(con) : null
      },
      log: (m) => dbLog('puente', m)
    })
    this.puente.start()
    this.tdb = new InvocadorTdb({
      puente: this.puente,
      connections: this.connections,
      drivers: this.drivers,
      tdbScript: this.tdbScript,
      log: this.log
    })
    this.puenteDocker = new DockerBridge({
      raiz: path.join(this.userDataDir, 'dbbridge'),
      clienteOrigen: path.join(this.appDir, 'src', 'tdb', 'tdb-container.cjs'),
      ejecutar: (token, argv, entrada) => this.tdb.ejecutarParaContenedor(token, argv, entrada),
      log: (m) => dbLog('docker', m)
    })
    escribirAtajos({ binRoot: this.binRoot, tdbScript: this.tdbScript, log: this.log })
  }

  /**
   * Engancha el explorador de BD, que nace después porque necesita a este controlador. La raíz
   * lo llama justo tras construirlo, antes de que ningún canal pueda atenderse.
   */
  conectarExplorador(explorador: ExploradorDelRegistro): void {
    this.ganchos = {
      puedeEditarConexion: (id, soloCasilla) => explorador.puedeEditarConexion(id, soloCasilla),
      onConexionEditada: (previo, nuevo, soloCasilla) => explorador.alCambiarConexion(previo, nuevo, soloCasilla),
      onConexionBorrada: (id, profileId) => explorador.alBorrarConexion(id, profileId),
      // Lo fijan `test:db-registro` (caso 18) y el (G1) de e2e/conexiones-compatibilidad.spec.ts.
      onConexionOlvidadaEnPerfil: (id, profileId) => explorador.alOlvidarConexionEnPerfil(id, profileId)
    }
    this.antesDeCambiarDriver = (packId) => explorador.antesDeCambiarDriver(packId)
  }

  /** Engancha el módulo SSH, que nace después: desde aquí se validan y se abren los túneles de las bases. */
  conectarSsh(ssh: SshParaTuneles): void {
    this.ssh = ssh
    this.connections.conocerConexionesSsh((profileId, id) => ssh.existeEnPerfil(profileId, id))
  }

  /**
   * El extremo local del túnel SSH de una conexión, abriéndolo si hace falta; `null` si no lleva túnel.
   * Lo piden `tdb` (por el puente) y el explorador antes de abrir una sesión.
   */
  tunelDe(con: DbConnection): Promise<DestinoTunel> | null {
    return this.tuneles.destino(con)
  }

  /**
   * Una conexión SSH cambió, se borró u olvidó su huella (puede ser el bastión de cualquiera): cada túnel
   * se reabre con los datos nuevos en su siguiente uso, sin cortar lo que ya va por el de antes.
   */
  alCambiarConexionSsh(): void {
    this.tuneles.marcarViejos()
  }

  // --- Puente ----------------------------------------------------------------

  /** Ata el token del entorno a la sesión ya creada; sin esto no se podría revocar al cerrarla. */
  atarSesion(extraEnv: Record<string, string>, sessionId: string): void {
    const token = extraEnv[ENV_SESION]
    if (token) this.puente.bind(token, sessionId)
  }

  /** Revoca lo que tuviera esa sesión. Llamar desde TODOS los caminos de cierre. */
  revocarSesion(sessionId: string): void {
    this.puente.revoke(sessionId)
  }

  /** La puerta del puente para otros dominios: registran sus operaciones (`ssh.*`) sin tocar el contrato de `tdb`. */
  get puertaPuente(): PuertaPuente {
    return this.puente
  }

  /** La puerta del buzón de Docker para otros dominios: registran su programa (`tssh`) junto a `tdb`. */
  get puertaBuzon(): PuertaBuzon {
    return this.puenteDocker
  }

  /** Fija las bases montadas de un proyecto: la siguiente invocación de `tdb` ya las ve (montaje en caliente). */
  fijarAmbito(profileId: string, projectHostPath: string, ids: readonly string[]): void {
    // Los ids se guardan tal cual: el filtro vive en `DbBridge.resolver`, que los cruza con las
    // conexiones conocidas del perfil en cada invocación. Se apunta aunque el puente esté en pausa.
    this.puente.setScope(profileId, projectHostPath, ids)
    dbLog('puente', `ámbito de ${profileId}|${projectHostPath} = [${ids.join(',')}]`)
  }

  /**
   * Entorno de una terminal en modo Docker: solo un token, una ruta y el idioma, ninguna contraseña.
   * Sin el puente levantado, solo el idioma: sin él, el modo Docker no ofrece bases.
   */
  entornoContenedor(
    profileId: string,
    projectHostPath: string,
    idsMontados: readonly string[],
    rutaBuzonEnContenedor: string
  ): Record<string, string> {
    // El idioma no depende del puente: sin él, `tdb` y `tssh` del contenedor explican el fallo.
    if (!this.puente.listo) return { [VARIABLE_IDIOMA]: idiomaActual() }
    const delPerfil = this.connections.list(profileId)
    const validas = idsMontados.filter((id) => delPerfil.some((c) => c.id === id))
    this.puente.setScope(profileId, projectHostPath, validas)
    const env = {
      [ENV_MODO]: 'pipe',
      // Hoy el espacio de datos nunca llega aquí, pero la marca se calcula igual: es gratis.
      [ENV_SESION]: this.puente.mint(profileId, projectHostPath, {
        espacioDatos: this.espacio.esEspacioDeDatos(profileId, projectHostPath)
      }),
      [ENV_BUZON]: rutaBuzonEnContenedor,
      [VARIABLE_IDIOMA]: idiomaActual()
    }
    dbLog(
      'env',
      `[docker] perfil=${profileId} proyecto=${projectHostPath} idsPedidos=${idsMontados.length} ` +
        `idsValidos=${validas.length} buzon=${rutaBuzonEnContenedor}`
    )
    return env
  }

  /**
   * Prepara el buzón del perfil y devuelve su carpeta del host para que el sandbox la monte.
   * Idempotente: se llama en cada `ensureContainer`, así el puente sobrevive a que se recree el contenedor.
   */
  prepararBuzonDocker(profileId: string): string {
    return this.puenteDocker.prepararPerfil(profileId)
  }

  /** Deja de sondear el buzón de un perfil cuyo contenedor murió; el buzón en disco no se borra. */
  olvidarBuzonDocker(profileId: string): void {
    this.puenteDocker.olvidarPerfil(profileId)
  }

  /**
   * Apaga los puentes al empezar el cierre de la app. Es una pausa y no un `stop()` porque ese cierre
   * puede abortarse: el local conserva su nombre, tokens y ámbitos para `reanudarPuente()`.
   */
  pararPuente(): void {
    void this.puente.pausar()
    this.puenteDocker.stop()
    // Si el cierre se aborta, cada túnel se vuelve a abrir al usarse.
    this.tuneles.cerrarTodos()
  }

  /**
   * Deshace `pararPuente()` si el cierre se aborta. El puente de Docker no se reanuda aquí: lo hace
   * `prepararBuzonDocker` perfil a perfil cuando un contenedor vuelve.
   */
  reanudarPuente(): Promise<void> {
    return this.puente.reanudar()
  }

  // --- Rutas -----------------------------------------------------------------

  /** Carpeta `src/tdb` de la app: de ahí cuelgan el CLI y el proceso de sesión del explorador. */
  tdbScriptDir(): string {
    return path.join(this.appDir, 'src', 'tdb')
  }

  /** Script del CLI. Misma ruta en dev y en producción gracias a `asar: false`. */
  private get tdbScript(): string {
    return path.join(this.tdbScriptDir(), 'tdb.cjs')
  }

  /** Contexto de drivers para el mensaje `abrir` del proceso de sesión, igual al que arma `tdb.cjs`. */
  ctxDrivers(): CtxDrivers {
    return contextoDeDrivers(this.drivers.driversDir)
  }

  /** Raíz de los atajos: dentro cuelga una carpeta por contrato (`s1`, `s2`…). */
  private get binRoot(): string {
    return path.join(this.userDataDir, 'bin')
  }

  /** Carpeta que se antepone al PATH de las terminales de Tessera. */
  get binDir(): string {
    return path.join(this.binRoot, SHIM_DIR)
  }

  // --- Espacio de datos por perfil -------------------------------------------

  /** Ruta `<userData>/conexiones/<perfil>` validada como hija directa, sin crearla. */
  espacioDeDatos(profileId: string): string {
    return this.espacio.ruta(profileId)
  }

  /** Rutas del espacio de datos de todos los perfiles, sin crearlas; un id inválido se omite. */
  workspacePaths(profileIds: string[]): Record<string, string> {
    return this.espacio.rutas(profileIds)
  }

  /** Crea el espacio si hace falta, siembra el contexto del agente y devuelve la ruta para abrirlo como proyecto. */
  ensureWorkspace(profileId: string, nombrePerfil: string): { projectHostPath: string; name: string } {
    return this.espacio.asegurar(profileId, nombrePerfil)
  }

  /**
   * El espacio de datos tal como lo borra el guardado de perfiles, con la papelera ya dentro: llega a la
   * composición como dependencia, igual que la carpeta del agente de la terminal.
   */
  get espacioDatos(): Pick<EspacioDatos, 'borrar'> {
    return this.espacio
  }

  /** Regenera el contexto del agente de un perfil, si su espacio ya existe. */
  refreshWorkspaceContext(profileId: string, nombrePerfil: string): void {
    this.espacio.refrescarContexto(profileId, nombrePerfil)
  }

  // --- Entorno para los pty --------------------------------------------------

  /**
   * Variables de una terminal de modo nativo: registro, drivers, perfil, ámbito y un secreto por
   * conexión, más el PATH con los atajos. La lógica vive en `hostEnv.ts`; aquí se le sirven las
   * dependencias y se registra qué decidió.
   */
  entornoHost(
    profileId: string,
    projectHostPath: string,
    idsMontados: readonly string[]
  ): Record<string, string> {
    const { env, diag } = construirEntornoHost(
      {
        binDir: this.binDir,
        registryPath: this.connections.registryPath,
        driversDir: this.drivers.driversDir,
        conexionesDelPerfil: (id) => this.connections.list(id),
        secretoDe: (id) => this.connections.secretOf(id),
        // Solo informativo: un id inválido no tiene espacio y da cadena vacía en vez de tumbar la terminal.
        espacioDeDatos: (id) => this.espacio.rutaOVacia(id),
        puente: this.puente.listo
          ? {
              pipe: this.puente.pipe,
              mint: (perfil, proyecto, info) => this.puente.mint(perfil, proyecto, info),
              fijarAmbito: (perfil, proyecto, ids) => this.puente.setScope(perfil, proyecto, ids)
            }
          : undefined
      },
      profileId,
      projectHostPath,
      idsMontados
    )
    dbLog(
      'env',
      `perfil=${profileId} proyecto=${projectHostPath} modo=${diag.modo} espacioDatos=${diag.espacioDatos} ` +
        `idsPedidos=${diag.idsPedidos} idsValidos=${diag.idsValidos} ` +
        `secretos=${diag.secretosResueltos}/${diag.secretosPedidos} ` +
        `claves=[${diag.claves.join(',')}]`
    )
    // Cada id descartado dice su causa; la lista completa se pide solo si hay descartes.
    if (diag.idsDescartados.length > 0) {
      const registro = registroParaDescartes(this.connections.listaCompleta(profileId))
      for (const linea of avisosDeDescartados(diag.idsDescartados, registro, profileId)) dbLog('env', linea)
    }
    if (diag.secretosResueltos < diag.secretosPedidos) {
      dbLog(
        'env',
        `AVISO: ${diag.secretosPedidos - diag.secretosResueltos} conexión(es) sin secreto ` +
          `legible (safeStorage); tdb las listará pero no podrá conectar`
      )
    }
    return env
  }

  /**
   * Texto que se añade al system prompt del agente al arrancar para que sepa qué bases tiene montadas, o,
   * sin ninguna, que `tdb` existe. Va por la línea de arranque y no por un archivo en el repo del usuario.
   */
  briefingParaAgente(profileId: string, projectHostPath: string, connectionIds: string[]): string | null {
    const validas = connectionIds
      .map((id) => this.connections.get(id))
      .filter((c): c is DbConnection => Boolean(c) && c!.profileId === profileId)
    const conBases = briefingBasesAgente(validas, this.espacio.esEspacioDeDatos(profileId, projectHostPath))
    // Sin bases, el aviso corto de que `tdb` existe; sin puente, `tdb` no podría atender y no se anuncia.
    return conBases ?? (this.puente.listo ? AVISO_SIN_BASES : null)
  }

  /** El usuario borró el perfil (`profiles/borradoDePerfil.ts`): fuera sus conexiones, ajenas incluidas. */
  alBorrarPerfil(profileId: string): void {
    for (const c of this.connections.list(profileId)) this.tuneles.cerrar(c.id)
    this.connections.alBorrarPerfil(profileId)
    this.sendChanged()
  }

  /** Las conexiones de un perfil con sus contraseñas, para una copia de la configuración (solo dentro del main). */
  paraCopia(profileId: string): ReturnType<ConnectionStore['paraCopia']> {
    return this.connections.paraCopia(profileId)
  }

  /** ¿Hay ya una conexión con ese id? Para la vista previa de una copia de la configuración. */
  idOcupado(id: string): boolean {
    return this.connections.idOcupado(id)
  }

  /**
   * Las conexiones de una copia de la configuración de los perfiles importados, con un solo aviso al
   * final. `revisar`: las de un archivo que no está en este equipo.
   */
  importarDeCopia(copia: unknown, perfiles: ReadonlySet<string>): { anadidas: number; saltadas: Array<{ alias: string; motivo: string }>; revisar: string[] } {
    const r = { anadidas: 0, saltadas: [] as Array<{ alias: string; motivo: string }>, revisar: [] as string[] }
    for (const item of Array.isArray(copia) ? copia : []) {
      const c = (typeof item === 'object' && item !== null ? item : {}) as { registro?: Record<string, unknown>; secreto?: unknown }
      const reg = c.registro ?? {}
      if (typeof reg.profileId !== 'string' || !perfiles.has(reg.profileId)) continue
      const alias = typeof reg.alias === 'string' ? reg.alias : '(sin nombre)'
      const motivo = this.connections.importarDeCopia(reg, c.secreto)
      if (motivo !== null) {
        r.saltadas.push({ alias, motivo })
        continue
      }
      r.anadidas++
      if (typeof c.secreto === 'string' && c.secreto !== '' && !this.connections.puedeGuardarSecretos()) {
        r.revisar.push(txDb().importacion.sinContrasena(alias))
      }
      if (typeof reg.archivo === 'string' && !existsSync(reg.archivo)) r.revisar.push(txDb().importacion.archivoAusente(alias))
    }
    if (r.anadidas > 0) this.sendChanged()
    return r
  }

  // --- Lo que atiende `ipc.ts` -------------------------------------------------

  /** Conexiones conocidas de un perfil. */
  listar(profileId: string): DbConnection[] {
    return this.connections.list(profileId)
  }

  /** Conocidas y ajenas de un perfil, con la marca del formato ajeno del archivo entero. */
  listarCompleta(profileId: string): DbListaConexiones {
    return this.connections.listaCompleta(profileId)
  }

  /** Alta de una conexión. */
  crearConexion(input: DbConnectionInput): DbConnection {
    return this.edicion.crear(DB_CHANNELS.CREATE, input)
  }

  /** Edición de una conexión: se bloquea antes de tocar el registro si hay una transacción pendiente. */
  editarConexion(req: { id: string; input: DbConnectionInput }): DbConnection {
    // El túnel no se cierra aquí: si cambió su destino, la siguiente petición abre otro y el de antes sigue
    // sirviendo a lo que ya iba por él (la casilla de los agentes se edita con una transacción pendiente).
    return this.edicion.actualizar(DB_CHANNELS.UPDATE, req)
  }

  /** Borra la entrada pedida y avisa al explorador de lo que cuelga de su id. */
  borrarConexion(req: DbBorrarConexion): DbConexionBorrada {
    const borrada = this.edicion.borrar(DB_CHANNELS.DELETE, req)
    this.tuneles.cerrar(req.id)
    return borrada
  }

  /** Reordena las conexiones de un perfil. */
  reordenarConexiones(req: { profileId: string; ids: string[] }): void {
    this.edicion.reordenar(DB_CHANNELS.REORDER, req)
  }

  /** Diálogo para elegir el archivo de una base; `null` si se cancela. */
  elegirArchivo(req: { motor: DbMotor }): Promise<DbArchivoElegido | null> {
    return this.archivos.elegir(req)
  }

  /** Diálogo para crear una base vacía; `null` si se cancela. */
  crearArchivo(req: { motor: DbMotor }): Promise<DbArchivoElegido | null> {
    return this.archivos.crear(req)
  }

  /** Ficha de un archivo soltado sobre el árbol. */
  archivoSoltado(req: { motor: DbMotor; ruta: string }): DbArchivoElegido {
    return this.archivos.soltado(req)
  }

  /** «Montar como base de datos»: crea o reutiliza la conexión del archivo del proyecto. */
  montarArchivo(req: DbMontarArchivoRequest): DbMontarArchivoRespuesta {
    return sinRutasDelHost(DB_CHANNELS.ARCHIVO_MONTAR, () => this.archivos.montar(req))
  }

  /** La conexión del perfil que ya apunta a ese archivo del proyecto. */
  conexionDeArchivo(req: DbMontarArchivoRequest): DbConexionDeArchivo {
    return this.archivos.conexionDe(req)
  }

  /** Probar conexión: abre de verdad contra el servidor y avisa a las vistas del resultado. */
  test(id: string): Promise<DbTestResult> {
    return probarConexion(
      {
        connections: this.connections,
        ejecutar: (con, args) => this.tdb.ejecutarParaConexion(con, args),
        avisarCambio: () => this.sendChanged()
      },
      id
    )
  }

  /** Estado de los drivers, para el panel. */
  driverStatus(): DriverStatus[] {
    return this.drivers.status()
  }

  /** Instala un pack de drivers tras esperar al explorador (en Windows, EBUSY al sobrescribir DLL cargadas). */
  async instalarDriver(packId: string): Promise<DriverStatus> {
    await this.antesDeCambiarDriver(packId)
    return this.drivers.install(packId)
  }

  /** Registra un cliente externo ya instalado, tras esperar al explorador. */
  async usarClienteExistente(packId: string, ruta: string): Promise<DriverStatus> {
    await this.antesDeCambiarDriver(packId)
    return this.drivers.useExisting(packId, ruta)
  }

  /** Diálogo para elegir la carpeta de un cliente de base de datos; `null` si se cancela. */
  async elegirCarpetaDriver(): Promise<string | null> {
    const res = await this.dialogos.elegir('carpeta-driver', {
      title: txDb().drivers.carpetaTitulo,
      properties: ['openDirectory'],
      buttonLabel: txDb().drivers.carpetaBoton
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  }

  /** Emite el progreso de descarga hacia el renderer. */
  sendDriverProgress(p: DriverProgress): void {
    this.eventos.emitir(DB_CHANNELS.DRIVERS_PROGRESS, p)
  }

  /** Avisa al renderer de que el registro cambió, para que ambas vistas se refresquen. */
  private sendChanged(): void {
    this.eventos.emitir(DB_CHANNELS.CHANGED)
  }

  /** `db:changed` para quien cambia el registro fuera de estos canales (el explorador). */
  notificarCambio(): void {
    this.sendChanged()
  }

  /** Olvida el cliente externo de un pack, esperando antes al explorador; ningún canal lo llama hoy. */
  async olvidarDriverExterno(packId: string): Promise<void> {
    await this.antesDeCambiarDriver(packId)
    this.drivers.forgetExisting(packId)
  }
}
