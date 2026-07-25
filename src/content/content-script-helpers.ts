export async function withFallback<T, F = T>(primary: () => Promise<T>, fallback: () => Promise<F>): Promise<T | F> {
  try { return await primary(); } catch { return await fallback(); }
}
