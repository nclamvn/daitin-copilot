const demoWordName = 'Word · Potential Advice (bản mô phỏng)';

export const demoWord = [
  {
    id: 'word-vn-renewal', topic: 'vn-renewal', kind: 'word', simulated: true,
    title: demoWordName, anchor: 'Vietnam › Trademark › Renewal › Documents required',
    quote: 'For trademark renewal, submit a Power of Attorney signed by the trademark owner’s legal representative.',
    date: null, position: 'signed',
    answerTitle: 'Có, theo hướng dẫn trong Word',
    answerText: 'Theo tài liệu đang dùng, hồ sơ gia hạn nhãn hiệu tại Việt Nam cần giấy ủy quyền (POA) có chữ ký của người đại diện theo pháp luật của chủ sở hữu nhãn hiệu.',
  },
  {
    id: 'word-th-registration', topic: 'th-annuity', kind: 'word', simulated: true,
    title: demoWordName, anchor: 'Thailand › Patent › Registration',
    quote: 'The Power of Attorney for entry into the Thai PCT national phase should be notarized.',
    date: null, position: null,
    note: 'Đoạn này nói về vào giai đoạn quốc gia PCT, khác với nộp niên phí duy trì bằng sáng chế.',
  },
];

export const simulatedMail = {
  updated: [
    {
      id: 'sim-update-vn', topic: 'vn-renewal', kind: 'email', simulated: true, date: '2026-11-12',
      title: 'Email mô phỏng · Bộ phận nhãn hiệu Việt Nam', anchor: 'Xác nhận sử dụng lại POA · Đoạn 2',
      quote: 'This replaces our earlier renewal instruction. A new POA is unnecessary if the same representative already holds a valid authorization covering renewal.',
      position: 'reusable', supersedes: ['word-vn-renewal'],
      answerTitle: 'Có thể dùng POA đã lưu nếu còn phù hợp',
      answerText: 'Theo email mô phỏng, khi giữ nguyên đại diện và POA còn hiệu lực, có phạm vi bao gồm gia hạn, có thể dùng lại giấy đã lưu. Với trường hợp khác, cần đối chiếu trước khi nộp.',
    },
    {
      id: 'sim-update-th', topic: 'th-annuity', kind: 'email', simulated: true, date: '2026-11-12',
      title: 'Email mô phỏng · Đối tác Thái Lan', anchor: 'Thai patent annuity through an agent · Đoạn 2',
      quote: 'For patent annuity paid through our firm, we require a signed POA covering the annuity payment.',
      position: 'signed',
      answerTitle: 'Có, trong trường hợp nộp qua đối tác mô phỏng',
      answerText: 'Theo email mô phỏng, khi nộp niên phí duy trì bằng sáng chế qua hãng đại diện nêu trong email, hãng yêu cầu POA đã ký và có phạm vi bao gồm việc nộp niên phí.',
    },
  ],
  conflict: [
    {
      id: 'sim-conflict-th-a', topic: 'th-annuity', kind: 'email', simulated: true, date: '2026-11-11',
      title: 'Email mô phỏng · Đối tác Thái Lan', anchor: 'Thai patent annuity via appointed agent · Đoạn 2',
      quote: 'A fresh signed POA is required for this annuity even when the appointed agent and existing authorization are unchanged.',
      position: 'new-required',
    },
    {
      id: 'sim-conflict-th-b', topic: 'th-annuity', kind: 'email', simulated: true, date: '2026-11-12',
      title: 'Email mô phỏng · Đối tác Thái Lan', anchor: 'Thai patent annuity via appointed agent · Đoạn 3',
      quote: 'No fresh POA is needed for this annuity when the appointed agent and existing authorization are unchanged.',
      position: 'reusable',
    },
    {
      id: 'sim-conflict-vn', topic: 'vn-renewal', kind: 'email', simulated: true, date: '2026-11-12',
      title: 'Email mô phỏng · Bộ phận nhãn hiệu Việt Nam', anchor: 'Renewal without a POA · Đoạn 2',
      quote: 'For this trademark renewal, the file can be submitted without a Power of Attorney.',
      position: 'none',
    },
  ],
};
