import { api, onState, registerChrome, registerView, render, ui } from './core.js';
import { renderHeader, renderNav, renderNotice } from './shell.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderToday } from './views/today.js';
import { renderAsk } from './views/ask.js';
import { renderUpdates } from './views/updates.js';
import { renderDeadlines } from './views/deadlines.js';
import { renderFollowUps } from './views/followups.js';
import { renderMailboxes } from './views/mailboxes.js';
import { renderSubscriptions } from './views/subscriptions.js';
import { renderActivity } from './views/activity.js';
import { renderSorting } from './views/rules.js';
import { renderRules } from './views/replies.js';
import { renderNotifications } from './views/notifications.js';
import { renderSettings } from './views/settings.js';

registerChrome({ nav: renderNav, header: renderHeader, notice: renderNotice, onboarding: renderOnboarding });
registerView('today', renderToday);
registerView('ask', renderAsk);
registerView('updates', renderUpdates);
registerView('deadlines', renderDeadlines);
registerView('followups', renderFollowUps);
registerView('mailboxes', renderMailboxes);
registerView('subscriptions', renderSubscriptions);
registerView('activity', renderActivity);
registerView('sorting', renderSorting);
registerView('rules', renderRules);
registerView('notifications', renderNotifications);
registerView('settings', renderSettings);

api.onState(onState);
api.getState().then((s) => {
  ui.state = s;
  if (s.settings.userName) ui.onboardStep = 'mail';
  render();
});
