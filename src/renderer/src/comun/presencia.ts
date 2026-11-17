// =============================================================================
// La presencia de lo que aparece y desaparece: un elemento que deja de estar visible sigue montado lo que dura su
// salida, marcado con `data-saliendo`, para que `movimiento.css` lo anime antes de quitarlo. La entrada no necesita
// nada (es `@starting-style`). Con «reducir movimiento» la salida dura cero y se quita al momento.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'

/** Lo que dura una salida (`--mov-salida`), con un margen para que la transición termine antes de desmontar. */
export const MS_SALIDA = 160

/** Si el sistema pide reducir el movimiento: entonces no hay salida que esperar. */
export function movimientoReducido(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface Presencia {
  /** Si se pinta: está visible o saliendo. */
  montado: boolean
  /** Si está saliendo: se marca con `data-saliendo` y ya no recibe clics. */
  saliendo: boolean
}

/** Cómo sigue la presencia cuando cambia la visibilidad. Puro: el temporizador lo pone el hook. */
export function siguientePresencia(actual: Presencia, visible: boolean): Presencia {
  if (visible) return { montado: true, saliendo: false }
  return actual.montado ? { montado: true, saliendo: true } : actual
}

/** El estado de presencia de algo que se muestra según `visible`, con su salida animada. */
export function usePresencia(visible: boolean, ms = MS_SALIDA): Presencia {
  const [p, setP] = useState<Presencia>({ montado: visible, saliendo: false })
  useEffect(() => {
    setP((actual) => siguientePresencia(actual, visible))
    if (visible) return
    const espera = movimientoReducido() ? 0 : ms
    // Devuelve el mismo objeto si ya estaba desmontado: un Presente que nace oculto no se vuelve a pintar.
    const t = setTimeout(() => setP((a) => (a.montado || a.saliendo ? { montado: false, saliendo: false } : a)), espera)
    return () => clearTimeout(t)
  }, [visible, ms])
  return p
}

/** Un elemento de una lista, y si está saliendo. */
export interface EnLista<T> {
  elemento: T
  saliendo: boolean
}

/**
 * La lista a pintar: los elementos actuales y, en el sitio que ocupaban, los que acaban de irse, marcados como
 * salientes. Uno que vuelve deja de salir. Puro: el hook pone el temporizador que los quita.
 */
export function conSalientes<T>(previa: readonly EnLista<T>[], actuales: readonly T[], clave: (t: T) => string): EnLista<T>[] {
  const vivas = new Set(actuales.map(clave))
  const fuera: EnLista<T>[] = []
  let j = 0
  // Se recorre la lista anterior: cada uno que sigue arrastra a los nuevos que van antes que él, y cada uno que se
  // fue se queda en su sitio, saliendo.
  for (const p of previa) {
    const k = clave(p.elemento)
    if (!vivas.has(k)) {
      fuera.push({ elemento: p.elemento, saliendo: true })
      continue
    }
    while (j < actuales.length) {
      const a = actuales[j++]
      fuera.push({ elemento: a, saliendo: false })
      if (clave(a) === k) break
    }
  }
  while (j < actuales.length) fuera.push({ elemento: actuales[j++], saliendo: false })
  return fuera
}

/** Una lista cuyos elementos salen animados al quitarse, con la misma presencia que un elemento suelto. */
export function useListaConSalida<T>(actuales: readonly T[], clave: (t: T) => string, ms = MS_SALIDA): EnLista<T>[] {
  const [lista, setLista] = useState<EnLista<T>[]>(() => actuales.map((elemento) => ({ elemento, saliendo: false })))
  // Un solo temporizador de purga en marcha: rearmarlo en cada cambio dejaría montados a los que salen mientras la
  // lista cambie más deprisa que la salida (un progreso que se actualiza varias veces por segundo).
  const purga = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setLista((previa) => conSalientes(previa, actuales, clave))
    if (purga.current !== null) return
    purga.current = setTimeout(
      () => {
        purga.current = null
        setLista((l) => (l.some((x) => x.saliendo) ? l.filter((x) => !x.saliendo) : l))
      },
      movimientoReducido() ? 0 : ms
    )
    // `clave` es una función estable por contrato: lo que cambia es la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actuales, ms])
  useEffect(
    () => () => {
      if (purga.current !== null) clearTimeout(purga.current)
    },
    []
  )
  return lista
}

/** El último valor no nulo: lo que pinta un aviso mientras sale, cuando su dato ya es `null`. */
export function useUltimoValor<T>(valor: T | null): T | null {
  const ultimo = useRef(valor)
  if (valor !== null) ultimo.current = valor
  return ultimo.current
}

/** Lo que dura la entrada de un contenedor (`--mov-entrada`). */
export const MS_ENTRADA = 240

/**
 * Mientras un contenedor entra (un diálogo, un marco), lo que ya trae dentro, o lo que llega mientras tanto, no hace
 * su propia entrada: aparece con él. Sin esto, cada campo que se despliega crece por su cuenta y el diálogo se estira
 * mientras se abre. El atributo `data-abriendo` va en el contenedor y `movimiento.css` apaga ahí las transiciones.
 */
export function useAbriendo(ms = MS_ENTRADA): { 'data-abriendo'?: '' } {
  const [abriendo, setAbriendo] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setAbriendo(false), movimientoReducido() ? 0 : ms)
    return () => clearTimeout(t)
  }, [ms])
  return abriendo ? { 'data-abriendo': '' } : {}
}

/** Los atributos que marcan la salida en el elemento animado. */
export const atributosPresencia = (p: Presencia): { 'data-saliendo'?: '' } => (p.saliendo ? { 'data-saliendo': '' } : {})
