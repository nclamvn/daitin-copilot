import { readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const validName = /^[a-z][a-z0-9-]{0,29}$/;
const validKey = /^[a-f0-9]{64}$/;
const passwordRecord = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/;
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const keyDigest = key => createHash('sha256').update(key).digest('hex');
const validPassword = value => typeof value === 'string' && /^[!-~]{8,64}$/.test(value);
const equal = (left, right) => timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
const actorOf = ({ name, group, role }) => ({ name, group, role });
const sessionDigest = account => keyDigest(account.passwordHash ?? account.key);

function derivePassword(password, salt) {
  return scryptSync(password, Buffer.from(salt, 'hex'), 32, scryptOptions).toString('hex');
}

export function hashPilotPassword(password) {
  if (!validPassword(password)) throw new Error('Mật khẩu pilot phải có 8–64 ký tự ASCII in được, không có khoảng trắng.');
  const salt = randomBytes(16).toString('hex');
  return 'scrypt:' + salt + ':' + derivePassword(password, salt);
}

export function validPilotAccount(account) {
  return typeof account?.name === 'string' && validName.test(account.name) &&
    typeof account.group === 'string' && validName.test(account.group) &&
    typeof account.key === 'string' && validKey.test(account.key) && ['editor', 'reviewer'].includes(account.role) &&
    (account.passwordHash === undefined ||
      (typeof account.passwordHash === 'string' && passwordRecord.test(account.passwordHash)));
}

export function pilotAccess(file, { secure = false, savedSessions = [] } = {}) {
  if (!file) throw new Error('M5 cần tệp tài khoản pilot riêng.');
  const sessions = new Map();
  const cookieToken = req => req.headers.cookie?.match(/(?:^|;\s*)daitin_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const sessionId = req => { const token = cookieToken(req); return token ? keyDigest(token) : null; };
  if (!Array.isArray(savedSessions) || savedSessions.length > 128 || savedSessions.some(item =>
    !Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || !validKey.test(item[0]) || !item[1] ||
    typeof item[1].name !== 'string' || !validName.test(item[1].name) ||
    typeof item[1].digest !== 'string' || !validKey.test(item[1].digest) ||
    !Number.isSafeInteger(item[1].until))) throw new Error('Trạng thái phiên pilot không hợp lệ.');
  for (const [id, value] of savedSessions) if (value.until > Date.now()) sessions.set(id, { ...value });
  function accounts() {
    if (statSync(file).mode & 0o077) throw new Error('Tệp tài khoản M5 cần quyền 0600.');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(value) || !value.length || !value.every(validPilotAccount) ||
        new Set(value.map(x => x.name)).size !== value.length) {
      throw new Error('Cấu hình tài khoản M5 không hợp lệ.');
    }
    return value;
  }
  accounts();
  const activeAccount = name => accounts().find(item => item.name === name && !item.disabled);
  function authorize(req) {
    const credential = req.headers.authorization?.match(/^Basic ([a-zA-Z0-9+/=]{4,180})$/i)?.[1];
    if (credential) {
      // Password accounts only enter through the rate-limited login route.
      const parts = Buffer.from(credential, 'base64').toString().match(/^([a-z][a-z0-9-]{0,29}):([a-f0-9]{64})$/);
      if (!parts) return null;
      const account = activeAccount(parts[1]);
      return account && !account.passwordHash && equal(account.key, parts[2]) ? actorOf(account) : null;
    }

    const token = sessionId(req);
    const session = sessions.get(token);
    if (!session || session.until <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    const account = activeAccount(session.name);
    return account && equal(sessionDigest(account), session.digest) ? actorOf(account) : null;
  }
  authorize.login = (name, key) => {
    if (typeof name !== 'string' || !validName.test(name) || !validPassword(key)) return null;
    const account = activeAccount(name);
    if (!account) return null;
    if (account.passwordHash) {
      const [, salt, expected] = account.passwordHash.match(passwordRecord);
      if (!equal(derivePassword(key, salt), expected)) return null;
    } else if (!validKey.test(key) || !equal(account.key, key)) return null;

    for (const [token, session] of sessions) if (session.until <= Date.now()) sessions.delete(token);
    if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    sessions.set(keyDigest(token), { name, digest: sessionDigest(account), until: Date.now() + 7200000 });
    return 'daitin_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200' + (secure ? '; Secure' : '');
  };
  authorize.logout = req => {
    sessions.delete(sessionId(req));
    return 'daitin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + (secure ? '; Secure' : '');
  };
  authorize.snapshot = () => [...sessions].filter(([, value]) => value.until > Date.now());
  return authorize;
}
