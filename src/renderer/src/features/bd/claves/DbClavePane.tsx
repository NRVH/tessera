// =============================================================================
// DbClavePane: la pestaña de clave de Redis, el visor de una clave, que también edita (el valor
// de un string, los elementos de un hash, list, set, zset o stream, la caducidad, renombrar, borrar) y la
// exporta a JSON. Cabecera con tipo, nombre, TTL con cuenta atrás, memoria y codificación;
// el cuerpo depende del tipo. Cumple el contrato de `DbArea`: no pide nada hasta su primer
// `visible`, publica sus indicadores y al desmontarse cancela lo que tenga en vuelo.
// Decisiones: docs/decisiones/bd/ui-claves-pestana.md
// =============================================================================

import { useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbKvBytes, DbKvContenido, DbKvValor } from '../../../../../shared/db-claves-ipc'
import type { IndicadorPestana } from '../dbTabsModel'
import { basePorDefectoClaves } from '../arbolClaves'
import type { AbrirConsolaEn } from '../consola/basesConsola'
import { bytesDeBase64, bytesDeTexto, pintarBytes } from './bytesClaves'
import type { AccionClave } from './edicionClaves'
import { bytesLegibles, comandoConsola, etiquetaTipo, resumenElementos, ttlLegible } from './visorClaves'
import { useLecturaClave, useTtlClave, useVigilanciaClave, type LecturaClave } from './useLecturaClave'
import { useVisorClave, type VisorClave } from './useVisorClave'
import { cuerpoClave } from './cuerpoClave'
import { useEdicionClave } from './useEdicionClave'
import { botonesEdicion, itemsFilaEdicion, nombreCampoDe } from './accionesEdicionClave'
import { DialogoEdicionClave } from './DialogoEdicionClave'
import { copiarTexto } from '../documentos/utilPanes'
import { ContextMenu } from '../../../comun/ContextMenu'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { BotonBarraBd } from '../rejilla/DatosBotonBarra'
import { MarcaEntorno } from '../MarcaEntorno'
import { IconoConsola, IconoDetener, IconoExportar, IconoRefrescar, IconoVerValor } from '../iconosBd'
import { useExportarClave, type ExportarClave } from './useExportarClave'
import '../rejilla.css'
import '../documentos/documentos.css'
import './claves.css'

export interface PropsClave {
  paneKey: string
  conexion: DbConnection
  /** La base numerada de la clave. */
  base: number
  /** La clave en base64 (su identidad: los bytes exactos). */
  clave: string
  /** El nombre pintado (`pintarBytes`), para enseñarlo. */
  nombre: string
  visible: boolean
  altoFila: number
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
  /** Abre una consola de esta conexión con un texto inicial, en la base de la clave. */
  onAbrirConsola?: AbrirConsolaEn
  /** La clave se renombró: la pestaña pasa a enseñar la nueva (sus bytes en base64 y su nombre pintado). */
  onRenombrada?: (clave: string, nombre: string) => void
}

/** Lo que dice la cabecera del valor leído: tamaño, elementos, memoria, codificación y ms. */
function metasClave(valor: DbKvValor | null, contenido: DbKvContenido | null): string[] {
  const metas: string[] = []
  if (!valor || !contenido || contenido.tipo === 'noExiste') return metas
  const resumen = resumenElementos(contenido)
  if (contenido.tipo === 'string') metas.push(bytesLegibles(contenido.bytes))
  if (resumen) metas.push(resumen)
  if (valor.memoria !== undefined) metas.push(`${bytesLegibles(valor.memoria)} en memoria`)
  if (valor.codificacion) metas.push(valor.codificacion)
  metas.push(`${valor.ms} ms`)
  return metas
}

function textoTtl(ttl: number | null): string {
  return ttl === null ? 'Sin caducidad' : ttl === 0 ? 'Caducada' : `Caduca en ${ttlLegible(ttl)}`
}

/** El TTL y las metas de la barra, o «Leyendo…» mientras no hay valor. */
function metaBarra(l: LecturaClave, contenido: DbKvContenido | null, ttl: number | null): React.ReactNode {
  const { valor, cargando, detenida } = l
  if (cargando && !valor) return 'Leyendo…'
  const claseTtl = ttl === null ? '' : ttl === 0 ? ' caducada' : ' caduca'
  const metas = metasClave(valor, contenido)
  return (
    <>
      {valor && contenido?.tipo !== 'noExiste' && (
        <span className={`db-clave-ttl${claseTtl}`} title={ttl === null ? 'La clave no caduca' : 'Tiempo que le queda (TTL)'}>
          {textoTtl(ttl)}
        </span>
      )}
      {metas.length > 0 && ` · ${metas.join(' · ')}`}
      {!cargando && detenida && valor && <span className="db-barra-aviso"> · detenida</span>}
    </>
  )
}

function identidadClave(p: PropsClave, l: LecturaClave, contenido: DbKvContenido | null, ttl: number | null): React.JSX.Element {
  const tipoChip = contenido && contenido.tipo !== 'noExiste' ? contenido.tipo : null
  return (
    <div className="db-clave-ident">
      {tipoChip && (
        <span className={`db-kv-tipo tipo-${tipoChip}`}>
          {etiquetaTipo(tipoChip, contenido?.tipo === 'otro' ? contenido.tipoServidor : undefined)}
        </span>
      )}
      <span className="db-clave-nombre" title={`${p.nombre} · db${p.base}`}>
        {p.nombre}
      </span>
      <span className="db-barra-meta">{metaBarra(l, contenido, ttl)}</span>
    </div>
  )
}

function BotonExportar({ exportacion, sinClave }: { exportacion: ExportarClave; sinClave: boolean }): React.JSX.Element {
  return (
    <BotonBarraBd
      etiqueta="Exportar a JSON"
      titulo="Guardar la clave entera (tipo, caducidad y valor) en un archivo JSON"
      motivo={exportacion.exportando ? 'Exportando…' : sinClave ? 'No hay ninguna clave que exportar' : null}
      onClick={() => void exportacion.exportar()}
    >
      <IconoExportar />
    </BotonBarraBd>
  )
}

function accionesClave(
  p: PropsClave,
  l: LecturaClave,
  visor: VisorClave,
  abrirConsola: () => void,
  edicion: React.ReactNode,
  exportacion: ExportarClave
): React.JSX.Element {
  const { contenido, tabla, panelDetalle, setPanelDetalle } = visor
  const sinClave = contenido === null || contenido.tipo === 'noExiste'
  const enCurso = l.cargando || l.cargandoMas
  // Un JSON que no se leyó (`omitidoBytes`) no tiene nada que copiar.
  const copiableValor =
    contenido?.tipo === 'string' ? pintarBytes(contenido.valor) : contenido?.tipo === 'json' && contenido.omitidoBytes === undefined ? contenido.texto : null
  return (
    <div className="panel-actions">
      <BotonBarraBd etiqueta="Refrescar" titulo="Volver a leer la clave" motivo={l.cargando ? 'Leyendo…' : null} onClick={() => void l.leer()}>
        <IconoRefrescar />
      </BotonBarraBd>
      <BotonBarraBd etiqueta="Detener" titulo="Detener la lectura en curso" motivo={enCurso ? null : 'No hay ninguna lectura en curso'} onClick={l.detener}>
        <IconoDetener />
      </BotonBarraBd>
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBarraBd etiqueta="Copiar nombre" titulo="Copiar el nombre de la clave" onClick={() => copiarTexto(p.nombre, 'Nombre')}>
        <IconoCopiar />
      </BotonBarraBd>
      {copiableValor !== null && (
        <BotonBarraBd etiqueta="Copiar valor" titulo="Copiar el valor (lo que se ve, como texto)" onClick={() => copiarTexto(copiableValor, 'Valor')}>
          <IconoCopiar />
        </BotonBarraBd>
      )}
      <BotonExportar exportacion={exportacion} sinClave={sinClave} />
      {tabla && (
        <BotonBarraBd
          etiqueta={panelDetalle ? 'Ocultar el elemento' : 'Ver el elemento'}
          titulo={panelDetalle ? 'Ocultar el panel del elemento elegido' : 'Ver entero el elemento elegido'}
          onClick={() => setPanelDetalle((v) => !v)}
        >
          <IconoVerValor />
        </BotonBarraBd>
      )}
      {edicion}
      {p.onAbrirConsola && (
        <BotonBarraBd etiqueta="Abrir consola" titulo="Abrir una consola con el comando que lee esta clave" onClick={abrirConsola}>
          <IconoConsola />
        </BotonBarraBd>
      )}
    </div>
  )
}

/**
 * Tras una edición que entró: renombrar o borrar (la clave, o el último elemento que la sostenía) cambia las
 * claves que lista el árbol, que se vuelve a pedir; renombrar pasa la pestaña a la clave nueva, y lo
 * demás vuelve a leer la clave.
 */
function trasEditarClave(p: PropsClave, l: LecturaClave, a: AccionClave, nuevoNombre?: string): void {
  if (a.tipo === 'renombrar' || a.tipo === 'borrar' || a.tipo.startsWith('quitar')) {
    void window.tessera.dbExplorador.refrescar(p.conexion.id).catch(() => undefined)
  }
  if (a.tipo === 'renombrar' && nuevoNombre !== undefined && p.onRenombrada) {
    const nueva = bytesDeTexto(nuevoNombre)
    p.onRenombrada(nueva.base64, pintarBytes(nueva))
    return
  }
  void l.leer()
}

/** La pestaña de un visor de clave de Redis (ver la cabecera del módulo). */
export function DbClavePane(p: PropsClave): React.JSX.Element {
  const { conexion, base, clave, nombre, visible, altoFila } = p
  const propsRef = useRef(p)
  propsRef.current = p
  // Con su texto si es UTF-8: los comandos que salen de la pestaña la escriben como el usuario.
  const bytesClave: DbKvBytes = useMemo(() => bytesDeBase64(clave), [clave])

  const lectura = useLecturaClave(conexion.id, base, bytesClave, visible)
  const lento = useVigilanciaClave(lectura, propsRef)
  const ttl = useTtlClave(lectura.valor, lectura.leidoEn, visible)
  const edicion = useEdicionClave(conexion, base, (a, nuevoNombre) => trasEditarClave(p, lectura, a, nuevoNombre))
  const visor = useVisorClave(lectura.valor, (i) => itemsFilaEdicion(lectura.valor?.contenido ?? null, i, edicion))
  const { contenido, menu, setMenu } = visor
  const botones = botonesEdicion({ contenido, edicion, clave: bytesClave, ttlMs: ttl, abrirMenu: (x, y, items) => setMenu({ x, y, items }) })
  const exportacion = useExportarClave(conexion.id, base, bytesClave)

  const abrirConsola = (): void => {
    const tipo = contenido === null ? 'otro' : contenido.tipo
    const cmd = comandoConsola(tipo, bytesClave, contenido?.tipo === 'json' && contenido.omitidoBytes !== undefined)
    // La consola nace en la base de la clave, pero eso vive en memoria: el `SELECT` va en el
    // archivo y la sigue diciendo tras reiniciar.
    const select = base === basePorDefectoClaves(conexion) ? '' : `SELECT ${base}\n`
    p.onAbrirConsola?.(conexion.id, `${select}${cmd}`, { familia: 'claves', indice: base })
  }

  return (
    <section className={`db-clave${visible ? '' : ' hidden'}`} aria-label={`Clave ${nombre}`}>
      <header className="panel-header db-barra">
        <MarcaEntorno entorno={conexion.entorno} />
        {identidadClave(p, lectura, contenido, ttl)}
        {accionesClave(p, lectura, visor, abrirConsola, botones, exportacion)}
      </header>

      {cuerpoClave({ lectura, visor, lento, altoFila, nombre, onAbrirConsola: p.onAbrirConsola ? abrirConsola : undefined })}

      {edicion.accion &&
        createPortal(
          <DialogoEdicionClave
            conexion={conexion}
            base={base}
            clave={bytesClave}
            nombre={nombre}
            conTtl={lectura.valor?.ttlMs != null}
            nombreCampo={nombreCampoDe(edicion.accion)}
            accion={edicion.accion}
            edicion={edicion}
          />,
          document.body
        )}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />, document.body)}
    </section>
  )
}
