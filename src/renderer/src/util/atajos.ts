// =============================================================================
// Atajos de teclado por plataforma: predicados puros (evento -> booleano) y las etiquetas que se
// enseñan al usuario. El modificador principal es Ctrl en Windows y Linux y ⌘ en macOS, y hay
// gestos cuya tecla, no solo el modificador, cambia entre plataformas (borrar, detener, abrir nodo).
// Cada función recibe la plataforma como último parámetro, con `window.tessera.plataforma` por defecto.
// Sin React ni DOM: `test-atajos.mts` lo carga con `node` a secas; su único import es de tipo.
// Decisiones: docs/decisiones/renderer/atajos-por-plataforma.md
// =============================================================================

import type { Plataforma } from '../../../shared/plataforma'

/**
 * Lo mínimo de un evento de teclado/rueda que hace falta para decidir.
 *
 * `readonly` a propósito: lo satisfacen sin adaptador el `KeyboardEvent` y el `WheelEvent`
 * del DOM, los sintéticos de React, el `IKeyboardEvent` de Monaco y `TeclaAtajo` de
 * `features/git/modelo/atajoCopiarHash.ts`.
 */
export interface ModificadoresEvento {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

/**
 * ¿Está pulsado el modificador principal de ESTA plataforma, y sólo él?
 *
 * `plataforma` es el último parámetro y tiene la real por defecto; se lee de
 * `window.tessera.plataforma` (el renderer no tiene `process`). Bajo `node` basta con
 * pasarla explícita: el valor por defecto sólo se evalúa cuando falta el argumento.
 */
export function esModPrincipal(
  e: ModificadoresEvento,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  return plataforma === 'mac' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/** Lo que hace falta de un evento de teclado para decidir un atajo de borrado. */
export interface TeclaBorrado extends ModificadoresEvento {
  readonly key: string
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/**
 * ¿Este evento pide BORRAR lo seleccionado?
 *
 * La tecla cambia con la plataforma, no sólo el modificador:
 *
 *   · Windows: `Supr` a secas.
 *   · macOS:   `⌘⌫`, el gesto nativo de borrar en el Finder; un ⌫ pelado allí no borra.
 *
 * Se acepta además `Delete`/`Backspace` sin modificador en las dos (el ⌦ de un teclado
 * completo de Mac llega como `Delete`). No se acepta `Ctrl+⌫` en Windows, donde ese acorde
 * no significa borrar. Shift y Alt anulan: `Shift+Supr` sería «borrar sin papelera», que
 * aquí no existe.
 */
export function esAtajoBorrado(
  e: TeclaBorrado,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.altKey || e.shiftKey) return false
  if (e.key !== 'Delete' && e.key !== 'Backspace') return false
  if (!e.ctrlKey && !e.metaKey) return true
  // Con modificador sólo vale en Mac: allí `⌘⌫` es el gesto; en Windows `Ctrl+Supr` no borra.
  return plataforma === 'mac' && esModPrincipal(e, plataforma)
}

/**
 * ¿Este evento pide CERRAR, con el gesto de borrar, la pestaña que tiene el foco (una
 * pestaña de resultado)? No es `esCerrarPestana` (Mod+W, desde cualquier sitio).
 *
 * Es el gesto de borrar de cada plataforma (`Supr` en Windows, `⌘⌫` o `Supr` en macOS)
 * SIN el ⌫ pelado que `esAtajoBorrado` acepta: un retroceso de más, con el foco en la tira
 * de pestañas en vez de en el editor, no debe llevarse un resultado.
 */
export function esBorrarPestanaEnfocada(
  e: TeclaBorrado,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey) return false
  return esAtajoBorrado(e, plataforma)
}

/**
 * ¿Está pulsado CONTROL literal, en cualquier plataforma?
 *
 * Sólo para los atajos que son de Control también en macOS (hoy, Ctrl+` de la terminal,
 * porque ⌘+` es «siguiente ventana» del sistema). Para cualquier otro gesto se usa
 * `esModPrincipal`.
 */
export function esCtrlLiteral(e: ModificadoresEvento): boolean {
  return e.ctrlKey && !e.metaKey
}

/**
 * La etiqueta del modificador principal para ENSEÑARLA (tooltips, textos de ayuda):
 * `⌘` en macOS y `Ctrl` en el resto. Es la pareja visible de `esModPrincipal`. Se usa
 * como `${etiquetaModPrincipal()}+C`.
 */
export function etiquetaModPrincipal(plataforma: Plataforma = window.tessera.plataforma): string {
  return plataforma === 'mac' ? '⌘' : 'Ctrl'
}

/** Lo que hace falta de un evento de teclado para decidir un atajo del mosaico. */
export interface TeclaMosaico extends ModificadoresEvento {
  readonly key: string
  readonly code: string
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly repeat: boolean
}

/**
 * Qué pide un acorde del mosaico: entrar/salir, saltar a la casilla N (0-based),
 * ampliar, o `ignorar` — un acorde del mosaico que hay que TRAGARSE sin hacer nada
 * (la autorrepetición, ver `accionMosaico`). No es lo mismo que `null`, que significa
 * "no es del mosaico, que siga su camino".
 */
export type AccionMosaico =
  | { readonly tipo: 'alternar' }
  | { readonly tipo: 'ir'; readonly indice: number }
  | { readonly tipo: 'ampliar' }
  | { readonly tipo: 'ignorar' }

/**
 * ¿Este evento es un atajo del MOSAICO DE AGENTES? Devuelve la acción o null.
 *
 *   · Mod+Shift+M  → entrar o salir del mosaico (vale dentro y fuera de él).
 *   · Mod+1…6      → enfocar la casilla N (sólo dentro del mosaico).
 *   · Mod+Shift+↩  → ampliar/restaurar la casilla enfocada (sólo dentro del mosaico).
 *
 * El llamador lo escucha en fase de CAPTURA: con una terminal enfocada, xterm convierte
 * en bytes y cancela varios de estos acordes (Ctrl+Shift+↩ sale como CR y Ctrl+3 como
 * ESC), y un listener en burbuja no los vería, o el agente recibiría una entrada que el
 * usuario no pidió.
 *
 * Las cifras se leen por `code` (`Digit1`…): en AZERTY la fila de arriba sin Shift da
 * `&`, `é`… y el atajo tiene que estar donde lo están los dedos. La M se lee por `key`
 * (una letra se busca por su nombre).
 *
 * La autorrepetición se TRAGA (`ignorar`) en vez de devolver `null`: si el evento siguiera
 * hasta xterm, cada repetición de Ctrl+Shift+↩ mandaría el prompt a medio escribir. Alt
 * anula siempre (AltGr en Windows llega como Ctrl+Alt).
 */
export function accionMosaico(
  e: TeclaMosaico,
  enMosaico: boolean,
  plataforma: Plataforma = window.tessera.plataforma
): AccionMosaico | null {
  if (e.altKey || !esModPrincipal(e, plataforma)) return null
  if (e.shiftKey) {
    if (e.key === 'm' || e.key === 'M') return e.repeat ? { tipo: 'ignorar' } : { tipo: 'alternar' }
    if (enMosaico && e.key === 'Enter') return e.repeat ? { tipo: 'ignorar' } : { tipo: 'ampliar' }
    return null
  }
  if (!enMosaico) return null
  const cifra = /^Digit([1-6])$/.exec(e.code)
  return cifra ? { tipo: 'ir', indice: Number(cifra[1]) - 1 } : null
}

// =============================================================================
// ÁREA DE BASES DE DATOS: cerrar pestaña, mostrar el agente, abrir un nodo, detener.
//
// Son PREDICADOS (evento → booleano), no acciones como `accionMosaico`. Responden «sí»
// también en la autorrepetición: devolver `false` dejaría seguir el evento, y con el foco
// en una terminal xterm lo convertiría en bytes. El llamador CONSUME el evento
// (`preventDefault`) y, si `e.repeat`, no actúa.
// =============================================================================

/**
 * Lo que hace falta de un evento de teclado para los atajos que miran la TECLA además
 * de los modificadores. Lo satisfacen tal cual el `KeyboardEvent` del DOM y el
 * sintético de React. El `IKeyboardEvent` de Monaco NO (no trae `key`): desde un
 * `onKeyDown` de Monaco se pasa su `e.browserEvent`.
 *
 * No se llama `TeclaAtajo` para no chocar con la de `features/git/modelo/atajoCopiarHash.ts`.
 */
export interface TeclaAcorde extends ModificadoresEvento {
  readonly key: string
  /** Tecla FÍSICA (`KeyB`). Sólo `esAlternarAgente` y `esFormatear` deciden por ella. */
  readonly code: string
  readonly altKey: boolean
  readonly shiftKey: boolean
  /** AltGr explícito, para eventos sintéticos sin `getModifierState` (tests). */
  readonly altGraph?: boolean
  /**
   * El del DOM y el de React; de él se lee AltGr (`'AltGraph'`). Declarado como MÉTODO
   * y no como propiedad-función a propósito: así el de React, cuyo parámetro es una
   * unión de literales y no `string`, encaja sin adaptador (bivarianza de métodos).
   */
  getModifierState?(tecla: string): boolean
}

/**
 * ¿AltGr está pulsado? En Windows llega como Ctrl+Alt, así que un `ctrlKey && altKey`
 * no lo distingue de pulsar Ctrl y Alt de verdad: sólo `getModifierState('AltGraph')`
 * lo hace. Se llama como método (`e.getModifierState?.(…)`) para no perder el `this`
 * del evento del DOM.
 */
function hayAltGr(e: TeclaAcorde): boolean {
  return e.altGraph === true || e.getModifierState?.('AltGraph') === true
}

/**
 * La LETRA latina que nombra la pulsación, en minúscula, o null.
 *
 * Se lee por su NOMBRE (`key`): el atajo está donde lo dice la tecla rotulada. Si la tecla
 * escribe una letra de OTRO ALFABETO (cirílico, griego…), se cae a la tecla física, porque
 * ningún `key` latino llegará nunca. La caída ocurre sólo cuando `key` es una LETRA
 * (`\p{L}`), no un signo: en Dvorak la tecla física `KeyW` escribe ',', y caer a `code`
 * haría que el mismo acorde abriera Configuración y cerrara la pestaña. Por lo mismo, los
 * símbolos que compone ⌥ en Mac ('∑', '∫') tampoco caen.
 */
function letraDe(e: TeclaAcorde): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  if (!/^\p{L}$/u.test(e.key)) return null
  const fisica = /^Key([A-Z])$/.exec(e.code)
  return fisica ? fisica[1].toLowerCase() : null
}

/**
 * ¿Este evento pide CERRAR LA PESTAÑA activa? Ctrl+W en Windows y Linux, ⌘W en Mac, y
 * en las dos SIN Alt ni Shift.
 *
 *   · El modificador es `esModPrincipal`, exclusivo: en Mac ⌃W es de readline (borrar
 *     la palabra anterior) y en Windows ⊞+W abre los widgets del sistema.
 *   · Shift ANULA: Ctrl+Shift+W / ⌘⇧W es «cerrar la VENTANA» en los navegadores y en los
 *     editores de código.
 *   · Alt ANULA: AltGr llega en Windows como Ctrl+Alt, y ⌥⌘W cierra TODAS las ventanas
 *     en el Finder.
 *   · La letra, por su nombre con la salvedad de los alfabetos no latinos (`letraDe`).
 *
 * DÓNDE vale no se decide aquí: el llamador lo atiende sólo con el foco dentro del área
 * de bases de datos, para no robarle ^W al pty de la terminal del agente.
 */
export function esCerrarPestana(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.altKey || e.shiftKey) return false
  return esModPrincipal(e, plataforma) && letraDe(e) === 'w'
}

/**
 * ¿Este evento pide MOSTRAR u OCULTAR el agente del área de bases de datos? Ctrl+Alt+B
 * en Windows y Linux, ⌥⌘B en Mac: el acorde que usan los editores de código para su
 * barra lateral secundaria, la analogía más cercana a una columna de agente a demanda.
 *
 * Se lee por `code` ('KeyB'), excepción a la convención de leer las letras por `key`: en
 * Mac ⌥ COMPONE caracteres y ⌥⌘B llega con `key: '∫'` en US (y otro símbolo en cada
 * distribución), así que `key === 'b'` no lo vería nunca. Precio aceptado: en Dvorak el
 * acorde queda en la tecla física de la B de QWERTY.
 *
 * AltGr ANULA en Windows y Linux: llega como Ctrl+Alt, y AltGr+B escribe un carácter en
 * algunas distribuciones. En Mac no se mira: allí ⌥ no es AltGr. Shift anula en las dos;
 * ⌃ en Mac y ⊞ en Windows, también.
 *
 * Debe llegar también con el foco en la terminal del agente, para ocultarlo desde ahí:
 * xterm trata Ctrl+Alt como AltGr en Windows y no cancela el evento, y en Mac no traduce
 * ningún acorde con ⌘. El llamador lo CONSUME (`preventDefault`).
 */
export function esAlternarAgente(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.code !== 'KeyB' || e.shiftKey) return false
  if (plataforma === 'mac') return e.metaKey && e.altKey && !e.ctrlKey
  return e.ctrlKey && e.altKey && !e.metaKey && !hayAltGr(e)
}

/**
 * ¿Este evento pide ALTERNAR LA PANTALLA COMPLETA del panel de la franja inferior (la
 * terminal o el historial de git)? Ctrl+Shift+↩ en Windows y Linux, ⌘⇧↩ en Mac: el mismo
 * acorde con que el mosaico amplía una casilla (`accionMosaico`), así que «hacer grande lo
 * que tengo delante» se pulsa igual en los dos sitios.
 *
 * Alt ANULA (AltGr llega en Windows como Ctrl+Alt, y ⌥ compone en Mac). Sin Shift no es
 * nuestro: Mod+↩ es «ejecutar» en la consola SQL. El modificador es el exclusivo de la
 * plataforma (`esModPrincipal`): ⌃⇧↩ en Mac y ⊞⇧↩ en Windows no cuentan. La tecla se lee
 * por su nombre: Enter no cambia con la distribución.
 *
 * DÓNDE vale no se decide aquí: el llamador lo atiende solo con el foco dentro de la franja
 * y fuera del mosaico, en fase de CAPTURA (xterm lo convertiría en un CR). La
 * autorrepetición también responde «sí»: la consume el llamador.
 */
export function esAlternarPantallaCompleta(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.altKey || !e.shiftKey || e.key !== 'Enter') return false
  return esModPrincipal(e, plataforma)
}

/**
 * ¿Este evento pide ABRIR el nodo seleccionado del árbol de bases de datos (o plegar y
 * desplegar un contenedor)?
 *
 *   · Enter y F4, SIN modificadores, en las dos.
 *   · En Mac ADEMÁS ⌘↓, el «Abrir» del Finder: en los teclados de Apple F4 exige fn, y
 *     con F4 sola abrir sería un gesto de dos manos.
 *   · Enter también en Mac, aunque en el Finder ↩ renombre: en este árbol casi nada se
 *     renombra y abrir es lo que se hace cien veces por sesión.
 *
 * Mitades negativas: Ctrl+↓ en Windows NO abre (mueve el foco sin mover la selección), ni
 * ⊞+↓ (minimiza la ventana); ⌃↓ en Mac tampoco (Mission Control). Ningún F4 con
 * modificador: Alt+F4 cierra la ventana en Windows.
 *
 * La tecla se mira por su nombre (`key`): Enter, F4 y las flechas no dependen de la
 * distribución.
 */
export function esAbrirNodo(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.altKey || e.shiftKey) return false
  if (!e.ctrlKey && !e.metaKey) return e.key === 'Enter' || e.key === 'F4'
  return plataforma === 'mac' && e.key === 'ArrowDown' && esModPrincipal(e, plataforma)
}

// El menú contextual por teclado (Mayús+F10, tecla Menú) no tiene predicado a propósito:
// ver el ADR de atajos por plataforma. El árbol escucha `contextmenu`.

/**
 * ¿Este evento pide DETENER la ejecución de la consola? Ctrl+F2 en Windows y Linux,
 * ⌘. en Mac. Aquí la TECLA es otra, no sólo el modificador:
 *
 *   · Ctrl+F2 es el «Stop» habitual de los clientes de bases de datos en Windows. No se
 *     traduce a ⌘F2 en Mac porque en los teclados de Apple F2 exige fn.
 *   · ⌘. es el CANCELAR nativo de macOS (detiene una carga, cancela un diálogo,
 *     interrumpe en la terminal), que es justo lo que se pide.
 *
 * En Mac se lee el CARÁCTER '.' y se TOLERA Shift: en AZERTY el punto se escribe con ⇧,
 * y en US ⌘⇧. da `key: '>'` y no casa, así que tolerar Shift no abre ningún acorde de más.
 * ⌃ y ⌥ anulan (⌃. es del pty; ⌥ compone). Sin verificar en un Mac AZERTY: lo fija el
 * test, no una medida.
 *
 * En Windows, Shift y Alt anulan, y la tecla se mira por su nombre ('F2').
 *
 * Dentro de Monaco pisa acordes suyos (Ctrl+F2 «Change All Occurrences», ⌘. «Quick Fix»):
 * la consola lo atiende sólo en SU editor, nunca en el de archivos.
 */
export function esDetener(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.altKey) return false
  if (plataforma === 'mac') return e.key === '.' && esModPrincipal(e, plataforma)
  return e.key === 'F2' && !e.shiftKey && esModPrincipal(e, plataforma)
}

// =============================================================================
// CONSOLA SQL: explicar el plan, el historial y formatear. Los tres los registra Monaco con
// `addAction` en el editor de la consola (`monacoConsola.ts`); la sección de la consola
// atiende además los dos primeros con estos predicados, para que valgan con el foco en la
// rejilla o en la Salida. No chocan con los acordes de serie de Monaco, con los del menú
// de aplicación de Mac (`main/app/menuAplicacion.ts`) ni con los globales, salvo lo dicho en
// cada JSDoc.
// =============================================================================

/**
 * ¿Este evento pide EXPLICAR EL PLAN de la sentencia del cursor (o de la selección)?
 * Ctrl+Shift+E en Windows y Linux, ⌘⇧E en Mac; la E de *explain* también vale en español.
 *
 * Monaco no tiene nada en Ctrl+Shift+E ni en ⌘⇧E. Mitades negativas: ⌘E en Mac es «Find
 * With Selection» (sin Shift no es nuestro), y ⌃⇧E en Mac es «seleccionar hasta el final
 * de la línea» (edición de línea del sistema): Ctrl no cuenta en Mac.
 *
 * Alt ANULA en las dos: ⌥ compone en Mac y AltGr llega como Ctrl+Alt en Windows. La
 * letra, por su nombre (`letraDe`).
 */
export function esExplicar(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.altKey || !e.shiftKey) return false
  return esModPrincipal(e, plataforma) && letraDe(e) === 'e'
}

/**
 * ¿Este evento pide abrir el HISTORIAL de consultas? Ctrl+Shift+H en Windows y Linux,
 * ⌘⇧H en Mac: la H de historial, la MISMA letra en las dos.
 *
 * No se usa Ctrl+Alt+E / ⌥⌘E: en Windows AltGr llega como Ctrl+Alt y AltGr+E escribe «€»
 * en varias distribuciones; Monaco resuelve sus acordes sin mirar AltGraph, así que el
 * acorde se comería el símbolo del euro.
 *
 * Mitades negativas: Ctrl+H sin Shift es «Reemplazar» de Monaco en Windows; ⌥⌘H es
 * «Ocultar otros» del menú de aplicación de Mac (lo atiende el sistema antes que la
 * página); ⌃⇧H en Mac no es nuestro (Ctrl no cuenta allí). Alt anula en las dos.
 */
export function esHistorial(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.altKey || !e.shiftKey) return false
  return esModPrincipal(e, plataforma) && letraDe(e) === 'h'
}

/**
 * ¿Este evento pide FORMATEAR el SQL de la consola? Ctrl+Alt+L en Windows y Linux, ⌥⌘L
 * en Mac: el «reformatear código» habitual de los entornos de desarrollo.
 *
 * Se lee por `code` ('KeyL'), como `esAlternarAgente` y por lo mismo: en Mac ⌥ COMPONE
 * caracteres y ⌥⌘L llega con `key: '¬'` en US. AltGr ANULA en Windows y Linux (en la
 * distribución polaca AltGr+L escribe «ł»). Shift anula en las dos.
 *
 * Dos límites, del lado de Monaco (donde lo registra `addAction`, que no puede mirar
 * AltGraph): en una distribución donde AltGr+L escribe algo, dentro del editor de la
 * consola el acorde gana a la letra; y en Mac ⌥⌘L es también «Buscar en la selección»
 * del buscador de Monaco, pero sólo con el buscador abierto: la acción de la consola se
 * registra con el contexto `!findWidgetVisible` para no quitárselo.
 */
export function esFormatear(
  e: TeclaAcorde,
  plataforma: Plataforma = window.tessera.plataforma
): boolean {
  if (e.code !== 'KeyL' || e.shiftKey) return false
  if (plataforma === 'mac') return e.metaKey && e.altKey && !e.ctrlKey
  return e.ctrlKey && e.altKey && !e.metaKey && !hayAltGr(e)
}

// =============================================================================
// LO QUE SE ENSEÑA: los acordes como DATOS y su pintado por plataforma.
// =============================================================================

/** Una tecla modificadora, con el nombre neutral de este módulo. */
export type Modificador = 'ctrl' | 'alt' | 'shift' | 'meta'

/** Un acorde en UNA familia de teclado: sus modificadores (en cualquier orden) y su tecla. */
export interface Acorde {
  readonly mods: readonly Modificador[]
  /**
   * La tecla con el nombre de `KeyboardEvent.key` ('Enter', 'F4', 'ArrowDown', '.'),
   * y las letras en MAYÚSCULA ('W'), que es como se rotulan.
   */
  readonly tecla: string
}

/**
 * El mismo gesto en las dos familias de teclado. `pc` es Windows y Linux ('otra'): la
 * familia de Ctrl, que es la rama «todo lo demás» de `esModPrincipal`. El PRIMERO de
 * cada lista es el que se enseña en un `title`; los siguientes son alternativas que
 * también valen (`etiquetasAcorde` las devuelve todas). Nunca vacía: lo impide el tipo.
 */
export interface AcordePorPlataforma {
  readonly pc: readonly [Acorde, ...Acorde[]]
  readonly mac: readonly [Acorde, ...Acorde[]]
}

/**
 * Los gestos con nombre. Los cuatro primeros tienen predicado en este archivo, y también
 * `pantallaCompleta` (`esAlternarPantallaCompleta`); los de la consola (`ejecutar`…`rollback`)
 * los registra Monaco con `addAction` con ESTOS acordes para que el `title` diga la verdad.
 * `explicar`, `historial` y `formatear` tienen las dos cosas: su `addAction` en el editor y
 * su predicado.
 */
export type IdAcorde =
  | 'cerrarPestana'
  | 'alternarAgente'
  | 'abrirNodo'
  | 'detener'
  | 'pantallaCompleta'
  | 'nuevaConsola'
  | 'copiar'
  | 'ejecutar'
  | 'ejecutarTodo'
  | 'commit'
  | 'rollback'
  | 'explicar'
  | 'historial'
  | 'formatear'

/**
 * La tabla. El test la cruza con los predicados en las dos plataformas: cada acorde que
 * se enseña lo acepta su predicado, y el de la otra familia no se cuela. Si alguien
 * cambia un predicado sin tocar su fila (o al revés), eso se pone rojo.
 *
 * `abrirNodo` no lista Enter: es el gesto implícito de cualquier lista y la etiqueta
 * enseña sólo los que no se adivinan (F4, ⌘↓). `ejecutarTodo` enseña Alt+X / ⌥X y deja
 * Ctrl+Shift+Enter / ⌘⇧↩ como alternativa.
 */
export const ACORDES: Readonly<Record<IdAcorde, AcordePorPlataforma>> = {
  cerrarPestana: {
    pc: [{ mods: ['ctrl'], tecla: 'W' }],
    mac: [{ mods: ['meta'], tecla: 'W' }]
  },
  alternarAgente: {
    pc: [{ mods: ['ctrl', 'alt'], tecla: 'B' }],
    mac: [{ mods: ['meta', 'alt'], tecla: 'B' }]
  },
  abrirNodo: {
    pc: [{ mods: [], tecla: 'F4' }],
    mac: [
      { mods: [], tecla: 'F4' },
      { mods: ['meta'], tecla: 'ArrowDown' }
    ]
  },
  detener: {
    pc: [{ mods: ['ctrl'], tecla: 'F2' }],
    mac: [{ mods: ['meta'], tecla: '.' }]
  },
  pantallaCompleta: {
    pc: [{ mods: ['ctrl', 'shift'], tecla: 'Enter' }],
    mac: [{ mods: ['meta', 'shift'], tecla: 'Enter' }]
  },
  nuevaConsola: {
    pc: [{ mods: ['ctrl'], tecla: 'N' }],
    mac: [{ mods: ['meta'], tecla: 'N' }]
  },
  copiar: {
    pc: [{ mods: ['ctrl'], tecla: 'C' }],
    mac: [{ mods: ['meta'], tecla: 'C' }]
  },
  ejecutar: {
    pc: [{ mods: ['ctrl'], tecla: 'Enter' }],
    mac: [{ mods: ['meta'], tecla: 'Enter' }]
  },
  ejecutarTodo: {
    pc: [
      { mods: ['alt'], tecla: 'X' },
      { mods: ['ctrl', 'shift'], tecla: 'Enter' }
    ],
    mac: [
      { mods: ['alt'], tecla: 'X' },
      { mods: ['meta', 'shift'], tecla: 'Enter' }
    ]
  },
  commit: {
    pc: [{ mods: ['ctrl', 'alt', 'shift'], tecla: 'K' }],
    mac: [{ mods: ['meta', 'alt', 'shift'], tecla: 'K' }]
  },
  rollback: {
    pc: [{ mods: ['ctrl', 'alt', 'shift'], tecla: 'R' }],
    mac: [{ mods: ['meta', 'alt', 'shift'], tecla: 'R' }]
  },
  explicar: {
    pc: [{ mods: ['ctrl', 'shift'], tecla: 'E' }],
    mac: [{ mods: ['meta', 'shift'], tecla: 'E' }]
  },
  historial: {
    pc: [{ mods: ['ctrl', 'shift'], tecla: 'H' }],
    mac: [{ mods: ['meta', 'shift'], tecla: 'H' }]
  },
  formatear: {
    pc: [{ mods: ['ctrl', 'alt'], tecla: 'L' }],
    mac: [{ mods: ['meta', 'alt'], tecla: 'L' }]
  }
}

/**
 * EL ORDEN DE LOS MODIFICADORES NO ES DE GUSTO: cada sistema tiene el suyo escrito.
 *
 *   · Windows: Ctrl, Alt, Shift, unidos con «+» («Ctrl+Alt+Shift+K»). Meta no lo usa
 *     ningún acorde de la familia pc (la tecla ⊞ es del sistema); si apareciera, iría
 *     delante.
 *   · Mac: ⌃ ⌥ ⇧ ⌘, sin separador («⌥⇧⌘K»), que es el orden con que Apple rotula los
 *     atajos en los menús. Por eso ⌥⌘B y no ⌘⌥B: con un orden libre, dos acordes de la
 *     misma pantalla saldrían escritos con reglas distintas.
 */
const ORDEN_PC: readonly Modificador[] = ['meta', 'ctrl', 'alt', 'shift']
const NOMBRE_PC: Readonly<Record<Modificador, string>> = {
  meta: 'Meta',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift'
}
const ORDEN_MAC: readonly Modificador[] = ['ctrl', 'alt', 'shift', 'meta']
const SIMBOLO_MAC: Readonly<Record<Modificador, string>> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  meta: '⌘'
}

/** Las teclas que no se pintan con su nombre de `key`. En Mac, Return es ↩. */
const TECLA_PC: ReadonlyMap<string, string> = new Map([
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→']
])
const TECLA_MAC: ReadonlyMap<string, string> = new Map([
  ['Enter', '↩'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→']
])

function pintarAcorde(a: Acorde, mac: boolean): string {
  const mapa = mac ? TECLA_MAC : TECLA_PC
  const tecla = mapa.get(a.tecla) ?? (a.tecla.length === 1 ? a.tecla.toUpperCase() : a.tecla)
  if (mac) {
    return ORDEN_MAC.filter((m) => a.mods.includes(m)).map((m) => SIMBOLO_MAC[m]).join('') + tecla
  }
  return ORDEN_PC.filter((m) => a.mods.includes(m))
    .map((m) => NOMBRE_PC[m])
    .concat(tecla)
    .join('+')
}

/**
 * TODOS los acordes que valen para un gesto en esta plataforma, pintados, con el que se
 * enseña primero. Acepta un id de `ACORDES` o un acorde propio, para que otro módulo
 * (la rejilla, por ejemplo) pinte los suyos con las mismas reglas de orden y símbolos.
 */
export function etiquetasAcorde(
  acorde: IdAcorde | AcordePorPlataforma,
  plataforma: Plataforma = window.tessera.plataforma
): string[] {
  const def = typeof acorde === 'string' ? ACORDES[acorde] : acorde
  const mac = plataforma === 'mac'
  return (mac ? def.mac : def.pc).map((a) => pintarAcorde(a, mac))
}

/**
 * El acorde de un gesto, listo para un `title` o un `aria-label`: «Ctrl+Alt+B» en
 * Windows y Linux, «⌥⌘B» en Mac. Es la pareja visible de los predicados de arriba, igual
 * que `etiquetaModPrincipal` lo es de `esModPrincipal`.
 */
export function etiquetaAcorde(
  acorde: IdAcorde | AcordePorPlataforma,
  plataforma: Plataforma = window.tessera.plataforma
): string {
  return etiquetasAcorde(acorde, plataforma)[0]
}

/**
 * La pista de cómo se abre un nodo del árbol, para el estado vacío y los tooltips:
 * «doble clic o F4» en Windows y Linux, «doble clic, F4 o ⌘↓» en Mac. Sale de la misma
 * fila de `ACORDES` que `esAbrirNodo` acepta (el test lo cruza), así que en Mac no puede
 * enseñar una F4 sin su ⌘↓, que es la que se pulsa sin fn.
 */
export function etiquetaAbrirNodo(plataforma: Plataforma = window.tessera.plataforma): string {
  const partes = ['doble clic', ...etiquetasAcorde('abrirNodo', plataforma)]
  return partes.slice(0, -1).join(', ') + ' o ' + partes[partes.length - 1]
}
