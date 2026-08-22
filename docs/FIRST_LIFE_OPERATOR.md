# First Life operator entry

This is the shortest honest path into the locally preserved San Francisco
First Life world. It starts the existing managed runtime; it does not compile a
new place, reset the world, or relabel the historical `ScoutLife` identity.
For a new checkout and new resident, use the
[clean-checkout candidate](FIRST_LIFE_QUICKSTART.md) instead.

## Preflight

From the Behold repository:

```sh
npm run world -- status --world sf-csdr
npm run play -- --world sf-csdr --dry-run
```

Status should report clear world control, a safe runtime, and clear controller
leases. The dry run should identify Minecraft 1.21.4, the local player, Java,
and the `127.0.0.1:25565` quick-connect target without opening Minecraft.

## Enter the world

```sh
npm run play -- --world sf-csdr
```

The foreground command starts the pinned server and the `SFCheckpoint`
companion, then opens the native client and joins the saved SF runtime. With no
`OPENROUTER_API_KEY`, the companion joins paused and makes no provider calls;
the human can still walk, look around, and inspect the shared world. This is the
preserved First Life play state, not the separately compiled full-city SF
release.

The visible check is deliberately small: confirm that the human client joins
the world and that `SFCheckpoint` is present in the same managed epoch. That is
an operator entry, not a new autonomy or long-life proof.

## Leave cleanly

Close the native client or interrupt the foreground `npm run play` command.
The owner drains the companion, saves Minecraft, stops the JVM, and releases
world control. Confirm the result with:

```sh
npm run world -- status --world sf-csdr
```

If an abnormal client exit leaves `recovery_required` while the server, port,
session lock, and controller leases are all stopped, use the evidence-preserving
recovery command:

```sh
npm run world -- recover --world sf-csdr
```

Recovery refuses a live, foreign, changed, or mismatched owner. It writes
prepared and completed recovery evidence before releasing the abandoned fence;
it does not reset or replace the runtime.
