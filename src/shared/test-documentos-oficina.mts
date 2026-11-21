// =============================================================================
// Comprueba qué extensiones se delegan al sistema y cómo se leen desde una ruta.
// Puro: no consulta asociaciones ni abre ninguna aplicación.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { extensionDeOficina } from './documentosOficina.ts'

function hr(titulo: string): void {
  console.log('\n' + '='.repeat(64) + '\n' + titulo)
}

let total = 0
let correctas = 0

function check(ruta: string, esperada: string | null): void {
  total++
  const extension = extensionDeOficina(ruta)
  const coincide = extension === esperada
  if (coincide) correctas++
  console.log(`[${coincide ? 'PASS' : 'FAIL'}] ${ruta}: ${extension} (esperada: ${esperada})`)
}

hr('Formatos de oficina, con cualquier capitalización')
for (const ext of 'doc docx docm dotx xls xlsx xlsm xlsb xlt xltx ppt pptx pptm pps ppsx odt ods odp'.split(' ')) {
  check(`carpeta/Informe final.${ext}`, ext)
  check(`Informe.${ext.toUpperCase()}`, ext)
}
check('paquete.jar!/docs/Informe.docx', 'docx')

hr('Formatos de texto excluidos de Office y extensión del último tramo')
for (const ruta of ['grafo.dot', 'GRAFO.DOT', 'nota.rtf', 'NOTA.RTF', 'reporte.csv', 'informe.pdf', 'informe.docx.txt', 'datos.xlsx/README', '.docx', 'informe.', 'informe']) {
  check(ruta, null)
}

hr(`VEREDICTO: ${correctas}/${total} PASS`)
process.exit(correctas === total ? 0 : 1)
