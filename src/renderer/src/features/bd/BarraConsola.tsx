// =============================================================================
// BarraConsola: la cabecera de la consola SQL. A la IZQUIERDA solo texto que describe
// (alias, entorno, esquema, modo de transacción, «RO agentes», el estado vivo); a la
// DERECHA solo botones de icono grises (`consola/BotonesBarraConsola.tsx`). El
// cronómetro se refresca aquí para no repintar el editor; el esquema se elige con
// `SelectorEsquemaConsola`, colgado de su botón.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { TITULO_SOLO_LECTURA_AGENTES } from './camposConexion'
import { tituloBotonEsquema } from './consola/esquemaConsola'
import { nivelSelectorConsola, textosSelectorConsola, type TextosSelectorConsola } from './nivelBasesBd'
import { textoProgreso } from './consola/vivoConsola'
// Por `DbEsquemasPopover` y no por su archivo: así `arbol.css` sigue entrando en la
// cascada en el mismo punto (el orden de carga de los módulos decide el del CSS).
import { SelectorEsquemaConsola } from './DbEsquemasPopover'
import type { AnclaDerecha } from './consola/popoverFlotante'
import {
  AccionesBarraConsola,
  type BarraConsolaProps,
  type EstadoBotonEsquema
} from './consola/BotonesBarraConsola'
import { MarcaEntorno } from './MarcaEntorno'
import { TICK_MS } from './documentos/consolaComun'

export type { BarraConsolaProps } from './consola/BotonesBarraConsola'

/** La hora para el cronómetro, refrescada cada `TICK_MS` mientras se ejecuta. */
function useCronometro(ejecutando: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    if (!ejecutando) return
    setAhora(Date.now())
    const t = setInterval(() => setAhora(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [ejecutando])
  return ahora
}

/** El botón del esquema (o la base) y el ancla del selector abierto. */
function useBotonEsquema(p: BarraConsolaProps): EstadoBotonEsquema & { ancla: AnclaDerecha | null; cerrar: () => void } {
  const ref = useRef<HTMLButtonElement>(null)
  const [ancla, setAncla] = useState<AnclaDerecha | null>(null)
  // Qué elige: el esquema, la BASE (sin base fija: `USE`) o nada (base fija: sin botón).
  const nivel = nivelSelectorConsola(p.conexion)
  const textos = textosSelectorConsola(nivel)
  const titulo = p.cambiandoEsquema
    ? textos.cambiando
    : nivel === 'esquema'
      ? tituloBotonEsquema(p.esquemaActual, p.ejecutando)
      : textos.tituloBoton(p.esquemaActual, p.ejecutando)
  // Si empieza a ejecutar con el selector abierto (Mod+Enter desde el editor), se cierra.
  useEffect(() => {
    if (p.ejecutando) setAncla(null)
  }, [p.ejecutando])
  const alPulsar = (): void => {
    if (ancla) {
      setAncla(null)
      return
    }
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setAncla({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  const puede = !p.ejecutando && !p.cambiandoEsquema
  return { ref, abierto: ancla !== null, nivel, textos, titulo, puede, alPulsar, ancla, cerrar: () => setAncla(null) }
}

/** La mitad izquierda: solo texto, nada se pulsa. */
function IdentidadConsola({
  p,
  estado,
  anunciado,
  textos
}: {
  p: BarraConsolaProps
  estado: string | null
  anunciado: string
  textos: TextosSelectorConsola
}): React.JSX.Element {
  const tx = p.barraTx
  return (
    <div className="db-consola-identidad">
      <span className="db-consola-alias" title={p.alias}>
        {p.alias}
      </span>
      {/* El entorno junto al alias y como TEXTO de estado: no se pulsa. */}
      <MarcaEntorno entorno={p.conexion.entorno} />
      {p.esquemaActual && (
        <span className="db-consola-dato db-consola-esquema" title={textos.datoActual(p.esquemaActual)}>
          {p.esquemaActual}
        </span>
      )}
      <span className="db-consola-dato">{tx.textoModo}</span>
      {/* «RO» INFORMA de la casilla de los agentes: al usuario de la consola no lo
          limita. La solo lectura de la SESIÓN (`tx.soloLectura`) la impone el main. */}
      {p.conexion.readonly && (
        <span className="db-consola-dato" title={TITULO_SOLO_LECTURA_AGENTES}>
          RO agentes
        </span>
      )}
      {tx.soloLectura && <span className="db-consola-dato">Solo lectura</span>}
      {tx.textoTx && (
        <span className="db-consola-dato db-consola-tx" title={tx.tituloTx ?? undefined}>
          {tx.textoTx}
        </span>
      )}
      {estado && (
        <span className="db-consola-estado" title={estado}>
          {estado}
        </span>
      )}
      {/* Región viva SIEMPRE montada: una que aparece con el texto ya dentro no se anuncia. */}
      <span className="solo-lectores" aria-live="polite">
        {anunciado}
      </span>
    </div>
  )
}

/** Por qué no se puede ejecutar (ni explicar) ahora; undefined = se puede. */
function motivoParaEjecutar(p: BarraConsolaProps): string | undefined {
  if (!p.cargado) return 'La consola todavía se está cargando'
  if (p.ejecutando) return 'Ya hay una ejecución en curso'
  return undefined
}

/** La cabecera de la consola SQL: identidad y estado a la izquierda, iconos a la derecha. */
export function BarraConsola(p: BarraConsolaProps): React.JSX.Element {
  const ahora = useCronometro(p.ejecutando)
  const esquema = useBotonEsquema(p)

  const progreso = p.ejecutando ? textoProgreso(p.lote, ahora) : null
  const estado = progreso ?? p.textoEstado
  // Lo que se ANUNCIA no lleva el cronómetro: un lector de pantalla repetiría
  // «Ejecutando · 3 s», «· 4 s»… cada segundo. Se anuncia el cambio de sentencia.
  const anunciado = progreso ? progreso.split(' · ')[0] : (p.textoEstado ?? '')
  const produccion = p.conexion.entorno === 'produccion'

  return (
    <div className={`panel-header db-consola-barra${produccion ? ' db-consola-barra-produccion' : ''}`}>
      <IdentidadConsola p={p} estado={estado} anunciado={anunciado} textos={esquema.textos} />

      <AccionesBarraConsola p={p} motivo={motivoParaEjecutar(p)} esquema={esquema} />

      {esquema.ancla && (
        <SelectorEsquemaConsola
          conexion={p.conexion}
          elegido={p.esquemaElegido}
          efectivo={p.esquemaActual}
          ancla={esquema.ancla}
          altoFila={p.altoFila}
          nivel={esquema.nivel}
          onElegir={p.onElegirEsquema}
          onCerrar={esquema.cerrar}
        />
      )}
    </div>
  )
}
