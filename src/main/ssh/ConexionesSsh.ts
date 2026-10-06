// =============================================================================
// ConexionesSsh: fuente de verdad de las conexiones SSH de los perfiles y sus grupos, en
// `userData/ssh-connections.json`. Se lee una vez al construir; cada escritura es todo o nada y se
// niega a pisar un archivo cambiado por fuera. Lo que esta versión no entiende se conserva
// (`registroSsh.ts`). El secreto se guarda cifrado y no sale del main. Sin `electron`: el cifrado
// llega por parámetro.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { nombresSistema } from '../../shared/nombresSistema.ts'
import { plataformaActual } from '../../shared/plataforma.ts'
import type {
  SshConexion,
  SshConexionBorrada,
  SshConexionInput,
  SshGrupo,
  SshGrupoBorrado,
  SshListaConexiones
} from '../../shared/ssh-ipc.ts'
import type { CifradoSecretos } from '../db/adaptadores/cifradoSistema.ts'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'
import {
  conservarAlEditarSsh,
  type ClaveSshPersistida,
  type ConexionSshPersistida,
  type GrupoSshPersistido
} from './conservarAlEditarSsh.ts'
import { conservarAparteSsh, leerBytesSiExiste } from './copiaIlegibleSsh.ts'
import { huellasDeKnownHosts } from './huellasSsh.ts'
import { mensajeCopiaIlegibleFallidaSsh, mensajeEscrituraFallidaSsh, mensajeRegistroRecuperadoSsh } from './mensajesRegistroSsh.ts'
import {
  ID_SEGURO,
  ajenasSsh,
  avisoAlSobrescribirSsh,
  codigoDeError,
  conexionesConocidas,
  crudoDe,
  esContenidoIlegibleSsh,
  gruposConocidos,
  idDeEntrada,
  idsConArchivos,
  lecturaConRespaldoSsh,
  perfilDeEntrada,
  podarPerfilesSsh,
  rutaCopiaClave,
  separarConexion,
  serializarRegistroSsh,
  type Entrada,
  type EntradaConocida,
  type RegistroSsh
} from './registroSsh.ts'
import {
  MENSAJE_FALTA_CLAVE,
  camposAGuardarSsh,
  validarEntradaSsh,
  validarNombreGrupo,
  type ContextoValidacionSsh
} from './validacionSsh.ts'

/** El archivo de clave de una conexión: la copia la deja en `ssh/claves/<id>` quien llama, antes de guardar. */
export interface ClaveInstalada {
  clave?: ClaveSshPersistida
}

/** La copia que se aparta (`ssh/claves/<id>.anterior`) mientras se sustituye por una nueva. */
export const SUFIJO_CLAVE_ANTERIOR = '.anterior'

/** Lo que necesita el registro. */
export interface OpcionesConexionesSsh {
  storePath: string
  /** Carpeta de los `known_hosts` de cada conexión (`ssh/huellas`). */
  dirHuellas: string
  /** Carpeta de las claves importadas (`ssh/claves`). */
  dirClaves: string
  /** El almacén del sistema; sin él no se guarda ningún secreto ni se marca uno ilegible. */
  cifrado?: CifradoSecretos
  log?: (mensaje: string) => void
}

type Conocida = EntradaConocida<ConexionSshPersistida>

/** Registro de conexiones SSH con su persistencia crash-safe. */
export class ConexionesSsh {
  private readonly storePath: string
  private readonly dirHuellas: string
  private readonly dirClaves: string
  private readonly cifrado: CifradoSecretos | null
  private readonly log: (mensaje: string) => void
  /** El archivo entero tal como está en disco; una escritura lo sustituye por la copia que escribió. */
  private reg: RegistroSsh
  /** Texto del principal la última vez que se leyó o escribió: `null` si no existía, `undefined` si no se pudo leer. */
  private textoConocido: string | null | undefined
  /** El aviso de que se usan las conexiones del `.bak`, o `null`. */
  private recuperado: string | null = null
  /** El principal roto que ya se guardó aparte en esta sesión: impide una segunda copia. */
  private ilegibleConservado: string | null = null

  constructor(opts: OpcionesConexionesSsh) {
    this.storePath = opts.storePath
    this.dirHuellas = opts.dirHuellas
    this.dirClaves = opts.dirClaves
    this.cifrado = opts.cifrado ?? null
    this.log = opts.log ?? ((m) => console.log(`[ssh] ${m}`))
    this.reg = this.leer()
  }

  /** ¿El registro está bloqueado? Entonces las listas salen vacías aunque el archivo esté lleno. */
  get formatoAjeno(): boolean {
    return this.reg.formatoAjeno
  }

  // --- Persistencia ----------------------------------------------------------

  private leer(): RegistroSsh {
    this.textoConocido = undefined
    const { reg, rescateDeRoto } = lecturaConRespaldoSsh((ruta) => {
      // Mismo decodificador que `readFileSync(ruta, 'utf-8')`, para que `textoConocido` compare igual.
      const texto = leerBytesSiExiste(ruta)?.toString('utf-8') ?? null
      if (ruta === this.storePath) this.textoConocido = texto
      return texto
    }, this.storePath)
    this.recuperado = rescateDeRoto ? mensajeRegistroRecuperadoSsh(null) : null
    return reg
  }

  /** La única puerta de las escrituras: el cambio se aplica a una copia y solo si se escribe pasa a ser el registro. */
  private aplicar(cambio: (reg: RegistroSsh) => void): void {
    const nuevo = structuredClone(this.reg)
    cambio(nuevo)
    this.persistir(nuevo)
    this.reg = nuevo
  }

  private persistir(reg: RegistroSsh): void {
    const texto = serializarRegistroSsh(reg)
    this.exigirPrincipalSustituible()
    try {
      writeFileAtomicSync(this.storePath, texto)
    } catch (e) {
      // El error de `fs` lleva la ruta del host y llegaría al renderer.
      throw new Error(mensajeEscrituraFallidaSsh(codigoDeError(e)), { cause: e })
    }
    this.textoConocido = texto
  }

  /** Lanza si el principal cambió y no se puede sustituir; si es el roto leído al arrancar, lo guarda aparte una vez. */
  private exigirPrincipalSustituible(): void {
    let bytes: Buffer | null
    try {
      bytes = leerBytesSiExiste(this.storePath)
    } catch (e) {
      const conocido = this.textoConocido
      if (typeof conocido === 'string' && esContenidoIlegibleSsh(conocido) && conocido !== this.ilegibleConservado) {
        throw new Error(mensajeCopiaIlegibleFallidaSsh(codigoDeError(e), 'leer'), { cause: e })
      }
      return
    }
    const actual = bytes === null ? null : bytes.toString('utf-8')
    const aviso = avisoAlSobrescribirSsh(actual, this.textoConocido)
    if (aviso !== null) throw new Error(aviso)
    if (bytes !== null && actual !== null && esContenidoIlegibleSsh(actual) && actual !== this.ilegibleConservado) {
      const sufijo = conservarAparteSsh(this.storePath, bytes)
      this.ilegibleConservado = actual
      this.recuperado = mensajeRegistroRecuperadoSsh(sufijo)
    }
  }

  // --- Consultas -------------------------------------------------------------

  /**
   * Grupos, conexiones (sin secretos ni rutas) y ajenas de todos los perfiles, de una misma lectura; con
   * `profileId`, solo las de ese perfil (lo que lee `tssh` o el aviso de un agente: no mira los secretos ni
   * las huellas de los demás).
   */
  listar(profileId?: string): SshListaConexiones {
    const delPerfil = <T extends { profileId: string }>(x: T): boolean => profileId === undefined || x.profileId === profileId
    const grupos = gruposConocidos(this.reg)
    const listas = {
      grupos: grupos.filter(delPerfil).map((g): SshGrupo => ({ id: g.id, profileId: g.profileId, nombre: g.nombre })),
      conexiones: this.reg.conexiones.flatMap((e) => (e.tipo === 'conocida' && delPerfil(e.registro) ? [this.aDto(e, grupos)] : [])),
      ajenas: ajenasSsh(this.reg).filter(delPerfil)
    }
    if (this.reg.formatoAjeno) return { ...listas, formatoAjeno: true, aviso: this.reg.aviso }
    return this.recuperado === null
      ? { ...listas, formatoAjeno: false }
      : { ...listas, formatoAjeno: false, recuperado: this.recuperado }
  }

  /** Copia de la conexión conocida con ese id, para el main (lleva `secretEnc`: nunca va al renderer). */
  conexion(id: string): ConexionSshPersistida | undefined {
    const c = conexionesConocidas(this.reg).find((x) => x.id === id)
    return c ? structuredClone(c) : undefined
  }

  /** El `known_hosts` propio de una conexión. */
  rutaHuellas(id: string): string {
    if (!ID_SEGURO.test(id)) throw new Error('El id de la conexión no es válido.')
    return join(this.dirHuellas, id)
  }

  /** La copia de la clave importada de una conexión. */
  rutaClave(id: string): string {
    const ruta = rutaCopiaClave(this.dirClaves, id)
    if (ruta === null) throw new Error('El id de la conexión no es válido.')
    return ruta
  }

  private contexto(): ContextoValidacionSsh {
    return { conexiones: conexionesConocidas(this.reg), grupos: gruposConocidos(this.reg), ajenas: ajenasSsh(this.reg) }
  }

  /** El DTO: sin `secretEnc` ni rutas; un grupo que no es uno conocido del perfil sale como «Sin grupo». */
  private aDto(e: Conocida, grupos: readonly GrupoSshPersistido[]): SshConexion {
    const c = e.registro
    const citado = c.grupoId ?? e.resto.grupoId
    const conocido = typeof c.grupoId === 'string' && grupos.some((g) => g.id === c.grupoId && g.profileId === c.profileId)
    const dto: SshConexion = {
      id: c.id,
      profileId: c.profileId,
      alias: c.alias,
      grupoId: conocido ? (c.grupoId as string) : null,
      host: c.host,
      puerto: c.puerto,
      usuario: c.usuario,
      metodo: c.metodo,
      tieneSecreto: typeof c.secretEnc === 'string' && c.secretEnc !== '',
      disponibleAgentes: c.disponibleAgentes === true,
      huellaServidor: this.huellasDe(c)
    }
    if (!conocido && citado !== undefined && citado !== null) dto.grupoDesconocido = true
    if (c.clave) dto.clave = { nombre: c.clave.nombre, tipo: c.clave.tipo, cifrada: c.clave.cifrada }
    if (dto.tieneSecreto && this.esIlegible(c.secretEnc as string)) dto.secretoIlegible = true
    return dto
  }

  private esIlegible(secretEnc: string): boolean {
    return this.cifrado !== null && this.descifrado(secretEnc) === null
  }

  /** El secreto en claro, o `null` si no se puede descifrar aquí (otro equipo u otro usuario). */
  private descifrado(secretEnc: string): string | null {
    try {
      return this.cifrado === null ? null : this.cifrado.descifrar(Buffer.from(secretEnc, 'base64'))
    } catch {
      return null
    }
  }

  /** El secreto cifrado para guardarlo; sin almacén del sistema se niega: nunca se guarda en claro. */
  private cifrar(plano: string, metodo: SshConexionInput['metodo']): string {
    if (this.cifrado === null || !this.cifrado.disponible()) {
      throw new Error(
        `No se puede guardar ${metodo === 'clave' ? 'la frase de la clave' : 'la contraseña'}: ` +
          `${nombresSistema(plataformaActual()).almacenSecretos} no está disponible. Tessera nunca la guarda en claro.`
      )
    }
    return this.cifrado.cifrar(plano).toString('base64')
  }

  /**
   * La contraseña (o la frase de la clave) en claro de una conexión conocida, o `null` si no tiene o no
   * se puede descifrar. Único punto que la expone, y solo hacia dentro del main (el programa de contraseñas).
   */
  secretoDe(id: string): string | null {
    const c = conexionesConocidas(this.reg).find((x) => x.id === id)
    return c && typeof c.secretEnc === 'string' && c.secretEnc !== '' ? this.descifrado(c.secretEnc) : null
  }

  private huellasDe(c: ConexionSshPersistida): SshConexion['huellaServidor'] {
    return huellasDeKnownHosts(this.textoHuellas(c.id) ?? '', c.host, c.puerto)
  }

  /** El `known_hosts` de una conexión tal como está, o `null` si aún no hay (nunca se conectó, o se olvidó). */
  textoHuellas(id: string): string | null {
    try {
      return readFileSync(this.rutaHuellas(id), 'utf-8')
    } catch {
      return null
    }
  }

  /**
   * Olvida las huellas guardadas del servidor: la próxima conexión acepta la que presente. Se vacía con
   * escritura atómica (con reintentos si un ssh lo tiene abierto) en vez de borrarlo a pelo.
   */
  olvidarHuellas(id: string): void {
    if (!conexionesConocidas(this.reg).some((c) => c.id === id)) throw new Error('Esa conexión ya no existe.')
    const ruta = this.rutaHuellas(id)
    try {
      if (existsSync(ruta)) writeFileAtomicSync(ruta, '')
      rmSync(`${ruta}.old`, { force: true })
    } catch (e) {
      throw new Error(`No se pudo olvidar la huella guardada (${codigoDeError(e)}).`, { cause: e })
    }
  }

  private dtoDe(id: string): SshConexion {
    const e = this.reg.conexiones.find((x): x is Conocida => x.tipo === 'conocida' && x.registro.id === id)
    if (!e) throw new Error('Esa conexión ya no existe.')
    return this.aDto(e, gruposConocidos(this.reg))
  }

  // --- Conexiones ------------------------------------------------------------

  /**
   * Alta de una conexión. Lanza con un mensaje para el usuario si no valida. Con el método 'clave',
   * `id` y `clave` son los de la copia que quien llama ya dejó en `ssh/claves/<id>`.
   */
  crear(input: SshConexionInput, instalada: ClaveInstalada & { id?: string } = {}): SshConexion {
    // Antes de validar: con un registro que no se sabe escribir, no entra nada.
    if (this.reg.formatoAjeno) throw new Error(this.reg.aviso)
    validarEntradaSsh(input, this.contexto())
    if (input.metodo === 'clave' && instalada.clave === undefined) throw new Error(MENSAJE_FALTA_CLAVE)
    const id = instalada.id ?? randomUUID()
    // El id nombra los archivos de la conexión: uno ya citado se los quedaría.
    if (!ID_SEGURO.test(id) || idsConArchivos(this.reg).has(id.toLowerCase())) throw new Error('No se pudo dar un id a la conexión: inténtalo otra vez.')
    const registro: ConexionSshPersistida = { id, ...camposAGuardarSsh(input) }
    if (input.metodo === 'clave' && instalada.clave !== undefined) registro.clave = instalada.clave
    if (input.secreto) registro.secretEnc = this.cifrar(input.secreto, input.metodo)
    this.aplicar((reg) => {
      reg.conexiones.push({ tipo: 'conocida', registro, resto: {} })
    })
    return this.dtoDe(registro.id)
  }

  /**
   * Edición de una conexión conocida; lo que el formulario no conoce se conserva (`conservarAlEditarSsh`).
   * Sin `clave` nueva, la importada sigue; si deja de usar un archivo de clave, su copia se borra.
   */
  editar(id: string, input: SshConexionInput, instalada: ClaveInstalada = {}): SshConexion {
    const idx = this.reg.conexiones.findIndex((e) => e.tipo === 'conocida' && e.registro.id === id)
    if (idx < 0) throw new Error('Esa conexión ya no existe.')
    const previa = this.reg.conexiones[idx] as Conocida
    if (input?.profileId !== previa.registro.profileId) throw new Error('Una conexión no puede cambiar de perfil.')
    validarEntradaSsh(input, this.contexto(), id)
    const nuevo: ConexionSshPersistida = { id, ...camposAGuardarSsh(input, previa.registro) }
    if (input.metodo === 'clave' && instalada.clave !== undefined) nuevo.clave = instalada.clave
    if (input.secreto) nuevo.secretEnc = this.cifrar(input.secreto, input.metodo)
    const grupos = gruposConocidos(this.reg)
    const grupoConocido = (g: string): boolean => grupos.some((x) => x.id === g && x.profileId === previa.registro.profileId)
    const entrada = separarConexion(conservarAlEditarSsh(crudoDe(previa), nuevo, grupoConocido, input.secreto))
    // No puede pasar (se acaba de validar), pero tragárselo guardaría algo que la siguiente lectura trataría de ajeno.
    if (!entrada) throw new Error(`La conexión "${nuevo.alias}" no tiene una forma válida.`)
    if (input.metodo === 'clave' && entrada.registro.clave === undefined) throw new Error(MENSAJE_FALTA_CLAVE)
    this.aplicar((reg) => {
      reg.conexiones[idx] = entrada
    })
    if (previa.registro.clave !== undefined && entrada.registro.clave === undefined) this.borrarClave(id)
    return this.dtoDe(id)
  }

  /** Borra la conexión conocida de ese perfil y, si ninguna otra entrada cita su id, sus archivos. */
  borrar(id: string, profileId: string): SshConexionBorrada {
    const idx = this.reg.conexiones.findIndex(
      (e) => e.tipo === 'conocida' && e.registro.id === id && e.registro.profileId === profileId
    )
    if (idx < 0) return { borrada: false }
    this.aplicar((reg) => {
      reg.conexiones.splice(idx, 1)
    })
    this.borrarArchivosSinDueno([id])
    return { borrada: true }
  }

  // --- Grupos ----------------------------------------------------------------

  private indiceGrupo(id: string, profileId: string): number {
    return this.reg.grupos.findIndex((e) => e.tipo === 'conocida' && e.registro.id === id && e.registro.profileId === profileId)
  }

  /** Alta de un grupo en el perfil. */
  crearGrupo(profileId: string, nombre: string): SshGrupo {
    if (this.reg.formatoAjeno) throw new Error(this.reg.aviso)
    const limpio = validarNombreGrupo(nombre, profileId, this.contexto())
    const registro: GrupoSshPersistido = { id: randomUUID(), profileId, nombre: limpio }
    this.aplicar((reg) => {
      reg.grupos.push({ tipo: 'conocida', registro, resto: {} })
    })
    return { ...registro }
  }

  /** Cambia el nombre de un grupo del perfil; lo que el grupo traiga y no se conozca se conserva. */
  renombrarGrupo(id: string, profileId: string, nombre: string): SshGrupo {
    const idx = this.indiceGrupo(id, profileId)
    if (idx < 0) throw new Error('Ese grupo ya no existe.')
    const limpio = validarNombreGrupo(nombre, profileId, this.contexto(), id)
    const actual = (this.reg.grupos[idx] as EntradaConocida<GrupoSshPersistido>).registro
    if (actual.nombre !== limpio) {
      this.aplicar((reg) => {
        ;(reg.grupos[idx] as EntradaConocida<GrupoSshPersistido>).registro.nombre = limpio
      })
    }
    return { id, profileId, nombre: limpio }
  }

  /** Borra un grupo del perfil: sus conexiones conocidas pasan a «Sin grupo»; las ajenas no se tocan. */
  borrarGrupo(id: string, profileId: string): SshGrupoBorrado {
    const idx = this.indiceGrupo(id, profileId)
    if (idx < 0) return { borrado: false, conexionesMovidas: 0 }
    const delGrupo = (c: ConexionSshPersistida): boolean => c.profileId === profileId && c.grupoId === id
    const movidas = conexionesConocidas(this.reg).filter(delGrupo).length
    this.aplicar((reg) => {
      reg.grupos.splice(idx, 1)
      for (const c of conexionesConocidas(reg)) if (delGrupo(c)) delete c.grupoId
    })
    return { borrado: true, conexionesMovidas: movidas }
  }

  // --- Perfiles --------------------------------------------------------------

  /**
   * Al arrancar: quita las ENTRADAS de perfiles que ya no existen y nunca sus archivos (si la lista
   * de perfiles se resembrara, una clave importada no se podría recuperar). Sin perfil legible, se conservan.
   */
  podarPerfiles(idsVivos: ReadonlySet<string>): void {
    const podado = podarPerfilesSsh(this.reg, idsVivos)
    if (podado.grupos.length === this.reg.grupos.length && podado.conexiones.length === this.reg.conexiones.length) return
    this.aplicar((reg) => {
      const p = podarPerfilesSsh(reg, idsVivos)
      reg.grupos = p.grupos
      reg.conexiones = p.conexiones
    })
  }

  /** El usuario borró el perfil: se van sus entradas (conocidas y ajenas) y los archivos de sus conexiones. */
  alBorrarPerfil(profileId: string): void {
    if (this.reg.formatoAjeno) return
    const delPerfil = <T extends { profileId: string }>(e: Entrada<T>): boolean => perfilDeEntrada(e) === profileId
    const ids = this.reg.conexiones.filter(delPerfil).flatMap((e) => idDeEntrada(e) ?? [])
    if (ids.length === 0 && !this.reg.grupos.some(delPerfil)) return
    this.aplicar((reg) => {
      reg.grupos = reg.grupos.filter((e) => !delPerfil(e))
      reg.conexiones = reg.conexiones.filter((e) => !delPerfil(e))
    })
    this.borrarArchivosSinDueno(ids)
  }

  /** Borra el `known_hosts` y la clave de cada id que ya no cita ninguna conexión del registro. */
  private borrarArchivosSinDueno(ids: readonly string[]): void {
    const citados = idsConArchivos(this.reg)
    for (const id of ids) {
      if (!ID_SEGURO.test(id) || citados.has(id.toLowerCase())) continue
      this.borrarArchivos(id, [join(this.dirHuellas, id), join(this.dirHuellas, `${id}.old`), ...this.archivosDeClave(id)])
    }
  }

  /** La conexión dejó de usar un archivo de clave: su copia ya no sirve a nadie. */
  private borrarClave(id: string): void {
    if (ID_SEGURO.test(id)) this.borrarArchivos(id, this.archivosDeClave(id))
  }

  /** La copia de la clave y la que se aparta mientras se sustituye. */
  private archivosDeClave(id: string): string[] {
    const ruta = rutaCopiaClave(this.dirClaves, id)
    return ruta === null ? [] : [ruta, `${ruta}${SUFIJO_CLAVE_ANTERIOR}`]
  }

  private borrarArchivos(id: string, rutas: readonly string[]): void {
    for (const ruta of rutas) {
      try {
        rmSync(ruta, { force: true })
      } catch (e) {
        this.log(`no se pudo borrar un archivo de la conexión ${id}: ${codigoDeError(e)}`)
      }
    }
  }
}
