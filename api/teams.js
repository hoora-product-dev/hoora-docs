import { serverClient } from '../server/supabase.js';
import { botReady, handleActivity, verifyTeamsRequest } from '../server/teams-bot.js';

// The address Teams calls for the Hoora Releases bot (set in Teams Developer Portal). Only
// requests signed by Microsoft for this bot, from the Hoora organization, are accepted.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!botReady()) return res.status(503).json({ error: 'The Teams bot is not set up.' });
  let activity;
  try {
    activity = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    await verifyTeamsRequest(req.headers?.authorization, activity);
    return res.status(200).json({ result: await handleActivity(activity, serverClient()) });
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('Teams bot:', error.message);
    return res.status(error.status || 500).json({ error: error.message });
  }
}
