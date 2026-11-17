// =============================================================================
// Servicio del historial de conversaciones: lista, borra y renombra las de un agente en la
// carpeta de credenciales de su cuenta. Sin electron; lo registra `ipc.ts`.
// Depende de `LectorConversaciones`, de los nombres propios y de la resolución de `<base>`.
// Decisiones: docs/decisiones/agentes/conversaciones-nombres-propios.md
// =============================================================================
import type { LectorConversaciones } from './LectorConversaciones'
import type { TitulosConversacion } from './titulosConversacion'
import type { BaseDeCuenta } from './baseAgente'
import { esDelProyecto } from './slugProyecto'
import type {
  ResumenConversacion,
  PeticionBorrarConversacion,
  PeticionListarConversaciones,
  PeticionRenombrarConversacion
} from '../../shared/conversations-ipc'

/** Historial de conversaciones por (agente, cuenta, proyecto) con sus nombres propios. */
export class ServicioConversaciones {
  private readonly lector: LectorConversaciones
  private readonly titulos: TitulosConversacion
  private readonly baseDe: BaseDeCuenta

  constructor(deps: {
    lector: LectorConversaciones
    titulos: TitulosConversacion
    baseDe: BaseDeCuenta
  }) {
    this.lector = deps.lector
    this.titulos = deps.titulos
    this.baseDe = deps.baseDe
  }

  /** Conversaciones del proyecto activo; sin cuenta válida, lista vacía. */
  async listar(req: PeticionListarConversaciones): Promise<ResumenConversacion[]> {
    const base = this.baseDe(req.agente, req.accountId, req.modo === 'host')
    if (base === null) return []
    // Se filtra por la ruta completa, no por el basename: dos proyectos con el mismo nombre
    // en el mismo perfil mezclarían su historial.
    const want = req.projectHostPath
    // `want` criba las carpetas de Claude por su nombre y, con `soloUltima`, decide cuál es la
    // última de este proyecto; el filtro de abajo sigue siendo quien decide sin `soloUltima`.
    const todas = await this.lector.listarConversaciones([{ dir: base, agente: req.agente }], {
      rutaProyecto: want || undefined,
      soloUltima: req.soloUltima === true
    })
    const filtradas = want ? todas.filter((c) => esDelProyecto(c.rutaProyecto, want)) : todas
    // El nombre propio se aplica aquí y no en el lector: así su caché sigue siendo el resumen
    // puro del transcript y renombrar no la invalida.
    return filtradas.map((c) => {
      const tituloPropio = this.titulos.obtenerTituloPropio(c.agente, c.id)
      return tituloPropio ? { ...c, tituloPropio } : c
    })
  }

  /** Borra el transcript y el nombre propio; devuelve `false` si la cuenta no es válida. */
  async borrar(req: PeticionBorrarConversacion): Promise<boolean> {
    const base = this.baseDe(req.agente, req.accountId, req.modo === 'host')
    if (base === null) return false
    const seBorro = await this.lector.borrarConversacion(base, req.agente, req.id)
    if (seBorro) await this.titulos.olvidarTituloPropio(req.agente, req.id)
    return seBorro
  }

  /** Pone o quita el nombre propio de una conversación. */
  async renombrar(req: PeticionRenombrarConversacion): Promise<void> {
    await this.titulos.fijarTituloPropio(req.agente, req.id, req.titulo)
  }
}
