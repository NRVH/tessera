#!/usr/bin/env node
// =============================================================================
// Prueba de la orden de borrar un perfil (`profiles/ordenDeBorrado.ts`, npm run test:orden-de-borrado):
// guardar una lista a la que le falta un perfil lo conserva y no borra nada; solo la orden borra, y se
// apunta como pendiente antes de tocar nada; al arrancar se terminan los pendientes que ya no están en la
// lista y se olvidan los que sí. Con dobles y una carpeta temporal.
// Decisiones: docs/decisiones/workspace/borrar-perfil-con-orden.md
// =============================================================================
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BorradosPendientes, borrarPorOrden, listaAGuardar, terminarBorradosPendientes } from './ordenDeBorrado.ts'

function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}
const results: { name: string; pass: boolean }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

type P = { id: string; nombre?: string }
const ids = (l: readonly P[]): string => l.map((p) => p.id).join(',')
const tmp = mkdtempSync(path.join(tmpdir(), 'tessera-orden-borrado-'))
let n = 0
const archivoNuevo = (): string => path.join(tmp, `pendientes-${n++}.json`)

try {
  hr('(A) Guardar nunca quita un perfil')
  {
    const actual: P[] = [{ id: 'uno' }, { id: 'dos' }, { id: 'tres' }]
    const igual = listaAGuardar(actual, [{ id: 'uno', nombre: 'Uno' }, { id: 'dos' }, { id: 'tres' }])
    check('(a1) la lista completa se guarda tal cual, sin retenidos', ids(igual.lista) === 'uno,dos,tres' && igual.retenidos.length === 0 && igual.lista[0].nombre === 'Uno', ids(igual.lista))
    const falta = listaAGuardar(actual, [{ id: 'uno' }, { id: 'tres' }])
    check('(a2) la que no trae «dos» lo conserva, en su sitio', ids(falta.lista) === 'uno,dos,tres' && ids(falta.retenidos) === 'dos', `${ids(falta.lista)} ret=${ids(falta.retenidos)}`)
    const vacia = listaAGuardar(actual, [])
    check('(a3) una lista vacía no se lleva a nadie', ids(vacia.lista) === 'uno,dos,tres' && vacia.retenidos.length === 3, ids(vacia.lista))
    const orden = listaAGuardar(actual, [{ id: 'tres' }, { id: 'uno' }, { id: 'dos' }, { id: 'cuatro' }])
    check('(a4) reordenar y dar de alta se respeta', ids(orden.lista) === 'tres,uno,dos,cuatro' && orden.retenidos.length === 0, ids(orden.lista))
  }

  hr('(B) El archivo de borrados pendientes')
  {
    const ruta = archivoNuevo()
    const avisos: string[] = []
    const p = new BorradosPendientes<P>(ruta, (m) => avisos.push(m))
    check('(b1) sin archivo, ninguno', p.leer().length === 0, '[]')
    p.apuntar({ id: 'uno', nombre: 'Uno' })
    p.apuntar({ id: 'dos' })
    p.apuntar({ id: 'uno', nombre: 'Uno otra vez' })
    const leidos = new BorradosPendientes<P>(ruta).leer()
    check('(b2) se guardan en disco, uno por id', ids(leidos) === 'dos,uno' && leidos[1].nombre === 'Uno otra vez', ids(leidos))
    p.quitar('uno')
    check('(b3) quitar deja los demás', ids(p.leer()) === 'dos', ids(p.leer()))
    writeFileSync(ruta, '{roto')
    check('(b4) ilegible = ninguno, y se registra', p.leer().length === 0 && avisos.length === 1, avisos.join(' | '))
    writeFileSync(ruta, JSON.stringify([{ id: 'ok' }, { sinId: 1 }, null, 'x']))
    check('(b5) las entradas sin id se ignoran', ids(p.leer()) === 'ok', ids(p.leer()))
  }

  hr('(C) La orden de borrar')
  {
    let lista: P[] = [{ id: 'uno' }, { id: 'dos' }]
    const pasos: string[] = []
    const pendientes = new BorradosPendientes<P>(archivoNuevo())
    const deps = {
      lista: () => lista,
      fijarLista: (l: P[]) => {
        pasos.push(`fijar ${ids(l)} (pendientes: ${ids(pendientes.leer())})`)
        lista = l
      },
      pendientes,
      borrar: async (ps: readonly P[]) => {
        pasos.push(`borrar ${ids(ps)} (pendientes: ${ids(pendientes.leer())})`)
      },
      log: (m: string) => pasos.push(`log ${m}`)
    }
    await borrarPorOrden(deps, 'dos')
    check(
      '(c1) se apunta, sale de la lista y se borra, en ese orden',
      pasos.join(' | ') === 'fijar uno (pendientes: dos) | borrar dos (pendientes: dos)',
      pasos.join(' | ')
    )
    check('(c2) y al terminar se quita de pendientes', pendientes.leer().length === 0 && ids(lista) === 'uno', `lista=${ids(lista)}`)

    pasos.length = 0
    await borrarPorOrden(deps, 'fantasma')
    check('(c3) un id que no está no borra nada', pasos.length === 1 && pasos[0].startsWith('log ') && ids(lista) === 'uno', pasos.join(' | '))

    pasos.length = 0
    let error = ''
    try {
      await borrarPorOrden({ ...deps, fijarLista: () => { throw new Error('disco lleno') } }, 'uno')
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    check('(c4) si no se puede guardar la lista: el error sube, no se borra nada y no queda pendiente', error === 'disco lleno' && pasos.length === 0 && pendientes.leer().length === 0, `${error} ${pasos.join(' | ')}`)

    let fallo = ''
    try {
      await borrarPorOrden({ ...deps, borrar: async () => { throw new Error('a medias') } }, 'uno')
    } catch (err) {
      fallo = err instanceof Error ? err.message : String(err)
    }
    check('(c5) si el borrado falla, el perfil ya salió de la lista y no queda pendiente', fallo === 'a medias' && lista.length === 0 && pendientes.leer().length === 0, `${fallo} lista=${ids(lista)}`)
  }

  hr('(D) Al arrancar se terminan los pendientes')
  {
    const pendientes = new BorradosPendientes<P>(archivoNuevo())
    pendientes.apuntar({ id: 'borrado' })
    pendientes.apuntar({ id: 'sigue' })
    pendientes.apuntar({ id: 'otra-caja' })
    const borrados: string[] = []
    const avisos: string[] = []
    await terminarBorradosPendientes(
      pendientes,
      () => ['sigue', 'Otra-Caja', 'beta'],
      async (ps) => {
        borrados.push(ids(ps))
      },
      (m) => avisos.push(m)
    )
    check('(d1) se borra solo el que ya no está en la lista', borrados.join(' | ') === 'borrado', borrados.join(' | '))
    check('(d2) el que sigue (o se recreó, aunque sea con otra caja) no se toca', !borrados.join().includes('sigue') && !borrados.join().includes('otra-caja'), borrados.join(' | '))
    check('(d3) y no queda ninguno pendiente', pendientes.leer().length === 0, ids(pendientes.leer()))
    check('(d4) se registra qué se termina', avisos.length === 1 && avisos[0].includes('borrado'), avisos.join(' | '))

    const vacio = new BorradosPendientes<P>(archivoNuevo())
    let llamado = false
    await terminarBorradosPendientes(vacio, () => [], async () => {
      llamado = true
    }, () => {})
    check('(d5) sin pendientes no se llama a borrar', !llamado, String(llamado))
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
console.log(`\nVEREDICTO: ${passed}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
