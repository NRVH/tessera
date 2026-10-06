// =============================================================================
// DialogoParametros: los valores de los parámetros (`:id`, `$1`) de lo que se va a
// ejecutar o explicar en la consola SQL. Uno por clave del lote, con su casilla NULL;
// ENTER ejecuta desde cualquier campo y ESC cancela. Los campos, los valores iniciales
// y el pie son de `consola/parametrosConsola.ts`; aquí solo se pinta y se devuelven
// los `DbBinds` (o null). Va por portal desde el pane, como los demás diálogos.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useEffect, useId, useRef, useState, type MutableRefObject } from 'react'
import type { DbBinds } from '../../../../shared/db-explorador-ipc'
import type { DialectoSql } from '../../../../shared/sql/dialectosSql'
import { cantidad } from './consola/salidaConsola'
import {
  pieDialogoParametros,
  valoresABinds,
  type AccionParametros,
  type CampoParametro,
  type ValorCampo
} from './consola/parametrosConsola'
import { esDeUnaListaDeSelect, useDialogo } from '../../comun/useDialogo'

export interface DialogoParametrosProps {
  campos: CampoParametro[]
  iniciales: Record<string, ValorCampo>
  mensaje: string
  accion: AccionParametros
  dialecto: DialectoSql
  alias: string
  onAceptar: (binds: DbBinds) => void
  onCancelar: () => void
}

/** Lo que comparten las filas: dónde van el foco inicial y los campos, y cómo se edita. */
interface FilasParametros {
  idBase: string
  valores: Record<string, ValorCampo>
  primeroNulo: boolean
  refs: MutableRefObject<Map<string, HTMLInputElement>>
  primeroRef: MutableRefObject<HTMLInputElement | null>
  poner: (clave: string, cambio: Partial<ValorCampo>) => void
}

/** Un parámetro: su nombre, el campo de texto y la casilla NULL que lo deshabilita. */
function FilaParametro({ c, i, f }: { c: CampoParametro; i: number; f: FilasParametros }): React.JSX.Element {
  const { primeroNulo, refs, primeroRef, poner } = f
  const idCampo = `${f.idBase}-v${i}`
  const v = f.valores[c.clave] ?? { texto: '', nulo: false }
  return (
    <div className="db-param-fila">
      <label
        className="db-param-nombre"
        htmlFor={idCampo}
        title={c.sentencias > 1 ? `${c.etiqueta}: aparece en ${cantidad(c.sentencias, 'sentencia', 'sentencias')}` : c.etiqueta}
      >
        {c.etiqueta}
      </label>
      <input
        id={idCampo}
        ref={(el) => {
          if (el) refs.current.set(c.clave, el)
          else refs.current.delete(c.clave)
          if (i === 0 && !primeroNulo) primeroRef.current = el
        }}
        className="modal-input db-param-valor"
        type="text"
        value={v.nulo ? '' : v.texto}
        placeholder={v.nulo ? 'NULL' : ''}
        disabled={v.nulo}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => poner(c.clave, { texto: e.target.value })}
      />
      <label className="db-param-nulo" title="Enviar NULL (sin valor)">
        <input
          type="checkbox"
          ref={(el) => {
            if (i === 0 && primeroNulo) primeroRef.current = el
          }}
          checked={v.nulo}
          onChange={(e) => {
            const nulo = e.target.checked
            poner(c.clave, { nulo })
            // Al desmarcar, el foco vuelve al campo que se acaba de habilitar.
            if (!nulo) requestAnimationFrame(() => refs.current.get(c.clave)?.focus())
          }}
        />
        NULL
      </label>
    </div>
  )
}

/**
 * Enter acepta desde cualquier campo, también desde la casilla NULL. Esc sube (lo
 * escucha `useDialogo` en `window`); las demás teclas no son de la consola de debajo.
 */
function teclaParametros(
  e: React.KeyboardEvent<HTMLDivElement>,
  alPulsarTecla: (e: React.KeyboardEvent<HTMLDivElement>) => void,
  aceptar: () => void
): void {
  // Con la lista de un select desplegada, sus teclas son de la lista (es del DOM y burbujea).
  if (esDeUnaListaDeSelect(e.target)) return
  alPulsarTecla(e)
  if (e.key === 'Escape') return
  e.stopPropagation()
  if (e.key === 'Enter' && !e.nativeEvent.isComposing && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault()
    aceptar()
  }
}

/**
 * El foco arranca en el primer campo con su texto seleccionado (o en su casilla NULL):
 * lo normal es teclear encima del valor de la vez anterior o aceptarlo con Enter.
 */
function useFocoInicial(): MutableRefObject<HTMLInputElement | null> {
  const primeroRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = primeroRef.current
    if (el) {
      el.focus()
      if (el.type === 'text') el.select()
    }
  }, [])
  return primeroRef
}

/** El diálogo de los valores de los parámetros; devuelve los `DbBinds` al aceptar. */
export function DialogoParametros(p: DialogoParametrosProps): React.JSX.Element {
  const { campos, onAceptar, onCancelar } = p
  const dlg = useDialogo({ onClose: onCancelar })
  const idBase = useId()
  const [valores, setValores] = useState<Record<string, ValorCampo>>(() => ({ ...p.iniciales }))
  const primeroRef = useFocoInicial()
  const refs = useRef(new Map<string, HTMLInputElement>())

  const aceptar = (): void => onAceptar(valoresABinds(campos, valores))
  const poner = (clave: string, cambio: Partial<ValorCampo>): void =>
    setValores((v) => ({ ...v, [clave]: { ...(v[clave] ?? { texto: '', nulo: false }), ...cambio } }))
  const primeroNulo = campos.length > 0 && valores[campos[0].clave]?.nulo === true
  const f: FilasParametros = { idBase, valores, primeroNulo, refs, primeroRef, poner }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onCancelar}>
      <div
        ref={dlg.ref}
        className="modal-card db-parametros-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idBase}-titulo`}
        aria-describedby={`${idBase}-mensaje`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => teclaParametros(e, dlg.alPulsarTecla, aceptar)}
      >
        <div className="modal-title" id={`${idBase}-titulo`}>
          Parámetros <span className="db-param-alias">· {p.alias}</span>
        </div>
        <div className="modal-message" id={`${idBase}-mensaje`}>
          {p.mensaje}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            aceptar()
          }}
        >
          <div className="db-param-lista" role="group" aria-label="Valores de los parámetros">
            {campos.map((c, i) => (
              <FilaParametro key={c.clave} c={c} i={i} f={f} />
            ))}
          </div>
          <div className="db-param-pie">{pieDialogoParametros(p.dialecto)}</div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancelar}>
              Cancelar
            </button>
            <button type="submit" className="btn primary">
              {p.accion === 'explicar' ? 'Explicar plan' : 'Ejecutar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
