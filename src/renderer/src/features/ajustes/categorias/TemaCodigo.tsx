// =============================================================================
// El tema del código en Configuración › Apariencia › Editor de código: el selector, con los colores
// principales del elegido al lado, y una vista previa coloreada por Monaco con el tema activo y en la
// letra del editor, que cambia al elegir otro. Monaco se carga al abrirla, no con Configuración.
// Decisiones: docs/decisiones/renderer/temas-de-codigo.md
// =============================================================================

import { useEffect, useState } from 'react'
import { NOMBRES_TEMAS_CODIGO, PALETAS_CODIGO, TEMAS_CODIGO, esTemaCodigo, type TemaCodigoId } from '../../../theme/temasCodigo'
import { resolveFontFamily, resolveFontSize, type TerminalAppearance } from '../../../theme/terminalAppearance'
import { Fila, Selector } from '../primitivas'
import { txApariencia } from '../textos.ts'

/** El nombre de cada tema en el selector; el de serie lo dice. */
function nombreDe(id: TemaCodigoId): string {
  return id === 'tessera' ? txApariencia().temaTessera : NOMBRES_TEMAS_CODIGO[id]
}

/** Los colores que distinguen un tema de otro de un vistazo: palabra clave, cadena, función, tipo y número. */
function Muestras({ id }: { id: TemaCodigoId }): React.JSX.Element {
  const p = PALETAS_CODIGO[id]
  return (
    <span className="ajustes-tema-muestras" aria-hidden="true">
      {[p.palabraClave, p.cadena, p.funcion, p.tipo, p.numero].map((color, i) => (
        <span key={i} className="ajustes-tema-muestra" style={{ background: color }} />
      ))}
    </span>
  )
}

/** La fila del tema, con su vista previa debajo, en la letra elegida para el editor. */
export function FilaTemaCodigo({
  tema,
  letra,
  onChange
}: {
  tema: TemaCodigoId
  letra: TerminalAppearance
  onChange: (t: TemaCodigoId) => void
}): React.JSX.Element {
  const t = txApariencia()
  return (
    <>
      <Fila
        etiqueta={t.tema}
        control={
          <span className="ajustes-tema-control">
            <Muestras id={tema} />
            <Selector
              valor={tema}
              opciones={TEMAS_CODIGO.map((id) => ({ value: id, label: nombreDe(id) }))}
              onChange={(v) => {
                if (esTemaCodigo(v)) onChange(v)
              }}
              etiqueta={t.temaEtiqueta}
            />
          </span>
        }
      />
      <PreviaTemaCodigo tema={tema} letra={letra} />
    </>
  )
}

/**
 * El código de muestra, coloreado por Monaco con el tema activo. Se vuelve a colorear al cambiar de tema:
 * las clases que pone Monaco son índices de la tabla de colores de cada tema, no papeles, así que el HTML
 * de un tema no vale para otro. Sale de una constante, no del usuario.
 */
function PreviaTemaCodigo({ tema, letra }: { tema: TemaCodigoId; letra: TerminalAppearance }): React.JSX.Element {
  const muestra = txApariencia().muestraCodigo
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void import('../../../comun/monacoSetup').then(({ ensureMonaco }) =>
      ensureMonaco()
        .editor.colorize(muestra, 'typescript', {})
        .then((h) => {
          if (vivo) setHtml(h)
        })
    )
    return () => {
      vivo = false
    }
  }, [muestra, tema])
  return (
    <div
      className="ajustes-previa-codigo"
      aria-label={txApariencia().previaTema}
      role="img"
      style={{ fontFamily: resolveFontFamily(letra), fontSize: resolveFontSize(letra) }}
    >
      {html === null ? <pre>{muestra}</pre> : <div dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}
