/** El e2e necesita el backend levantado con docker compose (nginx en :8080). */
export default async function globalSetup() {
  const backend = process.env.VITE_BACKEND ?? 'http://localhost:8080';
  try {
    const res = await fetch(`${backend}/health`);
    if (!res.ok) throw new Error(`health ${res.status}`);
  } catch (err) {
    throw new Error(
      `El backend no responde en ${backend} (${(err as Error).message}). Levantalo con: docker compose up -d`,
      { cause: err },
    );
  }
}
