# pi-acp provenance

Baseline: published MIT pi-acp@0.0.34 tarball, compared to upstream commit
04d0a15d6bb42bb65cce5c9caedcdcb2cdcb6905 before reuse.

Tarball: https://registry.npmjs.org/pi-acp/-/pi-acp-0.0.34.tgz
SHA-256: 4b3bf6bc71bed2b7f43dd7fcfa1906e464828e471740da593107e4f1608f2650
SHA-512 (npm integrity): MrCp37UbpUzkTkzTIMJQf1RYrT+kr4fgGDGFoLmBN26UupuCZp0XxVIY+7XYsMo3yDnzDeZUJ0jPyM3Si6Bkkg==
Published bundle SHA-256: 324aeb8bba1228937e16b1326fb3e014e2a625b2dea549dbcd49b006cd5df6a2

The tarball source map has 17 sources. Four differ from the git commit:
acp/agent.ts, acp/session.ts, acp/pi-sessions.ts, acp/translate/prompt.ts.
The published tarball is the selected baseline, including prompt.ts.

| Layer                                           | Local difference                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| prompt.ts                                       | Formatting and comment conventions; imported from published source map |
| ACP agent/session                               | New SDK 1.5 builder API; one session; no restore/history handlers      |
| RPC process                                     | New bounded transport; no session files; no Windows launchers          |
| MCP/control/permissions                         | New GitHuman-owned registry, extension and ACP gate                    |
| Upstream history, session store, slash commands | Excluded                                                               |

Keep LICENSE with the redistributed prompt conversion code. Runtime npx and
pi SDK dependencies are not required. Maintainers compare upstream changes
when supported pi versions or upstream security fixes change. Reconsider the
SDK-runtime ADR if the fork can no longer be reviewed as a bounded change.

macOS verification was explicitly skipped by the user because no host was
available. Linux tests do not establish macOS support.
