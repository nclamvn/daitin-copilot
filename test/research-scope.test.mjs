import assert from 'node:assert/strict';
import test from 'node:test';
import { search } from '../research.mjs';

test('mỹ phẩm, mỹ nghệ và mỹ thuật không bị nhận nhầm là thẩm quyền Mỹ', () => {
  for (const [query, procedure] of [
    ['Đăng ký nhãn hiệu mỹ phẩm tại Việt Nam dùng mẫu nào?', 'registration'],
    ['Gia hạn nhãn hiệu mỹ phẩm dùng mẫu nào?', 'renewal'],
    ['Đăng ký nhãn hiệu hàng mỹ nghệ tại Việt Nam dùng mẫu nào?', 'registration'],
    ['Đăng ký nhãn hiệu dịch vụ mỹ thuật tại Việt Nam dùng mẫu nào?', 'registration']
  ]) {
    const result = search(query, '2026-07-01');
    assert.equal(result.status, 'found', query);
    assert.equal(result.procedure, procedure, query);
    assert.ok(result.hits.length > 0, query);
  }
});

test('thẩm quyền Mỹ vẫn ngoài phạm vi kể cả câu hỏi có tên hàng hóa mỹ phẩm', () => {
  for (const query of [
    'Đăng ký nhãn hiệu ở Mỹ dùng mẫu nào?',
    'Gia hạn nhãn hiệu tại Hoa Kỳ dùng mẫu nào?',
    'Đăng ký nhãn hiệu mỹ phẩm tại Mỹ dùng mẫu nào?',
    'Đăng ký nhãn hiệu mỹ nghệ tại Hoa Kỳ dùng mẫu nào?'
  ]) assert.equal(search(query, '2026-07-01').status, 'out_of_scope', query);
});

test('ngoại lệ tên hàng hóa không mở rộng phạm vi Madrid hoặc nước ngoài', () => {
  for (const query of [
    'Đăng ký Madrid cho nhãn hiệu mỹ phẩm dùng mẫu nào?',
    'Đăng ký nhãn hiệu mỹ phẩm tại Nhật Bản dùng mẫu nào?',
    'Đăng ký nhãn hiệu mỹ nghệ ở nước ngoài dùng mẫu nào?'
  ]) assert.equal(search(query, '2026-07-01').status, 'out_of_scope', query);
});
