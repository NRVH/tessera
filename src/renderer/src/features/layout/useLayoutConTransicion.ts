// =============================================================================
// useLayoutConTransicion: cuando aparece o se va una zona, el reparto de la ventana (`SalidaLayoutCentro`)
// cambia dentro de una transición de vista del navegador. Se captura el reparto anterior y se aplica el nuevo
// de una vez: la terminal y el editor se recolocan una sola vez, no en cada fotograma. Una zona nueva entra por
// su lado con el contenido a la vista, y la que se va sale por él. El cambio de vista, al momento.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { movimientoReducido } from '../../comun/presencia'
import type { PanelInferiorCentro, SalidaLayoutCentro } from './layoutCentro'

import { cambiaElTexto, cambioDeReparto, conservaCaptura, firmaReparto, ladoDeZona, type CajaZona, type CambioDeReparto, type RepartoVisto, type ZonaMedida } from './movimientoLayout'

/** La clase de `<html>` que da nombre a las zonas mientras dura la transición (ver movimiento.css). */
const CLASE_TRANSICION = 'transicion-layout'
/** La de un cierre (movimiento.css). */
const CLASE_CIERRE = 'transicion-cierre'
/** La de maximizar o restaurar la franja (movimiento.css). */
const CLASE_MAXIMIZA = 'transicion-maximiza'
/** La de la terminal que cambia entre su tamaño normal y maximizada, con lo que se abre a sus lados (movimiento.css). */
const CLASE_MORFA = 'transicion-morfa'
/** La de la franja maximizada con el agente de la terminal al lado: una sola superficie (movimiento.css). */
const CLASE_BLOQUE = 'transicion-bloque'
const VARIABLES_FORMA = ['--vt-riel', '--vt-crece', '--vt-crece-riel']
/** La marca de una zona que se va, solo durante la captura vieja; su valor es el lado por el que sale. */
const ATRIBUTO_SE_VA = 'data-transicion-se-va'
/** La zona que enseña su captura vieja mientras viaja (`conservaCaptura`). */
const ATRIBUTO_CONSERVA = 'data-vt-conserva'
/** La zona nueva; su valor es el lado por el que entra. */
const ATRIBUTO_ENTRA = 'data-vt-entra'
const PIE_DEL_AGENTE = '.right-panel .agent-pane:not(.hidden) .agent-pane-footer'
const ZONAS_MEDIDAS: readonly ZonaMedida[] = ['.panel-lateral', '.editor-area', '.db-area', '.right-panel', '.git-log-panel', '.terminal-panel']

let transicionesVivas = 0
/** La última transición que puso cada marca de cada elemento: una que se salta no le quita la suya a la que la sigue. */
const duenoDeMarca = new WeakMap<Element, Map<string, number>>()
let siguienteTransicion = 0

function medir(): Map<ZonaMedida, CajaZona> {
  return new Map(
    ZONAS_MEDIDAS.map((zona) => {
      const r = document.querySelector(zona)?.getBoundingClientRect()
      return [zona, r && r.width > 0 && r.height > 0 ? { ancho: Math.round(r.width), alto: Math.round(r.height) } : null]
    })
  )
}

/** Lo que hace falta para que la lista de conexiones, el agente y el texto se abran con el borde de la terminal. */
interface FormaTerminal {
  /** Dónde empieza su texto, desde el borde izquierdo del panel. */
  texto: number
  alto: number
  /** Cuánto baja la lista de conexiones desde el borde superior del panel; `null` si no se ve. */
  riel: number | null
}

function medirForma(): FormaTerminal | null {
  const panel = document.querySelector('.terminal-panel')?.getBoundingClientRect()
  const pila = document.querySelector('.terminal-panel .terminal-stack')?.getBoundingClientRect()
  if (!panel || !pila || panel.height === 0) return null
  const riel = document.querySelector('.terminal-panel .ssh-riel')?.getBoundingClientRect()
  return { texto: pila.left - panel.left, alto: panel.height, riel: riel && riel.width > 0 ? riel.top - panel.top : null }
}

function publicarForma(raiz: HTMLElement, antes: FormaTerminal | null, despues: FormaTerminal | null): void {
  if (!antes || !despues) return
  const crece = Math.abs(despues.alto - antes.alto)
  raiz.style.setProperty('--vt-riel', `${Math.round(Math.abs(despues.texto - antes.texto))}px`)
  raiz.style.setProperty('--vt-crece', `${Math.round(crece)}px`)
  raiz.style.setProperty('--vt-crece-riel', `${Math.round(Math.max(0, crece - (antes.riel ?? despues.riel ?? 0)))}px`)
}

function aplicarConTransicion(aplicar: () => void, { tipo, seVan, aparecen, maximiza, columnaConFranja, morfa }: CambioDeReparto): () => void {
  const ladoDe = (zona: ZonaMedida): 'abajo' | 'derecha' | null => (zona === '.right-panel' && columnaConFranja ? 'abajo' : ladoDeZona(zona))
  const raiz = document.documentElement
  const id = ++siguienteTransicion
  const marcadas: [Element, string][] = []
  const marcar = (el: Element | null, atributo: string, valor = ''): void => {
    if (!el) return
    el.setAttribute(atributo, valor)
    const duenos = duenoDeMarca.get(el) ?? new Map<string, number>()
    duenos.set(atributo, id)
    duenoDeMarca.set(el, duenos)
    marcadas.push([el, atributo])
  }
  const desmarcar = (): void => {
    for (const [el, atributo] of marcadas.splice(0)) if (duenoDeMarca.get(el)?.get(atributo) === id) el.removeAttribute(atributo)
  }
  transicionesVivas++
  raiz.classList.add(CLASE_TRANSICION)
  raiz.classList.toggle(CLASE_CIERRE, tipo === 'cierre')
  raiz.classList.toggle(CLASE_MAXIMIZA, maximiza === true)
  raiz.classList.toggle(CLASE_BLOQUE, maximiza === true && [...seVan, ...aparecen].includes('.right-panel'))
  // Lo que se va lleva otro nombre solo en la captura vieja: así es una zona que sale y no la misma zona con
  // otro contenido, que enseñaría el nuevo mientras se encoge.
  const salen: (readonly [Element, string])[] = seVan.flatMap((zona) => [...document.querySelectorAll(zona)].map((el) => [el, ladoDe(zona) ?? 'funde'] as const))
  // La columna que el bloque va a tapar se queda quieta en su captura; la nueva sube con la franja.
  if ((columnaConFranja || morfa) && aparecen.includes('.right-panel')) for (const el of document.querySelectorAll('.right-panel')) salen.push([el, 'fija'])
  for (const [el, lado] of salen) el.setAttribute(ATRIBUTO_SE_VA, lado)
  const antes = medir()
  raiz.classList.toggle(CLASE_MORFA, morfa === true)
  const formaAntes = morfa ? medirForma() : null
  const t = document.startViewTransition(() => {
    for (const [el] of salen) el.removeAttribute(ATRIBUTO_SE_VA)
    flushSync(aplicar)
    if (formaAntes) publicarForma(raiz, formaAntes, medirForma())
    for (const [zona, despues] of medir()) {
      const el = document.querySelector(zona)
      const lado = ladoDe(zona)
      if (lado !== null && (aparecen as readonly ZonaMedida[]).includes(zona)) {
        marcar(el, ATRIBUTO_ENTRA, lado)
        // El pie lleva su propio nombre para acompañar al borde: al entrar la columna, entra con ella.
        if (zona === '.right-panel') marcar(document.querySelector(PIE_DEL_AGENTE), ATRIBUTO_ENTRA, lado)
        continue
      }
      // Al maximizar o restaurar, lo que estaba tapado no tiene captura vieja que conservar: quedaría en blanco.
      if (maximiza && zona !== '.terminal-panel' && zona !== '.git-log-panel') continue
      // Al abrir un archivo, la captura vieja del agente sale en blanco mientras se monta el editor: mejor la viva.
      if (zona === '.right-panel' && tipo === 'apertura' && !maximiza) continue
      const previa = antes.get(zona) ?? null
      if (conservaCaptura(zona, previa, despues)) marcar(el, ATRIBUTO_CONSERVA, cambiaElTexto(zona, previa, despues) ? 'texto' : '')
    }
  })
  // Con la ventana oculta o minimizada, el navegador se salta la animación y rechaza `ready`: el reparto se
  // aplica igual, así que no es un error.
  t.ready.catch(() => undefined)
  void t.finished.finally(() => {
    desmarcar()
    transicionesVivas--
    if (transicionesVivas > 0) return
    raiz.classList.remove(CLASE_TRANSICION, CLASE_CIERRE, CLASE_MAXIMIZA, CLASE_MORFA, CLASE_BLOQUE)
    for (const v of VARIABLES_FORMA) raiz.style.removeProperty(v)
  })
  return () => {
    for (const [el] of salen) el.removeAttribute(ATRIBUTO_SE_VA)
    t.skipTransition()
    desmarcar()
  }
}

/**
 * El dueño del layout con el layout que se pinta, para que todo lo que lo pinta lea el mismo. Mientras
 * uno nuevo cambia el reparto, lleva el anterior hasta que la transición lo captura (un fotograma) y
 * entonces aplica el último. Sin animación (`animar` falso, movimiento reducido o sin la API) devuelve el
 * nuevo en el mismo render, sin ese retraso.
 */
export function useLayoutConTransicion<T extends { lay: SalidaLayoutCentro; pantallaCompleta: PanelInferiorCentro | null; activeTargetKeyEfectivo: string | null }>(dueno: T, animar: boolean, vista: string): T {
  const visto = useRepartoVisto({ lay: dueno.lay, pantalla: dueno.pantallaCompleta, columna: dueno.activeTargetKeyEfectivo }, animar, vista)
  if (visto.lay === dueno.lay && visto.pantalla === dueno.pantallaCompleta && visto.columna === dueno.activeTargetKeyEfectivo) return dueno
  return { ...dueno, lay: visto.lay, pantallaCompleta: visto.pantalla, activeTargetKeyEfectivo: visto.columna }
}

/**
 * Cambiar de vista (Archivos, Git, Bases de datos) cambia el contexto entero, como en cualquier IDE: el reparto nuevo
 * se aplica al momento, para que la vista esté lista en el primer fotograma.
 */
function useRepartoVisto(reparto: RepartoVisto, animar: boolean, vista: string): RepartoVisto {
  const [visto, setVisto] = useState(reparto)
  const vistaVista = useRef(vista)
  const saltar = useRef<(() => void) | null>(null)
  const ultimo = useRef(reparto)
  ultimo.current = reparto
  const cambia = firmaReparto(reparto) !== firmaReparto(visto)
  const hayAnimacion = cambia && cambioDeReparto(visto, reparto, vistaVista.current, vista) !== null
  const conAnimacion = animar && hayAnimacion && !movimientoReducido() && typeof document.startViewTransition === 'function'
  useLayoutEffect(() => {
    const cambio = cambioDeReparto(visto, ultimo.current, vistaVista.current, vista)
    if (vistaVista.current !== vista) saltar.current?.()
    vistaVista.current = vista
    if (!cambia) return
    const aplicar = (): void => setVisto(ultimo.current)
    if (conAnimacion && cambio !== null) saltar.current = aplicarConTransicion(aplicar, cambio)
    else aplicar()
  }, [cambia, conAnimacion, vista, visto])
  return cambia && conAnimacion ? visto : reparto
}
