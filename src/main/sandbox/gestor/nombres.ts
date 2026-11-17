// =============================================================================
// Nombres, rutas y traducciones del sandbox: imagen, usuario neutro, puntos de montaje del
// contenedor, raíces gestionadas por perfil y sello de la instancia (fijados con
// `fijarBaseGestionada`) y el paso de una ruta del host a la que ve el daemon (`rutasSandbox.ts`).
// Decisiones: docs/decisiones/sandbox/raices-por-plataforma.md
// =============================================================================
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import type { Perfil } from '../../perfiles/types.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { ETIQUETA_INSTANCIA } from '../contenedoresPropios.ts'
import {
  aRutaDelDaemon,
  huellaInstancia,
  normalizarRutaResuelta,
  raicesSandbox,
  type RaicesSandbox
} from '../rutasSandbox.ts'

/** Imagen base compartida por todos los perfiles; lo que distingue a cada uno es el contenedor. */
export const IMAGEN_SANDBOX = 'tessera-sandbox-base'
export const USUARIO_NEUTRO = 'agente'
export const KEEPALIVE_CMD = ['sleep', 'infinity']

/** Imagen del helper privilegiado EFÍMERO: su busybox trae `nsenter` y corre como root. */
export const IMAGEN_AUXILIAR_PRIVILEGIADO = 'alpine'

/** Punto de montaje interno del contenedor donde aparece la raíz del perfil. */
export const RAIZ_WORKSPACE = '/workspace'

/** Raíz neutra de las credenciales por agente (`/agent-config/<tipo>`), fuera de `/workspace`. */
export const RAIZ_CONFIG_AGENTE = '/agent-config'

/** Buzón del puente de BD en el contenedor: bajo una raíz `rshared` para que el bind se propague. */
export const CONTENEDOR_PUENTE_DB = `${RAIZ_CONFIG_AGENTE}/dbbridge`

/**
 * Nombre del contenedor de un perfil. Lleva el sello de la instancia: dos usuarios de un mismo
 * Docker, o la app y su arnés de pruebas, pueden tener un perfil con el mismo id.
 */
export function nombreContenedorPara(perfil: Perfil): string {
  return `tessera-${SELLO}-${perfil.id}`
}

/**
 * Contenedores de cuenta: el «perfil» con que el gestor trata el contenedor de una cuenta es el del
 * perfil con otro id (`<perfil>--<huella de la cuenta>`). Así tiene su contenedor, sus raíces, su
 * buzón y su candado sin tocar nada del gestor; lo que es del perfil (su capa de imagen) se busca
 * por `idBase`. Derivado -> perfil, para saber de quién es cada uno.
 */
const BASES = new Map<string, string>()

/** Lo que separa el id del perfil de la huella de la cuenta: un id de perfil no lo lleva. */
const SEPARADOR_CUENTA = '--'

/** Huella corta y estable de una cuenta: el nombre del contenedor y su hostname no pasan de 63. */
function huellaCuenta(cuentaId: string): string {
  return createHash('sha256').update(cuentaId).digest('hex').slice(0, 10)
}

/** El perfil con que se gestiona el contenedor de la cuenta `cuentaId` del perfil `profile`. */
export function perfilDeCuenta(perfil: Perfil, cuentaId: string): Perfil {
  const id = `${idBase(perfil.id)}${SEPARADOR_CUENTA}${huellaCuenta(cuentaId)}`
  BASES.set(id, idBase(perfil.id))
  return { ...perfil, id }
}

/** El perfil del que es un contenedor de cuenta, o el mismo id si es el del perfil. */
export function idBase(id: string): string {
  return BASES.get(id) ?? id
}

/** ¿Es el id de un contenedor de cuenta (y no el del perfil)? */
export function esDeCuenta(id: string): boolean {
  return BASES.has(id)
}

/** Los ids de los contenedores de cuenta del perfil que se han creado en esta sesión de la app. */
export function cuentasDelPerfil(perfilId: string): string[] {
  return [...BASES].filter(([, base]) => base === perfilId).map(([id]) => id)
}

/** El hostname del contenedor en red `bridge`: no pasa de 63, y el id de uno de cuenta es largo. */
export function hostnameDe(perfil: Perfil): string {
  return `${perfil.id.slice(0, 55)}-sandbox`
}

/** `--label` del sello de la instancia para un `docker run`. */
export function argsEtiquetaInstancia(): string[] {
  return ['--label', `${ETIQUETA_INSTANCIA}=${SELLO}`]
}

/** Sello de esta instancia: el de su `userData` o, si el main no lo fijó, el de las pruebas. */
export function selloInstancia(): string {
  return SELLO
}

/** ¿Es una instancia de pruebas (el arnés, o las pruebas que no pasan por el main)? Usa su propia imagen. */
export function instanciaDePruebas(): boolean {
  return PRUEBAS
}

/** El sello de las pruebas que no pasan por el main: sus barridos solo ven lo suyo, y entre ellas se limpian. */
export const SELLO_PRUEBAS = 'pruebas'

/** Mensaje legible de un error desconocido (para los logs best-effort de limpieza). */
export function textoErrorSandbox(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// El respaldo `~/.tessera`, el sello y la imagen de pruebas son los de las pruebas que no pasan por el main: nada de
// lo que crean o barren es de la Tessera del usuario que comparte el Docker.
let RAICES = raicesSandbox(path.join(os.homedir(), '.tessera'))
let SELLO = SELLO_PRUEBAS
let PRUEBAS = true

/**
 * Fija la instancia con su `userData`: las raíces gestionadas (en macOS cuelgan de ahí; en
 * Windows y Linux llevan su huella) y el sello de sus contenedores. `deProduccion` es falso bajo
 * el arnés de pruebas, que usa la imagen de pruebas. La llama el main una sola vez, ANTES de
 * construir el sandbox.
 */
export function fijarBaseGestionada(baseHost: string, deProduccion: boolean): void {
  RAICES = raicesSandbox(baseHost, plataformaActual(), process.env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`)
  SELLO = huellaInstancia(baseHost)
  PRUEBAS = !deProduccion
}

/** Las dos raíces base vigentes (proyectos y credenciales). */
export function raicesGestionadas(): RaicesSandbox {
  return RAICES
}

/** Raíz gestionada del perfil dentro del namespace del daemon. */
export function raizGestionadaPara(perfil: Perfil): string {
  return `${RAICES.proyectos}/${perfil.id}`
}

/** Raíz de credenciales de agente del perfil dentro del namespace del daemon. */
export function raizConfigAgentePara(perfil: Perfil): string {
  return `${RAICES.agentcfg}/${perfil.id}`
}

/** Ruta del host resuelta y normalizada para comparar y deduplicar. */
export function normalizarRutaHostSandbox(rutaHost: string): string {
  return normalizarRutaResuelta(path.resolve(rutaHost))
}

/** Ruta del host -> ruta visible por el daemon de Docker. */
export function aRutaDaemon(hostAbs: string): string {
  return aRutaDelDaemon(normalizarRutaHostSandbox(hostAbs))
}


/** Subdirectorio seguro (sin traversal) a partir del basename del proyecto. */
export function sanearNombreWorkspace(basename: string): string {
  const saneado = basename.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[.]+/, '')
  return saneado.length > 0 ? saneado : 'proyecto'
}
