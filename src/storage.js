// Attempt storage. For the demo everything lives in this browser (localStorage), so it works offline.
//
// To share results across a whole crew, swap this file for the Neon version below:
// put a small API route in front of a Neon Postgres table (for example a Next.js route handler
// or a Cloudflare/Vercel function using @neondatabase/serverless), then point API_URL at it.
//
//   CREATE TABLE attempts (
//     id text PRIMARY KEY, name text, mode text, module text, date timestamptz,
//     seconds int, mistakes int, incidents int, score int, pass boolean,
//     readiness text, failed jsonb, events jsonb
//   );
//
// const API_URL = 'https://your-app.example.com/api/attempts';
// export async function saveAttempt(a) { await fetch(API_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }); }
// export async function listAttempts() { return (await fetch(API_URL)).json(); }
// export async function clearAttempts() { await fetch(API_URL, { method: 'DELETE' }); }

const KEY = 'rigready.attempts.v1';

export async function listAttempts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; }
}
export async function saveAttempt(a) {
  const all = await listAttempts();
  all.push(a);
  localStorage.setItem(KEY, JSON.stringify(all.slice(-500)));
  return a;
}
export async function saveMany(list) {
  const all = await listAttempts();
  localStorage.setItem(KEY, JSON.stringify(all.concat(list).slice(-500)));
}
export async function clearAttempts() { localStorage.removeItem(KEY); }
