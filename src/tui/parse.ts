export type Parsed = { tool: string; args?: any; preempt?: boolean; kind?: 'exclusive'|'parallel' } | { meta: 'help'|'json'|'unknown', args?: any };

export function parseLine(line: string): Parsed {
  const s = (line || '').trim();
  if (!s) return { meta: 'unknown' } as any;
  if (s === 'help' || s.startsWith('help ')) return { meta: 'help', args: s.slice(5) };
  if (s === 'json on') return { meta: 'json', args: { on: true } } as any;
  if (s === 'json off') return { meta: 'json', args: { on: false } } as any;

  const preempt = s.startsWith('!');
  const body = preempt ? s.slice(1).trim() : s;
  const [cmd, ...rest] = split(body);
  const tail = rest.join(' ');

  switch (cmd) {
    case 'say':
    case 'chat':
      return { tool: 'chat', args: { text: stripQuotes(tail) }, kind: 'parallel', preempt };
    case 'status':
      return { tool: 'status', kind: 'parallel', preempt } as any;
    case 'cursor':
      return { tool: 'block_at_cursor', args: {}, kind: 'parallel', preempt } as any;
    case 'nearby':
      return { tool: 'get_nearby', args: parseKV(rest), kind: 'parallel', preempt } as any;
    case 'look': {
      const tok = rest;
      if (tok.length >= 3 && isNum(tok[0]) && isNum(tok[1]) && isNum(tok[2])) {
        return { tool: 'look_at', args: { x: +tok[0], y: +tok[1], z: +tok[2] }, preempt };
      }
      if (tok[0] === '@cursor') return { tool: 'look_at', args: { x: '@cursor_x', y: '@cursor_y', z: '@cursor_z' }, preempt } as any;
      return { meta: 'unknown' } as any;
    }
    case 'move': {
      if (rest[0] !== 'to') return { meta: 'unknown' } as any;
      const tok = rest.slice(1);
      const kv = parseKV(tok);
      if (tok[0] === '@cursor') return { tool: 'move_to', args: { x: '@cursor_x', y: '@cursor_y', z: '@cursor_z', ...kv }, preempt } as any;
      if (tok.length >= 3 && isNum(tok[0]) && isNum(tok[1]) && isNum(tok[2])) {
        return { tool: 'move_to', args: { x: +tok[0], y: +tok[1], z: +tok[2], ...kv }, preempt };
      }
      return { meta: 'unknown' } as any;
    }
    case 'stop':
      return { tool: 'stop', kind: 'exclusive', preempt: true } as any;
    case 'dig': {
      const tok = rest;
      if (tok[0] === '@cursor') return { tool: 'dig_block', args: { x: '@cursor_x', y: '@cursor_y', z: '@cursor_z' }, preempt } as any;
      if (tok.length >= 3 && isNum(tok[0]) && isNum(tok[1]) && isNum(tok[2])) {
        return { tool: 'dig_block', args: { x: +tok[0], y: +tok[1], z: +tok[2] }, preempt };
      }
      return { meta: 'unknown' } as any;
    }
    case 'place':
      return { tool: 'place_against', args: { on: { x: '@cursor_x', y: '@cursor_y', z: '@cursor_z' }, face: 'top' }, preempt } as any;
    case 'equip':
      return { tool: 'equip_item', args: { name: stripQuotes(tail) }, preempt };
    case 'eat':
      return tail ? { tool: 'consume', args: { name: stripQuotes(tail) }, preempt } as any : { tool: 'consume', preempt } as any;
  }

  return { meta: 'unknown' } as any;
}

function split(s: string) {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (!inQ && /\s/.test(c)) { if (cur) out.push(cur), cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function stripQuotes(s: string) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function isNum(s: string) { return s != null && s !== '' && !Number.isNaN(Number(s)); }

function parseKV(tokens: string[]) {
  const kv: any = {};
  for (const t of tokens) {
    const m = /^([a-zA-Z_][\w-]*)=(.+)$/.exec(t);
    if (m) kv[m[1]] = numOrStr(m[2]);
  }
  return kv;
}

function numOrStr(v: string) { const n = Number(v); return Number.isFinite(n) ? n : v; }

