-- Marketplace safety RPCs
--
-- Problems addressed:
--   - place_order trusted client-supplied price + seller_id (financial spoofing).
--   - confirmOrder flipped listing -> sold without checking current status,
--     so two simultaneous buyers could both be confirmed.
--   - No idempotency on Place Order: double-click created two pending orders.
--   - State transitions (decline/cancel/ship/receive) had no current-status gate.
--
-- Strategy: every state change goes through a SECURITY DEFINER RPC that
-- locks the row, validates current state, and reads price/seller from the
-- listing itself. Clients only supply ids and free-text fields. RPCs return
-- the affected order_id (or void) and raise on conflict.
--
-- Note: each function uses a uniquely-named dollar quote ($fn_name$) so
-- naive SQL splitters (e.g. dashboard editors) can't confuse one function's
-- body with another's.

-- Belt-and-suspenders: at most one pending order per listing.
create unique index if not exists ux_orders_one_pending_per_listing
  on orders (listing_id) where status = 'pending';

-- ── place_order ──────────────────────────────────────────────────────────────
create or replace function place_order(
  p_listing_id        uuid,
  p_buyer_message     text,
  p_shipping_address  text
) returns uuid
language plpgsql security definer set search_path = public as $place_order$
declare
  v_buyer    uuid := auth.uid();
  v_listing  record;
  v_existing int;
  v_order_id uuid;
begin
  if v_buyer is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_shipping_address is null or length(trim(p_shipping_address)) = 0 then
    raise exception 'Shipping address required' using errcode = '22023';
  end if;

  select id, status, price, seller_id into v_listing
    from listings where id = p_listing_id for update;

  if not found then
    raise exception 'Listing not found' using errcode = '02000';
  end if;
  if v_listing.status <> 'active' then
    raise exception 'Listing is no longer available' using errcode = '22023';
  end if;
  if v_listing.seller_id = v_buyer then
    raise exception 'You cannot buy your own listing' using errcode = '22023';
  end if;

  select count(*) into v_existing
    from orders where listing_id = p_listing_id and status = 'pending';
  if v_existing > 0 then
    raise exception 'An order is already pending on this listing' using errcode = '22023';
  end if;

  insert into orders (listing_id, buyer_id, seller_id, price, status, buyer_message, shipping_address)
    values (p_listing_id, v_buyer, v_listing.seller_id, v_listing.price, 'pending',
            nullif(trim(p_buyer_message), ''), trim(p_shipping_address))
    returning id into v_order_id;

  update listings set status = 'pending' where id = p_listing_id;

  return v_order_id;
end $place_order$;

-- ── confirm_order ────────────────────────────────────────────────────────────
create or replace function confirm_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $confirm_order$
declare
  v_uid   uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select id, listing_id, seller_id, status into v_order
    from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '02000'; end if;
  if v_order.seller_id <> v_uid then raise exception 'Not your order' using errcode = '42501'; end if;
  if v_order.status <> 'pending' then
    raise exception 'Order is no longer pending' using errcode = '22023';
  end if;

  update orders   set status = 'confirmed', updated_at = now() where id = p_order_id;
  update listings set status = 'sold' where id = v_order.listing_id;
end $confirm_order$;

-- ── decline_order ────────────────────────────────────────────────────────────
create or replace function decline_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $decline_order$
declare
  v_uid   uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select id, listing_id, seller_id, status into v_order
    from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '02000'; end if;
  if v_order.seller_id <> v_uid then raise exception 'Not your order' using errcode = '42501'; end if;
  if v_order.status <> 'pending' then
    raise exception 'Order is no longer pending' using errcode = '22023';
  end if;

  update orders   set status = 'declined', updated_at = now() where id = p_order_id;
  update listings set status = 'active' where id = v_order.listing_id and status = 'pending';
end $decline_order$;

-- ── cancel_order ─────────────────────────────────────────────────────────────
create or replace function cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $cancel_order$
declare
  v_uid   uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select id, listing_id, buyer_id, status into v_order
    from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '02000'; end if;
  if v_order.buyer_id <> v_uid then raise exception 'Not your order' using errcode = '42501'; end if;
  if v_order.status <> 'pending' then
    raise exception 'Order can no longer be cancelled' using errcode = '22023';
  end if;

  update orders   set status = 'cancelled', updated_at = now() where id = p_order_id;
  update listings set status = 'active' where id = v_order.listing_id and status = 'pending';
end $cancel_order$;

-- ── mark_shipped ─────────────────────────────────────────────────────────────
create or replace function mark_shipped(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $mark_shipped$
declare v_uid uuid := auth.uid(); v_order record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select seller_id, status into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '02000'; end if;
  if v_order.seller_id <> v_uid then raise exception 'Not your order' using errcode = '42501'; end if;
  if v_order.status <> 'confirmed' then
    raise exception 'Order must be confirmed before shipping' using errcode = '22023';
  end if;
  update orders set status = 'shipped', updated_at = now() where id = p_order_id;
end $mark_shipped$;

-- ── mark_received ────────────────────────────────────────────────────────────
create or replace function mark_received(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $mark_received$
declare v_uid uuid := auth.uid(); v_order record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select buyer_id, status into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '02000'; end if;
  if v_order.buyer_id <> v_uid then raise exception 'Not your order' using errcode = '42501'; end if;
  if v_order.status not in ('shipped', 'confirmed') then
    raise exception 'Order is not in a receivable state' using errcode = '22023';
  end if;
  update orders set status = 'completed', updated_at = now() where id = p_order_id;
end $mark_received$;

-- ── remove_listing ───────────────────────────────────────────────────────────
create or replace function remove_listing(p_listing_id uuid)
returns void language plpgsql security definer set search_path = public as $remove_listing$
declare v_uid uuid := auth.uid(); v_listing record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select seller_id, status into v_listing from listings where id = p_listing_id for update;
  if not found then raise exception 'Listing not found' using errcode = '02000'; end if;
  if v_listing.seller_id <> v_uid then raise exception 'Not your listing' using errcode = '42501'; end if;
  if v_listing.status = 'pending' then
    raise exception 'Decline the pending order before removing this listing' using errcode = '22023';
  end if;
  update listings set status = 'removed' where id = p_listing_id;
end $remove_listing$;

-- ── mark_listing_sold ────────────────────────────────────────────────────────
create or replace function mark_listing_sold(p_listing_id uuid)
returns void language plpgsql security definer set search_path = public as $mark_listing_sold$
declare v_uid uuid := auth.uid(); v_listing record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select seller_id, status into v_listing from listings where id = p_listing_id for update;
  if not found then raise exception 'Listing not found' using errcode = '02000'; end if;
  if v_listing.seller_id <> v_uid then raise exception 'Not your listing' using errcode = '42501'; end if;
  if v_listing.status = 'pending' then
    raise exception 'A pending order exists; confirm or decline it first' using errcode = '22023';
  end if;
  update listings set status = 'sold' where id = p_listing_id;
end $mark_listing_sold$;

-- Grants
revoke all on function place_order(uuid, text, text)        from public;
revoke all on function confirm_order(uuid)                  from public;
revoke all on function decline_order(uuid)                  from public;
revoke all on function cancel_order(uuid)                   from public;
revoke all on function mark_shipped(uuid)                   from public;
revoke all on function mark_received(uuid)                  from public;
revoke all on function remove_listing(uuid)                 from public;
revoke all on function mark_listing_sold(uuid)              from public;

grant execute on function place_order(uuid, text, text)     to authenticated;
grant execute on function confirm_order(uuid)               to authenticated;
grant execute on function decline_order(uuid)               to authenticated;
grant execute on function cancel_order(uuid)                to authenticated;
grant execute on function mark_shipped(uuid)                to authenticated;
grant execute on function mark_received(uuid)               to authenticated;
grant execute on function remove_listing(uuid)              to authenticated;
grant execute on function mark_listing_sold(uuid)           to authenticated;
