// =============================================================================
// El DML de «Enviar»: de un cambio pendiente de la rejilla, la sentencia que lo aplica (con binds) y la
// misma con los valores a la vista para la vista previa. Un solo constructor para el renderer y el main;
// al ejecutar, siempre binds y nombres citados. Lo propio de cada motor sale de las reglas del dialecto
// y del descriptor. Puro, neutral y ES2020.
// Decisiones: docs/decisiones/bd/sql-dml-rejilla-un-constructor.md
// =============================================================================

import type { DbMotor } from '../db-ipc'
import type {
  DbCambioFila,
  DbCelda,
  DbIdentidadFila,
  DbOriginalesFila,
  DbTipoLogico,
  DbValorEdicion
} from '../db-explorador-ipc'
import { escrituraSql, type TerminadorSql } from '../escrituraSql/index.ts'
import { literalComparacionSql, literalSql } from '../formatosFilas.ts'
import { descriptorSql, etiquetasSqlDonde, type DescriptorSql } from '../motores/index.ts'
import { nunca } from '../nunca.ts'
import { dialectoDeMotor, marcadorPosicional, reglasDeMotor } from './dialectosSql.ts'
import { citar as citarNombre } from './identificadoresSql.ts'

/**
 * Nombre de la columna OCULTA con el ROWID de Oracle (`ROWIDTOCHAR(ROWID)`), la ÚLTIMA
 * del resultado de una tabla sin clave: el main la pide (`sqlRejilla.ts`) y la rejilla
 * no la pinta ni deja editarla. Vive aquí, UNA vez, porque si cada lado tuviera su
 * copia y una cambiara, la rejilla enseñaría el ROWID como una columna editable sin que
 * ningún test ni el compilador lo notaran.
 */
export const COLUMNA_ROWID = '__TESSERA_ROWID'

export interface SentenciaDml {
  /** Con marcadores de bind: lo que se ejecuta. */
  sql: string
  /** Los valores de los marcadores, en su orden. */
  binds: DbValorEdicion[]
  /**
   * La columna que recibe cada bind, en el MISMO orden que `binds` (`null` = el ROWID);
   * la de un original es la columna con la que se compara. La usa el main para el tipo
   * del bind (CLOB) y las claves binarias; ver la cabecera.
   */
  columnas: Array<string | null>
  /** Con los valores escritos como literales: lo que se ENSEÑA (nunca se ejecuta). */
  vista: string
  /**
   * Lo que cierra `vista` en un guion: `;` tras una sentencia, y la `/` en su línea tras un
   * bloque (la sentencia de Oracle con un nombre que SQL*Plus rompería va en un bloque con
   * EXECUTE IMMEDIATE: ver la cabecera, NOMBRES QUE SQL*PLUS ROMPE).
   */
  terminador: TerminadorSql
}

export interface ObjetoDml {
  esquema: string
  nombre: string
}

/** Error de construcción: el mensaje es para el usuario. */
export class ErrorDml extends Error {}

function marcador(motor: DbMotor, n: number): string {
  return marcadorPosicional(dialectoDeMotor(motor), n)
}

/**
 * ¿Identifica el motor la fila sin clave por su ROWID? Un `switch` que cierra con `nunca`, y
 * no un `=== 'rowid'`: con un tercer valor de `identidadSinPk` esta línea deja de compilar,
 * en vez de caer en silencio en la rama «no tiene ROWID».
 */
function identificaPorRowid(d: DescriptorSql): boolean {
  const identidad = d.sesion.identidadSinPk
  switch (identidad) {
    case 'rowid':
      return true
    case 'unicaNoNula':
      return false
    default:
      return nunca(identidad, 'identificaPorRowid')
  }
}

/**
 * Por qué no se identifica por ROWID en un motor que no lo hace: nombra los motores del
 * registro que SÍ (`etiquetasDonde`), no uno escrito a mano. Con los de hoy, «ROWID solo
 * existe en Oracle.», el texto de siempre; sin ninguno, no deja la frase a medias («…existe
 * en .»), igual que `mensajeSinRowid` de `sqlRejilla.ts` en el main.
 */
function mensajeSinRowid(): string {
  const donde = etiquetasSqlDonde(identificaPorRowid)
  return donde === '' ? 'Ningún motor identifica las filas por su ROWID.' : `ROWID solo existe en ${donde}.`
}

/** Un valor de la clave leído de la rejilla, como texto de bind. */
function valorDeClave(v: DbCelda, columna: string): string {
  if (v === null || v === undefined) {
    throw new ErrorDml(`La clave de la fila tiene «${columna}» vacío (NULL): no se puede encontrar la fila.`)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v
}

/**
 * Un valor de `originales` como texto de bind. Llega por IPC, así que se comprueba en
 * vez de fiarse del tipo: lo que no es texto ni NULL no se sabe comparar, y adivinar
 * aquí (un número de JS con otro formato, un objeto) daría un «la fila cambió» falso o,
 * peor, una comparación que casa de más. Un booleano se escribe como la clave.
 */
function valorOriginal(v: unknown, columna: string): DbValorEdicion {
  if (v === null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  throw new ErrorDml(`El valor leído de «${columna}» no es texto: no se puede comprobar si la fila cambió.`)
}

class Constructor {
  private readonly binds: DbValorEdicion[] = []
  private readonly columnas: Array<string | null> = []
  /**
   * Los nombres citados, tal cual: lo que el cliente de línea del motor puede romper en la
   * vista previa (ver la cabecera, NOMBRES QUE SQL*PLUS ROMPE). Lo decide el motor.
   */
  private readonly nombres: string[] = []
  private readonly motor: DbMotor
  private readonly tipos: Readonly<Record<string, DbTipoLogico | undefined>>
  // Sin propiedades de parámetro (`private readonly motor` en la firma): el
  // type-stripping de Node, con el que corren los tests, no las admite.
  constructor(motor: DbMotor, tipos: Readonly<Record<string, DbTipoLogico | undefined>>) {
    this.motor = motor
    this.tipos = tipos
  }

  /**
   * Un nombre citado como lo cita su motor (`"x"`; en SQL Server `[x]`), y lo anota para la
   * vista previa (ver la cabecera).
   */
  citar(nombre: string): string {
    this.nombres.push(nombre)
    return citarNombre(nombre, dialectoDeMotor(this.motor))
  }

  /**
   * Añade un bind y devuelve [marcador, literal para la vista]. `comparacion`: el valor
   * va en el WHERE (`"COL" = …`), y su literal no puede ser un CLOB (ver la cabecera).
   */
  valor(v: DbValorEdicion, columna: string | null, comparacion = false): [string, string] {
    this.binds.push(v)
    this.columnas.push(columna)
    const tipo = columna === null ? undefined : this.tipos[columna]
    const literal = comparacion ? literalComparacionSql(v, tipo, this.motor) : literalSql(v, tipo, this.motor)
    return [marcador(this.motor, this.binds.length), literal]
  }

  donde(identidad: DbIdentidadFila, clave: readonly DbCelda[], originales?: DbOriginalesFila): [string, string] {
    const [sql, vista] = this.dondeIdentidad(identidad, clave)
    // Las comprobaciones de concurrencia van DESPUÉS de la identidad: sus binds se
    // numeran tras los del SET y la clave, y la vista se lee «qué fila» y luego «con
    // qué valores».
    const [oSql, oVista] = this.dondeOriginales(originales)
    return [[sql, ...oSql].join(' AND '), [vista, ...oVista].join(' AND ')]
  }

  private dondeIdentidad(identidad: DbIdentidadFila, clave: readonly DbCelda[]): [string, string] {
    if (identidad.tipo === 'ninguna') throw new ErrorDml(identidad.motivo || 'Esta tabla no se puede editar.')
    if (identidad.tipo === 'rowid') {
      // Lo que no identifique la fila sin clave por su ROWID, lanza: nunca un `ROWID = …`
      // contra un motor que no lo tiene. El mensaje nombra los motores que SÍ lo tienen,
      // del registro (hoy, «ROWID solo existe en Oracle.», como siempre).
      if (!identificaPorRowid(descriptorSql(this.motor))) throw new ErrorDml(mensajeSinRowid())
      if (clave.length !== 1) throw new ErrorDml('La clave de la fila no cuadra con su ROWID.')
      const [m, l] = this.valor(valorDeClave(clave[0], 'ROWID'), null, true)
      return [`ROWID = ${m}`, `ROWID = ${l}`]
    }
    if (identidad.columnas.length === 0) throw new ErrorDml('La tabla no tiene clave con la que encontrar la fila.')
    if (clave.length !== identidad.columnas.length) {
      throw new ErrorDml('La clave de la fila no cuadra con la clave de la tabla: vuelve a abrirla.')
    }
    const sql: string[] = []
    const vista: string[] = []
    identidad.columnas.forEach((c, i) => {
      const [m, l] = this.valor(valorDeClave(clave[i], c), c, true)
      sql.push(`${this.citar(c)} = ${m}`)
      vista.push(`${this.citar(c)} = ${l}`)
    })
    return [sql.join(' AND '), vista.join(' AND ')]
  }

  /**
   * Las condiciones de concurrencia optimista: una por columna de `originales`, en su
   * orden (ver la cabecera). NULL —y en Oracle también '', que allí ES NULL— va como
   * `IS NULL` sin bind; el resto, `"COL" = :n`, que compara en el tipo de la COLUMNA.
   */
  private dondeOriginales(originales: DbOriginalesFila | undefined): [string[], string[]] {
    const sql: string[] = []
    const vista: string[] = []
    if (!originales) return [sql, vista]
    for (const c of Object.keys(originales)) {
      // La columna oculta del ROWID no existe en la tabla: `"__TESSERA_ROWID" = :n`
      // tumbaría el envío entero con ORA-00904. El ROWID ya va en la identidad.
      if (c === COLUMNA_ROWID) continue
      const v = valorOriginal(originales[c], c)
      if (v === null || (v === '' && reglasDeMotor(this.motor).cadenaVaciaEsNull)) {
        sql.push(`${this.citar(c)} IS NULL`)
        vista.push(`${this.citar(c)} IS NULL`)
        continue
      }
      const [m, l] = this.valor(v, c, true)
      sql.push(`${this.citar(c)} = ${m}`)
      vista.push(`${this.citar(c)} = ${l}`)
    }
    return [sql, vista]
  }

  resultado(sql: string, vista: string): SentenciaDml {
    // CÓMO SE ENSEÑA lo decide el motor (la de Oracle con un nombre que SQL*Plus rompe va en
    // un bloque con EXECUTE IMMEDIATE: ver la cabecera). Lo que se EJECUTA (`sql`, con
    // binds) no cambia: el driver manda el texto entero y no pasa por el cliente de línea.
    const v = escrituraSql(this.motor, 'sentenciaDeCambio').vistaDml(vista, this.nombres)
    return { sql, binds: this.binds.slice(), columnas: this.columnas.slice(), vista: v.vista, terminador: v.terminador }
  }
}

/**
 * La sentencia de UN cambio. `tipos` (por nombre de columna) solo afina los literales de
 * la vista previa; la ejecución va con binds de texto. Lanza `ErrorDml` si el cambio no
 * se puede aplicar (identidad 'ninguna', clave con NULL, UPDATE sin columnas…).
 */
export function sentenciaDeCambio(
  motor: DbMotor,
  objeto: ObjetoDml,
  identidad: DbIdentidadFila,
  cambio: DbCambioFila,
  tipos: Readonly<Record<string, DbTipoLogico | undefined>> = {}
): SentenciaDml {
  const k = new Constructor(motor, tipos)
  const tabla = `${k.citar(objeto.esquema)}.${k.citar(objeto.nombre)}`
  switch (cambio.tipo) {
    case 'actualizar': {
      const columnas = Object.keys(cambio.valores)
      if (columnas.length === 0) throw new ErrorDml('No hay ninguna celda cambiada en la fila.')
      const setSql: string[] = []
      const setVista: string[] = []
      for (const c of columnas) {
        const [m, l] = k.valor(cambio.valores[c], c)
        setSql.push(`${k.citar(c)} = ${m}`)
        setVista.push(`${k.citar(c)} = ${l}`)
      }
      const [dSql, dVista] = k.donde(identidad, cambio.clave, cambio.originales)
      return k.resultado(
        `UPDATE ${tabla} SET ${setSql.join(', ')} WHERE ${dSql}`,
        `UPDATE ${tabla} SET ${setVista.join(', ')} WHERE ${dVista}`
      )
    }
    case 'insertar': {
      const columnas = Object.keys(cambio.valores)
      if (columnas.length === 0) {
        if (!reglasDeMotor(motor).insertDefaultValues) throw new ErrorDml('La fila nueva no tiene ningún valor.')
        return k.resultado(`INSERT INTO ${tabla} DEFAULT VALUES`, `INSERT INTO ${tabla} DEFAULT VALUES`)
      }
      const marcas: string[] = []
      const literales: string[] = []
      for (const c of columnas) {
        const [m, l] = k.valor(cambio.valores[c], c)
        marcas.push(m)
        literales.push(l)
      }
      const lista = columnas.map((c) => k.citar(c)).join(', ')
      return k.resultado(
        `INSERT INTO ${tabla} (${lista}) VALUES (${marcas.join(', ')})`,
        `INSERT INTO ${tabla} (${lista}) VALUES (${literales.join(', ')})`
      )
    }
    case 'borrar': {
      const [dSql, dVista] = k.donde(identidad, cambio.clave, cambio.originales)
      return k.resultado(`DELETE FROM ${tabla} WHERE ${dSql}`, `DELETE FROM ${tabla} WHERE ${dVista}`)
    }
  }
}

/** La vista de una sentencia CON su terminador (`;`, o la `/` de un bloque): lo que va en el guion. */
export function vistaTerminada(s: Pick<SentenciaDml, 'vista' | 'terminador'>): string {
  return s.vista + s.terminador
}

/**
 * La vista previa de todos los cambios, una sentencia por línea terminada en `;` (o un bloque
 * terminado en `/`, con un nombre que SQL*Plus rompería).
 */
export function vistaPreviaDml(
  motor: DbMotor,
  objeto: ObjetoDml,
  identidad: DbIdentidadFila,
  cambios: readonly DbCambioFila[],
  tipos: Readonly<Record<string, DbTipoLogico | undefined>> = {}
): string {
  return cambios.map((c) => vistaTerminada(sentenciaDeCambio(motor, objeto, identidad, c, tipos))).join('\n')
}
