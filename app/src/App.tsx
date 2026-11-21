import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Recipes from './pages/Recipes'
import RecipeDetail from './pages/RecipeDetail'
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
          <Route path="/receta/:id" element={<RecipeDetail />} />
          <Route path="/importar" element={<ImportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="tabbar">
        <NavLink to="/" end>Recetas</NavLink>
        <NavLink to="/importar">Importar</NavLink>
      </nav>
    </div>
  )
}
