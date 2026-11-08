// =============================================================================
// El estado del editor de la configuración de un agente, sin React ni DOM: los dos archivos con su
// texto y lo último leído, qué pestaña se ve y qué problema tiene cada uno.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import type {
  ArchivoConfigLeido,
  ClaveFijada,
  ConfigAgenteLeida,
  ResultadoGuardarConfig,
  TipoArchivoConfig
} from '../../../../shared/configAgente-ipc'

export type ProblemaArchivoConfig =
  | Exclude<ResultadoGuardarConfig, { estado: 'guardado' }>
  | { estado: 'error'; detalle: string }
  | { estado: 'sin-anterior' }

export interface ArchivoEnEdicion {
  leido: ArchivoConfigLeido
  texto: string
  problema: ProblemaArchivoConfig | null
  /**
   * Cuántas veces se guardó bien y quedó todo guardado: el botón lo confirma en sí mismo cada vez. Si se tecleó
   * mientras se guardaba no sube, porque queda algo por guardar.
   */
  exitos: number
  /** Sube cuando el texto llega de fuera del editor: solo entonces hay que ponerlo en Monaco. */
  revision: number
}

export type EstadoConfigAgente =
  | { fase: 'cargando' }
  | { fase: 'no-disponible' }
  | { fase: 'error'; detalle: string }
  | {
      fase: 'lista'
      carpeta: string
      sesionesAbiertas: number
      fijadas: ClaveFijada[]
      activo: TipoArchivoConfig
      archivos: Record<TipoArchivoConfig, ArchivoEnEdicion>
    }

export type AccionConfigAgente =
  | { tipo: 'cargando' }
  | { tipo: 'cargado'; config: ConfigAgenteLeida | null }
  | { tipo: 'fallo-carga'; detalle: string }
  | { tipo: 'activar'; archivo: TipoArchivoConfig }
  | { tipo: 'editar'; archivo: TipoArchivoConfig; texto: string }
  | { tipo: 'resultado'; archivo: TipoArchivoConfig; resultado: ResultadoGuardarConfig }
  | { tipo: 'fallo-guardar'; archivo: TipoArchivoConfig; detalle: string }
  | { tipo: 'recargado'; archivo: TipoArchivoConfig; leido: ArchivoConfigLeido }
  | { tipo: 'anterior'; archivo: TipoArchivoConfig; texto: string | null }

const enEdicion = (leido: ArchivoConfigLeido, revision = 0): ArchivoEnEdicion => ({ leido, texto: leido.contenido, problema: null, exitos: 0, revision })

export const ESTADO_INICIAL_CONFIG: EstadoConfigAgente = { fase: 'cargando' }

export function reducirConfigAgente(estado: EstadoConfigAgente, accion: AccionConfigAgente): EstadoConfigAgente {
  if (accion.tipo === 'cargando') return ESTADO_INICIAL_CONFIG
  if (accion.tipo === 'cargado') {
    if (accion.config === null) return { fase: 'no-disponible' }
    const { carpeta, sesionesAbiertas, fijadas, archivos } = accion.config
    return {
      fase: 'lista',
      carpeta,
      sesionesAbiertas,
      fijadas,
      activo: 'configuracion',
      archivos: { configuracion: enEdicion(archivos.configuracion), instrucciones: enEdicion(archivos.instrucciones) }
    }
  }
  if (accion.tipo === 'fallo-carga') return { fase: 'error', detalle: accion.detalle }
  if (estado.fase !== 'lista') return estado
  if (accion.tipo === 'activar') return { ...estado, activo: accion.archivo }

  const actual = estado.archivos[accion.archivo]
  const poner = (archivo: ArchivoEnEdicion): EstadoConfigAgente => ({ ...estado, archivos: { ...estado.archivos, [accion.archivo]: archivo } })
  switch (accion.tipo) {
    case 'editar':
      // Monaco también avisa de los cambios que le manda el propio estado: esos no son una edición.
      return accion.texto === actual.texto ? estado : poner({ ...actual, texto: accion.texto, problema: null })
    case 'resultado':
      if (accion.resultado.estado === 'guardado') {
        // Lo tecleado mientras se guardaba se conserva: queda como cambio sin guardar.
        const leido = accion.resultado.archivo
        return poner({ ...actual, leido, problema: null, exitos: actual.texto === leido.contenido ? actual.exitos + 1 : actual.exitos })
      }
      return poner({ ...actual, problema: accion.resultado })
    case 'fallo-guardar':
      return poner({ ...actual, problema: { estado: 'error', detalle: accion.detalle } })
    case 'recargado':
      return poner(enEdicion(accion.leido, actual.revision + 1))
    case 'anterior':
      if (accion.texto === null) return poner({ ...actual, problema: { estado: 'sin-anterior' } })
      return poner({ ...actual, texto: accion.texto, problema: null, revision: actual.revision + 1 })
  }
}

export function tieneCambios(archivo: ArchivoEnEdicion): boolean {
  return archivo.texto !== archivo.leido.contenido
}

export function hayCambiosSinGuardar(estado: EstadoConfigAgente): boolean {
  return estado.fase === 'lista' && Object.values(estado.archivos).some(tieneCambios)
}

/** Sin cambios no hay nada que guardar; un archivo bloqueado no se escribe. */
export function sePuedeGuardar(archivo: ArchivoEnEdicion): boolean {
  return archivo.leido.bloqueo === null && tieneCambios(archivo)
}
