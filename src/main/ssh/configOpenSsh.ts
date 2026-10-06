// =============================================================================
// «Importar desde OpenSSH…»: el analizador de un archivo `config` de OpenSSH y lo que trae cada `Host`
// de un nombre concreto, con su clave ya importada, para que la persona lo revise antes del alta (las
// claves se inyectan: sin `fs` ni `electron`). Lo demás se cuenta. Lo usa `ControladorSsh.leerOpenSsh`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import path from 'node:path'
import type { Plataforma } from '../../shared/plataforma.ts'
import type { SshCandidataOpenSsh, SshClaveElegida } from '../../shared/ssh-ipc.ts'

/** Un `Host` concreto con lo que se importa de él, tal como venía en el archivo. */
export interface HostOpenSsh {
  alias: string
  host?: string
  puerto?: string
  usuario?: string
  identidad?: string
}

/** Lo que sale de analizar un archivo: los `Host` concretos y lo que no se sigue. */
export interface ConfigOpenSsh {
  hosts: HostOpenSsh[]
  /** Bloques `Host` con comodines o varios patrones, y bloques `Match`. */
  patrones: number
  include: number
}

const CAMPOS = new Map<string, keyof Omit<HostOpenSsh, 'alias'>>([
  ['hostname', 'host'],
  ['port', 'puerto'],
  ['user', 'usuario'],
  ['identityfile', 'identidad']
])

/** `Clave Valor`, `Clave=Valor` o `Clave = Valor`; una clave sola deja el valor vacío. */
const LINEA = /^\s*([^\s=]+)(?:\s*=\s*|\s+|$)(.*)$/

/** ¿Escapa la barra invertida al carácter siguiente? Como en OpenSSH: solo comillas, otra barra o un espacio fuera de comillas. */
function escapa(siguiente: string | undefined, comilla: string): boolean {
  return siguiente === '"' || siguiente === "'" || siguiente === '\\' || (comilla === '' && siguiente === ' ')
}

/** Qué es un carácter al partir los argumentos: un corte, un comentario, un escape, una comilla o texto. */
function pasoDe(ch: string, siguiente: string | undefined, comilla: string, empezado: boolean): 'corte' | 'comentario' | 'escape' | 'comilla' | 'texto' {
  if (comilla === '' && /\s/.test(ch)) return 'corte'
  if (comilla === '' && ch === '#' && !empezado) return 'comentario'
  if (ch === '\\' && escapa(siguiente, comilla)) return 'escape'
  if ((comilla === '' && (ch === '"' || ch === "'")) || ch === comilla) return 'comilla'
  return 'texto'
}

/**
 * Los argumentos de un valor, como los parte OpenSSH: espacios fuera de comillas, comillas dobles o simples,
 * y un `#` al empezar un argumento es un comentario. `C:\Users\…` se queda tal cual.
 */
export function argumentosOpenSsh(texto: string): string[] {
  const args: string[] = []
  let actual: string | null = null
  let comilla = ''
  for (let i = 0; i < texto.length; i++) {
    const paso = pasoDe(texto[i], texto[i + 1], comilla, actual !== null)
    if (paso === 'comentario') break
    if (paso === 'corte') {
      if (actual !== null) args.push(actual)
      actual = null
    } else if (paso === 'comilla') {
      comilla = comilla === '' ? texto[i] : ''
      actual ??= ''
    } else {
      actual = (actual ?? '') + (paso === 'escape' ? texto[++i] : texto[i])
    }
  }
  if (actual !== null) args.push(actual)
  return args
}

/**
 * Los `Host` de UN nombre concreto (sin `*`, `?` ni `!`), con `HostName`, `Port`, `User` y el primer
 * `IdentityFile`. Como en OpenSSH, el primer valor de cada directiva gana, también entre dos bloques del mismo
 * nombre. Lo de antes del primer `Host`, los `Host` con patrones y los `Match` no se importan; `Include` no se sigue.
 */
export function analizarConfigOpenSsh(texto: string): ConfigOpenSsh {
  const porNombre = new Map<string, HostOpenSsh>()
  let actual: HostOpenSsh | null = null
  let patrones = 0
  let include = 0
  for (const linea of texto.split(/\r?\n/)) {
    const m = LINEA.exec(linea)
    if (m === null || m[1].startsWith('#')) continue
    const clave = m[1].toLowerCase()
    const args = argumentosOpenSsh(m[2])
    if (clave === 'host' || clave === 'match') {
      actual = null
      if (clave === 'match' || args.length !== 1 || /[*?!]/.test(args[0])) {
        patrones++
        continue
      }
      const norma = args[0].toLowerCase()
      actual = porNombre.get(norma) ?? { alias: args[0] }
      porNombre.set(norma, actual)
    } else if (clave === 'include') {
      include++
    } else {
      const campo = CAMPOS.get(clave)
      if (actual !== null && campo !== undefined && args.length > 0) actual[campo] ??= args[0]
    }
  }
  return { hosts: [...porNombre.values()], patrones, include }
}

/** Con qué se expande un `IdentityFile`. */
export interface EntornoIdentidad {
  home: string
  /** El usuario local, para `%u`. */
  usuario: string
  plataforma: Plataforma
}

/** El `HostName` con sus tokens de uso común: `%h` (el nombre del `Host`) y `%%`. */
export function hostDe(h: HostOpenSsh): string {
  return (h.host ?? h.alias).replace(/%([%h])/g, (_t, t: string) => (t === '%' ? '%' : h.alias))
}

/**
 * La ruta de un `IdentityFile`: `~` y los tokens `%d`, `%u`, `%h`, `%r` y `%%`; una relativa, desde el home.
 * `null` con `none`. Los demás tokens se quedan y el archivo no existirá: la conexión entra con «Claves del
 * sistema». `destino` da `%h` (el host ya expandido) y `%r` (el usuario remoto).
 */
export function rutaIdentidad(valor: string, e: EntornoIdentidad, destino: { host: string; usuario: string } = { host: '%h', usuario: '%r' }): string | null {
  if (valor.toLowerCase() === 'none') return null
  const p = e.plataforma === 'windows' ? path.win32 : path.posix
  const conHome = valor === '~' || valor.startsWith('~/') || (e.plataforma === 'windows' && valor.startsWith('~\\')) ? e.home + valor.slice(1) : valor
  const tokens: Record<string, string> = { '%': '%', d: e.home, u: e.usuario, h: destino.host, r: destino.usuario }
  const expandida = conHome.replace(/%([%duhr])/g, (_t, t: string) => tokens[t])
  return p.resolve(e.home, expandida)
}

/**
 * Una ruta de red de Windows (`\\servidor\…`): no se abre al importar, porque leerla haría que Windows negociara
 * SMB con ese servidor y le mandara el hash del usuario, y el archivo de configuración puede ser ajeno.
 */
function esRutaDeRed(ruta: string, plataforma: Plataforma): boolean {
  return plataforma === 'windows' && (ruta.startsWith('\\\\') || ruta.startsWith('//'))
}

/** Lo que la lectura necesita de fuera: los nombres ocupados, las claves importadas y el registro de la app. */
export interface DepsLecturaOpenSsh {
  /** Los nombres ya usados en el perfil (con las entradas ajenas). */
  existentes: readonly string[]
  entorno: EntornoIdentidad
  /** Importa la clave con el camino del formulario (una copia provisional con su ficha); lanza si no es una clave válida. */
  importarClave: (ruta: string) => Promise<SshClaveElegida>
  log: (mensaje: string) => void
}

/** La copia de la clave del `IdentityFile`, o `null` sin él o si no se puede usar (y entonces se marca). */
async function claveDeIdentidad(h: HostOpenSsh, d: DepsLecturaOpenSsh): Promise<{ clave: SshClaveElegida | null; noUsable: boolean }> {
  const ruta = h.identidad === undefined ? null : rutaIdentidad(h.identidad, d.entorno, { host: hostDe(h), usuario: h.usuario ?? '' })
  if (ruta === null) return { clave: null, noUsable: false }
  if (esRutaDeRed(ruta, d.entorno.plataforma)) {
    d.log(`importar de OpenSSH: la clave de «${h.alias}» está en una ruta de red y no se abre`)
    return { clave: null, noUsable: true }
  }
  try {
    return { clave: await d.importarClave(ruta), noUsable: false }
  } catch (e) {
    d.log(`importar de OpenSSH: la clave de «${h.alias}» no vale: ${e instanceof Error ? e.message : String(e)}`)
    return { clave: null, noUsable: true }
  }
}

/**
 * Lo que trae cada `Host` concreto, para que la persona lo revise antes de darlo de alta: con la copia de su
 * `IdentityFile` si es una clave válida, y marcado si ya hay una conexión con ese nombre. Nunca contraseñas.
 */
export async function candidatasOpenSsh(config: ConfigOpenSsh, d: DepsLecturaOpenSsh): Promise<SshCandidataOpenSsh[]> {
  const ocupados = new Set(d.existentes.map((a) => a.trim().toLowerCase()))
  const candidatas: SshCandidataOpenSsh[] = []
  for (const h of config.hosts) {
    const puerto = h.puerto === undefined ? 22 : /^\d+$/.test(h.puerto) ? Number(h.puerto) : null
    const { clave, noUsable } = await claveDeIdentidad(h, d)
    candidatas.push({
      alias: h.alias,
      host: hostDe(h),
      puerto,
      usuario: h.usuario ?? '',
      clave,
      claveNoUsable: noUsable,
      existe: ocupados.has(h.alias.trim().toLowerCase())
    })
  }
  return candidatas
}
