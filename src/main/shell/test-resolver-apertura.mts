#!/usr/bin/env node
// =============================================================================
// Prueba de `resolverApertura` (npm run test:resolver-apertura) sobre carpetas temporales reales.
// Fija la regla 1 en un volumen sensible a mayúsculas: `proyecto` no cae dentro de `Proyecto`
// abierto. La sensibilidad del volumen se simula inyectando la identidad del disco, así que
// los casos de las dos clases de volumen se comprueban en cualquier plataforma.
// =============================================================================

import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolverApertura, type IdentidadDisco } from './resolverApertura.ts'

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

/** Volumen SENSIBLE simulado: cada caja es un sitio distinto. */
const sensible: IdentidadDisco = async (ruta) => `id:${ruta}`
/** Volumen INSENSIBLE simulado: la caja no cuenta. */
const insensible: IdentidadDisco = async (ruta) => `id:${ruta.toLowerCase()}`

async function main(): Promise<void> {
  const raiz = await realpath(await mkdtemp(path.join(tmpdir(), 'tessera-apertura-')))
  const proyecto = path.join(raiz, 'Proyecto')
  await mkdir(proyecto, { recursive: true })
  await writeFile(path.join(proyecto, 'a.ts'), 'x', 'utf8')
  const abiertos = [{ profileId: 'p1', projectHostPath: proyecto }]

  // En un volumen insensible la ruta con otra caja existe; en uno sensible el archivo pedido
  // sería el de la OTRA carpeta. `stat` (existe, es archivo) es real; la identidad, simulada.
  const otraCaja = path.join(raiz, 'proyecto', 'a.ts')
  const cajaDistinta = existsSync(otraCaja)

  hr('Misma caja: no se pregunta al disco')
  let llamadas = 0
  const contando: IdentidadDisco = async (r) => {
    llamadas++
    return sensible(r)
  }
  const igual = await resolverApertura(path.join(proyecto, 'a.ts'), abiertos, contando)
  check(
    '(a) con la misma caja se activa el proyecto abierto sin tocar la identidad del disco',
    igual.ok && igual.apertura.profileIdExistente === 'p1' && llamadas === 0,
    `ok=${igual.ok} perfil=${igual.ok ? igual.apertura.profileIdExistente : '-'} identidades=${llamadas}`
  )

  hr('Caja distinta (solo si el volumen de la prueba no distingue mayúsculas)')
  if (!cajaDistinta) {
    console.log('  (este volumen distingue mayúsculas: `proyecto/a.ts` no existe y no hay nada que pedir)')
    return
  }
  const enSensible = await resolverApertura(otraCaja, abiertos, sensible)
  check(
    '(b) volumen SENSIBLE: `proyecto/a.ts` NO cae dentro de `Proyecto` abierto; se acuña su contenedora',
    enSensible.ok && enSensible.apertura.profileIdExistente === null &&
      path.basename(enSensible.apertura.contenedora.projectHostPath) === 'proyecto',
    enSensible.ok
      ? `perfil=${enSensible.apertura.profileIdExistente} contenedora=${path.basename(enSensible.apertura.contenedora.projectHostPath)}`
      : `motivo=${enSensible.motivo}`
  )
  const enInsensible = await resolverApertura(otraCaja, abiertos, insensible)
  check(
    '(c) volumen INSENSIBLE: la misma petición activa el proyecto abierto, como siempre',
    enInsensible.ok && enInsensible.apertura.profileIdExistente === 'p1' && enInsensible.apertura.archivo?.path === 'a.ts',
    enInsensible.ok ? `perfil=${enInsensible.apertura.profileIdExistente} archivo=${enInsensible.apertura.archivo?.path}` : '-'
  )
  const sinIdentidad = await resolverApertura(otraCaja, abiertos, async () => null)
  check(
    '(d) sin identidad del disco (recursos de red) se queda la comparación sin caja',
    sinIdentidad.ok && sinIdentidad.apertura.profileIdExistente === 'p1',
    sinIdentidad.ok ? `perfil=${sinIdentidad.apertura.profileIdExistente}` : '-'
  )
  const real = await resolverApertura(otraCaja, abiertos)
  check(
    '(e) con la identidad REAL de este volumen (insensible) se activa el proyecto abierto',
    real.ok && real.apertura.profileIdExistente === 'p1',
    real.ok ? `perfil=${real.apertura.profileIdExistente}` : `motivo=${real.motivo}`
  )
}

main()
  .then(() => {
    const allPass = results.every((r) => r.pass)
    hr(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
    process.exit(allPass ? 0 : 1)
  })
  .catch((err) => {
    console.error('[test:resolver-apertura] error inesperado:', err)
    process.exit(1)
  })
