-- Add PayPal and Venmo payment handle fields to profiles
-- These are the user's PayPal.me username and Venmo @handle
-- (without paypal.me/ prefix or @ prefix respectively)
-- Used by the marketplace to generate deep-link pay buttons for confirmed orders.

alter table profiles
  add column if not exists paypal_handle text,
  add column if not exists venmo_handle  text;
