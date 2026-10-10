export const api = window.internpulse;

export async function unwrap<T>(promise: Promise<{ ok: true; data: T }>): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    const message = (result as unknown as { error?: string }).error ?? 'Unknown IPC error';
    throw new Error(message);
  }
  return result.data;
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
