// =============================================================================
// Categoría EXPERIMENTAL de Configuración: opciones de prueba que solo existen en las versiones
// alpha (el registro de salud y los volcados de caída). En la pública la categoría no se monta:
// el catálogo la poda al quedarse sin filas (`AJUSTES_SOLO_ALPHA`).
// Decisiones: docs/decisiones/app/registro-de-salud.md, docs/decisiones/app/volcados-de-caida.md
// =============================================================================

import { Fila, Grupo, Interruptor } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { txCategorias } from '../textosSistema.ts'

export function Experimental({
  ve,
  registroSalud,
  onAlternarRegistroSalud,
  volcadosCaida,
  onAlternarVolcadosCaida
}: PropsCategoria): React.JSX.Element | null {
  if (!ve('registro-salud') && !ve('volcados-caida')) return null
  const t = txCategorias().experimental
  return (
    <Grupo titulo={t.grupo}>
      {ve('registro-salud') && (
        <Fila
          etiqueta={t.salud}
          ayuda={t.saludAyuda}
          control={<Interruptor activo={registroSalud} onCambio={onAlternarRegistroSalud} etiqueta={t.saludEtiqueta} />}
        />
      )}
      {ve('volcados-caida') && (
        <Fila
          etiqueta={t.volcados}
          ayuda={t.volcadosAyuda}
          control={<Interruptor activo={volcadosCaida} onCambio={onAlternarVolcadosCaida} etiqueta={t.volcadosEtiqueta} />}
        />
      )}
    </Grupo>
  )
}
