// Client-side image compression → returns a small base64 data URL (~200x200 JPEG).
// Keeps user avatars tiny so we can store them directly in the DB without object storage.
export async function fileToCompressedDataUrl(file, maxSize = 240, quality = 0.85) {
  if (!file) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  // Scale down keeping aspect ratio, then center-crop to a square.
  const scale = Math.min(1, maxSize / Math.min(img.width, img.height));
  const w = img.width * scale;
  const h = img.height * scale;
  const canvas = document.createElement('canvas');
  canvas.width = maxSize;
  canvas.height = maxSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const dx = (maxSize - w) / 2;
  const dy = (maxSize - h) / 2;
  ctx.drawImage(img, dx, dy, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
