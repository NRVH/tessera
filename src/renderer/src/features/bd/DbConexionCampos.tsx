// =============================================================================
// Los campos del diálogo de conexión que salen del descriptor del motor: cada fila de
// `FormularioMotor` con sus ayudas y avisos en vivo, cada campo según su `tipo` y el
// selector del ARCHIVO de un motor de archivo. `data-campo` es la dirección por la que
// el diálogo lleva el foco al primer campo que falta.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

import { Fragment } from 'react'
import type { DbMotor } from '../../../../shared/db-ipc'
import { esAutenticacion } from '../../../../shared/motores/index'
import { conSrv, type BorradorConexion } from './borradorConexion'
import {
  avisoDeCampo,
  campoDeshabilitado,
  campoVisible,
  type AnchoCampo,
  type CampoConexion,
  type CampoTextoFormulario,
  type DefCampo
} from './camposConexion'
import { pegarRecortado } from '../../util/pasteTrim'

/** El `ancho` del descriptor, en las clases de este diálogo. `medio` es `.dbc-sid` (ver `dialogo.css`). */
const CLASE_ANCHO: Record<AnchoCampo, string> = {
  crece: 'dbc-crece',
  puerto: 'dbc-puerto',
  medio: 'dbc-sid'
}

interface PropsCampo {
  borrador: BorradorConexion
  invalido: boolean
  onTexto: (campo: CampoTextoFormulario, valor: string) => void
  onPuerto: (puerto: number) => void
  /** Para la autenticación y el cifrado, que no son texto. */
  onEditar: (parcial: Partial<BorradorConexion>) => void
  /** El SRV: no es un `editar` a secas, arrastra el cifrado y el puerto (`conSrv`). */
  onSrv: (srv: boolean) => void
}

type DefDe<T extends DefCampo['tipo']> = Extract<DefCampo, { tipo: T }>

/** Una casilla sola (el SRV), con el mismo aire que las del cifrado. */
function casillaSrv(def: DefDe<'casilla'>, p: PropsCampo): React.JSX.Element {
  return (
    <div className={`dbc-cifrado ${CLASE_ANCHO[def.ancho]}`}>
      <label className="dbc-check">
        <input type="checkbox" data-campo={def.campo} checked={p.borrador.srv} onChange={(e) => p.onSrv(e.target.checked)} />
        {def.etiqueta}
      </label>
    </div>
  )
}

/**
 * Las dos casillas de `DbTls`. Sin <label> de campo alrededor (cada casilla es ya su
 * <label>) ni `.dbc-campo`, cuyas reglas de input deformarían las casillas.
 */
function casillasCifrado(def: DefDe<'cifrado'>, p: PropsCampo): React.JSX.Element {
  const { borrador, onEditar } = p
  return (
    <div className={`dbc-cifrado ${CLASE_ANCHO[def.ancho]}`} data-campo={def.campo}>
      <label className="dbc-check">
        <input
          type="checkbox"
          checked={borrador.tls.cifrar}
          onChange={(e) => onEditar({ tls: { ...borrador.tls, cifrar: e.target.checked } })}
        />
        {def.etiqueta}
      </label>
      <label className="dbc-check">
        <input
          type="checkbox"
          data-casilla="confiarCertificado"
          checked={borrador.tls.confiarCertificado}
          onChange={(e) => onEditar({ tls: { ...borrador.tls, confiarCertificado: e.target.checked } })}
        />
        {def.etiquetaConfiar}
      </label>
    </div>
  )
}

function selectorAutenticacion(def: DefDe<'eleccion'>, p: PropsCampo): React.JSX.Element {
  return (
    <select
      data-campo={def.campo}
      aria-invalid={p.invalido || undefined}
      value={p.borrador.autenticacion}
      onChange={(e) => {
        const v = e.target.value
        if (esAutenticacion(v)) p.onEditar({ autenticacion: v })
      }}
    >
      {def.opciones.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.etiqueta}
        </option>
      ))}
    </select>
  )
}

/** Con SRV, apagado y VACÍO: enseñar el puerto que conserva el borrador diría que se usa. */
function inputPuerto(def: DefDe<'puerto'>, p: PropsCampo): React.JSX.Element {
  const apagado = campoDeshabilitado(def.campo, p.borrador)
  return (
    <input
      type="number"
      data-campo={def.campo}
      aria-invalid={(p.invalido && !apagado) || undefined}
      disabled={apagado}
      title={apagado ? 'Con DNS SRV, el puerto no se usa' : undefined}
      value={apagado ? '' : p.borrador.port}
      placeholder={apagado ? '—' : def.placeholder}
      onChange={(e) => p.onPuerto(Number(e.target.value))}
      // `pegarRecortado` no: recoloca el cursor con `setSelectionRange`, que
      // un input numérico no admite (lanza). Aquí basta con recortar.
      onPaste={(e) => {
        const pegado = e.clipboardData.getData('text')
        if (pegado === pegado.trim()) return
        e.preventDefault()
        p.onPuerto(Number(pegado.trim()))
      }}
    />
  )
}

/** Un campo de texto; lo que se avisa en vivo bajo la fila también lo pone en rojo. */
function inputTexto(def: DefDe<'texto'>, p: PropsCampo): React.JSX.Element {
  const campo = def.campo
  const marcado = p.invalido || avisoDeCampo(campo, p.borrador) !== null
  return (
    <input
      data-campo={campo}
      aria-invalid={marcado || undefined}
      value={p.borrador[campo]}
      placeholder={def.placeholder}
      spellCheck={false}
      onChange={(e) => p.onTexto(campo, e.target.value)}
      onPaste={pegarRecortado((v) => p.onTexto(campo, v))}
    />
  )
}

function inputDelCampo(def: DefDe<'eleccion' | 'puerto' | 'texto'>, p: PropsCampo): React.JSX.Element {
  if (def.tipo === 'eleccion') return selectorAutenticacion(def, p)
  if (def.tipo === 'puerto') return inputPuerto(def, p)
  return inputTexto(def, p)
}

/** Un campo del destino tal como lo describe el motor. */
function CampoDelDestino({ def, ...p }: PropsCampo & { def: DefCampo }): React.JSX.Element {
  if (def.tipo === 'casilla') return casillaSrv(def, p)
  if (def.tipo === 'cifrado') return casillasCifrado(def, p)
  return (
    <label className={`dbc-campo ${CLASE_ANCHO[def.ancho]}`}>
      <span className="dbc-etiqueta">{def.etiqueta}</span>
      {inputDelCampo(def, p)}
    </label>
  )
}

/** Lo que se dice EN VIVO bajo una fila (`avisoDeCampo`), en rojo y sin esperar a guardar. */
function avisosDeFila(fila: readonly DefCampo[], borrador: BorradorConexion): React.JSX.Element[] {
  return fila.flatMap((def) => {
    const aviso = avisoDeCampo(def.campo, borrador)
    return aviso === null
      ? []
      : [
          <p key={`aviso-${def.campo}`} className="dbc-error" role="status">
            {aviso}
          </p>
        ]
  })
}

/**
 * Filas de campos del descriptor, cada una con sus ayudas y sus avisos en vivo. La clave
 * es el primer campo de la fila, que no cambia entre motores: así cambiar de motor
 * conserva los inputs que siguen y solo cambia lo que dicen.
 */
export function FilasDelFormulario({
  filas,
  ayudas,
  borrador,
  marcados,
  onTexto,
  onEditar,
  setBorrador
}: {
  filas: readonly (readonly DefCampo[])[]
  ayudas: (motor: DbMotor, indice: number) => string[]
  borrador: BorradorConexion
  marcados: readonly (CampoConexion | DefCampo['campo'])[]
  onTexto: (campo: CampoTextoFormulario, valor: string) => void
  onEditar: (parcial: Partial<BorradorConexion>) => void
  setBorrador: React.Dispatch<React.SetStateAction<BorradorConexion>>
}): React.JSX.Element {
  return (
    <>
      {filas.map((fila, i) => (
        <Fragment key={fila[0]?.campo ?? i}>
          <div className="dbc-fila">
            {fila
              .filter((def) => campoVisible(def.campo, borrador))
              .map((def) => (
                <CampoDelDestino
                  key={def.campo}
                  def={def}
                  borrador={borrador}
                  invalido={marcados.includes(def.campo)}
                  onTexto={onTexto}
                  onPuerto={(port) => onEditar({ port })}
                  onEditar={onEditar}
                  onSrv={(srv) => setBorrador((b) => conSrv(b, srv))}
                />
              ))}
          </div>
          {ayudas(borrador.motor, i).map((ayuda) => (
            <p key={ayuda} className="dbc-ayuda">
              {ayuda}
            </p>
          ))}
          {avisosDeFila(fila, borrador)}
        </Fragment>
      ))}
    </>
  )
}

/**
 * El ARCHIVO de un motor de archivo: su nombre, «Elegir…» (diálogo nativo de abrir) y
 * «Crear nueva…» (el de guardar: crea una base vacía). El nombre va en un input de SOLO
 * LECTURA para que el foco del primer campo que falta, su `aria-invalid` y el lector de
 * pantalla funcionen como en los demás; un clic en él elige.
 */
export function CampoArchivo({
  nombre,
  invalido,
  ocupado,
  onElegir,
  onCrear
}: {
  nombre: string
  invalido: boolean
  ocupado: boolean
  onElegir: () => void
  onCrear: () => void
}): React.JSX.Element {
  return (
    <div className="dbc-fila">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Archivo</span>
        <span className="dbc-archivo">
          <input
            data-campo="archivo"
            readOnly
            aria-invalid={invalido || undefined}
            value={nombre}
            placeholder="Ningún archivo elegido"
            title={nombre || undefined}
            onClick={() => {
              if (!ocupado) onElegir()
            }}
          />
          <button type="button" className="btn" disabled={ocupado} onClick={onElegir}>
            Elegir…
          </button>
          <button
            type="button"
            className="btn"
            disabled={ocupado}
            title="Crea un archivo de base de datos nuevo y vacío"
            onClick={onCrear}
          >
            Crear nueva…
          </button>
        </span>
      </label>
    </div>
  )
}
