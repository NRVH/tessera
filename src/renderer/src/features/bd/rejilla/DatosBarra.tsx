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
import { marcaSinEsperar, metadatosDatos } from '../panesBd'
import { numCambios, textoCambios } from './cambiosRejilla'
import { formatoEntero } from './celdasRejilla'
import { abrirConsola, abrirMenuExportar, aplicarEscrito, copiarTodo } from './datosAcciones'
import { detener } from './datosLectura'
import { BotonBarraBd } from './DatosBotonBarra'
import type { VistaDatos } from './datosTipos'
import { txRejilla } from './textosRejilla.ts'

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
  if (cargando) return txRejilla().cargando
  if (res) return metadatosDatos(res.datos.filas.length, res.datos.hayMas, res.ms)
  return detenida ? txRejilla().consultaDetenida : ''
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
  const t = txRejilla()
  const tituloMeta = [destino ? t.sinonimoDe(destino) : null, motivoNoEditable ? t.noEditable(motivoNoEditable) : null]
    .filter((x): x is string => x !== null)
    .join('\n')
  const quieta = !cargando && res
  return (
    <span className="db-barra-meta" title={tituloMeta || undefined}>
      {textoMeta(v)}
      {quieta && detenida && <span className="db-barra-aviso"> · {t.detenida}</span>}
      {quieta && sinEsperar && <span className="db-barra-aviso"> · {marcaSinEsperar()}</span>}
      {destino && !cargando && ` · ${t.sinonimoDeMin(destino)}`}
      {editable && pendientes > 0 && (
        <span className="db-barra-pendientes"> · {t.cambiosSinEnviar(textoCambios(pendientes))}</span>
      )}
      {!cargando && motivoNoEditable && (
        <span className="db-barra-no-editable"> · {t.noEditable(motivoNoEditable)}</span>
      )}
    </span>
  )
}

function motivoBorrar(edicionViva: boolean, filasSel: number): string | null {
  if (!edicionViva) return txRejilla().cargando
  return filasSel === 0 ? txRejilla().seleccionaFilasBorrar : null
}

function botonesEdicion(v: VistaDatos): React.JSX.Element {
  const { edicionViva } = v.d
  const { filasSel } = v.e
  const pendientes = numCambios(v.e.cambios)
  const plataforma = window.tessera.plataforma
  const acordeBorrar = etiquetaAcorde(ACORDE_BORRAR, plataforma)
  const { accionesRef } = v.n
  const t = txRejilla()
  return (
    <>
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBarraBd
        etiqueta={t.anadirFila}
        titulo={t.anadirFilaTitulo}
        motivo={edicionViva ? null : t.cargando}
        onClick={() => accionesRef.current?.anadirFila()}
      >
        <IconoAnadirFila />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.borrarFilas}
        titulo={filasSel > 1 ? t.borrarNFilas(formatoEntero(filasSel), acordeBorrar) : t.borrarUnaFila(acordeBorrar)}
        motivo={motivoBorrar(edicionViva, filasSel)}
        onClick={() => accionesRef.current?.borrarSeleccion()}
      >
        <IconoBorrarFilas />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.revertirCambios}
        titulo={t.descartarSinEnviar(textoCambios(pendientes))}
        motivo={pendientes === 0 ? t.nadaQueRevertir : null}
        onClick={() => void v.a.pedirDescarte()}
      >
        <IconoRevertir />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.enviarCambios}
        titulo={t.enviarTitulo(textoCambios(pendientes), etiquetaAcorde(ACORDE_ENVIAR, plataforma))}
        motivo={pendientes === 0 ? t.nadaQueEnviar : null}
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
  const t = txRejilla()
  if (contando) return t.yaContando
  if (!res) return t.sinDatos
  if (hayLector) return null
  return sinLector ? sinLector.motivo : t.todasCargadas
}

function motivoExportar(v: VistaDatos): string | null {
  const t = txRejilla()
  if (v.exportador.enCurso !== null) return t.exportacionEnCurso
  return v.e.res ? null : t.sinDatos
}

function grupoFilas(v: VistaDatos): React.JSX.Element {
  const cargadas = v.e.res?.datos.filas.length ?? 0
  const t = txRejilla()
  return (
    <span className="db-barra-grupo grupo-filas">
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBarraBd
        etiqueta={t.contarFilas}
        titulo={t.contarTitulo}
        motivo={motivoContar(v)}
        onClick={() => void v.a.contar()}
      >
        <IconoContar />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.copiarTodo}
        titulo={t.copiarTodoTitulo}
        motivo={cargadas > 0 ? null : t.sinFilasCargadas}
        onClick={() => copiarTodo(v)}
      >
        <IconoCopiar />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.exportarArchivo}
        titulo={t.exportarTitulo}
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
  const t = txRejilla()
  const motivoDdl = objeto.tipo === 'sinonimo' && !v.e.res ? t.resolviendoSinonimo : null
  return (
    <span className="db-barra-grupo grupo-vistas">
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBarraBd etiqueta={t.abrirConsola} titulo={t.abrirConsolaTitulo} onClick={() => abrirConsola(v)}>
        <IconoConsola />
      </BotonBarraBd>
      <BotonBarraBd
        etiqueta={t.verDdl}
        titulo={t.verDdlTitulo}
        motivo={motivoDdl}
        onClick={() => onAbrir({ ...destino, modo: 'ddl', ...conBase })}
      >
        <IconoDdl />
      </BotonBarraBd>
      {TIPOS_CON_DEFINICION.has(real.tipo) && (
        <BotonBarraBd
          etiqueta={t.verDefinicion}
          titulo={t.verDefinicionTitulo}
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
  const t = txRejilla()
  return (
    <header className="panel-header db-barra">
      <MarcaEntorno entorno={v.props.conexion.entorno} />
      {metaDatos(v)}
      <div className="panel-actions">
        <BotonBarraBd etiqueta={t.refrescar} titulo={t.refrescarTitulo} onClick={() => aplicarEscrito(v)}>
          <IconoRefrescar />
        </BotonBarraBd>
        <BotonBarraBd
          etiqueta={t.detener}
          titulo={t.detenerTitulo}
          motivo={enCurso ? null : t.nadaEnCurso}
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
