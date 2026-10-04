// =============================================================================
// Hooks de la pestaña de datos, que `DbDatosPane` llama en este orden (el de declaración
// fija el de sus efectos y limpiezas): acciones estables, presupuesto de celdas, cierre y
// primera consulta, indicador de la pestaña y foco del error, y lo derivado del resultado.
// Las deps incluyen el núcleo, que es estable: no cambia cuándo corre nada.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import { useEffect, useMemo } from 'react'
import type { DbColumnaResultado } from '../../../../../shared/db-explorador-ipc'
import type { IndicadorPestana } from '../dbTabsModel'
import { columnasFiltrablesSql, FILTRO_TABLA_VACIO, podarColumnas } from '../filtro/modeloFiltro'
import type { DbDatosPaneProps } from '../propsBd'
import { ordenEnRejilla, peticionesEnVuelo, rangoError } from '../panesBd'
import {
  hayColumnaOculta,
  identidadParaEditar,
  motivosColumnas,
  noEditablesPorNombre,
  numCambios,
  sePuedeEditar
} from './cambiosRejilla'
import { registroCeldas } from './presupuestoCeldas'
import { registrarDatos } from './registroEdicion'
import { reanudarTrasTope } from './traerTodas'
import { cancelarDatos, cerrarSilencioso, nuevaPeticion, ponerCambios } from './datosBase'
import { cargarMas, consultar, contar, liberar, traerTodas } from './datosLectura'
import { abrirEnvio, cerrarEnvio, pedirDescarte } from './datosEnvio'
import { cerrarMenuExportar, valorCompleto } from './datosAcciones'
import type { AccionesDatos, DerivadosDatos, EstadoDatos, NucleoDatos } from './datosTipos'

const SIN_COLUMNAS: DbColumnaResultado[] = []

/** Las acciones de identidad estable, creadas una vez sobre el núcleo. */
export function useAccionesDatos(n: NucleoDatos): AccionesDatos {
  return useMemo<AccionesDatos>(
    () => ({
      consultar: (filtro, opciones) => consultar(n, filtro, opciones),
      cargarMas: () => cargarMas(n),
      traerTodas: () => traerTodas(n),
      contar: () => contar(n),
      liberar: () => liberar(n),
      ponerCambios: (c) => ponerCambios(n, c),
      pedirDescarte: () => pedirDescarte(n),
      abrirEnvio: () => abrirEnvio(n),
      cerrarEnvio: () => cerrarEnvio(n),
      cerrarMenuExportar: () => cerrarMenuExportar(n),
      valorCompleto: (f, c) => valorCompleto(n, f, c)
    }),
    [n]
  )
}

/**
 * La pestaña es un dueño del registro GLOBAL de celdas: oculta y poco usada, suelta lo
 * que va tras su primera página; visible y en el tope, al volver a verse (o al cambiar
 * las filas por página) mira si ya cabe.
 */
export function usePresupuestoDatos(n: NucleoDatos, a: AccionesDatos, e: EstadoDatos, props: DbDatosPaneProps): void {
  const { visible, filasPorPagina } = props
  const { res, sinLector } = e
  const { liberar: soltar } = a
  useEffect(() => {
    if (!visible) return
    n.usoRef.current = performance.now()
    return () => {
      n.usoRef.current = performance.now()
    }
  }, [visible, n])

  useEffect(() => {
    return registroCeldas.registrar({
      id: nuevaPeticion('rejilla-datos'),
      celdas: () => {
        const r = n.resRef.current
        return r ? r.datos.filas.length * r.columnas.length : 0
      },
      celdasPrimeraPagina: () => {
        const r = n.resRef.current
        return r ? Math.min(r.filasPrimeraPagina, r.datos.filas.length) * r.columnas.length : 0
      },
      visible: () => n.propsRef.current.visible,
      ultimoUso: () => n.usoRef.current,
      liberar: soltar
    })
  }, [soltar, n])

  // Cambiaron las filas o la visibilidad: el registro vuelve a sumar y pide memoria.
  useEffect(() => {
    registroCeldas.avisar()
  }, [res, visible])

  // Se lee la PROP `filasPorPagina` (no `propsRef`) para que esté en las deps.
  useEffect(() => {
    const r = n.resRef.current
    const reanudar = reanudarTrasTope(
      {
        visible,
        tope: sinLector?.tope === true,
        hayLector: r !== null && n.lectorRef.current !== null,
        columnas: r ? r.columnas.length : 0,
        filasPorPagina
      },
      registroCeldas
    )
    if (reanudar) n.setSinLector(null)
  }, [visible, sinLector, filasPorPagina, n])
}

/** Al cerrar la pestaña se cancela todo lo que esté en vuelo, también un «Enviar». */
function cerrarPestana(n: NucleoDatos): void {
  const con = n.propsRef.current.conexion
  const enVuelo = peticionesEnVuelo({
    consulta: n.peticionRef.current,
    cargando: n.cargandoRef.current,
    mas: n.masRef.current,
    contar: n.contarRef.current
  })
  // Un «Enviar» en vuelo también: sin pestaña, nadie vería si se aplicó.
  if (n.envioIdRef.current) enVuelo.push(n.envioIdRef.current)
  for (const peticionId of enVuelo) cancelarDatos(con.id, peticionId)
  // `peticionRef` a null: cualquier respuesta tardía cierra su lector.
  n.peticionRef.current = null
  n.contarRef.current = null
  n.masRef.current = null
  n.traerRef.current = null
  n.envioIdRef.current = null
  const l = n.lectorRef.current
  n.lectorRef.current = null
  if (l) cerrarSilencioso(l)
  n.haSidoVisibleRef.current = false
  // Una pregunta abierta se da por cancelada: la pestaña ya no existe.
  n.descarteRef.current?.resolver(false)
  n.descarteRef.current = null
}

/** Registro para cerrar (`registroEdicion.ts`), limpieza al desmontar y primera consulta visible. */
export function useCicloDatos(n: NucleoDatos, a: AccionesDatos, props: DbDatosPaneProps): void {
  const { paneKey, visible } = props
  const conexionId = props.conexion.id
  const { pedirDescarte: solicitarCierre, consultar: consultarTabla } = a
  useEffect(
    () =>
      registrarDatos(paneKey, {
        conexionId,
        solicitarCierre,
        cambiosPendientes: () => numCambios(n.cambiosRef.current)
      }),
    [paneKey, conexionId, solicitarCierre, n]
  )

  useEffect(() => () => cerrarPestana(n), [n])

  // Nada antes del primer `visible`: una pestaña de fondo no consulta a nadie.
  useEffect(() => {
    if (!visible || n.haSidoVisibleRef.current) return
    n.haSidoVisibleRef.current = true
    void consultarTabla(FILTRO_TABLA_VACIO)
  }, [visible, consultarTabla, n])
}

/** El indicador de la pestaña y el foco al campo WHERE con el token del error seleccionado. */
export function useIndicadoresDatos(n: NucleoDatos, e: EstadoDatos, exportando: boolean): void {
  const { cargando, contando, trayendo, error, errorCampo } = e
  const pendientes = numCambios(e.cambios)
  const enviando = e.envio?.estado.tipo === 'enviando'
  useEffect(() => {
    const s = new Set<IndicadorPestana>()
    if (cargando || contando || trayendo || exportando || enviando) s.add('cargando')
    if (pendientes > 0) s.add('sinEnviar')
    if (error || errorCampo) s.add('error')
    n.propsRef.current.onIndicador(s)
  }, [cargando, contando, trayendo, exportando, enviando, pendientes, error, errorCampo, n])

  // Solo si la pestaña se ve (robar el foco desde el fondo sería peor), y solo el WHERE.
  useEffect(() => {
    if (errorCampo?.campo !== 'where' || !n.propsRef.current.visible) return
    const input = n.whereRef.current
    if (!input) return
    input.focus()
    if (errorCampo.posicion !== undefined) {
      const { desde, hasta } = rangoError(input.value, errorCampo.posicion)
      input.setSelectionRange(desde, hasta)
    }
  }, [errorCampo, n])
}

/** Columnas visibles (sin la del ROWID), identidad, columnas del filtro y la edición de la rejilla. */
export function useDerivadosDatos(n: NucleoDatos, a: AccionesDatos, e: EstadoDatos): DerivadosDatos {
  const { res, cargando, aplicado, cambios, filaError } = e
  const columnasVisibles = useMemo(
    () => (res ? (hayColumnaOculta(res.columnas) ? res.columnas.slice(0, -1) : res.columnas) : SIN_COLUMNAS),
    [res]
  )
  const identidad = res ? identidadParaEditar(res.identidad, res.columnas) : null
  // Mientras llega OTRO resultado no se edita: un cambio quedaría con la posición de una fila del viejo.
  const edicionViva = sePuedeEditar(identidad, cargando)
  const motivosColumna = useMemo(
    () => motivosColumnas(columnasVisibles, noEditablesPorNombre(res?.noEditables)),
    [columnasVisibles, res?.noEditables]
  )
  const columnasFiltro = useMemo(() => columnasFiltrablesSql(columnasVisibles), [columnasVisibles])
  // Sin resultado las columnas están vacías y se llevaría todo lo escrito por delante.
  useEffect(() => {
    if (columnasFiltro.length === 0) return
    n.setGuiadoTxt((g) => podarColumnas(g, columnasFiltro))
  }, [columnasFiltro, n])
  const ordenRejilla = useMemo(() => ordenEnRejilla(aplicado.orden, columnasVisibles), [aplicado.orden, columnasVisibles])
  const { ponerCambios: onCambios, abrirEnvio: onEnviar } = a
  const { setFilasSel } = n
  const edicion = useMemo(
    () =>
      edicionViva
        ? { cambios, onCambios, motivosColumna, onEnviar, filaError, onFilasSeleccionadas: setFilasSel }
        : null,
    [edicionViva, cambios, onCambios, motivosColumna, onEnviar, filaError, setFilasSel]
  )
  const editable = identidad !== null && identidad.tipo !== 'ninguna'
  const motivoNoEditable =
    identidad !== null && identidad.tipo === 'ninguna' && identidad.motivo ? identidad.motivo : null
  return { columnasVisibles, editable, edicionViva, motivoNoEditable, columnasFiltro, ordenRejilla, edicion }
}
