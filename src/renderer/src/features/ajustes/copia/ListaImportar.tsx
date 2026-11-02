// =============================================================================
// La vista previa de importar como lista de casillas: cada perfil con su destino (uno nuevo o uno de
// este equipo) y lo suyo debajo (su casilla queda a medias si va a medias), las reglas del perfil frente
// a las del destino (traerlas, iguales, o mantener o sustituir con su diff), los agentes nativos, el
// historial nativo y los ajustes aparte, lo que ya está en el equipo sin casilla, y una casilla de «Todo»
// que marca o desmarca todo de una vez. Sin más estado propio que enseñar o no un diff: el árbol, la
// selección y los destinos los lleva el modal, y la lógica (dependencias incluidas) vive en
// `shared/seleccionCopia.ts` y `shared/destinoCopia.ts`.
// =============================================================================
import { useEffect, useId, useRef, useState } from 'react'
import {
  estadoPerfil,
  recuentoSeleccion,
  type ArbolImportar,
  type AvisoSeleccion,
  type ElementoImportar,
  type GrupoImportar
} from '../../../../../shared/seleccionCopia'
import { DiffReglas } from '../../pestanas'
import { detalleFuente, etiquetaFuente } from './etiquetasHistorial'
import { txCopia } from './textosCopia.ts'

interface PropsLista {
  arbol: ArbolImportar
  seleccion: ReadonlySet<string>
  avisos: readonly AvisoSeleccion[]
  /** Los perfiles de este equipo, destinos posibles, con sus reglas. */
  aqui: ReadonlyArray<{ id: string; nombre: string; reglas?: string }>
  /** Las reglas de cada perfil del archivo. */
  reglasArchivo: Readonly<Record<string, string>>
  /** Los perfiles del archivo cuyas reglas distintas se sustituyen. */
  sustituir: ReadonlySet<string>
  onAlternar: (clave: string) => void
  onMarcarTodo: (todo: boolean) => void
  onDestino: (perfil: string, destino: string | null) => void
  onSustituir: (perfil: string, sustituir: boolean) => void
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

function YaEsta({ etiqueta, pildora }: { etiqueta: string; pildora?: string }): React.JSX.Element {
  return (
    <div className="copia-casilla copia-ya">
      <span className="copia-hueco-casilla" aria-hidden="true" />
      <span>{etiqueta}</span>
      <span className="copia-ya-existe">{pildora ?? txCopia().importar.yaEsta}</span>
    </div>
  )
}

function etiquetaDe(e: ElementoImportar): string {
  const t = txCopia().importar
  if (e.tipo === 'ajustes') return t.ajustes
  if (e.tipo === 'perfil') return e.nombre
  if (e.tipo === 'reglas') return t.reglas
  if (e.historial) return `${t.tipo.historial} · ${etiquetaFuente(e.historial)}`
  return `${t.tipo[e.tipo]} · ${e.nombre}`
}

function Fila({ e, v }: { e: ElementoImportar; v: PropsLista }): React.JSX.Element {
  if (e.yaEsta) return <YaEsta etiqueta={etiquetaDe(e)} />
  const detalle = e.historial ? detalleFuente(e.historial) : e.detalle
  return <CasillaTriple etiqueta={etiquetaDe(e)} detalle={detalle} marcada={v.seleccion.has(e.clave)} onCambio={() => v.onAlternar(e.clave)} />
}

/** Las reglas del perfil frente a las del destino: traerlas es una casilla; iguales, nada; distintas, mantener o sustituir. */
function FilaReglas({ e, g, v }: { e: ElementoImportar; g: GrupoImportar; v: PropsLista }): React.JSX.Element {
  const t = txCopia().importar
  const [diff, setDiff] = useState(false)
  if (g.reglas === 'traer') {
    return <CasillaTriple etiqueta={t.reglas} detalle={t.reglasTraer} marcada={v.seleccion.has(e.clave)} onCambio={() => v.onAlternar(e.clave)} />
  }
  if (g.reglas !== 'distintas') return <YaEsta etiqueta={t.reglas} pildora={t.reglasIguales} />
  const aqui = v.aqui.find((p) => p.id === g.destino)?.reglas ?? ''
  return (
    <div className="copia-reglas">
      <div className="copia-casilla">
        <span className="copia-hueco-casilla" aria-hidden="true" />
        <span>{t.reglas}</span>
        <select
          className="copia-eleccion"
          aria-label={t.reglasDe(g.perfil.nombre)}
          value={v.sustituir.has(g.perfil.id) ? 'sustituir' : 'mantener'}
          onChange={(ev) => v.onSustituir(g.perfil.id, ev.target.value === 'sustituir')}
        >
          <option value="mantener">{t.mantenerReglas}</option>
          <option value="sustituir">{t.sustituirReglas}</option>
        </select>
        <button type="button" className="btn btn-ghost copia-ver-diff" aria-expanded={diff} onClick={() => setDiff((x) => !x)}>
          {diff ? t.ocultarDiferencias : t.verDiferencias}
        </button>
      </div>
      {diff && (
        <div className="copia-reglas-diff">
          <p className="dbc-ayuda">{t.diferenciasAyuda}</p>
          <DiffReglas original={aqui} modificado={v.reglasArchivo[g.perfil.id] ?? ''} />
        </div>
      )}
    </div>
  )
}

/** Un grupo aparte de la lista, sin perfil: los agentes nativos o el historial nativo. */
function Aparte({ titulo, lista, v }: { titulo: string; lista: readonly ElementoImportar[]; v: PropsLista }): React.JSX.Element | null {
  if (lista.length === 0) return null
  return (
    <div className="copia-grupo">
      <span className="dbc-ayuda">{titulo}</span>
      <div className="copia-hijos">
        {lista.map((n) => (
          <Fila key={n.clave} e={n} v={v} />
        ))}
      </div>
    </div>
  )
}

/** A qué perfil va el del archivo: uno nuevo o uno de este equipo. */
function SelectorDestino({ g, v }: { g: GrupoImportar; v: PropsLista }): React.JSX.Element {
  const t = txCopia().importar
  return (
    <select
      className="copia-eleccion"
      aria-label={t.destinoDe(g.perfil.nombre)}
      value={g.destino ?? ''}
      onChange={(ev) => v.onDestino(g.perfil.id, ev.target.value === '' ? null : ev.target.value)}
    >
      <option value="">{t.perfilNuevo}</option>
      {v.aqui.map((p) => (
        <option key={p.id} value={p.id}>
          {t.anadirA(p.nombre)}
        </option>
      ))}
    </select>
  )
}

function GrupoPerfil({ g, v }: { g: GrupoImportar; v: PropsLista }): React.JSX.Element {
  const estado = estadoPerfil(v.arbol, v.seleccion, g.perfil.id)
  return (
    <div className="copia-grupo">
      <div className="copia-perfil">
        {estado === 'yaEsta' ? (
          <YaEsta etiqueta={g.perfil.nombre} />
        ) : (
          <CasillaTriple
            etiqueta={g.perfil.nombre}
            detalle={null}
            marcada={estado === 'marcado'}
            aMedias={estado === 'medias'}
            onCambio={() => v.onAlternar(g.perfil.clave)}
          />
        )}
        <SelectorDestino g={g} v={v} />
      </div>
      {g.hijos.length > 0 && (
        <div className="copia-hijos">
          {g.hijos.map((h) => (h.tipo === 'reglas' ? <FilaReglas key={h.clave} e={h} g={g} v={v} /> : <Fila key={h.clave} e={h} v={v} />))}
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
        <Aparte titulo={t.nativos} lista={v.arbol.nativos} v={v} />
        <Aparte titulo={t.historialNativo} lista={v.arbol.historialNativo} v={v} />
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
