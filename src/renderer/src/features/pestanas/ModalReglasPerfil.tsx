// =============================================================================
// ModalReglasPerfil: el texto de una propuesta de reglas para editarlo antes de aceptarlo, las de un perfil
// o las globales. Un texto grande, su contador contra el tope (en rojo y sin poder guardar al pasarlo; con un
// aviso al acercarse) y
// Guardar o Cancelar. Guarda el texto tal cual; normalizarlo es cosa de quien lo guarda. Las reglas vigentes
// se editan en el contexto de los agentes. Depende de comun/Modal y de shared/reglasPerfil; lo abre
// `CapaPropuestasReglas`.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import '../../comun/formularioModal.css'
import './reglasPerfil.css'
import { useId, useState } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'
import { ID_REGLAS_GLOBALES } from '../../../../shared/reglas-ipc'
import { MAX_REGLAS_PERFIL, normalizarReglas, reglasCercaDelTope } from '../../../../shared/reglasPerfil'
import { ModalAviso, Modal, ModalPie } from '../../comun/Modal'
import { AYUDA, BotonAyuda } from '../academy'
import { txPestanas } from './textos.ts'

interface PropsModalReglasPerfil {
  /** El perfil, o el nivel global con su id reservado. */
  perfil: Pick<Perfil, 'id' | 'nombre' | 'reglas'>
  /** El texto con que se abre en vez de las vigentes (el de la propuesta). */
  textoInicial?: string
  onGuardar: (reglas: string) => void
  onCancelar: () => void
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
      {reglasCercaDelTope(p.largo) && <ModalAviso tono="aviso">{t.cercaDelTope}</ModalAviso>}
    </div>
  )
}

/** Diálogo de las reglas de un perfil, o de las globales, para editar una propuesta. */
export function ModalReglasPerfil({ perfil, textoInicial, onGuardar, onCancelar }: PropsModalReglasPerfil): React.JSX.Element {
  const idAyuda = useId()
  const t = txPestanas().reglas
  const global = perfil.id === ID_REGLAS_GLOBALES
  const [texto, setTexto] = useState(textoInicial ?? perfil.reglas ?? '')
  // El tope es el del texto que se guarda (ya normalizado), no el que se va tecleando.
  const largo = normalizarReglas(texto).length
  const excedido = largo > MAX_REGLAS_PERFIL

  return (
    <Modal titulo={global ? t.tituloGlobal : t.titulo(perfil.nombre)} ayuda={<BotonAyuda destino={AYUDA.reglasDelPerfil} />}
      tamano="m" className="db-conexion-modal reglas-modal" onCerrar={onCancelar}
      cierraConVelo={texto === (textoInicial ?? perfil.reglas ?? '')}
      pie={<ModalPie>
        <button type="button" className="btn btn-ghost" onClick={onCancelar}>{t.cancelar}</button>
        <button type="button" className="btn primary" disabled={excedido} onClick={() => onGuardar(texto)}>{t.guardar}</button>
      </ModalPie>}>
      <div id={idAyuda} className="dbc-ayuda">{global ? t.mensajeGlobal : t.mensaje}</div>
      <CampoReglas texto={texto} largo={largo} excedido={excedido} idAyuda={idAyuda} onCambio={setTexto} />
    </Modal>
  )
}
