// =============================================================================
// Exportar a archivo en el main, sin electron: el diálogo de guardar (inyectado), la escritura por trozos a un temporal
// que se renombra al final y «Mostrar en la carpeta» por token. Recibe un productor de páginas y usa `crearEscritor`
// de `shared/formatosFilas.ts`, el mismo que «Copiar como».
// Decisiones: docs/decisiones/bd/sesiones-exportar-con-cursor-vivo.md
// =============================================================================

import { randomBytes } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type {
  DbCelda,
  DbColumnaResultado,
  DbExportado,
  DbFormatoFilas,
  DbProgresoExportacion
} from '../../../shared/db-explorador-ipc.ts'
import type { DbMotor } from '../../../shared/db-ipc.ts'
import { crearEscritor, EXTENSION_FORMATO, NOMBRE_FORMATO, type EscritorFilas } from '../../../shared/formatosFilas.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import { sanearNombreArchivo } from './ConsolasStore.ts'
import { ErrorGestor } from './GestorSesiones.ts'
import { EXPORTACIONES_RECORDADAS, PROGRESO_EXPORTACION_MS } from './limites.ts'

/** Una página que entrega el productor. `recortes` como en `DbPagina`. */
export interface PaginaExportacion {
  columnas: readonly DbColumnaResultado[]
  filasJson: string
  recortes?: ReadonlyArray<readonly [number, number, number]>
}

/**
 * Lo que produce las páginas. Llama a `consumir` por cada una, EN ORDEN, esperando a
 * que se escriba antes de leer la siguiente, y mira `cancelada()` entre páginas.
 * Lanza `ErrorGestor` si algo falla. Puede devolver un aviso (orden no estable…).
 */
export type ProductorExportacion = (
  consumir: (p: PaginaExportacion) => Promise<void>,
  cancelada: () => boolean
) => Promise<{ aviso?: string } | void>

export interface OpcionesDialogoGuardar {
  titulo: string
  /**
   * SOLO el nombre propuesto (saneado, con extensión), sin carpeta: la carpeta la
   * pone el envoltorio de diálogos del main (ver la cabecera).
   */
  nombrePropuesto: string
  filtros: Array<{ name: string; extensions: string[] }>
}

export interface DependenciasExportador {
  /**
   * El diálogo nativo de guardar: la ruta elegida o null si se canceló. `ventana` es
   * la de quien lo pidió, opaca aquí (este módulo no conoce los tipos de Electron).
   */
  guardar: (opciones: OpcionesDialogoGuardar, ventana: unknown) => Promise<string | null>
  /** Muestra el archivo en el gestor de archivos (`shell.showItemInFolder`). */
  revelar: (ruta: string) => void
  emitirProgreso: (p: DbProgresoExportacion) => void
  plataforma: Plataforma
  ahora?: () => number
  log?: (linea: string) => void
}

interface PeticionExportacionBase {
  peticionId: string
  formato: DbFormatoFilas
  nombreSugerido: string
  motor: DbMotor
  tablaInsert?: string
  /** Ventana sobre la que abrir el diálogo (la del emisor). */
  ventana?: unknown
}

/**
 * Una exportación. El productor llega hecho (`producir`) o lo arma `preparar`, que corre
 * con la exportación YA apuntada (ver la cabecera, STOP): validar el origen y leer del
 * catálogo la PK o el sinónimo ANTES del diálogo, con un Stop que vale desde el primer
 * momento. `preparar` recibe `cancelada()` para mirarlo entre sus pasos si quiere; el
 * exportador lo mira igualmente al acabar, antes de abrir el diálogo.
 */
export type PeticionExportacion = PeticionExportacionBase &
  (
    | { producir: ProductorExportacion; preparar?: undefined }
    | { preparar: (cancelada: () => boolean) => Promise<ProductorExportacion>; producir?: undefined }
  )

export const MENSAJE_EXPORTACION_CANCELADA = 'Exportación cancelada.'

/** Error de disco -> mensaje SIN la ruta que Node mete en `message`. */
export function mensajeFsExportacion(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  switch (code) {
    case 'ENOENT':
      return 'La carpeta de destino ya no existe.'
    case 'EACCES':
    case 'EPERM':
      return 'Sin permiso para escribir ahí, o el archivo está abierto en otro programa.'
    case 'EBUSY':
      return 'El archivo está abierto en otro programa: ciérralo y vuelve a exportar.'
    case 'ENOSPC':
      return 'No queda espacio en el disco.'
    case 'EROFS':
      return 'La carpeta de destino es de solo lectura.'
    case 'ENAMETOOLONG':
      return 'El nombre o la ruta del archivo son demasiado largos.'
    case 'EISDIR':
      return 'Ya hay una carpeta con ese nombre.'
    default:
      return typeof code === 'string' ? `Error de disco al exportar (${code}).` : 'Error de disco al exportar.'
  }
}

function esTransitorio(err: unknown): boolean {
  const c = (err as { code?: unknown } | null)?.code
  return c === 'EPERM' || c === 'EACCES' || c === 'EBUSY'
}

async function renombrarConReintentos(origen: string, destino: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(origen, destino)
      return
    } catch (err) {
      if (i >= 5 || !esTransitorio(err)) throw err
      await new Promise((r) => setTimeout(r, 40 * (i + 1)))
    }
  }
}

/** Filas de una página, validando la forma (el `filasJson` de `filas` llega del renderer). */
export function filasDePagina(filasJson: string): DbCelda[][] {
  let filas: unknown
  try {
    filas = JSON.parse(filasJson)
  } catch {
    throw new ErrorGestor('interno', 'Las filas a exportar no son válidas.')
  }
  if (!Array.isArray(filas) || !filas.every((f) => Array.isArray(f))) {
    throw new ErrorGestor('interno', 'Las filas a exportar no son válidas.')
  }
  return filas as DbCelda[][]
}

/** El estado de una escritura en curso: archivo temporal, escritor y contadores. */
interface Volcado {
  p: PeticionExportacionBase
  marca: { cancelada: boolean }
  fh: FileHandle | null
  escritor: EscritorFilas | null
  filas: number
  bytes: number
  recortadas: number
  ultimoProgreso: number
}

/** Escribe las páginas de un productor a un archivo: temporal en la misma carpeta y renombrado al final. */
export class Exportador {
  private readonly deps: DependenciasExportador
  /** token -> ruta, en orden de llegada (el más viejo sale primero). */
  private readonly tokens = new Map<string, string>()
  /** peticionId -> marca de Stop de las exportaciones en curso. */
  private readonly enCurso = new Map<string, { cancelada: boolean }>()

  constructor(deps: DependenciasExportador) {
    this.deps = deps
  }

  private ahora(): number {
    return this.deps.ahora ? this.deps.ahora() : Date.now()
  }

  private log(linea: string): void {
    try {
      this.deps.log?.(linea)
    } catch {
      // el registro no puede romper lo que registra
    }
  }

  /** Stop. Devuelve si había una exportación con ese id. */
  cancelar(peticionId: string): boolean {
    const e = this.enCurso.get(peticionId)
    if (!e) return false
    e.cancelada = true
    return true
  }

  /** ¿Hay una exportación con ese id en curso? */
  enMarcha(peticionId: string): boolean {
    return this.enCurso.has(peticionId)
  }

  /** «Mostrar en la carpeta». Un token desconocido (caducado) no hace nada. */
  revelar(token: string): void {
    const ruta = this.tokens.get(token)
    if (ruta === undefined) return
    try {
      this.deps.revelar(ruta)
    } catch (e) {
      this.log(`revelar exportación falló: ${e instanceof Error ? e.name : 'error'}`)
    }
  }

  private recordar(ruta: string): string {
    const token = randomBytes(12).toString('hex')
    this.tokens.set(token, ruta)
    while (this.tokens.size > EXPORTACIONES_RECORDADAS) {
      const viejo = this.tokens.keys().next().value
      if (viejo === undefined) break
      this.tokens.delete(viejo)
    }
    return token
  }

  /** Abre el diálogo; null si el usuario lo cancela. */
  private async elegirRuta(formato: DbFormatoFilas, nombreSugerido: string, ventana: unknown): Promise<string | null> {
    const ext = EXTENSION_FORMATO[formato]
    const nombre = sanearNombreArchivo(nombreSugerido, this.deps.plataforma) + '.' + ext
    const elegida = await this.deps.guardar(
      {
        titulo: `Exportar como ${NOMBRE_FORMATO[formato]}`,
        nombrePropuesto: nombre,
        filtros: [{ name: NOMBRE_FORMATO[formato], extensions: [ext] }]
      },
      ventana
    )
    if (!elegida) return null
    // Sin extensión (el diálogo de Linux no la añade), la del formato.
    return path.extname(elegida) === '' ? `${elegida}.${ext}` : elegida
  }

  /**
   * Exporta: preparación, diálogo, escritura por trozos a un temporal y renombrado.
   * null = el usuario canceló el diálogo. Lanza `ErrorGestor` (motivo `cancelada` con
   * Stop, en CUALQUIER tramo: preparando, con el diálogo abierto o escribiendo).
   */
  async exportar(p: PeticionExportacion): Promise<DbExportado | null> {
    if (this.enCurso.has(p.peticionId)) {
      throw new ErrorGestor('ocupada', 'Ya hay una exportación con ese identificador en curso.')
    }
    // Apuntada ANTES de nada y en este mismo turno: desde aquí un Stop con este id la
    // encuentra (ver la cabecera, STOP). Antes se apuntaba después del diálogo.
    const marca = { cancelada: false }
    this.enCurso.set(p.peticionId, marca)
    try {
      const cancelada = (): boolean => marca.cancelada
      const producir = p.preparar ? await p.preparar(cancelada) : p.producir
      if (marca.cancelada) throw new ErrorGestor('cancelada', MENSAJE_EXPORTACION_CANCELADA)
      const ruta = await this.elegirRuta(p.formato, p.nombreSugerido, p.ventana ?? null)
      if (ruta === null) return null
      // Un Stop con el diálogo abierto (la pestaña se cerró mientras tanto): no se escribe nada.
      if (marca.cancelada) throw new ErrorGestor('cancelada', MENSAJE_EXPORTACION_CANCELADA)
      return await this.volcar(p, producir, ruta, marca)
    } finally {
      this.enCurso.delete(p.peticionId)
    }
  }

  /** La escritura por trozos a un temporal y el renombrado (la exportación ya está apuntada). */
  private async volcar(
    p: PeticionExportacionBase,
    producir: ProductorExportacion,
    ruta: string,
    marca: { cancelada: boolean }
  ): Promise<DbExportado> {
    const temporal = `${ruta}.${randomBytes(4).toString('hex')}.part`
    // El primer progreso sale con la primera página escrita, sin esperar; los demás, con el tope.
    const v: Volcado = { p, marca, fh: null, escritor: null, filas: 0, bytes: 0, recortadas: 0, ultimoProgreso: Number.NEGATIVE_INFINITY }
    try {
      try {
        v.fh = await open(temporal, 'wx')
      } catch (err) {
        throw new ErrorGestor('interno', mensajeFsExportacion(err))
      }
      const resultado = await producir(
        (pagina) => this.escribirPagina(v, pagina),
        () => marca.cancelada
      )
      if (marca.cancelada) throw new ErrorGestor('cancelada', MENSAJE_EXPORTACION_CANCELADA)
      // Cierra el temporal y lo renombra al destino: solo entonces el archivo bueno existe. En el
      // cuerpo y no en una función `async` aparte, que sumaría turnos.
      try {
        if (!v.escritor) v.escritor = await this.iniciar(v, [])
        await this.escribir(v, v.escritor.fin())
        const cerrar = v.fh as FileHandle
        v.fh = null
        await cerrar.close()
        await renombrarConReintentos(temporal, ruta)
      } catch (err) {
        throw err instanceof ErrorGestor ? err : new ErrorGestor('interno', mensajeFsExportacion(err))
      }
      const exportado: DbExportado = { archivo: path.basename(ruta), filas: v.filas, bytes: v.bytes, token: this.recordar(ruta) }
      if (v.recortadas > 0) exportado.recortadas = v.recortadas
      if (resultado && resultado.aviso) exportado.aviso = resultado.aviso
      this.log(`exportadas ${v.filas} filas (${p.formato}, ${v.bytes} bytes)`)
      return exportado
    } catch (err) {
      if (v.fh) {
        try {
          await v.fh.close()
        } catch {
          // ya cerrado
        }
      }
      await unlink(temporal).catch(() => undefined)
      throw err
    }
  }

  private async escribir(v: Volcado, texto: string): Promise<void> {
    if (texto === '' || !v.fh) return
    await v.fh.write(texto, null, 'utf8')
    v.bytes += Buffer.byteLength(texto, 'utf8')
  }

  private async iniciar(v: Volcado, columnas: readonly DbColumnaResultado[]): Promise<EscritorFilas> {
    const e = crearEscritor(v.p.formato, columnas, {
      motor: v.p.motor,
      ...(v.p.tablaInsert ? { tablaInsert: v.p.tablaInsert } : {}),
      cabecera: true,
      bom: v.p.formato === 'csv',
      saltoFinal: v.p.formato === 'csv' || v.p.formato === 'tsv'
    })
    await this.escribir(v, e.inicio())
    return e
  }

  /** Escribe una página que entrega el productor y avisa del progreso. */
  private async escribirPagina(v: Volcado, pagina: PaginaExportacion): Promise<void> {
    if (v.marca.cancelada) throw new ErrorGestor('cancelada', MENSAJE_EXPORTACION_CANCELADA)
    const trozo = filasDePagina(pagina.filasJson)
    if (!v.escritor) v.escritor = await this.iniciar(v, pagina.columnas)
    try {
      await this.escribir(v, v.escritor.filas(trozo))
    } catch (err) {
      throw err instanceof ErrorGestor ? err : new ErrorGestor('interno', mensajeFsExportacion(err))
    }
    v.filas += trozo.length
    v.recortadas += pagina.recortes ? pagina.recortes.length : 0
    const t = this.ahora()
    if (t - v.ultimoProgreso >= PROGRESO_EXPORTACION_MS) {
      v.ultimoProgreso = t
      try {
        this.deps.emitirProgreso({ peticionId: v.p.peticionId, filas: v.filas })
      } catch {
        // el progreso es un extra
      }
    }
  }
}
