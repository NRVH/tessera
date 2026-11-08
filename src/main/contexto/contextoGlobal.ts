// =============================================================================
// El contexto global de los agentes en disco (`<userData>/contexto-global.json`): se lee una vez y se reescribe
// entero, con escritura atómica, al guardarlo. Si está ilegible se recupera del respaldo `.bak`; lo que no tiene
// forma se queda vacío al leerlo y se rechaza al guardarlo. Avisa a quien escuche al cambiar. Sin electron: la ruta llega por parámetro.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import { readFileSync } from 'node:fs'
import { CONTEXTO_GLOBAL_VACIO, leerContextoGlobal, type ContextoGlobal } from '../../shared/contexto.ts'
import { MAX_REGLAS_PERFIL, normalizarReglas } from '../../shared/reglasPerfil.ts'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'

export class AlmacenContextoGlobal {
  private readonly ruta: string
  private actual: ContextoGlobal
  private readonly oyentes = new Set<(c: ContextoGlobal) => void>()

  constructor(opts: { ruta: string; log?: (m: string) => void }) {
    this.ruta = opts.ruta
    this.actual = CONTEXTO_GLOBAL_VACIO
    try {
      this.actual = leerContextoGlobal(JSON.parse(readFileSync(opts.ruta, 'utf-8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      opts.log?.(`contexto global ilegible en ${opts.ruta}: ${String(err)}`)
      // Un cierre sucio puede dejarlo a medias: el respaldo que deja la escritura atómica tiene el anterior.
      try {
        this.actual = leerContextoGlobal(JSON.parse(readFileSync(`${opts.ruta}.bak`, 'utf-8')))
        opts.log?.('contexto global recuperado del respaldo .bak')
      } catch {
        // Sin respaldo legible se parte de vacío.
      }
    }
  }

  leer(): ContextoGlobal {
    return this.actual
  }

  /**
   * Guarda las partes recibidas sobre lo vigente, ya normalizadas, y devuelve el resultado: quien guarda las reglas
   * no puede vaciar los documentos por no conocerlos. Si no cambia nada, no escribe ni avisa.
   */
  guardar(raw: unknown): ContextoGlobal {
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    // Leer recorta lo que no tiene forma; guardar lo rechaza, para no cambiar unas reglas por nada sin decirlo.
    if ('reglas' in o && (typeof o.reglas !== 'string' || normalizarReglas(o.reglas).length > MAX_REGLAS_PERFIL)) {
      throw new Error(`las reglas globales no pueden pasar de ${MAX_REGLAS_PERFIL} caracteres`)
    }
    const nuevo = leerContextoGlobal({
      reglas: 'reglas' in o ? o.reglas : this.actual.reglas,
      documentos: 'documentos' in o ? o.documentos : this.actual.documentos
    })
    if (JSON.stringify(nuevo) === JSON.stringify(this.actual)) return this.actual
    writeFileAtomicSync(this.ruta, `${JSON.stringify(nuevo, null, 2)}\n`)
    this.actual = nuevo
    for (const o of this.oyentes) o(nuevo)
    return nuevo
  }

  alCambiar(oyente: (c: ContextoGlobal) => void): () => void {
    this.oyentes.add(oyente)
    return () => this.oyentes.delete(oyente)
  }
}
