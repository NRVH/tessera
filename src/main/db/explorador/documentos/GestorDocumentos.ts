// =============================================================================
// Procesos y sesiones de los motores de documentos (MongoDB): las operaciones (bases, colecciones, detalle, consultar,
// más, consola, enviar), los lectores con ids del main y la traducción de errores del trabajador.
// Hereda su ciclo de vida de `gestorFamilia.ts`. Sin `electron`: se prueba con un trabajador falso.
// Decisiones: docs/decisiones/bd/documentos-controlador.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbErrorSql, DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type {
  DbDocBase,
  DbDocColeccion,
  DbDocConsultar,
  DbDocDetalleColeccion,
  DbDocEjecutar,
  DbDocEnviar,
  DbDocPagina,
  DbDocPedirBases,
  DbDocPedirColecciones,
  DbDocPedirDetalle,
  DbDocPedirMas,
  DbDocResultado,
  DbDocResultadoEnvio
} from '../../../../shared/db-documentos-ipc.ts'
import { puntosDeCodigoAUtf16 } from '../../../../shared/sql/posicionErrorSql.ts'
import {
  CODIGO_DOCS_PRODUCCION,
  CODIGO_DOCS_SIN_TRANSACCION,
  CODIGO_DOCS_SINTAXIS,
  CODIGO_DOCS_SOLO_LECTURA,
  CODIGO_LECTOR_DESCONOCIDO,
  PLAZOS_TRABAJADOR_MS,
  type ConexionTrabajador,
  type ErrorTrabajador,
  type PeticionDocs,
  type PoliticaDocs,
  type RespuestasDocs
} from '../protocoloTrabajador.ts'
import { esErrorCola } from '../colaSesion.ts'
import { MENSAJE_SIN_LECTOR, motivoDeClase } from '../GestorSesiones.ts'
import { MAX_LECTORES_POR_SESION } from '../limites.ts'
import { compilarConsultaDocs, ubicarErrorGuiado } from './filtroDocumentos.ts'
import {
  GestorFamilia,
  conexionTrabajadorFamilia,
  errorTrabajadorDe,
  type DependenciasGestorFamilia,
  type SesionFamilia
} from '../gestorFamilia.ts'

// --- Dependencias -------------------------------------------------------------------------

/** Las del núcleo común (ver `DependenciasGestorFamilia`). */
export type DependenciasGestorDocumentos = DependenciasGestorFamilia

// --- Estado ------------------------------------------------------------------------------

interface LectorDocs {
  id: string
  sesion: SesionFamilia
  /** El id del cursor DENTRO del trabajador. */
  lectorTrabajador: string
}

/** Contexto para ubicar un error de sintaxis (ver `errorDocs`). */
export interface ContextoErrorDocs {
  /** Texto de la consola ENVIADO (la sentencia) y su desplazamiento dentro de la consola. */
  texto?: string
  desplazamiento?: number
  /** Los textos de la barra de la pestaña de colección. */
  campos?: { filtro: string; proyeccion: string; orden: string }
}

/** Documentos por página de la consola si la petición no dice otra cosa. */
export const DOCS_PAGINA_CONSOLA = 100

// --- Funciones puras ---------------------------------------------------------------------

/**
 * La conexión tal como la necesita el trabajador de documentos: la común de la familia (con
 * el cifrado EFECTIVO, `tlsEfectivo`: el guardado, o el del motor; con `srv`, cifrar) y los
 * campos de MongoDB (`srv`, `opcionesUri`) solo si tienen valor. Sin secreto (ese va
 * aparte, en `abrir`).
 */
export function aConexionTrabajadorDocs(c: DbConnection): ConexionTrabajador {
  const t = conexionTrabajadorFamilia(c)
  if (c.srv === true) t.srv = true
  if (typeof c.opcionesUri === 'string' && c.opcionesUri.trim() !== '') t.opcionesUri = c.opcionesUri.trim()
  return t
}

/**
 * `ErrorTrabajador` → `DbErrorSql` (ver la cabecera). Pura: el test la fija caso a caso.
 * La posición solo se pone si el trabajador la dio Y se sabe sobre qué texto contarla.
 */
export function errorDocs(et: ErrorTrabajador, ctx: ContextoErrorDocs = {}): DbErrorSql {
  const e: DbErrorSql = { mensaje: et.mensaje, motivo: motivoDeClase(et.clase) }
  if (et.codigo) e.codigo = et.codigo
  ajustarPorCodigo(e, et.codigo)
  if (et.campoDocs) e.campo = et.campoDocs
  const posicion = posicionDeError(et, ctx)
  if (posicion !== undefined) e.posicion = posicion
  return e
}

/** Los códigos de la política del trabajador dan su motivo propio. */
function ajustarPorCodigo(e: DbErrorSql, codigo: ErrorTrabajador['codigo']): void {
  switch (codigo) {
    case CODIGO_DOCS_PRODUCCION:
      e.motivo = 'produccion'
      break
    case CODIGO_DOCS_SOLO_LECTURA:
      e.motivo = 'soloLectura'
      break
    case CODIGO_DOCS_SIN_TRANSACCION:
      e.motivo = 'sinTransaccion'
      break
    case CODIGO_DOCS_SINTAXIS:
      e.motivo = 'servidor'
      break
    case CODIGO_LECTOR_DESCONOCIDO:
      e.motivo = 'noReleible'
      e.mensaje = MENSAJE_SIN_LECTOR
      break
  }
}

/** La posición del error en UTF-16 (el trabajador la da en puntos de código), o `undefined`. */
function posicionDeError(et: ErrorTrabajador, ctx: ContextoErrorDocs): number | undefined {
  if (typeof et.offsetCp !== 'number' || !Number.isFinite(et.offsetCp) || et.offsetCp < 0) return undefined
  if (et.campoDocs) {
    const texto = ctx.campos?.[et.campoDocs]
    return typeof texto === 'string' ? puntosDeCodigoAUtf16(texto, et.offsetCp) : undefined
  }
  if (typeof ctx.texto === 'string') return puntosDeCodigoAUtf16(ctx.texto, et.offsetCp) + (ctx.desplazamiento ?? 0)
  return undefined
}

// --- El gestor ---------------------------------------------------------------------------

export class GestorDocumentos extends GestorFamilia<ContextoErrorDocs, PeticionDocs, RespuestasDocs> {
  private readonly lectores = new Map<string, LectorDocs>()
  /** Ids del main de los lectores vivos de cada sesión, del más viejo al más nuevo. */
  private readonly lectoresDeSesion = new WeakMap<SesionFamilia, string[]>()
  /** Campos de la muestra por colección (`detalle`): `JSON [conexión, base, colección]`. */
  private readonly columnas = new Map<string, string[]>()
  private secuenciaLector = 0

  constructor(deps: DependenciasGestorDocumentos) {
    super(deps, {
      op: 'docs',
      familia: 'documentos',
      etiqueta: 'documentos',
      conexionTrabajador: aConexionTrabajadorDocs,
      error: (et, ctx) => errorDocs(et, ctx)
    })
  }

  // --- Ganchos del núcleo ------------------------------------------------------------------

  /** La sesión deja de estar abierta: sus lectores se olvidan. */
  protected override alSoltarSesion(s: SesionFamilia): void {
    for (const id of this.lectoresDe(s).splice(0)) this.lectores.delete(id)
  }

  protected override alDesconectar(conexionId: string): void {
    this.olvidarColumnas(conexionId)
  }

  // --- Operaciones del contrato (validadas por el controlador) -------------------------

  async bases(req: DbDocPedirBases): Promise<DbRespuesta<DbDocBase[]>> {
    return this.respuesta(() => this.operar(req.conexionId, this.refMeta(req.conexionId), { operacion: 'bases' }, { reintentar: true }))
  }

  async colecciones(req: DbDocPedirColecciones): Promise<DbRespuesta<DbDocColeccion[]>> {
    return this.respuesta(() =>
      this.operar(req.conexionId, this.refMeta(req.conexionId), { operacion: 'colecciones', base: req.base }, { reintentar: true })
    )
  }

  async detalle(req: DbDocPedirDetalle): Promise<DbRespuesta<DbDocDetalleColeccion>> {
    return this.respuesta(() => this.leerDetalle(req.conexionId, req.base, req.coleccion))
  }

  async consultar(req: DbDocConsultar): Promise<DbRespuesta<DbDocPagina>> {
    // El filtro guiado y el orden de la cabecera, a los textos de siempre. El
    // controlador ya lo validó; aquí se repite porque el gestor también se llama directo.
    const compilada = compilarConsultaDocs(req)
    if (!compilada.ok) return compilada
    const { filtro, orden } = compilada.valor
    const campos = { filtro, proyeccion: req.proyeccion, orden }
    const r = await this.respuesta(async () => {
      const clave = this.claveColumnas(req.conexionId, req.base, req.coleccion)
      let columnas = this.columnas.get(clave)
      if (!columnas) {
        // Las columnas estables salen de la muestra; si no se puede leer (una vista sin
        // permiso de `$sample`), la página ordena las suyas y sigue.
        try {
          columnas = (await this.leerDetalle(req.conexionId, req.base, req.coleccion, req.peticionId)).campos.map((c) => c.nombre)
        } catch (e) {
          // Un Cancelar mientras se leía la muestra cancela la consulta entera.
          if ((esErrorCola(e) && e.motivo === 'cancelada') || errorTrabajadorDe(e)?.clase === 'cancelada') throw e
          columnas = []
        }
      }
      const s = this.sesionPara(req.conexionId, { rol: 'datos', conexionId: req.conexionId })
      const pagina = await this.operarEn(
        s,
        {
          operacion: 'consultar',
          base: req.base,
          coleccion: req.coleccion,
          filtro,
          proyeccion: req.proyeccion,
          orden,
          maxDocumentos: req.maxDocumentos,
          columnas
        },
        { clave: req.peticionId, reintentar: true }
      )
      return this.envolverPagina(s, pagina)
    }, { campos })
    return r.ok ? r : { ok: false, error: ubicarErrorGuiado(r.error, compilada.valor) }
  }

  async leerMas(req: DbDocPedirMas): Promise<DbRespuesta<DbDocPagina>> {
    const l = this.lectores.get(req.lector)
    if (!l || !l.sesion.abierta) {
      if (l) this.olvidarLector(l.id)
      return { ok: false, error: { motivo: 'noReleible', mensaje: MENSAJE_SIN_LECTOR } }
    }
    return this.respuesta(async () => {
      try {
        const pagina = await this.operarEn(
          l.sesion,
          { operacion: 'mas', lector: l.lectorTrabajador, maxDocumentos: req.maxDocumentos },
          { clave: req.peticionId }
        )
        if (pagina.lector === null) this.olvidarLector(l.id)
        return { ...pagina, lector: pagina.lector === null ? null : l.id }
      } catch (e) {
        if (errorTrabajadorDe(e)?.codigo === CODIGO_LECTOR_DESCONOCIDO) this.olvidarLector(l.id)
        throw e
      }
    })
  }

  async cerrarLector(lector: string): Promise<void> {
    const l = this.lectores.get(lector)
    if (!l) return
    this.olvidarLector(l.id)
    await this.cerrarLectorEnTrabajador(l)
  }

  async ejecutarConsola(req: DbDocEjecutar, politica: PoliticaDocs, maxDocumentos = DOCS_PAGINA_CONSOLA): Promise<DbRespuesta<DbDocResultado>> {
    const ctx: ContextoErrorDocs = { texto: req.texto, desplazamiento: req.desplazamiento }
    return this.respuesta(async () => {
      const s = this.sesionPara(req.conexionId, { rol: 'consola', perfilId: req.perfilId, consolaId: req.consolaId })
      const r = await this.operarEn(
        s,
        { operacion: 'consola', base: req.base, texto: req.texto, maxDocumentos, politica },
        // La consola usa el `peticionId` como `ejecucionId` de `DbCancelar` (ver el contrato).
        { clave: req.peticionId }
      )
      if (r.tipo !== 'documentos') return r
      return { ...r, pagina: this.envolverPagina(s, r.pagina) }
    }, ctx)
  }

  async enviar(req: DbDocEnviar, politica: PoliticaDocs): Promise<DbRespuesta<DbDocResultadoEnvio>> {
    return this.respuesta(() => {
      const s = this.sesionPara(req.conexionId, { rol: 'datos', conexionId: req.conexionId })
      return this.operarEn(s, {
        operacion: 'enviar',
        base: req.base,
        coleccion: req.coleccion,
        cambios: req.cambios,
        politica,
        confirmadoSinTransaccion: req.confirmadoSinTransaccion === true
      })
    })
  }

  // --- Columnas -----------------------------------------------------------------------------

  private claveColumnas(conexionId: string, base: string, coleccion: string): string {
    return JSON.stringify([conexionId, base, coleccion])
  }

  private olvidarColumnas(conexionId: string): void {
    for (const k of [...this.columnas.keys()]) {
      if ((JSON.parse(k) as string[])[0] === conexionId) this.columnas.delete(k)
    }
  }

  private async leerDetalle(conexionId: string, base: string, coleccion: string, clave?: string): Promise<DbDocDetalleColeccion> {
    const d = await this.operar(conexionId, this.refMeta(conexionId), { operacion: 'detalle', base, coleccion }, { clave, reintentar: true })
    this.columnas.set(
      this.claveColumnas(conexionId, base, coleccion),
      d.campos.map((c) => c.nombre)
    )
    return d
  }

  // --- Lectores ----------------------------------------------------------------------------

  private lectoresDe(s: SesionFamilia): string[] {
    let l = this.lectoresDeSesion.get(s)
    if (!l) {
      l = []
      this.lectoresDeSesion.set(s, l)
    }
    return l
  }

  /** La página con su lector del trabajador sustituido por un id del main. */
  private envolverPagina(s: SesionFamilia, pagina: DbDocPagina): DbDocPagina {
    if (pagina.lector === null) return pagina
    const id = `docs:${++this.secuenciaLector}`
    const l: LectorDocs = { id, sesion: s, lectorTrabajador: pagina.lector }
    this.lectores.set(id, l)
    const suyos = this.lectoresDe(s)
    suyos.push(id)
    while (suyos.length > MAX_LECTORES_POR_SESION) {
      const viejo = this.lectores.get(suyos[0])
      if (!viejo) {
        suyos.shift()
        continue
      }
      this.olvidarLector(viejo.id)
      void this.cerrarLectorEnTrabajador(viejo)
    }
    return { ...pagina, lector: id }
  }

  private olvidarLector(id: string): void {
    const l = this.lectores.get(id)
    if (!l) return
    this.lectores.delete(id)
    const suyos = this.lectoresDe(l.sesion)
    const i = suyos.indexOf(id)
    if (i >= 0) suyos.splice(i, 1)
  }

  /** Cierra el cursor en el trabajador (detrás de lo que espere; los errores no importan). */
  private async cerrarLectorEnTrabajador(l: LectorDocs): Promise<void> {
    const s = l.sesion
    if (!s.abierta || !s.proceso || s.proceso.salido) return
    try {
      const p = s.proceso
      await s.cola.correr(
        () => p.trabajador.enviar<'docs'>({ op: 'docs', sesion: s.id, operacion: 'cerrarLector', lector: l.lectorTrabajador }, PLAZOS_TRABAJADOR_MS.cerrar),
        { prioridad: 'baja' }
      )
    } catch {
      // un cursor que ya no existe es lo que se quería
    }
  }
}
