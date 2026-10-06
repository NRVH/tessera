// =============================================================================
// El archivo de clave de una conexión SSH: su nombre en un campo de solo lectura, «Elegir…» (el
// diálogo nativo) y soltar el archivo encima. La ruta no pasa por aquí: la del archivo soltado la
// saca el preload, y el main devuelve una ficha y el nombre. Si la clave tiene frase, su campo es
// `CampoSecretoSsh`. Presentación: el estado es de `useDialogoConexionSsh`.
// Decisiones: docs/decisiones/ssh/claves-importadas.md
// =============================================================================

import { useState } from 'react'
import type { ClaveBorrador } from './borradorSsh'

/** ¿Se arrastran archivos del sistema? Mientras dura el arrastre solo se ven los tipos. */
function arrastraArchivos(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files')
}

/** Lo que recibe el campo. */
export interface PropsCampoClaveSsh {
  clave: ClaveBorrador | null
  invalido: boolean
  /** Importando: el diálogo está abierto o la copia se está comprobando. */
  ocupado: boolean
  error: string | null
  onElegir: () => void
  onSoltar: (archivo: File) => void
}

/** El campo del método «Archivo de clave»: el nombre se ve como un campo más y un clic en él elige. */
export function CampoClaveSsh({ clave, invalido, ocupado, error, onElegir, onSoltar }: PropsCampoClaveSsh): React.JSX.Element {
  const [encima, setEncima] = useState(false)
  const titulo = clave === null ? undefined : clave.tipo !== null ? `${clave.nombre} (${clave.tipo})` : clave.nombre
  return (
    <div className="ssh-campo-clave">
      <label className="dbc-campo">
        <span className="dbc-etiqueta">Archivo de clave</span>
        <span
          className={`ssh-clave-archivo${encima ? ' soltando' : ''}`}
          onDragOver={(e) => {
            if (ocupado || !arrastraArchivos(e)) return
            e.preventDefault() // sin esto el navegador no admite el soltado
            e.dataTransfer.dropEffect = 'copy'
            if (!encima) setEncima(true)
          }}
          onDragLeave={(e) => {
            // Solo al salir del campo, no al pasar del texto al botón.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false)
          }}
          onDrop={(e) => {
            setEncima(false)
            if (ocupado || !arrastraArchivos(e)) return
            e.preventDefault()
            e.stopPropagation()
            const archivo = e.dataTransfer.files[0]
            if (archivo) onSoltar(archivo)
          }}
        >
          <input
            data-campo="clave"
            readOnly
            aria-invalid={invalido || undefined}
            value={clave?.nombre ?? ''}
            placeholder="Elige el archivo o suéltalo aquí"
            title={titulo}
            onClick={() => {
              if (!ocupado) onElegir()
            }}
          />
          <button type="button" className="btn" disabled={ocupado} onClick={onElegir}>
            {ocupado ? 'Importando…' : 'Elegir…'}
          </button>
        </span>
      </label>
      {error !== null && (
        <div className="dbc-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
