-- =====================================================================
-- Equivalência de siglas de instituição para a Coleta Lattes.
--
-- O Lattes escreve a instituição do jeito do cadastro do CNPq ("PUC
-- Minas", "FDUSP"); a planilha do grupo tem o seu próprio padrão ("PUC/MG",
-- "USP"). Sem tradução, toda faculdade vira conflito na revisão.
--
-- `de` é guardado já normalizado (maiúsculas, sem acento, só letras e
-- números): "PUC-SP", "PUC/SP" e "PUCSP" são a mesma chave. A conversão
-- vive em src/lib/coletaLattes.ts (chaveSigla) — mudou lá, mude o seed.
-- =====================================================================

create table if not exists public.coleta_siglas (
  de text primary key check (de ~ '^[A-Z0-9]+$'),
  para text not null check (length(trim(para)) > 0),
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now()
);

alter table public.coleta_siglas enable row level security;

drop policy if exists "coleta_siglas_equipe" on public.coleta_siglas;
create policy "coleta_siglas_equipe" on public.coleta_siglas
  for all to authenticated
  using (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]))
  with check (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));

-- ponto de partida: a grafia mais frequente na planilha Base BPF 2026.2
insert into public.coleta_siglas (de, para) values
  -- USP e suas faculdades
  ('FDUSP', 'USP'), ('FADUSP', 'USP'), ('FDRPUSP', 'USP'), ('FDRP', 'USP'),
  ('UNIVERSIDADEDESAOPAULO', 'USP'), ('FACULDADEDEDIREITODAUSP', 'USP'),
  ('FACULDADEDEDIREITODAUNIVERSIDADEDESAOPAULO', 'USP'),
  -- PUCs: a planilha usa PUC/UF
  ('PUCMINAS', 'PUC/MG'), ('PUCMG', 'PUC/MG'),
  ('PUCSP', 'PUC/SP'),
  ('PUCPR', 'PUC/PR'),
  ('PUCRS', 'PUC/RS'),
  ('PUCRIO', 'PUC-RIO'), ('PUCRJ', 'PUC-RIO'),
  -- outras com mais de uma grafia na planilha
  ('MACKENZIE', 'UPM'), ('UPM', 'UPM'),
  ('UNICEUB', 'UNICEUB'), ('CEUB', 'UNICEUB'),
  ('FGVSP', 'FGV-DIREITO SP'), ('FGVDIREITOSP', 'FGV-DIREITO SP'), ('DIREITOGVSP', 'FGV-DIREITO SP'),
  ('FGVRJ', 'FGV-RJ'), ('FGVDIREITORIO', 'FGV-RJ'),
  ('UNIJUI', 'UNIJUÍ')
on conflict (de) do nothing;
