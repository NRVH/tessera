// =============================================================================
// Los argumentos de `ssh` (y de `scp`, para `tssh cp`) para una conexión: `-F none` y unas opciones `-o`
// decididas aquí, para que la configuración del usuario no cuele multiplexado ni comandos; el `known_hosts`
// PROPIO de la conexión, la copia importada de su clave si la usa, siempre `--` antes del host y, en
// «Probar», `exit 0` detrás. El modo agente es estricto con la huella y nunca pregunta. Puro, con la
// plataforma como parámetro: rutas con barras normales en Windows, `%` doblado y entre comillas.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md, docs/decisiones/ssh/claves-importadas.md,
// docs/decisiones/ssh/askpass-y-secretos.md, docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import type { SshMetodo } from '../../shared/ssh-ipc.ts'

/** Quién usa la línea: una pestaña de la terminal ('humano') o un agente por `tssh` ('agente'). */
export type ModoLineaSsh = 'humano' | 'agente'

/** Lo que la línea necesita de la conexión. */
export interface DestinoLineaSsh {
  host: string
  puerto: number
  usuario: string
  metodo: SshMetodo
}

/** El modo, la ruta del `known_hosts` de la conexión en el host y, con el método 'clave', la de su clave. */
export interface OpcionesLineaSsh {
  modo: ModoLineaSsh
  rutaHuellas: string
  /** La copia importada (`ssh/claves/<id>`); obligatoria con el método 'clave'. */
  rutaClave?: string
  plataforma?: Plataforma
  /** Tessera dará el secreto guardado por el programa de contraseñas: una sola pregunta por método. */
  conAskpass?: boolean
  /**
   * «Probar»: sin terminal ni entrada (`-T -n`) y con `exit 0` como orden remota; sin programa de
   * contraseñas nadie puede contestar (`BatchMode`) y, con contraseña, solo se saluda (`none`).
   */
  prueba?: boolean
  /**
   * `tssh run`: sin terminal (`-T`) y, si la orden no lee la entrada, sin entrada (`-n`). La orden la pone
   * quien lanza, DETRÁS del host: tras el `--` ssh ya no lee opciones.
   */
  orden?: { conEntrada: boolean }
  /**
   * El explorador SFTP: el subsistema `sftp` (`-T -s` y `sftp` detrás del host) en vez de una shell. Sin
   * terminal nadie puede teclear una contraseña: sin programa de contraseñas, `BatchMode`.
   */
  subsistemaSftp?: boolean
}

/** Una conexión con archivo de clave cuya copia no está: sin ella ssh probaría las claves por defecto. */
export const MENSAJE_SIN_COPIA_CLAVE =
  'Esta conexión usa un archivo de clave y no se encuentra la copia que guardó Tessera: edítala y vuelve a elegir el archivo.'

/**
 * Una ruta como valor de una opción `-o`: barras normales en Windows, `%` doblado y entre comillas
 * dobles. Dentro de las comillas ssh lee `\"` y `\\` como el carácter; en Windows ya no queda ninguna barra invertida.
 */
export function citarRutaOpcion(ruta: string, plataforma: Plataforma = plataformaActual()): string {
  const conBarras = plataforma === 'windows' ? ruta.replace(/\\/g, '/') : ruta
  const sinTokens = conBarras.replace(/%/g, '%%')
  return `"${sinTokens.replace(/["\\]/g, (c) => `\\${c}`)}"`
}

/**
 * Lo que añade cada método. La clave va por `-o IdentityFile` y no por `-i`: `-i` busca el archivo
 * ANTES de expandir `%`, así que con el `%` doblado no lo encuentra y ssh sigue con las claves por
 * defecto del usuario (medido con el ssh 9.5 de Windows).
 */
function opcionesDeMetodo(destino: DestinoLineaSsh, opts: OpcionesLineaSsh, plataforma: Plataforma): string[] {
  if (destino.metodo === 'contrasena') {
    // Sin contraseña que dar, «Probar» solo saluda: llega, guarda la huella y el servidor dice qué métodos admite.
    const metodos = opts.prueba && !opts.conAskpass ? 'none' : 'password,keyboard-interactive'
    return [`PreferredAuthentications=${metodos}`, 'PubkeyAuthentication=no']
  }
  if (destino.metodo !== 'clave') return []
  if (!opts.rutaClave) throw new Error(MENSAJE_SIN_COPIA_CLAVE)
  return [`IdentityFile=${citarRutaOpcion(opts.rutaClave, plataforma)}`, 'IdentitiesOnly=yes', 'PreferredAuthentications=publickey']
}

/** Lo que añade quién contesta: Tessera una sola vez por método, o nadie (una prueba o un agente sin él). */
function opcionesDePreguntas(opts: OpcionesLineaSsh): string[] {
  if (opts.conAskpass) return ['NumberOfPasswordPrompts=1']
  return opts.prueba || opts.modo === 'agente' || opts.subsistemaSftp ? ['BatchMode=yes'] : []
}

/**
 * Lo que añade el modo agente: ni redirecciones ni órdenes locales. Con `-F none` ya son los valores por
 * defecto; ir explícitas hace que la línea las niegue aunque alguien añada algo delante.
 */
function opcionesDeModo(opts: OpcionesLineaSsh): string[] {
  return opts.modo === 'agente' ? ['ClearAllForwardings=yes', 'ForwardAgent=no', 'ForwardX11=no', 'PermitLocalCommand=no'] : []
}

/** Las `-o` de una conexión, comunes a ssh y a scp. */
function opcionesSsh(destino: DestinoLineaSsh, opts: OpcionesLineaSsh, plataforma: Plataforma): string[] {
  return [
    'ControlMaster=no',
    'ControlPath=none',
    `UserKnownHostsFile=${citarRutaOpcion(opts.rutaHuellas, plataforma)}`,
    `StrictHostKeyChecking=${opts.modo === 'agente' ? 'yes' : 'accept-new'}`,
    'CheckHostIP=no',
    'UpdateHostKeys=no',
    'ConnectTimeout=10',
    'ServerAliveInterval=15',
    'ServerAliveCountMax=3',
    ...opcionesDePreguntas(opts),
    ...opcionesDeMetodo(destino, opts, plataforma),
    ...opcionesDeModo(opts)
  ]
}

/** Lo que va entre las opciones y el `--`: «Probar» y `tssh run` sin terminal; sin entrada si no la leen. */
function sinTerminal(opts: OpcionesLineaSsh): string[] {
  if (opts.prueba) return ['-T', '-n']
  if (opts.subsistemaSftp) return ['-T', '-s']
  if (opts.orden) return opts.orden.conEntrada ? ['-T'] : ['-T', '-n']
  return []
}

/**
 * La línea de `ssh` sin el ejecutable. 'humano' acepta la huella de un servidor nuevo
 * (`accept-new`) y 'agente' solo los que ya confirmó un humano. Con contraseña no se prueban
 * claves; con archivo de clave, solo esa (ni las del agente de claves ni las de `~/.ssh`).
 */
export function argumentosSsh(destino: DestinoLineaSsh, opts: OpcionesLineaSsh): string[] {
  const plataforma = opts.plataforma ?? plataformaActual()
  return [
    '-F',
    'none',
    ...opcionesSsh(destino, opts, plataforma).flatMap((o) => ['-o', o]),
    '-p',
    String(destino.puerto),
    '-l',
    destino.usuario,
    ...sinTerminal(opts),
    '--',
    destino.host,
    ...(opts.prueba ? ['exit', '0'] : opts.subsistemaSftp ? ['sftp'] : [])
  ]
}

/** Un valor de una opción `-o` entre comillas dobles: ssh lee `\"` y `\\` como el carácter (un usuario `DOMINIO\nombre`). */
function citarValorOpcion(valor: string): string {
  return `"${valor.replace(/["\\]/g, (c) => `\\${c}`)}"`
}

/** Lo que `tssh cp` necesita además de la conexión: el ssh que lanzará scp y si copia carpetas. */
export interface OpcionesScp extends OpcionesLineaSsh {
  /** El ssh que scp lanza (`-S`): el de su misma carpeta, nunca uno del `PATH`. */
  ssh: string
  recursivo: boolean
}

/**
 * Las opciones de `scp` para una conexión (`tssh cp`), sin las rutas: las mismas `-o` que ssh, el puerto con
 * `-P` (en scp `-p` y `-l` son otra cosa) y el usuario como opción, así el lado remoto es solo `host:ruta`.
 * Quien lanza añade `--`, el origen y el destino.
 */
export function argumentosScp(destino: DestinoLineaSsh, opts: OpcionesScp): string[] {
  const plataforma = opts.plataforma ?? plataformaActual()
  return [
    '-S',
    opts.ssh,
    '-F',
    'none',
    ...[...opcionesSsh(destino, opts, plataforma), `User=${citarValorOpcion(destino.usuario)}`].flatMap((o) => ['-o', o]),
    '-P',
    String(destino.puerto),
    ...(opts.recursivo ? ['-r'] : [])
  ]
}

/** El host como lo escribe scp delante de `:ruta`: una dirección IPv6 entre corchetes. */
export function hostParaScp(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}
