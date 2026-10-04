// =============================================================================
// Servicio del historial de conversaciones: lista, borra y renombra las de un agente en la
// carpeta de credenciales de su cuenta. Sin electron; lo registra `ipc.ts`.
// Depende de `ConversationsReader`, de los nombres propios y de la resolución de `<base>`.
// Decisiones: docs/decisiones/agentes/conversaciones-nombres-propios.md
// =============================================================================
import type { ConversationsReader } from './ConversationsReader'
import type { TitulosConversacion } from './conversationTitles'
import type { BaseDeCuenta } from './baseAgente'
import { esDelProyecto } from './slugProyecto'
import type {
  ConversationSummary,
  DeleteConversationRequest,
  ListConversationsRequest,
  RenameConversationRequest
} from '../../shared/conversations-ipc'

/** Historial de conversaciones por (agente, cuenta, proyecto) con sus nombres propios. */
export class ServicioConversaciones {
  private readonly lector: ConversationsReader
  private readonly titulos: TitulosConversacion
  private readonly baseDe: BaseDeCuenta

  constructor(deps: {
    lector: ConversationsReader
    titulos: TitulosConversacion
    baseDe: BaseDeCuenta
  }) {
    this.lector = deps.lector
    this.titulos = deps.titulos
    this.baseDe = deps.baseDe
  }

  /** Conversaciones del proyecto activo; sin cuenta válida, lista vacía. */
  async listar(req: ListConversationsRequest): Promise<ConversationSummary[]> {
    const base = this.baseDe(req.agente, req.accountId, req.mode === 'host')
    if (base === null) return []
    // Se filtra por la ruta completa, no por el basename: dos proyectos con el mismo nombre
    // en el mismo perfil mezclarían su historial.
    const want = req.projectHostPath
    // `want` criba las carpetas de Claude por su nombre y, con `soloUltima`, decide cuál es la
    // última de este proyecto; el filtro de abajo sigue siendo quien decide sin `soloUltima`.
    const all = await this.lector.listConversations([{ dir: base, agente: req.agente }], {
      rutaProyecto: want || undefined,
      soloUltima: req.soloUltima === true
    })
    const filtered = want ? all.filter((c) => esDelProyecto(c.projectPath, want)) : all
    // El nombre propio se aplica aquí y no en el lector: así su caché sigue siendo el resumen
    // puro del transcript y renombrar no la invalida.
    return filtered.map((c) => {
      const custom = this.titulos.getCustomTitle(c.agente, c.id)
      return custom ? { ...c, customTitle: custom } : c
    })
  }

  /** Borra el transcript y el nombre propio; devuelve `false` si la cuenta no es válida. */
  async borrar(req: DeleteConversationRequest): Promise<boolean> {
    const base = this.baseDe(req.agente, req.accountId, req.mode === 'host')
    if (base === null) return false
    const deleted = await this.lector.deleteConversation(base, req.agente, req.id)
    if (deleted) await this.titulos.forgetCustomTitle(req.agente, req.id)
    return deleted
  }

  /** Pone o quita el nombre propio de una conversación. */
  async renombrar(req: RenameConversationRequest): Promise<void> {
    await this.titulos.setCustomTitle(req.agente, req.id, req.title)
  }
}
