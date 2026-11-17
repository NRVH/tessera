// =============================================================================
// Nombres propios de las conversaciones, puestos por el usuario, en un JSON aparte
// (`conversation-titles.json`, en userData) que se aplica encima del título derivado.
// El transcript no se toca: lo escriben los agentes y una reanudación lo reescribe.
// Sin electron: la ruta del archivo se la da quien crea la instancia.
// Decisiones: docs/decisiones/agentes/conversaciones-nombres-propios.md
// =============================================================================
import { existsSync, readFileSync } from 'node:fs'
import type { AgenteConversacion } from '../../shared/conversations-ipc'
import { escribirArchivoAtomico } from '../util/escrituraAtomica.ts'
import { recortarGraficos } from './recorteTitulo.ts'

/** Tope de un nombre propio en caracteres visibles (el título derivado se recorta a 100). */
const MAX_TITULO = 120

/** Mapa `<agente>:<id>` -> nombre propio. */
type MapaTitulos = Record<string, string>

/** Los nombres propios de las conversaciones sobre un archivo. */
export interface TitulosConversacion {
  /** Nombre propio de una conversación, o `undefined` si no se ha renombrado. */
  obtenerTituloPropio(agente: AgenteConversacion, id: string): string | undefined
  /**
   * Pone un nombre propio, o lo quita (`null` o vacío vuelve al título automático).
   * Devuelve el nombre efectivo, `undefined` si se quitó.
   */
  fijarTituloPropio(agente: AgenteConversacion, id: string, titulo: string | null): Promise<string | undefined>
  /** Olvida el nombre de una conversación borrada. */
  olvidarTituloPropio(agente: AgenteConversacion, id: string): Promise<void>
}

/** Clave de una conversación. Misma forma que el `seen` de LectorConversaciones. */
function clave(agente: AgenteConversacion, id: string): string {
  return `${agente}:${id}`
}

/** Lee un JSON de títulos; `null` si no existe o no se puede parsear. */
function leerMapa(ruta: string): MapaTitulos | null {
  if (!existsSync(ruta)) return null
  try {
    const crudo: unknown = JSON.parse(readFileSync(ruta, 'utf-8'))
    const salida: MapaTitulos = {}
    if (crudo && typeof crudo === 'object') {
      for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) salida[k] = v
      }
    }
    return salida
  } catch {
    return null
  }
}

/**
 * Siembra el mapa desde el disco. Un principal corrupto (un corte a media escritura) cae al
 * `.bak` que deja `escribirArchivoAtomico`; sin ninguno legible, arranca vacío sin lanzar.
 */
function leerTitulos(archivo: string): MapaTitulos {
  return leerMapa(archivo) ?? leerMapa(`${archivo}.bak`) ?? {}
}

/**
 * Crea los títulos sobre `archivo`. Tiene que ser UNA instancia por archivo: el estado y la
 * cadena de escrituras viven en ella, y dos instancias se pisarían.
 */
export function crearTitulosConversacion(archivo: string): TitulosConversacion {
  /** Fuente de verdad en memoria, sembrada perezosamente del disco. */
  let actual: MapaTitulos | null = null
  /** Cadena de escrituras: las serializa, porque el tmp de `escribirArchivoAtomico` es fijo por destino. */
  let cadenaEscrituras: Promise<void> = Promise.resolve()

  function asegurarActual(): MapaTitulos {
    actual ??= leerTitulos(archivo)
    return actual
  }

  /**
   * Escritura crash-safe (fsync, `.bak`, reintentos ante el bloqueo transitorio de un antivirus)
   * y serializada. Un fallo que sobreviva a los reintentos se registra y no corta la cadena.
   */
  function persistir(): Promise<void> {
    const foto = JSON.stringify(asegurarActual(), null, 2)
    cadenaEscrituras = cadenaEscrituras
      .then(() => escribirArchivoAtomico(archivo, foto))
      .catch((err) => {
        console.error('[conversations] no se pudo guardar los nombres:', err)
      })
    return cadenaEscrituras
  }

  async function fijarTituloPropio(
    agente: AgenteConversacion,
    id: string,
    titulo: string | null
  ): Promise<string | undefined> {
    const mapa = asegurarActual()
    const tituloLimpio = recortarGraficos((titulo ?? '').trim(), MAX_TITULO)
    if (!tituloLimpio) {
      if (!(clave(agente, id) in mapa)) return undefined
      delete mapa[clave(agente, id)]
      await persistir()
      return undefined
    }
    if (mapa[clave(agente, id)] === tituloLimpio) return tituloLimpio
    mapa[clave(agente, id)] = tituloLimpio
    await persistir()
    return tituloLimpio
  }

  return {
    obtenerTituloPropio: (agente, id) => asegurarActual()[clave(agente, id)],
    fijarTituloPropio,
    olvidarTituloPropio: async (agente, id) => {
      await fijarTituloPropio(agente, id, null)
    }
  }
}
