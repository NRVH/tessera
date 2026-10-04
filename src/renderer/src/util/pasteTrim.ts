// =============================================================================
// Pegado que RECORTA los espacios de los extremos: un espacio invisible delante o detrás de un
// host o una contraseña provoca fallos (login rechazado, host que no resuelve) que no se
// parecen a su causa. Solo se tocan los extremos de lo pegado (los interiores se respetan) y
// solo en el pegado: un espacio tecleado a propósito se queda. Depende de React solo por tipo.
// =============================================================================

/**
 * Resultado de insertar `pegado` (ya recortado) en `valor`, sustituyendo el tramo
 * `[inicio, fin)` que estuviera seleccionado. Pura y sin DOM para poder probarla.
 *
 * Devuelve además dónde debe quedar el cursor: al final de lo insertado, que es
 * donde lo dejaría el pegado nativo.
 */
export function insertarRecortado(
  valor: string,
  inicio: number,
  fin: number,
  pegado: string
): { valor: string; cursor: number } {
  const limpio = pegado.trim()
  // Acotar los índices defiende de un selectionStart/End incoherente (o de un
  // `null` convertido a 0/NaN por el llamador) sin romper el texto existente.
  const a = Math.max(0, Math.min(inicio, valor.length))
  const b = Math.max(a, Math.min(fin, valor.length))
  return { valor: valor.slice(0, a) + limpio + valor.slice(b), cursor: a + limpio.length }
}

/**
 * Handler de `onPaste` para un input CONTROLADO. `aplicar` recibe el valor COMPLETO
 * resultante y debe hacer lo mismo que haría el `onChange` del campo.
 *
 * Se usa esta forma —y no escribir en `el.value`— porque en un input controlado por
 * React una escritura directa al DOM no dispara `onChange` y el estado quedaría
 * desincronizado del pintado.
 *
 *   <input value={x} onChange={e => setX(e.target.value)} onPaste={pegarRecortado(setX)} />
 */
export function pegarRecortado(
  aplicar: (nuevoValor: string) => void
): (e: React.ClipboardEvent<HTMLInputElement>) => void {
  return (e) => {
    const pegado = e.clipboardData.getData('text')
    // Sin nada que recortar, se deja pasar el pegado NATIVO: así no se interfiere con
    // el deshacer del navegador ni con los pegados de imagen/archivo.
    if (pegado === pegado.trim()) return

    const el = e.currentTarget
    e.preventDefault()
    const { valor, cursor } = insertarRecortado(
      el.value,
      el.selectionStart ?? el.value.length,
      el.selectionEnd ?? el.value.length,
      pegado
    )
    aplicar(valor)
    // El cursor se recoloca tras el repintado de React (que si no lo mandaría al
    // final). rAF es suficiente: el commit ya ocurrió cuando se ejecuta.
    requestAnimationFrame(() => {
      if (el.isConnected) el.setSelectionRange(cursor, cursor)
    })
  }
}
