declare module 'prismarine-viewer' {
  export const mineflayer: (bot: any, opts: { viewDistance?: number; firstPerson?: boolean; port?: number; prefix?: string }) => void;
  export const standalone: any;
  export const headless: any;
  export const viewer: any;
  export const supportedVersions: string[];
}

