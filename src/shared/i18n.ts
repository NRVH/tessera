// =============================================================================
// Idioma de la interfaz: español o inglés, el del sistema salvo que el usuario elija otro en
// Configuración. Cada área declara sus textos con `crearTextos(es, en)` junto a su código; el inglés
// tiene que tener las MISMAS claves y firmas que el español, o no compila. El idioma se fija una vez
// al arrancar (main: `fijarIdioma`; renderer: el que llega por el preload) y cambiarlo pide reiniciar,
// así que los textos se leen al usarse, nunca en el nivel superior de un módulo.
// Puro: sin `process`, Electron ni DOM.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

export type Idioma = 'es' | 'en'
/** Lo que se guarda en los ajustes: `sistema` sigue al idioma del equipo. */
export type PreferenciaIdioma = 'sistema' | Idioma

export const IDIOMAS: readonly Idioma[] = ['es', 'en']
/** Argumento con el que la ventana recibe el idioma resuelto (el renderer no tiene `process`). */
export const ARGUMENTO_IDIOMA = '--tessera-idioma='
/** Variable de entorno con el idioma resuelto: la pone el main y la heredan `tdb` y `tssh`. */
export const VARIABLE_IDIOMA = 'TESSERA_IDIOMA'
/**
 * Variable que FIJA el idioma de la app por encima del ajuste y del sistema, para las pruebas. Es
 * otra y no `VARIABLE_IDIOMA` porque esa la hereda todo lo que se abre desde una terminal de Tessera,
 * incluida otra Tessera, que dejaría de hacer caso a su propio ajuste.
 */
export const VARIABLE_IDIOMA_FORZADO = 'TESSERA_FORZAR_IDIOMA'

export function esIdioma(v: unknown): v is Idioma {
  return v === 'es' || v === 'en'
}

export function normalizarPreferenciaIdioma(v: unknown): PreferenciaIdioma {
  return esIdioma(v) ? v : 'sistema'
}

/** El primero de los idiomas preferidos del sistema que Tessera habla; si no habla ninguno, inglés. */
export function idiomaDeLocales(locales: readonly string[]): Idioma {
  for (const l of locales) {
    const base = l.toLowerCase().split(/[-_]/)[0]
    if (esIdioma(base)) return base
  }
  return 'en'
}

export function resolverIdioma(preferencia: PreferenciaIdioma, localesSistema: readonly string[]): Idioma {
  return preferencia === 'sistema' ? idiomaDeLocales(localesSistema) : preferencia
}

/** El idioma que el main pasó a la ventana; español si no llegó (una ventana sin el argumento). */
export function idiomaDeArgumentos(argv: readonly string[]): Idioma {
  const arg = argv.find((a) => a.startsWith(ARGUMENTO_IDIOMA))
  const v = arg?.slice(ARGUMENTO_IDIOMA.length)
  return esIdioma(v) ? v : 'es'
}

let actual: Idioma = 'es'

export function fijarIdioma(idioma: Idioma): void {
  actual = idioma
}

export function idiomaActual(): Idioma {
  return actual
}

/** La etiqueta BCP 47 para `toLocaleString`, `Intl.*` y el orden de las listas. */
export function localeActual(): string {
  return actual === 'en' ? 'en-US' : 'es-ES'
}

/**
 * La forma que tiene que cumplir el inglés: las mismas claves que el español, con un texto donde
 * hay un texto, la misma firma donde hay una función (plurales, interpolación o un fragmento con
 * marcado) y lo mismo hacia dentro en los grupos.
 */
export type Textos<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly string[]
      ? readonly string[]
      : T[K] extends (...args: infer A) => infer R
        ? (...args: A) => R extends string ? string : R
        : Textos<T[K]>
}

/** Los textos de un área en los dos idiomas; devuelve quien da los del idioma activo al llamarlo. */
export function crearTextos<T extends object>(es: T, en: Textos<T>): () => Textos<T> {
  return () => (actual === 'en' ? en : (es as Textos<T>))
}
