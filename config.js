/* Supabase connection for the NFL pick'em.
 *
 * This MUST be a different Supabase project from the college app — the two
 * share a table shape, so pointing both at one database would mix the pools
 * together under the same week numbers.
 *
 * Both values are public by design; row-level security protects the data.
 * Never put the service_role / secret key here.
 */
window.CFB_CONFIG = {
  SUPABASE_URL: "https://kfistcvyygcprfslyiyh.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Betigpyl9AvmO7zfHWMCOg_ghcZT_p4",

  POLL_MS: 20000
};
