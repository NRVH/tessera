// =============================================================================
// Controlador de las conexiones SSH: atiende los canales de `ssh-ipc.ts` sobre `ConexionesSsh`, las claves
// importadas y «Probar», avisa al renderer con `ssh:cambio` tras cada cambio (también de huellas) y
// responde el entorno del cliente SSH. Para la terminal es el `LanzadorSshTerminal`: prepara la línea de
// ssh de una conexión (con el programa de contraseñas si guarda un secreto) y clasifica su salida.
// Sin `electron`: lo recibe todo por parámetro.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md, docs/decisiones/ssh/motor-linea-y-huellas.md,
// docs/decisiones/ssh/claves-importadas.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename } from 'node:path'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import {
  SSH_CHANNELS,
  pideSecretoSsh,
  type SshAviso,
  type SshBorrarConexion,
  type SshBorrarGrupo,
  type SshClaveElegida,
  type SshClaveSoltada,
  type SshConexion,
  type SshConexionBorrada,
  type SshConexionInput,
  type SshCrearGrupo,
  type SshEditarConexion,
  type SshElegirClave,
  type SshEntorno,
  type SshGrupo,
  type SshGrupoBorrado,
  type SshImportarOpenSsh,
  type SshLecturaOpenSsh,
  type SshListaConexiones,
  type SshOlvidarHuella,
  type SshProbar,
  type SshRenombrarGrupo,
  type SshResultadoPrueba
} from '../../shared/ssh-ipc.ts'
import type { TerminalExitReason } from '../../shared/terminal-ipc.ts'
import type { LanzadorSshTerminal, PreparacionSsh } from '../terminals/lanzadorSsh.ts'
import type { EmisorEventos } from '../util/emisorEventos.ts'
import { entornoSsh, mensajeSinSsh, resolverBinariosSsh, type BinariosSsh, type EjecutableSsh } from './binariosSsh.ts'
import { briefingSsh } from './briefingSsh.ts'
import { catalogoAgentes } from './catalogoAgentes.ts'
import { clasificarSalidaSsh } from './clasificacionSalida.ts'
import { analizarConfigOpenSsh, candidatasOpenSsh } from './configOpenSsh.ts'
import type { ConexionesSsh } from './ConexionesSsh.ts'
import type { ConexionSshPersistida } from './conservarAlEditarSsh.ts'
import { SIN_SECRETO, type AskpassSsh } from './controlador/askpassSsh.ts'
import { ErrorClave, type ClavesImportadas, type InstalacionClave } from './controlador/clavesImportadas.ts'
import { TOPE_PRUEBA_MS, resultadoPrueba, type EjecutarSsh } from './controlador/pruebaSsh.ts'
import { FICHA_PESTANA, FICHA_PRUEBA } from './fichasAskpass.ts'
import { huellasDeKnownHosts } from './huellasSsh.ts'
import { MENSAJE_SIN_COPIA_CLAVE, argumentosSsh } from './lineaSsh.ts'
import { QUITAR_ENV_SSH } from './programaAskpass.ts'
import { mensajeDeFalloSsh } from './registroSsh.ts'
import { errorHost, errorPuerto, errorUsuario } from './validacionSsh.ts'
import type { LineaSftp } from './sftp/SesionesSftp.ts'

/** Lo que recibe el controlador. */
export interface OpcionesControladorSsh {
  conexiones: ConexionesSsh
  eventos: EmisorEventos
  /** Las claves importadas; sin ellas no se puede elegir ni guardar un archivo de clave. */
  claves?: ClavesImportadas
  /** El programa de contraseñas; sin él, las contraseñas guardadas no se usan (se teclean). */
  askpass?: AskpassSsh
  /** Corre el ssh de «Probar» (sin consola y con tope); sin él no se puede probar. */
  ejecutar?: EjecutarSsh
  /** Dónde está el cliente SSH; se pregunta en cada uso (se puede instalar con Tessera abierta). */
  binarios?: () => BinariosSsh
  /** Si existe la copia de una clave (se sustituye en las pruebas). */
  existe?: (ruta: string) => boolean
  /** El diálogo nativo del archivo `config` de OpenSSH: su ruta, o `null` si se cancela. Sin él no se importa. */
  elegirConfigOpenSsh?: () => Promise<string | null>
  /** El home del usuario, para los `IdentityFile` de OpenSSH (se sustituye en las pruebas). */
  home?: string
  plataforma?: Plataforma
  ahora?: () => number
  log?: (mensaje: string) => void
}

/** La ficha de una clave recién elegida, si la conexión usa archivo de clave y el formulario la trae. */
function fichaDe(input: SshConexionInput): string | null {
  return input.metodo === 'clave' && input.clave !== undefined ? input.clave.token : null
}

/** Tope del archivo `config` de OpenSSH: uno de verdad no pasa de unos KiB. */
const TOPE_CONFIG_OPENSSH_BYTES = 1024 * 1024

/** Lee el archivo elegido; un error sin rutas del host si no se puede o es demasiado grande para ser un `config`. */
async function leerConfigOpenSsh(ruta: string): Promise<string> {
  try {
    if ((await stat(ruta)).size > TOPE_CONFIG_OPENSSH_BYTES) throw new Error('grande')
    return await readFile(ruta, 'utf8')
  } catch (e) {
    throw new Error('No se pudo leer ese archivo como configuración de OpenSSH.', { cause: e })
  }
}

/** El usuario local, para `%u` en un `IdentityFile`; vacío si el sistema no lo dice. */
function usuarioLocal(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

/** Una conexión lista para lanzar ssh: sus datos comprobados, la copia de su clave y el cliente SSH. */
interface DestinoSsh {
  c: ConexionSshPersistida
  rutaClave: string | undefined
  ssh: EjecutableSsh
}

/** Las conexiones SSH de los perfiles, para el renderer y para la terminal. */
export class ControladorSsh implements LanzadorSshTerminal {
  private readonly conexiones: ConexionesSsh
  private readonly eventos: EmisorEventos
  private readonly claves: ClavesImportadas | null
  private readonly askpass: AskpassSsh | null
  private readonly ejecutar: EjecutarSsh | null
  private readonly binarios: () => BinariosSsh
  private readonly existe: (ruta: string) => boolean
  private readonly elegirConfigOpenSsh: (() => Promise<string | null>) | null
  private readonly home: string
  private readonly plataforma: Plataforma
  private readonly ahora: () => number
  private readonly log: (mensaje: string) => void

  constructor(opts: OpcionesControladorSsh) {
    this.conexiones = opts.conexiones
    this.eventos = opts.eventos
    this.claves = opts.claves ?? null
    this.askpass = opts.askpass ?? null
    this.ejecutar = opts.ejecutar ?? null
    this.plataforma = opts.plataforma ?? plataformaActual()
    this.binarios = opts.binarios ?? (() => resolverBinariosSsh({ plataforma: this.plataforma }))
    this.existe = opts.existe ?? existsSync
    this.elegirConfigOpenSsh = opts.elegirConfigOpenSsh ?? null
    this.home = opts.home ?? homedir()
    this.ahora = opts.ahora ?? Date.now
    this.log = opts.log ?? ((m) => console.log(`[ssh] ${m}`))
  }

  /**
   * Corre una escritura del registro y, si sale bien, avisa al renderer. Un error de `fs` en crudo
   * lleva rutas del host: al renderer solo llega el mensaje propio, y el original va al registro.
   */
  private cambiar<T>(canal: string, escribir: () => T): T {
    let resultado: T
    try {
      resultado = escribir()
    } catch (e) {
      const mensaje = mensajeDeFalloSsh(e)
      if (e instanceof Error && mensaje === e.message) throw e
      this.log(`${canal} falló: ${String(e)}`)
      throw new Error(mensaje, { cause: e })
    }
    this.eventos.emitir(SSH_CHANNELS.CAMBIO)
    return resultado
  }

  /** Las claves importadas, o un error claro si este controlador no las tiene. */
  private clavesImportadas(): ClavesImportadas {
    if (this.claves === null) throw new ErrorClave('Esta ventana de Tessera no puede importar archivos de clave.')
    return this.claves
  }

  /**
   * Guarda con la copia de `token` ya en `ssh/claves/<id>`: si el registro falla, la copia vuelve a
   * ser provisional (la ficha sigue valiendo) y la clave anterior, si la había, a su sitio.
   */
  private conClave<T>(token: string, id: string, profileId: string, guardar: (instalacion: InstalacionClave) => T): T {
    const instalacion = this.clavesImportadas().instalar(token, id, profileId)
    let resultado: T
    try {
      resultado = guardar(instalacion)
    } catch (e) {
      instalacion.deshacer()
      throw e
    }
    instalacion.confirmar()
    return resultado
  }

  listar(): SshListaConexiones {
    return this.conexiones.listar()
  }

  crear(input: SshConexionInput): SshConexion {
    return this.cambiar(SSH_CHANNELS.CREAR, () => this.alta(input))
  }

  /** El alta sin avisar al renderer: con la clave recién elegida, si la trae, ya en `ssh/claves/<id>`. */
  private alta(input: SshConexionInput): SshConexion {
    const token = fichaDe(input)
    if (token === null) return this.conexiones.crear(input)
    const id = randomUUID()
    return this.conClave(token, id, input.profileId, (i) => this.conexiones.crear(input, { id, clave: i.clave }))
  }

  /**
   * «Importar desde OpenSSH…»: el diálogo nativo y lo que trae cada `Host` concreto del archivo, con la copia
   * de su clave ya importada (ver `configOpenSsh.ts`). No da de alta nada: lo hace el renderer con `crear`
   * cuando la persona lo revisa. `null` si se cancela.
   */
  async leerOpenSsh(req: SshImportarOpenSsh): Promise<SshLecturaOpenSsh | null> {
    if (this.elegirConfigOpenSsh === null) throw new Error('Esta ventana de Tessera no puede importar conexiones de OpenSSH.')
    // Con un registro que no se sabe escribir no entra nada: ni se abre el diálogo.
    const previa = this.conexiones.listar()
    if (previa.formatoAjeno) throw new Error(previa.aviso)
    const ruta = await this.elegirConfigOpenSsh()
    if (ruta === null) return null
    const config = analizarConfigOpenSsh(await leerConfigOpenSsh(ruta))
    const l = this.conexiones.listar(req.profileId)
    const candidatas = await candidatasOpenSsh(config, {
      existentes: [...l.conexiones.map((c) => c.alias), ...l.ajenas.filter((a) => a.tipo === 'conexion').map((a) => a.nombre)],
      entorno: { home: this.home, usuario: usuarioLocal(), plataforma: this.plataforma },
      importarClave: (rutaClave) => this.clavesImportadas().soltada(rutaClave, req.profileId),
      log: this.log
    })
    this.log(`importar de OpenSSH: ${candidatas.length} host(s), ${config.patrones} con patrones, ${config.include} Include`)
    return { archivo: basename(ruta), candidatas, conPatrones: config.patrones, include: config.include }
  }

  editar(req: SshEditarConexion): SshConexion {
    const editada = this.cambiar(SSH_CHANNELS.EDITAR, () => {
      const token = fichaDe(req.input)
      if (token === null) return this.conexiones.editar(req.id, req.input)
      // Antes de mover ningún archivo: que la conexión exista y sea de ese perfil.
      const previa = this.conexiones.conexion(req.id)
      if (!previa) throw new Error('Esa conexión ya no existe.')
      if (previa.profileId !== req.input.profileId) throw new Error('Una conexión no puede cambiar de perfil.')
      return this.conClave(token, req.id, previa.profileId, (i) => this.conexiones.editar(req.id, req.input, { clave: i.clave }))
    })
    this.askpass?.alCambiarConexion(req.id)
    return editada
  }

  borrar(req: SshBorrarConexion): SshConexionBorrada {
    const r = this.cambiar(SSH_CHANNELS.BORRAR, () => this.conexiones.borrar(req.id, req.profileId))
    this.askpass?.alCambiarConexion(req.id)
    return r
  }

  crearGrupo(req: SshCrearGrupo): SshGrupo {
    return this.cambiar(SSH_CHANNELS.GRUPO_CREAR, () => this.conexiones.crearGrupo(req.profileId, req.nombre))
  }

  renombrarGrupo(req: SshRenombrarGrupo): SshGrupo {
    return this.cambiar(SSH_CHANNELS.GRUPO_RENOMBRAR, () => this.conexiones.renombrarGrupo(req.id, req.profileId, req.nombre))
  }

  borrarGrupo(req: SshBorrarGrupo): SshGrupoBorrado {
    return this.cambiar(SSH_CHANNELS.GRUPO_BORRAR, () => this.conexiones.borrarGrupo(req.id, req.profileId))
  }

  entorno(): SshEntorno {
    return entornoSsh(this.binarios())
  }

  /** El aviso SSH del arranque de un agente nativo del perfil, o `null` sin conexiones disponibles para los agentes. */
  briefingAgente(profileId: string): string | null {
    try {
      return briefingSsh(catalogoAgentes(this.conexiones.listar(profileId), profileId))
    } catch (e) {
      // Un aviso que no se puede componer no impide arrancar al agente: arranca con el de bases.
      this.log(`no se pudo componer el aviso SSH del agente: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /** Diálogo nativo para elegir el archivo de clave: se importa una copia protegida. `null` si se cancela. */
  elegirClave(req: SshElegirClave): Promise<SshClaveElegida | null> {
    return this.clavesImportadas().elegir(req.profileId)
  }

  /** Un archivo soltado sobre el campo de la clave (la ruta la sacó el preload); como al elegir, solo vale para su perfil. */
  claveSoltada(req: SshClaveSoltada): Promise<SshClaveElegida> {
    return this.clavesImportadas().soltada(req.ruta, req.profileId)
  }

  /** Olvida las huellas guardadas del servidor de una conexión: la próxima vez acepta la que presente. */
  olvidarHuella(req: SshOlvidarHuella): void {
    this.cambiar(SSH_CHANNELS.HUELLA_OLVIDAR, () => this.conexiones.olvidarHuellas(req.id))
  }

  /** El usuario borró un perfil: se van sus conexiones, sus grupos y los archivos de sus conexiones. */
  alBorrarPerfil(profileId: string): void {
    this.cambiar('alBorrarPerfil', () => this.conexiones.alBorrarPerfil(profileId))
  }

  /** La copia de la clave de una conexión con archivo de clave; lanza si no está. */
  private rutaClaveDe(id: string, conClave: boolean): string {
    const ruta = this.conexiones.rutaClave(id)
    if (!conClave || !this.existe(ruta)) throw new Error(MENSAJE_SIN_COPIA_CLAVE)
    return ruta
  }

  /** La conexión vigente (de ese perfil, si se dice), con sus datos comprobados; lanza con un mensaje para el usuario. */
  private destino(conexionId: string, profileId?: string): DestinoSsh {
    const c = this.conexiones.conexion(conexionId)
    if (!c) throw new Error('Esa conexión SSH ya no existe.')
    if (profileId !== undefined && c.profileId !== profileId) throw new Error('Esa conexión SSH no es de este perfil.')
    // Se validó al guardar, pero el archivo se puede editar a mano y esto acaba en la línea de ssh.
    const error = errorHost(c.host) ?? errorPuerto(c.puerto) ?? errorUsuario(c.usuario)
    if (error !== null) throw new Error(`La conexión "${c.alias}" tiene un dato que no vale: ${error} Edítala para corregirlo.`)
    const rutaClave = c.metodo === 'clave' ? this.rutaClaveDe(c.id, c.clave !== undefined) : undefined
    const b = this.binarios()
    if (b.ssh === null) throw new Error(mensajeSinSsh(this.plataforma))
    if (b.dePrueba) this.log('ssh con TESSERA_SSH_BINARIO (solo pruebas)')
    return { c, rutaClave, ssh: b.ssh }
  }

  /** Dice al renderer (y al registro) por qué una pestaña no usará el secreto guardado. */
  private avisar(c: ConexionSshPersistida, texto: string): void {
    this.log(`conexion=${c.id}: ${texto}`)
    const aviso: SshAviso = { alias: c.alias, texto }
    this.eventos.emitir(SSH_CHANNELS.AVISO, aviso)
  }

  /**
   * La línea de ssh de una conexión del perfil, con sus datos vigentes (ver `LanzadorSshTerminal`). Al
   * terminar, la ficha del programa de contraseñas se revoca y, si ssh guardó una huella, se avisa.
   */
  preparar(profileId: string, conexionId: string): PreparacionSsh {
    const { c, rutaClave, ssh } = this.destino(conexionId, profileId)
    const secreto = this.askpass?.entorno(c, FICHA_PESTANA, true) ?? SIN_SECRETO
    if (secreto.aviso !== undefined) this.avisar(c, secreto.aviso)
    const rutaHuellas = this.conexiones.rutaHuellas(c.id)
    const args = argumentosSsh(c, { modo: 'humano', rutaHuellas, rutaClave, plataforma: this.plataforma, conAskpass: secreto.conAskpass })
    const huellasAntes = this.conexiones.textoHuellas(c.id)
    return {
      ejecutable: { archivo: ssh.exe, args: [...ssh.args, ...args], quitarEnv: [...QUITAR_ENV_SSH] },
      extraEnv: { TERM: 'xterm-256color', ...secreto.env },
      alTerminar: () => {
        this.askpass?.soltar(secreto.ficha)
        if (this.conexiones.textoHuellas(c.id) !== huellasAntes) this.eventos.emitir(SSH_CHANNELS.CAMBIO)
      }
    }
  }

  /**
   * La línea del explorador SFTP de una conexión del perfil: la de la pestaña (huella, clave y contraseña
   * guardada) con el subsistema `sftp` y sin terminal. El entorno es el de Tessera sin lo que ssh no debe
   * heredar, más el del programa de contraseñas. `alConectar` suelta la ficha y avisa de una huella nueva.
   */
  prepararSftp(profileId: string, conexionId: string): LineaSftp {
    const { c, rutaClave, ssh } = this.destino(conexionId, profileId)
    const secreto = this.askpass?.entorno(c, FICHA_PESTANA, true) ?? SIN_SECRETO
    if (secreto.aviso !== undefined) this.avisar(c, secreto.aviso)
    const rutaHuellas = this.conexiones.rutaHuellas(c.id)
    const args = argumentosSsh(c, { modo: 'humano', rutaHuellas, rutaClave, plataforma: this.plataforma, conAskpass: secreto.conAskpass, subsistemaSftp: true })
    const quitar = new Set(QUITAR_ENV_SSH.map((k) => k.toUpperCase()))
    const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !quitar.has(k.toUpperCase())))
    const huellasAntes = this.conexiones.textoHuellas(c.id)
    let soltada = false
    return {
      exe: ssh.exe,
      args: [...ssh.args, ...args],
      env: { ...env, ...secreto.env },
      alConectar: () => {
        if (soltada) return
        soltada = true
        this.askpass?.soltar(secreto.ficha)
        if (this.conexiones.textoHuellas(c.id) !== huellasAntes) this.eventos.emitir(SSH_CHANNELS.CAMBIO)
      }
    }
  }

  clasificar(exitCode: number | null, cola: string): TerminalExitReason | undefined {
    return clasificarSalidaSsh(exitCode, cola, this.plataforma)
  }

  /**
   * «Probar» la conexión GUARDADA: la línea de la pestaña sin terminal y con `exit 0`. Sin el secreto
   * que el método pide, solo se comprueba que se llega (y se guarda la huella).
   */
  async probar(req: SshProbar): Promise<SshResultadoPrueba> {
    if (this.ejecutar === null) throw new Error('Esta ventana de Tessera no puede probar conexiones SSH.')
    const { c, rutaClave, ssh } = this.destino(req.id)
    const secreto = this.askpass?.entorno(c, FICHA_PRUEBA, false) ?? SIN_SECRETO
    const rutaHuellas = this.conexiones.rutaHuellas(c.id)
    const opciones = { modo: 'humano' as const, rutaHuellas, rutaClave, plataforma: this.plataforma, conAskpass: secreto.conAskpass, prueba: true }
    const antes = this.conexiones.textoHuellas(c.id)
    const t0 = this.ahora()
    const salida = await this.ejecutar(ssh.exe, [...ssh.args, ...argumentosSsh(c, opciones)], {
      topeMs: TOPE_PRUEBA_MS,
      quitarEnv: QUITAR_ENV_SSH,
      extraEnv: secreto.env
    })
    const ms = this.ahora() - t0
    const preguntaSinContestar = this.askpass?.soltar(secreto.ficha) ?? false
    const despues = this.conexiones.textoHuellas(c.id)
    if (despues !== antes) this.eventos.emitir(SSH_CHANNELS.CAMBIO)
    // Solo el código y lo que tardó: la salida de ssh lleva rutas y no va al registro.
    this.log(`probar conexion=${c.id} codigo=${salida.codigo ?? (salida.agotado ? 'tope' : '-')} ms=${ms}`)
    return resultadoPrueba(salida, {
      ms,
      huellas: huellasDeKnownHosts(despues ?? '', c.host, c.puerto),
      soloAlcance: !secreto.conAskpass && pideSecretoSsh(c),
      preguntaSinContestar,
      plataforma: this.plataforma,
      ...(secreto.aviso !== undefined ? { aviso: secreto.aviso } : {})
    })
  }
}
