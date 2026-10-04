// =============================================================================
// Nombres propios de las conversaciones, puestos por el usuario, en un JSON aparte
// (`conversation-titles.json`, en userData) que se aplica encima del título derivado.
// El transcript no se toca: lo escriben los agentes y una reanudación lo reescribe.
// Sin electron: la ruta del archivo se la da quien crea la instancia.
// Decisiones: docs/decisiones/agentes/conversaciones-nombres-propios.md
// =============================================================================
import { existsSync, readFileSync } from 'node:fs'
import type { ConvAgent } from '../../shared/conversations-ipc'
import { writeFileAtomic } from '../util/atomicWrite.ts'
import { recortarGraficos } from './recorteTitulo.ts'

/** Tope de un nombre propio en caracteres visibles (el título derivado se recorta a 100). */
const TITLE_MAX = 120

/** Mapa `<agente>:<id>` -> nombre propio. */
type TitleMap = Record<string, string>

/** Los nombres propios de las conversaciones sobre un archivo. */
export interface TitulosConversacion {
  /** Nombre propio de una conversación, o `undefined` si no se ha renombrado. */
  getCustomTitle(agente: ConvAgent, id: string): string | undefined
  /**
   * Pone un nombre propio, o lo quita (`null` o vacío vuelve al título automático).
   * Devuelve el nombre efectivo, `undefined` si se quitó.
   */
  setCustomTitle(agente: ConvAgent, id: string, title: string | null): Promise<string | undefined>
  /** Olvida el nombre de una conversación borrada. */
  forgetCustomTitle(agente: ConvAgent, id: string): Promise<void>
}

/** Clave de una conversación. Misma forma que el `seen` de ConversationsReader. */
function key(agente: ConvAgent, id: string): string {
  return `${agente}:${id}`
}

/** Lee un JSON de títulos; `null` si no existe o no se puede parsear. */
function leerMapa(ruta: string): TitleMap | null {
  if (!existsSync(ruta)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(ruta, 'utf-8'))
    const out: TitleMap = {}
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) out[k] = v
      }
    }
    return out
  } catch {
    return null
  }
}

/**
 * Siembra el mapa desde el disco. Un principal corrupto (un corte a media escritura) cae al
 * `.bak` que deja `writeFileAtomic`; sin ninguno legible, arranca vacío sin lanzar.
 */
function leerTitulos(archivo: string): TitleMap {
  return leerMapa(archivo) ?? leerMapa(`${archivo}.bak`) ?? {}
}

/**
 * Crea los títulos sobre `archivo`. Tiene que ser UNA instancia por archivo: el estado y la
 * cadena de escrituras viven en ella, y dos instancias se pisarían.
 */
export function crearTitulosConversacion(archivo: string): TitulosConversacion {
  /** Fuente de verdad en memoria, sembrada perezosamente del disco. */
  let current: TitleMap | null = null
  /** Cadena de escrituras: las serializa, porque el tmp de `writeFileAtomic` es fijo por destino. */
  let writeChain: Promise<void> = Promise.resolve()

  function ensureCurrent(): TitleMap {
    current ??= leerTitulos(archivo)
    return current
  }

  /**
   * Escritura crash-safe (fsync, `.bak`, reintentos ante el bloqueo transitorio de un antivirus)
   * y serializada. Un fallo que sobreviva a los reintentos se registra y no corta la cadena.
   */
  function persist(): Promise<void> {
    const snapshot = JSON.stringify(ensureCurrent(), null, 2)
    writeChain = writeChain
      .then(() => writeFileAtomic(archivo, snapshot))
      .catch((err) => {
        console.error('[conversations] no se pudo guardar los nombres:', err)
      })
    return writeChain
  }

  async function setCustomTitle(
    agente: ConvAgent,
    id: string,
    title: string | null
  ): Promise<string | undefined> {
    const map = ensureCurrent()
    const clean = recortarGraficos((title ?? '').trim(), TITLE_MAX)
    if (!clean) {
      if (!(key(agente, id) in map)) return undefined
      delete map[key(agente, id)]
      await persist()
      return undefined
    }
    if (map[key(agente, id)] === clean) return clean
    map[key(agente, id)] = clean
    await persist()
    return clean
  }

  return {
    getCustomTitle: (agente, id) => ensureCurrent()[key(agente, id)],
    setCustomTitle,
    forgetCustomTitle: async (agente, id) => {
      await setCustomTitle(agente, id, null)
    }
  }
}
