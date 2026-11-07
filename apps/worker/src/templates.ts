// WhatsApp message templates. Business-initiated messages outside the 24h
// customer service window MUST use a template pre-approved in Meta Business
// Manager. Register each `name` with exactly this body ({{n}} = parameter n).
// Inside the window the same body is sent as free text, so wording stays identical.

export const TEMPLATES = {
  reminder_24h: {
    name: 'visit_reminder_day_before',
    category: 'UTILITY',
    body: 'Reminder: your site visit with {{1}} is on {{2}} ({{3}}). Reply 1 to confirm or 2 to reschedule.',
  },
  reminder_2h: {
    name: 'visit_reminder_same_day',
    category: 'UTILITY',
    body: '{{1}} is due at your property at {{2}} today. Reply RESCHEDULE if you can no longer make it.',
  },
  attendance_check: {
    name: 'visit_attendance_check',
    category: 'UTILITY',
    body: 'Did {{1}} arrive for your site visit? Reply 1 for Yes or 2 for No.',
  },
  installer_new_booking: {
    name: 'installer_new_booking',
    category: 'UTILITY',
    body:
      'New booked visit {{1}} on {{2}}. Customer: {{3}}, +{{4}}. {{5}}. ' +
      'After the visit reply WON {{1}} <amount>, LOST {{1}} <reason> or NOSHOW {{1}}.',
  },
  installer_outcome_request: {
    name: 'installer_outcome_request',
    category: 'UTILITY',
    body: 'How did visit {{1}} ({{2}}, {{3}}) go? Reply WON {{1}} <amount>, LOST {{1}} <reason> or NOSHOW {{1}}.',
  },
  installer_low_balance: {
    name: 'installer_low_balance',
    category: 'UTILITY',
    body: 'Your prepaid balance is {{1}} ({{2}} visits). Ads pause below {{3}}. Reply TOPUP to get a secure payment link.',
  },
  installer_topup_received: {
    name: 'installer_topup_received',
    category: 'UTILITY',
    body: 'Top-up of {{1}} received. Available credit: {{2}} ({{3}} visits). Thank you!',
  },
  installer_ads_resumed: {
    name: 'installer_ads_resumed',
    category: 'UTILITY',
    body: 'Your ads are live again. Available credit: {{1}} ({{2}} visits).',
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function renderTemplate(key: TemplateKey, params: string[]): string {
  return TEMPLATES[key].body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}
