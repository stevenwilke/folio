/**
 * Returns the best available cover URL for a book.
 * Falls back to Open Library ISBN cover if cover_image_url is not stored.
 */
export function getCoverUrl(book) {
  if (!book) return null
  if (book.cover_image_url) return book.cover_image_url
  // ?default=false makes OL return 404 instead of a blank placeholder GIF,
  // so the img onError handler fires and we fall back to FakeCover properly.
  if (book.isbn_13) return `https://covers.openlibrary.org/b/isbn/${book.isbn_13}-L.jpg?default=false`
  if (book.isbn_10) return `https://covers.openlibrary.org/b/isbn/${book.isbn_10}-L.jpg?default=false`
  return null
}
