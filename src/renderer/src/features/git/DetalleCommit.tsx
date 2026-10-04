// =============================================================================
// DetalleCommit: la tercera columna del panel Git·Log. Arriba, los archivos que tocó el
// commit; abajo, su ficha (asunto, cuerpo, hash copiable, autor, fecha y ramas).
// El chip de hash no copia por su cuenta: la acción y el acuse viven en `GitLogPanel`,
// que los comparte con la fila y con Ctrl+C. `commitDetail` y `branchesContaining` van en
// peticiones separadas: la segunda recorre las refs y puede tardar. Un divisor reparte el
// alto entre archivos y ficha.
// Decisiones: docs/decisiones/git/log-columnas-y-filas.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArchivosDelCommit } from './ArchivosDelCommit'
import { Splitter } from '../../comun/Splitter'
import { EstadoVacio } from '../../comun/EstadoVacio'
import { IconoCopiar, IconoEtiqueta, IconoSinSeleccion } from './iconos'
import { absoluteDate, hashCorto, relativeDate } from './modelo/formatoFecha'
import type { Commit, CommitDetail, FileChange } from '../../../../shared/git-ipc'
import type { FilaArbol } from './modelo/arbolArchivos'
import { etiquetaModPrincipal } from '../../util/atajos'

/** Cuántas ramas se enseñan antes de plegar el resto tras un «Mostrar todas». */
const RAMAS_VISIBLES = 4

/** Lo mínimo que se le deja a la ficha del commit: asunto + una línea de cuerpo. */
const MIN_FICHA = 72

/**
 * Espacio de la columna que pueden repartirse la lista y la ficha: el alto total menos lo
 * que no es negociable. Se mide porque la cabecera crece con el tamaño de letra.
 */
function altoRepartible(col: HTMLElement): number {
  let fijo = 0
  for (const hijo of Array.from(col.children)) {
    if (hijo.classList.contains('git-detalle-archivos')) continue
    if (hijo.classList.contains('git-detalle-meta')) continue
    fijo += (hijo as HTMLElement).offsetHeight
  }
  return Math.max(0, col.clientHeight - fijo)
}

interface Reparto {
  colRef: (node: HTMLDivElement | null) => void
  maxArchivos: number
  altoListaEfectivo: number
}

/** Alto VIVO de la columna, para acotar el divisor cuando la franja se redimensiona. */
function useRepartoDetalle(altoArchivos: number, minArchivos: number): Reparto {
  const observerRef = useRef<ResizeObserver | null>(null)
  const [altoCol, setAltoCol] = useState(0)
  // Ref de CALLBACK y no `useRef` + efecto de montaje: el div se desmonta y se vuelve a
  // montar al seleccionar el primer commit, y un efecto de montaje no volvería a correr.
  const colRef = useCallback((node: HTMLDivElement | null): void => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const ro = new ResizeObserver(() => setAltoCol(altoRepartible(node)))
    ro.observe(node)
    observerRef.current = ro
    setAltoCol(altoRepartible(node))
  }, [])
  useEffect(() => () => observerRef.current?.disconnect(), [])
  // Sin medida se deja pasar el valor guardado: acotarlo contra 0 lo aplastaría al mínimo.
  const maxArchivos =
    altoCol > 0 ? Math.max(minArchivos, altoCol - MIN_FICHA) : Math.max(minArchivos, altoArchivos)
  // Se pinta acotado aunque el persistido sea mayor: al encoger la franja puede no caber.
  const altoListaEfectivo = Math.min(Math.max(altoArchivos, minArchivos), maxArchivos)
  return { colRef, maxArchivos, altoListaEfectivo }
}

interface DatosDetalle {
  detalle: CommitDetail | null
  ramas: string[] | null
  ramasError: boolean
  todasLasRamas: boolean
  setTodasLasRamas: (valor: boolean) => void
}

/** Detalle y ramas del commit; un contador por petición descarta las respuestas viejas. */
function useDatosDetalle(hash: string | null, repoHostPath: string | null, anclado: boolean): DatosDetalle {
  const [detalle, setDetalle] = useState<CommitDetail | null>(null)
  const [ramas, setRamas] = useState<string[] | null>(null)
  const [ramasError, setRamasError] = useState(false)
  const [todasLasRamas, setTodasLasRamas] = useState(false)
  const detalleRef = useRef(0)
  const ramasRef = useRef(0)

  useEffect(() => {
    const id = ++detalleRef.current
    setDetalle(null)
    if (hash === null) return
    // Sin anclaje la respuesta sería un vacío de rechazo.
    if (!anclado) return
    window.tessera.git
      .commitDetail(hash, repoHostPath ?? undefined)
      .then((d) => {
        if (detalleRef.current === id) setDetalle(d)
      })
      .catch(() => {
        // Sin detalle se pinta lo que ya trae el Commit de la lista: degradar, no vaciar.
        if (detalleRef.current === id) setDetalle(null)
      })
  }, [hash, repoHostPath, anclado])

  useEffect(() => {
    const id = ++ramasRef.current
    setRamas(null)
    setRamasError(false)
    setTodasLasRamas(false)
    if (hash === null) return
    if (!anclado) return
    window.tessera.git
      .branchesContaining(hash, repoHostPath ?? undefined)
      .then((r) => {
        if (ramasRef.current === id) setRamas(r)
      })
      .catch(() => {
        if (ramasRef.current === id) setRamasError(true)
      })
  }, [hash, repoHostPath, anclado])
  return { detalle, ramas, ramasError, todasLasRamas, setTodasLasRamas }
}

/** El detalle enriquece lo del Commit de la lista, pero nunca es requisito para pintar. */
function datosFicha(commit: Commit, detalle: CommitDetail | null): {
  asunto: string
  autor: string
  email: string
  iso: string
  cuerpo: string
  otroCommitter: string | null
} {
  // Committer distinto del autor = rebase, cherry-pick o merge de PR: explica la fecha.
  const otroCommitter =
    detalle && detalle.committerName !== '' && detalle.committerName !== detalle.authorName
      ? detalle.committerName
      : null
  return {
    asunto: detalle?.subject ?? commit.subject,
    autor: detalle?.authorName ?? commit.authorName,
    email: detalle?.authorEmail ?? commit.authorEmail,
    iso: detalle?.isoDate ?? commit.isoDate,
    cuerpo: detalle?.body ?? '',
    otroCommitter
  }
}

/** Mensaje mientras no hay ramas que listar: error, buscando o ninguna. */
function MensajeRamas(p: { ramas: string[] | null; ramasError: boolean }): React.JSX.Element | null {
  if (p.ramasError) return <span className="git-detalle-fecha">No se pudieron leer las ramas.</span>
  if (p.ramas === null) return <span className="git-detalle-fecha">Buscando en qué ramas está…</span>
  if (p.ramas.length === 0) return <span className="git-detalle-fecha">En ninguna rama.</span>
  return null
}

function ListaRamas({ ramas, datos }: { ramas: string[]; datos: DatosDetalle }): React.JSX.Element {
  const { todasLasRamas, setTodasLasRamas } = datos
  const ramasAMostrar = todasLasRamas ? ramas : ramas.slice(0, RAMAS_VISIBLES)
  const ocultas = Math.max(0, ramas.length - ramasAMostrar.length)
  return (
    <>
      <span>
        En {ramas.length} rama{ramas.length === 1 ? '' : 's'}:
      </span>
      {ramasAMostrar.map((r) => (
        <span key={r} className="ref-chip ref-chip-local" title={r}>
          <IconoEtiqueta />
          <span className="ref-chip-nombre">{r}</span>
        </span>
      ))}
      {ocultas > 0 && (
        <button className="git-detalle-mas" onClick={() => setTodasLasRamas(true)}>
          Mostrar {ocultas} más
        </button>
      )}
      {todasLasRamas && ramas.length > RAMAS_VISIBLES && (
        <button className="git-detalle-mas" onClick={() => setTodasLasRamas(false)}>
          Mostrar menos
        </button>
      )}
    </>
  )
}

function RamasDelCommit({ datos }: { datos: DatosDetalle }): React.JSX.Element {
  const { ramas, ramasError } = datos
  return (
    <div className="git-detalle-ramas">
      <MensajeRamas ramas={ramas} ramasError={ramasError} />
      {!ramasError && ramas !== null && ramas.length > 0 && <ListaRamas ramas={ramas} datos={datos} />}
    </div>
  )
}

function FichaCommit(p: {
  commit: Commit
  datos: DatosDetalle
  copiado: boolean
  onCopiarHash: () => void
}): React.JSX.Element {
  const { commit, datos, copiado, onCopiarHash } = p
  const { asunto, autor, email, iso, cuerpo, otroCommitter } = datosFicha(commit, datos.detalle)
  return (
    <div className="git-detalle-meta">
      <div className="git-detalle-asunto">{asunto}</div>
      {cuerpo !== '' && <div className="git-detalle-cuerpo">{cuerpo}</div>}
      <div className="git-detalle-fila">
        <button
          type="button"
          className={`git-hash-chip${copiado ? ' copiado' : ''}`}
          // El atajo se enseña aquí, en el tooltip del comando equivalente, sin gastar píxeles.
          title={copiado ? 'Copiado' : `Copiar el hash completo · ${etiquetaModPrincipal()}+C en la lista`}
          onClick={onCopiarHash}
        >
          <span>{hashCorto(commit.hash, 10)}</span>
          <IconoCopiar copiado={copiado} />
        </button>
        <span className="git-detalle-autor" title={autor}>
          {autor}
        </span>
        {email !== '' && <span className="git-detalle-email">&lt;{email}&gt;</span>}
      </div>
      <div className="git-detalle-fila">
        <span className="git-detalle-fecha">
          {absoluteDate(iso)} · {relativeDate(iso)}
        </span>
      </div>
      {otroCommitter && (
        <div className="git-detalle-fila">
          <span className="git-detalle-fecha">
            Aplicado por {otroCommitter}
            {datos.detalle?.committerIsoDate ? ` · ${absoluteDate(datos.detalle.committerIsoDate)}` : ''}
          </span>
        </div>
      )}
      <RamasDelCommit datos={datos} />
    </div>
  )
}

interface PropsDetalleCommit {
  /** Commit seleccionado en el log, o null si no hay ninguno. */
  commit: Commit | null
  /** Repo del commit: viaja con cada petición, o una respuesta tardía preguntaría en OTRO repo. */
  repoHostPath: string | null
  /** ¿El backend está anclado a `repoHostPath`? Sin anclaje se leería un vacío de rechazo. */
  anclado: boolean
  /** Alto de fila en px (theme/densidad; el mismo que ve el CSS). */
  altoFila: number
  /** Alto de la lista de archivos; lo que sobra es para la ficha del commit. */
  altoArchivos: number
  minArchivos: number
  onAltoArchivos: (px: number) => void
  rutaSeleccionada: string | null
  onSeleccionarArchivo: (path: string) => void
  onAbrirDiff: (commit: Commit, change: FileChange) => void
  /** Paso a `ArchivosDelCommit`; esta columna no los usa, solo los transporta. */
  onFilasArchivos?: (
    hash: string,
    filas: readonly FilaArbol[],
    cambioPorRuta: ReadonlyMap<string, FileChange>
  ) => void
  revelarArchivo?: { indice: number; token: number } | null
  onKeyDownArchivos?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  alternarCarpetaRef?: { current: ((ruta: string) => void) | null }
  /** ¿El hash de ESTE commit acaba de copiarse? Lo manda el panel, dueño del acuse. */
  copiado: boolean
  /** Copia el hash completo. La acción vive en el panel. */
  onCopiarHash: () => void
}

export function DetalleCommit(p: PropsDetalleCommit): React.JSX.Element {
  const { commit, repoHostPath, anclado } = p
  const reparto = useRepartoDetalle(p.altoArchivos, p.minArchivos)
  const datos = useDatosDetalle(commit?.hash ?? null, repoHostPath, anclado)
  // Los dos returns comparten tipo de raíz: el div se reutiliza al elegir el primer commit.
  if (!commit) {
    return (
      <div className="git-log-col git-log-detalle">
        <div className="git-log-col-header">Detalle</div>
        <EstadoVacio
          icono={<IconoSinSeleccion />}
          titulo="Ningún commit seleccionado"
          pista="Elige uno del historial para ver su mensaje, su autor y los archivos que tocó."
        />
      </div>
    )
  }
  return (
    <div className="git-log-col git-log-detalle" ref={reparto.colRef}>
      <div className="git-log-col-header">Detalle</div>
      <ArchivosDelCommit
        commit={commit}
        repoHostPath={repoHostPath}
        anclado={anclado}
        altoFila={p.altoFila}
        altoArchivos={reparto.altoListaEfectivo}
        rutaSeleccionada={p.rutaSeleccionada}
        onSeleccionar={p.onSeleccionarArchivo}
        onAbrirDiff={p.onAbrirDiff}
        onFilas={p.onFilasArchivos}
        revelar={p.revelarArchivo}
        onKeyDown={p.onKeyDownArchivos}
        alternarRef={p.alternarCarpetaRef}
      />
      {/* Arrastrar hacia ABAJO agranda la lista. El techo se calcula con el alto vivo. */}
      <Splitter
        orientation="horizontal"
        size={reparto.altoListaEfectivo}
        min={p.minArchivos}
        max={reparto.maxArchivos}
        direction={1}
        onResize={p.onAltoArchivos}
        label="Reparto entre los archivos y el mensaje del commit"
      />
      <FichaCommit commit={commit} datos={datos} copiado={p.copiado} onCopiarHash={p.onCopiarHash} />
    </div>
  )
}
