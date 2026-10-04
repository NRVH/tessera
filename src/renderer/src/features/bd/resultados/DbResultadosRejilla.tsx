// =============================================================================
// DbResultadosRejilla: la rejilla de UN resultado de la consola y lo que su dueño le da:
// exportar (con SU `useExportarBd`, que se cancela al cerrar la pestaña), «Copiar como
// INSERT», «Traer todas» y el valor completo de una celda recortada. Lo pinta `DbResultados`.
// Decide con `valorResultado.ts` (tabla única, clave) y lee la clave de `cacheMetaBd`.
// Decisiones: docs/decisiones/bd/ui-resultados-pestanas.md
// =============================================================================

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { DbMotor } from '../../../../../shared/db-ipc'
import type {
  DbFormatoFilas,
  DbOrigenExportacion,
  DbRespuesta,
  DbTxModo,
  DbValor
} from '../../../../../shared/db-explorador-ipc'
import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql'
import { claveBd } from '../arbolBd'
import { cacheMetaBd } from '../cacheMetaBd'
import { sesionEsBase } from '../nivelBasesBd'
import type { ResultadoConsola } from '../consola/estadoConsola'
import { textoError } from '../consola/salidaConsola'
import { useExportarBd, type ExportadorBd } from '../rejilla/useExportarBd'
import { decidirValorCompleto, esquemaDeTabla, peticionValor, tablaInsertDe } from './valorResultado'
import { DbRejilla } from '../DbRejilla'

/** Lo que la consola da a la rejilla de cada resultado. */
export interface DuenoRejillaResultado {
  /** De qué consola son (exportar re-ejecuta la consulta en SU sesión). */
  perfilId: string
  consolaId: string
  /**
   * «Transacción al abrir» de la barra de la consola: exportar una consulta y leer el
   * valor entero de una celda van a SU sesión y, si no la tuviera, la crearían con esto
   * (ver `shared/ajustesBd.ts`).
   */
  txInicial: DbTxModo
  conexionId: string
  motor: DbMotor
  altoFila: number
  cargandoMas: ReadonlySet<string>
  contando: ReadonlySet<string>
  totales: Readonly<Record<string, number>>
  onCargarMas: (id: string) => void
  onContar: (id: string) => void
  onVolverAEjecutar: (id: string) => void
  /** Resultados con un «Traer todas» en marcha, y el motivo de los que llegaron al tope. */
  trayendo: ReadonlySet<string>
  topes: Readonly<Record<string, string>>
  onTraerTodas: (id: string) => void
  onDetenerTraerTodas: (id: string) => void
}

interface ValorCompletoResultado {
  onValorCompleto: ((fila: number, columna: number) => Promise<DbRespuesta<DbValor>>) | undefined
  razonSinValor: string | undefined
}

/**
 * El valor completo: solo con tabla única y su clave entera en el resultado; la clave se
 * pide al catálogo solo si hay celdas recortadas y la pestaña se ve.
 */
function useValorCompletoResultado(r: ResultadoConsola, visible: boolean, p: DuenoRejillaResultado): ValorCompletoResultado {
  const cache = cacheMetaBd()
  const version = useSyncExternalStore(cache.suscribir, cache.version)
  const { conexionId, motor, perfilId, consolaId, txInicial } = p
  const tabla = r.tabla
  // En SQL Server lo que relee la sesión es la BASE, no un esquema: no califica una tabla
  // escrita sin esquema, y esa tabla no ofrece el valor completo.
  const esquemaSesion = sesionEsBase(motor) ? null : r.esquemaSesion
  const esquemaTabla = tabla ? esquemaDeTabla(tabla, esquemaSesion) : null
  const claveCatalogo =
    tabla && esquemaTabla && !tabla.dblink ? claveBd.objeto(conexionId, esquemaTabla, 'tabla', tabla.nombre) : null
  const { columnasCatalogo, errorCatalogo } = useMemo(() => {
    void version
    if (!tabla || !esquemaTabla || claveCatalogo === null) return { columnasCatalogo: null, errorCatalogo: null }
    return {
      columnasCatalogo: cache.columnas(conexionId, esquemaTabla, tabla.nombre),
      errorCatalogo: cache.error(claveCatalogo)
    }
  }, [cache, version, conexionId, tabla, esquemaTabla, claveCatalogo])
  const decision = useMemo(
    () => decidirValorCompleto({ tabla, esquemaSesion, columnasResultado: r.columnas, columnasCatalogo }),
    [tabla, esquemaSesion, r.columnas, columnasCatalogo]
  )
  const hayRecortes = r.datos !== null && r.datos.recortes.size > 0
  const cargar = !decision.ok ? decision.cargar : undefined
  useEffect(() => {
    // Un error no se reintenta solo (lo dice la razón); la caché ya deduplica lo que esté en vuelo.
    if (!visible || !hayRecortes || !cargar || claveCatalogo === null) return
    if (cache.error(claveCatalogo) || cache.cargando(claveCatalogo)) return
    void cache.cargarColumnas(conexionId, cargar.esquema, cargar.nombre, 'tabla')
  }, [visible, hayRecortes, cargar, claveCatalogo, cache, conexionId])

  const datos = r.datos
  const onValorCompleto = useMemo(() => {
    if (!decision.ok || !datos) return undefined
    const { objeto, indicesClave } = decision
    return (fila: number, columna: number): Promise<DbRespuesta<DbValor>> => {
      const f = datos.filas[fila]
      const c = r.columnas[columna]
      if (!f || !c) return Promise.resolve({ ok: false, error: { motivo: 'interno', mensaje: 'La celda ya no está cargada' } })
      // Con SU consola: se relee en esa sesión, que ve la transacción sin confirmar.
      const peticion = peticionValor({ conexionId, perfilId, consolaId, txInicial, objeto, fila: f, indicesClave, columna: c.nombre })
      return window.tessera.dbExplorador
        .valor(peticion)
        .catch((err: unknown) => ({
          ok: false as const,
          error: { motivo: 'interno' as const, mensaje: err instanceof Error ? err.message : String(err) }
        }))
    }
  }, [decision, datos, r.columnas, conexionId, perfilId, consolaId, txInicial])
  let razonSinValor: string | undefined
  if (!decision.ok) {
    razonSinValor =
      errorCatalogo && decision.cargar ? `No se pudo leer la clave primaria de la tabla: ${textoError(errorCatalogo)}` : decision.razon
  }
  return { onValorCompleto, razonSinValor }
}

/**
 * Exporta el resultado: la consulta ENTERA en la sesión de la consola si se puede releer
 * (con sus parámetros), y si el main la rechaza, `useExportarBd` cae a lo ya cargado.
 */
function exportarResultado(
  r: ResultadoConsola,
  titulo: string,
  p: DuenoRejillaResultado,
  exportador: ExportadorBd,
  formato: DbFormatoFilas
): void {
  const releible = !r.noReleible && r.clase === 'consulta'
  const cargadas: DbOrigenExportacion | null = r.datos
    ? { tipo: 'filas', columnas: [...r.columnas], filasJson: JSON.stringify(r.datos.filas) }
    : null
  const origen: DbOrigenExportacion | null = releible
    ? {
        tipo: 'consulta',
        perfilId: p.perfilId,
        consolaId: p.consolaId,
        sql: r.sql,
        esquema: r.esquemaSesion,
        // Por si exportar CREA la sesión: con el modo de la barra (ver la prop).
        txInicial: p.txInicial,
        ...(r.binds ? { binds: r.binds } : {})
      }
    : cargadas
  if (origen === null) return
  const comun = {
    formato,
    nombreSugerido: titulo,
    tablaInsert: tablaInsertDe(r.tabla, dialectoDeMotor(p.motor)),
    motor: p.motor
  }
  void exportador.exportar({ ...comun, origen }, releible && cargadas ? { ...comun, origen: cargadas } : undefined)
}

/** La rejilla de UN resultado; componente propio para que cada pestaña tenga SU exportador. */
export function RejillaResultado({
  id,
  titulo,
  r,
  visible,
  p
}: {
  id: string
  titulo: string
  r: ResultadoConsola
  visible: boolean
  p: DuenoRejillaResultado
}): React.JSX.Element {
  const exportador = useExportarBd()
  const { onValorCompleto, razonSinValor } = useValorCompletoResultado(r, visible, p)
  const releible = !r.noReleible && r.clase === 'consulta'
  const onExportar = (formato: DbFormatoFilas): void => exportarResultado(r, titulo, p, exportador, formato)

  // Al tope de memoria de «Traer todas» se enseña el motivo como `sinLector`, pero sin
  // «Volver a ejecutar»: volvería a llenarse igual (lo que sirve es exportar).
  const tope = p.topes[id] ?? null
  return (
    <DbRejilla
      columnas={r.columnas}
      datos={r.datos}
      cargandoMas={p.cargandoMas.has(id)}
      onCargarMas={r.lector ? () => p.onCargarMas(id) : undefined}
      total={p.totales[id] ?? null}
      contando={p.contando.has(id)}
      onContar={r.lector ? () => p.onContar(id) : undefined}
      orden={null}
      sinLector={r.sinLector ?? tope}
      onVolverAEjecutar={r.sinLector ? () => p.onVolverAEjecutar(id) : undefined}
      altoFila={p.altoFila}
      visible={visible}
      etiquetaAria={`Resultado ${titulo}`}
      motor={p.motor}
      tablaInsert={tablaInsertDe(r.tabla, dialectoDeMotor(p.motor))}
      onTraerTodas={() => p.onTraerTodas(id)}
      trayendoTodas={p.trayendo.has(id)}
      onDetenerTraerTodas={() => p.onDetenerTraerTodas(id)}
      onExportar={releible || r.datos ? onExportar : undefined}
      exportando={exportador.enCurso ? { filas: exportador.enCurso.filas } : null}
      onCancelarExportacion={exportador.cancelar}
      onValorCompleto={onValorCompleto}
      razonSinValorCompleto={razonSinValor}
    />
  )
}
