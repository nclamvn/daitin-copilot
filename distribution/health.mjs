import http from 'node:http';
const origin = new URL(process.env.DAI_TIN_PUBLIC_ORIGIN);
const req = http.get({ host: '127.0.0.1', port: Number(process.env.PORT ?? 4320), path: '/healthz',
  headers: { Host: origin.host }, timeout: 4000 }, res => {
  res.resume();
  if (res.statusCode !== 200) process.exitCode = 1;
});
req.on('timeout', () => req.destroy());
req.on('error', () => { process.exitCode = 1; });
