// =============================================================================
// useVistaFranjaConTransicion: cuando la vista de la ventana desacoplada cambia (la barra lateral, la columna del
// agente o el panel que enseña), el cambio se aplica dentro de una transición de vista del documento de esa ventana:
// lo que sale se va por su lado, lo que entra llega por el suyo y el panel que se sustituye se funde en su sitio.
// El documento es el de la ventana desacoplada, no el de la principal, que puede estar tapada o en segundo plano.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { movimientoReducido } from '../../comun/presencia'
import { cambioDeVistaFranja, firmaVistaFranja, type CambioDeVistaFranja, type EstadoVistaFranja, type ZonaVistaFranja } from './franjaDesacoplada'
import { cambiaElTexto, conservaCaptura, type CajaZona, type ZonaMedida } from './movimientoLayout'
import {
  ATRIBUTO_CONSERVA, ATRIBUTO_ENTRA, ATRIBUTO_SE_VA, CLASE_CIERRE, CLASE_CRUCE, CLASE_MORFA, CLASE_TRANSICION, PIE_DEL_AGENTE, VARIABLES_FORMA,
  cajaDe, medirForma, publicarForma, zonaVisible
} from './useLayoutConTransicion'
import { enfocarPanel } from './RielActividadPuro'
import type { VentanaFranja } from './ventanasFranja'

const SELECTOR_ZONA: Record<ZonaVistaFranja, string> = { riel: '.riel-franja', agente: '.right-panel' }
const LADO_ZONA: Record<ZonaVistaFranja, 'izquierda' | 'derecha'> = { riel: 'izquierda', agente: 'derecha' }
const ZONAS_MEDIDAS: readonly ZonaMedida[] = ['.right-panel', '.git-log-panel', '.terminal-panel']

/** Las transiciones vivas de cada documento: la clase de `<html>` se quita cuando acaba la última. */
const vivasPorDocumento = new WeakMap<Document, number>()

/** Marca la zona que entra (y el pie de la columna del agente, que acompaña a su borde) con el lado por el que llega. */
function marcarEntradas(doc: Document, aparecen: readonly ZonaVistaFranja[], marcadas: Element[]): void {
  for (const zona of aparecen) {
    const el = zonaVisible(SELECTOR_ZONA[zona], doc)?.elemento
    if (!el) continue
    el.setAttribute(ATRIBUTO_ENTRA, LADO_ZONA[zona])
    marcadas.push(el)
    const pie = zona === 'agente' ? zonaVisible(PIE_DEL_AGENTE, doc)?.elemento : undefined
    if (!pie) continue
    pie.setAttribute(ATRIBUTO_ENTRA, LADO_ZONA[zona])
    marcadas.push(pie)
  }
}

/** Las zonas que cambian de tamaño enseñan su captura vieja mientras viajan (`conservaCaptura`). */
function marcarCapturasConservadas(doc: Document, antes: ReadonlyMap<ZonaMedida, CajaZona>, marcadas: Element[]): void {
  for (const zona of ZONAS_MEDIDAS) {
    const visible = zonaVisible(zona, doc)
    if (!visible || marcadas.includes(visible.elemento)) continue
    const previa = antes.get(zona) ?? null
    const despues = cajaDe(visible.rectangulo)
    if (!conservaCaptura(zona, previa, despues)) continue
    visible.elemento.setAttribute(ATRIBUTO_CONSERVA, cambiaElTexto(zona, previa, despues) ? 'texto' : '')
    marcadas.push(visible.elemento)
  }
}

function aplicarConTransicion(hija: VentanaFranja, cambio: CambioDeVistaFranja, panelNuevo: string, aplicar: () => void): () => void {
  const doc = hija.ventana.document
  const raiz = doc.documentElement
  vivasPorDocumento.set(doc, (vivasPorDocumento.get(doc) ?? 0) + 1)
  raiz.classList.add(CLASE_TRANSICION)
  raiz.classList.toggle(CLASE_CIERRE, cambio.tipo === 'cierre')
  raiz.classList.toggle(CLASE_CRUCE, cambio.cruce)
  raiz.classList.toggle(CLASE_MORFA, cambio.morfa)
  const formaAntes = cambio.morfa ? medirForma(doc) : null
  // La columna del agente sigue en la página aunque su contenedor se oculte: se mide antes de que se vaya.
  const salen = cambio.seVan.flatMap((zona) => {
    const visible = zonaVisible(SELECTOR_ZONA[zona], doc)
    return visible ? [{ elemento: visible.elemento, lado: LADO_ZONA[zona] }] : []
  })
  for (const { elemento, lado } of salen) elemento.setAttribute(ATRIBUTO_SE_VA, lado)
  const antes = new Map(ZONAS_MEDIDAS.map((zona) => [zona, cajaDe(zonaVisible(zona, doc)?.rectangulo)]))
  const marcadas: Element[] = []
  let omitida = false
  const desmarcarSalidas = (): void => {
    for (const { elemento } of salen) elemento.removeAttribute(ATRIBUTO_SE_VA)
  }
  const t = doc.startViewTransition(() => {
    if (omitida) return
    desmarcarSalidas()
    flushSync(aplicar)
    if (formaAntes) publicarForma(raiz, formaAntes, medirForma(doc))
    marcarEntradas(doc, cambio.aparecen, marcadas)
    if (!cambio.cruce) marcarCapturasConservadas(doc, antes, marcadas)
    // El foco del panel nuevo se pide cuando ya se ve: antes de la transición aún no existe.
    if (cambio.cruce && doc.hasFocus()) enfocarPanel(panelNuevo === 'gitlog' ? 'gitlog' : 'terminal', doc)
  })
  // Con la ventana oculta o minimizada, el navegador se salta la animación y rechaza `ready`: el cambio se
  // aplica igual, así que no es un error.
  t.ready.catch(() => undefined)
  const limpiar = (): void => {
    for (const el of marcadas) {
      el.removeAttribute(ATRIBUTO_ENTRA)
      el.removeAttribute(ATRIBUTO_CONSERVA)
    }
    const restantes = Math.max(0, (vivasPorDocumento.get(doc) ?? 1) - 1)
    vivasPorDocumento.set(doc, restantes)
    if (restantes > 0) return
    raiz.classList.remove(CLASE_TRANSICION, CLASE_CIERRE, CLASE_CRUCE, CLASE_MORFA)
    for (const v of VARIABLES_FORMA) raiz.style.removeProperty(v)
  }
  void t.finished.finally(() => { if (!omitida) limpiar() })
  return () => {
    omitida = true
    desmarcarSalidas()
    t.skipTransition()
    limpiar()
  }
}

/** Lo que pinta la ventana desacoplada, o `null` si aún no tiene vista (no hay ventana o no hay panel). */
export type VistaFranjaPintada = EstadoVistaFranja | null

/**
 * La vista que se pinta, con el cambio aplicado dentro de una transición del documento de la ventana desacoplada.
 * Mientras un cambio espera a que la transición capture lo anterior (un fotograma), devuelve la vista anterior;
 * sin animación (sin ventana, con movimiento reducido o por el ancho) devuelve la nueva en el mismo render.
 */
export function useVistaFranjaConTransicion(hija: VentanaFranja | undefined, deseada: VistaFranjaPintada): VistaFranjaPintada {
  const [visto, setVisto] = useState<VistaFranjaPintada>(deseada)
  const ultima = useRef(deseada)
  const saltarPendiente = useRef<(() => void) | null>(null)
  const firmaDeseada = firmaVistaFranja(deseada)
  const cambia = firmaVistaFranja(visto) !== firmaDeseada
  const cambio = cambia && visto !== null && deseada !== null ? cambioDeVistaFranja(visto, deseada) : null
  const ventana = hija && !hija.ventana.closed ? hija.ventana : null
  const anima = cambio !== null && ventana !== null && !movimientoReducido(ventana) && typeof ventana.document.startViewTransition === 'function'
  useLayoutEffect(() => { ultima.current = deseada })
  useLayoutEffect(() => {
    if (saltarPendiente.current) {
      // La captura pendiente se preparó para otro destino.
      saltarPendiente.current()
      saltarPendiente.current = null
      setVisto(ultima.current)
    } else if (anima && hija && cambio && deseada) {
      saltarPendiente.current = aplicarConTransicion(hija, cambio, deseada.panel, () => {
        saltarPendiente.current = null
        setVisto(ultima.current)
      })
    } else if (cambia) setVisto(ultima.current)
    // La firma recoge el contexto y el reparto; otros cambios de la vista no reinician la captura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaDeseada, anima, visto])
  return cambia && anima ? visto : deseada
}
