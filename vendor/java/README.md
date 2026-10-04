# Java decompilers

Third-party Java decompilers that Tessera ships inside its installer to show `.class` files.
They are redistributed unmodified and run as a separate process with a Java runtime found on
the user's computer. Their license texts sit next to them and must travel with them.

| File | Version | License | SHA-256 | Source |
| --- | --- | --- | --- | --- |
| `cfr-0.152.jar` | 0.152 | MIT (`LICENSE-cfr.txt`) | `f686e8f3ded377d7bc87d216a90e9e9512df4156e75b06c655a16648ae8765b2` | <https://github.com/leibnitz27/cfr/releases/download/0.152/cfr-0.152.jar> |
| `vineflower-1.12.0.jar` | 1.12.0 | Apache-2.0 (`LICENSE-vineflower.txt`) | `1dfcfe974395734fa467ce620661c7623d05ba83670de0529b1fbd63ff548b9d` | <https://github.com/Vineflower/vineflower/releases/download/1.12.0/vineflower-1.12.0.jar> |

- **CFR** — Copyright (c) 2011-2019 Lee Benfield, <https://www.benf.org/other/cfr>. Runs on
  Java 6 or later.
- **Vineflower** — a maintained fork of the Fernflower decompiler, <https://vineflower.org>.
  Needs Java 17 or later.

Neither jar contains its own license file, which is why the texts are kept here. To update
an engine, replace the jar, update this table (version, checksum and URL) and the paths in
`src/main/java/`. How the engine is chosen for each class, and why the user's jar never goes
on the JVM classpath, is recorded in `docs/decisiones/java/`.
