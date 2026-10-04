// =============================================================================
// Las piezas de texto del visor de clave: el conmutador de modo (Texto / JSON / Hex), el
// texto de unos bytes con el JSON coloreado, la vista de un string o JSON y una parte del
// detalle de la fila elegida. Las usa `DbClavePane`; la lógica está en `visorClaves.ts`.
// =============================================================================

import { useMemo, useState } from 'react'
import type { DbKvBytes } from '../../../../../shared/db-claves-ipc'
import { pintarBytes, tamanoBytes } from './bytesClaves'
import {
  COLOREAR_JSON_MAX,
  ETIQUETA_MODO,
  bytesLegibles,
  modoInicial,
  modosDe,
  textoEnModo,
  tokensJson,
  type ModoVista,
  type ParteDetalle
} from './visorClaves'
import { BotonBarraBd } from '../rejilla/DatosBotonBarra'
import { IconoCopiar } from '../../../comun/iconosMenu'

/** Lo que se copia de una parte del detalle: sus bytes pintados, o su texto. */
export function textoParte(x: ParteDetalle): string {
  return 'bytes' in x ? pintarBytes(x.bytes) : x.texto
}

/** El conmutador de modo (Texto / JSON / Hex) de unos bytes. */
function Modos({ modos, actual, onModo }: { modos: readonly ModoVista[]; actual: ModoVista; onModo: (m: ModoVista) => void }): React.JSX.Element {
  return (
    <span className="db-clave-modos" role="group" aria-label="Ver como">
      {modos.map((m) => (
        <button key={m} type="button" className={`btn${m === actual ? ' btn-active' : ''}`} aria-pressed={m === actual} onClick={() => onModo(m)}>
          {ETIQUETA_MODO[m]}
        </button>
      ))}
    </span>
  )
}

/** El texto de unos bytes en un modo, con el JSON coloreado (si no es enorme). */
function TextoEnModo({ bytes, modo }: { bytes: DbKvBytes; modo: ModoVista }): React.JSX.Element {
  const { texto } = useMemo(() => textoEnModo(bytes, modo), [bytes, modo])
  const tokens = useMemo(() => (modo === 'json' && texto.length <= COLOREAR_JSON_MAX ? tokensJson(texto) : null), [modo, texto])
  const clase = `db-clave-texto modo-${modo}${bytes.texto === undefined && modo === 'texto' ? ' binario' : ''}`
  if (!tokens) {
    return (
      <pre className={clase} tabIndex={0}>
        {texto}
      </pre>
    )
  }
  return (
    <pre className={clase} tabIndex={0}>
      {tokens.map((t, i) =>
        t.clase === 'espacio' ? (
          t.texto
        ) : (
          <span key={i} className={`tk-${t.clase}`}>
            {t.texto}
          </span>
        )
      )}
    </pre>
  )
}

/**
 * Un string o un JSON: la subbarra con el modo y el tamaño, el aviso de cortado y el texto.
 * `soloTexto`: el JSON de módulo llega como TEXTO (sin sus bytes), así que no hay hex.
 */
export function VistaBytes({
  bytes,
  aviso,
  modoElegido,
  onModo,
  soloTexto = false
}: {
  bytes: DbKvBytes
  aviso: string | null
  modoElegido: ModoVista | null
  onModo: (m: ModoVista) => void
  soloTexto?: boolean
}): React.JSX.Element {
  const modos = useMemo(() => (soloTexto ? modosDe(bytes).filter((m) => m !== 'hex') : modosDe(bytes)), [bytes, soloTexto])
  const modo = modoElegido !== null && modos.includes(modoElegido) ? modoElegido : modoInicial(bytes)
  const recortado = useMemo(() => modo === 'hex' && textoEnModo(bytes, 'hex').recortado, [bytes, modo])
  const tamano = soloTexto ? null : tamanoBytes(bytes)
  return (
    <>
      <div className="db-clave-sub">
        <Modos modos={modos} actual={modo} onModo={onModo} />
        <span className="db-clave-sub-texto">
          {soloTexto ? 'Documento JSON' : bytes.texto === undefined ? 'No es texto UTF-8' : 'Texto UTF-8'}
          {tamano !== null && ` · ${bytesLegibles(tamano)}${aviso ? ' leídos' : ''}`}
        </span>
      </div>
      {aviso && <div className="db-clave-aviso">{aviso}</div>}
      {recortado && <div className="db-clave-aviso">El volcado hex enseña solo el principio del valor.</div>}
      <TextoEnModo bytes={bytes} modo={modo} />
    </>
  )
}

/** Una parte del detalle de la fila elegida (un campo, un valor, un ID…). */
export function ParteVista({ parte, onCopiar }: { parte: ParteDetalle; onCopiar: () => void }): React.JSX.Element {
  const bytes = 'bytes' in parte ? parte.bytes : null
  const [modoElegido, setModoElegido] = useState<ModoVista | null>(null)
  const modos = useMemo(() => (bytes ? modosDe(bytes) : []), [bytes])
  const modo = bytes ? (modoElegido !== null && modos.includes(modoElegido) ? modoElegido : modoInicial(bytes)) : 'texto'
  return (
    <section className="db-clave-parte">
      <div className="db-clave-parte-cab">
        <span className="db-clave-parte-titulo" title={parte.titulo}>
          {parte.titulo}
        </span>
        {bytes && <span className="db-clave-parte-tamano">{bytesLegibles(tamanoBytes(bytes))}</span>}
        {bytes && modos.length > 1 && <Modos modos={modos} actual={modo} onModo={setModoElegido} />}
        <BotonBarraBd etiqueta={`Copiar ${parte.titulo}`} titulo={`Copiar ${parte.titulo}`} onClick={onCopiar}>
          <IconoCopiar />
        </BotonBarraBd>
      </div>
      {bytes ? (
        <TextoEnModo bytes={bytes} modo={modo} />
      ) : (
        <pre className="db-clave-texto" tabIndex={0}>
          {'texto' in parte ? parte.texto : ''}
        </pre>
      )}
    </section>
  )
}
