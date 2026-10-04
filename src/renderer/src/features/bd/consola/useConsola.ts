// =============================================================================
// useConsola: el MOTOR de una consola SQL. Compone sus piezas `useConsola*.ts` en un
// orden FIJO (el de sus efectos y limpiezas): núcleo con `despachar` síncrono,
// diálogos, modelo de Monaco, disco, sesión, lote, Stop, transacciones, resultados,
// Salida, atajos y cierre. Lo usa `DbConsolaPane`.
// Decisiones: docs/decisiones/bd/ui-consola-motor.md
// =============================================================================

import { useCallback, useMemo, useState } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbTxModo } from '../../../../../shared/db-explorador-ipc'
import { descriptor } from '../../../../../shared/motores/index'
import { ejecutando as hayEjecucion, estadoBarraTx, type BarraTx } from './estadoConsola'
import { modoTxPorDefecto } from './produccionConsola'
import type { ApiConsola, OpcionesConsola } from './tiposConsola'
import { useCierreConsola } from './useConsolaCierre'
import { useDialogosConsola } from './useConsolaDialogos'
import { useDiscoConsola } from './useConsolaDisco'
import type { ArchivoConsolaHook } from './useArchivoConsola'
import { useEdicionConsola } from './useConsolaEdicion'
import { useLoteConsola } from './useConsolaLote'
import { useModeloConsola } from './useConsolaModelo'
import { useNucleoConsola, type NucleoConsola } from './useConsolaNucleo'
import {
  useEnVueloConsola,
  usePresupuestoConsola,
  useTraerTodas,
  useUsoResultados
} from './useConsolaResultados'
import { useAtajosConsola, useSalidaConsola } from './useConsolaSalida'
import { useElegirEsquema, useSesionConsola, useTxConsola } from './useConsolaSesion'
import { useStopConsola } from './useConsolaStop'
import { puedeDetener } from './vivoConsola'

/** Si el popover del historial (que es del pane) está abierto. */
function useHistorialAbierto() {
  const [historialAbierto, setHistorialAbierto] = useState(false)
  const alternarHistorial = useCallback((): void => setHistorialAbierto((v) => !v), [])
  const cerrarHistorial = useCallback((): void => setHistorialAbierto(false), [])
  return { historialAbierto, alternarHistorial, cerrarHistorial }
}

/** La barra de transacción: el estado que manda el main o, sin sesión, el de nacimiento. */
function useBarraTx(n: NucleoConsola, conexion: DbConnection, txInicial: DbTxModo, ejecutando: boolean): BarraTx {
  const { estado, soloLectura } = n
  const entorno = conexion.entorno
  return useMemo(
    () =>
      estadoBarraTx(estado.sesion, {
        soloLectura,
        ejecutando,
        modoSinSesion: modoTxPorDefecto(entorno, soloLectura, txInicial),
        deArchivo: descriptor(conexion.motor).conexion.deArchivo
      }),
    [estado.sesion, soloLectura, ejecutando, entorno, conexion.motor, txInicial]
  )
}

interface Partes {
  ejecutando: boolean
  barraTx: BarraTx
  historial: ReturnType<typeof useHistorialAbierto>
  disco: Pick<ArchivoConsolaHook, 'cargarDelDisco' | 'conservarLaMia'>
  lote: ReturnType<typeof useLoteConsola>
  edicion: ReturnType<typeof useEdicionConsola>
  stop: ReturnType<typeof useStopConsola>
  tx: ReturnType<typeof useTxConsola>
  elegirEsquema: ReturnType<typeof useElegirEsquema>
  pestana: ReturnType<typeof useUsoResultados>
  vuelo: ReturnType<typeof useEnVueloConsola>
  traer: ReturnType<typeof useTraerTodas>
  salida: ReturnType<typeof useSalidaConsola>
}

function textoEstadoDe(n: NucleoConsola): string | null {
  if (n.cargado) return n.estado.pista
  return n.errorCarga !== null ? `No se pudo leer la consola: ${n.errorCarga}` : 'Cargando…'
}

function componerApi(n: NucleoConsola, p: Partes): ApiConsola {
  const { enVuelo } = p.vuelo
  return {
    ...p.disco,
    ...p.salida,
    ...p.historial,
    modelo: n.modelo,
    estado: n.estado,
    barraTx: p.barraTx,
    ejecutando: p.ejecutando,
    cargado: n.cargado,
    soloLectura: n.soloLectura,
    textoEstado: textoEstadoDe(n),
    conflicto: n.conflicto !== null,
    loteMarcado: n.loteMarcado,
    cargandoMas: enVuelo.cargandoMas,
    // Un «Traer todas» cuenta como una página en vuelo también ENTRE dos páginas.
    detenible: puedeDetener(p.ejecutando, enVuelo.cargandoMas.size + p.traer.trayendo.size, enVuelo.contando.size),
    contando: enVuelo.contando,
    totales: enVuelo.totales,
    dialogo: n.dialogo,
    ejecutar: p.lote.ejecutar,
    ejecutarTodo: p.lote.ejecutarTodo,
    detener: p.stop.detener,
    alternarModoTx: () => void p.tx.alternarModoTx(),
    commit: p.tx.commit,
    rollback: p.tx.rollback,
    pestana: p.pestana,
    cargarMas: p.vuelo.cargarMas,
    contar: p.vuelo.contar,
    esquemaActual: n.esquemaActual,
    esquemaElegido: n.esquemaElegido,
    cambiandoEsquema: n.cambiandoEsquema,
    elegirEsquema: (esquema) => void p.elegirEsquema(esquema),
    trayendo: p.traer.trayendo,
    topes: p.traer.topes,
    // La misma función en cada render: llega a `DbResultados`, que va con `memo`.
    traerTodas: p.traer.traerTodas,
    detenerTraerTodas: p.traer.detenerTraerTodas,
    explicar: () => void p.edicion.explicar(),
    formatear: () => void p.edicion.formatear(),
    insertarSql: p.edicion.insertarSql
  }
}

/** El motor de una consola SQL: estado, modelo, archivo, sesión, lote y cierre. */
export function useConsola(o: OpcionesConsola): ApiConsola {
  const n = useNucleoConsola(o)
  const dialogos = useDialogosConsola(n)
  const historial = useHistorialAbierto()
  useModeloConsola(n, o.conexion)
  const guardado = useDiscoConsola(n, o.visible)
  const disco = { cargarDelDisco: guardado.cargarDelDisco, conservarLaMia: guardado.conservarLaMia }
  useSesionConsola(n)
  const ejecutando = hayEjecucion(n.estado)
  const lote = useLoteConsola(n, dialogos, ejecutando)
  const edicion = useEdicionConsola(n, dialogos.bindsDelLote)
  const stop = useStopConsola(n, dialogos.pedirConfirmacion)
  const tx = useTxConsola(n, dialogos)
  const elegirEsquema = useElegirEsquema(n)
  const pestana = useUsoResultados(n, o.visible)
  const vuelo = useEnVueloConsola(n)
  usePresupuestoConsola(n, o.visible, vuelo.enVuelo)
  const traer = useTraerTodas(n, vuelo.enVuelo)
  const salida = useSalidaConsola(n, lote.correr, stop.forzar)
  useAtajosConsola(
    n,
    o.editor,
    {
      ejecutar: lote.ejecutar,
      ejecutarTodo: lote.ejecutarTodo,
      detener: stop.detener,
      commit: tx.commit,
      rollback: tx.rollback,
      explicar: edicion.explicar,
      formatear: edicion.formatear,
      alternarHistorial: historial.alternarHistorial
    },
    guardado.guardar
  )
  useCierreConsola(n, o.paneKey, dialogos, stop.detener, guardado.vaciar)
  const barraTx = useBarraTx(n, o.conexion, o.txInicial, ejecutando)
  const partes = { ejecutando, barraTx, historial, disco, lote, edicion, stop, tx, elegirEsquema, pestana, vuelo, traer, salida }
  return componerApi(n, partes)
}
