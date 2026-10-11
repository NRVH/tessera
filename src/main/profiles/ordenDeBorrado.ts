// =============================================================================
// Lo de un perfil solo se borra con su ORDEN explícita (`profiles:delete`), nunca porque falte en la lista
// que se guarda: un guardado incompleto conserva a los que no trae. La orden se apunta en un archivo de
// borrados pendientes antes de tocar nada, y al arrancar se terminan los que un cierre dejó a medias.
// Pura salvo el archivo (`node:fs` + `util/atomicWrite.ts`), para probarla con `node` a secas
// (`test-orden-de-borrado.mts`); la compone `agents/componer.ts`.
// Decisiones: docs/decisiones/workspace/borrar-perfil-con-orden.md
// =============================================================================
import { readFileSync } from 'node:fs'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'
import { perfilVuelveAExistir } from './borradoDePerfil.ts'

/** Lo que se escribe al guardar la lista, y los perfiles que se conservaron porque no venían en ella. */
export interface ListaAGuardar<P> {
  lista: P[]
  retenidos: P[]
}

/**
 * La lista que llega, más los perfiles de la actual que no trae, cada uno en su sitio de antes. Guardar
 * nunca quita un perfil: eso es cosa de `borrarPorOrden`.
 */
export function listaAGuardar<P extends { id: string }>(actual: readonly P[], siguiente: readonly P[]): ListaAGuardar<P> {
  const llegan = new Set(siguiente.map((p) => p.id))
  const lista = [...siguiente]
  const retenidos: P[] = []
  actual.forEach((perfil, i) => {
    if (llegan.has(perfil.id)) return
    retenidos.push(perfil)
    lista.splice(Math.min(i, lista.length), 0, perfil)
  })
  return { lista, retenidos }
}

/** Los perfiles con una orden de borrado sin terminar, en un JSON aparte de la lista de perfiles. */
export class BorradosPendientes<P extends { id: string }> {
  private readonly ruta: string
  private readonly log: (mensaje: string) => void

  constructor(ruta: string, log: (mensaje: string) => void = () => {}) {
    this.ruta = ruta
    this.log = log
  }

  /** Los apuntados. Un archivo que falta es «ninguno»; uno ilegible también, y se registra. */
  leer(): P[] {
    let texto: string
    try {
      texto = readFileSync(this.ruta, 'utf-8')
    } catch {
      return []
    }
    try {
      const datos: unknown = JSON.parse(texto)
      if (!Array.isArray(datos)) throw new Error('no es una lista')
      return datos.filter((p): p is P => typeof p === 'object' && p !== null && typeof (p as { id?: unknown }).id === 'string')
    } catch (err) {
      this.log(`[tessera] los borrados de perfil pendientes no se pueden leer y se ignoran: ${String(err)}`)
      return []
    }
  }

  apuntar(perfil: P): void {
    this.escribir([...this.leer().filter((p) => p.id !== perfil.id), perfil])
  }

  quitar(profileId: string): void {
    const antes = this.leer()
    const quedan = antes.filter((p) => p.id !== profileId)
    if (quedan.length !== antes.length) this.escribir(quedan)
  }

  private escribir(perfiles: readonly P[]): void {
    writeFileAtomicSync(this.ruta, JSON.stringify(perfiles, null, 2) + '\n')
  }
}

/** Lo que necesita la orden de borrar un perfil. */
export interface DepsOrdenDeBorrado<P extends { id: string }> {
  /** La lista de perfiles de ESTE momento. */
  lista: () => readonly P[]
  /** Persiste la lista y la reparte a quien la usa. */
  fijarLista: (lista: P[]) => void
  pendientes: Pick<BorradosPendientes<P>, 'apuntar' | 'quitar'>
  /** El borrado de lo suyo (`borrarPerfiles`): toma sus candados al llamarse, sin esperar nada antes. */
  borrar: (perfiles: readonly P[]) => Promise<void>
  log: (mensaje: string) => void
}

/**
 * El usuario borró el perfil: se apunta como pendiente, sale de la lista y se borra lo suyo; al terminar
 * se quita de pendientes. Un id que no está en la lista no borra nada. Si el guardado de la lista falla,
 * no se borra nada y la orden se olvida: el perfil sigue ahí.
 */
export async function borrarPorOrden<P extends { id: string }>(deps: DepsOrdenDeBorrado<P>, profileId: string): Promise<void> {
  const perfil = deps.lista().find((p) => p.id === profileId)
  if (!perfil) {
    deps.log(`[tessera] orden de borrar el perfil ${profileId}, que no está en la lista: no se borra nada`)
    return
  }
  deps.pendientes.apuntar(perfil)
  try {
    deps.fijarLista(deps.lista().filter((p) => p.id !== profileId))
  } catch (err) {
    deps.pendientes.quitar(profileId)
    throw err
  }
  try {
    await deps.borrar([perfil])
  } finally {
    deps.pendientes.quitar(profileId)
  }
}

/**
 * Al arrancar: termina los borrados que un cierre dejó a medias. Un perfil apuntado que sigue (o vuelve a
 * estar) en la lista no se borra: la orden no llegó a sacarlo, o se recreó.
 */
export async function terminarBorradosPendientes<P extends { id: string }>(
  pendientes: Pick<BorradosPendientes<P>, 'leer' | 'quitar'>,
  idsVivos: () => readonly string[],
  borrar: (perfiles: readonly P[]) => Promise<void>,
  log: (mensaje: string) => void
): Promise<void> {
  const apuntados = pendientes.leer()
  const aBorrar = apuntados.filter((p) => !perfilVuelveAExistir(idsVivos(), p.id))
  for (const p of apuntados) if (!aBorrar.includes(p)) pendientes.quitar(p.id)
  if (aBorrar.length === 0) return
  log(`[tessera] se termina el borrado de ${aBorrar.length} perfil(es) que quedó a medias: ${aBorrar.map((p) => p.id).join(', ')}`)
  try {
    await borrar(aBorrar)
  } finally {
    for (const p of aBorrar) pendientes.quitar(p.id)
  }
}
