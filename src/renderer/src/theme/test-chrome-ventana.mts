#!/usr/bin/env node
// =============================================================================
// Prueba del hueco de los botones de la ventana (node src/renderer/src/theme/test-chrome-ventana.mts).
// Sobre todo un test de texto: lee main/app/ventana.ts, styles.css y theme/chromeVentana.ts,
// sin comentarios, y comprueba que siguen de acuerdo (`.titlebar` en las dos plataformas,
// las opciones de la ventana, ningún ancho fijo del semáforo, la pantalla completa de Mac).
// Ejecuta además `seguirSemaforo` con un overlay falso.
// Decisiones: docs/decisiones/renderer/hueco-de-botones-de-ventana.md
// =============================================================================

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seguirSemaforo } from './chromeVentana.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

function leer(relativa: string): string {
  return readFileSync(fileURLToPath(new URL(relativa, import.meta.url)), 'utf8')
}
/** Quita comentarios de bloque (`/* … *\/`, también los JSDoc) y de línea (`// …`). */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
/**
 * Cuerpo de la primera regla CSS cuyo selector es exactamente `selector`.
 *
 * ANCLADO A PRINCIPIO DE REGLA a propósito. Con un `indexOf('.titlebar {')` bastaba
 * con que alguien reordenara el bloque para que `.titlebar` casara DENTRO de
 * `:root[data-plataforma='mac'] .titlebar {`, y el check (2) diría que Windows ha
 * perdido `env(titlebar-area-width)` sin que haya pasado nada. Falla del lado seguro
 * —falso FAIL, no falso PASS—, pero es un fantasma que cuesta media hora entender.
 * Por eso el selector tiene que ir precedido de principio de archivo, `}`, `;`, `/`
 * o salto de línea: nunca de otro selector.
 */
function reglaCss(css: string, selector: string): string | null {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const i = css.search(new RegExp(`(^|[};/\\n])\\s*${escapado}\\s*\\{`))
  if (i < 0) return null
  const abre = css.indexOf('{', i)
  const fin = css.indexOf('}', abre)
  return css.slice(abre + 1, fin)
}

const stylesCss = sinComentarios(leer('../styles.css'))
const ventanaTs = sinComentarios(leer('../../../main/app/ventana.ts'))
const chromeVentanaTs = sinComentarios(leer('./chromeVentana.ts'))
const mainTsx = sinComentarios(leer('../main.tsx'))

// -----------------------------------------------------------------------------
hr('(1) .titlebar en macOS: el hueco lo da env(titlebar-area-x) y va a la izquierda')
{
  const regla = reglaCss(stylesCss, ":root[data-plataforma='mac'] .titlebar")
  check('existe la regla de mac', regla !== null, regla === null ? 'no encontrada' : regla.trim().replace(/\s+/g, ' '))
  const izq = regla?.match(/padding-left:\s*env\(titlebar-area-x,\s*(\d+)px\)/)
  check('padding-left es env(titlebar-area-x, <fallback>px)', izq !== null && izq !== undefined, izq ? `fallback=${izq[1]}px` : 'no casa')
  check('fallback ≈ ancho del semáforo (60..100 px)', !!izq && Number(izq[1]) >= 60 && Number(izq[1]) <= 100, izq ? izq[1] : '—')
  check('padding-right: 0 (no se suma al hueco de Windows)', /padding-right:\s*0\s*;/.test(regla ?? ''), regla?.match(/padding-right:[^;]*/)?.[0] ?? '—')
  check('no queda var(--semaforo-w) en la regla', !/--semaforo-w/.test(regla ?? ''), regla?.match(/--semaforo-w[^;]*/)?.[0] ?? 'sin --semaforo-w')
}

// -----------------------------------------------------------------------------
hr('(2) .titlebar en Windows: sigue con env(titlebar-area-width)')
{
  const regla = reglaCss(stylesCss, '.titlebar')
  check('existe la regla base', regla !== null, regla === null ? 'no encontrada' : regla.trim().replace(/\s+/g, ' ').slice(0, 80))
  check('padding-right usa env(titlebar-area-width, …)', /padding-right:[^;]*env\(titlebar-area-width,/.test(regla ?? ''), regla?.match(/padding-right:[^;]*/)?.[0] ?? '—')
}

// -----------------------------------------------------------------------------
hr('(3) opcionesDeVentana: titleBarOverlay en las dos plataformas, sólo height en Mac')
{
  const ini = ventanaTs.indexOf('function opcionesDeVentana(')
  const fin = ventanaTs.indexOf('webPreferences:', ini)
  const cuerpo = ini >= 0 && fin > ini ? ventanaTs.slice(ini, fin) : ''
  check('opcionesDeVentana localizado (hasta webPreferences)', cuerpo.length > 0, `${cuerpo.length} chars`)
  const ternario = cuerpo.match(/esMac\(\)\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{([\s\S]*?)\}\s*\)/)
  check('hay un ternario esMac() ? {…} : {…} con las opciones por plataforma', ternario !== null, ternario ? 'ok' : 'no casa')
  const mac = ternario?.[1] ?? ''
  const win = ternario?.[2] ?? ''
  check('rama Mac: trafficLightPosition (lo que Chromium mide)', /trafficLightPosition:/.test(mac), mac.trim().replace(/\s+/g, ' ').slice(0, 120))
  check('rama Mac: titleBarOverlay con height: TITLEBAR_HEIGHT', /titleBarOverlay:\s*\{\s*height:\s*TITLEBAR_HEIGHT\s*\}/.test(mac), mac.match(/titleBarOverlay:[^}]*\}/)?.[0] ?? 'sin titleBarOverlay')
  check('rama Mac: SIN color ni symbolColor (son de Windows)', !/color:|symbolColor:/.test(mac), mac.match(/(?:symbol)?[Cc]olor:[^,}]*/)?.[0] ?? 'sin color ni symbolColor')
  check('rama Windows: titleBarOverlay con color, symbolColor y height', /titleBarOverlay:\s*\{[^}]*color:[^}]*symbolColor:[^}]*height:\s*TITLEBAR_HEIGHT[^}]*\}/.test(win), win.match(/titleBarOverlay:[^}]*\}/)?.[0]?.replace(/\s+/g, ' ') ?? 'sin titleBarOverlay')
}

// -----------------------------------------------------------------------------
hr('(4) Sin gemelo del ancho del semáforo en el renderer (fuera de comentarios)')
{
  // TODO el renderer y no una lista de archivos: al partir App.tsx el código de la
  // barra de título se repartió en features/, y una lista fija se quedaba mirando
  // archivos donde ya no vive nada (la guarda pasaba en vacío).
  const gemelo = /--semaforo-w|ANCHO_SEMAFORO|publicarHuecoSemaforo|factorDeNivel/
  const raiz = fileURLToPath(new URL('../', import.meta.url))
  const fuentes = (readdirSync(raiz, { recursive: true }) as string[])
    .map((r) => r.replace(/\\/g, '/'))
    .filter((r) => /\.(ts|tsx|css)$/.test(r))
  check('se escanea el renderer entero (> 100 fuentes, App.tsx y features/ incluidos)', fuentes.length > 100 && fuentes.includes('App.tsx') && fuentes.some((r) => r.startsWith('features/layout/')), `${fuentes.length} fuentes`)
  const conGemelo = fuentes.flatMap((r) => {
    const hit = sinComentarios(readFileSync(join(raiz, r), 'utf8')).match(gemelo)
    return hit ? [`${r}: "${hit[0]}"`] : []
  })
  check('ningún fuente del renderer tiene el gemelo', conGemelo.length === 0, conGemelo.length ? conGemelo.join('; ') : 'limpio')
}

// -----------------------------------------------------------------------------
hr('(5) chromeVentana.ts exporta sólo marcarPlataforma y seguirSemaforo')
{
  const exportadas = [...chromeVentanaTs.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1])
  check(
    'exports === [marcarPlataforma, seguirSemaforo]',
    JSON.stringify(exportadas) === JSON.stringify(['marcarPlataforma', 'seguirSemaforo']),
    JSON.stringify(exportadas)
  )
  check('main.tsx la importa y la llama', /marcarPlataforma\(\)/.test(mainTsx) && /from '\.\/theme\/chromeVentana'/.test(mainTsx), `importa=${/from '\.\/theme\/chromeVentana'/.test(mainTsx)} llama=${/marcarPlataforma\(\)/.test(mainTsx)}`)
  check('main.tsx llama también a seguirSemaforo()', /seguirSemaforo\(\)/.test(mainTsx), /seguirSemaforo\(\)/.test(mainTsx) ? 'llama' : 'no la llama')
}

// -----------------------------------------------------------------------------
hr('(6) Pantalla completa en Mac: sin semáforo no hay hueco, y Windows no se entera')
{
  const cerrada = reglaCss(stylesCss, ":root[data-plataforma='mac'][data-semaforo='oculto'] .titlebar")
  check(
    'existe la regla que cierra el hueco con el semáforo oculto',
    cerrada !== null,
    cerrada === null ? 'no encontrada' : cerrada.trim().replace(/\s+/g, ' ')
  )
  check('y pone padding-left: 0', /padding-left:\s*0\s*;/.test(cerrada ?? ''), cerrada?.match(/padding-left:[^;]*/)?.[0] ?? '—')

  // El botón: la regla de Mac que lo pega al semáforo tiene que DEJAR DE CASAR sin él,
  // para que mande la general (la del eje del riel). Si quedara la versión sin `:not`,
  // ganaría por especificidad y el botón seguiría en 0 con la barra ya sin hueco.
  const pegada = reglaCss(stylesCss, ":root[data-plataforma='mac']:not([data-semaforo='oculto']) .titlebar-inicio")
  check('la regla de Mac del botón lleva :not([data-semaforo=oculto])', pegada !== null && /padding-left:\s*0\s*;/.test(pegada), pegada?.trim().replace(/\s+/g, ' ') ?? 'no encontrada')
  const sinNot = reglaCss(stylesCss, ":root[data-plataforma='mac'] .titlebar-inicio")
  check('no queda la regla de Mac del botón SIN el :not', sinNot === null, sinNot === null ? 'no está' : sinNot.trim().replace(/\s+/g, ' '))
  const general = reglaCss(stylesCss, '.titlebar-inicio')
  check(
    'la general sigue centrando el botón en el eje del riel (es la que hereda Mac sin semáforo)',
    /padding-left:\s*calc\(\(var\(--activity-width\)\s*-\s*28px\)\s*\/\s*2\)/.test(general ?? ''),
    general?.match(/padding-left:[^;]*/)?.[0] ?? '—'
  )

  // Windows no puede verse afectado: toda regla con la marca va además acotada a Mac.
  const selectoresConMarca = [...stylesCss.matchAll(/[^{}]*data-semaforo[^{}]*\{/g)].map((m) => m[0].trim())
  check('hay reglas con la marca', selectoresConMarca.length > 0, `${selectoresConMarca.length}`)
  const sueltos = selectoresConMarca.filter((s) => !s.includes("[data-plataforma='mac']"))
  check('todas acotadas a [data-plataforma=mac]', sueltos.length === 0, sueltos.length ? JSON.stringify(sueltos) : 'sí')

  check(
    'no lee la MEDIDA del overlay (esa sigue siendo del env() del CSS)',
    !/getTitlebarAreaRect/.test(chromeVentanaTs),
    /getTitlebarAreaRect/.test(chromeVentanaTs) ? 'la lee' : 'no la lee'
  )
}

// -----------------------------------------------------------------------------
// ESTO SÍ ES LÓGICA, y se ejecuta: `seguirSemaforo` recibe la plataforma, el overlay y
// la raíz por parámetro, así que corre en node con un `EventTarget` falso. Los tres
// primeros casos son los tres modos en que nace un documento, medidos con Electron 43
// (ver la cabecera de chromeVentana.ts); el de la recarga en pantalla completa es el
// que se escapaba cuando sólo se escuchaba el evento.
hr('(7) seguirSemaforo: marca con el semáforo oculto, en los tres nacimientos del documento')
{
  function overlayFalso(visible: boolean): EventTarget & { visible: boolean; mover: (v: boolean) => void } {
    const o = Object.assign(new EventTarget(), {
      visible,
      mover(v: boolean): void {
        o.visible = v
        o.dispatchEvent(new Event('geometrychange'))
      }
    })
    return o
  }
  function raizFalsa(): { dataset: DOMStringMap } {
    const dataset: DOMStringMap = {}
    return { dataset }
  }

  {
    // Arranque en frío: nace sin overlay y el primer evento lo trae.
    const o = overlayFalso(false)
    const r = raizFalsa()
    seguirSemaforo('mac', o, r)
    check('frío: al nacer sin overlay, marca (aún no se sabe)', r.dataset.semaforo === 'oculto', String(r.dataset.semaforo))
    o.mover(true)
    check('frío: llega el overlay → sin marca', r.dataset.semaforo === undefined, String(r.dataset.semaforo))
  }
  {
    // Recarga en ventana, y luego ida y vuelta a pantalla completa.
    const o = overlayFalso(true)
    const r = raizFalsa()
    seguirSemaforo('mac', o, r)
    check('en ventana: sin marca desde el principio', r.dataset.semaforo === undefined, String(r.dataset.semaforo))
    o.mover(false)
    check('entra en pantalla completa → marca', r.dataset.semaforo === 'oculto', String(r.dataset.semaforo))
    o.mover(true)
    check('sale → sin marca', r.dataset.semaforo === undefined, String(r.dataset.semaforo))
  }
  {
    // Recarga EN pantalla completa: nace sin semáforo y NO llega ningún evento.
    const o = overlayFalso(false)
    const r = raizFalsa()
    seguirSemaforo('mac', o, r)
    check('recarga en pantalla completa: marca SIN esperar evento', r.dataset.semaforo === 'oculto', String(r.dataset.semaforo))
    o.mover(true)
    check('y al salir, sin marca', r.dataset.semaforo === undefined, String(r.dataset.semaforo))
  }
  {
    // Windows: con el overlay oculto (lo que sea que haga con F11) no se marca nunca.
    const o = overlayFalso(false)
    const r = raizFalsa()
    seguirSemaforo('windows', o, r)
    o.mover(false)
    o.mover(true)
    o.mover(false)
    check('windows: nunca marca, ni al nacer ni con eventos', r.dataset.semaforo === undefined, JSON.stringify(r.dataset))
  }
  {
    // Mac sin overlay (una ventana creada sin `titleBarOverlay`): no revienta ni marca.
    const r = raizFalsa()
    let error = ''
    try {
      seguirSemaforo('mac', undefined, r)
    } catch (e) {
      error = String(e)
    }
    check('mac sin overlay: ni error ni marca', error === '' && r.dataset.semaforo === undefined, error || JSON.stringify(r.dataset))
  }
}

// -----------------------------------------------------------------------------
const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
