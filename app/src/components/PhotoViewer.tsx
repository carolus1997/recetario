import { useEffect } from 'react'
import type { RecipeImage } from '../lib/photos'

interface StepOpt {
  id: string
  position: number
}

interface Props {
  images: RecipeImage[]
  urls: Record<string, string>
  index: number
  steps: StepOpt[]
  onIndex: (i: number) => void
  onClose: () => void
  onCover: (img: RecipeImage) => void
  onDelete: (img: RecipeImage) => void
  onStep: (img: RecipeImage, stepId: string | null) => void
}

export default function PhotoViewer({ images, urls, index, steps, onIndex, onClose, onCover, onDelete, onStep }: Props) {
  const img = images[index]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onClose, onIndex])
  if (!img) return null

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Foto de la receta">
      <div className="vt">
        <span>{index + 1} de {images.length}{img.is_cover ? ' · portada' : ''}</span>
        <button type="button" onClick={onClose}>Cerrar</button>
      </div>
      <div className="vi">
        {urls[img.storage_path] && <img src={urls[img.storage_path]} alt="" />}
        {index > 0 && (
          <button type="button" className="nav prev" aria-label="Foto anterior" onClick={() => onIndex(index - 1)}>‹</button>
        )}
        {index < images.length - 1 && (
          <button type="button" className="nav next" aria-label="Foto siguiente" onClick={() => onIndex(index + 1)}>›</button>
        )}
      </div>
      <div className="vc">
        <label>
          Paso asociado
          <select value={img.step_id ?? ''} onChange={(e) => onStep(img, e.target.value || null)}>
            <option value="">Ninguno (foto general)</option>
            {steps.map((s) => (
              <option key={s.id} value={s.id}>Paso {s.position + 1}</option>
            ))}
          </select>
        </label>
        <div className="row">
          {!img.is_cover && !img.step_id && <button type="button" onClick={() => onCover(img)}>Usar como portada</button>}
          <button type="button" className="danger-btn" onClick={() => onDelete(img)}>Eliminar foto</button>
        </div>
      </div>
    </div>
  )
}
