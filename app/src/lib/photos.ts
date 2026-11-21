import { supabase } from './supabase'

export const BUCKET = 'recipe-images'
const MAX_SIDE = 1600
const MAX_BYTES = 5 * 1024 * 1024 // límite del bucket

export interface RecipeImage {
  id: string
  recipe_id: string
  step_id: string | null
  storage_path: string
  origin: 'user' | 'imported'
  is_cover: boolean
  position: number
}

// Redimensiona y recodifica en el cliente. Al repintar en un canvas se pierden los metadatos
// (EXIF, incluida la ubicación GPS) y se respeta la orientación original.
export async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number; ext: string }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se puede leer esa imagen. Prueba con un JPG, PNG o WebP.')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const encode = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q))
  let type = 'image/webp'
  let ext = 'webp'
  let blob = await encode(type, 0.82)
  if (!blob || blob.type !== type) {
    type = 'image/jpeg' // navegadores sin soporte de escritura WebP
    ext = 'jpg'
    blob = await encode(type, 0.82)
  }
  for (let q = 0.7; blob && blob.size > MAX_BYTES && q > 0.3; q -= 0.1) blob = await encode(type, q)
  if (!blob || blob.size > MAX_BYTES) throw new Error('La imagen sigue siendo demasiado grande.')
  return { blob, width, height, ext }
}

export async function uploadPhoto(opts: {
  householdId: string
  recipeId: string
  file: File
  stepId?: string | null
  existingCount: number
  hasCover: boolean
}): Promise<void> {
  const { blob, width, height, ext } = await prepareImage(opts.file)
  const path = `${opts.householdId}/${opts.recipeId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type })
  if (up.error) throw new Error(up.error.message)
  const { error } = await supabase.from('recipe_images').insert({
    recipe_id: opts.recipeId,
    step_id: opts.stepId ?? null,
    storage_path: path,
    origin: 'user',
    is_cover: !opts.hasCover && !opts.stepId, // la primera foto general es la portada
    position: opts.existingCount,
    width,
    height,
    bytes: blob.size,
  })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]) // no dejar archivos huérfanos
    throw new Error(error.message)
  }
}

export async function deletePhoto(img: RecipeImage): Promise<void> {
  const { error } = await supabase.from('recipe_images').delete().eq('id', img.id)
  if (error) throw new Error(error.message)
  await supabase.storage.from(BUCKET).remove([img.storage_path])
}

// Solo puede haber una portada por receta (índice único): se quita la anterior antes de poner la nueva.
export async function setCover(img: RecipeImage): Promise<void> {
  const a = await supabase.from('recipe_images').update({ is_cover: false }).eq('recipe_id', img.recipe_id).eq('is_cover', true)
  if (a.error) throw new Error(a.error.message)
  const b = await supabase.from('recipe_images').update({ is_cover: true, step_id: null }).eq('id', img.id)
  if (b.error) throw new Error(b.error.message)
}

export async function setStep(img: RecipeImage, stepId: string | null): Promise<void> {
  const { error } = await supabase
    .from('recipe_images')
    .update({ step_id: stepId, is_cover: stepId ? false : img.is_cover })
    .eq('id', img.id)
  if (error) throw new Error(error.message)
}

// URLs temporales (1 hora) para el bucket privado.
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (error) throw new Error(error.message)
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}
