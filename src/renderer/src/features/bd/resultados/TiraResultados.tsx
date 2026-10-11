// =============================================================================
// La cabecera de los resultados de una consola: «Salida» fija y una pestaña por resultado
// (chincheta si está fijada, ✕, clic central y menú contextual), con los metadatos del activo
// y las acciones a la derecha. Genérica en el resultado: la usan la consola SQL y la de
// documentos. Qué pestaña se sustituye lo decide `pestanasResultado.ts`.
// Decisiones: docs/decisiones/bd/ui-resultados-pestanas.md
// =============================================================================

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../../comun/ContextMenu'
import { IconoCerrar } from '../../../comun/iconosMenu'
import { esBorrarPestanaEnfocada } from '../../../util/atajos'
import { IconoFijar } from '../iconosBd'
import {
  ID_SALIDA,
  puedeFijar,
  type AccionPestanaResultado,
  type EstadoResultados,
  type PestanaResultado as Pestana,
  type ResultadoConLector
} from './pestanasResultado'

type OnPestana = (accion: AccionPestanaResultado, id: string) => void

/** El menú contextual de una pestaña de resultado. */
function itemsMenuPestana<R extends ResultadoConLector>(
  resultados: EstadoResultados<R>,
  id: string,
  onPestana: OnPestana
): ContextMenuEntry[] {
  const pestana = resultados.pestanas.find((x) => x.id === id)
  if (!pestana) return []
  return [
    pestana.fijada
      ? { label: 'Desfijar', icon: <IconoFijar />, onClick: () => onPestana('desfijar', id) }
      : {
          label: 'Fijar',
          icon: <IconoFijar />,
          disabled: !puedeFijar(resultados),
          onClick: () => onPestana('fijar', id)
        },
    SEP,
    { label: 'Cerrar', icon: <IconoCerrar />, onClick: () => onPestana('cerrar', id) },
    { label: 'Cerrar las demás sin fijar', onClick: () => onPestana('cerrarOtras', id) },
    SEP,
    { label: 'Cerrar todos los resultados', onClick: () => onPestana('cerrarTodas', id) }
  ]
}

function teclaPestana(e: React.KeyboardEvent, id: string, onPestana: OnPestana): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onPestana('activar', id)
  } else if (id !== ID_SALIDA && esBorrarPestanaEnfocada(e)) {
    // La ✕ va a tabIndex -1 (una parada de Tab por pestaña): el gesto de borrar de cada
    // plataforma (`Supr`, o `⌘⌫` en Mac) es su teclado.
    e.preventDefault()
    onPestana('cerrar', id)
  }
}

/** Una pestaña de resultado: chincheta si está fijada, título y ✕; clic central cierra. */
function PestanaResultado(p: {
  t: Pestana
  esActiva: boolean
  titulo: string
  onPestana: OnPestana
  abrirMenu: (x: number, y: number) => void
}): React.JSX.Element {
  const { t, esActiva, onPestana } = p
  return (
    <div
      className={`terminal-tab db-resultado-tab${esActiva ? ' active' : ''}${t.fijada ? ' fijada' : ''}`}
      role="tab"
      aria-selected={esActiva}
      tabIndex={0}
      onClick={() => onPestana('activar', t.id)}
      onMouseDown={(e) => {
        // Sin esto, el botón central arranca el autodesplazamiento de Chromium.
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onPestana('cerrar', t.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        p.abrirMenu(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => teclaPestana(e, t.id, onPestana)}
      title={p.titulo}
    >
      {t.fijada && (
        <span className="db-resultado-chincheta" aria-label="Fijada">
          <IconoFijar />
        </span>
      )}
      <span className="terminal-tab-name">{t.titulo}</span>
      <button
        type="button"
        className="terminal-tab-kill"
        tabIndex={-1}
        title="Cerrar este resultado"
        aria-label={`Cerrar ${t.titulo}`}
        onClick={(e) => {
          e.stopPropagation()
          onPestana('cerrar', t.id)
        }}
      >
        <IconoCerrar />
      </button>
    </div>
  )
}

export interface PropsTiraResultados<R extends ResultadoConLector> {
  resultados: EstadoResultados<R>
  /** El tooltip de cada pestaña de resultado. */
  tituloDe: (t: Pestana, r: R | undefined) => string
  onPestana: OnPestana
  /** Los metadatos del activo («40 filas · 671 ms»); vacío, no se pintan. */
  meta: string
  /** Lo de la derecha («Limpiar la salida», «Cargar más»…). */
  acciones: React.ReactNode
}

/** La cabecera: tira de pestañas, metadatos del activo y acciones a la derecha. */
export function TiraResultados<R extends ResultadoConLector>(p: PropsTiraResultados<R>): React.JSX.Element {
  const { resultados, onPestana } = p
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const activa = resultados.activa
  const enSalida = activa === ID_SALIDA
  return (
    <div className="db-resultados-cabecera">
      <div className="db-resultados-tabs" role="tablist" aria-label="Salida y resultados">
        <div
          className={`terminal-tab db-resultado-tab${enSalida ? ' active' : ''}`}
          role="tab"
          aria-selected={enSalida}
          tabIndex={0}
          onClick={() => onPestana('activar', ID_SALIDA)}
          onKeyDown={(e) => teclaPestana(e, ID_SALIDA, onPestana)}
          title="Salida: lo que pasó en cada ejecución"
        >
          <span className="terminal-tab-name">Salida</span>
        </div>
        {resultados.pestanas.map((t) => (
          <PestanaResultado
            key={t.id}
            t={t}
            esActiva={t.id === activa}
            titulo={p.tituloDe(t, resultados.resultados[t.id])}
            onPestana={onPestana}
            abrirMenu={(x, y) => setMenu({ x, y, id: t.id })}
          />
        ))}
      </div>
      {p.meta !== '' && <span className="db-resultados-meta">{p.meta}</span>}
      <div className="panel-actions">{p.acciones}</div>
      {menu &&
        createPortal(
          <ContextMenu x={menu.x} y={menu.y} items={itemsMenuPestana(resultados, menu.id, onPestana)} onClose={() => setMenu(null)} />,
          document.body
        )}
    </div>
  )
}
