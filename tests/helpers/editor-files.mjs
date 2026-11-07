export async function pasteScreenshot(page, selector, name = 'clipboard.png') {
  await page.locator(selector).evaluate(async (element, filename) => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, 0, 2400, 1400);
    ctx.fillStyle = '#222';
    ctx.font = '50px sans-serif';
    ctx.fillText('Hoora verification image', 80, 150);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')),
      data = new DataTransfer();
    data.items.add(new File([blob], filename, { type: 'image/png' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, name);
}
