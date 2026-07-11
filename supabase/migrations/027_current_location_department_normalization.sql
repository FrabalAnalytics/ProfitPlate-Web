-- Normalize restaurant operating locations:
-- main stores hold stock; Kitchen and Bar are user departments that request/consume stock.

update public.locations
   set location_type = 'department'::public.location_type,
       routing_model = 'model_1_single_location'::public.routing_model
 where is_active = true
   and lower(name) ~ '(kitchen|bar)'
   and lower(name) !~ '(store|warehouse)'
   and location_type::text in (
     'department',
     'bar',
     'local_kitchen',
     'kitchen_line',
     'production_kitchen',
     'sales_outlet'
   );

update public.inventory_items ii
   set origin_inventory_item_id = ii.id
  from public.locations l
 where l.id = ii.location_id
   and l.location_type::text = 'main_store'
   and ii.origin_inventory_item_id is null;

notify pgrst, 'reload schema';
