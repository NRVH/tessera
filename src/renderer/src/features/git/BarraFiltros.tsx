// =============================================================================
// BarraFiltros: la fila de arriba de la columna central del log: buscador y los
// desplegables Rama, Usuario y Fecha (a propósito, solo esos tres). El buscador filtra la
// lista con texto libre y, si lo escrito parece un hash, salta a ese commit; el contador y
// las flechas solo salen en el primer caso. Los desplegables reusan `ContextMenu`.
// Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================

import { useState } from 'react'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import { IconoBuscar, IconoDesplegar } from './iconos'
import { pegarRecortado } from '../../util/pasteTrim'
import { PRESETS_FECHA, type Busqueda, type FiltrosLog } from './modelo/filtrosLog'
import { txGit } from './textos.ts'
import type { AutorConteo } from './modelo/filtrosLog'
import type { Branch } from '../../../../shared/git-ipc'

type CualMenu = 'rama' | 'autor' | 'fecha'

/** Qué desplegable está abierto, y dónde. */
type MenuAbierto = { cual: CualMenu; x: number; y: number } | null

function entradasRama(
  branches: Branch[] | null,
  filtros: FiltrosLog,
  onFiltros: (f: FiltrosLog) => void
): ContextMenuEntry[] {
  const locales = (branches ?? []).filter((b) => !b.remote)
  const remotas = (branches ?? []).filter((b) => b.remote)
  const t = txGit()
  const entradas: ContextMenuEntry[] = [
    {
      label: t.todasLasRamas,
      checked: filtros.rama === null,
      onClick: () => onFiltros({ ...filtros, rama: null })
    }
  ]
  const entradaDe = (b: Branch, label: string): ContextMenuEntry => ({
    label,
    checked: filtros.rama === b.name,
    onClick: () => onFiltros({ ...filtros, rama: b.name })
  })
  if (locales.length > 0) {
    entradas.push(SEP)
    for (const b of locales) entradas.push(entradaDe(b, b.current ? `${b.name}  (${t.actual})` : b.name))
  }
  if (remotas.length > 0) {
    entradas.push(SEP)
    for (const b of remotas) entradas.push(entradaDe(b, b.name))
  }
  return entradas
}

function entradasAutor(
  autores: AutorConteo[],
  filtros: FiltrosLog,
  onFiltros: (f: FiltrosLog) => void
): ContextMenuEntry[] {
  const entradas: ContextMenuEntry[] = [
    {
      label: txGit().cualquierUsuario,
      checked: filtros.autor === null,
      onClick: () => onFiltros({ ...filtros, autor: null })
    }
  ]
  if (autores.length > 0) entradas.push(SEP)
  for (const a of autores) {
    entradas.push({
      label: `${a.nombre}  (${a.commits})`,
      checked: filtros.autor === a.nombre,
      onClick: () => onFiltros({ ...filtros, autor: a.nombre })
    })
  }
  return entradas
}

function entradasFecha(filtros: FiltrosLog, onFiltros: (f: FiltrosLog) => void): ContextMenuEntry[] {
  const etiquetas = txGit().fechas
  return PRESETS_FECHA.map((id) => ({
    label: etiquetas[id],
    checked: filtros.fecha === id,
    onClick: () => onFiltros({ ...filtros, fecha: id })
  }))
}

/** Contador y flechas de coincidencia; solo salen en modo texto. */
function ControlesCoincidencia(p: {
  coincidencias: number
  indice: number
  onSaltar: (delta: 1 | -1) => void
}): React.JSX.Element {
  const { coincidencias, onSaltar } = p
  const t = txGit()
  return (
    <>
      <span className="git-buscador-conteo">
        {coincidencias === 0 ? t.sinResultados : `${p.indice}/${coincidencias}`}
      </span>
      <button
        className="git-icon-btn"
        onClick={() => onSaltar(-1)}
        disabled={coincidencias === 0}
        title={t.coincidenciaAnteriorTitulo}
        aria-label={t.coincidenciaAnterior}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className="git-icon-btn"
        onClick={() => onSaltar(1)}
        disabled={coincidencias === 0}
        title={t.coincidenciaSiguienteTitulo}
        aria-label={t.coincidenciaSiguiente}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  )
}

function Buscador(p: {
  consulta: string
  onConsulta: (v: string) => void
  modoTexto: boolean
  coincidencias: number
  indiceCoincidencia: number
  onSaltarCoincidencia: (delta: 1 | -1) => void
}): React.JSX.Element {
  const { consulta, onConsulta, coincidencias, onSaltarCoincidencia } = p
  const t = txGit()
  return (
    <div className="git-buscador">
      <IconoBuscar />
      <input
        type="text"
        value={consulta}
        onChange={(e) => onConsulta(e.target.value)}
        // Pegar un hash de otra ventana suele arrastrar espacios (ver util/pasteTrim).
        onPaste={pegarRecortado(onConsulta)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && p.modoTexto) {
            e.preventDefault()
            onSaltarCoincidencia(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape' && consulta !== '') {
            e.preventDefault()
            onConsulta('')
          }
        }}
        placeholder={t.textoOHash}
        spellCheck={false}
        aria-label={t.buscarEnHistorial}
      />
      {p.modoTexto && (
        <ControlesCoincidencia
          coincidencias={coincidencias}
          indice={p.indiceCoincidencia}
          onSaltar={onSaltarCoincidencia}
        />
      )}
      {consulta !== '' && (
        <button
          className="git-icon-btn"
          onClick={() => onConsulta('')}
          title={t.limpiarBusqueda}
          aria-label={t.limpiarBusqueda}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

function BotonFiltro(p: {
  activo: boolean
  title: string
  valor: string
  onAbrir: (e: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  return (
    <button className={`git-filtro-btn${p.activo ? ' activo' : ''}`} onClick={p.onAbrir} title={p.title}>
      <span className="git-filtro-valor">{p.valor}</span>
      <IconoDesplegar />
    </button>
  )
}

interface PropsBarraFiltros {
  consulta: string
  onConsulta: (v: string) => void
  /** La consulta ya interpretada (vacío / hash / texto). */
  busqueda: Busqueda
  /** Nº de commits que casan, en modo texto. */
  coincidencias: number
  /** Posición (1-based) de la coincidencia enfocada, o 0 si ninguna. */
  indiceCoincidencia: number
  onSaltarCoincidencia: (delta: 1 | -1) => void
  filtros: FiltrosLog
  onFiltros: (f: FiltrosLog) => void
  branches: Branch[] | null
  autores: AutorConteo[]
}

export function BarraFiltros(p: PropsBarraFiltros): React.JSX.Element {
  const { filtros, onFiltros } = p
  const [menu, setMenu] = useState<MenuAbierto>(null)

  const abrir = (cual: CualMenu, e: React.MouseEvent<HTMLButtonElement>): void => {
    // El DOMRect se mide SÍNCRONAMENTE: dentro de un updater React ya anuló currentTarget.
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ cual, x: r.left, y: r.bottom + 4 })
  }

  const t = txGit()
  const etiquetaFecha = t.fechas[filtros.fecha]
  const itemsMenu = (): ContextMenuEntry[] => {
    if (menu?.cual === 'rama') return entradasRama(p.branches, filtros, onFiltros)
    if (menu?.cual === 'autor') return entradasAutor(p.autores, filtros, onFiltros)
    return entradasFecha(filtros, onFiltros)
  }

  return (
    <div className="git-filtros">
      <Buscador
        consulta={p.consulta}
        onConsulta={p.onConsulta}
        modoTexto={p.busqueda.modo === 'texto'}
        coincidencias={p.coincidencias}
        indiceCoincidencia={p.indiceCoincidencia}
        onSaltarCoincidencia={p.onSaltarCoincidencia}
      />
      <BotonFiltro
        activo={filtros.rama !== null}
        title={t.filtrarRama}
        valor={filtros.rama ?? t.rama}
        onAbrir={(e) => abrir('rama', e)}
      />
      <BotonFiltro
        activo={filtros.autor !== null}
        title={t.filtrarUsuario}
        valor={filtros.autor ?? t.usuario}
        onAbrir={(e) => abrir('autor', e)}
      />
      <BotonFiltro
        activo={filtros.fecha !== 'cualquiera'}
        title={t.filtrarFecha}
        valor={filtros.fecha === 'cualquiera' ? t.fecha : etiquetaFecha}
        onAbrir={(e) => abrir('fecha', e)}
      />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={itemsMenu()} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
