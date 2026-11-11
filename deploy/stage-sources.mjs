import { stageSources } from '../web/static-sources.mjs';

const result = stageSources();
console.log('Đã kiểm dấu và đưa ' + result.files + ' PDF chính thống (' + Math.round(result.bytes / 1024 / 1024) + ' MiB) vào tài nguyên tĩnh theo SHA-256.');
