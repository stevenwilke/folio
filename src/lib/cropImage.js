/**
 * Crop an image using canvas and return the result as a Blob.
 *
 * @param {string} imageSrc – data URL or object URL of the source image
 * @param {{ x: number, y: number, width: number, height: number }} cropPixels – pixel area from react-easy-crop's onCropComplete
 * @returns {Promise<Blob>}
 */
export default async function getCroppedImg(imageSrc, cropPixels) {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  canvas.width = cropPixels.width
  canvas.height = cropPixels.height

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    cropPixels.width,
    cropPixels.height,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      0.92,
    )
  })
}

function createImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.addEventListener('load', () => resolve(img))
    img.addEventListener('error', err => reject(err))
    img.crossOrigin = 'anonymous'
    img.src = url
  })
}
