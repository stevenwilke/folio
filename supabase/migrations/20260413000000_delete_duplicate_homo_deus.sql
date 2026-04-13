-- Remove duplicate Homo Deus book record (75f6d254-faf0-4acc-a37a-e9a81f12653c)
-- Keeping ffd268d4-b621-4513-a95f-3f715c21ef15 as the canonical record
DELETE FROM collection_entries WHERE book_id = '75f6d254-faf0-4acc-a37a-e9a81f12653c';
DELETE FROM valuations WHERE book_id = '75f6d254-faf0-4acc-a37a-e9a81f12653c';
DELETE FROM books WHERE id = '75f6d254-faf0-4acc-a37a-e9a81f12653c';
