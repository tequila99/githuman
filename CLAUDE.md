# CLAUDE.md

Локальный CLI + веб-инструмент для просмотра git-diff (staged/unstaged/
branch/commits) с браузером файлов и подсветкой синтаксиса — до коммита.
Общее описание и команды пользователя — в [README.md](README.md). Этот файл
— для Claude Code (или другого агента), работающего в этом репозитории.

## Структура

- `src/server/` — Fastify-бэкенд, 3 слоя: `routes/` (HTTP + TypeBox-схемы
  валидации) → `services/` (бизнес-логика, вызовы `git`) →
  `repositories/`+`db/` (прямой доступ к `node:sqlite`).
- `src/cli/` — команды `serve`/`list`/`export`, парсинг аргументов
  (`node:util` `parseArgs`, не сторонняя библиотека).
- `src/shared/types.ts` — типы, общие между backend и frontend.
- `src/web/{components,pages,stores,composables,boot,router,api,i18n}` —
  frontend на Quasar (Vue 3 + Composition API + `<script setup>`, Pinia,
  vue-i18n). `@` в импортах указывает на `src/web` (алиас переопределён в
  `quasar.config.ts`, т.к. `src/` также содержит `cli`/`server`/`shared`,
  не относящиеся к веб-приложению). Pinia подключается вручную в
  `src/web/boot/pinia.ts`, а не через `sourceFiles.store` — у Quasar два
  несовместимых способа резолвить этот путь (через alias и от корня
  проекта одновременно), и при нестандартном `@` они расходятся.
- `tests/server/`, `tests/cli/` — `node:test`, зеркалируют структуру `src/`.
  **Нет тестов для Vue-компонентов** и `tests/e2e/` не существует (несмотря
  на `playwright.config.ts` и скрипт `test:e2e` — известный пробел, не
  чинить молча, если не просили явно).
- `.claude/docs/adr/`, `.claude/docs/plans/` — история решений проекта
  (см. ниже). **Не публикуется на GitHub** (`.claude/` в `.gitignore`).

## Рабочий процесс: ADR + план перед новой фичей

Проект последовательно ведёт `.claude/docs/adr/NNNN-slug.md` (что решили и
почему, формат: Статус/Дата/Этап, Контекст, Драйверы, Рассмотренные
варианты, Итоговое решение, Последствия, Ссылки) и парный
`.claude/docs/plans/NNNN-slug.md` (шаги реализации + критерии приёмки) —
по одной паре на этап, сквозная нумерация (сейчас дошла до 0015). Перед
нетривиальной новой фичей или архитектурной заменой — сначала ADR+план,
потом код. Существующий ADR **не переписывается по существу задним числом**
— при устаревании решения добавляется отметка `Статус: Частично
superseded` со сноской под заголовочной таблицей и новый ADR с явным
`Supersedes: ADR NNNN` (см. пример: 0011 → 0014/0015). См.
`.claude/docs/README.md` для текущего состояния статусов и известных
неточностей в старых записях.

## Команды

```bash
pnpm run dev:server   # backend, автоперезапуск при правках в src/
pnpm run dev          # frontend, Quasar dev-сервер с HMR (проксирует /api на :3847)
pnpm test             # test:server + test:cli (node:test) — 175 тестов
pnpm run typecheck    # tsc (server) + vue-tsc (web)
pnpm run lint:check   # oxfmt --check + oxlint — read-only, используй перед коммитом
pnpm run lint         # то же самое + автофикс
pnpm run build        # tsc (server) + quasar build (web) → dist/
```

Пакетный менеджер — **pnpm**, не npm/yarn (`packageManager` в
`package.json` пинует версию). Node ≥ 24 обязателен — используется нативный
`node:sqlite` (синхронный API, помечен experimental — предупреждение в
рантайме ожидаемо, не баг).

## Важные технические решения (не переоткрывать без ADR)

- **Аутентификации нет** — инструмент локальный, `--host 0.0.0.0`
  сознательно доступен без пароля в LAN (ADR 0008). Не добавлять auth без
  отдельного ADR.
- **Git-команды только через `execFile`**, никогда `exec`/`shell: true` —
  избегает shell-инъекции по построению. Любой пользовательский ввод,
  идущий в `git`-аргументы (ref/base/from/to), обязан пройти
  `assertSafeRef()` (`src/server/services/git.service.ts`) — refs не могут
  начинаться с `-` (иначе git трактует их как опции, см. историю
  git-инъекций, пофикшено 2026-09-08). Пути с диска (`WORKTREE`-чтения)
  обязаны идти через `resolveWithinRepo()` — не собирать `join(repoPath,
userPath)` напрямую.
- **Тема**: `Dark.set('auto')` по умолчанию + ручной тумблер
  (`use-app-theme.ts`, персистентный в `localStorage`) — см. ADR 0015.
- **Diff-файлы переиспользуют object identity** между рефетчами
  (`reconcileFiles` в `diff-store.ts`) — не убирать это при рефакторинге
  стора: без этого SSE-обновления сбрасывают UI-состояние каждой открытой
  карточки (см. `.claude/docs/adr/0014...`, известный баг, пофикшено
  2026-09-08).
- **Подсветка синтаксиса — на уровне файла целиком**, не построчно (ADR
  0011, раздел Shiki, остаётся в силе несмотря на миграцию на Quasar).
- **Pinia подключается вручную** (`app.use(createPinia())` в
  `src/web/boot/pinia.ts`, первым в `boot`-массиве), не через
  `sourceFiles.store` в `quasar.config.ts` — при переопределённом `@`-алиасе
  (нужен из-за `src/web/`) Quasar резолвит `sourceFiles.store` двумя
  несовместимыми способами одновременно (через alias — для рантайм-импорта,
  и от корня проекта — для feature-флага `hasStore`), из-за чего
  `app.use(store)` тихо не вызывается вообще, без ошибок сборки. Не
  возвращать `sourceFiles.store` обратно без явного решения этой проблемы.

## Стиль кода

- JSDoc-комментарии — только там, где поведение не очевидно из кода (WHY,
  не WHAT) — см. существующие функции в `git.service.ts`/`diff.service.ts`
  как образец.
- `oxlint`/`oxfmt`, не eslint/prettier. Конфиг в `oxlint.config.ts`
  сознательно не включает категории `style`/`pedantic`/`restriction` — см.
  комментарий в начале файла, почему.
- Composition API + `<script setup>` везде во Vue-компонентах — не Options
  API.

## Известные ограничения продукта (на 2026-09-08)

- **UI ревью/комментариев не реализован** — бэкенд полностью готов
  (`routes/reviews.ts`, `comments.ts`, протестировано), но
  `src/pages/ReviewsPage.vue` — заглушка. См. README.md.
- Нет тестов для Vue-компонентов (`vitest`/`@testing-library/vue` не
  подключены) и `tests/e2e/` не существует.
