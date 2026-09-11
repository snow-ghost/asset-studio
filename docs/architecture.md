# Устройство

Два компонента и один формат обмена.

## Бэкенд — `studiod` (Go)

Три слоя с зависимостями строго внутрь (`adapters → app → domain`, ADR-0001), проверяются `make lint`
(`depguard` — импорты, `forbidigo` — `time.Now` и `rand` в `domain`/`app`).

- `server/cmd/studiod` — composition root: флаги и env → адаптеры → use case'ы → HTTP. В проде отдаёт и
  собранный фронтенд.
- `server/internal/domain` — что такое ассет: виды, закрытое множество форматов с медиатипами и таблица
  «вид → допустимые форматы», правила id, `Validate`, `ValidatePayload` (сигнатура по формату), рецепт
  процедурной текстуры как непрозрачный JSON (ADR-0004), манифест как чистая функция. Только stdlib, ни
  часов, ни случайности.
- `server/internal/app` — use case'ы (`Studio`: List, Get, Payload, Save, Delete, Manifest) и порты
  `Repository`, `Clock`, `IDs`.
- `server/internal/adapters/fsrepo` — хранилище на диске. Ассет = два файла в каталоге данных: метаданные
  `<id>.json` и нагрузка `<id>.<формат>` (glb/gltf/png). Нагрузка лежит отдельным файлом специально: это
  ровно тот файл, который загрузит three.js-клиент wowd, — его можно отдать байт-в-байт и позже скопировать
  в каталог ассетов игры без конвертации (ADR-0002). Запись атомарна: временный файл → `fsync` → `rename`,
  сначала нагрузка, потом метаданные.
- `server/internal/adapters/memrepo` — то же в памяти, для юнитов `app`.
- `server/internal/adapters/system` — системные часы и генератор id.
- `server/internal/adapters/httpapi` — HTTP: декодировать, вызвать use case, закодировать; ошибки домена
  становятся кодами ответов в одном месте.

Зависимости продуктового кода — только stdlib (`godog` — тестовая). Хранилище — файлы, не БД: ассетов
немного, они крупные и бинарные, а diff по `<id>.json` человекочитаем.

### API

| Метод | Путь | Что |
|---|---|---|
| GET | `/api/assets` | список метаданных, новые сверху |
| POST | `/api/assets` | создать/сохранить (JSON: name, kind, format, tags, wowdRef, procedural, data=base64). Формат соответствует виду (`texture` ⇔ `png`, модели ⇔ `glb`/`gltf`), нагрузка — формату по сигнатуре, `procedural` — только у текстуры (JSON-объект до 4 КиБ), иначе 400; нагрузка больше лимита (`-max-payload`, 64 МиБ) — 413 с названным лимитом |
| GET | `/api/assets/{id}` | метаданные |
| PUT | `/api/assets/{id}` | обновить |
| DELETE | `/api/assets/{id}` | удалить |
| GET | `/api/assets/{id}/payload` | сырые байты модели/текстуры |
| GET | `/api/manifest` | мост в wowd (см. integration-with-wowd.md) |

### Приёмка

Поведение каркаса зафиксировано спекой `specs/000-scaffold/spec.md` и сценариями `features/**`
(Gherkin, английский, язык дизайнера). Их исполняет godog из `server/test/bdd`: каждый сценарий получает
свою студию во временном каталоге с тикающим фейковым `Clock` и говорит с ней через HTTP-хендлер
in-process, без сокета — 36 сценариев проходят за десятки миллисекунд. `make bdd` (с фильтрами `F=`, `T=`)
или `make test`. `make trace` строит `docs/traceability.md` и падает на непокрытом критерии.

## Фронтенд — `web` (three.js + TS + Vite)

Те же три слоя, что на бэкенде (ADR-0001); правила импортов — в `AGENTS.md`, раздел 4.

- `src/domain` — словарь ассета, зеркало Go-домена: виды, форматы, `formatFor(kind)` (исчерпывающий
  `switch`), `validateName`, типы `Asset` и `Manifest`; `import.ts` — одна дверь для файлов с диска
  (`inspectImport`: PNG или glTF по байтам, затем соответствие виду; для glTF — внешние файлы,
  Draco/meshopt; лимит); `model.ts` — `Transform`, `MaterialParams`, `ModelStats` и их проверки;
  `texture.ts` — рецепт процедурной текстуры (`checker`, `stripes`, `noise`) и детерминированный генератор
  RGBA с seeded PRNG; `limits.ts` — лимит нагрузки, одно число с сервером (`testdata/limits.json`). Чистый
  TS, ни three.js, ни DOM, ни fetch.
- `src/app/session.ts` — `StudioSession`: активный ассет, поля формы, список, выбор меша, маркер
  «изменено», текстура в работе (импортированные байты / рецепт / «пиксели не трогали»); new placeholder /
  import / save / load / delete / правки через порты из `ports.ts` (`AssetGateway`, `ModelCodec`,
  `TextureCodec`, `Placeholders`, `ViewportPort`, `EditorPort`, `ConfirmPort`, `StatusSink`).
  `commands.ts` — `History` на 50 шагов и команды `SetTransform`, `SetMaterial`, `SetTexture` с
  `apply`/`undo` (ADR-0003). Тестируется в Node с фейками.
- `src/adapters/three` — вьюпорт (сцена, свет, сетка в метрах, орбитальная камера; версии three.js и
  шкала как в клиенте wowd, чтобы вид совпадал с игрой), placeholder'ы по виду (капсула-тело,
  коробка-предмет, шумный патч ландшафта, процедурная текстура — то, что дизайнер заменяет, и то же, что
  wowd рисует сейчас, поэтому подключение манифеста не меняет вид, пока не появится настоящая геометрия),
  импорт/экспорт glTF с развёрткой сцены-обёртки и переносом анимаций (ADR-0003), текстуры (`texture.ts`:
  пиксели ↔ canvas ↔ PNG, предпросмотр на плоскости; для материалов — в ориентации glTF, чтобы round-trip
  сохранял пиксели, ADR-0004), `editor.ts` — гизмо (`TransformControls`), выбор меша лучом, рамка выбора,
  TRS корня, материалы и их текстуры по id, статистика модели.
- `src/adapters/http/api.ts` — `AssetGateway` поверх fetch. База API: `VITE_STUDIO_API`, иначе
  `http://localhost:8099` под Vite и тот же origin в сборке, которую отдаёт `studiod -web`.
- `src/adapters/ui` — тулбар с импортом файла (`.glb`, `.gltf`, `.png`), строка статуса и маркер
  «изменено», список, инспектор (статистика, поля трансформации, режимы гизмо W/E/R, материал выбранного
  меша и его текстура из ассетов студии, рецепт процедурной текстуры, undo/redo и Ctrl+Z);
  `textContent` и `createElement`, никакого `innerHTML` с данными; `confirm` только здесь.
- `src/main.ts` — сборка и `window.__studio`: ручка, через которую браузерные тесты читают состояние
  вьюпорта вместо пикселей.

Тесты: `web/tests/unit` — Vitest, `make test-web`; `web/tests/e2e` — Playwright, `make e2e` (собирает
`dist`, поднимает `studiod` на `:8199` с пустым каталогом данных, гоняет сценарии `@e2e` из
`features/e2e/`).

## Формат обмена

glTF/GLB для моделей, PNG для текстур. Причина одна: это то, что клиент wowd (three.js) грузит нативно.
Никакого промежуточного формата студии — что сохранили, то игра и покажет.
