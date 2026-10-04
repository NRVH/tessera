// =============================================================================
// Lo que flota sobre el lateral de BD: el menú contextual, el popover del «N de M» (por
// portal), el diálogo de la conexión, las confirmaciones de eliminar (que dicen todo lo que
// se pierde), los prompts de renombrar consola y filtrar claves, y la pregunta por una
// transacción pendiente. Está en el ciclo de importación: solo `function` al cargar.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { ContextMenu } from '../../comun/ContextMenu'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { PromptDialog } from '../../comun/PromptDialog'
import { useDialogo } from '../../comun/useDialogo'
import { DbConexionDialogo } from './DbConexionDialogo'
import { DbEsquemasPopover } from './DbEsquemasPopover'
import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc'
import type { DbConsolaInfo, DbResolverTx } from '../../../../shared/db-explorador-ipc'
import { claveConexion, nombresDeRefs, sesionesConCambios, textoEliminarAjena, textoEliminarConexion } from './filasArbolBd'
import { etiquetaBaseClaves } from './arbolClaves'
import { cambiosPendientesDeConexion } from './rejilla/registroEdicion'
import { eliminarConsola, eliminarPorId, renombrarConsola } from './DbArbolAcciones'
import { aplicarFiltroClaves } from './DbArbolNavegacion'
import type { CtxArbol, EstadoDialogo, PeticionTx, PopoverArbol } from './DbArbolTipos'

function PopoverEsquemasArbol({ a, popover, conexion }: { a: CtxArbol; popover: PopoverArbol; conexion: DbConnection }): React.JSX.Element {
  return (
    <DbEsquemasPopover
      conexion={conexion}
      ancla={popover.ancla}
      altoFila={a.p.altoFila}
      varsDensidad={a.p.varsDensidad}
      nivel={popover.nivel}
      base={popover.base}
      onCerrar={() => {
        a.e.ultimoCierrePopover.current = { conexionId: popover.conexionId, base: popover.base, en: performance.now() }
        a.e.setPopover(null)
        // Abierto desde el menú contextual, lo que tenía el foco antes ya no existe:
        // si queda huérfano, vuelve al árbol (nunca se le quita a otro sitio).
        requestAnimationFrame(() => {
          if (document.activeElement === null || document.activeElement === document.body) {
            a.e.listaRef.current?.focus()
          }
        })
      }}
    />
  )
}

function DialogoConexionArbol({ a, dialogo, perfilId }: { a: CtxArbol; dialogo: EstadoDialogo; perfilId: string }): React.JSX.Element {
  const conexionDialogo = dialogo.conexionId ? (a.d.porId.get(dialogo.conexionId) ?? null) : null
  return (
    <DbConexionDialogo
      // Otro archivo soltado con el alta abierta la rehace con él (otra ficha, otra clave).
      key={dialogo.conexionId ?? `nueva${dialogo.archivoInicial ? `:${dialogo.archivoInicial.elegido.token}` : ''}`}
      perfilId={perfilId}
      conexion={conexionDialogo}
      archivoInicial={dialogo.conexionId === null ? (dialogo.archivoInicial ?? null) : null}
      abrirClientes={dialogo.abrirClientes}
      requiereDriver={dialogo.requiereDriver ?? null}
      enfocarPassword={dialogo.enfocarPassword}
      onGuardada={(c, esNueva) => {
        if (esNueva) {
          a.p.onSeleccion(claveConexion(c.id))
          a.e.llevarA(claveConexion(c.id))
        }
      }}
      onCerrar={() => a.e.setDialogo(null)}
    />
  )
}

function ConfirmarConexion({ a, conexion }: { a: CtxArbol; conexion: DbConnection }): React.JSX.Element {
  const { proyectosMontada, consolas, sesiones } = a.p
  return (
    <ConfirmDialog
      title="Eliminar conexión"
      message={textoEliminarConexion({
        alias: conexion.alias,
        proyectos: proyectosMontada ? proyectosMontada(conexion.id) : null,
        consolas: consolas.filter((k) => k.conexionId === conexion.id).map((k) => k.nombre),
        conTx: nombresDeRefs(
          sesionesConCambios(sesiones, conexion.id).map((s) => s.ref),
          consolas
        ),
        sinEnviar: cambiosPendientesDeConexion(conexion.id)
      })}
      confirmLabel="Eliminar"
      danger
      onConfirm={() => {
        a.e.setConfirmacion(null)
        void eliminarPorId(a, conexion, false)
      }}
      onCancel={() => a.e.setConfirmacion(null)}
    />
  )
}

function ConfirmarAjena({ a, ajena }: { a: CtxArbol; ajena: DbConexionAjena }): React.JSX.Element {
  const { proyectosMontada, consolas, conexiones } = a.p
  return (
    <ConfirmDialog
      title="Eliminar conexión"
      message={textoEliminarAjena({
        alias: ajena.alias,
        motor: ajena.motor,
        proyectos: proyectosMontada ? proyectosMontada(ajena.id) : null,
        // El árbol no las pinta (cuelgan de una conexión que no sabe abrir), pero la
        // lista del perfil sí las trae, y el main las manda a la papelera con ella.
        consolas: consolas.filter((k) => k.conexionId === ajena.id).map((k) => k.nombre),
        // Si una CONOCIDA comparte su id (una edición a mano), los montajes y las
        // consolas de ese id son de ella y siguen.
        compartidaCon: conexiones.find((k) => k.id === ajena.id)?.alias ?? null,
        // La copia por id repetido dice con quién lo comparte, como su fila.
        idRepetido: ajena.idRepetido
      })}
      confirmLabel="Eliminar"
      danger
      onConfirm={() => {
        a.e.setConfirmacion(null)
        void eliminarPorId(a, ajena, true)
      }}
      onCancel={() => a.e.setConfirmacion(null)}
    />
  )
}

function ConfirmarConsola({ a, consola }: { a: CtxArbol; consola: DbConsolaInfo }): React.JSX.Element {
  return (
    <ConfirmDialog
      title="Eliminar consola"
      message={`«${consola.nombre}.sql» irá a la papelera; podrás recuperarla desde allí.`}
      confirmLabel="Eliminar"
      danger
      onConfirm={() => {
        a.e.setConfirmacion(null)
        void eliminarConsola(a, consola)
      }}
      onCancel={() => a.e.setConfirmacion(null)}
    />
  )
}

/** Las tres confirmaciones, cada una en su hueco (cambiar de una a otra monta otra). */
function ConfirmacionesArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const c = a.e.confirmacion
  return (
    <>
      {c?.tipo === 'conexion' && <ConfirmarConexion a={a} conexion={c.conexion} />}
      {c?.tipo === 'ajena' && <ConfirmarAjena a={a} ajena={c.ajena} />}
      {c?.tipo === 'consola' && <ConfirmarConsola a={a} consola={c.consola} />}
    </>
  )
}

function PromptsArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const { renombrando, setRenombrando, filtrandoClaves, setFiltrandoClaves } = a.e
  return (
    <>
      {renombrando && (
        <PromptDialog
          title="Renombrar consola"
          label="Nombre"
          initialValue={renombrando.consola.nombre}
          confirmLabel="Renombrar"
          error={renombrando.error}
          onConfirm={(nombre) => void renombrarConsola(a, renombrando.consola, nombre)}
          onCancel={() => setRenombrando(null)}
        />
      )}
      {filtrandoClaves && (
        <PromptDialog
          title={`Filtrar claves de ${etiquetaBaseClaves(filtrandoClaves.indice)}`}
          label="Patrón o texto"
          initialValue={filtrandoClaves.actual}
          confirmLabel="Filtrar"
          allowEmpty
          hint="Con * ? [ ] es un patrón (usuario:*). Sin comodines se busca el texto en cualquier parte del nombre. Vacío quita el filtro."
          onConfirm={(v) => {
            setFiltrandoClaves(null)
            aplicarFiltroClaves(a, filtrandoClaves, v)
            a.e.listaRef.current?.focus()
          }}
          onCancel={() => {
            setFiltrandoClaves(null)
            a.e.listaRef.current?.focus()
          }}
        />
      )}
    </>
  )
}

/** Todo lo que flota sobre el lateral (menú, popover y diálogos), como hermanos de un fragmento. */
export function DialogosArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const { menu, setMenu, popover, dialogo, peticionTx, setPeticionTx } = a.e
  const { perfilId } = a.p
  const conexionPopover = popover ? a.d.porId.get(popover.conexionId) : undefined
  return (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {popover && conexionPopover && <PopoverEsquemasArbol a={a} popover={popover} conexion={conexionPopover} />}
      {dialogo && perfilId && <DialogoConexionArbol a={a} dialogo={dialogo} perfilId={perfilId} />}
      <ConfirmacionesArbol a={a} />
      <PromptsArbol a={a} />
      {peticionTx && <DialogoTxArbol peticion={peticionTx} onCerrar={() => setPeticionTx(null)} />}
    </>
  )
}

/**
 * Confirmar / Revertir / Cancelar una transacción pendiente antes de desconectar o de
 * eliminar una consola. Propio del árbol: no hay pestaña a la que volver, solo la operación
 * que se reintenta. Sin Confirmar si todas están en tx `fallida`, y una línea dice por qué
 * (`opcionesTxArbol`). El foco arranca en CANCELAR: las otras dos escriben o descartan.
 */
function DialogoTxArbol({ peticion, onCerrar }: { peticion: PeticionTx; onCerrar: () => void }): React.JSX.Element {
  const dialogo = useDialogo({ onClose: onCerrar })
  const cancelarRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelarRef.current?.focus()
  }, [])
  const resolver = (r: DbResolverTx): void => {
    onCerrar()
    peticion.onResolver(r)
  }
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onCerrar}>
      <div
        ref={dialogo.ref}
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={peticion.titulo}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={dialogo.alPulsarTecla}
      >
        <div className="modal-title">{peticion.titulo}</div>
        <div className="modal-message">{peticion.mensaje}</div>
        {peticion.opciones.nota !== null && <div className="modal-message">{peticion.opciones.nota}</div>}
        <div className="modal-actions">
          <button ref={cancelarRef} type="button" className="btn btn-ghost" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className="btn" onClick={() => resolver('rollback')}>
            {peticion.opciones.revertir}
          </button>
          {peticion.opciones.confirmar !== null && (
            <button type="button" className="btn" onClick={() => resolver('commit')}>
              {peticion.opciones.confirmar}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
