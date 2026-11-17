// =============================================================================
// ControladorBd: dueño del subsistema de conexiones en el main (registro, puente, drivers, espacio de
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
  type ConexionBd,
  type DatosEntradaConexionBd,
  type DbListaConexiones,
  type DbMontarArchivoRespuesta,
  type PeticionMontarArchivoBd,
  type DbMotor,
  type ResultadoProbarConexion,
  type ProgresoDriver,
  type EstadoDriver
} from '../../shared/db-ipc'
import type { APapelera } from '../util/carpetaDePerfil'
import type { EmisorEventos } from '../util/emisorEventos'
import type { AlmacenConexiones } from './AlmacenConexiones'
import type { GestorDrivers } from './GestorDrivers'
import { AVISO_SIN_BASES, briefingBasesAgente } from './briefingAgente'
import { escribirAtajos } from './controlador/atajosTdb'
import { EdicionRegistro, sinRutasDelHost, type GanchosConexion } from './controlador/edicionRegistro'
import { EspacioDatos } from './controlador/espacioDatos'
import { contextoDeDrivers, InvocadorTdb } from './controlador/invocacionTdb'
import { MotoresDeArchivo, type DialogosBd } from './controlador/motoresDeArchivo'
import { probarConexion } from './controlador/probarConexion'
import { PuenteBd, type PuertaPuente, type SesionDelPuente } from './puenteBd'
import { registroBd } from './registroBd'
import { PuenteDocker, type PuertaBuzon } from './puenteDocker'
import type { CtxDrivers } from './explorador/protocoloTrabajador'
import { avisosDeDescartados, construirEntornoHost, registroParaDescartes } from './entornoHost'
import { SHIM_DIR } from './shims'
import { GestorTuneles, type DestinoTunel, type LineaTunel } from './tuneles/GestorTuneles'
import { escucha, lanzarTunel, puertoLibre } from './tuneles/sistemaTuneles'
import { txDb } from './textosDb.ts'
import { VARIABLE_IDIOMA, idiomaActual } from '../../shared/i18n.ts'

/** Lo que los túneles de las bases piden al módulo SSH (lo cumple `ControladorSsh`). */
export interface SshParaTuneles {
  prepararTunelBd(perfilId: string, conexionId: string, destino: { host: string; puerto: number }, puertoLocal: number): LineaTunel
  aliasDe(conexionId: string): string | null
  existeEnPerfil(perfilId: string, id: string): boolean
}

export { mensajeFalloTdb } from './controlador/invocacionTdb'
export type { DialogosBd } from './controlador/motoresDeArchivo'

/** Lo que el registro pide al explorador de BD; lo cumple `ControladorExplorador`. */
export interface ExploradorDelRegistro {
  puedeEditarConexion: GanchosConexion['puedeEditarConexion']
  alCambiarConexion: GanchosConexion['onConexionEditada']
  alBorrarConexion: GanchosConexion['onConexionBorrada']
  alOlvidarConexionEnPerfil: GanchosConexion['onConexionOlvidadaEnPerfil']
  antesDeCambiarDriver: (paqueteDriverId: string) => Promise<void>
}

/**
 * Lo que `ControladorBd` recibe al construirse; los ganchos del explorador son opcionales (las
 * pruebas sin explorador). La app los engancha con `conectarExplorador`.
 */
export interface OpcionesControladorBd extends Partial<GanchosConexion> {
  conexiones: AlmacenConexiones
  drivers: GestorDrivers
  /** Raíz de datos mutables (= app.getPath('userData')). */
  dirDatosUsuario: string
  /** Carpeta de la app (= app.getAppPath()); de ahí cuelga `src/tdb`. */
  dirApp: string
  /** Emisor hacia el renderer para `CHANGED` y `DRIVERS_PROGRESS`. */
  eventos: EmisorEventos
  /** Diálogos nativos ya anclados a la ventana. */
  dialogos: DialogosBd
  /** La papelera del sistema (`shell.trashItem`): adonde va el espacio de datos de un perfil borrado. */
  papelera: APapelera
  /** Se llama tras cada alta, baja o edición; el main regenera con él la memoria de los agentes. */
  onCambio?: (perfilId: string) => void
  /** Se ESPERA antes de instalar, registrar u olvidar un pack: el explorador cierra ahí los procesos que lo cargan. */
  antesDeCambiarDriver?: (paqueteDriverId: string) => Promise<void>
  /** La contenedora que el explorador de archivos tiene anclada ahora, o `null`: solo de ella se monta un archivo. */
  contenedoraAnclada?: () => string | null
  log?: (msg: string) => void
}

/** Dueño de las conexiones de bases de datos y de su puente hacia `tdb`. */
export class ControladorBd {
  private readonly conexiones: AlmacenConexiones
  private readonly drivers: GestorDrivers
  private readonly dirDatosUsuario: string
  private readonly dirApp: string
  private readonly eventos: EmisorEventos
  private readonly dialogos: DialogosBd
  private readonly onCambio: (perfilId: string) => void
  private antesDeCambiarDriver: (paqueteDriverId: string) => Promise<void>
  /** Los ganchos vigentes; `edicion` los lee en cada llamada, así que `conectarExplorador` los sustituye. */
  private ganchos: GanchosConexion
  private readonly log: (msg: string) => void
  /** Puente local: permite montar y desmontar en caliente, sin reiniciar la sesión del agente. */
  private readonly puente: PuenteBd
  /** Puente al host para el modo Docker: el contenedor deja la petición en un buzón y `tdb` corre aquí. */
  private readonly puenteDocker: PuenteDocker
  private readonly tdb: InvocadorTdb
  private readonly espacio: EspacioDatos
  private readonly archivos: MotoresDeArchivo
  private readonly edicion: EdicionRegistro
  /** El módulo SSH, que nace después (necesita el puente): sin él no se abre ningún túnel. */
  private ssh: SshParaTuneles | null = null
  private readonly tuneles: GestorTuneles

  constructor(opts: OpcionesControladorBd) {
    this.conexiones = opts.conexiones
    this.drivers = opts.drivers
    this.dirDatosUsuario = opts.dirDatosUsuario
    this.dirApp = opts.dirApp
    this.eventos = opts.eventos
    this.dialogos = opts.dialogos
    this.onCambio = opts.onCambio ?? (() => {})
    this.antesDeCambiarDriver = opts.antesDeCambiarDriver ?? (() => Promise.resolve())
    this.log = opts.log ?? ((m) => console.log(`[db] ${m}`))
    this.espacio = new EspacioDatos(this.dirDatosUsuario, this.conexiones, opts.papelera, this.log)
    this.archivos = new MotoresDeArchivo({
      conexiones: this.conexiones,
      dirScriptTdb: () => this.dirScriptTdb(),
      contenedoraAnclada: opts.contenedoraAnclada ?? (() => null),
      dialogos: this.dialogos,
      avisarCambio: () => this.enviarCambio(),
      onCambio: (perfilId) => this.onCambio(perfilId)
    })
    this.ganchos = {
      puedeEditarConexion: opts.puedeEditarConexion ?? (() => ({ ok: true })),
      onConexionEditada: opts.onConexionEditada ?? (() => {}),
      onConexionBorrada: opts.onConexionBorrada ?? (() => {}),
      onConexionOlvidadaEnPerfil: opts.onConexionOlvidadaEnPerfil ?? (() => {})
    }
    this.edicion = new EdicionRegistro({
      conexiones: this.conexiones,
      ganchos: {
        puedeEditarConexion: (id, soloCasilla) => this.ganchos.puedeEditarConexion(id, soloCasilla),
        onConexionEditada: (previo, nuevo, soloCasilla) => this.ganchos.onConexionEditada(previo, nuevo, soloCasilla),
        onConexionBorrada: (id, perfilId) => this.ganchos.onConexionBorrada(id, perfilId),
        onConexionOlvidadaEnPerfil: (id, perfilId) => this.ganchos.onConexionOlvidadaEnPerfil(id, perfilId)
      },
      resolverEntrada: (entrada) => this.archivos.resolverEntrada(entrada),
      onCambio: (perfilId) => this.onCambio(perfilId),
      avisarCambio: () => this.enviarCambio()
    })
    this.tuneles = new GestorTuneles({
      preparar: (perfilId, sshId, destino, puertoLocal) => {
        if (this.ssh === null) throw new Error(txDb().conexion.sinTuneles)
        return this.ssh.prepararTunelBd(perfilId, sshId, destino, puertoLocal)
      },
      aliasSsh: (id) => this.ssh?.aliasDe(id) ?? null,
      lanzar: lanzarTunel,
      puertoLibre,
      escucha,
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      ahora: () => Date.now(),
      log: (m) => registroBd('tuneles', m)
    })
    this.puente = new PuenteBd({
      conexionesDelPerfil: (id) => this.conexiones.listar(id),
      secretoDe: (id) => this.conexiones.secretoDe(id),
      tunelDe: (c) => {
        const con = this.conexiones.obtener(c.id)
        return con ? this.tunelDe(con) : null
      },
      log: (m) => registroBd('puente', m)
    })
    this.puente.iniciar()
    this.tdb = new InvocadorTdb({
      puente: this.puente,
      conexiones: this.conexiones,
      drivers: this.drivers,
      tdbScript: this.tdbScript,
      log: this.log
    })
    this.puenteDocker = new PuenteDocker({
      raiz: path.join(this.dirDatosUsuario, 'dbbridge'),
      clienteOrigen: path.join(this.dirApp, 'src', 'tdb', 'tdb-container.cjs'),
      ejecutar: (token, argv, entrada) => this.tdb.ejecutarParaContenedor(token, argv, entrada),
      log: (m) => registroBd('docker', m)
    })
    escribirAtajos({ raizBin: this.raizBin, tdbScript: this.tdbScript, log: this.log })
  }

  /**
   * Engancha el explorador de BD, que nace después porque necesita a este controlador. La raíz
   * lo llama justo tras construirlo, antes de que ningún canal pueda atenderse.
   */
  conectarExplorador(explorador: ExploradorDelRegistro): void {
    this.ganchos = {
      puedeEditarConexion: (id, soloCasilla) => explorador.puedeEditarConexion(id, soloCasilla),
      onConexionEditada: (previo, nuevo, soloCasilla) => explorador.alCambiarConexion(previo, nuevo, soloCasilla),
      onConexionBorrada: (id, perfilId) => explorador.alBorrarConexion(id, perfilId),
      // Lo fijan `test:db-registro` (caso 18) y el (G1) de e2e/conexiones-compatibilidad.spec.ts.
      onConexionOlvidadaEnPerfil: (id, perfilId) => explorador.alOlvidarConexionEnPerfil(id, perfilId)
    }
    this.antesDeCambiarDriver = (paqueteDriverId) => explorador.antesDeCambiarDriver(paqueteDriverId)
  }

  /** Engancha el módulo SSH, que nace después: desde aquí se validan y se abren los túneles de las bases. */
  conectarSsh(ssh: SshParaTuneles): void {
    this.ssh = ssh
    this.conexiones.conocerConexionesSsh((perfilId, id) => ssh.existeEnPerfil(perfilId, id))
  }

  /**
   * El extremo local del túnel SSH de una conexión, abriéndolo si hace falta; `null` si no lleva túnel.
   * Lo piden `tdb` (por el puente) y el explorador antes de abrir una sesión.
   */
  tunelDe(con: ConexionBd): Promise<DestinoTunel> | null {
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
  atarSesion(extraEnv: Record<string, string>, sesionId: string): void {
    const token = extraEnv[ENV_SESION]
    if (token) this.puente.bind(token, sesionId)
  }

  /** Revoca lo que tuviera esa sesión. Llamar desde TODOS los caminos de cierre. */
  revocarSesion(sesionId: string): void {
    this.puente.revocar(sesionId)
  }

  /** La puerta del puente para otros dominios: registran sus operaciones (`ssh.*`) sin tocar el contrato de `tdb`. */
  get puertaPuente(): PuertaPuente {
    return this.puente
  }

  /** De quién es un token de sesión del puente (`PuenteBd.sesionDeToken`): para quien atiende por el buzón sin lanzar un proceso. */
  sesionDeToken(token: string): SesionDelPuente | null {
    return this.puente.sesionDeToken(token)
  }

  /** La puerta del buzón de Docker para otros dominios: registran su programa (`tssh`, `tctx`) junto a `tdb`. */
  get puertaBuzon(): PuertaBuzon {
    return this.puenteDocker
  }

  /** Fija las bases montadas de un proyecto: la siguiente invocación de `tdb` ya las ve (montaje en caliente). */
  fijarAmbito(perfilId: string, rutaHostProyecto: string, ids: readonly string[]): void {
    // Los ids se guardan tal cual: el filtro vive en `PuenteBd.resolver`, que los cruza con las
    // conexiones conocidas del perfil en cada invocación. Se apunta aunque el puente esté en pausa.
    this.puente.fijarAmbito(perfilId, rutaHostProyecto, ids)
    registroBd('puente', `ámbito de ${perfilId}|${rutaHostProyecto} = [${ids.join(',')}]`)
  }

  /**
   * Entorno de una terminal en modo Docker: solo un token, una ruta y el idioma, ninguna contraseña.
   * Sin el puente levantado, solo el idioma: sin él, el modo Docker no ofrece bases.
   */
  entornoContenedor(
    perfilId: string,
    rutaHostProyecto: string,
    idsMontados: readonly string[],
    rutaBuzonEnContenedor: string
  ): Record<string, string> {
    // El idioma no depende del puente: sin él, `tdb`, `tssh` y `tctx` del contenedor explican el fallo.
    if (!this.puente.listo) return { [VARIABLE_IDIOMA]: idiomaActual() }
    const delPerfil = this.conexiones.listar(perfilId)
    const validas = idsMontados.filter((id) => delPerfil.some((c) => c.id === id))
    this.puente.fijarAmbito(perfilId, rutaHostProyecto, validas)
    const env = {
      [ENV_MODO]: 'pipe',
      // El agente de datos en contenedor también llega aquí: la marca da a `tdb` sus textos.
      [ENV_SESION]: this.puente.emitir(perfilId, rutaHostProyecto, {
        espacioDatos: this.espacio.esEspacioDeDatos(perfilId, rutaHostProyecto)
      }),
      [ENV_BUZON]: rutaBuzonEnContenedor,
      [VARIABLE_IDIOMA]: idiomaActual()
    }
    registroBd(
      'env',
      `[docker] perfil=${perfilId} proyecto=${rutaHostProyecto} idsPedidos=${idsMontados.length} ` +
        `idsValidos=${validas.length} buzon=${rutaBuzonEnContenedor}`
    )
    return env
  }

  /**
   * Prepara el buzón del perfil y devuelve su carpeta del host para que el sandbox la monte.
   * Idempotente: se llama en cada `ensureContainer`, así el puente sobrevive a que se recree el contenedor.
   */
  prepararBuzonDocker(perfilId: string): string {
    return this.puenteDocker.prepararPerfil(perfilId)
  }

  /** Deja de sondear el buzón de un perfil cuyo contenedor murió; el buzón en disco no se borra. */
  olvidarBuzonDocker(perfilId: string): void {
    this.puenteDocker.olvidarPerfil(perfilId)
  }

  /**
   * Apaga los puentes al empezar el cierre de la app. Es una pausa y no un `stop()` porque ese cierre
   * puede abortarse: el local conserva su nombre, tokens y ámbitos para `reanudarPuente()`.
   */
  pararPuente(): void {
    void this.puente.pausar()
    this.puenteDocker.detener()
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
  dirScriptTdb(): string {
    return path.join(this.dirApp, 'src', 'tdb')
  }

  /** Script del CLI. Misma ruta en dev y en producción gracias a `asar: false`. */
  private get tdbScript(): string {
    return path.join(this.dirScriptTdb(), 'tdb.cjs')
  }

  /** Contexto de drivers para el mensaje `abrir` del proceso de sesión, igual al que arma `tdb.cjs`. */
  ctxDrivers(): CtxDrivers {
    return contextoDeDrivers(this.drivers.dirDrivers)
  }

  /** Raíz de los atajos: dentro cuelga una carpeta por contrato (`s1`, `s2`…). */
  private get raizBin(): string {
    return path.join(this.dirDatosUsuario, 'bin')
  }

  /** Carpeta que se antepone al PATH de las terminales de Tessera. */
  get dirBin(): string {
    return path.join(this.raizBin, SHIM_DIR)
  }

  // --- Espacio de datos por perfil -------------------------------------------

  /** Ruta `<userData>/conexiones/<perfil>` validada como hija directa, sin crearla. */
  espacioDeDatos(perfilId: string): string {
    return this.espacio.ruta(perfilId)
  }

  /** Rutas del espacio de datos de todos los perfiles, sin crearlas; un id inválido se omite. */
  rutasEspacios(perfilIds: string[]): Record<string, string> {
    return this.espacio.rutas(perfilIds)
  }

  /** Crea el espacio si hace falta, siembra el contexto del agente y devuelve la ruta para abrirlo como proyecto. */
  asegurarEspacio(perfilId: string, nombrePerfil: string): { projectHostPath: string; name: string } {
    return this.espacio.asegurar(perfilId, nombrePerfil)
  }

  /**
   * El espacio de datos tal como lo borra el guardado de perfiles, con la papelera ya dentro: llega a la
   * composición como dependencia, igual que la carpeta del agente de la terminal.
   */
  get espacioDatos(): Pick<EspacioDatos, 'borrar'> {
    return this.espacio
  }

  /** Regenera el contexto del agente de un perfil, si su espacio ya existe. */
  refrescarContextoEspacio(perfilId: string, nombrePerfil: string): void {
    this.espacio.refrescarContexto(perfilId, nombrePerfil)
  }

  // --- Entorno para los pty --------------------------------------------------

  /**
   * Variables de una terminal de modo nativo: registro, drivers, perfil, ámbito y un secreto por
   * conexión, más el PATH con los atajos. La lógica vive en `entornoHost.ts`; aquí se le sirven las
   * dependencias y se registra qué decidió.
   */
  entornoHost(
    perfilId: string,
    rutaHostProyecto: string,
    idsMontados: readonly string[]
  ): Record<string, string> {
    const { env, diag } = construirEntornoHost(
      {
        dirBin: this.dirBin,
        rutaRegistro: this.conexiones.rutaRegistro,
        dirDrivers: this.drivers.dirDrivers,
        conexionesDelPerfil: (id) => this.conexiones.listar(id),
        secretoDe: (id) => this.conexiones.secretoDe(id),
        // Solo informativo: un id inválido no tiene espacio y da cadena vacía en vez de tumbar la terminal.
        espacioDeDatos: (id) => this.espacio.rutaOVacia(id),
        puente: this.puente.listo
          ? {
              pipe: this.puente.pipe,
              emitir: (perfil, proyecto, info) => this.puente.emitir(perfil, proyecto, info),
              fijarAmbito: (perfil, proyecto, ids) => this.puente.fijarAmbito(perfil, proyecto, ids)
            }
          : undefined
      },
      perfilId,
      rutaHostProyecto,
      idsMontados
    )
    registroBd(
      'env',
      `perfil=${perfilId} proyecto=${rutaHostProyecto} modo=${diag.modo} espacioDatos=${diag.espacioDatos} ` +
        `idsPedidos=${diag.idsPedidos} idsValidos=${diag.idsValidos} ` +
        `secretos=${diag.secretosResueltos}/${diag.secretosPedidos} ` +
        `claves=[${diag.claves.join(',')}]`
    )
    // Cada id descartado dice su causa; la lista completa se pide solo si hay descartes.
    if (diag.idsDescartados.length > 0) {
      const registro = registroParaDescartes(this.conexiones.listaCompleta(perfilId))
      for (const linea of avisosDeDescartados(diag.idsDescartados, registro, perfilId)) registroBd('env', linea)
    }
    if (diag.secretosResueltos < diag.secretosPedidos) {
      registroBd(
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
  briefingParaAgente(perfilId: string, rutaHostProyecto: string, conexionIds: string[]): string | null {
    const validas = conexionIds
      .map((id) => this.conexiones.obtener(id))
      .filter((c): c is ConexionBd => Boolean(c) && c!.profileId === perfilId)
    const conBases = briefingBasesAgente(validas, this.espacio.esEspacioDeDatos(perfilId, rutaHostProyecto))
    // Sin bases, el aviso corto de que `tdb` existe; sin puente, `tdb` no podría atender y no se anuncia.
    return conBases ?? (this.puente.listo ? AVISO_SIN_BASES : null)
  }

  /** El usuario borró el perfil (`perfiles/borradoDePerfil.ts`): fuera sus conexiones, ajenas incluidas. */
  alBorrarPerfil(perfilId: string): void {
    for (const c of this.conexiones.listar(perfilId)) this.tuneles.cerrar(c.id)
    this.conexiones.alBorrarPerfil(perfilId)
    this.enviarCambio()
  }

  /** Las conexiones de un perfil con sus contraseñas, para una copia de la configuración (solo dentro del main). */
  paraCopia(perfilId: string): ReturnType<AlmacenConexiones['paraCopia']> {
    return this.conexiones.paraCopia(perfilId)
  }

  /** ¿Hay ya una conexión con ese id? Para la vista previa de una copia de la configuración. */
  idOcupado(id: string): boolean {
    return this.conexiones.idOcupado(id)
  }

  /**
   * Las conexiones de una copia de la configuración de los perfiles importados, con un solo aviso al
   * final. `revisar`: las de un archivo que no está en este equipo.
   */
  importarDeCopia(copia: unknown, perfiles: ReadonlySet<string>): { anadidas: number; saltadas: Array<{ alias: string; motivo: string }>; revisar: string[] } {
    const r = { anadidas: 0, saltadas: [] as Array<{ alias: string; motivo: string }>, revisar: [] as string[] }
    for (const elemento of Array.isArray(copia) ? copia : []) {
      const c = (typeof elemento === 'object' && elemento !== null ? elemento : {}) as { registro?: Record<string, unknown>; secreto?: unknown }
      const reg = c.registro ?? {}
      if (typeof reg.profileId !== 'string' || !perfiles.has(reg.profileId)) continue
      const alias = typeof reg.alias === 'string' ? reg.alias : '(sin nombre)'
      const motivo = this.conexiones.importarDeCopia(reg, c.secreto)
      if (motivo !== null) {
        r.saltadas.push({ alias, motivo })
        continue
      }
      r.anadidas++
      if (typeof c.secreto === 'string' && c.secreto !== '' && !this.conexiones.puedeGuardarSecretos()) {
        r.revisar.push(txDb().importacion.sinContrasena(alias))
      }
      if (typeof reg.archivo === 'string' && !existsSync(reg.archivo)) r.revisar.push(txDb().importacion.archivoAusente(alias))
    }
    if (r.anadidas > 0) this.enviarCambio()
    return r
  }

  // --- Lo que atiende `ipc.ts` -------------------------------------------------

  /** Conexiones conocidas de un perfil. */
  listar(perfilId: string): ConexionBd[] {
    return this.conexiones.listar(perfilId)
  }

  /** Conocidas y ajenas de un perfil, con la marca del formato ajeno del archivo entero. */
  listarCompleta(perfilId: string): DbListaConexiones {
    return this.conexiones.listaCompleta(perfilId)
  }

  /** Alta de una conexión. */
  crearConexion(entrada: DatosEntradaConexionBd): ConexionBd {
    return this.edicion.crear(DB_CHANNELS.CREATE, entrada)
  }

  /** Edición de una conexión: se bloquea antes de tocar el registro si hay una transacción pendiente. */
  editarConexion(req: { id: string; input: DatosEntradaConexionBd }): ConexionBd {
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
  montarArchivo(req: PeticionMontarArchivoBd): DbMontarArchivoRespuesta {
    return sinRutasDelHost(DB_CHANNELS.ARCHIVO_MONTAR, () => this.archivos.montar(req))
  }

  /** La conexión del perfil que ya apunta a ese archivo del proyecto. */
  conexionDeArchivo(req: PeticionMontarArchivoBd): DbConexionDeArchivo {
    return this.archivos.conexionDe(req)
  }

  /** Probar conexión: abre de verdad contra el servidor y avisa a las vistas del resultado. */
  probar(id: string): Promise<ResultadoProbarConexion> {
    return probarConexion(
      {
        conexiones: this.conexiones,
        ejecutar: (con, args) => this.tdb.ejecutarParaConexion(con, args),
        avisarCambio: () => this.enviarCambio()
      },
      id
    )
  }

  /** Estado de los drivers, para el panel. */
  estadoDrivers(): EstadoDriver[] {
    return this.drivers.estado()
  }

  /** Instala un pack de drivers tras esperar al explorador (en Windows, EBUSY al sobrescribir DLL cargadas). */
  async instalarDriver(paqueteDriverId: string): Promise<EstadoDriver> {
    await this.antesDeCambiarDriver(paqueteDriverId)
    return this.drivers.instalar(paqueteDriverId)
  }

  /** Registra un cliente externo ya instalado, tras esperar al explorador. */
  async usarClienteExistente(paqueteDriverId: string, ruta: string): Promise<EstadoDriver> {
    await this.antesDeCambiarDriver(paqueteDriverId)
    return this.drivers.usarExistente(paqueteDriverId, ruta)
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
  enviarProgresoDriver(p: ProgresoDriver): void {
    this.eventos.emitir(DB_CHANNELS.DRIVERS_PROGRESS, p)
  }

  /** Avisa al renderer de que el registro cambió, para que ambas vistas se refresquen. */
  private enviarCambio(): void {
    this.eventos.emitir(DB_CHANNELS.CHANGED)
  }

  /** `db:changed` para quien cambia el registro fuera de estos canales (el explorador). */
  notificarCambio(): void {
    this.enviarCambio()
  }

  /** Olvida el cliente externo de un pack, esperando antes al explorador; ningún canal lo llama hoy. */
  async olvidarDriverExterno(paqueteDriverId: string): Promise<void> {
    await this.antesDeCambiarDriver(paqueteDriverId)
    this.drivers.olvidarExistente(paqueteDriverId)
  }
}
