// =============================================================================
// FilaArbolArchivo: LA fila de archivo de git, en sus dos modos y para sus dos
// superficies: ÁRBOL (los archivos de un commit, con carpetas y sin casillas) y
// PLANA (la vista de Cambios, con la carpeta en gris y casilla). Un solo componente
// porque comparten la interacción entera; la casilla y el chevron son slots
// opcionales. Ver docs/decisiones/git/cambios-fila-de-archivo.md.
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { PREFETCH_HOVER_MS } from './modelo/blobCache'
import { statusClass } from './modelo/statusBadge'
import { dirOf, nameOf } from './modelo/rutasArchivo'
import { rutaEnRepo } from './modelo/seccionesCambios'
import type { EstadoMarca, FilaArbol, NodoArchivo } from './modelo/arbolArchivos'
import { ANCHO_CHEVRON, ChevronArbol, IconoCarpeta } from '../../comun/iconosArbol'
import { FileTypeIcon } from '../../comun/fileIcons'
import { Casilla } from './Casilla'

const SANGRIA_BASE = 8
const SANGRIA_NIVEL = 12
/** Lo que se sangra un archivo bajo la cabecera de su repo: su casilla queda por dentro de la del repo. */
const SANGRIA_EN_REPO = ANCHO_CHEVRON + 10

export interface FilaArbolArchivoProps {
  fila: FilaArbol
  /** Estado de la casilla. `undefined` = esta superficie no tiene casillas. */
  marca?: EstadoMarca
  /** Modo LISTA PLANA (la vista de Cambios): sin sangría ni hueco de chevron, con la carpeta en gris. */
  plana?: boolean
  /** Marcada por el cursor (un clic). Solo archivos. */
  seleccionada?: boolean
  /** Su diff está abierto en el editor. Puede coexistir con `seleccionada`. */
  activa?: boolean
  onAlternarMarca?: () => void
  onSeleccionar?: () => void
  onAbrir?: () => void
  /** Solo carpetas: alterna colapso. */
  onAlternarCarpeta?: () => void
  /** Precalienta los blobs del diff (best-effort). Ver git/blobCache. */
  onPrefetch?: () => void
  onMenu?: (x: number, y: number) => void
  /**
   * ¿La fila es una PARADA DE TABULADOR propia? Con `false` no lleva ni `tabIndex` -1:
   * un -1 seguiría siendo enfocable con el ratón y pintaría dos marcadores de foco. El
   * árbol de un commit lo pasa a `false` y el foco vive en su contenedor.
   */
  enfocable?: boolean
  /** `option` cuando la fila vive dentro de un `listbox` navegable con teclado. */
  rol?: 'button' | 'option'
  /** Id estable, para que el contenedor pueda nombrarla con `aria-activedescendant`. */
  idFila?: string
  /** Sustituye el tooltip que la fila arma sola (las entradas de un archivo comprimido). */
  titulo?: string
  /**
   * Lista plana DENTRO de un repo de la lista de varios: la fila se sangra bajo el nombre del repo y
   * su carpeta en gris se cuenta desde el repo, sin esta carpeta (la del repo en la contenedora).
   */
  repo?: { prefijo: string | undefined }
}

/** La fila de archivo o carpeta de git, en modo árbol (commit) o lista plana (Cambios). */
export function FilaArbolArchivo(props: FilaArbolArchivoProps): React.JSX.Element {
  const { fila, marca, plana = false, seleccionada = false, activa = false } = props
  const { onAlternarMarca, onAbrir, onPrefetch } = props
  const { enfocable = true, rol = 'button', titulo, idFila } = props
  const { nodo, profundidad, expandida } = fila
  const esCarpeta = nodo.tipo === 'carpeta'
  const { cancelarPrefetch, programarPrefetch } = usePrefetchAlPasar()

  const activarFila = (): void => activar(props)

  return (
    <div
      className={claseFila(seleccionada, activa)}
      id={idFila}
      role={rol}
      aria-selected={rol === 'option' ? seleccionada : undefined}
      tabIndex={enfocable ? 0 : undefined}
      style={{ paddingLeft: sangria(plana, profundidad, props.repo !== undefined) }}
      onClick={activarFila}
      onDoubleClick={esCarpeta ? undefined : onAbrir}
      onMouseEnter={onPrefetch && !esCarpeta ? () => programarPrefetch(onPrefetch) : undefined}
      onMouseLeave={cancelarPrefetch}
      onKeyDown={(e) => alPulsarTecla(e, { esCarpeta, marca, activarFila }, props)}
      onContextMenu={manejadorMenu(props, esCarpeta)}
      title={titulo ?? tooltip(fila)}
    >
      {casillaDeFila(nodo, marca, onAlternarMarca)}
      {huecoDeChevron(nodo, plana, expandida)}
      {esCarpeta ? <IconoCarpeta abierto={expandida} /> : <FileTypeIcon name={nodo.nombre} />}
      {etiquetaDeNodo(nodo)}
      {plana && carpetaEnGris(nodo, props.repo)}
      {nodo.tipo === 'carpeta' && <span className="git-arbol-conteo">{nodo.archivos}</span>}
    </div>
  )
}

// Seleccionar TAMBIÉN precalienta, sin esperar: el doble clic viene justo detrás.
function activar(props: FilaArbolArchivoProps): void {
  if (props.fila.nodo.tipo === 'carpeta') {
    props.onAlternarCarpeta?.()
    return
  }
  props.onSeleccionar?.()
  props.onPrefetch?.()
}

function claseFila(seleccionada: boolean, activa: boolean): string {
  return `git-arbol-fila${seleccionada ? ' selected' : ''}${activa ? ' active' : ''}`
}

function sangria(plana: boolean, profundidad: number, enRepo: boolean): number {
  const base = plana ? SANGRIA_BASE : SANGRIA_BASE + profundidad * SANGRIA_NIVEL
  return enRepo ? base + SANGRIA_EN_REPO : base
}

// Clic derecho = seleccionar (solo archivos) + menú.
function manejadorMenu(
  props: FilaArbolArchivoProps,
  esCarpeta: boolean
): ((e: React.MouseEvent) => void) | undefined {
  const { onMenu, onSeleccionar } = props
  if (!onMenu) return undefined
  return (e) => {
    e.preventDefault()
    if (!esCarpeta) onSeleccionar?.()
    onMenu(e.clientX, e.clientY)
  }
}

function casillaDeFila(
  nodo: NodoArchivo,
  marca: EstadoMarca | undefined,
  onAlternarMarca: (() => void) | undefined
): React.JSX.Element | null {
  if (marca === undefined || !onAlternarMarca) return null
  const nombre = nodo.tipo === 'carpeta' ? nodo.segmentos.join('/') : nodo.nombre
  return <Casilla estado={marca} etiqueta={`Marcar ${nombre}`} onAlternar={onAlternarMarca} />
}

// La carpeta del archivo, en gris y detrás del nombre: devuelve lo que la lista plana quita del árbol.
// Dentro de un repo se cuenta desde él: la carpeta del repo ya la dice su cabecera.
function carpetaEnGris(nodo: NodoArchivo, repo: FilaArbolArchivoProps['repo']): React.JSX.Element | null {
  if (nodo.tipo !== 'archivo') return null
  const carpeta = dirOf(rutaEnRepo(nodo.ruta, repo?.prefijo))
  if (carpeta === '') return null
  return <span className="git-arbol-carpeta">{carpeta}</span>
}

// Debounce del hover: solo precalienta si el ratón se queda; salir antes lo cancela
// (barrer la lista de paso no debe disparar N lecturas de git).
function usePrefetchAlPasar(): {
  cancelarPrefetch: () => void
  programarPrefetch: (onPrefetch: () => void) => void
} {
  const hoverTimer = useRef<number | null>(null)
  const cancelarPrefetch = useCallback((): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])
  useEffect(() => cancelarPrefetch, [cancelarPrefetch])
  const programarPrefetch = (onPrefetch: () => void): void => {
    cancelarPrefetch()
    hoverTimer.current = window.setTimeout(onPrefetch, PREFETCH_HOVER_MS)
  }
  return { cancelarPrefetch, programarPrefetch }
}

// Enter abre (no hay "doble Enter"); Espacio ALTERNA LA CASILLA si la fila la tiene:
// la casilla es `tabIndex` -1 y sin esta tecla marcar un lote sería cosa del ratón.
function alPulsarTecla(
  e: React.KeyboardEvent,
  fila: { esCarpeta: boolean; marca: EstadoMarca | undefined; activarFila: () => void },
  props: FilaArbolArchivoProps
): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (fila.esCarpeta) props.onAlternarCarpeta?.()
    else props.onAbrir?.()
  } else if (e.key === ' ') {
    e.preventDefault()
    if (fila.marca !== undefined && props.onAlternarMarca) props.onAlternarMarca()
    else fila.activarFila()
  }
}

// En la lista plana no hay carpetas con las que alinearse: el hueco solo gastaría 14 px por fila.
function huecoDeChevron(
  nodo: NodoArchivo,
  plana: boolean,
  expandida: boolean
): React.JSX.Element | null {
  if (nodo.tipo === 'carpeta') return <ChevronArbol abierto={expandida} />
  if (plana) return null
  return (
    <span
      className="git-arbol-hueco"
      style={{ flex: `0 0 ${ANCHO_CHEVRON}px` }}
      aria-hidden="true"
    />
  )
}

function etiquetaDeNodo(nodo: NodoArchivo): React.JSX.Element {
  if (nodo.tipo === 'carpeta') {
    return (
      <span className="git-arbol-etiqueta">
        {nodo.segmentos.length > 1 && (
          <span className="tree-compact-prefix">{nodo.segmentos.slice(0, -1).join('/')}/</span>
        )}
        {nodo.segmentos[nodo.segmentos.length - 1]}
      </span>
    )
  }
  const { entrada } = nodo
  // "viejo → nuevo" solo cuando los dos están en la MISMA carpeta (un cambio de nombre a secas).
  const renameEnSitio =
    entrada.oldPath != null &&
    entrada.letra === 'R' &&
    dirOf(entrada.oldPath) === dirOf(entrada.path)
  return (
    <span className={`git-arbol-etiqueta ${statusClass(entrada.letra)}`}>
      {renameEnSitio ? (
        <>
          {nameOf(entrada.oldPath as string)}
          <span className="git-arbol-flecha">→</span>
          {nodo.nombre}
        </>
      ) : (
        nodo.nombre
      )}
    </span>
  )
}

/** Tooltip de la fila: la ruta completa y, en archivos, la letra y qué hace el doble clic. */
function tooltip(fila: FilaArbol): string {
  const { nodo } = fila
  if (nodo.tipo === 'carpeta') {
    return `${nodo.ruta}\n${nodo.archivos} ${nodo.archivos === 1 ? 'archivo' : 'archivos'}`
  }
  const { entrada } = nodo
  const cabecera =
    entrada.oldPath != null && entrada.letra === 'R'
      ? `${entrada.oldPath} → ${entrada.path}`
      : entrada.path
  const estado = entrada.letra === '' ? '' : `\n${descripcion(entrada.letra)}`
  return `${cabecera}${estado}\nDoble clic para ver las diferencias`
}

/** Lo que significa cada letra de git, para el tooltip (la fila no la pinta). */
function descripcion(letra: string): string {
  switch (letra) {
    case 'A':
      return 'Añadido'
    case 'M':
      return 'Modificado'
    case 'D':
      return 'Eliminado'
    case 'R':
      return 'Renombrado'
    case 'C':
      return 'Copiado'
    case 'U':
      return 'En conflicto'
    case 'T':
      return 'Cambió de tipo'
    default:
      return letra
  }
}
