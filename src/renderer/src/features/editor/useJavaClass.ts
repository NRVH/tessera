// =============================================================================
// Estado y efectos de JavaClassPane: editor de solo lectura, pedido al descompilador y motor.
// Solo pide el pane del proyecto activo; el tick del watcher relanza solo si hubo fuente.
// Es un hook del mismo pane para conservar el orden de estados y efectos.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { useVisibleLayout } from '../../comun/useVisibleLayout'
import {
  crearEditorJava,
  hayFuente,
  motorAlternativo,
  mostrarFuente,
  pedirDescompilacion
} from './javaClassModelo'
import type { OpenFile } from './centerPane'
import type { DescompilarResult, MotorDescompilador, MotorPedido } from '../../../../shared/java-ipc'

interface EntradaJavaClass {
  file: OpenFile
  visible: boolean
  targetKey: string
  activeTargetKey: string
  fsTick: number
}

type AccionLarga = 'redetectar' | 'elegir'

/** Estado del pane de clase Java: resultado, carga, motor y acciones de recuperación. */
export function useJavaClass({ file, visible, targetKey, activeTargetKey, fsTick }: EntradaJavaClass) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<editor.ITextModel | null>(null)
  /** Generación: descarta respuestas de una petición que ya no interesa. */
  const tokenRef = useRef(0)
  /** Lo último que se pidió (motor + fichero) y el `fsTick` de ese pedido. */
  const pedidoRef = useRef<string | null>(null)
  const tickRef = useRef(-1)
  /** ¿El último resultado trajo fuente? Un fallo NO se re-pide por un tick. */
  const conFuenteRef = useRef(false)

  const [cargando, setCargando] = useState(true)
  const [resultado, setResultado] = useState<DescompilarResult | null>(null)
  const [motorPedido, setMotorPedido] = useState<MotorPedido>('auto')
  const [detalleAbierto, setDetalleAbierto] = useState(false)

  const conFuente = hayFuente(resultado)

  // `visible && conFuente`: la ventana de reintentos del hook arranca cuando el host se destapa.
  useVisibleLayout(hostRef, editorRef, visible && conFuente)
  useEffect(() => crearEditorJava(hostRef.current, editorRef, modelRef), [])

  const descompilar = useCallback(
    async (motor: MotorPedido, ignorarCache = false): Promise<void> => {
      const token = ++tokenRef.current
      setCargando(true)
      const { r, rechazada } = await pedirDescompilacion({
        path: file.path,
        motor,
        targetKey,
        token,
        ignorarCache
      })
      // Respuesta tardía de una petición anterior: se descarta. Que cambie el proyecto mientras
      // tanto no la invalida: el resultado sigue siendo de ESTE pane y queda listo al volver.
      if (token !== tokenRef.current) return
      setCargando(false)
      conFuenteRef.current = hayFuente(r)
      setResultado(r)
      if (rechazada) return
      setDetalleAbierto(false)
      mostrarFuente(editorRef.current, modelRef, r.fuente)
    },
    [file.path, targetKey]
  )

  useEffect(() => {
    // Solo el pane del proyecto ACTIVO pide; los demás cargan al volver a serlo.
    if (targetKey !== activeTargetKey) return
    // La firma evita redescompilar al regresar al proyecto (perdería scroll y detalle abierto);
    // el `fsTick` cubre recompilar el jar, que no cambia motor ni ruta.
    const firma = `${motorPedido}@${file.path}`
    if (pedidoRef.current !== firma) {
      pedidoRef.current = firma
      tickRef.current = fsTick
      void descompilar(motorPedido)
      return
    }
    // Con una petición en vuelo no se apila otra: se re-evalúa al terminar.
    if (cargando || tickRef.current === fsTick) return
    tickRef.current = fsTick
    // Un intento FALLIDO no se repite por un tick (relanzaría la JVM para fallar igual).
    if (!conFuenteRef.current) return
    void descompilar(motorPedido)
    // `motorPedido` a propósito: cambiar de motor vuelve a pedir.
  }, [descompilar, motorPedido, targetKey, activeTargetKey, file.path, fsTick, cargando])

  // El motor del reintento sale de lo PEDIDO, no de `resultado.motor` (null si el intento falló:
  // se ofrecería otra vez el que acaba de fallar y el botón no haría nada).
  const otroMotor = motorAlternativo(resultado, motorPedido)

  /** Reintenta con `motor`, forzando la recarga aunque sea el mismo valor de estado. */
  const reintentar = (motor: MotorDescompilador): void => {
    if (motor === motorPedido) void descompilar(motor, true)
    else setMotorPedido(motor)
  }

  return {
    hostRef, resultado, conFuente, cargando, detalleAbierto, setDetalleAbierto,
    otroMotor, reintentar, ...useAccionesJava(descompilar, motorPedido)
  }
}

/** Acciones largas de recuperación: cada una recarga la clase al terminar y deshabilita los botones. */
function useAccionesJava(
  descompilar: (motor: MotorPedido, ignorarCache?: boolean) => Promise<void>,
  motorPedido: MotorPedido
) {
  const [accionEnCurso, setAccionEnCurso] = useState<AccionLarga | null>(null)
  const conAccion = (nombre: AccionLarga, accion: () => Promise<unknown>): void => {
    setAccionEnCurso(nombre)
    void accion()
      .then(() => descompilar(motorPedido, true))
      .finally(() => setAccionEnCurso(null))
  }
  const redetectar = (): void => conAccion('redetectar', () => window.tessera.java.redetect())
  const elegirJava = (): void => conAccion('elegir', () => window.tessera.java.pickJava())
  return { accionEnCurso, redetectar, elegirJava }
}
