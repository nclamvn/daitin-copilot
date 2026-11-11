// Opening the source file should offer a working entry point.
if (location.protocol === 'file:') {
  document.querySelector('.shell').hidden = true;
  document.querySelector('.symbols').hidden = true;
  document.querySelector('.skip').hidden = true;
  document.getElementById('file-entry').hidden = false;
} else {
  import('./app.mjs').catch(() => {
    const message = document.getElementById('status');
    message.hidden = false;
    message.dataset.error = '';
    message.textContent = 'Chưa tải được Bàn hồ sơ. Tải lại trang để kết nối.';
  });
}
