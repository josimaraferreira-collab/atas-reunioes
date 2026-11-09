create policy "ata_audios_atualizar" on storage.objects for update to authenticated
  using (bucket_id = 'ata-audios' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'ata-audios' and (storage.foldername(name))[1] = (select auth.uid())::text);
