const readline = require('readline');

function attachKeyboard(bot) {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const state = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sneak: false,
    sprint: false
  };

  const toggle = (name, val) => {
    const next = typeof val === 'boolean' ? val : !state[name];
    state[name] = next;
    try {
      if (['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].includes(name)) {
        // Stop pathfinder when manually steering
        if (next && bot.pathfinder) bot.pathfinder.stop();
        bot.setControlState(name, next);
      }
      logStatus();
    } catch (e) {
      console.warn('[keys] control error:', e?.message || e);
    }
  };

  const stopAll = () => {
    for (const k of Object.keys(state)) state[k] = false;
    try {
      bot.stopDigging?.();
    } catch {}
    if (bot.pathfinder) bot.pathfinder.stop();
    for (const k of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
      try { bot.setControlState(k, false); } catch {}
    }
    logStatus('[keys] STOP');
  };

  const lookStep = { yaw: 0.15, pitch: 0.12 };
  const look = async (dyaw, dpitch) => {
    try {
      const yaw = bot.entity?.yaw ?? 0;
      const pitch = bot.entity?.pitch ?? 0;
      await bot.look(yaw + dyaw, Math.max(Math.min(pitch + dpitch, Math.PI / 2), -Math.PI / 2), true);
    } catch (e) {
      console.warn('[keys] look error:', e?.message || e);
    }
  };

  const onKey = async (str, key) => {
    if (!key) return;
    // Exit
    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
      return;
    }

    switch (key.name) {
      case 'h':
        printHelp();
        break;
      case 'w': toggle('forward'); break;
      case 's': toggle('back'); break;
      case 'a': toggle('left'); break;
      case 'd': toggle('right'); break;
      case 'space': toggle('jump'); break;
      // Typical MC uses shift to sneak; terminal can’t sense shift alone reliably.
      // Use 'z' to toggle sneak and 'f' to toggle sprint.
      case 'z': toggle('sneak'); break;
      case 'f': toggle('sprint'); break;
      case 'x': stopAll(); break; // All stop

      case 'left': await look(-lookStep.yaw, 0); break;
      case 'right': await look(lookStep.yaw, 0); break;
      case 'up': await look(0, -lookStep.pitch); break;
      case 'down': await look(0, lookStep.pitch); break;

      case 't':
        await promptChat(bot);
        break;
      default:
        // ignore
        break;
    }
  };

  process.stdin.on('keypress', onKey);

  function cleanup() {
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.removeListener('keypress', onKey);
  }

  function logStatus(prefix = '[keys]') {
    const flags = Object.entries(state)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'idle';
    process.stdout.write(`\r${prefix} ${flags}      `);
  }

  function printHelp() {
    const lines = [
      '',
      'Keyboard controls:',
      '  w/a/s/d  toggle movement',
      '  space    toggle jump',
      '  z        toggle sneak (crouch)',
      '  f        toggle sprint',
      '  arrows   look around',
      '  t        chat prompt',
      '  x        stop all movement',
      '  h        show this help',
      '  Ctrl+C   exit',
      ''
    ];
    process.stdout.write(`\n${lines.join('\n')}\n`);
  }

  printHelp();
}

async function promptChat(bot) {
  const wasRaw = !!process.stdin.isRaw;
  if (wasRaw) try { process.stdin.setRawMode(false); } catch {}
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (p) => new Promise((res) => rl.question(p, res));
  try {
    const msg = await q('chat> ');
    if (msg && msg.trim()) bot.chat(msg.trim());
  } finally {
    rl.close();
    if (wasRaw) try { process.stdin.setRawMode(true); } catch {}
  }
}

module.exports = { attachKeyboard };

