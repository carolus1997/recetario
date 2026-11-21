import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { supabase } from './lib/supabase'
import { Ln } from './components/Icon'
import Login from './pages/Login'
import Recipes from './pages/Recipes'
import RecipeDetail from './pages/RecipeDetail'
import RecipeForm from './pages/RecipeForm'
import CookMode from './pages/CookMode'
import ImportPage from './pages/Import'

export default function App() {
  const { session, householdId, loading, error } = useAuth()

  if (loading) return <p className="center">Cargando…</p>
  if (!session) return <Login />
  if (error) return <p className="center error">{error}</p>
  if (!householdId)
    return <p className="center">Tu usuario no pertenece a ningún hogar todavía.</p>

  return (
    <div className="app">
      <header className="topbar">
        <strong>Recetario</strong>
        <button className="link" onClick={() => supabase.auth.signOut()}>
          Salir
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Recipes />} />
          <Route path="/nueva" element={<RecipeForm />} />
          <Route path="/receta/:id" element={<RecipeDetail />} />
          <Route path="/receta/:id/editar" element={<RecipeForm />} />
          <Route path="/receta/:id/cocinar" element={<CookMode />} />
          <Route path="/receta/:id/variante" element={<RecipeForm mode="variant" />} />
          <Route path="/importar" element={<ImportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Principal">
        <NavLink to="/" end>
          <Ln name="b" />
          Cuaderno
        </NavLink>
        <NavLink to="/importar">
          <Ln name="leaf" />
          Importar
        </NavLink>
      </nav>
    </div>
  )
}
