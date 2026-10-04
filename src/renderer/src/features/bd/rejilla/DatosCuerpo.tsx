// =============================================================================
// El cuerpo de la pestaña de datos: el aviso de un error que no es de un campo (con
// «Reintentar» / «Leer sin esperar» ante un bloqueo), la consulta detenida o la rejilla;
// y, por PORTAL (la carcasa puede cerrar una pestaña oculta), el menú de exportar, el
// diálogo de «Enviar» y la pregunta «Descartar N cambios».
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import { createPortal } from 'react-dom'
import { NOMBRE_FORMATO } from '../../../../../shared/formatosFilas'
import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql'
import { nombreCalificado } from '../../../../../shared/sql/identificadoresSql'
import { AvisoCaja } from '../../../comun/AvisoCaja'
import { ConfirmDialog } from '../../../comun/ConfirmDialog'
import { ContextMenu, type ContextMenuEntry } from '../../../comun/ContextMenu'
import { DbRejilla, type DbRejillaEdicionProps } from '../DbRejilla'
import { DialogoEnvio } from '../DialogoEnvio'
import { accionesDeError, describirError, ETIQUETA_ACCION_ERROR, sinOrdenEstable } from '../panesBd'
import { formatoEntero } from './celdasRejilla'
import { exportar, ordenar, volverAEjecutar } from './datosAcciones'
import { ejecutarEnvio, detenerEnvio, responderDescarte } from './datosEnvio'
import { detenerTraerTodas } from './datosLectura'
import { objetoReal } from './DatosBarra'
import { FORMATOS_EXPORTAR } from './exportarBd'
import { RAZON_SIN_CLAVE_PRIMARIA } from './visorValor'
import type { VistaDatos } from './datosTipos'

/** «Esquema.tabla» de la pestaña, en el dialecto de su motor. */
export function nombreTabla(v: VistaDatos): string {
  const { objeto, conexion } = v.props
  return nombreCalificado(objeto.esquema, objeto.nombre, dialectoDeMotor(conexion.motor))
}

function avisoError(v: VistaDatos): React.JSX.Element | null {
  const { error } = v.e
  const descripcion = error ? describirError(error, 'leer la tabla') : null
  if (!descripcion) return null
  return (
    <div className="db-datos-aviso">
      <AvisoCaja
        tono={descripcion.tono}
        titulo={descripcion.titulo}
        sugerencia={descripcion.sugerencia}
        detalle={descripcion.detalle}
      />
      {/* Un bloqueo se resuelve desde aquí: esperar otra vez o leer ya. */}
      {accionesDeError(error).length > 0 && (
        <div className="db-datos-aviso-acciones">
          {accionesDeError(error).map((a) => (
            <button
              key={a}
              type="button"
              className={a === 'reintentar' ? 'btn primary' : 'btn'}
              onClick={() => {
                const i = v.n.intentoRef.current
                void v.a.consultar(i.filtro, { maxFilas: i.maxFilas, sinEsperar: a === 'sinEsperar' })
              }}
            >
              {ETIQUETA_ACCION_ERROR[a]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Lo que la rejilla recibe del resultado y del lector. */
function lecturaRejilla(v: VistaDatos): Pick<
  DbRejillaEdicionProps,
  'datos' | 'total' | 'onContar' | 'orden' | 'clavePrimaria' | 'sinOrdenEstable' | 'sinLector' | 'onVolverAEjecutar'
> {
  const { res, sinLector, hayLector, aplicado } = v.e
  return {
    datos: res?.datos ?? null,
    total: res?.total ?? null,
    onContar: hayLector ? () => void v.a.contar() : undefined,
    orden: res ? v.d.ordenRejilla : null,
    clavePrimaria: res?.clavePrimaria,
    sinOrdenEstable: res !== null && sinOrdenEstable(v.props.conexion.motor, aplicado.orden, res.clavePrimaria),
    sinLector: sinLector?.motivo ?? null,
    onVolverAEjecutar: sinLector?.reejecutable ? () => volverAEjecutar(v) : undefined
  }
}

function rejillaDatos(v: VistaDatos): React.JSX.Element {
  const { props, e, d, a, exportador } = v
  const { res } = e
  const { conexion } = props
  const { real } = objetoReal(v)
  const conClave = (res?.clavePrimaria.length ?? 0) > 0
  return (
    <DbRejilla
      columnas={d.columnasVisibles}
      {...lecturaRejilla(v)}
      cargandoMas={e.cargandoMas}
      onCargarMas={() => void a.cargarMas()}
      contando={e.contando}
      onOrdenar={(columna, multiple) => ordenar(v, columna, multiple)}
      altoFila={props.altoFila}
      visible={props.visible}
      etiquetaAria={`Filas de ${nombreTabla(v)}`}
      motor={conexion.motor}
      tablaInsert={nombreCalificado(real.esquema, real.nombre, dialectoDeMotor(conexion.motor))}
      onTraerTodas={() => void a.traerTodas()}
      trayendoTodas={e.trayendo}
      onDetenerTraerTodas={() => detenerTraerTodas(v.n)}
      onExportar={(formato) => exportar(v, formato)}
      exportando={exportador.enCurso ? { filas: exportador.enCurso.filas } : null}
      onCancelarExportacion={exportador.cancelar}
      onValorCompleto={conClave ? a.valorCompleto : undefined}
      razonSinValorCompleto={res && !conClave ? RAZON_SIN_CLAVE_PRIMARIA : undefined}
      edicion={d.edicion}
      acciones={v.n.accionesRef}
      conservarPosicionDe={e.conservarPara}
    />
  )
}

/** El aviso de error, la consulta detenida o la rejilla. */
export function contenidoDatos(v: VistaDatos): React.JSX.Element {
  const aviso = avisoError(v)
  if (aviso) return aviso
  if (!v.e.res && v.e.detenida) {
    return <AvisoCaja tono="info" titulo="Consulta detenida" sugerencia="Pulsa Refrescar para volver a pedirla." />
  }
  return rejillaDatos(v)
}

export function menuExportarDatos(v: VistaDatos): React.ReactPortal | null {
  const { menuExportar } = v.e
  if (!menuExportar) return null
  const items: ContextMenuEntry[] = FORMATOS_EXPORTAR.map((f) => ({
    label: `${NOMBRE_FORMATO[f]}…`,
    onClick: () => exportar(v, f)
  }))
  return createPortal(
    <ContextMenu x={menuExportar.x} y={menuExportar.y} items={items} onClose={v.a.cerrarMenuExportar} />,
    document.body
  )
}

export function dialogoEnvioDatos(v: VistaDatos): React.ReactPortal | null {
  const { envio } = v.e
  if (!envio) return null
  const { conexion } = v.props
  return createPortal(
    <DialogoEnvio
      alias={conexion.alias}
      entorno={conexion.entorno}
      tabla={nombreCalificado(envio.objeto.esquema, envio.objeto.nombre, dialectoDeMotor(conexion.motor))}
      resumen={envio.resumen}
      lineas={envio.lineas}
      estado={envio.estado}
      onEnviar={() => void ejecutarEnvio(v.n)}
      onDetener={() => detenerEnvio(v.n)}
      onCerrar={v.a.cerrarEnvio}
    />,
    document.body
  )
}

export function descarteDatos(v: VistaDatos): React.ReactPortal | null {
  const { descarte } = v.e
  if (!descarte) return null
  return createPortal(
    <ConfirmDialog
      title={descarte.n === 1 ? 'Descartar 1 cambio' : `Descartar ${formatoEntero(descarte.n)} cambios`}
      message={`Los cambios sin enviar de ${nombreTabla(v)} se perderán.`}
      confirmLabel="Descartar"
      danger
      onConfirm={() => responderDescarte(v.n, true)}
      onCancel={() => responderDescarte(v.n, false)}
    />,
    document.body
  )
}
