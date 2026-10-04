// =============================================================================
// Altas, ediciones, borrados y reordenación del registro de conexiones, con sus ganchos hacia el
// explorador. Cada escritura pasa por `sinRutasDelHost`: al renderer solo llega el mensaje del error.
// Depende de `registroConexiones.ts` (la decisión de qué limpiar tras borrar) y del registro.
// Decisiones: docs/decisiones/bd/conexiones-edicion-y-ganchos.md
// =============================================================================
import type {
  DbBorrarConexion,
  DbConexionBorrada,
  DbConnection,
  DbConnectionInput
} from '../../../shared/db-ipc.ts'
import type { ConnectionStore, EntradaConexion } from '../ConnectionStore.ts'
import { dbLog } from '../dbLog.ts'
import { limpiezaTrasBorrar, mensajeDeFalloDelRegistro, tipoEntradaPedida } from '../registroConexiones.ts'

/** Ganchos hacia el explorador; todos opcionales para que el controlador funcione sin él. */
export interface GanchosConexion {
  /** Se consulta antes de editar; con `ok: false` la edición se rechaza con ese mensaje. */
  puedeEditarConexion: (id: string, soloCasillaAgentes?: boolean) => { ok: true } | { ok: false; mensaje: string }
  /** Tras una edición correcta, con el registro de antes y el de después. */
  onConexionEditada: (previo: DbConnection, nuevo: DbConnection, soloCasillaAgentes?: boolean) => void
  /** Tras un borrado correcto. */
  onConexionBorrada: (id: string, profileId: string) => void
  /** Tras borrar la copia de un perfil cuya conocida vive en otro: solo se limpia lo de ese perfil. */
  onConexionOlvidadaEnPerfil: (id: string, profileId: string) => void
}

/** Lo que la edición del registro necesita del resto del subsistema. */
export interface DependenciasEdicion {
  connections: ConnectionStore
  ganchos: GanchosConexion
  /** La entrada del renderer con el archivo ya resuelto (motores de archivo). */
  resolverEntrada: (input: DbConnectionInput) => EntradaConexion
  /** Tras cada alta, baja o edición: regenera el contexto de los agentes. */
  onChanged: (profileId: string) => void
  /** Avisa a las vistas de que el registro cambió. */
  avisarCambio: () => void
}

/**
 * Ejecuta un handler que escribe el registro sin dejar pasar rutas del host: un error de `fs` en
 * crudo lleva la ruta del registro. El original, con su ruta, va al log del main.
 */
export function sinRutasDelHost<T>(canal: string, handler: () => T): T {
  try {
    return handler()
  } catch (e) {
    const mensaje = mensajeDeFalloDelRegistro(e)
    const original = e instanceof Error && e.cause !== undefined ? e.cause : e
    const seguro = e instanceof Error && mensaje === e.message
    if (!seguro || original !== e) dbLog('ctrl', `${canal} falló: ${String(original)}`)
    if (seguro) throw e
    // Con `cause` para quien lo lea en el main: Electron manda al renderer solo el `toString()`.
    throw new Error(mensaje, { cause: e })
  }
}

/** Ejecuta un gancho tras una operación ya hecha: su fallo se registra y no la deshace. */
function avisarGancho(nombre: string, gancho: () => void): void {
  try {
    gancho()
  } catch (err) {
    dbLog('ctrl', `ERROR en el gancho ${nombre}: ${String(err)}`)
  }
}

/** Las cuatro escrituras del registro que atiende el canal de conexiones. */
export class EdicionRegistro {
  private readonly d: DependenciasEdicion

  constructor(deps: DependenciasEdicion) {
    this.d = deps
  }

  /** Alta de una conexión. */
  crear(canal: string, input: DbConnectionInput): DbConnection {
    return sinRutasDelHost(canal, () => {
      // Un motor de archivo trae el origen del archivo, no la ruta: se resuelve aquí.
      const creada = this.d.connections.create(this.d.resolverEntrada(input))
      this.d.onChanged(creada.profileId)
      this.d.avisarCambio()
      return creada
    })
  }

  /** Edición: se bloquea ANTES de tocar el registro si el explorador tiene una transacción pendiente. */
  actualizar(canal: string, req: { id: string; input: DbConnectionInput }): DbConnection {
    return sinRutasDelHost(canal, () => {
      // Si solo cambia la casilla de los agentes no se retira nada y no hay por qué bloquear; con un
      // archivo nuevo no se pregunta (resolverlo gastaría su ficha antes del permiso).
      const soloCasilla =
        req.input?.archivo === undefined &&
        this.d.connections.soloCambiaLaCasillaDeAgentes(req.id, this.d.resolverEntrada(req.input))
      const permiso = this.d.ganchos.puedeEditarConexion(req.id, soloCasilla)
      if (!permiso.ok) throw new Error(permiso.mensaje)
      // El previo se lee antes de editar: el gancho compara el antes y el después.
      const previo = this.d.connections.get(req.id)
      const actualizada = this.d.connections.update(req.id, this.d.resolverEntrada(req.input))
      if (previo) {
        avisarGancho('onConexionEditada', () => this.d.ganchos.onConexionEditada(previo, actualizada, soloCasilla))
      }
      this.d.onChanged(actualizada.profileId)
      this.d.avisarCambio()
      return actualizada
    })
  }

  /** Borra la entrada pedida (la conocida o la ajena, que solo comparten id por una edición a mano). */
  borrar(canal: string, req: DbBorrarConexion): DbConexionBorrada {
    return sinRutasDelHost(canal, () => {
      const id = typeof req?.id === 'string' ? req.id : ''
      // A qué resolvía el id antes de borrar: si queda otra con el mismo id, es un cambio de conexión.
      const previo = this.d.connections.get(id)
      const alias = typeof req?.alias === 'string' ? req.alias : undefined
      // Solo se borra entre las entradas de ese perfil; sin él, todo el registro (un renderer anterior).
      const perfilPedido = typeof req?.profileId === 'string' && req.profileId !== '' ? req.profileId : undefined
      const r = this.d.connections.borrar(id, tipoEntradaPedida(req?.ajena), alias, perfilPedido)
      if (r.perfil) this.avisarTrasBorrar(r, id, r.perfil, previo)
      this.d.avisarCambio()
      return { borrada: r.borrada, quedaConocida: r.quedaConocida, conocidaEnOtroPerfil: r.conocidaEnOtroPerfil }
    })
  }

  /** Reordena las conexiones de un perfil; es solo presentación y no toca contexto ni montajes. */
  reordenar(canal: string, req: { profileId: string; ids: string[] }): void {
    sinRutasDelHost(canal, () => {
      this.d.connections.reorder(req.profileId, req.ids ?? [])
      this.d.avisarCambio()
    })
  }

  /** Ganchos y contexto tras un borrado: lo que cuelga del id es de la conocida a la que resuelve. */
  private avisarTrasBorrar(
    r: ReturnType<ConnectionStore['borrar']>,
    id: string,
    perfil: string,
    previo: DbConnection | undefined
  ): void {
    const limpieza = limpiezaTrasBorrar(r)
    if (limpieza === 'borrada') {
      avisarGancho('onConexionBorrada', () => this.d.ganchos.onConexionBorrada(id, perfil))
    }
    if (limpieza === 'delPerfil') {
      avisarGancho('onConexionOlvidadaEnPerfil', () => this.d.ganchos.onConexionOlvidadaEnPerfil(id, perfil))
    }
    const nuevo = limpieza === 'cambiada' ? this.d.connections.get(id) : undefined
    if (previo && nuevo) avisarGancho('onConexionEditada', () => this.d.ganchos.onConexionEditada(previo, nuevo))
    // El contexto del agente y las vistas cambian igual (la entrada ya no está).
    this.d.onChanged(perfil)
  }
}
