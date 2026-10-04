// =============================================================================
// DriversLista: los CLIENTES DE BASE DE DATOS (Instant Client de Oracle) dentro del
// diálogo de conexión. «Descargar» solo si el pack es descargable (si no, la nota con el
// porqué), «Seleccionar carpeta…» siempre y «instalado (tuyo)» para lo que registró el
// usuario. Presentacional: la lista, la instalación y el progreso los lleva el diálogo.
// Decisiones: docs/decisiones/bd/ui-conexion-clientes.md
// =============================================================================

import type { DriverProgress, DriverStatus } from '../../../../shared/db-ipc'
import { ayudaSinClientes } from './camposConexion'

/**
 * Texto del botón mientras se instala: el % de la descarga, la descompresión (zip) o la
 * instalación (el .dmg, que se monta, se copia y se verifica: no se descomprime nada).
 */
export function textoProgresoDriver(progreso: DriverProgress | null): string {
  if (progreso?.fase === 'descomprimiendo') return 'Descomprimiendo…'
  if (progreso?.fase === 'instalando') return 'Instalando…'
  return `Descargando… ${progreso?.porcentaje ?? 0}%`
}

/**
 * La nota que ocupa el hueco del botón de descarga cuando no lo hay: el porqué de ESTE
 * sistema si lo hay (`noDisponible`), y si no, el de siempre. Sin ella, un Mac con un
 * sistema demasiado antiguo leía «Oracle ya no lo publica», que es falso.
 */
export function notaSinDescarga(d: Pick<DriverStatus, 'noDisponible'> | null | undefined): string {
  return d?.noDisponible ?? 'Oracle ya no lo publica para descarga directa; hay que bajarlo a mano desde su web.'
}

export function DriversLista({
  drivers,
  instalando,
  progreso,
  resaltado,
  onInstalar,
  onUsarExistente
}: {
  drivers: readonly DriverStatus[]
  /** Pack que se está instalando: bloquea los botones de todos (una descarga a la vez). */
  instalando: string | null
  progreso: DriverProgress | null
  /** Pack que pidió la última prueba: se marca para que se encuentre de un vistazo. */
  resaltado?: string | null
  onInstalar: (packId: string) => void
  onUsarExistente: (packId: string) => void
}): React.JSX.Element {
  return (
    <div className="dbc-drivers">
      {drivers.length === 0 && <p className="dbc-ayuda">No hay clientes que instalar en este equipo.</p>}
      {drivers.map((d) => (
        <div key={d.id} className={`dbc-driver${resaltado === d.id ? ' resaltado' : ''}`}>
          <div className="dbc-driver-nombre">{d.nombre}</div>
          <div className="dbc-driver-cubre">{d.cubre}</div>
          {d.aviso && <div className="dbc-driver-soporte">{d.aviso}</div>}
          <div className="dbc-driver-estado">
            {d.instalado ? (
              <span className="ok">instalado{d.externo ? ' (tuyo)' : ''}</span>
            ) : (
              <>
                {d.descargable ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={instalando !== null}
                    onClick={() => onInstalar(d.id)}
                  >
                    {instalando === d.id ? textoProgresoDriver(progreso) : `Descargar (${d.sizeMB} MB)`}
                  </button>
                ) : (
                  <span className="dbc-driver-nota">{notaSinDescarga(d)}</span>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={instalando !== null}
                  title="Registrar un cliente que ya tengas descomprimido en este equipo"
                  onClick={() => onUsarExistente(d.id)}
                >
                  Seleccionar carpeta…
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      <p className="dbc-ayuda">Solo hacen falta para Oracle anterior a 12.1. {ayudaSinClientes()}</p>
    </div>
  )
}
