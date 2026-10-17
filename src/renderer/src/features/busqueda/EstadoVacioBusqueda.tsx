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
import { txBusqueda } from './textos.ts'

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
  return proyecto || txBusqueda().elProyectoAbierto
}

/** La pista de «Ningún resultado» según qué opciones estrechan la búsqueda. */
function pistaSinResultados(opts: OpcionesBusqueda): string {
  const t = txBusqueda()
  return opts.wholeWord || opts.regex ? t.pistaSinResultadosOpciones : t.pistaSinResultadosMayus
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
  const t = txBusqueda()
  if (estado.error !== null) {
    return (
      <EstadoVacio
        icono={<IconoLupaSinResultados />}
        titulo={t.noSePudoBuscar}
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
        titulo={t.eligeUnaCarpeta}
        pista={t.pistaEligeCarpeta}
        className="buscar-vacio"
      />
    )
  }
  if (!hayConsulta) {
    return (
      <EstadoVacio
        icono={<IconoLupa />}
        titulo={enCarpeta ? t.buscaEnEsaCarpeta : t.buscaEnTodoElProyecto}
        pista={
          <>
            {t.escribeArriba}{' '}
            <strong>{nombreDelAmbito(enCarpeta, carpeta, proyectos, projectName)}</strong>
            {t.incluidoElContenido} <code>.jar</code> {t.yLasClases}
          </>
        }
        className="buscar-vacio"
      />
    )
  }
  if (estado.buscando) return <div className="buscar-buscando">{t.buscando}</div>
  return (
    <EstadoVacio
      icono={<IconoLupaSinResultados />}
      titulo={t.ningunResultado}
      pista={pistaSinResultados(opts)}
      className="buscar-vacio"
    />
  )
}
