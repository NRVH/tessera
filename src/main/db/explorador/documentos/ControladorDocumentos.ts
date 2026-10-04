// =============================================================================
// Operaciones de `DOCS_CHANNELS` (MongoDB): valida la conexión y la forma de cada petición, decide la política de
// escritura y se lo da al `GestorDocumentos`. Sin `electron`: sus canales los registra `ipc.ts`.
// Depende de `familias.ts` y `filtroDocumentos.ts`.
// Decisiones: docs/decisiones/bd/documentos-controlador.md
// =============================================================================

import {
  DOCS_CHANNELS,
  type DbDocCambio,
  type DbDocConsultar,
  type DbDocEjecutar,
  type DbDocEnviar,
  type DbDocPedirBases,
  type DbDocPedirColecciones,
  type DbDocPedirDetalle,
  type DbDocPedirMas
} from '../../../../shared/db-documentos-ipc.ts'
import { DB_CONSOLA_MAX_BYTES, type DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { conexionDePeticion, type BuscadorConexiones } from '../familias.ts'
import { esProduccion } from '../produccion.ts'
import { sinSoloLecturaImpuesta, type SoloLecturaImpuesta } from '../soloLecturaImpuesta.ts'
import type { PoliticaDocs } from '../protocoloTrabajador.ts'
import { DOCS_PAGINA_CONSOLA, type GestorDocumentos } from './GestorDocumentos.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from '../../../../shared/filtroGuiado.ts'
import { compilarConsultaDocs } from './filtroDocumentos.ts'
import { conValidado, esEnteroEn, esNombre, invalida, peticionIdDe, type Validado } from './validacionPeticion.ts'

/** Las operaciones del contrato de documentos (las claves de `DOCS_CHANNELS`). */
export type OperacionDocumentos = keyof typeof DOCS_CHANNELS

/** Lo que el controlador usa del gestor (el test lo sustituye por un falso). */
export type GestorDocumentosAtiende = Pick<
  GestorDocumentos,
  'bases' | 'colecciones' | 'detalle' | 'consultar' | 'leerMas' | 'cerrarLector' | 'ejecutarConsola' | 'enviar'
>

export interface OpcionesControladorDocumentos {
  /** El registro de conexiones (`ConnectionStore`). */
  conexiones: BuscadorConexiones
  gestor: GestorDocumentosAtiende
  log?: (linea: string) => void
  /**
   * La solo lectura que impone el explorador (`soloLecturaImpuesta.ts`). Ausente, NINGUNA: la
   * casilla `readonly` de la conexión es de los agentes. Solo la pasan los tests que la fijan.
   */
  soloLecturaImpuesta?: SoloLecturaImpuesta
}

/** Tope de cada texto de la barra de la pestaña de colección (filtro, proyección, orden). */
export const MAX_TEXTO_BARRA = 256 * 1024
/** Tope de documentos por página (el `batchSize`). */
export const MAX_DOCUMENTOS_PAGINA = 10_000
/** Tope de cambios de un «Enviar». */
export const MAX_CAMBIOS_ENVIO = 10_000
function esTextoAcotado(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max
}

/** Un cambio de «Enviar» con su forma (ver `DbDocCambio`), o null. */
function cambioValido(c: unknown): DbDocCambio | null {
  if (c === null || typeof c !== 'object') return null
  const x = c as Record<string, unknown>
  const texto = (v: unknown): v is string => esTextoAcotado(v, DB_CONSOLA_MAX_BYTES)
  switch (x.tipo) {
    case 'insertar':
      return texto(x.documento) ? { tipo: 'insertar', documento: x.documento } : null
    case 'reemplazar':
      return texto(x.idEjson) && texto(x.documento) ? { tipo: 'reemplazar', idEjson: x.idEjson, documento: x.documento } : null
    case 'borrar':
      return texto(x.idEjson) ? { tipo: 'borrar', idEjson: x.idEjson } : null
    case 'actualizar':
      return actualizacionValida(x, texto)
    default:
      return null
  }
}

/** Un cambio `actualizar`: campos a poner (nombre -> texto) y a quitar (nombres). */
function actualizacionValida(x: Record<string, unknown>, texto: (v: unknown) => v is string): DbDocCambio | null {
  if (!texto(x.idEjson) || x.poner === null || typeof x.poner !== 'object' || Array.isArray(x.poner)) return null
  if (!Array.isArray(x.quitar) || !x.quitar.every((q) => esNombre(q))) return null
  const poner: Record<string, string> = {}
  for (const [k, v] of Object.entries(x.poner as Record<string, unknown>)) {
    if (!esNombre(k) || !texto(v)) return null
    poner[k] = v
  }
  return { tipo: 'actualizar', idEjson: x.idEjson, poner, quitar: [...(x.quitar as string[])] }
}

/**
 * La política de escritura de una conexión (ver la cabecera). `soloLectura`: la que IMPONE
 * el explorador (`soloLecturaImpuesta.ts`), nunca la casilla `readonly`, que es de los
 * agentes; en el producto, false.
 */
export function politicaDe(con: Pick<DbConnection, 'entorno'>, soloLectura: boolean, confirmado: unknown): PoliticaDocs {
  return { soloLectura, produccion: esProduccion(con), confirmado: confirmado === true }
}

export class ControladorDocumentos {
  // Campo explícito y no `constructor(private readonly o…)`: el type-stripping de `node` con
  // el que corren los tests no admite propiedades de parámetro.
  private readonly o: OpcionesControladorDocumentos

  constructor(o: OpcionesControladorDocumentos) {
    this.o = o
  }

  /** La solo lectura impuesta (ver `soloLecturaImpuesta.ts`); en el producto, ninguna. */
  private ro(con: DbConnection): boolean {
    return (this.o.soloLecturaImpuesta ?? sinSoloLecturaImpuesta)(con)
  }

  /**
   * El PUNTO ÚNICO de las operaciones con conexión (ver la cabecera): valida la conexión y
   * la forma, decide la política y se lo da al gestor.
   */
  async atender(op: OperacionDocumentos, req: unknown): Promise<DbRespuesta<unknown>> {
    const v = conexionDePeticion(req, this.o.conexiones, 'documentos')
    if (!v.ok) return v
    const con = v.con
    const r = req as Record<string, unknown>
    const g = this.o.gestor
    switch (op) {
      case 'BASES':
        return conValidado(this.validarBases(r), (p) => g.bases(p))
      case 'COLECCIONES':
        return conValidado(this.validarColecciones(r), (p) => g.colecciones(p))
      case 'DETALLE':
        return conValidado(this.validarDetalle(r), (p) => g.detalle(p))
      case 'CONSULTAR':
        return conValidado(this.validarConsultar(r), (p) => g.consultar(p))
      case 'CONSOLA_EJECUTAR':
        return conValidado(this.validarEjecutar(r), (p) =>
          g.ejecutarConsola(p.req, politicaDe(con, this.ro(con), p.req.confirmado), p.maxDocumentos)
        )
      case 'ENVIAR':
        return conValidado(this.validarEnviar(r), (p) => g.enviar(p, politicaDe(con, this.ro(con), p.confirmado)))
      case 'LECTOR_MAS':
      case 'LECTOR_CERRAR':
        // No nombran conexión: tienen su propio handler (`leerMas`, `cerrarLector`).
        return invalida('esta operación no lleva conexión')
    }
  }

  /** `LECTOR_MAS`: la página siguiente de un cursor vivo (id del main). */
  async leerMas(req: unknown): Promise<DbRespuesta<unknown>> {
    if (req === null || typeof req !== 'object') return invalida('falta el lector')
    const r = req as Record<string, unknown>
    if (!esNombre(r.lector)) return invalida('falta «lector»')
    if (!esEnteroEn(r.maxDocumentos, 1, MAX_DOCUMENTOS_PAGINA)) return invalida('«maxDocumentos» fuera de rango')
    const peticionId = peticionIdDe(r)
    if (peticionId === null) return invalida('«peticionId» no es válido')
    const p: DbDocPedirMas = { lector: r.lector, maxDocumentos: r.maxDocumentos }
    if (peticionId !== undefined) p.peticionId = peticionId
    return this.o.gestor.leerMas(p)
  }

  /** `LECTOR_CERRAR`: cierra el cursor (uno que no existe no es error). */
  async cerrarLector(lector: unknown): Promise<void> {
    if (!esNombre(lector)) return
    await this.o.gestor.cerrarLector(lector)
  }

  // --- Validación de la forma (la conexión ya está validada) -----------------------------

  private refrescarDe(r: Record<string, unknown>): Validado<boolean | undefined> {
    if (r.refrescar === undefined) return { ok: true, valor: undefined }
    return typeof r.refrescar === 'boolean' ? { ok: true, valor: r.refrescar } : invalida('«refrescar» no es booleano')
  }

  private validarBases(r: Record<string, unknown>): Validado<DbDocPedirBases> {
    const rf = this.refrescarDe(r)
    if (!rf.ok) return rf
    const p: DbDocPedirBases = { conexionId: r.conexionId as string }
    if (rf.valor !== undefined) p.refrescar = rf.valor
    return { ok: true, valor: p }
  }

  private validarColecciones(r: Record<string, unknown>): Validado<DbDocPedirColecciones> {
    if (!esNombre(r.base)) return invalida('falta «base»')
    const rf = this.refrescarDe(r)
    if (!rf.ok) return rf
    const p: DbDocPedirColecciones = { conexionId: r.conexionId as string, base: r.base }
    if (rf.valor !== undefined) p.refrescar = rf.valor
    return { ok: true, valor: p }
  }

  private validarDetalle(r: Record<string, unknown>): Validado<DbDocPedirDetalle> {
    if (!esNombre(r.base)) return invalida('falta «base»')
    if (!esNombre(r.coleccion)) return invalida('falta «coleccion»')
    const rf = this.refrescarDe(r)
    if (!rf.ok) return rf
    const p: DbDocPedirDetalle = { conexionId: r.conexionId as string, base: r.base, coleccion: r.coleccion }
    if (rf.valor !== undefined) p.refrescar = rf.valor
    return { ok: true, valor: p }
  }

  private validarConsultar(r: Record<string, unknown>): Validado<DbDocConsultar> {
    if (!esNombre(r.base)) return invalida('falta «base»')
    if (!esNombre(r.coleccion)) return invalida('falta «coleccion»')
    for (const campo of ['filtro', 'proyeccion', 'orden'] as const) {
      if (!esTextoAcotado(r[campo], MAX_TEXTO_BARRA)) return invalida(`«${campo}» no es un texto válido`)
    }
    if (!esEnteroEn(r.maxDocumentos, 1, MAX_DOCUMENTOS_PAGINA)) return invalida('«maxDocumentos» fuera de rango')
    const peticionId = peticionIdDe(r)
    if (peticionId === null) return invalida('«peticionId» no es válido')
    const p: DbDocConsultar = {
      conexionId: r.conexionId as string,
      base: r.base,
      coleccion: r.coleccion,
      filtro: r.filtro as string,
      proyeccion: r.proyeccion as string,
      orden: r.orden as string,
      maxDocumentos: r.maxDocumentos
    }
    if (peticionId !== undefined) p.peticionId = peticionId
    // El filtro guiado y el orden de la cabecera se validan AQUÍ, en la entrada, con
    // el mismo compilador que usa el gestor: estructura (`validarFiltro`/`validarOrden`),
    // nombres de campo, números que no caben, y la exclusión con los textos de la barra.
    if (r.filtroGuiado !== undefined) p.filtroGuiado = r.filtroGuiado as DbFiltroGuiado
    if (r.ordenColumnas !== undefined) p.ordenColumnas = r.ordenColumnas as DbOrdenColumna[]
    const c = compilarConsultaDocs(p)
    if (!c.ok) return c
    return { ok: true, valor: p }
  }

  /**
   * `maxDocumentos` no está en `DbDocEjecutar` (el contrato de la base); se acepta OPCIONAL
   * por si el renderer lo manda (su «filas por página») y, sin él, `DOCS_PAGINA_CONSOLA`.
   */
  private validarEjecutar(r: Record<string, unknown>): Validado<{ req: DbDocEjecutar; maxDocumentos: number }> {
    if (!esNombre(r.perfilId)) return invalida('falta «perfilId»')
    if (!esNombre(r.consolaId)) return invalida('falta «consolaId»')
    if (r.base !== null && !esNombre(r.base)) return invalida('«base» no es válida')
    if (!esTextoAcotado(r.texto, DB_CONSOLA_MAX_BYTES) || r.texto.trim() === '') return invalida('falta la sentencia')
    if (!esEnteroEn(r.desplazamiento, 0, DB_CONSOLA_MAX_BYTES)) return invalida('«desplazamiento» fuera de rango')
    if (r.confirmado !== undefined && typeof r.confirmado !== 'boolean') return invalida('«confirmado» no es booleano')
    const peticionId = peticionIdDe(r)
    if (peticionId === null) return invalida('«peticionId» no es válido')
    let maxDocumentos = DOCS_PAGINA_CONSOLA
    if (r.maxDocumentos !== undefined) {
      if (!esEnteroEn(r.maxDocumentos, 1, MAX_DOCUMENTOS_PAGINA)) return invalida('«maxDocumentos» fuera de rango')
      maxDocumentos = r.maxDocumentos
    }
    const req: DbDocEjecutar = {
      perfilId: r.perfilId,
      consolaId: r.consolaId,
      conexionId: r.conexionId as string,
      base: r.base as string | null,
      texto: r.texto,
      desplazamiento: r.desplazamiento
    }
    if (r.confirmado === true) req.confirmado = true
    if (peticionId !== undefined) req.peticionId = peticionId
    return { ok: true, valor: { req, maxDocumentos } }
  }

  private validarEnviar(r: Record<string, unknown>): Validado<DbDocEnviar> {
    if (!esNombre(r.base)) return invalida('falta «base»')
    if (!esNombre(r.coleccion)) return invalida('falta «coleccion»')
    if (!Array.isArray(r.cambios) || r.cambios.length === 0 || r.cambios.length > MAX_CAMBIOS_ENVIO) {
      return invalida('«cambios» tiene que ser una lista no vacía')
    }
    const cambios: DbDocCambio[] = []
    for (let i = 0; i < r.cambios.length; i++) {
      const c = cambioValido(r.cambios[i])
      if (!c) return invalida(`el cambio ${i + 1} no tiene la forma esperada`)
      cambios.push(c)
    }
    for (const k of ['confirmado', 'confirmadoSinTransaccion'] as const) {
      if (r[k] !== undefined && typeof r[k] !== 'boolean') return invalida(`«${k}» no es booleano`)
    }
    const p: DbDocEnviar = { conexionId: r.conexionId as string, base: r.base, coleccion: r.coleccion, cambios }
    if (r.confirmado === true) p.confirmado = true
    if (r.confirmadoSinTransaccion === true) p.confirmadoSinTransaccion = true
    return { ok: true, valor: p }
  }

  /** Escribe una línea en el registro, si se le dio uno. */
  log(linea: string): void {
    this.o.log?.(linea)
  }
}
