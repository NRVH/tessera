// =============================================================================
// Dónde está el cliente OpenSSH (ssh, scp, ssh-keygen). Puro, con la plataforma, el entorno y la
// comprobación de existencia como parámetros. Rutas FIJAS y nunca el PATH: en Windows el del sistema
// y, si falta, el de Git for Windows (con aviso); en macOS, `/usr/bin`. Es el ÚNICO lector de
// `TESSERA_SSH_BINARIO`, que solo existe para las pruebas de interfaz (la app empaquetada solo le hace caso
// con la marca del arnés e2e).
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================
import { existsSync } from 'node:fs'
import path from 'node:path'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import type { SshEntorno } from '../../shared/ssh-ipc.ts'

/** La variable de las pruebas de interfaz: `{"exe": "…", "args": […]}` se lanza con `args` delante de los de ssh. */
export const VAR_SSH_BINARIO = 'TESSERA_SSH_BINARIO'

/** Un ejecutable con los argumentos que van delante de los de ssh. */
export interface EjecutableSsh {
  exe: string
  args: string[]
}

/** Lo que se encontró. `scp` y `ssh-keygen` salen siempre de la misma carpeta que `ssh`. */
export interface BinariosSsh {
  ssh: EjecutableSsh | null
  scp: string | null
  sshKeygen: string | null
  origen: SshEntorno['origen']
  aviso: SshEntorno['aviso']
  /** `TESSERA_SSH_BINARIO` está activo: quien compone lo anota en el registro. */
  dePrueba: boolean
  /** `TESSERA_SSH_BINARIO` está puesto pero no es `{exe, args}`: se ignora. */
  pruebaInvalida?: true
  /** `TESSERA_SSH_BINARIO` está puesto pero esta app no lo admite (`admiteBinarioDePrueba`): se ignora. */
  pruebaIgnorada?: true
}

/** Lo que se puede sustituir en una prueba. */
export interface OpcionesBinariosSsh {
  plataforma?: Plataforma
  env?: Record<string, string | undefined>
  existe?: (ruta: string) => boolean
  /** Si se hace caso de `TESSERA_SSH_BINARIO`: solo con `true` explícito (la app decide con `admiteBinarioDePrueba`). */
  admitePrueba?: boolean
}

/**
 * La marca con la que el arnés e2e (`e2e/tessera.ts`) lanza la app, y que nadie más pasa. NO vale
 * `--user-data-dir`: el relevo de actualización de macOS relanza la app instalada justo con él.
 */
export const ARG_ARNES_E2E = '--tessera-arnes-e2e'

/**
 * ¿Se hace caso de `TESSERA_SSH_BINARIO`? Sin empaquetar, sí; empaquetada, solo con la marca del arnés
 * (`ARG_ARNES_E2E`). La instalada, la abra el usuario o la relance una actualización, nunca lanza otro
 * programa en lugar de ssh (con la línea, el askpass y los secretos), aunque la variable esté puesta.
 */
export function admiteBinarioDePrueba(empaquetada: boolean, argv: readonly string[]): boolean {
  return !empaquetada || argv.includes(ARG_ARNES_E2E)
}

/** Una variable del entorno; en Windows sin distinguir mayúsculas, como la busca el sistema. */
function variable(env: Record<string, string | undefined>, nombre: string, plataforma: Plataforma): string | undefined {
  const exacta = env[nombre]
  const valor =
    exacta ??
    (plataforma === 'windows' ? env[Object.keys(env).find((k) => k.toUpperCase() === nombre.toUpperCase()) ?? ''] : undefined)
  return valor === undefined || valor === '' ? undefined : valor
}

/** `TESSERA_SSH_BINARIO` leído: el ejecutable, 'invalida' si no tiene la forma, o `null` si no está. */
function leerPrueba(texto: string | undefined): EjecutableSsh | 'invalida' | null {
  if (texto === undefined) return null
  try {
    const v: unknown = JSON.parse(texto)
    const { exe, args } = (v ?? {}) as { exe?: unknown; args?: unknown }
    if (typeof exe === 'string' && exe !== '' && Array.isArray(args) && args.every((a) => typeof a === 'string')) {
      return { exe, args: [...(args as string[])] }
    }
  } catch {
    // Cae a 'invalida' igual que una forma que no es la esperada.
  }
  return 'invalida'
}

/** Las carpetas candidatas en Windows, en orden: el OpenSSH del sistema y luego los de Git for Windows. */
function carpetasWindows(env: Record<string, string | undefined>): Array<{ dir: string; origen: 'sistema' | 'git' }> {
  const v = (nombre: string): string | undefined => variable(env, nombre, 'windows')
  const raiz = v('SystemRoot') ?? v('windir') ?? 'C:\\Windows'
  const git = [v('ProgramFiles'), v('ProgramW6432')]
    .filter((d): d is string => d !== undefined)
    .map((d) => path.win32.join(d, 'Git', 'usr', 'bin'))
  const local = v('LOCALAPPDATA')
  if (local !== undefined) git.push(path.win32.join(local, 'Programs', 'Git', 'usr', 'bin'))
  return [{ dir: path.win32.join(raiz, 'System32', 'OpenSSH'), origen: 'sistema' }, ...git.map((dir) => ({ dir, origen: 'git' as const }))]
}

function ninguno(): BinariosSsh {
  return { ssh: null, scp: null, sshKeygen: null, origen: null, aviso: 'sin-ssh', dePrueba: false }
}

function resolverWindows(env: Record<string, string | undefined>, existe: (ruta: string) => boolean): BinariosSsh {
  for (const { dir, origen } of carpetasWindows(env)) {
    const ssh = path.win32.join(dir, 'ssh.exe')
    if (!existe(ssh)) continue
    const hermano = (nombre: string): string | null => (existe(path.win32.join(dir, nombre)) ? path.win32.join(dir, nombre) : null)
    return {
      ssh: { exe: ssh, args: [] },
      scp: hermano('scp.exe'),
      sshKeygen: hermano('ssh-keygen.exe'),
      origen,
      aviso: origen === 'git' ? 'ssh-de-git' : null,
      dePrueba: false
    }
  }
  return ninguno()
}

function resolverPosix(existe: (ruta: string) => boolean): BinariosSsh {
  if (!existe('/usr/bin/ssh')) return ninguno()
  return {
    ssh: { exe: '/usr/bin/ssh', args: [] },
    scp: existe('/usr/bin/scp') ? '/usr/bin/scp' : null,
    sshKeygen: existe('/usr/bin/ssh-keygen') ? '/usr/bin/ssh-keygen' : null,
    origen: 'sistema',
    aviso: null,
    dePrueba: false
  }
}

/** Dónde está el cliente SSH en esta plataforma (o en la que se pase). */
export function resolverBinariosSsh(opts: OpcionesBinariosSsh = {}): BinariosSsh {
  const plataforma = opts.plataforma ?? plataformaActual()
  const env = opts.env ?? process.env
  const existe = opts.existe ?? existsSync
  const base = plataforma === 'windows' ? resolverWindows(env, existe) : resolverPosix(existe)
  const prueba = leerPrueba(variable(env, VAR_SSH_BINARIO, plataforma))
  // Cerrado por defecto: sin un permiso explícito, la variable no cambia qué programa se lanza.
  if (prueba !== null && opts.admitePrueba !== true) return { ...base, pruebaIgnorada: true }
  if (prueba === 'invalida') return { ...base, pruebaInvalida: true }
  if (prueba !== null) return { ...base, ssh: prueba, origen: 'sistema', aviso: null, dePrueba: true }
  return base
}

/** Lo que responde `ssh:entorno`. */
export function entornoSsh(b: BinariosSsh): SshEntorno {
  return { disponible: b.ssh !== null, origen: b.origen, aviso: b.aviso }
}

/** Sin cliente SSH: el remedio depende del sistema, así que se bifurca la frase entera. */
export function mensajeSinSsh(plataforma: Plataforma): string {
  return plataforma === 'windows'
    ? 'No se encontró el cliente SSH del sistema (OpenSSH). Instala «Cliente OpenSSH» desde las ' +
        'características opcionales del sistema y vuelve a intentarlo.'
    : 'No se encontró el cliente SSH del sistema en /usr/bin/ssh.'
}
