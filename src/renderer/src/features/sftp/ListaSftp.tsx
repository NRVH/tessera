// =============================================================================
// La lista de la carpeta remota del explorador SFTP: una cabecera de columnas (Nombre, Tamaño,
// Modificado, Permisos) y las filas en lista virtual, con la selección y el teclado en el contenedor
// (`aria-activedescendant`, como el árbol de conexiones SSH). También es la zona donde se sueltan
// archivos del equipo. Los nombres vienen del servidor y se pintan como texto. Presentación: lo que
// se hace con cada gesto es del explorador. Depende de `VirtualList`, de los iconos de archivo y del
// modelo de listado.
// =============================================================================

import { useId, type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { FileTypeIcon } from '../../comun/fileIcons'
import { IconoCarpeta } from '../../comun/iconosArbol'
import { VirtualList } from '../../comun/VirtualList'
import type { SftpEntrada } from '../../../../shared/sftp-ipc'
import { descripcionTipo, esNavegable, formatoFecha, formatoTamano } from './listadoSftp'
import type { SeleccionSftp } from './seleccionSftp'
import { ATRIBUTO_CARPETA_SOLTAR } from './useArrastreSftp'

export interface PropsListaSftp {
  entradas: readonly SftpEntrada[]
  seleccion: SeleccionSftp
  altoFila: number
  /** Hay un listado en marcha: la lista se atenúa pero no desaparece. */
  cargando: boolean
  /** Se está arrastrando algo del equipo por encima. */
  soltando: boolean
  /** La carpeta de la lista que recibiría lo soltado (resaltada), o `null` si va a la que se ve. */
  carpetaSoltar: string | null
  onClic: (nombre: string, e: MouseEvent) => void
  onAbrir: (entrada: SftpEntrada) => void
  /** Clic derecho: sobre una fila (su nombre) o sobre el fondo (`null`). */
  onMenu: (x: number, y: number, nombre: string | null) => void
  onTecla: (e: KeyboardEvent<HTMLDivElement>) => void
  /** El contenedor que scrollea y recibe el foco: a él vuelve el foco al cerrar el menú. */
  scrollRef: RefObject<HTMLDivElement>
  /** Clic en el fondo: deselecciona. */
  onFondo: () => void
  onArrastre: {
    entra: (e: DragEvent) => void
    sobre: (e: DragEvent) => void
    sale: (e: DragEvent) => void
    suelta: (e: DragEvent) => void
  }
}

/** El icono de una fila: carpeta, el del tipo de archivo, o el de enlace según adónde apunte. */
function IconoEntrada({ e }: { e: SftpEntrada }): React.JSX.Element {
  return esNavegable(e) ? <IconoCarpeta abierto={false} /> : <FileTypeIcon name={e.nombre} />
}

interface PropsFila {
  e: SftpEntrada
  id: string
  elegida: boolean
  activa: boolean
  conLider: boolean
  alto: number
  p: PropsListaSftp
}

function Fila({ e, id, elegida, activa, conLider, alto, p }: PropsFila): React.JSX.Element {
  const carpeta = esNavegable(e)
  return (
    <div
      id={id}
      role="option"
      aria-selected={elegida}
      aria-label={`${e.nombre}, ${descripcionTipo(e)}`}
      className={`sftp-fila${elegida ? ' seleccionada' : ''}${activa && conLider ? ' lider' : ''}${e.destinoEnlace === 'roto' ? ' roto' : ''}${carpeta && p.soltando && p.carpetaSoltar === e.nombre ? ' soltar-aqui' : ''}`}
      {...(carpeta ? { [ATRIBUTO_CARPETA_SOLTAR]: e.nombre } : {})}
      style={{ height: alto }}
      onClick={(ev) => p.onClic(e.nombre, ev)}
      onDoubleClick={() => p.onAbrir(e)}
      onContextMenu={(ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        p.onMenu(ev.clientX, ev.clientY, e.nombre)
      }}
    >
      <span className="sftp-celda sftp-celda-nombre">
        <IconoEntrada e={e} />
        <span className="sftp-nombre" title={e.nombre}>
          {e.nombre}
        </span>
        {e.tipo === 'enlace' && (
          <span className="sftp-etiqueta-enlace" title={descripcionTipo(e)}>
            enlace
          </span>
        )}
      </span>
      <span className="sftp-celda sftp-celda-tamano">{carpeta ? '' : formatoTamano(e.tamano)}</span>
      <span className="sftp-celda sftp-celda-fecha">{formatoFecha(e.modificado)}</span>
      <span className="sftp-celda sftp-celda-permisos">{e.permisos ?? '—'}</span>
    </div>
  )
}

/** La cabecera de columnas. Fuera de la lista virtual: no se va con el scroll. */
function CabeceraColumnas(): React.JSX.Element {
  return (
    <div className="sftp-cabecera" aria-hidden="true">
      <span className="sftp-celda sftp-celda-nombre">Nombre</span>
      <span className="sftp-celda sftp-celda-tamano">Tamaño</span>
      <span className="sftp-celda sftp-celda-fecha">Modificado</span>
      <span className="sftp-celda sftp-celda-permisos">Permisos</span>
    </div>
  )
}

export function ListaSftp(p: PropsListaSftp): React.JSX.Element {
  const idBase = useId()
  const { entradas, seleccion } = p
  const idDe = (i: number): string => `${idBase}-${i}`
  const indiceActivo = seleccion.activo === null ? -1 : entradas.findIndex((x) => x.nombre === seleccion.activo)
  return (
    <div
      className={`sftp-zona${p.soltando && p.carpetaSoltar === null ? ' soltando' : ''}${p.cargando ? ' cargando' : ''}`}
      onDragEnter={p.onArrastre.entra}
      onDragOver={p.onArrastre.sobre}
      onDragLeave={p.onArrastre.sale}
      onDrop={p.onArrastre.suelta}
      // El fondo (lo que no es una fila): el clic deselecciona y el derecho abre el menú de la carpeta.
      onClick={(ev) => !(ev.target as HTMLElement).closest('.sftp-fila') && p.onFondo()}
      onContextMenu={(ev) => {
        ev.preventDefault()
        p.onMenu(ev.clientX, ev.clientY, null)
      }}
    >
      <CabeceraColumnas />
      <VirtualList<SftpEntrada>
        className="sftp-lista"
        role="listbox"
        ariaLabel="Contenido de la carpeta remota"
        aria-activedescendant={indiceActivo >= 0 ? idDe(indiceActivo) : undefined}
        tabIndex={0}
        items={entradas}
        itemHeight={p.altoFila}
        getKey={(x) => x.nombre}
        scrollRef={p.scrollRef}
        scrollToIndex={indiceActivo >= 0 ? indiceActivo : null}
        onKeyDown={p.onTecla}
        renderItem={(x, i) => (
          <Fila
            e={x}
            id={idDe(i)}
            elegida={seleccion.nombres.has(x.nombre)}
            activa={x.nombre === seleccion.activo}
            conLider={seleccion.nombres.size > 1}
            alto={p.altoFila}
            p={p}
          />
        )}
      />
      {entradas.length === 0 && !p.cargando && <div className="sftp-vacia">Carpeta vacía</div>}
      {p.soltando && (
        <div className="sftp-aviso-soltar">
          {p.carpetaSoltar === null ? 'Suelta aquí para subir a esta carpeta' : `Suelta para subir a «${p.carpetaSoltar}»`}
        </div>
      )}
    </div>
  )
}
