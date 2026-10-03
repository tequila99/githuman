# Контекст запроса к агенту: URI и блоки

Как элементы контекста чата (`diff`, `file`, `review`, `attachment`) превращаются в блоки запроса ACP.
Код — `src/server/services/agent/context-builder.ts`, схема элементов — `src/shared/agents/schemas.ts`
(`ContextItem`). Термины — в [глоссарии](GLOSSARY.md).

## Что такое `githuman://`

`githuman://…` — идентификатор встроенного ресурса (`resource.uri`) в запросе ACP. Это **не адрес**: по
нему нельзя ничего открыть или скачать, и сам githuman его нигде не разбирает. Идентификатор нужен агенту,
чтобы назвать источник текста («diff из индекса», «ревью»), и ACP требует поле `uri` у ресурса.

| Вид | URI | Источник | Кодирование |
|---|---|---|---|
| `diff` | `githuman://diff/<source>/<path>` | `source` — `staged` или `unstaged`; `path` — путь файла в diff, может отсутствовать | `path` не кодируется. Без пути URI заканчивается на `/` |
| `review` | `githuman://review/<id>` | `id` ревью | не кодируется |
| `attachment` | `githuman://attachment/<имя>` | имя файла, которое прислал клиент (только текстовые вложения) | `encodeURIComponent` |

## Как элемент контекста попадает в запрос

Запрос — это текст пользователя, затем по одному блоку на каждый элемент контекста (`buildPromptBlocks`).

| Элемент | Блок ACP | Условия |
|---|---|---|
| `diff` (текст изменений) | `resource` с `githuman://diff/…`, тип `text/x-diff` | агент объявил `embeddedContext`; иначе — обычный текстовый блок с кодовой оградой, URI **отбрасывается** |
| `review` (ревью с комментариями, markdown) | `resource` с `githuman://review/…`, тип `text/markdown` | то же |
| `attachment`, текст в UTF-8 | `resource` с `githuman://attachment/…` | то же |
| `file` (файл репозитория) | `resource_link` с `file://` | агент читает файл сам, в том же `cwd` |
| `attachment`, изображение | `image` | агент объявил `image`, иначе ошибка «This agent does not accept images» |
| `attachment`, остальное (PDF, архив, не UTF-8) | `resource_link` с `file://` на копию в каталоге вложений | копия лежит вне репозитория |

Текст длиннее `MAX_EMBEDDED_CHARS` (200 000 символов) обрезается маркером
`… [truncated by githuman: N more characters]`: агент видит, что его обрезали и кто это сделал.
Вложение больше `MAX_ATTACHMENT_BYTES` (10 МБ) отклоняется.

Упоминание `@путь` остаётся в тексте запроса как метка, а редактор отдельно добавляет элемент контекста
`file` с тем же путём (повторы убираются). Сам файл поэтому уходит один раз, как `resource_link`, а метка
в тексте показывает агенту, о каком файле речь.

## Как добавить новый вид элемента

1. Добавить вариант в `ContextItem` (`src/shared/agents/schemas.ts`).
2. Написать `build<Вид>Item` в `context-builder.ts` и добавить ветку в `buildItem`.
3. Для встроенного текста взять `embed(...)` и новый URI вида `githuman://<вид>/…`; записать его в таблицу выше.
4. Показать элемент в интерфейсе: `src/web/components/agent/` и `src/web/utils/agent-context-label.ts`.
5. Добавить тест в `tests/server/routes/agent.test.ts`.
