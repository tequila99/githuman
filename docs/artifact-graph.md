# Задачи, типы и граф артефактов: этап 0089

Основание хранения и резервное копирование описаны в [artifact-storage.md](artifact-storage.md).
Этот этап добавляет серверные модели и API; пользовательский интерфейс и
принятие документов появятся позже.

## Метаданные и линии редакций

Внутренний `ArtifactStorageService.create` принимает прежние `requestId`, `body`,
`metadata` и необязательный `revisionOf` (не более одного ID). В `metadata`
добавлены `typeId`, `taskIds` и `relations`. По умолчанию используются `generic`
и пустые массивы. Начальное состояние сохраняется в неизменяемом frontmatter
с прежним `schema_version: 1`; targets связей записываются как `target_id`.
Текущие метаданные читаются из каталога, а не из frontmatter.

Старые файлы и авторитетные JSON-снимки не переписываются: недостающие поля
возвращаются как пустые массивы. Старые requestId и pending-операции сохраняют
возможность повтора и recovery с прежними байтами.

`updateMetadata` сохраняет пропущенные `typeId`, `taskIds`, `relations`.
Название и теги остаются обязательными. Все изменения требуют `expectedVersion`.
Передать `revisionOf` в обновляемых метаданных нельзя. Смена parent/reference
не меняет lineage и не переносит замечания; цепочка lineage доступна отдельно
для этапа наследования ревью 0091. Прежние draft-редакции сохраняют свой статус.

Направления связей:

| kind | Направление | Ограничение |
|---|---|---|
| `parent` | child → parent | Отдельный DAG; несколько родителей допустимы. |
| `replaces` | новый → заменяемый | Общий DAG приоритета с supplements. |
| `supplements` | дополнение → основание | Общий DAG приоритета с replaces. |
| `references` | источник → цель | Взаимные ссылки допустимы. |

Self-links, повтор kind+target и отсутствующая цель в текущем store отклоняются.
Связи draft-документа являются предложениями и не меняют статус других документов.
Новая редакция accepted-документа должна предлагать replaces или supplements
на предшественника.

## Задачи и типы

Задача содержит `storeId`, UUID `id`, `title`, `externalUrl|null`, `state`
(`open|closed`) и `version`. URL допускает HTTP/HTTPS без credentials.
Закрытие задачи сохраняет все артефакты и их статусы.

Тип содержит `storeId`, неизменяемый `id`, `label`, `active` и `version`.
Идемпотентный seed создаёт `generic`, `plan`, `review`, `research`, `prd`, `adr`,
`proposal`, `specification`, `report`. Новые пользовательские ID имеют формат
`[a-z][a-z0-9_-]{0,99}`. Деактивированный тип недоступен для нового выбора,
но остаётся у существующих артефактов; правка их названия/тегов сохраняется.
Физического удаления задач или типов нет. Тип `generic` — тип по умолчанию, его
нельзя деактивировать. Неизвестный тип или задача во входных данных — ошибка
ввода, а не «не найдено»; несуществующая сессия остаётся «не найдено».
Списки `taskIds` и `relations` при повторе запроса сравниваются как множества:
порядок элементов не меняет хеш запроса.

Команды справочников имеют `requestId`, изменения — `expectedVersion`.
Версия определения, actor, UTC-время, результат команды и изменение epoch
фиксируются одной SQLite-транзакцией. Actor назначает серверный transport.
Начальные определения типов не повышают epoch; пользовательские изменения
используют общий append-only `artifact_store_changes`. Rebuild epoch берёт
последнее событие этого журнала, включая задачи и связи сессий.

## Ограничения масштабирования

- Запись (`create`, `updateMetadata`) проверяет только записываемый документ и
  достижимые из него вершины (`artifactIssues`), а не весь граф. Проверка
  исходит из того, что store валиден до записи; при уже испорченном store она,
  в отличие от полной, запись не блокирует.
- `previewChangeSet` и `GET /api/artifacts/:id/relations` читают все снимки
  store. Размер входа preview ограничен схемой (до 100 субъектов, 100 изменений
  связей, 200 статусов и dispositions, 1000 ожидаемых версий), но каждый принятый
  документ без задач считается глобальным и всегда входит в `affectedIds`.
  Индекс связей и оптимизация preview отложены.
- Назначения чатов повышают общий epoch хранилища: курсоры списков артефактов
  после такого изменения дают 409. Это осознанное решение.
- Копирование истории 0088 в `artifact_store_changes` выполняется один раз,
  пока журнал пуст; события, добавленные кодом 0088 позже, не копируются.

## Предпросмотр: политика команд

- `update_relations` не меняет статусы и требует хотя бы одно изменение связей.
- `accept`, `archive`, `delete`, `restore` задают статус только своим субъектам
  (`accepted`, `archived`, `deleted`, `draft`); у остальных документов
  допустимо лишь производное `superseded` при принятии. Статус дополнения
  определяет его disposition и не повторяется в `targetStatuses`.
- Новая связь `replaces` у документа, принятого до пакета, отвергается
  (`replaces_on_active_artifact`): заменить принятый документ можно только
  принятием нового. Активные замены вне `accept` потребуют расширения 0092.

## API

Все маршруты используют общую проверку доступа устройств и Origin.
Списки и история возвращают страницы с `storeId`, `storeEpoch`, `items`,
`nextCursor`; query — `limit` (1–100, по умолчанию 50) и `cursor`.
После изменения store старый cursor даёт 409: начать список заново.

| Маршрут | Назначение |
|---|---|
| `GET /api/tasks` | Список задач. |
| `GET /api/tasks/:id` | Текущая задача. |
| `POST /api/tasks` | `{requestId, input: {title, externalUrl, state}}`. |
| `PATCH /api/tasks/:id` | `{requestId, expectedVersion, input}`. |
| `GET /api/tasks/:id/history` | Страницы истории определений. |
| `GET /api/tasks/:id/sessions` | Связи с чатами, включая недоступные. |
| `GET /api/tasks/:id/sessions/history` | История назначений с title snapshot и actor. |
| `GET /api/tasks/sessions/:id` | Назначение задач живой серверной сессии. |
| `PATCH /api/tasks/sessions/:id` | `{requestId, expectedVersion, taskIds}`; начальная версия 0. |
| `GET /api/artifact-types` | Все типы, включая неактивные. |
| `GET /api/artifact-types/:id` | Текущий тип. |
| `POST /api/artifact-types` | `{requestId, id, input: {label, active}}`. |
| `PATCH /api/artifact-types/:id` | `{requestId, expectedVersion, input}`. |
| `GET /api/artifact-types/:id/history` | Страницы истории определений. |
| `GET /api/artifacts/:id/relations` | Страницы связей; `direction=outgoing|incoming`, опционально `kind`. |
| `GET /api/artifacts/:id/ancestry` | Страницы предков, от ближайшего; массив `ancestorIds` вместо `items`. |
| `POST /api/artifacts/change-sets/preview` | Структурный предпросмотр предлагаемого пакета. |

Связи чатов назначаются только существующей сессии через серверный registry.
`GET /api/agent/sessions` дополнительно возвращает `taskIds`. Удаление чата
не удаляет задачу и историю. После перезапуска сессия помечается `available=false`;
автоматического восстановления процесса агента этот этап не добавляет.

## Предпросмотр ChangeSet

Вход: `storeId`, `command` (`accept|archive|delete|restore|update_relations`),
`subjectIds`, `expectedVersions: [{id, version}]`, `relationChanges`,
`targetStatuses`, `supplementDispositions` и `reason`.
`relationChanges` заменяет полный список связей указанного документа.

Результат содержит нормализованный `canonical`, серверный `changeDigest`,
`affectedIds`, фактические `expectedVersions`, `requiredSupplementDispositions`,
структурированные `errors`, `postState` и производные аудиторские `includedIn`.
Порядок свойств объектов и порядок множеств изменений не влияют на digest.
В `expectedVersions` входа должны присутствовать все затронутые документы;
сервер показывает недостающие версии в результате предпросмотра.

Полная замена требует решения для каждого действующего дополнения, включая
транзитивные дополнения:

- `incorporated`: прежнее дополнение получает неактивное `superseded`,
  результат содержит историческую запись `includedIn`.
- `carry_forward`: требуется `newBaseId` принятого основания в постсостоянии;
  исторические связи остаются в прежних снимках.
- `obsolete`: требуется явный `targetStatus=archived|deleted`.

Предпросмотр проверяет объединённые графы, ожидаемые версии, доступность
документов и целостность затронутых файлов. Он не фиксирует статусы,
метаданные, epoch или события. Его digest не является разрешением на принятие.
Сохранение версий ChangeSet, агентская validation, авторизации и атомарный
commit относятся к 0092. HTTP-команд создания/перезаписи артефактов нет.

## Внешние документы и обслуживание

Внутренний create сохраняет переданный Markdown body буквально, включая
вложенный пользовательский frontmatter. Серверный frontmatter формируется
отдельно: поля внешнего документа его не переопределяют. Для этого этапа
используется сохранение внешнего frontmatter в теле; его извлечение в
`source_metadata` и публичный MCP import-контракт относятся к 0090.
Существующие ADR автоматически не импортируются и не перемещаются.

Авторитетны также `artifact_revision_parents`, `artifact_type_versions`,
`task_versions`, `task_chat_link_events`, `artifact_definition_operations`
и `artifact_store_changes`; UPDATE/DELETE/REPLACE старых записей запрещены.
`task_current` и `artifact_type_current` перестраиваются через
`storage.catalog.transaction(() => storage.definitions.rebuild())`.
Каталог артефактов и epoch — через `storage.catalog.rebuild()`.
Операции обслуживания выполнять после остановки процессов и полной резервной
копии. Временные ограничения Windows из документа 0088 сохраняются.
