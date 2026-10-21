/** Counts slow Google calls per screen (each Sheet read/write ≈ 0.2–0.5 s in real Apps Script). Run: node test/perf.js */
const { createEnv } = require('./gas-mock');
const env = createEnv(); const { call, state } = env;
const L = 'owner@rosierfoods.com', A = 'asha@rosierfoods.com';
const future = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
state.currentUser = L; env.ctx.setup();
call(L, 'api_saveUser', { email: A, name: 'Asha', role: 'designer' });
let first;
for (let i = 0; i < 25; i++) {
  const s = call('', 'api_submitRequirement', { requesterName: 'R' + i, email: 'r' + i + '@x.com', department: 'Sales', brief: 'Req ' + i, preferredDate: future(5), quantity: 2 });
  call('', 'api_finalizeRequirement', s.data.uploadTicket);
}
first = call(L, 'api_listTasks', {}).data[0].taskId;
call(L, 'api_assignTask', first, { assigneeEmail: A, dueDate: future(3), priority: 'High' });
function measure(label, user, fn, ...args) {
  const out = [];
  for (let run = 0; run < 2; run++) {
    Object.keys(state.stats).forEach(k => state.stats[k] = 0);
    call(user, fn, ...args);
    out.push((state.stats.opens + state.stats.reads + state.stats.writes) + ' sheet calls');
  }
  console.log(label.padEnd(30) + 'first: ' + out[0].padEnd(16) + ' repeat: ' + out[1]);
}
measure('Leader dashboard', L, 'api_leaderDashboard');
measure('Task board', L, 'api_listTasks', {});
measure('Task detail', L, 'api_getTask', first);
measure('Designer dashboard', A, 'api_designerDashboard');
measure('Notifications poll', A, 'api_getNotifications');
measure('Bootstrap', L, 'api_bootstrap');
measure('Add comment (write)', A, 'api_addComment', first, 'hi');
measure('Update progress (write)', A, 'api_updateProgress', first, 25, '');
