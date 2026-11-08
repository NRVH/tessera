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
import { FilaInterruptor } from '../../comun/piezasAjustes'
import { txConexionDialogo } from './textosConexionDialogo.ts'

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

/** Un interruptor solo (el SRV), con el mismo aire que los del cifrado. */
function casillaSrv(def: DefDe<'casilla'>, p: PropsCampo): React.JSX.Element {
  return (
    <div className={`dbc-cifrado ${CLASE_ANCHO[def.ancho]}`}>
      <FilaInterruptor
        etiqueta={def.etiqueta}
        data-campo={def.campo}
        activo={p.borrador.srv}
        onChange={() => p.onSrv(!p.borrador.srv)}
      />
    </div>
  )
}

/**
 * Los dos interruptores de `DbTls`. Sin <label> de campo alrededor (cada fila lleva ya
 * el suyo) ni `.dbc-campo`, cuyas reglas de input deformarían los controles.
 */
function casillasCifrado(def: DefDe<'cifrado'>, p: PropsCampo): React.JSX.Element {
  const { borrador, onEditar } = p
  return (
    <div className={`dbc-cifrado ${CLASE_ANCHO[def.ancho]}`} data-campo={def.campo}>
      <FilaInterruptor
        etiqueta={def.etiqueta}
        activo={borrador.tls.cifrar}
        onChange={() => onEditar({ tls: { ...borrador.tls, cifrar: !borrador.tls.cifrar } })}
      />
      {def.etiquetaConfiar !== null && (
        <FilaInterruptor
          etiqueta={def.etiquetaConfiar}
          data-casilla="confiarCertificado"
          activo={borrador.tls.confiarCertificado}
          onChange={() => onEditar({ tls: { ...borrador.tls, confiarCertificado: !borrador.tls.confiarCertificado } })}
        />
      )}
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
      title={apagado ? txConexionDialogo().sinPuertoSrv : undefined}
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
  const t = txConexionDialogo()
  return (
    <div className="dbc-fila">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">{t.archivo}</span>
        <span className="dbc-archivo">
          <input
            data-campo="archivo"
            readOnly
            aria-invalid={invalido || undefined}
            value={nombre}
            placeholder={t.ningunArchivo}
            title={nombre || undefined}
            onClick={() => {
              if (!ocupado) onElegir()
            }}
          />
          <button type="button" className="btn" disabled={ocupado} onClick={onElegir}>
            {t.elegir}
          </button>
          <button
            type="button"
            className="btn"
            disabled={ocupado}
            title={t.crearNuevaTitulo}
            onClick={onCrear}
          >
            {t.crearNueva}
          </button>
        </span>
      </label>
    </div>
  )
}
