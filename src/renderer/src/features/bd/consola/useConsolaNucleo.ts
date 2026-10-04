// =============================================================================
// Núcleo de `useConsola`: la bolsa estable de refs, el estado con su `despachar`
// SÍNCRONO (el bucle del lote lee el estado resultante justo después de cada acción)
// y los estados de React que comparten las demás piezas del hook.
// Decisiones: docs/decisiones/bd/ui-consola-motor.md
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import { estadoInicialConsola, reducirConsola, type AccionConsola, type EstadoConsola } from './estadoConsola'
import { esquemaEfectivo } from './esquemaConsola'
import type { ApiExplorador, DialogoConsola, OpcionesConsola, RefsConsola } from './tiposConsola'
import { porDefectoConsola } from './utilConsola'

/** Lo que el núcleo reparte a las piezas del hook (los setters de React son estables). */
export interface NucleoConsola {
  r: RefsConsola
  api: ApiExplorador
  perfilId: string
  consolaId: string
  estado: EstadoConsola
  despachar: (a: AccionConsola) => void
  salida: (tipo: 'error' | 'aviso' | 'info', texto: string) => void
  soloLectura: boolean
  modelo: editor.ITextModel | null
  setModelo: (m: editor.ITextModel | null) => void
  cargado: boolean
  setCargado: (c: boolean) => void
  errorCarga: string | null
  setErrorCarga: (e: string | null) => void
  conflicto: { texto: string } | null
  cambiarConflicto: (c: { texto: string } | null) => void
  dialogo: DialogoConsola | null
  setDialogo: (d: DialogoConsola | null) => void
  loteMarcado: number | null
  setLoteMarcado: (l: number | null) => void
  esquemaElegido: string | null
  setEsquemaElegido: (e: string | null) => void
  cambiandoEsquema: boolean
  setCambiandoEsquema: (c: boolean) => void
  /** Esquema en que está la consola: uno solo para barra, eco y autocompletado. */
  esquemaActual: string | null
}

function crearRefsConsola(o: OpcionesConsola): RefsConsola {
  return {
    estadoRef: { current: estadoInicialConsola(o.conexion.motor) },
    esquemaElegidoRef: { current: o.consola.esquema ?? null },
    modeloRef: { current: null },
    edRef: { current: o.editor },
    visibleRef: { current: o.visible },
    soloLecturaRef: { current: false },
    conexionRef: { current: o.conexion },
    consolaRef: { current: o.consola },
    onIndicadorRef: { current: o.onIndicador },
    filasPorPaginaRef: { current: o.filasPorPagina },
    txInicialRef: { current: o.txInicial },
    cargadoRef: { current: false },
    guardadoRef: { current: null },
    conflictoRef: { current: null },
    escrituraRef: { current: null },
    temporizadorRef: { current: null },
    errorGuardadoRef: { current: null },
    aplicandoDiscoRef: { current: false },
    leyendoRef: { current: false },
    borradaRef: { current: false },
    desmontadoRef: { current: false },
    dialogoRef: { current: null },
    ejecucionRef: { current: null },
    stopRef: { current: null },
    infoLoteRef: { current: null },
    marcasRef: { current: null },
    validadorRef: { current: null },
    usoRef: { current: new Map() },
    txEnCursoRef: { current: false },
    cargandoMasRef: { current: new Set() },
    contandoRef: { current: new Set() },
    masEnVueloRef: { current: new Map() },
    conteosEnVueloRef: { current: new Map() },
    trayendoRef: { current: new Map() },
    valoresParamRef: { current: new Map() },
    cambiandoEsquemaRef: { current: false }
  }
}

/** La bolsa de refs (una por instancia) con lo que se lee de ESTE render. */
function useRefsConsola(o: OpcionesConsola): RefsConsola {
  const [r] = useState(() => crearRefsConsola(o))
  r.edRef.current = o.editor
  r.visibleRef.current = o.visible
  r.conexionRef.current = o.conexion
  r.consolaRef.current = o.consola
  r.onIndicadorRef.current = o.onIndicador
  // Ajustes de Configuración: valen para la SIGUIENTE petición y no rehacen nada.
  r.filasPorPaginaRef.current = o.filasPorPagina
  r.txInicialRef.current = o.txInicial
  return r
}

/** El reducer aplicado a mano: el resultado queda en el ref en el acto y en React al pintar. */
function useEstadoSincrono(r: RefsConsola, motor: OpcionesConsola['conexion']['motor']) {
  const [estado, setEstado] = useState<EstadoConsola>(() => r.estadoRef.current)
  const despachar = useCallback(
    (a: AccionConsola): void => {
      const sig = reducirConsola(r.estadoRef.current, a)
      if (sig === r.estadoRef.current) return
      r.estadoRef.current = sig
      setEstado(sig)
    },
    [r]
  )
  // Otro MOTOR (se editó la conexión) rehace el estado: lo del dialecto anterior ya no vale.
  useEffect(() => {
    if (r.estadoRef.current.motor === motor) return
    const sig = estadoInicialConsola(motor, r.estadoRef.current.sesion)
    r.estadoRef.current = sig
    setEstado(sig)
  }, [motor, r])
  return { estado, despachar }
}

/** Lo elegido en el selector: copia local que se actualiza al instante, sin esperar a listar. */
function useEsquemaElegido(r: RefsConsola, esquemaDeLaConsola: string | null | undefined) {
  const [esquemaElegido, setEsquemaElegido] = useState<string | null>(() => r.esquemaElegidoRef.current)
  r.esquemaElegidoRef.current = esquemaElegido
  useEffect(() => {
    setEsquemaElegido(esquemaDeLaConsola ?? null)
  }, [esquemaDeLaConsola])
  const [cambiandoEsquema, setCambiandoEsquema] = useState(false)
  return { esquemaElegido, setEsquemaElegido, cambiandoEsquema, setCambiandoEsquema }
}

/** Estado, refs y `despachar` de una consola; el primero de los hooks de `useConsola`. */
export function useNucleoConsola(o: OpcionesConsola): NucleoConsola {
  const r = useRefsConsola(o)
  const { estado, despachar } = useEstadoSincrono(r, o.conexion.motor)
  const esquema = useEsquemaElegido(r, o.consola.esquema)
  const [modelo, setModelo] = useState<editor.ITextModel | null>(null)
  const [cargado, setCargado] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState<{ texto: string } | null>(null)
  const [dialogo, setDialogo] = useState<DialogoConsola | null>(null)
  const [loteMarcado, setLoteMarcado] = useState<number | null>(null)
  // La solo lectura que APLICA el main a la sesión; nunca la casilla de la conexión.
  const soloLectura = estado.sesion ? estado.sesion.soloLectura : false
  r.soloLecturaRef.current = soloLectura
  const cambiarConflicto = useCallback(
    (c: { texto: string } | null): void => {
      r.conflictoRef.current = c
      setConflicto(c)
    },
    [r]
  )
  const salida = useCallback(
    (tipo: 'error' | 'aviso' | 'info', texto: string): void =>
      despachar({ tipo: 'salida', entrada: { tipo, texto }, ahora: Date.now() }),
    [despachar]
  )
  return {
    r,
    api: window.tessera.dbExplorador,
    perfilId: o.perfilId,
    consolaId: o.consola.id,
    estado,
    despachar,
    salida,
    soloLectura,
    modelo,
    setModelo,
    cargado,
    setCargado,
    errorCarga,
    setErrorCarga,
    conflicto,
    cambiarConflicto,
    dialogo,
    setDialogo,
    loteMarcado,
    setLoteMarcado,
    ...esquema,
    esquemaActual: esquemaEfectivo(estado.sesion, esquema.esquemaElegido, porDefectoConsola(o.conexion))
  }
}
