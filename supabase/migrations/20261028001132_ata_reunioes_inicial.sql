create table public.ata_reunioes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default 'Reunião',
  data_reuniao timestamptz not null default now(),
  local text,
  participantes text,
  pauta text,
  duracao_seg integer not null default 0,
  status text not null default 'gravando' check (status in ('gravando','transcrevendo','gerando_ata','pronta','erro')),
  ata text,
  erro text,
  audio_apagado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ata_segmentos (
  id uuid primary key default gen_random_uuid(),
  reuniao_id uuid not null references public.ata_reunioes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ordem integer not null,
  audio_path text not null,
  mime text not null,
  duracao_seg integer not null default 0,
  status text not null default 'pendente' check (status in ('pendente','processando','ok','erro')),
  transcricao text,
  erro text,
  created_at timestamptz not null default now(),
  unique (reuniao_id, ordem)
);

create index ata_reunioes_user_idx on public.ata_reunioes(user_id, data_reuniao desc);
create index ata_segmentos_reuniao_idx on public.ata_segmentos(reuniao_id, ordem);
create index ata_segmentos_user_idx on public.ata_segmentos(user_id);

alter table public.ata_reunioes enable row level security;
alter table public.ata_segmentos enable row level security;

create policy "ata_reunioes_dono" on public.ata_reunioes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "ata_segmentos_dono" on public.ata_segmentos
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.ata_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create trigger ata_reunioes_updated before update on public.ata_reunioes
  for each row execute function public.ata_touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ata-audios', 'ata-audios', false, 52428800,
  array['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a','audio/wav'])
on conflict (id) do nothing;

create policy "ata_audios_ler" on storage.objects for select to authenticated
  using (bucket_id = 'ata-audios' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ata_audios_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'ata-audios' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ata_audios_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'ata-audios' and (storage.foldername(name))[1] = (select auth.uid())::text);
