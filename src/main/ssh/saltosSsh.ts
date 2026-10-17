// =============================================================================
// El salto por bastiones: la cadena de una conexión (su bastión, el de este…) y lo que ssh necesita para
// recorrerla. Cada bastión es una conexión del perfil con su huella, su clave y su secreto, así que va en un
// bloque propio de una configuración generada (`-F`) y no en `ProxyJump`, que no pasaría sus opciones y parte
// la ruta de esa configuración en los espacios. Cada salto es un `ProxyCommand` citado como lo lee el ssh que
// lo lanza. Puro, con la plataforma como parámetro.
// Decisiones: docs/decisiones/ssh/tuneles-y-bastiones.md
// =============================================================================

import type { Plataforma } from '../../shared/plataforma.ts'
import { SSH_SALTOS_MAX } from '../../shared/ssh-ipc.ts'
import type { ConexionSshPersistida } from './conservarAlEditarSsh.ts'
import { citarValorOpcion, opcionesSsh, type ModoLineaSsh } from './lineaSsh.ts'
import { txSsh } from './textos.ts'

/**
 * Cómo lee el ssh un `ProxyCommand`. 'windows': el del sistema lo lanza tal cual, con las reglas de comillas
 * dobles de una línea de órdenes de Windows. 'sh': el de macOS (y el de Git en Windows) lo pasa a `/bin/sh -c`.
 */
export type CitaProxy = 'windows' | 'sh'

/** El host con que cada bastión se nombra en la configuración generada. */
export function hostDeSalto(i: number): string {
  return `tessera-salto-${i}`
}

/**
 * Los bastiones de `c`, del más cercano al más lejano. Lanza con un mensaje para el usuario si uno no existe,
 * es de otro perfil, la cadena vuelve sobre sí misma o pasa del tope (el archivo se puede editar a mano).
 */
export function cadenaDeSaltos(c: ConexionSshPersistida, conexion: (id: string) => ConexionSshPersistida | undefined): ConexionSshPersistida[] {
  const cadena: ConexionSshPersistida[] = []
  const vistos = new Set<string>([c.id])
  let actual = c
  while (actual.saltoId !== undefined) {
    const siguiente = conexion(actual.saltoId)
    if (siguiente === undefined || siguiente.profileId !== c.profileId) {
      throw new Error(txSsh().saltos.bastionNoExiste(actual.alias))
    }
    if (vistos.has(siguiente.id)) throw new Error(txSsh().saltos.circulo(c.alias))
    if (cadena.length >= SSH_SALTOS_MAX) throw new Error(txSsh().saltos.demasiados(c.alias, SSH_SALTOS_MAX))
    vistos.add(siguiente.id)
    cadena.push(siguiente)
    actual = siguiente
  }
  return cadena
}

/** Un argumento como lo parte una línea de órdenes de Windows: entre comillas, con `\` delante de cada `"` y de las `\` que lo preceden. */
function citarWindows(arg: string): string {
  let r = ''
  let barras = 0
  for (const ch of arg) {
    if (ch === '\\') {
      barras++
      continue
    }
    r += ch === '"' ? '\\'.repeat(barras * 2 + 1) + '"' : '\\'.repeat(barras) + ch
    barras = 0
  }
  return `"${r}${'\\'.repeat(barras * 2)}"`
}

/** Un argumento para `/bin/sh`: entre comillas simples, y cada comilla simple como `'\''`. */
function citarSh(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * El `ProxyCommand` que salta por `host` de la configuración `rutaConfig`: el mismo ssh (nunca uno del `PATH`)
 * con `-W` hacia el destino. ssh expande `%` en él, así que el `%` de una ruta va doblado; `%h` y `%p` son el
 * destino. En Windows, las rutas con barras normales, como en las demás opciones.
 */
export function proxyCommand(ssh: { exe: string; args: readonly string[] }, rutaConfig: string, host: string, cita: CitaProxy, plataforma: Plataforma): string {
  const ruta = (r: string): string => (plataforma === 'windows' ? r.replace(/\\/g, '/') : r)
  const citar = cita === 'windows' ? citarWindows : citarSh
  const citado = (a: string): string => citar(a).replace(/%/g, '%%')
  return [citado(ruta(ssh.exe)), ...ssh.args.map(citado), '-F', citado(ruta(rutaConfig)), '-W', citar('[%h]:%p'), host].join(' ')
}

/** Lo que necesita cada bloque de la configuración de los saltos. */
export interface OpcionesConfigSaltos {
  modo: ModoLineaSsh
  plataforma: Plataforma
  /** Tessera contesta (programa de contraseñas); sin él, ningún bastión pregunta (`BatchMode`). */
  conAskpass: boolean
  conDialogo: boolean
  rutaHuellas: (id: string) => string
  /** La copia de la clave de un bastión con el método 'clave' (ya comprobado que existe). */
  rutaClave: (id: string) => string | undefined
  /** El `ProxyCommand` hacia el bastión `i` de la cadena, para el anterior. */
  proxyHacia: (i: number) => string
}

/**
 * La configuración generada: un bloque por bastión con las mismas opciones que su propia línea (su
 * `known_hosts`, su clave, la huella estricta en modo agente) y, si tiene a su vez bastión, el salto hacia él.
 */
export function configSaltos(cadena: readonly ConexionSshPersistida[], o: OpcionesConfigSaltos): string {
  const bloques = cadena.map((s, i) => {
    const opciones = opcionesSsh(s, {
      modo: o.modo,
      plataforma: o.plataforma,
      rutaHuellas: o.rutaHuellas(s.id),
      rutaClave: o.rutaClave(s.id),
      conAskpass: o.conAskpass,
      conDialogo: o.conDialogo,
      salto: true,
      ...(i + 1 < cadena.length ? { proxyCommand: o.proxyHacia(i + 1) } : {})
    }, o.plataforma)
    const lineas = [`HostName=${s.host}`, `Port=${s.puerto}`, `User=${citarValorOpcion(s.usuario)}`, ...opciones]
    return [`Host ${hostDeSalto(i)}`, ...lineas.map((l) => `  ${l}`)].join('\n')
  })
  return `${bloques.join('\n')}\n`
}
