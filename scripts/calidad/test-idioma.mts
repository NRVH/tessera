#!/usr/bin/env node
// =============================================================================
// Guardia de IDIOMA del código (npm run test:idioma [-- opciones] [carpetas…]). Cuenta el inglés propio que
// un commit añade y quita en los nombres que declara: desde 1 de saldo lo detiene.
// `--commit`: lo que corre el hook sobre el índice. `--historial <n>`: mide los últimos n commits.
// `carpetas…`: certifica que no queda inglés propio ahí. Sin nada: informa del total del repo, sin fallar.
// Depende de `idiomaCommit.mts` e `idiomaInforme.mts`; la regla está en docs/decisiones/calidad/idioma-del-codigo.md.
// =============================================================================
import { check, cerrar, hr, leerArgumentos } from './comun.mts'
import { clasificar, medirContraGit, medirIndice as medirElIndice, referenciasDelCommit } from './idiomaCommit.mts'
import { cambiosDelCommit, commitsPedidos, ultimosCommits } from './idiomaGit.mts'
import { cargarDatos, contarEnDisco, describir, mensajeDelCommit, resumenDelRecuento } from './idiomaInforme.mts'
import type { DatosIdioma } from './idiomaDeclaraciones.mts'

const SIN_ARCHIVO = { detalle: false, rutas: [], json: null, privados: null }

interface Modo {
  commit: boolean
  historial: number | null
  detalle: boolean
  carpetas: string[]
}

function leerModo(argv: string[]): Modo {
  const modo: Modo = { commit: false, historial: null, detalle: false, carpetas: [] }
  const resto: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--commit') modo.commit = true
    else if (argv[i] === '--detalle') modo.detalle = true
    else if (argv[i] === '--historial') modo.historial = commitsPedidos(argv[++i])
    else resto.push(argv[i])
  }
  modo.carpetas = leerArgumentos(resto).rutas
  return modo
}

function medirIndice(datos: DatosIdioma, detalle: boolean): void {
  hr('IDIOMA DEL CÓDIGO: lo que añade este commit')
  const medida = medirElIndice(datos)
  const veredicto = clasificar(medida.saldo, medida.omitido)
  for (const linea of mensajeDelCommit(medida, veredicto, detalle)) console.log(linea)
  check('el saldo de inglés propio está por debajo del límite', veredicto !== 'detiene', `saldo ${medida.saldo} en ${medida.analizados}/${medida.archivos} archivos, ${medida.milisegundos} ms`)
  cerrar('idioma', medida.analizados, null, SIN_ARCHIVO)
}

function medirHistorial(n: number, datos: DatosIdioma, detalle: boolean): void {
  hr(`IDIOMA DEL CÓDIGO: los últimos ${n} commits`)
  const cuenta = { pasa: 0, detiene: 0, omitido: 0 }
  let conNuevosSinSaldo = 0
  const commits = ultimosCommits(n)
  if (commits.length === 0) console.log('  No hay commits que medir.')
  for (const { hash, asunto, hayPadre } of commits) {
    const medida = medirContraGit((limite) => cambiosDelCommit(hash, hayPadre, limite), referenciasDelCommit(hash, hayPadre), datos)
    const veredicto = clasificar(medida.saldo, medida.omitido)
    cuenta[veredicto]++
    if (veredicto === 'pasa' && medida.nuevos.length > 0) conNuevosSinSaldo++
    const nombres = medida.nuevos.slice(0, detalle ? undefined : 3).map((nombre) => describir(nombre).trim())
    console.log(`${hash.slice(0, 8)}  saldo ${String(medida.saldo).padStart(3)}  ${veredicto.padEnd(7)}  ${asunto.slice(0, 70)}`)
    if (veredicto !== 'pasa') for (const nombre of nombres) console.log(`            ${nombre}`)
  }
  console.log(`\n  detenidos ${cuenta.detiene}, sin medir ${cuenta.omitido}, sin novedad ${cuenta.pasa} (de ellos ${conNuevosSinSaldo} con nombres nuevos y saldo sin subir)`)
  const medidos = cuenta.pasa + cuenta.detiene + cuenta.omitido
  check('se midieron los commits que hay, hasta los pedidos', medidos === commits.length && commits.length <= n, `${commits.length} de hasta ${n} commits`)
  cerrar('idioma', commits.length, null, SIN_ARCHIVO)
}

function contar(modo: Modo, datos: DatosIdioma): void {
  const certifica = modo.carpetas.length > 0
  hr(certifica ? `IDIOMA DEL CÓDIGO: inglés propio en ${modo.carpetas.join(', ')}` : 'IDIOMA DEL CÓDIGO: inglés propio en todo el repo')
  const { archivos, nombres, fallidos } = contarEnDisco(modo.carpetas, datos)
  for (const fallo of fallidos) console.log(`AVISO idioma: no se pudo analizar ${fallo}. Se salta ese archivo.`)
  for (const nombre of modo.detalle || certifica ? nombres.slice(0, modo.detalle ? undefined : 25) : []) console.log(describir(nombre))
  if (certifica && !modo.detalle && nombres.length > 25) console.log(`  … y ${nombres.length - 25} más (--detalle para verlos todos)`)
  console.log(`\n  ${nombres.length} nombre(s) en inglés propio en ${archivos} archivo(s)`)
  for (const linea of resumenDelRecuento(nombres)) console.log(linea)
  if (certifica) check('sin inglés propio en las carpetas pedidas', nombres.length === 0, `${nombres.length} nombre(s)`)
  else check('informe del total del repo', true, `${nombres.length} nombre(s) en ${archivos} archivo(s); no falla`)
  cerrar('idioma', archivos, null, SIN_ARCHIVO)
}

function ejecutar(): void {
  const modo = leerModo(process.argv.slice(2))
  const datos = cargarDatos(modo.commit)
  if (modo.commit) medirIndice(datos, modo.detalle)
  else if (modo.historial !== null) medirHistorial(modo.historial, datos, modo.detalle)
  else contar(modo, datos)
}

try { ejecutar() } catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
