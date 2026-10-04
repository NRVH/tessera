// =============================================================================
// SSH GLOBAL del sandbox, resuelto del lado host: descubre la `.ssh` del usuario y las
// carpetas hermanas que su config referencia, y reescribe el config con las rutas de dentro
// del contenedor (`/home/agente/<base>/…`). El gestor las monta READ-ONLY y el preludio de
// `gitInContainer.ts` las copia a 600. La familia de rutas es un parámetro (`Plataforma`).
// Decisiones: docs/decisiones/sandbox/ssh-global.md
// =============================================================================
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** Raíz (dentro del contenedor) donde se bind-montean READ-ONLY las carpetas ssh del host. */
export const SSH_RO_BASE = '/mnt/tessera-ssh'
/** HOME del usuario neutro del contenedor; ahí se reproducen las carpetas escribibles. */
export const CONTAINER_HOME = '/home/agente'

/** Una carpeta del host a montar, con su basename dentro del contenedor. */
export interface SshMount {
  /** Ruta host absoluta a bind-montear read-only. */
  hostDir: string
  /** Basename usado como subruta bajo SSH_RO_BASE y bajo CONTAINER_HOME. Único. */
  basename: string
}

export interface SshSetup {
  /** Carpetas host a montar: la `.ssh` + las hermanas referenciadas por el config. */
  mounts: SshMount[]
  /**
   * Contenido del `~/.ssh/config` REESCRITO (rutas del host → `/home/agente/<base>/…`)
   * + un bloque `Host *` con known_hosts escribible y accept-new. null si no hay config.
   */
  configText: string | null
}

/**
 * El módulo `path` de la familia que toca. En Windows `path.win32` (que entiende las
 * letras de unidad y las barras invertidas) y en el resto `path.posix`.
 *
 * NO se usa `path` a secas ni siquiera cuando coincide con el sistema: este módulo lo
 * ejercen tests que fijan la OTRA plataforma, y con `path` la mitad de los casos
 * dependería de dónde corren.
 */
function rutasDe(plataforma: Plataforma): path.PlatformPath {
  return plataforma === 'windows' ? path.win32 : path.posix
}

/** ¿La cadena parece una ruta absoluta del host de esta plataforma? */
function esAbsolutaHost(p: string, plataforma: Plataforma): boolean {
  // En Windows, `C:\…` o `C:/…`. Se aceptan las dos porque un `~/.ssh/config` escrito a
  // mano mezcla ambas con total normalidad.
  if (plataforma === 'windows') return /^[A-Za-z]:[\\/]/.test(p)
  return p.startsWith('/')
}

/**
 * Deja una ruta con los separadores nativos de su familia.
 *
 * En Windows unifica a barra invertida (para que `basename`/`dirname` de `path.win32`
 * y la deduplicación vean siempre la misma forma). En POSIX es la IDENTIDAD: convertir
 * `/Users/usuario/.ssh` a barras invertidas daría una ruta inexistente.
 */
function normalizarSeparadores(p: string, plataforma: Plataforma): string {
  return plataforma === 'windows' ? p.replace(/\//g, '\\') : p
}

/**
 * Resuelve un `IdentityFile` (tal como aparece en el config) a su ruta host ABSOLUTA:
 *   - `~/x` / `~\x`   → <home>/x (home = carpeta padre de la .ssh).
 *   - absoluta del host → tal cual (con separadores normalizados).
 *   - relativa        → contra la carpeta .ssh (best-effort; los configs suelen usar
 *                       absolutas o `~`).
 * Devuelve null si no se puede resolver.
 */
function resolveHostKeyPath(
  raw: string,
  home: string,
  sshDir: string,
  plataforma: Plataforma
): string | null {
  const p = raw.trim().replace(/^["']|["']$/g, '') // quita comillas envolventes
  if (!p) return null
  const rutas = rutasDe(plataforma)
  if (p.startsWith('~')) {
    // El separador tras la tilde puede ser cualquiera de los dos: `~/x` es lo habitual
    // incluso en configs de Windows, porque ssh es una herramienta POSIX de origen.
    const rest = p.slice(1).replace(/^[\\/]/, '')
    return normalizarSeparadores(rutas.join(home, rest), plataforma)
  }
  if (esAbsolutaHost(p, plataforma)) return normalizarSeparadores(p, plataforma)
  // relativa: contra la carpeta .ssh
  return normalizarSeparadores(rutas.join(sshDir, p), plataforma)
}

/**
 * Línea que activa `UseKeychain`. Sin distinguir caja (ssh tampoco la distingue) y con
 * `\b` para admitir las dos sintaxis de ssh_config, `Opción valor` y `Opción=valor`,
 * sin casar con una opción que solo EMPIECE igual. Una línea comentada (`# UseKeychain`)
 * no casa, y no debe: ssh no la lee y no hay nada que ignorar.
 */
const RE_USEKEYCHAIN = /^\s*UseKeychain\b/i

/**
 * Un `Include`: el fichero incluido también llega al contenedor (el preludio copia
 * `~/.ssh` entera con sus subcarpetas a `/home/agente/.ssh`, y ssh resuelve `~/` e
 * `Include` DENTRO del contenedor) y puede llevar `UseKeychain`, que este módulo no ve.
 * Medido en la imagen real: con `UseKeychain yes` sólo en `~/.ssh/conf.d/incluido.conf`,
 * `ssh -G` aborta igual (exit 255); con el `IgnoreUnknown` antepuesto en el config
 * principal pasa a 0, porque el `IgnoreUnknown` global sí cubre los includes.
 */
const RE_INCLUDE = /^\s*Include\b/i

/** Un `IgnoreUnknown <pattern-list>` del usuario, para fundir sus patrones en el nuestro. */
const RE_IGNORE_UNKNOWN = /^\s*IgnoreUnknown(?:\s+|\s*=\s*)(.+?)\s*$/i

/** Comentario que precede al `IgnoreUnknown` antepuesto: quien lea el config sabe por qué está. */
const COMENTARIO_USEKEYCHAIN =
  '# Tessera: UseKeychain es del ssh de Apple; el OpenSSH del contenedor no la conoce.'

/**
 * Patrones del `IgnoreUnknown` que se antepone: `UseKeychain` primero, seguido de los
 * que el usuario ya tuviera en sus propios `IgnoreUnknown` (un pattern-list es una
 * lista separada por comas), sin repetir y sin distinguir caja.
 *
 * Se funden porque ssh solo honra el PRIMER `IgnoreUnknown` que lee: si el nuestro
 * fuera a secas, el suyo quedaría sin efecto y las opciones que él declaraba
 * desconocidas volverían a ser fatales. Los suyos pueden estar dentro de un `Host`;
 * subirlos al principio los hace globales, lo que como mucho vuelve el parseo más
 * permisivo, nunca menos.
 */
function patronesIgnoreUnknown(lines: string[]): string[] {
  const patrones = ['UseKeychain']
  const vistos = new Set(['usekeychain'])
  for (const line of lines) {
    const m = line.match(RE_IGNORE_UNKNOWN)
    if (!m) continue
    for (const crudo of m[1].replace(/^["']|["']$/g, '').split(',')) {
      const patron = crudo.trim()
      if (!patron || vistos.has(patron.toLowerCase())) continue
      vistos.add(patron.toLowerCase())
      patrones.push(patron)
    }
  }
  return patrones
}

/**
 * Reescribe el texto del config: cada `IdentityFile` pasa a apuntar a
 * `/home/agente/<basename>/<archivo>`, registrando de paso la carpeta host que hay que
 * montar (vía `addDir`). Si el config usa `UseKeychain`, antepone el `IgnoreUnknown`
 * que el OpenSSH del contenedor necesita para no abortar (ver la cabecera). Al final
 * añade un bloque `Host *` con known_hosts escribible.
 */
function rewriteConfig(
  raw: string,
  ctx: {
    home: string
    sshDir: string
    plataforma: Plataforma
    addDir: (dir: string) => string
  }
): string {
  const rutas = rutasDe(ctx.plataforma)
  const lines = raw.split(/\r?\n/)
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)(IdentityFile)(\s+)(.+?)\s*$/i)
    if (!m) return line
    const absHost = resolveHostKeyPath(m[4], ctx.home, ctx.sshDir, ctx.plataforma)
    if (!absHost) return line
    const dir = rutas.dirname(absHost)
    const file = rutas.basename(absHost)
    const basename = ctx.addDir(dir)
    return `${m[1]}${m[2]}${m[3]}${CONTAINER_HOME}/${basename}/${file}`
  })
  // `UseKeychain` es del ssh de Apple y el OpenSSH del contenedor aborta al leerla. El
  // `IgnoreUnknown` va como PRIMERA línea, antes de cualquier `Host`/`Match`: ssh no lo
  // aplica a lo que aparece antes que él. La línea `UseKeychain` se deja donde está:
  // ignorada es inofensiva, y borrar opciones del usuario es peor que declararlas
  // desconocidas. Sin la opción no se antepone nada y la salida no cambia.
  //
  // Un `Include` cuenta igual que la opción misma: el fichero incluido viaja al
  // contenedor con la copia de `~/.ssh` y puede llevar `UseKeychain`, pero esta función
  // es pura y no puede leerlo sin `fs`. Anteponer el prefijo de más es inocuo: sólo
  // declara desconocida una opción que el OpenSSH del contenedor rechaza de todas formas.
  if (lines.some((l) => RE_USEKEYCHAIN.test(l) || RE_INCLUDE.test(l))) {
    out.unshift(COMENTARIO_USEKEYCHAIN, `IgnoreUnknown ${patronesIgnoreUnknown(lines).join(',')}`, '')
  }
  // Fallbacks globales: known_hosts ESCRIBIBLE dentro del contenedor + aceptar host
  // nuevo sin prompt (ssh no interactivo). Van al final: las opciones específicas de
  // cada Host se leen primero (first-match-wins), esto solo rellena lo no fijado.
  out.push('', 'Host *', '    UserKnownHostsFile ~/.ssh/known_hosts', '    StrictHostKeyChecking accept-new')
  return out.join('\n')
}

/**
 * LA PARTE PURA: traduce un `~/.ssh/config` del host al que verá el contenedor, y dice
 * QUÉ carpetas hay que montar. Sin tocar el disco.
 *
 * Está separada de `resolveSshSetup` a propósito, siguiendo la regla del repo de que la
 * lógica probable viva en un módulo (o aquí, en una función) sin `fs`: es exactamente
 * la parte que estaba rota en macOS —la aritmética de rutas— y la que ningún test podía
 * alcanzar mientras estuviera enredada con `existsSync`. El fallo se manifestaba como
 * "0 carpetas" en un `console.log` del arranque, que no es algo que una batería de
 * tests pueda ver.
 *
 * `dirs` sale en el ORDEN en que se descubrieron, con la `.ssh` siempre primera.
 */
export function traducirConfigSsh(
  raw: string | null,
  opts: { home: string; sshDir: string; plataforma: Plataforma }
): { configText: string | null; dirs: SshMount[] } {
  const { home, sshDir, plataforma } = opts
  const rutas = rutasDe(plataforma)
  const allDirs = new Map<string, SshMount>()
  const addDir = (dir: string): string => {
    const abs = normalizarSeparadores(dir, plataforma)
    // La clave baja la caja en las dos plataformas: Windows no distingue mayúsculas y
    // APFS tampoco de fábrica, así que `~/.ssh` y `~/.SSH` son la misma carpeta y
    // montarla dos veces apilaría binds sobre el mismo destino.
    const key = abs.toLowerCase()
    const existing = allDirs.get(key)
    if (existing) return existing.basename
    const base = rutas.basename(abs)
    const taken = new Set([...allDirs.values()].map((x) => x.basename.toLowerCase()))
    let basename = base
    for (let n = 2; taken.has(basename.toLowerCase()); n++) basename = `${base}-${n}`
    allDirs.set(key, { hostDir: abs, basename })
    return basename
  }

  // La `.ssh` SIEMPRE se registra (tiene el config y posiblemente llaves/known_hosts).
  addDir(normalizarSeparadores(sshDir, plataforma))

  const configText =
    raw === null ? null : rewriteConfig(raw, { home, sshDir, plataforma, addDir })
  return { configText, dirs: [...allDirs.values()] }
}

/**
 * Resuelve el setup ssh GLOBAL a partir de la carpeta `.ssh` del usuario. Devuelve
 * null si la carpeta no existe (perfil/equipo sin ssh: git local funciona; el push por
 * ssh fallará con error claro, sin crash). Idempotente (solo lee del disco host).
 *
 * `plataforma` es explícita, con la del sistema por defecto, para poder probar las dos
 * desde una sola (ver la cabecera).
 */
export function resolveSshSetup(
  sshDir: string,
  plataforma: Plataforma = plataformaActual()
): SshSetup | null {
  if (!sshDir || !existsSync(sshDir)) return null
  const rutas = rutasDe(plataforma)
  const sshDirAbs = normalizarSeparadores(rutas.resolve(sshDir), plataforma)
  const home = rutas.dirname(sshDirAbs) // C:\Users\<user> — o /Users/<user>

  // Lo ÚNICO que hace esta función con el disco: leer el config y, al final, filtrar
  // por existencia. Toda la aritmética de rutas —descubrir carpetas, deduplicarlas,
  // asignar basenames y reescribir el config— vive en `traducirConfigSsh`, que es pura
  // y tiene test.
  const configPath = rutas.join(sshDirAbs, 'config')
  const raw = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null
  const { configText, dirs } = traducirConfigSsh(raw, { home, sshDir: sshDirAbs, plataforma })

  // Solo se MONTAN las carpetas que EXISTEN en disco: `docker run --mount` falla si la
  // fuente no existe (a diferencia de `-v`). Una carpeta referenciada por el config pero
  // ausente (p.ej. borrada) se omite del mount —su Host simplemente no funcionará, que es
  // lo correcto—; el config reescrito conserva su línea (inocua: el preludio la salta con
  // `[ -d ]`). La ruta host se pasa tal cual a toDaemonPath en SandboxManager, que es
  // quien sabe traducirla a lo que ve el daemon en cada plataforma.
  const mounts = dirs.filter((m) => existsSync(m.hostDir))
  return { mounts, configText }
}
