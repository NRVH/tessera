// =============================================================================
// Qué scripts `test:*` puede afectar un cambio: el cierre de dependencias de cada prueba (imports,
// `require` y rutas escritas como texto, también las de `path.join`) cruzado con los archivos que
// cambiaron desde una referencia de git. Una ruta escrita que es una CARPETA (la que barre una
// guardia) hace depender de todo lo que hay dentro. Lo usa `bateria.mjs --afectadas`.
// =============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const EXTENSIONES_CODIGO = /\.(m|c)?(j|t)sx?$/
const CANDIDATOS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js']
// Carpetas que nunca son una dependencia aunque se escriban: salida de la compilación y terceros.
const CARPETAS_AJENAS = new Set(['node_modules', 'out', 'dist', '.git', '.serena'])

// Pruebas que barren el árbol con `fs` sin que se vea en una ruta escrita (las que enumeran con
// `git ls-files` se reconocen solas).
const RECORREN_EL_REPO = new Set(['src/shared/test-fuentes-limpias.mts'])

const aPosix = (p) => p.split(sep).join('/')

const tipos = new Map()
/** 'archivo', 'carpeta' o null, con caché: cada ruta se mira en disco una sola vez. */
function tipoEnDisco(abs) {
  if (!tipos.has(abs)) tipos.set(abs, existsSync(abs) ? (statSync(abs).isDirectory() ? 'carpeta' : 'archivo') : null)
  return tipos.get(abs)
}

/** El archivo o la carpeta del repo a la que apunta `ruta` desde `base`, o null. */
function resolverRuta(raiz, base, ruta, admiteCarpeta) {
  for (const sufijo of CANDIDATOS) {
    const abs = resolve(base, ruta + sufijo)
    const rel = aPosix(relative(raiz, abs))
    if (rel.startsWith('..') || rel === '' || CARPETAS_AJENAS.has(rel.split('/')[0])) return null
    const tipo = tipoEnDisco(abs)
    if (tipo === null) continue
    const esCarpeta = tipo === 'carpeta'
    if (!esCarpeta) return { tipo: 'archivo', rel }
    if (sufijo === '' && admiteCarpeta) return { tipo: 'carpeta', rel }
  }
  return null
}

/**
 * El fuente sin los comentarios que abren una línea (los de documentación, donde se citan rutas). Solo
 * esos: un `/*` o un `//` a media línea puede estar dentro de un texto o de una expresión regular.
 */
function sinComentarios(texto) {
  return texto.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/[^\n]*/gm, '')
}

/** Lo que el fuente importa de verdad al ejecutarse: `from`, `import()`, `require()` e `import 'x'`, sin `import type`. */
function importsEjecutados(texto) {
  const salida = new Set()
  const patrones = [
    /(?:^|[\s;}])(?:import|export)\s+(?!type\s)[^'"`;]*?\sfrom\s*(['"])([^'"]+)\1/g,
    /(?:^|[\s;])import\s*(['"])([^'"]+)\1/g,
    /\bimport\(\s*(['"])([^'"]+)\1/g,
    /\brequire\(\s*(['"])([^'"]+)\1/g
  ]
  for (const p of patrones) for (const m of texto.matchAll(p)) salida.add(m[2])
  return salida
}

/** Las rutas escritas en un fuente: literales sueltos y secuencias de literales (las piezas de un `join`). */
function rutasEscritas(texto) {
  const salida = new Set()
  const literal = /(['"`])([^'"`\n\\$]{1,200})\1/g
  for (const m of texto.matchAll(literal)) salida.add(m[2])
  // Hasta cuatro segmentos seguidos (`join(raiz, 'src', 'tdb', 'tdb.cjs')`): una lista de datos más larga no es una ruta.
  const secuencia = /(['"])[\w.-]{1,40}\1(?:\s*,\s*(['"])[\w.-]{1,40}\2){1,3}(?!\s*,\s*['"])/g
  for (const m of texto.matchAll(secuencia)) {
    const piezas = [...m[0].matchAll(/(['"])([\w.-]{1,40})\1/g)].map((p) => p[2])
    for (let i = 0; i < piezas.length - 1; i++) salida.add(piezas.slice(i).join('/'))
  }
  return salida
}

/** Una ruta escrita que merece resolverse: relativa, con barra o con extensión de archivo. */
function pareceRuta(s) {
  if (s.length < 2 || /\s/.test(s) || s.includes('://') || s.startsWith('-')) return false
  return s.startsWith('./') || s.startsWith('../') || s.includes('/') || /\.[a-z]{1,5}$/i.test(s)
}

/**
 * Las dependencias directas de un fuente (archivos y carpetas del repo), con caché. Las carpetas
 * solo se aceptan desde pruebas y guiones (`test-*`, `scripts/`), que son los que barren el árbol.
 */
export function dependenciasDirectas(raiz) {
  const directas = new Map()
  function dependenciasDe(rel) {
    if (directas.has(rel)) return directas.get(rel)
    const deps = []
    directas.set(rel, deps)
    if (!EXTENSIONES_CODIGO.test(rel)) return deps
    let texto
    try {
      texto = readFileSync(join(raiz, rel), 'utf8')
    } catch {
      return deps
    }
    // En pruebas y guiones cuenta toda ruta escrita (leen, lanzan y barren archivos); en el código de la
    // app, solo sus imports relativos (un 'CLAUDE.md' de la app habla del proyecto del usuario, no de este repo).
    const pruebaOGuion = /(^|\/)test-[^/]*$/.test(rel) || rel.startsWith('scripts/')
    const limpio = sinComentarios(texto)
    const importados = importsEjecutados(limpio)
    const rutas = pruebaOGuion ? new Set([...rutasEscritas(limpio), ...importados]) : importados
    const base = dirname(join(raiz, rel))
    // Una carpeta escrita solo es una dependencia si el fuente lee carpetas; si no, es un dato de ejemplo.
    const leeCarpetas = pruebaOGuion && /\b(readdirSync|readdir|opendir|globSync|glob)\s*\(/.test(limpio)
    if (pruebaOGuion) {
      // Un guion que enumera con git (lo común de las guardias de calidad) depende de todo el repo. En una
      // prueba, `ls-files` es una orden contra un repo temporal.
      if (rel.startsWith('scripts/') && /['"]ls-files['"]/.test(limpio)) deps.push({ tipo: 'carpeta', rel: '' })
      // Una palabra suelta que es una carpeta junto a la prueba ('controlador') es esa carpeta.
      for (const ruta of rutas) {
        if (!leeCarpetas || !/^[\w.-]{2,40}$/.test(ruta) || CARPETAS_AJENAS.has(ruta)) continue
        const abs = join(base, ruta)
        if (tipoEnDisco(abs) === 'carpeta') deps.push({ tipo: 'carpeta', rel: aPosix(relative(raiz, abs)) })
      }
      if (RECORREN_EL_REPO.has(rel)) deps.push({ tipo: 'carpeta', rel: '' })
    }
    for (const ruta of rutas) {
      const relativa = ruta.startsWith('./') || ruta.startsWith('../')
      if (!pareceRuta(ruta) || (!pruebaOGuion && !relativa)) continue
      const desdeArchivo = resolverRuta(raiz, base, ruta, leeCarpetas)
      const desdeRaiz = relativa ? null : resolverRuta(raiz, raiz, ruta, leeCarpetas)
      // Una ruta escrita sin importarla: un guion (.cjs, .mjs, .js, .sh) se lanza y se sigue; un fuente
      // TypeScript, una hoja de estilos o un dato se LEE como texto y no se siguen sus imports.
      const leida = !importados.has(ruta) && !/\.(c|m)?js$|\.sh$/.test(ruta)
      for (const r of [desdeArchivo, desdeRaiz]) if (r && r.rel !== rel) deps.push(leida && r.tipo === 'archivo' ? { ...r, tipo: 'leido' } : r)
    }
    return deps
  }
  return dependenciasDe
}

/** El cierre de dependencias de un fuente: los archivos y los prefijos de carpeta de los que depende. */
export function crearGrafo(raiz) {
  const dependenciasDe = dependenciasDirectas(raiz)
  return function cierre(rel) {
    const seguidos = new Set([rel])
    const leidos = new Set()
    const carpetas = new Set()
    const pendientes = [rel]
    while (pendientes.length > 0) {
      for (const d of dependenciasDe(pendientes.pop())) {
        if (d.tipo === 'carpeta') carpetas.add(d.rel === '' ? '' : d.rel + '/')
        else if (d.tipo === 'leido') leidos.add(d.rel)
        else if (!seguidos.has(d.rel)) {
          seguidos.add(d.rel)
          pendientes.push(d.rel)
        }
      }
    }
    return { archivos: new Set([...seguidos, ...leidos]), carpetas }
  }
}

function git(raiz, args) {
  return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Los archivos cambiados desde `ref` (confirmados, en el índice y en el árbol) más los nuevos sin seguir. */
export function cambiadosDesde(raiz, ref) {
  const lineas = git(raiz, ['diff', '--name-only', ref]) + git(raiz, ['ls-files', '--others', '--exclude-standard'])
  // La documentación no la ejecuta ninguna prueba (si sale escrita en una, es un dato de ejemplo),
  // salvo los ADR, cuya existencia comprueba la guardia de cabeceras.
  const cuenta = (c) => !c.endsWith('.md') || c.startsWith('docs/decisiones/')
  return [...new Set(lineas.split('\n').map((l) => l.trim()).filter(Boolean))].filter(cuenta)
}

/**
 * Qué pruebas correr. `todas: true` si cambiaron las dependencias del proyecto (cualquier prueba
 * puede verlo); si no, las que dependen de un archivo cambiado y las que cambiaron en package.json.
 * Devuelve { todas, motivo, elegidas: Map<nombre, archivo cambiado que la alcanzó> }.
 */
export function pruebasAfectadas(raiz, ref, nombres, scripts) {
  let cambiados = cambiadosDesde(raiz, ref)
  if (cambiados.includes('package-lock.json')) return { todas: true, motivo: 'cambió package-lock.json', cambiados, elegidas: new Map() }
  const elegidas = new Map()
  if (cambiados.includes('package.json')) {
    let antes
    try {
      antes = JSON.parse(git(raiz, ['show', `${ref}:package.json`]))
    } catch {
      return { todas: true, motivo: `no hay package.json en ${ref}`, cambiados, elegidas }
    }
    const ahora = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))
    for (const campo of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']) {
      if (JSON.stringify(antes[campo] ?? null) !== JSON.stringify(ahora[campo] ?? null)) {
        return { todas: true, motivo: `cambió ${campo} de package.json`, cambiados, elegidas }
      }
    }
    for (const n of nombres) if ((antes.scripts ?? {})[n] !== scripts[n]) elegidas.set(n, 'package.json (su script)')
    // Si solo cambiaron scripts, ya están elegidas sus pruebas: quien lee package.json no ve nada nuevo.
    const sinScripts = (p) => JSON.stringify({ ...p, scripts: undefined })
    if (sinScripts(antes) === sinScripts(ahora)) cambiados = cambiados.filter((c) => c !== 'package.json')
  }
  const cierre = crearGrafo(raiz)
  for (const n of nombres) {
    if (elegidas.has(n)) continue
    const archivo = (scripts[n].match(/^node\s+(\S+)/) ?? [])[1]
    if (!archivo) {
      elegidas.set(n, 'orden sin archivo de prueba reconocible')
      continue
    }
    const { archivos, carpetas } = cierre(aPosix(archivo))
    const culpable = cambiados.find((c) => archivos.has(c) || [...carpetas].some((p) => c.startsWith(p)))
    if (culpable) elegidas.set(n, culpable)
  }
  return { todas: false, motivo: '', cambiados, elegidas }
}
