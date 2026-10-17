// =============================================================================
// El cuerpo de la pestaña de clave según lo leído: el error, la lectura detenida o en curso,
// una clave que ya no existe o de un tipo que el visor no lee, el texto de un string o JSON
// y la tabla de elementos con su panel de detalle. Son funciones de pintado sin estado
// propio: el estado vive en `DbClavePane` y sus hooks.
// =============================================================================

import type { DbKvBytes, DbKvContenido } from '../../../../../shared/db-claves-ipc'
import { avisoTruncado, resumenElementos, siguienteDe } from './visorClaves'
import { txVisorClaves } from './textosVisorClaves'
import type { LecturaClave } from './useLecturaClave'
import type { VisorClave } from './useVisorClave'
import { ParteVista, VistaBytes, textoParte } from './PiezasVisorClave'
import { TablaValores } from './TablaValores'
import { describirError } from '../panesBd'
import { copiarTexto } from '../documentos/utilPanes'
import { AvisoCaja } from '../../../comun/AvisoCaja'
import { EstadoVacio } from '../../../comun/EstadoVacio'
import { IconoClaveKv } from '../iconosBd'

export interface EntradaCuerpo {
  lectura: LecturaClave
  visor: VisorClave
  /** La lectura tarda: «Detener» también en el cuerpo. */
  lento: boolean
  altoFila: number
  nombre: string
  /** Ausente si la pestaña no puede abrir consolas. */
  onAbrirConsola: (() => void) | undefined
}

function leyendo(e: EntradaCuerpo): React.JSX.Element {
  const cargando = e.lectura.cargando
  const t = txVisorClaves()
  return (
    <div className="db-clave-leyendo" role="status">
      {cargando ? t.leyendoClave : ''}
      {cargando && e.lento && (
        <button type="button" className="btn" onClick={e.lectura.detener}>
          {t.detener}
        </button>
      )}
    </div>
  )
}

function detalleElemento(partes: VisorClave['partes']): React.JSX.Element {
  const t = txVisorClaves()
  return (
    <aside className="db-clave-detalle" aria-label={t.elementoElegido}>
      <div className="db-docs-panel-cab">
        <span className="db-docs-panel-titulo">{partes.length > 0 ? t.elementoElegido : t.ningunElementoElegido}</span>
      </div>
      {partes.length > 0 ? (
        <div className="db-clave-detalle-partes">
          {partes.map((parte, k) => (
            <ParteVista key={k} parte={parte} onCopiar={() => copiarTexto(textoParte(parte), parte.titulo)} />
          ))}
        </div>
      ) : (
        <div className="db-docs-panel-vacio">
          <EstadoVacio titulo={t.eligeUnElemento} pista={t.valorEnteroAqui} />
        </div>
      )}
    </aside>
  )
}

function cuerpoTabla(e: EntradaCuerpo, contenido: DbKvContenido): React.JSX.Element {
  const { tabla, indiceSel, setSeleccion, abrirMenuFila, panelDetalle, partes } = e.visor
  if (!tabla) return <></>
  const { cargandoMas, cargarMas } = e.lectura
  const t = txVisorClaves()
  const hayMas = siguienteDe(contenido) !== null
  const resumen = resumenElementos(contenido)
  return (
    <div className={`db-clave-cuerpo${panelDetalle ? ' con-detalle' : ''}`}>
      <div className="db-clave-zona">
        {tabla.filas.length === 0 ? (
          <EstadoVacio icono={<IconoClaveKv />} titulo={t.sinElementos} pista={t.sinElementosPista} />
        ) : (
          <TablaValores
            tabla={tabla}
            altoFila={e.altoFila}
            seleccionado={indiceSel >= 0 ? indiceSel : null}
            onSeleccionar={(i) => {
              const f = tabla.filas[i]
              if (f) setSeleccion(f.clave)
            }}
            onMenu={abrirMenuFila}
            pie={
              hayMas || cargandoMas ? (
                <span className="db-kv-pie-contenido">
                  {resumen}
                  <button type="button" className="btn" disabled={cargandoMas} onClick={() => void cargarMas()}>
                    {cargandoMas ? t.cargando : t.cargarMas}
                  </button>
                </span>
              ) : null
            }
            etiquetaAria={t.elementosDe(e.nombre)}
          />
        )}
      </div>
      {panelDetalle && detalleElemento(partes)}
    </div>
  )
}

function cuerpoOtro(e: EntradaCuerpo, tipoServidor: string): React.JSX.Element {
  const abrir = e.onAbrirConsola
  const t = txVisorClaves()
  return (
    <EstadoVacio
      icono={<IconoClaveKv />}
      titulo={t.tipoNoLeible(tipoServidor)}
      pista={t.tipoNoLeiblePista}
      accion={
        abrir ? (
          <button type="button" className="btn" onClick={abrir}>
            {t.abrirConsola}
          </button>
        ) : undefined
      }
    />
  )
}

/** El aviso de un error o de una lectura detenida, o null si no hay que avisar. */
function avisoDeLectura(l: LecturaClave): React.JSX.Element | null {
  const descripcion = l.error ? describirError(l.error, 'leer la clave') : null
  if (descripcion) {
    return <AvisoCaja tono={descripcion.tono} titulo={descripcion.titulo} sugerencia={descripcion.sugerencia} detalle={descripcion.detalle} />
  }
  const t = txVisorClaves()
  if (!l.valor && l.detenida) return <AvisoCaja tono="info" titulo={t.lecturaDetenida} sugerencia={t.lecturaDetenidaPista} />
  return null
}

/** El cuerpo que toca según lo leído (ver la cabecera del módulo). */
export function cuerpoClave(e: EntradaCuerpo): React.JSX.Element {
  const { contenido, modoElegido, setModoElegido } = e.visor
  const aviso = avisoDeLectura(e.lectura)
  if (aviso) return aviso
  if (!e.lectura.valor || !contenido) return leyendo(e)
  const t = txVisorClaves()
  switch (contenido.tipo) {
    case 'noExiste':
      return <EstadoVacio icono={<IconoClaveKv />} titulo={t.claveYaNoExiste} pista={t.claveYaNoExistePista} />
    case 'otro':
      return cuerpoOtro(e, contenido.tipoServidor)
    case 'string':
      return <VistaBytes bytes={contenido.valor} aviso={avisoTruncado(contenido)} modoElegido={modoElegido} onModo={setModoElegido} />
    case 'json': {
      // No leído por grande: no es un documento vacío, así que no se pinta como tal.
      if (contenido.omitidoBytes !== undefined) {
        return <EstadoVacio icono={<IconoClaveKv />} titulo={t.documentoGrande} pista={avisoTruncado(contenido) ?? ''} />
      }
      const b: DbKvBytes = { texto: contenido.texto, base64: '' }
      return <VistaBytes bytes={b} aviso={avisoTruncado(contenido)} modoElegido={modoElegido} onModo={setModoElegido} soloTexto />
    }
    case 'hash':
    case 'list':
    case 'set':
    case 'zset':
    case 'stream':
      return cuerpoTabla(e, contenido)
    default:
      return <></>
  }
}
