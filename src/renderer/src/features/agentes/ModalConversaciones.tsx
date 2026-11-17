// =============================================================================
// Historial del agente ACTIVO, por PROYECTO: títulos y búsqueda. Al hacer clic la
// terminal REANUDA esa sesión por id; no hay visor de lectura. Lo abre el pane del
// agente, que conoce el perfil, el agente, la cuenta y el proyecto.
// Cada fila puede llevar un nombre propio (`tituloPropio`, guardado por Tessera aparte
// del transcript); vaciarlo restablece el automático y la búsqueda mira los dos.
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import type { ResumenConversacion, AgenteConversacion, ModoEjecucionConversacion } from '../../../../shared/conversations-ipc'
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { pegarRecortado } from '../../util/pasteTrim'
import { DialogoPrompt } from '../../comun/DialogoPrompt'
import { AvisoConPresencia, ModalAviso, Modal } from '../../comun/Modal'
import { txConversaciones } from './textosConversaciones.ts'
import { lugarHistorial, type LugarAgente } from './textosMontajeBases'

/** Lo que se muestra en la fila: el nombre propio si lo hay; si no, el automático. */
function tituloVisible(c: ResumenConversacion): string {
  return c.tituloPropio ?? c.titulo
}

interface PropsModalConversaciones {
  perfilId: string
  agente: AgenteConversacion
  /** Cuenta activa del agente (determina qué carpeta se lista); null = sin cuenta. */
  cuentaId: string | null
  /** Proyecto activo (ruta host); las conversaciones se filtran por él. */
  rutaHostProyecto: string
  /**
   * Dónde vive el agente. El de datos y el de la terminal tienen una carpeta que se llama como
   * el id del perfil, así que el modal los nombra por su vista. Solo cambia el TEXTO (`lugarHistorial`).
   */
  lugar?: LugarAgente
  /**
   * Modo de ejecución. En 'host' (modo nativo) el historial se lee del home del usuario
   * en el sistema real y NO hace falta cuenta. Ausente => 'container'.
   */
  modo?: ModoEjecucionConversacion
  colorAcento: string | null
  /** Reanuda la conversación elegida (ejecuta el resume en la terminal). */
  onReanudar: (sesionId: string) => void
  onCerrar: () => void
}

const ETIQUETA_AGENTE_CONVERSACIONES: Record<AgenteConversacion, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

type PropsLista = Pick<PropsModalConversaciones, 'perfilId' | 'agente' | 'cuentaId' | 'rutaHostProyecto'> & {
  modo: ModoEjecucionConversacion
}

interface ListaConversaciones {
  lista: ResumenConversacion[] | null
  error: string | null
  renombrar: (c: ResumenConversacion, titulo: string) => Promise<void>
  borrar: (c: ResumenConversacion) => Promise<void>
}

/** Carga la lista del disco y la mantiene al renombrar o borrar, sin recargarla. */
function useListaConversaciones({ perfilId: profileId, agente, cuentaId: accountId, rutaHostProyecto: projectHostPath, modo: mode }: PropsLista): ListaConversaciones {
  const [lista, setLista] = useState<ResumenConversacion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) {
      setLista([])
      return
    }
    let cancelado = false
    window.tessera.conversaciones
      .listar({ profileId, agente, accountId, projectHostPath, modo: mode })
      .then((elementos) => {
        if (!cancelado) setLista(elementos)
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelado = true
    }
  }, [profileId, agente, accountId, projectHostPath, mode])

  /** Renombra (o restablece, con `title` vacío) y actualiza la fila EN SITIO. */
  async function renombrar(c: ResumenConversacion, titulo: string): Promise<void> {
    const tituloPropio = titulo.trim() || null
    try {
      await window.tessera.conversaciones.renombrar({ agente: c.agente, id: c.id, titulo: tituloPropio })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setLista((prev) =>
      prev
        ? prev.map((x) =>
            x.id === c.id ? { ...x, tituloPropio: tituloPropio ?? undefined } : x
          )
        : prev
    )
  }

  async function borrar(c: ResumenConversacion): Promise<void> {
    if (!accountId) return
    try {
      await window.tessera.conversaciones.borrar({ profileId, agente, accountId, id: c.id, modo: mode })
    } finally {
      // Quita la fila aunque el borrado falle parcialmente (se recarga al reabrir).
      setLista((prev) => (prev ? prev.filter((x) => x.id !== c.id) : prev))
    }
  }

  return { lista, error, renombrar, borrar }
}

/** Busca en el nombre propio Y en el automático: lo renombrado sigue encontrándose por su primer mensaje. */
function filtrar(lista: ResumenConversacion[] | null, consulta: string): ResumenConversacion[] {
  if (!lista) return []
  const q = consulta.trim().toLowerCase()
  if (!q) return lista
  return lista.filter(
    (c) =>
      c.titulo.toLowerCase().includes(q) || (c.tituloPropio?.toLowerCase().includes(q) ?? false)
  )
}

/** Modal del historial de conversaciones del agente activo en el proyecto. */
export function ModalConversaciones(props: PropsModalConversaciones): React.JSX.Element {
  const { agente, cuentaId: accountId, rutaHostProyecto: projectHostPath, lugar: dondeVive = 'proyecto', modo: mode = 'container', onCerrar } = props
  const [consulta, setConsulta] = useState('')
  const [confirmarBorrado, setConfirmarBorrado] = useState<ResumenConversacion | null>(null)
  const [renombrando, setRenombrando] = useState<ResumenConversacion | null>(null)
  const { lista, error, renombrar, borrar } = useListaConversaciones({
    perfilId: props.perfilId,
    agente,
    cuentaId: accountId,
    rutaHostProyecto: projectHostPath,
    modo: mode
  })

  const filtradas = useMemo(() => filtrar(lista, consulta), [lista, consulta])
  const lugar = lugarHistorial(dondeVive, projectHostPath)
  const t = txConversaciones()

  return (
    <>
      <PanelConversaciones
        agente={agente}
        colorAcento={props.colorAcento}
        lugar={lugar}
        consulta={consulta}
        setConsulta={setConsulta}
        estado={{ lista, error, filtradas, cuentaId: accountId }}
        onCerrar={onCerrar}
        onReanudar={props.onReanudar}
        onRenombrar={setRenombrando}
        onEliminar={setConfirmarBorrado}
      />

      {renombrando && (
        <DialogoRenombrar
          renombrando={renombrando}
          onConfirmar={(valor) => {
            setRenombrando(null)
            void renombrar(renombrando, valor)
          }}
          onCancelar={() => setRenombrando(null)}
        />
      )}

      {confirmarBorrado && (
        <DialogoConfirmar
          peligro
          titulo={t.eliminarPregunta(tituloVisible(confirmarBorrado))}
          mensaje={t.eliminarMensaje()}
          etiquetaConfirmar={t.eliminar}
          onConfirmar={() => {
            setConfirmarBorrado(null)
            void borrar(confirmarBorrado)
          }}
          onCancelar={() => setConfirmarBorrado(null)}
        />
      )}
    </>
  )
}

interface PropsEstadoLista {
  lista: ResumenConversacion[] | null
  error: string | null
  filtradas: ResumenConversacion[]
  cuentaId: string | null
}

interface PropsPanelConversaciones {
  agente: AgenteConversacion
  colorAcento: string | null
  lugar: { cabecera: string; enVacio: string }
  consulta: string
  setConsulta: React.Dispatch<React.SetStateAction<string>>
  estado: PropsEstadoLista
  onCerrar: () => void
  onReanudar: (sesionId: string) => void
  onRenombrar: (c: ResumenConversacion) => void
  onEliminar: (c: ResumenConversacion) => void
}

function PanelConversaciones(p: PropsPanelConversaciones): React.JSX.Element {
  const { agente, consulta, setConsulta, onCerrar } = p
  const t = txConversaciones()
  return (
    <Modal titulo={<>{p.colorAcento && <span className="profile-dot" style={{ background: p.colorAcento }} aria-hidden="true" />}{t.titulo(ETIQUETA_AGENTE_CONVERSACIONES[agente])}</>}
      subtitulo={<>{p.lugar.cabecera} · {t.pie}</>} centro={<input
          className="conv-search"
          placeholder={t.buscar}
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onPaste={pegarRecortado(setConsulta)}
          autoFocus
        />}
      className="conv-modal" tamano="m" onCerrar={onCerrar}>
      <div className="conv-list-scroll">
        <EstadoLista {...p.estado} agente={agente} enVacio={p.lugar.enVacio} />
        {p.estado.filtradas.map((c) => (
          <FilaConversacion
            key={c.id}
            c={c}
            onReanudar={() => {
              p.onReanudar(c.id)
              onCerrar()
            }}
            onRenombrar={() => p.onRenombrar(c)}
            onEliminar={() => p.onEliminar(c)}
          />
        ))}
      </div>

    </Modal>
  )
}

function EstadoLista({
  lista,
  error,
  filtradas,
  cuentaId: accountId,
  agente,
  enVacio
}: PropsEstadoLista & { agente: AgenteConversacion; enVacio: string }): React.JSX.Element {
  const t = txConversaciones()
  return (
    <>
      {lista === null && !error && <div className="conv-empty">{t.cargando}</div>}
      <AvisoConPresencia>{error && <ModalAviso tono="error">{t.errorLeer}{'\n'}{error}</ModalAviso>}</AvisoConPresencia>
      {lista !== null && !error && filtradas.length === 0 && (
        <div className="conv-empty">
          {!accountId
            ? t.elegirCuenta
            : lista.length === 0
              ? t.sinConversaciones(ETIQUETA_AGENTE_CONVERSACIONES[agente], enVacio)
              : t.sinResultados}
        </div>
      )}
    </>
  )
}

interface PropsFilaConversacion {
  c: ResumenConversacion
  onReanudar: () => void
  onRenombrar: () => void
  onEliminar: () => void
}

function FilaConversacion({ c, onReanudar, onRenombrar, onEliminar }: PropsFilaConversacion): React.JSX.Element {
  const t = txConversaciones()
  return (
    <div className="conv-item">
      <button
        className="conv-item-main"
        // Una conversación renombrada enseña su título automático en el tooltip.
        title={c.tituloPropio ? t.reanudarRenombrada(c.tituloPropio, c.titulo) : t.reanudar(c.titulo)}
        onClick={onReanudar}
      >
        <span className="conv-item-title">{tituloVisible(c)}</span>
        {c.tituloPropio && (
          <span className="conv-item-renamed" aria-label={t.renombrada}>
            <IconoEtiquetaConversacion />
          </span>
        )}
        <span className="conv-item-date">{formatearFecha(c.actualizadaEn)}</span>
      </button>
      <button
        className="conv-item-rename"
        title={t.renombrar}
        aria-label={t.renombrar}
        onClick={(e) => {
          e.stopPropagation()
          onRenombrar()
        }}
      >
        <IconoLapizRenombrar />
      </button>
      <button
        className="conv-item-del"
        title={t.eliminarTitulo}
        aria-label={t.eliminarTitulo}
        onClick={(e) => {
          e.stopPropagation()
          onEliminar()
        }}
      >
        <IconoPapeleraConversacion />
      </button>
    </div>
  )
}

interface PropsDialogoRenombrar {
  renombrando: ResumenConversacion
  onConfirmar: (valor: string) => void
  onCancelar: () => void
}

function DialogoRenombrar({ renombrando, onConfirmar, onCancelar }: PropsDialogoRenombrar): React.JSX.Element {
  const t = txConversaciones()
  return (
    <DialogoPrompt
      titulo={t.renombrar}
      etiqueta={t.nombre}
      valorInicial={renombrando.tituloPropio ?? ''}
      etiquetaConfirmar={t.guardar}
      permitirVacio
      pista={renombrando.tituloPropio ? t.pistaConNombre(renombrando.titulo) : t.pistaSinNombre(renombrando.titulo)}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />
  )
}

/** Lápiz para renombrar una conversación. */
function IconoLapizRenombrar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 6.5l3 3" strokeLinecap="round" />
    </svg>
  )
}

/** Etiqueta: marca discreta de que el título lo puso el usuario, no el agente. */
function IconoEtiquetaConversacion(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="11" height="11">
      <path d="M3 11V4h7l10 10-7 7L3 11z" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  )
}

/** Bote de basura para eliminar una conversación. */
function IconoPapeleraConversacion(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Fecha compacta y legible (hoy/ayer con hora; si no, fecha corta). */
function formatearFecha(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const ahora = new Date()
  const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === ahora.toDateString()) return txConversaciones().hoy(hhmm)
  const yesterday = new Date(ahora)
  yesterday.setDate(ahora.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return txConversaciones().ayer(hhmm)
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}
