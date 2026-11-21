#!/usr/bin/env node
// =============================================================================
// Prueba de las guardas entre ventanas y del registro de ventanas secundarias
// (`ventanaDe.ts`). Corre bajo `node` llano, simulando dos contextos de ventana
// con constructores distintos (principal e hija).
// =============================================================================

import {
  documentoDe,
  documentoEnfocado,
  documentoVivo,
  esAnimacionCss,
  esBotonHtml,
  esCampoHtml,
  esElemento,
  esElementoHtml,
  esNodo,
  registrarVentanaSecundaria,
  suscribirVentanasSecundarias,
  todasLasVentanas,
  todosLosDocumentos,
  ventanaDe,
  ventanaDeNodo,
  ventanaEnfocada,
  ventanaSecundariaDe,
  ventanasSecundarias
} from './ventanaDe.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Simula un contexto de ventana independiente con su propio constructor `HTMLElement`. */
function crearContextoVentana(enfocada = false) {
  class HtmlElementoPropio {
    nodeType = 1
    tagName: string
    ownerDocument: unknown
    style = {}
    namespaceURI = 'http://www.w3.org/1999/xhtml'
    constructor(etiqueta: string, doc: unknown) {
      this.tagName = etiqueta
      this.ownerDocument = doc
    }
    focus(): void {}
  }
  class SvgElementoPropio {
    nodeType = 1
    tagName = 'svg'
    ownerDocument: unknown
    style = {}
    namespaceURI = 'http://www.w3.org/2000/svg'
    constructor(doc: unknown) {
      this.ownerDocument = doc
    }
  }
  let foco = enfocada
  const ventana: Record<string, unknown> = {
    closed: false,
    HTMLElement: HtmlElementoPropio
  }
  const doc: Record<string, unknown> = {
    nodeType: 9,
    ownerDocument: null,
    defaultView: ventana,
    hasFocus: () => foco
  }
  ventana.document = doc
  return {
    ventana: ventana as unknown as Window,
    doc: doc as unknown as Document,
    ponerFoco: (v: boolean) => {
      foco = v
    },
    cerrar: () => {
      ventana.closed = true
    },
    crearHtml: (etiqueta: string) => new HtmlElementoPropio(etiqueta, doc),
    crearSvg: () => new SvgElementoPropio(doc),
    crearTexto: () => ({ nodeType: 3, ownerDocument: doc })
  }
}

function main(): void {
  hr('Guardas entre ventanas (cross-realm)')

  const principal = crearContextoVentana(false)
  const hija = crearContextoVentana(false)

  const divHija = hija.crearHtml('DIV')
  const botonHija = hija.crearHtml('BUTTON')
  const campoHija = hija.crearHtml('INPUT')
  const svgHija = hija.crearSvg()
  const textoHija = hija.crearTexto()

  check(
    '(1) los constructores de principal e hija son distintos',
    !(divHija instanceof (principal.ventana as unknown as { HTMLElement: new (...a: unknown[]) => unknown }).HTMLElement),
    'instanceof principal falla sobre nodo hijo'
  )
  check(
    '(2) esNodo distingue nodos de valores no-nodo',
    esNodo(divHija) && esNodo(textoHija) && esNodo(hija.doc) && !esNodo(null) && !esNodo(undefined) && !esNodo({}) && !esNodo('texto'),
    'div/texto/doc=true, null/objeto/texto=false'
  )
  check(
    '(3) esElemento solo acepta nodeType === 1',
    esElemento(divHija) && esElemento(svgHija) && !esElemento(textoHija) && !esElemento(hija.doc),
    'div/svg=true, texto/doc=false'
  )
  check(
    '(4) esElementoHtml acepta HTML de otra ventana y descarta SVG',
    esElementoHtml(divHija) && esElementoHtml(botonHija) && !esElementoHtml(svgHija) && !esElementoHtml(textoHija),
    'div/button=true, svg/texto=false'
  )
  check(
    '(5) esElementoHtml sin defaultView usa forma y namespace',
    esElementoHtml({ nodeType: 1, tagName: 'DIV', style: {}, focus: () => {}, namespaceURI: 'http://www.w3.org/1999/xhtml' }) &&
      !esElementoHtml({ nodeType: 1, tagName: 'svg', style: {}, focus: () => {}, namespaceURI: 'http://www.w3.org/2000/svg' }),
    'html sin vista=true, svg sin vista=false'
  )
  check(
    '(6) esBotonHtml y esCampoHtml reconocen etiqueta entre ventanas',
    esBotonHtml(botonHija) && !esBotonHtml(divHija) && esCampoHtml(campoHija) && !esCampoHtml(botonHija),
    'button/input exactos'
  )
  check(
    '(7) esAnimacionCss reconoce CSSAnimation por animationName',
    esAnimacionCss({ animationName: 'mov-panel-entra' }) && !esAnimacionCss({ transitionProperty: 'opacity' }) && !esAnimacionCss(null),
    'animationName=true, transition/null=false'
  )

  hr('Documento y ventana de un nodo')

  const par = ventanaDe(divHija as unknown as Node)
  check(
    '(8) ventanaDe devuelve documento y ventana de la hija',
    par.documento === hija.doc && par.ventana === hija.ventana,
    'coincide con hija'
  )
  check(
    '(9) documentoDe y ventanaDeNodo caen al defecto con null',
    documentoDe(null, principal.doc) === principal.doc && ventanaDeNodo(null, principal.ventana) === principal.ventana,
    'fallback limpio'
  )
  check(
    '(10) documentoDe de un Document devuelve el propio Document',
    documentoDe(hija.doc, principal.doc) === hija.doc,
    'hija.doc'
  )

  hr('Registro de ventanas secundarias y foco')

  let avisos = 0
  const dejarDeOir = suscribirVentanasSecundarias(() => {
    avisos++
  })
  const bajaHija = registrarVentanaSecundaria(hija.ventana, 'perfil-1')
  check(
    '(11) registrar añade la ventana, indexa por clave y notifica',
    ventanasSecundarias().length === 1 && ventanaSecundariaDe('perfil-1') === hija.ventana && avisos === 1,
    `n=${ventanasSecundarias().length}, avisos=${avisos}`
  )
  check(
    '(12) todasLasVentanas y todosLosDocumentos incluyen principal e hija',
    todasLasVentanas(principal.ventana).length === 2 && todosLosDocumentos(principal.doc).length === 2,
    `ventanas=${todasLasVentanas(principal.ventana).length}`
  )

  hija.ponerFoco(true)
  check(
    '(13) ventanaEnfocada y documentoEnfocado devuelven la hija cuando tiene foco',
    ventanaEnfocada(principal.ventana) === hija.ventana && documentoEnfocado(principal.doc) === hija.doc,
    'hija enfocada'
  )

  hija.ponerFoco(false)
  check(
    '(14) sin foco en ninguna hija devuelven la principal',
    ventanaEnfocada(principal.ventana) === principal.ventana && documentoEnfocado(principal.doc) === principal.doc,
    'principal por defecto'
  )

  check(
    '(15) documentoVivo mantiene el de una hija abierta y cae a principal si cerró',
    documentoVivo(hija.doc, principal.doc) === hija.doc,
    'abierta=hija'
  )
  hija.cerrar()
  check(
    '(16) hija cerrada queda fuera de documentoVivo, ventanaSecundariaDe y listas',
    documentoVivo(hija.doc, principal.doc) === principal.doc &&
      ventanaSecundariaDe('perfil-1') === undefined &&
      todasLasVentanas(principal.ventana).length === 1 &&
      todosLosDocumentos(principal.doc).length === 1,
    'cerrada descartada'
  )

  bajaHija()
  bajaHija()
  dejarDeOir()
  check(
    '(17) la baja es idempotente y limpia el registro',
    ventanasSecundarias().length === 0 && avisos === 2,
    `n=${ventanasSecundarias().length}, avisos=${avisos}`
  )
  const otra = crearContextoVentana()
  const bajaOtra = registrarVentanaSecundaria(otra.ventana)
  bajaOtra()
  check(
    'un diálogo pendiente pasa a la principal desde la baja, antes del cierre nativo',
    !otra.ventana.closed && documentoVivo(otra.doc, principal.doc) === principal.doc,
    'ventana aún abierta, destino principal'
  )

  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
