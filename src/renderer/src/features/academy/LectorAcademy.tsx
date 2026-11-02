// =============================================================================
// El lector de Tessera Academy: un modal propio, encima de lo que haya (Configuración o el diálogo
// del ⓘ), con la cabecera del artículo, el índice de secciones fijo que marca la que se lee, el
// cuerpo con su scroll y el paso al anterior y al siguiente. Esc o el velo lo cierran y se vuelve a
// lo de debajo. Al abrirlo con una sección, la lleva arriba y la resalta un momento.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { alClicEnVelo, useDialogo } from '../../comun/useDialogo'
import { articulo } from './articulos'
import { urlDeCaptura } from './capturas'
import { IconoArticulo, IconoBirrete, IconoInfo } from './iconosAcademy'
import { ARTICULOS_EN_ORDEN, INDICE_ACADEMY, tituloDe, type ArticuloId } from './indice'
import { textoPlano } from './marcado'
import { seVeEn, tipoDeBloque, type Bloque, type Seccion } from './modelo'
import { abrirAcademy, cerrarAcademy, useStoreAcademy } from './store'
import { TextoMarcado } from './TextoMarcado'
import { txAcademy } from './textos'
import { txIndice } from './textosIndice'
import './academy.css'

/** El id del DOM de una sección: único entre artículos porque lleva el del artículo. */
function idDeSeccion(id: ArticuloId, ancla: string): string {
  return `academy-${id}-${ancla}`
}

function BloqueArticulo({ bloque }: { bloque: Bloque }): React.JSX.Element | null {
  if (!seVeEn(bloque, window.tessera.plataforma)) return null
  if (typeof bloque === 'string') return <p><TextoMarcado texto={bloque} /></p>
  switch (tipoDeBloque(bloque)) {
    case 'p':
      return <p><TextoMarcado texto={(bloque as { p: string }).p} /></p>
    case 'nota':
      return (
        <div className="academy-nota">
          <IconoInfo />
          <p><TextoMarcado texto={(bloque as { nota: string }).nota} /></p>
        </div>
      )
    case 'lista':
      return (
        <ul className="academy-lista">
          {(bloque as { lista: readonly string[] }).lista.map((t, i) => (
            <li key={i}><TextoMarcado texto={t} /></li>
          ))}
        </ul>
      )
    case 'pasos':
      return (
        <ol className="academy-pasos">
          {(bloque as { pasos: readonly string[] }).pasos.map((t, i) => (
            <li key={i}><TextoMarcado texto={t} /></li>
          ))}
        </ol>
      )
    case 'captura': {
      const c = bloque as { captura: string; alt: string }
      const url = urlDeCaptura(c.captura)
      if (!url) return null
      return (
        <figure className="academy-figura">
          <img className="academy-captura" src={url} alt={textoPlano(c.alt)} loading="lazy" />
          <figcaption><TextoMarcado texto={c.alt} /></figcaption>
        </figure>
      )
    }
  }
}

/** El grupo del índice al que pertenece el artículo. */
function grupoDe(id: ArticuloId): string {
  const g = INDICE_ACADEMY.find((x) => (x.articulos as readonly string[]).includes(id))
  return g ? txIndice().grupos[g.grupo] : ''
}

/** Lleva la sección pedida arriba (o el principio, sin sección) cada vez que se pide. */
function useIrASeccion(cuerpo: React.RefObject<HTMLElement>, id: ArticuloId, ancla: string | null, pedido: number): void {
  useEffect(() => {
    const destino = ancla ? document.getElementById(idDeSeccion(id, ancla)) : null
    if (!destino) {
      cuerpo.current?.scrollTo({ top: 0 })
      return
    }
    destino.scrollIntoView({ block: 'start' })
    destino.classList.remove('academy-destacada')
    // Forzar el reflujo reinicia la animación aunque la sección ya estuviera resaltada.
    void destino.offsetWidth
    destino.classList.add('academy-destacada')
  }, [cuerpo, id, ancla, pedido])
}

/**
 * La sección que se está leyendo: la última cuyo título ya pasó por arriba del cuerpo. Al fondo del
 * todo (con scroll), una sección corta nunca llega arriba: manda la que se pidió si se ve, y si el
 * lector movió la rueda, la última.
 */
function useSeccionVisible(
  cuerpo: React.RefObject<HTMLElement>,
  id: ArticuloId,
  secciones: readonly Seccion[],
  pedida: string | null,
  pedido: number
): string | null {
  const [activa, setActiva] = useState<string | null>(secciones[0]?.ancla ?? null)
  const preferida = useRef<string | null>(pedida)
  useEffect(() => {
    preferida.current = pedida
  }, [pedida, pedido])
  useEffect(() => {
    const el = cuerpo.current
    if (!el) return
    const seccion = (ancla: string): HTMLElement | null => document.getElementById(idDeSeccion(id, ancla))
    const mirar = (): void => {
      const caja = el.getBoundingClientRect()
      let actual: string | null = secciones[0]?.ancla ?? null
      for (const s of secciones) {
        const sec = seccion(s.ancla)
        if (sec && sec.getBoundingClientRect().top <= caja.top + 96) actual = s.ancla
      }
      const hayScroll = el.scrollHeight > el.clientHeight + 4
      if (hayScroll && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
        const p = preferida.current ? seccion(preferida.current) : null
        actual = p && p.getBoundingClientRect().top < caja.bottom ? preferida.current : (secciones[secciones.length - 1]?.ancla ?? actual)
      }
      setActiva(actual)
    }
    const olvidar = (): void => {
      preferida.current = null
    }
    mirar()
    el.addEventListener('scroll', mirar, { passive: true })
    el.addEventListener('wheel', olvidar, { passive: true })
    return () => {
      el.removeEventListener('scroll', mirar)
      el.removeEventListener('wheel', olvidar)
    }
  }, [cuerpo, id, secciones])
  return activa
}

function Lector({ id, ancla, pedido }: { id: ArticuloId; ancla: string | null; pedido: number }): React.JSX.Element {
  const t = txAcademy()
  const a = articulo(id)
  const { ref, alPulsarTecla } = useDialogo({ onClose: cerrarAcademy })
  const cuerpo = useRef<HTMLDivElement>(null)
  useIrASeccion(cuerpo, id, ancla, pedido)
  const activa = useSeccionVisible(cuerpo, id, a.secciones, ancla, pedido)
  // El foco entra en el lector al abrirlo y al pasar de artículo: si no, se queda en el ⓘ de
  // debajo, y ni la trampa de Tab ni el teclado serían del lector.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [ref, id])
  const i = ARTICULOS_EN_ORDEN.indexOf(id)
  const anterior = i > 0 ? ARTICULOS_EN_ORDEN[i - 1] : null
  const siguiente = i < ARTICULOS_EN_ORDEN.length - 1 ? ARTICULOS_EN_ORDEN[i + 1] : null

  return (
    <div className="modal-overlay academy-lector-velo" role="presentation" onMouseDown={alClicEnVelo(cerrarAcademy)}>
      <div
        ref={ref}
        className="academy-lector"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`academy-titulo-${id}`}
        onKeyDown={alPulsarTecla}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="academy-lector-cabecera">
          <span className="academy-icono-articulo">
            <IconoArticulo id={id} />
          </span>
          <div className="academy-lector-titulos">
            <div className="academy-lector-grupo">
              <IconoBirrete />
              <span>{t.nombre}</span>
              <span aria-hidden="true">·</span>
              <span>{grupoDe(id)}</span>
            </div>
            <h2 id={`academy-titulo-${id}`} className="academy-titulo">
              {tituloDe(id)}
            </h2>
          </div>
          <button type="button" className="btn btn-icon academy-lector-cerrar" onClick={cerrarAcademy} title={t.cerrar} aria-label={t.cerrar}>
            ✕
          </button>
        </header>

        <div ref={cuerpo} className="academy-lector-cuerpo">
          <nav className="academy-lector-toc" aria-label={t.enEsteArticulo}>
            <div className="academy-lector-toc-titulo">{t.enEsteArticulo}</div>
            {a.secciones.map((s) => (
              <button
                key={s.ancla}
                type="button"
                className={`academy-toc-item${activa === s.ancla ? ' activa' : ''}`}
                aria-current={activa === s.ancla ? 'location' : undefined}
                onClick={() => abrirAcademy(`${id}/${s.ancla}`)}
              >
                {textoPlano(s.titulo)}
              </button>
            ))}
          </nav>

          <article className="academy-articulo" data-articulo={id}>
            <p className="academy-resumen"><TextoMarcado texto={a.resumen} /></p>
            {a.secciones.map((s) => (
              <section key={s.ancla} id={idDeSeccion(id, s.ancla)} className="academy-seccion" data-ancla={s.ancla}>
                <h3><TextoMarcado texto={s.titulo} /></h3>
                {s.bloques.map((b, n) => (
                  <BloqueArticulo key={n} bloque={b} />
                ))}
              </section>
            ))}
            <nav className="academy-pasar">
              {anterior && (
                <button type="button" className="academy-pasar-boton" onClick={() => abrirAcademy(anterior)}>
                  <span className="academy-pasar-etiqueta">{t.anteriorEtiqueta}</span>
                  <span className="academy-pasar-titulo">‹ {tituloDe(anterior)}</span>
                </button>
              )}
              {siguiente && (
                <button type="button" className="academy-pasar-boton academy-siguiente" onClick={() => abrirAcademy(siguiente)}>
                  <span className="academy-pasar-etiqueta">{t.siguienteEtiqueta}</span>
                  <span className="academy-pasar-titulo">{tituloDe(siguiente)} ›</span>
                </button>
              )}
            </nav>
          </article>
        </div>
      </div>
    </div>
  )
}

/** El lector, montado solo con un artículo abierto. Va en la capa de modales de la raíz. */
export function LectorAcademy(): React.JSX.Element | null {
  const { articulo: id, ancla, pedido } = useStoreAcademy()
  if (id === null) return null
  return <Lector id={id} ancla={ancla} pedido={pedido} />
}
