-- Обновить relationship cache PostgREST после создания таблиц оргструктуры.
SELECT pg_notify('pgrst', 'reload schema');
