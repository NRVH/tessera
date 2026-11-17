// =============================================================================
// Conecta el modelo del editor de configuración con el main: carga los dos archivos y atiende
// guardar, sobrescribir, recargar y recuperar la versión anterior.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { refConfig, type RefConfigAgente, type TipoArchivoConfig } from '../../../../shared/configAgente-ipc'
import { normalizarErrorIpc } from '../../../../shared/erroresDocker'
import { ESTADO_INICIAL_CONFIG, reducirConfigAgente, sePuedeGuardar, type AccionConfigAgente, type EstadoConfigAgente } from './modeloConfigAgente.ts'

const mensaje = (err: unknown): string => normalizarErrorIpc(err instanceof Error ? err.message : String(err))

export interface ConfigAgenteEnEdicion {
  estado: EstadoConfigAgente
  guardando: boolean
  despachar: (accion: AccionConfigAgente) => void
  cargar: () => void
  guardar: (archivo: TipoArchivoConfig, opciones?: { sobrescribir?: boolean }) => void
  cargarDelArchivo: (archivo: TipoArchivoConfig) => void
  recuperarAnterior: (archivo: TipoArchivoConfig) => void
}

export function useConfigAgente(ref: RefConfigAgente): ConfigAgenteEnEdicion {
  const [estado, despachar] = useReducer(reducirConfigAgente, ESTADO_INICIAL_CONFIG)
  const [guardando, setGuardando] = useState(false)
  const ultimo = useRef(estado)
  ultimo.current = estado
  // Guardar con Ctrl+S mientras otro guardado sigue en curso compararía contra una versión ya vieja.
  const enCurso = useRef(false)
  // La referencia llega nueva en cada render: se rehace de sus partes, con la capa incluida, porque sin ella
  // el main entiende la carpeta nativa del agente.
  const { agente, cuentaId } = ref
  const capaTipo = ref.capa?.tipo ?? null
  const capaPerfil = ref.capa?.tipo === 'perfil' ? ref.capa.perfilId : null
  const destino = useMemo(() => refConfig(agente, cuentaId, capaTipo, capaPerfil), [agente, cuentaId, capaTipo, capaPerfil])

  const cargar = useCallback((): void => {
    despachar({ tipo: 'cargando' })
    window.tessera.configAgente
      .leer(destino)
      .then((config) => despachar({ tipo: 'cargado', config }))
      .catch((err: unknown) => despachar({ tipo: 'fallo-carga', detalle: mensaje(err) }))
  }, [destino])

  useEffect(cargar, [cargar])

  const guardar = useCallback(
    (archivo: TipoArchivoConfig, opciones?: { sobrescribir?: boolean }): void => {
      const actual = ultimo.current
      if (actual.fase !== 'lista' || enCurso.current) return
      // Ctrl+S llega aunque no haya nada que guardar: sin esto crearía un archivo vacío.
      if (!opciones?.sobrescribir && !sePuedeGuardar(actual.archivos[archivo])) return
      const { texto, leido } = actual.archivos[archivo]
      enCurso.current = true
      setGuardando(true)
      window.tessera.configAgente
        .guardar({ ref: destino, tipo: archivo, contenido: texto, versionLeida: leido.version, sobrescribir: opciones?.sobrescribir })
        .then((resultado) => despachar({ tipo: 'resultado', archivo, resultado }))
        .catch((err: unknown) => despachar({ tipo: 'fallo-guardar', archivo, detalle: mensaje(err) }))
        .finally(() => {
          enCurso.current = false
          setGuardando(false)
        })
    },
    [destino]
  )

  const cargarDelArchivo = useCallback(
    (archivo: TipoArchivoConfig): void => {
      window.tessera.configAgente
        .leer(destino)
        .then((config) => {
          if (config) despachar({ tipo: 'recargado', archivo, leido: config.archivos[archivo] })
          else despachar({ tipo: 'cargado', config: null })
        })
        .catch((err: unknown) => despachar({ tipo: 'fallo-guardar', archivo, detalle: mensaje(err) }))
    },
    [destino]
  )

  const recuperarAnterior = useCallback(
    (archivo: TipoArchivoConfig): void => {
      window.tessera.configAgente
        .leerAnterior(destino, archivo)
        .then((texto) => despachar({ tipo: 'anterior', archivo, texto }))
        .catch((err: unknown) => despachar({ tipo: 'fallo-guardar', archivo, detalle: mensaje(err) }))
    },
    [destino]
  )

  return { estado, guardando, despachar, cargar, guardar, cargarDelArchivo, recuperarAnterior }
}
