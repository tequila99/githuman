# pi runtime control points

Each directory pins one control version and its internal pi package family.
The lock files are test fixtures; they do not add a pi SDK to the application
or replace the user's global installation.

Run from the repository root:

```sh
pnpm run test:pi-matrix --install
```

The installer uses `--ignore-workspace` so the fixture is independent of the
application workspace. Subsequent runs use `pnpm run test:pi-matrix`.

The matrix creates temporary POSIX global-style `bin/pi` symlinks to the
installed package entry points. It tests actual executable resolution without
modifying the user's global pi. It does not invoke npm's global installer.

Control points: 0.81.0, 0.85.1, 0.99.0, 1.0.0, 1.1.0, 1.4.0. Runtime feature
detection and the bridge handshake decide whether a launch can proceed;
versions between these control points are not claimed as verified.

Linux is verified. macOS checks were explicitly skipped because no host was
available. Native chat cleanup after sudden pi death is best effort, as
explicitly agreed in ADR 0115's lifecycle supplement. The crash test reports
a surviving native process and always cleans up the process it created.
