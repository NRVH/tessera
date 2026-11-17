# El SSH del usuario se utiliza por permiso de perfil y sus claves privadas permanecen en el host

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/agente/`, `src/main/sandbox/gestor/montajes.ts`,
  `gestor/nombres.ts`, `src/main/agentes/gitEnContenedor.ts` y `src/tssh/ssh-agente.cjs`.

## Decisión

El SSH global no se monta en los contenedores. Tampoco se monta la carpeta SSH propia de un perfil.
Cada perfil autoriza las claves del sistema o de su propia carpeta que sus agentes pueden utilizar.
El catálogo reconoce los `IdentityFile` del config (incluidos sus includes) y los nombres estándar de `~/.ssh`.

El host genera únicamente configuración y material público para las claves autorizadas. Los alias conservan
sus destinos; cada `IdentityFile` apunta a una pública y su destino queda con `IdentitiesOnly`. El programa del contenedor
abre un socket de agente SSH y pide al host identidades o firmas por el buzón autenticado. El token determina
el perfil y cada firma vuelve a comprobar sus permisos. La frase y la privada nunca salen del host.

El protocolo, los formatos admitidos, los límites, la auditoría y las reglas de compatibilidad se definen en
[`agente-del-contenedor.md`](../ssh/agente-del-contenedor.md).
No existe un contrato de montajes SSH ni un `sshSetup` que atraviese los lanzadores: todos preparan únicamente
el socket y el material público mediante el buzón. El mismo preludio se aplica a las terminales Docker interactivas.

## Consecuencias

- Perfil existente sin lista: todas sus claves descubiertas permitidas; perfil nuevo: ninguna.
- Las firmas se registran por perfil, huella y momento en `logs/ssh.log`.
- El contenedor recibe `known_hosts`, públicas y config generado; nunca se copia una carpeta SSH completa.
- `test:ssh-config` fija que las rutas privadas no aparecen ni se proponen montajes en ninguna plataforma.
- Las pruebas del agente SSH ejercen claves reales, permisos y firmas sin Docker; la integración del socket
  y las conexiones reales necesitan Docker.
