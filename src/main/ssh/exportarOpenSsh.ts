// =============================================================================
// «Exportar a OpenSSH…»: el texto del archivo `config` con un bloque `Host` por conexión (y los bastiones
// que necesitan), el nombre de cada `Host` y de su archivo de clave, y la ruta que lo apunta. Puro: las
// lecturas y escrituras las hace `controlador/archivosOpenSsh.ts`. Lo de vuelta lo lee `configOpenSsh.ts`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import path from 'node:path'
import type { Plataforma } from '../../shared/plataforma.ts'
import type { SshConexion, SshGrupo } from '../../shared/ssh-ipc.ts'

/** Las conexiones pedidas (todas sin `ids`) más los bastiones que necesitan, y cuántos se añadieron por eso. */
export function seleccionExportar(conexiones: readonly SshConexion[], ids?: readonly string[]): { elegidas: SshConexion[]; bastiones: number } {
  const porId = new Map(conexiones.map((c) => [c.id, c]))
  const pedidas = new Set(ids ?? conexiones.map((c) => c.id))
  const dentro = new Set<string>()
  let bastiones = 0
  for (const id of pedidas) {
    // Un ciclo de saltos (solo editando a mano) se corta en la primera repetida.
    for (let c = porId.get(id); c !== undefined && !dentro.has(c.id); c = c.saltoId === null ? undefined : porId.get(c.saltoId)) {
      dentro.add(c.id)
      if (!pedidas.has(c.id)) bastiones++
    }
  }
  return { elegidas: conexiones.filter((c) => dentro.has(c.id)), bastiones }
}

/**
 * El nombre de `Host` de un alias: letras, cifras, `.`, `_` y `-`. Lo demás (espacios, comodines, comas,
 * comillas) haría del bloque un patrón o lo partiría, y pasa a `-`.
 */
export function nombreHostOpenSsh(alias: string): string {
  // En NFC: dos formas de la misma letra serían un solo nombre de archivo en macOS.
  const limpio = alias.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '')
  return limpio === '' ? 'conexion' : limpio
}

/**
 * Un valor como lo parte OpenSSH: entre comillas si lleva espacios, comillas, `\` o `#`. Un salto de línea no tiene
 * comillas que valgan (OpenSSH lee línea a línea y abriría otra directiva), así que lanza.
 */
export function valorOpenSsh(v: string): string {
  if (/[\r\n]/.test(v)) throw new Error('un valor con un salto de línea no cabe en un config de OpenSSH')
  return /^[^\s"'\\#]+$/.test(v) ? v : `"${v.replace(/["\\]/g, '\\$&')}"`
}

/**
 * La ruta de un `IdentityFile`: con `~/` si está bajo el home (el archivo se puede llevar a otro equipo con la
 * carpeta), barras normales y el `%` doblado, porque OpenSSH expande sus tokens en ese valor.
 */
export function identidadOpenSsh(ruta: string, home: string, plataforma: Plataforma): string {
  const p = plataforma === 'windows' ? path.win32 : path.posix
  const relativa = p.relative(home, ruta)
  const bajoHome = relativa !== '' && !relativa.startsWith('..') && !p.isAbsolute(relativa)
  const texto = (bajoHome ? `~/${relativa}` : ruta).replace(/\\/g, '/').replace(/%/g, '%%')
  return valorOpenSsh(texto)
}

/** Una dirección delante de `:puerto` en un reenvío: una IPv6 entre corchetes. */
function direccion(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

/** Un texto libre (alias, grupo) en una línea de comentario. */
function comentario(texto: string): string {
  return texto.replace(/[\r\n]+/g, ' ')
}

/** Lo que pide el plan: los grupos del perfil, las conexiones cuya clave se copió y dónde queda cada copia. */
export interface OpcionesPlanOpenSsh {
  grupos: readonly SshGrupo[]
  /** Las conexiones con archivo de clave cuya copia se pudo leer. */
  conClave: ReadonlySet<string>
  /** El valor de `IdentityFile` para el archivo de clave de ese nombre. */
  identidad: (archivo: string) => string
}

/** Lo que sale del plan: el texto del `config`, qué clave va en qué archivo y lo que se cuenta al usuario. */
export interface PlanOpenSsh {
  texto: string
  claves: { id: string; archivo: string }[]
  /** Conexiones cuyo nombre de `Host` no es su alias. */
  renombradas: number
}

/** Los nombres de `Host` de cada conexión, únicos sin distinguir mayúsculas (como los compara OpenSSH). */
function nombresHost(conexiones: readonly SshConexion[]): Map<string, string> {
  const usados = new Set<string>()
  const nombres = new Map<string, string>()
  for (const c of conexiones) {
    const base = nombreHostOpenSsh(c.alias)
    let nombre = base
    for (let n = 2; usados.has(nombre.toLowerCase()); n++) nombre = `${base}-${n}`
    usados.add(nombre.toLowerCase())
    nombres.set(c.id, nombre)
  }
  return nombres
}

/** Las líneas del bloque de una conexión. */
function bloque(c: SshConexion, nombre: string, nombres: ReadonlyMap<string, string>, o: OpcionesPlanOpenSsh): string[] {
  const lineas = nombre === c.alias ? [] : [`# ${comentario(c.alias)}`]
  lineas.push(`Host ${nombre}`, `  HostName ${valorOpenSsh(c.host)}`, `  User ${valorOpenSsh(c.usuario)}`)
  if (c.puerto !== 22) lineas.push(`  Port ${c.puerto}`)
  if (c.metodo === 'clave' && o.conClave.has(c.id)) lineas.push(`  IdentityFile ${o.identidad(`id_${nombre}`)}`, '  IdentitiesOnly yes')
  const salto = c.saltoId === null ? undefined : nombres.get(c.saltoId)
  if (salto !== undefined) lineas.push(`  ProxyJump ${salto}`)
  for (const t of c.tuneles) {
    if (t.tipo === 'dinamico') lineas.push(`  DynamicForward 127.0.0.1:${t.puerto}`)
    else {
      const destino = `${direccion(t.destinoHost ?? '')}:${t.destinoPuerto}`
      lineas.push(t.tipo === 'local' ? `  LocalForward 127.0.0.1:${t.puerto} ${destino}` : `  RemoteForward ${t.puerto} ${destino}`)
    }
  }
  return lineas
}

/**
 * El `config` de las conexiones, por grupos (en su orden, y al final las de «Sin grupo»): cada una con su
 * `HostName`, `User`, `Port` si no es el 22, su copia de la clave, su bastión y sus túneles. Las contraseñas no
 * van: OpenSSH no tiene dónde guardarlas.
 */
export function planOpenSsh(conexiones: readonly SshConexion[], o: OpcionesPlanOpenSsh): PlanOpenSsh {
  const nombres = nombresHost(conexiones)
  const secciones = [...o.grupos.map((g) => ({ id: g.id as string | null, nombre: g.nombre })), { id: null, nombre: 'Sin grupo' }]
  const conocidos = new Set(o.grupos.map((g) => g.id))
  const lineas = ['# Conexiones SSH exportadas de Tessera. Las contraseñas no se exportan: ssh las pedirá al conectar.']
  const claves: PlanOpenSsh['claves'] = []
  let renombradas = 0
  for (const s of secciones) {
    const suyas = conexiones.filter((c) => (s.id === null ? c.grupoId === null || !conocidos.has(c.grupoId) : c.grupoId === s.id))
    if (suyas.length === 0) continue
    lineas.push('', `# Grupo: ${comentario(s.nombre)}`)
    for (const c of suyas) {
      const nombre = nombres.get(c.id) as string
      if (nombre !== c.alias) renombradas++
      if (c.metodo === 'clave' && o.conClave.has(c.id)) claves.push({ id: c.id, archivo: `id_${nombre}` })
      lineas.push('', ...bloque(c, nombre, nombres, o))
    }
  }
  return { texto: `${lineas.join('\n')}\n`, claves, renombradas }
}
