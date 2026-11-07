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
export const BRAND = process.env.BRAND_NAME ?? 'LEAD-GEN Solar Desk';
export const PRIVACY_URL = process.env.PRIVACY_URL ?? 'https://example.com/privacy';

/** Minimum score (0–100) to offer an appointment. See docs/03-architecture.md §4. */
export const SCORE_THRESHOLD = 60;

/** Unparseable answers in a row before a human takes over. */
export const MAX_FAILED_PARSES = 3;

/** Appointment slot starts (SAST, 24h) and length. */
export const SLOT_TIMES = ['09:00', '12:00', '15:00'];
export const SLOT_MINUTES = 90;
/** Earliest bookable slot, hours from now. Gives the installer time to prepare. */
export const MIN_LEAD_TIME_HOURS = 24;
