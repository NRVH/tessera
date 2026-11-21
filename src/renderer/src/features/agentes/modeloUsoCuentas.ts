// =============================================================================
// Las cuentas del perfil en «Uso de las cuentas» y las fijadas en la barra de estado, sin efectos. Una cuenta cuyo uso
// ya está a la vista en el pie de un panel no se repite en ninguno de los dos sitios.
// Las ventanas de modelos concretos no participan en el resumen de la cuenta.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import type { AgenteConversacion } from '../../../../shared/conversations-ipc.ts'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc.ts'
import { MAX_CUENTAS_FIJADAS, type CuentaFijada } from '../../../../shared/workspace-state-ipc.ts'
import type { FotoUso, VentanaUso } from '../../../../shared/usage-ipc.ts'

/** Una cuenta con su uso: la nativa (`accountId` null, sin `cuenta`) o una de Docker, privada o global. */
export interface CuentaUso extends CuentaFijada {
  cuenta: CuentaAgente | null
  foto: FotoUso | null
}

export interface GrupoCuentasUso {
  agente: CuentaFijada['agente']
  filas: CuentaUso[]
}

/** Solo los agentes de serie tienen uso de cuenta. */
export const AGENTES_CON_USO = ['claude-code', 'codex'] as const satisfies readonly AgenteConversacion[]

export function controlesFilaCuenta(fila: CuentaUso): { cuentaParaIniciar: CuentaAgente | null; mostrarPin: boolean } {
  const cuentaParaIniciar = fila.cuenta?.conSesion === false ? fila.cuenta : null
  return { cuentaParaIniciar, mostrarPin: !cuentaParaIniciar }
}

/** Una fijada sin sesión oculta el pin: ofrece el menú contextual de la fila para poder desfijarla. */
export function ofreceMenuDesfijar(fila: CuentaUso, fijada: boolean): boolean {
  return fijada && fila.cuenta?.conSesion === false
}

/** La identidad nativa es independiente del id interno del panel. */
export function mismaCuenta(a: CuentaFijada | null | undefined, b: CuentaFijada | null | undefined): boolean {
  return !!a && !!b && a.agente === b.agente && a.accountId === b.accountId
}

export function estaALaVista(cuenta: CuentaFijada, aLaVista: readonly CuentaFijada[]): boolean {
  return aLaVista.some((c) => mismaCuenta(c, cuenta))
}

/**
 * Por agente, la nativa primero y las de Docker en el orden en que llegan; sin las que están a la vista y sin grupos
 * vacíos. Una fijada se lista siempre, aunque esté a la vista o la nativa no tenga datos: sin su fila no habría cómo
 * quitarla, y ocupa uno de los huecos.
 */
export function construirGrupos(cuentas: readonly CuentaUso[], aLaVista: readonly CuentaFijada[], fijadas: readonly CuentaFijada[] = []): GrupoCuentasUso[] {
  return AGENTES_CON_USO.map((agente) => {
    const filas = cuentas.filter((c) => c.agente === agente && (estaALaVista(c, fijadas)
      || (!estaALaVista(c, aLaVista) && (c.accountId !== null || !!c.foto?.windows.length))))
    return { agente, filas: [...filas.filter((c) => c.accountId === null), ...filas.filter((c) => c.accountId !== null)] }
  }).filter((g) => g.filas.length > 0)
}

/** Las filas cuyo nombre visible contiene el texto, sin distinguir mayúsculas; los grupos que se quedan sin filas, fuera. */
export function filtrarGrupos(grupos: readonly GrupoCuentasUso[], texto: string, nombre: (fila: CuentaUso) => string): GrupoCuentasUso[] {
  const buscado = texto.trim().toLocaleLowerCase()
  if (!buscado) return [...grupos]
  return grupos.map((g) => ({ ...g, filas: g.filas.filter((f) => nombre(f).toLocaleLowerCase().includes(buscado)) })).filter((g) => g.filas.length > 0)
}

/**
 * Las dos ventanas generales de la cuenta. Las de un modelo concreto llevan su nombre delante, separado por un espacio,
 * y no forman parte del resumen. La duración de cada límite depende del plan: una general con otra etiqueta ocupa la
 * columna que quede libre.
 */
export function ventanasCuenta(foto: FotoUso | null): [VentanaUso | undefined, VentanaUso | undefined] {
  const generales = (foto?.windows ?? []).filter((w) => !w.etiqueta.includes(' '))
  const corta = generales.find((w) => w.etiqueta === '5h')
  const larga = generales.find((w) => w.etiqueta === '7d')
  const resto = generales.filter((w) => w !== corta && w !== larga)
  return [corta ?? resto.shift(), larga ?? resto.shift()]
}

/** La columna con mayor consumo. En un empate, la primera. */
export function peorVentana(foto: FotoUso | null): 0 | 1 {
  const [primera, segunda] = ventanasCuenta(foto)
  return (segunda?.porcentaje ?? -1) > (primera?.porcentaje ?? -1) ? 1 : 0
}

export function nombreCorto(agente: AgenteConversacion): string {
  return agente === 'codex' ? 'Codex' : 'Claude'
}

/**
 * Las fijadas que se enseñan en la barra, en su orden: fuera las que están a la vista en un panel y las de Docker
 * borradas o sin sesión, o de las que aún no se sabe el nombre. La elección se conserva aunque ahora no se enseñe.
 */
export function fijadasEnBarra(fijadas: readonly CuentaFijada[], aLaVista: readonly CuentaFijada[], cuentas: readonly CuentaAgente[]): CuentaFijada[] {
  return fijadas.filter((f) => !estaALaVista(f, aLaVista)
    && (f.accountId === null || cuentas.some((c) => c.id === f.accountId && c.agente === f.agente && c.conSesion !== false)))
}

/**
 * Las fijadas que siguen existiendo: fuera las de Docker que ya no están en una lista de su agente leída con éxito
 * (`agentesLeidos`). Las de un agente cuya lista no se pudo leer se conservan: no se sabe si existen.
 */
export function fijadasVigentes(fijadas: readonly CuentaFijada[], cuentas: readonly CuentaUso[], agentesLeidos: ReadonlySet<CuentaFijada['agente']>): CuentaFijada[] {
  return fijadas.filter((f) => f.accountId === null || !agentesLeidos.has(f.agente) || cuentas.some((c) => mismaCuenta(c, f)))
}

/**
 * Fija o quita una cuenta; con el máximo ya fijado, una cuenta nueva no entra. `vigentes` son las que siguen
 * existiendo: al fijar, una borrada deja su hueco y sale de la lista guardada.
 */
export function alternarFijada(actuales: readonly CuentaFijada[], cuenta: CuentaFijada, vigentes: readonly CuentaFijada[] = actuales): CuentaFijada[] {
  if (estaALaVista(cuenta, actuales)) return actuales.filter((c) => !mismaCuenta(c, cuenta))
  if (vigentes.length >= MAX_CUENTAS_FIJADAS) return [...actuales]
  return [...actuales.filter((c) => estaALaVista(c, vigentes)), cuenta].map((c) => ({ agente: c.agente, accountId: c.accountId }))
}

export function sinHueco(vigentes: readonly CuentaFijada[]): boolean {
  return vigentes.length >= MAX_CUENTAS_FIJADAS
}
