// =============================================================================
// La vista previa de importar como lista de casillas: cada perfil con su destino (uno nuevo o uno de
// este equipo) y lo suyo debajo (su casilla queda a medias si va a medias), las reglas del perfil frente
// a las del destino (traerlas, iguales, o mantener o sustituir con su diff), su configuración de Docker
// (distinta de la de aquí, sin marcar de serie), los archivos de sus cuentas de Docker, los agentes nativos con sus
// reglas, el historial nativo, la configuración global de Docker y los ajustes aparte, lo que ya está en el equipo sin casilla, y una casilla de «Todo»
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
import type { ArchivoPedido, ResultadoDiffArchivo } from '../../../../../shared/copia-configuracion-ipc'
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
  /** Los archivos de agentes distintos que se sustituyen, por clave del elemento. */
  sustituirArchivos: ReadonlySet<string>
  /** El archivo abierto en el main: de ahí salen las dos versiones del diff de un archivo de agente. */
  token: string
  onAlternar: (clave: string) => void
  onMarcarTodo: (todo: boolean) => void
  onDestino: (perfil: string, destino: string | null) => void
  onSustituir: (perfil: string, sustituir: boolean) => void
  onSustituirArchivo: (clave: string, sustituir: boolean) => void
}

function CasillaTriple(p: { etiqueta: string; detalle: string | null; marcada: boolean; aMedias?: boolean; mono?: boolean; onCambio: () => void }): React.JSX.Element {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const aMedias = p.aMedias === true
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = aMedias
  }, [aMedias])
  return (
    <div className="copia-casilla">
      <input ref={ref} id={id} type="checkbox" checked={p.marcada} onChange={p.onCambio} />
      <label htmlFor={id} className={p.mono ? 'copia-mono' : undefined}>{p.etiqueta}</label>
      {p.detalle && <span className="copia-detalle-fila">{p.detalle}</span>}
    </div>
  )
}

function YaEsta({ etiqueta, pildora, mono }: { etiqueta: string; pildora?: string; mono?: boolean }): React.JSX.Element {
  return (
    <div className="copia-casilla copia-ya">
      <span className="copia-hueco-casilla" aria-hidden="true" />
      <span className={mono ? 'copia-mono' : undefined}>{etiqueta}</span>
      <span className="copia-ya-existe">{pildora ?? txCopia().importar.yaEsta}</span>
    </div>
  )
}

function etiquetaDe(e: ElementoImportar): string {
  const t = txCopia().importar
  if (e.tipo === 'ajustes') return t.ajustes
  if (e.tipo === 'configDocker') return t.configDocker
  if (e.tipo === 'configGlobal') return t.configGlobal
  if (e.tipo === 'perfil') return e.nombre
  if (e.tipo === 'reglas') return t.reglas
  if (e.historial) return `${t.tipo.historial} · ${etiquetaFuente(e.historial)}`
  return `${t.tipo[e.tipo as keyof typeof t.tipo]} · ${e.nombre}`
}

function Fila({ e, v }: { e: ElementoImportar; v: PropsLista }): React.JSX.Element {
  const t = txCopia().importar
  const esConfig = e.tipo === 'configDocker' || e.tipo === 'configGlobal'
  if (e.yaEsta) return <YaEsta etiqueta={etiquetaDe(e)} pildora={esConfig ? t.configIgual : undefined} />
  const detalle = e.historial ? detalleFuente(e.historial) : e.sustituye ? (e.tipo === 'configGlobal' ? t.configSustituyeGlobal : t.configSustituye) : e.detalle
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

/** La cuenta de Docker bajo su perfil: la que no existe aquí se elige para crearla, y sin ella no se ofrecen sus archivos. */
function FilaCuenta({ e, v }: { e: ElementoImportar; v: PropsLista }): React.JSX.Element {
  const t = txCopia()
  const etiqueta = t.importar.cuentaAgente(t.agentes[e.cuenta!.agente], e.cuenta!.predeterminada ? t.predeterminada : e.nombre)
  if (e.yaEsta) return <YaEsta etiqueta={etiqueta} />
  return <CasillaTriple etiqueta={etiqueta} detalle={t.importar.cuentaNueva} marcada={v.seleccion.has(e.clave)} onCambio={() => v.onAlternar(e.clave)} />
}

function pedidoDe(e: ElementoImportar, g: GrupoImportar | null): ArchivoPedido {
  const a = e.archivo!
  return a.cuenta === null ? { origen: 'nativo', agente: a.agente } : { origen: 'cuenta', perfilAqui: g?.destino ?? '', perfil: g?.perfil.id ?? '', cuenta: a.cuenta, tipo: a.tipo }
}

/** Un archivo distinto: de serie se mantiene el de aquí, con su diff, que el main solo entrega al pedirlo. */
function ArchivoDistinto({ e, g, etiqueta, mono, v }: { e: ElementoImportar; g: GrupoImportar | null; etiqueta: string; mono: boolean; v: PropsLista }): React.JSX.Element {
  const t = txCopia().importar
  const [abierto, setAbierto] = useState(false)
  const [diff, setDiff] = useState<ResultadoDiffArchivo | 'cargando' | undefined>(undefined)
  const alternarDiff = (): void => {
    setAbierto((x) => !x)
    if (diff !== undefined) return
    setDiff('cargando')
    void window.tessera.copiaConfiguracion.diffArchivo(v.token, pedidoDe(e, g)).then(setDiff, () => setDiff(null))
  }
  const nativas = e.tipo === 'reglaNativa'
  return (
    <div className="copia-reglas">
      <div className="copia-casilla">
        <span className="copia-hueco-casilla" aria-hidden="true" />
        <span className={mono ? 'copia-mono' : undefined}>{etiqueta}</span>
        <select
          className="copia-eleccion"
          aria-label={nativas ? t.reglasNativaDe(etiqueta) : t.eleccionArchivoDe(e.archivo!.nombre)}
          value={v.sustituirArchivos.has(e.clave) ? 'sustituir' : 'mantener'}
          onChange={(ev) => v.onSustituirArchivo(e.clave, ev.target.value === 'sustituir')}
        >
          <option value="mantener">{nativas ? t.mantenerReglas : t.mantenerArchivo}</option>
          <option value="sustituir">{nativas ? t.sustituirReglas : t.sustituirArchivo}</option>
        </select>
        <button type="button" className="btn btn-ghost copia-ver-diff" aria-expanded={abierto} onClick={alternarDiff}>
          {abierto ? t.ocultarDiferencias : t.verDiferencias}
        </button>
      </div>
      {abierto && (
        <div className="copia-reglas-diff">
          {diff === 'cargando' && <p className="dbc-ayuda">{t.diferenciasCargando}</p>}
          {(diff === null || diff === undefined) && <p className="dbc-ayuda">{t.diferenciasNoDisponibles}</p>}
          {diff && diff !== 'cargando' && (
            <>
              <p className="dbc-ayuda">{t.diferenciasArchivoAyuda}</p>
              <DiffReglas original={diff.aqui} modificado={diff.archivo} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Un archivo de agente frente al de aquí: falta, casilla; igual, píldora; distinto, mantener o sustituir. */
function FilaArchivo({ e, g, v }: { e: ElementoImportar; g: GrupoImportar | null; v: PropsLista }): React.JSX.Element {
  const t = txCopia()
  const a = e.archivo!
  const nativas = e.tipo === 'reglaNativa'
  const etiqueta = nativas ? t.importar.reglasNativas(t.agentes[a.agente]) : a.nombre
  const mono = !nativas
  if (a.estado === 'igual') return <YaEsta etiqueta={etiqueta} pildora={t.importar.archivoIgual} mono={mono} />
  if (a.estado === 'bloqueado') return <YaEsta etiqueta={etiqueta} pildora={t.importar.archivoBloqueado} mono={mono} />
  if (a.estado === 'distinto') return <ArchivoDistinto e={e} g={g} etiqueta={etiqueta} mono={mono} v={v} />
  const detalle = nativas ? t.importar.reglasNativaTraer : e.requiere.length > 0 ? t.importar.cuentaNueva : t.importar.archivoTraer
  return <CasillaTriple etiqueta={etiqueta} detalle={detalle} marcada={v.seleccion.has(e.clave)} mono={mono} onCambio={() => v.onAlternar(e.clave)} />
}

/** Un grupo aparte de la lista, sin perfil: los agentes nativos, con sus reglas, o el historial nativo. */
function Aparte({ titulo, lista, v }: { titulo: string; lista: readonly ElementoImportar[]; v: PropsLista }): React.JSX.Element | null {
  if (lista.length === 0) return null
  return (
    <div className="copia-grupo">
      <span className="dbc-ayuda">{titulo}</span>
      <div className="copia-hijos">
        {lista.map((n) => (n.archivo ? <FilaArchivo key={n.clave} e={n} g={null} v={v} /> : <Fila key={n.clave} e={n} v={v} />))}
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
          {g.hijos.map((h) => (
            <HijoPerfil key={`${h.clave}|${g.destino ?? ''}`} h={h} g={g} v={v} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Cada cosa de un perfil en su fila; los archivos de una cuenta que no se va a crear no se ofrecen. */
function HijoPerfil({ h, g, v }: { h: ElementoImportar; g: GrupoImportar; v: PropsLista }): React.JSX.Element | null {
  if (h.tipo === 'reglas') return <FilaReglas e={h} g={g} v={v} />
  if (h.tipo === 'cuentaAgente') return <FilaCuenta e={h} v={v} />
  if (h.tipo === 'archivoCuenta') {
    if (h.requiere.some((r) => !v.seleccion.has(r))) return null
    return (
      <div className="copia-de-cuenta">
        <FilaArchivo e={h} g={g} v={v} />
      </div>
    )
  }
  return <Fila e={h} v={v} />
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
        <Aparte titulo={t.nativos} lista={[...v.arbol.nativos, ...v.arbol.reglasNativas]} v={v} />
        <Aparte titulo={t.historialNativo} lista={v.arbol.historialNativo} v={v} />
        {v.arbol.configGlobal && <Fila e={v.arbol.configGlobal} v={v} />}
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
