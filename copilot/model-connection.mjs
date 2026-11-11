import { readFileSync, statSync } from 'node:fs';

// Endpoint configuration is administrator-owned. Requests can never override it.
export function modelConnection({
  port = process.env.DAI_TIN_MODEL_PORT,
  model = process.env.DAI_TIN_MODEL_ID,
  keyFile = process.env.DAI_TIN_MODEL_KEY_FILE,
  endpoint = process.env.DAI_TIN_MODEL_ENDPOINT,
  mode = process.env.DAI_TIN_MODEL_MODE
} = {}) {
  if (mode !== undefined && !['enabled', 'disabled'].includes(mode)) throw new Error('Chế độ AI cần enabled hoặc disabled.');
  if (mode === 'disabled') return null;
  if (!endpoint && port === undefined) return null;
  if (!/^[a-zA-Z0-9_.:/-]{1,120}$/.test(model ?? '')) {
    throw new Error('Cần mã mô hình và tệp khóa AI trên máy chủ.');
  }
  let target;
  let provider;
  if (endpoint) {
    target = new URL(endpoint);
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash ||
        !target.pathname.endsWith('/chat/completions')) {
      throw new Error('Endpoint AI cần HTTPS và đường dẫn chat/completions, không chứa khóa hay tham số.');
    }
    provider = target.hostname;
  } else {
    const number = Number(port);
    if (!Number.isInteger(number) || number < 1024 || number > 65535) throw new Error('Cổng mô hình chưa hợp lệ.');
    target = new URL('http://127.0.0.1:' + number + '/v1/chat/completions');
    provider = 'llama.cpp-loopback';
  }
  if (!keyFile && target.href === 'https://ai-gateway.vercel.sh/v1/chat/completions' && process.env.VERCEL === '1') {
    return { endpoint: target.href, model, provider, remote: true, key: null, async credential() {
      const { getVercelOidcToken } = await import('@vercel/oidc');
      const token = await getVercelOidcToken();
      if (typeof token !== 'string' || !token) throw new Error('AI Gateway chưa có danh tính máy chủ.');
      return token;
    } };
  }
  if (!keyFile) throw new Error('Cần tệp khóa AI trên máy chủ.');
  if (statSync(keyFile).mode & 0o077) throw new Error('Tệp khóa AI cần quyền 0600.');
  const key = readFileSync(keyFile, 'utf8').trim();
  if (!(endpoint ? /^[\x21-\x7e]{16,4096}$/ : /^[a-f0-9]{64}$/).test(key)) {
    throw new Error('Tệp khóa AI chưa hợp lệ.');
  }
  return { endpoint: target.href, model, key, provider, remote: Boolean(endpoint), credential: async () => key };
}

export const schemaFormat = (connection, name, schema) => connection.remote
  ? { type: 'json_schema', json_schema: { name, strict: true, schema } }
  : { type: 'json_schema', schema };
