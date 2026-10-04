#!/usr/bin/env node
// =============================================================================
// Prueba de abiertosEfectivos (node src/main/shell/test-abiertos-efectivos.mts): contra
// qué proyectos resuelve el main una apertura de «Abrir con Tessera». Fija la propiedad
// de seguridad: mientras el renderer no haya restaurado sus pestañas, un archivo de un
// proyecto persistido cae en ESE proyecto y no se acuña uno nuevo encima.
// Decisiones: docs/decisiones/renderer/abrir-con-tessera.md
// =============================================================================

import { abiertosEfectivos, proyectosDeEstado } from './abiertosEfectivos.ts'
import { contenedoraMasProfunda } from '../../shared/rutasHost.ts'
import type { TomarAperturasRequest } from '../../shared/shell-windows-ipc.ts'
import type { WorkspaceState } from '../../shared/workspace-state-ipc.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Lo persistido: un proyecto por perfil, y uno de ellos hibernado. */
const byProfile: WorkspaceState['byProfile'] = {
  alfa: {
    openProjects: [
      { projectHostPath: 'C:\\p\\caja', name: 'caja', estado: 'active' },
      { projectHostPath: 'C:\\p\\dormido', name: 'dormido', estado: 'hibernated' }
    ],
    activePath: 'C:\\p\\caja'
  },
  mac: {
    openProjects: [{ projectHostPath: '/Users/u/caja', name: 'caja', estado: 'active' }],
    activePath: '/Users/u/caja'
  }
}
const persistidos = proyectosDeEstado(byProfile)
const claves = (l: readonly { profileId: string; projectHostPath: string }[]): string =>
  l.map((p) => `${p.profileId}:${p.projectHostPath}`).join(' , ')

hr('(1) proyectosDeEstado: todos los perfiles, hibernados incluidos')
{
  check('tres proyectos, con su perfil', persistidos.length === 3, claves(persistidos))
  check(
    'el hibernado también cuenta',
    persistidos.some((p) => p.profileId === 'alfa' && p.projectHostPath === 'C:\\p\\dormido'),
    'alfa:C:\\p\\dormido'
  )
  check('sin perfiles: lista vacía', proyectosDeEstado({}).length === 0, '[]')
}

hr('(2) Sin pestañas cargadas, la regla 1 ve lo persistido (SEGURIDAD)')
{
  const peticiones: [string, TomarAperturasRequest | null | undefined][] = [
    ['pestanasCargadas: false', { abiertos: [], pestanasCargadas: false }],
    ['sin el campo (renderer viejo)', { abiertos: [] }],
    ['petición nula', null],
    ['petición indefinida', undefined]
  ]
  for (const [nombre, req] of peticiones) {
    const ab = abiertosEfectivos(req, () => persistidos)
    const win = contenedoraMasProfunda(ab, 'C:\\p\\caja\\repo\\nota.txt')
    check(
      `${nombre}: un archivo del restaurado cae en el restaurado`,
      win?.profileId === 'alfa' && win.projectHostPath === 'C:\\p\\caja',
      `${win?.profileId}:${win?.projectHostPath}`
    )
  }
  const ab = abiertosEfectivos({ abiertos: [], pestanasCargadas: false }, () => persistidos)
  const posix = contenedoraMasProfunda(ab, '/Users/u/caja/src/a.ts')
  check('lo mismo con rutas POSIX', posix?.profileId === 'mac', `${posix?.profileId}:${posix?.projectHostPath}`)
  const dormido = contenedoraMasProfunda(ab, 'C:\\p\\dormido\\leeme.md')
  check('y con un proyecto hibernado', dormido?.projectHostPath === 'C:\\p\\dormido', String(dormido?.projectHostPath))
  const ajeno = contenedoraMasProfunda(ab, 'C:\\p\\caja2\\nota.txt')
  check('mitad negativa: C:\\p\\caja2 no es C:\\p\\caja', ajeno === null, String(ajeno))
}

hr('(3) Con las pestañas cargadas manda el renderer, y lo persistido ni se lee')
{
  let lecturas = 0
  const leer = (): typeof persistidos => {
    lecturas++
    return persistidos
  }
  const vacio = abiertosEfectivos({ abiertos: [], pestanasCargadas: true }, leer)
  check('renderer sin proyectos: lista vacía (lo cerrado no resucita)', vacio.length === 0, claves(vacio))
  const uno = abiertosEfectivos(
    { abiertos: [{ profileId: 'alfa', projectHostPath: 'C:\\p\\otro' }], pestanasCargadas: true },
    leer
  )
  check('solo lo que manda el renderer', claves(uno) === 'alfa:C:\\p\\otro', claves(uno))
  check('no se leyó lo persistido', lecturas === 0, `lecturas=${lecturas}`)
  // Solo `true` cuenta: cualquier otra cosa no demuestra que las pestañas estén.
  const raro = abiertosEfectivos(
    { abiertos: [], pestanasCargadas: 'true' as unknown as boolean },
    leer
  )
  check("pestanasCargadas: 'true' (cadena) NO cuenta como cargadas", raro.length === 3 && lecturas === 1, claves(raro))
}

hr('(4) La unión no repite y lo del renderer va primero')
{
  const ab = abiertosEfectivos(
    {
      abiertos: [
        { profileId: 'alfa', projectHostPath: 'c:\\P\\CAJA' },
        { profileId: 'otro', projectHostPath: 'C:\\p\\caja' }
      ],
      pestanasCargadas: false
    },
    () => persistidos
  )
  check(
    'mismo perfil y misma ruta con otra caja: una sola vez, la del renderer',
    ab.filter((p) => p.profileId === 'alfa' && p.projectHostPath.toLowerCase() === 'c:\\p\\caja').length === 1 &&
      ab[0].projectHostPath === 'c:\\P\\CAJA',
    claves(ab)
  )
  check('la misma ruta en OTRO perfil se conserva', ab.some((p) => p.profileId === 'otro'), claves(ab))
  check('total: 2 del renderer + 2 persistidos nuevos', ab.length === 4, `n=${ab.length}`)
}

hr('(5) Saneado: una entrada mal formada no lanza ni se cuela')
{
  const sucio = {
    abiertos: [
      null,
      7,
      { profileId: 'alfa' },
      { projectHostPath: 'C:\\x' },
      { profileId: 1, projectHostPath: 'C:\\x' },
      { profileId: 'alfa', projectHostPath: 'C:\\p\\bien', sobra: true }
    ],
    pestanasCargadas: true
  } as unknown as TomarAperturasRequest
  let ab: ReturnType<typeof abiertosEfectivos> = []
  let lanzo = false
  try {
    ab = abiertosEfectivos(sucio, () => [])
  } catch {
    lanzo = true
  }
  check('no lanza', !lanzo, `lanzo=${lanzo}`)
  check('solo pasa la entrada bien formada, sin campos de más', JSON.stringify(ab) === JSON.stringify([{ profileId: 'alfa', projectHostPath: 'C:\\p\\bien' }]), JSON.stringify(ab))
  const noLista = abiertosEfectivos({ abiertos: 'no' } as unknown as TomarAperturasRequest, () => persistidos)
  check('`abiertos` que no es lista: se tratan como vacío y se suma lo persistido', noLista.length === 3, claves(noLista))
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
