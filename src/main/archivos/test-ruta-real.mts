#!/usr/bin/env node
// =============================================================================
// Prueba de la guarda de enlaces (npm run test:ruta-real): `sigueDentroDeLaRaiz` sobre un disco real, y
// `ServicioArchivos`, que la aplica en cada operación. Un enlace o una junction dentro del proyecto que apunte fuera
// (lo que puede dejar un proceso del contenedor del agente) no deja leer, escribir, crear, copiar ni arrastrar a
// través de él; borrar o renombrar el enlace mismo sí. Los enlaces a archivo necesitan permiso en Windows: sin él,
// esos casos se dicen omitidos.
// =============================================================================

import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { register } from 'node:module'
import { promises as fs } from 'node:fs'
import { rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { EscritorioArchivos } from './adaptadores/escritorioElectron.ts'

const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') throw new Error('ServicioArchivos importó electron desde ' + ctx.parentURL)
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs))
const { ServicioArchivos } = await import('./ServicioArchivos.ts')
const { sigueDentroDeLaRaiz } = await import('./rutaReal.ts')

const escritorio: EscritorioArchivos = {
  revelarEnCarpeta: () => {},
  abrirRuta: async () => '',
  imagenDesdeUrlDatos: () => ({ isEmpty: () => true }) as never,
  guardarConDialogo: async () => ({ canceled: true, filePath: '' })
}

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}
async function lanza(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}
const existe = (p: string): Promise<boolean> => fs.lstat(p).then(() => true, () => false)

const tmp = realpathSync(crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-ruta-real-')))
const raiz = path.join(tmp, 'proyecto')
const fuera = path.join(tmp, 'fuera')
const fueraArchivo = path.join(fuera, 'secreto.txt')

/** Enlace a carpeta: junction en Windows (no pide permiso), enlace simbólico en el resto. */
const enlazarCarpeta = (destino: string, enlace: string): Promise<void> => fs.symlink(destino, enlace, 'junction')
/** Enlace a archivo; false si el sistema no lo permite (Windows sin modo desarrollador). */
async function enlazarArchivo(destino: string, enlace: string): Promise<boolean> {
  try {
    await fs.symlink(destino, enlace, 'file')
    return true
  } catch {
    return false
  }
}

try {
  await fs.mkdir(path.join(raiz, 'src'), { recursive: true })
  await fs.mkdir(fuera)
  await fs.writeFile(path.join(raiz, 'src', 'a.txt'), 'A')
  await fs.writeFile(fueraArchivo, 'SECRETO')
  await enlazarCarpeta(fuera, path.join(raiz, 'escape'))
  const conArchivo = await enlazarArchivo(fueraArchivo, path.join(raiz, 'enlace.txt'))
  const conColgante = await enlazarArchivo(path.join(fuera, 'nuevo.txt'), path.join(raiz, 'colgante.txt'))

  hr('1. sigueDentroDeLaRaiz sobre el disco')
  const s = (rel: string, seguirUltimo = true): Promise<boolean> => sigueDentroDeLaRaiz(raiz, path.join(raiz, rel), { seguirUltimo })
  check('1a', await s('src/a.txt'), 'un archivo normal del proyecto')
  check('1b', await s('src/nuevo.txt'), 'un archivo que aún no existe, en una carpeta del proyecto')
  check('1c', await s('src/x/y/z.txt'), 'una ruta entera que aún no existe')
  check('1d', await sigueDentroDeLaRaiz(raiz, raiz, { seguirUltimo: false }), 'la raíz misma, también sin seguir el último tramo')
  check('1e', !(await s('escape/secreto.txt')), 'un archivo a través de una carpeta enlazada fuera: no')
  check('1f', !(await s('escape/creado.txt')), 'un archivo NUEVO a través de una carpeta enlazada fuera: no')
  check('1g', !(await s('escape')), 'la carpeta enlazada siguiéndola: no')
  check('1h', await s('escape', false), 'la carpeta enlazada sin seguirla (borrarla o renombrarla): sí')
  if (conArchivo) {
    check('1i', !(await s('enlace.txt')), 'un archivo enlazado fuera, siguiéndolo: no')
    check('1j', await s('enlace.txt', false), 'el mismo enlace sin seguirlo: sí')
  } else console.log('OMITIDO (1i, 1j) este sistema no deja crear enlaces a archivo')
  if (conColgante) check('1k', !(await s('colgante.txt')), 'un enlace colgante hacia fuera: escribir crearía su destino, así que no')
  else console.log('OMITIDO (1k) este sistema no deja crear enlaces a archivo')
  const raizPorEnlace = path.join(tmp, 'atajo')
  await enlazarCarpeta(raiz, raizPorEnlace)
  check('1l', await sigueDentroDeLaRaiz(raizPorEnlace, path.join(raizPorEnlace, 'src', 'a.txt'), { seguirUltimo: true }), 'un proyecto abierto por una ruta con enlace sigue funcionando')
  const disco = (codigo: string) => ({
    realpath: async (r: string) => {
      if (r === raiz) return raiz
      throw Object.assign(new Error(codigo), { code: codigo })
    },
    existeEntrada: async () => false
  })
  check('1m', !(await sigueDentroDeLaRaiz(raiz, path.join(raiz, 'x'), { seguirUltimo: true }, disco('ELOOP'))), 'un bucle de enlaces cuenta como fuera')
  check('1n', !(await sigueDentroDeLaRaiz(raiz, path.join(raiz, 'x'), { seguirUltimo: true }, disco('EACCES'))), 'un error que no es "no existe" cuenta como fuera')
  const raizSinRealpath = (codigo: string) => ({
    realpath: async () => {
      throw Object.assign(new Error(codigo), { code: codigo })
    },
    existeEntrada: async () => false
  })
  check('1o', await sigueDentroDeLaRaiz(raiz, path.join(raiz, 'x'), { seguirUltimo: true }, raizSinRealpath('UNKNOWN')), 'un volumen que no sabe resolver la raíz no deja el proyecto inservible')
  check('1p', !(await sigueDentroDeLaRaiz(raiz, path.join(raiz, 'x'), { seguirUltimo: true }, raizSinRealpath('ENOENT'))), 'sin raíz, nada pasa')

  hr('2. ServicioArchivos aplica la guarda en cada operación')
  const svc = new ServicioArchivos({ raizProyecto: raiz, escritorio, log: () => {} })
  check('2a', (await svc.leerArchivo('src/a.txt')).contenido === 'A', 'leer un archivo normal')
  check('2b', (await svc.leerArchivo('escape/secreto.txt')).contenido === 'SECRETO', 'leer a través del enlace sí (solo lo enseña la ventana; un `npm link` se puede mirar)')
  check('2c', await lanza(() => svc.escribirArchivo('escape/secreto.txt', 'PISADO')), 'guardar a través del enlace: rechazado')
  check('2d', (await fs.readFile(fueraArchivo, 'utf8')) === 'SECRETO', 'el archivo de fuera sigue intacto')
  check('2e', await lanza(() => svc.crearEntrada('escape', 'creado.txt', 'file')), 'crear dentro de la carpeta enlazada: rechazado')
  check('2f', !(await existe(path.join(fuera, 'creado.txt'))), 'y no aparece nada fuera')
  check('2g', (await svc.listarDirectorio('escape')).some((x) => x.nombre === 'secreto.txt'), 'listar la carpeta enlazada también')
  check('2g2', await lanza(() => svc.abrirRuta('escape/secreto.txt')), 'abrirla con la app del sistema no: podría ejecutar un programa del host')
  const pegadoRechazado = await lanza(() => svc.pegar({ destDir: 'src', srcs: ['escape/secreto.txt'], op: 'copiar' }))
  check('2h', pegadoRechazado && !(await existe(path.join(raiz, 'src', 'secreto.txt'))), 'copiar desde el enlace no trae el archivo de fuera al proyecto')
  await svc.escribirArchivo('src/b.txt', 'B')
  check('2i', (await fs.readFile(path.join(raiz, 'src', 'b.txt'), 'utf8')) === 'B', 'guardar un archivo normal sigue funcionando')
  const renombrado = await svc.renombrar('escape', 'escape2')
  check('2j', renombrado.ruta === 'escape2' && (await existe(path.join(raiz, 'escape2'))) && (await existe(fueraArchivo)), 'renombrar el enlace mueve el enlace, no su destino')
  const borrado = await svc.borrarVarios(['escape2'])
  check('2k', borrado.borrados.length === 1 && (await existe(fueraArchivo)), `borrar el enlace lo quita sin tocar lo de fuera -> ${JSON.stringify(borrado)}`)
  if (conArchivo) {
    check('2l', await lanza(() => svc.escribirArchivo('enlace.txt', 'PISADO')), 'guardar en un archivo enlazado fuera: rechazado')
    check('2m', (await fs.readFile(fueraArchivo, 'utf8')) === 'SECRETO', 'el archivo de fuera sigue intacto')
  } else console.log('OMITIDO (2l, 2m) este sistema no deja crear enlaces a archivo')
  if (conColgante) {
    check('2n', await lanza(() => svc.escribirArchivo('colgante.txt', 'X')), 'guardar en un enlace colgante: rechazado')
    check('2o', !(await existe(path.join(fuera, 'nuevo.txt'))), 'y su destino de fuera no se crea')
  } else console.log('OMITIDO (2n, 2o) este sistema no deja crear enlaces a archivo')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

hr(`VEREDICTO: ${passed}/${passed + failed} PASS${failed ? ' — HAY FAIL' : ' — TODO PASS'}`)
process.exit(failed ? 1 : 0)
