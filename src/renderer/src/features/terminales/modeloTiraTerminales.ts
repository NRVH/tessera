// =============================================================================
// El orden de la tira de terminales, en lógica pura: locales y SSH se intercalan y cada proyecto
// recuerda el suyo. Las SSH son del perfil, así que su sitio en la tira no puede vivir en su lista:
// el orden va por contexto, con claves que dicen de qué clase es cada pestaña. Sin proyecto no hay
// locales y el orden ES la lista del perfil. Cerrar la pestaña que se ve pasa a su vecina EN LA TIRA.
// Entre arranques los ids cambian, así que se guarda con marcas que los sobreviven.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { cerrarLocal } from './cierreLocal.ts'
import { cerrarTerminal, seleccionarTerminal, type ShellTerminal, type EstadoTerminalesShell } from './modeloTerminalesShell.ts'
import {
  abrirSsh,
  cerrarSsh,
  elegirSsh,
  esPestanaSftp,
  perfilDeContexto,
  reordenarSsh,
  soltarSsh,
  sshDePerfil,
  type DatosPestanaSsh,
  type EstadoPestanasSsh
} from './modeloPestanasSsh.ts'

/** contexto (`perfil|ruta`) -> claves de sus pestañas, en el orden de la tira. Sin entrada = primero las SSH. */
export type EstadoOrdenTira = Readonly<Record<string, readonly string[]>>

export const ordenInicialTira: EstadoOrdenTira = {}

/** Lo que manda sobre la tira. */
export interface EstadoTira {
  terminalesShell: EstadoTerminalesShell
  ssh: EstadoPestanasSsh
  orden: EstadoOrdenTira
}

export const claveLocal = (id: string): string => `l:${id}`
export const claveSsh = (id: string): string => `s:${id}`
export const esClaveSsh = (clave: string): boolean => clave.startsWith('s:')
export const idDeClave = (clave: string): string => clave.slice(2)

/** ¿Es el contexto de «ningún proyecto» del perfil (`perfil|`)? */
function sinProyecto(contexto: string): boolean {
  return contexto.indexOf('|') === contexto.length - 1
}

/** Las claves en el orden de la tira: las guardadas que siguen vivas y, detrás, las que no estaban. */
export function ordenVisible(
  guardado: readonly string[] | undefined,
  ssh: readonly Pick<DatosPestanaSsh, 'id'>[],
  locales: readonly Pick<ShellTerminal, 'id'>[]
): string[] {
  const vivas = [...ssh.map((t) => claveSsh(t.id)), ...locales.map((t) => claveLocal(t.id))]
  if (guardado === undefined) return vivas
  const existen = new Set(vivas)
  const fijadas = guardado.filter((c) => existen.has(c))
  const yaEstan = new Set(fijadas)
  return [...fijadas, ...vivas.filter((c) => !yaEstan.has(c))]
}

/** La tira de un contexto. */
export function clavesDeContexto(e: EstadoTira, contexto: string): string[] {
  return ordenVisible(e.orden[contexto], sshDePerfil(e.ssh, perfilDeContexto(contexto)), e.terminalesShell[contexto]?.lista ?? [])
}

/** `clave` puesta antes de `antesDe` (null = al final), o null si no cambia nada o alguna no está. */
function moverClave(claves: readonly string[], clave: string, antesDe: string | null): string[] | null {
  if (!claves.includes(clave) || clave === antesDe) return null
  const sin = claves.filter((c) => c !== clave)
  const i = antesDe === null ? sin.length : sin.indexOf(antesDe)
  if (i === -1) return null
  sin.splice(i, 0, clave)
  return sin.every((c, j) => c === claves[j]) ? null : sin
}

/** Mueve una pestaña en la tira de un contexto. Devuelve el MISMO estado si nada cambia. */
export function moverEnTira(e: EstadoTira, contexto: string, clave: string, antesDe: string | null): EstadoTira {
  const siguiente = moverClave(clavesDeContexto(e, contexto), clave, antesDe)
  if (siguiente === null) return e
  if (sinProyecto(contexto)) return { ...e, ssh: reordenarSsh(e.ssh, perfilDeContexto(contexto), siguiente.map(idDeClave)) }
  return { ...e, orden: { ...e.orden, [contexto]: siguiente } }
}

/**
 * Abre una SSH y la deja al final de la tira del contexto en que se pidió, junto al botón que la abrió. Sin
 * fijar antes el orden, una tira sin acomodar la pintaría entre las SSH, delante de las locales.
 */
export function abrirSshEnTira(e: EstadoTira, contexto: string, perfilId: string, conexionId: string, alias: string, sftp = false): EstadoTira {
  const orden = sinProyecto(contexto) || e.orden[contexto] !== undefined ? e.orden : { ...e.orden, [contexto]: clavesDeContexto(e, contexto) }
  return { ...e, orden, ssh: abrirSsh(e.ssh, contexto, perfilId, conexionId, alias, sftp) }
}

/**
 * A quién se pasa al cerrar: la de la derecha en la tira y, si no, la de la izquierda. Una SSH recién
 * restaurada se salta: verse la conectaría sola, y puede pedir una contraseña que nadie espera. Si no
 * queda otra (`null`), decide el cierre de cada clase: el panel no se queda sin nada que enseñar.
 */
function vecinaAlCerrar(e: EstadoTira, contexto: string, clave: string): string | null {
  const claves = clavesDeContexto(e, contexto)
  const i = claves.indexOf(clave)
  if (i === -1) return null
  const ssh = sshDePerfil(e.ssh, perfilDeContexto(contexto))
  const elegible = (c: string): boolean => c !== clave && (!esClaveSsh(c) || ssh.find((t) => t.id === idDeClave(c))?.restaurada === undefined)
  return claves.slice(i + 1).find(elegible) ?? claves.slice(0, i).reverse().find(elegible) ?? null
}

/** Deja a la vista una pestaña del contexto. */
function mirar(e: EstadoTira, contexto: string, clave: string): EstadoTira {
  const id = idDeClave(clave)
  if (esClaveSsh(clave)) return { ...e, ssh: elegirSsh(e.ssh, perfilDeContexto(contexto), contexto, id) }
  return { ...e, terminalesShell: seleccionarTerminal(e.terminalesShell, contexto, id), ssh: soltarSsh(e.ssh, contexto) }
}

/** Cierra una local; si era la que se veía, se pasa a su vecina de la tira. */
export function cerrarLocalEnTira(e: EstadoTira, clave: string, id: string): EstadoTira {
  const seVeia = e.ssh.activaPorContexto[clave] === undefined && e.terminalesShell[clave]?.activoId === id
  const vecina = seVeia ? vecinaAlCerrar(e, clave, claveLocal(id)) : null
  // Con vecina no pasa por `cerrarLocal`: elegiría una SSH que al final no se mira y le quitaría la marca de restaurada.
  if (vecina !== null) return mirar({ ...e, terminalesShell: cerrarTerminal(e.terminalesShell, clave, id) }, clave, vecina)
  const r = cerrarLocal(e.terminalesShell, e.ssh, clave, id)
  return { ...e, terminalesShell: r.shell, ssh: r.ssh }
}

/** Cierra una SSH; en cada contexto que la miraba se pasa a su vecina en la tira de ESE contexto. */
export function cerrarSshEnTira(e: EstadoTira, perfilId: string, id: string): EstadoTira {
  const clave = claveSsh(id)
  const vecinas = Object.entries(e.ssh.activaPorContexto)
    .filter(([contexto, elegida]) => elegida === id && perfilDeContexto(contexto) === perfilId)
    .map(([contexto]) => [contexto, vecinaAlCerrar(e, contexto, clave)] as const)
  let tras: EstadoTira = { ...e, ssh: cerrarSsh(e.ssh, perfilId, id) }
  for (const [contexto, vecina] of vecinas) if (vecina !== null) tras = mirar(tras, contexto, vecina)
  return tras
}

/** Olvida el orden de los proyectos que ya no están abiertos. Devuelve el MISMO objeto si no sobra nada. */
export function podarOrden(orden: EstadoOrdenTira, proyectosVivos: Iterable<string>): EstadoOrdenTira {
  const vivos = new Set(proyectosVivos)
  const claves = Object.keys(orden)
  if (claves.every((k) => vivos.has(k))) return orden
  const salida: Record<string, readonly string[]> = {}
  for (const k of claves) if (vivos.has(k)) salida[k] = orden[k]
  return salida
}

/** La marca de cada SSH: su conexión, su clase y cuál es de las iguales, en el orden de la lista, que se conserva al restaurar. */
function marcasSsh(lista: readonly DatosPestanaSsh[]): Map<string, string> {
  const vistas = new Map<string, number>()
  const marcas = new Map<string, string>()
  for (const t of lista) {
    const base = `s:${esPestanaSftp(t) ? 'f' : 't'}:${t.conexionId}`
    const n = vistas.get(base) ?? 0
    vistas.set(base, n + 1)
    marcas.set(t.id, `${base}:${n}`)
  }
  return marcas
}

/** La marca de una local: su posición en la lista, que es en la que vuelven. */
const marcaLocal = (i: number): string => `l:${i}`

/** El orden de la tira con marcas que sobreviven al reinicio; `undefined` si el proyecto no tiene uno propio. */
export function marcasDeOrden(
  guardado: readonly string[] | undefined,
  ssh: readonly DatosPestanaSsh[],
  locales: readonly ShellTerminal[]
): string[] | undefined {
  if (guardado === undefined) return undefined
  const deSsh = marcasSsh(ssh)
  return ordenVisible(guardado, ssh, locales).map((c) =>
    esClaveSsh(c) ? (deSsh.get(idDeClave(c)) as string) : marcaLocal(locales.findIndex((t) => t.id === idDeClave(c)))
  )
}

/** El orden guardado, con los ids de esta sesión. Lo que ya no existe se descarta. */
export function ordenDesdeMarcas(marcas: readonly string[], ssh: readonly DatosPestanaSsh[], locales: readonly ShellTerminal[]): string[] {
  const clavePorMarca = new Map<string, string>()
  for (const [id, marca] of marcasSsh(ssh)) clavePorMarca.set(marca, claveSsh(id))
  locales.forEach((t, i) => clavePorMarca.set(marcaLocal(i), claveLocal(t.id)))
  return marcas.flatMap((m) => clavePorMarca.get(m) ?? [])
}
