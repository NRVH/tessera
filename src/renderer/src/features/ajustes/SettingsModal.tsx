// =============================================================================
// Modal de Configuración: riel vertical de categorías y buscador que las atraviesa.
// Con consulta, el panel apila los resultados de TODAS las categorías y el riel pasa
// a ser un índice con el conteo de cada una; sin ella, enseña la categoría elegida.
// `PANELES` es un `Record` completo sobre `CategoriaId`: una categoría sin panel no compila.
// Depende de `catalogo.ts` y `filtrarAjustes.ts`; los paneles viven en `categorias/`.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogo } from '../../comun/useDialogo'
import { categoriasVisibles, type CategoriaId } from './catalogo'
import {
  contarPorCategoria,
  filtrarAjustes,
  gruposDe,
  sinResultados
} from './filtrarAjustes'
import { CabeceraModal, RielCategorias } from './PartesModal'
import type { AjustesProps, PropsCategoria } from './tipos'
import { useRielAjustes } from './useRielAjustes'
import { Apariencia } from './categorias/Apariencia'
import { Terminales } from './categorias/Terminales'
import { Proyectos } from './categorias/Proyectos'
import { BasesDeDatos } from './categorias/BasesDeDatos'
import { Integracion } from './categorias/Integracion'
import { Actualizaciones } from './categorias/Actualizaciones'
import { Acerca } from './categorias/Acerca'

/** El panel de cada categoría. COMPLETO: una categoría sin panel no compila. */
const PANELES: Record<CategoriaId, (p: PropsCategoria) => React.JSX.Element | null> = {
  apariencia: Apariencia,
  terminales: Terminales,
  proyectos: Proyectos,
  'bases-de-datos': BasesDeDatos,
  integracion: Integracion,
  actualizaciones: Actualizaciones,
  acerca: Acerca
}

/**
 * Las categorías que ESTE sistema puede enseñar, y sus grupos aplanados.
 *
 * Constantes de módulo y no `useMemo`: ni la plataforma ni sus capacidades cambian
 * durante la vida del proceso. Se filtra AQUÍ, en un solo sitio, y de esta lista salen
 * el riel, el buscador, el conteo por categoría y las flechas del teclado: si alguno
 * usara el catálogo completo, se podría llegar a un ajuste que no se monta
 * (ver `catalogo.categoriasVisibles`).
 */
const CATEGORIAS_VISIBLES = categoriasVisibles(window.tessera.capacidades)
const TODOS_LOS_GRUPOS = gruposDe(CATEGORIAS_VISIBLES)

interface SettingsModalProps extends AjustesProps {
  /**
   * Categoría abierta. Vive en el store de ajustes y no aquí porque este componente se DESMONTA
   * al cerrarse: dentro, reabrir caería siempre en la primera.
   */
  categoria: CategoriaId
  onCambiarCategoria: (id: CategoriaId) => void
  onClose: () => void
}

/** Resultados de la búsqueda: un bloque por categoría con coincidencias, o el aviso de vacío. */
function ResultadosBusqueda({
  vacio,
  consulta,
  conResultados,
  ve,
  ajustes,
  bloques
}: {
  vacio: boolean
  consulta: string
  conResultados: readonly { id: CategoriaId; titulo: string }[]
  ve: (id: string) => boolean
  ajustes: AjustesProps
  bloques: React.MutableRefObject<Map<string, HTMLDivElement>>
}): React.JSX.Element {
  if (vacio) {
    return <div className="ajustes-sin-resultados">Ningún ajuste coincide con «{consulta.trim()}».</div>
  }
  return (
    <>
      {conResultados.map((c) => {
        const Panel = PANELES[c.id]
        return (
          <div
            key={c.id}
            className="ajustes-bloque"
            ref={(el) => {
              if (el) bloques.current.set(c.id, el)
              else bloques.current.delete(c.id)
            }}
          >
            {/* Con la búsqueda abierta el nombre de la categoría es lo
                único que distingue dos filas "Fuente" o dos "Tamaño". */}
            <div className="ajustes-bloque-titulo">{c.titulo}</div>
            <Panel ve={ve} {...ajustes} />
          </div>
        )
      })}
    </>
  )
}

/** Panel de la categoría elegida (sin consulta). */
function PanelCategoria({
  categoria,
  ve,
  ajustes
}: {
  categoria: CategoriaId
  ve: (id: string) => boolean
  ajustes: AjustesProps
}): React.JSX.Element {
  const Panel = PANELES[categoria]
  return <Panel ve={ve} {...ajustes} />
}

/** El `tabpanel` del modal: resultados apilados con consulta, la categoría elegida sin ella. */
function PanelModal({
  categoria,
  hayConsulta,
  resultados,
  ve,
  ajustes
}: {
  categoria: CategoriaId
  hayConsulta: boolean
  resultados: React.ComponentProps<typeof ResultadosBusqueda>
  ve: (id: string) => boolean
  ajustes: AjustesProps
}): React.JSX.Element {
  if (hayConsulta) {
    return (
      <div
        className="ajustes-modal-panel"
        role="tabpanel"
        // El MISMO id al que apuntan los `aria-controls` del riel: con consulta el
        // panel apila todas las categorías, y la seleccionada sigue "controlándolo".
        id={`ajustes-panel-${categoria}`}
        aria-label="Resultados de la búsqueda"
        // Scrollea y puede no tener nada enfocable dentro.
        tabIndex={0}
      >
        <ResultadosBusqueda {...resultados} />
      </div>
    )
  }
  return (
    <div
      className="ajustes-modal-panel"
      role="tabpanel"
      id={`ajustes-panel-${categoria}`}
      aria-labelledby={`ajustes-tab-${categoria}`}
      // Es un contenedor que scrollea y puede no tener nada enfocable
      // dentro; sin esto no se llega a él con el teclado.
      tabIndex={0}
    >
      <PanelCategoria categoria={categoria} ve={ve} ajustes={ajustes} />
    </div>
  )
}

/** La consulta del buscador y lo que se deriva de ella: ajustes visibles, conteo por categoría y Esc. */
function useConsultaAjustes(): {
  consulta: string
  setConsulta: (valor: string) => void
  hayConsulta: boolean
  conteo: ReadonlyMap<string, number>
  ve: (id: string) => boolean
  vacio: boolean
  conResultados: readonly { id: CategoriaId; titulo: string }[]
  alPulsarEnBuscador: (e: React.KeyboardEvent) => void
} {
  // La CONSULTA no se recuerda entre aperturas, al contrario que la categoría:
  // un filtro rancio al reabrir se lee como "faltan ajustes".
  const [consulta, setConsulta] = useState('')
  const hayConsulta = consulta.trim() !== ''

  const visibles = useMemo(() => filtrarAjustes(TODOS_LOS_GRUPOS, consulta), [consulta])
  const conteo = useMemo(() => contarPorCategoria(CATEGORIAS_VISIBLES, visibles), [visibles])
  const ve = (id: string): boolean => visibles.has(id)
  const vacio = sinResultados(TODOS_LOS_GRUPOS, visibles)
  const conResultados = CATEGORIAS_VISIBLES.filter((c) => (conteo.get(c.id) ?? 0) > 0)

  /**
   * Esc dentro del buscador: si hay texto, LIMPIA y no cierra.
   *
   * `stopPropagation` es obligatorio: el Esc de `useDialogo` escucha en `window`, y sin
   * él una sola pulsación limpiaría Y cerraría. `preventDefault` desactiva el borrado
   * nativo de los `type="search"`. La condición usa el MISMO `hayConsulta` que decide el
   * render: con la consulta en blancos el modal no filtra nada y Esc tiene que cerrar.
   */
  function alPulsarEnBuscador(e: React.KeyboardEvent): void {
    if (e.key !== 'Escape' || !hayConsulta) return
    e.preventDefault()
    e.stopPropagation()
    setConsulta('')
  }

  return { consulta, setConsulta, hayConsulta, conteo, ve, vacio, conResultados, alPulsarEnBuscador }
}

export function SettingsModal({
  categoria,
  onCambiarCategoria,
  onClose,
  ...ajustes
}: SettingsModalProps): React.JSX.Element {
  const { consulta, setConsulta, hayConsulta, conteo, ve, vacio, conResultados, alPulsarEnBuscador } =
    useConsultaAjustes()

  const { ref, alPulsarTecla } = useDialogo({ onClose })
  const buscadorRef = useRef<HTMLInputElement>(null)
  const { rielRef, bloques, irA, alPulsarEnRiel } = useRielAjustes(
    categoria,
    CATEGORIAS_VISIBLES,
    onCambiarCategoria
  )

  // Foco inicial con un efecto y NO con `autoFocus`: los dos a la vez se pisan con
  // la trampa de foco y el input pierde el foco un frame después de montar.
  useEffect(() => {
    buscadorRef.current?.focus()
  }, [])

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        ref={ref}
        className="ajustes-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ajustes-titulo"
        onKeyDown={alPulsarTecla}
        // mousedown y no click: así arrastrar una selección desde dentro y soltar
        // fuera no cierra el modal.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <CabeceraModal
          consulta={consulta}
          onConsulta={setConsulta}
          buscadorRef={buscadorRef}
          alPulsarEnBuscador={alPulsarEnBuscador}
          onClose={onClose}
        />

        <div className="ajustes-modal-cuerpo">
          <RielCategorias
            rielRef={rielRef}
            categorias={CATEGORIAS_VISIBLES}
            categoria={categoria}
            conteo={conteo}
            hayConsulta={hayConsulta}
            onIrA={irA}
            alPulsarEnRiel={alPulsarEnRiel}
          />

          <PanelModal
            categoria={categoria}
            hayConsulta={hayConsulta}
            resultados={{ vacio, consulta, conResultados, ve, ajustes, bloques }}
            ve={ve}
            ajustes={ajustes}
          />
        </div>
      </div>
    </div>
  )
}
