// =============================================================================
// ConnectionStore: fuente de verdad de las conexiones a bases de datos, privadas por perfil, en
// `userData/db-connections.json`. La contraseña va cifrada con el `CifradoSecretos` que recibe;
// nunca se guarda en claro. Lo que esta versión no entiende se conserva (`registroConexiones.ts`).
// Cada escritura es todo o nada, y `tdb` lee el mismo archivo sin descifrar nada.
// Decisiones: docs/decisiones/bd/conexiones-registro-crash-safe.md
// =============================================================================
import { randomUUID } from 'node:crypto'
import { normalizarEsquemasVisibles } from '../../shared/dbEsquemas'
import type {
  DbConexionAjena,
  DbConnection,
  DbEsquemasVisibles,
  DbIntrospeccion,
  DbListaConexiones
} from '../../shared/db-ipc'
import { nombresSistema } from '../../shared/nombresSistema'
import { plataformaActual, type Plataforma } from '../../shared/plataforma'
import { writeFileAtomicSync } from '../util/atomicWrite'
import type { CifradoSecretos } from './adaptadores/cifradoSistema'
import { huellaDestinoProbado, type ConexionPersistida } from './conservarAlEditar'
import { codigoDe, conservarAparte, leerBytesSiExiste } from './controlador/copiaIlegible'
import {
  camposAGuardar,
  soloCambiaLaCasilla,
  validarEntrada,
  type ConexionesGuardadas,
  type EntradaConexion
} from './controlador/validacionConexion'
import {
  ajenasDelPerfil,
  avisoAlSobrescribir,
  conocidas,
  editarConocida,
  esContenidoIlegible,
  huecosDeOrden,
  lecturaConRespaldo,
  mensajeCopiaIlegibleFallida,
  mensajeEscrituraRegistroFallida,
  mensajeRegistroRecuperado,
  normalizarIntrospeccion,
  podarPerfiles,
  quitarPorId,
  serializarRegistro,
  siguienteOrden,
  type EntradaConocida,
  type Registro,
  type TipoEntrada
} from './registroConexiones'
import { mismoArchivo, nombreArchivoDeRuta } from './rutaArchivoBd'

export type { EntradaConexion } from './controlador/validacionConexion'

/** Un registro persistido; `secretEnc` nunca sale de esta clase. */
type PersistedConnection = ConexionPersistida

/** Copia de una selección de esquemas, para que el DTO no comparta el objeto del registro. */
function copiarEsquemas(v: DbEsquemasVisibles): DbEsquemasVisibles {
  return v.modo === 'todos' ? { modo: 'todos' } : { modo: 'lista', porDefecto: v.porDefecto, esquemas: [...v.esquemas] }
}

/**
 * La conocida con ese id en `reg` (la copia de `aplicar`, o el registro recién adoptado). Lanza si no
 * está, que no puede pasar: quien la pide acaba de encontrarla en el registro del que `reg` es copia.
 */
function conocidaEn(reg: Registro, id: string): PersistedConnection {
  const c = conocidas(reg).find((x) => x.id === id)
  if (!c) throw new Error(`Conexión desconocida: "${id}".`)
  return c
}

/** Registro de conexiones a bases de datos, con su persistencia crash-safe. */
export class ConnectionStore {
  private readonly storePath: string
  private readonly cifrado: CifradoSecretos
  /**
   * El archivo entero (conocidas y ajenas en su orden, la raíz y la versión), tal como está en
   * disco. No se muta en el sitio: una escritura lo sustituye por la copia que acaba de escribir.
   */
  private reg: Registro
  /**
   * El texto del principal la última vez que este store lo leyó o lo escribió: `null` si no
   * existía, `undefined` si no se pudo leer. Detecta una edición a mano con Tessera abierta.
   */
  private textoConocido: string | null | undefined
  /** El aviso de que el principal no era JSON y se usan las conexiones del `.bak`, o `null`. */
  private recuperado: string | null = null
  /** El texto del principal roto que ya se guardó aparte en esta sesión: impide una segunda copia. */
  private ilegibleConservado: string | null = null

  constructor(opts: { storePath: string; cifrado: CifradoSecretos }) {
    this.storePath = opts.storePath
    this.cifrado = opts.cifrado
    this.reg = this.read()
  }

  /** Ruta del registro, para pasarla a `tdb` por entorno. */
  get registryPath(): string {
    return this.storePath
  }

  /**
   * ¿El registro está bloqueado (formato que esta versión no reconoce, o archivo ilegible sin `.bak`)?
   * Entonces `list` y `ajenas` salen vacías aunque el archivo tenga conexiones, y quien tome esa lista
   * por «las que existen» podría desmontar bases: por eso viaja al renderer con las listas.
   */
  get formatoAjeno(): boolean {
    return this.reg.formatoAjeno
  }

  /** Las conexiones que esta versión entiende, del registro en uso: para consultar, no para mutar. */
  private get connections(): PersistedConnection[] {
    return conocidas(this.reg)
  }

  /** Las conocidas como las ve la validación. */
  private get guardadas(): ConexionesGuardadas {
    return { conocidas: this.connections, ajenasDelPerfil: (profileId) => this.ajenas(profileId) }
  }

  // --- Persistencia ----------------------------------------------------------

  private read(): Registro {
    // El primario manda si es legible (aunque esté vacío); solo si falta o está corrupto se recurre al
    // respaldo, y un primario con contenido nunca se toma por vacío (`lecturaConRespaldo`). Solo «no
    // existe» es `null`: cualquier otro fallo al leer se deja lanzar.
    this.textoConocido = undefined
    const { reg, rescateDeRoto } = lecturaConRespaldo((ruta) => {
      const texto = this.leerPrincipalOBak(ruta)
      if (ruta === this.storePath) this.textoConocido = texto
      return texto
    }, this.storePath)
    this.recuperado = rescateDeRoto ? mensajeRegistroRecuperado(null) : null
    return reg
  }

  /** El texto de una ruta del registro; `null` si no existe; y si existe y no se deja leer, lanza. */
  private leerPrincipalOBak(ruta: string): string | null {
    // Mismo decodificador que `readFileSync(ruta, 'utf-8')`, para que `textoConocido` compare igual.
    return leerBytesSiExiste(ruta)?.toString('utf-8') ?? null
  }

  /**
   * La única puerta de las escrituras: aplica `cambio` a una copia del registro, la escribe y solo si
   * sale bien la copia pasa a ser el registro. Si algo lanza, el registro y `textoConocido` quedan como
   * estaban y el error sigue hacia el llamador. `cambio` no toca los objetos del registro en uso.
   */
  private aplicar(cambio: (reg: Registro) => void): void {
    const nuevo = structuredClone(this.reg)
    cambio(nuevo)
    this.persistir(nuevo)
    this.reg = nuevo
  }

  /** Escribe `reg` en disco; lanza sin escribir nada si no se puede (ver `aplicar`). */
  private persistir(reg: Registro): void {
    const texto = serializarRegistro(reg)
    // Si el principal cambió por debajo y no se puede sustituir, o es el roto rescatado y su copia aparte falla.
    this.exigirPrincipalSustituible()
    try {
      writeFileAtomicSync(this.storePath, texto)
    } catch (e) {
      // El error de `fs` lleva la ruta del registro y llegaría al renderer: se lanza uno propio con el código.
      throw new Error(mensajeEscrituraRegistroFallida(codigoDe(e)), { cause: e })
    }
    this.textoConocido = texto
  }

  /**
   * Lanza, con su aviso, si el principal cambió desde que este store lo leyó o lo escribió y lo que
   * tiene ahora no se puede sustituir sin perderlo (`avisoAlSobrescribir`). Si es el principal roto
   * que se leyó al arrancar, lo guarda aparte antes de dejar que se sustituya, una vez por sesión; si
   * no puede guardarlo, lanza. Un principal que no se deja leer en este instante se deja a la
   * escritura (un bloqueo pasajero), salvo que haya un roto pendiente de copiar.
   */
  private exigirPrincipalSustituible(): void {
    let bytes: Buffer | null
    try {
      bytes = leerBytesSiExiste(this.storePath)
    } catch (e) {
      const conocido = this.textoConocido
      if (typeof conocido === 'string' && esContenidoIlegible(conocido) && conocido !== this.ilegibleConservado) {
        // `leer`: lo que falló es abrir el principal, no escribir la copia.
        throw new Error(mensajeCopiaIlegibleFallida(codigoDe(e), 'leer'), { cause: e })
      }
      return
    }
    const actual = bytes === null ? null : bytes.toString('utf-8')
    const aviso = avisoAlSobrescribir(actual, this.textoConocido)
    if (aviso !== null) throw new Error(aviso)
    // Aquí, un principal que no es JSON solo puede ser el mismo que se leyó al arrancar: el roto rescatado.
    if (bytes !== null && actual !== null && esContenidoIlegible(actual) && actual !== this.ilegibleConservado) {
      const sufijo = conservarAparte(this.storePath, bytes)
      this.ilegibleConservado = actual
      this.recuperado = mensajeRegistroRecuperado(sufijo)
    }
  }

  // --- Cifrado ---------------------------------------------------------------

  /**
   * Cifra con el almacén del sistema. Sin él prefiere fallar antes que guardar la contraseña en claro:
   * un registro en claro sería una regresión de seguridad silenciosa.
   */
  private encrypt(plain: string): string {
    if (!this.cifrado.disponible()) {
      // La frase no empieza por el nombre del almacén: sus valores llevan artículo en minúscula.
      throw new Error(
        'No se puede guardar la contraseña: ' +
          `${nombresSistema(plataformaActual()).almacenSecretos} no está disponible. ` +
          'Tessera nunca la guarda en claro.'
      )
    }
    return this.cifrado.cifrar(plain).toString('base64')
  }

  /** Descifra; devuelve null si el blob no es descifrable (otra máquina o usuario). */
  private decrypt(enc: string | undefined): string | null {
    if (!enc) return null
    try {
      return this.cifrado.descifrar(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  // --- Consultas -------------------------------------------------------------

  /**
   * DTO público (sin secreto) de una conexión persistida. `secretoIlegible` distingue «no guardaste
   * contraseña» de «hay una que este equipo no puede descifrar». `esquemas`, `bases` e `introspeccion`
   * salen copiados; la ruta del archivo no cruza: solo su nombre.
   */
  private toDto(c: PersistedConnection): DbConnection {
    const { secretEnc, verificadaEn, esquemas, bases, introspeccion, archivo, ...rest } = c
    const verificada = verificadaEn !== undefined
    const explorador: Pick<DbConnection, 'esquemas' | 'bases' | 'introspeccion' | 'archivoVisible'> = {}
    if (esquemas !== undefined) explorador.esquemas = copiarEsquemas(esquemas)
    if (bases !== undefined) explorador.bases = copiarEsquemas(bases)
    if (introspeccion !== undefined) explorador.introspeccion = { ...introspeccion }
    if (typeof archivo === 'string') explorador.archivoVisible = nombreArchivoDeRuta(archivo)
    if (!secretEnc) return { ...rest, ...explorador, tieneSecreto: false, verificada }
    return {
      ...rest,
      ...explorador,
      tieneSecreto: true,
      secretoIlegible: this.decrypt(secretEnc) === null,
      verificada
    }
  }

  /**
   * Conexiones de un perfil en el orden que fijó el usuario; las que no tienen posición van al final
   * por alias. Sin secretos. Solo las que esta versión entiende: las demás, en `ajenas`.
   */
  list(profileId: string): DbConnection[] {
    return this.connections
      .filter((c) => c.profileId === profileId)
      .slice()
      .sort((a, b) => {
        const oa = a.orden ?? Number.MAX_SAFE_INTEGER
        const ob = b.orden ?? Number.MAX_SAFE_INTEGER
        return oa !== ob ? oa - ob : a.alias.localeCompare(b.alias)
      })
      .map((c) => this.toDto(c))
  }

  /** Conexiones del perfil que esta versión no entiende: solo id, perfil, alias y motor. */
  ajenas(profileId: string): DbConexionAjena[] {
    return ajenasDelPerfil(this.reg, profileId)
  }

  /**
   * Lo que responde `LIST_COMPLETA`: conocidas y ajenas de la misma instantánea, la marca de registro
   * bloqueado con su aviso y, si el principal era JSON roto y se usa el `.bak`, `recuperado`.
   */
  listaCompleta(profileId: string): DbListaConexiones {
    const listas = { conexiones: this.list(profileId), ajenas: this.ajenas(profileId) }
    if (this.reg.formatoAjeno) return { ...listas, formatoAjeno: true, aviso: this.reg.aviso }
    return this.recuperado === null
      ? { ...listas, formatoAjeno: false }
      : { ...listas, formatoAjeno: false, recuperado: this.recuperado }
  }

  /**
   * Fija el orden de un perfil a partir de los ids que manda la UI. Solo se aceptan ids de ese perfil,
   * y lo que la lista no mencione conserva su sitio detrás. Las ajenas no se tocan: las conocidas toman
   * los `orden` que ellas dejan libres (`huecosDeOrden`).
   */
  reorder(profileId: string, ids: string[]): void {
    const delPerfil = this.connections.filter((c) => c.profileId === profileId)
    const validos = ids.filter((id) => delPerfil.some((c) => c.id === id))
    if (validos.length === 0) return
    const restantes = delPerfil.filter((c) => !validos.includes(c.id)).map((c) => c.id)
    const finales = [...validos, ...restantes]
    const huecos = huecosDeOrden(this.reg, profileId, finales.length)
    // Qué cambia se decide sobre el registro en uso; se aplica sobre la copia.
    const cambios = finales
      .map((id, i) => ({ id, orden: huecos[i] }))
      .filter(({ id, orden }) => delPerfil.find((x) => x.id === id)?.orden !== orden)
    if (cambios.length === 0) return
    this.aplicar((reg) => {
      for (const { id, orden } of cambios) conocidaEn(reg, id).orden = orden
    })
  }

  /** La conexión conocida con ese id, sin secreto. */
  get(id: string): DbConnection | undefined {
    const found = this.connections.find((c) => c.id === id)
    return found ? this.toDto(found) : undefined
  }

  /** Huella de lo que «Probar» prueba de esa conexión (`huellaDestinoProbado`), o `null` si no existe. */
  huellaPrueba(id: string): string | null {
    const found = this.connections.find((c) => c.id === id)
    return found ? huellaDestinoProbado(found) : null
  }

  /** La ruta guardada del archivo de una conexión de motor de archivo, o `null`. Solo para el main. */
  rutaArchivoDe(id: string): string | null {
    const found = this.connections.find((c) => c.id === id)
    return found && typeof found.archivo === 'string' ? found.archivo : null
  }

  /**
   * La conexión de `profileId` que ya apunta al archivo real `ruta` (canónica), o `undefined`: es lo
   * que reutiliza «Montar como base de datos». Con varias, la primera en el orden del perfil.
   */
  conArchivo(profileId: string, ruta: string, plataforma: Plataforma = plataformaActual()): DbConnection | undefined {
    const found = this.connections
      .filter((c) => c.profileId === profileId && typeof c.archivo === 'string' && mismoArchivo(c.archivo, ruta, plataforma))
      .sort((a, b) => (a.orden ?? Number.MAX_SAFE_INTEGER) - (b.orden ?? Number.MAX_SAFE_INTEGER))[0]
    return found ? this.toDto(found) : undefined
  }

  /**
   * Contraseña en claro de una conexión. Único punto que la expone, y solo hacia dentro del main.
   * Nunca de una ajena, aunque traiga `secretEnc`.
   */
  secretOf(id: string): string | null {
    const found = this.connections.find((c) => c.id === id)
    return found ? this.decrypt(found.secretEnc) : null
  }

  /** Todas las conexiones conocidas de un perfil con su secreto, por `id` (de él cuelga el nombre de la variable). */
  secretsForProfile(profileId: string): Array<{ id: string; secret: string }> {
    const out: Array<{ id: string; secret: string }> = []
    for (const c of this.connections) {
      if (c.profileId !== profileId) continue
      const secret = this.decrypt(c.secretEnc)
      if (secret !== null) out.push({ id: c.id, secret })
    }
    return out
  }

  // --- Mutaciones ------------------------------------------------------------

  /** Alta de una conexión, al final de su perfil. Lanza con un mensaje para el usuario si no valida. */
  create(input: EntradaConexion): DbConnection {
    // Antes de validar y de tocar la memoria: con un registro que no se sabe escribir, no entra nada.
    if (this.reg.formatoAjeno) throw new Error(this.reg.aviso)
    validarEntrada(input, this.guardadas)
    const record: PersistedConnection = {
      id: randomUUID(),
      ...camposAGuardar(input, this.connections),
      orden: siguienteOrden(this.reg, input.profileId)
    }
    if (input.password) record.secretEnc = this.encrypt(input.password)
    this.aplicar((reg) => {
      reg.entradas.push({ tipo: 'conocida', registro: record, resto: {} })
    })
    return this.toDto(record)
  }

  /** Edición de una conexión conocida; `conservarAlEditar` rescata lo que el formulario no conoce. */
  update(id: string, input: EntradaConexion): DbConnection {
    // Solo una conocida: el id de una ajena da «desconocida» y la ajena no se toca.
    const idx = this.reg.entradas.findIndex((e) => e.tipo === 'conocida' && e.registro.id === id)
    if (idx < 0) throw new Error(`Conexión desconocida: "${id}".`)
    validarEntrada(input, this.guardadas, id)
    const previa = this.reg.entradas[idx] as EntradaConocida
    const nuevo: PersistedConnection = { id, ...camposAGuardar(input, this.connections, id) }
    // password: undefined = conserva la guardada; '' = la borra; texto = la sustituye (solo el texto se cifra aquí).
    if (input.password !== undefined && input.password !== '') {
      nuevo.secretEnc = this.encrypt(input.password)
    }
    const entrada = editarConocida(previa, nuevo, input.password)
    // En el mismo sitio de la copia: `aplicar` la clona tal cual, así que `idx` vale ahí.
    this.aplicar((reg) => {
      reg.entradas[idx] = entrada
    })
    return this.toDto(entrada.registro)
  }

  /**
   * ¿Guardar `input` sobre la conexión `id` solo marca o desmarca la casilla de los agentes? Se compara
   * lo que se guardaría con lo guardado, no la entrada cruda. Una contraseña o un archivo nuevos, una
   * entrada que no valida o una ajena: otra edición.
   */
  soloCambiaLaCasillaDeAgentes(id: string, input: EntradaConexion): boolean {
    if (input.password !== undefined || input.rutaArchivo !== undefined) return false
    const e = this.reg.entradas.find((x) => x.tipo === 'conocida' && x.registro.id === id)
    if (!e || e.tipo !== 'conocida') return false
    try {
      validarEntrada(input, this.guardadas, id)
    } catch {
      return false
    }
    return soloCambiaLaCasilla({ ...camposAGuardar(input, this.connections, id) }, { ...e.registro })
  }

  /**
   * Borra la conexión con ese id que se pidió, conocida o ajena; `tipo` dice cuál cuando las dos
   * comparten id. Devuelve el perfil de lo borrado, o `null` si no había nada.
   */
  remove(id: string, tipo?: TipoEntrada): string | null {
    return this.borrar(id, tipo).perfil
  }

  /**
   * `remove` con lo que el llamador necesita para decidir qué limpiar (`limpiezaTrasBorrar`): el perfil y
   * el tipo de lo borrado, y dónde queda la conocida de ese id. `perfil` limita lo borrable a ese perfil.
   */
  borrar(
    id: string,
    tipo?: TipoEntrada,
    alias?: string,
    perfil?: string
  ): {
    borrada: boolean
    perfil: string | null
    tipo: TipoEntrada | null
    quedaConocida: boolean
    conocidaEnOtroPerfil: boolean
  } {
    const r = quitarPorId(this.reg.entradas, id, tipo, alias, perfil)
    if (r.quitadas > 0) {
      // Se vuelve a quitar sobre la copia: `quitarPorId` elige por identidad y las de `r` son del registro en uso.
      this.aplicar((reg) => {
        reg.entradas = quitarPorId(reg.entradas, id, tipo, alias, perfil).entradas
      })
    }
    const borrada = r.quitadas > 0
    const referencia = borrada ? r.perfil : (perfil ?? null)
    // La conocida a la que resuelve el id después (del registro nuevo, si se escribió).
    const duena = this.connections.find((c) => c.id === id)
    const enOtro = duena !== undefined && referencia !== null && duena.profileId !== referencia
    return {
      borrada,
      perfil: borrada ? r.perfil : null,
      tipo: r.tipo,
      quedaConocida: duena !== undefined && !enOtro,
      conocidaEnOtroPerfil: enOtro
    }
  }

  /** Marca el resultado de la última prueba: solo las verificadas se pueden montar en un proyecto. */
  setVerificada(id: string, ok: boolean, ahora: number = Date.now()): void {
    const found = this.connections.find((c) => c.id === id)
    if (!found) return
    const nuevo = ok ? ahora : undefined
    if (found.verificadaEn === nuevo) return
    this.aplicar((reg) => {
      const c = conocidaEn(reg, id)
      if (nuevo === undefined) delete c.verificadaEn
      else c.verificadaEn = nuevo
    })
  }

  /**
   * Marca la conexión como verificada porque el explorador abrió una sesión contra ella y recuerda el
   * driver. Solo escribe si algo cambia (se llama en cada apertura) y nunca desverifica: eso es de
   * «Probar». Devuelve si cambió algo, para que el llamador avise con `db:changed`.
   */
  marcarVerificada(id: string, driverId: string | null, ahora: number = Date.now()): boolean {
    const found = this.connections.find((c) => c.id === id)
    if (!found) return false
    const yaVerificada = found.verificadaEn !== undefined
    const mismoDriver = (found.driverId ?? null) === driverId
    // Lo normal —cada apertura de sesión— acaba aquí, sin copiar ni escribir nada.
    if (yaVerificada && mismoDriver) return false
    this.aplicar((reg) => {
      const c = conocidaEn(reg, id)
      if (!yaVerificada) c.verificadaEn = ahora
      if (!mismoDriver) c.driverId = driverId
    })
    return true
  }

  /** Recuerda qué driver resolvió esta conexión, para no volver a sondear. */
  setDriver(id: string, driverId: string | null): void {
    const found = this.connections.find((c) => c.id === id)
    if (!found || found.driverId === driverId) return
    this.aplicar((reg) => {
      conocidaEn(reg, id).driverId = driverId
    })
  }

  /**
   * Fija los esquemas que el explorador enseña de esta conexión, normalizados con la misma función que
   * al leer del disco. Una forma inválida se rechaza en vez de guardarse como «sin configurar».
   */
  setEsquemasVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    const found = this.connections.find((c) => c.id === id)
    if (!found) throw new Error(`Conexión desconocida: "${id}".`)
    const normal = normalizarEsquemasVisibles(v)
    if (normal === undefined) throw new Error('La selección de esquemas no es válida.')
    if (JSON.stringify(found.esquemas) === JSON.stringify(normal)) return this.toDto(found)
    this.aplicar((reg) => {
      conocidaEn(reg, id).esquemas = normal
    })
    // Del registro nuevo: `found` es del que se acaba de sustituir.
    return this.toDto(conocidaEn(this.reg, id))
  }

  /** Como `setEsquemasVisibles`, para las bases que enseña el nivel «Bases» del árbol. */
  setBasesVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    const found = this.connections.find((c) => c.id === id)
    if (!found) throw new Error(`Conexión desconocida: "${id}".`)
    const normal = normalizarEsquemasVisibles(v)
    if (normal === undefined) throw new Error('La selección de bases no es válida.')
    if (JSON.stringify(found.bases) === JSON.stringify(normal)) return this.toDto(found)
    this.aplicar((reg) => {
      conocidaEn(reg, id).bases = normal
    })
    return this.toDto(conocidaEn(this.reg, id))
  }

  /**
   * Guarda la foto de la última introspección para pintar «N de M» sin conectar. Solo persiste si cambia
   * el total o el esquema por defecto; una foto inválida se ignora (es una caché, no un dato del usuario).
   */
  setIntrospeccion(id: string, v: DbIntrospeccion): void {
    const found = this.connections.find((c) => c.id === id)
    if (!found) return
    const normal = normalizarIntrospeccion(v)
    if (normal === undefined) return
    const previa = found.introspeccion
    if (
      previa !== undefined &&
      previa.totalEsquemas === normal.totalEsquemas &&
      previa.esquemaPorDefecto === normal.esquemaPorDefecto
    ) {
      return
    }
    this.aplicar((reg) => {
      conocidaEn(reg, id).introspeccion = normal
    })
  }

  /** Elimina las conexiones de perfiles que ya no existen, ajenas incluidas; las sin perfil legible se conservan. */
  pruneProfiles(idsVivos: Set<string>): void {
    if (podarPerfiles(this.reg.entradas, idsVivos).length === this.reg.entradas.length) return
    this.aplicar((reg) => {
      reg.entradas = podarPerfiles(reg.entradas, idsVivos)
    })
  }
}
