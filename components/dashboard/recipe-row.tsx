"use client";

import { type FormEvent, useState } from "react";
import type { InventoryItem } from "@/lib/dashboard/inventory-utils";
import { getRecipeId, type Recipe, type RecipeComponent } from "@/lib/dashboard/recipe-normalizers";

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const extractUuid = (value: unknown) => String(value ?? "").match(uuidPattern)?.[0] ?? "";
const formControlClass = "h-11 min-w-0 w-full rounded-sm border border-border-system bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-text-ghost focus:border-accent focus:ring-2 focus:ring-accent/20";
const primaryButtonClass = "h-11 rounded-sm bg-accent px-4 text-sm font-semibold text-background transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70";
const secondaryButtonClass = "h-11 rounded-sm border border-border-system bg-card px-4 text-sm font-semibold text-foreground transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-50";

export function RecipeRow({
  recipe,
  components,
  inventoryItems,
  currency,
  disabled,
  onUpdateRecipeDetails,
  onUpdateRecipeComponentQuantity,
}: {
  recipe: Recipe;
  components: RecipeComponent[];
  inventoryItems: InventoryItem[];
  currency: string;
  disabled: boolean;
  onUpdateRecipeDetails: (
    recipeId: string,
    patch: Partial<
      Pick<
        Recipe,
        | "name"
        | "recipe_type"
        | "output_uom"
        | "standard_batch_output_qty"
        | "standard_yield_pct"
        | "selling_price"
        | "is_active"
      >
    >,
  ) => Promise<void>;
  onUpdateRecipeComponentQuantity: (
    component: RecipeComponent,
    quantity: number,
  ) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);

  async function handleRecipeDetailsUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const recipeType = String(formData.get("recipe_type") ?? "sub_recipe");
    const outputUom = String(formData.get("output_uom") ?? "").trim() || "unit";
    const standardBatchOutputQty = Number(
      formData.get("standard_batch_output_qty") ?? 1,
    );
    const standardYieldPct = Number(formData.get("standard_yield_pct") ?? 1);
    const nextSellingPrice = Number(formData.get("selling_price") ?? 0);

    if (!name) {
      return;
    }

    await onUpdateRecipeDetails(getRecipeId(recipe), {
      name,
      recipe_type:
        recipeType === "final_menu_item" ? "final_menu_item" : "sub_recipe",
      output_uom: outputUom,
      standard_batch_output_qty:
        Number.isFinite(standardBatchOutputQty) && standardBatchOutputQty > 0
          ? standardBatchOutputQty
          : 1,
      standard_yield_pct:
        Number.isFinite(standardYieldPct) &&
        standardYieldPct > 0 &&
        standardYieldPct <= 1
          ? standardYieldPct
          : 1,
      selling_price:
        Number.isFinite(nextSellingPrice) && nextSellingPrice >= 0
          ? nextSellingPrice
          : 0,
    });
    setIsEditing(false);
  }

  async function handleDeactivateRecipe() {
    await onUpdateRecipeDetails(getRecipeId(recipe), { is_active: false });
  }

  return (
    <div className="grid gap-4 border-t border-border-system px-5 py-4 text-sm text-text-muted transition hover:bg-background/70 lg:grid-cols-[1.1fr_0.65fr_0.55fr_0.7fr_1.2fr]">
      <div className="min-w-0">
        <p className="truncate font-semibold text-foreground">{recipe.name}</p>
        <p className="text-xs text-text-ghost">
          Baseline: {Number(recipe.standard_batch_output_qty ?? 1).toLocaleString()}{" "}
          {recipe.output_uom ?? "unit"} | Yield:{" "}
          {Math.round(recipe.standard_yield_pct * 100)}%
        </p>
      </div>
      <span className="w-fit rounded-sm border border-border-system bg-background px-2.5 py-1 text-xs font-semibold capitalize text-text-muted">
        {recipe.recipe_type === "sub_recipe" ? "Sub recipe" : "Menu item"}
      </span>
      <span className="font-semibold text-foreground">
        {currency} {Number(recipe.resolved_unit_cost ?? 0).toLocaleString()}
      </span>
      {recipe.recipe_type === "sub_recipe" ? (
        <span className="font-semibold text-text-ghost">No menu price</span>
      ) : (
        <span className="font-semibold text-foreground">
          {currency} {Number(recipe.selling_price ?? 0).toLocaleString()}
        </span>
      )}
      <div className="grid gap-1 text-xs text-text-muted">
        {components.length > 0 ? (
          components.map((component) => {
            const item = inventoryItems.find(
              (inventoryItem) =>
                extractUuid(inventoryItem.id) ===
                extractUuid(component.component_inventory_item_id),
            );
            const yieldPct = Math.max(Number(item?.yield_pct ?? 1) || 1, 0.0001);
            const netQty = Number(component.qty_in_recipe_uom) || 0;
            const grossQty = netQty / yieldPct;

            return (
              <span key={component.id} className="leading-5">
                {item?.name ?? component.ingredient_name ?? "Ingredient"}: net{" "}
                {netQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
                {component.recipe_uom}, gross{" "}
                {grossQty.toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}{" "}
                at {Math.round(yieldPct * 100)}% yield
              </span>
            );
          })
        ) : (
          <span>No ingredients</span>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsEditing((currentValue) => !currentValue)}
          className="mt-2 h-9 w-fit rounded-sm border border-border-system bg-card px-3 text-xs font-semibold text-foreground transition hover:border-border-system-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isEditing ? "Close edit" : "Edit recipe"}
        </button>
      </div>
      {isEditing ? (
        <form
          onSubmit={handleRecipeDetailsUpdate}
          className="col-span-full grid gap-3 rounded-sm border border-border-system bg-background p-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.55fr_0.65fr_0.55fr_0.65fr_auto_auto]"
        >
          <input
            name="name"
            defaultValue={recipe.name}
            disabled={disabled}
            className={formControlClass}
            aria-label={`Recipe name for ${recipe.name}`}
          />
          <select
            name="recipe_type"
            defaultValue={
              recipe.recipe_type === "sub_recipe" ? "sub_recipe" : "final_menu_item"
            }
            disabled={disabled}
            className={formControlClass}
            aria-label={`Recipe type for ${recipe.name}`}
          >
            <option value="sub_recipe">Sub recipe</option>
            <option value="final_menu_item">Menu item</option>
          </select>
          <input
            name="output_uom"
            defaultValue={recipe.output_uom ?? "unit"}
            disabled={disabled}
            className={formControlClass}
            aria-label={`Output unit for ${recipe.name}`}
          />
          <input
            name="standard_batch_output_qty"
            type="number"
            min="0.000001"
            step="any"
            defaultValue={recipe.standard_batch_output_qty}
            disabled={disabled}
            className={formControlClass}
            aria-label={`Batch output for ${recipe.name}`}
          />
          <input
            name="standard_yield_pct"
            type="number"
            min="0.01"
            max="1"
            step="0.01"
            defaultValue={recipe.standard_yield_pct}
            disabled={disabled}
            className={formControlClass}
            aria-label={`Yield for ${recipe.name}`}
          />
          <input
            name="selling_price"
            type="number"
            min="0"
            step="0.01"
            defaultValue={recipe.selling_price}
            disabled={disabled}
            className={formControlClass}
            aria-label={`Selling price for ${recipe.name}`}
          />
          <button type="submit" disabled={disabled} className={primaryButtonClass}>
            Save recipe
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={handleDeactivateRecipe}
            className={secondaryButtonClass}
          >
            Deactivate
          </button>
        </form>
      ) : null}
      {isEditing && components.length > 0 ? (
        <div className="col-span-full grid gap-2 rounded-sm border border-border-system bg-background p-3">
          {components.map((component) => {
            const item = inventoryItems.find(
              (inventoryItem) =>
                extractUuid(inventoryItem.id) ===
                extractUuid(component.component_inventory_item_id),
            );

            return (
              <form
                key={`edit-${component.id}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  const quantity = Number(formData.get("component_quantity"));

                  onUpdateRecipeComponentQuantity(component, quantity);
                }}
                className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_90px] md:items-center"
              >
                <p className="truncate font-semibold text-foreground">
                  {item?.name ?? component.ingredient_name ?? "Ingredient"}
                </p>
                <input
                  name="component_quantity"
                  type="number"
                  min="0.000001"
                  step="any"
                  defaultValue={component.qty_in_recipe_uom}
                  disabled={disabled}
                  className={formControlClass}
                  aria-label={`Ingredient quantity for ${
                    item?.name ?? component.ingredient_name ?? "ingredient"
                  }`}
                />
                <button
                  type="submit"
                  disabled={disabled}
                  className={secondaryButtonClass}
                >
                  Save qty
                </button>
              </form>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}


