// =============================================================================
// El tooltip de la app: el texto del `title` de lo que está bajo el ratón, en una caja propia e igual
// en las dos plataformas. Escucha en el documento y vale para cualquier `title` sin tocar a quien lo
// pone: mientras el ratón está encima, el `title` de esa cadena se guarda aparte para que el sistema
// no pinte también el suyo, y vuelve al salir o al pulsar. Posición en `posicionTooltip.ts`; estilo
// en `tooltipPropio.css`.
// Decisiones: docs/decisiones/renderer/tooltip-propio.md
// =============================================================================

import './tooltipPropio.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { posicionTooltip } from './posicionTooltip'

/** Lo que tarda en salir con el ratón quieto, y la ventana en la que el siguiente sale sin esperar. */
const ESPERA_MS = 500
const CALIENTE_MS = 400
/** Cada cuánto se mira, con la caja a la vista, que su ancla siga en la página. */
const VIGIA_MS = 300
/** Donde se guarda el `title` mientras el ratón está encima. */
const GUARDADO = 'data-titulo-propio'

/** El título de `el`, esté puesto o guardado. */
function tituloDe(el: Element): string {
  return (el.getAttribute('title') ?? el.getAttribute(GUARDADO) ?? '').trim()
}

/** Los elementos con título desde `nodo` hacia arriba: el primero es el que se enseña. */
function cadenaDe(nodo: EventTarget | null): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let el = nodo instanceof Element ? nodo : null; el; el = el.parentElement) {
    if (el instanceof HTMLElement && tituloDe(el) !== '') out.push(el)
  }
  return out
}

function guardar(el: HTMLElement): void {
  const t = el.getAttribute('title')
  if (t === null) return
  el.setAttribute(GUARDADO, t)
  el.removeAttribute('title')
}

function devolver(el: HTMLElement): void {
  const t = el.getAttribute(GUARDADO)
  if (t === null) return
  el.removeAttribute(GUARDADO)
  // Si mientras tanto alguien puso otro, manda el suyo.
  if (!el.hasAttribute('title')) el.setAttribute('title', t)
}

interface Visible {
  texto: string
  ancla: HTMLElement
}

/** Estado de la escucha: la cadena con el título guardado y lo que está pendiente. */
interface Escucha {
  cadena: HTMLElement[]
  temporizador: number | undefined
  ocultoEn: number
  /** Se pulsó dentro de esta cadena: hasta salir de ella no se vuelve a enseñar. */
  pulsada: HTMLElement | null
  /** La caja llegó a verse (solo entonces el siguiente sale sin esperar). */
  visto: boolean
  /** Mientras se ve, comprueba que el ancla siga en la página: si desaparece, no hay `pointerout`. */
  vigia: number | undefined
  observador: MutationObserver
  setVisible: (v: Visible | null) => void
}

/** Oculta la caja sin devolver los títulos: el ratón sigue encima. */
function callar(e: Escucha): void {
  window.clearTimeout(e.temporizador)
  window.clearInterval(e.vigia)
  e.vigia = undefined
  if (e.visto) e.ocultoEn = Date.now()
  e.visto = false
  e.setVisible(null)
}

/** Devuelve los títulos guardados y oculta lo que hubiera. */
function soltar(e: Escucha): void {
  callar(e)
  e.observador.disconnect()
  for (const el of e.cadena) devolver(el)
  e.cadena = []
}

/** El ratón entró en algo: guarda los títulos de su cadena y programa el tooltip del más cercano. */
function alEntrar(e: Escucha, ev: PointerEvent): void {
  const cadena = cadenaDe(ev.target)
  if (e.pulsada && cadena.includes(e.pulsada)) return
  e.pulsada = null
  if (cadena[0] !== undefined && cadena[0] === e.cadena[0]) return
  soltar(e)
  if (cadena.length === 0) return
  e.cadena = cadena
  for (const el of cadena) {
    guardar(el)
    e.observador.observe(el, { attributes: true, attributeFilter: ['title'] })
  }
  const ancla = cadena[0]
  const mostrar = (): void => {
    const texto = tituloDe(ancla)
    if (e.cadena[0] !== ancla || !ancla.isConnected || texto === '') return
    e.visto = true
    e.setVisible({ texto, ancla })
    e.vigia = window.setInterval(() => {
      if (!ancla.isConnected) soltar(e)
    }, VIGIA_MS)
  }
  if (Date.now() - e.ocultoEn < CALIENTE_MS) mostrar()
  else e.temporizador = window.setTimeout(mostrar, ESPERA_MS)
}

/** El ratón salió: si fue fuera del ancla, se suelta. */
function alSalir(e: Escucha, ev: PointerEvent): void {
  const ancla = e.cadena[0] ?? e.pulsada
  if (ancla && !(ev.relatedTarget instanceof Node && ancla.contains(ev.relatedTarget))) {
    e.pulsada = null
    soltar(e)
  }
}

/**
 * Escucha en el documento hasta que se llame a lo que devuelve. Pulsar, teclear o desplazar lo que
 * contiene el ancla quitan la caja, como el del sistema. Al pulsar, el título vuelve a su sitio en el
 * acto (quien lo busque tras un clic lo encuentra); al teclear o desplazar se queda guardado hasta
 * salir, o el sistema pintaría el suyo con el ratón aún encima.
 */
function escuchar(setVisible: (v: Visible | null) => void): () => void {
  const e: Escucha = {
    cadena: [],
    temporizador: undefined,
    ocultoEn: 0,
    pulsada: null,
    visto: false,
    vigia: undefined,
    // Un `title` que React reescribe mientras el ratón está encima se vuelve a guardar.
    observador: new MutationObserver((cambios) => {
      for (const c of cambios) if (c.target instanceof HTMLElement && e.cadena.includes(c.target)) guardar(c.target)
    }),
    setVisible
  }
  const entrar = (ev: PointerEvent): void => alEntrar(e, ev)
  const salir = (ev: PointerEvent): void => alSalir(e, ev)
  const pulsar = (): void => {
    e.pulsada = e.cadena[0] ?? null
    soltar(e)
    e.ocultoEn = 0
  }
  const quitar = (): void => {
    soltar(e)
    e.ocultoEn = 0
  }
  const acallar = (ev: Event): void => {
    const ancla = e.cadena[0]
    // Un desplazamiento ajeno (la salida de una terminal que corre) no mueve el ancla: no la toca.
    if (ev.type === 'scroll' && ancla && ev.target instanceof Node && ev.target !== document && !ev.target.contains(ancla)) return
    callar(e)
    e.ocultoEn = 0
  }
  const otros = ['keydown', 'wheel', 'scroll'] as const
  document.addEventListener('pointerover', entrar, true)
  document.addEventListener('pointerout', salir, true)
  document.addEventListener('pointerdown', pulsar, true)
  for (const ev of otros) document.addEventListener(ev, acallar, true)
  window.addEventListener('blur', quitar)
  return () => {
    soltar(e)
    document.removeEventListener('pointerover', entrar, true)
    document.removeEventListener('pointerout', salir, true)
    document.removeEventListener('pointerdown', pulsar, true)
    for (const ev of otros) document.removeEventListener(ev, acallar, true)
    window.removeEventListener('blur', quitar)
  }
}

/** Sigue al ratón y decide qué tooltip se ve. */
function useTooltipPropio(): Visible | null {
  const [visible, setVisible] = useState<Visible | null>(null)
  useEffect(() => escuchar(setVisible), [])
  return visible
}

/** La caja del tooltip, colocada respecto a su ancla una vez medida. */
function CajaTooltip({ texto, ancla }: Visible): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const t = ref.current
    if (!t) return
    const a = ancla.getBoundingClientRect()
    setPos(posicionTooltip(a, { width: t.offsetWidth, height: t.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }))
  }, [texto, ancla])
  return (
    <div ref={ref} className="tooltip-propio" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}>
      {texto}
    </div>
  )
}

/** El tooltip de la app: una sola instancia, en `App.tsx`. */
export function TooltipPropio(): React.JSX.Element | null {
  const visible = useTooltipPropio()
  return visible ? <CajaTooltip {...visible} /> : null
}
