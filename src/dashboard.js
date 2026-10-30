import { listAttempts, saveMany, clearAttempts } from './storage.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const cls = (r) => ({ 'Ready': 'ready', 'Ready with coaching': 'coach', 'Needs practice': 'practice', 'Not ready': 'not' }[r] || 'practice');

async function render() {
  const all = (await listAttempts()).sort((a, b) => b.date.localeCompare(a.date));
  $('empty').hidden = all.length > 0;
  const names = [...new Set(all.map((a) => a.name))];
  $('kTrainees').textContent = names.length;
  $('kAttempts').textContent = all.length;
  $('kPass').textContent = all.length ? Math.round(100 * all.filter((a) => a.pass).length / all.length) + '%' : '0%';
  $('kAvg').textContent = all.length ? Math.round(all.reduce((s, a) => s + a.score, 0) / all.length) : 0;
  const miss = {}; all.forEach((a) => (a.failed || []).forEach((f) => { miss[f] = (miss[f] || 0) + 1; }));
  const top = Object.entries(miss).sort((a, b) => b[1] - a[1])[0];
  $('kMissed').textContent = top ? `${top[0]} (${top[1]}x)` : 'None yet';

  $('crew').innerHTML = names.map((n) => {
    const mine = all.filter((a) => a.name === n);
    const best = mine.slice().sort((a, b) => (b.pass - a.pass) || (b.score - a.score))[0];
    const lastFails = (mine[0].failed || []).slice(0, 2);
    return `<article class="person ${cls(best.readiness)}">
      <div class="p-top"><b>${esc(n)}</b><span class="badge ${cls(best.readiness)}">${esc(best.readiness)}</span></div>
      <div class="p-score"><span class="big">${best.score}</span><span>best score · ${mine.length} attempt${mine.length > 1 ? 's' : ''}</span></div>
      <div class="p-gaps">${lastFails.length ? 'Last run missed: ' + lastFails.map(esc).join('; ') : 'Last run: clean'}</div>
    </article>`;
  }).join('');

  $('rows').innerHTML = all.map((a) => `<tr>
    <td><b>${esc(a.name)}</b>${a.sample ? ' <span class="tag">sample</span>' : ''}</td><td>${fmtDate(a.date)}</td><td>${esc(a.mode || 'Practice')}</td><td>${fmtTime(a.seconds)}</td>
    <td>${a.mistakes}</td><td class="${a.incidents ? 'red' : ''}">${a.incidents}</td><td><b>${a.score}</b></td>
    <td><span class="res ${a.pass ? 'pass' : 'fail'}">${a.pass ? 'PASS' : 'FAIL'}</span></td><td><span class="badge ${cls(a.readiness)}">${esc(a.readiness)}</span></td></tr>`).join('');
}

$('sampleBtn').addEventListener('click', async () => {
  const now = Date.now(); const H = 3600e3;
  const C = ['Permit signed before touching equipment', 'Own lock and tag on before opening the pump', 'Pressure bled to zero before opening', 'Isolation verified with a try-start', 'Picked only the right tools', 'Refused to let anyone remove your lock', 'Isolated the right breaker (MP-1)'];
  const mk = (name, hAgo, mode, seconds, mistakes, incidents, failed) => {
    const score = Math.max(0, 100 - mistakes * 8 - incidents * 35); const pass = !incidents && score >= 75;
    return { id: 's' + Math.random().toString(36).slice(2), sample: true, name, mode, module: 'RigReady: Mud Pump Lockout', date: new Date(now - hAgo * H).toISOString(), seconds, mistakes, incidents, score, pass,
      readiness: incidents ? 'Not ready' : score >= 90 ? 'Ready' : pass ? 'Ready with coaching' : 'Needs practice', failed };
  };
  await saveMany([
    mk('Chinedu Okafor', 50, 'Practice', 412, 2, 1, [C[1], C[3]]),
    mk('Chinedu Okafor', 26, 'Assessment', 338, 1, 0, [C[4]]),
    mk('Aisha Bello', 30, 'Assessment', 296, 0, 0, []),
    mk('Tunde Adeyemi', 28, 'Practice', 455, 1, 1, [C[5]]),
    mk('Tunde Adeyemi', 4, 'Practice', 390, 3, 0, [C[0], C[4], C[6]]),
    mk('Ngozi Eze', 20, 'Assessment', 318, 1, 0, [C[3]]),
    mk('Ibrahim Musa', 8, 'Practice', 501, 2, 2, [C[2], C[1]]),
    mk('Efe Ogbe', 2, 'Assessment', 287, 0, 0, []),
  ]);
  render();
});
$('clearBtn').addEventListener('click', async () => { if (confirm('Delete every attempt stored in this browser?')) { await clearAttempts(); render(); } });
$('csvBtn').addEventListener('click', async () => {
  const all = await listAttempts();
  const head = ['name', 'date', 'mode', 'seconds', 'mistakes', 'incidents', 'score', 'pass', 'readiness', 'missed'];
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [head.join(',')].concat(all.map((a) => [a.name, a.date, a.mode, a.seconds, a.mistakes, a.incidents, a.score, a.pass, a.readiness, (a.failed || []).join('; ')].map(q).join(','))).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a'); link.href = url; link.download = 'rigready-attempts.csv'; link.click(); URL.revokeObjectURL(url);
});
render();
