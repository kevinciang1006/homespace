-- Public dish photo bucket + browser (anon) upload policies.
-- Upsert requires SELECT + INSERT + UPDATE policies for the uploading role.

insert into storage.buckets (id, name, public)
values ('dish-images', 'dish-images', true)
on conflict (id) do update set public = true;

-- Public read.
drop policy if exists "dish-images read" on storage.objects;
create policy "dish-images read" on storage.objects
  for select using (bucket_id = 'dish-images');

-- Anon + authenticated may upload and replace (upsert) within this bucket only.
drop policy if exists "dish-images insert" on storage.objects;
create policy "dish-images insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'dish-images');

drop policy if exists "dish-images update" on storage.objects;
create policy "dish-images update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'dish-images')
  with check (bucket_id = 'dish-images');
