import { readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const validName = /^[a-z][a-z0-9-]{0,29}$/;
const validKey = /^[a-f0-9]{64}$/;

export function pilotAccess(file, { secure = false, savedSessions = [] } = {}) {
  if (!file) throw new Error('M5 cần tệp tài khoản pilot riêng.');
  const sessions = new Map();
  const keyDigest = key => createHash('sha256').update(key).digest('hex');
  const cookieToken = req => req.headers.cookie?.match(/(?:^|;\s*)daitin_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const sessionId = req => { const token = cookieToken(req); return token ? keyDigest(token) : null; };
  if (!Array.isArray(savedSessions) || savedSessions.length > 128 || savedSessions.some(item =>
    !Array.isArray(item) || item.length !== 2 || !validKey.test(item[0]) || !item[1] ||
    !validName.test(item[1].name ?? '') || !validKey.test(item[1].digest ?? '') ||
    !Number.isSafeInteger(item[1].until))) throw new Error('Trạng thái phiên pilot không hợp lệ.');
  for (const [id, value] of savedSessions) if (value.until > Date.now()) sessions.set(id, { ...value });
  function accounts() {
    if (statSync(file).mode & 0o077) throw new Error('Tệp tài khoản M5 cần quyền 0600.');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(value) || !value.length || new Set(value.map(x => x.name)).size !== value.length ||
        value.some(x => !validName.test(x.name ?? '') || !validName.test(x.group ?? '') ||
          !validKey.test(x.key ?? '') || !['editor', 'reviewer'].includes(x.role))) {
      throw new Error('Cấu hình tài khoản M5 không hợp lệ.');
    }
    return value;
  }
  accounts();
  function authorize(req) {
    const credential = req.headers.authorization?.match(/^Basic ([a-zA-Z0-9+/=]{4,180})$/i)?.[1];
    let name;
    let digest;
    if (credential) {
      const parts = Buffer.from(credential, 'base64').toString().match(/^([a-z][a-z0-9-]{0,29}):([a-f0-9]{64})$/);
      if (!parts) return null;
      name = parts[1];
      digest = keyDigest(parts[2]);
    } else {
      const token = sessionId(req);
      const session = sessions.get(token);
      if (!session || session.until <= Date.now()) {
        sessions.delete(token);
        return null;
      }
      name = session.name;
      digest = session.digest;
    }
    const account = accounts().find(item => item.name === name && !item.disabled);
    return account && timingSafeEqual(Buffer.from(keyDigest(account.key)), Buffer.from(digest)) ?
      { name, group: account.group, role: account.role } : null;
  }
  authorize.login = (name, key) => {
    if (!validName.test(name ?? '') || !validKey.test(key ?? '')) return null;
    const actor = authorize({ headers: { authorization: 'Basic ' + Buffer.from(name + ':' + key).toString('base64') } });
    if (!actor) return null;
    for (const [token, session] of sessions) if (session.until <= Date.now()) sessions.delete(token);
    if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    sessions.set(keyDigest(token), { name, digest: keyDigest(key), until: Date.now() + 7200000 });
    return 'daitin_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200' + (secure ? '; Secure' : '');
  };
  authorize.logout = req => {
    sessions.delete(sessionId(req));
    return 'daitin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + (secure ? '; Secure' : '');
  };
  authorize.snapshot = () => [...sessions].filter(([, value]) => value.until > Date.now());
  return authorize;
}
