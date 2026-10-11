// =============================================================================
// El salto por bastiones de una línea de ssh o de scp, para la terminal, «Probar», el explorador SFTP y
// `tssh`: comprueba cada bastión como su propia conexión (sus datos y la copia de su clave), escribe la
// configuración generada (`adaptadores/configSaltos.ts`) y devuelve el `ProxyCommand` hacia el primero.
// Decisiones: docs/decisiones/ssh/tuneles-y-bastiones.md
// =============================================================================
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { EjecutableSsh } from '../binariosSsh.ts'
import type { ConexionSshPersistida } from '../conservarAlEditarSsh.ts'
import type { ModoLineaSsh } from '../lineaSsh.ts'
import { configSaltos, hostDeSalto, proxyCommand, type CitaProxy } from '../saltosSsh.ts'
import { errorHost, errorPuerto, errorUsuario } from '../validacionSsh.ts'

/** Lo que necesita. */
export interface DepsLineaSaltos {
  rutaHuellas: (id: string) => string
  rutaClave: (id: string) => string
  existe: (ruta: string) => boolean
  config: { reservar: () => string; escribir: (ruta: string, texto: string) => void }
  plataforma: Plataforma
}

/** Cómo se lanzará el ssh que salta. */
export interface PeticionSaltos {
  modo: ModoLineaSsh
  conAskpass: boolean
  conDialogo: boolean
  ssh: EjecutableSsh
  cita: CitaProxy
}

/** Cómo cita el `ProxyCommand` el ssh elegido: el del sistema en Windows lo lanza sin shell; los demás, con `/bin/sh`. */
export function citaDe(plataforma: Plataforma, origen: string | null): CitaProxy {
  return plataforma === 'windows' && origen !== 'git' ? 'windows' : 'sh'
}

/** Lo que impide usar un bastión, para el usuario; `null` si vale. */
export function problemaDeSalto(s: ConexionSshPersistida, d: Pick<DepsLineaSaltos, 'existe' | 'rutaClave'>): string | null {
  const dato = errorHost(s.host) ?? errorPuerto(s.puerto) ?? errorUsuario(s.usuario)
  if (dato !== null) return `El bastión «${s.alias}» tiene un dato que no vale: ${dato} Edítalo para corregirlo.`
  if (s.metodo === 'clave' && (s.clave === undefined || !d.existe(d.rutaClave(s.id)))) {
    return `El bastión «${s.alias}» usa un archivo de clave y falta la copia que guardó Tessera: edítalo y vuelve a elegir el archivo.`
  }
  return null
}

/** El `ProxyCommand` que recorre `cadena`, con su configuración ya escrita; `undefined` sin bastiones. Lanza con un mensaje para el usuario. */
export function proxyDeSaltos(cadena: readonly ConexionSshPersistida[], p: PeticionSaltos, d: DepsLineaSaltos): string | undefined {
  if (cadena.length === 0) return undefined
  for (const s of cadena) {
    const problema = problemaDeSalto(s, d)
    if (problema !== null) throw new Error(problema)
  }
  const ruta = d.config.reservar()
  const hacia = (i: number): string => proxyCommand(p.ssh, ruta, hostDeSalto(i), p.cita, d.plataforma)
  const texto = configSaltos(cadena, {
    modo: p.modo,
    plataforma: d.plataforma,
    conAskpass: p.conAskpass,
    conDialogo: p.conDialogo,
    rutaHuellas: d.rutaHuellas,
    rutaClave: (id) => d.rutaClave(id),
    proxyHacia: hacia
  })
  try {
    d.config.escribir(ruta, texto)
  } catch (e) {
    // El error de `fs` lleva la ruta del host.
    const codigo = (e as NodeJS.ErrnoException)?.code ?? 'desconocido'
    throw new Error(`No se pudo preparar el salto por el bastión (${codigo}).`, { cause: e })
  }
  return hacia(0)
}
