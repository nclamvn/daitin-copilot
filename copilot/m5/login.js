const form = document.getElementById('login');
const error = document.getElementById('error');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = form.querySelector('button');
  if (submit.disabled) return;
  submit.disabled = true;
  error.hidden = true;
  try {
    const values = new FormData(form);
    const response = await fetch('/api/m5/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: values.get('username'), key: values.get('key') })
    });
    form.elements.key.value = '';
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error ?? 'Chưa đăng nhập được. Thử lại sau.');
    }
    const target = form.dataset.returnTo;
    if (['/patents/', '/copilot/m3/workspace/'].includes(target)) {
      const next = new URL(target, location.origin);
      const id = new URL(location.href).searchParams.get('case');
      if (id && /^[a-f0-9-]{36}$/.test(id)) next.searchParams.set('case', id);
      location.assign(next.href);
    } else location.reload();
  } catch (detail) {
    error.textContent = detail.message;
    error.hidden = false;
    submit.disabled = false;
  }
});
