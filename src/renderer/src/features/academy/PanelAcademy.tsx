// =============================================================================
// El panel de la categoría «Tessera Academy» de Configuración: el índice, una rejilla de tarjetas
// por grupo que ocupa todo el ancho. Con el buscador en uso enseña solo los artículos que casan.
// Una tarjeta abre el artículo en el lector (`LectorAcademy`), encima de Configuración; sus migajas
// vuelven aquí, al grupo del artículo.
// =============================================================================

import { useEffect } from 'react'
import { articulo } from './articulos'
import { IconoArticulo } from './iconosAcademy'
import { INDICE_ACADEMY, tituloDe, type ArticuloId, type GrupoAcademyId } from './indice'
import { textoPlano } from './marcado'
import { abrirAcademy, useStoreAcademy } from './store'
import { txAcademy } from './textos'
import { txIndice } from './textosIndice'
import './academy.css'

function TarjetaArticulo({ id }: { id: ArticuloId }): React.JSX.Element {
  const a = articulo(id)
  return (
    <li>
      <button type="button" className="academy-tarjeta" onClick={() => abrirAcademy(id)} data-articulo={id}>
        <span className="academy-icono-articulo">
          <IconoArticulo id={id} />
        </span>
        <span className="academy-tarjeta-texto">
          <span className="academy-tarjeta-titulo">{tituloDe(id)}</span>
          <span className="academy-tarjeta-resumen">{textoPlano(a.resumen)}</span>
          <span className="academy-tarjeta-pie">{txAcademy().secciones(a.secciones.length)}</span>
        </span>
      </button>
    </li>
  )
}

const idDeGrupo = (grupo: GrupoAcademyId): string => `academy-grupo-${grupo}`

/**
 * Las migajas del lector piden un grupo: se lleva arriba al montarse el índice y se consume, para que volver
 * a la categoría después no salte otra vez a él.
 */
function useIrAlGrupoPedido(): void {
  const grupo = useStoreAcademy((s) => s.grupoPedido)
  useEffect(() => {
    if (grupo === null) return
    // Se resalta un momento, como la sección pedida en el lector: así se distingue de ir al principio del índice.
    requestAnimationFrame(() => {
      const destino = document.getElementById(idDeGrupo(grupo))
      if (!destino) return
      destino.scrollIntoView({ block: 'start' })
      destino.classList.remove('academy-destacada')
      void destino.offsetWidth
      destino.classList.add('academy-destacada')
    })
    useStoreAcademy.setState({ grupoPedido: null })
  }, [grupo])
}

export function PanelAcademy({
  ve,
  enBusqueda
}: {
  ve: (id: string) => boolean
  enBusqueda: boolean
}): React.JSX.Element {
  const t = txAcademy()
  useIrAlGrupoPedido()
  return (
    <div className="academy-indice" aria-label={enBusqueda ? t.resultados : t.indice}>
      {!enBusqueda && <p className="academy-presentacion">{t.presentacion}</p>}
      {INDICE_ACADEMY.map((g) => {
        const visibles = g.articulos.filter((id) => ve(id))
        if (visibles.length === 0) return null
        return (
          <section key={g.grupo} id={idDeGrupo(g.grupo)} className="academy-grupo">
            <h3 className="academy-grupo-titulo">{txIndice().grupos[g.grupo]}</h3>
            <ul className="academy-tarjetas">
              {visibles.map((id) => (
                <TarjetaArticulo key={id} id={id} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
