#!/usr/bin/env node
// =============================================================================
// Prueba del store de pestañas (node src/renderer/src/features/pestanas/test-store-pestanas.mts).
// Fija que `despacharTabs` es EXACTAMENTE el reducer de tabsModel (mismo estado que
// `tabsReducer`) y que lo que no cambia nada no avisa a nadie: es lo que conserva
// la identidad de la que dependen los efectos de useTabs. Cubre también el
// objetivo confirmado, los perfiles hibernándose y la carga inicial.
// =============================================================================

import { EMPTY_TABS_STATE, tabsReducer, type TabsAction } from './tabsModel.ts'
import {
  despacharTabs,
  fijarConfirmado,
  iniciarPestanas,
  marcarHibernando,
  marcarPestanasCargadas,
  useStorePestanas
} from './store.ts'
import type { Profile } from '../../../../main/profiles/types.ts'

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

const perfil = (id: string): Profile => ({
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

hr('(1) despacharTabs = tabsReducer, acción a acción')
{
  const acciones: TabsAction[] = [
    { type: 'init', profiles: [perfil('alfa'), perfil('beta')] },
    { type: 'openProject', profileId: 'alfa', project: { projectHostPath: 'C:\\p\\alfa', name: 'alfa' } },
    { type: 'openProject', profileId: 'beta', project: { projectHostPath: 'C:\\p\\beta', name: 'beta' } },
    { type: 'setActiveProfile', profileId: 'beta' },
    { type: 'closeProject', profileId: 'alfa', projectHostPath: 'C:\\p\\alfa' }
  ]
  let esperado = EMPTY_TABS_STATE
  check('arranca en EMPTY_TABS_STATE', useStorePestanas.getState().tabs === EMPTY_TABS_STATE, 'misma referencia')
  for (const a of acciones) {
    esperado = tabsReducer(esperado, a)
    despacharTabs(a)
    const real = useStorePestanas.getState().tabs
    check(`${a.type}: mismo estado que el reducer`, JSON.stringify(real) === JSON.stringify(esperado), `activo=${real.activeProfileId}`)
  }
}

hr('(2) Lo que no cambia nada no avisa y conserva la identidad')
{
  const antes = useStorePestanas.getState().tabs
  const n = avisos
  despacharTabs({ type: 'setActiveProfile', profileId: 'no-existe' })
  check('acción no-op: sin aviso', avisos === n, `avisos ${n} -> ${avisos}`)
  check('acción no-op: misma referencia de `tabs`', useStorePestanas.getState().tabs === antes, 'identidad')
  despacharTabs({ type: 'setActiveProfile', profileId: 'alfa' })
  check('acción que cambia: avisa una vez', avisos === n + 1, `avisos ${n} -> ${avisos}`)
}

hr('(3) Confirmado e hibernando')
{
  const project = { projectHostPath: 'C:\\p\\beta', name: 'beta', estado: 'active' as const }
  fijarConfirmado({ profileId: 'beta', project, repo: null })
  check('fijarConfirmado guarda el objetivo', useStorePestanas.getState().confirmado?.project.name === 'beta', 'beta')
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
    despacharTabs({ type: 'openProject', profileId: 'beta', project: { projectHostPath: ruta(n), name: n } })
  }
  const orden = (): string => useStorePestanas.getState().tabs.byProfile.beta.openProjects.map((p) => p.name).join(',')
  const activo = useStorePestanas.getState().tabs.byProfile.beta.activePath
  check('parte de beta,gamma,delta', orden() === 'beta,gamma,delta', orden())
  const antes = useStorePestanas.getState().tabs
  const n = avisos
  despacharTabs({ type: 'reordenarProyectos', profileId: 'beta', orderedPaths: [ruta('beta'), ruta('gamma'), ruta('delta')] })
  despacharTabs({ type: 'reordenarProyectos', profileId: 'beta', orderedPaths: [ruta('beta'), ruta('beta'), ruta('delta')] })
  check('el mismo orden y un orden mal formado: sin aviso y misma referencia', avisos === n && useStorePestanas.getState().tabs === antes, `avisos ${n} -> ${avisos}`)
  despacharTabs({ type: 'reordenarProyectos', profileId: 'beta', orderedPaths: [ruta('delta'), ruta('beta'), ruta('gamma')] })
  check('un orden nuevo: un aviso y el orden cambia', avisos === n + 1 && orden() === 'delta,beta,gamma', `avisos ${n} -> ${avisos} · ${orden()}`)
  check('y el activo sigue siendo el mismo', useStorePestanas.getState().tabs.byProfile.beta.activePath === activo, String(activo))
}

hr('(4) Carga inicial: pestañas e indicador de «cargadas» en un solo aviso')
{
  check('antes de la carga inicial, `pestanasCargadas` es false', !useStorePestanas.getState().pestanasCargadas, 'false')
  const restored = {
    activeProfileId: 'beta',
    byProfile: {
      beta: {
        openProjects: [{ projectHostPath: 'C:\\p\\gamma', name: 'gamma', estado: 'active' as const }],
        activePath: 'C:\\p\\gamma',
        repoState: {}
      }
    }
  }
  const profiles = [perfil('alfa'), perfil('beta')]
  const esperado = tabsReducer(useStorePestanas.getState().tabs, { type: 'init', profiles, restored })
  let vistoAMedias = false
  const soltar = useStorePestanas.subscribe((s) => {
    const restauradas = s.tabs.byProfile.beta?.openProjects.some((p) => p.name === 'gamma') === true
    if (restauradas !== s.pestanasCargadas) vistoAMedias = true
  })
  const n = avisos
  iniciarPestanas(profiles, restored)
  soltar()
  const s = useStorePestanas.getState()
  check('iniciarPestanas = tabsReducer(init)', JSON.stringify(s.tabs) === JSON.stringify(esperado), `activo=${s.tabs.activeProfileId}`)
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
