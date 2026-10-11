// =============================================================================
// El selector de color de un perfil: los colores base de la paleta, los que el usuario ha
// fijado y un «Personalizado» de tono y luz dentro de la banda cenizo. Las muestras enseñan
// la TINTA (lo que se pinta), no el color crudo. `PaletaColorPerfil` es el cuerpo, que usa
// también «Nuevo perfil»; `SelectorColorPerfil` es el popover bajo la pestaña.
// Decisiones: docs/decisiones/renderer/color-de-perfil-cenizo.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { MAX_COLORES_FIJADOS } from '../../../../shared/workspace-state-ipc'
import type { Profile } from '../../../../main/profiles/types'
import { tintaPerfil } from './colorPerfil'
import { PALETTE_PERFILES } from './paletaPerfiles'
import { useStorePestanas } from './store'
import { colorDeTonoYLuz, fijarColor, leerHex, quitarFijado, tonoYLuzDe } from './colorPersonalizado'

/** Una muestra: botón redondo con la tinta del color; la elegida lleva anillo. */
function Muestra(p: { color: string; elegida: boolean; onElegir: () => void; onQuitar?: () => void }): React.JSX.Element {
  const tinta = tintaPerfil(p.color)
  return (
    <button
      type="button"
      className={`selector-color-muestra${p.elegida ? ' elegida' : ''}`}
      style={{ background: tinta }}
      title={p.onQuitar ? `${tinta} · clic derecho para quitarlo` : tinta}
      aria-label={`Color ${tinta}`}
      aria-pressed={p.elegida}
      onClick={p.onElegir}
      onContextMenu={(e) => {
        if (!p.onQuitar) return
        e.preventDefault()
        p.onQuitar()
      }}
    />
  )
}

/**
 * Tono y luz con deslizadores, el hex y los botones de aplicar y fijar. Parte del color tal cual
 * (no de su proyección en la banda), así que Aplicar sin tocar nada no lo cambia, y lo vuelve a
 * leer cuando cambia desde fuera (una muestra del mismo popover).
 */
function Personalizado(p: { color: string; onAplicar: (c: string) => void; onFijar: (c: string) => void }): React.JSX.Element {
  const [base, setBase] = useState(p.color)
  const [tl, setTl] = useState(() => tonoYLuzDe(p.color))
  const [hex, setHex] = useState(() => p.color.toLowerCase())
  if (base !== p.color) {
    setBase(p.color)
    setTl(tonoYLuzDe(p.color))
    setHex(p.color.toLowerCase())
  }
  const actual = leerHex(hex)
  const mover = (cambio: Partial<typeof tl>): void => {
    const nuevo = { ...tl, ...cambio }
    setTl(nuevo)
    setHex(colorDeTonoYLuz(nuevo))
  }
  return (
    <div className="selector-color-personalizado">
      <input
        type="range"
        className="selector-color-tono"
        aria-label="Tono"
        min={0}
        max={359}
        value={tl.tono}
        onChange={(e) => mover({ tono: Number(e.target.value) })}
      />
      <input
        type="range"
        className="selector-color-luz"
        aria-label="Luz"
        min={0}
        max={100}
        value={Math.round(tl.luz * 100)}
        style={{ ['--tono' as string]: String(tl.tono) }}
        onChange={(e) => mover({ luz: Number(e.target.value) / 100 })}
      />
      <div className="selector-color-fila">
        <span className="selector-color-vista" style={{ background: actual ? tintaPerfil(actual) : 'transparent' }} aria-hidden="true" />
        <input
          className="selector-color-hex"
          aria-label="Color en hexadecimal"
          spellCheck={false}
          value={hex}
          onChange={(e) => {
            setHex(e.target.value)
            const leido = leerHex(e.target.value)
            if (leido) setTl(tonoYLuzDe(leido))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && actual) p.onAplicar(actual)
          }}
        />
        <button type="button" className="btn btn-ghost" disabled={!actual} onClick={() => actual && p.onFijar(actual)}>
          Fijar
        </button>
        <button type="button" className="btn primary" disabled={!actual} onClick={() => actual && p.onAplicar(actual)}>
          Aplicar
        </button>
      </div>
    </div>
  )
}

/** El cuerpo del selector: base, fijados y personalizado. Fijar se guarda con los ajustes. */
export function PaletaColorPerfil({ color, onElegir }: { color: string; onElegir: (c: string) => void }): React.JSX.Element {
  const fijados = useStorePestanas((s) => s.coloresFijados)
  const guardar = (lista: string[]): void => useStorePestanas.setState({ coloresFijados: lista })
  const esElegido = (c: string): boolean => c.toLowerCase() === color.toLowerCase()
  return (
    <div className="selector-color-cuerpo">
      <div className="selector-color-rotulo">Colores</div>
      <div className="selector-color-rejilla">
        {PALETTE_PERFILES.map((c) => (
          <Muestra key={c} color={c} elegida={esElegido(c)} onElegir={() => onElegir(c)} />
        ))}
      </div>
      <div className="selector-color-rotulo">Fijados</div>
      {fijados.length > 0 ? (
        <div className="selector-color-rejilla">
          {fijados.map((c) => (
            <Muestra key={c} color={c} elegida={esElegido(c)} onElegir={() => onElegir(c)} onQuitar={() => guardar(quitarFijado(fijados, c))} />
          ))}
        </div>
      ) : (
        <div className="selector-color-vacio">Fija un color personalizado para volver a usarlo.</div>
      )}
      <div className="selector-color-rotulo">Personalizado</div>
      <Personalizado
        color={color}
        onAplicar={onElegir}
        onFijar={(c) => {
          guardar(fijarColor(fijados, c, MAX_COLORES_FIJADOS))
          onElegir(c)
        }}
      />
    </div>
  )
}

/**
 * El popover bajo la pestaña del perfil. Elegir aplica en el acto (la pestaña se tiñe ya); Esc
 * deshace lo elegido desde que se abrió y cierra; un clic fuera cierra conservándolo.
 */
export function SelectorColorPerfil(p: {
  profile: Profile
  x: number
  y: number
  onElegir: (profileId: string, color: string) => void
  onCerrar: () => void
}): React.JSX.Element {
  const { profile, onElegir, onCerrar } = p
  const original = useRef(profile.color)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (profile.color !== original.current) onElegir(profile.id, original.current)
      onCerrar()
    }
    const alPulsarFuera = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCerrar()
    }
    window.addEventListener('keydown', alTeclear, true)
    window.addEventListener('mousedown', alPulsarFuera)
    return () => {
      window.removeEventListener('keydown', alTeclear, true)
      window.removeEventListener('mousedown', alPulsarFuera)
    }
  }, [profile.id, profile.color, onElegir, onCerrar])
  return (
    <div ref={ref} className="selector-color" role="dialog" aria-label={`Color de ${profile.nombre}`} style={{ left: p.x, top: p.y }}>
      <div className="selector-color-titulo">Color de «{profile.nombre}»</div>
      <PaletaColorPerfil color={profile.color} onElegir={(c) => onElegir(profile.id, c)} />
    </div>
  )
}
