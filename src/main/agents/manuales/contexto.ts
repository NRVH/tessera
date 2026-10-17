// =============================================================================
// Lee el contexto de una sesión de agente manual con la fuente que definió el usuario: su
// comando en la shell nativa o en el contenedor del perfil (con el `HOME` del agente y la
// carpeta del proyecto), o el final de su archivo. La lectura de la salida es la pura de
// `shared/contextoAgenteManual.ts`; aquí, dónde y cómo se ejecuta.
// =============================================================================

import { open } from 'node:fs/promises'
import path from 'node:path'
import { citarSh } from '../../../shared/citarShell.ts'
import { leerContexto, TOPE_LECTURA_BYTES, type FuenteContexto, type LecturaContexto } from '../../../shared/contextoAgenteManual.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import { txAgentes } from '../textos.ts'

/** Lo que hace falta saber de la sesión para leer su contexto. */
export interface SesionConContexto {
  profileId: string
  projectHostPath: string
  host: boolean
  /** Su `HOME` en el contenedor; vacío en nativo, donde es la carpeta personal de siempre. */
  home: string
  fuente: FuenteContexto
}

export interface DepsContexto {
  plataforma: Plataforma
  homedir: string
  /** La orden en la shell nativa, en la carpeta del proyecto; la salida útil o un error. */
  ejecutarNativo: (orden: string, cwd: string) => Promise<{ ok: boolean; salida: string }>
  /** La orden con `bash` en el contenedor del perfil, en la carpeta del proyecto. */
  ejecutarEnContenedor: (s: SesionConContexto, orden: string) => Promise<{ ok: boolean; salida: string }>
  /** Los últimos `bytes` de un archivo del equipo. */
  leerFinal: (ruta: string, bytes: number) => Promise<string>
}

/** La ruta de `~/…` o relativa, como palabra de `sh`: la casa sin citar para que se expanda. */
export function rutaParaSh(valor: string): string {
  if (valor === '~') return '"$HOME"'
  if (valor.startsWith('~/')) return `"$HOME"/${citarSh(valor.slice(2))}`
  return citarSh(valor)
}

/** Tope de la orden dentro del contenedor, en segundos: `timeout` mata también lo de dentro. */
export const TOPE_CONTENEDOR_S = 10

/**
 * La orden que corre en el contenedor: con la casa del agente y su PATH (los mismos que al
 * lanzarlo), con tope propio y, si es un archivo, solo su final.
 */
export function ordenEnContenedor(fuente: FuenteContexto, home: string): string {
  const entorno = `export HOME=${citarSh(home)} PATH=${citarSh(`${home}/.local/bin`)}:/home/agente/.local/bin:"$PATH"; `
  const cuerpo = fuente.origen === 'comando' ? fuente.valor : `tail -c ${TOPE_LECTURA_BYTES} -- ${rutaParaSh(fuente.valor)}`
  return `${entorno}exec timeout -k 2 ${TOPE_CONTENEDOR_S} bash -c ${citarSh(cuerpo)}`
}

/** El archivo en el equipo: `~` es la carpeta personal y una ruta relativa cuelga del proyecto. */
export function rutaNativa(valor: string, homedir: string, proyecto: string, plataforma: Plataforma): string {
  const p = plataforma === 'windows' ? path.win32 : path.posix
  if (valor === '~') return homedir
  if (valor.startsWith('~/') || (plataforma === 'windows' && valor.startsWith('~\\'))) return p.join(homedir, valor.slice(2))
  return p.isAbsolute(valor) ? valor : p.join(proyecto, valor)
}

/** Los últimos `bytes` del archivo; la primera línea puede quedar cortada, y la lectura lo tolera. */
export async function leerFinal(ruta: string, bytes: number): Promise<string> {
  const fh = await open(ruta, 'r')
  try {
    const { size } = await fh.stat()
    const largo = Math.min(size, bytes)
    const buf = Buffer.alloc(largo)
    await fh.read(buf, 0, largo, size - largo)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

async function salidaDe(s: SesionConContexto, deps: DepsContexto): Promise<{ ok: boolean; salida: string }> {
  const { fuente } = s
  if (!s.host) return deps.ejecutarEnContenedor(s, ordenEnContenedor(fuente, s.home))
  if (fuente.origen === 'comando') return deps.ejecutarNativo(fuente.valor, s.projectHostPath)
  const ruta = rutaNativa(fuente.valor, deps.homedir, s.projectHostPath, deps.plataforma)
  return { ok: true, salida: await deps.leerFinal(ruta, TOPE_LECTURA_BYTES) }
}

/** El contexto de la sesión; nunca rechaza: un fallo vuelve como error para el pie. */
export async function leerContextoDeSesion(s: SesionConContexto, deps: DepsContexto): Promise<LecturaContexto> {
  try {
    const r = await salidaDe(s, deps)
    const lectura = leerContexto(r.salida, s.fuente)
    if (lectura.ok || r.ok) return lectura
    const t = txAgentes().contexto
    const queFalla = s.fuente.origen === 'comando' ? t.comandoFallo : t.archivoFallo
    return { ok: false, error: t.conMotivo(queFalla, r.salida.trim().slice(0, 200) || t.sinSalida) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
