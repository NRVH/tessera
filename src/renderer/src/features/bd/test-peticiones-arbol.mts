#!/usr/bin/env node
// =============================================================================
// Prueba de las peticiones al árbol de BD (node src/renderer/src/features/bd/test-peticiones-arbol.mts).
// Fija que «Nueva conexión…» y «Editar» se atienden exactamente una vez por petición, en
// cualquier visita a la vista: el store olvida las peticiones al salir y nunca repite un token.
// =============================================================================

import {
  olvidarPeticionesArbol,
  pedirAltaConexion,
  pedirEdicionConexion,
  peticionPorAtender,
  useStoreBd
} from './store.ts'

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

// Lo mismo que hace el efecto de `DbArbol`: el último token atendido sobrevive al desmontaje.
const atendidas: { nueva: number | null; editar: number | null } = { nueva: null, editar: null }
function atenderNueva(): boolean {
  const pedida = useStoreBd.getState().pedirNuevaConexion
  if (!peticionPorAtender(pedida, atendidas.nueva)) return false
  atendidas.nueva = pedida.token
  return true
}
function atenderEditar(): string | null {
  const pedida = useStoreBd.getState().pedirEditarConexion
  if (!peticionPorAtender(pedida, atendidas.editar)) return null
  atendidas.editar = pedida.token
  return pedida.valor
}

hr('(1) La primera «Nueva conexión…» de CADA visita abre el diálogo')
{
  const abiertas: boolean[] = []
  for (let visita = 0; visita < 4; visita++) {
    pedirAltaConexion()
    abiertas.push(atenderNueva())
    olvidarPeticionesArbol()
  }
  check('cuatro visitas, cuatro diálogos', abiertas.every(Boolean), JSON.stringify(abiertas))
}

hr('(2) Una petición no se atiende dos veces')
{
  pedirAltaConexion()
  const primera = atenderNueva()
  const remontado = atenderNueva()
  check('atendida al llegar', primera, String(primera))
  check('remontar el árbol con el mismo token no la repite', !remontado, String(remontado))
  pedirAltaConexion()
  check('la siguiente sí', atenderNueva(), 'true')
  olvidarPeticionesArbol()
  check('olvidada: nada que atender', !atenderNueva(), 'false')
}

hr('(3) Editar sigue la misma regla, también tras salir y volver')
{
  const editadas: (string | null)[] = []
  for (const id of ['a', 'b', 'a']) {
    pedirEdicionConexion(id)
    editadas.push(atenderEditar())
    olvidarPeticionesArbol()
  }
  check('cada visita edita la suya', editadas.join() === 'a,b,a', JSON.stringify(editadas))
}

hr('(4) Los tokens no se repiten aunque se olviden las peticiones')
{
  pedirAltaConexion()
  const t1 = useStoreBd.getState().pedirNuevaConexion?.token
  olvidarPeticionesArbol()
  pedirAltaConexion()
  const t2 = useStoreBd.getState().pedirNuevaConexion?.token
  check('el token tras olvidar es otro', t1 !== undefined && t2 !== undefined && t2 > t1, `${t1} -> ${t2}`)
  check('peticionPorAtender(null) es false', !peticionPorAtender(null, null), 'false')
}

console.log('\n' + '='.repeat(78))
const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
console.log(`VEREDICTO: ${passed}/${results.length} PASS`)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
