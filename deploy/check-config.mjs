import { matchesGlob } from 'node:path';

// Vercel validates these fields before running the build. Keep that platform
// constraint local as well, and check the resources needed by dynamic loaders.
export function validateDeploymentConfig(config, resources = []) {
  const fn = config.functions?.['api/index.mjs'];
  if (!fn) throw new Error('Thiếu cấu hình Function.');
  for (const name of ['includeFiles', 'excludeFiles']) {
    if (typeof fn[name] !== 'string' || fn[name].length > 256) {
      throw new Error('Vercel ' + name + ' phải là glob không vượt 256 ký tự.');
    }
  }
  for (const path of resources) {
    if (!matchesGlob(path, fn.includeFiles) || matchesGlob(path, fn.excludeFiles)) {
      throw new Error('Tài nguyên động chưa được đưa vào Function: ' + path);
    }
  }
  return { includeLength: fn.includeFiles.length, excludeLength: fn.excludeFiles.length, resources: resources.length };
}
