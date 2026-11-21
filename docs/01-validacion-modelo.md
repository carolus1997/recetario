# Validación del modelo de datos con 5 recetas reales

Dataset: pollo al curry, puerros con mozzarella (variante de la receta original del documento maestro), albóndigas en salsa, ensalada templada de garbanzos, salmón al horno. Están en [03-recetas-semilla.json](03-recetas-semilla.json) en un formato de importación borrador.

## Qué fuerza cada receta

| Receta | Casos que prueba |
|---|---|
| Pollo al curry | Masa, volumen y cucharas; ingrediente opcional (cilantro); «sal» y «pimienta» sin cantidad; contables (1 cebolla, 2 dientes); conservación y congelación |
| Puerros | Electrodoméstico y temperatura (airfryer, 185 °C); fracción (0,5 cucharadita); pasos con rango de tiempo («3 a 5 min»); relación con la receta de puerros del documento maestro |
| Albóndigas | **Dos componentes** (albóndigas y salsa); un paso final que mezcla ambos; «aprox. 20 albóndigas» |
| Ensalada de garbanzos | Receta rápida y vegetariana; ingrediente ya cocido (garbanzos cocidos) |
| Salmón al horno | Doble cantidad («4 lomos, aprox. 600 g»); horno a 200 °C; rango «12 a 15 min»; **no congelar** |

Entre las cinco aparecen unos 55 ingredientes, de unos 28 distintos. Se repiten aceite de oliva (5 veces), sal (5), pimienta (4), cebolla (4) y tomate triturado (2), lo que sirve para probar la normalización.

## Lo que el modelo anterior ya resolvía

Cantidad y unidad estructuradas, ingredientes sin cantidad (`quantity_text`), opcionales, secciones, etiquetas, variantes, favoritos y fotos.

## Huecos encontrados y cambios (esquema v0.2)

| # | Hueco | Cambio |
|---|---|---|
| 1 | Dificultad, electrodomésticos, conservación, congelable. Son datos propios de la receta. | `recipes.difficulty` (`facil`/`media`/`dificil`), `appliances text[]`, `storage_days`, `freezable` (nulo = no se sabe), `storage_notes`. |
| 2 | Temperatura en los pasos («185 °C», «200 °C»). | `recipe_steps.temperature_c`. |
| 3 | Tiempos en rango («3 a 5 min», «12 a 15 min»). | `timer_min_seconds` y `timer_max_seconds` en lugar de `timer_seconds`. El temporizador usa el máximo, o el mínimo si no hay máximo. |
| 4 | Unidades: lomo, hoja, diente, cucharada, 0,5. Un enum fijo se queda corto. | Tabla `units` con `kind` (`mass`/`volume`/`count`/`spoon`) y `to_base` cuando hay equivalencia fiable. Cucharada y cucharadita se convierten a ml, nunca a g. Se admiten fracciones decimales. |
| 5 | «4 lomos (aprox. 600 g)»: dos cantidades de una vez. | `alt_quantity` y `alt_unit` en `recipe_ingredients`. La principal es 4 lomos; la alternativa, 600 g, sirve para la lista de la compra y los precios. |
| 6 | Albóndigas y salsa son componentes. | Se mantiene `section`: no hace falta una receta hija. Los pasos 1-3 pertenecen a la sección *Albóndigas*, los 4-7 a *Salsa* y el 8 queda sin sección (montaje). Una subreceta reutilizable en otras recetas queda para más adelante. |
| 7 | Alérgenos. | Se guardan en el ingrediente (`ingredients.allergens text[]`) y se calculan para la receta. No se escriben a mano en cada receta. Ejemplo: el pan rallado da gluten. |
| 8 | Etiquetas de naturaleza distinta (comida/cena, dieta, cocina, técnica). | `tags.kind` (`momento`, `dieta`, `cocina`, `tecnica`, `otro`), para poder filtrar por grupos. |
| 9 | «pimienta» frente a «pimienta negra»; «cebolla» frente a «cebolla morada». | Ingredientes distintos con `parent_ingredient_id` opcional, para agrupar en la lista de la compra («pimienta negra» pertenece a «pimienta»). |
| 10 | «ajo en polvo» frente a «ajo». | Ingredientes separados. No son alias. |
| 11 | La receta de puerros ya tiene variantes en el documento maestro; esta es la variante 1. | Se importa como variante de «Puerros asados con mozzarella», con `variant_label` «Con zanahoria, miel y soja». |
| 12 | «Aprox. 20 albóndigas»: dato de resultado. | Va en la descripción o en una nota. No se modela. |

## Decisiones cerradas (fase 1)

| Cuestión | Decisión |
|---|---|
| Crudo y cocido | Ingredientes distintos, vinculados al alimento base mediante `parent_ingredient_id` y `state` (garbanzo → garbanzos cocidos). |
| Subrecetas reutilizables | Fase 2. |
| Secciones dentro de una receta | Desde fase 1 (`section`). |
| Unidades | Códigos estables (`g`, `kg`, `ml`, `l`, `unidad`, `cucharada`, `cucharadita`…); texto visible en `units.label_es`. |
| Conversiones | Solo dentro de la misma magnitud. Volumen→masa y unidad→masa por ingrediente (`ingredient_unit_conversions`). |
| Regla | Nunca convertir entre estados (seco↔cocido) sin factor de rendimiento (`ingredient_yields`). 100 g de garbanzos secos no son 100 g de cocidos. |
