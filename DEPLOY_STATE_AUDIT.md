# Deploy State Audit

Дата аудита: 2026-07-04  
Режим: задачи 1-8 read-only; запись выполнена только в задаче 9 в отдельном worktree `/Users/igorrabov/Desktop/crm-nesting-github-ops-rules` на ветке `ops-rules`.  
База: `origin/main f95774e79078f900887b1ce42bcd61dba5a26939`.

## 1. Git: где живёт фикс кратности BOM

Команда:

```bash
git fetch --all --prune && printf 'base: origin/main ' && git rev-parse --short origin/main && git log --oneline origin/main -15
```

Вывод:

```text
base: origin/main f95774e
f95774e Restore automatic material receipt date
9d0c762 Fix production stage date and workshop display
1b2fdbe Restore outsourcing workflow
2cf2b61 hotfix: remove DXF warnings header
4c6f4c9 Merge phase2-fixes into main
765e36e phase2: validate unfolded holes and bend cylinders
b926675 Add production outsourcing quick add
7b7e7dc phase2: fix z unfold and fallback thickness
ff3ba7a phase2: enforce real parts validation timeout
230ccf2 Fix outsourcing transport supplier flags
6f1ba9f Add outsourcing transport workflow
6311ca9 phase2: add real parts validation script
e034e73 Merge branch 'phase2-unfold'
7de14c7 Merge branch 'phase1-brep-contours'
d5cea13 phase2: expose unfold acceptance fields
```

Команда:

```bash
git branch -r --contains efc67ca
git branch -r --contains 2b4131b
```

Вывод:

```text
-- contains efc67ca --
  origin/fix-bom-multiplicity

-- contains 2b4131b --
  origin/fix-bom-multiplicity
```

Команда:

```bash
git log origin/main..origin/fix-bom-multiplicity --oneline
git log origin/fix-bom-multiplicity..origin/main --oneline
```

Вывод:

```text
-- origin/main..origin/fix-bom-multiplicity --
2b4131b fix: merge latest main into bom multiplicity branch
efc67ca fix: handle BOM multiplicity and thickness guard

-- origin/fix-bom-multiplicity..origin/main --
f95774e Restore automatic material receipt date
```

Вердикт: `efc67ca` и `2b4131b` не входят в `origin/main`; они живут в `origin/fix-bom-multiplicity`. После merge-коммита `2b4131b` в `origin/main` появился `f95774e`, которого нет в fix-ветке.

## 2. Railway: что реально в проде

Команда:

```bash
railway deployment list --json | jq '.[] | select(.id=="e3b32da2-bbc2-4c0b-8e36-ddfab32d4f4b") | {id,status,createdAt,meta:{branch:.meta.branch,commitHash:.meta.commitHash,cliMessage:.meta.cliMessage,commitMessage:.meta.commitMessage,repo:.meta.repo,rootDirectory:.meta.rootDirectory,reason:.meta.reason,imageDigest:.meta.imageDigest}}'
```

Вывод:

```json
{
  "id": "e3b32da2-bbc2-4c0b-8e36-ddfab32d4f4b",
  "status": "REMOVED",
  "createdAt": "2026-07-04T18:51:16.281Z",
  "meta": {
    "branch": null,
    "commitHash": null,
    "cliMessage": "fix: handle BOM multiplicity and thickness guard",
    "commitMessage": null,
    "repo": null,
    "rootDirectory": "/nesting-service",
    "reason": "deploy",
    "imageDigest": "sha256:5dbef3ff85ac33899bd82edb3fc9b7118be4f799e1329fd8e3d8196b54a174ae"
  }
}
```

Команда:

```bash
railway deployment list --json | jq '.[0] | {id,status,createdAt,meta:{branch:.meta.branch,commitHash:.meta.commitHash,commitMessage:.meta.commitMessage,repo:.meta.repo,rootDirectory:.meta.rootDirectory,reason:.meta.reason,imageDigest:.meta.imageDigest}}'
```

Вывод:

```json
{
  "id": "0136f4ad-e1c7-424c-b98f-d03177d6aa40",
  "status": "SUCCESS",
  "createdAt": "2026-07-04T19:10:20.158Z",
  "meta": {
    "branch": "main",
    "commitHash": "f95774e79078f900887b1ce42bcd61dba5a26939",
    "commitMessage": "Restore automatic material receipt date",
    "repo": "igorriabov98/crm-nesting-platform",
    "rootDirectory": "/nesting-service",
    "reason": "deploy",
    "imageDigest": "sha256:b5f3eb0c74e384156bd685e72c292bcf03c510c23ae0cae8ce6917973402e55c"
  }
}
```

Команда:

```bash
railway environment config --environment production --json | jq '{services: (.services | with_entries(.value |= {source, networking, deploy, build})) , privateNetworkDisabled}'
```

Вывод:

```json
{
  "services": {
    "4ebec247-59bb-4bbf-8980-8e95e6f10cb1": {
      "source": {
        "repo": "igorriabov98/crm-nesting-platform",
        "branch": "main",
        "rootDirectory": "/nesting-service",
        "checkSuites": false
      },
      "networking": {
        "serviceDomains": {
          "crm-nesting-platform-production.up.railway.app": {
            "port": 8080
          }
        }
      },
      "deploy": {
        "ipv6EgressEnabled": false,
        "multiRegionConfig": {
          "europe-west4-drams3a": {
            "numReplicas": 1
          }
        }
      },
      "build": {
        "builder": "RAILPACK",
        "buildEnvironment": "V3"
      }
    }
  },
  "privateNetworkDisabled": false
}
```

Команда:

```bash
git rev-parse origin/main
git merge-base --is-ancestor efc67ca f95774e79078f900887b1ce42bcd61dba5a26939; echo $?
```

Вывод:

```text
origin/main=f95774e79078f900887b1ce42bcd61dba5a26939
efc67ca ancestor of f95774e=no
```

Вердикт: текущий Railway prod deployment `0136f4ad-e1c7-424c-b98f-d03177d6aa40` идёт из `main` на SHA `f95774e79078f900887b1ce42bcd61dba5a26939`, совпадает с `origin/main`, но не содержит `efc67ca`. Фикс кратности BOM в текущем prod-сервисе: нет. Деплой `e3b32da2-bbc2-4c0b-8e36-ddfab32d4f4b` был CLI/deploy без branch и commit SHA в metadata и сейчас `REMOVED`; это отклонение от правила deploy from main.

## 3. Vercel: что реально в CRM-проде

Команда:

```bash
vercel inspect crm-nesting-platform.vercel.app --format=json --no-color | sed -n '/^{/,$p' | jq '{id,name,url,target,readyState,createdAt,aliases}'
```

Вывод:

```json
{
  "id": "dpl_D3XHrCcF4PzjgEZw1q3buRUCS4bX",
  "name": "crm-nesting-platform",
  "url": "crm-nesting-platform-of6p69ncl-igorriabov98-8607s-projects.vercel.app",
  "target": "production",
  "readyState": "READY",
  "createdAt": 1783192232059,
  "aliases": [
    "crm-nesting-platform.vercel.app",
    "crm-nesting-platform-igorriabov98-8607s-projects.vercel.app"
  ]
}
```

Команда:

```bash
vercel list crm-nesting-platform --environment production --status READY --format json --yes --no-color | sed -n '/^{/,$p' | jq '.deployments[0] | {url,state,target,createdAt,ready,meta:{gitCommitSha:.meta.gitCommitSha,gitCommitRef:.meta.gitCommitRef,gitCommitMessage:.meta.gitCommitMessage,githubCommitSha:.meta.githubCommitSha,githubCommitRef:.meta.githubCommitRef,githubCommitMessage:.meta.githubCommitMessage,actor:.meta.actor,githubDeployment:.meta.githubDeployment}}'
```

Вывод:

```json
{
  "url": "crm-nesting-platform-of6p69ncl-igorriabov98-8607s-projects.vercel.app",
  "state": "READY",
  "target": "production",
  "createdAt": 1783192232059,
  "ready": 1783192436159,
  "meta": {
    "gitCommitSha": "f95774e79078f900887b1ce42bcd61dba5a26939",
    "gitCommitRef": "codex/restore-outsourcing",
    "gitCommitMessage": "Restore automatic material receipt date",
    "githubCommitSha": null,
    "githubCommitRef": null,
    "githubCommitMessage": null,
    "actor": "codex",
    "githubDeployment": null
  }
}
```

Команда:

```bash
git merge-base --is-ancestor efc67ca f95774e79078f900887b1ce42bcd61dba5a26939; echo $?
```

Вывод:

```text
efc67ca ancestor of f95774e=no
```

Вердикт: текущий Vercel production alias указывает на CLI deployment `crm-nesting-platform-of6p69ncl...` с `gitCommitRef=codex/restore-outsourcing`, `gitCommitSha=f95774e79078f900887b1ce42bcd61dba5a26939`. SHA совпадает с `origin/main`, но deployment metadata не `main`, а feature branch. `efc67ca` не содержится. Фикс кратности BOM в текущем CRM-проде: нет.

## 4. БД против кода

Команда:

```bash
railway run --service crm-nesting-platform --environment production -- npx prisma migrate status --schema prisma/schema.prisma
```

Вывод:

```text
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "postgres", schemas "nesting" at "aws-0-eu-west-1.pooler.supabase.com:5432"

7 migrations found in prisma/migrations

┌─────────────────────────────────────────────────────────┐
│  Update available 6.19.3 -> 7.8.0                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
Database schema is up to date!
```

Команда:

```bash
railway run --service crm-nesting-platform --environment production -- node -e "...select _prisma_migrations..."
```

Вывод:

```json
[
  {
    "migration_name": "202607030004_phase2_nullable_part_thickness",
    "applied": true
  },
  {
    "migration_name": "202607040001_thickness_guard",
    "applied": true
  }
]
```

Команда:

```bash
git ls-tree -r --name-only f95774e -- nesting-service/prisma/migrations | tail -20
git show f95774e:nesting-service/prisma/migrations/202607040001_thickness_guard/migration.sql
git grep -n "thicknessMismatch\|thickness_mismatch\|dimensionGuard" f95774e -- nesting-service/src nesting-service/prisma/schema.prisma src | head -80
```

Вывод:

```text
nesting-service/prisma/migrations/202607020001_phase0_dimension_guard/migration.sql
nesting-service/prisma/migrations/202607020002_phase0_nesting_params/migration.sql
nesting-service/prisma/migrations/202607020003_phase0_contour_source/migration.sql
nesting-service/prisma/migrations/202607030001_phase1_brep_contours/migration.sql
nesting-service/prisma/migrations/202607030002_parse_report/migration.sql
nesting-service/prisma/migrations/202607030003_phase2_unfold_part_metadata/migration.sql
nesting-service/prisma/migrations/202607030004_phase2_nullable_part_thickness/migration.sql
fatal: path 'nesting-service/prisma/migrations/202607040001_thickness_guard/migration.sql' exists on disk, but not in 'f95774e'
f95774e:nesting-service/src/lib/ai/service.ts:168:    const dimensionGuard = part
f95774e:nesting-service/src/lib/ai/service.ts:171:    if (dimensionGuard) {
f95774e:nesting-service/src/lib/ai/service.ts:172:      Object.assign(data, dimensionGuard.data);
```

Вердикт: `202607040001_thickness_guard` применена в prod DB, но текущая запущенная Railway-ревизия `f95774e` не содержит эту миграцию и не содержит поля `thicknessMismatch`/`thicknessMismatchNote` в tracked code. Схема опережает код: безопасно как additive columns, но это факт.

Команда:

```bash
railway run --service crm-nesting-platform --environment production -- node -e "...select public.steel_types..."
```

Вывод:

```json
[
  {
    "count": 14,
    "names": [
      "09Г2С",
      "10",
      "12Х18Н10Т",
      "20",
      "40Х",
      "45",
      "65Г",
      "AISI 304",
      "AISI 430",
      "Hardox",
      "S235",
      "S355",
      "Ст3пс",
      "Ст3сп"
    ]
  }
]
```

Команда:

```bash
git show efc67ca:supabase/migrations/20260704120000_seed_standard_steel_types.sql
git show f95774e:supabase/migrations/20260704120000_seed_standard_steel_types.sql
```

Вывод:

```text
INSERT INTO public.steel_types (name, density_kg_mm3) VALUES
  ('Ст3сп', 0.00000785),
  ('Ст3пс', 0.00000785),
  ('09Г2С', 0.00000785),
  ('10', 0.00000785),
  ('20', 0.00000785),
  ('45', 0.00000785),
  ('40Х', 0.00000785),
  ('65Г', 0.00000785),
  ('12Х18Н10Т', 0.00000790),
  ('AISI 304', 0.00000793),
  ('AISI 430', 0.00000770)
ON CONFLICT (name) DO UPDATE
SET density_kg_mm3 = EXCLUDED.density_kg_mm3;

fatal: path 'supabase/migrations/20260704120000_seed_standard_steel_types.sql' exists on disk, but not in 'f95774e'
```

Факт: ожидание "11 строк public.steel_types" не совпадает с prod: сейчас 14 строк. Seed на 11 строк есть в `efc67ca`, но отсутствует в `f95774e`.

Кто читает `steel_types`:

Команда:

```bash
git show f95774e:src/lib/actions/steel-types.ts | nl -ba | sed -n '33,42p'
git show f95774e:src/app/api/nesting/ai/analyze/[id]/route.ts | nl -ba | sed -n '17,29p'
git show f95774e:nesting-service/src/routes/ai.routes.ts | nl -ba | sed -n '19,27p'
git show f95774e:nesting-service/src/lib/ai/service.ts | nl -ba | sed -n '26,41p'
git show f95774e:nesting-service/src/lib/ai/steel-types.ts | nl -ba | sed -n '15,40p'
```

Вывод:

```text
src/lib/actions/steel-types.ts
    33	export async function getSteelTypes(): Promise<SteelType[]> {
    34	  const supabase = await getDb()
    35	  const { data, error } = await supabase
    36	    .from<SteelType[]>('steel_types')
    37	    .select('*')
    38	    .order('name')
    39	
    40	  if (error) throw new Error(error.message)
    41	  return data ?? []
    42	}

src/app/api/nesting/ai/analyze/[id]/route.ts
    17	  try {
    18	    const steelTypes = await getSteelTypes()
    19	    const res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/analyze-pdf`, {
    20	      method: 'POST',
    21	      headers: { 'Content-Type': 'application/json' },
    22	      body: JSON.stringify({
    23	        steelTypes: steelTypes.map((steelType) => ({
    24	          id: steelType.id,
    25	          name: steelType.name,
    26	          densityKgMm3: steelType.density_kg_mm3,
    27	        })),
    28	      }),
    29	    })

nesting-service/src/routes/ai.routes.ts
    19	const steelTypeSchema = z.object({
    20	  id: z.string().min(1),
    21	  name: z.string().min(1),
    22	  densityKgMm3: z.coerce.number().nullable().optional(),
    23	});
    24	
    25	const analyzePdfSchema = z.object({
    26	  steelTypes: z.array(steelTypeSchema).optional(),
    27	});

nesting-service/src/lib/ai/service.ts
    26	export async function analyzeProjectPdf(input: {
    27	  projectId: string;
    28	  pdfFilePath: string;
    29	  autoApply?: boolean;
    30	  steelTypes?: SteelTypeCatalogItem[];
    31	}): Promise<ProjectPdfAnalysisResult> {
    32	  const pdfResult = await analyzePDF(input.pdfFilePath, { steelTypes: input.steelTypes });
    33	
    34	  if (!pdfResult.success) {
    35	    return buildFailedResult(pdfResult);
    36	  }
    37	
    38	  const deterministicBom = await loadDeterministicBom(input.pdfFilePath);
    39	  const extractedBom = mergeDeterministicBOM(pdfResult.bom, deterministicBom);
    40	  const bom = resolveBOMSteelTypes(extractedBom, input.steelTypes ?? []);

nesting-service/src/lib/ai/steel-types.ts
    15	export function resolveSteelTypeForEntry(
    16	  entry: Pick<BOMEntry, 'material' | 'notes' | 'steelTypeRaw'>,
    17	  steelTypes: SteelTypeCatalogItem[] = []
    18	): ResolvedSteelType {
    19	  const raw = firstNonEmpty([
    20	    entry.steelTypeRaw,
    21	    extractCatalogSteelType(entry.material, steelTypes),
    22	    extractCatalogSteelType(entry.notes, steelTypes),
    23	    extractCommonSteelMark(entry.material),
    24	    extractCommonSteelMark(entry.notes),
    25	  ]);
    36	  const normalizedRaw = normalizeSteelTypeName(raw);
    37	  const matches = steelTypes.filter((steelType) => normalizeSteelTypeName(steelType.name) === normalizedRaw);
```

Вердикт: CRM читает `public.steel_types` через `getSteelTypes()` и передаёт каталог в nesting-service API. Запущенная ревизия сервиса не читает `public.steel_types` напрямую из БД; resolver берёт справочник из `input.steelTypes`, переданного CRM.

## 5. Инвентаризация веток

Команда:

```bash
for branch in $(git branch -r --format='%(refname:short)' | sed 's#^origin/##' | sort); do echo "--- origin/$branch ---"; git log "origin/main..origin/$branch" --oneline || true; done
```

Вывод:

```text
--- origin/fix-bom-multiplicity ---
2b4131b fix: merge latest main into bom multiplicity branch
efc67ca fix: handle BOM multiplicity and thickness guard
--- origin/integration-diagnostics ---
ec6e9c1 integration: document reconciliation mismatch basis
c71178d Merge main into integration-diagnostics
5a976bb integration: prefer unfolded brep contours
7f0d2a8 integration: add nesting diagnostic package
dc155ad integration: validate nesting layouts
76c3b93 integration: warn about duplicate product files
8909edb integration: mark superseded nesting projects
b29d06a integration: guard nesting project access
5427fb3 integration: support nesting warning status
--- origin/main ---
--- origin/origin ---
fatal: ambiguous argument 'origin/main..origin/origin': unknown revision or path not in the working tree.
Use '--' to separate paths from revisions, like this:
'git <command> [<revision>...] -- [<file>...]'
--- origin/phase2-unfold ---
0cdba25 Derive material receipt date on sales plan
da38ef9 Auto-fill material receipt date
53196e4 Sync cutting stage start with inventory fact
bc1ae6d Add material type selection task
eb8be64 Move material request into supply tab
--- origin/security-fix ---
115222c Harden CRM security for Vercel rollout
```

Примечание: `origin/origin` в этом цикле является результатом обработки `origin/HEAD`; реальные remote refs подтверждены следующей командой.

Команда:

```bash
git branch -r -vv
```

Вывод:

```text
  origin/HEAD                    -> origin/main
  origin/fix-bom-multiplicity    2b4131b fix: merge latest main into bom multiplicity branch
  origin/integration-diagnostics ec6e9c1 integration: document reconciliation mismatch basis
  origin/main                    f95774e Restore automatic material receipt date
  origin/phase2-unfold           0cdba25 Derive material receipt date on sales plan
  origin/security-fix            115222c Harden CRM security for Vercel rollout
```

Команда:

```bash
for special in phase2-fixes hotfix-dxf-warnings integration-diagnostics fix-bom-multiplicity; do git rev-parse --verify origin/$special; done
```

Вывод:

```text
--- origin/phase2-fixes ---
fatal: Needed a single revision
--- origin/hotfix-dxf-warnings ---
fatal: Needed a single revision
--- origin/integration-diagnostics ---
ec6e9c1ba3f02fcc9fe71c3a00947e04fd3bb8ac
--- origin/fix-bom-multiplicity ---
2b4131ba290c8e301c9cf25fc482e7f0ceec3992
```

Команда:

```bash
for b in phase2-fixes hotfix-dxf-warnings; do git rev-parse --verify "$b"; git log --oneline "origin/main..$b"; git merge-base --is-ancestor "$b" origin/main; echo $?; done
```

Вывод:

```text
--- phase2-fixes ---
765e36ee7516c59d8ae06376cec76c4a0a9ae5c3
HEAD 765e36e
contained_in_origin_main=yes
--- hotfix-dxf-warnings ---
2cf2b61da0e3155852b64cffa8e095b47e09e2c2
HEAD 2cf2b61
contained_in_origin_main=yes
```

Таблица:

| Ветка | Коммитов не в main | Что это по содержанию | Рекомендация |
|---|---:|---|---|
| `origin/main` | 0 | текущий remote main `f95774e` | база |
| `origin/fix-bom-multiplicity` | 2 | BOM multiplicity, thickness guard, seed steel types | влить после merge/rebase на свежий `origin/main`; основной кандидат |
| `origin/integration-diagnostics` | 9 | diagnostic package, layout validation, warning/superseded statuses | не вливать вслепую; rebase/review, затем отдельный merge |
| `origin/phase2-unfold` | 5 | supply/material date workflow commits; часть была CLI-deployed и отсутствует в main | не merge whole branch; проверить и cherry-pick только нужные коммиты |
| `origin/security-fix` | 1 | security hardening commit, но ветка старая относительно main | rebase/cherry-pick после review; не merge whole branch |
| `origin/phase2-fixes` | n/a | remote отсутствует; local branch `phase2-fixes` contained in `origin/main` | после стабилизации удалить local worktree/branch |
| `origin/hotfix-dxf-warnings` | n/a | remote отсутствует; local branch `hotfix-dxf-warnings` contained in `origin/main` | после стабилизации удалить local worktree/branch |

## 6. Worktrees и локальное состояние

Команда:

```bash
git worktree list --porcelain
```

Вывод:

```text
worktree /Users/igorrabov/Desktop/crm-nesting-github
HEAD 0cdba2566855839cc37f41e3ad234a9851ab08b3
branch refs/heads/phase2-unfold

worktree /private/tmp/hotfix-dxf-warnings
HEAD 2cf2b61da0e3155852b64cffa8e095b47e09e2c2
branch refs/heads/hotfix-dxf-warnings

worktree /private/tmp/phase2-main-merge
HEAD 2cf2b61da0e3155852b64cffa8e095b47e09e2c2
branch refs/heads/main

worktree /Users/igorrabov/Desktop/crm-nesting-github-fix-bom-multiplicity
HEAD 2b4131ba290c8e301c9cf25fc482e7f0ceec3992
branch refs/heads/fix-bom-multiplicity

worktree /Users/igorrabov/Desktop/crm-nesting-github-integration-diagnostics
HEAD ec6e9c1ba3f02fcc9fe71c3a00947e04fd3bb8ac
branch refs/heads/integration-diagnostics

worktree /Users/igorrabov/Desktop/crm-nesting-github-phase2-fixes
HEAD 765e36ee7516c59d8ae06376cec76c4a0a9ae5c3
branch refs/heads/phase2-fixes

worktree /Users/igorrabov/Desktop/crm-nesting-github-restore-outsourcing
HEAD f95774e79078f900887b1ce42bcd61dba5a26939
branch refs/heads/codex/restore-outsourcing

worktree /Users/igorrabov/Desktop/crm-nesting-github/.git/worktrees/crm-nesting-sales-plan-verify/C:/Users/igorrabov/Desktop/crm-nesting-sales-plan-verify
HEAD 615f7ae50f7275bc9ea5600cbf28e773b4947e0e
detached
prunable gitdir file points to non-existent location
```

Команда:

```bash
for each worktree: git branch --show-current; git status --short; git stash list
```

Вывод:

```text
--- /Users/igorrabov/Desktop/crm-nesting-github ---
branch: phase2-unfold
HEAD: 0cdba25
status:
 M .gitignore
 M AGENTS.md
 M eslint.config.mjs
 M nesting-service/prisma/schema.prisma
 M nesting-service/src/lib/__tests__/test-bom-matcher.ts
 M nesting-service/src/lib/__tests__/test-dimension-guard.ts
 M nesting-service/src/lib/__tests__/test-steel-types.ts
 M nesting-service/src/lib/ai/bom-matcher.ts
 M nesting-service/src/lib/ai/dimension-guard.ts
 M nesting-service/src/lib/ai/pdf-bom-fallback.ts
 M nesting-service/src/lib/ai/service.ts
 M nesting-service/src/lib/ai/steel-types.ts
 M nesting-service/src/lib/ai/types.ts
 M nesting-service/src/routes/ai.routes.ts
 M nesting-service/src/routes/parts.routes.ts
 M scripts/ensure-nesting-service.mjs
 M src/components/features/nesting/AIAnalysisPanel.tsx
 M src/components/features/nesting/PartsTable.tsx
 M src/lib/nesting/api.ts
?? INTEGRATION_AUDIT.md
?? PROJECT_AUDIT.md
?? nesting-service/prisma/migrations/202607040001_thickness_guard/
?? nesting-service/src/lib/__tests__/test-bom-multiplicity.ts
?? supabase/migrations/20260704120000_seed_standard_steel_types.sql
stash:
--- /private/tmp/hotfix-dxf-warnings ---
branch: hotfix-dxf-warnings
HEAD: 2cf2b61
status:
stash:
--- /private/tmp/phase2-main-merge ---
branch: main
HEAD: 2cf2b61
status:
?? nesting-service/prisma/migrations/20260701000000_baseline_existing_nesting_schema/
stash:
--- /Users/igorrabov/Desktop/crm-nesting-github-fix-bom-multiplicity ---
branch: fix-bom-multiplicity
HEAD: 2b4131b
status:
stash:
--- /Users/igorrabov/Desktop/crm-nesting-github-integration-diagnostics ---
branch: integration-diagnostics
HEAD: ec6e9c1
status:
stash:
--- /Users/igorrabov/Desktop/crm-nesting-github-phase2-fixes ---
branch: phase2-fixes
HEAD: 765e36e
status:
stash:
--- /Users/igorrabov/Desktop/crm-nesting-github-restore-outsourcing ---
branch: codex/restore-outsourcing
HEAD: f95774e
status:
stash:
--- /Users/igorrabov/Desktop/crm-nesting-github/.git/worktrees/crm-nesting-sales-plan-verify/C:/Users/igorrabov/Desktop/crm-nesting-sales-plan-verify ---
branch: fatal: cannot change to '/Users/igorrabov/Desktop/crm-nesting-github/.git/worktrees/crm-nesting-sales-plan-verify/C:/Users/igorrabov/Desktop/crm-nesting-sales-plan-verify': No such file or directory
HEAD: fatal: cannot change to '/Users/igorrabov/Desktop/crm-nesting-github/.git/worktrees/crm-nesting-sales-plan-verify/C:/Users/igorrabov/Desktop/crm-nesting-sales-plan-verify': No such file or directory
status:
fatal: cannot change to '/Users/igorrabov/Desktop/crm-nesting-github/.git/worktrees/crm-nesting-sales-plan-verify/C:/Users/igorrabov/Desktop/crm-nesting-sales-plan-verify': No such file or directory
stash:
fatal: cannot change to '/Users/igorrabov/Desktop/crm-nesting-github/.git/worktrees/crm-nesting-sales-plan-verify/C:/Users/igorrabov/Desktop/crm-nesting-sales-plan-verify': No such file or directory
```

Таблица:

| Worktree | Ветка | Грязный/чистый | Stash | Можно ли удалять после стабилизации |
|---|---|---|---|---|
| `/Users/igorrabov/Desktop/crm-nesting-github` | `phase2-unfold` | грязный, много modified/untracked | пусто | нет, сначала разобрать изменения |
| `/private/tmp/hotfix-dxf-warnings` | `hotfix-dxf-warnings` | чистый | пусто | да, ветка contained in main |
| `/private/tmp/phase2-main-merge` | `main` | грязный: untracked baseline migration | пусто | нет, сначала решить судьбу untracked и обновить stale main |
| `/Users/igorrabov/Desktop/crm-nesting-github-fix-bom-multiplicity` | `fix-bom-multiplicity` | чистый | пусто | нет, держать до merge/cherry-pick BOM fix |
| `/Users/igorrabov/Desktop/crm-nesting-github-integration-diagnostics` | `integration-diagnostics` | чистый | пусто | держать до решения по ветке |
| `/Users/igorrabov/Desktop/crm-nesting-github-phase2-fixes` | `phase2-fixes` | чистый | пусто | да, contained in main |
| `/Users/igorrabov/Desktop/crm-nesting-github-restore-outsourcing` | `codex/restore-outsourcing` | чистый | пусто | да, HEAD == origin/main |
| prunable Windows path | detached | путь отсутствует | нет данных | да, после подтверждения `git worktree prune` |

## 7. Поиск потерянных изменений

Команда:

```bash
git reflog show origin/main --date=iso -30
```

Вывод:

```text
f95774e refs/remotes/origin/main@{2026-07-04 22:10:18 +0300}: update by push
9d0c762 refs/remotes/origin/main@{2026-07-04 21:45:05 +0300}: update by push
1b2fdbe refs/remotes/origin/main@{2026-07-04 21:24:00 +0300}: update by push
2cf2b61 refs/remotes/origin/main@{2026-07-04 20:35:11 +0300}: update by push
4c6f4c9 refs/remotes/origin/main@{2026-07-04 17:57:50 +0300}: update by push
d72bb97 refs/remotes/origin/main@{2026-07-02 18:13:27 +0300}: update by push
9fa3722 refs/remotes/origin/main@{2026-07-02 16:03:32 +0300}: update by push
9bc72e7 refs/remotes/origin/main@{2026-07-02 15:52:15 +0300}: update by push
6bf2c2a refs/remotes/origin/main@{2026-07-02 15:38:25 +0300}: update by push
07dd928 refs/remotes/origin/main@{2026-07-02 11:56:23 +0300}: update by push
626e970 refs/remotes/origin/main@{2026-07-02 10:39:58 +0300}: update by push
8cb1398 refs/remotes/origin/main@{2026-07-01 22:29:00 +0300}: update by push
718848e refs/remotes/origin/main@{2026-07-01 22:20:33 +0300}: update by push
f0f1740 refs/remotes/origin/main@{2026-07-01 21:30:43 +0300}: update by push
854cf8f refs/remotes/origin/main@{2026-07-01 20:58:04 +0300}: update by push
519c33f refs/remotes/origin/main@{2026-07-01 20:35:55 +0300}: update by push
acb0df8 refs/remotes/origin/main@{2026-07-01 18:25:35 +0300}: update by push
59469b2 refs/remotes/origin/main@{2026-07-01 18:09:16 +0300}: update by push
8b255c4 refs/remotes/origin/main@{2026-07-01 18:01:14 +0300}: update by push
e5d74fd refs/remotes/origin/main@{2026-07-01 17:50:50 +0300}: update by push
6dd4bd4 refs/remotes/origin/main@{2026-07-01 17:17:21 +0300}: update by push
2a7feb2 refs/remotes/origin/main@{2026-07-01 17:08:54 +0300}: update by push
3c8cdf8 refs/remotes/origin/main@{2026-07-01 17:04:45 +0300}: update by push
9a779b6 refs/remotes/origin/main@{2026-07-01 16:49:43 +0300}: update by push
c0100a5 refs/remotes/origin/main@{2026-07-01 12:31:13 +0300}: update by push
4c6664b refs/remotes/origin/main@{2026-07-01 12:21:15 +0300}: update by push
6bfb867 refs/remotes/origin/main@{2026-07-01 12:02:04 +0300}: update by push
becd028 refs/remotes/origin/main@{2026-06-30 19:28:43 +0300}: update by push
905ae7f refs/remotes/origin/main@{2026-06-30 18:35:09 +0300}: update by push
5dc05f3 refs/remotes/origin/main@{2026-06-30 18:13:24 +0300}: update by push
```

Команда:

```bash
git reflog show origin/main --date=iso --format='%H%x09%gd%x09%gs' -40 | while ...; do git merge-base --is-ancestor "$old" "$new"; done
```

Вывод:

```text
9d0c762 -> f95774e | fast-forward | origin/main@{2026-07-04 22:10:18 +0300} | update by push
1b2fdbe -> 9d0c762 | fast-forward | origin/main@{2026-07-04 21:45:05 +0300} | update by push
2cf2b61 -> 1b2fdbe | fast-forward | origin/main@{2026-07-04 21:24:00 +0300} | update by push
4c6f4c9 -> 2cf2b61 | fast-forward | origin/main@{2026-07-04 20:35:11 +0300} | update by push
d72bb97 -> 4c6f4c9 | fast-forward | origin/main@{2026-07-04 17:57:50 +0300} | update by push
9fa3722 -> d72bb97 | fast-forward | origin/main@{2026-07-02 18:13:27 +0300} | update by push
9bc72e7 -> 9fa3722 | fast-forward | origin/main@{2026-07-02 16:03:32 +0300} | update by push
6bf2c2a -> 9bc72e7 | fast-forward | origin/main@{2026-07-02 15:52:15 +0300} | update by push
07dd928 -> 6bf2c2a | fast-forward | origin/main@{2026-07-02 15:38:25 +0300} | update by push
626e970 -> 07dd928 | fast-forward | origin/main@{2026-07-02 11:56:23 +0300} | update by push
8cb1398 -> 626e970 | fast-forward | origin/main@{2026-07-02 10:39:58 +0300} | update by push
718848e -> 8cb1398 | fast-forward | origin/main@{2026-07-01 22:29:00 +0300} | update by push
f0f1740 -> 718848e | fast-forward | origin/main@{2026-07-01 22:20:33 +0300} | update by push
854cf8f -> f0f1740 | fast-forward | origin/main@{2026-07-01 21:30:43 +0300} | update by push
519c33f -> 854cf8f | fast-forward | origin/main@{2026-07-01 20:58:04 +0300} | update by push
acb0df8 -> 519c33f | fast-forward | origin/main@{2026-07-01 20:35:55 +0300} | update by push
59469b2 -> acb0df8 | fast-forward | origin/main@{2026-07-01 18:25:35 +0300} | update by push
8b255c4 -> 59469b2 | fast-forward | origin/main@{2026-07-01 18:09:16 +0300} | update by push
e5d74fd -> 8b255c4 | fast-forward | origin/main@{2026-07-01 18:01:14 +0300} | update by push
6dd4bd4 -> e5d74fd | fast-forward | origin/main@{2026-07-01 17:50:50 +0300} | update by push
```

Вывод по reflog: non-fast-forward обновлений `origin/main` не найдено в проверенном окне. Подозреваемых SHA из reflog, исчезнувших из `origin/main`, не найдено.

Команда:

```bash
git fsck --no-reflogs --unreachable --no-progress
```

Вывод:

```text
Точная команда git fsck --lost-found не запускалась, потому что --lost-found создаёт записи в .git/lost-found, а режим задач 1-8 запрещает git-записи. Использован read-only вариант.

$ read-only fsck commit summary across worktrees
--- /Users/igorrabov/Desktop/crm-nesting-github ---
7da0da8 Rewrite production planner layout
--- /private/tmp/hotfix-dxf-warnings ---
7da0da8 Rewrite production planner layout
--- /private/tmp/phase2-main-merge ---
7da0da8 Rewrite production planner layout
--- /Users/igorrabov/Desktop/crm-nesting-github-fix-bom-multiplicity ---
7da0da8 Rewrite production planner layout
--- /Users/igorrabov/Desktop/crm-nesting-github-integration-diagnostics ---
7da0da8 Rewrite production planner layout
--- /Users/igorrabov/Desktop/crm-nesting-github-phase2-fixes ---
7da0da8 Rewrite production planner layout
--- /Users/igorrabov/Desktop/crm-nesting-github-restore-outsourcing ---
7da0da8 Rewrite production planner layout
--- /Users/igorrabov/Desktop/crm-nesting-github/.git/worktrees/crm-nesting-sales-plan-verify/C:/Users/igorrabov/Desktop/crm-nesting-sales-plan-verify ---
missing worktree path
```

Команда:

```bash
git branch -a --contains 7da0da8
git show --stat --oneline --decorate --no-renames 7da0da8
git log --oneline origin/main..7da0da8
```

Вывод:

```text
$ git branch -a --contains 7da0da8

$ git show --stat --oneline --decorate --no-renames 7da0da8
7da0da8 Rewrite production planner layout
 .../features/production/ProductionPlanner.tsx      | 1494 ++++++++++++++++++++
 .../features/production/ProductionWorkspace.tsx    |  111 +-
 .../features/production/gantt/GanttBar.tsx         |   26 +-
 3 files changed, 1545 insertions(+), 86 deletions(-)

$ git log --oneline origin/main..7da0da8
7da0da8 Rewrite production planner layout
```

Команда:

```bash
vercel list crm-nesting-platform --environment production --status READY --format json --yes --no-color | ... containment
```

Вывод:

```text
2026-07-04T19:10:32Z | crm-nesting-platform-of6p69ncl-igorriabov98-8607s-projects.vercel.app | ref=codex/restore-outsourcing | sha=f95774e79078f900887b1ce42bcd61dba5a26939 | source=cli | in_origin_main=yes | Restore automatic material receipt date
2026-07-04T19:10:21Z | crm-nesting-platform-halec4p3y-igorriabov98-8607s-projects.vercel.app | ref=main | sha=f95774e79078f900887b1ce42bcd61dba5a26939 | source=1 | in_origin_main=yes | Restore automatic material receipt date
2026-07-04T18:52:37Z | crm-nesting-platform-hmrct1am2-igorriabov98-8607s-projects.vercel.app | ref=fix-bom-multiplicity | sha=2b4131ba290c8e301c9cf25fc482e7f0ceec3992 | source=cli | in_origin_main=no | fix: merge latest main into bom multiplicity branch
2026-07-04T18:45:19Z | crm-nesting-platform-qm0rshura-igorriabov98-8607s-projects.vercel.app | ref=codex/restore-outsourcing | sha=9d0c762f22e5bf55a0d9782c11215da7671eb572 | source=cli | in_origin_main=yes | Fix production stage date and workshop display
2026-07-04T18:45:07Z | crm-nesting-platform-26glpe82z-igorriabov98-8607s-projects.vercel.app | ref=main | sha=9d0c762f22e5bf55a0d9782c11215da7671eb572 | source=1 | in_origin_main=yes | Fix production stage date and workshop display
2026-07-04T18:24:02Z | crm-nesting-platform-nx26brvts-igorriabov98-8607s-projects.vercel.app | ref=main | sha=1b2fdbe09dadd6e31b07cae167013ecff54b55dd | source=1 | in_origin_main=yes | Restore outsourcing workflow
2026-07-04T18:19:17Z | crm-nesting-platform-7i7uuyg3s-igorriabov98-8607s-projects.vercel.app | ref=codex/restore-outsourcing | sha=1b2fdbe09dadd6e31b07cae167013ecff54b55dd | source=cli | in_origin_main=yes | Restore outsourcing workflow
2026-07-04T17:37:44Z | crm-nesting-platform-fuy2gqbt6-igorriabov98-8607s-projects.vercel.app | ref=hotfix-dxf-warnings | sha=2cf2b61da0e3155852b64cffa8e095b47e09e2c2 | source=cli | in_origin_main=yes | hotfix: remove DXF warnings header
2026-07-04T17:35:13Z | crm-nesting-platform-cta00csb1-igorriabov98-8607s-projects.vercel.app | ref=main | sha=2cf2b61da0e3155852b64cffa8e095b47e09e2c2 | source=1 | in_origin_main=yes | hotfix: remove DXF warnings header
2026-07-04T17:30:47Z | crm-nesting-platform-gog6nld14-igorriabov98-8607s-projects.vercel.app | ref=HEAD | sha=0cdba2566855839cc37f41e3ad234a9851ab08b3 | source=cli | in_origin_main=no | Derive material receipt date on sales plan
2026-07-04T17:13:31Z | crm-nesting-platform-3gds3fxc6-igorriabov98-8607s-projects.vercel.app | ref=HEAD | sha=da38ef95365bd2f318d7bc8ad4d163d51b38c952 | source=cli | in_origin_main=no | Auto-fill material receipt date
2026-07-04T15:15:15Z | crm-nesting-platform-s95t8kcup-igorriabov98-8607s-projects.vercel.app | ref=HEAD | sha=53196e4b588da81daaa66df3c0fd9d8052b13ed2 | source=cli | in_origin_main=no | Sync cutting stage start with inventory fact
2026-07-04T15:01:38Z | crm-nesting-platform-ffgaftufy-igorriabov98-8607s-projects.vercel.app | ref=main | sha=4c6f4c95ff0ccba83c8ce8d14a2cfe7fdb3227d6 | source=cli | in_origin_main=yes | Merge phase2-fixes into main
2026-07-04T14:57:52Z | crm-nesting-platform-5kg9ixakk-igorriabov98-8607s-projects.vercel.app | ref=main | sha=4c6f4c95ff0ccba83c8ce8d14a2cfe7fdb3227d6 | source=1 | in_origin_main=yes | Merge phase2-fixes into main
2026-07-04T14:30:23Z | crm-nesting-platform-1ndxega1f-igorriabov98-8607s-projects.vercel.app | ref=null | sha=null | source=cli | in_origin_main=no |
2026-07-04T13:40:25Z | crm-nesting-platform-ihovmbtzz-igorriabov98-8607s-projects.vercel.app | ref=null | sha=null | source=cli | in_origin_main=no |
2026-07-04T13:13:52Z | crm-nesting-platform-a6w54moa2-igorriabov98-8607s-projects.vercel.app | ref=null | sha=null | source=cli | in_origin_main=no |
2026-07-03T13:16:38Z | crm-nesting-platform-5bjyfkek6-igorriabov98-8607s-projects.vercel.app | ref=phase2-unfold | sha=b926675779e6c12b5748b67fa0e133bb3a6c9ba6 | source=1 | in_origin_main=yes | Add production outsourcing quick add
2026-07-03T11:52:41Z | crm-nesting-platform-84go3nhk0-igorriabov98-8607s-projects.vercel.app | ref=HEAD | sha=230ccf2141557cf8624cc774812a0daaa9efa1d6 | source=cli | in_origin_main=yes | Fix outsourcing transport supplier flags
2026-07-03T11:33:36Z | crm-nesting-platform-rlm2t5wpg-igorriabov98-8607s-projects.vercel.app | ref=HEAD | sha=6f1ba9f614553121fdbff37d858affbc42285c22 | source=cli | in_origin_main=yes | Add outsourcing transport workflow
```

Команда:

```bash
railway deployment list --json | ... containment
```

Вывод:

```text
2026-07-04T19:10:20.158Z | 0136f4ad-e1c7-424c-b98f-d03177d6aa40 | status=SUCCESS | branch=main | sha=f95774e79078f900887b1ce42bcd61dba5a26939 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Restore automatic material receipt date
2026-07-04T18:51:16.281Z | e3b32da2-bbc2-4c0b-8e36-ddfab32d4f4b | status=REMOVED | branch=null | sha=null | in_origin_main=unknown | repo=null | reason=deploy | fix: handle BOM multiplicity and thickness guard
2026-07-04T18:46:57.668Z | 94975398-c3e6-4bd7-a16a-7f9c0c3a6efb | status=REMOVED | branch=null | sha=null | in_origin_main=unknown | repo=null | reason=deploy | fix: handle BOM multiplicity and thickness guard
2026-07-04T18:45:07.250Z | fc05c797-0640-44fa-bbc2-4e3bb11d932d | status=REMOVED | branch=main | sha=9d0c762f22e5bf55a0d9782c11215da7671eb572 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Fix production stage date and workshop display
2026-07-04T18:44:13.516Z | 6de453d6-4ed1-4175-915c-fb72c0922cec | status=FAILED | branch=null | sha=null | in_origin_main=unknown | repo=null | reason=deploy | fix: handle BOM multiplicity and thickness guard
2026-07-04T18:24:01.797Z | f5d930e5-65c1-4a92-9e05-fdcea9fcbbc0 | status=REMOVED | branch=main | sha=1b2fdbe09dadd6e31b07cae167013ecff54b55dd | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Restore outsourcing workflow
2026-07-04T17:35:12.459Z | 892c0711-8285-489d-a8cb-483feeb3c64a | status=REMOVED | branch=main | sha=2cf2b61da0e3155852b64cffa8e095b47e09e2c2 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | hotfix: remove DXF warnings header
2026-07-04T14:57:51.504Z | 99c77b89-11e7-4853-8941-048e7095ae06 | status=REMOVED | branch=main | sha=4c6f4c95ff0ccba83c8ce8d14a2cfe7fdb3227d6 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Merge phase2-fixes into main
2026-07-02T15:13:28.693Z | 90a26ad1-5e05-4b5f-8462-9df574b0e1dd | status=REMOVED | branch=main | sha=d72bb97e480fd5559a3d526573de178ea737d584 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Hide supply lane when supply filter is off
2026-07-02T13:03:33.022Z | 04b03680-80a8-450c-882e-761499e7639e | status=REMOVED | branch=main | sha=9fa37227e97d594ee0893032b3efc642f8f28484 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Avoid overlapping production planner stages
2026-07-02T12:52:16.693Z | 378bde3d-dc09-48a6-824c-19e982e01fce | status=REMOVED | branch=main | sha=9bc72e73e23d6fe85d662e926313440f1d9f8573 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Render shipping readiness as green marker
2026-07-02T12:38:27.550Z | 2f0f7f52-cdcf-4768-a91f-0658c2631d1d | status=REMOVED | branch=main | sha=6bf2c2a73a4fd84e67401ade639e4ff40affcf2a | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Show shipping readiness on production gantt
2026-07-02T08:56:24.238Z | c2a5b2cd-baa0-47c8-9a39-55f8081c41f2 | status=REMOVED | branch=main | sha=07dd928605da07b97b2db365c3d26183776adeef | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Add quality control document
2026-07-02T07:39:59.283Z | 4dee2f11-907e-4a5b-ae1c-e1d51e7ae2a9 | status=REMOVED | branch=main | sha=626e9703dae7f8bcbf7f727239e9c0ea1e034aeb | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Add computed machine progress
2026-07-01T19:29:01.986Z | 070aa9fe-9605-487d-8b4e-7c7ed528d151 | status=REMOVED | branch=main | sha=8cb13988f45e1e0e7d889e57f064ede2a227b24d | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Use request item weights in inventory history
2026-07-01T19:20:34.532Z | ff4393d1-feed-4076-9f66-5eace88baf34 | status=REMOVED | branch=main | sha=718848e0b65ea5b94c05692064862ea7b0411c4f | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Add inventory history row weights
2026-07-01T18:30:44.411Z | 308066a0-dbfe-46a3-8770-178db2068516 | status=REMOVED | branch=main | sha=f0f1740e7653d318363d0623b9d4989aaac08ddf | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Fix SS23 cutting fact inventory replay
2026-07-01T17:58:05.347Z | 29f99ea6-e927-4395-a910-fa7e8a34d6db | status=REMOVED | branch=main | sha=854cf8f6f9ed647545335facdb9a562f569f58b1 | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Fix collapsed sidebar header icon
2026-07-01T17:35:56.075Z | 2c1cf039-f81e-4851-adc5-6c3c4c9f908f | status=REMOVED | branch=main | sha=519c33ff1c810924bbd62fab4e444d03561ea60d | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Remove today line from timeline header
2026-07-01T15:25:36.446Z | a4869547-0418-491b-b7e9-71678059eaca | status=REMOVED | branch=main | sha=acb0df897ddb90d0cbddcaabe21e94822957bb3c | in_origin_main=yes | repo=igorriabov98/crm-nesting-platform | reason=deploy | Speed up production date edits
```

Таблица потерянных/непродвинутых изменений:

| Потерянное изменение | Где найдено | Как вернуть |
|---|---|---|
| BOM multiplicity + thickness guard (`efc67ca`, merge `2b4131b`) | `origin/fix-bom-multiplicity`; Vercel CLI deploy `2b4131b`; Railway removed CLI deploys с message BOM fix | `git merge --no-ff origin/fix-bom-multiplicity` или `git cherry-pick efc67ca` после свежей базы |
| Production planner layout `7da0da8` | read-only fsck unreachable commit; ни одна ветка не содержит | `git cherry-pick 7da0da8` |
| Sales/material date commits `53196e4`, `da38ef9`, `0cdba25` | Vercel CLI deploy history; `origin/phase2-unfold` | проверить на superseded и cherry-pick нужные SHA из `origin/phase2-unfold` |
| Railway deploy `e3b32da2...` | Railway history; metadata без SHA, imageDigest и cliMessage BOM fix | восстановление через `origin/fix-bom-multiplicity`, не через deployment SHA |

## 8. Итоговый вердикт и план

Таблица:

| Слой | Ожидание | Факт | Расхождение |
|---|---|---|---|
| `origin/main` | содержит текущие production-фиксы | `f95774e`; не содержит `efc67ca`/`2b4131b`; не содержит `7da0da8`; не содержит часть `phase2-unfold` CLI-deploy SHA | BOM fix и часть deploy history вне main |
| Railway | prod из main с актуальным BOM fix | current SUCCESS `0136f4ad...` branch `main`, SHA `f95774e`; `efc67ca` нет | BOM fix не в prod; ранее был removed CLI deploy без SHA |
| Vercel | prod из main с актуальным BOM fix | current alias на CLI deploy `codex/restore-outsourcing`, SHA `f95774e`; `efc67ca` нет | SHA совпадает с main, но deployment не из main metadata; BOM fix не в prod |
| Prod DB schema | соответствует deployed code | `202607040001_thickness_guard` applied; deployed `f95774e` не содержит миграцию/поля | схема опережает код |
| Prod DB seed | 11 строк steel seed | `public.steel_types` содержит 14 строк; seed file на 11 строк есть в `efc67ca`, отсутствует в `f95774e` | seed/data опережают main и отличаются от ожидания |
| Потерянные изменения | нет lost commits/deploy-only SHA | fsck: `7da0da8`; Vercel deploy-only: `2b4131b`, `0cdba25`, `da38ef9`, `53196e4`; Railway removed deploys без SHA | нужно восстановить/отсечь перед единым deploy |

План консистентности: НЕ ВЫПОЛНЯТЬ без подтверждения; каждая строка ждёт подтверждения.

| Шаг | Команда | Статус |
|---:|---|---|
| 1 | `git fetch --all --prune && git rev-parse origin/main` | ждёт подтверждения |
| 2 | `git -C /private/tmp/phase2-main-merge status --short` | ждёт подтверждения |
| 3 | `git -C /private/tmp/phase2-main-merge reset --hard origin/main` | ждёт подтверждения |
| 4 | `git -C /private/tmp/phase2-main-merge clean -fd -- nesting-service/prisma/migrations/20260701000000_baseline_existing_nesting_schema/` | ждёт подтверждения |
| 5 | `git -C /private/tmp/phase2-main-merge merge --no-ff origin/fix-bom-multiplicity` | ждёт подтверждения |
| 6 | `git -C /private/tmp/phase2-main-merge cherry-pick 7da0da8` | ждёт подтверждения |
| 7 | `git -C /private/tmp/phase2-main-merge cherry-pick 53196e4 da38ef9 0cdba25` | ждёт подтверждения, только если эти commits не superseded |
| 8 | `git -C /private/tmp/phase2-main-merge log --oneline --decorate -10` | ждёт подтверждения |
| 9 | `git -C /private/tmp/phase2-main-merge test "$(git rev-parse main)" = "$(git rev-parse origin/main)"` | ждёт подтверждения |
| 10 | `git -C /private/tmp/phase2-main-merge push origin main` | ждёт явного подтверждения push |
| 11 | `git -C /private/tmp/phase2-main-merge log origin/main --oneline -3` | ждёт подтверждения |
| 12 | `railway redeploy --service crm-nesting-platform --environment production` | ждёт явного подтверждения deploy |
| 13 | `vercel --prod --yes` | ждёт явного подтверждения deploy |
| 14 | `railway deployment list --json | jq '.[0] | {id,status,createdAt,meta:{branch:.meta.branch,commitHash:.meta.commitHash}}'` | ждёт подтверждения |
| 15 | `vercel list crm-nesting-platform --environment production --status READY --format json --yes --no-color | sed -n '/^{/,$p' | jq '.deployments[0] | {url,target,meta}'` | ждёт подтверждения |
| 16 | smoke: `DXF старого проекта; KVSH-100-SB-FULL: строк без детали 0, накладки s4, стали без warning` | ждёт подтверждения и конкретных project IDs |
