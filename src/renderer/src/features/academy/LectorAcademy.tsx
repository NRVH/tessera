// =============================================================================
// El lector de Tessera Academy: un modal propio, encima de lo que haya (Configuración o el diálogo
// del ⓘ), con la cabecera del artículo, el índice de secciones fijo que marca la que se lee, el
// cuerpo con su scroll y, en el pie fijo, el paso al anterior y al siguiente. Esc o el velo lo cierran y se vuelve a
// lo de debajo. Al abrirlo con una sección, la lleva arriba y la resalta un momento.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../comun/Modal'
import { articulo } from './articulos'
import { urlDeCaptura } from './capturas'
import { IconoArticulo, IconoBirrete, IconoInfo } from './iconosAcademy'
import { ARTICULOS_EN_ORDEN, INDICE_ACADEMY, tituloDe, type ArticuloId, type GrupoAcademyId } from './indice'
import { textoPlano } from './marcado'
import { seVeEn, tipoDeBloque, type Bloque, type Seccion } from './modelo'
import { abrirAcademy, cerrarAcademy, irAlIndice, useStoreAcademy } from './store'
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
function grupoDe(id: ArticuloId): GrupoAcademyId | null {
  return INDICE_ACADEMY.find((x) => (x.articulos as readonly string[]).includes(id))?.grupo ?? null
}

/** Las migajas: «Tessera Academy» lleva al índice y el grupo, a su sitio en el índice. */
function Migajas({ id }: { id: ArticuloId }): React.JSX.Element {
  const t = txAcademy()
  const grupo = grupoDe(id)
  return (
    <nav className="academy-lector-grupo" aria-label={t.migajas}>
      <IconoBirrete />
      <button type="button" className="academy-migaja" onClick={() => irAlIndice(null)} title={t.irAlIndice}>
        {t.nombre}
      </button>
      {grupo && (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="academy-migaja" onClick={() => irAlIndice(grupo)} title={t.irAlGrupo(txIndice().grupos[grupo])}>
            {txIndice().grupos[grupo]}
          </button>
        </>
      )}
    </nav>
  )
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
  const cuerpo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    cuerpo.current?.closest('.modal-card')?.querySelector<HTMLButtonElement>('.modal-cerrar')?.focus({ preventScroll: true })
  }, [id])
  useIrASeccion(cuerpo, id, ancla, pedido)
  const activa = useSeccionVisible(cuerpo, id, a.secciones, ancla, pedido)
  const i = ARTICULOS_EN_ORDEN.indexOf(id)
  const anterior = i > 0 ? ARTICULOS_EN_ORDEN[i - 1] : null
  const siguiente = i < ARTICULOS_EN_ORDEN.length - 1 ? ARTICULOS_EN_ORDEN[i + 1] : null

  return (
    <Modal titulo={<span className="academy-lector-cabecera"><span className="academy-icono-articulo"><IconoArticulo id={id} /></span><span className="academy-titulo">{tituloDe(id)}</span></span>}
      subtitulo={<Migajas id={id} />}
      tamano="xl" className="academy-lector" cuerpoClassName="academy-lector-contenido" onCerrar={cerrarAcademy}
      pie={<PasarArticulo anterior={anterior} siguiente={siguiente} />}>
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
          </article>
        </div>
    </Modal>
  )
}

/**
 * El paso al artículo anterior y al siguiente, en el pie fijo del lector: se alcanza desde cualquier punto
 * del artículo sin desplazarse hasta el final.
 */
function PasarArticulo({ anterior, siguiente }: { anterior: ArticuloId | null; siguiente: ArticuloId | null }): React.JSX.Element {
  const t = txAcademy()
  return (
    <nav className="academy-pasar" aria-label={t.navegacionArticulos}>
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
  )
}

/** El lector, montado solo con un artículo abierto. Va en la capa de modales de la raíz. */
export function LectorAcademy(): React.JSX.Element | null {
  const { articulo: id, ancla, pedido } = useStoreAcademy()
  if (id === null) return null
  return <Lector id={id} ancla={ancla} pedido={pedido} />
}
