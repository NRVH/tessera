// =============================================================================
// DialogoParametros: los valores de los parámetros (`:id`, `$1`) de lo que se va a
// ejecutar o explicar en la consola SQL. Uno por clave del lote, con su interruptor NULL;
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
import { esDeUnaListaDeSelect } from '../../comun/useDialogo'
import { Modal, ModalPie } from '../../comun/Modal'
import { Interruptor } from '../../comun/piezasAjustes'
import { txConsolaBd } from './textosConsolaBd.ts'

export interface PropsDialogoParametros {
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
  primeroRef: MutableRefObject<HTMLElement | null>
  poner: (clave: string, cambio: Partial<ValorCampo>) => void
}

/** Un parámetro: su nombre, el campo de texto y el interruptor NULL que lo deshabilita. */
function FilaParametro({ c, i, f }: { c: CampoParametro; i: number; f: FilasParametros }): React.JSX.Element {
  const { primeroNulo, refs, primeroRef, poner } = f
  const idCampo = `${f.idBase}-v${i}`
  const v = f.valores[c.clave] ?? { texto: '', nulo: false }
  const t = txConsolaBd()
  return (
    <div className="db-param-fila">
      <label
        className="db-param-nombre"
        htmlFor={idCampo}
        title={c.sentencias > 1 ? t.apareceEn(c.etiqueta, cantidad(c.sentencias, t.sentencia, t.sentencias)) : c.etiqueta}
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
      <label className="db-param-nulo">
        <Interruptor
          compacto
          etiqueta="NULL"
          ref={(el) => {
            if (i === 0 && primeroNulo) primeroRef.current = el
          }}
          activo={v.nulo}
          onCambio={() => {
            const nulo = !v.nulo
            poner(c.clave, { nulo })
            // Al apagarlo, el foco vuelve al campo que se acaba de habilitar.
            if (!nulo) requestAnimationFrame(() => refs.current.get(c.clave)?.focus())
          }}
        />
        NULL
      </label>
    </div>
  )
}

/**
 * Enter acepta desde cualquier campo, también desde el interruptor NULL. Esc sube (lo
 * escucha `useDialogo` en `window`); las demás teclas no son de la consola de debajo.
 */
function teclaParametros(
  e: React.KeyboardEvent<HTMLFormElement>,
  aceptar: () => void
): void {
  // Con la lista de un select desplegada, sus teclas son de la lista (es del DOM y burbujea).
  if (esDeUnaListaDeSelect(e.target)) return
  if (e.key === 'Escape') return
  if (e.key !== 'Tab') e.stopPropagation()
  // El interruptor NULL es un botón, pero Enter en él acepta como en los campos (alterna con Espacio).
  const esBoton = e.target instanceof HTMLButtonElement && e.target.getAttribute('role') !== 'switch'
  if (e.key === 'Enter' && !e.nativeEvent.isComposing && !esBoton) {
    e.preventDefault()
    aceptar()
  }
}

/**
 * El foco arranca en el primer campo con su texto seleccionado (o en su interruptor NULL):
 * lo normal es teclear encima del valor de la vez anterior o aceptarlo con Enter.
 */
function useFocoInicial(): MutableRefObject<HTMLElement | null> {
  const primeroRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = primeroRef.current
    if (el) {
      el.focus()
      if (el instanceof HTMLInputElement && el.type === 'text') el.select()
    }
  }, [])
  return primeroRef
}

/** El diálogo de los valores de los parámetros; devuelve los `DbBinds` al aceptar. */
export function DialogoParametros(p: PropsDialogoParametros): React.JSX.Element {
  const { campos, onAceptar, onCancelar } = p
  const idBase = useId()
  const [valores, setValores] = useState<Record<string, ValorCampo>>(() => ({ ...p.iniciales }))
  const primeroRef = useFocoInicial()
  const refs = useRef(new Map<string, HTMLInputElement>())

  const aceptar = (): void => onAceptar(valoresABinds(campos, valores))
  const poner = (clave: string, cambio: Partial<ValorCampo>): void =>
    setValores((v) => ({ ...v, [clave]: { ...(v[clave] ?? { texto: '', nulo: false }), ...cambio } }))
  const primeroNulo = campos.length > 0 && valores[campos[0].clave]?.nulo === true
  const f: FilasParametros = { idBase, valores, primeroNulo, refs, primeroRef, poner }
  const t = txConsolaBd()

  return (
    <Modal titulo={<>{t.parametros} <span className="db-param-alias">· {p.alias}</span></>}
      tamano="m" className="db-parametros-modal" subtitulo={p.mensaje} onCerrar={onCancelar}
      pie={<ModalPie>
        <button type="button" className="btn btn-ghost" onClick={onCancelar}>{t.cancelar}</button>
        <button type="button" className="btn primary" onClick={aceptar}>{p.accion === 'explicar' ? t.explicarPlan : t.ejecutar}</button>
      </ModalPie>}
    >
      <form className="db-param-form" onKeyDown={(e) => teclaParametros(e, aceptar)} onSubmit={(e) => { e.preventDefault(); aceptar() }}>
        <div className="db-param-lista" role="group" aria-label={t.valoresParametros}>
          {campos.map((c, i) => <FilaParametro key={c.clave} c={c} i={i} f={f} />)}
        </div>
        <div className="db-param-pie">{pieDialogoParametros(p.dialecto)}</div>
      </form>
    </Modal>
  )
}
