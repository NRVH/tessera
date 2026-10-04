// =============================================================================
// Decisiones vivas de la consola SQL: lo que `useConsola` y el adaptador de Monaco
// preguntan FUERA del reducer (¿esta edición invalida una marca?, ¿lo leído del disco
// pisa algo mío?, ¿qué cancela ■?, ¿qué se pierde al forzar y con qué alcance?, ¿qué
// avisos tiene esta versión?), sacado aquí para fijarlo con un test bajo `node`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbCancelar, DbEstadoSesion, DbEstadoTx, DbMotivoError } from '../../../../../shared/db-explorador-ipc.ts'
import type { Plataforma } from '../../../../../shared/plataforma.ts'
import { avisosConSoloLectura, type AvisoSql } from '../../../../../shared/sql/avisosSql.ts'
import type { Clasificacion } from '../../../../../shared/sql/clasificarSql.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { ModoEjecucion } from '../../../../../shared/sql/divisorSql.ts'
import { motivoNoExplicable } from '../../../../../shared/sql/explicarSql.ts'
import { esDetener, esExplicar, esFormatear, esHistorial, type TeclaAcorde } from '../../../util/atajos.ts'
import { analisisDe, type ModeloAnalizable } from '../autocompletado/analisisModelo.ts'
import type { IndicadorPestana } from '../dbTabsModel.ts'
import { PISTA_SIN_SENTENCIA } from './estadoConsola.ts'
import { enCurso, msDe, type Lote } from './lote.ts'
import { formatoDuracion } from './marcasConsola.ts'
import {
  cantidad,
  ETIQUETA_FORZAR,
  ETIQUETA_FORZAR_CONSOLA,
  TEXTO_SIN_RESPUESTA_STOP,
  TEXTO_STOP_CON_CAMBIOS
} from './salidaConsola.ts'
import { nunca } from '../../../../../shared/nunca.ts'

/** Sin respuesta al Stop durante este tiempo, la Salida ofrece «Forzar». */
export const ESPERA_STOP_MS = 10_000
/**
 * Lo mismo en un motor con un proceso por consola (SQLite): el main mata en unos 20 ms, así
 * que si en 1,5 s la sentencia sigue es que no mató (cambios sin confirmar). Holgado para
 * un equipo cargado; más corto que eso solo adelantaría un aviso que ya es seguro.
 */
export const ESPERA_STOP_MATAR_MS = 1_500

// --- Marcas y ediciones ------------------------------------------------------------

/**
 * Un cambio del modelo reducido a lo que importa: dónde empezaba el tramo
 * sustituido (UTF-16, coordenadas de ANTES del cambio) y cuánto medía. Es la forma de
 * `IModelContentChange` de Monaco (`rangeOffset`, `rangeLength`).
 */
export interface CambioTexto {
  offset: number
  largo: number
}

/**
 * ¿El cambio toca la sentencia `[desde, hasta)`? Toca si SUSTITUYE algo de dentro o
 * si INSERTA estrictamente dentro. Escribir justo en un borde (antes del primer
 * carácter o detrás del último) no la toca: es lo que hace quien empieza la
 * siguiente sentencia en la línea de abajo, y quitar la ✓ por eso sería absurdo.
 * Es el mismo criterio que `NeverGrowsWhenTypingAtEdges` de la decoración.
 */
export function cambioTocaRango(desde: number, hasta: number, c: CambioTexto): boolean {
  if (c.largo > 0) return c.offset < hasta && c.offset + c.largo > desde
  return c.offset > desde && c.offset < hasta
}

// --- Disco -------------------------------------------------------------------------

/**
 * Qué hacer tras leer la consola del disco:
 *   - `igual`: el disco ya dice lo que dice el editor. Solo se apunta como guardado.
 *   - `recargar`: no había nada mío sin guardar (o es la primera lectura): se carga
 *     lo del disco, conservando el deshacer.
 *   - `mio`: lo del disco es lo último que YO guardé; lo que cambió es el editor, y
 *     su escritura pendiente seguirá su curso.
 *   - `conflicto`: cambió el disco Y hay cambios míos sin guardar. Se pregunta
 *     ("Cargar la del disco" / "Conservar la mía"); decidir solo pisaría a alguien.
 * `guardado` es lo último que se sabe que está en disco por mano propia (null = aún
 * no se leyó nunca).
 */
export type DecisionDisco = 'igual' | 'recargar' | 'mio' | 'conflicto'

/** Qué hacer con el texto recién leído del disco frente al del editor (ver `DecisionDisco`). */
export function decidirTrasLeer(modelo: string, guardado: string | null, disco: string): DecisionDisco {
  if (disco === modelo) return 'igual'
  if (guardado === null || modelo === guardado) return 'recargar'
  if (disco === guardado) return 'mio'
  return 'conflicto'
}

/** Una consola "vacía" (se borra al cerrarla): nada más que blancos. */
export function textoVacio(texto: string): boolean {
  return texto.trim() === ''
}

// --- Qué se ejecuta ------------------------------------------------------------------

/**
 * El modo de `sentenciasAEjecutar` a partir del editor: la selección si no está
 * vacía, si no el cursor. Los offsets son del modelo (UTF-16).
 */
export function modoDesdeEditor(
  seleccion: { desde: number; hasta: number } | null,
  cursor: number
): ModoEjecucion {
  if (seleccion && seleccion.hasta > seleccion.desde) {
    return { tipo: 'seleccion', desde: seleccion.desde, hasta: seleccion.hasta }
  }
  return { tipo: 'cursor', cursor }
}

// --- Avisos léxicos (el amarillo mientras se escribe) --------------------------------

/**
 * Lo que los avisos leen de un modelo: lo de `analisisDe` más la LONGITUD, que se mira
 * sin copiar el texto (lo cumple `editor.ITextModel`).
 */
export interface ModeloAvisos extends ModeloAnalizable {
  getValueLength(): number
}

/**
 * Los avisos léxicos del modelo, o null si pasa de `tope` (entonces no se analiza y se
 * limpian los marcadores). Lo llama `ValidadorAvisos.ahora` a los 250 ms de cada pausa.
 *
 * PARTE CON LA MISMA DIVISIÓN QUE EL AUTOCOMPLETADO (`analisisDe`, una por versión del
 * modelo y dialecto), no por su cuenta: partir otra vez la misma versión es otra pasada
 * del léxico, 60-80 ms a 2 MiB en el hilo del renderer (ver `analisisModelo.ts`). Lo que
 * se avisa es lo mismo; `test-vivo-consola` lo fija contra la división directa. El tope
 * se mira con `getValueLength()` antes de pedir nada: una consola de 10 MiB no se copia
 * entera cada 250 ms solo para decir que es demasiado grande.
 */
export function avisosVivos(
  modelo: ModeloAvisos,
  d: DialectoSql,
  soloLectura: boolean,
  tope: number
): AvisoSql[] | null {
  if (modelo.getValueLength() > tope) return null
  return avisosConSoloLectura(analisisDe(modelo, d).sentencias, d, soloLectura)
}

// --- Explicar plan -------------------------------------------------------------------

/** Pista si la selección tiene más de una sentencia. */
export const PISTA_VARIAS_PLAN = 'Explicar el plan es de UNA sentencia: deja el cursor en una o selecciona solo una'
/**
 * Pista de «Formatear» cuando no cambió nada. No dice «ya estaba formateado» a secas:
 * `formatearEnEditor` también deja intactos a propósito los bloques PL/SQL, los
 * comandos del cliente y lo que no entiende, y esa frase mentiría sobre ellos.
 */
export const PISTA_YA_FORMATEADO = 'Nada que cambiar: ya estaba formateado, o es algo que el formateador deja como está (PL/SQL, comandos…)'

/**
 * ¿Qué sentencia se explica? Tiene que ser UNA (el contrato de `explicar`) y
 * explicable según `motivoNoExplicable` de `shared/sql/explicarSql.ts`, la MISMA regla
 * con la que el main vuelve a decidir (consulta o DML; ni un EXPLAIN ya escrito ni un
 * SHOW): con una regla propia, el botón ofrecería algo que el main rechaza. Los
 * comandos del cliente de una selección no cuentan (no llegan al servidor): «SET
 * SERVEROUTPUT ON» + una consulta es UNA sentencia que explicar. La pista dice por qué
 * no, en vez de mandar al main algo que va a rechazar.
 */
export function sentenciaExplicable<S extends Pick<Clasificacion, 'clase' | 'verbo'>>(
  ss: readonly S[]
): { ok: true; sentencia: S } | { ok: false; pista: string } {
  const utiles = ss.filter((s) => s.clase !== 'cliente')
  if (utiles.length === 0) {
    return { ok: false, pista: ss.length > 0 ? (motivoNoExplicable(ss[0]) ?? PISTA_SIN_SENTENCIA) : PISTA_SIN_SENTENCIA }
  }
  if (utiles.length > 1) return { ok: false, pista: PISTA_VARIAS_PLAN }
  const s = utiles[0]
  const motivo = motivoNoExplicable(s)
  if (motivo !== null) return { ok: false, pista: motivo }
  return { ok: true, sentencia: s }
}

// --- Los acordes que atiende la SECCIÓN de la consola -------------------------------

/** Lo que hace la sección de la consola con una tecla que le llega por burbujeo. */
export type AtajoSeccion = 'detener' | 'explicar' | 'historial' | 'formatear'

/** Lo que hace falta saber, además de la tecla, para decidir. */
export interface ContextoAtajoSeccion {
  /** Hay algo que ■ puede parar (`puedeDetener`). */
  detenible: boolean
  /** La consola tiene un diálogo abierto: peligros, parámetros, transacción, forzar… */
  dialogoAbierto: boolean
  /**
   * La tecla viene de un PORTAL (un diálogo, el visor de un valor, un menú contextual):
   * su DOM cuelga de `body`, pero React la burbujea por el árbol de COMPONENTES hasta la
   * sección igual que si viniera de dentro.
   */
  desdePortal: boolean
}

/**
 * ¿Qué hace la sección de la consola con esta tecla? Es la que atiende los acordes con
 * el foco FUERA del editor (la rejilla, la Salida, la barra); dentro los consume su
 * `addAction` antes de que suban.
 *
 * EXPLICAR, HISTORIAL Y FORMATEAR NUNCA A TRAVÉS DE UN DIÁLOGO. Los diálogos van por
 * portal y el `ConfirmDialog` de los peligros no corta el burbujeo de React: un
 * Ctrl+Shift+E sobre «¿Ejecutar DELETE sin WHERE?» arrancaría un plan con la confirmación
 * abierta, y al confirmar, `correr` vería una ejecución en curso y se retiraría sin decir
 * nada. Se cortan con un diálogo abierto y con CUALQUIER tecla que venga de un portal (el
 * visor de un valor, un menú), que no es de la sección aunque React la suba hasta ella.
 *
 * DETENER SÍ pasa con un diálogo abierto: el de «Forzar el cierre» sale justo cuando una
 * sentencia no para, y volver a pedir ■ desde ahí no hace daño. La autorrepetición no
 * relanza explicar, historial ni formatear (mantener el acorde no encola planes).
 */
export function atajoDeSeccion(
  e: TeclaAcorde & { readonly repeat?: boolean },
  ctx: ContextoAtajoSeccion,
  plataforma: Plataforma
): AtajoSeccion | null {
  if (ctx.detenible && esDetener(e, plataforma)) return 'detener'
  if (e.repeat === true || ctx.dialogoAbierto || ctx.desdePortal) return null
  if (esExplicar(e, plataforma)) return 'explicar'
  if (esHistorial(e, plataforma)) return 'historial'
  if (esFormatear(e, plataforma)) return 'formatear'
  return null
}

// --- Barra -------------------------------------------------------------------------

/**
 * Texto de estado de la barra mientras corre un lote: «Ejecutando 2 de 5 · 3 s».
 * Con una sola sentencia no se numera («Ejecutando · 3 s»). El cronómetro es el
 * VIVO de `formatoDuracion` (vacío el primer segundo, luego segundos enteros), el
 * mismo que va detrás de la sentencia en el editor, para que las dos cifras no
 * discrepen. Tras pulsar ■ con algo en vuelo, «Deteniendo…». Null si no corre nada.
 */
export function textoProgreso(l: Lote | null, ahora: number): string | null {
  if (!l || !enCurso(l)) return null
  const total = l.sentencias.length
  const i = l.sentencias.findIndex((x) => x.estado === 'corriendo')
  if (l.estado === 'cancelado') return 'Deteniendo…'
  const numero = i >= 0 ? i + 1 : l.sentencias.filter((x) => x.estado !== 'pendiente').length + 1
  // Un «Explicar plan» no ejecuta: la barra no puede decir «Ejecutando».
  const base =
    l.plan === true
      ? 'Obteniendo el plan'
      : total > 1
        ? `Ejecutando ${Math.min(numero, total)} de ${total}`
        : 'Ejecutando'
  if (i < 0) return base
  const ms = msDe(l.sentencias[i], ahora)
  const vivo = ms !== null ? formatoDuracion(ms, true) : ''
  return vivo ? `${base} · ${vivo}` : base
}

/**
 * ¿Dos conjuntos de indicadores dicen lo mismo? La consola lo usa para no avisar a
 * la pestaña en vano, y `DbArea` para no rehacer su mapa de indicadores (una sola
 * copia: la del área era idéntica salvo por el `null`).
 */
export function mismosIndicadores(
  a: ReadonlySet<IndicadorPestana> | null,
  b: ReadonlySet<IndicadorPestana>
): boolean {
  if (!a || a.size !== b.size) return false
  for (const x of b) if (!a.has(x)) return false
  return true
}

// --- Detener -----------------------------------------------------------------------

/**
 * ¿Hay algo que ■ pueda parar? Un lote en curso, una página de «cargar más» o un
 * «Contar» en vuelo. Las dos últimas corren en la sesión de la consola (el lector es
 * suyo): una re-ejecución lenta (OFFSET en PG, el respaldo ROWNUM en Oracle) o un
 * COUNT(*) sobre una tabla grande la dejan ocupada igual que una sentencia, y con ■
 * apagado mientras tanto no había forma de soltarla: la consola no ejecutaba nada
 * hasta que el servidor acabara de contar.
 */
export function puedeDetener(ejecutando: boolean, masEnVuelo: number, conteosEnVuelo = 0): boolean {
  return ejecutando || masEnVuelo > 0 || conteosEnVuelo > 0
}

/**
 * Lo que ■ manda cancelar. La ejecución, por el rol `consola` con su `ejecucionId`
 * (null = no hay sentencia en el trabajador: entre dos sentencias basta con parar el
 * lote). Cada «cargar más» y cada «Contar», por el rol `datos` con SU `peticionId`: el
 * main busca esa clave en todas las sesiones de la conexión, la de la consola
 * incluida. Sin clave guardada no se podía alcanzar desde ningún Stop: «Contar» se
 * lanzaba con un id que no se apuntaba en ninguna parte.
 */
export function cancelacionesDetener(p: {
  perfilId: string
  consolaId: string
  conexionId: string
  ejecucionId: string | null
  masEnVuelo: Iterable<string>
  conteosEnVuelo?: Iterable<string>
}): DbCancelar[] {
  const out: DbCancelar[] = []
  if (p.ejecucionId) {
    out.push({ rol: 'consola', perfilId: p.perfilId, consolaId: p.consolaId, ejecucionId: p.ejecucionId })
  }
  // Un solo conjunto de vistos para las dos listas: un id repetido (no debería
  // pasar, son uuid) se manda una vez.
  const vistos = new Set<string>()
  const datos = (ids: Iterable<string>): void => {
    for (const peticionId of ids) {
      if (!peticionId || vistos.has(peticionId)) continue
      vistos.add(peticionId)
      out.push({ rol: 'datos', conexionId: p.conexionId, peticionId })
    }
  }
  datos(p.masEnVuelo)
  if (p.conteosEnVuelo) datos(p.conteosEnVuelo)
  return out
}

// --- Transacciones -----------------------------------------------------------------

/**
 * ¿Hay que resolver la transacción antes de cerrar la consola? `pendiente` y
 * `fallida`, sí: se perdería trabajo (o, en la fallida, hay que revertir antes de
 * nada). `abierta` (PG, un BEGIN que solo leyó) no: el main la cierra en silencio.
 */
export function hayTxQueResolver(s: DbEstadoSesion | null): boolean {
  return s !== null && (s.tx === 'pendiente' || s.tx === 'fallida')
}

/**
 * Cerrar la consola pidió al main cerrar su sesión y el main dijo que no: ¿se
 * queda la pestaña abierta? `resolvioTx` = se le pidió de paso Commit o Rollback.
 *   - Con `resolvioTx`, sí: lo que falló fue confirmar o revertir, y la
 *     transacción sigue ahí.
 *   - Con `ocupada`, TAMBIÉN, aunque antes no hubiera transacción: la sentencia que
 *     sigue corriendo es justo la que puede CREARLA (el primer UPDATE en Manual). Es
 *     el caso de un Stop que no llega a tiempo: si la sentencia acaba, deja una tx
 *     pendiente con sus bloqueos de fila que el barrido de inactividad no cierra
 *     nunca (no toca sesiones con tx viva), y sin la pestaña no hay nada que la
 *     enseñe. Abierta, el error queda a la vista, sigue el «Forzar» del Stop, y el
 *     siguiente cierre ya pregunta por la transacción.
 *   - Cualquier otro fallo sin transacción que resolver no retiene nada: la
 *     sesión se queda ociosa y el main la cierra por inactividad.
 */
export function cierreFallidoRetiene(motivo: DbMotivoError, resolvioTx: boolean): boolean {
  return resolvioTx || motivo === 'ocupada'
}

/** Mensaje de `DialogoTxPendiente`. */
export function textoTxPendiente(tx: DbEstadoTx, sentencias: number): string {
  if (tx === 'fallida') return 'La transacción de la consola falló: solo se puede revertir.'
  return sentencias > 0
    ? `La consola tiene una transacción sin confirmar (${cantidad(sentencias, 'sentencia', 'sentencias')}).`
    : 'La consola tiene una transacción sin confirmar.'
}

/** Una transacción que se pierde si se mata el proceso de la conexión. */
export interface TxEnRiesgo {
  nombre: string
  tx: DbEstadoTx
  sentencias: number
}

/**
 * Las transacciones vivas de una conexión (las de TODAS sus consolas, no solo la
 * mía: «Forzar» mata el proceso entero). `nombres` traduce el id de consola a su
 * nombre visible; una consola sin nombre conocido (de otro perfil) sale genérica.
 */
export function txEnRiesgo(
  sesiones: readonly DbEstadoSesion[],
  conexionId: string,
  nombres: ReadonlyMap<string, string>,
  soloConsola?: { perfilId: string; consolaId: string }
): TxEnRiesgo[] {
  const out: TxEnRiesgo[] = []
  for (const s of sesiones) {
    if (s.conexionId !== conexionId || s.tx === 'ninguna') continue
    // Alcance 'consola' (un proceso por consola): solo se pierde la de ESTA consola.
    if (
      soloConsola &&
      (s.ref.rol !== 'consola' || s.ref.perfilId !== soloConsola.perfilId || s.ref.consolaId !== soloConsola.consolaId)
    ) {
      continue
    }
    const nombre =
      s.ref.rol === 'consola' ? (nombres.get(s.ref.consolaId) ?? 'una consola de otro perfil') : 'la sesión de datos'
    out.push({ nombre, tx: s.tx, sentencias: s.sentenciasEnTx })
  }
  return out
}

/**
 * Qué cierra «Forzar». En un motor que se interrumpe, el proceso es de la
 * CONEXIÓN y Forzar se lo lleva entero, con las transacciones de todas sus consolas. En uno
 * con un proceso por consola (`procesoPorSesion`, SQLite: no se interrumpe y el Stop es
 * matar) Forzar mata solo el de ESTA consola: matar los demás perdería transacciones de
 * otras consolas que nadie pidió parar.
 */
export type AlcanceForzar = 'conexion' | 'consola'

export function alcanceForzar(procesoPorSesion: boolean): AlcanceForzar {
  return procesoPorSesion ? 'consola' : 'conexion'
}

/**
 * Lo que dice la consola cuando el Stop no termina la sentencia, y cuándo lo dice. En un
 * motor que se interrumpe, se espera `ESPERA_STOP_MS` a que el servidor responda. En uno
 * con un proceso por consola el main mata en el acto (unos 20 ms) salvo que la consola
 * tenga CAMBIOS SIN CONFIRMAR, que no se pierden sin preguntar: ahí esperar 10 s no sirve
 * de nada, y se ofrece «Forzar» enseguida con el motivo verdadero.
 */
export function avisoStopSinRespuesta(alcance: AlcanceForzar): { texto: string; etiqueta: string; esperaMs: number } {
  switch (alcance) {
    case 'conexion':
      return { texto: TEXTO_SIN_RESPUESTA_STOP, etiqueta: ETIQUETA_FORZAR, esperaMs: ESPERA_STOP_MS }
    case 'consola':
      return { texto: TEXTO_STOP_CON_CAMBIOS, etiqueta: ETIQUETA_FORZAR_CONSOLA, esperaMs: ESPERA_STOP_MATAR_MS }
    default:
      return nunca(alcance, 'avisoStopSinRespuesta')
  }
}

/** Cuerpo del diálogo de «Forzar»: qué se cierra y qué transacciones se revierten. */
export function mensajeForzar(alias: string, enRiesgo: readonly TxEnRiesgo[], alcance: AlcanceForzar = 'conexion'): string {
  let cabeza: string
  let vacio: string
  switch (alcance) {
    case 'conexion':
      cabeza = `Se cerrará la conexión con ${alias} (todas sus sesiones) y el servidor revertirá lo que no esté confirmado.`
      vacio = 'No hay transacciones sin confirmar en esta conexión.'
      break
    case 'consola':
      cabeza = `Se cerrará la sesión de esta consola con ${alias} y se revertirá lo que no esté confirmado en ella. Las demás consolas y pestañas de la conexión siguen como están.`
      vacio = 'Esta consola no tiene transacciones sin confirmar.'
      break
    default:
      return nunca(alcance, 'mensajeForzar')
  }
  if (enRiesgo.length === 0) return `${cabeza}\n\n${vacio}`
  const lineas = enRiesgo.map((t) => {
    if (t.tx === 'pendiente' && t.sentencias > 0) {
      return `· ${t.nombre}: ${cantidad(t.sentencias, 'sentencia', 'sentencias')} sin confirmar`
    }
    if (t.tx === 'fallida') return `· ${t.nombre}: transacción fallida`
    if (t.tx === 'abierta') return `· ${t.nombre}: transacción abierta (solo lecturas)`
    return `· ${t.nombre}: transacción sin confirmar`
  })
  return `${cabeza}\n\nSe perderán:\n${lineas.join('\n')}`
}
