-- Fix Homo Deus: add ISBNs, correct title and genre
UPDATE books SET
  title = 'Homo Deus: A Brief History of Tomorrow',
  isbn_13 = '9780062464316',
  isbn_10 = '0062464310',
  genre = 'Non-Fiction'
WHERE id = 'ffd268d4-b621-4513-a95f-3f715c21ef15';
