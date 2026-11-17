// =============================================================================
// La línea de arranque de una tarea delegada, en el contenedor de la cuenta: el modo no interactivo de cada CLI
// (`claude -p` con `stream-json`, `codex exec --json`), que lee la orden de un archivo por la entrada estándar y
// escribe sus eventos en JSON, una línea cada uno. Mismo entorno limpio, variables del puente, capa compartida y
// aviso que una pestaña de esa cuenta. Pura: compone una cadena con lo que recibe.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { citarSh } from '../../../shared/citarShell.ts'
import { ESFUERZO_VALIDO, MODELO_VALIDO, type AgenteDelegable } from '../../../shared/delegacion-ipc.ts'
import { ASIGNACIONES_TERMINAL_CONTENEDOR } from '../../terminales/entornoPty.ts'
import { componerComandoGitLimpio, asignacionesBdAgente } from '../gitEnContenedor.ts'
import { ID_CONVERSACION, SIN_SERVIDOR_CODEX, argumentoBriefing, argumentoCapa, argumentoFoto } from '../lineaArranqueAgente.ts'

/**
 * Lo que escribe la línea de Codex cuando la cuenta no tiene sesión: en una tarea no hay nadie que haga el login
 * por navegador, así que no se lanza. El código de salida lo distingue de un fallo del agente.
 */
export const MARCA_SIN_CREDENCIAL = 'TESSERA_DELEGACION_SIN_CREDENCIAL'
export const CODIGO_SIN_CREDENCIAL = 86

export interface OpcionesLineaDelegada {
  binario: string
  agente: AgenteDelegable
  /** La carpeta de la cuenta dentro del contenedor (`/agent-config/<agente>/<cuenta>`). */
  rutaConfig: string
  /** El archivo con la orden, dentro del contenedor. */
  rutaOrden: string
  soloLectura: boolean
  /** La conversación a continuar (`--continuar`), o null para una nueva. */
  reanudar: string | null
  /** El modelo y el esfuerzo pedidos; sin ellos, los de la configuración de la cuenta. */
  modelo?: string
  esfuerzo?: string
  aviso: string | null
  conCapa: boolean
  /** Las variables del puente de la sesión (`tdb`, `tssh`, `tctx`), las mismas que lleva una pestaña de la cuenta. */
  entorno: Record<string, string>
}

/**
 * Los permisos sin nadie que apruebe. Leer y escribir: los de la cuenta en Docker sin preguntas, porque el
 * contenedor ya es el límite y en una tarea no hay a quién preguntar. Solo lectura: el modo de planificación de
 * Claude Code. Codex no tiene un modo así que funcione en el contenedor (su sandbox de solo lectura usa un
 * aislamiento que dentro de Docker no arranca, y entonces no ejecuta ni una orden): corre sin él y la
 * restricción le llega como indicación en su aviso (`AVISO_SOLO_LECTURA`).
 */
function argumentoPermisos(agente: AgenteDelegable, soloLectura: boolean): string {
  if (agente === 'claude-code') return soloLectura ? '--permission-mode plan' : '--dangerously-skip-permissions'
  return '--dangerously-bypass-approvals-and-sandbox'
}

/** Las opciones de modelo y esfuerzo; un valor sin la forma de un nombre no entra en la línea. */
function argumentosModelo(o: Pick<OpcionesLineaDelegada, 'agente' | 'modelo' | 'esfuerzo'>): string[] {
  const modelo = o.modelo !== undefined && MODELO_VALIDO.test(o.modelo) ? citarSh(o.modelo) : null
  const esfuerzo = o.esfuerzo !== undefined && ESFUERZO_VALIDO.test(o.esfuerzo) ? o.esfuerzo : null
  if (o.agente === 'claude-code') return [...(modelo ? [`--model ${modelo}`] : []), ...(esfuerzo ? [`--effort ${citarSh(esfuerzo)}`] : [])]
  return [...(modelo ? [`-m ${modelo}`] : []), ...(esfuerzo ? [`-c ${citarSh(`model_reasoning_effort="${esfuerzo}"`)}`] : [])]
}

/** La invocación del CLI, sin el entorno: la orden entra por la entrada estándar desde su archivo. */
export function invocacionDelegada(o: Omit<OpcionesLineaDelegada, 'entorno'>): string {
  const reanudar = o.reanudar && ID_CONVERSACION.test(o.reanudar) ? o.reanudar : null
  const aviso = argumentoBriefing(o.aviso, o.agente, citarSh)
  const capa = o.conCapa ? argumentoCapa(o.agente, o.binario, o.rutaConfig) : null
  const entrada = `< ${citarSh(o.rutaOrden)}`
  if (o.agente === 'claude-code') {
    const args = ['-p', '--output-format stream-json', '--verbose', argumentoPermisos(o.agente, o.soloLectura), ...argumentosModelo(o)]
    if (reanudar) args.push(`--resume ${reanudar}`)
    if (capa) args.push(capa)
    if (aviso) args.push(aviso)
    const foto = argumentoFoto(o.agente, o.binario, reanudar ? `--resume ${reanudar}` : null, aviso)
    if (foto) args.push(foto)
    return `exec ${o.binario} ${args.join(' ')} ${entrada}`
  }
  // Las opciones de `exec` van antes de `resume`: el subcomando no las admite todas.
  const opciones = ['--json', '--skip-git-repo-check', SIN_SERVIDOR_CODEX, argumentoPermisos(o.agente, o.soloLectura), ...argumentosModelo(o)]
  if (capa) opciones.push(capa)
  if (aviso) opciones.push(aviso)
  const sub = reanudar ? ` resume ${reanudar}` : ''
  const sinSesion = `{ echo ${MARCA_SIN_CREDENCIAL}; exit ${CODIGO_SIN_CREDENCIAL}; }`
  return `{ [ -f "$CODEX_HOME/auth.json" ] || ${sinSesion}; } && exec ${o.binario} exec ${opciones.join(' ')}${sub} - ${entrada}`
}

/**
 * La línea entera, bajo el entorno limpio del contenedor, como `construirComandoLanzamientoAgente`: `env -i` borra los `-e` de
 * `docker exec`, así que las variables del puente van dentro.
 */
export function lineaDelegada(o: OpcionesLineaDelegada): string {
  return componerComandoGitLimpio(invocacionDelegada(o), {
    agente: o.agente,
    rutaConfigContenedor: o.rutaConfig,
    asignacionesExtra: [...ASIGNACIONES_TERMINAL_CONTENEDOR, ...asignacionesBdAgente(o.entorno)],
  })
}
