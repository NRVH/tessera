// =============================================================================
// Categoría AGENTES: la lista de agentes del perfil activo (ordenar, mostrar u ocultar, editar,
// borrar y añadir; la pinta `GestionAgentes` de la feature de agentes) y el selector de la
// cabecera del agente, pestañas o lista, que vale para toda la aplicación.
// =============================================================================

import { useStoreAgentes, fijarSelectorAgentes, GestionAgentes, textosSelectorAgentes } from '../../agentes'
import { normalizarSelectorAgentes } from '../../../../../shared/agentesManuales'
import { Fila, Grupo, Selector } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { txCatalogo } from '../textosCatalogo.ts'

export function Agentes({ ve }: PropsCategoria): React.JSX.Element {
  const selector = useStoreAgentes((s) => s.selectorAgentes)
  const t = textosSelectorAgentes()
  const grupos = txCatalogo().grupos
  return (
    <>
      {ve('agentes-lista') && (
        <Grupo titulo={grupos['Agentes del perfil']}>
          <GestionAgentes />
        </Grupo>
      )}
      {ve('selector-agentes') && (
        <Grupo titulo={grupos['Cabecera del agente']}>
          <Fila
            etiqueta={t.selector}
            ayuda={t.selectorAyuda}
            control={
              <Selector
                valor={selector}
                etiqueta={t.selector}
                opciones={[
                  { value: 'pestanas', label: t.pestanas },
                  { value: 'lista', label: t.lista }
                ]}
                onChange={(v) => fijarSelectorAgentes(normalizarSelectorAgentes(v))}
              />
            }
          />
        </Grupo>
      )}
    </>
  )
}
