// =============================================================================
// El MODELO de Monaco de una consola SQL: es del hook (se crea al montar y se
// dispone al desmontar; el editor es del pane). Al desmontar se lee el texto
// pendiente ANTES de disponerlo y se cancela lo que siga en vuelo. También el
// lenguaje del modelo y su ruta del autocompletado. Pieza de `useConsola`.
// Decisiones: docs/decisiones/bd/ui-consola-motor.md
// =============================================================================

import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql'
import { ensureMonaco } from '../../../comun/monacoSetup'
import { registrarRutaConsola, uriConsola } from '../autocompletado/enrutadorConsolas'
import { nivelSelectorConsola } from '../nivelBasesBd'
import { lectoresAbiertos } from '../resultados/pestanasResultado'
import { soltarModelo, tomarModelo, vaciarAlDesmontar } from './archivoConsola'
import { esquemaEfectivo } from './esquemaConsola'
import { lenguajeConsola, registrarLenguajesConsola } from './lenguajeConsola'
import { MarcasLoteMonaco, ValidadorAvisos } from './monacoConsola'
import type { RefsConsola } from './tiposConsola'
import type { NucleoConsola } from './useConsolaNucleo'
import { porDefectoConsola } from './utilConsola'
import { cancelacionesDetener } from './vivoConsola'

interface Montado {
  m: editor.ITextModel
  clave: string
  marcas: MarcasLoteMonaco
  validador: ValidadorAvisos
  /** Los mapas «en vuelo» son el MISMO objeto toda la vida del hook: se toman al montar. */
  masEnVuelo: Map<string, string>
  conteosEnVuelo: Map<string, string>
}

/** «Más», «Contar» y lectores que ya no pintará nadie; y la pregunta abierta, cancelada. */
function soltarEnVuelo(n: NucleoConsola, v: Montado): void {
  const { r, api, perfilId, consolaId } = n
  // Se cancelan en el servidor ANTES de cerrar sus lectores: la sesión no queda ocupada.
  const mas = cancelacionesDetener({
    perfilId,
    consolaId,
    conexionId: r.conexionRef.current.id,
    ejecucionId: null,
    masEnVuelo: v.masEnVuelo.values(),
    conteosEnVuelo: v.conteosEnVuelo.values()
  })
  for (const c of mas) api.cancelar(c).catch(() => undefined)
  v.masEnVuelo.clear()
  v.conteosEnVuelo.clear()
  const lectores = lectoresAbiertos(r.estadoRef.current.resultados).concat(r.estadoRef.current.lectoresPorCerrar)
  for (const l of lectores) api.cerrarLector(l).catch(() => undefined)
  const d = r.dialogoRef.current
  if (d) {
    if (d.tipo === 'confirmar') d.resolver(false)
    else d.resolver(null)
  }
}

function desmontarModelo(n: NucleoConsola, v: Montado): void {
  const { r } = n
  r.desmontadoRef.current = true
  vaciarAlDesmontar(n, v.m)
  if (r.stopRef.current !== null) clearTimeout(r.stopRef.current)
  soltarEnVuelo(n, v)
  v.marcas.dispose()
  v.validador.dispose()
  r.marcasRef.current = null
  r.validadorRef.current = null
  r.modeloRef.current = null
  soltarModelo(v.clave, v.m)
  n.setModelo(null)
}

function montarModelo(n: NucleoConsola): () => void {
  const { r, api, consolaId } = n
  r.desmontadoRef.current = false
  const monaco = ensureMonaco()
  registrarLenguajesConsola(monaco)
  const uri = monaco.Uri.parse(uriConsola(consolaId))
  const clave = uri.toString()
  const previo = monaco.editor.getModel(uri)
  const m =
    previo && !previo.isDisposed() ? previo : monaco.editor.createModel('', lenguajeConsola(r.conexionRef.current.motor), uri)
  tomarModelo(clave)
  r.modeloRef.current = m
  r.cargadoRef.current = false
  r.guardadoRef.current = null
  r.borradaRef.current = false
  n.setModelo(m)
  n.setCargado(false)
  n.setErrorCarga(null)
  const marcas = new MarcasLoteMonaco(m)
  r.marcasRef.current = marcas
  const validador = new ValidadorAvisos(
    m,
    () => ({ dialecto: r.estadoRef.current.dialecto, soloLectura: r.soloLecturaRef.current }),
    (req) => api.validarSintaxis(req)
  )
  r.validadorRef.current = validador
  const v: Montado = {
    m,
    clave,
    marcas,
    validador,
    masEnVuelo: r.masEnVueloRef.current,
    conteosEnVuelo: r.conteosEnVueloRef.current
  }
  return () => desmontarModelo(n, v)
}

/** Ruta del autocompletado: el esquema y la base son FUNCIONES leídas al preguntar. */
function rutaAutocompletado(r: RefsConsola, consolaId: string, conexionId: string, alias: string, motor: DbConnection['motor']) {
  return {
    consolaId,
    conexionId,
    alias,
    dialecto: dialectoDeMotor(motor),
    // Lo del selector cuenta también ANTES de abrir la sesión; con sesión, manda la suya.
    esquema: () => {
      if (nivelSelectorConsola(r.conexionRef.current) !== 'esquema') return null
      return esquemaEfectivo(r.estadoRef.current.sesion, r.esquemaElegidoRef.current, null)
    },
    // Donde el selector elige bases, la base de la consola; con base fija, ninguna.
    base: () => {
      const c = r.conexionRef.current
      if (nivelSelectorConsola(c) !== 'base') return null
      return esquemaEfectivo(r.estadoRef.current.sesion, r.esquemaElegidoRef.current, porDefectoConsola(c))
    }
  }
}

/** Modelo, lenguaje y ruta del autocompletado de la consola (efectos en este orden). */
export function useModeloConsola(n: NucleoConsola, conexion: DbConnection): void {
  const { r, modelo, perfilId, consolaId } = n
  useEffect(
    () => montarModelo(n),
    // El modelo es de la CONSOLA: solo se rehace si cambia cuál es.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perfilId, consolaId]
  )

  // El lenguaje sigue al motor (y corrige un modelo que venía con otro).
  useEffect(() => {
    if (!modelo || modelo.isDisposed()) return
    const monaco = ensureMonaco()
    registrarLenguajesConsola(monaco)
    const lang = lenguajeConsola(conexion.motor)
    if (modelo.getLanguageId() !== lang) monaco.editor.setModelLanguage(modelo, lang)
    r.validadorRef.current?.programar()
  }, [modelo, conexion.motor, r])

  useEffect(() => {
    if (!modelo) return
    return registrarRutaConsola(
      modelo.uri.toString(),
      rutaAutocompletado(r, consolaId, conexion.id, conexion.alias, conexion.motor)
    )
  }, [modelo, consolaId, conexion.id, conexion.alias, conexion.motor, r])
}
