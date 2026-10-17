#!/usr/bin/env node
// =============================================================================
// Prueba de qué laterales siguen montados (npm run test:laterales-vivos): el explorador y el árbol de
// BD se quedan, ocultos, al cambiar de vista; el de git sale en cuanto deja de verse; volver a uno no
// lo mueve de sitio (el navegador no pierde su desplazamiento), y el conjunto es el mismo objeto en
// cada render.
// =============================================================================
import { conVisto, soloExistentes, type ConUso, type Vivo } from '../../comun/vivosRecientes.ts'
import { lateralesMontables, type VistaLateral } from './lateralesVivos.ts'

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

/** Lo que hace `useVivosRecientes` en cada render, con la vista que se ve. */
function ver(lista: readonly ConUso<Vivo>[], activa: VistaLateral): readonly ConUso<Vivo>[] {
  return soloExistentes(conVisto(lista, { clave: activa }), lateralesMontables(activa))
}
const claves = (l: readonly ConUso<Vivo>[]): string => l.map((v) => v.pieza.clave).join(',')

hr('(1) Archivos → Git → Archivos')
let lista: readonly ConUso<Vivo>[] = []
lista = ver(lista, 'files')
check('1a', claves(lista) === 'files', claves(lista))
lista = ver(lista, 'git')
check('1b', claves(lista) === 'files,git', `git se monta y el explorador sigue, oculto: ${claves(lista)}`)
lista = ver(lista, 'files')
check('1c', claves(lista) === 'files', `al volver, git sale y el explorador no se movió: ${claves(lista)}`)

hr('(2) Con BD de por medio')
lista = ver(lista, 'db')
check('2a', claves(lista) === 'files,db', claves(lista))
lista = ver(lista, 'git')
check('2b', claves(lista) === 'files,db,git', `los dos se conservan mientras se ve git: ${claves(lista)}`)
lista = ver(lista, 'db')
check('2c', claves(lista) === 'files,db', `volver a BD no reordena: ${claves(lista)}`)
check('2d', ver(lista, 'db') === lista, 'sin cambios: misma lista')

hr('(3) Identidad estable')
check('3a', lateralesMontables('git') === lateralesMontables('git'), 'el conjunto de una vista es siempre el mismo objeto')
check('3b', lateralesMontables('files').has('db') && !lateralesMontables('files').has('git'), 'mirando archivos: BD sí, git no')

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed > 0 ? 1 : 0)
