param(
  [string]$WorkbookPath = "C:\Users\Hp\Downloads\New ProfitPlate  data.xlsx",
  [string]$OutputPath = "supabase\imports\lagos_grills_fresh_import.sql",
  [string]$OrganizationName = "Lagos Grills",
  [string]$Currency = "NGN",
  [string]$SubscriptionTier = "multi_unit"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipXml($zip, $name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $null }
  $stream = $entry.Open()
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $stream.Dispose()
  }
}

function Get-ColIndex($cellRef) {
  $letters = ([regex]::Match($cellRef, '^[A-Z]+')).Value
  $n = 0
  foreach ($ch in $letters.ToCharArray()) {
    $n = $n * 26 + ([int][char]$ch - [int][char]'A' + 1)
  }
  return $n
}

function Get-WorkbookRows($path) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    $shared = @()
    $sharedXml = Read-ZipXml $zip 'xl/sharedStrings.xml'
    if ($sharedXml) {
      foreach ($si in $sharedXml.sst.si) {
        if ($si.t) {
          $shared += [string]$si.t
        } else {
          $shared += (($si.r | ForEach-Object { [string]$_.t }) -join '')
        }
      }
    }

    $wb = Read-ZipXml $zip 'xl/workbook.xml'
    $rels = Read-ZipXml $zip 'xl/_rels/workbook.xml.rels'
    $relMap = @{}
    foreach ($rel in $rels.Relationships.Relationship) {
      $relMap[[string]$rel.Id] = [string]$rel.Target
    }

    $book = @{}
    foreach ($sheet in $wb.workbook.sheets.sheet) {
      $rid = $sheet.GetAttribute(
        'id',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
      )
      $target = $relMap[$rid]
      $sheetPath = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { "xl/$target" }
      $sheetXml = Read-ZipXml $zip $sheetPath
      $rows = @()

      foreach ($row in @($sheetXml.worksheet.sheetData.row)) {
        $vals = @{}
        foreach ($c in @($row.c)) {
          $idx = Get-ColIndex $c.r
          if ($c.t -eq 's') {
            $val = $shared[[int]$c.v]
          } elseif ($c.t -eq 'inlineStr') {
            $val = [string]$c.is.t
          } else {
            $val = [string]$c.v
          }
          $vals[$idx] = ([string]$val).Trim()
        }

        $max = if ($vals.Keys.Count -gt 0) {
          ($vals.Keys | Measure-Object -Maximum).Maximum
        } else {
          0
        }
        $out = for ($i = 1; $i -le $max; $i++) {
          if ($vals.ContainsKey($i)) { $vals[$i] } else { '' }
        }
        if ((($out -join '').Trim()).Length -gt 0) {
          $rows += ,$out
        }
      }

      $book[[string]$sheet.name] = $rows
    }

    return $book
  } finally {
    $zip.Dispose()
  }
}

function Normalize-Key($value) {
  return ([string]$value).Trim().ToLowerInvariant()
}

function Sql-String($value) {
  if ($null -eq $value -or [string]$value -eq '') { return "null" }
  return "'" + ([string]$value).Replace("'", "''") + "'"
}

function To-Number($value, $fallback = 0) {
  $number = 0
  if ([double]::TryParse([string]$value, [ref]$number)) { return $number }
  return $fallback
}

function Location-Type($value) {
  $normalized = Normalize-Key $value
  if ($normalized -like '*department*') { return 'department' }
  return 'main_store'
}

function Role-Key($value) {
  switch -Regex (Normalize-Key $value) {
    '^owner$' { return 'owner' }
    'finance|account' { return 'finance_manager' }
    'operation' { return 'operations_manager' }
    'procurement' { return 'procurement_manager' }
    'inventory' { return 'inventory_manager' }
    'chef|kitchen' { return 'chef' }
    default { return 'viewer' }
  }
}

function Item-Type($componentType) {
  $normalized = Normalize-Key $componentType
  if ($normalized -like '*sub*' -or $normalized -like '*prep*') { return 'semi_finished' }
  return 'raw_material'
}

function Cost-Type($componentType) {
  $normalized = Normalize-Key $componentType
  if ($normalized -like '*sub*' -or $normalized -like '*prep*') { return 'manufactured' }
  return 'purchased'
}

function Add-InventoryRow($rows, $seen, $row) {
  $key = "$(Normalize-Key $($row.name))|$(Normalize-Key $($row.location))|$(Normalize-Key $($row.cost_type))"
  if ($seen.ContainsKey($key)) { return }
  $seen[$key] = $true
  $rows.Add($row) | Out-Null
}

if (-not (Test-Path -LiteralPath $WorkbookPath)) {
  throw "Workbook not found: $WorkbookPath"
}

$book = Get-WorkbookRows $WorkbookPath
$locations = @($book['Location'] | Select-Object -Skip 1)
$users = @($book['Users'] | Select-Object -Skip 1)
$vendors = @($book['Vendors'] | Select-Object -Skip 1)
$skus = @($book['Skus'] | Select-Object -Skip 1)
$subRecipes = @($book['Sub recipe'] | Select-Object -Skip 1)
$finalRecipes = @($book['Final recipe'] | Select-Object -Skip 1)
$subComponents = @($book['Sub recipe Component'] | Select-Object -Skip 1)
$finalComponents = @($book['Final recipe Component'] | Select-Object -Skip 1)

$locationNames = @{}
foreach ($row in $locations) {
  if ($row[0]) { $locationNames[(Normalize-Key $row[0])] = $row[0] }
}

$subRecipeNames = @{}
foreach ($row in $subRecipes) {
  if ($row[0]) { $subRecipeNames[(Normalize-Key $row[0])] = $true }
}

$inventoryRows = [System.Collections.Generic.List[object]]::new()
$inventorySeen = @{}
$warnings = [System.Collections.Generic.List[string]]::new()
$sharedMainStoreRows = @()
$highValueBySku = @{}

foreach ($row in $skus) {
  if (-not $row[0]) { continue }
  $location = $row[7]
  $skuKey = Normalize-Key $row[0]
  $isHighValueSku = ((Normalize-Key $row[6]) -like '*high value*' -and (Normalize-Key $row[6]) -notlike '*not high value*')
  if ($isHighValueSku) {
    $highValueBySku[$skuKey] = $true
  } elseif (-not $highValueBySku.ContainsKey($skuKey)) {
    $highValueBySku[$skuKey] = $false
  }
  $isSubRecipeSku = ((Normalize-Key $row[0]) -like '*_sfg') -or $subRecipeNames.ContainsKey((Normalize-Key $row[0]))

  if ((Normalize-Key $location) -like '*both food*drink*') {
    $sharedMainStoreRows += $row
    $warnings.Add("Shared main-store SKU needs reviewed opening split: $($row[0]) opening_qty=$($row[3])") | Out-Null
    foreach ($splitLocation in @('Food Main Store', 'Drink Main Store')) {
      Add-InventoryRow $inventoryRows $inventorySeen ([pscustomobject]@{
        name = $row[0]
        sku = $row[0]
        department = $row[1]
        location = $splitLocation
        item_type = 'raw_material'
        cost_type = 'purchased'
        base_uom = $row[2]
        opening_qty = 0
        unit_cost = To-Number $row[4]
        is_high_value = $isHighValueSku
        recipe_name = $null
      })
    }
    continue
  }

  $itemType = if ($isSubRecipeSku) { 'semi_finished' } else { 'raw_material' }
  $costType = if ($isSubRecipeSku) { 'manufactured' } else { 'purchased' }
  $recipeName = if ($isSubRecipeSku) { $row[0] } else { $null }

  Add-InventoryRow $inventoryRows $inventorySeen ([pscustomobject]@{
    name = $row[0]
    sku = $row[0]
    department = $row[1]
    location = $location
    item_type = $itemType
    cost_type = $costType
    base_uom = $row[2]
    opening_qty = To-Number $row[3]
    unit_cost = To-Number $row[4]
    is_high_value = $isHighValueSku
    recipe_name = $recipeName
  })
}

foreach ($row in $subRecipes) {
  if (-not $row[0]) { continue }
  $department = if ((Normalize-Key $row[1]) -like '*bar*') { 'Bar' } else { 'Kitchen' }
  Add-InventoryRow $inventoryRows $inventorySeen ([pscustomobject]@{
    name = $row[0]
    sku = $row[0]
    department = $department
    location = $department
    item_type = 'semi_finished'
    cost_type = 'manufactured'
    base_uom = 'Portion'
    opening_qty = 0
    unit_cost = 0
    is_high_value = $false
    recipe_name = $row[0]
  })
}

$componentLines = @($subComponents + $finalComponents)
foreach ($row in $componentLines) {
  if (-not $row[5]) { continue }
  $department = $row[0]
  if ($department -notin @('Kitchen', 'Bar')) { continue }

  $componentRecipeName = if ((Item-Type $row[6]) -eq 'semi_finished') { $row[5] } else { $null }
  $componentKey = Normalize-Key $row[5]

  Add-InventoryRow $inventoryRows $inventorySeen ([pscustomobject]@{
    name = $row[5]
    sku = $row[5]
    department = $department
    location = $department
    item_type = Item-Type $row[6]
    cost_type = Cost-Type $row[6]
    base_uom = $row[8]
    opening_qty = 0
    unit_cost = To-Number $row[12]
    is_high_value = if ($highValueBySku.ContainsKey($componentKey)) { $highValueBySku[$componentKey] } else { $false }
    recipe_name = $componentRecipeName
  })
}

$outDir = Split-Path -Parent $OutputPath
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

$sql = [System.Text.StringBuilder]::new()
[void]$sql.AppendLine("-- Generated Lagos Grills fresh import.")
[void]$sql.AppendLine("-- Review before running. This resets operating data for the target organization.")
[void]$sql.AppendLine("-- Generated at: $(Get-Date -Format o)")
foreach ($warning in $warnings) {
  [void]$sql.AppendLine("-- WARNING: $warning")
}
[void]$sql.AppendLine("begin;")
[void]$sql.AppendLine("do `$`$")
[void]$sql.AppendLine("declare")
[void]$sql.AppendLine("  target_org_id uuid;")
[void]$sql.AppendLine("  rec jsonb;")
[void]$sql.AppendLine("  location_ids jsonb := '{}'::jsonb;")
[void]$sql.AppendLine("  item_ids jsonb := '{}'::jsonb;")
[void]$sql.AppendLine("  recipe_ids jsonb := '{}'::jsonb;")
[void]$sql.AppendLine("  inventory_item_type_name text;")
[void]$sql.AppendLine("  inventory_cost_type_name text;")
[void]$sql.AppendLine("  recipe_type_name text;")
[void]$sql.AppendLine("begin")
[void]$sql.AppendLine("  select id into target_org_id from public.organizations where name = $(Sql-String $OrganizationName) order by created_at desc limit 1;")
[void]$sql.AppendLine("  if target_org_id is null then")
[void]$sql.AppendLine("    insert into public.organizations (name, local_currency, subscription_tier)")
[void]$sql.AppendLine("    values ($(Sql-String $OrganizationName), $(Sql-String $Currency), $(Sql-String $SubscriptionTier)::public.subscription_tier)")
[void]$sql.AppendLine("    returning id into target_org_id;")
[void]$sql.AppendLine("  else")
[void]$sql.AppendLine("    update public.organizations")
[void]$sql.AppendLine("    set local_currency = $(Sql-String $Currency),")
[void]$sql.AppendLine("        subscription_tier = $(Sql-String $SubscriptionTier)::public.subscription_tier")
[void]$sql.AppendLine("    where id = target_org_id;")
[void]$sql.AppendLine("  end if;")
[void]$sql.AppendLine("")
[void]$sql.AppendLine("  alter table public.inventory_items")
[void]$sql.AppendLine("    add column if not exists department text,")
[void]$sql.AppendLine("    add column if not exists is_high_value boolean not null default false;")
[void]$sql.AppendLine("")
[void]$sql.AppendLine("  select format_type(a.atttypid, a.atttypmod)")
[void]$sql.AppendLine("    into inventory_item_type_name")
[void]$sql.AppendLine("  from pg_attribute a")
[void]$sql.AppendLine("  where a.attrelid = 'public.inventory_items'::regclass")
[void]$sql.AppendLine("    and a.attname = 'item_type';")
[void]$sql.AppendLine("")
[void]$sql.AppendLine("  select format_type(a.atttypid, a.atttypmod)")
[void]$sql.AppendLine("    into inventory_cost_type_name")
[void]$sql.AppendLine("  from pg_attribute a")
[void]$sql.AppendLine("  where a.attrelid = 'public.inventory_items'::regclass")
[void]$sql.AppendLine("    and a.attname = 'cost_type';")
[void]$sql.AppendLine("")
[void]$sql.AppendLine("  select format_type(a.atttypid, a.atttypmod)")
[void]$sql.AppendLine("    into recipe_type_name")
[void]$sql.AppendLine("  from pg_attribute a")
[void]$sql.AppendLine("  where a.attrelid = 'public.recipes'::regclass")
[void]$sql.AppendLine("    and a.attname = 'recipe_type';")
[void]$sql.AppendLine("")
[void]$sql.AppendLine("  delete from public.approval_requests where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.cost_recalculation_events where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.variance_attributions where organization_id = target_org_id;")
[void]$sql.AppendLine("  alter table public.transformation_events disable trigger prevent_transformation_event_delete;")
[void]$sql.AppendLine("  delete from public.transformation_events where organization_id = target_org_id;")
[void]$sql.AppendLine("  alter table public.transformation_events enable trigger prevent_transformation_event_delete;")
[void]$sql.AppendLine("  delete from public.stock_count_lines where stock_count_id in (select id from public.stock_counts where organization_id = target_org_id);")
[void]$sql.AppendLine("  delete from public.stock_counts where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.production_run_inputs where production_run_id in (select id from public.production_runs where organization_id = target_org_id);")
[void]$sql.AppendLine("  delete from public.production_runs where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.waste_events where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.menu_sales where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.purchase_order_lines where purchase_order_id in (select id from public.purchase_orders where organization_id = target_org_id);")
[void]$sql.AppendLine("  delete from public.purchase_orders where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.recipe_components where organization_id = target_org_id;")
[void]$sql.AppendLine("  alter table public.recipes disable trigger block_sub_recipe_delete_with_stock;")
[void]$sql.AppendLine("  delete from public.recipes where organization_id = target_org_id;")
[void]$sql.AppendLine("  alter table public.recipes enable trigger block_sub_recipe_delete_with_stock;")
[void]$sql.AppendLine("  delete from public.inventory_items where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.suppliers where organization_id = target_org_id;")
[void]$sql.AppendLine("  delete from public.locations where organization_id = target_org_id;")

[void]$sql.AppendLine("")
[void]$sql.AppendLine("  for rec in select * from jsonb_array_elements('$(($locations | ForEach-Object { @{name=$_[0]; type=$_[1]} } | ConvertTo-Json -Compress).Replace("'","''"))'::jsonb) loop")
[void]$sql.AppendLine("    insert into public.locations (tenant_id, organization_id, name, location_type, routing_model, is_active)")
[void]$sql.AppendLine("    values (target_org_id, target_org_id, rec->>'name', 'main_store'::public.location_type, 'model_1_single_location', true)")
[void]$sql.AppendLine("    returning jsonb_set(location_ids, array[rec->>'name'], to_jsonb(id::text), true) into location_ids;")
[void]$sql.AppendLine("  end loop;")

[void]$sql.AppendLine("")
[void]$sql.AppendLine("  for rec in select * from jsonb_array_elements('$(($vendors | ForEach-Object { @{name=$_[0]; category=$_[1]; active=$_[2]; contact=$_[3]; phone=$_[4]; email=$_[5]} } | ConvertTo-Json -Compress).Replace("'","''"))'::jsonb) loop")
[void]$sql.AppendLine("    insert into public.suppliers (organization_id, name, contact_name, phone, email, is_active)")
[void]$sql.AppendLine("    values (target_org_id, rec->>'name', nullif(rec->>'contact',''), nullif(rec->>'phone',''), nullif(rec->>'email',''), coalesce(rec->>'active','Active') = 'Active');")
[void]$sql.AppendLine("  end loop;")

[void]$sql.AppendLine("")
[void]$sql.AppendLine("  for rec in select * from jsonb_array_elements('$(($inventoryRows | ConvertTo-Json -Depth 4 -Compress).Replace("'","''"))'::jsonb) loop")
[void]$sql.AppendLine("    execute format(")
[void]$sql.AppendLine("      'insert into public.inventory_items (tenant_id, organization_id, location_id, name, sku, department, item_type, cost_type, base_uom, recipe_uom, on_hand_uom, on_hand_qty, current_cost_per_base_uom, is_high_value, is_active) values (`$1, `$2, `$3, `$4, `$5, `$6, `$7::%s, `$8::%s, `$9, `$10, `$11, `$12, `$13, `$14, `$15) returning jsonb_set(`$16, array[`$4 || ''|'' || `$17], to_jsonb(id::text), true)',")
[void]$sql.AppendLine("      inventory_item_type_name,")
[void]$sql.AppendLine("      inventory_cost_type_name")
[void]$sql.AppendLine("    )")
[void]$sql.AppendLine("    into item_ids")
[void]$sql.AppendLine("    using target_org_id, target_org_id, nullif(location_ids->>(rec->>'location'), '')::uuid, rec->>'name', rec->>'sku', nullif(rec->>'department',''), rec->>'item_type', rec->>'cost_type', rec->>'base_uom', rec->>'base_uom', rec->>'base_uom', coalesce((rec->>'opening_qty')::numeric, 0), coalesce((rec->>'unit_cost')::numeric, 0), coalesce((rec->>'is_high_value')::boolean, false), true, item_ids, rec->>'location';")
[void]$sql.AppendLine("  end loop;")

$recipeRows = @()
foreach ($row in $subRecipes) {
  if ($row[0]) {
    $department = if ((Normalize-Key $row[1]) -like '*bar*') { 'Bar' } else { 'Kitchen' }
    $componentDefinition = $subComponents |
      Where-Object { $_[1] -eq $row[0] } |
      Select-Object -First 1
    $outputQty = if ($componentDefinition) { To-Number $componentDefinition[3] } else { 1 }
    $outputUom = if ($componentDefinition -and $componentDefinition[4]) { $componentDefinition[4] } else { 'Portion' }

    $recipeRows += [pscustomobject]@{
      name=$row[0]
      department=$department
      recipe_type='sub_recipe'
      output_qty=if ($outputQty -gt 0) { $outputQty } else { 1 }
      output_uom=$outputUom
      selling_price=0
    }
  }
}
foreach ($row in $finalRecipes) {
  if ($row[0]) {
    $department = if (($finalComponents | Where-Object { $_[1] -eq $row[0] } | Select-Object -First 1)[0] -eq 'Bar') { 'Bar' } else { 'Kitchen' }
    $recipeRows += [pscustomobject]@{name=$row[0]; department=$department; recipe_type='final_dish'; output_qty=1; output_uom='Portion'; selling_price=(To-Number $row[2])}
  }
}

[void]$sql.AppendLine("")
[void]$sql.AppendLine("  for rec in select * from jsonb_array_elements('$(($recipeRows | ConvertTo-Json -Depth 4 -Compress).Replace("'","''"))'::jsonb) loop")
[void]$sql.AppendLine("    execute format(")
[void]$sql.AppendLine("      'insert into public.recipes (tenant_id, organization_id, name, recipe_type, output_uom, standard_batch_output_qty, standard_yield_pct, selling_price, is_active) values (`$1, `$2, `$3, `$4::%s, `$5, `$6, `$7, `$8, `$9) returning jsonb_set(`$10, array[`$3 || ''|'' || `$4], to_jsonb(id::text), true)',")
[void]$sql.AppendLine("      recipe_type_name")
[void]$sql.AppendLine("    )")
[void]$sql.AppendLine("    into recipe_ids")
[void]$sql.AppendLine("    using target_org_id, target_org_id, rec->>'name', rec->>'recipe_type', rec->>'output_uom', coalesce((rec->>'output_qty')::numeric, 1), 1, coalesce((rec->>'selling_price')::numeric, 0), true, recipe_ids;")
[void]$sql.AppendLine("  end loop;")

$allComponents = @()
foreach ($row in $subComponents) {
  if ($row[1] -and $row[5]) {
    $allComponents += [pscustomobject]@{
      recipe=$row[1]
      recipe_type='sub_recipe'
      department=$row[0]
      component=$row[5]
      component_type=$row[6]
      qty=(To-Number $row[7])
      uom=$row[8]
    }
  }
}

foreach ($row in $finalComponents) {
  if ($row[1] -and $row[5]) {
    $allComponents += [pscustomobject]@{
      recipe=$row[1]
      recipe_type='final_dish'
      department=$row[0]
      component=$row[5]
      component_type=$row[6]
      qty=(To-Number $row[7])
      uom=$row[8]
    }
  }
}

[void]$sql.AppendLine("")
[void]$sql.AppendLine("  for rec in select * from jsonb_array_elements('$(($allComponents | ConvertTo-Json -Depth 4 -Compress).Replace("'","''"))'::jsonb) loop")
[void]$sql.AppendLine("    insert into public.recipe_components (organization_id, recipe_id, component_inventory_item_id, qty_in_recipe_uom, recipe_uom)")
[void]$sql.AppendLine("    values (target_org_id, nullif(recipe_ids->>((rec->>'recipe') || '|' || (rec->>'recipe_type')), '')::uuid, nullif(item_ids->>((rec->>'component') || '|' || (rec->>'department')), '')::uuid, coalesce((rec->>'qty')::numeric, 0), rec->>'uom');")
[void]$sql.AppendLine("  end loop;")

[void]$sql.AppendLine("end")
[void]$sql.AppendLine("`$`$;")
[void]$sql.AppendLine("commit;")

[System.IO.File]::WriteAllText((Resolve-Path .).Path + "\" + $OutputPath, $sql.ToString())

Write-Output "Generated $OutputPath"
Write-Output "Inventory rows: $($inventoryRows.Count)"
Write-Output "Recipe rows: $($recipeRows.Count)"
Write-Output "Component rows: $($allComponents.Count)"
if ($warnings.Count -gt 0) {
  Write-Output "Warnings:"
  $warnings | ForEach-Object { Write-Output " - $_" }
}
