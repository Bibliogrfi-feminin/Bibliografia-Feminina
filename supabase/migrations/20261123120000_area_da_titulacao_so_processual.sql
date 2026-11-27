-- =====================================================================
-- Área da titulação → área do processo da obra derivada.
--
-- A área em que a pessoa defendeu mestrado/doutorado/livre-docência é
-- classificada pelo grupo, numa lista fechada que mistura direito
-- material ("Direito Civil", "Direito Penal"...) e processual ("Direito
-- Processual - Civil"...). A regra antiga procurava a palavra solta, e
-- uma tese de Direito Civil virava obra de "P. Civil".
--
-- Agora o portal não adivinha: só a escolha explícita "Direito
-- Processual - X" vira "P. X"; qualquer outra área vai para "Outros".
-- =====================================================================

create or replace function public.area_da_titulacao(p text)
returns public.area_processo_enum
language sql
immutable
as $$
  select case
    when p is null or lower(p) not like '%processual%' then 'Outros'
    when lower(p) like '%civil%'         then 'P. Civil'
    when lower(p) like '%penal%'         then 'P. Penal'
    when lower(p) like '%trabalh%'       then 'P. Trabalhista'
    when lower(p) like '%tribut%'        then 'P. Tributario'
    when lower(p) like '%constitucion%'  then 'P. Constitucional'
    when lower(p) like '%administrat%'   then 'P. Administrativo'
    else 'Outros'
  end::public.area_processo_enum
$$;

-- As obras de titulação que já existem passam pela regra nova.
update public.producoes_bibliograficas p
   set area_processo = public.area_da_titulacao(a.area_mestrado)
  from public.associadas a
 where p.associada_id = a.id
   and p.tipo_obra = 'Dissertação de Mestrado'
   and p.area_processo is distinct from public.area_da_titulacao(a.area_mestrado);

update public.producoes_bibliograficas p
   set area_processo = public.area_da_titulacao(a.area_doutorado)
  from public.associadas a
 where p.associada_id = a.id
   and p.tipo_obra = 'Tese de Doutorado'
   and p.area_processo is distinct from public.area_da_titulacao(a.area_doutorado);

update public.producoes_bibliograficas p
   set area_processo = public.area_da_titulacao(a.area_livre_docencia)
  from public.associadas a
 where p.associada_id = a.id
   and p.tipo_obra = 'Tese de Livre-Docência'
   and p.area_processo is distinct from public.area_da_titulacao(a.area_livre_docencia);
