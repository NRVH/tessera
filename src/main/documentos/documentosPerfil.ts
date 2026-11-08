// =============================================================================
// Lista y lee los documentos de referencia de un perfil en sus carpetas del equipo. Un agente solo nombra el
// documento: el nombre se busca en el listado, así que nunca se lee algo fuera de las carpetas elegidas, ni a
// través de un enlace, ni un archivo que no sea texto. Los nombres son relativos a cada carpeta: valen igual
// en un contenedor, donde la ruta del equipo no existe.
// Decisiones: docs/decisiones/agentes/documentos-del-perfil.md
// =============================================================================

import { constants } from 'node:fs'
import { lstat, open, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  EXTENSIONES_DOCUMENTO,
  MAX_BYTES_DOCUMENTO,
  MAX_DOCUMENTOS,
  PROFUNDIDAD_DOCUMENTOS
} from '../../shared/documentosPerfil.ts'

export interface DocumentoListado {
  /** `<carpeta>/<ruta dentro de ella>`, con `/`: lo único que ve el agente. */
  nombre: string
  bytes: number
}

export interface ListadoDocumentos {
  documentos: DocumentoListado[]
  /** Las carpetas elegidas que no existen en este equipo, por su nombre. */
  noDisponibles: string[]
  /** Se dejó de listar al llegar a `MAX_DOCUMENTOS`. */
  truncado: boolean
}

export type LecturaDocumento =
  | { estado: 'ok'; nombre: string; contenido: string }
  | { estado: 'no-existe' }
  | { estado: 'ambiguo'; candidatos: string[] }
  | { estado: 'grande'; bytes: number }
  | { estado: 'no-texto' }

interface Encontrado extends DocumentoListado {
  ruta: string
}

/** El nombre visible de cada carpeta; dos con el mismo nombre se distinguen con `-2`, `-3`… por orden. */
function prefijos(carpetas: readonly string[]): string[] {
  const usados = new Map<string, number>()
  return carpetas.map((c) => {
    const base = basename(c.replace(/[\\/]+$/, '')) || 'documentos'
    const n = (usados.get(base.toLowerCase()) ?? 0) + 1
    usados.set(base.toLowerCase(), n)
    return n === 1 ? base : `${base}-${n}`
  })
}

const esDocumento = (nombre: string): boolean => EXTENSIONES_DOCUMENTO.includes(extname(nombre).toLowerCase())

/** Recorre una carpeta sin seguir enlaces ni entrar en lo oculto (`.git`, `.obsidian`…). */
async function recorrer(dir: string, visible: string, nivel: number, salida: Encontrado[]): Promise<boolean> {
  let entradas
  try {
    entradas = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  entradas.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entradas) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (nivel < PROFUNDIDAD_DOCUMENTOS && (await recorrer(ruta, `${visible}/${e.name}`, nivel + 1, salida))) return true
    } else if (e.isFile() && esDocumento(e.name)) {
      // `lstat` y no `stat`: solo cuenta un archivo regular, nunca lo que señale un enlace. Es la única barrera
      // donde `O_NOFOLLOW` no existe (Windows).
      const info = await lstat(ruta).catch(() => null)
      if (!info?.isFile()) continue
      // Lleno y aún aparece otro documento: solo entonces se dejó algo fuera.
      if (salida.length >= MAX_DOCUMENTOS) return true
      salida.push({ nombre: `${visible}/${e.name}`, bytes: info.size, ruta })
    }
  }
  return false
}

async function encontrar(carpetas: readonly string[]): Promise<{ encontrados: Encontrado[]; noDisponibles: string[]; truncado: boolean }> {
  const encontrados: Encontrado[] = []
  const noDisponibles: string[] = []
  let truncado = false
  const nombres = prefijos(carpetas)
  for (let i = 0; i < carpetas.length && !truncado; i++) {
    // `stat` en la carpeta elegida: la eligió el usuario en su equipo, y puede ser un enlace o una junction.
    const info = await stat(carpetas[i]).catch(() => null)
    if (!info?.isDirectory()) {
      noDisponibles.push(nombres[i])
      continue
    }
    truncado = await recorrer(carpetas[i], nombres[i], 1, encontrados)
  }
  return { encontrados, noDisponibles, truncado }
}

export async function listarDocumentos(carpetas: readonly string[]): Promise<ListadoDocumentos> {
  const { encontrados, noDisponibles, truncado } = await encontrar(carpetas)
  return { documentos: encontrados.map(({ nombre, bytes }) => ({ nombre, bytes })), noDisponibles, truncado }
}

/** El nombre completo o, si no lleva carpeta, el del archivo, si solo hay uno así. Sin distinguir mayúsculas. */
function elegir(encontrados: readonly Encontrado[], pedido: string): Encontrado | { candidatos: string[] } | null {
  const buscado = pedido.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  const exacto = encontrados.find((e) => e.nombre.toLowerCase() === buscado)
  if (exacto) return exacto
  const ultimo = buscado.split('/').pop() ?? ''
  const porArchivo = encontrados.filter((e) => e.nombre.toLowerCase().endsWith(`/${ultimo}`))
  if (porArchivo.length === 1) return porArchivo[0]
  return porArchivo.length > 1 ? { candidatos: porArchivo.map((e) => e.nombre) } : null
}

/**
 * UTF-8, o UTF-16 con su marca, que es lo que escribe la redirección de Windows PowerShell 5.1. Lo demás no
 * es texto que se pueda entregar sin adivinar.
 */
function decodificar(bytes: Buffer): string | null {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null
  try {
    return new TextDecoder(utf16 ?? 'utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Abre sin seguir un enlace aunque lo hayan puesto después de listar, y comprueba tamaño y texto. */
async function leerArchivo(e: Encontrado): Promise<LecturaDocumento> {
  const archivo = await open(e.ruta, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)).catch(() => null)
  if (!archivo) return { estado: 'no-existe' }
  try {
    const info = await archivo.stat()
    if (!info.isFile()) return { estado: 'no-existe' }
    if (info.size > MAX_BYTES_DOCUMENTO) return { estado: 'grande', bytes: info.size }
    const contenido = decodificar(await archivo.readFile())
    return contenido === null ? { estado: 'no-texto' } : { estado: 'ok', nombre: e.nombre, contenido }
  } finally {
    await archivo.close()
  }
}

export async function leerDocumento(carpetas: readonly string[], pedido: string): Promise<LecturaDocumento> {
  const { encontrados } = await encontrar(carpetas)
  const elegido = elegir(encontrados, pedido)
  if (elegido === null) return { estado: 'no-existe' }
  if ('candidatos' in elegido) return { estado: 'ambiguo', candidatos: elegido.candidatos }
  return leerArchivo(elegido)
}
