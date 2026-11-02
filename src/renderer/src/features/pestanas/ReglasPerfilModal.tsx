// =============================================================================
// ReglasPerfilModal: diálogo donde el usuario escribe las reglas de un perfil para sus agentes. Un texto
// grande, su contador contra el tope (en rojo y sin poder guardar al pasarlo) y Guardar o Cancelar; si un
// agente propuso un cambio, un aviso para revisarlo, y para editar una propuesta se abre con su texto.
// Guarda el texto tal cual; normalizarlo y quitar el campo si queda vacío es cosa del reductor de pestañas.
// Depende de comun/useDialogo y de shared/reglasPerfil; lo abren `DialogosPerfil` y `CapaPropuestasReglas`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import '../../comun/formularioModal.css'
import './reglasPerfil.css'
import { useId, useState } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import { MAX_REGLAS_PERFIL, normalizarReglas } from '../../../../shared/reglasPerfil'
import { alClicEnVelo, useDialogo } from '../../comun/useDialogo'
import { AYUDA, BotonAyuda } from '../academy'
import { txPestanas } from './textos.ts'

interface ReglasPerfilModalProps {
  profile: Profile
  /** El texto con que se abre en vez de las vigentes (editar una propuesta antes de aceptarla). */
  textoInicial?: string
  /** Si hay una propuesta pendiente para este perfil: el diálogo lo avisa y deja revisarla. */
  onRevisarPropuesta?: () => void
  onGuardar: (reglas: string) => void
  onCancel: () => void
}

/** El aviso de que hay una propuesta pendiente, con el botón para revisarla. */
function AvisoPropuesta({ onRevisar }: { onRevisar: () => void }): React.JSX.Element {
  const t = txPestanas().reglas
  return (
    <div className="reglas-aviso-propuesta" role="status">
      <span>{t.hayPropuesta}</span>
      <button type="button" className="btn btn-ghost" onClick={onRevisar}>
        {t.revisarPropuesta}
      </button>
    </div>
  )
}

/** El texto de las reglas y su contador contra el tope. */
function CampoReglas(p: { texto: string; largo: number; excedido: boolean; idAyuda: string; onCambio: (texto: string) => void }): React.JSX.Element {
  const id = useId()
  const t = txPestanas().reglas
  return (
    <div className="dbc-campo">
      <label className="dbc-etiqueta" htmlFor={id}>
        {t.etiqueta}
      </label>
      <textarea
        id={id}
        className="reglas-texto"
        value={p.texto}
        autoFocus
        spellCheck={false}
        placeholder={t.placeholder}
        aria-describedby={p.idAyuda}
        onChange={(e) => p.onCambio(e.target.value)}
      />
      <span className={`reglas-contador${p.excedido ? ' excedido' : ''}`} role={p.excedido ? 'alert' : undefined} data-testid="reglas-contador">
        {p.excedido && `${t.demasiado} `}
        {t.contador(p.largo, MAX_REGLAS_PERFIL)}
      </span>
    </div>
  )
}

/** Diálogo de las reglas de un perfil para sus agentes. */
export function ReglasPerfilModal({ profile, textoInicial, onRevisarPropuesta, onGuardar, onCancel }: ReglasPerfilModalProps): React.JSX.Element {
  const dialogo = useDialogo({ onClose: onCancel })
  const idTitulo = useId()
  const idAyuda = useId()
  const t = txPestanas().reglas
  const [texto, setTexto] = useState(textoInicial ?? profile.reglas ?? '')
  // El tope es el del texto que se guarda (ya normalizado), no el que se va tecleando.
  const largo = normalizarReglas(texto).length
  const excedido = largo > MAX_REGLAS_PERFIL

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={alClicEnVelo(onCancel)}>
      <div
        ref={dialogo.ref}
        className="modal-card db-conexion-modal reglas-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={dialogo.alPulsarTecla}
      >
        <form
          className="dbc-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!excedido) onGuardar(texto)
          }}
        >
          <div className="dbc-cabecera">
            <div className="dbc-titulo-fila">
              <div id={idTitulo} className="modal-title">
                {t.titulo(profile.nombre)}
              </div>
              <BotonAyuda destino={AYUDA.reglasDelPerfil} />
            </div>
            <div id={idAyuda} className="dbc-ayuda">
              {t.mensaje}
            </div>
          </div>
          <div className="dbc-cuerpo">
            {onRevisarPropuesta && <AvisoPropuesta onRevisar={onRevisarPropuesta} />}
            <CampoReglas texto={texto} largo={largo} excedido={excedido} idAyuda={idAyuda} onCambio={setTexto} />
          </div>
          <div className="modal-actions dbc-acciones">
            <span className="dbc-hueco" />
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              {t.cancelar}
            </button>
            <button type="submit" className="btn primary" disabled={excedido}>
              {t.guardar}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
