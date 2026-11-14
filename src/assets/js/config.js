// Pergola configuration: allowed values, defaults and the short URL format used to share a configuration.

export const LIMITS = {
  width: { min: 3, max: 7, step: 0.5 },
  depth: { min: 2, max: 5, step: 0.5 },
  height: { min: 2.2, max: 3, step: 0.1 },
  angle: { min: 0, max: 90, step: 5 },
  drop: { min: 0, max: 100, step: 10 },
};

export const ROOFS = ['poliweglan', 'szklo', 'lamele'];
export const MOUNTS = ['sciana', 'wolnostojaca'];
export const SIDES = ['front', 'lewa', 'prawa'];
export const COLORS = [
  { id: '7016', hex: '#383e42' },
  { id: '9016', hex: '#eeede6' },
  { id: '9005', hex: '#171717' },
  { id: '7024', hex: '#4b4e54' },
  { id: 'drewno', hex: '#8a5a35' },
];

export const DEFAULTS = Object.freeze({
  width: 4,
  depth: 3,
  height: 2.5,
  mount: 'sciana',
  roof: 'poliweglan',
  angle: 30,
  color: '7016',
  screens: [],
  drop: 60,
  led: false,
});

// Clamps to the range and snaps to the step, e.g. 4.3 m with a 0.5 m step becomes 4.5 m.
export function snap(value, { min, max, step }, fallback) {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return Math.round((min + Math.round((clamped - min) / step) * step) * 100) / 100;
}

export function normalize(input = {}) {
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const screens = Array.isArray(input.screens) ? input.screens : String(input.screens ?? '').split(',');
  return {
    width: snap(input.width, LIMITS.width, DEFAULTS.width),
    depth: snap(input.depth, LIMITS.depth, DEFAULTS.depth),
    height: snap(input.height, LIMITS.height, DEFAULTS.height),
    mount: pick(input.mount, MOUNTS, DEFAULTS.mount),
    roof: pick(input.roof, ROOFS, DEFAULTS.roof),
    angle: snap(input.angle, LIMITS.angle, DEFAULTS.angle),
    color: pick(input.color, COLORS.map((color) => color.id), DEFAULTS.color),
    screens: SIDES.filter((side) => screens.includes(side)),
    drop: snap(input.drop, LIMITS.drop, DEFAULTS.drop),
    led: input.led === true || input.led === '1' || input.led === 'true',
  };
}

const KEYS = { width: 's', depth: 'g', height: 'w', mount: 'm', roof: 'd', angle: 'k', color: 'c', screens: 'z', drop: 'o', led: 'l' };

// ?s=4&g=3&w=2.5&m=sciana&d=lamele&k=30&c=7016&z=front,lewa&o=60&l=1
export function toQuery(config) {
  const params = new URLSearchParams();
  for (const [name, key] of Object.entries(KEYS)) {
    const value = config[name];
    if (name === 'screens') params.set(key, value.join(','));
    else if (name === 'led') params.set(key, value ? '1' : '0');
    else params.set(key, String(value));
  }
  return params.toString();
}

export function fromQuery(search) {
  const params = new URLSearchParams(search);
  const input = {};
  for (const [name, key] of Object.entries(KEYS)) {
    if (params.has(key)) input[name] = params.get(key);
  }
  return normalize(input);
}
