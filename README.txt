# Сайт клана «Парламент»

Сайт работает как статическая страница на GitHub Pages. Серверный API запускается в Cloudflare Workers, данные хранятся в Cloudflare D1. Python не нужен.

## Первый запуск Cloudflare

Нужны Node.js и аккаунт Cloudflare. Команды ниже выполняются в PowerShell из папки `worker`:

```powershell
cd C:\Users\Admin\Desktop\parlament_site\worker
npx.cmd wrangler login
npx.cmd wrangler d1 create parlament
```

Cloudflare покажет `database_id`. Вставьте его вместо `REPLACE_WITH_D1_DATABASE_ID` в `wrangler.toml`, затем создайте таблицы и задайте начальный пароль админа:

```powershell
npx.cmd wrangler d1 execute parlament --remote --file=schema.sql
npx.cmd wrangler secret put AUTH_PEPPER
npx.cmd wrangler secret put ADMIN_PASSWORD
```

Сначала задайте `AUTH_PEPPER` как длинную случайную строку (это постоянный закрытый ключ хеширования; после первого входа его не меняйте). Затем задайте `ADMIN_PASSWORD` — начальный пароль, не короче 8 символов. Значения вводятся в запрос Wrangler и не сохраняются в публичных файлах. Для уведомлений можно отдельно задать секреты:

```powershell
npx.cmd wrangler secret put DISCORD_WEBHOOK
npx.cmd wrangler secret put TG_TOKEN
npx.cmd wrangler secret put TG_CHAT
```

Разверните API:

```powershell
npx.cmd wrangler deploy
```

В Cloudflare появится адрес Worker вида `https://parlament-api.<ваш-поддомен>.workers.dev`. В `public/index.html` замените `YOUR-SUBDOMAIN` в строке `API_URL` на свой поддомен Cloudflare. Адрес должен оканчиваться на `/api`.

После этого опубликуйте обновлённый `public/index.html` через ваш обычный источник GitHub Pages. Папки `worker` и `legacy`, файл `clan.db` и SQL-экспорт не должны попадать в публикуемый набор файлов GitHub Pages. Публикуйте только сайт из `public` (через текущий workflow или источник Pages).

## Перенос текущей базы SQLite

Сделайте копию `clan.db` перед переносом. В `worker` выполните:

```powershell
node export-sqlite.mjs ..\clan.db import.sql
npx.cmd wrangler d1 execute parlament --remote --file=import.sql
Remove-Item import.sql
```

`import.sql` содержит контакты заявителей и коды заявок. Он добавлен в `.gitignore`: не публикуйте и не отправляйте его в репозиторий. Экспорт переносит новости, правила, участников, заявки, достижения, голосования и голоса. Старые админские сессии не переносятся.

## Смена пароля администратора

После первого входа откройте вкладку «Админ», внизу панели заполните текущий и новый пароли и нажмите «Сменить пароль». Новый пароль должен быть не короче 8 символов. Пароль хранится в D1 как HMAC-хеш с секретом `AUTH_PEPPER`; активная сессия обновляется, остальные сбрасываются.

Если потеряли пароль, выполните команды из `worker/RESET-ADMIN.txt`: они сбросят сохранённый вход, после чего задайте новый `ADMIN_PASSWORD` и войдите им. Секрет `AUTH_PEPPER` оставьте прежним.

## Что где находится

- `public/index.html` — сайт и клиентский JavaScript.
- `worker/src/index.js` — API Worker без Python.
- `worker/schema.sql` — таблицы D1.
- `worker/export-sqlite.mjs` — разовый экспорт старой SQLite-базы в SQL для импорта.
- `worker/wrangler.toml` — настройки развёртывания и подключение D1.
- `worker/RESET-ADMIN.txt` и `worker/reset-admin.sql` — восстановление входа администратора.

