// =============================================================================
// El protocolo del archivo de las tres consolas (SQL, MongoDB y Redis), sin React: guardar
// (una escritura a la vez; un conflicto congela), leer el disco y decidir entre apuntarlo,
// recargar conservando el deshacer o abrir un conflicto, y el último tecleo al desmontar.
// Los hooks que lo programan están en `useArchivoConsola.ts`; la prueba, en `test-archivo-consola.mts`.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import type { editor } from 'monaco-editor'
import type { DbConsolaTexto, DbEscrituraConsola, DbRespuesta } from '../../../../../shared/db-explorador-ipc.ts'
import { mensajeDe, norm } from '../documentos/consolaComun.ts'
import { reemplazarConservandoDeshacer } from './reemplazoModelo.ts'
import { textoError } from './salidaConsola.ts'
import { decidirTrasLeer, textoVacio } from './vivoConsola.ts'

type Ref<T> = { current: T }

/** Los refs del archivo que comparten las tres consolas (los mismos nombres en las tres). */
export interface RefsArchivoConsola {
  modeloRef: Ref<editor.ITextModel | null>
  /** El texto ya llegó del disco: hasta entonces no se guarda nada. */
  cargadoRef: Ref<boolean>
  /** Lo último que se sabe en disco por mano propia (null = aún no se leyó). */
  guardadoRef: Ref<string | null>
  conflictoRef: Ref<{ texto: string } | null>
  escrituraRef: Ref<Promise<void> | null>
  temporizadorRef: Ref<ReturnType<typeof setTimeout> | null>
  /** El último error de guardado avisado: el mismo no se repite en cada tecla. */
  errorGuardadoRef: Ref<string | null>
  aplicandoDiscoRef: Ref<boolean>
  leyendoRef: Ref<boolean>
  borradaRef: Ref<boolean>
}

/** Lo que el protocolo usa de `window.tessera.dbExplorador`. */
export interface ApiArchivoConsola {
  leerConsola: (perfilId: string, consolaId: string) => Promise<DbRespuesta<DbConsolaTexto>>
  escribirConsola: (perfilId: string, consolaId: string, texto: string) => Promise<DbRespuesta<DbEscrituraConsola>>
}

/** Una consola concreta: sus refs, la API, de quién es y adónde van sus avisos. */
export interface ArchivoConsola {
  r: RefsArchivoConsola
  api: ApiArchivoConsola
  perfilId: string
  consolaId: string
  cambiarConflicto: (c: { texto: string } | null) => void
  /** Un error para el usuario: la Salida en la consola SQL y en la de MongoDB, el registro en la de Redis. */
  avisar: (texto: string) => void
}

/** Lo que además necesita leer el disco. */
export interface LecturaArchivoConsola extends ArchivoConsola {
  /** Corre algo: sus offsets son del texto de antes y una recarga los movería. */
  ejecutando: () => boolean
  setCargado: (v: boolean) => void
  setErrorCarga: (msg: string | null) => void
  /** Tras la primera carga (la consola SQL valida ya el texto). */
  alCargar?: () => void
}

/** Escribe en el modelo lo que hay en disco: la primera carga con `setValue` (adopta su EOL) y las recargas conservando el deshacer. */
export function aplicarDisco(
  r: Pick<RefsArchivoConsola, 'aplicandoDiscoRef' | 'guardadoRef'>,
  m: editor.ITextModel,
  texto: string,
  primera: boolean
): void {
  r.aplicandoDiscoRef.current = true
  try {
    if (primera) m.setValue(texto)
    else reemplazarConservandoDeshacer(m, texto)
  } finally {
    r.aplicandoDiscoRef.current = false
  }
  r.guardadoRef.current = m.getValue()
}

/** Leer el disco no debe pisar una ejecución, una escritura en vuelo ni un conflicto abierto (la primera lectura, sí). */
export function lecturaPermitida(
  r: Pick<RefsArchivoConsola, 'leyendoRef' | 'borradaRef' | 'escrituraRef' | 'conflictoRef'>,
  m: editor.ITextModel | null,
  primera: boolean,
  ejecutando: boolean
): boolean {
  if (!m || m.isDisposed() || r.leyendoRef.current || r.borradaRef.current) return false
  return primera || !(ejecutando || r.escrituraRef.current || r.conflictoRef.current)
}

function avisarErrorGuardado(a: ArchivoConsola, msg: string): void {
  if (a.r.errorGuardadoRef.current === msg) return
  a.r.errorGuardadoRef.current = msg
  a.avisar(`No se pudo guardar la consola: ${msg}`)
}

async function escribir(a: ArchivoConsola, m: editor.ITextModel, texto: string): Promise<void> {
  const { r } = a
  try {
    const res = await a.api.escribirConsola(a.perfilId, a.consolaId, texto)
    if (!res.ok) {
      avisarErrorGuardado(a, textoError(res.error))
      return
    }
    r.errorGuardadoRef.current = null
    if (res.valor.ok) {
      r.guardadoRef.current = texto
      return
    }
    // Conflicto: lo del disco cuenta desde ya como leído (el main lo apuntó).
    const actual = m.isDisposed() ? texto : m.getValue()
    r.guardadoRef.current = res.valor.texto
    if (norm(res.valor.texto) === norm(actual)) return
    a.cambiarConflicto({ texto: res.valor.texto })
  } catch (err) {
    avisarErrorGuardado(a, mensajeDe(err))
  }
}

/** Guarda el texto del modelo si cambió; `forzar` escribe aunque haya conflicto («Conservar la mía»). */
export async function guardarArchivoConsola(a: ArchivoConsola, forzar = false): Promise<void> {
  const { r } = a
  if (r.temporizadorRef.current !== null) clearTimeout(r.temporizadorRef.current)
  r.temporizadorRef.current = null
  // Una escritura en vuelo primero: así `guardadoRef` sabe siempre qué quedó en disco.
  while (r.escrituraRef.current) await r.escrituraRef.current
  const m = r.modeloRef.current
  if (!m || m.isDisposed() || !r.cargadoRef.current || r.borradaRef.current) return
  if (r.conflictoRef.current && !forzar) return
  const texto = m.getValue()
  if (!forzar && texto === r.guardadoRef.current) return
  const escritura = escribir(a, m, texto)
  r.escrituraRef.current = escritura
  try {
    await escritura
  } finally {
    if (r.escrituraRef.current === escritura) r.escrituraRef.current = null
  }
}

function adoptarLectura(a: LecturaArchivoConsola, m: editor.ITextModel, disco: string, primera: boolean): void {
  const { r } = a
  const actual = m.getValue()
  const guardado = r.guardadoRef.current === null ? null : norm(r.guardadoRef.current)
  const decision = decidirTrasLeer(norm(actual), guardado, norm(disco))
  if (decision === 'igual') r.guardadoRef.current = actual
  else if (decision === 'recargar') aplicarDisco(r, m, disco, primera)
  else if (decision === 'conflicto') a.cambiarConflicto({ texto: disco })
  if (primera) {
    r.cargadoRef.current = true
    a.setCargado(true)
    a.setErrorCarga(null)
    a.alCargar?.()
  }
}

/** Lee el archivo y lo adopta según `decidirTrasLeer`; un fallo en la primera lectura es el error de carga. */
export async function leerArchivoConsola(a: LecturaArchivoConsola): Promise<void> {
  const { r } = a
  const m = r.modeloRef.current
  const primera = !r.cargadoRef.current
  if (!m || !lecturaPermitida(r, m, primera, a.ejecutando())) return
  r.leyendoRef.current = true
  try {
    const res = await a.api.leerConsola(a.perfilId, a.consolaId)
    if (m.isDisposed() || r.modeloRef.current !== m) return
    if (!res.ok) {
      const msg = textoError(res.error)
      if (primera) a.setErrorCarga(msg)
      else a.avisar(`No se pudo leer la consola: ${msg}`)
      return
    }
    adoptarLectura(a, m, res.valor.texto, primera)
  } catch (err) {
    if (primera) a.setErrorCarga(mensajeDe(err))
  } finally {
    r.leyendoRef.current = false
  }
}

/** Al desmontar, el último tecleo se escribe ya: sin conflicto abierto y si la consola no se borró. */
export function vaciarAlDesmontar(a: Pick<ArchivoConsola, 'r' | 'api' | 'perfilId' | 'consolaId'>, m: editor.ITextModel): void {
  const { r } = a
  const pendiente =
    !m.isDisposed() && r.cargadoRef.current && !r.borradaRef.current && !r.conflictoRef.current ? m.getValue() : null
  if (r.temporizadorRef.current !== null) clearTimeout(r.temporizadorRef.current)
  r.temporizadorRef.current = null
  if (pendiente !== null && pendiente !== r.guardadoRef.current) {
    void a.api.escribirConsola(a.perfilId, a.consolaId, pendiente).catch(() => undefined)
  }
}

/** Solo se borra al cerrar lo que se sabe vacío EN DISCO: con un conflicto, el disco tiene lo del agente. */
export function vaciaEnDisco(r: Pick<RefsArchivoConsola, 'modeloRef' | 'cargadoRef' | 'conflictoRef'>): boolean {
  const m = r.modeloRef.current
  return !!m && !m.isDisposed() && r.cargadoRef.current && !r.conflictoRef.current && textoVacio(m.getValue())
}

/** Modelos de consola vivos por URI con cuenta de usos: un remontaje rápido reutiliza el modelo. */
const usosModelo = new Map<string, number>()

/** Un montaje más usa el modelo de `clave` (su URI). */
export function tomarModelo(clave: string): void {
  usosModelo.set(clave, (usosModelo.get(clave) ?? 0) + 1)
}

/** Un montaje deja el modelo; el último en irse lo dispone. */
export function soltarModelo(clave: string, m: editor.ITextModel): void {
  const usos = (usosModelo.get(clave) ?? 1) - 1
  if (usos <= 0) {
    usosModelo.delete(clave)
    if (!m.isDisposed()) m.dispose()
  } else {
    usosModelo.set(clave, usos)
  }
}
