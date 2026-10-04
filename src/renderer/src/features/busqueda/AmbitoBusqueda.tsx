// =============================================================================
// El selector de ámbito de la búsqueda: «En el proyecto» o «En una carpeta». La carpeta se
// elige en un `<select>` nativo con un `<optgroup>` por proyecto; la sangría usa espacios duros
// porque un `<option>` no admite CSS. Elegir una carpeta de otro proyecto lo activa.
// Decisiones: docs/decisiones/busqueda/busqueda-en-archivos.md
// =============================================================================
import { useMemo } from 'react'
import type { CarpetasResult, ProyectoBuscable } from '../../../../shared/search-ipc'
import { useCarpetasBusqueda } from './useCarpetasBusqueda'

/**
 * Sangría de cada nivel del desplegable: dos espacios duros (U+00A0). Se escriben con
 * `fromCharCode` para no dejar dos bytes invisibles en el fuente.
 */
const SANGRIA = String.fromCharCode(160, 160)

/** Lo elegido: qué proyecto (por su raíz host) y qué carpeta suya (`''` = todo él). */
export interface SeleccionCarpeta {
  raiz: string
  carpeta: string
}

/** Una entrada del desplegable, ya aplanada: el select no anida. */
interface OpcionCarpeta {
  proyecto: string
  raiz: string
  carpeta: string
  etiqueta: string
}

type Modo = 'proyecto' | 'carpeta'

interface AmbitoBusquedaProps {
  modo: Modo
  onModo: (m: Modo) => void
  /** Carpeta elegida, o null si aún ninguna. */
  seleccion: SeleccionCarpeta | null
  onSeleccion: (s: SeleccionCarpeta) => void
  /** Proyectos abiertos del perfil activo, en el orden de sus pestañas. */
  proyectos: ProyectoBuscable[]
  /** Raíz host del proyecto ACTIVO. Si no coincide con la elegida, se está activando. */
  raizActiva: string | null
}

/** Las opciones planas del select: la raíz de cada proyecto y sus carpetas, con sangría. */
function construirOpciones(datos: CarpetasResult | null): OpcionCarpeta[] {
  if (datos === null) return []
  const fuera: OpcionCarpeta[] = []
  for (const p of datos.proyectos) {
    // La raíz va primero y sin sangría: es la única forma de decir «todo el proyecto B».
    fuera.push({ proyecto: p.nombre, raiz: p.raiz, carpeta: '', etiqueta: `${p.nombre}` })
    for (const c of p.carpetas) {
      fuera.push({
        proyecto: p.nombre,
        raiz: p.raiz,
        carpeta: c.path,
        etiqueta: SANGRIA.repeat(c.profundidad + 1) + c.nombre
      })
    }
  }
  return fuera
}

/** El selector de ámbito de la búsqueda. */
export function AmbitoBusqueda({
  modo,
  onModo,
  seleccion,
  onSeleccion,
  proyectos,
  raizActiva
}: AmbitoBusquedaProps): React.JSX.Element {
  const { datos, cargando, error } = useCarpetasBusqueda(modo, proyectos)
  const opciones = useMemo(() => construirOpciones(datos), [datos])
  // El valor del select es el índice: no hay separador seguro entre proyecto y carpeta.
  const indice = useMemo(() => {
    if (seleccion === null) return -1
    return opciones.findIndex((o) => o.raiz === seleccion.raiz && o.carpeta === seleccion.carpeta)
  }, [opciones, seleccion])
  const activando = seleccion !== null && raizActiva !== null && seleccion.raiz !== raizActiva

  return (
    <div className="buscar-ambito">
      <ModosAmbito modo={modo} onModo={onModo} />
      {modo === 'carpeta' && (
        <>
          <select
            className="buscar-ambito-select"
            aria-label="Carpeta en la que buscar"
            value={indice}
            disabled={cargando || opciones.length === 0}
            onChange={(e) => {
              const o = opciones[Number(e.target.value)]
              if (o) onSeleccion({ raiz: o.raiz, carpeta: o.carpeta })
            }}
          >
            {/* El hueco «sin elegir» solo existe mientras no hay elección. */}
            {indice < 0 && (
              <option value={-1}>
                {cargando ? 'Leyendo las carpetas…' : 'Elige una carpeta…'}
              </option>
            )}
            {agrupar(opciones).map((g) => (
              <optgroup key={g.raiz} label={g.proyecto}>
                {g.items.map((it) => (
                  <option key={it.i} value={it.i}>
                    {it.etiqueta}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <NotasAmbito error={error} activando={activando} datos={datos} />
        </>
      )}
    </div>
  )
}

/** Los dos botones de modo. */
function ModosAmbito({ modo, onModo }: { modo: Modo; onModo: (m: Modo) => void }): React.JSX.Element {
  return (
    <div className="buscar-ambito-modos" role="group" aria-label="Ámbito de la búsqueda">
      <button
        type="button"
        className={`buscar-ambito-modo${modo === 'proyecto' ? ' activo' : ''}`}
        onClick={() => onModo('proyecto')}
        aria-pressed={modo === 'proyecto'}
      >
        En el proyecto
      </button>
      <button
        type="button"
        className={`buscar-ambito-modo${modo === 'carpeta' ? ' activo' : ''}`}
        onClick={() => onModo('carpeta')}
        aria-pressed={modo === 'carpeta'}
      >
        En una carpeta
      </button>
    </div>
  )
}

/** La nota junto al select: el error, el cambio de proyecto en curso o los avisos de lectura. */
function NotasAmbito({
  error,
  activando,
  datos
}: {
  error: string | null
  activando: boolean
  datos: CarpetasResult | null
}): React.JSX.Element {
  const avisos = (datos?.proyectos ?? []).filter((p) => p.error !== undefined || p.truncado)
  return (
    <>
      {error !== null && <span className="buscar-ambito-nota es-error">{error}</span>}
      {activando && <span className="buscar-ambito-nota">Cambiando de proyecto…</span>}
      {error === null && !activando && avisos.length > 0 && (
        <span className="buscar-ambito-nota" title={avisos.map(textoAviso).join('\n')}>
          {avisos.length === 1 ? textoAviso(avisos[0]) : `${avisos.length} proyectos con avisos`}
        </span>
      )}
    </>
  )
}

/** El aviso de un proyecto que no se pudo leer entero. Nunca se calla por omisión. */
function textoAviso(p: CarpetasResult['proyectos'][number]): string {
  if (p.error !== undefined) return `${p.nombre}: ${p.error}`
  return `${p.nombre}: hay más carpetas de las que caben en la lista`
}

/**
 * Reagrupa las opciones planas por proyecto conservando su índice original, que es el valor
 * del select: así `onChange` es una búsqueda por posición y no una traducción de cadenas.
 */
function agrupar(
  opciones: OpcionCarpeta[]
): { raiz: string; proyecto: string; items: { i: number; etiqueta: string }[] }[] {
  const fuera: { raiz: string; proyecto: string; items: { i: number; etiqueta: string }[] }[] = []
  opciones.forEach((o, i) => {
    let g = fuera[fuera.length - 1]
    if (!g || g.raiz !== o.raiz) {
      g = { raiz: o.raiz, proyecto: o.proyecto, items: [] }
      fuera.push(g)
    }
    g.items.push({ i, etiqueta: o.etiqueta })
  })
  return fuera
}
