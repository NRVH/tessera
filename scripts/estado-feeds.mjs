// =============================================================================
// Responde a una pregunta: ¿qué versión de Tessera está viendo ahora mismo cada plataforma?
// Pide los dos manifiestos PUBLICADOS (no mira `dist/`), los compara con `package.json` y avisa
// si `latest-mac.yml` no trae `minimumSystemVersion`. Por defecto mira las Releases de GitHub;
// `--feed <url>` o `TESSERA_FEED_BASE` consultan otro feed. Sale 0 (un desfase es legítimo);
// con `--estricto`, 1 si falta publicar, 3 si el feed va por delante del repo y 2 si no se pudo
// comprobar. Lee los campos sin parser de YAML. `publish-update.mjs` lo usa para no puentear a
// otro feed una versión que GitHub aún no sirve (`veredictoDelPuente`).
// Decisiones: docs/decisiones/despliegue/releases-de-github.md
// =============================================================================
import { readFileSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sistemaMinimoDelManifiesto } from './sistemaMinimo.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** El feed que leen las apps instaladas: tiene que coincidir con `publish.url` de `electron-builder.yml`. */
export const FEED_GITHUB = 'https://github.com/NRVH/tessera/releases/latest/download'

/**
 * La base del feed a consultar: `--feed <url>`, si no `TESSERA_FEED_BASE`, si no GitHub.
 * Sin barra final, para que `${base}/${canal}` no salga con dos. LANZA si `--feed` llega sin
 * valor: tomar la opción siguiente (`--estricto`) por URL consultaría un feed que no existe.
 */
export function baseDelFeed(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--feed')
  const valor = i >= 0 ? argv[i + 1] : undefined
  if (i >= 0 && (!valor || valor.startsWith('--'))) throw new Error('--feed necesita una URL: --feed <url>')
  const elegida = valor || env.TESSERA_FEED_BASE || FEED_GITHUB
  return elegida.replace(/\/+$/, '')
}

/**
 * Los dos canales que electron-updater sabe pedir. El sufijo `-mac` lo añade el propio
 * updater en Darwin, así que estos dos nombres son fijos.
 */
export const CANALES = [
  { plataforma: 'Windows', canal: 'latest.yml' },
  { plataforma: 'macOS', canal: 'latest-mac.yml' }
]

/**
 * Compara `a` con `b` como versiones numéricas: -1 si a<b, 1 si a>b, 0 si iguales,
 * y `null` si alguna no es puramente numérica (no se inventa un orden).
 *
 * HACE FALTA LA DIRECCIÓN, no solo si coinciden: un feed por DELANTE del repo no se
 * arregla publicando —eso pisaría el manifiesto bueno con uno anterior— sino con
 * `git pull`.
 */
export function compararVersiones(a, b) {
  const trocear = (v) => (/^\d+(\.\d+)*$/.test(String(v).trim()) ? String(v).trim().split('.').map(Number) : null)
  const pa = trocear(a)
  const pb = trocear(b)
  if (!pa || !pb) return null
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** La versión que este working copy dice ser. */
export function versionDelRepo() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
}

/**
 * Saca un escalar de una línea `clave: valor` de primer nivel del manifiesto, sin
 * comillas. `null` si no está: un manifiesto sin `version` está corrupto y se enseña así.
 */
export function campo(texto, clave) {
  const m = texto.match(new RegExp(`^${clave}:\\s*(.+)$`, 'm'))
  if (!m) return null
  return m[1].trim().replace(/^['"]|['"]$/g, '')
}

/**
 * Por qué falló un `fetch`, en una frase que sirva de diagnóstico. `e.message` del fetch
 * de Node es siempre «fetch failed»; lo útil vive en `e.cause`: su `code`, los `code` de
 * un AggregateError (un nombre que resuelve a varias direcciones) o su `message`.
 */
function porQueFalló(e) {
  if (e.name === 'TimeoutError') return 'sin respuesta en 10 s'
  const causa = e.cause
  if (!causa) return e.message
  if (causa.code) return causa.code
  if (Array.isArray(causa.errors)) {
    const codigos = [...new Set(causa.errors.map((x) => x?.code).filter(Boolean))]
    if (codigos.length > 0) return codigos.join(', ')
  }
  return causa.message || e.message
}

/**
 * Estado de UN canal. No lanza nunca: un servidor caído o un feed que falta son
 * resultados legítimos que hay que poder enseñar en la tabla, no excepciones.
 */
async function leerCanal(c, base) {
  const url = `${base}/${c.canal}`
  let res
  try {
    // Con tope de tiempo: un servidor que se queda colgado no puede dejar el comando
    // clavado minutos sin imprimir nada. GitHub redirige al almacén de ficheros.
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) })
  } catch (e) {
    return { ...c, estado: 'ilegible', detalle: `sin respuesta del feed (${porQueFalló(e)})` }
  }
  // 404 ES UN ESTADO CONOCIDO, no una incógnita: el manifiesto no está, y de ahí se
  // sigue qué hacer —publicar—. Va con los atrasados, no con los ilegibles.
  if (res.status === 404) return { ...c, estado: 'ausente', detalle: 'no está en el feed' }
  if (!res.ok) return { ...c, estado: 'ilegible', detalle: `HTTP ${res.status}` }
  const texto = await res.text()
  const version = campo(texto, 'version')
  if (!version) return { ...c, estado: 'ilegible', detalle: 'manifiesto sin campo `version` (¿corrupto?)' }
  return {
    ...c,
    estado: 'ok',
    version,
    releaseDate: campo(texto, 'releaseDate'),
    path: campo(texto, 'path'),
    minimo: sistemaMinimoDelManifiesto(texto)
  }
}

/** Estado de los dos canales de `base`, en paralelo. */
export async function estadoDeFeeds(base = FEED_GITHUB) {
  return Promise.all(CANALES.map((c) => leerCanal(c, base)))
}

/**
 * Si el puente a otro feed puede subir `aPuentear` (`[{ plataforma, canal, version }]`): cada canal
 * tiene que servirse YA en `estadosGithub` con esa versión EXACTA. Un canal ilegible tampoco
 * vale: sin comprobarlo, las apps podrían saltar a un feed que aún no la tiene y quedarse sin
 * actualizaciones. Devuelve `{ permitido, motivos }`.
 */
export function veredictoDelPuente(estadosGithub, aPuentear) {
  const motivos = []
  for (const p of aPuentear) {
    const e = estadosGithub.find((x) => x.canal === p.canal)
    if (!e || e.estado === 'ausente') motivos.push(`${p.plataforma}: GitHub aún no sirve ${p.canal}`)
    else if (e.estado !== 'ok') motivos.push(`${p.plataforma}: no se pudo leer ${p.canal} en GitHub (${e.detalle})`)
    else if (e.version !== p.version) motivos.push(`${p.plataforma}: GitHub sirve la ${e.version}, no la ${p.version}`)
  }
  return { permitido: motivos.length === 0, motivos }
}

/** `2026-09-06T19:24:57.016Z` → `2026-09-06 19:24`. Los milisegundos no dicen nada. */
function fechaCorta(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Qué hay que hacer para que una versión llegue a `base`. */
export function remedioDePublicar(base, version) {
  if (base === FEED_GITHUB) {
    return (
      `empuja la etiqueta v${version} al repo público: el workflow «Publicar» compila las dos\n` +
      '  plataformas y solo saca la release de borrador cuando están las dos.'
    )
  }
  return 'publica esa versión en ese feed (el puente de la transición, con los artefactos de la release).'
}

/**
 * Imprime la tabla y devuelve `{ faltaPublicar, adelantadas, ilegibles, sinMinimo }`.
 *
 * TRES REMEDIOS DISTINTOS. ATRÁS o AUSENTE → publicar. ADELANTE → `git pull`, nunca
 * publicar (se pisaría la buena con una anterior). ILEGIBLE → no se sabe nada, y no es
 * señal de que haya que republicar. Aparte, un `latest-mac.yml` sin mínimo de sistema
 * en Darwin deja pasar la versión a Macs que no pueden con ella: se avisa.
 */
export function informar(estados, esperada, base = FEED_GITHUB) {
  const faltaPublicar = []
  const adelantadas = []
  const ilegibles = []
  const sinMinimo = []
  console.log(`\n[feeds] Tessera ${esperada} (package.json) → ${base}\n`)
  for (const e of estados) {
    const etiqueta = e.plataforma.padEnd(8)
    if (e.estado === 'ilegible') {
      console.log(`  ${etiqueta} ? ${e.detalle}`)
      ilegibles.push(e)
      continue
    }
    if (e.estado === 'ausente') {
      console.log(`  ${etiqueta} ✕ ${e.detalle}`)
      faltaPublicar.push(e)
      continue
    }
    const fecha = e.releaseDate ? `  (${fechaCorta(e.releaseDate)})` : ''
    const cmp = compararVersiones(e.version, esperada)
    let marca = '✓'
    let nota = ''
    if (cmp === -1) {
      marca = '·'
      nota = '   ← ATRÁS'
      faltaPublicar.push(e)
    } else if (cmp === 1) {
      marca = '!'
      nota = '   ← ADELANTE (tu repo está viejo)'
      adelantadas.push(e)
    } else if (cmp === null && e.version !== esperada) {
      // Versiones que no se pueden ordenar (una prerelease, un manifiesto raro): se
      // enseña la discrepancia y no se inventa una dirección.
      marca = '?'
      nota = '   ← DISTINTA (no comparable)'
      ilegibles.push(e)
    }
    const minimo = e.canal === 'latest-mac.yml' && e.minimo ? `  [mínimo Darwin ${e.minimo}]` : ''
    console.log(`  ${etiqueta} ${marca} ${e.version}${fecha}${minimo}${nota}`)
    if (e.canal === 'latest-mac.yml' && !e.minimo) sinMinimo.push(e)
  }
  const grupos = { faltaPublicar, adelantadas, ilegibles, sinMinimo }
  imprimirResumen(grupos, esperada, base)
  return grupos
}

/** El remedio de cada grupo de `informar`, debajo de la tabla. */
function imprimirResumen({ faltaPublicar, adelantadas, ilegibles, sinMinimo }, esperada, base) {
  if (faltaPublicar.length > 0) {
    console.log(`\n[feeds] Falta publicar (${faltaPublicar.map((e) => e.plataforma).join(', ')}):`)
    console.log(`  ${remedioDePublicar(base, esperada)}`)
    console.log(
      '\n  Mientras tanto NO hay nada roto en esa plataforma: sus apps instaladas siguen\n' +
        '  funcionando con la versión que tienen y simplemente no ven la nueva.'
    )
  }

  if (adelantadas.length > 0) {
    console.log(
      `\n[feeds] EL FEED VA POR DELANTE (${adelantadas.map((a) => a.plataforma).join(', ')}).` +
        '\n  NO publiques desde aquí: subirías una versión ANTERIOR encima de la buena.' +
        '\n  Actualiza el repositorio primero:  git pull'
    )
  }

  if (sinMinimo.length > 0) {
    console.log(
      '\n[feeds] AVISO: latest-mac.yml no trae minimumSystemVersion en Darwin. electron-updater' +
        '\n  ofrecerá esta versión a Macs por debajo del mínimo de Electron, y el relevo pondría' +
        '\n  un bundle que no arranca. Se escribe con: node scripts/parchearMinimoMac.mjs'
    )
  }

  if (ilegibles.length > 0) {
    console.log(
      `\n[feeds] SIN COMPROBAR (${ilegibles.map((f) => f.plataforma).join(', ')}): no se pudo leer el feed,` +
        '\n  así que no se sabe si está al día. NO es señal de que haya que republicar.' +
        '\n  Reintenta con: npm run feeds:estado'
    )
  }

  if (faltaPublicar.length === 0 && adelantadas.length === 0 && ilegibles.length === 0) {
    console.log('\n[feeds] ✓ Las dos plataformas sirven la misma versión.')
  }
  console.log('')
}

// --- CLI: sólo cuando se ejecuta directamente, no al importarlo ---------------
// Se comparan RUTAS REALES, no URLs: construir `file://` + argv[1] a mano falla en
// Windows y el bloque no se ejecutaría nunca.
const esteFichero = fileURLToPath(import.meta.url)
const ejecutadoDirectamente = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(esteFichero)
  } catch {
    return false
  }
})()

if (ejecutadoDirectamente) {
  const esperada = versionDelRepo()
  let base
  try {
    base = baseDelFeed()
  } catch (e) {
    console.error(`\n[feeds] ✕ ${e.message}\n`)
    process.exit(2)
  }
  const { faltaPublicar, adelantadas, ilegibles } = informar(await estadoDeFeeds(base), esperada, base)
  if (process.argv.includes('--estricto')) {
    // El orden importa: si algo falta por publicar, ése es el problema que manda.
    if (faltaPublicar.length > 0) process.exit(1)
    if (adelantadas.length > 0) process.exit(3)
    if (ilegibles.length > 0) process.exit(2)
  }
}
