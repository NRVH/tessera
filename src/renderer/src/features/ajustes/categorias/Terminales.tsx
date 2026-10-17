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
import { Fila, Grupo, Interruptor, Selector, Stepper } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { txTerminales } from '../textos.ts'

export function Terminales({
  ve,
  terminalAppearance,
  onChangeTerminalAppearance,
  agentAppearance,
  onChangeAgentAppearance
}: PropsCategoria): React.JSX.Element {
  const t = txTerminales()
  return (
    <>
      <GrupoTerminal
        titulo={t.grupoTerminal}
        idFuente="term-fuente"
        idTamano="term-tamano"
        nombre={t.nombreTerminal}
        appearance={terminalAppearance}
        onChange={onChangeTerminalAppearance}
        ve={ve}
        idResaltado="term-resaltado"
      />
      <GrupoTerminal
        titulo={t.grupoAgente}
        ayuda={t.ayudaAgente}
        idFuente="agente-fuente"
        idTamano="agente-tamano"
        nombre={t.nombreAgente}
        appearance={agentAppearance}
        onChange={onChangeAgentAppearance}
        ve={ve}
      />
      {ve('term-render') && (
        <Grupo titulo={t.rendimiento}>
          <FilaRenderizado />
        </Grupo>
      )}
    </>
  )
}

/** Resaltar logs y salidas (`terminales/resaltadoSalida.ts`). */
function FilaResaltado({ activo, onChange }: { activo: boolean; onChange: () => void }): React.JSX.Element {
  const t = txTerminales()
  return (
    <Fila
      etiqueta={t.resaltar}
      ayuda={t.resaltarAyuda}
      control={<Interruptor activo={activo} onChange={onChange} etiqueta={t.resaltar} />}
    />
  )
}

/** Fuente + tamaño de UNA terminal y, en la de shell, el resaltado. Se instancia dos veces con estado distinto. */
function GrupoTerminal({
  titulo,
  ayuda,
  idFuente,
  idTamano,
  idResaltado,
  nombre,
  appearance,
  onChange,
  ve
}: {
  titulo: string
  ayuda?: string
  idFuente: string
  idTamano: string
  /** Solo la de shell: la del agente pinta su propia interfaz. */
  idResaltado?: string
  /** Para los aria-label: "Reducir el tamaño de la terminal del agente". */
  nombre: string
  appearance: TerminalAppearance
  onChange: (a: TerminalAppearance) => void
  ve: (id: string) => boolean
}): React.JSX.Element | null {
  const conResaltado = idResaltado !== undefined && ve(idResaltado)
  if (!ve(idFuente) && !ve(idTamano) && !conResaltado) return null
  const update = (partial: Partial<TerminalAppearance>): void => onChange({ ...appearance, ...partial })
  const size = appearance.fontSize || DEFAULT_TERMINAL_FONT_SIZE
  const t = txTerminales()
  const opciones = TERMINAL_FONT_OPTIONS.map((o) => (o.value === '' ? { ...o, label: t.predeterminada } : o))
  return (
    <Grupo titulo={titulo} ayuda={ayuda}>
      {ve(idFuente) && (
        <Fila
          etiqueta={t.fuente}
          control={
            <Selector
              valor={appearance.fontFamily}
              opciones={opciones}
              onChange={(fontFamily) => update({ fontFamily })}
              etiqueta={t.fuenteDe(nombre)}
            />
          }
        />
      )}
      {ve(idTamano) && (
        <Fila
          etiqueta={t.tamano}
          control={
            <Stepper
              valor={size}
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              onChange={(v) => update({ fontSize: v })}
              etiqueta={t.tamanoDe(nombre)}
            />
          }
        />
      )}
      {conResaltado && <FilaResaltado activo={appearance.resaltar !== false} onChange={() => update({ resaltar: appearance.resaltar === false })} />}
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
  const t = txTerminales()
  return (
    <Fila
      etiqueta={t.renderizado}
      ayuda={gpu.useWebgl ? t.porGpu : t.porSoftware}
      control={
        <span className="ajustes-dato" title={gpu.renderer || t.sinDatosGpu}>
          {gpu.useWebgl ? 'WebGL' : 'DOM'}
          {name ? ` · ${name}` : ''}
        </span>
      }
    />
  )
}
