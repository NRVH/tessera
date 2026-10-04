// =============================================================================
// Avisos vivos de la consola SQL en Monaco: los amarillos léxicos (tras una pausa de
// tecleo, sobre la división del autocompletado) y el rojo de la gramática local, que
// responde el main. Cada uno con su dueño de marcadores. Lo reexporta `monacoConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-monaco.md
// =============================================================================

import type { editor } from 'monaco-editor'
import type { DbRespuesta, DbValidarSintaxis, VeredictoSintaxis } from '../../../../../shared/db-explorador-ipc.ts'
import { reglasDe, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import {
  CacheSintaxis,
  erroresDeSintaxis,
  fuenteSintaxis,
  loteDeSintaxis,
  pendientesDeSintaxis,
  sentenciasAValidar
} from '../../../../../shared/sql/sintaxisSql.ts'
import { analisisDe } from '../autocompletado/analisisModelo.ts'
import { ensureMonaco } from '../../../comun/monacoSetup.ts'
import { avisosVivos } from './vivoConsola.ts'

/** Dueño de los avisos léxicos. */
export const DUENO_AVISOS = 'tessera-sql-avisos'
/** Dueño de los errores de la gramática local (rojos, sin ejecutar). */
export const DUENO_SINTAXIS = 'tessera-sql-sintaxis'

/** Por encima de esto no se analiza mientras se escribe (sí al ejecutar). */
export const MAX_ANALISIS_VIVO = 2 * 1024 * 1024
/** Pausa de tecleo antes de recalcular los avisos. */
export const PAUSA_AVISOS_MS = 250

type ValidarSintaxis = (req: DbValidarSintaxis) => Promise<DbRespuesta<VeredictoSintaxis[]>>

/**
 * Recalcula los avisos amarillos (¿falta `;`?, cadena sin cerrar, escribe en una
 * conexión de solo lectura…) tras una pausa de tecleo. Las opciones se leen al
 * recalcular, así que un cambio de solo lectura de la conexión se nota en la próxima
 * pausa sin volver a crear el validador.
 */
export class ValidadorAvisos {
  private temporizador: ReturnType<typeof setTimeout> | null = null
  private cerrado = false
  /** Veredictos de la gramática local por texto de sentencia. */
  private readonly cacheSintaxis = new CacheSintaxis()
  /** Número de la última petición de gramática: una respuesta vieja no pinta. */
  private peticionSintaxis = 0

  constructor(
    private readonly modelo: editor.ITextModel,
    private readonly opciones: () => { dialecto: DialectoSql; soloLectura: boolean },
    /** `CONSOLA_SINTAXIS`; sin él no hay subrayado de gramática. */
    private readonly validarSintaxis?: ValidarSintaxis
  ) {}

  programar(): void {
    if (this.cerrado) return
    if (this.temporizador !== null) clearTimeout(this.temporizador)
    this.temporizador = setTimeout(() => {
      this.temporizador = null
      this.ahora()
    }, PAUSA_AVISOS_MS)
  }

  ahora(): void {
    if (this.cerrado || this.modelo.isDisposed()) return
    const monaco = ensureMonaco()
    const { dialecto, soloLectura } = this.opciones()
    // La división es la del autocompletado (`analisisDe`, una por versión): ver
    // `avisosVivos`. null = pasa del tope y no se analiza.
    const avisos = avisosVivos(this.modelo, dialecto, soloLectura, MAX_ANALISIS_VIVO)
    if (avisos === null) {
      monaco.editor.setModelMarkers(this.modelo, DUENO_AVISOS, [])
      this.limpiarSintaxis()
      return
    }
    const marcadores: editor.IMarkerData[] = avisos.map((a) => {
      const ini = this.modelo.getPositionAt(a.desde)
      const fin = this.modelo.getPositionAt(Math.max(a.desde + 1, a.hasta))
      return {
        severity: monaco.MarkerSeverity.Warning,
        message: a.mensaje,
        startLineNumber: ini.lineNumber,
        startColumn: ini.column,
        endLineNumber: fin.lineNumber,
        endColumn: fin.column
      }
    })
    monaco.editor.setModelMarkers(this.modelo, DUENO_AVISOS, marcadores)
    this.gramatica(dialecto)
  }

  /**
   * El subrayado ROJO de la gramática local, sobre la MISMA división que los avisos
   * (ver `shared/sql/sintaxisSql.ts`). Solo se piden al main las sentencias que la caché
   * no sabe; la respuesta pinta solo si el modelo sigue en la versión que se pidió (si
   * no, la pausa siguiente vuelve a pasar por aquí y ya las tiene en la caché).
   */
  private gramatica(dialecto: DialectoSql): void {
    const monaco = ensureMonaco()
    const g = reglasDe(dialecto).gramaticaLocal
    if (g === null || !this.validarSintaxis) {
      this.limpiarSintaxis()
      return
    }
    const analisis = analisisDe(this.modelo, dialecto)
    const aValidar = sentenciasAValidar(analisis.sentencias, dialecto)
    const pintar = (): void => {
      if (this.cerrado || this.modelo.isDisposed() || this.modelo.getVersionId() !== analisis.version) return
      const errores = erroresDeSintaxis(analisis.texto, aValidar, this.cacheSintaxis, dialecto)
      const fuente = fuenteSintaxis(g)
      monaco.editor.setModelMarkers(
        this.modelo,
        DUENO_SINTAXIS,
        errores.map((e) => {
          const ini = this.modelo.getPositionAt(e.desde)
          const fin = this.modelo.getPositionAt(e.hasta)
          return {
            severity: monaco.MarkerSeverity.Error,
            message: e.mensaje,
            source: fuente,
            startLineNumber: ini.lineNumber,
            startColumn: ini.column,
            endLineNumber: fin.lineNumber,
            endColumn: fin.column
          }
        })
      )
    }
    const todos = pendientesDeSintaxis(aValidar, this.cacheSintaxis)
    if (todos.length === 0) {
      pintar()
      return
    }
    // Por lotes que quepan en una petición; si quedan más, otra pausa pide el siguiente.
    const pendientes = loteDeSintaxis(todos)
    const quedan = pendientes.length < todos.length
    const n = ++this.peticionSintaxis
    this.validarSintaxis({ gramatica: g, textos: pendientes })
      .then((r) => {
        if (r.ok) r.valor.forEach((v, i) => this.cacheSintaxis.guardar(pendientes[i], v))
        if (n !== this.peticionSintaxis) return
        pintar()
        if (r.ok && quedan) this.programar()
      })
      .catch(() => undefined)
  }

  /**
   * Quita el rojo de la gramática y deja sin efecto la petición en vuelo: sin subir el
   * número, una respuesta que llegara después (la conexión cambió de motor sin cambiar el
   * texto, así que la versión del modelo es la misma) volvería a pintarlo.
   */
  private limpiarSintaxis(): void {
    this.peticionSintaxis++
    ensureMonaco().editor.setModelMarkers(this.modelo, DUENO_SINTAXIS, [])
  }

  dispose(): void {
    this.cerrado = true
    if (this.temporizador !== null) clearTimeout(this.temporizador)
    this.temporizador = null
    if (!this.modelo.isDisposed()) {
      ensureMonaco().editor.setModelMarkers(this.modelo, DUENO_AVISOS, [])
      ensureMonaco().editor.setModelMarkers(this.modelo, DUENO_SINTAXIS, [])
    }
  }
}
