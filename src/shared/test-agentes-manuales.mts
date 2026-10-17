// =============================================================================
// Pruebas de `agentesManuales.ts`: el id que sale del nombre (seguro para rutas y `sh`, único),
// la validación de cada campo, la limpieza de lo leído del disco, la copia en JSON de ida y
// vuelta y la invocación que se lanza.
// Uso: node src/shared/test-agentes-manuales.mts
// =============================================================================

import {
  definicionComoJson,
  definicionDesdeJson,
  esAgenteManual,
  idDesdeNombre,
  invocacionAgenteManual,
  normalizarDefiniciones,
  programaDelComando,
  validarDefinicion,
  type DefinicionAgente
} from './agentesManuales.ts'
import { normalizeWorkspaceState } from './workspace-state-ipc.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const base: DefinicionAgente = { id: 'm-lince', nombre: 'Lince', comando: 'lince' }

function ids(): void {
  hr('(1) El id que sale del nombre')
  check('minúsculas y guiones', idDesdeNombre('Mi Agente', []) === 'm-mi-agente', idDesdeNombre('Mi Agente', []))
  check('sin tildes ni eñes', idDesdeNombre('Ñandú Código', []) === 'm-nandu-codigo', idDesdeNombre('Ñandú Código', []))
  const raro = idDesdeNombre(`a'; rm -rf / #`, [])
  check('nada que una shell interprete', esAgenteManual(raro) && /^m-[a-z0-9-]+$/.test(raro), raro)
  check('un nombre sin letras ni cifras da «agente»', idDesdeNombre('¡¡¡', []) === 'm-agente', idDesdeNombre('¡¡¡', []))
  check('repetido: lleva número', idDesdeNombre('Lince', ['m-lince', 'm-lince-2']) === 'm-lince-3', idDesdeNombre('Lince', ['m-lince', 'm-lince-2']))
  const largo = idDesdeNombre('x'.repeat(80), [])
  check('largo: recortado y válido', esAgenteManual(largo) && largo.length <= 26, largo)
  check('NEGATIVO: los de serie no son manuales', !esAgenteManual('claude-code') && !esAgenteManual('codex'), '')
  check('NEGATIVO: un id con barra o punto no vale', !esAgenteManual('m-../x') && !esAgenteManual('m-a/b'), '')
}

function validacion(): void {
  hr('(2) Validación')
  const ok = validarDefinicion({ ...base, reanudar: ' --continue ', enTerminal: true }, false)
  check('válida, con espacios recortados', ok.ok && ok.valor.reanudar === '--continue' && ok.valor.enTerminal === true, JSON.stringify(ok))
  const sinComando = validarDefinicion({ ...base, comando: '   ' }, false)
  check('sin comando: error', !sinComando.ok && sinComando.error === 'Falta el comando.', JSON.stringify(sinComando))
  const multilinea = validarDefinicion({ ...base, comando: 'lince\nrm -rf ~' }, false)
  check('comando de varias líneas: error', !multilinea.ok && /una sola línea/.test(multilinea.error), JSON.stringify(multilinea))
  const instNativo = validarDefinicion({ ...base, instalacion: 'npm i -g lince' }, false)
  check('instalación en nativo: error', !instNativo.ok && /solo existen en Docker/.test(instNativo.error), JSON.stringify(instNativo))
  const instDocker = validarDefinicion({ ...base, instalacion: 'apt-get update\r\nnpm i -g lince\n' }, true)
  check('instalación en Docker: varias líneas, CRLF a LF', instDocker.ok && instDocker.valor.instalacion === 'apt-get update\nnpm i -g lince', JSON.stringify(instDocker))
  const nombreLargo = validarDefinicion({ ...base, nombre: 'x'.repeat(41) }, false)
  check('nombre de más de 40: error', !nombreLargo.ok, JSON.stringify(nombreLargo))
  const idMalo = validarDefinicion({ ...base, id: 'claude-code' }, false)
  check('NEGATIVO: no se puede hacer pasar por uno de serie', !idMalo.ok, JSON.stringify(idMalo))
  const enTerminalNoBool = validarDefinicion({ ...base, enTerminal: 'sí' }, false)
  check('enTerminal solo con true', enTerminalNoBool.ok && enTerminalNoBool.valor.enTerminal === undefined, JSON.stringify(enTerminalNoBool))
}

function disco(): void {
  hr('(3) Lo leído del disco')
  const lista = normalizarDefiniciones([base, { ...base, nombre: 'Otro' }, { id: 'x' }, 'basura', { ...base, id: 'm-otro', comando: '' }], false)
  check('se quedan las válidas y sin ids repetidos', lista.length === 1 && lista[0].nombre === 'Lince', JSON.stringify(lista))
  check('algo que no es lista: vacía', normalizarDefiniciones({ a: 1 }, false).length === 0, '')
}

function json(): void {
  hr('(4) Copiar y pegar como JSON')
  const d: DefinicionAgente = { ...base, reanudar: '--continue', instalacion: 'npm i -g lince', enTerminal: true }
  const texto = definicionComoJson(d)
  check('la copia no lleva el id', !texto.includes('m-lince') && texto.includes('"tessera": "agente"'), texto)
  const enDocker = definicionDesdeJson(texto, ['m-lince'], true)
  check('pegada en Docker: id nuevo y todo lo demás igual',
    enDocker.ok && enDocker.valor.id === 'm-lince-2' && enDocker.valor.instalacion === 'npm i -g lince' && enDocker.valor.enTerminal === true, JSON.stringify(enDocker))
  const enNativo = definicionDesdeJson(texto, [], false)
  check('pegada en nativo: sin las órdenes de instalación', enNativo.ok && enNativo.valor.instalacion === undefined, JSON.stringify(enNativo))
  const futura = definicionDesdeJson(JSON.stringify({ tessera: 'agente', version: 99, nombre: 'X', comando: 'x' }), [], false)
  check('de una Tessera más nueva: error que lo dice', !futura.ok && /más nueva/.test(futura.error), JSON.stringify(futura))
  const ajena = definicionDesdeJson('{"nombre":"X","comando":"x"}', [], false)
  check('un JSON que no es de Tessera: error', !ajena.ok, JSON.stringify(ajena))
  const roto = definicionDesdeJson('{no es json', [], false)
  check('texto que no es JSON: error', !roto.ok && roto.error === 'El texto pegado no es JSON.', JSON.stringify(roto))
}

function lanzamiento(): void {
  hr('(5) Lo que se lanza')
  const d: DefinicionAgente = { ...base, comando: 'npx lince --modo rapido', reanudar: '--continue' }
  check('al abrir, con reanudar', invocacionAgenteManual(d, true) === 'npx lince --modo rapido --continue', invocacionAgenteManual(d, true))
  check('conversación nueva, sin reanudar', invocacionAgenteManual(d, false) === 'npx lince --modo rapido', invocacionAgenteManual(d, false))
  check('sin cómo reanudar, siempre igual', invocacionAgenteManual(base, true) === 'lince', invocacionAgenteManual(base, true))
  check('el programa: la primera palabra', programaDelComando('npx lince --x') === 'npx', programaDelComando('npx lince --x'))
  check('el programa entre comillas', programaDelComando('"C:/Mis cosas/lince.exe" --x') === 'C:/Mis cosas/lince.exe', programaDelComando('"C:/Mis cosas/lince.exe" --x'))
}

function ajustes(): void {
  hr('(6) Lo guardado en los ajustes, al leerlo')
  const leido = normalizeWorkspaceState({
    version: 1,
    activeProfileId: null,
    byProfile: {},
    settings: {
      agentesNativos: [base, { id: 'malo' }],
      agentesDockerPorPerfil: { trabajo: [{ ...base, instalacion: 'npm i -g lince' }], vacio: [] },
      agentesOcultosPorPerfil: { trabajo: ['codex', 'codex', 'm-lince', 'desconocido', 'M-MAL', 7], nada: 'x', vacio: [] },
      ordenAgentesPorPerfil: { trabajo: ['m-lince', 'claude-code', 'm-lince', 'otro'], lista: 'x' },
      selectorAgentes: 'lista'
    }
  })
  const s = leido?.settings
  check('nativos: los válidos', s?.agentesNativos.length === 1 && s.agentesNativos[0].id === 'm-lince', JSON.stringify(s?.agentesNativos))
  check('Docker por perfil, con sus órdenes; sin perfiles vacíos',
    s?.agentesDockerPorPerfil.trabajo?.[0].instalacion === 'npm i -g lince' && !('vacio' in (s?.agentesDockerPorPerfil ?? {})), JSON.stringify(s?.agentesDockerPorPerfil))
  check('ocultos: de serie y manuales, sin repetir ni ids inválidos ni perfiles vacíos',
    JSON.stringify(s?.agentesOcultosPorPerfil) === '{"trabajo":["codex","m-lince"]}', JSON.stringify(s?.agentesOcultosPorPerfil))
  check('orden: ids de agente sin repetir; una lista que no es lista se descarta',
    JSON.stringify(s?.ordenAgentesPorPerfil) === '{"trabajo":["m-lince","claude-code"]}', JSON.stringify(s?.ordenAgentesPorPerfil))
  check('selector: «lista» se respeta', s?.selectorAgentes === 'lista', String(s?.selectorAgentes))
  // Lo que guardaba la versión anterior: solo ocultos de serie, sin orden ni selector.
  const viejo = normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: { agentesOcultosPorPerfil: { personal: ['claude-code'] } } })?.settings
  check('migración: los ocultos de serie de antes se conservan tal cual', JSON.stringify(viejo?.agentesOcultosPorPerfil) === '{"personal":["claude-code"]}', JSON.stringify(viejo?.agentesOcultosPorPerfil))
  check('migración: sin orden guardado, ninguno; sin selector, pestañas',
    JSON.stringify(viejo?.ordenAgentesPorPerfil) === '{}' && viejo?.selectorAgentes === 'pestanas', `${JSON.stringify(viejo?.ordenAgentesPorPerfil)} ${viejo?.selectorAgentes}`)
  const raro = normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: { selectorAgentes: 'cuadricula', ordenAgentesPorPerfil: ['codex'] } })?.settings
  check('NEGATIVO: un selector desconocido cae a pestañas y un orden que es lista suelta, a nada',
    raro?.selectorAgentes === 'pestanas' && JSON.stringify(raro?.ordenAgentesPorPerfil) === '{}', `${raro?.selectorAgentes} ${JSON.stringify(raro?.ordenAgentesPorPerfil)}`)
  const sinNada = normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings: {} })?.settings
  check('un archivo de antes: todo vacío', sinNada?.agentesNativos.length === 0 && Object.keys(sinNada.agentesDockerPorPerfil).length === 0, '')
}

ids()
validacion()
disco()
json()
lanzamiento()
ajustes()
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
