import { Link } from 'react-router-dom'
import { Ill, Ln, illustrationFor } from './Icon'
import { difficultyLabel } from '../lib/labels'

export interface CardRecipe {
  id: string
  title: string
  prep_minutes: number | null
  cook_minutes: number | null
  difficulty: string | null
  freezable: boolean | null
  parent_recipe_id: string | null
  variant_label: string | null
  tags: string[]
  ingredientNames: string[]
}

interface Props {
  recipe: CardRecipe
  favorite: boolean
  coverUrl?: string
  onToggleFavorite: (id: string) => void
}

export default function RecipeCard({ recipe, favorite, coverUrl, onToggleFavorite }: Props) {
  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)
  return (
    <article className="card">
      {recipe.parent_recipe_id && <span className="ribbon">Variante</span>}
      <div className="pic">
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="nopic">
            <Ill name={illustrationFor([recipe.title, ...recipe.ingredientNames])} />
          </div>
        )}
        <button
          type="button"
          className="fav"
          aria-pressed={favorite}
          aria-label={favorite ? 'Quitar de favoritas' : 'Añadir a favoritas'}
          onClick={() => onToggleFavorite(recipe.id)}
        >
          <Ln name="heart" />
        </button>
      </div>
      <Link className="card-link" to={`/receta/${recipe.id}`}>
        <div className="body">
          <h3>{recipe.title}</h3>
          <div className="meta">
            {total > 0 && <span><b>{total} min</b></span>}
            {recipe.difficulty && <span>{difficultyLabel(recipe.difficulty)}</span>}
            {recipe.freezable === true && <span>se congela</span>}
            {recipe.freezable === false && <span>no congelar</span>}
            {recipe.variant_label && <span>{recipe.variant_label}</span>}
          </div>
          {recipe.tags.length > 0 && (
            <p className="tags">
              {recipe.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </p>
          )}
        </div>
      </Link>
    </article>
  )
}
