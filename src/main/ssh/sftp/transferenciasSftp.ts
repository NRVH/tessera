// =============================================================================
// Lo largo del explorador SFTP: bajar y subir archivos y carpetas enteras y borrar en el servidor, con el
// avance y la cancelación que les da quien los lanza. Nunca se deja un archivo a medias encima de uno bueno:
// se escribe a un temporal al lado y se renombra al final, en el equipo y en el servidor. Los enlaces solo se
// siguen si apuntan a un archivo (una carpeta enlazada podría dar vueltas). Depende de `ClienteSftp`.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================
import { randomBytes } from 'node:crypto'
import { constants as fsc } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Plataforma } from '../../../shared/plataforma.ts'
import { nombreValido } from '../transferenciaBuzon.ts'
import { ErrorSftp, type ClienteSftp } from './ClienteSftp.ts'
import { ESTADO, tipoDeModo } from './protocoloSftp.ts'

/** Trozo de lectura y escritura, y cuántos van en vuelo a la vez (lo que da velocidad con latencia). */
const TROZO = 32 * 1024
const EN_VUELO = 16

/** El avance de una operación: bytes (o elementos, al borrar) y el nombre en curso. */
export interface Avance {
  sumar: (n: number) => void
  actual: (nombre: string) => void
  readonly cancelada: boolean
}

/** Una operación cancelada por el usuario. */
export class Cancelada extends Error {}

function vigilar(a: Avance): void {
  if (a.cancelada) throw new Cancelada('cancelada')
}

/** Une una carpeta remota (POSIX) y un nombre. */
export function unirRemota(carpeta: string, nombre: string): string {
  return carpeta.endsWith('/') ? `${carpeta}${nombre}` : `${carpeta}/${nombre}`
}

/** El último tramo de una ruta remota. */
export function baseRemota(ruta: string): string {
  return ruta.replace(/\/+$/, '').split('/').pop() ?? ''
}

/** La carpeta de una ruta remota. */
export function carpetaRemota(ruta: string): string {
  const sin = ruta.replace(/\/+$/, '')
  const i = sin.lastIndexOf('/')
  return i <= 0 ? '/' : sin.slice(0, i)
}

/**
 * Una ruta remota que llega del renderer: absoluta, sin NUL y sin `.`/`..` como tramo (el servidor las
 * resolvería, pero lo que se borra o se pisa tiene que ser lo que se ve). `/` no se toca nunca.
 */
export function rutaRemotaValida(ruta: unknown): ruta is string {
  if (typeof ruta !== 'string' || !ruta.startsWith('/') || ruta.includes('\0') || ruta.length > 4096) return false
  const tramos = ruta.split('/').slice(1)
  return tramos.every((t, i) => (t !== '' || i === tramos.length - 1) && t !== '.' && t !== '..') && ruta !== '/'
}

/** Un elemento de lo que se va a mover: su ruta relativa (con `/`), si es carpeta y lo que pesa. */
export interface Elemento {
  rel: string
  carpeta: boolean
  tamano: number
}

/** El árbol remoto bajo `raiz` (incluida), para bajarlo. Los enlaces a carpeta o rotos se saltan. */
export async function recorrerRemoto(c: ClienteSftp, raiz: string, a: Avance): Promise<Elemento[]> {
  const inicio = await c.stat(raiz)
  if (tipoDeModo(inicio.permisos) !== 'carpeta') return [{ rel: '', carpeta: false, tamano: inicio.tamano ?? 0 }]
  const elementos: Elemento[] = [{ rel: '', carpeta: true, tamano: 0 }]
  const pendientes = ['']
  while (pendientes.length > 0) {
    vigilar(a)
    const rel = pendientes.pop()!
    for (const e of await c.listar(rel ? unirRemota(raiz, rel) : raiz)) {
      const hijo = rel ? `${rel}/${e.nombre}` : e.nombre
      let tipo = tipoDeModo(e.atributos.permisos)
      let tamano = e.atributos.tamano ?? 0
      if (tipo === 'enlace') {
        const destino = await c.stat(unirRemota(raiz, hijo)).catch(() => null)
        tipo = destino && tipoDeModo(destino.permisos) === 'archivo' ? 'archivo' : 'otro'
        tamano = destino?.tamano ?? 0
      }
      if (tipo === 'carpeta') {
        elementos.push({ rel: hijo, carpeta: true, tamano: 0 })
        pendientes.push(hijo)
      } else if (tipo === 'archivo') elementos.push({ rel: hijo, carpeta: false, tamano })
    }
  }
  return elementos
}

/** El árbol local bajo `raiz` (incluida), para subirlo. Los enlaces a carpeta se saltan. */
export async function recorrerLocal(raiz: string, a: Avance): Promise<Elemento[]> {
  const inicio = await stat(raiz)
  if (!inicio.isDirectory()) return [{ rel: '', carpeta: false, tamano: inicio.size }]
  const elementos: Elemento[] = [{ rel: '', carpeta: true, tamano: 0 }]
  const pendientes = ['']
  while (pendientes.length > 0) {
    vigilar(a)
    const rel = pendientes.pop()!
    for (const nombre of await readdir(rel ? path.join(raiz, ...rel.split('/')) : raiz)) {
      const hijo = rel ? `${rel}/${nombre}` : nombre
      const abs = path.join(raiz, ...hijo.split('/'))
      const l = await lstat(abs)
      if (l.isDirectory()) {
        elementos.push({ rel: hijo, carpeta: true, tamano: 0 })
        pendientes.push(hijo)
      } else if (l.isFile()) elementos.push({ rel: hijo, carpeta: false, tamano: l.size })
      else if (l.isSymbolicLink()) {
        const s = await stat(abs).catch(() => null)
        if (s?.isFile()) elementos.push({ rel: hijo, carpeta: false, tamano: s.size })
      }
    }
  }
  return elementos
}

/** Corre `n` obreros sobre una cola compartida; el primer fallo para a los demás y se relanza. */
async function obreros(n: number, trabajo: () => Promise<boolean>): Promise<void> {
  let fallo: unknown = null
  const uno = async (): Promise<void> => {
    try {
      while (fallo === null && (await trabajo()));
    } catch (e) {
      fallo ??= e
    }
  }
  await Promise.all(Array.from({ length: n }, uno))
  if (fallo !== null) throw fallo
}

/** Baja un archivo a un temporal al lado de `local` y lo renombra al acabar (pisa solo entonces). */
async function bajarArchivo(c: ClienteSftp, remoto: string, local: string, tamano: number, a: Avance): Promise<void> {
  const parcial = `${local}.tessera-parcial`
  const handle = await c.abrir(remoto, 'leer')
  const fd = await open(parcial, 'w')
  let hecho = false
  try {
    // Los tramos se reparten sobre la marcha desde un cursor: el tamaño lo dice el servidor, y una cola
    // entera de antemano (cientos de GB aparentes de un archivo disperso) congelaría el main.
    const repetir: Array<[number, number]> = []
    let cursor = 0
    let fin = false
    await obreros(EN_VUELO, async () => {
      vigilar(a)
      let tramo = repetir.shift()
      if (!tramo && !fin && cursor < tamano) {
        tramo = [cursor, Math.min(TROZO, tamano - cursor)]
        cursor += tramo[1]
      }
      if (!tramo) return false
      const datos = await c.leer(handle, tramo[0], tramo[1])
      if (datos === null || datos.length === 0) {
        // Fin antes de lo anunciado (encogió, o el tamaño era falso): no se piden más tramos.
        fin = true
        return true
      }
      await fd.write(datos, 0, datos.length, tramo[0])
      a.sumar(datos.length)
      if (datos.length < tramo[1]) repetir.push([tramo[0] + datos.length, tramo[1] - datos.length])
      return true
    })
    // Lo que creciera mientras tanto, en orden hasta el final.
    for (let desde = tamano; ; ) {
      vigilar(a)
      const datos = await c.leer(handle, desde, TROZO)
      if (datos === null || datos.length === 0) break
      await fd.write(datos, 0, datos.length, desde)
      desde += datos.length
      a.sumar(datos.length)
    }
    await fd.close()
    await rename(parcial, local)
    hecho = true
  } finally {
    if (!hecho) {
      await fd.close().catch(() => {})
      await rm(parcial, { force: true }).catch(() => {})
    }
    await c.cerrar(handle).catch(() => {})
  }
}

/**
 * Sube un archivo a un temporal al lado de `remoto` (creado en exclusiva) y lo renombra al acabar. Si
 * `remoto` existe y se pidió reemplazar, se reemplaza de una vez si el servidor sabe (`posix-rename`) o
 * borrándolo justo antes; conserva sus permisos. Sin reemplazar, un `remoto` que aparezca entre medias falla.
 */
async function subirArchivo(c: ClienteSftp, local: string, remoto: string, reemplazar: boolean, a: Avance): Promise<void> {
  const previo = await c.lstatSiExiste(remoto)
  if (previo && !reemplazar) throw new ErrorSftp(ESTADO.FALLO, `«${baseRemota(remoto)}» ya existe en el servidor.`)
  if (previo && tipoDeModo(previo.permisos) === 'carpeta') throw new ErrorSftp(ESTADO.FALLO, `«${baseRemota(remoto)}» es una carpeta en el servidor.`)
  const temporal = unirRemota(carpetaRemota(remoto), `.${baseRemota(remoto)}.tessera-${randomBytes(4).toString('hex')}`)
  const fd = await open(local, fsc.O_RDONLY)
  let handle: Buffer | null = await c.abrir(temporal, 'crear', 0o644)
  try {
    const tamano = (await fd.stat()).size
    let desde = 0
    await obreros(EN_VUELO, async () => {
      vigilar(a)
      if (desde >= tamano) return false
      const aqui = desde
      const largo = Math.min(TROZO, tamano - aqui)
      desde += largo
      const datos = Buffer.alloc(largo)
      const { bytesRead } = await fd.read(datos, 0, largo, aqui)
      await c.escribirEn(handle!, aqui, datos.subarray(0, bytesRead))
      a.sumar(bytesRead)
      return true
    })
    await c.cerrar(handle)
    handle = null
    if (previo?.permisos !== null && previo?.permisos !== undefined) await c.setPermisos(temporal, previo.permisos & 0o7777).catch(() => {})
    if (previo && c.extensiones.has('posix-rename@openssh.com')) await c.renameReemplazando(temporal, remoto)
    else {
      if (previo) await c.remove(remoto)
      await c.rename(temporal, remoto)
    }
  } catch (e) {
    if (handle) await c.cerrar(handle).catch(() => {})
    await c.remove(temporal).catch(() => {})
    throw e
  } finally {
    await fd.close().catch(() => {})
  }
}

/** Baja `remoto` (archivo o carpeta entera) como `local`. Una carpeta que ya exista se mezcla. */
export async function bajar(c: ClienteSftp, remoto: string, local: string, plataforma: Plataforma, a: Avance): Promise<void> {
  const elementos = await recorrerRemoto(c, remoto, a)
  const malo = elementos.find((e) => e.rel !== '' && !e.rel.split('/').every((t) => nombreValido(t, plataforma)))
  if (malo) throw new ErrorSftp(ESTADO.FALLO, `«${malo.rel}» no se puede guardar en este equipo con ese nombre.`)
  for (const e of elementos) {
    vigilar(a)
    const destino = e.rel ? path.join(local, ...e.rel.split('/')) : local
    if (e.carpeta) await mkdir(destino, { recursive: true })
    else {
      a.actual(e.rel || baseRemota(remoto))
      await bajarArchivo(c, e.rel ? unirRemota(remoto, e.rel) : remoto, destino, e.tamano, a)
    }
  }
}

/** Sube `local` (archivo o carpeta entera) como `remoto`. Una carpeta que ya exista se mezcla. */
export async function subir(c: ClienteSftp, local: string, remoto: string, reemplazar: boolean, a: Avance): Promise<void> {
  for (const e of await recorrerLocal(local, a)) {
    vigilar(a)
    const destino = e.rel ? unirRemota(remoto, e.rel) : remoto
    if (e.carpeta) {
      const hay = await c.lstatSiExiste(destino)
      if (!hay) await c.mkdir(destino)
      else if (tipoDeModo(hay.permisos) !== 'carpeta') throw new ErrorSftp(ESTADO.FALLO, `«${e.rel || baseRemota(remoto)}» existe en el servidor y no es una carpeta.`)
    } else {
      a.actual(e.rel || path.basename(local))
      await subirArchivo(c, e.rel ? path.join(local, ...e.rel.split('/')) : local, destino, reemplazar, a)
    }
  }
}

/** Lo que pesa (en bytes) un árbol. */
export function pesoDe(elementos: readonly Elemento[]): number {
  return elementos.reduce((n, e) => n + (e.carpeta ? 0 : e.tamano), 0)
}

/** Borra en el servidor un archivo, un enlace (no lo que apunta) o una carpeta con todo su contenido. */
export async function borrar(c: ClienteSftp, ruta: string, a: Avance): Promise<void> {
  vigilar(a)
  const at = await c.lstat(ruta)
  if (tipoDeModo(at.permisos) === 'carpeta') {
    for (const e of await c.listar(ruta)) await borrar(c, unirRemota(ruta, e.nombre), a)
    a.actual(baseRemota(ruta))
    await c.rmdir(ruta)
  } else {
    a.actual(baseRemota(ruta))
    await c.remove(ruta)
  }
  a.sumar(1)
}
