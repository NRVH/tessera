// =============================================================================
// El botón «Exportar a archivo» de MongoDB, de la pestaña de colección y de los resultados de la consola:
// un menú con JSON y CSV que lanza la exportación de su origen (la colección con su filtro, o la
// sentencia que dio el resultado) y, mientras escribe, se vuelve «Detener». El seguimiento, el progreso y
// el aviso final son los de la rejilla SQL (`useExportarBd`).
// Decisiones: docs/decisiones/bd/mongodb-explain-y-exportar.md
// =============================================================================

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { DbFormatoFilas, DbOrigenExportacion } from '../../../../../shared/db-explorador-ipc'
import type { DbMotor } from '../../../../../shared/db-ipc'
import { NOMBRE_FORMATO } from '../../../../../shared/formatosFilas'
import { ContextMenu } from '../../../comun/ContextMenu'
import { IconoDetener, IconoExportar } from '../iconosBd'
import { BotonBarraBd } from '../rejilla/DatosBotonBarra'
import { textoExportando } from '../rejilla/exportarBd'
import { IconoFormato } from '../rejilla/IconoFormato'
import { useExportarBd } from '../rejilla/useExportarBd'

/** Los orígenes de documentos de `DbOrigenExportacion`. */
export type OrigenExportacionDocs = Extract<DbOrigenExportacion, { tipo: 'coleccion' | 'sentencia' }>

const FORMATOS: readonly DbFormatoFilas[] = ['json', 'csv']

export function BotonExportarDocs({
  origen,
  motor,
  nombreSugerido,
  motivo,
  titulo
}: {
  origen: OrigenExportacionDocs
  motor: DbMotor
  /** Lo que propone el diálogo de guardar, sin extensión. */
  nombreSugerido: string
  /** Por qué no se puede exportar ahora; null = se puede. */
  motivo: string | null
  titulo: string
}): React.JSX.Element {
  const exportador = useExportarBd()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  if (exportador.enCurso) {
    return (
      <BotonBarraBd etiqueta="Detener la exportación" titulo={`${textoExportando(exportador.enCurso.filas)} · Pulsa para detenerla`} onClick={exportador.cancelar}>
        <IconoDetener />
      </BotonBarraBd>
    )
  }
  return (
    <>
      <BotonBarraBd
        etiqueta="Exportar a archivo"
        titulo={titulo}
        motivo={motivo}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom + 4 })
        }}
      >
        <IconoExportar />
      </BotonBarraBd>
      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={FORMATOS.map((formato) => ({
              label: `${NOMBRE_FORMATO[formato]}…`,
              icon: <IconoFormato formato={formato} />,
              onClick: () => void exportador.exportar({ origen, formato, nombreSugerido, motor })
            }))}
            onClose={() => setMenu(null)}
          />,
          document.body
        )}
    </>
  )
}
