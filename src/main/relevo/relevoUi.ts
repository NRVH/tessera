// =============================================================================
// La ventana del relevo como una cadena de HTML autocontenida: sin React, sin build y sin cargar
// nada del disco de la app (se está reemplazando debajo), con la paleta oscura de Tessera pero
// sin su `styles.css`. Comunicación de UNA dirección: el main pinta por `executeJavaScript`
// (`window.relevo.estado`) y los dos botones avisan por `console.log` de una marca propia, sin
// preload ni IPC. Lo prueba `shared/test-relevo.mts`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

/** Lo que la ventana sabe pintar. */
export interface EstadoRelevo {
  /** Fase: 'esperando' | 'instalando' | 'ok' | 'error' */
  fase: 'esperando' | 'instalando' | 'ok' | 'error'
  titulo: string
  detalle: string
  /** Líneas de registro que se enseñan en el desplegable. */
  log: string[]
}

/**
 * Marcas que la página imprime por consola al pulsar cada botón. Llevan prefijo
 * propio para que ningún mensaje ajeno de Chromium (un aviso de CSP, un recurso que
 * no carga) se confunda con un clic.
 */
export const MARCA_ABRIR = 'tessera-relevo:abrir'
export const MARCA_COPIAR = 'tessera-relevo:copiar'

/** Escapa texto para meterlo en el HTML sin que un `<` rompa la página. */
export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Página del relevo. `versionNueva` sale en el subtítulo desde el primer frame:
 * es la única pregunta que el usuario se hace mirando esta ventana.
 */
export function paginaRelevo(versionActual: string, versionNueva: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Actualizando Tessera</title>
<style>
  :root {
    --bg: #1b1d23; --bg-elev: #22242b; --fg: #d7dae0; --fg-muted: #8b909a;
    --borde: #31343c; --acento: #5aa2e8; --ok: #61ae66; --err: #e06a63;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 13px/1.5 "Segoe UI", system-ui, sans-serif;
    height: 100vh; display: flex; flex-direction: column;
    -webkit-user-select: none; user-select: none;
  }
  .cab { padding: 22px 24px 0; }
  h1 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
  .sub { color: var(--fg-muted); font-size: 12px; }
  .cuerpo { flex: 1; padding: 18px 24px; overflow: hidden; display: flex; flex-direction: column; gap: 14px; }
  .barra { height: 4px; border-radius: 999px; background: #2b2e36; overflow: hidden; }
  .barra i { display: block; height: 100%; width: 40%; border-radius: 999px; background: var(--acento);
             animation: corre 1.1s ease-in-out infinite; }
  @keyframes corre { 0% { margin-left: -40% } 100% { margin-left: 100% } }
  .barra.quieta i { animation: none; width: 100%; }
  .barra.ok i { background: var(--ok); }
  .barra.err i { background: var(--err); }
  .detalle { color: var(--fg-muted); font-size: 12px; white-space: pre-wrap; }
  details { border: 1px solid var(--borde); border-radius: 7px; background: var(--bg-elev);
            overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  summary { padding: 7px 10px; cursor: pointer; color: var(--fg-muted); font-size: 12px; }
  /* flex:1 + min-height:0 y NADA de max-height: el registro tiene que ENCOGER
     hasta el hueco que quede y desplazarse dentro, no crecer y salirse. Con
     max-height medía 107 px dentro de un contenedor de 61 en una ventana de 301,
     y el overflow:hidden recortaba el resto: se veían dos renglones de cinco,
     justo cuando el registro es lo único que explica el fallo.
     (Sin comillas invertidas aquí dentro: esto vive en un template literal y una
     sola las parte en dos.) */
  pre { margin: 0; padding: 0 10px 10px; overflow: auto; flex: 1 1 auto; min-height: 0;
        font: 11px/1.45 Consolas, "Cascadia Mono", monospace; color: var(--fg-muted);
        -webkit-user-select: text; user-select: text; }
  .pie { padding: 0 24px 20px; display: flex; gap: 8px; justify-content: flex-end; }
  button { font: inherit; padding: 6px 14px; border-radius: 7px; cursor: pointer;
           border: 1px solid var(--borde); background: transparent; color: var(--fg); }
  button:hover { border-color: #454a55; }
  button.primario { background: var(--acento); border-color: var(--acento); color: #10131a; font-weight: 600; }
  button[hidden] { display: none; }
</style></head>
<body>
  <div class="cab">
    <h1 id="titulo">Preparando la actualización…</h1>
    <div class="sub">Tessera ${escaparHtml(versionActual)} → ${escaparHtml(versionNueva)}</div>
  </div>
  <div class="cuerpo">
    <div class="barra" id="barra"><i></i></div>
    <div class="detalle" id="detalle">No cierres esta ventana.</div>
    <details id="caja"><summary>Ver registro</summary><pre id="log"></pre></details>
  </div>
  <div class="pie">
    <button id="copiar" hidden>Copiar registro</button>
    <button id="abrir" class="primario" hidden>Abrir Tessera</button>
  </div>
<script>
  const $ = (id) => document.getElementById(id)
  window.relevo = {
    estado(e) {
      $('titulo').textContent = e.titulo
      $('detalle').textContent = e.detalle
      $('log').textContent = e.log.join('\\n')
      $('log').scrollTop = $('log').scrollHeight
      const b = $('barra')
      b.className = 'barra' + (e.fase === 'ok' ? ' quieta ok' : e.fase === 'error' ? ' quieta err' : '')
      const fin = e.fase === 'ok' || e.fase === 'error'
      $('abrir').hidden = !fin
      $('copiar').hidden = !fin
      // El registro se despliega SOLO si algo falló: en el camino feliz nadie lo
      // quiere ver, y en el malo es lo primero que hace falta.
      if (e.fase === 'error') $('caja').open = true
      if (fin) $('abrir').focus()
    }
  }
  $('abrir').addEventListener('click', () => { console.log('${MARCA_ABRIR}') })
  $('copiar').addEventListener('click', () => { console.log('${MARCA_COPIAR}') })
</script>
</body></html>`
}
