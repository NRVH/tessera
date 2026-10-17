// =============================================================================
// Exportar documentos de MongoDB a un archivo: valida el origen (la colección con el filtro de su pestaña, o
// una sentencia de lectura de la consola), lo lee por páginas del trabajador y se lo da al `Exportador`; y
// el escritor de JSON, un documento por línea dentro de una lista. Sin `electron`: se prueba con un gestor falso.
// Depende de `filtroDocumentos.ts`; lo usa `controlador/exportar.ts`.
// Decisiones: docs/decisiones/bd/mongodb-explain-y-exportar.md
// =============================================================================

import { DB_CONSOLA_MAX_BYTES, type DbColumnaResultado, type DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type { DbDocConsultar } from '../../../../shared/db-documentos-ipc.ts'
import type { EscritorFilas } from '../../../../shared/formatosFilas.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from '../../../../shared/filtroGuiado.ts'
import { ErrorGestor } from '../sesiones/errores.ts'
import type { ProductorExportacion } from '../exportacion.ts'
import type { FormatoExportacionDocs, PaginaExportacionDocs } from '../protocoloTrabajador.ts'
import type { PeticionExportarAbrir, PeticionExportarMas } from './GestorDocumentos.ts'
import { compilarConsultaDocs } from './filtroDocumentos.ts'
import { txDocumentos } from './textosDocumentos.ts'
import { esNombre } from './validacionPeticion.ts'

/** Lo que el exportador usa del gestor de documentos (el test lo sustituye por un falso). */
export interface GestorExportaDocumentos {
  exportarAbrir(conexionId: string, pet: PeticionExportarAbrir, peticionId?: string): Promise<DbRespuesta<PaginaExportacionDocs>>
  exportarMas(lector: string, pet: Omit<PeticionExportarMas, 'operacion' | 'lector'>): Promise<DbRespuesta<PaginaExportacionDocs>>
  cerrarLector(lector: string): Promise<void>
}

/** Documentos por página de una exportación. */
export const PAGINA_EXPORTACION_DOCS = 1000
/** Tope de cada texto del origen (filtro, proyección, orden). */
const MAX_TEXTO = 256 * 1024

/** El origen ya validado: lo que se pide al trabajador, más la conexión. */
export interface OrigenDocumentos {
  conexionId: string
  pet: PeticionExportarAbrir
}

const mala = (que: string): ErrorGestor => new ErrorGestor('interno', `Petición inválida: ${que}.`)

/** Un origen `coleccion` o `sentencia` de `DbOrigenExportacion`, validado; lanza `ErrorGestor` si no es válido. */
export function origenDocumentos(o: Record<string, unknown>, formato: FormatoExportacionDocs): OrigenDocumentos {
  if (!esNombre(o.conexionId)) throw mala('«conexionId»')
  const comun = { formato, maxDocumentos: PAGINA_EXPORTACION_DOCS }
  if (o.tipo === 'sentencia') {
    if (typeof o.texto !== 'string' || o.texto.trim() === '' || o.texto.length > DB_CONSOLA_MAX_BYTES) throw mala('«texto»')
    if (o.base !== null && !esNombre(o.base)) throw mala('«base»')
    return { conexionId: o.conexionId, pet: { operacion: 'exportarAbrir', origen: 'sentencia', base: o.base, texto: o.texto, ...comun } }
  }
  return origenDeColeccion(o, o.conexionId, comun)
}

function origenDeColeccion(
  o: Record<string, unknown>,
  conexionId: string,
  comun: { formato: FormatoExportacionDocs; maxDocumentos: number }
): OrigenDocumentos {
  if (!esNombre(o.base)) throw mala('«base»')
  if (!esNombre(o.coleccion)) throw mala('«coleccion»')
  for (const campo of ['filtro', 'proyeccion', 'orden'] as const) {
    const v = o[campo]
    if (typeof v !== 'string' || v.length > MAX_TEXTO) throw mala(`«${campo}»`)
  }
  const consulta: Pick<DbDocConsultar, 'filtro' | 'orden' | 'filtroGuiado' | 'ordenColumnas'> = {
    filtro: o.filtro as string,
    orden: o.orden as string,
    ...(o.filtroGuiado !== undefined ? { filtroGuiado: o.filtroGuiado as DbFiltroGuiado } : {}),
    ...(o.ordenColumnas !== undefined ? { ordenColumnas: o.ordenColumnas as DbOrdenColumna[] } : {})
  }
  const compilada = compilarConsultaDocs(consulta)
  if (!compilada.ok) throw new ErrorGestor(compilada.error.motivo, compilada.error.mensaje)
  const { filtro, orden } = compilada.valor
  return {
    conexionId,
    pet: { operacion: 'exportarAbrir', origen: 'coleccion', base: o.base, coleccion: o.coleccion, filtro, proyeccion: o.proyeccion as string, orden, ...comun }
  }
}

function pagina(r: DbRespuesta<PaginaExportacionDocs>): PaginaExportacionDocs {
  if (r.ok) return r.valor
  throw new ErrorGestor(r.error.motivo, r.error.mensaje, r.error)
}

function columnasDeArchivo(formato: FormatoExportacionDocs, columnas: readonly string[]): DbColumnaResultado[] {
  const nombres = formato === 'json' ? ['documento'] : columnas
  return nombres.map((nombre) => ({ nombre, tipoLogico: 'texto', tipoMotor: '' }))
}

/**
 * Quien produce las páginas del archivo: abre la lectura, entrega cada página al exportador y sigue con la
 * siguiente mientras haya y no se cancele. El cursor se cierra siempre al acabar, aunque sea por un fallo o un Stop.
 */
export function productorDocumentos(
  gestor: GestorExportaDocumentos,
  origen: OrigenDocumentos,
  formato: FormatoExportacionDocs,
  peticionId: string
): ProductorExportacion {
  return async (consumir, cancelada) => {
    let lector: string | null = null
    let omitidos = 0
    try {
      let actual = pagina(await gestor.exportarAbrir(origen.conexionId, origen.pet, peticionId))
      // CSV: las columnas son las de la primera página y las siguientes se escriben con ellas.
      const columnas = actual.columnas
      for (;;) {
        lector = actual.lector
        omitidos += actual.omitidos
        await consumir({ columnas: columnasDeArchivo(formato, columnas), filasJson: JSON.stringify(actual.filas) })
        if (lector === null || cancelada()) break
        actual = pagina(await gestor.exportarMas(lector, { formato, maxDocumentos: PAGINA_EXPORTACION_DOCS, ...(formato === 'csv' ? { columnas } : {}) }))
      }
    } finally {
      if (lector !== null) await gestor.cerrarLector(lector).catch(() => undefined)
    }
    if (omitidos === 0) return
    return { aviso: txDocumentos().camposOmitidos(omitidos) }
  }
}

/** JSON de documentos: `[` y un documento por línea, sin la coma final. */
export function escritorJsonDocumentos(): EscritorFilas {
  let hayAlguno = false
  return {
    inicio: () => '[',
    filas: (filas) => {
      let texto = ''
      for (const fila of filas) {
        texto += `${hayAlguno ? ',' : ''}\n${String(fila[0])}`
        hayAlguno = true
      }
      return texto
    },
    fin: () => (hayAlguno ? '\n]\n' : ']\n')
  }
}
