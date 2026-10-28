# Жизненный цикл артефактов

Документы остаются неизменяемыми файлами. Статусы и связи меняет пакет
ChangeSet: сервер проверяет предполагаемое постсостояние, сохраняет версию
предложения и вычисляет SHA-256 digest. Перезапись содержимого не поддерживается.
UI принятия документов относится к этапу 0094; описанные HTTP/MCP операции уже
доступны серверу и агентам.

## Последовательность

1. `change_sets.propose` сохраняет `{requestId, changeSet}`. Для новой версии
   передаются `id` и `expectedVersion`. В `expectedVersions` должны быть версии
   всей области, которую показывает `POST /api/artifacts/change-sets/preview`.
2. `validations.prepare({changeSetId,version})` фиксирует manifest и возвращает
   validation ID. `validations.start({id,presetId})` запускает отдельную ACP-сессию
   выбранного серверного пресета.
3. Валидатор читает все страницы `validations.manifest({id,limit,cursor})` и все
   обязательные тексты `validations.read({id,key,offset})`. Для документа key —
   UUID; для обсуждения — `review:threadId`. Сервер выдаёт UTF-8 блоки до 8 KiB
   с `nextOffset`, отслеживает непрерывное покрытие байтов и проверяет свежесть.
4. `validations.submit` принимает verdict `pass|conflict|incomplete`, findings
   с точными цитатами и resolutions. Digest и validatorSessionId назначает сервер.
   Неполное чтение превращает результат в `incomplete`. Необязательный `report`
   сохраняется отдельным изолированным draft; его создание не инвалидирует manifest.
   Также доступен `validations.create_report({id,body})`.
5. Агент вызывает `actions.request` с `{kind:'lifecycle',changeSetId,version,validationId}`.
   Пользователь подтверждает конкретное pending action через защищённый HTTP API.
   Агент не может выдать себе разрешение. Обычные ACP permissions и autoApprove
   пользовательское подтверждение не заменяют.
6. `change_sets.commit({id,version,validationId,authorizationId,requestId})` применяет
   пакет атомарно. Replay того же requestId возвращает прежний результат; повторное
   потребление разрешения с другим requestId запрещено.

Manifest включает объединение текущего и предложенного графов, lineage,
контекст связанных задач и общих принятых документов, версии обсуждений и
обязательные тексты. Скрытый текст комментариев не выдаётся в контексте.
Новые узлы и блокеры учитываются через validationEpoch; metadataVersion внутри
области тоже обязана совпадать. Перед commit сервер проверяет физические файлы.
Открытые блокеры транзитивных priority targets действуют и без revisionOf.

## HTTP

| Метод и путь | Действие |
|---|---|
| POST `/api/artifact-change-sets` | Предложить пакет или новую immutable версию |
| GET `/api/artifact-change-sets/:id` | Текущая версия предложения |
| POST `/api/artifact-validations` | Prepare: `{changeSetId,version}` |
| POST `/api/artifact-validations/:id/start` | Start: `{presetId}` |
| GET `/api/artifact-validations/:id` | Статус и краткая сводка отчёта |
| GET `/api/artifact-validations/:id/manifest` | Страницы manifest, `limit/cursor` |
| GET `/api/artifact-validations/:id/report` | Полный структурированный отчёт блоками, `offset` |
| GET `/api/artifact-validations/:id/history` | Immutable история, `afterSeq/limit` |
| DELETE `/api/artifact-validations/:id` | Отменить проверку |
| GET `/api/artifact-actions` | Pending actions для подтверждения |
| POST `/api/artifact-actions` | Предложить конкретное действие от пользователя |
| POST `/api/artifact-actions/:id/approve` | Подтвердить с `{sourceUserRequestId}` |
| DELETE `/api/artifact-actions/:id` | Отозвать pending action или grant |
| POST `/api/artifact-change-sets/:id/commit` | Атомарно применить подтверждённый пакет |
| POST `/api/artifact-review-actions` | Выполнить `{action,authorizationId}` для review |

Agent bearer не действует на пользовательских HTTP API. Уведомление
`artifact-actions` идёт через существующий `/api/agent/events`; новый EventSource
не нужен. Grant привязан к сессии, точному digest и manifest, действует 15 минут,
используется один раз и не восстанавливается после restart.

Для review `actions.request` принимает
`{kind:'review',threadId,input:{requestId,expectedThreadVersion,kind,scope,...}}`.
Kind — `resolved`, `reopened` либо `blocking_changed` (с `blocking`). Scope содержит
`appliesToArtifactId` и `includeRevisionDescendants:true`. Такие grants имеют
manifestDigest=null и не требуют validation pass. После подтверждения агент
вызывает `reviews.resolve`, `reviews.reopen`, `reviews.set_blocking` либо общий
`reviews.execute`. Изменение scope, версии или значения требует нового grant.

## Статусы и сбои

Команды пакета: `submit_review`, `return_to_draft`, `reject`, `accept`, `archive`,
`delete`, `restore`, `update_relations`. Принятие возможно из in_review.
`restore` возвращает archived/deleted в draft. История superseded навсегда
запрещает восстановление прежнего документа: нужен новый артефакт.

При замене accepted предшественник получает superseded. Для каждого активного
дополнения требуется incorporated → archived + includedIn audit, carry_forward →
accepted с новой базой, либо obsolete → archived/deleted. Исторические priority
связи сами по себе не активны; активен только accepted source.

Одновременно работает одна validation job на store, включая несколько serve.
Timeout — 10 минут. Отмена, завершение агента без отчёта и отзыв сессии не дают pass.
После restart история и prepared/report записи сохраняются. Проверка с умершим
owner или истёкшей lease становится incomplete; чужая активная lease сохраняется.

Изменившийся manifest, неверное разрешение, открытый blocker или сбой записи
отклоняют весь commit. SSE отправляется после успешной транзакции. Отчёт является
свидетельством процедуры; сервер не доказывает смысловую правильность анализа.
