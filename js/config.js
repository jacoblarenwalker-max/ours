// Public client config. The publishable key is meant to be public; it can only call the
// key-checked "ours_*" functions. The notebook key itself lives only in the link's #fragment
// (never sent to GitHub) and in this device's storage.
export const SUPABASE_URL = 'https://voydoxmxdnjnewxlwzse.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_FO-tgfKuBTb19W8GaX1qZw_dtZRRdqY';
export const STALE_AFTER_HOURS = 30;

// The header's name and subtitle. Change SUBTITLE here, then run `node tools/apply-brand.mjs` so the page title,
// link-preview text and home-screen manifest match (the cover art itself has no subtitle on it).
export const BRAND_NAME = 'Ours';
export const SUBTITLE = 'Every dollar, side by side';
