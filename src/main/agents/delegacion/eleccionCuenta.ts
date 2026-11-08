// =============================================================================
// Qué cuenta de Docker hace una tarea delegada: la que nombra quien delega (sin distinguir mayúsculas ni tildes;
// un trozo vale si solo encaja con una) o, con `auto`, la del agente con más uso disponible en su ventana más
// ajustada, saltando las que no tienen sesión o pasan del umbral. Puro: las cuentas y su uso llegan ya leídos.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import {
  UMBRAL_AGOTADA,
  type AgenteDelegable,
  type EstadoCuentaDelegable,
  type VentanaUsoDelegable
} from '../../../shared/delegacion-ipc.ts'

export interface CuentaCandidata {
  id: string
  nombre: string
  agente: AgenteDelegable
  /** Si la carpeta de la cuenta tiene sesión iniciada. */
  credencial: boolean
  ventanas: VentanaUsoDelegable[]
}

export type Eleccion =
  | { ok: true; cuenta: CuentaCandidata }
  | { ok: false; rechazo: 'cuenta-no-existe'; disponibles: string[] }
  | { ok: false; rechazo: 'cuenta-ambigua'; candidatos: string[] }
  | { ok: false; rechazo: 'sin-credencial' }
  | { ok: false; rechazo: 'ninguna-cuenta'; reinicio?: number }

/** El uso de la ventana más ajustada: el que antes deja la cuenta sin servicio. */
export function usoMaximo(ventanas: readonly VentanaUsoDelegable[]): number {
  return ventanas.reduce((m, v) => Math.max(m, v.porcentaje), 0)
}

export function estadoDe(c: Pick<CuentaCandidata, 'credencial' | 'ventanas'>): EstadoCuentaDelegable {
  if (!c.credencial) return 'sin-credencial'
  return usoMaximo(c.ventanas) >= UMBRAL_AGOTADA ? 'agotada' : 'lista'
}

const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** La cuenta por su nombre: igual, o un trozo que solo encaja con una. */
function porNombre(delAgente: readonly CuentaCandidata[], pedido: string): Eleccion {
  const p = normalizar(pedido)
  const iguales = delAgente.filter((c) => normalizar(c.nombre) === p)
  const encajan = iguales.length > 0 ? iguales : p === '' ? [] : delAgente.filter((c) => normalizar(c.nombre).includes(p))
  if (encajan.length === 0) return { ok: false, rechazo: 'cuenta-no-existe', disponibles: delAgente.map((c) => c.nombre) }
  if (encajan.length > 1) return { ok: false, rechazo: 'cuenta-ambigua', candidatos: encajan.map((c) => c.nombre) }
  // Con el uso agotado se deja intentar: el dato de uso puede ser viejo y el agente lo dirá al empezar.
  return encajan[0].credencial ? { ok: true, cuenta: encajan[0] } : { ok: false, rechazo: 'sin-credencial' }
}

/** La que antes se reinicia entre las agotadas: cuándo vuelve a haber una. */
function primerReinicio(cuentas: readonly CuentaCandidata[]): number | undefined {
  const reinicios = cuentas.flatMap((c) => c.ventanas.filter((v) => v.porcentaje >= UMBRAL_AGOTADA && v.reinicio !== undefined).map((v) => v.reinicio as number))
  return reinicios.length > 0 ? Math.min(...reinicios) : undefined
}

export function elegirCuenta(cuentas: readonly CuentaCandidata[], agente: AgenteDelegable, pedido: string): Eleccion {
  const delAgente = cuentas.filter((c) => c.agente === agente)
  if (normalizar(pedido) !== 'auto') return porNombre(delAgente, pedido)
  const conSesion = delAgente.filter((c) => c.credencial)
  const libres = conSesion.filter((c) => usoMaximo(c.ventanas) < UMBRAL_AGOTADA)
  if (libres.length === 0) {
    const reinicio = primerReinicio(conSesion)
    return reinicio === undefined ? { ok: false, rechazo: 'ninguna-cuenta' } : { ok: false, rechazo: 'ninguna-cuenta', reinicio }
  }
  const elegida = [...libres].sort((a, b) => usoMaximo(a.ventanas) - usoMaximo(b.ventanas) || a.nombre.localeCompare(b.nombre))[0]
  return { ok: true, cuenta: elegida }
}
