import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { Bot, ControlState } from 'mineflayer';

export function startControlsServer(bot: Bot, port: number, viewerPort?: number) {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, { path: '/controls/socket.io' });

  const viewerUrl = `http://localhost:${viewerPort ?? (port - 1)}/`;

  const html = `<!doctype html>
  <html><head><meta charset="utf-8"/>
  <title>Behold Controls</title>
  <style>
    html,body{height:100%;margin:0}
    body{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;background:#000;color:#eee}
    #wrap{position:relative;height:100%;}
    #v{position:absolute;inset:0;border:0;width:100%;height:100%;}
    #overlay{position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,0.45);padding:8px 10px;border-radius:6px;line-height:1.4}
    kbd{border:1px solid #666;padding:1px 5px;border-radius:4px;background:#111}
    #top{position:absolute;left:12px;top:12px;background:rgba(0,0,0,0.45);padding:6px 8px;border-radius:6px}
    button{font-family:inherit;background:#111;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 6px}
  </style>
  </head><body>
  <div id="wrap">
    <iframe id="v" src="${viewerUrl}" tabindex="-1"></iframe>
    <div id="top"><button id="stop">Stop</button> <button id="drop">Drop (Q)</button></div>
    <div id="overlay" tabindex="0">W/A/S/D move (hold), Space jump (hold), F sprint (hold), Z sneak (toggle). Q drop. Keyboard-only — clicks do nothing.</div>
  </div>
  <script src="/controls/socket.io/socket.io.js"></script>
  <script>
    const socket = io({ path: '/controls/socket.io' });
    const down = new Set();
    const keyMap = { 'w':'forward','a':'left','s':'back','d':'right',' ':'jump','f':'sprint','z':'sneak' };
    const holdKeys = new Set(['forward','left','back','right','jump','sprint']);
    function send(name, pressed){ socket.emit('control', { name, pressed }); }
    window.addEventListener('blur', ()=>{ for(const n of Array.from(down)){ down.delete(n); send(n,false);} });
    // Keep focus on overlay to capture keys even after iframe clicks
    const overlay = document.getElementById('overlay');
    function focusOverlay(){ overlay && overlay.focus(); }
    focusOverlay();
    document.addEventListener('pointerdown', ()=> setTimeout(focusOverlay, 0), true);
    document.addEventListener('keydown', (e)=>{
      const k = e.key.length===1 ? e.key.toLowerCase() : e.key.toLowerCase();
      if (k === 'q') { e.preventDefault(); socket.emit('action', { type:'drop' }); return; }
      const name = keyMap[k];
      if (!name) return;
      e.preventDefault();
      if (holdKeys.has(name)) {
        if (down.has(name)) return;
        down.add(name);
        send(name, true);
      } else {
        // toggle
        send(name, true);
        setTimeout(()=>send(name, false), 10);
      }
    });
    document.addEventListener('keyup', (e)=>{
      const k = e.key.length===1 ? e.key.toLowerCase() : e.key.toLowerCase();
      const name = keyMap[k];
      if (!name) return;
      e.preventDefault();
      if (holdKeys.has(name)) {
        down.delete(name);
        send(name, false);
      }
    });
    document.getElementById('stop').onclick = ()=> socket.emit('stop');
    document.getElementById('drop').onclick = ()=> socket.emit('action', { type:'drop' });
  </script>
  </body></html>`;

  app.get('/controls', (_req, res) => res.type('html').send(html));

  io.on('connection', (socket) => {
    socket.on('control', ({ name, pressed }: { name: ControlState; pressed: boolean }) => {
      try {
        if (pressed && (bot as any).pathfinder) (bot as any).pathfinder.stop();
        if (name === 'sneak' && pressed) {
          // Toggle sneak
          const current = (bot as any).controlState?.sneak ?? false;
          (bot as any).setControlState('sneak', !current);
        } else {
          (bot as any).setControlState(name, pressed);
        }
      } catch {}
    });
    socket.on('stop', () => {
      try {
        (bot as any).stopDigging?.();
      } catch {}
      if ((bot as any).pathfinder) (bot as any).pathfinder.stop();
      for (const k of ['forward','back','left','right','jump','sneak','sprint'] as ControlState[]) {
        try { (bot as any).setControlState(k, false); } catch {}
      }
    });
    socket.on('action', async (msg: { type: 'drop' }) => {
      if (msg?.type === 'drop') {
        try {
          const held = (bot as any).heldItem;
          if (held) await (bot as any).tossStack(held);
        } catch {}
      }
    });
  });

  server.listen(port, () => {
    console.log(`[controls] Web controls at http://localhost:${port}/controls`);
  });

  return { close: () => server.close() };
}
