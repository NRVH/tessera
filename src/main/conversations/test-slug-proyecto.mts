#!/usr/bin/env node
// =============================================================================
// Prueba de la criba por nombre de carpeta de las conversaciones de Claude Code
// (`slugProyecto.ts`).
// (node src/main/conversations/test-slug-proyecto.mts) Puro: dos funciones sobre strings.
// Cubre la normalización, la comparación sin distinguir mayúsculas, el modo contenedor, el proyecto
// en la raíz de una unidad y que la criba es un superconjunto que no casa por prefijo ni por el
// medio.
// =============================================================================

import {
  normalizarNombre,
  carpetaPuedeSerDe,
  esDelProyecto,
  esRutaDeContenedor
} from './slugProyecto.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

function main(): void {
  hr('1. normalizarNombre')
  check(
    'lo no alfanumérico pasa a guion',
    normalizarNombre('Proyecto_ALFA1') === 'Proyecto-ALFA1',
    `Proyecto_ALFA1 -> ${normalizarNombre('Proyecto_ALFA1')}`
  )
  check(
    'los puntos y espacios también',
    normalizarNombre('mi app.v2') === 'mi-app-v2',
    `"mi app.v2" -> ${normalizarNombre('mi app.v2')}`
  )
  check(
    'un nombre ya alfanumérico no cambia',
    normalizarNombre('tessera') === 'tessera',
    'tessera -> tessera'
  )

  hr('2. El caso normal (nombres con la forma de ~/.claude/projects)')
  const real = 'd--Datos-Proyectos-Varios-tessera'
  check(
    'la carpeta de tessera casa con "tessera"',
    carpetaPuedeSerDe(real, 'tessera'),
    real
  )
  check(
    'la carpeta de otro proyecto NO casa con "tessera"',
    !carpetaPuedeSerDe('d--Datos-Proyectos-Varios-ventas', 'tessera'),
    'd--Datos-Proyectos-Varios-ventas vs tessera'
  )

  hr('3. Insensible a mayúsculas (D-- y d-- conviven en disco)')
  check(
    'la misma unidad en MAYÚSCULA casa igual',
    carpetaPuedeSerDe('D--Datos-Proyectos-Varios-tessera', 'tessera'),
    'D--… -> casa'
  )
  check(
    'el proyecto en otra caja también casa',
    carpetaPuedeSerDe('D--Datos-Proyectos-EquipoA-IMPLEMENTACION-NUBE', 'implementacion-nube'),
    'proyecto pedido en minúscula contra carpeta en mayúscula'
  )

  hr('4. Guion bajo en el nombre del proyecto')
  check(
    'Proyecto_ALFA1 casa con su carpeta -Proyecto-ALFA1',
    carpetaPuedeSerDe('d--Datos-Proyectos-Equipo-Proyecto-ALFA1', 'Proyecto_ALFA1'),
    'el guion bajo se normaliza a guion antes de comparar'
  )

  hr('5. Modo contenedor: el cwd es /workspace/<proyecto>')
  check(
    'la carpeta de un cwd de contenedor casa',
    carpetaPuedeSerDe('-workspace-tessera', 'tessera'),
    '-workspace-tessera'
  )

  hr('6. Proyecto en la RAÍZ de una unidad (sin sufijo que cortar)')
  check(
    'la carpeta ES el nombre, sin guion delante',
    carpetaPuedeSerDe('tessera', 'tessera'),
    'igualdad exacta'
  )
  check(
    'D--tessera (raíz de la unidad D:) también casa',
    carpetaPuedeSerDe('D--tessera', 'tessera'),
    'D--tessera'
  )

  hr('7. LA CRIBA ES UN SUPERCONJUNTO (deliberado)')
  check(
    'un proyecto llamado "otra-tessera" PASA la criba de "tessera"',
    carpetaPuedeSerDe('d--Datos-otra-tessera', 'tessera'),
    'pasa la criba; el filtro exacto por cwd es quien lo descarta después'
  )

  hr('8. No casa por prefijo ni por el medio')
  check(
    'pedir NUBE no arrastra la carpeta de cli-admin',
    !carpetaPuedeSerDe('D--Datos-Proyectos-EquipoA-IMPLEMENTACION-NUBE-cli-admin', 'NUBE'),
    'esa carpeta es del proyecto cli-admin, no de NUBE'
  )
  check(
    'esa misma carpeta SÍ casa con cli-admin',
    carpetaPuedeSerDe('D--Datos-Proyectos-EquipoA-IMPLEMENTACION-NUBE-cli-admin', 'cli-admin'),
    'y es lo correcto'
  )

  hr('9. Nombre vacío no abre la puerta a todo')
  check(
    'un nombre vacío no casa con nada',
    !carpetaPuedeSerDe('d--Datos-Proyectos-Varios-tessera', ''),
    'devuelve false en vez de casar por sufijo vacío'
  )
  check(
    'un nombre que normaliza a vacío tampoco',
    !carpetaPuedeSerDe('d--Datos-x', '///'),
    '"///" normaliza a "---" pero no es sufijo de la carpeta'
  )

  hr('10. Un nombre que es sufijo de otro no se cuela al revés')
  check(
    'pedir "api" no arrastra "pagos-api"… sí lo hace, y es correcto (superconjunto)',
    carpetaPuedeSerDe('D--Datos-Proyectos-EquipoB-pagos-api', 'api'),
    'pagos-api termina en -api: pasa la criba, y el filtro exacto lo descarta'
  )
  check(
    'pero pedir "pagos-api" NO arrastra un proyecto llamado solo "api"',
    !carpetaPuedeSerDe('D--Datos-api', 'pagos-api'),
    'la asimetría es la esperada'
  )

  // ---------------------------------------------------------------------------
  hr('esDelProyecto: el FILTRO EXACTO (dos proyectos con el mismo nombre)')
  // ---------------------------------------------------------------------------
  // El caso real: dos carpetas con el mismo nombre en el mismo perfil. Con el basename como
  // filtro, sus historiales se mezclaban y auto-reanudar podía abrir el chat equivocado.
  const NUBE_A = 'D:\\Datos\\Proyectos\\EquipoA\\cli-nube'
  const NUBE_B = 'D:\\Datos\\Proyectos\\EquipoA\\IMPLEMENTACION_NUBE\\cli-nube'

  check(
    'una conversacion se atribuye a SU proyecto',
    esDelProyecto(NUBE_A, NUBE_A),
    'ruta identica'
  )
  check(
    'DOS proyectos que se llaman igual NO se mezclan (el fallo que se corrige)',
    !esDelProyecto(NUBE_A, NUBE_B) && !esDelProyecto(NUBE_B, NUBE_A),
    'cli-nube de EquipoA no es el cli-nube de IMPLEMENTACION_NUBE'
  )
  check(
    'separadores mezclados dan igual',
    esDelProyecto('D:/Datos/Proyectos/EquipoA/cli-nube', NUBE_A),
    'POSIX vs Windows: la misma ruta'
  )
  check(
    'la caja da igual (CC escribe D-- y d-- para la misma unidad)',
    esDelProyecto('d:\\datos\\proyectos\\equipoa\\cli-nube', NUBE_A),
    'comparacion insensible a mayusculas'
  )
  check(
    'una barra final sobrante no rompe la comparacion',
    esDelProyecto(NUBE_A + '\\', NUBE_A),
    'se normaliza'
  )

  // MODO CONTENEDOR: el cwd es /workspace/<nombre> y no hay forma de reconstruir la
  // ruta de Windows, asi que ahi se sigue comparando el ultimo segmento. Es seguro
  // porque SandboxManager.addProject ya resuelve las colisiones de nombre dentro de
  // /workspace y cada perfil tiene su propia base de transcripts.
  check(
    'en contenedor casa por ultimo segmento',
    esDelProyecto('/workspace/cli-nube', NUBE_A),
    '/workspace/cli-nube -> cli-nube'
  )
  check(
    'y en contenedor NO casa un proyecto distinto',
    !esDelProyecto('/workspace/cli-admin', NUBE_A),
    'cli-admin != cli-nube'
  )
  check(
    'entradas vacias nunca casan (no atribuir por defecto)',
    !esDelProyecto('', NUBE_A) && !esDelProyecto(NUBE_A, ''),
    'sin dato no se atribuye'
  )

  // El camino del contenedor solo se toma bajo /workspace: una ruta POSIX que no venga del
  // contenedor (una shell que reporte /d/..., un transcript de otra máquina) usa el filtro exacto.
  check(
    'una ruta POSIX que NO es del contenedor usa el filtro exacto',
    !esDelProyecto('/d/Datos/Proyectos/EquipoA/IMPLEMENTACION_NUBE/cli-nube', NUBE_A),
    'sin /workspace no hay basename suelto'
  )
  check(
    'y tampoco casa un /workspaceX que solo comparte prefijo',
    !esDelProyecto('/workspaceviejo/cli-nube', NUBE_A),
    '/workspaceviejo != /workspace'
  )
  check(
    'la propia raiz /workspace se reconoce como del contenedor',
    esRutaDeContenedor('/workspace') && esRutaDeContenedor('/workspace/algo'),
    'raiz y descendiente'
  )
  check(
    'una ruta de Windows nunca es del contenedor',
    !esRutaDeContenedor(NUBE_A) && !esRutaDeContenedor('/tmp/x'),
    'D:\\... y /tmp fuera'
  )

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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

main()
