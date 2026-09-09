# GitHuman

Локальный CLI + веб-интерфейс для просмотра изменений в git-репозитории —
staged/unstaged diff, сравнение веток и коммитов, браузер файлов с
подсветкой синтаксиса — до коммита. Данные никуда не уходят: всё работает
локально, поверх обычного `git`.

Идея и часть архитектуры унаследованы от оригинального
[mcollina/githuman](https://github.com/mcollina/githuman) (MIT) — эта версия
переосмысливает стек (Fastify + `node:sqlite` на бэкенде, Vue 3 + Quasar на
фронтенде вместо React) и интерфейс.

## Что уже работает

- Просмотр diff: staged, unstaged, между ветками, между произвольными
  коммитами.
- Браузер файлов репозитория (не только изменённых) с подсветкой
  синтаксиса (shiki).
- Live-обновления через SSE: интерфейс сам обновляется при изменении
  файлов в репозитории — удобно смотреть, как редактирует код AI-агент.
- Ручной/авто выбор тёмной-светлой темы.
- CLI: `serve` (поднять сервер), `list`/`export` (быстрый доступ к
  сохранённым ревью без веб-интерфейса).

## Известное ограничение (WIP)

Бэкенд полностью поддерживает модель "ревью" — создание ревью
(staged/branch/commits), инлайн-комментарии, статусы
(`in_progress`/`approved`/`changes_requested`), экспорт в Markdown/JSON — всё
это покрыто тестами (`src/server/routes/reviews.ts`, `comments.ts`,
`export.ts`). **Соответствующий экран во фронтенде пока не реализован** —
`ReviewsPage.vue` сейчас заглушка. Работает только просмотр diff/файлов;
создание ревью и комментирование через UI недоступно. Это следующий
логический кусок работы, не забытая функциональность — трекается в
`.claude/docs/adr/0014-quasar-frontend-migration.md` (не публикуется, файл
только для локальной разработки).

## Установка и запуск

Требуется Node.js ≥ 24 (используется нативный `node:sqlite`) и pnpm.

```bash
git clone <url-этого-репозитория>
cd githuman
pnpm install
pnpm run build
node dist/cli/index.js serve
```

По умолчанию сервер слушает `http://localhost:3847` и открывает браузер
автоматически (отключить: `--no-open`). Репозиторий, который анализируется —
это `git`-репозиторий, из корня которого запущена команда (определяется как
`git rev-parse --show-toplevel` от текущей директории).

```bash
node dist/cli/index.js serve --port 4000 --host 0.0.0.0   # LAN-доступ, см. предупреждение ниже
node dist/cli/index.js list --status in_progress            # список ревью без веб-интерфейса
node dist/cli/index.js export last --format markdown -o review.md
```

> **Осторожно с `--host 0.0.0.0`**: сервер по умолчанию не требует
> аутентификации. Открывая его в локальной сети, любой в этой сети сможет
> просматривать содержимое репозитория.

### Данные и совместимость с оригинальным mcollina/githuman

Ревью хранятся в `.githuman/ght-reviews.db` (SQLite) в корне анализируемого
репозитория. Префикс `ght-` — сознательный выбор: оригинальный
[mcollina/githuman](https://github.com/mcollina/githuman) хранит свои данные
в том же `.githuman/reviews.db` с несовместимой схемой — без префикса оба
инструмента затирали бы файлы друг друга при использовании в одном
репозитории.

Префикс настраивается флагом `--db-prefix` (доступен у `serve`, `list`,
`export` — указывайте один и тот же для всех трёх) или переменной окружения
`GITHUMAN_DB_PREFIX`; флаг имеет приоритет над переменной. Пустое значение
(`--db-prefix ""`) — осознанный режим совместимости: работать с
`.githuman/reviews.db` оригинального инструмента напрямую (миграция схем на
вашей ответственности).

```bash
node dist/cli/index.js serve --db-prefix myteam-   # .githuman/myteam-reviews.db
node dist/cli/index.js list --db-prefix ""         # .githuman/reviews.db (оригинальный githuman)
```

## Разработка

Два процесса нужны одновременно — backend (Fastify, автоперезапуск при
правках) и frontend (Quasar dev-сервер с HMR):

```bash
# терминал 1 — backend
pnpm run dev:server

# терминал 2 — frontend, из этого же репозитория
pnpm run dev
```

Если backend должен анализировать _другой_ репозиторий, а не сам
githuman — запустите `dev:server` из cwd того репозитория, указав
абсолютный путь к скрипту:

```bash
cd /path/to/other/repo
node --watch-path=/path/to/githuman/src \
  /path/to/githuman/src/cli/index.ts serve --no-open
```

Прочие команды:

```bash
pnpm test           # server (node:test) + CLI
pnpm run typecheck   # tsc (server) + vue-tsc (web)
pnpm run lint:check  # oxfmt --check + oxlint (read-only)
pnpm run lint        # то же самое, но с автофиксом
pnpm run build       # server (tsc) + web (quasar build) → dist/
```

Нет отдельного набора тестов для Vue-компонентов и e2e-спеков в
`tests/e2e/` пока не существует (несмотря на `playwright.config.ts` и
`test:e2e`-скрипт) — покрытие сейчас только на уровне backend/CLI (175
тестов, `node:test`).

## Стек

- **Backend**: Fastify 5, `node:sqlite` (нативный, синхронный), TypeBox
  (валидация + OpenAPI), SSE для live-обновлений.
- **Frontend**: Vue 3 + Quasar (Composition API, `<script setup>`), Pinia,
  vue-i18n, shiki.
- **Тесты**: `node:test` (backend/CLI).
- **Пакетный менеджер**: pnpm.

## Лицензия

MIT, см. [LICENSE](LICENSE).
