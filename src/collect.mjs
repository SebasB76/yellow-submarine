const GRAPHQL_URL = 'https://api.github.com/graphql';
const MAX_GROWTH_CONTRIBUTIONS = 100_000;
const CONTRIBUTION_SCALE = 50;
const WEEKS_PER_STRIPE = 4;
const MAX_STRIPES = 5;
const WORK_EVENT_TYPES = new Set([
  'PushEvent', 'PullRequestEvent', 'PullRequestReviewEvent', 'PullRequestReviewCommentEvent',
  'IssuesEvent', 'IssueCommentEvent', 'CreateEvent',
]);
// Totals that unlock John, Paul, George, and Ringo's keepsakes, in that order.
const KEEPSAKE_MILESTONES = [100, 500, 1_000, 2_500];
const AMBIENT_WINDOW_DAYS = 7;
const MIN_AMBIENT_EVENTS = 3;

async function graphql(query, variables, token) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'yellow-submarine',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(`GitHub GraphQL request failed: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

export async function collectAccount(login, token) {
  const overview = await graphql(
    `query ($login: String!) {
      user(login: $login) {
        contributionsCollection { contributionYears }
      }
    }`,
    { login },
    token,
  );
  if (!overview.user) throw new Error(`GitHub has no user named ${login}`);

  // One aliased query fetches every year; GitHub caps a calendar at one year.
  const years = overview.user.contributionsCollection.contributionYears;
  const yearFields = years
    .map(year => `y${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${year}-12-31T23:59:59Z") {
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }`)
    .join('\n');
  const calendars = await graphql(`query ($login: String!) { user(login: $login) { ${yearFields} } }`, { login }, token);

  let totalContributions = 0;
  const dailyCounts = new Map();
  for (const year of years) {
    const calendar = calendars.user[`y${year}`].contributionCalendar;
    totalContributions += calendar.totalContributions;
    for (const week of calendar.weeks) {
      for (const day of week.contributionDays) dailyCounts.set(day.date, day.contributionCount);
    }
  }

  const workTimes = await collectWorkTimes(login, token);
  return { login, totalContributions, dailyCounts, workTimes };
}

// The events API keeps about 90 days and 300 public events; private work is invisible to it.
async function collectWorkTimes(login, token) {
  const times = [];
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(`https://api.github.com/users/${login}/events/public?per_page=100&page=${page}`, {
      headers: { Authorization: `bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'yellow-submarine' },
    });
    if (!response.ok) throw new Error(`GitHub events request failed: ${response.status} ${await response.text()}`);
    const events = await response.json();
    for (const event of events) if (WORK_EVENT_TYPES.has(event.type)) times.push(new Date(event.created_at));
    if (events.length < 100) break;
  }
  return times;
}

const isoDate = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
const mondayOf = date => addDays(date, -((date.getUTCDay() + 6) % 7));

function countCurrentWeeklyStreak(dailyCounts, observedOn) {
  const weekIsActive = monday => [0, 1, 2, 3, 4, 5, 6].some(i => (dailyCounts.get(isoDate(addDays(monday, i))) ?? 0) > 0);
  let monday = mondayOf(observedOn);
  // The observation week is still in progress, so an empty one does not end the streak.
  if (!weekIsActive(monday)) monday = addDays(monday, -7);
  let weeks = 0;
  while (weekIsActive(monday)) {
    weeks += 1;
    monday = addDays(monday, -7);
  }
  return weeks;
}

function classifyActivity(dailyCounts, observedOn) {
  const observedCount = dailyCounts.get(isoDate(observedOn)) ?? 0;
  if (observedCount === 0) return { level: 0, observedCount };
  const activeDays = [];
  for (let i = 1; i <= 365; i++) {
    const count = dailyCounts.get(isoDate(addDays(observedOn, -i))) ?? 0;
    if (count > 0) activeDays.push(count);
  }
  activeDays.sort((a, b) => a - b);
  const median = activeDays.length ? activeDays[Math.floor(activeDays.length / 2)] : 1;
  const busy = observedCount >= Math.max(5, median * 2);
  return { level: busy ? 2 : 1, observedCount };
}

function classifyAmbient(workTimes, observedOn, utcOffsetHours) {
  const windowEnd = addDays(observedOn, 1);
  const windowStart = addDays(windowEnd, -AMBIENT_WINDOW_DAYS);
  let times = workTimes.filter(time => time >= windowStart && time < windowEnd);
  // A quiet week falls back to every known event, so the water keeps the usual hours.
  if (times.length < MIN_AMBIENT_EVENTS) times = workTimes.filter(time => time < windowEnd);
  const counts = { morning: 0, afternoon: 0, night: 0 };
  for (const time of times) {
    const hour = (time.getUTCHours() + utcOffsetHours + 24) % 24;
    if (hour >= 5 && hour < 12) counts.morning += 1;
    else if (hour >= 12 && hour < 19) counts.afternoon += 1;
    else counts.night += 1;
  }
  const ambient = times.length === 0 ? 'morning' : Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return { ambient, counts };
}

// Same diminishing growth curve as git-koi, mapped onto stages 1 through 4.
function growthStage(totalContributions) {
  const bounded = Math.min(totalContributions, MAX_GROWTH_CONTRIBUTIONS);
  const fraction = Math.log2(1 + bounded / CONTRIBUTION_SCALE) / Math.log2(1 + MAX_GROWTH_CONTRIBUTIONS / CONTRIBUTION_SCALE);
  return 1 + 3 * fraction;
}

export function developSubmarine(account, observedOn, utcOffsetHours) {
  const streakWeeks = countCurrentWeeklyStreak(account.dailyCounts, observedOn);
  const activity = classifyActivity(account.dailyCounts, observedOn);
  const ambient = classifyAmbient(account.workTimes, observedOn, utcOffsetHours);
  return {
    observedOn: isoDate(observedOn),
    stage: growthStage(account.totalContributions),
    stripes: Math.min(MAX_STRIPES, Math.ceil(streakWeeks / WEEKS_PER_STRIPE)),
    activity: activity.level,
    ambient: ambient.ambient,
    keepsakes: KEEPSAKE_MILESTONES.filter(milestone => account.totalContributions >= milestone).length,
    facts: {
      totalContributions: account.totalContributions,
      streakWeeks,
      observedCount: activity.observedCount,
      workHours: ambient.counts,
    },
  };
}
