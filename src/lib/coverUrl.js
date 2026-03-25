/**
 * Returns the best available cover URL for a book.
 * Falls back to Open Library ISBN cover if cover_image_url is not stored.
 */
export function getCoverUrl(book) {
  if (!book) return null
  if (book.cover_image_url) return book.cover_image_url
  if (book.isbn_13) return `https://covers.openlibrary.org/b/isbn/${book.isbn_13}-L.jpg`
  if (book.isbn_10) return `https://covers.openlibrary.org/b/isbn/${book.isbn_10}-L.jpg`
  return null
}
