// =============================================================================
// Categoría TERMINALES: la de shell y la del agente, con apariencias INDEPENDIENTES
// (no se usan igual: en la del agente se lee conversación larga, en la de shell salida
// de comandos que tiene que caber). `GrupoTerminal` se instancia dos veces aquí, con estado
// distinto, y una tercera en Apariencia para el editor de código. Las claves conservan el nombre `terminal*` para el shell: renombrarlas
// resetearía el ajuste guardado. El fondo no es configurable (ver theme/aparienciaTerminal).
// «Renderizado» va aparte y al final: es un dato de xterm en general, no de una terminal.
// =============================================================================

import {
  TAMANO_LETRA_TERMINAL_MAX,
  TAMANO_LETRA_TERMINAL_MIN
} from '../../../../../shared/workspace-state-ipc'
import {
  TAMANO_LETRA_TERMINAL_POR_DEFECTO,
  OPCIONES_LETRA_TERMINAL,
  type AparienciaTerminal
} from '../../../theme/aparienciaTerminal'
import { detectarRendererGpu, nombreGpuLegible } from '../../../util/rendererGpu'
import { Fila, Grupo, Interruptor, Selector, Stepper } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { txTerminales } from '../textos.ts'

export function Terminales({
  ve,
  aparienciaTerminal,
  onCambiarAparienciaTerminal,
  aparienciaAgente,
  onCambiarAparienciaAgente
}: PropsCategoria): React.JSX.Element {
  const t = txTerminales()
  return (
    <>
      <GrupoTerminal
        titulo={t.grupoTerminal}
        idFuente="term-fuente"
        idTamano="term-tamano"
        nombre={t.nombreTerminal}
        apariencia={aparienciaTerminal}
        onCambio={onCambiarAparienciaTerminal}
        ve={ve}
        idResaltado="term-resaltado"
      />
      <GrupoTerminal
        titulo={t.grupoAgente}
        ayuda={t.ayudaAgente}
        idFuente="agente-fuente"
        idTamano="agente-tamano"
        nombre={t.nombreAgente}
        apariencia={aparienciaAgente}
        onCambio={onCambiarAparienciaAgente}
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
function FilaResaltado({ activo, onCambio }: { activo: boolean; onCambio: () => void }): React.JSX.Element {
  const t = txTerminales()
  return (
    <Fila
      etiqueta={t.resaltar}
      ayuda={t.resaltarAyuda}
      control={<Interruptor activo={activo} onCambio={onCambio} etiqueta={t.resaltar} />}
    />
  )
}

/**
 * Fuente + tamaño de UNA superficie de letra monoespaciada y, en la terminal de shell, el resaltado. Lo usan
 * las dos terminales y el editor de código (`Apariencia`), con el mismo catálogo de fuentes.
 */
export function GrupoTerminal({
  titulo,
  ayuda,
  idFuente,
  idTamano,
  idResaltado,
  nombre,
  apariencia,
  onCambio,
  ve,
  antes
}: {
  titulo: string
  ayuda?: string
  /** Filas propias de la superficie antes de fuente y tamaño (el tema del editor de código). */
  antes?: React.ReactNode
  idFuente: string
  idTamano: string
  /** Solo la de shell: la del agente pinta su propia interfaz. */
  idResaltado?: string
  /** Para los aria-label: "Reducir el tamaño de la terminal del agente". */
  nombre: string
  apariencia: AparienciaTerminal
  onCambio: (a: AparienciaTerminal) => void
  ve: (id: string) => boolean
}): React.JSX.Element | null {
  const conResaltado = idResaltado !== undefined && ve(idResaltado)
  if (!antes && !ve(idFuente) && !ve(idTamano) && !conResaltado) return null
  const actualizar = (parcial: Partial<AparienciaTerminal>): void => onCambio({ ...apariencia, ...parcial })
  const tamano = apariencia.tamanoLetra || TAMANO_LETRA_TERMINAL_POR_DEFECTO
  const t = txTerminales()
  const opciones = OPCIONES_LETRA_TERMINAL.map((o) => (o.value === '' ? { ...o, label: t.predeterminada } : o))
  return (
    <Grupo titulo={titulo} ayuda={ayuda}>
      {antes}
      {ve(idFuente) && (
        <Fila
          etiqueta={t.fuente}
          control={
            <Selector
              valor={apariencia.familiaLetra}
              opciones={opciones}
              onCambio={(familiaLetra) => actualizar({ familiaLetra })}
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
              valor={tamano}
              min={TAMANO_LETRA_TERMINAL_MIN}
              max={TAMANO_LETRA_TERMINAL_MAX}
              onCambio={(v) => actualizar({ tamanoLetra: v })}
              etiqueta={t.tamanoDe(nombre)}
            />
          }
        />
      )}
      {conResaltado && <FilaResaltado activo={apariencia.resaltar !== false} onCambio={() => actualizar({ resaltar: apariencia.resaltar === false })} />}
    </Grupo>
  )
}

/**
 * Renderizado de xterm: INFORMATIVO, no un ajuste. Se pinta como fila para que
 * no vuelva a ser un texto suelto flotando entre ajustes.
 */
function FilaRenderizado(): React.JSX.Element {
  const gpu = detectarRendererGpu()
  const nombre = nombreGpuLegible(gpu.renderer)
  const t = txTerminales()
  return (
    <Fila
      etiqueta={t.renderizado}
      ayuda={gpu.useWebgl ? t.porGpu : t.porSoftware}
      control={
        <span className="ajustes-dato" title={gpu.renderer || t.sinDatosGpu}>
          {gpu.useWebgl ? 'WebGL' : 'DOM'}
          {nombre ? ` · ${nombre}` : ''}
        </span>
      }
    />
  )
}
