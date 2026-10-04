#!/usr/bin/env node
// =============================================================================
// Prueba de exportar a archivo (`exportacion.ts`) con un diálogo y un productor falsos, contra una carpeta temporal real:
// formatos, diálogo, cancelación en cada tramo, temporal y renombrado, y errores de disco sin ruta.
// (node src/main/db/explorador/test-exportacion.mts  ·  npm run test:db-exportacion)
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DbColumnaResultado, DbFormatoFilas, DbProgresoExportacion } from '../../../shared/db-explorador-ipc.ts'
import { crearEscritor } from '../../../shared/formatosFilas.ts'
import {
  Exportador,
  filasDePagina,
  mensajeFsExportacion,
  type OpcionesDialogoGuardar,
  type PaginaExportacion,
  type ProductorExportacion
} from './exportacion.ts'
import { ErrorGestor } from './GestorSesiones.ts'

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

const COLUMNAS: DbColumnaResultado[] = [
  { nombre: 'id', tipoLogico: 'numero', tipoMotor: 'int4' },
  { nombre: 'nombre', tipoLogico: 'texto', tipoMotor: 'text' },
  { nombre: 'foto', tipoLogico: 'binario', tipoMotor: 'bytea' }
]
const PAGINA1 = [
  ['1', 'Ana, "la" de|Sevilla', '0x0A0B'],
  ['2', 'Ñandú 😀\nsegunda línea', null]
]
const PAGINA2 = [['3', null, '0xFF']]

function productor(paginas: unknown[][][], extra: Partial<PaginaExportacion> = {}): ProductorExportacion {
  return async (consumir) => {
    for (const p of paginas) await consumir({ columnas: COLUMNAS, filasJson: JSON.stringify(p), ...extra })
  }
}

async function error(fn: () => Promise<unknown>): Promise<ErrorGestor | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return e instanceof ErrorGestor ? e : new ErrorGestor('interno', `NO ES ErrorGestor: ${String(e)}`)
  }
}

async function main(): Promise<void> {
  const base = mkdtempSync(path.join(os.tmpdir(), 'tessera-exportar-'))
  const descargas = path.join(base, 'Descargas')
  const otra = path.join(base, 'otra')
  mkdirSync(descargas)
  mkdirSync(otra)
  const dialogos: OpcionesDialogoGuardar[] = []
  // Como el envoltorio de la app: toma el NOMBRE propuesto y pone SU carpeta.
  let carpetaDialogo = descargas
  const aceptar = (op: OpcionesDialogoGuardar): string => path.join(carpetaDialogo, op.nombrePropuesto)
  let respuesta: (op: OpcionesDialogoGuardar) => string | null = aceptar
  const progreso: DbProgresoExportacion[] = []
  const revelados: string[] = []
  let reloj = 0
  const ex = new Exportador({
    guardar: async (op) => {
      dialogos.push(op)
      return respuesta(op)
    },
    revelar: (ruta) => revelados.push(ruta),
    emitirProgreso: (p) => progreso.push(p),
    plataforma: 'windows',
    ahora: () => reloj
  })
  let n = 0
  const pid = (): string => `exp-${++n}`
  const restos = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith('.part'))

  try {
    hr('(1) Los cinco formatos, idénticos a «Copiar como» salvo BOM y salto final')
    for (const formato of ['csv', 'tsv', 'json', 'insert', 'markdown'] as DbFormatoFilas[]) {
      const r = await ex.exportar({ peticionId: pid(), formato, nombreSugerido: 'public.cliente', motor: 'postgres', tablaInsert: 'public.cliente', producir: productor([PAGINA1, PAGINA2]) })
      const ruta = path.join(descargas, r?.archivo ?? '?')
      const escrito = existsSync(ruta) ? readFileSync(ruta, 'utf8') : ''
      const e = crearEscritor(formato, COLUMNAS, {
        motor: 'postgres',
        tablaInsert: 'public.cliente',
        cabecera: true,
        bom: formato === 'csv',
        saltoFinal: formato === 'csv' || formato === 'tsv'
      })
      const esperado = e.inicio() + e.filas(PAGINA1 as never) + e.filas(PAGINA2 as never) + e.fin()
      check(
        `${formato}: el archivo es lo que da crearEscritor por trozos (${r?.filas} filas, ${r?.bytes} bytes)`,
        r !== null && escrito === esperado && r.filas === 3 && r.bytes === Buffer.byteLength(esperado, 'utf8') && r.archivo === `public.cliente.${formato === 'insert' ? 'sql' : formato === 'markdown' ? 'md' : formato}`,
        JSON.stringify(r)
      )
    }
    const csv = readFileSync(path.join(descargas, 'public.cliente.csv'), 'utf8')
    check('CSV con BOM y salto final; TSV con salto final', csv.charCodeAt(0) === 0xfeff && csv.endsWith('\r\n') && readFileSync(path.join(descargas, 'public.cliente.tsv'), 'utf8').endsWith('\n'), JSON.stringify(csv.slice(0, 12)))
    check('sin temporales en la carpeta', restos(descargas).length === 0, readdirSync(descargas).join(','))

    hr('(2) El diálogo')
    const d0 = dialogos[0]
    check('propone el nombre saneado con su extensión, filtro y título', d0.nombrePropuesto === 'public.cliente.csv' && d0.filtros[0].extensions[0] === 'csv' && /CSV/.test(d0.titulo), JSON.stringify(d0))
    check(
      'y SOLO el nombre, sin carpeta: la carpeta no es cosa del exportador',
      dialogos.every((d) => path.basename(d.nombrePropuesto) === d.nombrePropuesto && !/[\\/]/.test(d.nombrePropuesto)) && !('rutaPropuesta' in d0),
      dialogos.map((d) => d.nombrePropuesto).join(', ')
    )
    respuesta = () => null
    const cancelado = await ex.exportar({ peticionId: pid(), formato: 'json', nombreSugerido: 'x', motor: 'postgres', producir: productor([PAGINA1]) })
    check('cancelar el diálogo -> null y nada escrito', cancelado === null && !existsSync(path.join(descargas, 'x.json')), String(cancelado))
    respuesta = () => path.join(otra, 'sin_extension')
    const sinExt = await ex.exportar({ peticionId: pid(), formato: 'json', nombreSugerido: '"Mi/Tabla":x', motor: 'postgres', producir: productor([PAGINA1]) })
    check('sin extensión se le pone la del formato', sinExt?.archivo === 'sin_extension.json' && existsSync(path.join(otra, 'sin_extension.json')), JSON.stringify(sinExt))
    const propuesta = dialogos[dialogos.length - 1].nombrePropuesto
    check('un identificador citado con / : " se sanea', propuesta === '_Mi_Tabla__x.json', propuesta)
    // A partir de aquí, el «envoltorio» falso escribe en la otra carpeta.
    carpetaDialogo = otra
    respuesta = aceptar

    hr('(3) Stop a media exportación')
    const idStop = pid()
    let leidas = 0
    const parar: ProductorExportacion = async (consumir, cancelada) => {
      for (let i = 0; i < 10; i++) {
        if (cancelada()) throw new ErrorGestor('cancelada', 'Exportación cancelada.')
        await consumir({ columnas: COLUMNAS, filasJson: JSON.stringify(PAGINA1) })
        leidas++
        if (i === 1) ex.cancelar(idStop)
      }
    }
    const eStop = await error(() => ex.exportar({ peticionId: idStop, formato: 'csv', nombreSugerido: 'parada', motor: 'postgres', producir: parar }))
    check('responde cancelada, a mitad (no leyó las 10 páginas)', eStop?.error.motivo === 'cancelada' && leidas === 2, `${eStop?.error.motivo} tras ${leidas}`)
    check('sin archivo ni temporal', !existsSync(path.join(otra, 'parada.csv')) && restos(otra).length === 0, readdirSync(otra).join(','))
    check('cancelar un id que no está en curso no hace nada', ex.cancelar('no-existe') === false && !ex.enMarcha(idStop), 'false')

    hr('(4) Fallos: del productor y del disco')
    const eProd = await error(() =>
      ex.exportar({
        peticionId: pid(),
        formato: 'csv',
        nombreSugerido: 'rota',
        motor: 'postgres',
        producir: async (consumir) => {
          await consumir({ columnas: COLUMNAS, filasJson: JSON.stringify(PAGINA1) })
          throw new ErrorGestor('servidor', 'ORA-00942: table or view does not exist')
        }
      })
    )
    check('el error del servidor sale tal cual, sin archivo ni temporal', eProd?.error.motivo === 'servidor' && !existsSync(path.join(otra, 'rota.csv')) && restos(otra).length === 0, `${eProd?.error.mensaje}`)
    respuesta = () => path.join(base, 'no', 'existe', 'x.csv')
    const eDisco = await error(() => ex.exportar({ peticionId: pid(), formato: 'csv', nombreSugerido: 'x', motor: 'postgres', producir: productor([PAGINA1]) }))
    check('carpeta que no existe: mensaje sin la ruta del host', eDisco !== null && !eDisco.message.includes(base) && /no existe/.test(eDisco.message), `${eDisco?.message}`)
    check('mensajeFsExportacion nunca lleva la ruta', !mensajeFsExportacion({ code: 'EPERM', message: `EPERM ${base}` }).includes(base) && /\(EXDEV\)/.test(mensajeFsExportacion({ code: 'EXDEV' })), mensajeFsExportacion({ code: 'EBUSY' }))
    const eFilas = await error(async () => filasDePagina('{"no":"es un array"}'))
    check('filasJson que no es un array de filas: rechazado', eFilas?.error.motivo === 'interno', `${eFilas?.message}`)
    respuesta = aceptar

    hr('(5) Progreso')
    progreso.length = 0
    reloj = 1000
    const idProg = pid()
    await ex.exportar({
      peticionId: idProg,
      formato: 'json',
      nombreSugerido: 'progreso',
      motor: 'postgres',
      producir: async (consumir) => {
        for (const t of [1000, 1100, 1200, 1300, 1600]) {
          reloj = t
          await consumir({ columnas: COLUMNAS, filasJson: JSON.stringify(PAGINA1) })
        }
      }
    })
    check(
      'el primero con la primera página (sin esperar), después como mucho cada 250 ms',
      JSON.stringify(progreso.map((p) => p.filas)) === '[2,8,10]' && progreso.every((p) => p.peticionId === idProg),
      JSON.stringify(progreso)
    )

    hr('(6) «Mostrar en la carpeta» por token')
    const ultimo = await ex.exportar({ peticionId: pid(), formato: 'csv', nombreSugerido: 'revelar', motor: 'postgres', producir: productor([PAGINA1]) })
    ex.revelar(ultimo?.token ?? '')
    check('revela la ruta de ESA exportación', revelados[revelados.length - 1] === path.join(otra, 'revelar.csv'), revelados[revelados.length - 1] ?? '')
    const primero = ultimo?.token ?? ''
    for (let i = 0; i < 20; i++) {
      await ex.exportar({ peticionId: pid(), formato: 'csv', nombreSugerido: `r${i}`, motor: 'postgres', producir: productor([PAGINA1]) })
    }
    const antes = revelados.length
    ex.revelar(primero)
    ex.revelar('inventado')
    check('solo se recuerdan las últimas 20: un token viejo o inventado no hace nada', revelados.length === antes, `${revelados.length - antes} revelados`)

    hr('(7) recortadas, aviso y nombre sin ruta')
    const r7 = await ex.exportar({
      peticionId: pid(),
      formato: 'csv',
      nombreSugerido: 'avisos',
      motor: 'postgres',
      producir: async (consumir) => {
        await consumir({ columnas: COLUMNAS, filasJson: JSON.stringify(PAGINA1), recortes: [[0, 1, 99999999], [1, 1, 99999999]] })
        return { aviso: 'sin orden estable' }
      }
    })
    check('recortadas cuenta las celdas recortadas y el aviso llega', r7?.recortadas === 2 && r7.aviso === 'sin orden estable', JSON.stringify(r7))
    check('archivo es solo el nombre: nunca una ruta', r7 !== null && !r7.archivo.includes(path.sep) && !r7.archivo.includes('/'), `${r7?.archivo}`)
    const sinNada = await ex.exportar({ peticionId: pid(), formato: 'csv', nombreSugerido: 'limpio', motor: 'postgres', producir: productor([PAGINA1]) })
    check('sin recortes ni aviso: sin esos campos', sinNada !== null && !('recortadas' in sinNada) && !('aviso' in sinNada), JSON.stringify(sinNada))

    hr('(8) el Stop vale en TODO el camino (preparando y con el diálogo abierto)')
    // `preparar` es lo que hace el controlador ANTES del diálogo: leer del catálogo la PK
    // o el sinónimo. Aquí, una lectura que no acaba hasta que el test la suelta.
    let soltar: () => void = () => undefined
    const catalogo = new Promise<void>((r) => {
      soltar = r
    })
    const idPrep = pid()
    const dialogosAntes = dialogos.length
    const vistoEnPreparar = { cancelada: false }
    const enPrep = error(() =>
      ex.exportar({
        peticionId: idPrep,
        formato: 'csv',
        nombreSugerido: 'preparando',
        motor: 'postgres',
        preparar: async (cancelada) => {
          await catalogo
          vistoEnPreparar.cancelada = cancelada()
          return productor([PAGINA1])
        }
      })
    )
    const apuntada = ex.enMarcha(idPrep)
    const otraIgual = await error(() => ex.exportar({ peticionId: idPrep, formato: 'csv', nombreSugerido: 'x', motor: 'postgres', producir: productor([PAGINA1]) }))
    const parada = ex.cancelar(idPrep) // el Stop de la pestaña al desmontarse
    soltar()
    const ePrep = await enPrep
    check(
      'la exportación está apuntada DESDE LA PETICIÓN: el Stop mientras se lee el catálogo la encuentra',
      apuntada && parada && vistoEnPreparar.cancelada,
      `apuntada=${apuntada} cancelar()=${parada} preparar vio cancelada=${vistoEnPreparar.cancelada}`
    )
    check(
      '… y responde cancelada SIN abrir el diálogo de guardar ni escribir nada',
      ePrep?.error.motivo === 'cancelada' && dialogos.length === dialogosAntes && !existsSync(path.join(otra, 'preparando.csv')) && restos(otra).length === 0,
      `${ePrep?.error.motivo} · diálogos abiertos=${dialogos.length - dialogosAntes}`
    )
    check(
      'otra petición con el mismo id MIENTRAS se prepara: ocupada (antes pasaba, porque aún no estaba apuntada)',
      otraIgual?.error.motivo === 'ocupada' && !ex.enMarcha(idPrep),
      `${otraIgual?.error.motivo} · sigue en marcha=${ex.enMarcha(idPrep)}`
    )
    const idDialogo = pid()
    respuesta = (op) => {
      ex.cancelar(idDialogo) // la pestaña se cierra con el diálogo abierto
      return path.join(otra, op.nombrePropuesto)
    }
    const eDialogo = await error(() =>
      ex.exportar({ peticionId: idDialogo, formato: 'csv', nombreSugerido: 'con_dialogo', motor: 'postgres', preparar: async () => productor([PAGINA1]) })
    )
    respuesta = aceptar
    check(
      'Stop con el diálogo abierto: cancelada y NO se escribe el archivo elegido',
      eDialogo?.error.motivo === 'cancelada' && !existsSync(path.join(otra, 'con_dialogo.csv')) && restos(otra).length === 0,
      `${eDialogo?.error.motivo}`
    )
    const idMala = pid()
    const eMala = await error(() =>
      ex.exportar({
        peticionId: idMala,
        formato: 'csv',
        nombreSugerido: 'mala',
        motor: 'postgres',
        preparar: async () => {
          throw new ErrorGestor('interno', 'Petición inválida: «columnas».')
        }
      })
    )
    check(
      'un origen inválido sale tal cual de preparar, sin diálogo, y la petición no queda apuntada',
      eMala?.error.motivo === 'interno' && /columnas/.test(eMala.message) && !ex.enMarcha(idMala) && ex.cancelar(idMala) === false,
      `${eMala?.message}`
    )
    const normal = await ex.exportar({ peticionId: pid(), formato: 'csv', nombreSugerido: 'preparada', motor: 'postgres', preparar: async () => productor([PAGINA1, PAGINA2]) })
    check('NEGATIVO: sin Stop, preparar + diálogo + escritura como siempre', normal?.filas === 3 && existsSync(path.join(otra, 'preparada.csv')), JSON.stringify(normal))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
