// =============================================================================
// «Probar» una conexión SSH: la misma línea que la pestaña (con `accept-new`, que guarda la huella: así el
// agente, en estricto, solo usará hosts que ya confirmó una persona) sin terminal y con `exit 0`, tope de
// 20 s y el programa de contraseñas si hay secreto. Devuelve lo que tardó y las huellas del servidor, o el
// motivo con una línea SIN rutas: la salida de ssh no sale de aquí. Sin `electron`: ssh lo corre quien llama.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { plataformaActual, type Plataforma } from '../../../shared/plataforma.ts'
import type { SshHuella, SshMotivoPrueba, SshResultadoPrueba } from '../../../shared/ssh-ipc.ts'
import { clasificarSalidaSsh, esSalidaDeFalloSsh } from '../clasificacionSalida.ts'
import type { SalidaCorta } from '../formatoClave.ts'

/** Lo que espera «Probar» como mucho; ssh ya corta la conexión a los 10 s (`ConnectTimeout`). */
export const TOPE_PRUEBA_MS = 20_000

/** Lo que devuelve correr ssh (`ejecutarCorto` de `adaptadores/permisosClave.ts`). */
export type SalidaSsh = SalidaCorta

/** Corre ssh sin consola, con tope, sin las variables de `quitarEnv` y con las de `extraEnv`. */
export type EjecutarSsh = (
  exe: string,
  args: readonly string[],
  opciones: { topeMs: number; quitarEnv?: readonly string[]; extraEnv?: Readonly<Record<string, string>> }
) => Promise<SalidaSsh>

/** Lo que matiza el resultado además de la salida. */
export interface ContextoResultadoPrueba {
  ms: number
  huellas: SshHuella[]
  /** Faltaba el secreto que el método pide: un rechazo de credenciales solo dice que se llegó. */
  soloAlcance: boolean
  /** El programa de contraseñas recibió una pregunta que Tessera no contesta. */
  preguntaSinContestar: boolean
  /** Hay un secreto guardado que no se pudo usar, y por qué. */
  aviso?: string
  /** Decide qué códigos son de un fallo de ssh (`esSalidaDeFalloSsh`); por defecto, la de este sistema. */
  plataforma?: Plataforma
}

/** Lo que dice ssh al aceptar una huella nueva: no es un fallo y no se enseña como detalle. */
const AVISO_HUELLA_ANADIDA = /^Warning: Permanently added /
/** Una ruta del host (Windows o POSIX) que no debe salir hacia el renderer. */
const PARECE_RUTA = /[A-Za-z]:[\\/]|(?:^|[\s(])[\\/]\S*[\\/]/
/** La huella que presenta el servidor cuando no es la guardada. */
const HUELLA_PRESENTADA = /The fingerprint for the (\S+) key sent by the remote host is\s+SHA256:([A-Za-z0-9+/]+)/

/** La última línea de ssh, sin lo citado (lleva rutas) y sin nada que parezca una ruta; si no, el código. */
export function detalleSinRutas(errores: string, codigo: number | null): string {
  const lineas = errores
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !AVISO_HUELLA_ANADIDA.test(l))
  const ultima = (lineas[lineas.length - 1] ?? '').replace(/"[^"]*"|'[^']*'/g, '«…»')
  if (ultima !== '' && !PARECE_RUTA.test(ultima)) return ultima.slice(0, 200)
  return codigo === null ? 'No se pudo lanzar ssh.' : `ssh salió con el código ${codigo}.`
}

/** La huella que presenta el servidor cuando cambió, si ssh la dijo. */
export function huellaPresentada(errores: string): SshHuella | undefined {
  const m = HUELLA_PRESENTADA.exec(errores)
  return m ? { algoritmo: m[1], sha256: m[2] } : undefined
}

/**
 * El resultado de «Probar» a partir de lo que dijo ssh. Solo el 255 (y en Windows el -1) es un fallo de ssh:
 * cualquier otro código lo dio el otro lado, así que ssh ENTRÓ (una cuenta con ForceCommand, git-shell o un
 * equipo de red que no acepta `exit 0`). Puro.
 */
export function resultadoPrueba(s: SalidaSsh, x: ContextoResultadoPrueba): SshResultadoPrueba {
  const base = { ms: x.ms, huellas: x.huellas, ...(x.aviso !== undefined ? { aviso: x.aviso } : {}) }
  if (s.agotado) return { ...base, ok: false, motivo: 'tiempo', detalle: '' }
  const plataforma = x.plataforma ?? plataformaActual()
  const falloSsh = esSalidaDeFalloSsh(s.codigo, plataforma)
  if (s.codigo !== null && !falloSsh) return { ...base, ok: true, soloAlcance: false }
  const motivo: SshMotivoPrueba = (falloSsh ? clasificarSalidaSsh(s.codigo, s.errores, plataforma) : undefined) ?? 'otro'
  if (motivo === 'ssh-autenticacion' && x.soloAlcance && !x.preguntaSinContestar) return { ...base, ok: true, soloAlcance: true }
  const nueva = motivo === 'ssh-huella-cambiada' ? huellaPresentada(s.errores) : undefined
  return {
    ...base,
    ok: false,
    motivo,
    detalle: detalleSinRutas(s.errores, s.codigo),
    ...(nueva !== undefined ? { huellaNueva: nueva } : {}),
    ...(x.preguntaSinContestar ? { preguntaSinContestar: true as const } : {})
  }
}
