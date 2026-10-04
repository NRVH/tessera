#!/usr/bin/env node
// =============================================================================
// Prueba de la capa PURA de la acción rápida del Finder (npm run test:servicio-finder): la ruta
// del servicio, la disponibilidad en las dos plataformas (por parámetro), `rutaAppDesdeEjecutable`,
// las claves del `Info.plist` que ponen la entrada solo en el Finder, el `document.wflow` (comando
// e `inputMethod` 1), el escapado ida y vuelta (shell dentro de XML) y la reconciliación
// `appDelWflow(contenidoWflow(x)) === x`. No toca `~/Library/Services` ni llama a `pbs`: eso
// ensuciaría el menú de quien lo ejecuta; el registro real se comprobó a mano (ver el ADR).
// Decisiones: docs/decisiones/sistema/accion-rapida-del-finder.md
// =============================================================================

import { register } from 'node:module'

// Resolver-hook: los módulos de producción importan sin extensión ('../../shared/x').
// Node ejecutando .ts por type-stripping no resuelve extensionless: se reintenta con .ts.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))

const {
  NOMBRE_SERVICIO,
  ID_SERVICIO,
  appDelWflow,
  comandoDeApertura,
  contenidoInfoPlist,
  contenidoWflow,
  disponibilidadFinder,
  escaparParaComillasDobles,
  escaparXml,
  rutaAppDesdeEjecutable,
  rutaServicioFinder
} = await import('./servicioFinder.ts')

let pasados = 0
let total = 0

function hr(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 68 - title.length))}`)
}

function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasados++
  console.log(`  ${pass ? '✓' : '✗'} ${name}${evidence === '' ? '' : ` — ${evidence}`}`)
}

const APP = '/Applications/Tessera.app'
const EXE = `${APP}/Contents/MacOS/Tessera`

// ── (A) La ruta del servicio ─────────────────────────────────────────────────
hr('(A) dónde se instala')
{
  const r = rutaServicioFinder('/Users/ana')
  check(
    '(A1) va a ~/Library/Services',
    r === `/Users/ana/Library/Services/${NOMBRE_SERVICIO}.workflow`,
    r
  )
  check('(A2) la carpeta acaba en .workflow', r.endsWith('.workflow'), r)
  // El nombre se enseña en el menú del Finder. «Abrir con» ya lo pone el paquete: si
  // este dijera lo mismo habría dos entradas casi homónimas en el mismo menú.
  check(
    '(A3) el nombre no choca con el «Abrir con» del paquete',
    !NOMBRE_SERVICIO.startsWith('Abrir con'),
    NOMBRE_SERVICIO
  )
}

// ── (B) Disponibilidad en las dos plataformas ────────────────────────────────
hr('(B) dónde se puede instalar (las dos plataformas, desde ésta)')
{
  const empaquetada = { empaquetada: true, execPath: EXE }
  check(
    '(B1) mac empaquetada: ok',
    disponibilidadFinder(empaquetada, 'mac') === 'ok',
    disponibilidadFinder(empaquetada, 'mac')
  )
  check(
    '(B2) windows: otro-sistema',
    disponibilidadFinder(empaquetada, 'windows') === 'otro-sistema',
    disponibilidadFinder(empaquetada, 'windows')
  )
  check(
    '(B3) otra (linux/bsd): otro-sistema',
    disponibilidadFinder(empaquetada, 'otra') === 'otro-sistema',
    disponibilidadFinder(empaquetada, 'otra')
  )
  // `npm run dev`: el ejecutable es el Electron de node_modules. Registrarlo dejaría una
  // acción rápida que abre un Electron vacío.
  const dev = { empaquetada: false, execPath: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' }
  check(
    '(B4) mac en desarrollo: desarrollo, no ok',
    disponibilidadFinder(dev, 'mac') === 'desarrollo',
    disponibilidadFinder(dev, 'mac')
  )
  // Empaquetada pero sin `.app` en la ruta: no debería pasar, y si pasa se dice.
  const raro = { empaquetada: true, execPath: '/opt/tessera/bin/tessera' }
  check(
    '(B5) empaquetada sin bundle: sin-bundle',
    disponibilidadFinder(raro, 'mac') === 'sin-bundle',
    disponibilidadFinder(raro, 'mac')
  )
}

// ── (C) La ruta del .app a partir del ejecutable ─────────────────────────────
hr('(C) de qué .app se saca la ruta que se hornea')
{
  check('(C1) caso normal', rutaAppDesdeEjecutable(EXE) === APP, String(rutaAppDesdeEjecutable(EXE)))
  // Un `.app` dentro de otro: se quiere el INTERIOR, que es el que se lanza.
  const anidado = '/Applications/Taller.app/Contents/Applications/Analizador.app/Contents/MacOS/Analizador'
  check(
    '(C2) .app anidado: gana el de dentro',
    rutaAppDesdeEjecutable(anidado) ===
      '/Applications/Taller.app/Contents/Applications/Analizador.app',
    String(rutaAppDesdeEjecutable(anidado))
  )
  check(
    '(C3) sin .app: null (no una ruta inventada)',
    rutaAppDesdeEjecutable('/usr/local/bin/tessera') === null,
    String(rutaAppDesdeEjecutable('/usr/local/bin/tessera'))
  )
  // Un ejecutable de Windows no tiene `.app`: la función no debe fabricar nada.
  check(
    '(C4) ruta de Windows: null',
    rutaAppDesdeEjecutable('C:\\Users\\ana\\Tessera\\Tessera.exe') === null,
    String(rutaAppDesdeEjecutable('C:\\Users\\ana\\Tessera\\Tessera.exe'))
  )
  // Una carpeta llamada exactamente ".app" no es un bundle.
  check(
    '(C5) segmento «.app» pelado: null',
    rutaAppDesdeEjecutable('/Users/ana/.app/bin/x') === null,
    String(rutaAppDesdeEjecutable('/Users/ana/.app/bin/x'))
  )
}

// ── (D) El Info.plist ────────────────────────────────────────────────────────
hr('(D) el Info.plist: qué hace que salga en el menú del Finder')
{
  const p = contenidoInfoPlist()
  check('(D1) declara NSServices', p.includes('<key>NSServices</key>'), 'presente')
  check(
    '(D2) NSMessage = runWorkflowAsService',
    p.includes('<string>runWorkflowAsService</string>'),
    'presente'
  )
  // Sin esto sale en el menú «Servicios» de TODAS las apps, no sólo del Finder.
  check(
    '(D3) NSRequiredContext ata el servicio al Finder',
    p.includes('<key>NSRequiredContext</key>') && p.includes('<string>com.apple.finder</string>'),
    'com.apple.finder'
  )
  // `public.folder` y NADA de extensiones: ésas ya las trae CFBundleDocumentTypes del
  // paquete, y duplicarlas daría dos entradas de menú para lo mismo.
  check(
    '(D4) NSSendFileTypes es sólo public.folder',
    p.includes('<string>public.folder</string>') && !p.includes('public.data'),
    'public.folder'
  )
  check('(D5) el menú lleva el nombre del servicio', p.includes(`<string>${NOMBRE_SERVICIO}</string>`), NOMBRE_SERVICIO)
  check('(D6) lleva su propio identificador de bundle', p.includes(ID_SERVICIO), ID_SERVICIO)
  // El identificador del `.workflow` NO puede ser el de la app: son dos paquetes
  // distintos y macOS los indexa por este campo. `idApp` es `string` y no un literal a
  // propósito: comparado con la constante, TypeScript estrecha los dos a literales, ve
  // que nunca son iguales y falla la compilación en vez de dejar correr el test.
  const idApp: string = 'com.noe.tessera'
  check('(D7) el id no es el de la app', ID_SERVICIO !== idApp, ID_SERVICIO)
  check('(D8) es un plist XML bien formado en su cabecera', p.startsWith('<?xml version="1.0"'), 'ok')
}

// ── (E) El document.wflow ────────────────────────────────────────────────────
hr('(E) el document.wflow: qué se ejecuta al pulsar')
{
  const w = contenidoWflow(APP)
  check(
    '(E1) el comando abre ESTE .app',
    w.includes(`/usr/bin/open -a &quot;${APP}&quot;`),
    APP
  )
  // La diferencia entre abrir la carpeta buena y partir en dos una con `\n` en el nombre.
  check(
    '(E2) inputMethod = 1 (argumentos), no 0 (stdin)',
    /<key>inputMethod<\/key>\s*<integer>1<\/integer>/.test(w),
    '1'
  )
  check(
    '(E3) el guion usa "$@" y no "$1"',
    w.includes('&quot;$@&quot;') && !w.includes('&quot;$1&quot;'),
    '"$@"'
  )
  check(
    '(E4) es un servicio del menú (servicesMenu)',
    w.includes('<string>com.apple.Automator.servicesMenu</string>'),
    'presente'
  )
  check(
    '(E5) la entrada del workflow son carpetas',
    w.includes('<string>com.apple.Automator.fileSystemObject.folder</string>'),
    'presente'
  )
  // Automator valida el documento contra el Info.plist de la acción: sin la ruta exacta
  // el servicio se registra pero al pulsarlo no pasa nada.
  check(
    '(E6) apunta a la acción real del sistema',
    w.includes('<string>/System/Library/Automator/Run Shell Script.action</string>'),
    'presente'
  )
  // Dos instalaciones seguidas tienen que dar el MISMO fichero, o no se puede comparar
  // lo instalado con lo que tocaría instalar (que es como se reconcilia).
  check('(E7) es determinista (mismos bytes dos veces)', contenidoWflow(APP) === w, 'idéntico')
}

// ── (F) El escapado, que atraviesa dos capas ─────────────────────────────────
hr('(F) escapado: shell dentro de XML')
{
  check(
    '(F1) escaparXml cubre los cuatro de un <string>',
    escaparXml('a&b<c>d"e') === 'a&amp;b&lt;c&gt;d&quot;e',
    escaparXml('a&b<c>d"e')
  )
  check(
    '(F2) escaparParaComillasDobles cubre \\ " $ `',
    escaparParaComillasDobles('a\\b"c$d`e') === 'a\\\\b\\"c\\$d\\`e',
    escaparParaComillasDobles('a\\b"c$d`e')
  )
  // El caso que motivó el escapado: `$HOME` dentro de la ruta se expandiría y el `open`
  // iría contra otro sitio.
  const conDolar = '/Users/ana/$HOME raro.app'
  check(
    '(F3) un $ en la ruta se neutraliza en el comando',
    comandoDeApertura(conDolar).includes('\\$HOME'),
    comandoDeApertura(conDolar)
  )
  // Y una ruta con `&` tiene que salir del plist como `&amp;`, o el XML no parsea.
  const conAmp = '/Applications/Tessera & Co.app'
  check(
    '(F4) un & en la ruta sale escapado en el XML',
    contenidoWflow(conAmp).includes('&amp; Co.app'),
    'ok'
  )
  check(
    '(F5) ningún & queda crudo en el wflow',
    !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(contenidoWflow(conAmp)),
    'sin & sueltos'
  )
}

// ── (G) La reconciliación: ida y vuelta ──────────────────────────────────────
hr('(G) leer del wflow instalado a qué .app apunta')
{
  const rutas = [
    APP,
    '/Users/ana/Applications/Tessera.app',
    '/Applications/Tessera & Co.app',
    '/Users/ana/$HOME raro.app',
    '/Applications/Tessera "beta".app',
    '/Applications/Tessera con espacios y (paréntesis).app'
  ]
  for (const r of rutas) {
    const vuelta = appDelWflow(contenidoWflow(r))
    check(`(G1) ida y vuelta: ${r}`, vuelta === r, String(vuelta))
  }
  // Un fichero que no escribimos nosotros no debe leerse como "apunta a algo": el
  // llamador lo trata como desactualizado y lo reescribe, que es lo correcto.
  check('(G2) contenido ajeno: null', appDelWflow('<plist><dict/></plist>') === null, 'null')
  check('(G3) fichero vacío: null', appDelWflow('') === null, 'null')
  // Y lo que sí escribimos, distinto del que corre, tiene que detectarse como distinto.
  check(
    '(G4) otra copia se detecta como otra',
    appDelWflow(contenidoWflow('/Users/ana/Downloads/Tessera.app')) !== APP,
    'distinto'
  )
}

const allPass = pasados === total
console.log(`\nVEREDICTO: ${pasados}/${total} PASS`)
process.exit(allPass ? 0 : 1)
