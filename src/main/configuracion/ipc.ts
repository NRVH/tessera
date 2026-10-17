// =============================================================================
// IPC de la copia de la configuración: exportar (armar, cifrar con la frase y guardar con el
// diálogo nativo) e importar en tres pasos (abrir y leer la cabecera, descifrar con la frase y, ya
// fusionados los perfiles en el renderer, dar de alta las conexiones elegidas). Lo descifrado se queda en
// el main hasta CONEXIONES u OLVIDAR: ningún secreto cruza al renderer. Un `.tessera` abierto desde el
// sistema se abre igual, sin diálogo (`copiasPendientes.ts`).
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import type { BrowserWindow, IpcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  COPIA_CONFIGURACION_CHANNELS as C,
  type AbrirResult,
  type ConexionesRequest,
  type DescifrarRequest,
  type DescifrarResult,
  type ExportarRequest,
  type ExportarResult,
  type ResultadoConexiones
} from '../../shared/copia-configuracion-ipc'
import { EXTENSION_COPIA, MIN_FRASE } from '../../shared/copiaConfiguracion'
import type { Plataforma } from '../../shared/plataforma'
import { writeFileAtomicSync } from '../util/atomicWrite'
import { elegirConDialogo, guardarConDialogo } from '../util/adaptadores/dialogosNativos'
import { cifrarCopia, copiaSinCifrar, descifrarCopia, leerArchivoCopia, type ArchivoCopia } from './cifradoFrase'
import { txConfiguracion } from './textos.ts'
import { conectarAvisoCopias, tomarCopiaPendiente } from './copiasPendientes'
import { copiaDelSistemaAceptable } from './rutaCopiaSistema'
import { leerSeleccionConexiones } from '../../shared/seleccionCopia'
import { armarContenido, leerContenido, previaConexiones, seleccionarContenido, type ContenidoCopia, type FuentesConexiones } from './contenido'

/** Una copia es texto: más que esto no es una copia de Tessera. */
const TOPE_ARCHIVO_BYTES = 64 * 1024 * 1024
/** Cuánto vive un archivo abierto (y lo descifrado de él) sin importarse ni soltarse. */
const VIDA_ABIERTO_MS = 15 * 60_000
const filtros = (): Array<{ name: string; extensions: string[] }> => [
  { name: txConfiguracion().filtro, extensions: [EXTENSION_COPIA] }
]

export interface DepsCopiaConfiguracion {
  ipc: Pick<IpcMain, 'handle'>
  ventana: () => BrowserWindow | null
  plataforma: Plataforma
  version: string
  fuentes: FuentesConexiones
  importarSsh: (copia: unknown, perfiles: ReadonlySet<string>) => Promise<{ anadidas: number; saltadas: Array<{ alias: string; motivo: string }>; sinSecreto: string[] }>
  importarBd: (copia: unknown, perfiles: ReadonlySet<string>) => { anadidas: number; saltadas: Array<{ alias: string; motivo: string }>; revisar: string[] }
  /** ¿Hay ya en este equipo una conexión con ese id? Para marcarla en la vista previa. */
  yaEsta: { ssh: (id: string) => boolean; bd: (id: string) => boolean }
}

interface Abierto {
  archivo: ArchivoCopia
  contenido?: ContenidoCopia
}

/** `tessera-configuracion-AAAA-MM-DD.tessera`. */
function nombrePropuesto(ahora = new Date()): string {
  return `tessera-configuracion-${ahora.toISOString().slice(0, 10)}.${EXTENSION_COPIA}`
}

async function exportar(d: DepsCopiaConfiguracion, req: ExportarRequest): Promise<ExportarResult> {
  // Sin frase solo si se pide así, explícito: una frase vacía o corta por sí sola no basta.
  const sinFrase = req?.sinFrase === true
  if (!sinFrase && (typeof req?.frase !== 'string' || req.frase.length < MIN_FRASE)) throw new Error(txConfiguracion().fraseCorta(MIN_FRASE))
  const { contenido, resumen } = armarContenido(req, d.fuentes)
  const r = await guardarConDialogo('copia-configuracion', nombrePropuesto(), { filters: filtros() }, { ventana: d.ventana() })
  if (r.canceled || !r.filePath) return { estado: 'cancelado' }
  const meta = { plataforma: d.plataforma, app: d.version }
  const archivo = sinFrase ? copiaSinCifrar(JSON.stringify(contenido), meta) : await cifrarCopia(JSON.stringify(contenido), req.frase, meta)
  writeFileAtomicSync(r.filePath, JSON.stringify(archivo, null, 2))
  return { estado: 'guardado', nombre: path.basename(r.filePath), resumen }
}

async function abrir(d: DepsCopiaConfiguracion, abiertos: Map<string, Abierto>): Promise<AbrirResult> {
  const r = await elegirConDialogo('copia-configuracion', { properties: ['openFile'], filters: filtros() }, { ventana: d.ventana() })
  const ruta = r.filePaths[0]
  if (r.canceled || !ruta) return { estado: 'cancelado' }
  return abrirRuta(ruta, abiertos)
}

/** Lee la cabecera de una copia y la deja abierta con su token: lo mismo la elegida a mano que la del sistema. */
async function abrirRuta(ruta: string, abiertos: Map<string, Abierto>): Promise<AbrirResult> {
  try {
    if ((await stat(ruta)).size > TOPE_ARCHIVO_BYTES) return { estado: 'error', error: txConfiguracion().demasiadoGrande }
    const leido = leerArchivoCopia(await readFile(ruta, 'utf8'))
    if (!leido.ok) return { estado: 'error', error: leido.error }
    // Un solo archivo abierto a la vez: abrir otro suelta el anterior.
    abiertos.clear()
    const token = randomUUID()
    abiertos.set(token, { archivo: leido.archivo })
    // Si el renderer no llega a soltarlo (se recarga, se cae), lo descifrado no se queda en memoria.
    setTimeout(() => abiertos.delete(token), VIDA_ABIERTO_MS).unref()
    const { creado, plataforma, app } = leido.archivo
    return { estado: 'abierto', token, nombre: path.basename(ruta), creado, plataforma, app, cifrado: leido.archivo.cifrado !== null }
  } catch {
    return { estado: 'error', error: txConfiguracion().noSeLeyo }
  }
}

/**
 * La copia que llegó del sistema: solo un archivo regular de este equipo. La ruta se mira antes de
 * tocar el disco (en Windows, solo con tocar una ruta de red ya se habla con ese servidor) y otra
 * vez resuelta, por si un enlace lleva fuera. El diálogo de abrir a mano no pasa por aquí.
 */
async function abrirDelSistema(ruta: string, abiertos: Map<string, Abierto>): Promise<AbrirResult> {
  const rechazo: AbrirResult = { estado: 'error', error: txConfiguracion().soloLocales }
  if (!copiaDelSistemaAceptable(ruta, true)) return rechazo
  try {
    const real = await realpath(ruta)
    if (!copiaDelSistemaAceptable(real, (await stat(real)).isFile())) return rechazo
    return await abrirRuta(real, abiertos)
  } catch {
    return { estado: 'error', error: txConfiguracion().noSeLeyo }
  }
}

async function descifrar(d: DepsCopiaConfiguracion, abiertos: Map<string, Abierto>, req: DescifrarRequest): Promise<DescifrarResult> {
  const a = abiertos.get(req?.token)
  if (!a) return { ok: false, error: txConfiguracion().noAbierto }
  const r = await descifrarCopia(a.archivo, typeof req.frase === 'string' ? req.frase : '')
  if (!r.ok) return r
  const leido = leerContenido(r.contenido)
  if (!leido) return { ok: false, error: txConfiguracion().contenidoIlegible }
  a.contenido = leido.contenido
  const { perfiles, agentes, ajustes } = leido.contenido
  return { ok: true, perfiles, agentes, ajustes, conexiones: previaConexiones(leido.contenido, d.yaEsta), perfilesInvalidos: leido.invalidos }
}

/** Perfiles cuya carpeta `.ssh` no está en este equipo. */
function revisarPerfiles(c: ContenidoCopia): string[] {
  return c.perfiles
    .filter((p) => typeof p.sshDir === 'string' && p.sshDir !== '' && !existsSync(p.sshDir))
    .map((p) => txConfiguracion().sshNoEsta(p.nombre))
}

async function conexiones(d: DepsCopiaConfiguracion, abiertos: Map<string, Abierto>, req: ConexionesRequest): Promise<ResultadoConexiones> {
  const a = abiertos.get(req?.token)
  if (!a?.contenido) throw new Error(txConfiguracion().noAbiertoCorto)
  abiertos.delete(req.token)
  const c = seleccionarContenido(a.contenido, leerSeleccionConexiones(req.seleccion))
  const perfiles = new Set(c.perfiles.map((p) => p.id))
  // SSH antes: una base puede ir por el túnel de una conexión SSH de la copia.
  const ssh = await d.importarSsh(c.ssh, perfiles)
  const bd = d.importarBd(c.bd, perfiles)
  const sinSecretoSsh = ssh.sinSecreto.map((a) => txConfiguracion().sinSecretoSsh(a))
  return {
    ssh: { anadidas: ssh.anadidas, saltadas: ssh.saltadas },
    bd: { anadidas: bd.anadidas, saltadas: bd.saltadas },
    revisar: [...revisarPerfiles(c), ...sinSecretoSsh, ...bd.revisar]
  }
}

export function registrarIpcCopiaConfiguracion(d: DepsCopiaConfiguracion): void {
  const abiertos = new Map<string, Abierto>()
  d.ipc.handle(C.EXPORTAR, (_e, req: ExportarRequest) => exportar(d, req))
  d.ipc.handle(C.ABRIR, () => abrir(d, abiertos))
  d.ipc.handle(C.DESCIFRAR, (_e, req: DescifrarRequest) => descifrar(d, abiertos, req))
  d.ipc.handle(C.CONEXIONES, (_e, req: ConexionesRequest) => conexiones(d, abiertos, req))
  d.ipc.handle(C.OLVIDAR, (_e, req: { token?: unknown }) => {
    if (typeof req?.token === 'string') abiertos.delete(req.token)
  })
  d.ipc.handle(C.TOMAR_PENDIENTE, () => {
    const ruta = tomarCopiaPendiente()
    return ruta === null ? null : abrirDelSistema(ruta, abiertos)
  })
  // El empujón para que el renderer no sondee; perderlo no cuesta nada, la copia sigue apuntada.
  conectarAvisoCopias(() => {
    const win = d.ventana()
    if (win !== null && !win.isDestroyed()) win.webContents.send(C.HAY_PENDIENTE)
  })
}
