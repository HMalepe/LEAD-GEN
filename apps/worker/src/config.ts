// Runtime configuration. Everything business-tunable lives here, not in logic.

export interface Territory {
  name: string;
  /** Inclusive 4-digit postal code ranges served. */
  postalRanges: Array<[number, number]>;
}

/**
 * EXAMPLE territory: Pretoria/Tshwane (0001–0299) and Johannesburg + East Rand (1400–2199).
 * Replace with the real postal codes each client's territory contract covers.
 */
export const TERRITORY: Territory = {
  name: 'Gauteng (Pretoria + Johannesburg)',
  postalRanges: [
    [1, 299],
    [1400, 2199],
  ],
};

/** Brand shown to consumers. Placeholder: set BRAND_NAME to your registered trading name. */
export const BRAND = process.env.BRAND_NAME ?? 'LEAD-GEN Home Services';
export const PRIVACY_URL = process.env.PRIVACY_URL ?? 'https://example.com/privacy';

/** Unparseable answers in a row before a human takes over. */
export const MAX_FAILED_PARSES = 3;

/** Courtesy window for service messages (reminders, attendance checks), SAST hours [start, end). */
export const SERVICE_WINDOW = { startHour: 7, endHour: 21 };

/** Days after an attended visit to ask the installer for the outcome. */
export const OUTCOME_REQUEST_DAYS = [3, 7, 14];
/** Installers with an attended visit older than this and no outcome stop receiving bookings. */
export const OUTCOME_OVERDUE_DAYS = 14;
/** Hours after attendance before the visit is billed (dispute window). */
export const BILLING_DELAY_HOURS = 48;
