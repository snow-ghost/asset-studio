# Asset Studio

[![ci](https://github.com/snow-ghost/asset-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/snow-ghost/asset-studio/actions/workflows/ci.yml)

Инструмент для создания и просмотра ассетов игры **wowd**: модели персонажей и существ, предметы, элементы
ландшафта и текстуры. Всё, что здесь сделано, предназначено для интеграции в клиент wowd — связь описана в
[docs/integration-with-wowd.md](docs/integration-with-wowd.md) и заложена в код с первого дня.

- **Фронтенд** — three.js + TypeScript + Vite (та же связка и версии, что в клиенте wowd), чтобы то, что видно
  в студии, совпадало с тем, что покажет игра.
- **Бэкенд** — Go (`studiod`): хранит и отдаёт ассеты (модели glTF/GLB, текстуры PNG) и **манифест** —
  список ассетов, привязанных к id контента wowd. Манифест и есть мост в игру.

## Связь с wowd (главное — не потерять)

- Игра лежит в `/opt/projects/wowd` (Go-сервер + three.js-клиент). Сейчас клиент рисует капсулы и плоскую
  землю; моделей и рельефа у него нет.
- Студия делает **картинку**; игра уже владеет **id** (creature_id из `creature_templates.csv`, id предметов
  из `content/items`, id зон из `content/zones`). Поле `wowdRef` у ассета связывает одно с другим, а
  `GET /api/manifest` отдаёт карту «id контента → файл ассета», которую клиент wowd будет загружать вместо
  капсул. Правило VIII конституции wowd (константы и контент — в данных, не в коде) не нарушается: ассеты —
  это визуальный слой клиента, ключами к которому служат те же id.
- Правило XI wowd (никаких названий/ассетов из World of Warcraft) переносится сюда: оригинальный IP.

Подробности и порядок интеграции — в [docs/integration-with-wowd.md](docs/integration-with-wowd.md).
План работ — в [docs/roadmap.md](docs/roadmap.md). Устройство — в [docs/architecture.md](docs/architecture.md).

## Запуск

Два процесса в режиме разработки:

```sh
# 1. Бэкенд (порт 8099), ассеты складываются в ./data/assets
make server        # или: cd server && go run ./cmd/studiod   (-max-payload N — лимит нагрузки в МиБ, по умолчанию 64)

# 2. Фронтенд (порт 5190), обращается к бэкенду по http://localhost:8099
make web           # или: cd web && npm install && npm run dev
```

Открыть http://localhost:5190. Выбрать тип ассета, нажать «New placeholder» или «Import glTF» (`.glb`
или самодостаточный `.gltf`), подвинуть модель гизмо (W/E/R) или числами в панели справа, кликнуть меш и
поправить цвет, metalness и roughness, «Save». Ctrl+Z / Ctrl+Shift+Z — отмена и возврат. Сохранённые
ассеты появляются слева; клик — открыть. Несохранённые правки помечены «● modified», и студия спросит,
прежде чем их потерять.

Собранный фронтенд можно отдавать одним процессом:

```sh
cd web && npm run build
cd ../server && go run ./cmd/studiod -web ../web/dist   # всё на порту 8099
```

## Проверка

```sh
make check   # сборка, go vet, типы фронтенда
make lint    # gofmt, go vet, golangci-lint (границы слоёв), типы фронтенда
make bdd     # приёмочные сценарии features/** (godog); make bdd F=features/assets T='@req-000-3'
make test    # все тесты бэкенда, приёмка включена
make test-web # юниты фронтенда (Vitest)
make e2e     # браузерные сценарии @e2e (Playwright; сам собирает dist и поднимает studiod на :8199)
make trace   # docs/traceability.md из спек, сценариев и тестов; падает на непокрытом критерии
```

## Статус

M0 (каркас) — создание, сохранение, просмотр ассета каждого типа через placeholder; хранение и манифест на
бэкенде — спека [specs/000-scaffold](specs/000-scaffold/spec.md), отчёт [docs/M0-REPORT.md](docs/M0-REPORT.md).
M1 (редактирование модели) — импорт glTF/GLB, гизмо и числовые поля, материалы, undo, round-trip без потерь —
спека [specs/001-model-editing](specs/001-model-editing/spec.md), отчёт [docs/M1-REPORT.md](docs/M1-REPORT.md).
Дальше — текстуры (M2), рельеф и вегетация (M3), предметы, персонажи и загрузчик манифеста в клиенте wowd
(см. roadmap). Правила работы — в [AGENTS.md](AGENTS.md).
