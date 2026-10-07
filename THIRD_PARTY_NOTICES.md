# Avisos de terceros

Tessera se publica bajo la [licencia MIT](./LICENSE). Está construida sobre software escrito
por otros, y lo distribuye, cada uno con su propia licencia. Este archivo enumera esos
componentes, la licencia con la que Tessera usa cada uno y lo que sus licencias piden que se
diga. Describe Tessera 0.76.1.

## Cómo viaja el código de terceros con Tessera

- **Las dependencias npm de producción** se copian, sin modificar, a la carpeta
  `node_modules` de la app: `<carpeta de instalación>\resources\app\node_modules` en Windows
  y `Tessera.app/Contents/Resources/app/node_modules` en macOS. La app no se empaqueta en un
  archivo asar, así que cada paquete conserva su propia carpeta y su propio archivo de
  licencia.
- **Las bibliotecas de la interfaz** las integra Vite en el código compilado de la app
  (`out/`). Se enumeran en
  [Bibliotecas integradas en la interfaz](#bibliotecas-integradas-en-la-interfaz).
- **Los descompiladores de Java** viven en `vendor/java/`, junto a sus textos de licencia.
- **Los archivos de licencia de Electron y Chromium** los distribuye electron-builder con la
  app.

## Componentes con condiciones específicas

### CFR 0.152 (MIT)

Descompilador de Java, redistribuido sin modificar como `vendor/java/cfr-0.152.jar` y
ejecutado como un proceso aparte con un entorno de Java instalado en el equipo del usuario.
Código fuente: <https://github.com/leibnitz27/cfr> · <https://www.benf.org/other/cfr>

```
The MIT License (MIT)

Copyright (c) 2011-2019 Lee Benfield - https://www.benf.org/other/cfr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Vineflower 1.12.0 (Apache-2.0)

Descompilador de Java, una bifurcación mantenida del descompilador Fernflower. Redistribuido
sin modificar como `vendor/java/vineflower-1.12.0.jar` y ejecutado como un proceso aparte.
Con licencia Apache License 2.0; el texto completo está en
`vendor/java/LICENSE-vineflower.txt` y en [Apache License 2.0](#apache-license-20), más abajo.
Código fuente: <https://github.com/Vineflower/vineflower> · <https://vineflower.org>

### jschardet 3.1.4 (LGPL-2.1-or-later)

Detección de la codificación de caracteres, que usa el editor para adivinar la codificación
de un archivo. Copyright António Afonso and contributors.

- Tessera usa jschardet **sin modificar**.
- **No** está integrado en el código de Tessera: el proceso principal lo carga en tiempo de
  ejecución desde su propia carpeta, `resources/app/node_modules/jschardet`, como un módulo
  aparte. Como la app no se empaqueta en un archivo asar, puedes reemplazar esa carpeta por
  una versión modificada de la biblioteca, compilada desde su código fuente, y Tessera la
  cargará.
- El código fuente de la versión exacta que usa Tessera está disponible en
  <https://github.com/aadsm/jschardet> (versión 3.1.4) y en el paquete `jschardet@3.1.4` de
  npm.
- El texto de la licencia (GNU Lesser General Public License, versión 2.1) viaja en la
  carpeta de la biblioteca y está disponible en
  <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>.

### JSZip 3.10.1 (MIT, elegida entre MIT OR GPL-3.0-or-later)

Lectura de ZIP, una dependencia de `mammoth` (el visor de Word). JSZip tiene licencia dual;
Tessera lo usa bajo la **licencia MIT**.
Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso.

JSZip depende de **pako** 1.0.11 (MIT AND Zlib), Copyright (C) 2014-2017 by Vitaly Puzrin
and Andrei Tuputcyn.

### DOMPurify 3.4.11 (Apache-2.0, elegida entre MPL-2.0 OR Apache-2.0)

Saneador de HTML, integrado en la interfaz. DOMPurify tiene licencia dual; Tessera lo usa
bajo la **Apache License 2.0** (texto [más abajo](#apache-license-20)).
Copyright Cure53 and other contributors. Código fuente: <https://github.com/cure53/DOMPurify>

### libpg-query 18.1.5 (MIT; incluye código de PostgreSQL bajo la PostgreSQL License)

El propio analizador SQL de PostgreSQL compilado a WebAssembly, que se usa para analizar
sentencias de PostgreSQL. Copyright (c) 2021 Dan Lynch; Copyright (c) 2025 Constructive. Con
licencia MIT.

El módulo de WebAssembly contiene código del analizador de PostgreSQL, distribuido bajo la
PostgreSQL License:

```
PostgreSQL Database Management System
(also known as Postgres, formerly known as Postgres95)

Portions Copyright (c) 1996-2025, The PostgreSQL Global Development Group

Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose, without fee, and without a written agreement
is hereby granted, provided that the above copyright notice and this
paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS
DOCUMENTATION, EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
```

### node-oracledb 6.10.0 (Apache-2.0, elegida entre Apache-2.0 OR UPL-1.0)

Controlador de Oracle Database. Tiene licencia dual; Tessera lo usa bajo la
**Apache License 2.0**. Copyright (c) 2015, 2025 Oracle and/or its affiliates.

### vscode-material-icons 0.1.1 (MIT)

Iconos de archivos y carpetas del explorador. Copyright (c) 2024 Matěj Chalk.

### Monaco Editor 0.52.2 (MIT)

El editor de código. Copyright (c) 2016 - present Microsoft Corporation. La fuente de iconos
Codicons incluida con Monaco es © Microsoft y tiene licencia Creative Commons Attribution 4.0
International License (CC BY 4.0).

### node-pty 1.1.0 (MIT)

Pseudoterminales para las terminales y los agentes. Copyright (c) 2012-2015, Christopher
Jeffrey, and the node-pty contributors. En Windows incluye **winpty** (MIT, Copyright Ryan
Prichard) y los binarios de **ConPTY** (`conpty.dll`, `OpenConsole.exe`) de Microsoft
Terminal (MIT, Copyright (c) Microsoft Corporation).

### Electron y Chromium

Tessera corre sobre [Electron](https://www.electronjs.org/) (MIT, Copyright (c) Electron
contributors, Copyright (c) 2013-2020 GitHub Inc.), que integra Chromium, Node.js y sus
propios componentes de terceros. electron-builder distribuye sus archivos de licencia con la
app: `LICENSE.electron.txt` (Electron) y `LICENSES.chromium.html` (Chromium y todo lo que
incluye). En Windows están junto a `Tessera.exe`.

### Oracle Instant Client (no se redistribuye)

Tessera **no** incluye ni redistribuye Oracle Instant Client. Cuando una base de datos lo
necesita y el usuario lo pide, Tessera lo descarga del sitio de Oracle
(`download.oracle.com`) a la carpeta de datos del usuario. Esa descarga se rige por las
condiciones de licencia de Oracle para Instant Client (ver
<https://www.oracle.com/database/technologies/instant-client.html>), un acuerdo entre el
usuario y Oracle, no con Tessera. El usuario también puede indicarle a Tessera un Instant
Client que ya tenga instalado.

## Otras licencias en el árbol de dependencias

Todas las demás dependencias de producción están bajo MIT, ISC, BSD-2-Clause, BSD-3-Clause o
Apache-2.0, salvo estas:

| Paquete | Versión | Licencia | Lo trae |
| --- | --- | --- | --- |
| argparse | 2.0.1 | Python-2.0 (PSF License) | `js-yaml`, una dependencia de `electron-updater` |
| sax | 1.6.0 | BlueOak-1.0.0 | `builder-util-runtime`, una dependencia de `electron-updater` |
| tslib | 2.8.1 | 0BSD | varios paquetes |
| pako | 1.0.11 | MIT AND Zlib | `jszip` |
| duck | 0.1.12 | BSD (texto de 2 cláusulas) | `mammoth` |
| khroma | 2.1.0 | MIT (archivo de licencia; sin campo en su `package.json`) | `mermaid` |

Sus textos de licencia viajan en la carpeta de cada paquete.

## Dependencias directas

| Paquete | Versión | Licencia |
| --- | --- | --- |
| @mongodb-js/shell-bson-parser | 1.5.19 | Apache-2.0 |
| acorn | 8.17.0 | MIT |
| electron-updater | 6.8.9 | MIT |
| fflate | 0.8.3 | MIT |
| iconv-lite | 0.7.3 | MIT |
| ioredis | 6.0.0 | MIT |
| jschardet | 3.1.4 | LGPL-2.1-or-later |
| libpg-query | 18.1.5 | MIT |
| mammoth | 1.12.0 | BSD-2-Clause |
| mongodb | 7.7.0 | Apache-2.0 |
| node-pty | 1.1.0 | MIT |
| oracledb | 6.10.0 | Apache-2.0 OR UPL-1.0 (elegida Apache-2.0) |
| pg | 8.22.0 | MIT |
| pg-cursor | 2.22.0 | MIT |
| tedious | 20.3.3 | MIT |

## Bibliotecas integradas en la interfaz

Estas se compilan dentro de `out/` y no conservan una carpeta propia en la app instalada, así
que se enumeran aquí con sus licencias.

| Paquete | Versión | Licencia |
| --- | --- | --- |
| @braintree/sanitize-url | 7.1.2 | MIT |
| @iconify/utils | 3.1.7 | MIT |
| @mermaid-js/parser | 1.2.1 | MIT |
| @upsetjs/venn.js | 2.0.0 | MIT |
| @xterm/addon-clipboard | 0.2.0 | MIT |
| @xterm/addon-fit | 0.10.0 | MIT |
| @xterm/addon-search | 0.15.0 | MIT |
| @xterm/addon-web-links | 0.12.0 | MIT |
| @xterm/addon-webgl | 0.18.0 | MIT |
| @xterm/xterm | 5.5.0 | MIT |
| cose-base | 1.0.3 | MIT |
| cytoscape | 3.34.3 | MIT |
| cytoscape-cose-bilkent | 4.1.0 | MIT |
| cytoscape-fcose | 2.2.0 | MIT |
| d3-array, d3-axis, d3-color, d3-dispatch, d3-format, d3-hierarchy, d3-interpolate, d3-path, d3-scale, d3-scale-chromatic, d3-selection, d3-shape, d3-time, d3-time-format, d3-timer, d3-transition, d3-zoom | 3.x / 4.x | ISC |
| d3-ease | 3.0.1 | BSD-3-Clause |
| d3-sankey | 0.12.3 | BSD-3-Clause |
| dagre-d3-es | 7.0.14 | MIT |
| dayjs | 1.11.23 | MIT |
| dompurify | 3.4.11 | MPL-2.0 OR Apache-2.0 (elegida Apache-2.0) |
| es-toolkit | 1.52.0 | MIT |
| fastdom | 1.0.12 | MIT |
| internmap | 2.0.3 | ISC |
| katex | 0.16.47 | MIT |
| khroma | 2.1.0 | MIT |
| layout-base | 1.0.2 | MIT |
| lodash-es | 4.18.1 | MIT |
| marked | 18.0.5 | MIT |
| mermaid | 11.17.2 | MIT |
| monaco-editor | 0.52.2 | MIT |
| nearley | 2.20.1 | MIT |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| roughjs | 4.6.6 | MIT |
| scheduler | 0.23.2 | MIT |
| sql-formatter | 15.9.0 | MIT |
| stylis | 4.4.0 | MIT |
| ts-dedent | 2.3.0 | MIT |
| uuid | 14.0.2 | MIT |
| vscode-material-icons | 0.1.1 | MIT |
| zustand | 5.0.15 | MIT |

## Marcas registradas

Postgres, PostgreSQL y el logotipo de Slonik son marcas comerciales o marcas registradas de
la PostgreSQL Community Association of Canada, y se usan con su permiso. Oracle es una marca
registrada de Oracle y/o sus filiales. Los demás nombres de productos que aparecen en
Tessera, como Claude Code, Codex, SQL Server, MongoDB, Redis o Docker, son marcas de sus
respectivos dueños. Su uso no implica ninguna afiliación con ellos ni su respaldo.

## Apache License 2.0

Se aplica a Vineflower, DOMPurify (por elección), node-oracledb (por elección), el
controlador de Node.js de MongoDB y `@mongodb-js/shell-bson-parser`, entre otros. El texto
de la licencia se reproduce en inglés, que es su versión oficial.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```
