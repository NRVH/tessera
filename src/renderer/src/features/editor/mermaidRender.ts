// =============================================================================
// Dibuja diagramas Mermaid: librería cargada bajo demanda y salida saneada con DOMPurify.
// Se carga con `import()` (pesa cerca de un mega) y se cachea la promesa; el SVG se sanea
// aunque mermaid ya lo haga, y un error de sintaxis se devuelve como valor, nunca se lanza.
// El tema sale de la paleta única (`theme/atomOneDark`), no de los presets de mermaid.
// Lo usa `useMermaid`.
// =============================================================================

import DOMPurify from 'dompurify'
import { ATOM_ONE_DARK } from '../../theme/atomOneDark'

/** Módulo de mermaid ya cargado y configurado. Se resuelve una sola vez. */
let cargando: Promise<typeof import('mermaid').default> | null = null

/** Carga mermaid la primera vez y la configura; las siguientes llamadas reciben la misma promesa. */
function mermaidListo(): Promise<typeof import('mermaid').default> {
  if (cargando) return cargando
  cargando = import('mermaid').then(({ default: mermaid }) => {
    const c = ATOM_ONE_DARK
    mermaid.initialize({
      // Nada de barrer el DOM solo: aquí se pinta cuando y donde nosotros decimos.
      startOnLoad: false,
      // 'strict' desactiva los `click` que lanzan javascript: el contenido no es de confianza.
      securityLevel: 'strict',
      // `base` + variables propias: los colores salen de la paleta de Tessera.
      theme: 'base',
      themeVariables: {
        darkMode: true,
        background: c.bg,
        primaryColor: c.surfaceHi,
        primaryTextColor: c.fg,
        primaryBorderColor: c.accent,
        secondaryColor: c.surface,
        tertiaryColor: c.bgElevated,
        lineColor: c.fgMuted,
        textColor: c.fg,
        mainBkg: c.surfaceHi,
        nodeBorder: c.accent,
        clusterBkg: c.bgDeep,
        clusterBorder: c.borderSoft,
        titleColor: c.fg,
        edgeLabelBackground: c.bg,
        fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
        fontSize: '13px'
      }
    })
    return mermaid
  })
  return cargando
}

/** Sanea el SVG con perfil explícito: el de por defecto recorta `<foreignObject>` y filtros. */
function sanearSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    ADD_ATTR: ['dominant-baseline', 'transform-origin']
  })
}

/** Resultado de dibujar un diagrama: o el SVG, o el motivo por el que no salió. */
export type ResultadoMermaid = { ok: true; svg: string } | { ok: false; error: string }

/** Contador para los ids: mermaid EXIGE uno único por render en el documento. */
let secuencia = 0

/** Dibuja un diagrama y devuelve su SVG saneado. Nunca lanza: el error es un valor de retorno. */
export async function dibujarMermaid(codigo: string): Promise<ResultadoMermaid> {
  const fuente = codigo.trim()
  if (fuente === '') return { ok: false, error: 'El diagrama está vacío.' }

  try {
    const mermaid = await mermaidListo()

    // Se valida antes: `render` con un diagrama inválido deja un SVG de error en el <body>.
    const valido = await mermaid.parse(fuente, { suppressErrors: true })
    if (!valido) return { ok: false, error: 'El diagrama tiene un error de sintaxis.' }

    secuencia += 1
    const { svg } = await mermaid.render(`tessera-mermaid-${secuencia}`, fuente)
    return { ok: true, svg: sanearSvg(svg) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
