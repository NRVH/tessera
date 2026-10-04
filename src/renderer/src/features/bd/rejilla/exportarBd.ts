// =============================================================================
// Exportar a archivo, la parte pura: el id de cada exportación, los textos que la cuentan
// (la píldora mientras escribe y el aviso final, con el gestor de archivos y la base del
// tamaño de la plataforma que se pasa) y el repartidor que da el progreso del main a su
// exportación desde UNA sola suscripción. Neutral: la usan `useExportarBd` y su test.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-exportar.md
// =============================================================================

import type { Plataforma } from '../../../../../shared/plataforma.ts'
import type { DbExportado, DbFormatoFilas, DbProgresoExportacion } from '../../../../../shared/db-explorador-ipc.ts'
import { nombresSistema } from '../../../../../shared/nombresSistema.ts'
import { formatoEntero } from './celdasRejilla.ts'

let contador = 0

/** Id opaco de una exportación: único en el renderer y sin nada que se pueda adivinar. */
export function nuevoIdExportacion(): string {
  contador++
  return `exportar-${Date.now().toString(36)}-${contador.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const UNIDADES = ['KB', 'MB', 'GB', 'TB']

/**
 * Tamaño de un archivo como lo diría el gestor de archivos del sistema: «850 bytes»,
 * «1,2 MB», «12 MB» (sin «,0»). Base 1000 en Mac y 1024 en el resto (ver la cabecera).
 */
export function formatoTamano(bytes: number, plataforma: Plataforma): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? Math.trunc(bytes) : 0
  const base = plataforma === 'mac' ? 1000 : 1024
  if (b < base) return `${formatoEntero(b)} ${b === 1 ? 'byte' : 'bytes'}`
  let v = b / base
  let u = 0
  while (v >= base && u < UNIDADES.length - 1) {
    v /= base
    u++
  }
  // Una cifra decimal por debajo de 100 («1,2 MB»); por encima, entera («250 MB»).
  const texto = v < 100 ? v.toFixed(1).replace(/\.0$/, '').replace('.', ',') : String(Math.round(v))
  return `${texto} ${UNIDADES[u]}`
}

export interface AvisoExportado {
  /**
   * `warn` si el archivo NO es exactamente la tabla: celdas recortadas o páginas sin
   * orden estable. El archivo sirve, pero un aviso verde que dura 3 s escondería eso.
   */
  tipo: 'success' | 'warn'
  titulo: string
  detalle: string
  /** Etiqueta de la acción del aviso: «Mostrar en <gestor de archivos>». */
  accion: string
}

/** El aviso de una exportación terminada. */
export function avisoExportado(r: DbExportado, plataforma: Plataforma): AvisoExportado {
  const titulo =
    r.filas === 1 ? `Exportada 1 fila a ${r.archivo}` : `Exportadas ${formatoEntero(r.filas)} filas a ${r.archivo}`
  const partes = [formatoTamano(r.bytes, plataforma)]
  const recortadas = r.recortadas ?? 0
  if (recortadas > 0) {
    partes.push(
      recortadas === 1
        ? '1 celda pasaba de 16 MiB y se escribió recortada'
        : `${formatoEntero(recortadas)} celdas pasaban de 16 MiB y se escribieron recortadas`
    )
  }
  if (r.aviso) partes.push(r.aviso)
  return {
    tipo: recortadas > 0 || r.aviso ? 'warn' : 'success',
    titulo,
    detalle: partes.join(' · '),
    accion: `Mostrar en ${nombresSistema(plataforma).gestorArchivos}`
  }
}

/** Lo que dice la píldora mientras se escribe el archivo. */
export function textoExportando(filas: number): string {
  if (!Number.isFinite(filas) || filas <= 0) return 'Exportando…'
  return `Exportando: ${formatoEntero(filas)} ${filas === 1 ? 'fila' : 'filas'}`
}

/** Aviso de una exportación detenida (Stop, o la pestaña que la lanzó se cerró). */
export function avisoDetenida(porCierre: boolean): { titulo: string; detalle?: string } {
  return porCierre
    ? { titulo: 'Exportación detenida', detalle: 'Se cerró la pestaña que la lanzó.' }
    : { titulo: 'Exportación detenida' }
}

/** Recibe las filas escritas de UNA exportación. */
export type OyenteProgreso = (filas: number) => void

/** Una suscripción a un canal de progreso; devuelve la baja. */
export type SuscribirProgreso = (cb: (e: DbProgresoExportacion) => void) => () => void

export interface RepartidorProgreso {
  /** Escucha el progreso de `peticionId` hasta llamar a la baja que devuelve (idempotente). */
  escuchar(peticionId: string, oyente: OyenteProgreso): () => void
  /** Cuántas exportaciones se escuchan ahora. */
  readonly escuchando: number
}

/**
 * Un solo oyente en el canal para todas las exportaciones, y cada progreso a la suya
 * por `peticionId` (ver la cabecera). El canal se suscribe con la primera escucha y se
 * da de baja cuando se va la última: sin exportaciones, cero oyentes.
 */
export function crearRepartidorProgreso(suscribir: SuscribirProgreso): RepartidorProgreso {
  const oyentes = new Map<string, OyenteProgreso>()
  let baja: (() => void) | null = null

  const repartir = (e: DbProgresoExportacion): void => {
    if (!e || typeof e.peticionId !== 'string') return
    const oyente = oyentes.get(e.peticionId)
    if (oyente) oyente(e.filas)
  }

  return {
    escuchar(peticionId, oyente) {
      if (baja === null) baja = suscribir(repartir)
      oyentes.set(peticionId, oyente)
      let activa = true
      return () => {
        if (!activa) return
        activa = false
        // Solo la suya: un id repetido que la sustituyó sigue escuchando.
        if (oyentes.get(peticionId) === oyente) oyentes.delete(peticionId)
        if (oyentes.size === 0 && baja !== null) {
          const b = baja
          baja = null
          b()
        }
      }
    },
    get escuchando() {
      return oyentes.size
    }
  }
}

/** Orden de los formatos en los menús de exportar: el más usado primero. */
export const FORMATOS_EXPORTAR: readonly DbFormatoFilas[] = ['csv', 'tsv', 'json', 'insert', 'markdown']

/** Los de «Copiar como»: TSV ya lo cubren «Copiar» y «Copiar con cabeceras». */
export const FORMATOS_COPIAR_COMO: readonly DbFormatoFilas[] = ['csv', 'json', 'insert', 'markdown']
