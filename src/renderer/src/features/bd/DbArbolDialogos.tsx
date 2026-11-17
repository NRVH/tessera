// =============================================================================
// Lo que flota sobre el lateral de BD: el menú contextual, el popover del «N de M» (por
// portal), el diálogo de la conexión, las confirmaciones de eliminar (que dicen todo lo que
// se pierde), los prompts de renombrar consola y filtrar claves, los diálogos de claves (nueva y
// borrar por patrón) y la pregunta por una
// transacción pendiente. Está en el ciclo de importación: solo `function` al cargar.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { MenuContextual } from '../../comun/MenuContextual'
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { DialogoPrompt } from '../../comun/DialogoPrompt'
import { ModalAviso, Modal, ModalPie } from '../../comun/Modal'
import { DbConexionDialogo } from './DbConexionDialogo'
import { DbEsquemasPopover } from './DbEsquemasPopover'
import type { DbConexionAjena, ConexionBd } from '../../../../shared/db-ipc'
import type { DbConsolaInfo, DbResolverTx } from '../../../../shared/db-explorador-ipc'
import { claveConexion, nombresDeRefs, sesionesConCambios, textoEliminarAjena, textoEliminarConexion } from './filasArbolBd'
import { etiquetaBaseClaves } from './arbolClaves'
import { cambiosPendientesDeConexion } from './rejilla/registroEdicion'
import { eliminarConsola, eliminarPorId, refrescar, renombrarConsola } from './DbArbolAcciones'
import { bytesDeTexto, pintarBytes } from './claves/bytesClaves'
import { DialogoBorrarClaves } from './claves/DialogoBorrarClaves'
import { DialogoNuevaClave } from './claves/DialogoNuevaClave'
import { aplicarFiltroClaves } from './DbArbolNavegacion'
import type { CtxArbol, EstadoDialogo, PeticionTx, PopoverArbol } from './DbArbolTipos'
import { txArbolAcciones } from './textosArbolAcciones.ts'

function PopoverEsquemasArbol({ a, popover, conexion }: { a: CtxArbol; popover: PopoverArbol; conexion: ConexionBd }): React.JSX.Element {
  return (
    <DbEsquemasPopover
      conexion={conexion}
      ancla={popover.ancla}
      altoFila={a.p.altoFila}
      variablesDensidad={a.p.variablesDensidad}
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
      enfocarContrasena={dialogo.enfocarContrasena}
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

function ConfirmarConexion({ a, conexion }: { a: CtxArbol; conexion: ConexionBd }): React.JSX.Element {
  const { proyectosMontada, consolas, sesiones } = a.p
  return (
    <DialogoConfirmar
      titulo={txArbolAcciones().tituloEliminarConexion(conexion.alias)}
      mensaje={textoEliminarConexion({
        alias: conexion.alias,
        proyectos: proyectosMontada ? proyectosMontada(conexion.id) : null,
        consolas: consolas.filter((k) => k.conexionId === conexion.id).map((k) => k.nombre),
        conTx: nombresDeRefs(
          sesionesConCambios(sesiones, conexion.id).map((s) => s.ref),
          consolas
        ),
        sinEnviar: cambiosPendientesDeConexion(conexion.id)
      })}
      etiquetaConfirmar={txArbolAcciones().eliminar}
      peligro
      onConfirmar={() => {
        a.e.setConfirmacion(null)
        void eliminarPorId(a, conexion, false)
      }}
      onCancelar={() => a.e.setConfirmacion(null)}
    />
  )
}

function ConfirmarAjena({ a, ajena }: { a: CtxArbol; ajena: DbConexionAjena }): React.JSX.Element {
  const { proyectosMontada, consolas, conexiones } = a.p
  return (
    <DialogoConfirmar
      titulo={txArbolAcciones().tituloEliminarConexion(ajena.alias)}
      mensaje={textoEliminarAjena({
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
      etiquetaConfirmar={txArbolAcciones().eliminar}
      peligro
      onConfirmar={() => {
        a.e.setConfirmacion(null)
        void eliminarPorId(a, ajena, true)
      }}
      onCancelar={() => a.e.setConfirmacion(null)}
    />
  )
}

function ConfirmarConsola({ a, consola }: { a: CtxArbol; consola: DbConsolaInfo }): React.JSX.Element {
  return (
    <DialogoConfirmar
      titulo={txArbolAcciones().tituloEliminarConsola(consola.nombre)}
      mensaje={txArbolAcciones().consolaALaPapelera(consola.nombre)}
      etiquetaConfirmar={txArbolAcciones().eliminar}
      peligro
      onConfirmar={() => {
        a.e.setConfirmacion(null)
        void eliminarConsola(a, consola)
      }}
      onCancelar={() => a.e.setConfirmacion(null)}
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
  const t = txArbolAcciones()
  return (
    <>
      {renombrando && (
        <DialogoPrompt
          titulo={t.tituloRenombrar}
          etiqueta={t.etiquetaNombre}
          valorInicial={renombrando.consola.nombre}
          etiquetaConfirmar={t.renombrarBoton}
          error={renombrando.error}
          onConfirmar={(nombre) => void renombrarConsola(a, renombrando.consola, nombre)}
          onCancelar={() => setRenombrando(null)}
        />
      )}
      {filtrandoClaves && (
        <DialogoPrompt
          titulo={t.filtrarClavesDe(etiquetaBaseClaves(filtrandoClaves.indice))}
          etiqueta={t.patronOTexto}
          valorInicial={filtrandoClaves.actual}
          etiquetaConfirmar={t.filtrar}
          permitirVacio
          pista={t.pistaFiltro}
          onConfirmar={(v) => {
            setFiltrandoClaves(null)
            aplicarFiltroClaves(a, filtrandoClaves, v)
            a.e.listaRef.current?.focus()
          }}
          onCancelar={() => {
            setFiltrandoClaves(null)
            a.e.listaRef.current?.focus()
          }}
        />
      )}
    </>
  )
}

/** «Nueva clave» y «Borrar claves por patrón» de una base de Redis; al terminar refrescan el árbol. */
function DialogosClavesArbol({ a }: { a: CtxArbol }): React.JSX.Element | null {
  const { accionClaves, setAccionClaves } = a.e
  const c = accionClaves ? a.d.porId.get(accionClaves.conexionId) : undefined
  if (!accionClaves || !c) return null
  const salir = (): void => {
    setAccionClaves(null)
    a.e.listaRef.current?.focus()
  }
  if (accionClaves.tipo === 'borrar') {
    return (
      <DialogoBorrarClaves
        conexion={c}
        base={accionClaves.indice}
        patronInicial={accionClaves.patron}
        tipo={accionClaves.tipoClave}
        onCerrar={(huboBorrado) => {
          salir()
          if (huboBorrado) refrescar(a, c.id)
        }}
      />
    )
  }
  return (
    <DialogoNuevaClave
      conexion={c}
      base={accionClaves.indice}
      onCerrar={salir}
      alCrear={(nombre) => {
        refrescar(a, c.id)
        const clave = bytesDeTexto(nombre)
        a.p.onAbrir({ tipoPane: 'clave', conexionId: c.id, base: accionClaves.indice, clave: clave.base64, nombre: pintarBytes(clave) })
      }}
    />
  )
}

/** Todo lo que flota sobre el lateral (menú, popover y diálogos), como hermanos de un fragmento. */
export function DialogosArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const { menu, setMenu, popover, dialogo, peticionTx, setPeticionTx } = a.e
  const { perfilId } = a.p
  const conexionPopover = popover ? a.d.porId.get(popover.conexionId) : undefined
  return (
    <>
      {menu && <MenuContextual x={menu.x} y={menu.y} items={menu.items} onCerrar={() => setMenu(null)} />}
      {popover && conexionPopover && <PopoverEsquemasArbol a={a} popover={popover} conexion={conexionPopover} />}
      {dialogo && perfilId && <DialogoConexionArbol a={a} dialogo={dialogo} perfilId={perfilId} />}
      <ConfirmacionesArbol a={a} />
      <PromptsArbol a={a} />
      <DialogosClavesArbol a={a} />
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
  const cancelarRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelarRef.current?.focus()
  }, [])
  const resolver = (r: DbResolverTx): void => {
    onCerrar()
    peticion.onResolver(r)
  }
  return (
    <Modal titulo={peticion.titulo} severidad="advertencia" tamano="s" rol="alertdialog" onCerrar={onCerrar} cierraConVelo={false}
      pie={<ModalPie>
        <button ref={cancelarRef} type="button" className="btn btn-ghost" onClick={onCerrar}>
          {txArbolAcciones().cancelar}
        </button>
        <button type="button" className="btn danger" onClick={() => resolver('rollback')}>
          {peticion.opciones.revertir}
        </button>
        {peticion.opciones.confirmar !== null && (
          <button type="button" className="btn primary" onClick={() => resolver('commit')}>
            {peticion.opciones.confirmar}
          </button>
        )}
      </ModalPie>}
    >
      <div className="modal-message">{peticion.mensaje}</div>
      {peticion.opciones.nota !== null && <ModalAviso tono="aviso">{peticion.opciones.nota}</ModalAviso>}
    </Modal>
  )
}
