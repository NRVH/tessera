// =============================================================================
// Pestaña de tabla: abrir, paginar, contar, cerrar lectores y «Enviar» de la rejilla.
// Apunta cada petición en `enPreparacion` para que un Stop llegue antes de encolar en el gestor.
// Decisiones: docs/decisiones/bd/explorador-stop-en-preparacion.md
// =============================================================================

import {
  type DbIdentidadFila,
  type DbPagina,
  type DbRefObjeto,
  type DbRespuesta,
  type DbResultadoEnvio,
  type DbTablaAbierta,
  TIPOS_CON_DATOS
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { descriptorSql } from '../../../../shared/motores/index.ts'
import { nunca } from '../../../../shared/nunca.ts'

import { conTiposDeclarados, faltanTiposDeclarados, sqlTiposColumnas } from '../catalogoSql.ts'
import {
  type ColumnaEdicion,
  columnasFueraDelCatalogo,
  comparablesDe,
  conMarcasDeTabla,
  decidirIdentidad,
  type EntradaIdentidad,
  esEsquemaDelSistema,
  identidadAntesDeLeer,
  mapearTablaEdicion,
  mapearUnicaNoNula,
  mismaIdentidad,
  MOTIVO_SOLO_LECTURA,
  necesitaUnica,
  noEditablesDe,
  prepararEnvio,
  puedeSerEditable,
  sqlColumnasEdicion,
  sqlUnicaNoNula,
  type TablaEdicion,
  validarCambios,
  validarFormaEnvio
} from '../edicionRejilla.ts'
import { motorExplorador } from '../motores/index.ts'
import { exigeConfirmacion, mensajeProduccion } from '../produccion.ts'
import { sinSoloLecturaImpuesta } from '../soloLecturaImpuesta.ts'
import type { ClaveKeyset } from '../sqlRejilla.ts'

import type { ObjetosExplorador } from './objetos.ts'
import type { ContextoExplorador } from './tipos.ts'
import {
  claveConBase,
  conBase,
  construir,
  esObjeto,
  exigir,
  fallo,
  filtroYOrden,
  MAX_FRAGMENTO,
  mensajeDe,
  ok,
  opcional
} from './validacion.ts'

/** Con qué se identifica cada fila de un objeto y, si se puede editar, sus columnas. */
type Edicion = { identidad: DbIdentidadFila; columnas: ColumnaEdicion[] | null }

/** Una petición de abrir tabla ya validada. */
interface PeticionTabla {
  id: string
  peticionId: string
  objeto: DbRefObjeto
  where: string | null
  orderBy: string | null
  guiado: ReturnType<typeof filtroYOrden>
  maxFilas: number
  sinEsperar: boolean
}

/** Lo que `leerPreparada` le pasa a `completarTabla`. */
interface TablaLeida {
  id: string
  con: DbConnection
  destino: DbRefObjeto
  remoto: boolean
  pk: string[]
  previa: Edicion | null
  edicionP: Promise<Edicion>
  tiposP: Promise<Map<string, string> | null>
}

/** Pestaña de tabla: abrir, paginar, contar, cerrar lectores y «Enviar» de la rejilla. */
export class TablaExplorador {
  private readonly c: ContextoExplorador
  private readonly catalogo: ObjetosExplorador

  constructor(c: ContextoExplorador, catalogo: ObjetosExplorador) {
    this.c = c
    this.catalogo = catalogo
  }

  async abrirTabla(req: unknown): Promise<DbRespuesta<DbTablaAbierta>> {
    return this.c.seguro(async () => {
      if (!esObjeto(req)) return fallo('interno', 'Petición inválida.')
      const id = exigir(req.conexionId, 'conexionId')
      const peticionId = exigir(req.peticionId, 'peticionId', 200)
      const objeto = this.c.refObjeto(req.objeto, id)
      if (TIPOS_CON_DATOS.indexOf(objeto.tipo) < 0) return fallo('interno', 'Ese objeto no tiene datos que enseñar.')
      const where = opcional(req.where, 'where', MAX_FRAGMENTO) ?? null
      const orderBy = opcional(req.orderBy, 'orderBy', MAX_FRAGMENTO) ?? null
      // Filtro y orden se validan aquí, antes de leer nada del catálogo.
      const guiado = filtroYOrden(req.filtro, req.orden)
      const maxFilas = typeof req.maxFilas === 'number' ? req.maxFilas : NaN
      const peticion: PeticionTabla = { id, peticionId, objeto, where, orderBy, guiado, maxFilas, sinEsperar: req.sinEsperar === true }
      // Desde aquí, un Stop con este `peticionId` se apunta (ver `enPreparacion`): la PK y la
      // identidad se leen del catálogo ANTES de que la lectura esté en el gestor.
      return this.prepararDatos(id, peticionId, (detenido) => this.leerPreparada(peticion, detenido))
    })
  }

  /** Lee del catálogo lo que la lectura necesita y la encola en el gestor, en el mismo turno que mira `detenido`. */
  private async leerPreparada(p: PeticionTabla, detenido: () => boolean): Promise<DbRespuesta<DbTablaAbierta>> {
    const { id, peticionId, objeto } = p
    let destino: DbRefObjeto = objeto
    let dblink: string | null = null
    if (objeto.tipo === 'sinonimo') {
      const r = await this.catalogo.resolverSinonimo(id, objeto.esquema, objeto.nombre, objeto.base)
      destino = r.objeto
      dblink = r.dblink
    }
    const pk = dblink ? [] : await this.catalogo.clavePrimaria(id, destino)
    const con = this.c.conexionOError(id)
    const remoto = dblink !== null
    // Con qué se identifica cada fila para editarla, EN PARALELO con la primera página salvo si el
    // SELECT depende de ello (Oracle sin PK: columna oculta del ROWID). `edicionDe` no lanza; el
    // `catch` vacío evita un rechazo sin atender si una salida temprana abandona la promesa.
    const edicionP = this.edicionDe(id, con, destino, remoto, pk)
    edicionP.catch(() => undefined)
    // El tipo DECLARADO de cada columna (solo Oracle, y solo en una tabla local), también en paralelo.
    const tiposP =
      motorExplorador(con.motor).catalogo.leeTiposDeclarados && !remoto ? this.tiposDeclarados(id, destino) : Promise.resolve(null)
    const previa = identidadAntesDeLeer(this.entradaIdentidad(con, destino, remoto, pk)) ? await edicionP : null
    // Paginado por clave (SQLite): la clave y el alias del rowid; null en los motores que no paginan así.
    const paginado = await this.paginadoDe(id, con, destino, pk, remoto)
    // Un Stop que llegó mientras se leía el catálogo: no se lee nada. Esto y la llamada al gestor van
    // en el MISMO turno, y `leerTabla` encola antes de su primer `await`.
    if (detenido()) return fallo('cancelada', 'Lectura detenida antes de empezar.')
    const r = await this.c.gestor.leerTabla({
      conexionId: id,
      peticionId,
      objeto: { esquema: destino.esquema, nombre: destino.nombre, dblink, ...(destino.base ? { base: destino.base } : {}) },
      where: p.where,
      orderBy: p.orderBy,
      ...p.guiado,
      pk,
      maxFilas: p.maxFilas,
      ...(previa?.identidad.tipo === 'rowid' ? { rowid: true } : {}),
      ...(paginado ? { clave: paginado.clave, aliasRowid: paginado.aliasRowid } : {}),
      // «Leer sin esperar», tras un error con motivo 'bloqueo' (SQL Server).
      ...(p.sinEsperar ? { sinEsperar: true } : {})
    })
    if (!r.ok) return r
    return this.completarTabla(r.valor, { id, con, destino, remoto, pk, previa, edicionP, tiposP })
  }

  /**
   * Cierra la respuesta con la identidad y los tipos declarados. Un Stop con la página ya leída no
   * la tira: lo caro, el SELECT, ya corrió; tirarla obligaría a cerrar un cursor vivo cuyo id el
   * renderer ya no conocería.
   */
  private async completarTabla(pagina: DbTablaAbierta['resultado'], t: TablaLeida): Promise<DbRespuesta<DbTablaAbierta>> {
    const { id, con, destino, remoto, pk } = t
    let edicion = t.previa ?? (await t.edicionP)
    // La página trae una columna que el catálogo de edición (cacheado, sin TTL) no conoce: un DDL
    // hecho fuera de Tessera. Se relee, salvo que cambie la identidad que decidió el SELECT.
    if (pagina.tipo === 'filas' && edicion.columnas) {
      const nuevas = columnasFueraDelCatalogo(
        pagina.columnas.map((c) => c.nombre),
        edicion.columnas
      )
      if (nuevas.length > 0) {
        const fresca = await this.edicionDe(id, con, destino, remoto, pk, true)
        if (fresca.identidad.tipo === edicion.identidad.tipo || fresca.identidad.tipo === 'ninguna') edicion = fresca
      }
    }
    // Los tipos declarados, con la misma relectura si la página trae una columna que no conocen.
    let resultado = pagina
    if (resultado.tipo === 'filas') {
      let tipos = await t.tiposP
      if (tipos && faltanTiposDeclarados(resultado.columnas, tipos)) tipos = await this.tiposDeclarados(id, destino, true)
      if (tipos) resultado = { ...resultado, columnas: conTiposDeclarados(resultado.columnas, tipos) }
    }
    const valor: DbTablaAbierta = { resultado, clavePrimaria: pk, objeto: destino, identidad: edicion.identidad }
    if (edicion.columnas) valor.noEditables = noEditablesDe(edicion.columnas)
    // Con el ROWID, las columnas que el main compara (la rejilla no elige otra).
    if (edicion.columnas && edicion.identidad.tipo === 'rowid') valor.comparables = comparablesDe(edicion.columnas)
    return ok(valor)
  }

  /**
   * La identidad de las filas de un objeto (ya resuelto) y, si se puede editar, sus
   * columnas con lo que no se escribe.
   * Solo lectura: nada más que la decisión, sin una consulta de más. La UNIQUE NOT NULL
   * solo se busca en PG sin PK. Si el catálogo falla, la tabla se ABRE igual, sin
   * edición: leer no puede depender de poder escribir. Cacheado con el detalle, así que
   * «Enviar» vuelve a calcular lo mismo sin ir al servidor (y un DDL lo invalida).
   * `refrescar`: vuelve a preguntar y guarda lo nuevo, sin invalidar nada más ni avisar al
   * árbol (lo usa `abrirTabla` cuando la página delata una caché vieja).
   */
  private async edicionDe(
    conexionId: string,
    con: DbConnection,
    destino: DbRefObjeto,
    remoto: boolean,
    pk: readonly string[],
    refrescar = false
  ): Promise<Edicion> {
    const base = this.entradaIdentidad(con, destino, remoto, pk)
    // Solo lectura, una vista, algo remoto o del sistema: 'ninguna' sin preguntar nada.
    if (!puedeSerEditable(base)) return { identidad: decidirIdentidad({ ...base, unica: null }), columnas: null }
    try {
      const tabla = await this.columnasEdicion(conexionId, destino, refrescar)
      // Temporal, externa y, en 12c+, «del sistema» también por `oracle_maintained` (la lista
      // escrita a mano no conoce las cuentas de una versión futura). Aditivo: solo puede
      // quitar la edición, nunca darla.
      const conMarcas = conMarcasDeTabla(base, tabla)
      const unica = necesitaUnica(conMarcas) ? await this.unicaNoNula(conexionId, destino, refrescar) : null
      const identidad = decidirIdentidad({ ...conMarcas, unica })
      return { identidad, columnas: identidad.tipo === 'ninguna' ? null : tabla.columnas }
    } catch (e) {
      this.c.log(`no se pudo leer la identidad de edición de ${conexionId}: ${mensajeDe(e).slice(0, 200)}`)
      return {
        identidad: { tipo: 'ninguna', motivo: 'No se pudo leer del catálogo cómo encontrar cada fila: la tabla se abre sin edición.' },
        columnas: null
      }
    }
  }

  /**
   * ¿El explorador trata `con` como de solo lectura? La que impone quien lo construye
   * (`soloLecturaImpuesta.ts`), NUNCA la casilla `con.readonly`, que es solo
   * de los agentes, y en el producto la rejilla se edita en cualquier conexión.
   */
  roDe(con: DbConnection): boolean {
    return (this.c.opciones.soloLecturaImpuesta ?? sinSoloLecturaImpuesta)(con)
  }

  /** Lo que decide la identidad sin preguntar al catálogo (`edicionDe`, `identidadAntesDeLeer`). */
  private entradaIdentidad(
    con: DbConnection,
    destino: DbRefObjeto,
    remoto: boolean,
    pk: readonly string[]
  ): Pick<EntradaIdentidad, 'motor' | 'soloLectura' | 'sistema' | 'tipo' | 'remoto' | 'pk'> {
    return {
      motor: con.motor,
      // La impuesta por el explorador, no la casilla de los agentes (ver `roDe`).
      soloLectura: this.roDe(con),
      sistema: esEsquemaDelSistema(con.motor, destino.esquema),
      tipo: destino.tipo,
      remoto,
      pk
    }
  }

  /**
   * El paginado por CLAVE de la pestaña y de la exportación (la forma
   * 'keyset' de SQLite; `sqlRejilla.ts`): la PK si la hay y, si no, el rowid por el alias que
   * no tape una columna, que dice el catálogo de edición (cacheado con el detalle: una
   * consulta local de más la primera vez, y solo sin PK). null en un motor que no pagina
   * por clave: la petición al gestor sale como siempre. Sin clave (una vista, una virtual)
   * o si el catálogo falla, `clave: null`, y la rejilla cae a LIMIT/OFFSET: leer no puede
   * depender de esto.
   */
  async paginadoDe(
    conexionId: string,
    con: DbConnection,
    destino: DbRefObjeto,
    pk: readonly string[],
    remoto: boolean
  ): Promise<{ clave: ClaveKeyset | null; aliasRowid: string | null } | null> {
    const forma = descriptorSql(con.motor).sesion.paginado.rejilla
    switch (forma) {
      case 'keyset':
        break
      case 'cursor':
      case 'rownum':
      case 'limitOffset':
      case 'offsetFetch':
        return null
      default:
        return nunca(forma, 'paginadoDe')
    }
    if (remoto || destino.tipo !== 'tabla') return { clave: null, aliasRowid: null }
    let alias: string | null = null
    // Sin catálogo no se sabe si la PK admite NULL: como si admitiera (el camino seguro).
    let pkConNulos = true
    try {
      const tabla = await this.columnasEdicion(conexionId, destino)
      alias = tabla.aliasRowid ?? null
      pkConNulos = tabla.claveAdmiteNulos !== false
    } catch (e) {
      this.c.log(`no se pudo leer la clave de paginado de ${conexionId}: ${mensajeDe(e).slice(0, 200)}`)
    }
    // Por la PK solo si NINGUNA de sus columnas admite NULL:
    // `pk > ?` detrás de una clave NULL no devuelve nada y la pestaña (y la exportación)
    // terminaban ahí, en silencio. Si no, por el rowid, que nunca es NULL; y sin rowid
    // legible, LIMIT/OFFSET.
    if (pk.length > 0 && !pkConNulos) return { clave: { tipo: 'pk', columnas: pk.slice() }, aliasRowid: alias }
    return { clave: alias ? { tipo: 'rowid', alias } : null, aliasRowid: alias }
  }

  /** Columnas con lo que no se puede escribir y las marcas de la tabla, cacheadas con el detalle. */
  private columnasEdicion(conexionId: string, ref: DbRefObjeto, refrescar = false): Promise<TablaEdicion> {
    return this.c.cache.memo(
      conexionId,
      claveConBase({ familia: 'detalle', esquema: ref.esquema, resto: [ref.nombre, 'edicion'] }, ref.base),
      () =>
        this.c.gestor.catalogo(
          conexionId,
          async (ctx) =>
            mapearTablaEdicion(
              ctx.dialecto.motor,
              await ctx.consultar(construir(() => sqlColumnasEdicion(ctx.dialecto, ref.esquema, ref.nombre)))
            ),
          conBase({ prioridad: 'alta' as const }, ref.base)
        ),
      refrescar
    )
  }

  /**
   * Nombre de columna -> tipo DECLARADO ('VARCHAR2(40 CHAR)') de una tabla
   * de Oracle (`sqlTiposColumnas`), para la cabecera de su pestaña de datos. En la caché del
   * detalle, así que un DDL de la consola o «Refrescar» lo invalidan como a lo demás.
   *
   * No lanza: un fallo del catálogo no puede tirar la apertura de la tabla por algo que solo
   * se ENSEÑA. Devuelve null y la cabecera se queda con el tipo del trabajador.
   */
  private async tiposDeclarados(conexionId: string, ref: DbRefObjeto, refrescar = false): Promise<Map<string, string> | null> {
    try {
      return await this.c.cache.memo(
        conexionId,
        claveConBase({ familia: 'detalle', esquema: ref.esquema, resto: [ref.nombre, 'tipos'] }, ref.base),
        () =>
          this.c.gestor.catalogo(
            conexionId,
            async (ctx) => {
              // El mapeador es del motor: no recibe el motor, y solo Oracle los lee.
              const catalogo = motorExplorador(ctx.dialecto.motor).catalogo
              return catalogo.mapearTiposColumnas(
                await ctx.consultar(construir(() => sqlTiposColumnas(ctx.dialecto, ref.esquema, ref.nombre)))
              )
            },
            conBase({ prioridad: 'alta' as const }, ref.base)
          ),
        refrescar
      )
    } catch (e) {
      this.c.log(`no se pudieron leer los tipos declarados de ${conexionId}: ${mensajeDe(e).slice(0, 200)}`)
      return null
    }
  }

  /** PG: la primera UNIQUE con todas sus columnas NOT NULL, o null. */
  private unicaNoNula(conexionId: string, ref: DbRefObjeto, refrescar = false): Promise<string[] | null> {
    return this.c.cache.memo(
      conexionId,
      claveConBase({ familia: 'detalle', esquema: ref.esquema, resto: [ref.nombre, 'unica'] }, ref.base),
      () =>
        this.c.gestor.catalogo(
          conexionId,
          async (ctx) => mapearUnicaNoNula(await ctx.consultar(construir(() => sqlUnicaNoNula(ctx.dialecto, ref.esquema, ref.nombre)))),
          conBase({ prioridad: 'alta' as const }, ref.base)
        ),
      refrescar
    )
  }

  /**
   * «Enviar» de la rejilla. El main NO se fía del renderer y comprueba, POR
   * ESTE ORDEN y antes de mandar nada: la forma; la conexión (solo lectura ->
   * `soloLectura`; producción sin `confirmado` -> 'produccion', ni una consulta al
   * catálogo); que la identidad recibida es la que el main calcula para esa tabla (si
   * la tabla cambió de clave desde que se abrió, se rechaza); que cada columna escrita
   * existe y es editable; y que cada clave cuadra (al construir la sentencia con la
   * MISMA función de la vista previa). Luego ejecuta el gestor, todo o nada.
   */
  async enviarCambios(req: unknown): Promise<DbRespuesta<DbResultadoEnvio>> {
    return this.c.seguro(async () => {
      const forma = validarFormaEnvio(req)
      if (!forma.ok) return fallo('interno', forma.mensaje)
      const v = forma.valor
      if (this.c.estado.hayEnPreparacion(v.conexionId, v.peticionId)) {
        return fallo('ocupada', 'Ya hay un envío con ese identificador en curso.')
      }
      // Desde aquí, un Stop con este `peticionId` se apunta (ver `enPreparacion`).
      return this.prepararDatos(v.conexionId, v.peticionId, async (detenido) => {
        const objeto = this.c.refObjeto(v.objeto, v.conexionId)
        if (TIPOS_CON_DATOS.indexOf(objeto.tipo) < 0) return fallo('interno', 'Ese objeto no tiene datos que editar.')
        const con = this.c.conexionOError(v.conexionId)
        if (this.roDe(con)) return fallo('soloLectura', MOTIVO_SOLO_LECTURA)
        if (exigeConfirmacion(con, this.roDe(con), v.confirmado)) return fallo('produccion', mensajeProduccion(con.alias, 'enviar'))
        let destino: DbRefObjeto = objeto
        let dblink: string | null = null
        if (objeto.tipo === 'sinonimo') {
          const r = await this.catalogo.resolverSinonimo(v.conexionId, objeto.esquema, objeto.nombre, objeto.base)
          destino = r.objeto
          dblink = r.dblink
        }
        const pk = dblink ? [] : await this.catalogo.clavePrimaria(v.conexionId, destino)
        const edicion = await this.edicionDe(v.conexionId, con, destino, dblink !== null, pk)
        if (edicion.identidad.tipo === 'ninguna') return fallo('interno', edicion.identidad.motivo)
        if (!mismaIdentidad(edicion.identidad, v.identidad)) {
          return fallo('interno', 'La tabla cambió desde que se abrió (ya no se identifican sus filas igual): vuelve a abrirla.')
        }
        const columnas = edicion.columnas ?? []
        const malo = validarCambios(edicion.identidad, v.cambios, columnas)
        if (malo) return fallo('interno', malo.mensaje)
        const preparado = prepararEnvio(con.motor, destino, edicion.identidad, v.cambios, columnas)
        if (!preparado.ok) return fallo('interno', preparado.mensaje)
        // Un Stop que llegó mientras se validaba: no se envía nada. Esto y la llamada al
        // gestor van en el MISMO turno, y el gestor registra la sesión del envío antes de
        // su primer `await`: desde entonces, el Stop ya la encuentra.
        if (detenido()) return fallo('cancelada', 'Envío detenido antes de empezar: no se aplicó nada.')
        return this.c.gestor.enviarCambios({
          conexionId: v.conexionId,
          peticionId: v.peticionId,
          confirmado: v.confirmado,
          sentencias: preparado.sentencias,
          // La DML se escribe con el nombre de dos partes (`dmlRejilla`): en una base
          // del nivel «Bases», la sesión del envío entra antes en ella.
          ...(destino.base ? { base: destino.base } : {})
        })
      })
    })
  }

  /**
   * Corre `preparar` con su petición apuntada (`EstadoExplorador.apuntarPreparacion`), que la
   * mira con `detenido()` justo antes de encolar en el gestor, en el mismo turno. La marca vive
   * hasta que la operación termina; desde que está en la cola del gestor ya no decide nada (el
   * Stop la encuentra allí).
   */
  private async prepararDatos<T>(
    conexionId: string,
    peticionId: string,
    preparar: (detenido: () => boolean) => Promise<DbRespuesta<T>>
  ): Promise<DbRespuesta<T>> {
    const marca = this.c.estado.apuntarPreparacion(conexionId, peticionId)
    try {
      return await preparar(marca.detenido)
    } finally {
      marca.soltar()
    }
  }

  async leerMas(lector: unknown, maxFilas: unknown, peticionId?: unknown): Promise<DbRespuesta<DbPagina>> {
    return this.c.seguro(async () =>
      this.c.gestor.leerMas(
        exigir(lector, 'lector', 200),
        typeof maxFilas === 'number' ? maxFilas : NaN,
        // Opcional: sin ella la página se lee igual, pero el Stop no la alcanza.
        opcional(peticionId, 'peticionId', 200)
      )
    )
  }

  async contar(lector: unknown, peticionId: unknown): Promise<DbRespuesta<number>> {
    return this.c.seguro(async () => this.c.gestor.contar(exigir(lector, 'lector', 200), exigir(peticionId, 'peticionId', 200)))
  }

  async cerrarLector(lector: unknown): Promise<void> {
    if (typeof lector === 'string' && lector) await this.c.gestor.cerrarLector(lector)
  }
}
