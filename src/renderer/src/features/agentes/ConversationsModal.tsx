// =============================================================================
// Historial del agente ACTIVO, por PROYECTO: títulos y búsqueda. Al hacer clic la
// terminal REANUDA esa sesión por id; no hay visor de lectura. Lo abre el pane del
// agente, que conoce el perfil, el agente, la cuenta y el proyecto.
// Cada fila puede llevar un nombre propio (`customTitle`, guardado por Tessera aparte
// del transcript); vaciarlo restablece el automático y la búsqueda mira los dos.
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import type { ConversationSummary, ConvAgent, ConvRunMode } from '../../../../shared/conversations-ipc'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { pegarRecortado } from '../../util/pasteTrim'
import { PromptDialog } from '../../comun/PromptDialog'
import { useDialogo } from '../../comun/useDialogo'
import { lugarHistorial, type LugarAgente } from './textosMontajeBases'

/** Lo que se muestra en la fila: el nombre propio si lo hay; si no, el automático. */
function displayTitle(c: ConversationSummary): string {
  return c.customTitle ?? c.title
}

interface ConversationsModalProps {
  profileId: string
  agente: ConvAgent
  /** Cuenta activa del agente (determina qué carpeta se lista); null = sin cuenta. */
  accountId: string | null
  /** Proyecto activo (ruta host); las conversaciones se filtran por él. */
  projectHostPath: string
  /**
   * Dónde vive el agente. El de datos y el de la terminal tienen una carpeta que se llama como
   * el id del perfil, así que el modal los nombra por su vista. Solo cambia el TEXTO (`lugarHistorial`).
   */
  lugar?: LugarAgente
  /**
   * Modo de ejecución. En 'host' (modo nativo) el historial se lee del home del usuario
   * en el sistema real y NO hace falta cuenta. Ausente => 'container'.
   */
  mode?: ConvRunMode
  accentColor: string | null
  /** Reanuda la conversación elegida (ejecuta el resume en la terminal). */
  onResume: (sessionId: string) => void
  onClose: () => void
}

const AGENT_LABEL: Record<ConvAgent, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

type PropsLista = Pick<ConversationsModalProps, 'profileId' | 'agente' | 'accountId' | 'projectHostPath'> & {
  mode: ConvRunMode
}

interface ListaConversaciones {
  list: ConversationSummary[] | null
  error: string | null
  renombrar: (c: ConversationSummary, title: string) => Promise<void>
  borrar: (c: ConversationSummary) => Promise<void>
}

/** Carga la lista del disco y la mantiene al renombrar o borrar, sin recargarla. */
function useListaConversaciones({ profileId, agente, accountId, projectHostPath, mode }: PropsLista): ListaConversaciones {
  const [list, setList] = useState<ConversationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) {
      setList([])
      return
    }
    let cancelled = false
    window.tessera.conversations
      .list({ profileId, agente, accountId, projectHostPath, mode })
      .then((items) => {
        if (!cancelled) setList(items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [profileId, agente, accountId, projectHostPath, mode])

  /** Renombra (o restablece, con `title` vacío) y actualiza la fila EN SITIO. */
  async function renombrar(c: ConversationSummary, title: string): Promise<void> {
    const custom = title.trim() || null
    try {
      await window.tessera.conversations.rename({ agente: c.agente, id: c.id, title: custom })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setList((prev) =>
      prev
        ? prev.map((x) =>
            x.id === c.id ? { ...x, customTitle: custom ?? undefined } : x
          )
        : prev
    )
  }

  async function borrar(c: ConversationSummary): Promise<void> {
    if (!accountId) return
    try {
      await window.tessera.conversations.delete({ profileId, agente, accountId, id: c.id, mode })
    } finally {
      // Quita la fila aunque el borrado falle parcialmente (se recarga al reabrir).
      setList((prev) => (prev ? prev.filter((x) => x.id !== c.id) : prev))
    }
  }

  return { list, error, renombrar, borrar }
}

/** Busca en el nombre propio Y en el automático: lo renombrado sigue encontrándose por su primer mensaje. */
function filtrar(list: ConversationSummary[] | null, query: string): ConversationSummary[] {
  if (!list) return []
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (c) =>
      c.title.toLowerCase().includes(q) || (c.customTitle?.toLowerCase().includes(q) ?? false)
  )
}

/** Modal del historial de conversaciones del agente activo en el proyecto. */
export function ConversationsModal(props: ConversationsModalProps): React.JSX.Element {
  const { agente, accountId, projectHostPath, lugar: dondeVive = 'proyecto', mode = 'container', onClose } = props
  // Esc por la pila de diálogos: el renombrado y el borrado se montan encima, y un solo Esc
  // cierra únicamente el de arriba.
  useDialogo({ onClose })
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<ConversationSummary | null>(null)
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null)
  const { list, error, renombrar, borrar } = useListaConversaciones({
    profileId: props.profileId,
    agente,
    accountId,
    projectHostPath,
    mode
  })

  const filtered = useMemo(() => filtrar(list, query), [list, query])
  const lugar = lugarHistorial(dondeVive, projectHostPath)

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <PanelConversaciones
        agente={agente}
        accentColor={props.accentColor}
        lugar={lugar}
        query={query}
        setQuery={setQuery}
        estado={{ list, error, filtered, accountId }}
        onClose={onClose}
        onResume={props.onResume}
        onRenombrar={setRenaming}
        onEliminar={setConfirmDelete}
      />

      {renaming && (
        <DialogoRenombrar
          renaming={renaming}
          onConfirm={(value) => {
            setRenaming(null)
            void renombrar(renaming, value)
          }}
          onCancel={() => setRenaming(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          danger
          title="Eliminar conversación"
          message={`¿Eliminar "${displayTitle(confirmDelete)}"?\nSe borra su transcript del disco. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => {
            setConfirmDelete(null)
            void borrar(confirmDelete)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

interface CabeceraConversacionesProps {
  agente: ConvAgent
  accentColor: string | null
  cabecera: string | null
  onClose: () => void
}

function CabeceraConversaciones({ agente, accentColor, cabecera, onClose }: CabeceraConversacionesProps): React.JSX.Element {
  return (
    <header className="conv-header">
      <div className="conv-header-title">
        {accentColor && (
          <span className="profile-dot" style={{ background: accentColor }} aria-hidden="true" />
        )}
        <span>Conversaciones de {AGENT_LABEL[agente]}</span>
        {cabecera && <span className="conv-header-profile">{cabecera}</span>}
      </div>
      <button className="btn btn-icon conv-close" onClick={onClose} title="Cerrar (Esc)" aria-label="Cerrar">
        ✕
      </button>
    </header>
  )
}

interface EstadoListaProps {
  list: ConversationSummary[] | null
  error: string | null
  filtered: ConversationSummary[]
  accountId: string | null
}

interface PanelConversacionesProps {
  agente: ConvAgent
  accentColor: string | null
  lugar: { cabecera: string; enVacio: string }
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  estado: EstadoListaProps
  onClose: () => void
  onResume: (sessionId: string) => void
  onRenombrar: (c: ConversationSummary) => void
  onEliminar: (c: ConversationSummary) => void
}

function PanelConversaciones(p: PanelConversacionesProps): React.JSX.Element {
  const { agente, query, setQuery, onClose } = p
  return (
    <div
      className="conv-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Conversaciones de ${AGENT_LABEL[agente]}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <CabeceraConversaciones agente={agente} accentColor={p.accentColor} cabecera={p.lugar.cabecera} onClose={onClose} />

      <div className="conv-search-wrap">
        <input
          className="conv-search"
          placeholder="Buscar conversación…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPaste={pegarRecortado(setQuery)}
          autoFocus
        />
      </div>

      <div className="conv-list-scroll">
        <EstadoLista {...p.estado} agente={agente} enVacio={p.lugar.enVacio} />
        {p.estado.filtered.map((c) => (
          <FilaConversacion
            key={c.id}
            c={c}
            onResume={() => {
              p.onResume(c.id)
              onClose()
            }}
            onRenombrar={() => p.onRenombrar(c)}
            onEliminar={() => p.onEliminar(c)}
          />
        ))}
      </div>

      <footer className="conv-footer">
        Clic en una conversación para reanudarla en la terminal.
      </footer>
    </div>
  )
}

function EstadoLista({
  list,
  error,
  filtered,
  accountId,
  agente,
  enVacio
}: EstadoListaProps & { agente: ConvAgent; enVacio: string }): React.JSX.Element {
  return (
    <>
      {list === null && !error && <div className="conv-empty">Cargando…</div>}
      {error && <div className="conv-empty conv-error">No se pudo leer el historial:{'\n'}{error}</div>}
      {list !== null && !error && filtered.length === 0 && (
        <div className="conv-empty">
          {!accountId
            ? 'Elige una cuenta primero.'
            : list.length === 0
              ? `Aún no hay conversaciones de ${AGENT_LABEL[agente]} ${enVacio}.`
              : 'Ningún resultado para la búsqueda.'}
        </div>
      )}
    </>
  )
}

interface FilaConversacionProps {
  c: ConversationSummary
  onResume: () => void
  onRenombrar: () => void
  onEliminar: () => void
}

function FilaConversacion({ c, onResume, onRenombrar, onEliminar }: FilaConversacionProps): React.JSX.Element {
  return (
    <div className="conv-item">
      <button
        className="conv-item-main"
        // Una conversación renombrada enseña su título automático en el tooltip.
        title={
          c.customTitle
            ? `Reanudar: ${c.customTitle}\nTítulo automático: ${c.title}`
            : `Reanudar: ${c.title}`
        }
        onClick={onResume}
      >
        <span className="conv-item-title">{displayTitle(c)}</span>
        {c.customTitle && (
          <span className="conv-item-renamed" aria-label="Renombrada">
            <TagIcon />
          </span>
        )}
        <span className="conv-item-date">{formatDate(c.updatedAt)}</span>
      </button>
      <button
        className="conv-item-rename"
        title="Renombrar conversación"
        aria-label="Renombrar conversación"
        onClick={(e) => {
          e.stopPropagation()
          onRenombrar()
        }}
      >
        <PencilIcon />
      </button>
      <button
        className="conv-item-del"
        title="Eliminar conversación"
        aria-label="Eliminar conversación"
        onClick={(e) => {
          e.stopPropagation()
          onEliminar()
        }}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

interface DialogoRenombrarProps {
  renaming: ConversationSummary
  onConfirm: (value: string) => void
  onCancel: () => void
}

function DialogoRenombrar({ renaming, onConfirm, onCancel }: DialogoRenombrarProps): React.JSX.Element {
  return (
    <PromptDialog
      title="Renombrar conversación"
      label="Nombre"
      initialValue={renaming.customTitle ?? ''}
      confirmLabel="Guardar"
      allowEmpty
      hint={
        renaming.customTitle
          ? `Déjalo vacío para volver al título automático:\n"${renaming.title}"`
          : `Título automático actual:\n"${renaming.title}"`
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/** Lápiz para renombrar una conversación. */
function PencilIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 6.5l3 3" strokeLinecap="round" />
    </svg>
  )
}

/** Etiqueta: marca discreta de que el título lo puso el usuario, no el agente. */
function TagIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="11" height="11">
      <path d="M3 11V4h7l10 10-7 7L3 11z" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  )
}

/** Bote de basura para eliminar una conversación. */
function TrashIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Fecha compacta y legible (hoy/ayer con hora; si no, fecha corta). */
function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `hoy ${hhmm}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `ayer ${hhmm}`
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}
