# Vendored release candidates

The tracked `deepfates-lync-*.tgz` files are unmodified reproducible `npm pack`
outputs from clean Lync revisions. Behold pins the newest named artifact in
`package.json` rather than depending on a workstation-global checkout or stale
registry package.

The current pin is `deepfates-lync-0.4.2.tgz`, built from revision `0ec1b37`.

- SHA-256: `c83b01766b73656a334d49b28e54056472e2b171a981560ded642524fed3aba8`

Lync remains the source owner. This artifact exists only so a standalone
Behold checkout can reproduce the repaired writer before an owner-authorized
registry release; replace it with the exact published package when available.
