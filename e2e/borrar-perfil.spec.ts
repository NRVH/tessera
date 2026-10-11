// =============================================================================
// Borrar un perfil, en la app empaquetada: guardar una lista a la que le falta un perfil no borra nada
// suyo (el main lo conserva), y «Eliminar perfil…» se lleva sus conexiones SSH y de bases de datos sin
// tocar las del otro perfil, y no deja el borrado apuntado como pendiente. Datos en un `userData` temporal.
// Decisiones: docs/decisiones/workspace/borrar-perfil-con-orden.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, type SesionTessera } from './tessera'

const perfil = (id: string, nombre: string, color: string): Record<string, unknown> => ({
  id,
  nombre,
  color,
  agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
  sandbox: { habilitado: false }
})

let s: SesionTessera

/** Los ids de perfil de las conexiones SSH, y los alias de las de BD de cada perfil, vistos por el main. */
async function estado(): Promise<{ perfiles: string[]; ssh: string[]; bdPersonal: string[]; bdTrabajo: string[] }> {
  return s.win.evaluate(async () => {
    const lista = await window.tessera.ssh.listar()
    return {
      perfiles: (await window.tessera.getProfiles()).map((p) => p.id),
      ssh: lista.conexiones.map((c) => `${c.profileId}:${c.alias}`).sort(),
      bdPersonal: (await window.tessera.db.list('personal')).map((c) => c.alias),
      bdTrabajo: (await window.tessera.db.list('trabajo')).map((c) => c.alias)
    }
  })
}

test.describe.serial('Borrar un perfil', () => {
  test.beforeAll(async () => {
    s = await abrirTessera({}, {
      sembrar: (datos) =>
        writeFileSync(join(datos, 'profiles.json'), JSON.stringify([perfil('personal', 'Personal', '#9814c8'), perfil('trabajo', 'Trabajo', '#1478c8')]))
    })
    await expect(s.win.locator('.profile-tab', { hasText: 'Trabajo' }).first()).toBeVisible()
    await s.win.evaluate(async () => {
      for (const profileId of ['personal', 'trabajo']) {
        await window.tessera.ssh.crear({
          profileId,
          alias: `ssh-${profileId}`,
          grupoId: null,
          host: '127.0.0.1',
          puerto: 22,
          usuario: 'u',
          metodo: 'sistema',
          disponibleAgentes: true
        })
        await window.tessera.db.create({
          profileId,
          alias: `bd-${profileId}`,
          motor: 'postgres',
          host: '127.0.0.1',
          port: 5432,
          database: 'd',
          user: 'u',
          readonly: true
        } as never)
      }
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
  })

  test('guardar una lista a la que le falta un perfil no borra nada suyo', async () => {
    await s.win.evaluate(async () => {
      const todos = await window.tessera.getProfiles()
      await window.tessera.saveProfiles(todos.filter((p) => p.id !== 'trabajo'))
    })
    const e = await estado()
    expect(e.perfiles).toEqual(['personal', 'trabajo'])
    expect(e.ssh).toEqual(['personal:ssh-personal', 'trabajo:ssh-trabajo'])
    expect(e.bdTrabajo).toEqual(['bd-trabajo'])
    const enDisco = JSON.parse(readFileSync(join(s.datos, 'profiles.json'), 'utf-8')) as { id: string }[]
    expect(enDisco.map((p) => p.id)).toEqual(['personal', 'trabajo'])
  })

  test('«Eliminar perfil…» se lleva sus conexiones SSH y de bases de datos, y solo las suyas', async () => {
    await s.win.locator('.profile-tab', { hasText: 'Trabajo' }).first().click({ button: 'right' })
    await s.win.getByRole('menuitem', { name: 'Eliminar perfil…' }).click()
    await s.win.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(s.win.locator('.profile-tab', { hasText: 'Trabajo' })).toHaveCount(0)
    await expect.poll(async () => (await estado()).ssh).toEqual(['personal:ssh-personal'])
    const e = await estado()
    expect(e.perfiles).toEqual(['personal'])
    expect(e.bdTrabajo).toEqual([])
    expect(e.bdPersonal).toEqual(['bd-personal'])
    const pendientes = join(s.datos, 'perfiles-borrados.json')
    await expect.poll(() => (existsSync(pendientes) ? JSON.parse(readFileSync(pendientes, 'utf-8')).length : 0)).toBe(0)
  })
})
