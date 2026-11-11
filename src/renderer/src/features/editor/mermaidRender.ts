// =============================================================================
// Dibuja diagramas Mermaid: librería cargada bajo demanda y salida saneada con DOMPurify.
// Se carga con `import()` (pesa cerca de un mega) y se cachea la promesa; el SVG se sanea
// aunque mermaid ya lo haga, y un error de sintaxis se devuelve como valor, nunca se lanza.
// Cada dibujo repone la paleta según el tema declarado y va en fila. Lo usa `useMermaid`.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================

import DOMPurify from 'dompurify'
import { ATOM_ONE_DARK } from '../../theme/atomOneDark'
import { txVistaPrevia } from './textosVisores.ts'
import { fondoDeTemaPropio } from './mermaidTema.ts'

const VARIABLES = {
  darkMode: true,
  background: ATOM_ONE_DARK.bg,
  primaryColor: ATOM_ONE_DARK.surfaceHi,
  primaryTextColor: ATOM_ONE_DARK.fg,
  primaryBorderColor: ATOM_ONE_DARK.accent,
  secondaryColor: ATOM_ONE_DARK.surface,
  tertiaryColor: ATOM_ONE_DARK.bgElevated,
  lineColor: ATOM_ONE_DARK.fgMuted,
  textColor: ATOM_ONE_DARK.fg,
  mainBkg: ATOM_ONE_DARK.surfaceHi,
  nodeBorder: ATOM_ONE_DARK.accent,
  clusterBkg: ATOM_ONE_DARK.bgDeep,
  clusterBorder: ATOM_ONE_DARK.borderSoft,
  titleColor: ATOM_ONE_DARK.fg,
  edgeLabelBackground: ATOM_ONE_DARK.bg,
  fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
  fontSize: '13px'
}

const CONFIG_NEUTRA = {
  // Nada de barrer el DOM solo: aquí se pinta cuando y donde nosotros decimos.
  startOnLoad: false,
  // 'strict' desactiva los `click` que lanzan javascript: el contenido no es de confianza.
  securityLevel: 'strict' as const
}
const CONFIG_APP = { ...CONFIG_NEUTRA, theme: 'base' as const, themeVariables: VARIABLES }

/** Módulo de mermaid cargado bajo demanda. Se resuelve una sola vez. */
let cargando: Promise<typeof import('mermaid').default> | null = null

/** Carga mermaid la primera vez; las siguientes llamadas reciben la misma promesa. */
function mermaidListo(): Promise<typeof import('mermaid').default> {
  if (cargando) return cargando
  cargando = import('mermaid').then(({ default: mermaid }) => mermaid)
  return cargando
}

let fila: Promise<unknown> = Promise.resolve()

/** La configuración de mermaid es global y cada dibujo la repone. */
function enFila<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = fila.then(tarea, tarea)
  fila = resultado.then(() => undefined, () => undefined)
  return resultado
}

/**
 * Sanea el SVG con perfil explícito: el de por defecto recorta `<foreignObject>` y filtros. Las etiquetas de un
 * diagrama son HTML dentro de `<foreignObject>`: sin declararlo punto de integración, la etiqueta se conserva
 * pero su contenido se borra y el diagrama sale sin texto.
 */
function sanearSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    ADD_ATTR: ['dominant-baseline', 'transform-origin']
  })
}

/** Dibujos en curso con las medidas ajustadas: el ajuste se quita cuando acaba el último. */
let midiendo = 0

/**
 * Mientras se dibuja, el ancho que mide un `<div>` se redondea al entero si está a menos de una décima.
 * Mermaid decide si una etiqueta se parte en líneas comparando su ancho con el máximo por igualdad exacta, y con
 * el zoom de la ventana distinto de 100 % el navegador devuelve 199,99 en vez de 200: la etiqueta se quedaría en
 * una línea, cortada por su recuadro. Devuelve cómo deshacerlo.
 */
function ajustarMedidas(): () => void {
  const prototipo = HTMLDivElement.prototype as { getBoundingClientRect?: () => DOMRect }
  if (midiendo === 0) {
    const medir = Element.prototype.getBoundingClientRect
    Object.defineProperty(prototipo, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function (this: Element): DOMRect {
        const r = medir.call(this)
        const entero = Math.round(r.width)
        return r.width !== entero && Math.abs(r.width - entero) < 0.1 ? new DOMRect(r.x, r.y, entero, r.height) : r
      }
    })
  }
  midiendo += 1
  return () => {
    midiendo -= 1
    if (midiendo === 0) delete prototipo.getBoundingClientRect
  }
}

/** Resultado de dibujar un diagrama: o el SVG, o el motivo por el que no salió. */
export type ResultadoMermaid = { ok: true; svg: string; fondo: string | null } | { ok: false; error: string }

/** Contador para los ids: mermaid EXIGE uno único por render en el documento. */
let secuencia = 0

/** Dibuja un diagrama y devuelve su SVG saneado. Nunca lanza: el error es un valor de retorno. */
export async function dibujarMermaid(codigo: string): Promise<ResultadoMermaid> {
  const fuente = codigo.trim()
  if (fuente === '') return { ok: false, error: txVistaPrevia().diagramaVacio }

  try {
    return await enFila<ResultadoMermaid>(async () => {
      const mermaid = await mermaidListo()
      mermaid.initialize(CONFIG_APP)
      // Se valida antes: `render` con un diagrama inválido deja un SVG de error en el <body>.
      const analizado = await mermaid.parse(fuente, { suppressErrors: true })
      if (!analizado) return { ok: false, error: txVistaPrevia().diagramaSintaxis }
      const fondo = fondoDeTemaPropio(analizado.config ?? {})
      mermaid.initialize(fondo === null ? CONFIG_APP : CONFIG_NEUTRA)

      secuencia += 1
      const deshacer = ajustarMedidas()
      try {
        const { svg } = await mermaid.render(`tessera-mermaid-${secuencia}`, fuente)
        return { ok: true, svg: sanearSvg(svg), fondo }
      } finally {
        deshacer()
      }
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
