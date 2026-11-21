// =============================================================================
// Documento de la franja, con el aspecto del renderer y su propia barra de título.
// Refleja estilos y raíz, prepara las capas flotante y de diálogos de la hija,
// instala el resaltado de barras al desplazar y registra la ventana secundaria.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { PREFIJO_MARCO_FRANJA } from '../../../../shared/franja-ipc'
import { instalarBarrasAlDesplazar } from '../../comun/barrasDesplazamiento'
import { ID_CAPA_FLOTANTE } from '../../comun/capaFlotante'
import { asegurarEstilosMenuContextual } from '../../comun/menuContextualEstilos'
import { ID_CAPA_DIALOGOS } from '../../comun/Modal'
import { seguirSemaforo } from '../../theme/chromeVentana'
import { registrarVentanaSecundaria } from '../../util/ventanaDe'

function esperarHojas(documento: Document, senal: AbortSignal): Promise<boolean> {
  const pendientes = Array.from(documento.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .filter((hoja) => !hoja.sheet && !hoja.disabled)
  if (pendientes.length === 0) return Promise.resolve(true)
  return new Promise((resolver) => {
    const escucha = new AbortController()
    let quedan = pendientes.length
    const terminar = (listos: boolean): void => {
      window.clearTimeout(tope)
      escucha.abort()
      senal.removeEventListener('abort', cancelar)
      resolver(listos)
    }
    const cancelar = (): void => terminar(false)
    const tope = window.setTimeout(cancelar, 4000)
    senal.addEventListener('abort', cancelar, { once: true })
    for (const hoja of pendientes) {
      hoja.addEventListener('load', () => { if (--quedan === 0) terminar(true) }, { once: true, signal: escucha.signal })
      hoja.addEventListener('error', cancelar, { once: true, signal: escucha.signal })
    }
  })
}

function reflejarDocumento(destino: Document): () => void {
  const base = destino.createElement('base')
  base.href = document.baseURI
  destino.head.append(base)
  const copias = new Map<Element, Element>()
  const reflejarEstilos = (): void => {
    const originales = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))
    for (const [original, copia] of copias) {
      if (originales.includes(original)) continue
      copia.remove()
      copias.delete(original)
    }
    let anterior: Element = base
    for (const original of originales) {
      let copia = copias.get(original)
      if (!copia || !copia.isEqualNode(original)) {
        copia?.remove()
        copia = destino.importNode(original, true)
        copias.set(original, copia)
      }
      if (anterior.nextElementSibling !== copia) anterior.after(copia)
      anterior = copia
    }
  }
  const raiz = destino.documentElement
  const reflejarRaiz = (): void => {
    const origen = document.documentElement
    for (const nombre of raiz.getAttributeNames()) {
      if (nombre !== 'data-semaforo' && nombre !== 'class' && !origen.hasAttribute(nombre)) raiz.removeAttribute(nombre)
    }
    for (const { name: nombre, value: valor } of origen.attributes) {
      if (nombre !== 'data-semaforo' && nombre !== 'class') raiz.setAttribute(nombre, valor)
    }
  }
  reflejarEstilos()
  reflejarRaiz()
  const estilos = new MutationObserver(reflejarEstilos)
  const atributos = new MutationObserver(reflejarRaiz)
  estilos.observe(document.head, { childList: true, subtree: true, attributes: true, characterData: true })
  atributos.observe(document.documentElement, { attributes: true })
  return () => {
    estilos.disconnect()
    atributos.disconnect()
  }
}

export function prepararDocumentoFranja(ventana: Window, tituloInicial?: string) {
  const doc = ventana.document
  // Asegura la hoja del menú contextual en la principal antes del primer reflejo para que
  // el primer menú abierto en la hija mida ya con sus estilos aplicados.
  asegurarEstilosMenuContextual()
  const dejarDeObservar = reflejarDocumento(doc)
  const quitarBarras = instalarBarrasAlDesplazar(doc)
  const perfil = ventana.name.startsWith(PREFIJO_MARCO_FRANJA) ? ventana.name.slice(PREFIJO_MARCO_FRANJA.length) : undefined
  const quitarVentana = registrarVentanaSecundaria(ventana, perfil || undefined)
  const espera = new AbortController()
  const estilosListos = esperarHojas(doc, espera.signal)
  const dejarDeReflejar = (): void => {
    espera.abort()
    dejarDeObservar()
    quitarBarras()
    quitarVentana()
  }
  seguirSemaforo(window.tessera.plataforma, undefined, doc.documentElement, ventana.navigator)
  const marco = doc.createElement('div')
  marco.className = 'shell ventana-franja franja-pantalla-completa'
  const barra = doc.createElement('header')
  barra.className = 'titlebar'
  if (tituloInicial) doc.title = tituloInicial
  const cuerpo = doc.createElement('div')
  cuerpo.className = 'shell-body'
  const riel = doc.createElement('div')
  riel.className = 'anfitrion-movil'
  const lienzo = doc.createElement('main')
  lienzo.className = 'shell-main'
  const lateral = doc.createElement('div')
  lateral.className = 'shell-main-top'
  const agentes = doc.createElement('section')
  agentes.className = 'right-panel cc-panel'
  const divisor = doc.createElement('div')
  divisor.className = 'anfitrion-movil'
  lateral.append(divisor, agentes)
  lienzo.append(lateral)
  cuerpo.append(riel, lienzo)
  const pie = doc.createElement('div')
  pie.className = 'anfitrion-movil'
  // Dentro de `.shell` y fuera de `.shell-main`, igual que en `App.tsx`, para heredar `--perfil`.
  const capaFlotante = doc.createElement('div')
  capaFlotante.id = ID_CAPA_FLOTANTE
  capaFlotante.className = 'capa-flotante'
  const capaDialogos = doc.createElement('div')
  capaDialogos.id = ID_CAPA_DIALOGOS
  capaDialogos.className = 'capa-dialogos'
  marco.append(barra, cuerpo, pie, capaFlotante, capaDialogos)
  doc.body.append(marco)
  return { marco, riel, lienzo, lateral, agentes, divisor, pie, dejarDeReflejar, estilosListos }
}
