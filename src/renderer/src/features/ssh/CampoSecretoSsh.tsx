// =============================================================================
// El campo de la contraseña (método «Contraseña») o de la frase (una clave que la tiene) de una conexión
// SSH: de SOLO ESCRITURA, con su ojo, «(sin cambios)» si ya hay una guardada, «Olvidarla» para borrarla
// y el aviso de una que este equipo no puede leer. Lo que pasará con la guardada lo decide `secretoSsh`;
// el estado, `useDialogoConexionSsh`. El almacén del sistema se nombra con `nombresSistema`.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { useState } from 'react'
import { IconoOjo } from '../../comun/iconosFormulario'
import { pegarRecortado } from '../../util/pasteTrim'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { BorradorSsh, CampoSsh } from './borradorSsh'
import { avisoSecretoIlegible, ayudaSecreto, marcadorSecreto, type DestinoSecreto } from './secretoSsh'

/** Lo que recibe el campo. */
export interface PropsCampoSecretoSsh {
  borrador: BorradorSsh
  destino: DestinoSecreto
  marcados: readonly CampoSsh[]
  editar: (parcial: Partial<BorradorSsh>) => void
}

/** El campo del secreto, con su ayuda debajo. */
export function CampoSecretoSsh({ borrador, destino, marcados, editar }: PropsCampoSecretoSsh): React.JSX.Element {
  const [ver, setVer] = useState(false)
  const esFrase = borrador.metodo === 'clave'
  const etiqueta = esFrase ? 'Frase de la clave' : 'Contraseña'
  const olvidable = destino === 'se-conserva' || destino === 'se-olvida'
  return (
    <div className="ssh-campo-secreto">
      <label className="dbc-campo">
        <span className="dbc-etiqueta">
          {etiqueta} {esFrase && <span className="dbc-ayuda-inline">(opcional)</span>}
        </span>
        <span className="dbc-pass">
          <input
            data-campo="secreto"
            type={ver ? 'text' : 'password'}
            aria-invalid={marcados.includes('secreto') || undefined}
            value={borrador.secreto}
            placeholder={marcadorSecreto(destino)}
            disabled={borrador.olvidarSecreto}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(e) => editar({ secreto: e.target.value })}
            onPaste={pegarRecortado((v) => editar({ secreto: v }))}
          />
          <button
            type="button"
            className="dbc-pass-ojo"
            title={ver ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
            aria-label={ver ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
            aria-pressed={ver}
            // Al tabular por el formulario se salta el ojo y se pasa al siguiente CAMPO.
            tabIndex={-1}
            onClick={() => setVer((v) => !v)}
          >
            <IconoOjo tachado={ver} />
          </button>
        </span>
      </label>
      {destino === 'se-conserva' && borrador.secretoIlegible && (
        <div className="ssh-aviso-secreto" role="note">
          {avisoSecretoIlegible(esFrase, nombresSistema(window.tessera.plataforma).almacenSecretos)}
        </div>
      )}
      <div className="ssh-secreto-ayuda">
        <p className="dbc-ayuda">{ayudaSecreto(destino, esFrase)}</p>
        {olvidable && (
          <button type="button" className="btn btn-ghost ssh-secreto-olvidar" onClick={() => editar({ olvidarSecreto: !borrador.olvidarSecreto, secreto: '' })}>
            {borrador.olvidarSecreto ? 'No olvidarla' : `Olvidar la ${esFrase ? 'frase' : 'contraseña'} guardada`}
          </button>
        )}
      </div>
    </div>
  )
}
