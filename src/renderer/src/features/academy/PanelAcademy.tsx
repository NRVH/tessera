// =============================================================================
// El panel de la categoría «Tessera Academy» de Configuración: el índice, una rejilla de tarjetas
// por grupo que ocupa todo el ancho. Con el buscador en uso enseña solo los artículos que casan.
// Una tarjeta abre el artículo en el lector (`LectorAcademy`), encima de Configuración.
// =============================================================================

import { articulo } from './articulos'
import { IconoArticulo } from './iconosAcademy'
import { INDICE_ACADEMY, tituloDe, type ArticuloId } from './indice'
import { textoPlano } from './marcado'
import { abrirAcademy } from './store'
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

export function PanelAcademy({
  ve,
  enBusqueda
}: {
  ve: (id: string) => boolean
  enBusqueda: boolean
}): React.JSX.Element {
  const t = txAcademy()
  return (
    <div className="academy-indice" aria-label={enBusqueda ? t.resultados : t.indice}>
      {!enBusqueda && <p className="academy-presentacion">{t.presentacion}</p>}
      {INDICE_ACADEMY.map((g) => {
        const visibles = g.articulos.filter((id) => ve(id))
        if (visibles.length === 0) return null
        return (
          <section key={g.grupo} className="academy-grupo">
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
