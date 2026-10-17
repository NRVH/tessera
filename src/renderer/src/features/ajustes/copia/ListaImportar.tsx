// =============================================================================
// La vista previa de importar como lista de casillas: cada perfil con lo suyo debajo (su casilla
// queda a medias si va a medias), los agentes nativos y los ajustes aparte, lo que ya está en el
// equipo sin casilla, y una casilla de «Todo» que marca o desmarca todo de una vez. Sin estado propio: el árbol y la selección los lleva el modal, y la lógica
// (dependencias incluidas) vive en `shared/seleccionCopia.ts`.
// =============================================================================
import { useEffect, useId, useRef } from 'react'
import { estadoPerfil, recuentoSeleccion, type ArbolImportar, type AvisoSeleccion, type ElementoImportar } from '../../../../../shared/seleccionCopia'
import { txCopia } from './textosCopia.ts'

interface PropsLista {
  arbol: ArbolImportar
  seleccion: ReadonlySet<string>
  avisos: readonly AvisoSeleccion[]
  onAlternar: (clave: string) => void
  onMarcarTodo: (todo: boolean) => void
}

function CasillaTriple(p: { etiqueta: string; detalle: string | null; marcada: boolean; aMedias?: boolean; onCambio: () => void }): React.JSX.Element {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const aMedias = p.aMedias === true
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = aMedias
  }, [aMedias])
  return (
    <div className="copia-casilla">
      <input ref={ref} id={id} type="checkbox" checked={p.marcada} onChange={p.onCambio} />
      <label htmlFor={id}>{p.etiqueta}</label>
      {p.detalle && <span className="copia-detalle-fila">{p.detalle}</span>}
    </div>
  )
}

function YaEsta({ etiqueta }: { etiqueta: string }): React.JSX.Element {
  return (
    <div className="copia-casilla copia-ya">
      <span className="copia-hueco-casilla" aria-hidden="true" />
      <span>{etiqueta}</span>
      <span className="copia-ya-existe">{txCopia().importar.yaEsta}</span>
    </div>
  )
}

function etiquetaDe(e: ElementoImportar): string {
  const t = txCopia().importar
  if (e.tipo === 'ajustes') return t.ajustes
  if (e.tipo === 'perfil') return e.nombre
  return `${t.tipo[e.tipo]} · ${e.nombre}`
}

function Fila({ e, v }: { e: ElementoImportar; v: PropsLista }): React.JSX.Element {
  if (e.yaEsta) return <YaEsta etiqueta={etiquetaDe(e)} />
  return <CasillaTriple etiqueta={etiquetaDe(e)} detalle={e.detalle} marcada={v.seleccion.has(e.clave)} onCambio={() => v.onAlternar(e.clave)} />
}

function GrupoPerfil({ g, v }: { g: ArbolImportar['perfiles'][number]; v: PropsLista }): React.JSX.Element {
  const t = txCopia().importar
  const estado = estadoPerfil(v.arbol, v.seleccion, g.perfil.id)
  return (
    <div className="copia-grupo">
      {estado === 'yaEsta' ? (
        <YaEsta etiqueta={g.perfil.nombre} />
      ) : (
        <CasillaTriple
          etiqueta={g.perfil.nombre}
          detalle={g.perfil.yaEsta ? t.perfilExiste : t.perfilNuevo}
          marcada={estado === 'marcado'}
          aMedias={estado === 'medias'}
          onCambio={() => v.onAlternar(g.perfil.clave)}
        />
      )}
      {g.hijos.length > 0 && (
        <div className="copia-hijos">
          {g.hijos.map((h) => (
            <Fila key={h.clave} e={h} v={v} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * «Todo», encabezando la lista: marcada con todo, a medias con parte y vacía sin nada, como las de
 * cada perfil. Pulsarla marca todo salvo que ya lo esté. Sin nada que traer no se pinta.
 */
function CasillaTodo({ v }: { v: PropsLista }): React.JSX.Element | null {
  const t = txCopia().importar
  const r = recuentoSeleccion(v.arbol, v.seleccion)
  if (r.estado === 'nada') return null
  return (
    <div className="copia-todo">
      <CasillaTriple
        etiqueta={t.todo}
        detalle={t.recuento(r.marcadas, r.total)}
        marcada={r.estado === 'marcado'}
        aMedias={r.estado === 'medias'}
        onCambio={() => v.onMarcarTodo(r.estado !== 'marcado')}
      />
    </div>
  )
}

export function ListaImportar(v: PropsLista): React.JSX.Element {
  const t = txCopia().importar
  return (
    <>
      <fieldset className="copia-lista">
        <legend className="dbc-etiqueta">{t.queImportar}</legend>
        <p className="dbc-ayuda">{t.previaAyuda}</p>
        <CasillaTodo v={v} />
        {v.arbol.perfiles.map((g) => (
          <GrupoPerfil key={g.perfil.clave} g={g} v={v} />
        ))}
        {v.arbol.nativos.length > 0 && (
          <div className="copia-grupo">
            <span className="dbc-ayuda">{t.nativos}</span>
            <div className="copia-hijos">
              {v.arbol.nativos.map((n) => (
                <Fila key={n.clave} e={n} v={v} />
              ))}
            </div>
          </div>
        )}
        {v.arbol.ajustes && <Fila e={v.arbol.ajustes} v={v} />}
      </fieldset>
      {v.avisos.length > 0 && (
        <ul className="copia-detalle" role="status">
          {v.avisos.map((a, i) => (
            <li key={i}>{a.tipo === 'marcada' ? t.marcadaTambien(a.nombre, a.por) : t.desmarcadaTambien(a.nombre, a.por)}</li>
          ))}
        </ul>
      )}
    </>
  )
}
