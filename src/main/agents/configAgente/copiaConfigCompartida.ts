// =============================================================================
// El contexto de los agentes en la copia de la configuración: qué se lleva (del nivel global, sus reglas y su
// configuración técnica de Docker; de cada perfil exportado, su configuración técnica, porque sus reglas viajan
// con él), cómo queda cada nivel frente al de este equipo (traerlo, igual o distinto) y cómo se escribe el
// elegido, con la sintaxis comprobada y la versión anterior guardada. Las carpetas de documentos no viajan: son
// rutas de este equipo. Sin electron.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md, docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import { ARCHIVOS_CONFIG_AGENTE, MAX_BYTES_CONFIG_AGENTE, type AgenteConConfig, type CapaCompartida } from '../../../shared/configAgente-ipc.ts'
import type { EstadoConfigDocker, PreviaConfigDocker } from '../../../shared/copia-configuracion-ipc.ts'
import type { ContextoGlobal } from '../../../shared/contexto.ts'
import { MAX_REGLAS_PERFIL, normalizarReglas } from '../../../shared/reglasPerfil.ts'
import { join } from 'node:path'
import { carpetaCapa } from './configCompartida.ts'
import { leerDeDisco, ServicioConfigAgente } from './ServicioConfigAgente.ts'

const AGENTES: readonly AgenteConConfig[] = ['claude-code', 'codex']

/** Lo que tiene un nivel: la configuración técnica de cada agente y, en el global, sus reglas. */
export type CapaCopia = Partial<Record<AgenteConConfig, string>> & { reglas?: string }

export interface ConfigDockerCopia {
  global?: CapaCopia
  /** Por id del perfil, el del archivo al exportar y el de destino una vez reasignado. */
  perfiles: Record<string, CapaCopia>
}

/** Dónde vive el contexto en este equipo: la raíz de las capas de Docker y el almacén del global. */
export interface EntornoContexto {
  raiz: string
  global: { leer: () => ContextoGlobal; guardar: (c: ContextoGlobal) => ContextoGlobal }
}

const objeto = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const CLAVES = [...AGENTES, 'reglas'] as const

const vacia = (c: CapaCopia | null | undefined): boolean => !c || CLAVES.every((k) => !c[k])

/** Un archivo sin nada que aplicar: vacío o, en JSON, un objeto vacío, que es como se vacía un `settings.json`. */
function sinContenido(agente: AgenteConConfig, texto: string): boolean {
  const t = texto.trim()
  return t === '' || (agente === 'claude-code' && t === '{}')
}

/** Cómo se vacía la configuración de un agente: un `settings.json` vacío no es JSON válido. */
const VACIO = (agente: AgenteConConfig): string => (agente === 'claude-code' ? '{}\n' : '')

/** Lo que tiene un nivel de este equipo; los archivos vacíos o que no se pueden leer no cuentan. */
export async function leerCapa(e: EntornoContexto, capa: CapaCompartida): Promise<CapaCopia> {
  const fuera: CapaCopia = {}
  for (const agente of AGENTES) {
    const leida = await leerDeDisco(join(carpetaCapa(e.raiz, capa, agente), ARCHIVOS_CONFIG_AGENTE[agente].configuracion)).catch(() => null)
    if (leida && !leida.bloqueo && !sinContenido(agente, leida.contenido)) fuera[agente] = leida.contenido
  }
  if (capa.tipo === 'global' && e.global.leer().reglas !== '') fuera.reglas = e.global.leer().reglas
  return fuera
}

/** El nivel global y la configuración de cada perfil elegido, sin los vacíos; nada si ninguno tiene contenido. */
export async function capasParaCopia(e: EntornoContexto, perfiles: readonly string[]): Promise<ConfigDockerCopia | undefined> {
  const global = await leerCapa(e, { tipo: 'global' })
  const fuera: ConfigDockerCopia = { perfiles: {} }
  if (!vacia(global)) fuera.global = global
  for (const id of perfiles) {
    const capa = await leerCapa(e, { tipo: 'perfil', profileId: id })
    if (!vacia(capa)) fuera.perfiles[id] = capa
  }
  return fuera.global || Object.keys(fuera.perfiles).length > 0 ? fuera : undefined
}

function capaValida(raw: unknown, conReglas: boolean): CapaCopia | null {
  const o = objeto(raw)
  const fuera: CapaCopia = {}
  for (const agente of AGENTES) {
    const texto = o[agente]
    if (typeof texto === 'string' && !sinContenido(agente, texto) && Buffer.byteLength(texto, 'utf8') <= MAX_BYTES_CONFIG_AGENTE) fuera[agente] = texto
  }
  if (conReglas && typeof o.reglas === 'string') {
    const reglas = normalizarReglas(o.reglas)
    if (reglas !== '' && reglas.length <= MAX_REGLAS_PERFIL) fuera.reglas = reglas
  }
  return vacia(fuera) ? null : fuera
}

/** Lo que trae el archivo, leído con cuidado: lo que no tiene la forma se queda fuera. */
export function leerConfigDockerCopia(raw: unknown): ConfigDockerCopia | undefined {
  const o = objeto(raw)
  const global = capaValida(o.global, true)
  const perfiles = Object.fromEntries(
    Object.entries(objeto(o.perfiles)).flatMap(([id, c]): Array<[string, CapaCopia]> => {
      const capa = id === '' ? null : capaValida(c, false)
      return capa ? [[id, capa]] : []
    })
  )
  if (!global && Object.keys(perfiles).length === 0) return undefined
  return { ...(global ? { global } : {}), perfiles }
}

/**
 * El nivel del archivo frente al de aquí: sin nada aquí se trae; con lo mismo en cada parte, igual. Unas reglas
 * que el archivo no trae no cuentan: importar no las toca.
 */
export function compararCapas(aqui: CapaCopia, archivo: CapaCopia): EstadoConfigDocker {
  if (vacia(aqui)) return 'traer'
  return CLAVES.every((k) => (k === 'reglas' && !archivo.reglas) || (aqui[k] ?? '') === (archivo[k] ?? '')) ? 'igual' : 'distinta'
}

/** Qué partes de un global distinto sustituirían algo que ya existe aquí. */
function partesSustituidas(aqui: CapaCopia, archivo: CapaCopia): { reglas: boolean; configuracion: boolean } {
  return {
    reglas: !!aqui.reglas && !!archivo.reglas && aqui.reglas !== archivo.reglas,
    configuracion: AGENTES.some((a) => !!aqui[a] && aqui[a] !== archivo[a])
  }
}

/**
 * Para la vista previa: el global frente al de aquí y la configuración de cada perfil del archivo frente a la de
 * cada perfil de aquí que ya tiene una (los demás, y uno nuevo, la traen). El renderer elige el destino; el
 * contenido no sale del main.
 */
export async function previaConfigDocker(e: EntornoContexto, copia: ConfigDockerCopia | undefined, perfilesAqui: readonly string[]): Promise<PreviaConfigDocker> {
  const previa: PreviaConfigDocker = { global: null, perfiles: {} }
  if (!copia) return previa
  if (copia.global) {
    const aqui = await leerCapa(e, { tipo: 'global' })
    previa.global = compararCapas(aqui, copia.global)
    previa.partesGlobal = partesSustituidas(aqui, copia.global)
  }
  if (Object.keys(copia.perfiles).length === 0) return previa
  const aqui = new Map<string, CapaCopia>()
  for (const id of perfilesAqui) {
    const capa = await leerCapa(e, { tipo: 'perfil', profileId: id })
    if (!vacia(capa)) aqui.set(id, capa)
  }
  for (const [id, capa] of Object.entries(copia.perfiles)) {
    previa.perfiles[id] = Object.fromEntries([...aqui].map(([local, suya]) => [local, compararCapas(suya, capa)]))
  }
  return previa
}

/**
 * Escribe los niveles de la copia (ya reducida a lo elegido y con cada perfil en su destino) como los guardaría
 * el editor: sintaxis comprobada y la versión anterior a salvo. La configuración queda como la del archivo: la
 * que el archivo no trae se vacía; las reglas globales solo se sustituyen si el archivo trae unas. Devuelve los niveles que no se pudieron escribir del todo, para revisarlos; nunca
 * lanza, porque llega después de haber importado las conexiones y el historial.
 */
export async function importarConfigDocker(e: EntornoContexto, copia: ConfigDockerCopia | undefined, perfilesAqui: readonly string[]): Promise<CapaCompartida[]> {
  if (!copia) return []
  const servicio = new ServicioConfigAgente({
    carpetaDe: ({ capa, agente }) => (capa ? carpetaCapa(e.raiz, capa, agente) : null),
    sesionesAbiertas: () => 0
  })
  const fallidas: CapaCompartida[] = []
  const escribir = async (capa: CapaCompartida, archivo: CapaCopia): Promise<void> => {
    const aqui = await leerCapa(e, capa)
    let ok = true
    for (const agente of AGENTES) {
      if (archivo[agente] === aqui[agente]) continue
      const contenido = archivo[agente] ?? VACIO(agente)
      // Un disco lleno o un archivo bloqueado no corta la importación: el nivel se avisa para revisarlo.
      const r = await servicio.guardar({ ref: { agente, accountId: null, capa }, tipo: 'configuracion', contenido, versionLeida: null, sobrescribir: true }).catch(() => null)
      if (r?.estado !== 'guardado') ok = false
    }
    // Las reglas no tienen versión anterior que recuperar: unas que el archivo no trae no vacían las de aquí.
    if (capa.tipo === 'global' && archivo.reglas && archivo.reglas !== aqui.reglas) {
      try {
        e.global.guardar({ ...e.global.leer(), reglas: archivo.reglas })
      } catch {
        ok = false
      }
    }
    if (!ok) fallidas.push(capa)
  }
  if (copia.global) await escribir({ tipo: 'global' }, copia.global)
  for (const [id, capa] of Object.entries(copia.perfiles)) {
    // Solo a un perfil que existe aquí: los nuevos ya se guardaron antes de importar.
    if (perfilesAqui.includes(id)) await escribir({ tipo: 'perfil', profileId: id }, capa)
  }
  return fallidas
}
