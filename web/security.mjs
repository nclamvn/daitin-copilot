export function webSettings(env = process.env) {
  if (env.DAI_TIN_WEB !== '1') return null;
  const origin = new URL(env.DAI_TIN_PUBLIC_ORIGIN ?? '');
  const test = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) &&
    env.DAI_TIN_WEB_TEST_HTTP === '1';
  if ((!test && origin.protocol !== 'https:') || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash || env.DAI_TIN_M5 !== '1' ||
      env.DAI_TIN_M3 !== '1' || env.DAI_TIN_COPILOT !== '1' || env.DAI_TIN_PILOT !== '1') {
    throw new Error('Bản web cần HTTPS, tài khoản và đầy đủ chế độ pilot M5.');
  }
  const origins = [origin.origin];
  if (env.VERCEL === '1') for (const value of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (value && /^[a-z0-9-]+\.vercel\.app$/.test(value)) origins.push('https://' + value);
  }
  return { origin: origin.origin, host: origin.host, origins: [...new Set(origins)], secure: !test };
}

export function allowedRequest(req, settings) {
  const host = req.headers.host ?? '';
  const origins = settings ? settings.origins ?? [settings.origin] : ['http://' + host];
  const hosts = settings ? origins.map(value => new URL(value).host) : ['127.0.0.1:' + req.socket.localPort, 'localhost:' + req.socket.localPort];
  // Forwarded headers never grant authority; reverse proxy must preserve Host.
  return hosts.includes(host) && (!req.headers.origin || req.headers.origin === (settings ? new URL(origins.find(value => new URL(value).host === host) ?? settings.origin).origin : 'http://' + host)) &&
    !(req.headers['sec-fetch-site'] === 'cross-site' && !['GET', 'HEAD'].includes(req.method));
}

export const publicWebAsset = path => [
  '/brand.css', '/public/brand.css', '/brand/daitin.png', '/public/brand/daitin.png',
  '/fonts.css', '/public/fonts.css', '/copilot/m3/login.js', '/copilot/m3/login.css',
  '/copilot/m3/workspace/', '/copilot/m3/workspace', '/copilot/m3/workspace/index.html'
].includes(path);

export function windowLimit(max, windowMs, maxKeys = 1024, saved = []) {
  if (!Array.isArray(saved) || saved.length > maxKeys || saved.some(item =>
    !Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || item[0].length > 200 ||
    !item[1] || !Number.isSafeInteger(item[1].count) || item[1].count < 0 || item[1].count > max ||
    !Number.isSafeInteger(item[1].until))) throw new Error('Bộ đếm pilot chưa hợp lệ.');
  const entries = new Map(saved.map(([key, value]) => [key, { ...value }]));
  const limited = (key, now = Date.now()) => {
    for (const [id, value] of entries) if (value.until <= now) entries.delete(id);
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= maxKeys) return false;
      entry = { count: 0, until: now + windowMs };
      entries.set(key, entry);
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
  };
  limited.snapshot = () => [...entries].filter(([, value]) => value.until > Date.now());
  return limited;
}
