// =============================================================================
// Las entradas de edición del visor de clave: los botones de la barra («Editar valor» de un string,
// «Añadir …» de un hash, list, set, zset o stream y «Más acciones» con la caducidad, renombrar y borrar)
// y las entradas del menú de una fila de esos tipos. Solo abren el diálogo de la acción (`useEdicionClave`); lo que se puede
// editar lo decide `edicionClaves.ts`. Lo usa `DbClavePane`.
// Decisiones: docs/decisiones/bd/ui-claves-visor.md
// =============================================================================

import type { DbKvBytes, DbKvContenido } from '../../../../../shared/db-claves-ipc'
import type { ContextMenuEntry } from '../../../comun/ContextMenu'
import { IconoEliminar, IconoHistorial, IconoRenombrar } from '../../../comun/iconosMenu'
import { BotonBarraBd } from '../rejilla/DatosBotonBarra'
import { IconoAnadirElemento, IconoEditarValor, IconoMasAcciones } from '../iconosBd'
import { pintarBytes } from './bytesClaves'
import { nombreRenombrable, textoEditable } from './edicionClaves'
import type { TipoConElementos } from './edicionElementos'
import { nombreElementos } from './visorClaves'
import { txEdicionClaves } from './textosEdicionClaves'
import type { EdicionClave } from './useEdicionClave'

/** Las acciones sobre la clave entera, para el menú de «Más acciones». */
function itemsClave(edicion: EdicionClave, clave: DbKvBytes, ttlMs: number | null): ContextMenuEntry[] {
  const t = txEdicionClaves()
  const segundos = ttlMs === null ? null : Math.max(1, Math.ceil(ttlMs / 1000))
  const nombre = nombreRenombrable(clave)
  return [
    { label: t.caducidad, icon: <IconoHistorial />, onClick: () => edicion.abrir({ tipo: 'ttl', segundos }) },
    {
      label: t.renombrar,
      icon: <IconoRenombrar />,
      disabled: !nombre.ok,
      title: nombre.ok ? undefined : nombre.motivo,
      onClick: () => nombre.ok && edicion.abrir({ tipo: 'renombrar', actual: nombre.texto })
    },
    { label: t.borrarClave, icon: <IconoEliminar />, danger: true, onClick: () => edicion.abrir({ tipo: 'borrar' }) }
  ]
}

/** Los botones de edición de la barra; nada si la clave ya no existe. */
export function botonesEdicion(o: {
  contenido: DbKvContenido | null
  edicion: EdicionClave
  clave: DbKvBytes
  ttlMs: number | null
  abrirMenu: (x: number, y: number, items: ContextMenuEntry[]) => void
}): React.JSX.Element | null {
  const { contenido, edicion } = o
  if (!contenido || contenido.tipo === 'noExiste') return null
  const t = txEdicionClaves()
  const editable = contenido.tipo === 'string' ? textoEditable(contenido.valor, contenido.truncado) : null
  return (
    <>
      <span className="panel-actions-sep" aria-hidden="true" />
      {editable && (
        <BotonBarraBd
          etiqueta={t.editarValor}
          titulo={t.editarValorTitulo}
          motivo={editable.ok ? null : editable.motivo}
          onClick={() => editable.ok && edicion.abrir({ tipo: 'valor', actual: editable.texto })}
        >
          <IconoEditarValor />
        </BotonBarraBd>
      )}
      {contenido.tipo === 'hash' && (
        <BotonBarraBd etiqueta={t.anadirCampo} titulo={t.anadirCampoTitulo} onClick={() => edicion.abrir({ tipo: 'campo', campo: null, actual: '' })}>
          <IconoAnadirElemento />
        </BotonBarraBd>
      )}
      {esConElementos(contenido.tipo) && (
        <BotonBarraBd
          etiqueta={t.anadir(nombreElementos(contenido.tipo)[0])}
          titulo={t.anadirALaClave(nombreElementos(contenido.tipo)[0])}
          onClick={() => edicion.abrir({ tipo: 'anadir', de: contenido.tipo as TipoConElementos })}
        >
          <IconoAnadirElemento />
        </BotonBarraBd>
      )}
      <BotonBarraBd
        etiqueta={t.masAcciones}
        titulo={t.masAccionesTitulo}
        onClick={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect()
          o.abrirMenu(r.left, r.bottom + 2, itemsClave(edicion, o.clave, o.ttlMs))
        }}
      >
        <IconoMasAcciones />
      </BotonBarraBd>
    </>
  )
}

function esConElementos(tipo: DbKvContenido['tipo']): tipo is TipoConElementos {
  return tipo === 'list' || tipo === 'set' || tipo === 'zset' || tipo === 'stream'
}

/** Editar (si el valor es texto) y borrar la fila `i` de un hash. */
function itemsHash(contenido: Extract<DbKvContenido, { tipo: 'hash' }>, i: number, edicion: EdicionClave): ContextMenuEntry[] {
  const par = contenido.pares[i]
  if (!par) return []
  const editable = textoEditable(par.valor)
  const t = txEdicionClaves()
  return [
    itemEditar(t.editarElValor, editable, (texto) => edicion.abrir({ tipo: 'campo', campo: par.campo, actual: texto })),
    itemBorrar(t.borrarElCampo, () => edicion.abrir({ tipo: 'quitarCampo', campo: par.campo }))
  ]
}

function itemEditar(label: string, editable: ReturnType<typeof textoEditable>, abrir: (texto: string) => void): ContextMenuEntry {
  return {
    label,
    icon: <IconoEditarValor />,
    disabled: !editable.ok,
    title: editable.ok ? undefined : editable.motivo,
    onClick: () => editable.ok && abrir(editable.texto)
  }
}

function itemBorrar(label: string, abrir: () => void, motivo?: string): ContextMenuEntry {
  return { label, icon: <IconoEliminar />, danger: true, disabled: motivo !== undefined, title: motivo, onClick: abrir }
}

/**
 * Una lista se borra por valor (`LREM`), que quita la PRIMERA coincidencia: con una igual antes, el
 * borrado se llevaría otra fila, así que se explica y no se ofrece.
 */
function itemsLista(contenido: Extract<DbKvContenido, { tipo: 'list' }>, i: number, edicion: EdicionClave): ContextMenuEntry[] {
  const el = contenido.elementos[i]
  if (!el) return []
  const repetido = contenido.elementos.findIndex((x) => x.base64 === el.base64) < i
  const t = txEdicionClaves()
  return [
    itemEditar(t.editarElValor, textoEditable(el), (texto) => edicion.abrir({ tipo: 'elemento', indice: i, actual: texto })),
    itemBorrar(t.borrarElElemento, () => edicion.abrir({ tipo: 'quitar', de: 'list', elemento: el }), repetido ? t.elementoRepetido : undefined)
  ]
}

/** Las entradas de edición del menú de la fila `i`; ninguna en un string, un JSON ni un tipo desconocido. */
export function itemsFilaEdicion(contenido: DbKvContenido | null, i: number, edicion: EdicionClave): ContextMenuEntry[] {
  const t = txEdicionClaves()
  switch (contenido?.tipo) {
    case 'hash':
      return itemsHash(contenido, i, edicion)
    case 'list':
      return itemsLista(contenido, i, edicion)
    case 'set': {
      const m = contenido.miembros[i]
      return m ? [itemBorrar(t.borrarElMiembro, () => edicion.abrir({ tipo: 'quitar', de: 'set', elemento: m }))] : []
    }
    case 'zset': {
      const m = contenido.miembros[i]
      if (!m) return []
      return [
        { label: t.editarPuntuacion, icon: <IconoEditarValor />, onClick: () => edicion.abrir({ tipo: 'puntuacion', miembro: m.miembro, actual: m.puntuacion }) },
        itemBorrar(t.borrarElMiembro, () => edicion.abrir({ tipo: 'quitar', de: 'zset', elemento: m.miembro }))
      ]
    }
    case 'stream': {
      const e = contenido.entradas[i]
      return e ? [itemBorrar(t.borrarLaEntrada, () => edicion.abrir({ tipo: 'quitarEntrada', id: e.id }))] : []
    }
    default:
      return []
  }
}

/** El nombre del elemento que se edita o borra, como se enseña en el título del diálogo. */
export function nombreCampoDe(a: EdicionClave['accion']): string | undefined {
  if (!a) return undefined
  if ((a.tipo === 'campo' || a.tipo === 'quitarCampo') && a.campo) return pintarBytes(a.campo)
  if (a.tipo === 'quitar') return pintarBytes(a.elemento)
  if (a.tipo === 'puntuacion') return pintarBytes(a.miembro)
  return undefined
}
