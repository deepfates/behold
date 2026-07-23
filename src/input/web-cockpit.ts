import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Bot, ControlState } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';

const CONTROLS = new Set<ControlState>([
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sprint',
  'sneak',
]);

interface CockpitOptions {
  port?: number;
  host?: string;
  viewerUrl?: string;
}

export function attachWebCockpit(bot: Bot, options: CockpitOptions = {}) {
  const port = options.port ?? 3008;
  const host = options.host ?? '127.0.0.1';
  const viewerUrl = options.viewerUrl ?? 'http://127.0.0.1:3007';
  const token = randomUUID();
  const chat: Array<{ at: number; username: string; message: string }> = [];
  let destination: string | null = null;

  bot.on('chat', (username, message) => {
    chat.push({ at: Date.now(), username, message });
    if (chat.length > 30) chat.splice(0, chat.length - 30);
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        return sendHtml(res, cockpitHtml(viewerUrl, token));
      }
      if (req.method === 'GET' && req.url === '/api/state') {
        return sendJson(res, 200, getState(bot, chat, destination));
      }
      if (req.method !== 'POST' || !req.url?.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'not_found' });
      }
      if (req.headers['x-behold-token'] !== token) {
        return sendJson(res, 403, { error: 'invalid_session' });
      }

      const body = await readJson(req);
      if (req.url === '/api/control') {
        const control = String(body.control || '') as ControlState;
        if (!CONTROLS.has(control) || typeof body.active !== 'boolean') {
          return sendJson(res, 400, { error: 'invalid_control' });
        }
        if (body.active && bot.pathfinder) bot.pathfinder.stop();
        bot.setControlState(control, body.active);
        return sendJson(res, 200, { ok: true });
      }
      if (req.url === '/api/look') {
        await look(bot, String(body.direction || ''));
        return sendJson(res, 200, { ok: true });
      }
      if (req.url === '/api/look-delta') {
        await lookDelta(bot, Number(body.dx), Number(body.dy));
        return sendJson(res, 200, { ok: true });
      }
      if (req.url === '/api/navigate') {
        const username = String(body.username || '');
        const player = bot.players[username];
        if (!player?.entity) return sendJson(res, 404, { error: 'player_not_visible' });
        bot.clearControlStates();
        bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2.5), true);
        destination = username;
        return sendJson(res, 200, { ok: true });
      }
      if (req.url === '/api/chat') {
        const message = String(body.message || '')
          .trim()
          .slice(0, 240);
        if (!message) return sendJson(res, 400, { error: 'empty_message' });
        bot.chat(message);
        chat.push({ at: Date.now(), username: bot.username, message });
        return sendJson(res, 200, { ok: true });
      }
      if (req.url === '/api/action') {
        await act(bot, String(body.action || ''));
        if (body.action === 'stop') destination = null;
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error: any) {
      return sendJson(res, 500, { error: error?.message || 'cockpit_error' });
    }
  });

  server.listen(port, host, () => {
    console.log(`[cockpit] Running at http://${host}:${port}`);
  });
  bot.once('end', () => {
    server.close();
  });
  return server;
}

function getState(
  bot: Bot,
  chat: Array<{ at: number; username: string; message: string }>,
  destination: string | null,
) {
  const position = bot.entity?.position;
  const nearby = Object.values(bot.players)
    .filter((player) => player.username !== bot.username && player.entity && position)
    .map((player) => ({
      username: player.username,
      distance: Math.round(position!.distanceTo(player.entity!.position) * 10) / 10,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  return {
    connected: !!bot.entity,
    username: bot.username,
    position: position
      ? { x: round(position.x), y: round(position.y), z: round(position.z) }
      : null,
    health: bot.health,
    food: bot.food,
    heldItem: bot.heldItem?.displayName || null,
    time: bot.time?.timeOfDay ?? null,
    nearby,
    chat,
    navigation: bot.pathfinder?.isMoving() ? destination : null,
  };
}

async function look(bot: Bot, direction: string) {
  const yaw = bot.entity?.yaw ?? 0;
  const pitch = bot.entity?.pitch ?? 0;
  const yawStep = 0.18;
  const pitchStep = 0.14;
  if (direction === 'left') return bot.look(yaw + yawStep, pitch, true);
  if (direction === 'right') return bot.look(yaw - yawStep, pitch, true);
  if (direction === 'up') return bot.look(yaw, clampPitch(pitch - pitchStep), true);
  if (direction === 'down') return bot.look(yaw, clampPitch(pitch + pitchStep), true);
  throw new Error('invalid_look_direction');
}

async function lookDelta(bot: Bot, dx: number, dy: number) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('invalid_look_delta');
  const yaw = bot.entity?.yaw ?? 0;
  const pitch = bot.entity?.pitch ?? 0;
  const sensitivity = 0.0024;
  return bot.look(
    yaw - Math.max(-180, Math.min(180, dx)) * sensitivity,
    clampPitch(pitch - Math.max(-180, Math.min(180, dy)) * sensitivity),
    true,
  );
}

async function act(bot: Bot, action: string) {
  if (action === 'swing') return bot.swingArm('right');
  if (action === 'use') return bot.activateItem();
  if (action === 'stop') {
    bot.clearControlStates();
    bot.pathfinder?.stop();
    return;
  }
  throw new Error('invalid_action');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8192) throw new Error('request_too_large');
  }
  return raw ? JSON.parse(raw) : {};
}

function sendHtml(res: ServerResponse, body: string) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'self'; frame-src http://127.0.0.1:3007 http://localhost:3007; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function clampPitch(value: number) {
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, value));
}

function cockpitHtml(viewerUrl: string, token: string) {
  return COCKPIT_HTML.replace('__VIEWER_URL__', viewerUrl).replace('__TOKEN__', token);
}

const COCKPIT_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Behold World Cockpit</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; overflow: hidden; background: #000; color: #f4fff7; user-select: none; }
    #shell, #viewport { width: 100vw; height: 100vh; position: relative; }
    iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; pointer-events: none; }
    #vignette { pointer-events: none; position: absolute; inset: 0; box-shadow: inset 0 0 120px #0008; }
    #crosshair { pointer-events: none; position: absolute; inset: 50% auto auto 50%; width: 14px; height: 14px; transform: translate(-50%,-50%); opacity: .8; }
    #crosshair:before, #crosshair:after { content: ''; position: absolute; background: white; box-shadow: 0 0 3px #000; }
    #crosshair:before { width: 14px; height: 2px; top: 6px; }
    #crosshair:after { width: 2px; height: 14px; left: 6px; }
    .glass { background: #07110cbb; border: 1px solid #d8ffe52e; box-shadow: 0 8px 30px #0005; backdrop-filter: blur(10px); }
    header { position: absolute; z-index: 3; top: 14px; left: 14px; display: flex; gap: 12px; align-items: center; padding: 9px 12px; border-radius: 9px; font: 600 12px ui-monospace, monospace; }
    header strong { color: #8dffa7; letter-spacing: .08em; }
    #nearby { position: absolute; z-index: 3; top: 14px; right: 14px; display: flex; gap: 7px; }
    #nearby button { padding: 8px 11px; }
    #chatlog { position: absolute; z-index: 3; left: 14px; bottom: 68px; width: min(430px, calc(100vw - 28px)); padding: 9px 12px; border-radius: 9px; font-size: 12px; line-height: 1.55; opacity: 0; transition: opacity .2s; pointer-events: none; }
    #chatlog.visible { opacity: 1; }
    .speaker { color: #8dffa7; font-weight: 700; }
    #hud { position: absolute; z-index: 3; left: 14px; right: 14px; bottom: 14px; display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
    #hint { justify-self: center; padding: 9px 14px; border-radius: 9px; font-size: 12px; cursor: pointer; }
    #chatbox { display: flex; gap: 7px; width: min(430px, 40vw); }
    button, input { border: 1px solid #d8ffe530; background: #0b1811dd; color: #f4fff7; border-radius: 7px; font: inherit; }
    button { cursor: pointer; }
    button:hover, button:active, button.active { background: #235d35e8; border-color: #8dffa7; }
    input { min-width: 0; flex: 1; padding: 9px 11px; user-select: text; }
    #chatbox button { padding: 0 12px; }
    #controls { display: flex; gap: 6px; }
    #controls button { height: 36px; min-width: 38px; padding: 0 9px; }
    #stop { color: #ffb7b7; }
    #toast { position: absolute; z-index: 4; top: 64px; left: 50%; transform: translateX(-50%); padding: 8px 12px; border-radius: 8px; font-size: 12px; opacity: 0; transition: opacity .2s; pointer-events: none; }
    #toast.visible { opacity: 1; }
    .pad, .look { display: none; }
    [data-control="forward"] { grid-column: 2; }
    [data-control="left"] { grid-row: 2; grid-column: 1; }
    [data-control="back"] { grid-row: 2; grid-column: 2; }
    [data-control="right"] { grid-row: 2; grid-column: 3; }
    .look { display: grid; grid-template-columns: repeat(3, 38px); grid-template-rows: repeat(2, 34px); gap: 4px; }
    [data-look="up"] { grid-column: 2; }
    [data-look="left"] { grid-row: 2; grid-column: 1; }
    [data-look="down"] { grid-row: 2; grid-column: 2; }
    [data-look="right"] { grid-row: 2; grid-column: 3; }
    @media (max-width: 800px) { #chatbox { width: 45vw; } #controls button:nth-child(-n+2) { display:none; } header strong { display:none; } }
  </style>
</head>
<body tabindex="0">
  <div id="shell"><main id="viewport">
      <iframe src="__VIEWER_URL__" title="Minecraft first-person view"></iframe>
      <div id="vignette"></div>
      <div id="crosshair"></div>
      <header class="glass"><strong>BEHOLD</strong><span id="status">connecting…</span><span id="vitals"></span></header>
      <div id="nearby"></div>
      <div id="chatlog" class="glass"></div>
      <div id="toast" class="glass"></div>
      <div id="hud">
        <form id="chatbox"><input id="message" autocomplete="off" placeholder="Press T to talk…"><button>Send</button></form>
        <button id="hint" class="glass">Click the world to look · WASD to move</button>
        <div id="controls"><button data-control="jump">Jump</button><button data-action="swing">Wave</button><button data-action="use">Use</button><button data-action="stop" id="stop">Stop</button></div>
      </div>
    </main>
  </div>
  <script>
    const token = '__TOKEN__';
    const held = new Set();
    const keyControls = {w:'forward',a:'left',s:'back',d:'right',' ':'jump',Shift:'sprint'};
    const lookKeys = {ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
    const api = (path, body) => fetch(path, {method:'POST',headers:{'content-type':'application/json','x-behold-token':token},body:JSON.stringify(body)});
    const control = (name, active) => api('/api/control', {control:name,active});
    const releaseAll = () => { for (const name of held) control(name,false); held.clear(); document.querySelectorAll('.active').forEach((el)=>el.classList.remove('active')); };
    const toast = (message) => { const el=document.getElementById('toast'); el.textContent=message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('visible'),1800); };
    document.addEventListener('keydown', (event) => {
      if (event.target.tagName === 'INPUT') return;
      if (event.key.toLowerCase() === 't') { event.preventDefault(); document.exitPointerLock(); document.getElementById('message').focus(); return; }
      const name = keyControls[event.key];
      if (name && !held.has(name)) { event.preventDefault(); held.add(name); control(name,true); }
      const direction = lookKeys[event.key];
      if (direction && !event.repeat) { event.preventDefault(); api('/api/look',{direction}); }
      if (event.key === 'Escape') releaseAll();
    });
    document.addEventListener('keyup', (event) => { const name=keyControls[event.key]; if(name){held.delete(name);control(name,false);} });
    window.addEventListener('blur', releaseAll);
    const viewport=document.getElementById('viewport');
    const hint=document.getElementById('hint');
    const lock=()=>{ if(document.activeElement?.tagName!=='INPUT') viewport.requestPointerLock(); };
    viewport.addEventListener('click',(event)=>{if(!event.target.closest('button,input,form')) lock();});
    hint.addEventListener('click',lock);
    document.addEventListener('pointerlockchange',()=>{hint.textContent=document.pointerLockElement?'Mouse look active · T chat · Esc release':'Click the world to look · WASD to move';});
    let mouseX=0,mouseY=0,mouseFrame=0;
    document.addEventListener('mousemove',(event)=>{if(document.pointerLockElement!==viewport)return;mouseX+=event.movementX;mouseY+=event.movementY;if(!mouseFrame)mouseFrame=requestAnimationFrame(()=>{api('/api/look-delta',{dx:mouseX,dy:mouseY});mouseX=mouseY=0;mouseFrame=0;});});
    document.querySelectorAll('[data-control]').forEach((button) => {
      const name=button.dataset.control;
      const down=(event)=>{event.preventDefault();held.add(name);button.classList.add('active');control(name,true);};
      const up=(event)=>{event.preventDefault();held.delete(name);button.classList.remove('active');control(name,false);};
      button.addEventListener('pointerdown',down); button.addEventListener('pointerup',up); button.addEventListener('pointercancel',up); button.addEventListener('pointerleave',up);
    });
    document.querySelectorAll('[data-action]').forEach((button)=>button.addEventListener('click',()=>api('/api/action',{action:button.dataset.action})));
    document.getElementById('chatbox').addEventListener('submit',(event)=>{event.preventDefault();const input=document.getElementById('message');const message=input.value.trim();if(message){api('/api/chat',{message});input.value='';document.body.focus();toast('Message sent');}});
    let lastChatCount=0;
    async function refresh(){try{const state=await fetch('/api/state',{cache:'no-store'}).then((r)=>r.json());document.getElementById('status').textContent=state.position?'x '+state.position.x+' · y '+state.position.y+' · z '+state.position.z:'spawning…';document.getElementById('vitals').textContent='♥ '+Math.round(state.health||0)+' · food '+Math.round(state.food||0);const nearby=document.getElementById('nearby');nearby.replaceChildren(...state.nearby.map((p)=>{const b=document.createElement('button');b.className='glass';b.textContent=(state.navigation===p.username?'Following ':'Walk to ')+p.username+' · '+p.distance+'m';b.onclick=()=>{api('/api/navigate',{username:p.username});toast('Walking to '+p.username);};return b;}));const log=document.getElementById('chatlog');const recent=state.chat.slice(-5);log.innerHTML=recent.map((m)=>'<div><span class="speaker"></span> <span class="words"></span></div>').join('');[...log.children].forEach((row,i)=>{row.querySelector('.speaker').textContent=recent[i].username;row.querySelector('.words').textContent=recent[i].message;});log.classList.toggle('visible',recent.length>0);if(state.chat.length>lastChatCount&&lastChatCount)toast('New message');lastChatCount=state.chat.length;}catch(error){document.getElementById('status').textContent='reconnecting…';}}
    setInterval(refresh,500); refresh(); document.body.focus();
  </script>
</body>
</html>`;
