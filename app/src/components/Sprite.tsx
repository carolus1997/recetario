import html from './sprite.html?raw'

// Filtros (#rough, #crayon) e ilustraciones (<symbol>) del diseño, montados una sola vez.
// Contenido estático del propio repositorio, no entrada del usuario.
export default function Sprite() {
  return <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}
