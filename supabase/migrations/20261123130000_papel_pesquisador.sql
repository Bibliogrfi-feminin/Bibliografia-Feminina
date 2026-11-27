-- =====================================================================
-- Papel PESQUISADOR: alunas e alunos que coletam currículos e cadastram
-- pessoas novas, com poderes reduzidos (ver 20261123140000).
--
-- Fica sozinho neste arquivo: um valor novo de enum só pode ser usado
-- depois que a transação que o criou termina.
-- =====================================================================

alter type public.role_enum add value if not exists 'PESQUISADOR';
