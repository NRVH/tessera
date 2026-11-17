#!/usr/bin/env node
// =============================================================================
// Prueba del store de pestañas (node src/renderer/src/features/pestanas/test-store-pestanas.mts).
// Fija que `despacharPestanas` es EXACTAMENTE el reducer de modeloPestanas (mismo estado que
// `reducirPestanas`) y que lo que no cambia nada no avisa a nadie: es lo que conserva
// la identidad de la que dependen los efectos de usePestanas. Cubre también el
// objetivo confirmado, los perfiles hibernándose y la carga inicial.
// =============================================================================

import { ESTADO_ARBOL_PESTANAS_VACIO, reducirPestanas, type AccionPestanas } from './modeloPestanas.ts'
import {
  despacharPestanas,
  fijarConfirmado,
  iniciarPestanas,
  marcarHibernando,
  marcarPestanasCargadas,
  useStorePestanas
} from './store.ts'
import type { Perfil } from '../../../../main/perfiles/types.ts'

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

const perfil = (id: string): Perfil => ({
  id,
  nombre: id.toUpperCase(),
  color: '#61afef',
  agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
  sandbox: { habilitado: false }
})

let avisos = 0
useStorePestanas.subscribe(() => {
  avisos++
})

hr('(1) despacharPestanas = reducirPestanas, acción a acción')
{
  const acciones: AccionPestanas[] = [
    { tipo: 'init', perfiles: [perfil('alfa'), perfil('beta')] },
    { tipo: 'openProject', perfilId: 'alfa', proyecto: { projectHostPath: 'C:\\p\\alfa', name: 'alfa' } },
    { tipo: 'openProject', perfilId: 'beta', proyecto: { projectHostPath: 'C:\\p\\beta', name: 'beta' } },
    { tipo: 'setActiveProfile', perfilId: 'beta' },
    { tipo: 'closeProject', perfilId: 'alfa', rutaHostProyecto: 'C:\\p\\alfa' }
  ]
  let esperado = ESTADO_ARBOL_PESTANAS_VACIO
  check('arranca en ESTADO_ARBOL_PESTANAS_VACIO', useStorePestanas.getState().pestanas === ESTADO_ARBOL_PESTANAS_VACIO, 'misma referencia')
  for (const a of acciones) {
    esperado = reducirPestanas(esperado, a)
    despacharPestanas(a)
    const real = useStorePestanas.getState().pestanas
    check(`${a.tipo}: mismo estado que el reducer`, JSON.stringify(real) === JSON.stringify(esperado), `activo=${real.perfilActivoId}`)
  }
}

hr('(2) Lo que no cambia nada no avisa y conserva la identidad')
{
  const antes = useStorePestanas.getState().pestanas
  const n = avisos
  despacharPestanas({ tipo: 'setActiveProfile', perfilId: 'no-existe' })
  check('acción no-op: sin aviso', avisos === n, `avisos ${n} -> ${avisos}`)
  check('acción no-op: misma referencia de `tabs`', useStorePestanas.getState().pestanas === antes, 'identidad')
  despacharPestanas({ tipo: 'setActiveProfile', perfilId: 'alfa' })
  check('acción que cambia: avisa una vez', avisos === n + 1, `avisos ${n} -> ${avisos}`)
}

hr('(3) Confirmado e hibernando')
{
  const proyecto = { rutaHostProyecto: 'C:\\p\\beta', nombre: 'beta', estado: 'active' as const }
  fijarConfirmado({ perfilId: 'beta', proyecto, repo: null })
  check('fijarConfirmado guarda el objetivo', useStorePestanas.getState().confirmado?.proyecto.nombre === 'beta', 'beta')
  marcarHibernando('alfa', true)
  const conjunto = useStorePestanas.getState().hibernando
  check('marcarHibernando añade', conjunto.has('alfa'), [...conjunto].join(','))
  const n = avisos
  marcarHibernando('alfa', true)
  check('marcar dos veces: mismo conjunto y sin aviso', useStorePestanas.getState().hibernando === conjunto && avisos === n, `avisos ${n} -> ${avisos}`)
  marcarHibernando('alfa', false)
  check('marcarHibernando quita', !useStorePestanas.getState().hibernando.has('alfa'), 'vacío')
}

hr('(3b) Reordenar proyectos: avisa solo si el orden cambia de verdad')
{
  const ruta = (n: string): string => `C:\\p\\${n}`
  for (const n of ['gamma', 'delta']) {
    despacharPestanas({ tipo: 'openProject', perfilId: 'beta', proyecto: { projectHostPath: ruta(n), name: n } })
  }
  const orden = (): string => useStorePestanas.getState().pestanas.porPerfil.beta.proyectosAbiertos.map((p) => p.nombre).join(',')
  const activo = useStorePestanas.getState().pestanas.porPerfil.beta.rutaActiva
  check('parte de beta,gamma,delta', orden() === 'beta,gamma,delta', orden())
  const antes = useStorePestanas.getState().pestanas
  const n = avisos
  despacharPestanas({ tipo: 'reordenarProyectos', perfilId: 'beta', rutasOrdenadas: [ruta('beta'), ruta('gamma'), ruta('delta')] })
  despacharPestanas({ tipo: 'reordenarProyectos', perfilId: 'beta', rutasOrdenadas: [ruta('beta'), ruta('beta'), ruta('delta')] })
  check('el mismo orden y un orden mal formado: sin aviso y misma referencia', avisos === n && useStorePestanas.getState().pestanas === antes, `avisos ${n} -> ${avisos}`)
  despacharPestanas({ tipo: 'reordenarProyectos', perfilId: 'beta', rutasOrdenadas: [ruta('delta'), ruta('beta'), ruta('gamma')] })
  check('un orden nuevo: un aviso y el orden cambia', avisos === n + 1 && orden() === 'delta,beta,gamma', `avisos ${n} -> ${avisos} · ${orden()}`)
  check('y el activo sigue siendo el mismo', useStorePestanas.getState().pestanas.porPerfil.beta.rutaActiva === activo, String(activo))
}

hr('(4) Carga inicial: pestañas e indicador de «cargadas» en un solo aviso')
{
  check('antes de la carga inicial, `pestanasCargadas` es false', !useStorePestanas.getState().pestanasCargadas, 'false')
  const restaurada = {
    perfilActivoId: 'beta',
    porPerfil: {
      beta: {
        proyectosAbiertos: [{ rutaHostProyecto: 'C:\\p\\gamma', nombre: 'gamma', estado: 'active' as const }],
        rutaActiva: 'C:\\p\\gamma',
        estadoRepos: {}
      }
    }
  }
  const perfiles = [perfil('alfa'), perfil('beta')]
  const esperado = reducirPestanas(useStorePestanas.getState().pestanas, { tipo: 'init', perfiles, restaurada })
  let vistoAMedias = false
  const soltar = useStorePestanas.subscribe((s) => {
    const restauradas = s.pestanas.porPerfil.beta?.proyectosAbiertos.some((p) => p.nombre === 'gamma') === true
    if (restauradas !== s.pestanasCargadas) vistoAMedias = true
  })
  const n = avisos
  iniciarPestanas(perfiles, restaurada)
  soltar()
  const s = useStorePestanas.getState()
  check('iniciarPestanas = reducirPestanas(init)', JSON.stringify(s.pestanas) === JSON.stringify(esperado), `activo=${s.pestanas.perfilActivoId}`)
  check('deja `pestanasCargadas` a true', s.pestanasCargadas, String(s.pestanasCargadas))
  check('UN solo aviso, y nadie ve las pestañas sin la bandera', avisos === n + 1 && !vistoAMedias, `avisos ${n} -> ${avisos}`)

  useStorePestanas.setState({ pestanasCargadas: false })
  const m = avisos
  marcarPestanasCargadas()
  check('marcarPestanasCargadas la pone y avisa', useStorePestanas.getState().pestanasCargadas && avisos === m + 1, `avisos ${m} -> ${avisos}`)
  const antes = useStorePestanas.getState()
  marcarPestanasCargadas()
  check('la segunda vez no avisa ni cambia el estado', avisos === m + 1 && useStorePestanas.getState() === antes, `avisos ${m + 1} -> ${avisos}`)
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
