// =============================================================================
// El estado y los efectos del modal «Buscar en archivos», reunidos en un solo hook que llama
// el propio modal: el estado sigue teniendo el mismo dueño y los efectos, su orden de siempre.
// El modal solo pinta lo que este hook le devuelve.
// Decisiones: docs/decisiones/busqueda/busqueda-en-archivos.md
// =============================================================================
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useDialogo } from '../../comun/useDialogo'
import type { SeleccionCarpeta } from './AmbitoBusqueda'
import {
  tamanoInicial,
  teclaDeLista,
  useAmbitoCarpeta,
  useDensidadBusqueda,
  useEnfoqueCampo,
  useLanzarBusqueda,
  useSuscripcionResultados
} from './useEfectosBusqueda'
import {
  ESTADO_INICIAL,
  filaSeleccionada,
  textoContador,
  type EstadoBusqueda
} from './filasResultado'
import type { MemoriaBusqueda } from './memoriaBusqueda'
import type { CoincidenciaArchivo, ProyectoBuscable } from '../../../../shared/search-ipc'
import type { OpcionesBusqueda } from '../../../../shared/textSearch'

/** Lo que recibe el modal de búsqueda. */
export interface PropsBuscarEnArchivos {
  /** Nombre del proyecto activo, para el encabezado. */
  projectName: string
  /** Proyectos abiertos del perfil activo, en el orden de sus pestañas. */
  proyectos: ProyectoBuscable[]
  /** Raíz host del proyecto activo: contra ella se decide si hay que activar otro. */
  raizActiva: string | null
  /** Activa el proyecto de esa raíz (lo mismo que pulsar su pestaña). */
  onActivarProyecto: (raiz: string) => void
  /** Clave del proyecto activo: cambiarla relanza la búsqueda e invalida la previa. */
  projectKey: string
  /** Consulta, opciones y tamaños iniciales (se recuerdan entre aperturas). */
  estadoInicial: MemoriaBusqueda
  /** Sube el estado para recordarlo al cerrar. */
  onRecordar: (e: MemoriaBusqueda) => void
  /** Abre la coincidencia en una pestaña del editor, en su línea. */
  onAbrir: (c: CoincidenciaArchivo) => void
  onClose: () => void
  /** Sube en cada Ctrl+Shift+F con el modal ya abierto: vuelve al campo y selecciona lo escrito. */
  focusToken: number
}

/** Los valores que el modal recuerda al cerrarse, junto a sus setters. */
function useMemoriaBusqueda(inicial: MemoriaBusqueda): {
  memoria: MemoriaBusqueda
  set: {
    query: Dispatch<SetStateAction<string>>
    opts: Dispatch<SetStateAction<OpcionesBusqueda>>
    modoAmbito: Dispatch<SetStateAction<'proyecto' | 'carpeta'>>
    carpeta: Dispatch<SetStateAction<SeleccionCarpeta | null>>
    altoPrevia: Dispatch<SetStateAction<number>>
    tam: Dispatch<SetStateAction<{ ancho: number; alto: number }>>
  }
} {
  const [query, setQuery] = useState(inicial.query)
  const [opts, setOpts] = useState<OpcionesBusqueda>(inicial.opts)
  const [modoAmbito, setModoAmbito] = useState(inicial.modoAmbito)
  const [carpeta, setCarpeta] = useState<SeleccionCarpeta | null>(inicial.carpeta)
  const [altoPrevia, setAltoPrevia] = useState(inicial.altoPrevia)
  const [tam, setTam] = useState(() => tamanoInicial(inicial))
  return {
    memoria: { query, opts, altoPrevia, modoAmbito, carpeta, ...tam },
    set: {
      query: setQuery,
      opts: setOpts,
      modoAmbito: setModoAmbito,
      carpeta: setCarpeta,
      altoPrevia: setAltoPrevia,
      tam: setTam
    }
  }
}

/** Lo que el modal necesita para pintarse. */
export interface VistaModalBusqueda {
  m: MemoriaBusqueda
  set: ReturnType<typeof useMemoriaBusqueda>['set']
  estado: EstadoBusqueda
  setEstado: Dispatch<SetStateAction<EstadoBusqueda>>
  vars: Record<string, string>
  altoDeFila: number
  dialogo: React.RefObject<HTMLDivElement>
  inputRef: React.RefObject<HTMLInputElement>
  alPulsar: (e: React.KeyboardEvent) => void
  fila: CoincidenciaArchivo | null
  hayConsulta: boolean
  /** El texto del contador, o null mientras no haya nada que decir. */
  contador: string | null
  abrir: (c: CoincidenciaArchivo) => void
}

/** Estado, efectos y derivados del modal de búsqueda. */
export function useBusquedaEnArchivos(props: PropsBuscarEnArchivos): VistaModalBusqueda {
  const { estadoInicial, proyectos, raizActiva, projectKey, onAbrir, onClose } = props
  const { memoria: m, set } = useMemoriaBusqueda(estadoInicial)
  const [estado, setEstado] = useState(ESTADO_INICIAL)
  const { vars, altoDeFila } = useDensidadBusqueda()
  const { ref, alPulsarTecla } = useDialogo({ onClose })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const idRef = useRef(0)
  useSuscripcionResultados({ idRef, setEstado, memoria: m, onRecordar: props.onRecordar })
  useLanzarBusqueda({ idRef, setEstado, projectKey, raizActiva, ...m })
  useAmbitoCarpeta({
    ...{ proyectos, raizActiva, carpeta: m.carpeta, modoAmbito: m.modoAmbito },
    setCarpeta: set.carpeta,
    setModoAmbito: set.modoAmbito,
    onActivarProyecto: props.onActivarProyecto
  })
  useEnfoqueCampo(inputRef, props.focusToken)

  const fila = filaSeleccionada(estado)
  const hayConsulta = m.query.trim() !== ''
  const texto = useMemo(() => textoContador(estado, hayConsulta), [estado, hayConsulta])
  const abrir = useCallback(
    (c: CoincidenciaArchivo) => {
      onAbrir(c)
      onClose()
    },
    [onAbrir, onClose]
  )
  const alPulsar = (e: React.KeyboardEvent): void =>
    teclaDeLista(e, { fila, setEstado, abrir, alPulsarTecla })
  const contador = estado.filas.length > 0 || estado.buscando ? texto : null
  return { m, set, estado, setEstado, vars, altoDeFila, dialogo: ref, inputRef, alPulsar, fila, hayConsulta, contador, abrir }
}
