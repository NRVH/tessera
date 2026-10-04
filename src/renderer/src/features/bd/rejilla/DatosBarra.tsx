// =============================================================================
// La barra de la pestaña de datos: identidad y metadatos a la izquierda (la marca del
// ENTORNO, filas y tiempo, lo pendiente) y SOLO iconos a la derecha, agrupados con
// filete (consulta · edición · filas · otras vistas). En una pestaña estrecha ceden
// primero las otras vistas y luego las filas; edición y consulta no ceden nunca.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql'
import { nombreCalificado } from '../../../../../shared/sql/identificadoresSql'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { etiquetaAcorde } from '../../../util/atajos'
import {
  IconoConsola,
  IconoContar,
  IconoDdl,
  IconoDefinicion,
  IconoDetener,
  IconoExportar,
  IconoRefrescar
} from '../iconosBd'
import { IconoAnadirFila, IconoBorrarFilas, IconoEnviar, IconoRevertir } from '../iconosEdicion'
import { MarcaEntorno } from '../MarcaEntorno'
import { MARCA_SIN_ESPERAR, metadatosDatos } from '../panesBd'
import { numCambios, textoCambios } from './cambiosRejilla'
import { formatoEntero } from './celdasRejilla'
import { abrirConsola, abrirMenuExportar, aplicarEscrito, copiarTodo } from './datosAcciones'
import { detener } from './datosLectura'
import { BotonBarraBd } from './DatosBotonBarra'
import type { VistaDatos } from './datosTipos'

/** El acorde de «Enviar» dentro de la rejilla. */
const ACORDE_ENVIAR = {
  pc: [{ mods: ['ctrl'], tecla: 'Enter' }],
  mac: [{ mods: ['meta'], tecla: 'Enter' }]
} as const
/** El de borrar filas: Supr, y ⌘⌫ en Mac (el gesto de los gestores de archivos). */
const ACORDE_BORRAR = {
  pc: [{ mods: [], tecla: 'Supr' }],
  mac: [{ mods: ['meta'], tecla: '⌫' }]
} as const
const TIPOS_CON_DEFINICION = new Set(['vista', 'vistaMaterializada'])

/** El objeto que se consultó de verdad (el destino de un sinónimo) y su base, si la hay. */
export function objetoReal(v: VistaDatos): { real: VistaDatos['props']['objeto']; conBase: { base?: string } } {
  const { objeto } = v.props
  const real = v.e.res?.objetoReal ?? objeto
  const base = real.base ?? objeto.base
  return { real, conBase: base !== undefined ? { base } : {} }
}

function textoMeta(v: VistaDatos): string {
  const { cargando, res, detenida } = v.e
  if (cargando) return 'Cargando…'
  if (res) return metadatosDatos(res.datos.filas.length, res.datos.hayMas, res.ms)
  return detenida ? 'Consulta detenida' : ''
}

/** «sinónimo de X» si lo consultado no es el objeto de la pestaña. */
function destinoSinonimo(v: VistaDatos): string | null {
  const { res } = v.e
  const { objeto, conexion } = v.props
  const esSinonimo =
    res !== null && (res.objetoReal.esquema !== objeto.esquema || res.objetoReal.nombre !== objeto.nombre)
  const { real } = objetoReal(v)
  return esSinonimo ? nombreCalificado(real.esquema, real.nombre, dialectoDeMotor(conexion.motor)) : null
}

function metaDatos(v: VistaDatos): React.JSX.Element {
  const { cargando, res, detenida, sinEsperar } = v.e
  const { editable, motivoNoEditable } = v.d
  const pendientes = numCambios(v.e.cambios)
  const destino = destinoSinonimo(v)
  const tituloMeta = [destino ? `Sinónimo de ${destino}` : null, motivoNoEditable ? `No editable: ${motivoNoEditable}` : null]
    .filter((x): x is string => x !== null)
    .join('\n')
  const quieta = !cargando && res
  return (
    <span className="db-barra-meta" title={tituloMeta || undefined}>
      {textoMeta(v)}
      {quieta && detenida && <span className="db-barra-aviso"> · detenida</span>}
      {quieta && sinEsperar && <span className="db-barra-aviso"> · {MARCA_SIN_ESPERAR}</span>}
      {destino && !cargando && ` · sinónimo de ${destino}`}
      {editable && pendientes > 0 && <span className="db-barra-pendientes"> · {textoCambios(pendientes)} sin enviar</span>}
      {!cargando && motivoNoEditable && <span className="db-barra-no-editable"> · No editable: {motivoNoEditable}</span>}
    </span>
  )
}

function motivoBorrar(edicionViva: boolean, filasSel: number): string | null {
  if (!edicionViva) return 'Cargando…'
  return filasSel === 0 ? 'Selecciona las filas que quieres borrar' : null
}

function botonesEdicion(v: VistaDatos): React.JSX.Element {
  const { edicionViva } = v.d
  const { filasSel } = v.e
  const pendientes = numCambios(v.e.cambios)
  const plataforma = window.tessera.plataforma
  const acordeBorrar = etiquetaAcorde(ACORDE_BORRAR, plataforma)
  const { accionesRef } = v.n
  return (
    <>
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBarraBd
        etiqueta="Añadir fila"
        titulo="Añadir una fila (se inserta al Enviar)"
        motivo={edicionViva ? null : 'Cargando…'}
        onClick={() => accionesRef.current?.anadirFila()}
      >
        <IconoAnadirFila />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Borrar filas"
        titulo={
          filasSel > 1
            ? `Borrar las ${formatoEntero(filasSel)} filas seleccionadas (${acordeBorrar})`
            : `Borrar la fila seleccionada (${acordeBorrar})`
        }
        motivo={motivoBorrar(edicionViva, filasSel)}
        onClick={() => accionesRef.current?.borrarSeleccion()}
      >
        <IconoBorrarFilas />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Revertir cambios"
        titulo={`Descartar ${textoCambios(pendientes)} sin enviar`}
        motivo={pendientes === 0 ? 'No hay cambios que revertir' : null}
        onClick={() => void v.a.pedirDescarte()}
      >
        <IconoRevertir />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Enviar cambios"
        titulo={`Enviar ${textoCambios(pendientes)} (${etiquetaAcorde(ACORDE_ENVIAR, plataforma)}): vista previa y, al aceptar, todo o nada`}
        motivo={pendientes === 0 ? 'No hay cambios que enviar' : null}
        onClick={v.a.abrirEnvio}
      >
        <span className="db-envio-icono">
          <IconoEnviar />
          {pendientes > 0 && (
            <span className="db-envio-cuenta" aria-hidden="true">
              {pendientes > 99 ? '99+' : pendientes}
            </span>
          )}
        </span>
      </BotonBarraBd>
    </>
  )
}

/** Contar corre en la sesión del LECTOR: mientras siga vivo se puede (también en el tope). */
function motivoContar(v: VistaDatos): string | null {
  const { contando, res, hayLector, sinLector } = v.e
  if (contando) return 'Ya se está contando'
  if (!res) return 'Todavía no hay datos'
  if (hayLector) return null
  return sinLector ? sinLector.motivo : 'Ya están todas las filas cargadas'
}

function motivoExportar(v: VistaDatos): string | null {
  if (v.exportador.enCurso !== null) return 'Ya hay una exportación en curso'
  return v.e.res ? null : 'Todavía no hay datos'
}

function grupoFilas(v: VistaDatos): React.JSX.Element {
  const cargadas = v.e.res?.datos.filas.length ?? 0
  return (
    <span className="db-barra-grupo grupo-filas">
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBarraBd
        etiqueta="Contar filas"
        titulo="Contar todas las filas en el servidor"
        motivo={motivoContar(v)}
        onClick={() => void v.a.contar()}
      >
        <IconoContar />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Copiar todo"
        titulo="Copiar lo cargado como TSV, con cabeceras"
        motivo={cargadas > 0 ? null : 'No hay filas cargadas'}
        onClick={() => copiarTodo(v)}
      >
        <IconoCopiar />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Exportar a archivo"
        titulo="Exportar la tabla entera, con el filtro aplicado, a un archivo"
        motivo={motivoExportar(v)}
        onClick={(e) => abrirMenuExportar(v.n, e)}
      >
        <IconoExportar />
      </BotonBarraBd>
    </span>
  )
}

/** «Ver definición» y «Ver DDL» siguen al objeto REAL (un sinónimo aún sin resolver, espera). */
function grupoVistas(v: VistaDatos): React.JSX.Element {
  const { conexion, objeto, onAbrir } = v.props
  const { real, conBase } = objetoReal(v)
  const destino = { kind: 'fuente' as const, conexionId: conexion.id, esquema: real.esquema, objeto: real.nombre, tipo: real.tipo }
  const motivoDdl = objeto.tipo === 'sinonimo' && !v.e.res ? 'Resolviendo el sinónimo…' : null
  return (
    <span className="db-barra-grupo grupo-vistas">
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBarraBd etiqueta="Abrir consola" titulo="Abrir una consola con el SELECT de esta tabla" onClick={() => abrirConsola(v)}>
        <IconoConsola />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta="Ver DDL"
        titulo="Ver el DDL (el CREATE) del objeto"
        motivo={motivoDdl}
        onClick={() => onAbrir({ ...destino, modo: 'ddl', ...conBase })}
      >
        <IconoDdl />
      </BotonBarraBd>
      {TIPOS_CON_DEFINICION.has(real.tipo) && (
        <BotonBarraBd
          etiqueta="Ver definición"
          titulo="Ver la definición de la vista"
          onClick={() => onAbrir({ ...destino, ...conBase })}
        >
          <IconoDefinicion />
        </BotonBarraBd>
      )}
    </span>
  )
}

/** La barra entera de la pestaña. */
export function barraDatos(v: VistaDatos): React.JSX.Element {
  const { cargando, cargandoMas, contando, trayendo } = v.e
  const enCurso = cargando || cargandoMas || contando || trayendo
  return (
    <header className="panel-header db-barra">
      <MarcaEntorno entorno={v.props.conexion.entorno} />
      {metaDatos(v)}
      <div className="panel-actions">
        <BotonBarraBd etiqueta="Refrescar" titulo="Refrescar (con el filtro escrito)" onClick={() => aplicarEscrito(v)}>
          <IconoRefrescar />
        </BotonBarraBd>
        <BotonBarraBd
          etiqueta="Detener"
          titulo="Detener la consulta en curso"
          motivo={enCurso ? null : 'No hay ninguna consulta en curso'}
          onClick={() => detener(v.n)}
        >
          <IconoDetener />
        </BotonBarraBd>
        {v.d.editable && botonesEdicion(v)}
        {grupoFilas(v)}
        {grupoVistas(v)}
      </div>
    </header>
  )
}
