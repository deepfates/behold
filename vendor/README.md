# Vendored release candidates

The tracked `deepfates-lync-*.tgz` files are unmodified reproducible `npm pack`
outputs from clean Lync revisions. Behold pins the newest named artifact in
`package.json` rather than depending on a workstation-global checkout or stale
registry package.

The current pin is `deepfates-lync-0.4.3.tgz`, built from revision `553626e`.

- SHA-256: `a33a140c003676f3813018dd31f4d12033c3fd527b5e5a004491a01dcc21bf80`

Lync remains the source owner. This artifact exists only so a standalone
Behold checkout can reproduce the repaired writer and the Node-only bounded
file-Loom cursor before an owner-authorized registry release; replace it with
the exact published package when available. The cursor subpath requires Node
22.13 or newer; browser-safe and eager Lync surfaces retain their wider runtime
contract.
