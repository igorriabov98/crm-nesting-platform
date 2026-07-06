<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Запрещено без явного подтверждения оператора

- `git push` в любой remote.
- Деплой в любую среду, включая Vercel, Railway, Supabase и другие production/staging/preview окружения.
- `prisma migrate deploy`, `prisma migrate reset` или любые команды миграций, которые меняют БД.
- Изменение production environment variables, secrets, доменов, build/deploy settings или runtime settings.
- Удаление данных, storage objects, database rows, buckets, deployments, branches или remote resources.

Перед любым таким действием нужно отдельно получить явное подтверждение оператора в текущем диалоге.

## Правила параллельной работы и деплоя

1. ОДИН ПИСАТЕЛЬ В MAIN. `main` меняется только merge'ем, который выполняет один процесс. Перед merge: `git fetch --all --prune` и проверка, что локальный `main` == `origin/main`. Force-push в `main` запрещён всегда.
2. АГЕНТ = СВОЯ ВЕТКА = СВОЙ WORKTREE. В чужие worktree и ветки не писать. Оператор правит руками - в отдельной ветке.
3. ДЕПЛОЙ ТОЛЬКО ИЗ MAIN, только после push. Railway и Vercel должны деплоиться с одного SHA. Деплой с feature-веток запрещён.
4. ПЕРЕД ЛЮБОЙ ЗАДАЧЕЙ: `git fetch --all --prune` и отчёт первой строкой: `база: origin/main <sha>`. Если ветка устарела от `main`, сначала merge `main` в ветку, потом работа.
5. ПОСЛЕ MERGE В MAIN: `git log origin/main --oneline -3` в отчёт как доказательство, что коммиты реально в `origin/main`.
6. Секция "Запрещено без явного подтверждения оператора" действует поверх всего: push, deploy, миграции, изменение env, удаление данных.
7. Каждый отчёт агента заканчивается блоком: ветка, HEAD SHA, что в origin (запушено/нет), что в проде (задеплоено/нет).

## CI/CD и операционный цикл

Подробный цикл PR -> CI -> merge -> ручной deploy workflow -> production smoke описан в [docs/OPERATIONS.md](./docs/OPERATIONS.md). Эти правила дополняют ограничения выше: настройки Railway, Vercel и GitHub branch protection меняются только после отдельного подтверждения оператора.

## UI-правило для выпадающих списков

Во всех выпадающих меню закрытое состояние должно показывать тот же человекочитаемый label, что и элемент в открытом списке. Нельзя оставлять технические значения enum/id вроде `standard`, `undefined` или UUID; если используется `SelectValue`, передавайте отображаемый текст явно.
