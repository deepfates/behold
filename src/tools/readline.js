require('dotenv').config();

const { getConfig } = require('../config');
const { createBot } = require('../bot');
const readline = require('node:readline');

// Load config and create bot using shared defaults
const config = getConfig();
console.log(
  `[readline] Connecting to ${config.server.host}:${config.server.port} as ${config.auth.username} (${config.auth.mode})`,
);

const bot = createBot(config);

// Readline interface for terminal I/O
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

bot.once('spawn', () => {
  console.log(`[readline] Bot joined the game as ${bot.username}. Type to chat. (Ctrl+C to exit)`);
  rl.setPrompt('> ');
  rl.prompt();
});

// Echo in-game chat/messages into the terminal without breaking the input line
bot.on('message', (message) => {
  try {
    // Move cursor left to overwrite the prompt cleanly
    readline.moveCursor(process.stdout, -2, 0);
  } catch {}
  const text =
    typeof message?.toAnsi === 'function'
      ? message.toAnsi()
      : (message?.toString?.() ?? String(message));
  console.log(text);
  rl.prompt();
});

// Send terminal lines into in-game chat
rl.on('line', (line) => {
  try {
    readline.moveCursor(process.stdout, 0, -1);
    readline.clearScreenDown(process.stdout);
  } catch {}
  const msg = String(line || '').trim();
  if (msg) bot.chat(msg);
  rl.prompt();
});

// Basic lifecycle and error visibility
bot.on('kicked', (reason) => {
  console.warn('[bot] Kicked:', reason);
});
bot.on('error', (err) => {
  console.error('[bot] Error:', err);
});
bot.on('end', () => {
  console.warn('[bot] Disconnected from server.');
  rl.close();
});

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('\n[readline] Exiting...');
  try {
    bot.end();
  } catch {}
  rl.close();
  process.exit(0);
});
