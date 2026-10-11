// =============================================================================
// Lector del estado que el propio agente informa por su salida (OSC 7501, «Program Status
// Protocol»): separa del flujo del pty los avisos de estado, la sonda con la que el CLI pregunta si
// la terminal los entiende y las campanas sueltas (un BEL que cierra un OSC no es una campana). Lee
// trozo a trozo: una secuencia puede llegar partida entre dos. Puro; lo usa el rastreador de turnos.
// Decisiones: docs/decisiones/agentes/turnos-estado-informado.md
// =============================================================================

import type { AgentMotivoEspera as MotivoEspera } from '../../shared/agent-terminal-ipc'

/** Los estados del protocolo. `clear` no es un estado: borra el registro (y sus hijos). */
export type EstadoInformado = 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear'

/** Un aviso de estado ya validado. */
export interface AvisoPrograma {
  estado: EstadoInformado
  /** El registro al que se refiere: `null` es el raíz (el del programa); `a/b`, un hijo. */
  id: string | null
  motivo: MotivoEspera | null
}

/** Lo que trae un trozo de salida. */
export interface LecturaPrograma {
  avisos: AvisoPrograma[]
  /** El programa preguntó si la terminal entiende el protocolo: hay que contestarle. */
  sonda: boolean
  /** BEL fuera de cualquier OSC: la campana de verdad. */
  campanas: number
}

/** La respuesta a la sonda: el mismo cuerpo, `?`. */
export const RESPUESTA_SONDA = '\x1b]7501;?\x07'

const ESC = '\x1b'
const BEL = '\x07'
const PREFIJO = '7501;'
/** Un OSC más largo que esto (un portapapeles en base64) no es un aviso: se descarta sin guardarlo. */
const TOPE_CUERPO = 4096

const ESTADOS = new Set<string>(['idle', 'working', 'done', 'blocked', 'error', 'clear'])
const MOTIVOS = new Set<string>(['permission', 'question', 'auth'])
const ID = /^[A-Za-z0-9_.+-]{1,32}(?:\/[A-Za-z0-9_.+-]{1,32})*$/
const CLAVE = /^[a-z]+$/
const VALOR = /^[A-Za-z0-9_.,+/=-]*$/
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** ¿Es un texto en base64 cuyo UTF-8 no lleva caracteres de control? Si no, el aviso entero se descarta. */
function textoValido(b64: string): boolean {
  if (!BASE64.test(b64)) return false
  // eslint-disable-next-line no-control-regex -- buscar caracteres de control es justo su trabajo
  return !/[\x00-\x1f\x7f]/.test(Buffer.from(b64, 'base64').toString('utf8'))
}

/** Las parejas `clave=valor` de un cuerpo; las mal formadas se saltan y la última repetida gana. */
function parejas(cuerpo: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of cuerpo.split(':')) {
    const igual = p.indexOf('=')
    if (igual <= 0) continue
    const clave = p.slice(0, igual)
    const valor = p.slice(igual + 1)
    if (CLAVE.test(clave) && VALOR.test(valor)) m.set(clave, valor)
  }
  return m
}

/**
 * Un aviso del cuerpo (sin el `7501;`), o `null` si no vale: sin `state` o con uno desconocido, con un
 * `id` mal formado, o con un `msg`/`title` que no decodifica limpio. Las claves desconocidas se ignoran.
 */
export function avisoDe(cuerpo: string): AvisoPrograma | null {
  const m = parejas(cuerpo)
  const estado = m.get('state')
  if (estado === undefined || !ESTADOS.has(estado)) return null
  const id = m.get('id')
  if (id !== undefined && !ID.test(id)) return null
  for (const k of ['msg', 'title']) {
    const t = m.get(k)
    if (t !== undefined && !textoValido(t)) return null
  }
  const motivo = m.get('kind')
  return {
    estado: estado as EstadoInformado,
    id: id ?? null,
    motivo: estado === 'blocked' && motivo !== undefined && MOTIVOS.has(motivo) ? (motivo as MotivoEspera) : null
  }
}

/** Un lector por sesión: guarda lo que quedó a medias entre dos trozos. */
export interface LectorPrograma {
  leer: (trozo: string) => LecturaPrograma
  /** Olvida lo que quedó a medias (el proceso se relanza). */
  reiniciar: () => void
}

/** Estado de un lector: dentro de un OSC o fuera, y lo que se arrastra al trozo siguiente. */
interface EstadoLector {
  enOsc: boolean
  /** El cuerpo del OSC en curso; `null` si pasó del tope y solo se espera su final. */
  cuerpo: string | null
  /** Un ESC al final del trozo: no se sabe aún qué empieza. */
  escPendiente: boolean
}

/** Cierra el OSC en curso y apunta lo que diga. */
function cerrarOsc(e: EstadoLector, out: LecturaPrograma): void {
  const cuerpo = e.cuerpo
  e.enOsc = false
  e.cuerpo = ''
  if (cuerpo === null || !cuerpo.startsWith(PREFIJO)) return
  const resto = cuerpo.slice(PREFIJO.length)
  if (resto === '?') {
    out.sonda = true
    return
  }
  const aviso = avisoDe(resto)
  if (aviso !== null) out.avisos.push(aviso)
}

/** Añade texto al OSC en curso, o lo descarta entero si pasa del tope. */
function acumular(e: EstadoLector, texto: string): void {
  if (e.cuerpo === null) return
  e.cuerpo = e.cuerpo.length + texto.length > TOPE_CUERPO ? null : e.cuerpo + texto
}

/** Fuera de un OSC desde `i`: cuenta campanas y entra en el siguiente `ESC ]`. Devuelve dónde sigue, o -1 si se acabó. */
function pasoFuera(e: EstadoLector, s: string, i: number, out: LecturaPrograma): number {
  const esc = s.indexOf(ESC, i)
  const fin = esc < 0 ? s.length : esc
  for (let j = s.indexOf(BEL, i); j >= 0 && j < fin; j = s.indexOf(BEL, j + 1)) out.campanas++
  if (esc < 0) return -1
  if (esc + 1 === s.length) {
    e.escPendiente = true
    return -1
  }
  if (s[esc + 1] !== ']') return esc + 1
  e.enOsc = true
  e.cuerpo = ''
  return esc + 2
}

/** Dentro de un OSC desde `i`: busca su final (BEL o `ESC \`). Devuelve dónde sigue, o -1 si se acabó. */
function pasoDentro(e: EstadoLector, s: string, i: number, out: LecturaPrograma): number {
  const bel = s.indexOf(BEL, i)
  const esc = s.indexOf(ESC, i)
  if (bel < 0 && esc < 0) {
    acumular(e, s.slice(i))
    return -1
  }
  if (bel >= 0 && (esc < 0 || bel < esc)) {
    acumular(e, s.slice(i, bel))
    cerrarOsc(e, out)
    return bel + 1
  }
  acumular(e, s.slice(i, esc))
  if (esc + 1 === s.length) {
    e.escPendiente = true
    return -1
  }
  if (s[esc + 1] === '\\') {
    cerrarOsc(e, out)
    return esc + 2
  }
  // Otro ESC corta el OSC sin terminarlo: no dice nada, y lo que sigue se lee desde fuera.
  e.enOsc = false
  e.cuerpo = ''
  return esc
}

/** Crea el lector de una sesión. */
export function crearLectorPrograma(): LectorPrograma {
  const e: EstadoLector = { enOsc: false, cuerpo: '', escPendiente: false }
  return {
    leer: (trozo) => {
      const out: LecturaPrograma = { avisos: [], sonda: false, campanas: 0 }
      const s = e.escPendiente ? ESC + trozo : trozo
      e.escPendiente = false
      for (let i = 0; i >= 0 && i < s.length; ) i = e.enOsc ? pasoDentro(e, s, i, out) : pasoFuera(e, s, i, out)
      return out
    },
    reiniciar: () => {
      e.enOsc = false
      e.cuerpo = ''
      e.escPendiente = false
    }
  }
}
