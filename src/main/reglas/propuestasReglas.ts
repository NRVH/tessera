// =============================================================================
// El almacén de las propuestas de reglas pendientes, una por perfil y otra para las globales, con su id
// reservado (la nueva sustituye a la anterior), en
// `<userData>/reglas-propuestas.json` con escritura atómica y respaldo `.bak`. Lo de un perfil que ya no
// existe no se devuelve ni se vuelve a escribir, y su borrado lo quita. Sin electron: la ruta y la lista
// de perfiles llegan por parámetro. Lo componen `componer.ts` y las operaciones de `tctx`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { readFileSync } from 'node:fs'
import { MAX_MOTIVO_PROPUESTA, MAX_REGLAS_PERFIL, normalizarReglas } from '../../shared/reglasPerfil.ts'
import type { PropuestaReglas } from '../../shared/reglas-ipc.ts'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'

/** Lo que se escribe en disco. */
interface Persistido {
  version: 1
  propuestas: PropuestaReglas[]
}

/** Lo que necesita el almacén. */
export interface DepsPropuestas {
  ruta: string
  /** Los ids de los perfiles que existen AHORA: se lee en cada uso. */
  idsVivos: () => readonly string[]
  log: (mensaje: string) => void
  /** Se llama al resolverse una propuesta anotada con `resolverAlGuardar` (para avisar a la interfaz). */
  alResolver?: (profileId: string) => void
}

/** ¿Tiene la forma de una propuesta? Lo de disco puede venir editado a mano o a medias. */
function esPropuesta(v: unknown): v is PropuestaReglas {
  if (v === null || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return (
    typeof p.profileId === 'string' &&
    p.profileId !== '' &&
    typeof p.texto === 'string' &&
    p.texto !== '' &&
    p.texto.length <= MAX_REGLAS_PERFIL &&
    typeof p.motivo === 'string' &&
    p.motivo.length <= MAX_MOTIVO_PROPUESTA &&
    typeof p.en === 'number' &&
    Number.isFinite(p.en) &&
    (p.proyecto === undefined || typeof p.proyecto === 'string') &&
    (p.desdePerfil === undefined || typeof p.desdePerfil === 'string')
  )
}

/** Solo los campos de una propuesta, sin lo que trajera de más. */
function limpia(p: PropuestaReglas): PropuestaReglas {
  return {
    profileId: p.profileId,
    texto: p.texto,
    motivo: p.motivo,
    en: p.en,
    ...(p.proyecto ? { proyecto: p.proyecto } : {}),
    ...(p.desdePerfil ? { desdePerfil: p.desdePerfil } : {})
  }
}

/** Las propuestas de un archivo: lista (aunque vacía) si es JSON legible; `null` si no existe o está corrupto. */
function leerArchivo(ruta: string): PropuestaReglas[] | null {
  let crudo: unknown
  try {
    crudo = JSON.parse(readFileSync(ruta, 'utf-8'))
  } catch {
    return null
  }
  const lista = (crudo as { propuestas?: unknown } | null)?.propuestas
  return Array.isArray(lista) ? lista.filter(esPropuesta).map(limpia) : []
}

/** Las propuestas pendientes de reglas, una por perfil. */
export class PropuestasReglas {
  private readonly d: DepsPropuestas
  private readonly porPerfil = new Map<string, PropuestaReglas>()
  /** Las propuestas aceptadas o editadas que esperan a que sus reglas lleguen a disco (solo en memoria). */
  private readonly esperando = new Map<string, { en: number; texto: string }>()

  constructor(d: DepsPropuestas) {
    this.d = d
    // El primario manda si es legible (vaciarlo a mano no resucita lo del `.bak`); si no, el respaldo.
    const leidas = leerArchivo(d.ruta) ?? leerArchivo(`${d.ruta}.bak`) ?? []
    const vivos = new Set(d.idsVivos())
    for (const p of leidas) {
      if (!vivos.has(p.profileId)) continue
      const previa = this.porPerfil.get(p.profileId)
      if (!previa || previa.en < p.en) this.porPerfil.set(p.profileId, p)
    }
  }

  /** La pendiente de un perfil que existe, o `null`. */
  obtener(profileId: string): PropuestaReglas | null {
    if (!this.d.idsVivos().includes(profileId)) return null
    return this.porPerfil.get(profileId) ?? null
  }

  /** Los perfiles (vivos) con una propuesta pendiente. */
  pendientes(): string[] {
    const vivos = new Set(this.d.idsVivos())
    return [...this.porPerfil.keys()].filter((id) => vivos.has(id))
  }

  /** Guarda una propuesta: sustituye a la que tuviera su perfil. */
  guardar(p: PropuestaReglas): void {
    this.porPerfil.set(p.profileId, limpia(p))
    this.persistir()
  }

  /** Quita la de un perfil; con `en`, solo si sigue siendo esa. Devuelve si quitó algo. */
  descartar(profileId: string, en?: number): boolean {
    const actual = this.porPerfil.get(profileId)
    if (!actual || (en !== undefined && actual.en !== en)) return false
    this.porPerfil.delete(profileId)
    this.persistir()
    return true
  }

  /** Lo que hace la orden de borrar un perfil: su propuesta fuera, aunque ya no esté en la lista. */
  borrarPerfil(profileId: string): void {
    this.esperando.delete(profileId)
    this.descartar(profileId)
  }

  /**
   * Anota que la propuesta `en` de un perfil se resuelve cuando se guarden en disco unas reglas iguales a
   * `texto` (las aceptadas o las editadas): hasta entonces sigue pendiente, y un guardado que falle no
   * pierde ni las reglas ni la propuesta. Una nueva anotación del mismo perfil sustituye a la anterior.
   */
  resolverAlGuardar(profileId: string, en: number, texto: string): void {
    this.esperando.set(profileId, { en, texto: normalizarReglas(texto) })
  }

  /**
   * Llama a cada guardado de perfiles con la lista que quedó en disco: quita las propuestas anotadas cuyas
   * reglas ya son las guardadas (solo si siguen siendo esa propuesta) y devuelve los perfiles resueltos.
   */
  alGuardarPerfiles(perfiles: ReadonlyArray<{ id: string; reglas?: string }>): string[] {
    const resueltos: string[] = []
    for (const [profileId, espera] of [...this.esperando]) {
      const perfil = perfiles.find((p) => p.id === profileId)
      if (!perfil || (perfil.reglas ?? '') !== espera.texto) continue
      this.esperando.delete(profileId)
      this.descartar(profileId, espera.en)
      resueltos.push(profileId)
      this.d.alResolver?.(profileId)
    }
    return resueltos
  }

  private persistir(): void {
    const vivos = new Set(this.d.idsVivos())
    const doc: Persistido = { version: 1, propuestas: [...this.porPerfil.values()].filter((p) => vivos.has(p.profileId)) }
    try {
      writeFileAtomicSync(this.d.ruta, JSON.stringify(doc, null, 2) + '\n')
    } catch (err) {
      this.d.log(`no se pudieron guardar las propuestas de reglas: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
