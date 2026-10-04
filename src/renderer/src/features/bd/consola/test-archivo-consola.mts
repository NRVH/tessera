#!/usr/bin/env node
// =============================================================================
// Prueba del protocolo de archivo de las tres consolas (`archivoConsola.ts`), de las preguntas
// de cierre de MongoDB y Redis (`documentos/cierreConsola.ts`) y del teclado de sus tablas:
// (node src/renderer/src/features/bd/consola/test-archivo-consola.mts)
// Con el modelo de texto REAL de monaco-editor (su parte `common` carga bajo `node`): la recarga
// no se funde con la última racha de tecleo, cuándo se lee y se escribe, y el conflicto.
// =============================================================================

import type { editor } from 'monaco-editor'
import type { DbConsolaTexto, DbEscrituraConsola, DbRespuesta } from '../../../../../shared/db-explorador-ipc.ts'
import {
  aplicarDisco,
  guardarArchivoConsola,
  leerArchivoConsola,
  lecturaPermitida,
  soltarModelo,
  tomarModelo,
  vaciaEnDisco,
  vaciarAlDesmontar,
  type LecturaArchivoConsola,
  type RefsArchivoConsola
} from './archivoConsola.ts'
import { confirmarCierre, preguntasDeCierre } from '../documentos/cierreConsola.ts'
import type { EnCurso, PeticionDialogo } from '../documentos/consolaComun.ts'
import { destinoTeclado } from '../documentos/ventanaVirtual.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Un modelo de texto de verdad, con su pila de deshacer, sin editor ni DOM. */
async function fabricaModelos(): Promise<(texto: string) => editor.ITextModel & { undo(): unknown; redo(): unknown; canUndo(): boolean }> {
  // Rutas internas sin tipos publicados: se cargan con un especificador calculado.
  const vs = 'monaco-editor/esm/vs/'
  const cargar = (ruta: string): Promise<any> => import(vs + ruta)
  const { TextModel } = await cargar('editor/common/model/textModel.js')
  const { UndoRedoService } = await cargar('platform/undoRedo/common/undoRedoService.js')
  const { LanguageService } = await cargar('editor/common/services/languageService.js')
  const { ILanguageService } = await cargar('editor/common/languages/language.js')
  const { LanguageConfigurationService, ILanguageConfigurationService } = await cargar('editor/common/languages/languageConfigurationRegistry.js')
  const { ITreeSitterParserService } = await cargar('editor/common/services/treeSitterParserService.js')
  const { InstantiationService } = await cargar('platform/instantiation/common/instantiationService.js')
  const { ServiceCollection } = await cargar('platform/instantiation/common/serviceCollection.js')
  const sinSuscripcion = (): { dispose(): void } => ({ dispose() {} })
  const deshacer = new UndoRedoService({}, {})
  const lenguajes = new LanguageService()
  const configuracion = new LanguageConfigurationService({ getValue: () => undefined, onDidChangeConfiguration: sinSuscripcion }, lenguajes)
  const servicios = new ServiceCollection()
  servicios.set(ILanguageService, lenguajes)
  servicios.set(ILanguageConfigurationService, configuracion)
  servicios.set(ITreeSitterParserService, { getOrInitLanguage: () => undefined, onDidAddLanguage: sinSuscripcion, onDidUpdateTree: sinSuscripcion })
  const instancias = new InstantiationService(servicios)
  return (texto) => new TextModel(texto, 'plaintext', TextModel.DEFAULT_CREATION_OPTIONS, null, deshacer, lenguajes, configuracion, instancias)
}

/** Teclear sin cerrar el elemento de deshacer, como hace el editor en una racha. */
function teclear(m: editor.ITextModel, texto: string): void {
  const fin = m.getFullModelRange()
  const pos = { startLineNumber: fin.endLineNumber, startColumn: fin.endColumn, endLineNumber: fin.endLineNumber, endColumn: fin.endColumn }
  m.pushEditOperations([], [{ range: pos, text: texto }], () => null)
}

function refs(): { aplicandoDiscoRef: { current: boolean }; guardadoRef: { current: string | null } } {
  return { aplicandoDiscoRef: { current: false }, guardadoRef: { current: null } }
}

type FabricaModelos = Awaited<ReturnType<typeof fabricaModelos>>

function refsArchivo(m: editor.ITextModel | null): RefsArchivoConsola {
  return {
    modeloRef: { current: m },
    cargadoRef: { current: false },
    guardadoRef: { current: null },
    conflictoRef: { current: null },
    escrituraRef: { current: null },
    temporizadorRef: { current: null },
    errorGuardadoRef: { current: null },
    aplicandoDiscoRef: { current: false },
    leyendoRef: { current: false },
    borradaRef: { current: false }
  }
}

/** Un disco falso: lo escrito, y lo que responderán la próxima lectura y la próxima escritura. */
interface DiscoFalso {
  escritos: string[]
  leer: () => DbRespuesta<DbConsolaTexto>
  escribir: (texto: string) => DbRespuesta<DbEscrituraConsola>
}

function consolaFalsa(m: editor.ITextModel | null, disco: DiscoFalso) {
  const avisos: string[] = []
  const conflictos: Array<{ texto: string } | null> = []
  const errores: Array<string | null> = []
  let cargas = 0
  const r = refsArchivo(m)
  const a: LecturaArchivoConsola = {
    r,
    api: {
      leerConsola: async () => disco.leer(),
      escribirConsola: async (_p, _c, texto) => {
        disco.escritos.push(texto)
        return disco.escribir(texto)
      }
    },
    perfilId: 'p',
    consolaId: 'c',
    cambiarConflicto: (c) => {
      r.conflictoRef.current = c
      conflictos.push(c)
    },
    avisar: (t) => avisos.push(t),
    ejecutando: () => false,
    setCargado: () => undefined,
    setErrorCarga: (e) => errores.push(e),
    alCargar: () => {
      cargas++
    }
  }
  return { a, r, avisos, conflictos, errores, cargas: () => cargas }
}

const ok = <T,>(valor: T): DbRespuesta<T> => ({ ok: true, valor })
const falla = <T,>(mensaje: string): DbRespuesta<T> => ({ ok: false, error: { motivo: 'interno', mensaje } })

async function probarGuardado(nuevoModelo: FabricaModelos): Promise<void> {
  hr('Guardar el archivo')
  {
    const m = nuevoModelo('uno')
    const disco: DiscoFalso = { escritos: [], leer: () => ok({ texto: '', version: '1' }), escribir: () => ok({ ok: true, version: '2' }) }
    const c = consolaFalsa(m, disco)
    await guardarArchivoConsola(c.a)
    check('antes de la primera lectura no se escribe nada', disco.escritos.length === 0, JSON.stringify(disco.escritos))
    c.r.cargadoRef.current = true
    await guardarArchivoConsola(c.a)
    check('cargada: escribe el texto', JSON.stringify(disco.escritos) === '["uno"]', JSON.stringify(disco.escritos))
    check('guardadoRef = lo escrito', c.r.guardadoRef.current === 'uno', String(c.r.guardadoRef.current))
    await guardarArchivoConsola(c.a)
    check('el mismo texto no se reescribe', disco.escritos.length === 1, String(disco.escritos.length))
    await guardarArchivoConsola(c.a, true)
    check('forzar reescribe aunque sea el mismo', disco.escritos.length === 2, String(disco.escritos.length))
    c.r.borradaRef.current = true
    m.setValue('dos')
    await guardarArchivoConsola(c.a)
    check('borrada: no escribe', disco.escritos.length === 2, String(disco.escritos.length))
  }
  {
    const m = nuevoModelo('mío')
    const disco: DiscoFalso = {
      escritos: [],
      leer: () => ok({ texto: '', version: '1' }),
      escribir: () => ok({ ok: false, conflicto: true, texto: 'del agente', version: '3' })
    }
    const c = consolaFalsa(m, disco)
    c.r.cargadoRef.current = true
    await guardarArchivoConsola(c.a)
    check('el main rechaza: se abre el conflicto con lo del disco', c.r.conflictoRef.current?.texto === 'del agente', JSON.stringify(c.conflictos))
    check('lo del disco cuenta como leído', c.r.guardadoRef.current === 'del agente', String(c.r.guardadoRef.current))
    m.setValue('mío 2')
    await guardarArchivoConsola(c.a)
    check('con el conflicto abierto el guardado se congela', disco.escritos.length === 1, String(disco.escritos.length))
    disco.escribir = () => ok({ ok: true, version: '4' })
    await guardarArchivoConsola(c.a, true)
    check('«Conservar la mía» (forzar) escribe', disco.escritos.at(-1) === 'mío 2', JSON.stringify(disco.escritos))
  }
  {
    const m = nuevoModelo('a\r\nb')
    const disco: DiscoFalso = {
      escritos: [],
      leer: () => ok({ texto: '', version: '1' }),
      escribir: () => ok({ ok: false, conflicto: true, texto: 'a\nb', version: '3' })
    }
    const c = consolaFalsa(m, disco)
    c.r.cargadoRef.current = true
    await guardarArchivoConsola(c.a)
    check('rechazo con el mismo texto salvo el EOL: sin conflicto', c.conflictos.length === 0, JSON.stringify(c.conflictos))
  }
  {
    const m = nuevoModelo('x')
    const disco: DiscoFalso = { escritos: [], leer: () => ok({ texto: '', version: '1' }), escribir: () => falla('disco lleno') }
    const c = consolaFalsa(m, disco)
    c.r.cargadoRef.current = true
    await guardarArchivoConsola(c.a)
    m.setValue('xy')
    await guardarArchivoConsola(c.a)
    check('el mismo error se avisa una sola vez', c.avisos.length === 1 && c.avisos[0].startsWith('No se pudo guardar la consola: '), JSON.stringify(c.avisos))
  }
  {
    const m = nuevoModelo('1')
    let soltar: () => void = () => undefined
    const disco: DiscoFalso = { escritos: [], leer: () => ok({ texto: '', version: '1' }), escribir: () => ok({ ok: true, version: '2' }) }
    const c = consolaFalsa(m, disco)
    c.r.cargadoRef.current = true
    const original = c.a.api.escribirConsola
    let enVuelo = 0
    let maxEnVuelo = 0
    c.a.api = {
      ...c.a.api,
      escribirConsola: async (p, id, t) => {
        enVuelo++
        maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
        await new Promise<void>((res) => (soltar = res))
        enVuelo--
        return original(p, id, t)
      }
    }
    const primera = guardarArchivoConsola(c.a)
    m.setValue('12')
    const segunda = guardarArchivoConsola(c.a)
    await new Promise((res) => setTimeout(res, 0))
    soltar()
    await new Promise((res) => setTimeout(res, 0))
    soltar()
    await Promise.all([primera, segunda])
    check('una escritura a la vez, y la segunda lleva lo último', maxEnVuelo === 1 && JSON.stringify(disco.escritos) === '["1","12"]', `${maxEnVuelo} ${JSON.stringify(disco.escritos)}`)
  }
}

async function probarLectura(nuevoModelo: FabricaModelos): Promise<void> {
  hr('Leer el archivo')
  {
    const m = nuevoModelo('')
    const disco: DiscoFalso = { escritos: [], leer: () => ok({ texto: 'del disco', version: '1' }), escribir: () => ok({ ok: true, version: '2' }) }
    const c = consolaFalsa(m, disco)
    await leerArchivoConsola(c.a)
    check('primera lectura: el texto del disco, sin deshacer', m.getValue() === 'del disco' && !m.canUndo(), JSON.stringify(m.getValue()))
    check('primera lectura: cargada y avisa una vez', c.r.cargadoRef.current && c.cargas() === 1, String(c.cargas()))
    disco.leer = () => ok({ texto: 'del agente', version: '2' })
    await leerArchivoConsola(c.a)
    check('sin cambios míos: recarga lo del agente', m.getValue() === 'del agente', JSON.stringify(m.getValue()))
    await m.undo()
    check('la recarga se deshace con Ctrl+Z', m.getValue() === 'del disco', JSON.stringify(m.getValue()))
    await m.redo()
    teclear(m, ' y lo mío')
    disco.leer = () => ok({ texto: 'del agente', version: '2' })
    await leerArchivoConsola(c.a)
    check('lo del disco es lo mío ya guardado: no toca lo tecleado', m.getValue() === 'del agente y lo mío' && c.conflictos.length === 0, JSON.stringify(m.getValue()))
    disco.leer = () => ok({ texto: 'otra cosa', version: '3' })
    await leerArchivoConsola(c.a)
    check('cambiaron los dos: conflicto, y el editor se queda como está', c.r.conflictoRef.current?.texto === 'otra cosa' && m.getValue() === 'del agente y lo mío', JSON.stringify(c.conflictos))
    disco.leer = () => ok({ texto: 'tercera', version: '4' })
    await leerArchivoConsola(c.a)
    check('con el conflicto abierto no se vuelve a leer', c.conflictos.length === 1, String(c.conflictos.length))
  }
  {
    const m = nuevoModelo('')
    const disco: DiscoFalso = { escritos: [], leer: () => falla('sin permiso'), escribir: () => ok({ ok: true, version: '2' }) }
    const c = consolaFalsa(m, disco)
    await leerArchivoConsola(c.a)
    check('falla la primera: error de carga, no un aviso', c.errores.at(-1) === 'sin permiso' && c.avisos.length === 0, JSON.stringify(c.errores))
    check('falla la primera: sigue sin cargar', !c.r.cargadoRef.current, String(c.r.cargadoRef.current))
    c.r.cargadoRef.current = true
    await leerArchivoConsola(c.a)
    check('falla una relectura: aviso', c.avisos.length === 1 && c.avisos[0].startsWith('No se pudo leer la consola: '), JSON.stringify(c.avisos))
  }
  {
    const m = nuevoModelo('mío')
    const disco: DiscoFalso = { escritos: [], leer: () => ok({ texto: 'del agente', version: '1' }), escribir: () => ok({ ok: true, version: '2' }) }
    const c = consolaFalsa(m, disco)
    c.r.cargadoRef.current = true
    c.r.guardadoRef.current = 'mío'
    c.a.ejecutando = () => true
    await leerArchivoConsola(c.a)
    check('con algo ejecutándose no se relee', m.getValue() === 'mío', JSON.stringify(m.getValue()))
  }
}

function probarDesmontaje(nuevoModelo: FabricaModelos): void {
  hr('Desmontar y cerrar')
  {
    const m = nuevoModelo('último')
    const disco: DiscoFalso = { escritos: [], leer: () => ok({ texto: '', version: '1' }), escribir: () => ok({ ok: true, version: '2' }) }
    const c = consolaFalsa(m, disco)
    c.r.cargadoRef.current = true
    c.r.guardadoRef.current = 'anterior'
    c.r.temporizadorRef.current = setTimeout(() => undefined, 60_000)
    vaciarAlDesmontar(c.a, m)
    check('el último tecleo se escribe al desmontar', JSON.stringify(disco.escritos) === '["último"]', JSON.stringify(disco.escritos))
    check('y el guardado programado se cancela', c.r.temporizadorRef.current === null, String(c.r.temporizadorRef.current))
    c.r.conflictoRef.current = { texto: 'del agente' }
    m.setValue('otro')
    vaciarAlDesmontar(c.a, m)
    check('con un conflicto no se escribe', disco.escritos.length === 1, String(disco.escritos.length))
    check('con un conflicto no está vacía en disco', !vaciaEnDisco(c.r), 'false')
    c.r.conflictoRef.current = null
    m.setValue('  \n')
    check('solo blancos y sin conflicto: vacía en disco', vaciaEnDisco(c.r), 'true')
  }
  {
    const m = nuevoModelo('x')
    tomarModelo('uri:a')
    tomarModelo('uri:a')
    soltarModelo('uri:a', m)
    check('el modelo sigue vivo mientras otro montaje lo usa', !m.isDisposed(), String(m.isDisposed()))
    soltarModelo('uri:a', m)
    check('el último montaje en irse lo dispone', m.isDisposed(), String(m.isDisposed()))
  }
}

async function main(): Promise<void> {
  const nuevoModelo = await fabricaModelos()

  hr('Recarga del disco tras teclear')
  {
    const m = nuevoModelo('abc ')
    const r = refs()
    teclear(m, 'xyz')
    aplicarDisco(r, m, 'TEXTO DEL AGENTE', false)
    check('la recarga deja el texto del disco', m.getValue() === 'TEXTO DEL AGENTE', JSON.stringify(m.getValue()))
    check('guardadoRef = lo del disco', r.guardadoRef.current === 'TEXTO DEL AGENTE', String(r.guardadoRef.current))
    await m.undo()
    check('Ctrl+Z vuelve a TU texto, con la racha que no llegó al disco', m.getValue() === 'abc xyz', JSON.stringify(m.getValue()))
    await m.undo()
    check('otro Ctrl+Z deshace la racha', m.getValue() === 'abc ', JSON.stringify(m.getValue()))
    await m.redo()
    await m.redo()
    check('rehacer vuelve al texto del disco', m.getValue() === 'TEXTO DEL AGENTE', JSON.stringify(m.getValue()))
  }

  hr('Recarga con el mismo texto')
  {
    const m = nuevoModelo('abc ')
    const r = refs()
    teclear(m, 'xyz')
    const version = m.getAlternativeVersionId()
    aplicarDisco(r, m, 'abc xyz', false)
    check('no toca el modelo', m.getAlternativeVersionId() === version, `${version} -> ${m.getAlternativeVersionId()}`)
    check('guardadoRef = lo del disco', r.guardadoRef.current === 'abc xyz', String(r.guardadoRef.current))
    await m.undo()
    check('Ctrl+Z deshace la racha, sin un paso vacío', m.getValue() === 'abc ', JSON.stringify(m.getValue()))
  }

  hr('Primera carga y bandera de aplicación')
  {
    const m = nuevoModelo('')
    const r = refs()
    const vistas: boolean[] = []
    m.onDidChangeContent(() => vistas.push(r.aplicandoDiscoRef.current))
    aplicarDisco(r, m, 'db.c.find()', true)
    check('primera: el texto del disco', m.getValue() === 'db.c.find()', JSON.stringify(m.getValue()))
    check('primera: nada que deshacer', !m.canUndo(), String(m.canUndo()))
    aplicarDisco(r, m, 'db.c.count()', false)
    check('el cambio se ve con la bandera puesta', vistas.length === 2 && vistas.every(Boolean), JSON.stringify(vistas))
    check('la bandera se baja al terminar', !r.aplicandoDiscoRef.current, String(r.aplicandoDiscoRef.current))
  }

  hr('Cuándo se puede leer el disco')
  {
    const m = nuevoModelo('x')
    const base = () => ({
      leyendoRef: { current: false },
      borradaRef: { current: false },
      escrituraRef: { current: null as Promise<void> | null },
      conflictoRef: { current: null as { texto: string } | null }
    })
    check('libre: sí', lecturaPermitida(base(), m, false, false), 'true')
    check('sin modelo: no', !lecturaPermitida(base(), null, true, false), 'false')
    check('leyendo ya: no, ni la primera', !lecturaPermitida({ ...base(), leyendoRef: { current: true } }, m, true, false), 'false')
    check('borrada: no, ni la primera', !lecturaPermitida({ ...base(), borradaRef: { current: true } }, m, true, false), 'false')
    check('con una ejecución: no', !lecturaPermitida(base(), m, false, true), 'false')
    check('con una escritura en vuelo: no', !lecturaPermitida({ ...base(), escrituraRef: { current: Promise.resolve() } }, m, false, false), 'false')
    check('con un conflicto: no', !lecturaPermitida({ ...base(), conflictoRef: { current: { texto: 'y' } } }, m, false, false), 'false')
    check('la primera lectura sí, aunque corra algo', lecturaPermitida(base(), m, true, true), 'true')
    m.dispose()
    check('modelo dispuesto: no', !lecturaPermitida(base(), m, true, false), 'false')
  }

  await probarGuardado(nuevoModelo)
  await probarLectura(nuevoModelo)
  probarDesmontaje(nuevoModelo)

  hr('Las preguntas previas al cierre')
  {
    const corriendo: EnCurso = { id: 1, total: 1, indice: 0, inicio: 0, peticionId: 'p' }
    const estado = (enCurso: EnCurso | null, conflicto: { texto: string } | null, respuestas: boolean[]) => {
      const preguntas: string[] = []
      const e = {
        pedirConfirmacion: async (d: PeticionDialogo) => {
          preguntas.push(d.titulo)
          return respuestas.shift() ?? false
        },
        dialogoRef: { current: null },
        consolaRef: { current: { nombre: 'c.mongo' } },
        enCursoRef: { current: enCurso },
        conflictoRef: { current: conflicto }
      }
      return { e, preguntas }
    }
    check('nada corre ni hay conflicto: ninguna', preguntasDeCierre(estado(null, null, []).e).length === 0, '[]')
    check('corre algo: detener', JSON.stringify(preguntasDeCierre(estado(corriendo, null, []).e)) === '["detener"]', 'detener')
    check('conflicto: conflicto', JSON.stringify(preguntasDeCierre(estado(null, { texto: 'y' }, []).e)) === '["conflicto"]', 'conflicto')

    const libre = estado(null, null, [])
    check('sin preguntas, confirmarCierre no pregunta y deja cerrar', (await confirmarCierre(libre.e, () => undefined)) && libre.preguntas.length === 0, JSON.stringify(libre.preguntas))
    const conConflicto = estado(null, { texto: 'y' }, [false])
    const cerro = await confirmarCierre(conConflicto.e, () => undefined)
    check('con conflicto pregunta, y un «no» no cierra', !cerro && JSON.stringify(conConflicto.preguntas) === '["El archivo cambió fuera de Tessera"]', JSON.stringify(conConflicto.preguntas))
    const detenido = estado(corriendo, null, [true])
    let detuvo = false
    const cierra = await confirmarCierre(detenido.e, () => {
      detuvo = true
      detenido.e.enCursoRef.current = null
    })
    check('corriendo: «¿Detener y cerrar?», detiene y cierra', cierra && detuvo && JSON.stringify(detenido.preguntas) === '["¿Detener y cerrar?"]', JSON.stringify(detenido.preguntas))
  }

  hr('Teclado de las tablas de documentos y claves')
  {
    check('↓ sin selección: la primera', destinoTeclado('ArrowDown', null, 10, 5) === 0, '0')
    check('↓ en la última: se queda', destinoTeclado('ArrowDown', 9, 10, 5) === 9, '9')
    check('↑ en la primera: se queda', destinoTeclado('ArrowUp', 0, 10, 5) === 0, '0')
    check('Av Pág: una página menos una fila', destinoTeclado('PageDown', 2, 10, 5) === 6, String(destinoTeclado('PageDown', 2, 10, 5)))
    check('Av Pág al final: la última', destinoTeclado('PageDown', 8, 10, 5) === 9, '9')
    check('Re Pág al principio: la primera', destinoTeclado('PageUp', 1, 10, 5) === 0, '0')
    check('página de 1 fila: avanza de una en una', destinoTeclado('PageDown', 3, 10, 1) === 4, '4')
    check('Inicio y Fin', destinoTeclado('Home', 5, 10, 5) === 0 && destinoTeclado('End', 5, 10, 5) === 9, '0/9')
    check('otra tecla no mueve', destinoTeclado('a', 5, 10, 5) === null, 'null')
  }

  const total = results.length
  const passed = results.filter((x) => x.pass).length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
