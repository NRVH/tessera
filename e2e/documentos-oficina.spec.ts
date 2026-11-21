// =============================================================================
// Selección y apertura externa desde el árbol, saneado al arrancar y diffs de oficina.
// El arnés registra cada llamada al escritorio en un archivo temporal sin abrir aplicaciones.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const DOCUMENTO = 'acta.docx'
const HOJA = 'datos.xlsx'
const TEXTO = 'datos.csv'

function sembrar(datos: string, repo: string, conDocumento: boolean): void {
  writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
  const clave = `personal|${repo}`
  writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({
    version: 1,
    activeProfileId: 'personal',
    byProfile: { personal: { openProjects: [{ projectHostPath: repo, name: 'repo', estado: 'active' }], activePath: repo } },
    settings: { defaultProjectMode: 'windows', windowsModeProjects: [clave] },
    sesiones: {
      [clave]: { pestanas: conDocumento ? [{ ruta: TEXTO }, { ruta: DOCUMENTO }] : [{ ruta: TEXTO }], activa: conDocumento ? DOCUMENTO : TEXTO }
    }
  }))
}

function aperturas(s: SesionTessera): string[] {
  const registro = join(s.datos, 'aperturas-e2e.jsonl')
  if (!existsSync(registro)) return []
  return readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((linea) => JSON.parse(linea) as string)
}

test.describe('documentos de oficina', () => {
  let s: SesionTessera | undefined
  let agentes: ReturnType<typeof montarAgenteFalso>
  let repo: string

  test.beforeEach(() => {
    agentes = montarAgenteFalso()
    repo = join(agentes.raiz, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, DOCUMENTO), 'contenido de prueba')
    writeFileSync(join(repo, HOJA), 'contenido de prueba')
    writeFileSync(join(repo, TEXTO), 'nombre,valor\nuno,1\n')
  })

  test.afterEach(async () => {
    await s?.cerrar()
    s = undefined
    if (agentes) await borrarTemporal(agentes.raiz)
  })

  async function arrancar(conDocumento = false, error = ''): Promise<SesionTessera> {
    s = await abrirTessera({ ...agentes.env, TESSERA_E2E_ERROR_APERTURA: error }, {
      sembrar: (datos) => sembrar(datos, repo, conDocumento)
    })
    await expect(s.ventana.locator('.editor-tab.active')).toHaveText(TEXTO, { timeout: 30_000 })
    return s
  }

  test('el clic simple selecciona un DOCX y el doble clic lo abre una vez', async () => {
    const sesion = await arrancar()
    const ventana = sesion.ventana
    const fila = ventana.locator('.sidebar .tree-row:visible', { hasText: DOCUMENTO })
    const aviso = ventana.getByRole('status').filter({ hasText: `Se está abriendo "${DOCUMENTO}" con la aplicación del sistema.` })
    await fila.click()
    await expect(fila).toHaveClass(/seleccionada/)
    await expect(aviso).toHaveCount(0)
    expect(aperturas(sesion)).toEqual([])
    await expect(ventana.locator('.editor-tab')).toHaveCount(1)
    await expect(ventana.locator('.editor-tab.active')).toHaveText(TEXTO)
    await fila.dblclick()
    await expect(aviso).toHaveCount(1)
    await expect.poll(() => aperturas(sesion)).toEqual([join(repo, DOCUMENTO)])
    await expect(ventana.locator('.editor-tab')).toHaveCount(1)
    await expect(ventana.locator('.editor-tab.active')).toHaveText(TEXTO)
  })

  test('las flechas no abren un documento y la tecla de apertura lo abre una vez', async () => {
    const sesion = await arrancar()
    const ventana = sesion.ventana
    const esperadas: string[] = []
    for (const nombre of [DOCUMENTO, HOJA]) {
      const fila = ventana.locator('.sidebar .tree-row:visible', { hasText: nombre })
      await fila.press('ArrowDown')
      expect(aperturas(sesion)).toEqual(esperadas)
      await fila.press('Enter')
      esperadas.push(join(repo, nombre))
      await expect.poll(() => aperturas(sesion)).toEqual(esperadas)
    }
    await expect(ventana.locator('.editor-tab')).toHaveCount(1)
    await expect(ventana.locator('.editor-tab.active')).toHaveText(TEXTO)
  })

  for (const [error, texto] of [
    ['No application found to open URL', 'no hay ninguna aplicación asociada a los archivos .docx. Instale una o elija con cuál abrirlos desde'],
    ['Permiso denegado', 'Permiso denegado']
  ]) {
    test(`el aviso de error conserva el motivo: ${error}`, async () => {
      const sesion = await arrancar(false, error)
      const ventana = sesion.ventana
      await ventana.locator('.sidebar .tree-row:visible', { hasText: DOCUMENTO }).dblclick()
      await expect(ventana.getByRole('alert').filter({ hasText: `No se pudo abrir "${DOCUMENTO}": ${texto}` })).toBeVisible()
      expect(aperturas(sesion)).toEqual([join(repo, DOCUMENTO)])
      await expect(ventana.locator('.editor-tab')).toHaveCount(1)
      await expect(ventana.locator('.editor-tab.active')).toHaveText(TEXTO)
    })
  }

  test('el aviso de un error del sistema sustituye la ruta absoluta por el nombre del archivo', async () => {
    const sesion = await arrancar(false, `Permiso denegado al abrir ${join(repo, DOCUMENTO)}`)
    const ventana = sesion.ventana
    await ventana.locator('.sidebar .tree-row:visible', { hasText: DOCUMENTO }).dblclick()
    const alerta = ventana.locator('.toast.toast-error')
    await expect(alerta).toContainText(`No se pudo abrir "${DOCUMENTO}": Permiso denegado al abrir ${DOCUMENTO}`)
    await expect(alerta).not.toContainText(repo)
    await expect(alerta).not.toContainText('ENOENT')
  })

  test('el aviso de un archivo que ya no existe usa el texto redactado y sin rutas', async () => {
    const sesion = await arrancar()
    const ventana = sesion.ventana
    const fila = ventana.locator('.sidebar .tree-row:visible', { hasText: DOCUMENTO })
    await fila.focus()
    rmSync(join(repo, DOCUMENTO))
    await fila.press('Enter')
    const alerta = ventana.locator('.toast.toast-error')
    await expect(alerta).toContainText(`No se pudo abrir "${DOCUMENTO}": el archivo ya no existe.`)
    await expect(alerta).not.toContainText('ENOENT')
    await expect(alerta).not.toContainText(repo)
    expect(aperturas(sesion)).toEqual([])
  })

  test('crear un archivo de oficina no llama a la apertura externa', async () => {
    const sesion = await arrancar()
    const ventana = sesion.ventana
    await ventana.getByRole('button', { name: 'Nuevo archivo' }).click()
    const dialogo = ventana.getByRole('dialog')
    await dialogo.getByRole('textbox').fill('nuevo.docx')
    await dialogo.getByRole('button', { name: 'Crear' }).click()
    await expect(ventana.locator('.sidebar .tree-row:visible', { hasText: 'nuevo.docx' })).toBeVisible()
    expect(aperturas(sesion)).toEqual([])
    await expect(ventana.locator('.editor-tab')).toHaveCount(1)
    await expect(ventana.locator('.editor-tab.active')).toHaveText(TEXTO)
  })

  test('un clic sobre un DOCX selecciona su carpeta sin abrirlo', async () => {
    mkdirSync(join(repo, 'sub'))
    writeFileSync(join(repo, 'sub', 'informe.docx'), 'contenido de prueba')
    const sesion = await arrancar()
    const ventana = sesion.ventana
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'sub' }).click()
    await ventana.locator('.sidebar .tree-row:visible', { hasText: TEXTO }).click()
    const botonNuevo = ventana.getByRole('button', { name: 'Nuevo archivo' })
    await expect(botonNuevo).toHaveAttribute('title', 'Nuevo archivo')
    await ventana.locator('.sidebar .tree-row:visible', { hasText: 'informe.docx' }).click()
    await expect(botonNuevo).toHaveAttribute('title', 'Nuevo archivo en "sub"')
    expect(aperturas(sesion)).toEqual([])
    await expect(ventana.locator('.editor-tab')).toHaveCount(1)
    await expect(ventana.locator('.editor-tab.active')).toHaveText(TEXTO)
  })

  test('arranca sin el documento de la sesión y sin apertura externa', async () => {
    const sesion = await arrancar(true)
    await expect(sesion.ventana.locator('.editor-tab')).toHaveText([TEXTO])
    expect(aperturas(sesion)).toEqual([])
  })

  test('Git muestra el diff binario sin lanzar el documento', async () => {
    const git = (...argumentos: string[]): void => {
      execFileSync('git', ['-c', 'user.name=Pruebas', '-c', 'user.email=pruebas@example.invalid', ...argumentos], {
        cwd: repo, stdio: 'ignore', timeout: 10_000
      })
    }
    git('init', '-q')
    git('add', '.')
    git('commit', '-qm', 'Versión inicial')
    writeFileSync(join(repo, DOCUMENTO), 'revisión de prueba')
    const sesion = await arrancar()
    const ventana = sesion.ventana
    await ventana.getByRole('button', { name: /^Git · Cambios/ }).click()
    const fila = ventana.locator('.git-panel .git-arbol-fila', { hasText: DOCUMENTO })
    await fila.click()
    await fila.press('ArrowDown')
    await expect(ventana.locator('.editor-tab')).toHaveCount(1)
    await fila.dblclick()
    await expect(ventana.getByText('Archivo binario: no hay un diff de texto que mostrar.')).toBeVisible()
    expect(aperturas(sesion)).toEqual([])
  })
})
