# Third-party notices

Tessera is released under the [MIT License](./LICENSE). It is built on, and ships with,
software written by others, each under its own license. This file lists those components,
the license under which Tessera uses each one, and anything their licenses ask us to say.
It describes Tessera 0.71.0.

## How third-party code travels with Tessera

- **Production npm dependencies** are copied, unmodified, into the app's `node_modules`
  folder: `<installation folder>\resources\app\node_modules` on Windows and
  `Tessera.app/Contents/Resources/app/node_modules` on macOS. The app is not packed into an
  asar archive, so every package keeps its own folder and its own license file.
- **Interface libraries** are bundled into the app's compiled code (`out/`) by Vite. They
  are listed in [Libraries bundled into the interface](#libraries-bundled-into-the-interface).
- **Java decompilers** live in `vendor/java/`, next to their license texts.
- **Electron and Chromium** license files are shipped by electron-builder with the app.

## Components with specific terms

### CFR 0.152 (MIT)

Java decompiler, redistributed unmodified as `vendor/java/cfr-0.152.jar` and run as a
separate process with a Java runtime installed on the user's computer.
Source: <https://github.com/leibnitz27/cfr> · <https://www.benf.org/other/cfr>

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

Java decompiler, a maintained fork of the Fernflower decompiler. Redistributed unmodified as
`vendor/java/vineflower-1.12.0.jar` and run as a separate process. Licensed under the
Apache License 2.0; the full text is in `vendor/java/LICENSE-vineflower.txt` and in
[Apache License 2.0](#apache-license-20) below.
Source: <https://github.com/Vineflower/vineflower> · <https://vineflower.org>

### jschardet 3.1.4 (LGPL-2.1-or-later)

Character encoding detection, used by the editor to guess a file's encoding.
Copyright António Afonso and contributors.

- Tessera uses jschardet **unmodified**.
- It is **not** bundled into Tessera's code: the main process loads it at runtime from its
  own folder, `resources/app/node_modules/jschardet`, as a separate module. Because the app
  is not packed into an asar archive, you can replace that folder with a modified version of
  the library, built from its source, and Tessera will load it.
- The source code of the exact version Tessera uses is available at
  <https://github.com/aadsm/jschardet> (version 3.1.4) and in the `jschardet@3.1.4`
  package on npm.
- The license text (GNU Lesser General Public License, version 2.1) ships in the library's
  folder and is available at <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>.

### JSZip 3.10.1 (MIT, chosen from MIT OR GPL-3.0-or-later)

ZIP reading, a dependency of `mammoth` (the Word viewer). JSZip is dual licensed; Tessera
uses it under the **MIT License**.
Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso.

JSZip depends on **pako** 1.0.11 (MIT AND Zlib), Copyright (C) 2014-2017 by Vitaly Puzrin
and Andrei Tuputcyn.

### DOMPurify 3.4.11 (Apache-2.0, chosen from MPL-2.0 OR Apache-2.0)

HTML sanitizer, bundled into the interface. DOMPurify is dual licensed; Tessera uses it
under the **Apache License 2.0** (text [below](#apache-license-20)).
Copyright Cure53 and other contributors. Source: <https://github.com/cure53/DOMPurify>

### libpg-query 18.1.5 (MIT; includes PostgreSQL code under the PostgreSQL License)

PostgreSQL's own SQL parser compiled to WebAssembly, used to analyze PostgreSQL statements.
Copyright (c) 2021 Dan Lynch; Copyright (c) 2025 Constructive. Licensed under the MIT License.

The WebAssembly module contains parser code from PostgreSQL, distributed under the
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

### node-oracledb 6.10.0 (Apache-2.0, chosen from Apache-2.0 OR UPL-1.0)

Oracle Database driver. Dual licensed; Tessera uses it under the **Apache License 2.0**.
Copyright (c) 2015, 2025 Oracle and/or its affiliates.

### vscode-material-icons 0.1.1 (MIT)

File and folder icons of the explorer. Copyright (c) 2024 Matěj Chalk.

### Monaco Editor 0.52.2 (MIT)

The code editor. Copyright (c) 2016 - present Microsoft Corporation. The Codicons icon font
included with Monaco is © Microsoft and licensed under the Creative Commons Attribution 4.0
International License (CC BY 4.0).

### node-pty 1.1.0 (MIT)

Pseudo-terminals for the terminals and the agents. Copyright (c) 2012-2015, Christopher
Jeffrey, and the node-pty contributors. On Windows it includes **winpty** (MIT, Copyright
Ryan Prichard) and the **ConPTY** binaries (`conpty.dll`, `OpenConsole.exe`) from Microsoft
Terminal (MIT, Copyright (c) Microsoft Corporation).

### Electron and Chromium

Tessera runs on [Electron](https://www.electronjs.org/) (MIT, Copyright (c) Electron
contributors, Copyright (c) 2013-2020 GitHub Inc.), which embeds Chromium, Node.js and their
own third-party components. electron-builder ships their license files with the app:
`LICENSE.electron.txt` (Electron) and `LICENSES.chromium.html` (Chromium and everything it
includes). On Windows they sit next to `Tessera.exe`.

### Oracle Instant Client (not redistributed)

Tessera does **not** include or redistribute Oracle Instant Client. When a database needs it
and the user asks for it, Tessera downloads it from Oracle's site (`download.oracle.com`)
into the user's data folder. That download is governed by Oracle's own license terms for
Instant Client (see <https://www.oracle.com/database/technologies/instant-client.html>),
an agreement between the user and Oracle, not with Tessera. The user can also point Tessera to an Instant Client
already installed.

## Other licenses in the dependency tree

Every other production dependency is under MIT, ISC, BSD-2-Clause, BSD-3-Clause or
Apache-2.0, except these:

| Package | Version | License | Pulled in by |
| --- | --- | --- | --- |
| argparse | 2.0.1 | Python-2.0 (PSF License) | `js-yaml`, a dependency of `electron-updater` |
| sax | 1.6.0 | BlueOak-1.0.0 | `builder-util-runtime`, a dependency of `electron-updater` |
| tslib | 2.8.1 | 0BSD | several packages |
| pako | 1.0.11 | MIT AND Zlib | `jszip` |
| duck | 0.1.12 | BSD (2-clause text) | `mammoth` |
| khroma | 2.1.0 | MIT (license file; no field in its `package.json`) | `mermaid` |

Their license texts ship in each package's folder.

## Direct dependencies

| Package | Version | License |
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
| oracledb | 6.10.0 | Apache-2.0 OR UPL-1.0 (Apache-2.0 chosen) |
| pg | 8.22.0 | MIT |
| pg-cursor | 2.22.0 | MIT |
| tedious | 20.3.3 | MIT |

## Libraries bundled into the interface

These are compiled into `out/` and do not keep a separate folder in the installed app, so
they are listed here with their licenses.

| Package | Version | License |
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
| dompurify | 3.4.11 | MPL-2.0 OR Apache-2.0 (Apache-2.0 chosen) |
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

## Trademarks

Postgres, PostgreSQL and the Slonik Logo are trademarks or registered trademarks of the
PostgreSQL Community Association of Canada, and used with their permission. Oracle is a
registered trademark of Oracle and/or its affiliates. Other product names that appear in
Tessera, such as Claude Code, Codex, SQL Server, MongoDB, Redis or Docker, are trademarks of
their respective owners. Their use does not imply any affiliation with or endorsement by
them.

## Apache License 2.0

Applies to Vineflower, DOMPurify (as chosen), node-oracledb (as chosen), MongoDB's Node.js
driver and `@mongodb-js/shell-bson-parser`, among others.

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
