// =============================================================================
// La barra del explorador SFTP: subir un nivel y actualizar, las migas de la carpeta actual (cada
// una lleva a su ruta) y las acciones sobre la carpeta y la selección. Los botones son de icono con
// su etiqueta accesible y su tooltip (`.sidebar-icon-btn`, como las barras del explorador de
// archivos). Presentación pura: lo que hace cada uno es del explorador. Depende de los iconos de la
// feature y de las migas puras.
// =============================================================================

import { useEffect, useRef } from 'react'
import { IconoCarpetaNueva, IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { IconoActualizar, IconoDescargar, IconoSubirArchivos, IconoSubirCarpeta, IconoSubirNivel } from './iconosSftp'
import { migasDe } from './rutasSftp'

export interface PropsBarraSftp {
  ruta: string
  cargando: boolean
  /** Cuántas filas hay elegidas y cuántas de ellas se pueden descargar. */
  elegidos: number
  descargables: number
  atajoBorrar: string
  onIr: (ruta: string) => void
  onSubirNivel: () => void
  onActualizar: () => void
  onNuevaCarpeta: () => void
  onSubirArchivos: () => void
  onSubirCarpeta: () => void
  onDescargar: () => void
  onRenombrar: () => void
  onEliminar: () => void
}

interface PropsBoton {
  etiqueta: string
  titulo?: string
  deshabilitado?: boolean
  onClick: () => void
  children: React.ReactNode
}

function Boton({ etiqueta, titulo, deshabilitado, onClick, children }: PropsBoton): React.JSX.Element {
  return (
    <button type="button" className="sidebar-icon-btn" aria-label={etiqueta} title={titulo ?? etiqueta} disabled={deshabilitado} onClick={onClick}>
      {children}
    </button>
  )
}

/** Las migas, con la última (la carpeta actual) sin enlace y siempre a la vista. */
function Migas({ ruta, onIr }: { ruta: string; onIr: (ruta: string) => void }): React.JSX.Element {
  const migas = migasDe(ruta)
  const contenedor = useRef<HTMLDivElement>(null)
  // En una franja estrecha la ruta larga desborda: se deja a la vista lo último, que es lo que importa.
  useEffect(() => {
    const el = contenedor.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [ruta])
  return (
    <nav className="sftp-migas" aria-label="Ruta de la carpeta" ref={contenedor} title={ruta}>
      {migas.map((m, i) => (
        <span key={m.ruta} className="sftp-miga-grupo">
          {i > 1 && (
            <span className="sftp-miga-sep" aria-hidden="true">
              /
            </span>
          )}
          {i === migas.length - 1 ? (
            <span className="sftp-miga actual" aria-current="location">
              {m.nombre}
            </span>
          ) : (
            <button type="button" className="sftp-miga" onClick={() => onIr(m.ruta)}>
              {m.nombre}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}

export function BarraSftp(p: PropsBarraSftp): React.JSX.Element {
  const hay = p.elegidos > 0
  return (
    <div className="sftp-barra" role="toolbar" aria-label="Archivos remotos por SFTP">
      <Boton etiqueta="Subir un nivel" titulo="Subir un nivel (Retroceso)" deshabilitado={p.ruta === '/'} onClick={p.onSubirNivel}>
        <IconoSubirNivel />
      </Boton>
      <Boton etiqueta="Actualizar" titulo="Actualizar (F5)" deshabilitado={p.cargando} onClick={p.onActualizar}>
        <IconoActualizar />
      </Boton>
      <Migas ruta={p.ruta} onIr={p.onIr} />
      <Boton etiqueta="Nueva carpeta" onClick={p.onNuevaCarpeta}>
        <IconoCarpetaNueva />
      </Boton>
      <Boton etiqueta="Subir archivos…" onClick={p.onSubirArchivos}>
        <IconoSubirArchivos />
      </Boton>
      <Boton etiqueta="Subir carpeta…" onClick={p.onSubirCarpeta}>
        <IconoSubirCarpeta />
      </Boton>
      <span className="sftp-barra-sep" aria-hidden="true" />
      <Boton etiqueta="Descargar" titulo="Descargar la selección…" deshabilitado={p.descargables === 0} onClick={p.onDescargar}>
        <IconoDescargar />
      </Boton>
      <Boton etiqueta="Renombrar" titulo="Renombrar (F2)" deshabilitado={p.elegidos !== 1} onClick={p.onRenombrar}>
        <IconoRenombrar />
      </Boton>
      <Boton etiqueta="Eliminar" titulo={`Eliminar la selección (${p.atajoBorrar})`} deshabilitado={!hay} onClick={p.onEliminar}>
        <IconoEliminar />
      </Boton>
    </div>
  )
}
