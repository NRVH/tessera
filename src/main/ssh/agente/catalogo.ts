// =============================================================================
// Descubrimiento del SSH del usuario y del perfil; solo entrega material público al buzón.
// Reúne identidades y aplica permisos para ofrecer al contenedor únicamente las claves autorizadas.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { glob, open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Profile } from '../../profiles/types.ts'
import type { ClaveAgente } from '../../../shared/ssh-agente-ipc.ts'
import { comprobarPublica, Lector } from './protocolo.ts'
import { FraseNecesaria, leerClave, validarCifradoClave } from './lectorClaves.ts'
import { analizarLinea, identidadesConfig, type EntornoConfig } from './configuracion.ts'
import { permiteClave } from './permisos.ts'
import { lanzadaPorElArnes } from '../../../shared/arnesE2e.ts'

export function carpetaSshGlobal(entorno: EntornoConfig, argv = process.argv, variables = process.env): string {
  return lanzadaPorElArnes(argv) && variables.TESSERA_E2E_SSH_DIR ? path.resolve(variables.TESSERA_E2E_SSH_DIR) : path.join(entorno.home, '.ssh')
}

export async function leerLimitado(ruta: string): Promise<string> {
  const archivo = await open(ruta, 'r')
  try {
    if (!(await archivo.stat()).isFile()) throw new Error('No es un archivo SSH')
    const bytes = Buffer.alloc(1024 * 1024 + 1)
    let total = 0
    while (total < bytes.length) {
      const { bytesRead: leidos } = await archivo.read(bytes, total, bytes.length - total, null)
      if (!leidos) break
      total += leidos
    }
    if (total === bytes.length) throw new Error('Archivo SSH demasiado grande')
    return bytes.subarray(0, total).toString('utf8')
  } finally { await archivo.close() }
}

interface Seguimiento { archivos: Map<string, string>; patrones: Map<string, string> }
async function huella(ruta: string): Promise<string> {
  try { const a = await stat(ruta); return `${a.ino}:${a.size}:${a.mtimeMs}:${a.ctimeMs}` } catch { return 'ausente' }
}
async function coincidencias(patron: string): Promise<string[]> {
  const archivos: string[] = []
  for await (const archivo of glob(patron.replace(/\\/g, '/'))) archivos.push(archivo)
  return archivos.sort()
}
async function vigilar(ruta: string, seguimiento?: Seguimiento): Promise<void> {
  seguimiento?.archivos.set(ruta, await huella(ruta))
}

/** Los includes se expanden en el host; ningún archivo incluido se copia al contenedor. */
export async function leerConfiguracion(ruta: string, entorno: EntornoConfig, vistos = new Set<string>(), carpeta = path.join(entorno.home, '.ssh'), seguimiento?: Seguimiento): Promise<string> {
  if (vistos.has(ruta) || vistos.size >= 64) return ''
  vistos.add(ruta)
  let texto: string
  await vigilar(ruta, seguimiento)
  try { texto = await leerLimitado(ruta) } catch { return '' }
  const salida: string[] = []
  for (const linea of texto.split(/\r?\n/)) {
    const parte = analizarLinea(linea)
    if (parte?.opcion !== 'include') {
      if (parte?.opcion === 'identityfile') {
        const valor = parte.argumentos[0] ?? 'none'
        const trasladado = valor.startsWith('~/.ssh/') ? path.join(carpeta, valor.slice(7)) : valor
        salida.push(`IdentityFile "${trasladado.replace(/\\/g, '/').replace(/"/g, '\\"')}"`)
      } else salida.push(linea)
      continue
    }
    for (const patron of parte.argumentos) {
      const expandido = patron.startsWith('~/.ssh/') ? path.join(carpeta, patron.slice(7)) : patron.startsWith('~/') ? entorno.home + patron.slice(1) : path.resolve(carpeta, patron)
      const archivos = await coincidencias(expandido)
      seguimiento?.patrones.set(expandido, JSON.stringify(archivos))
      for (const archivo of archivos) salida.push(await leerConfiguracion(archivo, entorno, vistos, carpeta, seguimiento))
    }
  }
  return salida.join('\n')
}

export async function catalogo(perfil: Profile, entorno: EntornoConfig, seguimiento?: Seguimiento): Promise<{ claves: ClaveAgente[]; config: string }> {
  const global = carpetaSshGlobal(entorno)
  const carpetas = [...new Set([global, ...(perfil.sshDir ? [path.resolve(perfil.sshDir)] : [])])]
  const config = (await Promise.all(carpetas.map((carpeta) => leerConfiguracion(path.join(carpeta, 'config'), entorno, new Set(), carpeta, seguimiento)))).join('\nHost *\n')
  const rutas = new Map<string, Set<string>>()
  for (const identidad of identidadesConfig(config, entorno)) {
    const alias = rutas.get(identidad.ruta) ?? new Set<string>()
    identidad.alias.forEach((nombre) => alias.add(nombre))
    rutas.set(identidad.ruta, alias)
  }
  for (const carpeta of carpetas) {
    await vigilar(carpeta, seguimiento)
    let archivos: string[]
    try { archivos = await readdir(carpeta) } catch { continue }
    for (const nombre of archivos) {
      if (carpeta === global && !/^id_(ed25519|ecdsa|rsa|dsa|ed25519_sk|ecdsa_sk)$/.test(nombre)) continue
      const ruta = path.join(carpeta, nombre)
      if (!rutas.has(ruta)) rutas.set(ruta, new Set())
    }
  }
  const claves: ClaveAgente[] = []
  for (const [ruta, alias] of rutas) {
    await vigilar(ruta, seguimiento)
    await vigilar(ruta + '.pub', seguimiento)
    try {
      if (!/-----BEGIN (OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(await leerLimitado(ruta))) continue
      const carpeta = path.dirname(ruta)
      const relativa = path.relative(entorno.home, carpeta)
      claves.push({ ruta, nombre: path.basename(ruta), carpeta: relativa === '' ? '~' : !relativa.startsWith('..') && !path.isAbsolute(relativa) ? '~/' + relativa.replace(/\\/g, '/') : carpeta, alias: [...alias], permitida: permiteClave(perfil, ruta, entorno.plataforma) })
    } catch { /* Un archivo ausente o ilegible no puede ser una identidad ofrecida. */ }
  }
  return { claves, config }
}

export async function publicaSinFrase(texto: string, ruta: string): Promise<Buffer> {
  if (texto.includes('BEGIN OPENSSH PRIVATE KEY')) {
    const lector = new Lector(Buffer.from(texto.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64'))
    if (lector.bytes(15).toString() !== 'openssh-key-v1\0') throw new Error('Formato incorrecto')
    const cifrado = lector.texto()
    const derivacion = lector.texto()
    validarCifradoClave(cifrado, derivacion, lector.cadena())
    if (lector.entero() !== 1) throw new Error('Se requiere una sola clave')
    return comprobarPublica(lector.cadena())
  }
  try { return leerClave(texto).publica } catch (error) {
    if (!(error instanceof FraseNecesaria)) throw error
    const partes = (await leerLimitado(ruta + '.pub')).trim().split(/\s+/)
    if (!/^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp(256|384|521))$/.test(partes[0])) throw new Error('Clave pública no admitida', { cause: error })
    return comprobarPublica(Buffer.from(partes[1], 'base64'))
  }
}

export class CacheCatalogo {
  private readonly entradas = new Map<string, { seguimiento: Seguimiento; resultado: Awaited<ReturnType<typeof catalogo>> }>()
  async leer(perfil: Profile, entorno: EntornoConfig): ReturnType<typeof catalogo> {
    const clave = JSON.stringify([perfil, entorno, carpetaSshGlobal(entorno)])
    const previa = this.entradas.get(clave)
    if (previa) {
      const archivos = await Promise.all([...previa.seguimiento.archivos].map(async ([ruta, valor]) => await huella(ruta) === valor))
      const patrones = await Promise.all([...previa.seguimiento.patrones].map(async ([patron, valor]) => JSON.stringify(await coincidencias(patron)) === valor))
      if ([...archivos, ...patrones].every(Boolean)) return previa.resultado
    }
    const seguimiento: Seguimiento = { archivos: new Map(), patrones: new Map() }
    const resultado = await catalogo(perfil, entorno, seguimiento)
    if (this.entradas.size >= 32) this.entradas.delete(this.entradas.keys().next().value!)
    this.entradas.set(clave, { seguimiento, resultado })
    return resultado
  }
}
