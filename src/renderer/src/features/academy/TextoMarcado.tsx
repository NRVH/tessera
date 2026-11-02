// =============================================================================
// Pinta un texto de Tessera Academy con su marcado (`marcado.ts`), sin HTML crudo. Los enlaces
// son botones que navegan dentro de la Academy; los del glosario llevan su definición en el
// `title`, para leerla sin salir del artículo.
// =============================================================================

import { nombresSistema } from '../../../../shared/nombresSistema'
import { articulo } from './articulos'
import { partirDestino, textosDe } from './modelo'
import { partirMarcado, sustituirNombres, textoPlano } from './marcado'
import { abrirAcademy } from './store'

/** La definición de un término del glosario, en texto plano; `undefined` si no es del glosario. */
function definicion(destino: string): string | undefined {
  const d = partirDestino(destino)
  if (d.articulo !== 'glosario' || d.ancla === null) return undefined
  const termino = articulo('glosario').secciones.find((s) => s.ancla === d.ancla)
  const primero = termino?.bloques[0]
  return primero === undefined ? undefined : textoPlano(sustituir(textosDe(primero)[0]))
}

function sustituir(texto: string): string {
  return sustituirNombres(texto, nombresSistema(window.tessera.plataforma))
}

const TECLA = String.raw`(?:Ctrl|Shift|Mayús|Alt|Supr|Esc|Enter|Intro|Tab|Delete|F\d{1,2}|[⌘⇧⌥⌃↩⌫↑↓]|[A-Z0-9,.=-])`
/** Teclas unidas por «+» (`Ctrl+Shift+F`) o seguidas, como se escriben en Mac (`⇧⌘F`). */
const ACORDE = new RegExp(`^(?:${TECLA}\\+)*${TECLA}$|^(?:[⌘⇧⌥⌃]+[A-Z0-9,.=↩⌫↑↓-])$`)
const MODIFICADOR = /^(?:Ctrl|Shift|Mayús|Alt)\+|[⌘⇧⌥⌃]/
const TECLA_SOLA = /^(?:Esc|Enter|Intro|Supr|F\d{1,2}|[↩⌫])$/

/** Un atajo con modificador, o una tecla especial suelta; el resto de código se queda como código. */
function esAtajo(t: string): boolean {
  return TECLA_SOLA.test(t) || (MODIFICADOR.test(t) && ACORDE.test(t))
}
const SIMBOLOS = /[⌘⇧⌥⌃↩⌫↑↓]|[^⌘⇧⌥⌃↩⌫↑↓+]+/g

function Teclas({ atajo }: { atajo: string }): React.JSX.Element {
  const teclas = atajo.includes('+') ? atajo.split('+').filter((t) => t !== '') : (atajo.match(SIMBOLOS) ?? [atajo])
  return (
    <span className="academy-atajo">
      {teclas.map((t, i) => (
        <kbd key={i}>{t}</kbd>
      ))}
    </span>
  )
}

export function TextoMarcado({ texto }: { texto: string }): React.JSX.Element {
  return (
    <>
      {partirMarcado(sustituir(texto)).map((t, i) => {
        if (t.tipo === 'negrita') return <strong key={i}>{t.texto}</strong>
        if (t.tipo === 'codigo') return esAtajo(t.texto) ? <Teclas key={i} atajo={t.texto} /> : <code key={i}>{t.texto}</code>
        if (t.tipo === 'enlace') {
          return (
            <button
              key={i}
              type="button"
              className="academy-enlace"
              title={definicion(t.destino)}
              onClick={() => abrirAcademy(t.destino)}
            >
              {t.texto}
            </button>
          )
        }
        return <span key={i}>{t.texto}</span>
      })}
    </>
  )
}
