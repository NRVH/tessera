// =============================================================================
// Categoría TERMINALES: la de shell y la del agente, con apariencias INDEPENDIENTES
// (no se usan igual: en la del agente se lee conversación larga, en la de shell salida
// de comandos que tiene que caber). `GrupoTerminal` se instancia dos veces con estado
// distinto. Las claves conservan el nombre `terminal*` para el shell: renombrarlas
// resetearía el ajuste guardado. El fondo no es configurable (ver theme/terminalAppearance).
// «Renderizado» va aparte y al final: es un dato de xterm en general, no de una terminal.
// =============================================================================

import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN
} from '../../../../../shared/workspace-state-ipc'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_OPTIONS,
  type TerminalAppearance
} from '../../../theme/terminalAppearance'
import { detectGpuRenderer, prettyGpuName } from '../../../util/gpuRenderer'
import { Fila, Grupo, Selector, Stepper } from '../primitivas'
import type { PropsCategoria } from '../tipos'

export function Terminales({
  ve,
  terminalAppearance,
  onChangeTerminalAppearance,
  agentAppearance,
  onChangeAgentAppearance
}: PropsCategoria): React.JSX.Element {
  return (
    <>
      <GrupoTerminal
        titulo="Terminal"
        idFuente="term-fuente"
        idTamano="term-tamano"
        nombre="la terminal"
        appearance={terminalAppearance}
        onChange={onChangeTerminalAppearance}
        ve={ve}
      />
      <GrupoTerminal
        titulo="Terminal del agente"
        ayuda="La de Claude Code y Codex, independiente de la de arriba."
        idFuente="agente-fuente"
        idTamano="agente-tamano"
        nombre="la terminal del agente"
        appearance={agentAppearance}
        onChange={onChangeAgentAppearance}
        ve={ve}
      />
      {ve('term-render') && (
        <Grupo titulo="Rendimiento">
          <FilaRenderizado />
        </Grupo>
      )}
    </>
  )
}

/** Fuente + tamaño de UNA terminal. Se instancia dos veces con estado distinto. */
function GrupoTerminal({
  titulo,
  ayuda,
  idFuente,
  idTamano,
  nombre,
  appearance,
  onChange,
  ve
}: {
  titulo: string
  ayuda?: string
  idFuente: string
  idTamano: string
  /** Para los aria-label: "Reducir el tamaño de la terminal del agente". */
  nombre: string
  appearance: TerminalAppearance
  onChange: (a: TerminalAppearance) => void
  ve: (id: string) => boolean
}): React.JSX.Element | null {
  if (!ve(idFuente) && !ve(idTamano)) return null
  const update = (partial: Partial<TerminalAppearance>): void =>
    onChange({ ...appearance, ...partial })
  const size = appearance.fontSize || DEFAULT_TERMINAL_FONT_SIZE
  return (
    <Grupo titulo={titulo} ayuda={ayuda}>
      {ve(idFuente) && (
        <Fila
          etiqueta="Fuente"
          control={
            <Selector
              valor={appearance.fontFamily}
              opciones={TERMINAL_FONT_OPTIONS}
              onChange={(fontFamily) => update({ fontFamily })}
              etiqueta={`Fuente de ${nombre}`}
            />
          }
        />
      )}
      {ve(idTamano) && (
        <Fila
          etiqueta="Tamaño"
          control={
            <Stepper
              valor={size}
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              onChange={(v) => update({ fontSize: v })}
              etiqueta={`el tamaño de ${nombre}`}
            />
          }
        />
      )}
    </Grupo>
  )
}

/**
 * Renderizado de xterm: INFORMATIVO, no un ajuste. Se pinta como fila para que
 * no vuelva a ser un texto suelto flotando entre ajustes.
 */
function FilaRenderizado(): React.JSX.Element {
  const gpu = detectGpuRenderer()
  const name = prettyGpuName(gpu.renderer)
  return (
    <Fila
      etiqueta="Renderizado"
      ayuda={
        gpu.useWebgl
          ? 'Las terminales dibujan por GPU.'
          : 'Sin GPU disponible: las terminales dibujan por software.'
      }
      control={
        <span className="ajustes-dato" title={gpu.renderer || 'sin datos de GPU'}>
          {gpu.useWebgl ? 'WebGL' : 'DOM'}
          {name ? ` · ${name}` : ''}
        </span>
      }
    />
  )
}
