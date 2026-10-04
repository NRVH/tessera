# Security policy

Tessera runs AI agents next to your code, your credentials and your databases, so security
reports are taken seriously and handled before anything else.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub Security Advisories:
**[Report a vulnerability](https://github.com/NRVH/tessera/security/advisories/new)**
(the **Security** tab of the repository, then **Report a vulnerability**).

Include, as far as you can:

- what an attacker could do, and under which conditions;
- the steps to reproduce it, or a proof of concept;
- the Tessera version (**Settings › Acerca de**), the operating system and its version,
  and whether the project was in Docker or native mode.

Tessera is maintained by one person, so you will get an answer as soon as possible rather
than within a fixed time. Once the problem is
confirmed, a fix is prepared privately, published in a new release, and the advisory is
made public with credit to you, unless you prefer to stay anonymous.

## Supported versions

Only the **latest release** receives security fixes. Installed copies update themselves,
so the fix reaches users through the normal update.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## What is especially sensitive

These areas carry the security promises of Tessera. A weakness in any of them is in scope:

- **The sandbox.** A workspace's container must see only that workspace's projects, its own
  agent credentials and, read-only, the SSH keys. Anything that lets an agent reach the
  host's files, another workspace's container or credentials, the Docker daemon, or gain
  privileges beyond the container (escapes through mounts, the privileged helper, image
  builds, environment or path handling) is a vulnerability.
- **Agent credentials.** The sign-ins of each workspace and agent are kept apart and mounted
  only while the agent runs. Any way for one workspace or project to read another's
  credentials, or for them to leak into logs, is a vulnerability.
- **Database access and `tdb`.** Passwords are encrypted with the system's secret store, and
  agents query through `tdb` without receiving them. Read-only connections must stay
  read-only for agents. Leaking a password to an agent, bypassing read-only, or using the
  local bridge that `tdb` talks to from outside Tessera is a vulnerability.
- **The boundary between the interface and the main process.** The interface runs isolated
  and must never handle host paths. Path traversal outside a project, or a way for file
  content (Markdown, HTML, SVG, PDF, a decompiled class) to run code in the app, is a
  vulnerability.
- **Updates.** Anything that could make Tessera install a build that did not come from this
  repository's releases.

Out of scope: what an agent does with the access you deliberately give it (a project in
native mode runs with your permissions by design), and problems in Claude Code, Codex,
Docker or other third-party software, which should be reported to their maintainers.
