// =============================================================================
// Motores de archivo (SQLite): elegir, crear o soltar el archivo, «Montar como base de datos» y la
// resolución del origen del archivo al guardar una conexión. La ruta no sale nunca del main: al
// renderer llega una ficha y el nombre. Depende de `archivosBd.ts` y `rutaArchivoBd.ts` (lo puro).
// Decisiones: docs/decisiones/bd/conexiones-archivos-de-base-de-datos.md
// =============================================================================
import { createRequire } from 'node:module'
import path from 'node:path'
import {
  ALIAS_MAX,
  type DbArchivoElegido,
  type DbConexionDeArchivo,
  type DbConnectionInput,
  type DbMontarArchivoRequest,
  type DbMontarArchivoRespuesta,
  type DbMotor,
  type DbOrigenArchivo
} from '../../../shared/db-ipc.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { descriptor, esMotor } from '../../../shared/motores/index.ts'
import type { elegirConDialogo, guardarConDialogo } from '../../util/adaptadores/dialogosNativos.ts'
import {
  adaptadorArchivo,
  aliasLibre,
  FichasArchivo,
  motorDeArchivo,
  rutaDeArchivoDelProyecto,
  type AdaptadorArchivoBd,
  type ComunSqlite,
  type RutaDelProyecto
} from '../archivosBd.ts'
import type { ConnectionStore, EntradaConexion } from '../ConnectionStore.ts'
import { canonizarRutaArchivo, claveRutaArchivo, depsDeSerie, nombreArchivoDeRuta } from '../rutaArchivoBd.ts'

/** Diálogos nativos ya anclados a la ventana por quien compone la app. */
export interface DialogosBd {
  elegir: typeof elegirConDialogo
  guardar: typeof guardarConDialogo
}

/** Lo que los motores de archivo necesitan del resto del subsistema. */
export interface DependenciasArchivos {
  connections: Pick<ConnectionStore, 'conArchivo' | 'setVerificada' | 'get' | 'listaCompleta' | 'create'>
  /** Carpeta `src/tdb` de la app, de donde se carga `sqliteComun.cjs`. */
  tdbScriptDir: () => string
  contenedoraAnclada: () => string | null
  dialogos: DialogosBd
  /** Avisa a las vistas de que el registro cambió. */
  avisarCambio: () => void
  onChanged: (profileId: string) => void
}

/** Atiende los canales `ARCHIVO_*` y resuelve el archivo de una conexión de un motor de archivo. */
export class MotoresDeArchivo {
  private readonly fichas = new FichasArchivo()
  private comunCargado: ComunSqlite | null = null

  private readonly d: DependenciasArchivos

  constructor(deps: DependenciasArchivos) {
    this.d = deps
  }

  /** Diálogo para elegir un archivo existente del motor pedido; `null` si se cancela. */
  async elegir(req: { motor: DbMotor }): Promise<DbArchivoElegido | null> {
    const { motor, adaptador } = this.adaptadorPedido(req?.motor)
    const desc = descriptor(motor)
    const r = await this.d.dialogos.elegir('archivo-bd', {
      title: `Elige la base de datos ${desc.etiqueta}`,
      properties: ['openFile'],
      filters: [
        { name: `Bases ${desc.etiqueta}`, extensions: [...desc.conexion.extensionesArchivo] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ],
      buttonLabel: 'Elegir'
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return this.fichaDeExistente(motor, adaptador, r.filePaths[0])
  }

  /** Diálogo para crear una base vacía del motor pedido; `null` si se cancela. */
  async crear(req: { motor: DbMotor }): Promise<DbArchivoElegido | null> {
    const { motor, adaptador } = this.adaptadorPedido(req?.motor)
    const desc = descriptor(motor)
    const ext = desc.conexion.extensionesArchivo[0] ?? 'db'
    const r = await this.d.dialogos.guardar('archivo-bd', `nueva.${ext}`, {
      title: `Nueva base de datos ${desc.etiqueta}`,
      filters: [{ name: `Bases ${desc.etiqueta}`, extensions: [...desc.conexion.extensionesArchivo] }],
      buttonLabel: 'Crear'
    })
    if (r.canceled || !r.filePath) return null
    // Sin extensión, la del motor: el filtro no reconocería la base al volver a elegirla.
    const ruta = path.extname(r.filePath) === '' ? `${r.filePath}.${ext}` : r.filePath
    adaptador.crear(ruta)
    const canon = canonizarRutaArchivo(ruta, depsDeSerie())
    return this.fichas.emitir(canon.ruta, motor, plataformaActual())
  }

  /** Un archivo soltado sobre el árbol (la ruta la resuelve el preload), tratado como uno elegido. */
  soltado(req: { motor: DbMotor; ruta: string }): DbArchivoElegido {
    const { motor, adaptador } = this.adaptadorPedido(req?.motor)
    if (typeof req?.ruta !== 'string' || req.ruta === '') throw new Error('Ese elemento no es un archivo del equipo.')
    return this.fichaDeExistente(motor, adaptador, req.ruta)
  }

  /**
   * La entrada del renderer con el archivo resuelto: el `DbOrigenArchivo` se cambia por la ruta
   * canónica que guarda el registro. Un motor de red, o una edición sin archivo nuevo, pasan tal cual.
   */
  resolverEntrada(input: DbConnectionInput): EntradaConexion {
    const { archivo, ...resto } = (input ?? {}) as DbConnectionInput
    if (archivo === undefined || !esMotor(resto.motor) || !descriptor(resto.motor).conexion.deArchivo) return resto
    return { ...resto, rutaArchivo: this.rutaDeOrigen(archivo, resto.motor) }
  }

  /**
   * «Montar como base de datos»: el motor sale de la cabecera del archivo y la conexión es la del
   * perfil que ya apunta a él o una nueva de solo lectura, dada por verificada.
   */
  montar(req: DbMontarArchivoRequest): DbMontarArchivoRespuesta {
    const profileId = typeof req?.profileId === 'string' ? req.profileId : ''
    if (!profileId) throw new Error('Una conexión requiere un perfil.')
    const canon = this.archivoDelProyectoAnclado(req?.projectHostPath, req?.relPath)
    const motor = motorDeArchivo(canon.ruta, (m) => this.adaptadorArchivo(m))
    const previa = this.d.connections.conArchivo(profileId, canon.ruta)
    if (previa) {
      if (!previa.verificada) {
        this.d.connections.setVerificada(previa.id, true)
        this.d.avisarCambio()
      }
      return { conexion: this.d.connections.get(previa.id) ?? previa, reutilizada: true }
    }
    const lista = this.d.connections.listaCompleta(profileId)
    const ocupados = [...lista.conexiones.map((c) => c.alias), ...lista.ajenas.map((a) => a.alias)]
    const desc = descriptor(motor)
    const nombre = nombreArchivoDeRuta(canon.ruta)
    const creada = this.d.connections.create({
      profileId,
      alias: aliasLibre(nombre, ocupados, ALIAS_MAX),
      motor,
      host: '',
      port: 0,
      user: '',
      readonly: desc.conexion.soloLecturaPorDefecto,
      rutaArchivo: canon.ruta
    })
    this.d.connections.setVerificada(creada.id, true)
    this.d.onChanged(profileId)
    this.d.avisarCambio()
    return { conexion: this.d.connections.get(creada.id) ?? creada, reutilizada: false }
  }

  /** La conexión del perfil que ya apunta a ese archivo del proyecto, o `null`. */
  conexionDe(req: DbMontarArchivoRequest): DbConexionDeArchivo {
    try {
      const profileId = typeof req?.profileId === 'string' ? req.profileId : ''
      if (!profileId) return null
      const canon = this.archivoDelProyectoAnclado(req?.projectHostPath, req?.relPath)
      const c = this.d.connections.conArchivo(profileId, canon.ruta)
      return c ? { id: c.id } : null
    } catch {
      // Fuera del proyecto, dentro de un comprimido…: no hay conexión que ofrecer desmontar.
      return null
    }
  }

  /** `src/tdb/sqliteComun.cjs`, cargado en ejecución: el main no importa los `.cjs` de `tdb`. */
  private comunSqlite(): ComunSqlite {
    this.comunCargado ??= createRequire(path.join(this.d.tdbScriptDir(), 'tdb.cjs'))('./sqliteComun.cjs') as ComunSqlite
    return this.comunCargado
  }

  private adaptadorArchivo(motor: DbMotor): AdaptadorArchivoBd | null {
    return adaptadorArchivo(motor, () => this.comunSqlite(), plataformaActual())
  }

  /** El adaptador de un motor de archivo pedido por el renderer, o lanza. */
  private adaptadorPedido(motor: unknown): { motor: DbMotor; adaptador: AdaptadorArchivoBd } {
    const a = esMotor(motor) && descriptor(motor).conexion.deArchivo ? this.adaptadorArchivo(motor) : null
    if (!a || !esMotor(motor)) throw new Error('Ese motor no es de archivo.')
    return { motor, adaptador: a }
  }

  /** Ficha de un archivo que ya existe: canoniza, comprueba que es del motor y que se abriría, y emite. */
  private fichaDeExistente(motor: DbMotor, adaptador: AdaptadorArchivoBd, ruta: string): DbArchivoElegido {
    const canon = canonizarRutaArchivo(ruta, depsDeSerie())
    adaptador.comprobar(canon.ruta, false)
    return this.fichas.emitir(canon.ruta, motor, plataformaActual())
  }

  /**
   * El archivo `relPath` del proyecto `projectHostPath`, solo si ese proyecto es la contenedora
   * anclada en el explorador de archivos: un renderer no puede registrar cualquier `.db` del disco.
   */
  private archivoDelProyectoAnclado(projectHostPath: unknown, relPath: unknown): RutaDelProyecto {
    const pedido = String(projectHostPath ?? '')
    const anclada = this.d.contenedoraAnclada()
    // `path` del main es el de este sistema, que es de donde son las dos rutas.
    if (anclada === null || !path.isAbsolute(pedido) || claveRutaArchivo(path.resolve(pedido)) !== claveRutaArchivo(path.resolve(anclada))) {
      throw new Error('Ese archivo no es del proyecto abierto en el explorador: ábrelo desde su proyecto.')
    }
    return rutaDeArchivoDelProyecto(pedido, String(relPath ?? ''), depsDeSerie())
  }

  /** La ruta canónica que dice un `DbOrigenArchivo` para `motor`. Lanza con mensaje para el usuario. */
  private rutaDeOrigen(origen: DbOrigenArchivo, motor: DbMotor): string {
    const tipo = (origen as { tipo?: unknown } | null)?.tipo
    if (tipo === 'elegido') return this.fichas.resolver((origen as { token?: unknown }).token, motor).ruta
    if (tipo === 'proyecto') {
      const o = origen as { projectHostPath?: unknown; relPath?: unknown }
      const canon = this.archivoDelProyectoAnclado(o.projectHostPath, o.relPath)
      const { adaptador } = this.adaptadorPedido(motor)
      adaptador.comprobar(canon.ruta, true)
      return canon.ruta
    }
    throw new Error('No se sabe de dónde sale el archivo de la base.')
  }
}
