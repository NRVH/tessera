// =============================================================================
// Lógica del modal de un agente manual: el borrador, pegar una definición copiada, guardar
// (en nativo, avisando si su programa no está en el PATH; en Docker, aplicando la capa del
// perfil con su progreso cuando cambian las órdenes de instalación) y el resultado.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import { useEffect, useState } from 'react'
import {
  definicionDesdeJson,
  idDesdeNombre,
  programaDelComando,
  validarDefinicion,
  type DefinicionAgente
} from '../../../../shared/agentesManuales'
import type { AplicarCapaResult } from '../../../../shared/agentes-manuales-ipc'
import type { OrigenContexto } from '../../../../shared/contextoAgenteManual'
import { idsManualesOcupados } from './agentesDelProyecto'
import { guardarAgenteManual, selectAgent, useStoreAgentes, type DestinoAgenteManual } from './store'

export interface BorradorAgente {
  nombre: string
  comando: string
  reanudar: string
  instalacion: string
  enTerminal: boolean
  /** De dónde sale el contexto; vacío, no se muestra. */
  contextoOrigen: '' | OrigenContexto
  contextoValor: string
  contextoUsado: string
  contextoMaximo: string
}

export interface OpcionesModalAgente {
  profileId: string
  /** Dónde corre: el de uno que se edita, o el de partida de uno nuevo (que se puede cambiar en el modal). */
  hostMode: boolean
  /** La definición a editar; sin ella, uno nuevo. */
  inicial: DefinicionAgente | null
  onCerrar: () => void
}

/** En qué punto está el guardado: editando, con el programa sin encontrar, instalando o con el resultado. */
export type FaseModal =
  | { tipo: 'editando' }
  | { tipo: 'sin-programa'; programa: string }
  | { tipo: 'instalando'; lineas: string[] }
  | { tipo: 'instalado'; lineas: string[]; resultado: AplicarCapaResult }

function borradorDe(d: DefinicionAgente | null): BorradorAgente {
  if (!d) return { ...BORRADOR_VACIO }
  const c = d.contexto
  return {
    nombre: d.nombre,
    comando: d.comando,
    reanudar: d.reanudar ?? '',
    instalacion: d.instalacion ?? '',
    enTerminal: d.enTerminal === true,
    ...(c ? { contextoOrigen: c.origen, contextoValor: c.valor, contextoUsado: c.usado, contextoMaximo: c.maximo } : SIN_CONTEXTO)
  }
}

const SIN_CONTEXTO = { contextoOrigen: '', contextoValor: '', contextoUsado: '', contextoMaximo: '' } as const
const BORRADOR_VACIO: BorradorAgente = { nombre: '', comando: '', reanudar: '', instalacion: '', enTerminal: false, ...SIN_CONTEXTO }

function destinoDe(o: OpcionesModalAgente, nativo: boolean): DestinoAgenteManual {
  return nativo ? { nativo: true } : { nativo: false, profileId: o.profileId }
}

/** Los ids manuales del equipo, sin el que se edita: el nuevo id no puede chocar con ninguno. */
function idsExistentes(o: OpcionesModalAgente): string[] {
  const s = useStoreAgentes.getState()
  return idsManualesOcupados({ nativos: s.agentesNativos, dockerPorPerfil: s.agentesDockerPorPerfil }, o.inicial?.id)
}

/** Las líneas del build de la capa de ESTE perfil, mientras se instala. */
function useLineasCapa(profileId: string, activo: boolean, alLlegar: (linea: string) => void): void {
  useEffect(() => {
    if (!activo) return
    return window.tessera.agentesManuales.onProgreso((p) => {
      if (p.profileId === profileId) alLlegar(p.linea)
    })
    // `alLlegar` es un setter estable de React: no hace falta en la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, activo])
}

export function useModalAgenteManual(o: OpcionesModalAgente) {
  const [b, setB] = useState<BorradorAgente>(() => borradorDe(o.inicial))
  const [error, setError] = useState<string | null>(null)
  const [fase, setFase] = useState<FaseModal>({ tipo: 'editando' })
  // Solo uno nuevo elige dónde corre: el de uno existente es donde viven su instalación y sus cuentas.
  const [nativo, setNativo] = useState(o.hostMode)
  const editar = (cambio: Partial<BorradorAgente>): void => {
    setB((x) => ({ ...x, ...cambio }))
    setError(null)
    if (fase.tipo === 'sin-programa') setFase({ tipo: 'editando' })
  }
  useLineasCapa(o.profileId, fase.tipo === 'instalando', (linea) =>
    setFase((f) => (f.tipo === 'instalando' ? { tipo: 'instalando', lineas: [...f.lineas, linea].slice(-400) } : f))
  )
  const pegar = async (): Promise<void> => {
    const r = definicionDesdeJson(await window.tessera.clipboard.read(), idsExistentes(o), !nativo)
    if (!r.ok) return setError(r.error)
    setB(borradorDe(r.valor))
    setError(null)
  }
  const guardar = async (): Promise<void> => {
    const def = definicionDelBorrador(b, o, nativo)
    if (!def.ok) return setError(def.error)
    if (nativo && fase.tipo !== 'sin-programa') {
      const programa = programaDelComando(def.valor.comando)
      if ((await window.tessera.agentesManuales.buscarNativo(programa)).ruta === null) return setFase({ tipo: 'sin-programa', programa })
    }
    guardarAgenteManual(destinoDe(o, nativo), def.valor)
    selectAgent(o.profileId, def.valor.id)
    if (nativo || (def.valor.instalacion ?? '') === (o.inicial?.instalacion ?? '')) return o.onCerrar()
    setFase({ tipo: 'instalando', lineas: [] })
    const definiciones = useStoreAgentes.getState().agentesDockerPorPerfil[o.profileId] ?? []
    const resultado = await window.tessera.agentesManuales.aplicarCapa({ profileId: o.profileId, definiciones })
    setFase((f) => ({ tipo: 'instalado', lineas: f.tipo === 'instalando' ? f.lineas : [], resultado }))
  }
  const elegirNativo = (v: boolean): void => {
    if (o.inicial !== null) return
    setNativo(v)
    if (fase.tipo === 'sin-programa') setFase({ tipo: 'editando' })
  }
  return { b, editar, error, fase, pegar, guardar, nativo, elegirNativo, eligeDonde: o.inicial === null }
}

/** La definición que sale del borrador: el id del que se edita, o uno nuevo a partir del nombre. */
function definicionDelBorrador(b: BorradorAgente, o: OpcionesModalAgente, nativo: boolean) {
  const id = o.inicial?.id ?? idDesdeNombre(b.nombre, idsExistentes(o))
  const contexto = b.contextoOrigen ? { origen: b.contextoOrigen, valor: b.contextoValor, usado: b.contextoUsado, maximo: b.contextoMaximo } : undefined
  return validarDefinicion(
    { id, nombre: b.nombre, comando: b.comando, reanudar: b.reanudar, instalacion: nativo ? undefined : b.instalacion, enTerminal: b.enTerminal, contexto },
    !nativo
  )
}

export type VistaModalAgente = ReturnType<typeof useModalAgenteManual>
