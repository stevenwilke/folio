-- Add book_drop_claimed to notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'friend_request', 'friend_accepted',
  'borrow_request', 'borrow_approved', 'borrow_returned',
  'order_update', 'recommendation', 'club_activity',
  'achievement', 'quote_shared', 'book_drop_claimed'
));
