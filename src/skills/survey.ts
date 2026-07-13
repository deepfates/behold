import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

export type SurveySample = { x: number; z: number; y: number | null; block: string | null };

export type SurveyOptions = {
  radius?: number;
  step?: number;
  verticalRange?: number;
};

export async function surveyArea(bot: Bot, opts: SurveyOptions = {}) {
  const pos = (bot as any).entity?.position;
  if (!pos) return { ok: false, error: 'bot_not_spawned' };

  const radius = clampInt(opts.radius, 4, 48, 16);
  const step = clampInt(opts.step, 1, 8, 4);
  const verticalRange = clampInt(opts.verticalRange, 8, 96, 48);
  const center = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
  const samples: SurveySample[] = [];

  for (let z = center.z - radius; z <= center.z + radius; z += step) {
    for (let x = center.x - radius; x <= center.x + radius; x += step) {
      samples.push(findSurface(bot, x, z, center.y, verticalRange));
    }
  }

  return { ok: true, ...summarizeSurvey(samples, center, radius, step) };
}

export function summarizeSurvey(
  samples: SurveySample[],
  center: { x: number; y: number; z: number },
  radius: number,
  step: number,
) {
  const heights = samples
    .map((sample) => sample.y)
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : null;
  const materialCounts = new Map<string, number>();
  for (const sample of samples) {
    if (sample.block) materialCounts.set(sample.block, (materialCounts.get(sample.block) || 0) + 1);
  }
  const materials = [...materialCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 12);
  const highPoints =
    medianHeight == null
      ? []
      : samples
          .filter((sample) => sample.y != null && sample.y >= medianHeight + 4)
          .sort((a, b) => (b.y || 0) - (a.y || 0))
          .slice(0, 8);

  const byZ = new Map<number, SurveySample[]>();
  for (const sample of samples) {
    const row = byZ.get(sample.z) || [];
    row.push(sample);
    byZ.set(sample.z, row);
  }
  const map = [...byZ.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((sample) => classifyBlockName(sample.block))
        .join(''),
    );

  return {
    center,
    radius,
    step,
    sampledColumns: samples.length,
    observedColumns: heights.length,
    elevation: {
      min: heights[0] ?? null,
      median: medianHeight,
      max: heights[heights.length - 1] ?? null,
    },
    materials,
    highPoints,
    map,
    legend: {
      '.': 'ground',
      '#': 'stone/building',
      W: 'wood',
      T: 'tree',
      '~': 'water',
      '+': 'constructed/other',
      ' ': 'unknown',
    },
  };
}

export function classifyBlockName(name: string | null) {
  if (!name) return ' ';
  if (name === 'water' || name === 'lava') return '~';
  if (name.includes('leaves') || name.includes('log') || name.includes('stem')) return 'T';
  if (name.includes('planks') || name.includes('wood')) return 'W';
  if (
    name.includes('grass') ||
    name.includes('dirt') ||
    name.includes('sand') ||
    name.includes('gravel')
  )
    return '.';
  if (
    name.includes('stone') ||
    name.includes('brick') ||
    name.includes('concrete') ||
    name.includes('terracotta') ||
    name.includes('deepslate')
  )
    return '#';
  return '+';
}

function findSurface(
  bot: Bot,
  x: number,
  z: number,
  centerY: number,
  verticalRange: number,
): SurveySample {
  const maxY = Math.min(319, centerY + verticalRange);
  const minY = Math.max(-64, centerY - 8);
  for (let y = maxY; y >= minY; y--) {
    const block = (bot as any).blockAt?.(new Vec3(x, y, z), false);
    const name = String(block?.name || '');
    if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') continue;
    return { x, z, y, block: name };
  }
  return { x, z, y: null, block: null };
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
