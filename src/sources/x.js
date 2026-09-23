// X has no Composio trigger type, so Jev polls recent mentions with the app-only search tool.
import { execute } from '../composio.js';
import { fromTweet } from '../normalize.js';
import { loadState, saveState } from '../config.js';

/** Fetch mentions newer than the saved cursor. First call only sets the cursor (no backlog replies). */
export async function pollMentions(cfg) {
  const handle = cfg.sources.x.handle.replace(/^@/, '');
  const state = loadState();
  const args = {
    query: `@${handle} -from:${handle} -is:retweet`,
    max_results: 20,
    sort_order: 'recency',
    expansions: ['author_id'],
    tweet_fields: ['created_at', 'author_id', 'conversation_id'],
    user_fields: ['username', 'name'],
  };
  if (state.x.sinceId) args.since_id = state.x.sinceId;
  const data = await execute(cfg, 'x', 'TWITTER_RECENT_SEARCH', args);
  const tweets = data?.data ?? [];
  const users = Object.fromEntries((data?.includes?.users ?? []).map((u) => [u.id, u]));
  const newest = data?.meta?.newest_id ?? tweets[0]?.id;
  const firstRun = !state.x.sinceId;
  if (newest) {
    state.x.sinceId = newest;
    saveState(state);
  }
  if (firstRun) return { items: [], firstRun: true };
  return { items: tweets.map((t) => fromTweet(t, users)).reverse(), firstRun: false };
}
