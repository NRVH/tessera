// =============================================================================
// El contenido de cada fila del lateral de BD, elegido por una TABLA por tipo de fila
// (`CONTENIDO_POR_TIPO`). Aquí van las filas con acciones propias: la conexión (con la
// franja de su ENTORNO, `MarcaEntorno`, su punto de sesión y su «N de M»), la ajena, la
// base del nivel «Bases», la fila de error y «Cargar más claves»; el resto, en `FilaArbolTexto`.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import type { ReactNode } from 'react'
import { ChevronArbol } from '../../comun/iconosArbol'
import { IconoBd, IconoMotor } from './iconosBd'
import { MarcaEntorno } from './MarcaEntorno'
import { TITULO_SOLO_LECTURA_AGENTES } from './camposConexion'
import type { InsigniaEsquemas } from './arbolBd'
import { avisoSecreto, esContenedorArbol, estadoSesionConexion, motorAjeno, textoAjena, type FilaArbol } from './filasArbolBd'
import { abrirPopover, accionDeFilaError, anclaDe, cargarMasClaves, ejecutarAccionError, idInsignia, idInsigniaBase } from './DbArbolNavegacion'
import {
  contenidoCarpeta,
  contenidoCarpetaConsolas,
  contenidoCarpetaDetalle,
  contenidoColeccion,
  contenidoColumna,
  contenidoConsola,
  contenidoDocBase,
  contenidoEsquema,
  contenidoIndice,
  contenidoKvBase,
  contenidoKvCarpeta,
  contenidoKvClave,
  contenidoObjeto,
  contenidoRestriccion,
  marcar
} from './FilaArbolTexto'
import type { CtxArbol } from './DbArbolTipos'

type FilaDe<K extends FilaArbol['kind']> = Extract<FilaArbol, { kind: K }>
type Contenido<K extends FilaArbol['kind']> = (fila: FilaDe<K>, chevron: ReactNode, a: CtxArbol) => ReactNode

function chevronDe(a: CtxArbol, fila: FilaArbol): ReactNode {
  if (!esContenedorArbol(fila)) return null
  return (
    <span
      className="db-chevron"
      aria-hidden="true"
      onClick={(e) => {
        e.stopPropagation()
        a.p.onSeleccion(fila.key)
        a.p.onAlternarExpandido(fila.key, !('expandida' in fila && fila.expandida))
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <ChevronArbol abierto={'expandida' in fila && fila.expandida} />
    </span>
  )
}

/** El «N de M» de la conexión: un botón que abre el popover y deja el foco en la LISTA. */
function insigniaConexion(fila: FilaDe<'conexion'>, ins: InsigniaEsquemas, a: CtxArbol): ReactNode {
  const c = fila.conexion
  return (
    <button
      type="button"
      id={idInsignia(a, c.id)}
      className="db-insignia-esquemas"
      tabIndex={-1}
      // Con nivel «Bases», la insignia cuenta BASES.
      title={`${fila.nivelBases ? 'Bases' : 'Esquemas'} visibles: ${ins.n} de ${ins.m}. Pulsa para elegirl${fila.nivelBases ? 'as' : 'os'}.`}
      aria-label={`${fila.nivelBases ? 'Bases' : 'Esquemas'} visibles: ${ins.n} de ${ins.m}`}
      // El foco se queda en la LISTA (la enfoca su propio mousedown): si se lo
      // quedara el botón, al cerrar el popover volvería a él y no al árbol.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        a.p.onSeleccion(fila.key)
        abrirPopover(a, c.id, anclaDe(e.currentTarget, 0, 0), fila.nivelBases ? 'bases' : undefined)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {ins.n} de {ins.m}
    </button>
  )
}

function contenidoConexion(fila: FilaDe<'conexion'>, chevron: ReactNode, a: CtxArbol): ReactNode {
  const c = fila.conexion
  const estado = estadoSesionConexion(a.p.sesiones, c.id)
  const avisoPass = avisoSecreto(c, a.almacen)
  const ins = fila.insignia
  return (
    <>
      {/* La franja del ENTORNO, pegada al borde izquierdo de la fila (su sitio lo pone
          arbol.css); sin entorno no pinta nada. */}
      <MarcaEntorno entorno={c.entorno} compacta />
      {chevron}
      <span className="db-motor-icono">
        <IconoMotor motor={c.motor} />
        {estado && (
          <span
            className={`db-sesion-punto ${estado}`}
            title={estado === 'conectada' ? 'Conectada' : estado === 'conectando' ? 'Conectando…' : 'Sesión perdida'}
          />
        )}
      </span>
      <span className="tree-label db-fila-nombre db-conexion-alias">{marcar(c.alias, fila.coincidencia)}</span>
      {estado && (
        <span className="solo-lectores">
          {estado === 'conectada' ? ', conectada' : estado === 'conectando' ? ', conectando' : ', sesión perdida'}
        </span>
      )}
      {c.readonly && (
        <span className="db-chip-ro" title={TITULO_SOLO_LECTURA_AGENTES}>
          RO
        </span>
      )}
      {avisoPass && (
        <span className="db-fila-aviso" title={avisoPass} aria-label={avisoPass}>
          ⚠
        </span>
      )}
      {ins && ins.m > 0 && insigniaConexion(fila, ins, a)}
    </>
  )
}

/**
 * Sin chevron (no se despliega) ni punto de sesión (no se conecta). El icono es el cilindro
 * GENÉRICO a propósito: si esta versión no sabe abrirla, no debe parecer que la conoce.
 */
function contenidoAjena(fila: FilaDe<'ajena'>): ReactNode {
  const a = fila.ajena
  return (
    <>
      <span className="db-motor-icono">
        <IconoBd className="db-motor db-motor-desconocido" />
      </span>
      <span className="tree-label db-fila-nombre db-conexion-alias">{marcar(a.alias, fila.coincidencia)}</span>
      <span className="db-fila-meta db-ajena-motor">{motorAjeno(a)}</span>
      <span className="db-ajena-aviso">{textoAjena(a)}</span>
    </>
  )
}

/** Una base del nivel «Bases»: el cilindro, su nombre y el «N de M» de sus esquemas. */
function contenidoBase(fila: FilaDe<'base'>, chevron: ReactNode, a: CtxArbol): ReactNode {
  const insB = fila.insignia
  return (
    <>
      {chevron}
      <span className="db-fila-icono db-icono-base">
        <IconoBd />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(fila.base, fila.coincidencia)}</span>
      {fila.porDefecto && <span className="db-fila-meta">por defecto</span>}
      {!fila.accesible && <span className="db-fila-meta">sin acceso</span>}
      {insB && insB.m > 0 && (
        <button
          type="button"
          id={idInsigniaBase(a, fila.conexionId, fila.base)}
          className="db-insignia-esquemas"
          tabIndex={-1}
          title={`Esquemas visibles: ${insB.n} de ${insB.m}. Pulsa para elegirlos.`}
          aria-label={`Esquemas visibles de ${fila.base}: ${insB.n} de ${insB.m}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            a.p.onSeleccion(fila.key)
            abrirPopover(a, fila.conexionId, anclaDe(e.currentTarget, 0, 0), 'esquemas', fila.base)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {insB.n} de {insB.m}
        </button>
      )}
    </>
  )
}

function contenidoPlaceholder(fila: FilaDe<'placeholder'>, _chevron: ReactNode, a: CtxArbol): ReactNode {
  if (fila.variante !== 'error') return <span className="tree-label">{fila.mensaje ?? ''}</span>
  const acc = accionDeFilaError(a, fila)
  return (
    <>
      <span className="tree-label db-fila-error-texto">{fila.mensaje ?? 'Error'}</span>
      {acc && (
        <button
          type="button"
          className="db-fila-accion"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            ejecutarAccionError(a, fila)
          }}
        >
          {acc.etiqueta}
        </button>
      )}
    </>
  )
}

/** «Cargar más claves» como un enlace de acción (Enter también), con su nota. */
function contenidoKvMas(fila: FilaDe<'kv-mas'>, _chevron: ReactNode, a: CtxArbol): ReactNode {
  return fila.cargando ? (
    <span className="tree-label db-kv-mas-cargando">{fila.vista.accion}</span>
  ) : (
    <>
      <button
        type="button"
        className="db-fila-accion"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          a.p.onSeleccion(fila.key)
          cargarMasClaves(a, fila.conexionId, fila.indice)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {fila.vista.accion}
      </button>
      {fila.vista.nota !== null && <span className={`db-kv-mas-nota${fila.vista.error ? ' error' : ''}`}>{fila.vista.nota}</span>}
    </>
  )
}

const CONTENIDO_POR_TIPO: { [K in FilaArbol['kind']]: Contenido<K> } = {
  conexion: contenidoConexion,
  ajena: contenidoAjena,
  'carpeta-consolas': contenidoCarpetaConsolas,
  consola: contenidoConsola,
  base: contenidoBase,
  esquema: contenidoEsquema,
  carpeta: contenidoCarpeta,
  objeto: contenidoObjeto,
  'carpeta-detalle': contenidoCarpetaDetalle,
  columna: contenidoColumna,
  indice: contenidoIndice,
  restriccion: contenidoRestriccion,
  placeholder: contenidoPlaceholder,
  'doc-base': contenidoDocBase,
  coleccion: contenidoColeccion,
  'kv-base': contenidoKvBase,
  'kv-carpeta': contenidoKvCarpeta,
  'kv-clave': contenidoKvClave,
  'kv-mas': contenidoKvMas
}

/** Lo que va dentro de la fila: chevron (si se despliega), icono, nombre y lo suyo. */
export function contenidoFila(a: CtxArbol, fila: FilaArbol): ReactNode {
  const chevron = chevronDe(a, fila)
  const contenido = CONTENIDO_POR_TIPO[fila.kind] as Contenido<FilaArbol['kind']>
  return contenido(fila, chevron, a)
}
