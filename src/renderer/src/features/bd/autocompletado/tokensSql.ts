// =============================================================================
// Utilidades sobre los tokens del léxico compartido para el autocompletado SQL:
// qué es cada token, su texto crudo, su nombre de catálogo y cómo saltar un grupo.
// Puro: depende de `shared/sql` y lo usan `referenciasSql`, `clausulasSql`,
// `estrellaSql` y `contextoSql`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-contexto.md
// =============================================================================

import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { citar, citarSiHaceFalta, plegarSinComillas } from '../../../../../shared/sql/identificadoresSql.ts'
import type { TipoToken, Token } from '../../../../../shared/sql/lexicoSql.ts'

/** Conjunto de palabras a partir de un texto separado por blancos. */
export function conjunto(texto: string): ReadonlySet<string> {
  return new Set(texto.split(/\s+/).filter((p) => p.length > 0))
}

// Booleano y NO guarda de tipo: una guarda `t is Token` dejaría `t` en `never`
// en la rama falsa aunque solo hubiera fallado el tipo de token.
export function es(t: Token | undefined, tipo: TipoToken): boolean {
  return t !== undefined && t.tipo === tipo
}

export function esPalabra(t: Token | undefined, ...valores: string[]): boolean {
  return t !== undefined && t.tipo === 'palabra' && valores.indexOf(t.valor) >= 0
}

export function esIdent(t: Token | undefined): t is Token {
  return t !== undefined && (t.tipo === 'palabra' || t.tipo === 'identCitado')
}

/** Texto crudo de una palabra; si `texto` no casa con el token, su valor (en mayúsculas). */
export function crudo(t: Token, texto: string | undefined): string {
  if (texto !== undefined) {
    const c = texto.slice(t.desde, t.hasta)
    if (c.toUpperCase() === t.valor) return c
  }
  return t.valor
}

/** Nombre de catálogo de un identificador: el contenido si va citado; si no, plegado. */
export function nombreDe(t: Token, d: DialectoSql, texto: string | undefined): string {
  if (t.tipo === 'identCitado') return t.valor
  return plegarSinComillas(crudo(t, texto), d)
}

/** Índice tras el `)` que cierra el `(` de `sig[k]` (o el final si no se cierra). */
export function saltarGrupo(sig: readonly Token[], k: number): number {
  let prof = 0
  for (let j = k; j < sig.length; j++) {
    if (sig[j].tipo === 'parenA') prof++
    else if (sig[j].tipo === 'parenC') {
      prof--
      if (prof === 0) return j + 1
    }
  }
  return sig.length
}

/**
 * El identificador tal como está escrito: el texto crudo si casa con el token; si no
 * (sin `texto`), reconstruido (citado si hace falta, como lo escribiría Tessera).
 */
export function escrito(t: Token, d: DialectoSql, texto: string | undefined): string {
  if (texto !== undefined) {
    const c = texto.slice(t.desde, t.hasta)
    if (t.tipo === 'identCitado' ? c.length >= 2 && c[c.length - 1] === '"' : c.toUpperCase() === t.valor) return c
  }
  return t.tipo === 'identCitado' ? citar(t.valor) : citarSiHaceFalta(nombreDe(t, d, texto), d)
}

/** Los tokens que cuentan para la gramática: sin comentarios ni líneas de cliente. */
export function significativos(tokens: readonly Token[]): Token[] {
  return tokens.filter((t) => t.tipo !== 'comentario' && t.tipo !== 'lineaCliente')
}
