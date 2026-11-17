// =============================================================================
// Configuración › Agentes: la lista de agentes del perfil activo (de serie, nativos y Docker) con
// asa para ordenar (arrastrando, o con ↑/↓ con ella enfocada), ojo para mostrar u ocultar, editar y
// borrar los manuales, y «Añadir agente…». Sus modales van en `SobreAjustes`: el modal de
// Configuración los taparía.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import './selectorAgentes.css'
import { useState } from 'react'
import { SobreAjustes } from './SobreAjustes'
export { SobreAjustes } from './SobreAjustes'
import { CuentasConfiguracion } from './CuentasConfiguracion'
import { tieneCuentasDocker } from './modeloCuentasConfiguracion'
import type { DefinicionAgente, IdAgente } from '../../../../shared/agentesManuales'
import { useStorePestanas } from '../pestanas'
import { agentesDelPerfil, sePuedeOcultar, type AgenteDelPerfil } from './agentesDelProyecto'
import { moverUnPaso, soltarSobre } from './ordenAgentes.ts'
import { fijarOrdenAgentes, ocultarAgente } from './store'
import { useFuenteAgentes } from './useAgentesDelProyecto'
import { useArrastreOrden } from './useArrastreOrden'
import { ocultarConAviso } from './menusSelectorAgentes'
import { ModalAgenteManual } from './ModalAgenteManual'
import { ConfirmarBorradoAgente } from './ConfirmarBorradoAgente'
import { IconoAsa, IconoBorrar, IconoEditar, IconoOjo } from './iconosGestionAgentes'
import { txSelector } from './textosSelectorAgentes.ts'

/** El perfil activo y su nombre. */
export function usePerfilActivo(): { perfilId: string | null; nombre: string } {
  const pestanas = useStorePestanas((s) => s.pestanas)
  const perfilId = pestanas.perfilActivoId
  if (!perfilId) return { perfilId: null, nombre: '' }
  return { perfilId, nombre: pestanas.perfiles.find((p) => p.id === perfilId)?.nombre ?? perfilId }
}

type Modal = { inicial: DefinicionAgente | null; nativo: boolean } | null

interface Fila {
  a: AgenteDelPerfil
  ids: IdAgente[]
  visibles: IdAgente[]
}

/** Mueve un puesto con ↑/↓ desde el asa enfocada: el orden sin ratón. */
function moverConTeclado(perfilId: string, ids: IdAgente[], id: IdAgente, e: React.KeyboardEvent): void {
  const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
  if (delta === 0) return
  e.preventDefault()
  const nuevo = moverUnPaso(ids, id, delta)
  if (nuevo) fijarOrdenAgentes(perfilId, nuevo)
}

function BotonIcono(p: { etiqueta: string; onClic: (e: React.MouseEvent<HTMLButtonElement>) => void; pulsado?: boolean; deshabilitado?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" className="btn btn-icon" title={p.etiqueta} aria-label={p.etiqueta} aria-pressed={p.pulsado} disabled={p.deshabilitado} onClick={p.onClic}>
      {p.children}
    </button>
  )
}

export function GestionAgentes(): React.JSX.Element {
  const t = txSelector()
  const fuente = useFuenteAgentes()
  const perfil = usePerfilActivo()
  const [modal, setModal] = useState<Modal>(null)
  const [borrando, setBorrando] = useState<{ d: DefinicionAgente; nativo: boolean } | null>(null)
  const perfilId = perfil.perfilId ?? ''
  const lista = agentesDelPerfil(fuente, perfilId)
  const ids = lista.map((x) => x.pestana.id)
  const orden = useArrastreOrden((id, destino) => {
    const nuevo = soltarSobre(ids, id, destino)
    if (nuevo) fijarOrdenAgentes(perfilId, nuevo)
  })
  if (!perfil.perfilId) return <p className="ajustes-fila-ayuda">{t.sinPerfil}</p>
  const visibles = lista.filter((x) => !x.oculto).map((x) => x.pestana.id)
  return (
    <div className="gestion-agentes">
      <p className="ajustes-fila-ayuda">{t.perfil(perfil.nombre)}</p>
      <ul className="gestion-agentes-lista" aria-label={t.perfil(perfil.nombre)}>
        {lista.map((a) => (
          <FilaAgente
            key={perfilId + ':' + a.pestana.id}
            f={{ a, ids, visibles }}
            perfilId={perfilId}
            orden={orden}
            onEditar={(d, nativo) => setModal({ inicial: d, nativo })}
            onBorrar={(d, nativo) => setBorrando({ d, nativo })}
          />
        ))}
      </ul>
      <div>
        <button type="button" className="btn" onClick={() => setModal({ inicial: null, nativo: true })}>
          {t.anadir}
        </button>
      </div>
      {modal && (
        <SobreAjustes>
          <ModalAgenteManual perfilId={perfilId} modoNativo={modal.nativo} inicial={modal.inicial} onCerrar={() => setModal(null)} />
        </SobreAjustes>
      )}
      {borrando && (
        <SobreAjustes>
          <ConfirmarBorradoAgente d={borrando.d} perfilId={perfilId} nativo={borrando.nativo} onCerrar={() => setBorrando(null)} />
        </SobreAjustes>
      )}
    </div>
  )
}

function FilaAgente(p: {
  f: Fila
  perfilId: string
  orden: ReturnType<typeof useArrastreOrden>
  onEditar: (d: DefinicionAgente, nativo: boolean) => void
  onBorrar: (d: DefinicionAgente, nativo: boolean) => void
}): React.JSX.Element {
  const t = txSelector()
  const { a, visibles } = p.f
  const { id, nombre, manual } = a.pestana
  const nativo = a.modo === 'nativo'
  const bloqueada = !a.oculto && !sePuedeOcultar(visibles, id)
  const clases = ['gestion-agente', a.oculto && 'oculto', p.orden.arrastrado === id && 'arrastrando', p.orden.sobre === id && 'destino']
  return (
    <li className={clases.filter(Boolean).join(' ')} data-agente={id} {...p.orden.arrastre(id)}>
      <span
        className="gestion-agente-asa"
        role="button"
        tabIndex={0}
        title={t.asa(nombre)}
        aria-label={t.asa(nombre)}
        onKeyDown={(e) => moverConTeclado(p.perfilId, p.f.ids, id, e)}
      >
        <IconoAsa />
      </span>
      <span className="gestion-agente-nombre">{nombre}</span>
      <span className="gestion-agente-modo">{t.modo[a.modo]}</span>
      <BotonIcono
        etiqueta={a.oculto ? t.mostrar(nombre) : bloqueada ? t.ultimoVisible : t.ocultar(nombre)}
        pulsado={!a.oculto}
        deshabilitado={bloqueada}
        onClic={() => (a.oculto ? ocultarAgente(p.perfilId, id, false) : ocultarConAviso(p.perfilId, a.pestana))}
      >
        <IconoOjo abierto={!a.oculto} />
      </BotonIcono>
      {manual && (
        <>
          <BotonIcono etiqueta={t.editar(nombre)} onClic={() => p.onEditar(manual, nativo)}>
            <IconoEditar />
          </BotonIcono>
          <BotonIcono etiqueta={t.eliminar(nombre)} onClic={() => p.onBorrar(manual, nativo)}>
            <IconoBorrar />
          </BotonIcono>
        </>
      )}
      {tieneCuentasDocker(a.modo) && <CuentasConfiguracion perfilId={p.perfilId} agente={id} nombre={nombre} manual={manual ?? undefined} />}
    </li>
  )
}
