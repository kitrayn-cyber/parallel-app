// Same Berkeley windows as the existing UI; Intl handles daylight saving time.
export function available(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms));
  const get = k => parts.find(p => p.type === k).value;
  const t = Number(get('hour')) * 60 + Number(get('minute'));
  if (t < 390 || t >= 1350) return false;
  return ['Sat', 'Sun'].includes(get('weekday')) || t < 480 || (t >= 720 && t < 780) || t >= 1140;
}
export function nextAvailable(ms) {
  for (let n = 0; n < 2880; n++) {
    const at = ms + n * 60000;
    if (available(at)) return at;
  }
  throw new Error('No schedule window');
}
export function dueAt(now, random = Math.random) {
  // Artificial delay is 30 seconds–3 hours; sleep/lab windows can extend it.
  return nextAvailable(now + 30000 + Math.floor(random() * (10800000 - 30000)));
}
