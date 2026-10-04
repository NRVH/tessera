// =============================================================================
// Hooks de la columna del agente (CCPanel): la medida de la columna, la
// distribución del mosaico calculada en el render, las versiones de las sesiones
// nativas y los datos por perfil que reciben los panes. CCPanel los llama en un
// orden fijo, el mismo en que declaraba sus efectos.
// Decisiones: docs/decisiones/agentes/columna-del-agente.md
// =============================================================================

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { agentTargetKey, hexARgb, tintaPerfil, tintaResaltado } from '../pestanas'
import { AgentAppearanceContext, resolveFontFamily, resolveFontSize } from '../../theme/terminalAppearance'
import { calcularMosaico, type DisposicionMosaico, type OpcionMosaico } from '../mosaico'
import type { Profile } from '../../../../main/profiles/types'
import type { EstadoAgentesNativos } from '../../../../shared/agentes-nativos-ipc'
import type { MosaicoPanel } from './CCPanel'

/**
 * Píxeles que cada casilla gasta FUERA de la terminal, para decidir en caracteres. Calca
 * la cuenta de `FitAddon`, que mide el `.terminal-host` CON su relleno (border-box), así
 * que el relleno no se descuenta. Alto 69 = cabecera (35) + pie (34). Ancho 33 = canalón
 * del scrollbar (18) + los 15 px que xterm reserva cuando no puede medir la barra
 * (barras superpuestas), cota alta también de la barra fina. Si la cabecera o el pie
 * cambian de alto, se cambia aquí.
 */
const CROMO_CASILLA = { ancho: 33, alto: 69 }
/** El `gap` de la rejilla (styles.css, `.right-panel.cc-mosaico`): el filete entre casillas. */
const HUECO_CASILLAS = 1

/** Versiones de la sesión nativa de un target: con cuál arrancó y cuál hay instalada. */
export type VersionesAgente = { lanzada: string | null; instalada: string | null }

/**
 * Celda de carácter estimada desde la fuente: ancho medido (`measureText` de una 'W',
 * como xterm) y alto como lo calcula xterm, letra al ~117 % por el `lineHeight: 1.2`.
 */
function medirCeldaTerminal(fontFamily: string, fontSize: number): { ancho: number; alto: number } {
  let ancho = fontSize * 0.6
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = `${fontSize}px ${fontFamily}`
      const w = ctx.measureText('W').width
      if (w > 0) ancho = w
    }
  } catch {
    /* sin canvas: la proporción típica de una monoespaciada */
  }
  const alto = Math.floor(Math.ceil(fontSize * 1.17) * 1.2)
  return { ancho, alto }
}

/**
 * Versiones por clave de target (el main las cuenta por perfil, proyecto y agente). Se
 * memoiza sobre la foto para que cada pane reciba el MISMO objeto mientras no cambie.
 */
export function useVersionesPorTarget(
  estadoAgentesNativos: EstadoAgentesNativos | null
): Map<string, VersionesAgente> {
  return useMemo(() => {
    const m = new Map<string, VersionesAgente>()
    if (!estadoAgentesNativos) return m
    for (const s of estadoAgentesNativos.sesiones) {
      const cli = s.agente === 'codex' ? estadoAgentesNativos.codex : estadoAgentesNativos.claude
      m.set(agentTargetKey(s.profileId, s.projectHostPath, s.agente), {
        lanzada: s.versionLanzada,
        instalada: cli.instalada
      })
    }
    return m
  }, [estadoAgentesNativos])
}

/**
 * Medida de la columna con un ResizeObserver y no una container query: `container-type`
 * implica `contain` y rompería los menús `position: fixed` de cada pane.
 */
export function useMedidaColumna(enMosaico: boolean): {
  seccionRef: RefObject<HTMLElement>
  medida: { ancho: number; alto: number }
} {
  const seccionRef = useRef<HTMLElement>(null)
  const [medida, setMedida] = useState({ ancho: 0, alto: 0 })
  useLayoutEffect(() => {
    if (!enMosaico) return
    const el = seccionRef.current
    if (!el) return
    const medir = (): void => {
      const ancho = el.clientWidth
      const alto = el.clientHeight
      setMedida((m) => (m.ancho === ancho && m.alto === alto ? m : { ancho, alto }))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => {
      ro.disconnect()
      // Cada entrada parte SIN medida: una de otra ventana colocaría casillas que al
      // medir de verdad se esconden (creando y tirando sus WebGL de paso).
      setMedida({ ancho: 0, alto: 0 })
    }
  }, [enMosaico])
  return { seccionRef, medida }
}

/**
 * Distribución del mosaico, calculada EN EL RENDER (no en un efecto) para que la primera
 * pasada ya traiga forma. `calcularMosaico` devuelve el mismo `anterior` si nada cambió,
 * así que la identidad es estable. Reporta la distribución a la barra del mosaico.
 */
export function useDisposicionMosaico(
  mosaico: MosaicoPanel | null,
  medida: { ancho: number; alto: number }
): DisposicionMosaico | null {
  const apariencia = useContext(AgentAppearanceContext)
  const celda = useMemo(
    () => medirCeldaTerminal(resolveFontFamily(apariencia), resolveFontSize(apariencia)),
    [apariencia]
  )
  const anteriorRef = useRef<DisposicionMosaico | null>(null)
  // La última de REJILLA: al restaurar una ampliada, la histéresis compara con ella.
  const ultimaRejillaRef = useRef<DisposicionMosaico | null>(null)
  const teselas = mosaico?.teselas
  const preset = mosaico?.preset
  const ampliadaKey = mosaico?.ampliada ?? null
  const enfocadaKey = mosaico?.enfocada ?? null
  const disposicion = useMemo((): DisposicionMosaico | null => {
    if (!teselas || !preset) return null
    const indice = (k: string | null): number | null => {
      if (k === null) return null
      const i = teselas.indexOf(k)
      return i >= 0 ? i : null
    }
    const anterior = anteriorRef.current
    return calcularMosaico({
      n: teselas.length,
      preset,
      ancho: medida.ancho,
      alto: medida.alto,
      hueco: HUECO_CASILLAS,
      celda,
      cromo: CROMO_CASILLA,
      ampliada: indice(ampliadaKey),
      enfocada: indice(enfocadaKey),
      anterior: anterior?.origen === 'ampliada' ? ultimaRejillaRef.current : anterior
    })
  }, [teselas, preset, medida, celda, ampliadaKey, enfocadaKey])
  // Los refs se actualizan al CONFIRMAR, no durante el render (que React puede tirar).
  useLayoutEffect(() => {
    anteriorRef.current = disposicion
    if (disposicion === null) ultimaRejillaRef.current = null
    else if (disposicion.origen !== 'ampliada') ultimaRejillaRef.current = disposicion
  }, [disposicion])

  // Por ref, porque el objeto `mosaico` se recrea en cada render.
  const onDisposicionRef = useRef(mosaico?.onDisposicion)
  onDisposicionRef.current = mosaico?.onDisposicion
  useEffect(() => {
    onDisposicionRef.current?.(disposicion)
  }, [disposicion])

  return disposicion
}

/** Color de un perfil en tinta y su versión de letra. */
export type ColorPerfil = { tinta: string; claro: string }

/**
 * Colores por perfil. Se descarta lo que no sea hex: un color inválido en una variable
 * CSS no cae a su reserva, invalida la declaración entera.
 */
export function useColoresPerfil(profiles: Profile[]): Record<string, ColorPerfil | undefined> {
  return useMemo(() => {
    const m: Record<string, ColorPerfil | undefined> = {}
    for (const p of profiles) {
      if (!p.color || hexARgb(p.color) === null) continue
      const claro = tintaResaltado(p.color)
      m[p.id] = { tinta: tintaPerfil(p.color), claro }
    }
    return m
  }, [profiles])
}

/**
 * Destinos de cada casilla agrupados por perfil UNA vez, no dentro del bucle de targets,
 * que recorre todos los abiertos y se repinta con cada latido de actividad.
 */
export function useOpcionesPorPerfil(opciones: OpcionMosaico[] | undefined): Map<string, OpcionMosaico[]> {
  return useMemo(() => {
    const m = new Map<string, OpcionMosaico[]>()
    for (const o of opciones ?? []) {
      const lista = m.get(o.profileId)
      if (lista) lista.push(o)
      else m.set(o.profileId, [o])
    }
    return m
  }, [opciones])
}
