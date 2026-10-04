// =============================================================================
// La pestaña de DATOS de una tabla, vista, vista materializada, tabla foránea o
// sinónimo: barra, filtro (guiado o WHERE libre) y la rejilla. Es la DUEÑA de los datos
// (lectura por páginas, contar, exportar, traer todas) y de lo PENDIENTE de la edición
// con su «Enviar». Las piezas viven en `rejilla/datos*` y `rejilla/Datos*`.
// El orden de los imports fija la cascada: `rejilla.css` entra antes que `DatosFiltro` (filtro.css).
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import type { DbDatosPaneProps } from './propsBd'
import { useExportarBd } from './rejilla/useExportarBd'
import { useEstadoDatos } from './rejilla/useDatosEstado'
import {
  useAccionesDatos,
  useCicloDatos,
  useDerivadosDatos,
  useIndicadoresDatos,
  usePresupuestoDatos
} from './rejilla/useDatosEfectos'
import { barraDatos } from './rejilla/DatosBarra'
import './rejilla.css'
import './filtro/filtro.css'
import { filtroDatos } from './rejilla/DatosFiltro'
import {
  contenidoDatos,
  descarteDatos,
  dialogoEnvioDatos,
  menuExportarDatos,
  nombreTabla
} from './rejilla/DatosCuerpo'
import type { VistaDatos } from './rejilla/datosTipos'

/** La pestaña de datos de un objeto de la base, con su edición y su «Enviar». */
export function DbDatosPane(props: DbDatosPaneProps): React.JSX.Element {
  // El orden de estos hooks es el de sus efectos: no se reordena.
  const { estado: e, n } = useEstadoDatos(props)
  const exportador = useExportarBd()
  const a = useAccionesDatos(n)
  usePresupuestoDatos(n, a, e, props)
  useCicloDatos(n, a, props)
  useIndicadoresDatos(n, e, exportador.enCurso !== null)
  const d = useDerivadosDatos(n, a, e)
  const v: VistaDatos = { n, a, props, e, d, exportador }

  return (
    <section className={`db-datos${props.visible ? '' : ' hidden'}`} aria-label={`Datos de ${nombreTabla(v)}`}>
      {barraDatos(v)}

      <div className="db-datos-cuerpo">
        {filtroDatos(v)}

        {contenidoDatos(v)}
      </div>
      {menuExportarDatos(v)}
      {dialogoEnvioDatos(v)}
      {descarteDatos(v)}
    </section>
  )
}
