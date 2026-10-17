// =============================================================================
// Configuración › Agentes: la lista de agentes del perfil activo (de serie, nativos y Docker) con
// asa para ordenar (arrastrando, o con ↑/↓ con ella enfocada), ojo para mostrar u ocultar, editar y
// borrar los manuales, y «Añadir agente…». Sus modales van en `SobreAjustes`: el modal de
// Configuración los taparía.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import './selectorAgentes.css'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { DefinicionAgente, IdAgente } from '../../../../shared/agentesManuales'
import { useStorePestanas } from '../pestanas'
import { editorTargetKey } from '../editor'
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

/** Por encima del modal de Configuración: un portal a `<body>` con su propio apilamiento. */
function SobreAjustes({ children }: { children: React.ReactNode }): React.JSX.Element {
  return createPortal(<div className="sobre-ajustes">{children}</div>, document.body)
}

/** El perfil activo, su nombre y el modo de su proyecto activo (el de un agente nuevo). */
function usePerfilActivo(nuevoNativoPorDefecto: boolean): { profileId: string | null; nombre: string; nativo: boolean } {
  const tabs = useStorePestanas((s) => s.tabs)
  const windowsModeKeys = useStorePestanas((s) => s.windowsModeKeys)
  const profileId = tabs.activeProfileId
  if (!profileId) return { profileId: null, nombre: '', nativo: nuevoNativoPorDefecto }
  const nombre = tabs.profiles.find((p) => p.id === profileId)?.nombre ?? profileId
  const ruta = tabs.byProfile[profileId]?.activePath ?? null
  return { profileId, nombre, nativo: ruta ? windowsModeKeys.has(editorTargetKey(profileId, ruta)) : nuevoNativoPorDefecto }
}

type Modal = { inicial: DefinicionAgente | null; nativo: boolean } | null

interface Fila {
  a: AgenteDelPerfil
  ids: IdAgente[]
  visibles: IdAgente[]
}

/** Mueve un puesto con ↑/↓ desde el asa enfocada: el orden sin ratón. */
function moverConTeclado(profileId: string, ids: IdAgente[], id: IdAgente, e: React.KeyboardEvent): void {
  const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
  if (delta === 0) return
  e.preventDefault()
  const nuevo = moverUnPaso(ids, id, delta)
  if (nuevo) fijarOrdenAgentes(profileId, nuevo)
}

function BotonIcono(p: { etiqueta: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; pulsado?: boolean; disabled?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" className="btn btn-icon" title={p.etiqueta} aria-label={p.etiqueta} aria-pressed={p.pulsado} disabled={p.disabled} onClick={p.onClick}>
      {p.children}
    </button>
  )
}

export function GestionAgentes({ nuevoNativoPorDefecto }: { nuevoNativoPorDefecto: boolean }): React.JSX.Element {
  const t = txSelector()
  const fuente = useFuenteAgentes()
  const perfil = usePerfilActivo(nuevoNativoPorDefecto)
  const [modal, setModal] = useState<Modal>(null)
  const [borrando, setBorrando] = useState<{ d: DefinicionAgente; nativo: boolean } | null>(null)
  const profileId = perfil.profileId ?? ''
  const lista = agentesDelPerfil(fuente, profileId)
  const ids = lista.map((x) => x.pestana.id)
  const orden = useArrastreOrden((id, destino) => {
    const nuevo = soltarSobre(ids, id, destino)
    if (nuevo) fijarOrdenAgentes(profileId, nuevo)
  })
  if (!perfil.profileId) return <p className="ajustes-fila-ayuda">{t.sinPerfil}</p>
  const visibles = lista.filter((x) => !x.oculto).map((x) => x.pestana.id)
  return (
    <div className="gestion-agentes">
      <p className="ajustes-fila-ayuda">{t.perfil(perfil.nombre)}</p>
      <ul className="gestion-agentes-lista" aria-label={t.perfil(perfil.nombre)}>
        {lista.map((a) => (
          <FilaAgente
            key={a.pestana.id}
            f={{ a, ids, visibles }}
            profileId={profileId}
            orden={orden}
            onEditar={(d, nativo) => setModal({ inicial: d, nativo })}
            onBorrar={(d, nativo) => setBorrando({ d, nativo })}
          />
        ))}
      </ul>
      <div>
        <button type="button" className="btn" title={t.anadirEn(perfil.nativo)} onClick={() => setModal({ inicial: null, nativo: perfil.nativo })}>
          {t.anadir}
        </button>
      </div>
      {modal && (
        <SobreAjustes>
          <ModalAgenteManual profileId={profileId} hostMode={modal.nativo} inicial={modal.inicial} onCerrar={() => setModal(null)} />
        </SobreAjustes>
      )}
      {borrando && (
        <SobreAjustes>
          <ConfirmarBorradoAgente d={borrando.d} profileId={profileId} nativo={borrando.nativo} onCerrar={() => setBorrando(null)} />
        </SobreAjustes>
      )}
    </div>
  )
}

function FilaAgente(p: {
  f: Fila
  profileId: string
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
        onKeyDown={(e) => moverConTeclado(p.profileId, p.f.ids, id, e)}
      >
        <IconoAsa />
      </span>
      <span className="gestion-agente-nombre">{nombre}</span>
      <span className="gestion-agente-modo">{t.modo[a.modo]}</span>
      <BotonIcono
        etiqueta={a.oculto ? t.mostrar(nombre) : bloqueada ? t.ultimoVisible : t.ocultar(nombre)}
        pulsado={!a.oculto}
        disabled={bloqueada}
        onClick={() => (a.oculto ? ocultarAgente(p.profileId, id, false) : ocultarConAviso(p.profileId, a.pestana))}
      >
        <IconoOjo abierto={!a.oculto} />
      </BotonIcono>
      {manual && (
        <>
          <BotonIcono etiqueta={t.editar(nombre)} onClick={() => p.onEditar(manual, nativo)}>
            <IconoEditar />
          </BotonIcono>
          <BotonIcono etiqueta={t.eliminar(nombre)} onClick={() => p.onBorrar(manual, nativo)}>
            <IconoBorrar />
          </BotonIcono>
        </>
      )}
    </li>
  )
}
