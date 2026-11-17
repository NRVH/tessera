// =============================================================================
// IPC de la copia de la configuración: exportar (armar, cifrar con la frase y guardar con el diálogo
// nativo; con historial, en trozos) e importar en tres pasos (abrir y leer la cabecera, descifrar con la
// frase y, ya fusionados los perfiles en el renderer, dar de alta las conexiones, el historial, la
// configuración de Docker y los archivos de los agentes elegidos, cada uno en su perfil de destino).
// Lo descifrado (y la clave) se queda en el main hasta CONEXIONES u OLVIDAR: ningún secreto cruza al
// renderer. Un `.tessera` abierto desde el sistema se abre igual, sin diálogo (`copiasPendientes.ts`).
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import type { SinValidar } from '../../shared/ipc'
import type { BrowserWindow, IpcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  COPIA_CONFIGURACION_CHANNELS as C,
  type ResultadoAbrir,
  type PeticionConexiones,
  type PeticionDescifrar,
  type ResultadoDescifrar,
  type PeticionDiffArchivo,
  type ResultadoDiffArchivo,
  type PeticionExportar,
  type ResultadoExportar,
  type FuenteHistorial,
  type PeticionOlvidarCopia,
  type PeticionPreviaHistorial,
  type ResultadoConexiones,
  type ResumenExportacion,
  type ResumenHistorialImportado
} from '../../shared/copia-configuracion-ipc'
import { EXTENSION_COPIA, MIN_FRASE } from '../../shared/copiaConfiguracion'
import type { Plataforma } from '../../shared/plataforma'
import { escribirArchivoAtomicoSync } from '../util/escrituraAtomica'
import { elegirConDialogo, guardarConDialogo } from '../util/adaptadores/dialogosNativos'
import { descifrarCopia, prepararCopia, type ArchivoCopia } from './cifradoFrase'
import { txConfiguracion } from './textos.ts'
import { conectarAvisoCopias, tomarCopiaPendiente } from './copiasPendientes'
import { copiaDelSistemaAceptable } from './rutaCopiaSistema'
import { leerSeleccionConexiones, type SeleccionConexiones } from '../../shared/seleccionCopia'
import {
  armarContenido,
  leerContenido,
  previaConexiones,
  previaHistorial,
  reasignarContenido,
  seleccionarContenido,
  type ContenidoCopia,
  type FuentesConexiones
} from './contenido'
import { ImportadorHistorial, escribirHistorial, recogerHistorial, type DepsHistorial } from './historialCopia'
import { listarConCache } from './inclusionHistorial'
import { EscritorCopia, leerCabeceraCopia, leerTrozos, selloDe } from './trozosCopia'
import type { CapaCompartida } from '../../shared/configAgente-ipc'
import { capasParaCopia, importarConfigDocker, previaConfigDocker, type EntornoContexto } from '../agentes/configAgente/copiaConfigCompartida'
import {
  archivosParaCopia,
  diferenciaArchivo,
  elegirArchivos,
  importarArchivosAgentes,
  previaArchivosAgentes,
  type ArchivoNombrado,
  type ResultadoArchivos
} from '../agentes/configAgente/copiaArchivosAgentes'

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
  historial: DepsHistorial
  /** El contexto de los agentes: la raíz de sus capas de Docker, el global y los perfiles de este equipo, que pueden recibirlo. */
  configDocker: EntornoContexto & { perfilesAqui: () => string[]; nombreAqui: (id: string) => string | undefined }
}

interface Abierto {
  archivo: ArchivoCopia
  ruta: string
  /** El SHA-256 de la primera línea de un archivo de la versión 2 (con historial); null en la 1. */
  hashLinea: Buffer | null
  contenido?: ContenidoCopia
  /** La clave de la frase, para abrir los trozos del historial; null sin frase. */
  clave?: Buffer | null
}

/** `tessera-configuracion-AAAA-MM-DD.tessera`. */
function nombrePropuesto(ahora = new Date()): string {
  return `tessera-configuracion-${ahora.toISOString().slice(0, 10)}.${EXTENSION_COPIA}`
}

async function exportar(d: DepsCopiaConfiguracion, req: PeticionExportar): Promise<ResultadoExportar> {
  // Sin frase solo si se pide así, explícito: una frase vacía o corta por sí sola no basta.
  const sinFrase = req?.sinFrase === true
  if (!sinFrase && (typeof req?.frase !== 'string' || req.frase.length < MIN_FRASE)) throw new Error(txConfiguracion().fraseCorta(MIN_FRASE))
  const { contenido, resumen } = armarContenido(req, d.fuentes)
  if (req.apartados.configDocker === true) {
    const config = await capasParaCopia(d.configDocker, contenido.perfiles.map((p) => p.id))
    if (config) contenido.configDocker = config
  }
  await anadirArchivosAgentes(d, req, contenido, resumen)
  const r = await guardarConDialogo('copia-configuracion', nombrePropuesto(), { filters: filtros() }, { ventana: d.ventana() })
  if (r.canceled || !r.filePath) return { estado: 'cancelado' }
  const meta = { plataforma: d.plataforma, app: d.version }
  const frase = sinFrase ? null : req.frase
  if (typeof req.historial !== 'object' || req.historial === null) {
    const { archivo } = await prepararCopia(JSON.stringify(contenido), frase, meta, false)
    escribirArchivoAtomicoSync(r.filePath, JSON.stringify(archivo, null, 2))
    return { estado: 'guardado', nombre: path.basename(r.filePath), resumen }
  }
  await exportarConHistorial(d, r.filePath, { contenido, resumen, frase, nativo: req.historial.nativo === true, meta })
  return { estado: 'guardado', nombre: path.basename(r.filePath), resumen }
}

/** Cómo se nombra un archivo de agente en los avisos: con su cuenta y su perfil, o como del equipo. */
function etiquetaArchivo(a: ArchivoNombrado, nombreDePerfil: (id: string) => string): string {
  const tx = txConfiguracion().archivosAgentes
  return a.cuenta
    ? tx.deCuenta(a.nombre, tx.agentes[a.agente], a.cuenta.predeterminada ? tx.predeterminada : a.cuenta.nombre, nombreDePerfil(a.cuenta.perfil))
    : tx.nativo(a.nombre, tx.agentes[a.agente])
}

const nombreEn = (c: ContenidoCopia) => (id: string): string => c.perfiles.find((p) => p.id === id)?.nombre ?? id
/** Ya importado, el id es el del destino: el perfil se llama como aquí, no como en el archivo. */
const nombreDestino = (d: DepsCopiaConfiguracion, c: ContenidoCopia) => (id: string): string => d.configDocker.nombreAqui(id) ?? nombreEn(c)(id)

/** Los archivos de los agentes pedidos: solo lo que existe, y lo que no se puede leer con seguridad se dice. */
async function anadirArchivosAgentes(d: DepsCopiaConfiguracion, req: PeticionExportar, contenido: ContenidoCopia, resumen: ResumenExportacion): Promise<void> {
  const pide = { cuentas: req.apartados.archivosCuentas === true, nativos: req.apartados.reglasNativas === true }
  if (!pide.cuentas && !pide.nativos) return
  const { archivos, bloqueados } = await archivosParaCopia(d.historial, contenido.perfiles.map((p) => p.id), pide)
  if (archivos) contenido.archivosAgentes = archivos
  resumen.archivosAgentes = {
    cuentas: archivos?.cuentas.length ?? 0,
    nativos: Object.keys(archivos?.nativos ?? {}).length,
    bloqueados: bloqueados.map((b) => etiquetaArchivo(b, nombreEn(contenido)))
  }
}

/** El archivo de la versión 2: el contenido con el índice del historial y, detrás, las conversaciones en trozos. */
async function exportarConHistorial(
  d: DepsCopiaConfiguracion,
  ruta: string,
  o: { contenido: ContenidoCopia; resumen: ResumenExportacion; frase: string | null; nativo: boolean; meta: { plataforma: Plataforma; app: string } }
): Promise<void> {
  const fuentes = await recogerHistorial(d.historial, o.contenido.perfiles.map((p) => p.id), o.nativo, true)
  const contenido: ContenidoCopia = { ...o.contenido, historial: { fuentes: fuentes.map((f) => f.fuente) } }
  const resumen = {
    conversaciones: fuentes.reduce((n, f) => n + f.fuente.conversaciones, 0),
    bytes: fuentes.reduce((n, f) => n + f.fuente.bytes, 0),
    saltadas: 0
  }
  o.resumen.historial = resumen
  const { archivo, clave } = await prepararCopia(JSON.stringify(contenido), o.frase, o.meta, true)
  const e = await EscritorCopia.abrir(ruta, archivo, clave)
  try {
    resumen.saltadas = await escribirHistorial(e, fuentes)
    await e.cerrar()
  } catch (err) {
    // El error que ve el usuario es el de exportar; uno al borrar el temporal solo se registra.
    await e.abortar().catch((fallo: unknown) => console.warn(`[copia] no se pudo borrar el temporal de la copia: ${String(fallo)}`))
    throw err
  }
}

/** Lo que llevaría el historial de esos perfiles (y el nativo), sin abrir ninguna conversación. */
async function previaHistorialExportar(d: DepsCopiaConfiguracion, req: PeticionPreviaHistorial, listar: ReturnType<typeof listarConCache>): Promise<FuenteHistorial[]> {
  const perfiles = Array.isArray(req?.perfiles) ? req.perfiles.filter((p): p is string => typeof p === 'string') : []
  const fuentes = await recogerHistorial(d.historial, perfiles, req?.nativo === true, false, listar)
  return fuentes.map((f) => f.fuente)
}

async function abrir(d: DepsCopiaConfiguracion, abiertos: Map<string, Abierto>): Promise<ResultadoAbrir> {
  const r = await elegirConDialogo('copia-configuracion', { properties: ['openFile'], filters: filtros() }, { ventana: d.ventana() })
  const ruta = r.filePaths[0]
  if (r.canceled || !ruta) return { estado: 'cancelado' }
  return abrirRuta(ruta, abiertos)
}

/** Lee la cabecera de una copia y la deja abierta con su token: lo mismo la elegida a mano que la del sistema. */
async function abrirRuta(ruta: string, abiertos: Map<string, Abierto>): Promise<ResultadoAbrir> {
  try {
    const leido = await leerCabeceraCopia(ruta)
    if (!leido.ok) return { estado: 'error', error: leido.error }
    // Un solo archivo abierto a la vez: abrir otro suelta el anterior.
    abiertos.clear()
    const token = randomUUID()
    abiertos.set(token, { archivo: leido.archivo, ruta, hashLinea: leido.hash })
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
async function abrirDelSistema(ruta: string, abiertos: Map<string, Abierto>): Promise<ResultadoAbrir> {
  const rechazo: ResultadoAbrir = { estado: 'error', error: txConfiguracion().soloLocales }
  if (!copiaDelSistemaAceptable(ruta, true)) return rechazo
  try {
    const real = await realpath(ruta)
    if (!copiaDelSistemaAceptable(real, (await stat(real)).isFile())) return rechazo
    return await abrirRuta(real, abiertos)
  } catch {
    return { estado: 'error', error: txConfiguracion().noSeLeyo }
  }
}

async function descifrar(d: DepsCopiaConfiguracion, abiertos: Map<string, Abierto>, req: PeticionDescifrar): Promise<ResultadoDescifrar> {
  const a = abiertos.get(req?.token)
  if (!a) return { ok: false, error: txConfiguracion().noAbierto }
  const r = await descifrarCopia(a.archivo, typeof req.frase === 'string' ? req.frase : '')
  if (!r.ok) return r
  const leido = leerContenido(r.contenido)
  if (!leido) return { ok: false, error: txConfiguracion().contenidoIlegible }
  a.contenido = leido.contenido
  a.clave = r.clave
  const { perfiles, agentes, ajustes } = leido.contenido
  return {
    ok: true,
    perfiles,
    agentes,
    ajustes,
    conexiones: previaConexiones(leido.contenido, d.yaEsta),
    perfilesInvalidos: leido.invalidos,
    // Sin la primera línea de la versión 2 no hay trozos que leer: un índice suelto no se ofrece.
    historial: a.hashLinea === null ? [] : previaHistorial(leido.contenido),
    configDocker: await previaConfigDocker(d.configDocker, leido.contenido.configDocker, d.configDocker.perfilesAqui()),
    archivosAgentes: {
      ...(await previaArchivosAgentes(d.historial, leido.contenido.archivosAgentes, d.configDocker.perfilesAqui())),
      invalidos: (leido.contenido.archivosAgentes?.invalidos ?? []).map((i) => etiquetaArchivo(i, nombreEn(leido.contenido)))
    }
  }
}

/** Las dos versiones de un archivo de agente distinto, solo cuando se piden para verlas. */
async function diffArchivo(d: DepsCopiaConfiguracion, abiertos: Map<string, Abierto>, req: PeticionDiffArchivo): Promise<ResultadoDiffArchivo> {
  const a = abiertos.get(req?.token)
  if (!a?.contenido) return null
  return diferenciaArchivo(d.historial, a.contenido.archivosAgentes, req.archivo, d.configDocker.perfilesAqui())
}

/** Los archivos de agentes elegidos, ya en su destino: lo escrito y lo que hay que revisar, nombrados. */
async function importarArchivos(d: DepsCopiaConfiguracion, a: Abierto, c: ContenidoCopia, seleccion: SeleccionConexiones): Promise<{ creados: string[]; sustituidos: string[]; revisar: string[] }> {
  const elegidos = elegirArchivos(a.contenido?.archivosAgentes, seleccion)
  const r: ResultadoArchivos = await importarArchivosAgentes(d.historial, elegidos, d.configDocker.perfilesAqui())
  const tx = txConfiguracion().archivosAgentes
  // Los que no son válidos ya se avisaron al abrir el archivo y nunca se ofrecieron.
  const etiqueta = (x: ArchivoNombrado): string => etiquetaArchivo(x, nombreDestino(d, c))
  return {
    creados: r.creados.map(etiqueta),
    sustituidos: r.sustituidos.map(etiqueta),
    revisar: r.revisar.map((x) => tx.noImportado(etiqueta(x.archivo), tx.motivos[x.motivo]))
  }
}

/** La configuración de Docker elegida, ya en su destino: qué niveles se escribieron y cuáles no se pudieron. */
async function importarConfig(d: DepsCopiaConfiguracion, c: ContenidoCopia): Promise<{ hechos: string[]; revisar: string[] }> {
  if (!c.configDocker) return { hechos: [], revisar: [] }
  const tx = txConfiguracion()
  const nombre = (capa: CapaCompartida): string =>
    capa.tipo === 'global' ? tx.configGlobal : tx.configPerfil(nombreDestino(d, c)(capa.perfilId))
  const pedidas: CapaCompartida[] = [
    ...(c.configDocker.global ? [{ tipo: 'global' } as const] : []),
    ...Object.keys(c.configDocker.perfiles).map((perfilId) => ({ tipo: 'perfil', perfilId }) as const)
  ]
  const fallidas = await importarConfigDocker(d.configDocker, c.configDocker, d.configDocker.perfilesAqui())
  const claves = new Set(fallidas.map((f) => JSON.stringify(f)))
  const fallo = (x: CapaCompartida): boolean => claves.has(JSON.stringify(x))
  return { hechos: pedidas.filter((x) => !fallo(x)).map(nombre), revisar: fallidas.map((x) => tx.configNoImportada(nombre(x))) }
}

/**
 * Las conversaciones elegidas, trozo a trozo; los trozos de las fuentes no elegidas se saltan sin descifrar.
 * Un archivo dañado corta aquí, con lo escrito hasta ahí.
 */
async function importarHistorial(d: DepsCopiaConfiguracion, a: Abierto, c: ContenidoCopia, elegidas: readonly string[]): Promise<ResumenHistorialImportado | undefined> {
  if (a.hashLinea === null || elegidas.length === 0 || !c.historial) return undefined
  const perfiles = new Set(c.perfiles.map((p) => p.id))
  const fuentes = c.historial.fuentes.filter((f) => elegidas.includes(String(f.id)) && (f.perfil === null || perfiles.has(f.perfil)))
  const importador = new ImportadorHistorial(d.historial)
  importador.preparar(fuentes)
  const sello = selloDe(a.hashLinea, a.clave ?? null, a.archivo.cifrado?.sal ?? null)
  try {
    for await (const t of leerTrozos(a.ruta, a.hashLinea, sello, new Set(fuentes.map((f) => f.id)))) await importador.trozo(t)
    return importador.cerrar(null)
  } catch (err) {
    await importador.soltar()
    return importador.cerrar(txConfiguracion().historial.error(err instanceof Error ? err.message : String(err)))
  }
}

/** Perfiles nuevos cuya carpeta `.ssh` no está en este equipo; de uno que va a un perfil de aquí no se trae. */
function revisarPerfiles(c: ContenidoCopia, fusionados: ReadonlySet<string>): string[] {
  return c.perfiles
    .filter((p) => !fusionados.has(p.id) && typeof p.sshDir === 'string' && p.sshDir !== '' && !existsSync(p.sshDir))
    .map((p) => txConfiguracion().sshNoEsta(p.nombre))
}

async function conexiones(d: DepsCopiaConfiguracion, abiertos: Map<string, Abierto>, req: PeticionConexiones): Promise<ResultadoConexiones> {
  const a = abiertos.get(req?.token)
  if (!a?.contenido) throw new Error(txConfiguracion().noAbiertoCorto)
  abiertos.delete(req.token)
  const seleccion = leerSeleccionConexiones(req.seleccion)
  const elegido = seleccionarContenido(a.contenido, seleccion)
  const revisarDePerfiles = revisarPerfiles(elegido, new Set(seleccion.fusionados))
  // Cada cosa al perfil de aquí que la recibe: el mismo, uno nuevo con otro id o uno que ya existía.
  const c = reasignarContenido(elegido, seleccion.reasignar)
  const perfiles = new Set(c.perfiles.map((p) => p.id))
  // SSH antes: una base puede ir por el túnel de una conexión SSH de la copia.
  const ssh = await d.importarSsh(c.ssh, perfiles)
  const bd = d.importarBd(c.bd, perfiles)
  const sinSecretoSsh = ssh.sinSecreto.map((a) => txConfiguracion().sinSecretoSsh(a))
  const historial = await importarHistorial(d, a, c, seleccion.historial)
  const config = await importarConfig(d, c)
  const archivos = await importarArchivos(d, a, c, seleccion)
  return {
    ssh: { anadidas: ssh.anadidas, saltadas: ssh.saltadas },
    bd: { anadidas: bd.anadidas, saltadas: bd.saltadas },
    revisar: [...revisarDePerfiles, ...sinSecretoSsh, ...bd.revisar, ...config.revisar, ...archivos.revisar],
    ...(historial ? { historial } : {}),
    ...(config.hechos.length > 0 ? { configDocker: config.hechos } : {}),
    ...(archivos.creados.length > 0 || archivos.sustituidos.length > 0 ? { archivosAgentes: { creados: archivos.creados, sustituidos: archivos.sustituidos } } : {})
  }
}

export function registrarIpcCopiaConfiguracion(d: DepsCopiaConfiguracion): void {
  const abiertos = new Map<string, Abierto>()
  const listarPrevia = listarConCache()
  d.ipc.handle(C.EXPORTAR, (_e, req: PeticionExportar) => exportar(d, req))
  d.ipc.handle(C.ABRIR, () => abrir(d, abiertos))
  d.ipc.handle(C.DESCIFRAR, (_e, req: PeticionDescifrar) => descifrar(d, abiertos, req))
  d.ipc.handle(C.CONEXIONES, (_e, req: PeticionConexiones) => conexiones(d, abiertos, req))
  d.ipc.handle(C.PREVIA_HISTORIAL, (_e, req: PeticionPreviaHistorial) => previaHistorialExportar(d, req, listarPrevia))
  d.ipc.handle(C.DIFF_ARCHIVO, (_e, req: PeticionDiffArchivo) => diffArchivo(d, abiertos, req))
  d.ipc.handle(C.OLVIDAR, (_e, req: SinValidar<PeticionOlvidarCopia>) => {
    if (typeof req?.token === 'string') abiertos.delete(req.token)
  })
  d.ipc.handle(C.TOMAR_PENDIENTE, () => {
    const ruta = tomarCopiaPendiente()
    return ruta === null ? null : abrirDelSistema(ruta, abiertos)
  })
  // El empujón para que el renderer no sondee; perderlo no cuesta nada, la copia sigue apuntada.
  conectarAvisoCopias(() => {
    const ventana = d.ventana()
    if (ventana !== null && !ventana.isDestroyed()) ventana.webContents.send(C.HAY_PENDIENTE)
  })
}
