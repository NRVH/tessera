// =============================================================================
// Las copias congeladas fijan el orden de la cabecera autenticada y la detección del formato:
// una prueba que genera su propia copia no detecta cambios simultáneos del escritor y el lector.
// No se regeneran: cada formato nuevo añade otra copia y conserva las existentes.
// Uso: node src/main/configuracion/test-copias-congeladas.mts
// =============================================================================

import { isDeepStrictEqual } from 'node:util'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { descifrarCopia, leerArchivoCopia } from './cifradoFrase.ts'
import { leerContenido } from './contenido.ts'
import { leerCabeceraCopia, leerTrozos, selloDe } from './trozosCopia.ts'
import { txConfiguracion } from './textos.ts'

const FRASE = 'frase de prueba congelada'
const HISTORIAL = Buffer.from('{"mensaje":"Conversación inventada"}\n'.repeat(120000), 'utf8')
// Sin tipos de producción: un renombrado de sus propiedades no debe actualizar lo esperado.
const ESPERADO = {
  perfiles: [
    { id: 'bosque', nombre: 'Bosque', color: '#238450', agentes: [{ tipo: 'codex', configDir: 'ejemplos/bosque/agente' }], sandbox: { habilitado: true, redHost: false }, reglas: 'Use datos inventados.', contextoGlobal: false },
    { id: 'lago', nombre: 'Lago', color: '#2468ac', agentes: [{ tipo: 'codex', configDir: 'ejemplos/lago/agente' }], sandbox: { habilitado: false }, sshDir: 'ejemplos/lago/ssh' }
  ],
  ssh: {
    grupos: [{ id: 'grupo', profileId: 'bosque', nombre: 'Laboratorio' }],
    conexiones: [{ registro: { id: 'ssh', profileId: 'bosque', grupoId: 'grupo', alias: 'Servidor de ejemplo', host: 'ssh.example.invalid', puerto: 2222, usuario: 'inventado', metodo: 'password', disponibleAgentes: true, tuneles: [{ tipo: 'local', puerto: 15432, destinoHost: 'bd.example.invalid', destinoPuerto: 5432 }] }, secreto: 'secreto inventado', huellas: 'ssh.example.invalid ssh-ed25519 HuellaInventada' }]
  },
  bd: [
    { registro: { id: 'pg', profileId: 'bosque', alias: 'Almacén', motor: 'postgres', host: 'pg.example.invalid', port: 5432, user: 'inventado', database: 'ejemplo', readonly: true, tunelSsh: { conexionId: 'ssh' } }, secreto: 'secreto pg inventado' },
    { registro: { id: 'sql', profileId: 'lago', alias: 'Catálogo', motor: 'sqlserver', host: 'sql.example.invalid', port: 1433, user: 'inventado', readonly: false, tls: { cifrar: true, confiarCertificado: true } }, secreto: 'secreto sql inventado' },
    { registro: { id: 'redis', profileId: 'lago', alias: 'Cola', motor: 'redis', host: 'sentinel.example.invalid:26379', port: 26379, user: 'inventado', readonly: false, topologiaRedis: { modo: 'sentinel', maestro: 'maestro-ejemplo', claveSentinel: 'misma' } }, secreto: 'secreto redis inventado' }
  ],
  agentes: {
    nativos: [{ id: 'm-lince', nombre: 'Lince', comando: 'lince', reanudar: '--reanudar', enTerminal: true, contexto: { origen: 'comando', valor: 'lince estado', usado: 'uso.tokens', maximo: '200000' } }],
    dockerPorPerfil: {}, ocultosPorPerfil: { lago: ['m-lince'] }
  },
  ajustes: {
    zoomLevel: 1, hideProfileNames: true, activityBarOrder: ['db', 'files', 'git'], bottomBarOrder: ['gitlog', 'terminal'],
    terminalFontFamily: 'monospace', terminalFontSize: 17, terminalResaltado: false,
    agentFontFamily: 'monospace', agentFontSize: 18, editorFontFamily: 'monospace', editorFontSize: 19,
    editorTema: 'claro', uiFontSize: 15, explorerFontSize: 16, gitFontSize: 17,
    aplicarUpdateAlCerrar: false, registroSalud: false, volcadosCaida: false, diffColapsarSinCambios: true,
    paquetesExtraSandbox: ['jq'], sandboxDepsNavegador: true, mosaicoPreset: 'columnas', coloresPerfilFijados: ['#123456'],
    dbFontSize: 18, dbFilasPorPagina: 200, dbTxInicial: 'manual', dbConsolaInactividadMin: 60,
    agenteInactividadMin: 15, primeroEnPararse: 'primeros', protegerTrabajando: false,
    saturacionUmbral: 80, saturacionSegundos: 60, avisarAntesDeParar: false
  }
}
const INDICE = { fuentes: [{ id: 0, agente: 'codex', perfil: 'bosque', cuenta: 'cuenta-ejemplo', predeterminada: true, conversaciones: 1, bytes: HISTORIAL.length, proyectos: { 'proyecto-ejemplo': 'ejemplos/bosque/proyecto' } }] }

const resultados: boolean[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia = ''): void {
  resultados.push(pasa)
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

async function comprobar(nombre: string, version: number): Promise<void> {
  hr(nombre)
  const ruta = fileURLToPath(new URL(`./copias-congeladas/${nombre}.tessera`, import.meta.url))
  const cabecera = await leerCabeceraCopia(ruta)
  check('se detecta el formato desde disco', cabecera.ok, cabecera.ok ? '' : cabecera.error)
  if (!cabecera.ok) return
  const a = cabecera.archivo
  check('se conserva la versión y el cifrado de coste mínimo', a.version === version && a.cifrado?.kdf === 'scrypt' && a.cifrado.N === 2 && a.cifrado.r === 1 && a.cifrado.p === 1)
  check('la cabecera conserva sus datos autenticados', a.tessera === 'configuracion' && a.creado === '2026-01-01T00:00:00.000Z' && a.plataforma === 'linux' && a.app === '0.0.0')
  check('se reconoce la presencia de historial', version === 1 ? cabecera.hash === null && a.historial === undefined : cabecera.hash !== null && isDeepStrictEqual(a.historial, { compresion: 'zstd', trozo: 4194304 }))
  if (version === 1) {
    const leido = leerArchivoCopia(await readFile(ruta, 'utf8'))
    check('el lector de texto de v1 acepta la copia', leido.ok && isDeepStrictEqual(leido.archivo, a))
  }
  const mal = await descifrarCopia(a, 'frase de prueba congeladb')
  check('un carácter distinto rechaza la frase', !mal.ok && mal.error === txConfiguracion().archivo.fraseMala)
  const abierto = await descifrarCopia(a, FRASE)
  check('la frase conocida autentica y descifra', abierto.ok, abierto.ok ? '' : abierto.error)
  if (!abierto.ok) return
  const esperado = version === 1 ? ESPERADO : { ...ESPERADO, historial: INDICE }
  check('el JSON descifrado conserva todos los campos', isDeepStrictEqual(JSON.parse(abierto.contenido), esperado))
  const contenido = leerContenido(abierto.contenido)
  check('el lector actual conserva todo el contenido sin perfiles inválidos', contenido?.invalidos === 0 && isDeepStrictEqual(contenido.contenido, esperado))
  if (version === 2 && cabecera.hash !== null) {
    const sello = selloDe(cabecera.hash, abierto.clave, a.cifrado?.sal ?? null)
    const datos: Buffer[] = []
    const metas: unknown[] = []
    for await (const trozo of leerTrozos(ruta, cabecera.hash, sello)) {
      metas.push(trozo.meta)
      datos.push(trozo.datos)
    }
    check('se reconocen los dos trozos de la fuente y su cierre', isDeepStrictEqual(metas, [
      { t: 'archivo', i: 0, fuente: 0, ruta: 'conversaciones/ejemplo.jsonl', parte: 0, ultima: false },
      { t: 'archivo', i: 1, fuente: 0, ruta: 'conversaciones/ejemplo.jsonl', parte: 1, ultima: true }
    ]))
    check('el historial se reconstruye byte a byte', Buffer.concat(datos).equals(HISTORIAL))
  }
}

for (const [nombre, version] of [['v1-sin-historial', 1], ['v2-con-historial', 2]] as const) {
  try {
    await comprobar(nombre, version)
  } catch (error) {
    check(`${nombre}: lectura completa`, false, String(error))
  }
}
const pasan = resultados.filter(Boolean).length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS`)
process.exit(pasan === resultados.length ? 0 : 1)
