#!/usr/bin/env node
// =============================================================================
// Prueba de `vistaHtml`: qué recursos de un .html no cargan en la vista previa y qué dice el aviso.
// (node src/renderer/src/features/editor/test-vista-html.mts)
// Fija que cuentan las relativas (también las que empiezan por "/") y las absolutas (la CSP
// bloquea la red), que solo cuentan los subrecursos y no los enlaces, que lo embebido y las
// anclas no cuentan, y que el texto del aviso encaja con cada combinación.
// =============================================================================

import { avisoVistaHtml, recursosBloqueados, tieneRecursosBloqueados } from './vistaHtml.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL
// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78) + `\n${title}\n` + '='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: unknown = ''): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence === '' ? '' : ` -> ${String(evidence)}`}`)
}

/** Azúcar: las URLs detectadas, sin el motivo. */
const urls = (html: string): string[] => recursosBloqueados(html).map((r) => r.url)
/** Azúcar: el motivo de una URL concreta. */
const motivo = (html: string, url: string): string | undefined =>
  recursosBloqueados(html).find((r) => r.url === url)?.motivo

hr('(1) Rutas RELATIVAS: no resuelven porque el blob no tiene carpeta')
{
  const html = `
    <link rel="stylesheet" href="estilo.css">
    <img src="img/logo.png">
    <script src="./app.js"></script>
    <img src="/raiz/desde-la-raiz.png">
  `
  check('la hoja de estilos', urls(html).includes('estilo.css'), urls(html).join(', '))
  check('la imagen', urls(html).includes('img/logo.png'))
  check('el script con ./', urls(html).includes('./app.js'))
  // Una ruta "/algo" SÍ resuelve... contra el origen de Tessera, que no es donde está
  // el archivo. Da 404 igual, así que hay que avisar.
  check('y la que empieza por "/"', urls(html).includes('/raiz/desde-la-raiz.png'))
  check('todas con motivo "relativo"', recursosBloqueados(html).every((r) => r.motivo === 'relativo'))
  check('el atajo dice que sí', tieneRecursosBloqueados(html) === true)
}

hr('(2) Rutas ABSOLUTAS: resuelven, pero la CSP heredada las bloquea')
{
  const html = `
    <link rel="stylesheet" href="https://cdn.example.com/bootstrap.css">
    <script src="//cdn.example.com/b.js"></script>
  `
  check('el CSS de un CDN cuenta', urls(html).includes('https://cdn.example.com/bootstrap.css'))
  check('y el script con protocolo relativo', urls(html).includes('//cdn.example.com/b.js'))
  check(
    'con motivo "red", no "relativo"',
    motivo(html, 'https://cdn.example.com/bootstrap.css') === 'red',
    motivo(html, 'https://cdn.example.com/bootstrap.css')
  )
  // Una página cuyo ÚNICO estilo es un CDN saldría sin formato: tiene que avisar.
  check(
    'una página cuyo único CSS es un CDN SÍ avisa',
    tieneRecursosBloqueados('<link rel="stylesheet" href="https://cdn.x/a.css">') === true
  )
}

hr('(3) Sólo SUBRECURSOS: un enlace no carga nada')
{
  check(
    'un <a href> relativo NO cuenta',
    urls('<a href="../otra.html">otra</a>').length === 0,
    urls('<a href="../otra.html">otra</a>').join(',')
  )
  check('ni un <a href> absoluto', urls('<a href="https://example.com">web</a>').length === 0)
  check('ni un mailto', urls('<a href="mailto:a@b.c">correo</a>').length === 0)
  // Pero el href de un <link> SÍ, que es donde vive la hoja de estilos.
  check('el href de un <link> sí cuenta', urls('<link rel="stylesheet" href="a.css">').includes('a.css'))
  check(
    'y con atributos por medio también',
    urls('<link rel="preload" as="style" href="b.css">').includes('b.css')
  )
}

hr('(4) Lo que no es una petición o va embebido')
{
  check('data: no cuenta', urls('<img src="data:image/gif;base64,R0lGOD">').length === 0)
  check('blob: tampoco', urls('<img src="blob:http://localhost/abc">').length === 0)
  check('un ancla tampoco', urls('<link href="#x">').length === 0)
  check('un src vacío tampoco', urls('<img src="">').length === 0)
  check(
    'un HTML con el estilo embebido no avisa',
    tieneRecursosBloqueados('<html><head><style>body{color:red}</style></head><body>hola</body></html>') === false
  )
  check('HTML vacío tampoco', tieneRecursosBloqueados('') === false)
}

hr('(5) El texto del aviso encaja con lo que falla')
{
  check('sin nada que avisar, no hay aviso', avisoVistaHtml('<p>hola</p>') === null)

  const soloRelativos = avisoVistaHtml('<link rel="stylesheet" href="a.css">') ?? ''
  check('sólo relativos: habla de la carpeta', soloRelativos.includes('sin su carpeta'), soloRelativos)
  check('sólo relativos: NO habla de la red', !soloRelativos.includes('no sale a la red'))

  const soloRed = avisoVistaHtml('<link rel="stylesheet" href="https://cdn.x/a.css">') ?? ''
  check('sólo red: habla de la red', soloRed.includes('no sale a la red'), soloRed)
  check('sólo red: NO habla de la carpeta', !soloRed.includes('sin su carpeta'))

  const ambos = avisoVistaHtml('<link rel="stylesheet" href="a.css"><script src="https://cdn.x/b.js"></script>') ?? ''
  check('los dos: menciona las dos causas', ambos.includes('sin su carpeta') && ambos.includes('no sale a la red'), ambos)
  check('y siempre recuerda que no hay JavaScript', ambos.includes('Tampoco se ejecuta JavaScript'))
}

hr('(6) Tope y duplicados')
{
  const muchas = Array.from({ length: 20 }, (_, i) => `<img src="f${i}.png">`).join('')
  check('el tope por defecto corta en 6', recursosBloqueados(muchas).length === 6, recursosBloqueados(muchas).length)
  check('y se puede pedir menos', recursosBloqueados(muchas, 2).length === 2)
  check('sin duplicados', urls('<img src="x.png"><img src="x.png">').length === 1)
}

hr('(7) Las tres formas de escribir un atributo')
{
  check('comillas dobles', urls('<img src="a.png">').includes('a.png'))
  check('comillas simples', urls("<img src='b.png'>").includes('b.png'))
  check('sin comillas', urls('<img src=c.png>').includes('c.png'))
  check('con espacios alrededor del igual', urls('<img src = "d.png">').includes('d.png'))
  check('mayúsculas en el atributo', urls('<IMG SRC="e.png">').includes('e.png'))
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const ok = results.filter((r) => r.pass).length
const allPass = ok === results.length
console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${ok}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
