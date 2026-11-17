// =============================================================================
// BarraFiltros: la fila de arriba de la columna central del log: buscador y los
// desplegables Rama, Usuario y Fecha (a propósito, solo esos tres). El buscador filtra la
// lista con texto libre y, si lo escrito parece un hash, salta a ese commit; el contador y
// las flechas solo salen en el primer caso. Los desplegables reusan `MenuContextual`.
// Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================

import { useState } from 'react'
import { MenuContextual, SEP, type EntradaMenuContextual } from '../../comun/MenuContextual'
import { IconoBuscar, IconoDesplegar } from './iconos'
import { pegarRecortado } from '../../util/pasteTrim'
import { PRESETS_FECHA, type Busqueda, type FiltrosLog } from './modelo/filtrosLog'
import { txGit } from './textos.ts'
import type { AutorConteo } from './modelo/filtrosLog'
import type { Rama } from '../../../../shared/git-ipc'

type CualMenu = 'rama' | 'autor' | 'fecha'

/** Qué desplegable está abierto, y dónde. */
type MenuAbierto = { cual: CualMenu; x: number; y: number } | null

function entradasRama(
  ramas: Rama[] | null,
  filtros: FiltrosLog,
  onFiltros: (f: FiltrosLog) => void
): EntradaMenuContextual[] {
  const locales = (ramas ?? []).filter((b) => !b.esRemota)
  const remotas = (ramas ?? []).filter((b) => b.esRemota)
  const t = txGit()
  const entradas: EntradaMenuContextual[] = [
    {
      label: t.todasLasRamas,
      checked: filtros.rama === null,
      onClick: () => onFiltros({ ...filtros, rama: null })
    }
  ]
  const entradaDe = (b: Rama, etiqueta: string): EntradaMenuContextual => ({
    label: etiqueta,
    checked: filtros.rama === b.nombre,
    onClick: () => onFiltros({ ...filtros, rama: b.nombre })
  })
  if (locales.length > 0) {
    entradas.push(SEP)
    for (const b of locales) entradas.push(entradaDe(b, b.esActual ? `${b.nombre}  (${t.actual})` : b.nombre))
  }
  if (remotas.length > 0) {
    entradas.push(SEP)
    for (const b of remotas) entradas.push(entradaDe(b, b.nombre))
  }
  return entradas
}

function entradasAutor(
  autores: AutorConteo[],
  filtros: FiltrosLog,
  onFiltros: (f: FiltrosLog) => void
): EntradaMenuContextual[] {
  const entradas: EntradaMenuContextual[] = [
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

function entradasFecha(filtros: FiltrosLog, onFiltros: (f: FiltrosLog) => void): EntradaMenuContextual[] {
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
        <button
          className={`git-icon-btn git-limpiar${consulta !== '' ? ' visible' : ''}`}
          tabIndex={consulta !== '' ? 0 : -1}
          aria-hidden={consulta === ''}
          onClick={() => onConsulta('')}
          title={t.limpiarBusqueda}
          aria-label={t.limpiarBusqueda}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
    </div>
  )
}

function BotonFiltro(p: {
  activo: boolean
  titulo: string
  valor: string
  onAbrir: (e: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  return (
    <button className={`git-filtro-btn${p.activo ? ' activo' : ''}`} onClick={p.onAbrir} title={p.titulo}>
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
  ramas: Rama[] | null
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
  const elementosMenu = (): EntradaMenuContextual[] => {
    if (menu?.cual === 'rama') return entradasRama(p.ramas, filtros, onFiltros)
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
        titulo={t.filtrarRama}
        valor={filtros.rama ?? t.rama}
        onAbrir={(e) => abrir('rama', e)}
      />
      <BotonFiltro
        activo={filtros.autor !== null}
        titulo={t.filtrarUsuario}
        valor={filtros.autor ?? t.usuario}
        onAbrir={(e) => abrir('autor', e)}
      />
      <BotonFiltro
        activo={filtros.fecha !== 'cualquiera'}
        titulo={t.filtrarFecha}
        valor={filtros.fecha === 'cualquiera' ? t.fecha : etiquetaFecha}
        onAbrir={(e) => abrir('fecha', e)}
      />
      {menu && (
        <MenuContextual x={menu.x} y={menu.y} items={elementosMenu()} onCerrar={() => setMenu(null)} />
      )}
    </div>
  )
}
