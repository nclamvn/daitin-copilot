import { Worker } from 'node:worker_threads';
import { CaseError } from '../m3/workflow.mjs';

const maxBytes = 2 * 1024 * 1024;
const timeoutMs = 8000;
let active = 0;

function run(operation, bytes, page) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes ||
      !/^%PDF-[0-9]\.[0-9]/.test(Buffer.from(bytes).subarray(0, 8).toString('ascii'))) {
    return Promise.reject(new CaseError('Chọn PDF hợp lệ, tối đa 2 MiB.', 422));
  }
  if (active >= 2) return Promise.reject(new CaseError('Đang đọc hai tệp. Hãy thử lại sau.', 429));
  active += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    let timer;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker?.terminate().catch(() => {});
      active -= 1;
      if (error) reject(error);
      else resolve(operation === 'render' ? Buffer.from(result) : result);
    };
    try {
      worker = new Worker(new URL('./pdf-js-worker.mjs', import.meta.url), {
        workerData: { operation, bytes: new Uint8Array(bytes), page },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
        // Test-runner/eval flags are invalid for a file-backed worker.
        execArgv: []
      });
      timer = setTimeout(() => finish(new CaseError('PDF vượt giới hạn thời gian xử lý. Kiểm tra tệp gốc.', 422)), timeoutMs);
      worker.once('message', value => finish(value.error ? new CaseError(value.error.message, value.error.status) : null, value.result));
      worker.once('error', error => {
        console.error('PDF worker:', error.name, error.code ?? 'execution-failed');
        void finish(new CaseError('PDF bị khóa, hỏng hoặc vượt giới hạn xử lý. Kiểm tra tệp gốc.', 422));
      });
      worker.once('exit', () => { if (!settled) void finish(new CaseError('PDF chưa xử lý được hoặc vượt giới hạn tài nguyên.', 422)); });
    } catch (error) {
      console.error('PDF worker start:', error.name, error.code ?? 'start-failed');
      void finish(new CaseError('Chưa khởi động được bộ đọc PDF.', 503));
    }
  });
}

export const inspectWithPDFJS = bytes => run('inspect', bytes);
export const renderWithPDFJS = (bytes, page) => run('render', bytes, page);
