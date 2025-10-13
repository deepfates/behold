declare module 'mineflayer-pathfinder' {
  import type { Bot } from 'mineflayer'
  import type { IndexedData } from 'minecraft-data'

  // Widen Movements constructor to match runtime (bot, mcData)
  // Official d.ts currently declares (bot) only.
  export class Movements {
    constructor(bot: Bot, mcData?: IndexedData)
  }
}

