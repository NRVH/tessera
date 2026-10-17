// =============================================================================
// Prevuelo del modo `--network host` de un perfil: PURO. Recibe lo ya medido (el motor,
// la versión, los ajustes de Docker Desktop, la sonda) y devuelve las filas REDACTADAS que
// pinta el renderer. La plataforma es un parámetro SIN valor por defecto, y los textos se
// componen aquí, en el main. Quien mide es `gestor/red.ts`.
// Decisiones: docs/decisiones/sandbox/red-del-anfitrion.md
// =============================================================================

import type { Plataforma } from '../../shared/plataforma'
// El tipo de las filas vive en el contrato IPC: lo consumen también el preload y el renderer.
import type { FilaPrevuelo } from '../../shared/sandbox-red-ipc'
import { txSandbox } from './textos.ts'

/** Versión de Docker Desktop a partir de la cual existe la red del anfitrión. */
export const VERSION_MINIMA = { mayor: 4, menor: 34 } as const

/** Lo medido fuera. `null` significa SIEMPRE "no se pudo saber", nunca "no". */
export interface EntradasPrevuelo {
  /** ¿Responde el daemon? */
  motorVivo: boolean
  /** `OSType` de `docker info`: con contenedores Windows este modo ni existe. */
  tipoContenedores: 'linux' | 'windows' | null
  /** `Server.Platform.Name` de `docker version`, p.ej. "Docker Desktop 4.90.0 (238679)". */
  nombrePlataformaDocker: string | null
  /** Clave del fichero de ajustes de Docker Desktop. */
  hostNetworking: boolean | null
  /** Enhanced Container Isolation: si está, anula la red del anfitrión. */
  aislamientoReforzado: boolean | null
  /** La sonda funcional: ¿el anfitrión alcanzó de verdad al contenedor? */
  traficoLlega: boolean | null
}

export interface ResultadoPrevuelo {
  filas: FilaPrevuelo[]
  /** ¿Hay alguna fila en 'falla'? Es lo que decide el tono del aviso, no un porcentaje. */
  hayFallas: boolean
}

/**
 * Versión de Docker Desktop a partir del `Server.Platform.Name` de `docker version`.
 * Devuelve `null` si la cadena no es de Docker Desktop (Docker Engine a pelo, Colima,
 * Rancher…), que NO es lo mismo que "versión vieja": ahí la fila queda 'desconocido'.
 */
export function versionDockerDesktop(nombre: string | null): { mayor: number; menor: number } | null {
  if (!nombre) return null
  const m = /Docker Desktop\s+(\d+)\.(\d+)/i.exec(nombre)
  if (!m) return null
  return { mayor: Number(m[1]), menor: Number(m[2]) }
}

/**
 * Rutas CANDIDATAS del fichero de ajustes de Docker Desktop, en orden de preferencia.
 *
 * Es una LISTA y no una ruta porque Docker renombró el fichero en la 4.35
 * (`settings.json` -> `settings-store.json`): quien lea prueba en orden y se queda con
 * el primero que exista. `home` y `appData` entran por parámetro para que el test los
 * fije sin tocar el entorno.
 */
export function rutasAjustesDocker(plataforma: Plataforma, home: string, appData: string): string[] {
  if (plataforma === 'windows') {
    return [`${appData}\\Docker\\settings-store.json`, `${appData}\\Docker\\settings.json`]
  }
  if (plataforma === 'mac') {
    const base = `${home}/Library/Group Containers/group.com.docker`
    return [`${base}/settings-store.json`, `${base}/settings.json`]
  }
  return [`${home}/.docker/desktop/settings-store.json`]
}

/**
 * Las dos claves que importan del fichero de ajustes de Docker Desktop.
 *
 * Acepta la clave en mayúscula inicial y en minúscula: el fichero de Windows usa
 * `HostNetworkingEnabled` y el esquema interno del backend la escribe en minúscula, así
 * que dar por buena sólo una de las dos daría un falso "no está" en una plataforma.
 *
 * `null` = no se pudo saber (fichero ausente o JSON roto). `false` = el fichero se leyó
 * y la clave no está, que es el defecto real de Docker (viene apagada de fábrica).
 */
export function leerAjustesDocker(texto: string | null): {
  hostNetworking: boolean | null
  aislamientoReforzado: boolean | null
} {
  if (texto === null) return { hostNetworking: null, aislamientoReforzado: null }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(texto) as Record<string, unknown>
  } catch {
    return { hostNetworking: null, aislamientoReforzado: null }
  }
  const bool = (...claves: string[]): boolean => claves.some((c) => json[c] === true)
  return {
    hostNetworking: bool('HostNetworkingEnabled', 'hostNetworkingEnabled'),
    aislamientoReforzado: bool('EnhancedContainerIsolation', 'enhancedContainerIsolation')
  }
}

/**
 * Modo de red EFECTIVO de WSL, de la salida de `wslinfo --networking-mode`.
 *
 * Se pregunta al sistema en vez de leer `%USERPROFILE%\.wslconfig` a propósito: el
 * fichero dice la INTENCIÓN y sólo surte efecto tras `wsl --shutdown`, así que puede
 * llevar `mirrored` escrito y la máquina seguir en `nat`. Esto informa del EGRESS por
 * VPN, que es otra cosa que la red del anfitrión y por eso no es una fila del prevuelo.
 */
export function modoRedWsl(salida: string | null): 'nat' | 'mirrored' | null {
  if (salida === null) return null
  const t = salida.trim().toLowerCase()
  if (t === 'mirrored') return 'mirrored'
  if (t === 'nat') return 'nat'
  return null
}

/**
 * Las filas del diagnóstico, redactadas.
 *
 * `tuEquipo` llega ya resuelto por `nombresSistema` («tu Windows» / «tu Mac»): ningún
 * texto de aquí escribe el nombre del sistema a mano. Los rótulos del menú de Docker
 * Desktop SÍ van en inglés y a propósito — son literales de otra aplicación, idénticos
 * en las dos plataformas, y traducirlos convierte una instrucción seguible en una
 * adivinanza.
 */
export function evaluarPrevuelo(
  e: EntradasPrevuelo,
  plataforma: Plataforma,
  tuEquipo: string
): ResultadoPrevuelo {
  const filas: FilaPrevuelo[] = [
    filaMotor(e),
    filaVersion(e),
    filaAjuste(e),
    filaAislamiento(e, tuEquipo),
    filaTrafico(e, plataforma, tuEquipo)
  ]
  return { filas, hayFallas: filas.some((f) => f.estado === 'falla') }
}

/** 1) El motor, y de qué tipo son sus contenedores. */
function filaMotor(e: EntradasPrevuelo): FilaPrevuelo {
  const t = txSandbox().prevuelo
  if (!e.motorVivo) {
    return { id: 'motor', estado: 'falla', titulo: t.motorTitulo, remedio: t.motorRemedio }
  } else if (e.tipoContenedores === 'windows') {
    return { id: 'motor', estado: 'falla', titulo: t.linuxTitulo, remedio: t.linuxRemedio }
  } else {
    return { id: 'motor', estado: 'ok', titulo: t.motorOk }
  }
}

/** 2) Versión: solo se afirma cuando se reconoce Docker Desktop. */
function filaVersion(e: EntradasPrevuelo): FilaPrevuelo {
  const t = txSandbox().prevuelo
  const v = versionDockerDesktop(e.nombrePlataformaDocker)
  const titulo = t.versionTitulo(VERSION_MINIMA.mayor, VERSION_MINIMA.menor)
  if (v === null) {
    return { id: 'version', estado: 'desconocido', titulo, remedio: t.versionDesconocida }
  } else if (v.mayor < VERSION_MINIMA.mayor || (v.mayor === VERSION_MINIMA.mayor && v.menor < VERSION_MINIMA.menor)) {
    return {
      id: 'version',
      estado: 'falla',
      titulo,
      remedio: t.versionVieja(v.mayor, v.menor, VERSION_MINIMA.mayor, VERSION_MINIMA.menor)
    }
  } else {
    return { id: 'version', estado: 'ok', titulo: t.versionOk(v.mayor, v.menor) }
  }
}

/** 3) La casilla: PISTA, nunca veredicto. */
function filaAjuste(e: EntradasPrevuelo): FilaPrevuelo {
  const t = txSandbox().prevuelo
  if (e.hostNetworking === null) {
    return { id: 'ajuste', estado: 'desconocido', titulo: t.ajusteTitulo, remedio: t.ajusteDesconocido }
  } else if (!e.hostNetworking) {
    return { id: 'ajuste', estado: 'falla', titulo: t.ajusteTitulo, remedio: t.ajusteApagado }
  } else {
    return { id: 'ajuste', estado: 'ok', titulo: t.ajusteOk }
  }
}

/** 4) Enhanced Container Isolation: anula la función aunque la casilla esté marcada. */
function filaAislamiento(e: EntradasPrevuelo, tuEquipo: string): FilaPrevuelo {
  const t = txSandbox().prevuelo
  if (e.aislamientoReforzado === null) {
    return { id: 'aislamiento', estado: 'desconocido', titulo: t.aislamientoTitulo, remedio: t.aislamientoDesconocido }
  } else if (e.aislamientoReforzado) {
    return { id: 'aislamiento', estado: 'falla', titulo: t.aislamientoTitulo, remedio: t.aislamientoActivo(tuEquipo) }
  } else {
    return { id: 'aislamiento', estado: 'ok', titulo: t.aislamientoTitulo }
  }
}

/** 5) LA FILA QUE DECIDE: las cuatro anteriores explican; ésta mide. */
function filaTrafico(e: EntradasPrevuelo, plataforma: Plataforma, tuEquipo: string): FilaPrevuelo {
  const t = txSandbox().prevuelo
  const titulo = t.traficoTitulo(tuEquipo)
  if (e.traficoLlega === null) {
    return { id: 'trafico', estado: 'desconocido', titulo, remedio: t.traficoDesconocido }
  } else if (!e.traficoLlega) {
    return {
      id: 'trafico',
      estado: 'falla',
      titulo,
      remedio: plataforma === 'windows' ? t.traficoWindows(tuEquipo) : t.traficoOtra(tuEquipo)
    }
  } else {
    return { id: 'trafico', estado: 'ok', titulo }
  }
}

/**
 * El bloque informativo del EGRESS por VPN. Va SEPARADO de las filas del prevuelo, y no
 * por orden: es otra cosa. La salida a la VPN la da `networkingMode=mirrored` de WSL,
 * vale para TODOS los perfiles con toggle o sin él, y sólo existe en Windows.
 *
 * NUNCA es una comprobación en rojo: no sabemos qué host de la VPN le importa al
 * usuario, así que afirmar que el egress está caído sin haberlo probado sería cambiar un
 * silencio por una mentira nueva. Es información, y se dice como tal.
 */
export function notaEgress(plataforma: Plataforma, modo: 'nat' | 'mirrored' | null): string | null {
  if (plataforma !== 'windows') return null
  if (modo === 'mirrored') return txSandbox().prevuelo.egressEspejo
  if (modo === 'nat') return txSandbox().prevuelo.egressNat
  return null
}
