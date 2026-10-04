// =============================================================================
// El cuerpo del modal de búsqueda cuando no hay ninguna fila. Son cuatro situaciones
// distintas: algo falló, falta la carpeta, aún no se escribió nada, o se buscó y no hay nada.
// Buscar es transitorio y va como línea, no como estado vacío centrado (que haría saltar el layout).
// =============================================================================
import { EstadoVacio, IconoLupa, IconoLupaSinResultados } from '../../comun/EstadoVacio'
import type { ProyectoBuscable } from '../../../../shared/search-ipc'
import type { OpcionesBusqueda } from '../../../../shared/textSearch'
import type { SeleccionCarpeta } from './AmbitoBusqueda'
import type { EstadoBusqueda } from './filasResultado'

interface EstadoVacioBusquedaProps {
  estado: EstadoBusqueda
  modoAmbito: 'proyecto' | 'carpeta'
  carpeta: SeleccionCarpeta | null
  proyectos: ProyectoBuscable[]
  projectName: string
  hayConsulta: boolean
  opts: OpcionesBusqueda
}

/**
 * Lo que se nombra en los textos: la carpeta, o el proyecto si el ámbito es su raíz
 * (cuya ruta relativa es la cadena vacía y no es una carpeta a efectos de los textos).
 */
function nombreDelAmbito(
  enCarpeta: boolean,
  carpeta: SeleccionCarpeta | null,
  proyectos: ProyectoBuscable[],
  projectName: string
): string {
  if (enCarpeta && carpeta !== null) return carpeta.carpeta
  const proyecto =
    carpeta !== null
      ? (proyectos.find((p) => p.raiz === carpeta.raiz)?.nombre ?? projectName)
      : projectName
  return proyecto || 'el proyecto abierto'
}

/** La pista de «Ningún resultado» según qué opciones estrechan la búsqueda. */
function pistaSinResultados(opts: OpcionesBusqueda): string {
  return opts.wholeWord || opts.regex
    ? 'Prueba con menos texto, o desactiva «palabra completa» y «expresión regular».'
    : 'Prueba con menos texto, o activa «Aa» si buscabas distinguiendo mayúsculas.'
}

/** El estado vacío que corresponde al momento de la búsqueda. */
export function EstadoVacioBusqueda({
  estado,
  modoAmbito,
  carpeta,
  proyectos,
  projectName,
  hayConsulta,
  opts
}: EstadoVacioBusquedaProps): React.JSX.Element {
  const enCarpeta = modoAmbito === 'carpeta' && carpeta !== null && carpeta.carpeta !== ''
  if (estado.error !== null) {
    return (
      <EstadoVacio
        icono={<IconoLupaSinResultados />}
        titulo="No se pudo buscar"
        pista={estado.error}
        className="buscar-vacio"
      />
    )
  }
  // Antes que «escribe algo»: con el ámbito a medias, lo que falta es la carpeta.
  if (modoAmbito === 'carpeta' && carpeta === null) {
    return (
      <EstadoVacio
        icono={<IconoLupa />}
        titulo="Elige una carpeta"
        pista="Arriba, en el desplegable. La lista trae las carpetas de todos los proyectos abiertos, agrupadas por proyecto."
        className="buscar-vacio"
      />
    )
  }
  if (!hayConsulta) {
    return (
      <EstadoVacio
        icono={<IconoLupa />}
        titulo={enCarpeta ? 'Busca en esa carpeta' : 'Busca en todo el proyecto'}
        pista={
          <>
            Escribe arriba para buscar en todas las carpetas y subcarpetas de{' '}
            <strong>{nombreDelAmbito(enCarpeta, carpeta, proyectos, projectName)}</strong>, incluido
            el contenido de los <code>.jar</code> y las clases compiladas.
          </>
        }
        className="buscar-vacio"
      />
    )
  }
  if (estado.buscando) return <div className="buscar-buscando">Buscando…</div>
  return (
    <EstadoVacio
      icono={<IconoLupaSinResultados />}
      titulo="Ningún resultado"
      pista={pistaSinResultados(opts)}
      className="buscar-vacio"
    />
  )
}
