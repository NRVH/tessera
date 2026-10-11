// =============================================================================
// Lo que toca disco al importar y exportar con OpenSSH. Importar: leer el `config` elegido, con tope. Exportar:
// pide el destino, copia las claves a una carpeta NUEVA junto a él y escribe el `config` (de `exportarOpenSsh.ts`),
// todo solo para el usuario, como las copias de Tessera: el ssh del sistema rechaza una clave, o un `config`, con
// permisos de más. Sin `electron`: el diálogo y los permisos llegan por parámetro. Al renderer no llega ninguna ruta.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { userInfo } from 'node:os'
import path from 'node:path'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { SshConexion, SshExportacionOpenSsh, SshGrupo } from '../../../shared/ssh-ipc.ts'
import { identidadOpenSsh, planOpenSsh, seleccionExportar } from '../exportarOpenSsh.ts'
import { errorHost, errorPuerto, errorTuneles, errorUsuario } from '../validacionSsh.ts'

/** Tope del archivo `config` de OpenSSH: uno de verdad no pasa de unos KiB. */
const TOPE_CONFIG_OPENSSH_BYTES = 1024 * 1024

/** Lee el archivo elegido; un error sin rutas del host si no se puede o es demasiado grande para ser un `config`. */
export async function leerConfigOpenSsh(ruta: string): Promise<string> {
  try {
    if ((await stat(ruta)).size > TOPE_CONFIG_OPENSSH_BYTES) throw new Error('grande')
    return await readFile(ruta, 'utf8')
  } catch (e) {
    throw new Error('No se pudo leer ese archivo como configuración de OpenSSH.', { cause: e })
  }
}

/** El usuario local, para `%u` en un `IdentityFile`; vacío si el sistema no lo dice. */
export function usuarioLocal(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

/** Lo que necesita la exportación de fuera. */
export interface DepsExportacionOpenSsh {
  /** El diálogo de guardar: la ruta elegida, o `null` si se cancela. */
  elegirDestino: () => Promise<string | null>
  /** El texto de la copia de la clave de una conexión; lanza si no está. */
  leerClave: (id: string) => Promise<string>
  permisos: {
    asegurarCarpeta: (dir: string) => Promise<void>
    /** Escribe un archivo NUEVO (falla si ya existe) solo para el usuario. */
    escribirProtegida: (ruta: string, texto: string) => Promise<void>
  }
  home: string
  plataforma: Plataforma
  log: (mensaje: string) => void
}

/** Tantas carpetas `-claves-N` ya ocupadas no son un caso real: se para en vez de seguir probando. */
const INTENTOS_CARPETA = 100

/** Crea `<destino>-claves` (o `-claves-2`…, sin tocar una que ya exista) y la deja solo para el usuario. */
async function carpetaNueva(destino: string, d: DepsExportacionOpenSsh): Promise<string> {
  for (let n = 1; n <= INTENTOS_CARPETA; n++) {
    const dir = `${destino}-claves${n === 1 ? '' : `-${n}`}`
    try {
      await mkdir(dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw e
    }
    await d.permisos.asegurarCarpeta(dir)
    return dir
  }
  throw new Error('demasiadas carpetas de claves junto al destino')
}

/** Las copias de las claves que se pueden leer, por id; las que faltan se cuentan. */
async function textosDeClaves(elegidas: readonly SshConexion[], d: DepsExportacionOpenSsh): Promise<{ textos: Map<string, string>; sinClave: number }> {
  const textos = new Map<string, string>()
  let sinClave = 0
  for (const c of elegidas) {
    if (c.metodo !== 'clave') continue
    try {
      if (c.clave === undefined) throw new Error('sin copia')
      textos.set(c.id, await d.leerClave(c.id))
    } catch (e) {
      sinClave++
      d.log(`exportar a OpenSSH: la conexión ${c.id} va sin clave: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { textos, sinClave }
}

/** ¿Está en `~/.ssh` con otro nombre que `config`? Entonces basta un `Include` de su nombre. */
function esIncluible(destino: string, d: DepsExportacionOpenSsh): boolean {
  const p = d.plataforma === 'windows' ? path.win32 : path.posix
  const carpeta = p.dirname(destino)
  const dirSsh = p.join(d.home, '.ssh')
  const igual = d.plataforma === 'windows' ? carpeta.toLowerCase() === dirSsh.toLowerCase() : carpeta === dirSsh
  return igual && p.basename(destino) !== 'config'
}

/**
 * Exporta `ids` (o todas) de la lista del perfil, con los bastiones que necesitan. El `config` se escribe en un
 * temporal protegido y se renombra encima del elegido (el diálogo ya preguntó si se sustituye). Si algo falla,
 * la carpeta de claves recién creada se borra. `null` si se cancela el diálogo.
 */
export async function exportarOpenSsh(
  lista: { grupos: readonly SshGrupo[]; conexiones: readonly SshConexion[] },
  ids: readonly string[] | undefined,
  d: DepsExportacionOpenSsh
): Promise<SshExportacionOpenSsh | null> {
  const { elegidas, bastiones } = seleccionExportar(lista.conexiones, ids)
  if (elegidas.length === 0) throw new Error('No hay conexiones que exportar.')
  // Se validó al guardar, pero el registro se edita a mano y esto acaba en un config que ssh ejecuta.
  for (const c of elegidas) {
    const error = errorHost(c.host) ?? errorPuerto(c.puerto) ?? errorUsuario(c.usuario) ?? errorTuneles(c.tuneles)
    if (error !== null) throw new Error(`La conexión "${c.alias}" tiene un dato que no vale: ${error} Edítala para corregirlo.`)
  }
  const destino = await d.elegirDestino()
  if (destino === null) return null
  const { textos, sinClave } = await textosDeClaves(elegidas, d)
  let carpeta: string | null = null
  try {
    carpeta = textos.size > 0 ? await carpetaNueva(destino, d) : null
    const dirClaves = carpeta ?? ''
    const plan = planOpenSsh(elegidas, { grupos: lista.grupos, conClave: new Set(textos.keys()), identidad: (a) => identidadOpenSsh(path.join(dirClaves, a), d.home, d.plataforma) })
    for (const k of plan.claves) await d.permisos.escribirProtegida(path.join(dirClaves, k.archivo), textos.get(k.id) as string)
    // Si el elegido es un enlace, se sustituye el archivo al que apunta y el enlace se queda.
    const real = await realpath(destino).catch(() => destino)
    const temporal = `${real}.${randomUUID()}.tmp`
    try {
      await d.permisos.escribirProtegida(temporal, plan.texto)
      await rename(temporal, real)
    } catch (e) {
      await rm(temporal, { force: true })
      throw e
    }
    d.log(`exportar a OpenSSH: ${elegidas.length} conexión(es), ${plan.claves.length} clave(s), ${bastiones} bastión(es) añadidos`)
    return {
      archivo: path.basename(destino),
      conexiones: elegidas.length,
      bastiones,
      carpetaClaves: carpeta === null ? null : path.basename(carpeta),
      claves: plan.claves.length,
      sinClave,
      conSecreto: elegidas.filter((c) => c.tieneSecreto).length,
      renombradas: plan.renombradas,
      incluible: esIncluible(destino, d)
    }
  } catch (e) {
    if (carpeta !== null) await rm(carpeta, { recursive: true, force: true }).catch(() => undefined)
    d.log(`exportar a OpenSSH falló: ${String(e)}`)
    throw new Error('No se pudo escribir la exportación en esa carpeta.', { cause: e })
  }
}
