// =============================================================================
// Acciones de la barra y del filtro de la pestaña de datos: aplicar lo escrito,
// cambiar de barra, ordenar por la cabecera, Esc, copiar todo, exportar con el filtro
// APLICADO y el valor completo del visor por la clave primaria. Consultar otra vez
// pregunta antes «Descartar N cambios» (`conDescarte`).
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import { MAX_COLUMNAS_ORDEN } from '../../../../../shared/filtroGuiado'
import type { DbFormatoFilas, DbRespuesta, DbValor } from '../../../../../shared/db-explorador-ipc'
import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql'
import { nombreCalificado } from '../../../../../shared/sql/identificadoresSql'
import { notify, notifyError } from '../../../comun/notifications'
import { camposDeFiltroTabla, ciclarOrden, problemaDelGuiado } from '../filtro/modeloFiltro'
import { consultaParaConsola, errorDeInvoke } from '../panesBd'
import { numCambios } from './cambiosRejilla'
import { formatoEntero } from './celdasRejilla'
import { copiarComo } from './copiarComo'
import { conDescarte } from './datosEnvio'
import { claveDeFila } from './visorValor'
import type { Filtro, NucleoDatos, VistaDatos } from './datosTipos'

/**
 * Aplica lo escrito en el modo VISIBLE, con el orden aplicado. En el guiado, lo que no
 * vale se señala en su fila sin mandar nada (el main es la segunda barrera).
 */
export function aplicarEscrito(v: VistaDatos): void {
  const { modo, guiadoTxt, whereTxt } = v.e
  const filtro: Filtro = { modo, guiado: guiadoTxt, where: whereTxt, orden: v.n.aplicadoRef.current.orden }
  if (modo === 'guiado') {
    const problema = problemaDelGuiado(guiadoTxt)
    v.n.setErrorGuiado(problema)
    if (problema) return
  } else {
    v.n.setErrorGuiado(null)
  }
  conDescarte(v.n, () => void v.a.consultar(filtro))
}

/** Cambia de barra (guiado ↔ SQL) sin consultar; el foco sigue al usuario a la nueva. */
export function cambiarModo(n: NucleoDatos, m: Filtro['modo']): void {
  n.setModo(m)
  n.setErrorGuiado(null)
  requestAnimationFrame(() => {
    if (m === 'sql') n.whereRef.current?.focus()
    else n.guiadoRef.current?.querySelector<HTMLElement>('select, input, button:not(:disabled)')?.focus()
  })
}

export function volverAEjecutar(v: VistaDatos): void {
  conDescarte(v.n, () => void v.a.consultar(v.n.aplicadoRef.current))
}

/** Clic en la cabecera: `ciclarOrden` por NOMBRE y a consultar con el filtro APLICADO. */
export function ordenar(v: VistaDatos, columna: number, multiple: boolean): void {
  const col = v.d.columnasVisibles[columna]
  if (!col) return
  const nuevo = ciclarOrden(v.n.aplicadoRef.current.orden, col.nombre, multiple)
  if (nuevo.length > MAX_COLUMNAS_ORDEN) {
    notify('warn', `Se ordena por hasta ${MAX_COLUMNAS_ORDEN} columnas`)
    return
  }
  conDescarte(v.n, () => void v.a.consultar({ ...v.n.aplicadoRef.current, orden: nuevo }))
}

/** Esc en la barra guiada: vuelve a lo último aplicado que funcionó. */
export function restaurarGuiado(v: VistaDatos): void {
  v.n.setGuiadoTxt(v.n.aplicadoRef.current.guiado)
  v.n.setErrorGuiado(null)
  const campo = v.e.errorCampo?.campo
  if (campo === 'filtro' || campo === 'orderBy') v.n.setErrorCampo(null)
}

/** Intro aplica; Esc devuelve el WHERE a lo último que funcionó (sin nada que deshacer, sigue). */
export function teclaWhere(v: VistaDatos, e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.nativeEvent.isComposing) return
  if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    aplicarEscrito(v)
    return
  }
  if (e.key !== 'Escape') return
  const restaurado = v.e.aplicado.where
  const conError = v.e.errorCampo?.campo === 'where' || v.e.errorCampo?.campo === 'orderBy'
  if (v.e.whereTxt === restaurado && !conError) return
  e.preventDefault()
  v.n.setWhereTxt(restaurado)
  if (conError) v.n.setErrorCampo(null)
}

function notasCopiarTodo(hayMas: boolean, conCambios: boolean, incompletas: number): string[] {
  const notas: string[] = []
  if (hayMas) notas.push('Solo las cargadas: el servidor tiene más.')
  if (conCambios) notas.push('Lo leído del servidor: sin los cambios pendientes.')
  if (incompletas > 0) {
    notas.push(
      `${formatoEntero(incompletas)} ${
        incompletas === 1 ? 'celda llegó recortada' : 'celdas llegaron recortadas'
      }: lo copiado no es el valor entero.`
    )
  }
  return notas
}

/** Copia lo cargado (lo leído del servidor, sin lo pendiente) como TSV con cabeceras. */
export function copiarTodo(v: VistaDatos): void {
  const base = v.n.resRef.current
  const columnas = v.d.columnasVisibles
  if (!base || base.datos.filas.length === 0 || columnas.length === 0) return
  const n = base.datos.filas.length
  const copia = copiarComo('tsvCabecera', {
    columnas,
    filas: base.datos.filas,
    rango: { f0: 0, f1: n - 1, c0: 0, c1: columnas.length - 1 },
    recortes: base.datos.recortes
  })
  const cambiosRef = v.n.cambiosRef
  window.tessera.clipboard
    .write(copia.texto)
    .then(() => {
      const notas = notasCopiarTodo(base.datos.hayMas, numCambios(cambiosRef.current) > 0, copia.incompletas)
      notify(
        copia.incompletas > 0 ? 'warn' : 'success',
        `${formatoEntero(n)} ${n === 1 ? 'fila copiada' : 'filas copiadas'}`,
        notas.length > 0 ? notas.join(' ') : undefined
      )
    })
    .catch((err: unknown) => notifyError('No se pudo copiar', err))
}

export function abrirConsola(v: VistaDatos): void {
  const { conexion, objeto, onAbrirConsola } = v.props
  onAbrirConsola(conexion.id, consultaParaConsola(objeto, conexion.motor))
}

/** Exporta la tabla ENTERA con el filtro APLICADO; los INSERT van a la tabla REAL calificada. */
export function exportar(v: VistaDatos, formato: DbFormatoFilas): void {
  const { conexion: con, objeto: obj } = v.n.propsRef.current
  const destino = v.n.resRef.current?.objetoReal ?? obj
  void v.exportador.exportar({
    origen: {
      tipo: 'tabla',
      conexionId: con.id,
      objeto: obj,
      // Los mismos campos que `abrirTabla`, de la MISMA función.
      ...camposDeFiltroTabla(v.e.aplicado)
    },
    formato,
    nombreSugerido: `${obj.esquema}.${obj.nombre}`,
    tablaInsert: nombreCalificado(destino.esquema, destino.nombre, dialectoDeMotor(con.motor)),
    motor: con.motor
  })
}

/** El menú de formatos, anclado bajo el botón que lo abre. */
export function abrirMenuExportar(n: NucleoDatos, e: React.MouseEvent<HTMLButtonElement>): void {
  const boton = e.currentTarget
  n.botonExportarRef.current = boton
  const r = boton.getBoundingClientRect()
  n.setMenuExportar({ x: r.left, y: r.bottom + 4 })
}

/** Cierra el menú; el foco vuelve al botón que lo abrió (tras elegir lo toma el diálogo nativo; tras Esc, el teclado sigue ahí). */
export function cerrarMenuExportar(n: NucleoDatos): void {
  n.setMenuExportar(null)
  const b = n.botonExportarRef.current
  if (b && document.contains(b)) b.focus({ preventScroll: true })
}

/** El valor completo de una celda recortada, por la CLAVE PRIMARIA de su fila y del objeto real. */
export async function valorCompleto(n: NucleoDatos, f: number, c: number): Promise<DbRespuesta<DbValor>> {
  const base = n.resRef.current
  const con = n.propsRef.current.conexion
  if (!base || !base.columnas[c]) {
    return { ok: false, error: { motivo: 'interno', mensaje: 'Los datos ya no están cargados.' } }
  }
  const recortesFila = base.datos.recortes.get(f)
  const clave = claveDeFila(
    base.columnas.map((col) => col.nombre),
    base.clavePrimaria,
    base.datos.filas[f],
    (col) => recortesFila?.has(col) === true
  )
  if (!clave.ok) return { ok: false, error: { motivo: 'interno', mensaje: clave.error } }
  try {
    return await window.tessera.dbExplorador.valor({
      conexionId: con.id,
      objeto: base.objetoReal,
      clave: clave.valores,
      columna: base.columnas[c].nombre
    })
  } catch (err) {
    return { ok: false, error: errorDeInvoke(err) }
  }
}
