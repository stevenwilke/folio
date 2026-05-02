-- Atomic in-app notifications for friendship events.
--
-- The audit flagged that notify.js fires AFTER the action commits, with
-- Promise.allSettled, so if the in-app insert silently fails (RLS, type
-- check, network) the action commits without notifying the other party —
-- "ghost activity." Friend request / accept is the most-frequent path,
-- so we move the in-app insert into a DB trigger that runs in the same
-- transaction as the friendship row change.
--
-- Push and email channels stay on the client side via notify.js (best-
-- effort). Other notification types (borrows, orders, etc.) still go
-- through notify.js end-to-end — applying this same pattern there is
-- a follow-up.
--
-- The client should NOT also call notify(..., 'friend_request') / 'friend_accepted'
-- for the in-app channel; the calls remain valid for push/email but the
-- in-app insert is now redundant. Updated client-side to skip in-app.
--
-- friendships table lives outside the migration tree (Supabase Studio),
-- so we guard with pg_class.

do $do$
begin
  if exists (select 1 from pg_class where relname = 'friendships') then
    execute $body$
      create or replace function trg_friendship_request_notify()
      returns trigger language plpgsql security definer set search_path = public
      as $fn$
      declare v_username text;
      begin
        if new.status <> 'pending' then return new; end if;
        select username into v_username from profiles where id = new.requester_id;
        insert into notifications (user_id, actor_id, type, title, body, link, metadata)
        values (
          new.addressee_id,
          new.requester_id,
          'friend_request',
          'New friend request',
          coalesce(v_username, 'Someone') || ' wants to be your friend',
          '/friends',
          jsonb_build_object('friendship_id', new.id, 'from_user_id', new.requester_id)
        );
        return new;
      end
      $fn$;
    $body$;

    execute $body$
      create or replace function trg_friendship_accept_notify()
      returns trigger language plpgsql security definer set search_path = public
      as $fn$
      declare v_username text;
      begin
        if new.status = 'accepted' and old.status is distinct from 'accepted' then
          select username into v_username from profiles where id = new.addressee_id;
          insert into notifications (user_id, actor_id, type, title, body, link, metadata)
          values (
            new.requester_id,
            new.addressee_id,
            'friend_accepted',
            'Friend request accepted',
            coalesce(v_username, 'Someone') || ' accepted your friend request',
            '/profile/' || coalesce(v_username, ''),
            jsonb_build_object('friendship_id', new.id)
          );
        end if;
        return new;
      end
      $fn$;
    $body$;

    execute 'drop trigger if exists trg_friendships_notify_request on friendships';
    execute 'create trigger trg_friendships_notify_request '
         || 'after insert on friendships '
         || 'for each row execute function trg_friendship_request_notify()';

    execute 'drop trigger if exists trg_friendships_notify_accept on friendships';
    execute 'create trigger trg_friendships_notify_accept '
         || 'after update on friendships '
         || 'for each row execute function trg_friendship_accept_notify()';
  end if;
end
$do$;
