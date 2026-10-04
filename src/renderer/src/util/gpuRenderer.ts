// =============================================================================
// Detección (UNA vez, memoizada) de si conviene el renderer WebGL de xterm o el DOM: con una
// GPU real se usa WebGL; con renderizado por software (VMs, drivers caídos) cae al DOM.
// Se sondea el nombre del renderer vía WEBGL_debug_renderer_info. Si el contexto WebGL se pierde
// en caliente, el pane descarta el addon y el DOM toma el relevo.
// Depende solo del DOM del navegador (un lienzo de sondeo).
// =============================================================================

export interface GpuDecision {
  /** true = cargar el addon WebGL; false = quedarse con el renderer DOM. */
  useWebgl: boolean
  /** Nombre del renderer detectado ('' si no se pudo leer). Para mostrar en Ajustes. */
  renderer: string
}

/** Rasterizadores por SOFTWARE (sin GPU real): ahí el DOM rinde mejor que WebGL. */
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|paravirtual/i

let cached: GpuDecision | null = null

/** Decisión de renderer, calculada una sola vez por sesión (barato reusarla en cada pane). */
export function detectGpuRenderer(): GpuDecision {
  if (cached) return cached
  let renderer = ''
  let useWebgl = false
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : ''
      // Hay contexto WebGL y NO es software → usar WebGL (GPU presente).
      useWebgl = !SOFTWARE_RE.test(renderer)
      // Libera el contexto de sondeo (no lo dejamos ocupando una ranura de GL).
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    useWebgl = false
  }
  cached = { useWebgl, renderer }
  return cached
}

/**
 * DEVUELVE a Chromium el contexto WebGL de unos lienzos que se acaban de tirar.
 *
 * El addon WebGL de xterm, al desecharse, QUITA su lienzo del DOM pero no llama a
 * `loseContext()`, así que el contexto sigue vivo —ocupando una de las ~16 ranuras de
 * Chromium— hasta que lo recoja la basura, que no tiene prisa. Mientras sólo había un
 * pane a la vista daba igual; el mosaico crea y tira hasta seis de golpe cada vez que
 * se entra y se sale, y al pasar del tope Chromium pierde el contexto MÁS VIEJO, que
 * puede ser el de una terminal a la vista (se queda en negro tres segundos y cae al
 * renderer DOM). Es el mismo gesto que ya hace `detectGpuRenderer` con su lienzo de
 * sondeo.
 *
 * Se pide `webgl2` porque es lo que crea el addon: `getContext` devuelve el contexto
 * EXISTENTE de ese tipo, y null si el lienzo tiene otro (el de enlaces de xterm es 2D).
 * Los lienzos se recogen ANTES de desechar el addon y se sueltan DESPUÉS: así su
 * escucha de `webglcontextlost` ya no existe y no se dispara un "contexto perdido"
 * que reintentaría montarlo.
 */
export function soltarContextosWebgl(lienzos: readonly HTMLCanvasElement[]): void {
  for (const lienzo of lienzos) {
    try {
      const gl = lienzo.getContext('webgl2') as WebGL2RenderingContext | null
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* un lienzo ya liberado o de otro tipo: nada que devolver */
    }
  }
}

/** Lo mínimo del hueco de una terminal para recoger sus lienzos. */
interface ConLienzos {
  querySelectorAll(selector: 'canvas'): ArrayLike<HTMLCanvasElement>
}

/**
 * Desecha lo que pinta con WebGL en `host` (el addon al ocultarse, el xterm entero al
 * desmontarse) devolviendo sus contextos: recoge los lienzos, desecha y los suelta, en
 * ese orden (ver `soltarContextosWebgl`). Con `conWebgl` en false solo desecha.
 */
export function desecharWebgl(host: ConLienzos | null | undefined, desechable: { dispose(): void }, conWebgl = true): void {
  const lienzos = conWebgl && host ? Array.from(host.querySelectorAll('canvas')) : []
  desechable.dispose()
  soltarContextosWebgl(lienzos)
}

/**
 * Nombre "limpio" de la GPU para mostrar en la UI. Chromium suele envolverlo en
 * `ANGLE (Vendor, <GPU> DirectX..., D3D11)`; extrae el trozo legible del medio.
 */
export function prettyGpuName(renderer: string): string {
  if (!renderer) return ''
  const angle = renderer.match(/^ANGLE \(([^,]+),\s*(.+?)(?:\s+Direct3D|\s+vs_|,).*\)$/i)
  const name = angle ? angle[2] : renderer
  return name.replace(/\s*\(0x[0-9a-fA-F]+\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}
