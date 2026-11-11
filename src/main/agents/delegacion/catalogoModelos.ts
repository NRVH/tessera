// =============================================================================
// Los modelos y esfuerzos que anuncia el CLI de una cuenta, leídos dentro de su contenedor: `model/list` del servidor de
// aplicación de Codex y la respuesta de inicialización del modo `stream-json` de Claude Code. Compone la orden, lee su
// salida y comprueba una petición contra lo leído. Lo que escribe el contenedor no es de fiar: solo pasa lo que tiene
// la forma de un nombre. Puro.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md, docs/decisiones/agentes/contratos-con-los-cli.md
// =============================================================================
import { citarSh } from '../../../shared/citarShell.ts'
import { ESFUERZO_VALIDO, MODELO_VALIDO, type AgenteDelegable, type ModeloDelegable } from '../../../shared/delegacion-ipc.ts'
import { composeCleanGitCommand } from '../gitInContainer.ts'

/** Lo que se espera como mucho al CLI dentro del contenedor, en segundos. */
const TOPE_CLI_S = 20
const MAX_MODELOS = 200
const MAX_ESFUERZOS = 12
const MAX_NOMBRE = 80
/** Lo que anuncia Claude Code para «sin modelo elegido»: no es un modelo que se pueda pedir. */
const VALOR_PREDETERMINADO_CLAUDE = 'default'

const PETICION_CLAUDE = JSON.stringify({ type: 'control_request', request_id: 'catalogo', request: { subtype: 'initialize' } })
const INICIO_CODEX = JSON.stringify({ method: 'initialize', id: 1, params: { clientInfo: { name: 'tessera', title: 'Tessera', version: '1' } } })
const INICIADO_CODEX = JSON.stringify({ method: 'initialized', params: {} })
const LISTAR_CODEX = JSON.stringify({ method: 'model/list', id: 2, params: { limit: MAX_MODELOS } })

/** La orden sin el entorno. Claude Code contesta y sale al cerrarse su entrada; Codex necesita la entrada abierta hasta contestar. */
export function invocacionCatalogo(agente: AgenteDelegable, binario: string): string {
  if (agente === 'claude-code') {
    return `printf '%s\\n' ${citarSh(PETICION_CLAUDE)} | timeout ${TOPE_CLI_S} ${binario} -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence`
  }
  return [
    `coproc CATALOGO { exec timeout ${TOPE_CLI_S} ${binario} app-server 2>/dev/null; }`,
    `printf '%s\\n' ${citarSh(INICIO_CODEX)} >&"\${CATALOGO[1]}"`,
    `while IFS= read -r -t ${TOPE_CLI_S} linea <&"\${CATALOGO[0]}"; do`,
    '  case "$linea" in',
    `    *'"id":2'*) printf '%s\\n' "$linea"; kill "$CATALOGO_PID" 2>/dev/null; exit 0 ;;`,
    `    *'"id":1'*) printf '%s\\n' ${citarSh(INICIADO_CODEX)} ${citarSh(LISTAR_CODEX)} >&"\${CATALOGO[1]}" ;;`,
    '  esac',
    'done',
    'exit 1'
  ].join('\n')
}

/** La línea entera, con la carpeta de la cuenta: sin ella, Claude Code solo enseña los alias genéricos. */
export function lineaCatalogo(agente: AgenteDelegable, binario: string, rutaConfig: string): string {
  return composeCleanGitCommand(invocacionCatalogo(agente, binario), { agente, containerConfigPath: rutaConfig, prelude: false })
}

type Crudo = Record<string, unknown>
const obj = (v: unknown): Crudo | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Crudo) : null)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function eventos(salida: string): Crudo[] {
  return salida.split(/\r?\n/).flatMap((l) => {
    if (!l.trim().startsWith('{')) return []
    try {
      const o = obj(JSON.parse(l))
      return o ? [o] : []
    } catch {
      return []
    }
  })
}

function nombreLegible(v: unknown, respaldo: string): string {
  const limpio = typeof v === 'string' ? v.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE) : ''
  return limpio || respaldo
}

const esfuerzosLimpios = (v: unknown[]): string[] => [...new Set(v.filter((e): e is string => typeof e === 'string' && ESFUERZO_VALIDO.test(e)))].slice(0, MAX_ESFUERZOS)

function modelosClaude(salida: string): LecturaCatalogo {
  const respuesta = eventos(salida).find((e) => e.type === 'control_response' && obj(e.response)?.subtype === 'success')
  const cuerpo = obj(obj(respuesta?.response)?.response)
  if (!cuerpo) return { ok: false, motivo: 'ilegible' }
  const cuenta = obj(cuerpo.account)
  if (cuenta?.tokenSource === 'none' && !cuenta.apiKeySource) return { ok: false, motivo: 'sin-sesion' }
  const filas = lista(cuerpo.models).map(obj).filter((m): m is Crudo => m !== null)
  const predeterminado = filas.find((m) => m.value === VALOR_PREDETERMINADO_CLAUDE)?.resolvedModel
  let marcado = false
  const modelos = filas.flatMap((m): ModeloDelegable[] => {
    const id = m.value
    if (typeof id !== 'string' || id === VALOR_PREDETERMINADO_CLAUDE || !MODELO_VALIDO.test(id)) return []
    const resuelto = typeof m.resolvedModel === 'string' && MODELO_VALIDO.test(m.resolvedModel) ? m.resolvedModel : undefined
    const porDefecto = !marcado && resuelto !== undefined && resuelto === predeterminado
    marcado ||= porDefecto
    return [{ id, ...(resuelto ? { resuelto } : {}), nombre: nombreLegible(m.displayName, id), esfuerzos: m.supportsEffort === true ? esfuerzosLimpios(lista(m.supportedEffortLevels)) : [], porDefecto }]
  })
  return modelos.length > 0 ? { ok: true, modelos: modelos.slice(0, MAX_MODELOS) } : { ok: false, motivo: 'ilegible' }
}

function modelosCodex(salida: string): LecturaCatalogo {
  const respuesta = eventos(salida).find((e) => e.id === 2 && obj(e.result) !== null)
  const filas = lista(obj(respuesta?.result)?.data).map(obj).filter((m): m is Crudo => m !== null)
  const modelos = filas.flatMap((m): ModeloDelegable[] => {
    const id = m.model
    if (typeof id !== 'string' || m.hidden === true || !MODELO_VALIDO.test(id)) return []
    return [{ id, nombre: nombreLegible(m.displayName, id), esfuerzos: esfuerzosLimpios(lista(m.supportedReasoningEfforts).map((e) => obj(e)?.reasoningEffort)), porDefecto: m.isDefault === true }]
  })
  return modelos.length > 0 ? { ok: true, modelos: modelos.slice(0, MAX_MODELOS) } : { ok: false, motivo: 'ilegible' }
}

export type LecturaCatalogo = { ok: true; modelos: ModeloDelegable[] } | { ok: false; motivo: 'sin-sesion' | 'ilegible' }

export function leerCatalogo(agente: AgenteDelegable, salida: string): LecturaCatalogo {
  return agente === 'claude-code' ? modelosClaude(salida) : modelosCodex(salida)
}

export type RechazoModelo =
  | { ok: false; rechazo: 'modelo-no-disponible'; modelo: string; disponibles: string[] }
  | { ok: false; rechazo: 'esfuerzo-no-admitido'; esfuerzo: string; modelo?: string; admitidos: string[] }

/**
 * El esfuerzo de una continuación. El heredado no se impone a un modelo nuevo que no lo admite: quien cambia de modelo
 * sin indicar esfuerzo no tendría forma de quitarlo, y se usa el predeterminado de ese modelo.
 */
export function esfuerzoAlContinuar(modelos: readonly ModeloDelegable[], modeloNuevo: string | undefined, pedido: string | undefined, heredado: string | undefined): string | undefined {
  if (pedido !== undefined || heredado === undefined || modeloNuevo === undefined) return pedido ?? heredado
  return comprobarPeticion(modelos, modeloNuevo, heredado)?.rechazo === 'esfuerzo-no-admitido' ? undefined : heredado
}

/** Por qué el catálogo no admite esa petición, o null. Sin modelo elegido, vale cualquier esfuerzo que admita alguno. */
export function comprobarPeticion(modelos: readonly ModeloDelegable[], modelo: string | undefined, esfuerzo: string | undefined): RechazoModelo | null {
  const elegido = modelo === undefined ? undefined : modelos.find((m) => m.id === modelo || m.resuelto === modelo)
  if (modelo !== undefined && !elegido) return { ok: false, rechazo: 'modelo-no-disponible', modelo, disponibles: modelos.map((m) => m.id) }
  if (esfuerzo === undefined) return null
  const admitidos = elegido ? elegido.esfuerzos : [...new Set(modelos.flatMap((m) => m.esfuerzos))]
  return admitidos.includes(esfuerzo) ? null : { ok: false, rechazo: 'esfuerzo-no-admitido', esfuerzo, ...(modelo !== undefined ? { modelo } : {}), admitidos }
}
