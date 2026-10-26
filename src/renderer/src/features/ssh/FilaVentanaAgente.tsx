// =============================================================================
// «Nueva ventana de agente» al pie de las conexiones SSH (el lanzador de la ▾ y el riel a pantalla
// completa): en su propia fila, porque no es un alta del perfil sino otra ventana, y con una «i» pegada
// al texto que explica qué abre, que el nombre solo no lo dice.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import { IconoColumnaAgente } from '../../comun/iconosPanel'
import { IconoInfo } from './iconosSsh'
import { txSsh } from './textos.ts'

/** La fila; `alAbrir` lo llama quien la aloja tras pedir la ventana (el lanzador se cierra). */
export function FilaVentanaAgente({ alAbrir, className = '' }: { alAbrir?: () => void; className?: string }): React.JSX.Element {
  const t = txSsh()
  return (
    <div className={`ssh-pie ssh-pie-ventana${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="ssh-pie-boton"
        title={t.nuevaVentanaAgenteTitulo}
        onClick={() => {
          void window.tessera.ventanaAgente.abrir()
          alAbrir?.()
        }}
      >
        <IconoColumnaAgente />
        {t.nuevaVentanaAgente}
        {/* Pegada al texto y a su altura; pulsarla solo explica, no abre la ventana. Fuera del nombre del
            botón: el lector de pantalla ya recibe la explicación por su `title`. */}
        <span className="ssh-pie-info" aria-hidden="true" title={t.nuevaVentanaAgenteTitulo} onClick={(e) => e.stopPropagation()}>
          <IconoInfo />
        </span>
      </button>
    </div>
  )
}
