// =============================================================================
// DbClavePane: la pestaña de clave de Redis, el visor de una clave (solo lectura: se escribe
// por la consola). Cabecera con tipo, nombre, TTL con cuenta atrás, memoria y codificación;
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
import { pintarBytes } from './bytesClaves'
import { bytesLegibles, comandoConsola, etiquetaTipo, resumenElementos, ttlLegible } from './visorClaves'
import { useLecturaClave, useTtlClave, useVigilanciaClave, type LecturaClave } from './useLecturaClave'
import { useVisorClave, type VisorClave } from './useVisorClave'
import { cuerpoClave } from './cuerpoClave'
import { copiarTexto } from '../documentos/utilPanes'
import { ContextMenu } from '../../../comun/ContextMenu'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { BotonBarraBd } from '../rejilla/DatosBotonBarra'
import { MarcaEntorno } from '../MarcaEntorno'
import { IconoConsola, IconoDetener, IconoRefrescar, IconoVerValor } from '../iconosBd'
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
  /** Abre una consola de esta conexión con un texto inicial. */
  onAbrirConsola?: (conexionId: string, textoInicial?: string) => void
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

function accionesClave(p: PropsClave, l: LecturaClave, visor: VisorClave, abrirConsola: () => void): React.JSX.Element {
  const { contenido, tabla, panelDetalle, setPanelDetalle } = visor
  const enCurso = l.cargando || l.cargandoMas
  const copiableValor = contenido?.tipo === 'string' ? pintarBytes(contenido.valor) : contenido?.tipo === 'json' ? contenido.texto : null
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
      {tabla && (
        <BotonBarraBd
          etiqueta={panelDetalle ? 'Ocultar el elemento' : 'Ver el elemento'}
          titulo={panelDetalle ? 'Ocultar el panel del elemento elegido' : 'Ver entero el elemento elegido'}
          onClick={() => setPanelDetalle((v) => !v)}
        >
          <IconoVerValor />
        </BotonBarraBd>
      )}
      {p.onAbrirConsola && (
        <BotonBarraBd etiqueta="Abrir consola" titulo="Abrir una consola con el comando que lee esta clave" onClick={abrirConsola}>
          <IconoConsola />
        </BotonBarraBd>
      )}
    </div>
  )
}

/** La pestaña de un visor de clave de Redis (ver la cabecera del módulo). */
export function DbClavePane(p: PropsClave): React.JSX.Element {
  const { conexion, base, clave, nombre, visible, altoFila } = p
  const propsRef = useRef(p)
  propsRef.current = p
  const bytesClave: DbKvBytes = useMemo(() => ({ base64: clave }), [clave])

  const lectura = useLecturaClave(conexion.id, base, bytesClave, visible)
  const lento = useVigilanciaClave(lectura, propsRef)
  const ttl = useTtlClave(lectura.valor, lectura.leidoEn, visible)
  const visor = useVisorClave(lectura.valor)
  const { contenido, menu, setMenu } = visor

  const abrirConsola = (): void => {
    const tipo = contenido === null ? 'otro' : contenido.tipo
    const cmd = comandoConsola(tipo, bytesClave)
    const select = base === basePorDefectoClaves(conexion) ? '' : `SELECT ${base}\n`
    p.onAbrirConsola?.(conexion.id, `${select}${cmd}`)
  }

  return (
    <section className={`db-clave${visible ? '' : ' hidden'}`} aria-label={`Clave ${nombre}`}>
      <header className="panel-header db-barra">
        <MarcaEntorno entorno={conexion.entorno} />
        {identidadClave(p, lectura, contenido, ttl)}
        {accionesClave(p, lectura, visor, abrirConsola)}
      </header>

      {cuerpoClave({ lectura, visor, lento, altoFila, nombre, onAbrirConsola: p.onAbrirConsola ? abrirConsola : undefined })}

      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />, document.body)}
    </section>
  )
}
