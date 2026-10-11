// =============================================================================
// Categoría EXPERIMENTAL de Configuración: opciones de prueba que solo existen en las versiones
// alpha (el registro de salud y los volcados de caída). En la pública la categoría no se monta:
// el catálogo la poda al quedarse sin filas (`AJUSTES_SOLO_ALPHA`).
// Decisiones: docs/decisiones/app/registro-de-salud.md, docs/decisiones/app/volcados-de-caida.md
// =============================================================================

import { Fila, Grupo, Interruptor } from '../primitivas'
import type { PropsCategoria } from '../tipos'

export function Experimental({
  ve,
  registroSalud,
  onToggleRegistroSalud,
  volcadosCaida,
  onToggleVolcadosCaida
}: PropsCategoria): React.JSX.Element | null {
  if (!ve('registro-salud') && !ve('volcados-caida')) return null
  return (
    <Grupo titulo="Diagnóstico">
      {ve('registro-salud') && (
        <Fila
          etiqueta="Registro de salud"
          ayuda="Guarda cada 5 minutos, en un archivo de este equipo, cuánta memoria y cuántos procesos usa Tessera, para encontrar fugas con el uso real. No guarda nada de tus proyectos ni sale del equipo. Solo existe en las versiones alpha."
          control={<Interruptor activo={registroSalud} onChange={onToggleRegistroSalud} etiqueta="Guardar el registro de salud" />}
        />
      )}
      {ve('volcados-caida') && (
        <Fila
          etiqueta="Volcados de caída"
          ayuda="Si Tessera se cae, guarda en este equipo un volcado de la caída (los diez últimos) y lo anota en su registro de fallos al volver a abrirla, para encontrar la causa. Nunca sale del equipo, y puede contener datos que la app tenía en memoria. El cambio vale al reiniciar Tessera. Solo existe en las versiones alpha."
          control={<Interruptor activo={volcadosCaida} onChange={onToggleVolcadosCaida} etiqueta="Guardar volcados de caída" />}
        />
      )}
    </Grupo>
  )
}
