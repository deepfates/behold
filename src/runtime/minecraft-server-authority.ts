export type ManagedServerAuthorityExit = Readonly<{
  name: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

/**
 * An already-started Minecraft server whose process lifecycle belongs to an
 * exact external authority. Behold owns inhabitants and its world epoch after
 * adoption; the authority retains Java ownership and exposes only acknowledged
 * lifecycle operations. Arbitrary console passthrough is deliberately absent.
 */
export type ManagedExternalServerAuthority = Readonly<{
  protocol: 'behold.external-minecraft-server-authority.v1';
  kind: 'place-release-serve';
  authorityPid: number;
  serverPid: number;
  runtimeWorldPath: string;
  host: '127.0.0.1' | '::1';
  port: number;
  minecraftServerSha256: string;
  initialTickState: 'frozen';
  /** Exact authority terminal that established the initial frozen state. */
  initialTickEvidence: unknown;
  identity: Readonly<Record<string, unknown>>;
  exit: Promise<ManagedServerAuthorityExit>;
  freeze(): Promise<unknown>;
  save(reason: string): Promise<unknown>;
  unfreeze(): Promise<unknown>;
  stop(reason: string): Promise<ManagedServerAuthorityExit>;
}>;
