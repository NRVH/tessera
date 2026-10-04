// =============================================================================
// Controles del mosaico de agentes en la barra de título: resumen, distribuciones,
// selector de casillas y, si no caben todas, fichas para elegir cuál se ve.
// Van en la barra y no dentro de la columna medida: así un aviso que aparece no
// cambia la medida ni, con ella, el reparto (evita un bucle), y no roba filas.
// El selector lista todo lo abierto en orden canónico, nunca agrupado por estado:
// una lista que se reordena sola mueve la opción que ibas a pulsar.
// =============================================================================

import { useState } from 'react'
import { ContextMenu, type ContextMenuEntry } from '../../comun/ContextMenu'
import { PuntoMosaico } from './PuntoMosaico'
import type { PresetMosaico } from './mosaicoLayout'
import type { OpcionMosaico } from './mosaicoTeselas'

interface BarraMosaicoProps {
  /** Cuántas hay en el mosaico y cuántas de ellas trabajan ahora. */
  casillas: number
  trabajando: number
  preset: PresetMosaico
  onPreset: (p: PresetMosaico) => void
  /**
   * false cuando la distribución pedida no cabe en esta ventana y se usa Automático
   * en su lugar. Se AVISA en vez de romper la terminal: una casilla de 30 columnas no
   * sirve para nada, y la elección del usuario vuelve sola en cuanto haya sitio.
   */
  presetRespetado: boolean
  /** Todo lo que se puede poner en una casilla (orden canónico), en marcha o no. */
  opciones: OpcionMosaico[]
  /** Mete o saca una sesión del mosaico (con seis, sustituye a la menos reciente). */
  onAlternar: (key: string) => void
  /**
   * Casillas que NO caben a la vez (la ventana es demasiado pequeña, o hay una
   * ampliada): se enseñan como fichas y la pulsada pasa a verse. Vacío = caben todas.
   */
  fichas: OpcionMosaico[]
  /** Clave de la casilla que se ve cuando no caben todas. */
  visible: string | null
  onElegirFicha: (key: string) => void
}

// Los nombres dicen lo que se ve («Columnas», «Filas») y no la palabra técnica
// («horizontal»), que en distintas terminales significa cosas opuestas.
const PRESETS: { id: PresetMosaico; nombre: string; ayuda: string; icono: () => React.JSX.Element }[] = [
  {
    id: 'auto',
    nombre: 'Automático',
    ayuda: 'Automático: reparte según cuántas haya y la forma de la ventana',
    icono: IconoAuto
  },
  {
    id: 'cuadricula',
    nombre: 'Cuadrícula',
    ayuda: 'Cuadrícula: filas y columnas equilibradas (4 en 2 × 2, 6 en 3 × 2), aunque Automático prefiera otra forma',
    icono: IconoCuadricula
  },
  { id: 'columnas', nombre: 'Columnas', ayuda: 'Columnas: todas lado a lado', icono: IconoColumnas },
  { id: 'filas', nombre: 'Filas', ayuda: 'Filas: todas una debajo de otra', icono: IconoFilas },
  {
    id: 'principal',
    nombre: 'Principal y pila',
    ayuda: 'Principal y pila: la primera grande a la izquierda y las demás apiladas a la derecha',
    icono: IconoPrincipal
  }
]

/** Controles del mosaico que ocupan la barra de título mientras está abierto. */
export function BarraMosaico({
  casillas,
  trabajando,
  preset,
  onPreset,
  presetRespetado,
  opciones,
  onAlternar,
  fichas,
  visible,
  onElegirFicha
}: BarraMosaicoProps): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const nombrePreset = PRESETS.find((p) => p.id === preset)?.nombre ?? ''
  const items = itemsDelSelector(opciones, onAlternar)

  return (
    <div className="barra-mosaico" role="toolbar" aria-label="Mosaico de agentes">
      <span className="barra-mosaico-resumen">
        {casillas === 1 ? '1 agente' : `${casillas} agentes`}
        {trabajando > 0 && <span className="barra-mosaico-trabajando"> · {trabajando} trabajando</span>}
      </span>
      <PresetsMosaico preset={preset} onPreset={onPreset} />
      {!presetRespetado && <AvisoPreset nombrePreset={nombrePreset} />}
      <button
        type="button"
        className="barra-mosaico-selector"
        // El menú se cierra con un mousedown fuera de él; sin esto, pulsar el propio
        // botón con el menú abierto lo cerraba en el mousedown y el click lo reabría.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu((m) => (m ? null : { x: r.left, y: r.bottom + 4 }))
        }}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title="Elegir qué proyectos se ven (como mucho seis). Los que no están en marcha arrancan al añadirlos, y los dormidos levantan antes su contenedor."
      >
        {casillas} de {opciones.length}
        <IconoDesplegar />
      </button>
      {fichas.length > 0 && <FichasMosaico fichas={fichas} visible={visible} onElegirFicha={onElegirFicha} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}

/**
 * Una fila por PROYECTO, no por (proyecto, agente): el mosaico enseña una casilla por
 * proyecto y el agente se elige dentro. «(dormido)» además del punto hueco porque
 * marcarlo levanta su contenedor, el único clic de la lista con ese coste.
 */
function itemsDelSelector(opciones: OpcionMosaico[], onAlternar: (key: string) => void): ContextMenuEntry[] {
  return opciones.map((o) => ({
    label: `${o.perfil} · ${o.proyecto}${o.dormido ? ' (dormido)' : ''}`,
    checked: o.esCasilla,
    icon: <PuntoMosaico color={o.color} enMarcha={o.enMarcha} trabajando={o.trabajando} sinVer={o.sinVer} />,
    onClick: () => onAlternar(o.key)
  }))
}

/** Las distribuciones como control segmentado de iconos. */
function PresetsMosaico({
  preset,
  onPreset
}: {
  preset: PresetMosaico
  onPreset: (p: PresetMosaico) => void
}): React.JSX.Element {
  return (
    <span className="barra-mosaico-presets" role="radiogroup" aria-label="Distribución">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={preset === p.id}
          className={`titlebar-btn${preset === p.id ? ' active' : ''}`}
          onClick={() => onPreset(p.id)}
          title={p.ayuda}
          aria-label={p.nombre}
        >
          <p.icono />
        </button>
      ))}
    </span>
  )
}

/**
 * Un icono con su porqué en el tooltip, no una frase: la barra va justa y la vista ya
 * es usable. Nombra lo que se pidió para que se entienda que volverá solo.
 */
function AvisoPreset({ nombrePreset }: { nombrePreset: string }): React.JSX.Element {
  return (
    <span
      className="barra-mosaico-aviso"
      title={`«${nombrePreset}» no cabe en esta ventana: se usa Automático hasta que haya sitio.`}
      aria-label={`${nombrePreset} no cabe: se usa Automático`}
      role="img"
    >
      <IconoAviso />
    </span>
  )
}

/** Fichas de las casillas que no caben a la vez; la pulsada pasa a verse. */
function FichasMosaico({
  fichas,
  visible,
  onElegirFicha
}: {
  fichas: OpcionMosaico[]
  visible: string | null
  onElegirFicha: (key: string) => void
}): React.JSX.Element {
  return (
    <span className="barra-mosaico-fichas" role="tablist" aria-label="Casilla a la vista">
      {fichas.map((f) => {
        const nombre = etiquetaFicha(f, fichas)
        return (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={visible === f.key}
            className={`barra-mosaico-ficha${visible === f.key ? ' active' : ''}`}
            onClick={() => onElegirFicha(f.key)}
            title={`${f.perfil} · ${f.proyecto} · ${f.agente}`}
          >
            <PuntoMosaico color={f.color} enMarcha={f.enMarcha} trabajando={f.trabajando} sinVer={f.sinVer} />
            <span className="barra-mosaico-ficha-nombre">{nombre}</span>
          </button>
        )
      })}
    </span>
  )
}

/**
 * Nombre de una ficha: el proyecto, y el perfil delante solo si el mismo proyecto
 * aparece en otro perfil («Trabajo · api»). Dos proyectos distintos con el mismo nombre
 * en el mismo perfil siguen sin distinguirse: haría falta enseñar parte de la ruta.
 */
function etiquetaFicha(f: OpcionMosaico, fichas: OpcionMosaico[]): string {
  const conPerfil = fichas.some((o) => o.key !== f.key && o.proyecto === f.proyecto && o.perfil !== f.perfil)
  return `${conPerfil ? `${f.perfil} · ` : ''}${f.proyecto}`
}

// --- Iconos (24×24, trazo 1.6, el mismo lenguaje que el resto de la barra) ---------

/** Automático: la forma que más a menudo sale (3 arriba y 2 abajo, estiradas). */
function IconoAuto(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 12h18M9 4v8M15 4v8M12 12v8" />
    </svg>
  )
}

/** Cuadrícula: 2 × 2 dentro del marco, la forma equilibrada. */
function IconoCuadricula(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16M3 12h18" />
    </svg>
  )
}

function IconoColumnas(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  )
}

function IconoFilas(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.33h18M3 14.67h18" />
    </svg>
  )
}

function IconoPrincipal(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M13 4v16M13 12h8" />
    </svg>
  )
}

function IconoAviso(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.2v.3" strokeLinecap="round" />
    </svg>
  )
}

function IconoDesplegar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
