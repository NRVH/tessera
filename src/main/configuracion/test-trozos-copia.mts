// =============================================================================
// Pruebas del archivo de la versión 2 (`trozosCopia.ts` y `cifradoFrase.ts`): ida y vuelta con y sin frase,
// un archivo partido en varios trozos, la frase equivocada y cada forma de tocar los trozos (alterar, mover,
// quitar, duplicar, cortar, añadir, cambiar el cierre o traer uno de otro archivo), que falla siempre, también
// sobre trozos de fuentes no elegidas, que se saltan sin abrir. Que la versión 1 se sigue leyendo, que una
// Tessera anterior rechaza la 2 como «más nueva», los topes al abrir y que abortar no deja el temporal.
// Uso: node src/main/configuracion/test-trozos-copia.mts
// =============================================================================

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { VERSION_ARCHIVO, VERSION_SIN_HISTORIAL, descifrarCopia, leerArchivoCopia, prepararCopia } from './cifradoFrase.ts'
import { txConfiguracion } from './textos.ts'
import { EscritorCopia, TOPE_CABECERA, archivoDeLinea, hashLinea, leerCabeceraCopia, leerTrozos, lineasDe, selloDe } from './trozosCopia.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const TMP = mkdtempSync(path.join(os.tmpdir(), 'tessera-prueba-trozos-'))
const FRASE = 'una frase de prueba'
const META = { plataforma: 'windows' as const, app: '9.9.9' }
const CONTENIDO = JSON.stringify({ perfiles: [], secreto: 'contraseña-de-prueba' })

/** Tres archivos de origen: uno pequeño, uno vacío y uno de 9 MiB (tres trozos). */
const ORIGEN = {
  'projects/-ejemplo/a.jsonl': Buffer.from('{"type":"user","cwd":"/ejemplo","texto":"hola secreta"}\n'),
  'projects/-ejemplo/b.jsonl': Buffer.alloc(0),
  'sessions/2026/rollout-x.jsonl': Buffer.from(Array.from({ length: 9 * 1024 * 1024 / 64 }, (_, i) => `linea ${String(i).padStart(10, '0')} ${'x'.repeat(42)}\n`).join(''))
}
const rutasOrigen: Record<string, string> = {}
for (const [rel, datos] of Object.entries(ORIGEN)) {
  const abs = path.join(TMP, rel.replaceAll('/', '_'))
  rutasOrigen[rel] = abs
  writeFileSync(abs, datos)
}

async function escribir(nombre: string, frase: string | null): Promise<string> {
  const destino = path.join(TMP, nombre)
  const { archivo, clave } = await prepararCopia(CONTENIDO, frase, META, true)
  const e = await EscritorCopia.abrir(destino, archivo, clave)
  for (const [rel, abs] of Object.entries(rutasOrigen)) await e.archivo(rel.startsWith('sessions') ? 1 : 0, rel, abs, readFileSync(abs).length)
  await e.cerrar()
  return destino
}

async function primera(ruta: string): Promise<string> {
  for await (const l of lineasDe(ruta, 1e8, 1e8)) return l
  return ''
}

/** Lee el archivo como lo hace el importador (con `elegidas`, solo esas fuentes): los archivos reconstruidos, o el error. */
async function leer(ruta: string, frase: string, elegidas?: ReadonlySet<number>): Promise<{ ok: true; archivos: Map<string, Buffer> } | { ok: false; error: string }> {
  try {
    const leido = await leerCabeceraCopia(ruta)
    if (!leido.ok) return leido
    if (leido.hash === null) return { ok: false, error: 'versión 1' }
    const d = await descifrarCopia(leido.archivo, frase)
    if (!d.ok) return d
    const archivos = new Map<string, Buffer>()
    for await (const t of leerTrozos(ruta, leido.hash, selloDe(leido.hash, d.clave, leido.archivo.cifrado?.sal ?? null), elegidas)) {
      archivos.set(t.meta.ruta, Buffer.concat([archivos.get(t.meta.ruta) ?? Buffer.alloc(0), t.datos]))
    }
    return { ok: true, archivos }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function iguales(a: Map<string, Buffer>): boolean {
  return Object.entries(ORIGEN).every(([rel, datos]) => a.get(rel)?.equals(datos) === true) && a.size === Object.keys(ORIGEN).length
}

/** Una copia del archivo con sus líneas cambiadas por `f`. */
function tocado(ruta: string, nombre: string, f: (l: string[]) => string[]): string {
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  const destino = path.join(TMP, nombre)
  writeFileSync(destino, f(lineas).join('\n'))
  return destino
}

async function idaYVuelta(): Promise<string> {
  hr('(1) Ida y vuelta con frase, en streaming y por trozos')
  const ruta = await escribir('con-frase.tessera', FRASE)
  const texto = readFileSync(ruta, 'utf8')
  const lineas = texto.split('\n')
  check('nada del historial ni del contenido en claro', !texto.includes('hola secreta') && !texto.includes('contraseña-de-prueba'), `${texto.length} bytes`)
  check('un trozo por línea: 1 + 1 vacío + 3 del grande + cierre', lineas.length === 1 + 1 + 1 + 3 + 1 + 1 + 1, `${lineas.length} líneas`)
  const r = await leer(ruta, FRASE)
  check('vuelve igual, byte a byte (también el vacío y el de 9 MiB)', r.ok && iguales(r.archivos), r.ok ? [...r.archivos.keys()].join(', ') : r.error)
  const cab = archivoDeLinea(lineas[0])
  check('la cabecera dice versión 2 y el historial', cab.ok && cab.archivo.version === VERSION_ARCHIVO && cab.archivo.historial?.compresion === 'zstd', lineas[0].slice(0, 90))
  const mala = await leer(ruta, 'otra frase cualquiera')
  check('NEGATIVO: con otra frase, error', !mala.ok, mala.ok ? 'leyó' : mala.error)
  return ruta
}

async function anterior(ruta: string): Promise<void> {
  hr('(2) Compatibilidad entre versiones')
  const texto = readFileSync(ruta, 'utf8')
  let entero: unknown = null
  try {
    entero = JSON.parse(texto)
  } catch {
    entero = null
  }
  check('el archivo entero sigue siendo JSON (una Tessera anterior lo lee)', entero !== null, '')
  const vieja = leerArchivoCopia(texto, 1)
  check('una Tessera de la versión 1 lo rechaza por «más nueva»', !vieja.ok && /más nueva|newer/.test(vieja.error), JSON.stringify(vieja))
  const sin = await prepararCopia(CONTENIDO, FRASE, META, false)
  const v1 = JSON.stringify(sin.archivo, null, 2)
  const leida = leerArchivoCopia(v1)
  const d = leida.ok ? await descifrarCopia(leida.archivo, FRASE) : null
  check('sin historial se escribe la versión 1 y esta Tessera la sigue leyendo', sin.archivo.version === VERSION_SIN_HISTORIAL && d?.ok === true && d.contenido === CONTENIDO, '')
  const tocada = leerArchivoCopia(JSON.stringify({ ...sin.archivo, version: 2 }))
  check('NEGATIVO: una «versión 2» sin su historial en la cabecera no vale', !tocada.ok, JSON.stringify(tocada))
}

async function tocar(ruta: string): Promise<void> {
  hr('(3) Trozos tocados: siempre error, nunca datos a medias por bueno')
  const casos: Array<[string, (l: string[]) => string[]]> = [
    ['un trozo alterado', (l) => l.map((x, i) => (i === 3 ? x.slice(0, 20) + (x[20] === 'A' ? 'B' : 'A') + x.slice(21) : x))],
    ['dos trozos cambiados de sitio', (l) => [l[0], l[2], l[1], ...l.slice(3)]],
    ['un trozo quitado', (l) => [l[0], ...l.slice(2)]],
    ['un trozo duplicado', (l) => [l[0], l[1], l[1], ...l.slice(2)]],
    ['cortado tras el tercer trozo', (l) => l.slice(0, 4)],
    ['sin el cierre', (l) => l.filter((x) => x !== ']}')],
    ['una línea añadida tras el cierre', (l) => [...l.slice(0, -1), '"AAAA"', '']],
    ['el de cierre quitado y el anterior hecho último', (l) => {
      const i = l.indexOf(']}')
      return [...l.slice(0, i - 2), l[i - 2].replace(/,$/, ''), ']}', '']
    }],
    ['la coma del final cambiada en un trozo de datos', (l) => l.map((x, i) => (i === 1 ? x.replace(/,$/, '') : x))]
  ]
  for (const [nombre, f] of casos) {
    const r = await leer(tocado(ruta, `t-${nombre.replaceAll(' ', '-')}.tessera`, f), FRASE)
    check(`NEGATIVO: ${nombre}`, !r.ok, r.ok ? 'se leyó' : r.error)
  }
  const otro = await escribir('otro.tessera', FRASE)
  const deOtro = readFileSync(otro, 'utf8').split('\n')
  const r = await leer(tocado(ruta, 't-de-otro.tessera', (l) => [l[0], deOtro[1], ...l.slice(2)]), FRASE)
  check('NEGATIVO: un trozo de otro archivo con la misma frase', !r.ok, r.ok ? 'se leyó' : r.error)
  const cab = await leer(tocado(ruta, 't-cabecera.tessera', (l) => [l[0].replace('"app":"9.9.9"', '"app":"9.9.8"'), ...l.slice(1)]), FRASE)
  check('NEGATIVO: la cabecera cambiada', !cab.ok, cab.ok ? 'se leyó' : cab.error)
  // Aunque alguien sacara la clave de otra copia, los trozos de esta no se abren con ella.
  const linea = await primera(ruta)
  const leido = archivoDeLinea(linea)
  const otraCab = archivoDeLinea(await primera(otro))
  const dOtra = otraCab.ok ? await descifrarCopia(otraCab.archivo, FRASE) : null
  let error = ''
  try {
    if (leido.ok && dOtra?.ok) for await (const _ of leerTrozos(ruta, hashLinea(linea), selloDe(hashLinea(linea), dOtra.clave, leido.archivo.cifrado?.sal ?? null))) void _
  } catch (err) {
    error = String(err)
  }
  check('NEGATIVO: con la clave de otra copia, los trozos no se abren', error !== '', error)
}

async function sinFrase(): Promise<void> {
  hr('(4) Sin frase: comprimido y en claro, pero en orden')
  const ruta = await escribir('sin-frase.tessera', null)
  const r = await leer(ruta, '')
  check('vuelve igual', r.ok && iguales(r.archivos), r.ok ? '' : r.error)
  const cab = archivoDeLinea(await primera(ruta))
  check('la cabecera dice que no va cifrado', cab.ok && cab.archivo.cifrado === null, '')
  const movido = await leer(tocado(ruta, 's-movido.tessera', (l) => [l[0], l[2], l[1], ...l.slice(3)]), '')
  check('NEGATIVO: sin frase, un trozo movido también se nota', !movido.ok, movido.ok ? 'se leyó' : movido.error)
  const cortado = await leer(tocado(ruta, 's-cortado.tessera', (l) => l.slice(0, 3)), '')
  check('NEGATIVO: sin frase, cortado', !cortado.ok, cortado.ok ? 'se leyó' : cortado.error)
}

const soloDe = (a: Map<string, Buffer>, prefijo: string): boolean =>
  [...a.keys()].every((r) => r.startsWith(prefijo)) &&
  Object.entries(ORIGEN).filter(([r]) => r.startsWith(prefijo)).every(([r, datos]) => a.get(r)?.equals(datos) === true)

async function saltar(ruta: string): Promise<void> {
  hr('(5) Solo las fuentes elegidas: las demás se saltan sin abrir, y tocarlas también se nota')
  // Líneas: 0 cabecera, 1-2 la fuente 0 (dos archivos), 3-5 la fuente 1 (un archivo en tres trozos), 6 cierre.
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  check('cada línea de trozo lleva su fuente en claro', /^"0:/.test(lineas[1]) && /^"1:/.test(lineas[3]) && /^"fin:/.test(lineas[6]), lineas.map((l) => l.slice(0, 4)).join(' '))
  const cero = await leer(ruta, FRASE, new Set([0]))
  check('elegida la fuente 0: solo sus archivos, iguales', cero.ok && cero.archivos.size === 2 && soloDe(cero.archivos, 'projects/'), cero.ok ? [...cero.archivos.keys()].join(', ') : cero.error)
  const uno = await leer(ruta, FRASE, new Set([1]))
  check('elegida la fuente 1: solo la suya, igual', uno.ok && uno.archivos.size === 1 && soloDe(uno.archivos, 'sessions/'), uno.ok ? [...uno.archivos.keys()].join(', ') : uno.error)
  const casos: Array<[string, (l: string[]) => string[]]> = [
    ['un trozo saltado alterado', (l) => l.map((x, i) => (i === 4 ? x.slice(0, 20) + (x[20] === 'A' ? 'B' : 'A') + x.slice(21) : x))],
    ['dos trozos saltados cambiados de sitio', (l) => [...l.slice(0, 4), l[5], l[4], ...l.slice(6)]],
    ['un trozo saltado quitado', (l) => [...l.slice(0, 4), ...l.slice(5)]],
    ['un trozo saltado duplicado', (l) => [...l.slice(0, 5), l[4], ...l.slice(5)]],
    ['un trozo elegido rebautizado como de otra fuente', (l) => l.map((x, i) => (i === 1 ? x.replace(/^"0:/, '"1:') : x))],
    ['un trozo saltado rebautizado como de la elegida', (l) => l.map((x, i) => (i === 3 ? x.replace(/^"1:/, '"0:') : x))]
  ]
  for (const [nombre, f] of casos) {
    const r = await leer(tocado(ruta, `e-${nombre.replaceAll(' ', '-')}.tessera`, f), FRASE, new Set([0]))
    check(`NEGATIVO: ${nombre}`, !r.ok, r.ok ? 'se leyó' : r.error)
  }
  // Sin frase se puede rehacer el cierre: un trozo saltado ilegible con su hash al día no se abre (no se toca).
  const sin = await escribir('sin-frase-saltos.tessera', null)
  const rehecho = tocado(sin, 's-saltado-ilegible.tessera', (l) => {
    const nuevas = l.map((x, i) => (i === 4 ? '"1:AAAA",' : x))
    let cadena = createHash('sha256').update(nuevas[0], 'utf8').digest()
    for (const x of nuevas.slice(1, 6)) cadena = createHash('sha256').update(cadena).update(x, 'utf8').digest()
    const plano = zstdDecompressSync(Buffer.from(nuevas[6].slice(5, -1), 'base64'))
    const largo = plano.readUInt32BE(0)
    const meta = { ...JSON.parse(plano.subarray(4, 4 + largo).toString('utf8')), cadena: cadena.toString('base64') }
    const m = Buffer.from(JSON.stringify(meta), 'utf8')
    const cabeza = Buffer.alloc(4)
    cabeza.writeUInt32BE(m.length)
    nuevas[6] = `"fin:${zstdCompressSync(Buffer.concat([cabeza, m])).toString('base64')}"`
    return nuevas
  })
  const saltado = await leer(rehecho, '', new Set([0]))
  check('un trozo de una fuente no elegida no se abre: ilegible y todo, se salta', saltado.ok && saltado.archivos.size === 2, saltado.ok ? '' : saltado.error)
  const elegido = await leer(rehecho, '', new Set([1]))
  check('NEGATIVO: y elegida su fuente, se abre y falla', !elegido.ok, elegido.ok ? 'se leyó' : elegido.error)
}

async function cabeceraEnDisco(): Promise<void> {
  hr('(6) Abrir: la forma antes que el tamaño, y un tope también para la versión 2')
  const t = txConfiguracion()
  const cualquiera = path.join(TMP, 'cualquiera.bin')
  writeFileSync(cualquiera, Buffer.alloc(2 * 1024 * 1024, 0x78))
  const noEs = await leerCabeceraCopia(cualquiera)
  check('un archivo cualquiera sin saltos: «no es una copia», sin leerlo entero', !noEs.ok && noEs.error === t.archivo.noEsCopia, JSON.stringify(noEs))
  const relleno = Buffer.alloc(TOPE_CABECERA + 1024 * 1024, 0x78)
  const v2 = path.join(TMP, 'v2-enorme.tessera')
  writeFileSync(v2, '{"tessera":"configuracion","version":2,"datos":"')
  appendFileSync(v2, relleno)
  const grande2 = await leerCabeceraCopia(v2)
  check('una primera línea de la versión 2 por encima del tope: «demasiado grande»', !grande2.ok && grande2.error === t.demasiadoGrande, JSON.stringify(grande2))
  const v1 = path.join(TMP, 'v1-enorme.tessera')
  writeFileSync(v1, '{\n  "tessera": "configuracion",\n  "datos": "')
  appendFileSync(v1, relleno)
  appendFileSync(v1, '"\n}\n')
  const grande1 = await leerCabeceraCopia(v1)
  check('una de la versión 1 por encima del tope: «demasiado grande»', !grande1.ok && grande1.error === t.demasiadoGrande, JSON.stringify(grande1))
  const sin = await prepararCopia(CONTENIDO, FRASE, META, false)
  const v1Buena = path.join(TMP, 'v1.tessera')
  writeFileSync(v1Buena, JSON.stringify(sin.archivo, null, 2))
  const buena1 = await leerCabeceraCopia(v1Buena)
  check('la versión 1 de siempre se abre (sin hash de primera línea)', buena1.ok && buena1.hash === null && buena1.archivo.version === VERSION_SIN_HISTORIAL, JSON.stringify(buena1).slice(0, 80))
  const buena2 = await leerCabeceraCopia(path.join(TMP, 'con-frase.tessera'))
  check('la 2 se abre y guarda solo el hash de su primera línea', buena2.ok && buena2.hash?.length === 32, '')
}

async function abortar(): Promise<void> {
  hr('(7) Abortar a medias no deja el temporal')
  const destino = path.join(TMP, 'abortada.tessera')
  const { archivo, clave } = await prepararCopia(CONTENIDO, FRASE, META, true)
  const e = await EscritorCopia.abrir(destino, archivo, clave)
  await e.archivo(0, 'projects/-ejemplo/a.jsonl', rutasOrigen['projects/-ejemplo/a.jsonl'], ORIGEN['projects/-ejemplo/a.jsonl'].length)
  await e.abortar()
  check('ni temporal ni destino', !existsSync(`${destino}.tessera-tmp`) && !existsSync(destino), '')
  const otro = await EscritorCopia.abrir(path.join(TMP, 'falta.tessera'), archivo, clave)
  const escrito = await otro.archivo(0, 'projects/-ejemplo/z.jsonl', path.join(TMP, 'no-existe.jsonl'), 10)
  await otro.abortar()
  check('un archivo que ya no está: false y nada escrito', escrito === false, String(escrito))
}

try {
  const ruta = await idaYVuelta()
  await anterior(ruta)
  await tocar(ruta)
  await sinFrase()
  await saltar(ruta)
  await cabeceraEnDisco()
  await abortar()
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

const pasan = resultados.filter((r) => r.pasa).length
console.log(`\nVEREDICTO: ${pasan}/${resultados.length} PASS`)
process.exit(pasan === resultados.length ? 0 : 1)
